import { BiLinkMap } from './bilink-map';
import { BasicObservable, Blueprint, Observable } from './observable';
import { CompositeReleasable, Releasable } from './releasable';
import { TaskQueue } from './task-queue';

interface ValueInfo<T> extends Releasable {
  value: T;
}

/**
 * A place to store values
 * Simply viewed as Observable -> Observable transformation, but special in that
 * it calls the observe function of the passed Observable only once,
 * and uses the return value to construct a new Observable of values.
 * Memoizes Observables that are reused in various places, making initialization happen only once.
 * Also allows retrieving a list of currently held values.
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

  public observe(observer: (value: T) => Releasable): Releasable {
    this.observers.add(observer);
    // Link to all existing values
    // Note: link() is now async, but we can't await here as observe() needs to return immediately
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
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      )
      .map(result => result.reason);

    // If there were errors, throw the first one (or an aggregate error if multiple)
    if (errors.length > 0) {
      if (errors.length === 1) {
        throw errors[0];
      } else {
        throw new AggregateError(errors, 'Multiple errors during Store.release()');
      }
    }
  }
}

export namespace Store {
  /**
   * Instantiate a Blueprint.
   * If called within a Blueprint, that Blueprint becomes the parent
   * If called outside a Blueprint, creates an independent Store (not recommended: use fromBlueprint directly)
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
              // Get queued tasks to check if there are more recent updates
              const remainedTasks = tasks.getRemainingTasks();
              // Skip this task if:
              // 1. There are newer tasks queued (optimize by jumping to the latest)
              // 2. The value hasn't changed (deduplicate)
              if (remainedTasks.length > 0 || task === currentValue) {
                return;
              }

              // Release previous value
              await valueReleasable.release();
              // Create new value
              currentValue = task;
              valueReleasable.add(observer(currentValue));
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
   * Update values from any location.
   * The returned function is a Quon Blueprint. Therefore, it can only be called within a Blueprint.
   * When called in a Blueprint, value set/clear is registered.
   * When used in multiple places, multiple values belong simultaneously.
   */
  export function usePortal<T>(): [Store<T>, (newValue: T) => void] {
    return new BasicObservable<[Store<T>, (newValue: T) => void]>(create => {
      let innerCreateTunnel: (value: T) => Releasable;

      const innerStore: Store<T> = new Store<T>(
        new BasicObservable<T>(observer => {
          // Executed synchronously by Store constructor
          innerCreateTunnel = observer;
          return Releasable.noop;
        })
      );

      const releaseValue = create([
        innerStore,
        (value: T) => {
          // Add value
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
