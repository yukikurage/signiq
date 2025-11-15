import { CompositeResource, Resource } from './resource';
import { Structural } from './structural';

/**
 * A collection of realm values
 * Value additions can be monitored through the instantiate function
 * When an observation obtained from the instantiate function is released,
 * all created values are expected to be released as well
 */
export abstract class Realm<T> {
  public abstract instantiate(observer: (value: T) => Resource): Resource;

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
        return Resource.noop;
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
      return Resource.parallel([releaseLeft, releaseRight]);
    });
  }

  public static pure<T>(value: T): BasicRealm<T> {
    return new BasicRealm<T>(observer => {
      return observer(value);
    });
  }

  public static never<T>(): BasicRealm<T> {
    return new BasicRealm<T>(_observer => {
      return Resource.noop;
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
      observer: (value: T) => Resource
    ) => Resource
  ) {
    super();
  }

  public instantiate(observer: (value: T) => Resource): Resource {
    let resources: Set<{
      resource: T;
      dependedResource: Resource;
      releasing: boolean;
    }> = new Set();
    let addResource: (v: T, resource: Resource) => Resource;
    const waitForReleaseAll = new Promise<void>(
      resolve =>
        (addResource = (resource: T, dependedResource: Resource) => {
          const v = {
            resource,
            dependedResource: Resource.noop,
            releasing: false,
          };
          v.dependedResource = {
            release: async () => {
              if (v.releasing) return;
              v.releasing = true;
              await dependedResource.release();
              v.releasing = false;
              resources.delete(v);
              if (resources.size === 0) {
                resolve();
              }
            },
          };
          resources.add(v);
          return v.dependedResource;
        })
    );
    const wrappedObserver = (value: T): Resource => {
      const resource = observer(value);
      const removeResource = addResource(value, resource);
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
            await r.dependedResource.release();
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
 * CellRealm は常に一つのリソースを持ち、さらにそのリソースはどのリソースも依存しない。
 * 外部から値の直接更新が可能である。
 */
export class CellRealm<T extends Structural>
  extends Realm<T>
  implements Resource
{
  private value: T;
  // Each observer instance tracks its own state
  private instances = new Set<{
    observer: (value: T) => Resource;
    currentResource: Resource;
    releasing: Set<Promise<void>>;
  }>();
  // Track if the CellRealm itself is being released
  private cellReleasing = false;

  constructor(initialValue: T) {
    super();
    this.value = initialValue;
  }

  public peek(): T {
    return this.value;
  }

  public modify(modifier: (currentValue: T) => T): void {
    const newValue = modifier(this.value);

    if (newValue === this.value) {
      return;
    }

    this.value = newValue;

    // For each instance, call observer with new value first, then release old resource
    for (const instance of this.instances) {
      const oldResource = instance.currentResource;

      // Call observer with new value (this happens immediately/synchronously)
      const newResource = instance.observer(this.value);
      instance.currentResource = newResource;

      // Immediately start releasing the old resource (asynchronously, but initiated right away)
      const releasingPromise = oldResource.release().then(() => {
        // Remove this specific promise from the set after completion
        instance.releasing.delete(releasingPromise);
      });

      instance.releasing.add(releasingPromise);
    }
  }

  public set(newValue: T): void {
    this.modify(_ => newValue);
  }

  public instantiate(observer: (value: T) => Resource): Resource {
    if (this.cellReleasing) {
      return Resource.noop;
    }

    // Call observer with current value immediately
    const initialResource = observer(this.value);

    const instance = {
      observer,
      currentResource: initialResource,
      releasing: new Set<Promise<void>>(),
    };

    this.instances.add(instance);

    return {
      release: async () => {
        // Wait for all pending releases to complete
        if (instance.releasing.size > 0) {
          await Promise.all(instance.releasing);
        }

        // Release the current resource
        await instance.currentResource.release();

        // Remove from instances
        this.instances.delete(instance);
      },
    };
  }

  public async release(): Promise<void> {
    this.cellReleasing = true;

    // Wait for all pending releases to complete, then release current resources
    const releasePromises: Promise<void>[] = [];

    for (const instance of this.instances) {
      const releaseTask = (async () => {
        // Wait for any pending release
        if (instance.releasing !== null) {
          await instance.releasing;
        }
        // Release current resource
        await instance.currentResource.release();
      })();

      releasePromises.push(releaseTask);
    }

    await Promise.all(releasePromises);

    // Clear all instances
    this.instances.clear();
  }

  public static persisted<T, U extends Structural>(
    source: Realm<T>,
    initialValue: U,
    onCreate?: (
      source: T,
      prevValue: U
    ) => {
      result: U;
      onDelete?: (deletePrevValue: U) => U;
    }
  ): Realm<Realm<U>> {
    return new EffectRealm<Realm<U>>(async (addResource, abortSignal) => {
      const cell = new CellRealm<U>(initialValue);
      addResource(cell);

      const releaseObservation = source.instantiate(source => {
        if (abortSignal.aborted) {
          return Resource.noop;
        }
        if (onCreate) {
          const currentValue = cell.peek();
          const { result: newValue, onDelete: onDeleteFunc } = onCreate(
            source,
            currentValue
          );
          cell.set(newValue);

          return {
            release: async () => {
              let updatedValue = cell.peek();
              if (onDeleteFunc) {
                updatedValue = onDeleteFunc(updatedValue);
              }
              cell.set(updatedValue);
            },
          };
        }
        return Resource.noop;
      });

      addResource(releaseObservation);

      return cell;
    });
  }
}

/**
 * Effect Realm は、一回のみ値を発火させる可能性のある Realm である。
 * また、値が発火した場合、その寿命は observation の寿命と一致する。
 */
export class EffectRealm<T> extends Realm<T> {
  constructor(
    private readonly maker: (
      addResource: (resource: Resource) => void,
      abortSignal: AbortSignal
    ) => Promise<T> | T
  ) {
    super();
  }

  // 実行し、結果と resource を取得する
  // resource は実行することで Promise なら途中でキャンセルできる。
  public run(): {
    result: Promise<T> | T;
    resource: Resource;
  } {
    const abortController = new AbortController();
    const computationResource = new CompositeResource();

    // Start async operation
    const makerResult = this.maker((r: Resource) => {
      computationResource.add(r);
    }, abortController.signal);

    if (makerResult instanceof Promise) {
      const resultPromise = makerResult.then(value => {
        return value;
      });
      return {
        result: resultPromise,
        resource: Resource.sequential([
          {
            release: async () => {
              abortController.abort();
            },
          },
          computationResource,
        ]),
      };
    } else {
      return {
        result: makerResult,
        resource: Resource.sequential([
          {
            release: async () => {
              abortController.abort();
            },
          },
          computationResource,
        ]),
      };
    }
  }

  public instantiate(observer: (value: T) => Resource): Resource {
    const { result, resource } = this.run();
    if (result instanceof Promise) {
      let released = false;
      const asyncResource: Resource = {
        release: async () => {
          released = true;
          await resource.release();
        },
      };
      result
        .then(value => {
          if (released) return;
          const observationResource = observer(value);
          // 値が作成されたなら resource にそれを追加する
          asyncResource.release = async () => {
            await Resource.sequential([
              observationResource, // 値の解放
              resource, // 計算の解放
            ]).release();
          };
        })
        .catch(_e => {
          // Ignore errors here; they should be handled in the maker function
        });
      return asyncResource;
    } else {
      const observationResource = observer(result);
      return Resource.sequential([observationResource, resource]);
    }
  }
}
