import { CompositeReleasable, Releasable } from './releasable';

/**
 * A collection of realm values
 * Value additions can be monitored through the instantiate function
 * When an observation obtained from the instantiate function is released,
 * all created values are expected to be released as well
 */
export abstract class Realm<T> {
  public abstract instantiate(observer: (value: T) => Releasable): Releasable;

  public map<U>(f: (value: T) => U): Realm<U> {
    return new BasicRealm<U>(create => {
      return this.instantiate(value => {
        return create(f(value));
      });
    });
  }

  public flatMap<U>(f: (value: T) => Realm<U>): Realm<U> {
    return new BasicRealm<U>(create => {
      // Observe the parent Realm
      return this.instantiate(value => {
        // Get and observe the child
        return f(value).instantiate(v => {
          return create(v);
        });
      });
    });
  }

  public filter(predicate: (value: T) => boolean): Realm<T> {
    return new BasicRealm<T>(create => {
      return this.instantiate(value => {
        if (predicate(value)) {
          return create(value);
        }
        return Releasable.noop;
      });
    });
  }

  public merge<U>(other: Realm<U>): Realm<T | U> {
    return new BasicRealm<T | U>(create => {
      const releaseLeft = this.instantiate(value => {
        return create(value);
      });
      const releaseRight = other.instantiate(value => {
        return create(value);
      });
      return Releasable.parallel([releaseLeft, releaseRight]);
    });
  }

  public static pure<T>(value: T): BasicRealm<T> {
    return new BasicRealm<T>(observer => {
      return observer(value);
    });
  }

  public static never<T>(): BasicRealm<T> {
    return new BasicRealm<T>(_observer => {
      return Releasable.noop;
    });
  }

  public static lazy<T>(thunk: () => Realm<T>): BasicRealm<T> {
    return new BasicRealm<T>(observer => {
      return thunk().instantiate(observer);
    });
  }
}

/**
 * 通常の Realm
 * subscribeFunc により観測が行われる。
 * Resource safety のために、発行した値は observation の寿命と一致するようにする。
 */
export class BasicRealm<T> extends Realm<T> {
  constructor(
    private readonly subscribeFunc: (
      observer: (value: T) => Releasable
    ) => Releasable
  ) {
    super();
  }

  public instantiate(observer: (value: T) => Releasable): Releasable {
    let resources: Set<{
      resource: T;
      releasable: Releasable;
      releasing: boolean;
    }> = new Set();
    let addResource: (v: T, releasable: Releasable) => Releasable;
    const waitForReleaseAll = new Promise<void>(
      resolve =>
        (addResource = (resource: T, releasable: Releasable) => {
          const v = { resource, releasable: Releasable.noop, releasing: false };
          v.releasable = {
            release: async () => {
              if (v.releasing) return;
              v.releasing = true;
              await releasable.release();
              v.releasing = false;
              resources.delete(v);
              if (resources.size === 0) {
                resolve();
              }
            },
          };
          resources.add(v);
          return v.releasable;
        })
    );
    const wrappedObserver = (value: T): Releasable => {
      const releasable = observer(value);
      const removeResource = addResource(value, releasable);
      return removeResource;
    };
    const releaseSubscription = this.subscribeFunc(wrappedObserver);
    return {
      release: async () => {
        // First, release the subscription to prevent new values
        await releaseSubscription.release();
        // Releasing でないものがあれば解放する
        for (const r of [...resources]) {
          if (!r.releasing) {
            await r.releasable.release();
          }
        }
        // Then, wait for all resources to be released
        if (resources.size !== 0) {
          await waitForReleaseAll;
        }
      },
    };
  }
}

/**
 * Effect Realm は、一回のみ値を発火させる可能性のある Realm である。
 * また、値が発火した場合、その寿命は observation の寿命と一致する。
 */
export class EffectRealm<T> extends Realm<T> {
  constructor(
    private readonly maker: (
      addReleasable: (releasable: Releasable) => void,
      abortSignal: AbortSignal
    ) => Promise<T> | T
  ) {
    super();
  }

  // 実行し、結果と releasable を取得する
  // releasable は実行することで Promise なら途中でキャンセルできる。
  public run(): {
    result: Promise<T> | T;
    releasable: Releasable;
  } {
    const abortController = new AbortController();
    const computationReleasable = new CompositeReleasable();

    // Start async operation
    const makerResult = this.maker((r: Releasable) => {
      computationReleasable.add(r);
    }, abortController.signal);

    if (makerResult instanceof Promise) {
      const resultPromise = makerResult.then(value => {
        return value;
      });
      return {
        result: resultPromise,
        releasable: Releasable.sequential([
          {
            release: async () => {
              abortController.abort();
            },
          },
          computationReleasable,
        ]),
      };
    } else {
      return {
        result: makerResult,
        releasable: Releasable.sequential([
          {
            release: async () => {
              abortController.abort();
            },
          },
          computationReleasable,
        ]),
      };
    }
  }

  public instantiate(observer: (value: T) => Releasable): Releasable {
    const { result, releasable } = this.run();
    if (result instanceof Promise) {
      let released = false;
      const asyncReleasable: Releasable = {
        release: async () => {
          released = true;
          await releasable.release();
        },
      };
      result
        .then(value => {
          if (released) return;
          const observationReleasable = observer(value);
          // 値が作成されたなら releasable にそれを追加する
          asyncReleasable.release = async () => {
            await Releasable.sequential([
              observationReleasable, // 値の解放
              releasable, // 計算の解放
            ]).release();
          };
        })
        .catch(_e => {
          // Ignore errors here; they should be handled in the maker function
        });
      return asyncReleasable;
    } else {
      const observationReleasable = observer(result);
      return Releasable.sequential([observationReleasable, releasable]);
    }
  }
}
