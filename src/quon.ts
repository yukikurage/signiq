import { BiLinkMap } from './bilink-map';
import { Observable } from './observable';
import { Queue } from './queue';
import { Releasable } from './releasable';
import { TaskQueue } from './task-queue';

interface ValueInfo<T> extends Releasable {
  value: T;
}

/**
 * 値を貯めておく場所
 * 単純にみると Observable -> Observable の変換であるが、
 * 渡された値の Observable の observe 関数を一度のみ呼び出し、
 * その返り値を使って新しい値の Observable を構築するという点で特殊。
 * いろいろな場所で使いまわされる Observable をメモ化し、初期化処理を一回のみに変える
 * また、現在保持している値の一覧を取得できる
 */
export class Store<T> implements Releasable, Observable<T> {
  private bindings = new BiLinkMap<
    ValueInfo<T>,
    (value: T) => Releasable,
    Releasable
  >();
  private values = new Set<ValueInfo<T>>();
  private observers = new Set<(value: T) => Releasable>();
  private releaseThis: Releasable;
  private released = false;

  constructor(observable: Observable<T>) {
    this.releaseThis = observable.observe(this.create.bind(this));
  }

  private create(value: T): Releasable {
    const v: ValueInfo<T> = {
      value,
      release: async () => {
        this.values.delete(v);
        await this.bindings.unlinkAllA(v);
      },
    };
    this.values.add(v);
    // すでに存在する observer 全員に対してリンクを貼る
    [...this.observers].forEach(o => {
      const link = o(value);
      this.bindings.link(v, o, link);
    });
    return v;
  }

  public peek(): Iterable<T> {
    return [...this.values].map(v => v.value);
  }

  public observe(observer: (value: T) => Releasable): Releasable {
    this.observers.add(observer);
    // すでに存在する値全員に対してリンクを貼る
    [...this.values].forEach(v => {
      const link = observer(v.value);
      this.bindings.link(v, observer, link);
    });
    return {
      release: async () => {
        this.observers.delete(observer);
        await this.bindings.unlinkAllB(observer);
      },
    };
  }

  public async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    await this.releaseThis.release();
    // releaseThis　は全ての Link を解除していると期待されるが、念のためこちらでも解除しておく
    await this.bindings.unlinkAll();
  }

  public use(): T {
    return Quon.useObservable(this);
  }
}

type ObservableResult = any;

type BLUEPRINT_GLOBAL_CONTEXT_TYPE = {
  use<T>(blueprint: Observable<T>): T;
};

let BLUEPRINT_GLOBAL_CONTEXT: BLUEPRINT_GLOBAL_CONTEXT_TYPE | undefined =
  undefined;

class StoreChainException<U, T> {
  constructor(
    public readonly observable: Observable<U>,
    public readonly continuation: (value: U) => Observable<T>
  ) {}
}

export namespace Quon {
  export function useObservable<T>(observable: Observable<T>): T {
    const global = BLUEPRINT_GLOBAL_CONTEXT;
    if (global === undefined) {
      throw new Error('Quon.useObservable must be called within Quon.launch');
    }
    // 一時的に Store にラップして useStore を使う
    return global.use(observable);
  }

  function launch<T>(blueprint: () => T): Observable<T> {
    // 履歴と一緒に Blueprint を実行する
    function runBlueprintWithHistory(
      history: Queue<ObservableResult>
    ): Observable<T> {
      let currentHistory = history;

      // Observable をチェインさせるための関数f
      function use<U>(observable: Observable<U>): U {
        const dequeued = Queue.dequeue(currentHistory);

        if (dequeued !== undefined) {
          // 履歴がある場合: 履歴の値を返し、残りの履歴で続行
          const { value, queue: remainingHistory } = dequeued;
          currentHistory = remainingHistory;
          return value;
        } else {
          // 履歴が枯渇した場合: 継続を作成して Store をチェイン
          const continuation = (v: U): Observable<T> => {
            return runBlueprintWithHistory(Queue.enqueue(history, v));
          };

          // 例外を throw して外側で Store を返す
          throw new StoreChainException<U, T>(observable, continuation);
        }
      }

      // Blueprint の実行
      const temp = BLUEPRINT_GLOBAL_CONTEXT;
      BLUEPRINT_GLOBAL_CONTEXT = { use };
      try {
        const result = blueprint();
        BLUEPRINT_GLOBAL_CONTEXT = temp;
        return Observable.pure(result);
      } catch (e) {
        BLUEPRINT_GLOBAL_CONTEXT = temp;
        if (e instanceof StoreChainException) {
          // Chain 例外をキャッチ: Observable と 継続をチェイン
          // observe に継続を登録する
          return Observable.make(create => {
            // 親 Store を observe
            return e.observable.observe(value => {
              // 継続で子 Observation を取得
              const childObservable = e.continuation(value);
              // 子 Store を observe
              return childObservable.observe(v => {
                return create(v);
              });
            });
          });
        }
        throw e;
      }
    }

    return runBlueprintWithHistory(Queue.empty());
  }

