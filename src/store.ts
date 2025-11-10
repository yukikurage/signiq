import { BiLinkMap } from './bilink-map';
import { BasicRealm, EffectRealm, Realm } from './realm';
import { CompositeReleasable, Releasable } from './releasable';
import { Structural } from './structural';
import { TaskQueue } from './task-queue';

interface ValueInfo<T> extends Releasable {
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
export class Store<T> extends Realm<T> implements Releasable {
  private bindings = new BiLinkMap<
    ValueInfo<T>,
    (value: T) => Releasable,
    Releasable
  >();
  private values = new Set<ValueInfo<T>>();
  private observers = new Set<(value: T) => Releasable>();
  private releaseThis: Releasable;
  private released = false;

  constructor(realm: Realm<T>) {
    super();
    this.releaseThis = realm.instantiate(this.create.bind(this));
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

  public instantiate(observer: (value: T) => Releasable): Releasable {
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
    return new EffectRealm<Store<T>>((addReleasable, _abortSignal) => {
      const store = new Store(rlm);
      addReleasable(store);
      return store;
    });
  }

  /**
   * Create an Realm that provides a single-value cell.
   * The setter replaces the current value (releases old, creates new).
   */
  export function newCellRealm<T extends Structural>(
    initialValue: T
  ): Realm<[Store<T>, (update: T | ((prevValue: T) => T)) => Promise<void>]> {
    return new EffectRealm<
      [Store<T>, (update: T | ((prevValue: T) => T)) => Promise<void>]
    >((addReleasable, _abortSignal) => {
      // Request task queue
      const tasks: TaskQueue<(prevValue: T) => T> = new TaskQueue<
        (prevValue: T) => T
      >();

      const innerStore = new Store<T>(
        new BasicRealm<T>(observer => {
          let currentValue: T = initialValue;
          const valueReleasable = new CompositeReleasable();
          valueReleasable.add(observer(initialValue));

          // Launch Tasks
          const releaseTaskProcess = tasks.launch(async task => {
            // Get queued tasks to check if there are more recent updates
            const remainedTasks = tasks.getRemainingTasks();
            // Skip this task if:
            // 1. There are newer tasks queued (optimize by jumping to the latest)
            // 2. The value hasn't changed (deduplicate)
            if (remainedTasks.length > 0) {
              return;
            }
            const newValue = task(currentValue);
            if (newValue === currentValue) {
              return;
            }

            // Release previous value
            await valueReleasable.release();
            // Create new value
            currentValue = newValue;
            valueReleasable.add(observer(currentValue));
          });
          return Releasable.parallel([releaseTaskProcess, valueReleasable]);
        })
      );

      addReleasable(innerStore);

      return [
        innerStore,
        async (update: T | ((prevValue: T) => T)) => {
          await tasks.enqueue(prevValue => {
            if (typeof update === 'function') {
              // Function update
              return (update as (prevValue: T) => T)(prevValue);
            } else {
              // Direct value update
              return update;
            }
          });
        },
      ];
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
      (addReleasable, _abortSignal) => {
        let innerCreateTunnel: (value: T) => Releasable;

        const innerStore: Store<T> = new Store<T>(
          new BasicRealm<T>(observer => {
            // Executed synchronously by Store constructor
            innerCreateTunnel = observer;
            return Releasable.noop;
          })
        );

        addReleasable(innerStore);

        return [
          innerStore,
          (value: T) => {
            // Return Realm<void> that adds the value
            return new BasicRealm<void>(create => {
              const releasable = innerCreateTunnel(value);
              return Releasable.sequential([create(undefined), releasable]);
            });
          },
        ];
      }
    );
  }
}
