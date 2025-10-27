import { BiLinkMap } from './bilink-map';
import { TaskQueue } from './task-queue';
import { Releasable } from './releasable';
import { BlueprintDSL } from './blueprint-dsl.js';

interface ValueInfo<T> extends Releasable {
  value: T;
}

/**
 * 実際に占有された領域
 */
export class Cluster<T> implements Releasable {
  private bindings = new BiLinkMap<
    ValueInfo<T>,
    (value: T) => Releasable,
    Releasable
  >();
  private values = new Set<ValueInfo<T>>();
  private observers = new Set<(value: T) => Releasable>();
  private releaseThis: Releasable;
  private released = false;

  constructor(init: (create: (value: T) => Releasable) => Releasable) {
    this.releaseThis = init(this.create.bind(this));
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

  // Cluster を監視する Blueprint を生成する
  public view(): Blueprint<T> {
    return new Blueprint<T>(create => {
      return this.observe(value => {
        return create(value);
      });
    });
  }

  public async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    await this.releaseThis.release();
    // releaseThis　は全ての Link を解除していると期待されるが、念のためこちらでも解除しておく
    await this.bindings.unlinkAll();
  }
}

/**
 * 純粋層
 * instantiate によって実際に占有された領域 (Cluster) を生成する
 */
export class Blueprint<T> {
  constructor(private init: (create: (value: T) => Releasable) => Releasable) {}

  public launch(): Cluster<T> {
    return new Cluster<T>(create => {
      return this.init(create);
    });
  }

  public map<U>(f: (v: T) => U): Blueprint<U> {
    return new Blueprint<U>(create => {
      return this.init(value => {
        return create(f(value));
      });
    });
  }

  public filter(f: (v: T) => boolean): Blueprint<T> {
    return new Blueprint<T>(create => {
      return this.init(value => {
        if (f(value)) {
          return create(value);
        } else {
          return Releasable.noop;
        }
      });
    });
  }

  public flatMap<U>(f: (v: T) => Blueprint<U>): Blueprint<U> {
    return new Blueprint<U>(create => {
      // 親の初期化
      return this.init(value => {
        // 親からの create 通知

        // 部分的に Blueprint をインスタンス化
        const innerCluster = f(value).launch();

        innerCluster.observe(v => {
          // 内部 Blueprint からの create 通知
          return create(v);
        });

        // 親の値がリリースされるときは innerCluster もリリースする
        return innerCluster;
      });
    });
  }

  /**
   * Blueprint を他の Blueprint 内で instantiate する。
   * できた Cluster は親 Blueprint のライフサイクルに従う
   */
  public instantiate(): Blueprint<Cluster<T>> {
    return new Blueprint<Cluster<T>>(create => {
      const parentCluster = this.launch();

      // 子のインスタンスを作成
      const childCluster = new Cluster<T>(childCreate => {
        // 親の各値に対して処理
        return parentCluster.observe(value => {
          return childCreate(value);
        });
      });

      // childCluster を Blueprint として返す
      const releaseValue = create(childCluster);

      return Releasable.sequential([releaseValue, childCluster]);
    });
  }

  // For DSL
  public get use(): T {
    return BlueprintDSL.use<T>(this);
  }
}

export namespace Blueprint {
  export function basic<T>(
    init: (create: (v: T) => Releasable) => Releasable
  ): Blueprint<T> {
    return new Blueprint(init);
  }

  export function state<T>(
    init: T
  ): Blueprint<[Cluster<T>, (value: T) => Promise<void>]> {
    return new Blueprint<[Cluster<T>, (value: T) => Promise<void>]>(create => {
      // Request task queue
      const tasks: TaskQueue<T> = new TaskQueue<T>();

      const innerCluster = new Cluster<T>(innerCreate => {
        let currentValue: T = init;
        let currentReleasable: Releasable = innerCreate(init);
        // Launch Tasks
        const tqCluster = tasks.launch(async task => {
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
            currentReleasable = innerCreate(currentValue);
          }
        });
        return Releasable.parallel([tqCluster, currentReleasable]);
      });

      const releaseValue = create([
        innerCluster,
        async (value: T) => {
          await tasks.enqueue(value);
        },
      ]);

      return Releasable.parallel([innerCluster, releaseValue]);
    });
  }

  export function pure<T>(value: T): Blueprint<T> {
    return new Blueprint<T>(create => {
      return create(value);
    });
  }

  export function never(): Blueprint<never> {
    return new Blueprint<never>(_create => {
      return Releasable.noop;
    });
  }

  export function fromIterable<T>(iterable: Iterable<T>): Blueprint<T> {
    return new Blueprint<T>(create => {
      for (const value of iterable) {
        create(value);
      }
      return Releasable.noop;
    });
  }

  export function effect<T>(
    maker: (
      addReleasable: (releasable: Releasable) => void,
      abortSignal: AbortSignal
    ) => Promise<T> | T
  ): Blueprint<T> {
    return new Blueprint<T>(create => {
      const abortController = new AbortController();
      const releasables: Releasable[] = [];

      // Start async operation
      const makerResult = maker((r: Releasable) => {
        releasables.push(r);
      }, abortController.signal);

      if (makerResult instanceof Promise) {
        makerResult.then(value => {
          if (!abortController.signal.aborted) {
            create(value);
          }
        });
      } else {
        if (!abortController.signal.aborted) {
          create(makerResult);
        }
      }

      return {
        release: async () => {
          // Abort async operation
          abortController.abort();
          // Release all collected releasables (reverse order)
          for (const r of [...releasables].reverse()) {
            await r.release();
          }
        },
      };
    });
  }

  export function wait(delayMs: number): Blueprint<void> {
    return new Blueprint<void>(create => {
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
        releaseValue,
      ]);
    });
  }
}

export namespace Blueprint {
  export const build = BlueprintDSL.build;
}