  /**
   * Blueprint をインスタンス化する。
   * Blueprint 内で呼ばれたならその Blueprint を親とする
   * Blueprint 外で呼ばれたなら独立した Store を作成する
   */
  export function instantiate<T>(blueprint: () => T): Store<T> {
    const global = BLUEPRINT_GLOBAL_CONTEXT;
    if (global === undefined) {
      // Blueprint 外で呼ばれた場合: 独立した Store を作成
      return new Store(launch(blueprint));
    } else {
      return Quon.useObservable(
        Observable.make<Store<T>>(create => {
          // Blueprint を実行
          const innerStore = new Store(launch(blueprint));
          const releaseValue = create(innerStore);

          // innerStore を observe
          return Releasable.sequential([releaseValue, innerStore]);
        })
      );
    }
  }

  export function useNever(): never {
    return Quon.useObservable(Observable.never());
  }

  export function useState<T>(
    initialValue: T
  ): [Store<T>, (newValue: T) => Promise<void>] {
    return Quon.useObservable(
      Observable.make<[Store<T>, (newValue: T) => Promise<void>]>(create => {
        // Request task queue
        const tasks: TaskQueue<T> = new TaskQueue<T>();

        const innerStore = new Store<T>(
          Observable.make<T>(observer => {
            let currentValue: T = initialValue;
            let currentReleasable: Releasable = observer(initialValue);

            // Launch Tasks
            const releaseTaskProcess = tasks.launch(async task => {
              // Get queued tasks
              const remainedTasks = tasks.getRemainingTasks();
              if (remainedTasks.length > 0 || task === currentValue) {
                // Skip
                return;
              } else {
                // Release previous value
                await currentReleasable.release();
                // Create new value
                currentValue = task;
                currentReleasable = observer(currentValue);
              }
            });
            return Releasable.parallel([
              releaseTaskProcess,
              {
                release: async () => {
                  await currentReleasable.release();
                },
              },
            ]);
          })
        );

        const releaseValue = create([
          innerStore,
          async (value: T) => {
            await tasks.enqueue(value);
          },
        ]);

        return Releasable.parallel([innerStore, releaseValue]);
      })
    );
  }

  export function useGuard(predicate: () => boolean): void {
    return Quon.useObservable(
      Observable.make<void>(create => {
        if (!predicate()) {
          return Releasable.noop;
        }
        return create(undefined);
      })
    );
  }

  export function useIterable<T>(iterable: Iterable<T>): T {
    return Quon.useObservable(
      Observable.make<T>(create => {
        const releasables: Releasable[] = [];
        for (const value of iterable) {
          const r = create(value);
          releasables.push(r);
        }
        return Releasable.sequential(releasables.reverse());
      })
    );
  }

  export function useEffect<T>(
    maker: (
      addReleasable: (releasable: Releasable) => void,
      abortSignal: AbortSignal
    ) => Promise<T> | T
  ): T {
    return Quon.useObservable(
      Observable.make(create => {
        const abortController = new AbortController();
        const releasables: Releasable[] = [];
        let releaseValue: Releasable = Releasable.noop;

        // Start async operation
        const makerResult = maker((r: Releasable) => {
          releasables.push(r);
        }, abortController.signal);

        if (makerResult instanceof Promise) {
          makerResult
            .then(value => {
              if (!abortController.signal.aborted) {
                releaseValue = create(value);
              }
            })
            .catch(err => {
              // Ignore errors
            });
        } else {
          if (!abortController.signal.aborted) {
            releaseValue = create(makerResult);
          }
        }

        return {
          release: async () => {
            await releaseValue.release();
            // Abort async operation
            abortController.abort();
            // Release all collected releasables (reverse order)
            for (const r of [...releasables].reverse()) {
              await r.release();
            }
          },
        };
      })
    );
  }

  export function useTimeout(delayMs: number): void {
    return Quon.useObservable(
      Observable.make(create => {
        let releaseValue: Releasable = Releasable.noop;
        const timeout = setTimeout(() => {
          releaseValue = create(undefined);
        }, delayMs);
        return Releasable.parallel([
          {
            release: async () => {
              clearTimeout(timeout);
            },
          },
          {
            release: async () => {
              await releaseValue.release();
            },
          },
        ]);
      })
    );
  }
}
