import { BiLinkMap } from './bilink-map';
import { BasicObservable, Blueprint, Observable } from './observable';
import { CompositeReleasable, Releasable } from './releasable';
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
export class Store<T> extends Observable<T> implements Releasable {
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
    super();
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
}

export namespace Store {
  /**
   * Blueprint をインスタンス化する。
   * Blueprint 内で呼ばれたならその Blueprint を親とする
   * Blueprint 外で呼ばれたなら独立した Store を作成する (非推奨 : instantiate を直接使う)
   */
  export function useBlueprint<T>(blueprint: () => T): Store<T> {
    const userContext = Blueprint.useUserContext();
    return Blueprint.useObservable(
      new BasicObservable<Store<T>>(create => {
        const store = new Store(Blueprint.toObservable(blueprint, userContext));
        const releaseValue = create(new Store<T>(store));
        return Releasable.sequential([releaseValue, store]);
      })
    );
  }

  export function fromBlueprint<T>(blueprint: () => T): Store<T> {
    return new Store(Blueprint.toObservable(blueprint));
  }

  export function useState<T>(
    initialValue: T
  ): [Store<T>, (newValue: T) => Promise<void>] {
    return new BasicObservable<[Store<T>, (newValue: T) => Promise<void>]>(
      create => {
        // Request task queue
        const tasks: TaskQueue<T> = new TaskQueue<T>();

        const innerStore = new Store<T>(
          new BasicObservable<T>(observer => {
            let currentValue: T = initialValue;
            const valueReleasable = new CompositeReleasable();
            valueReleasable.add(observer(initialValue));

            // Launch Tasks
            const releaseTaskProcess = tasks.launch(async task => {
              // Get queued tasks
              const remainedTasks = tasks.getRemainingTasks();
              if (remainedTasks.length > 0 || task === currentValue) {
                // Skip
                return;
              } else {
                // Release previous value
                await valueReleasable.release();
                // Create new value
                currentValue = task;
                valueReleasable.add(observer(currentValue));
              }
            });
            return Releasable.parallel([releaseTaskProcess, valueReleasable]);
          })
        );

        const releaseValue = create([
          innerStore,
          async (value: T) => {
            await tasks.enqueue(value);
          },
        ]);

        return Releasable.parallel([innerStore, releaseValue]);
      }
    ).use();
  }

  /**
   * 任意の場所から値を更新できる。
   * 返り値の関数は Quon Blueprint である。したがって、Blueprint 内でのみ呼ぶことができる。
   * Blueprint で呼び出した場合、値のセット / 消去が登録される。
   * 複数の箇所で使用した場合複数の値が同時に属する。
   */
  export function usePortal<T>(): [Store<T>, (newValue: T) => void] {
    return new BasicObservable<[Store<T>, (newValue: T) => void]>(create => {
      let innerCreateTunnel: (value: T) => Releasable;

      const innerStore: Store<T> = new Store<T>(
        new BasicObservable<T>(observer => {
          // Store constructor によって同期的に実行される
          innerCreateTunnel = observer;
          return Releasable.noop;
        })
      );

      const releaseValue = create([
        innerStore,
        (value: T) => {
          // 値を追加
          new BasicObservable(create => {
            const releasable = innerCreateTunnel(value);
            return Releasable.sequential([create(undefined), releasable]);
          }).use();
        },
      ]);

      return Releasable.sequential([releaseValue, innerStore]);
    }).use();
  }
}
