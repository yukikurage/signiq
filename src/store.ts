import { BiLinkMap } from './bilink-map';
import { BasicRealm, EffectRealm, Realm } from './realm';
import { Resource } from './resource';

interface ValueInfo<T> extends Resource {
  value: T;
}

/**
 * A place to store values
 * Simply viewed as Realm -> Realm transformation, but special in that
 * it calls the instantiate function of the passed Realm only once,
 * and uses the return value to construct a new Realm of values.
 * Memoizes Realms that are reused in various places, making initialization happen only once.
 * Also allows retrieving a list of currently held values.
 */
export class Store<T> extends Realm<T> implements Resource {
  private bindings = new BiLinkMap<
    ValueInfo<T>,
    (value: T) => Resource,
    Resource
  >();
  private values = new Set<ValueInfo<T>>();
  private observers = new Set<(value: T) => Resource>();
  private releaseThis: Resource;
  private released = false;

  constructor(realm: Realm<T>) {
    super();
    this.releaseThis = realm.instantiate(this.create.bind(this));
  }

  private create(value: T): Resource {
    const v: ValueInfo<T> = {
      value,
      release: async () => {
        this.values.delete(v);
        await this.bindings.unlinkAllA(v);
      },
    };
    this.values.add(v);
    // Link to all existing observers
    // Note: link() is now async, but we can't await here as create() is sync
    // The links will be established asynchronously, but this should not affect correctness
    // as the synchronous observers will be called immediately
    [...this.observers].forEach(async o => {
      const link = o(value);
      await this.bindings.link(v, o, link);
    });
    return v;
  }

  public peek(): Iterable<T> {
    return [...this.values].map(v => v.value);
  }

  public instantiate(observer: (value: T) => Resource): Resource {
    this.observers.add(observer);
    // Link to all existing values
    // Note: link() is now async, but we can't await here as instantiate() needs to return immediately
    // The links will be established asynchronously
    [...this.values].forEach(async v => {
      const link = observer(v.value);
      await this.bindings.link(v, observer, link);
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

    // Use Promise.allSettled to ensure both release operations attempt to complete
    // even if one fails. This prevents partial cleanup.
    const results = await Promise.allSettled([
      this.releaseThis.release(),
      this.bindings.unlinkAll(),
    ]);

    // Collect any errors that occurred
    const errors = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected'
      )
      .map(result => result.reason);

    // If there were errors, throw the first one (or an aggregate error if multiple)
    if (errors.length > 0) {
      if (errors.length === 1) {
        throw errors[0];
      } else {
        throw new AggregateError(
          errors,
          'Multiple errors during Store.release()'
        );
      }
    }
  }
}

export namespace Store {
  /**
   * Wrap an Realm in a Store as an effect Realm.
   * The Store is created synchronously and returned.
   */
  export function newStoreRealm<T>(rlm: Realm<T>): Realm<Store<T>> {
    return new EffectRealm<Store<T>>((addResource, _abortSignal) => {
      const store = new Store(rlm);
      addResource(store);
      return store;
    });
  }

  /**
   * Create an Realm that provides a multi-value portal.
   * The setter returns an Realm<void> that represents adding/removing a value.
   * Multiple values can coexist in the Store.
   */
  export function newPortalRealm<T>(): Realm<
    [Store<T>, (newValue: T) => Realm<void>]
  > {
    return new EffectRealm<[Store<T>, (newValue: T) => Realm<void>]>(
      (addResource, _abortSignal) => {
        let innerCreateTunnel: (value: T) => Resource;

        const innerStore: Store<T> = new Store<T>(
          new BasicRealm<T>(observer => {
            // Executed synchronously by Store constructor
            innerCreateTunnel = observer;
            return Resource.noop;
          })
        );

        addResource(innerStore);

        return [
          innerStore,
          (value: T) => {
            // Return Realm<void> that adds the value
            return new BasicRealm<void>(create => {
              const resource = innerCreateTunnel(value);
              return Resource.sequential([create(undefined), resource]);
            });
          },
        ];
      }
    );
  }
}
