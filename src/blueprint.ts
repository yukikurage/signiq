import { BasicReleasable, CompositeReleasable, Releasable } from './releasable';
import { BasicObservable, Observable } from './observable';
import { Store } from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BlueprintResult = any;

type UserContext = Record<symbol, BlueprintResult>;

type BLUEPRINT_GLOBAL_CONTEXT_TYPE = {
  use<T>(observable: Observable<T>): T;
  getUserCtx(): UserContext;
};

let BLUEPRINT_GLOBAL_CONTEXT: BLUEPRINT_GLOBAL_CONTEXT_TYPE | undefined =
  undefined;

class BlueprintChainException<U, T> extends Error {
  private static readonly BLUEPRINT_CHAIN_EXCEPTION_SYMBOL = Symbol(
    'BlueprintChainException'
  );

  constructor(
    public readonly observable: Observable<U>,
    public readonly continuation: (value: U) => Observable<T>
  ) {
    super('BlueprintChainException (internal use only)');
    Object.setPrototypeOf(this, BlueprintChainException.prototype);
    (this as any)[BlueprintChainException.BLUEPRINT_CHAIN_EXCEPTION_SYMBOL] =
      true;
  }

  static isBlueprintChainException(
    e: unknown
  ): e is BlueprintChainException<unknown, unknown> {
    return (
      typeof e === 'object' &&
      e !== null &&
      BlueprintChainException.BLUEPRINT_CHAIN_EXCEPTION_SYMBOL in e &&
      (e as any)[BlueprintChainException.BLUEPRINT_CHAIN_EXCEPTION_SYMBOL] ===
        true
    );
  }
}

export namespace Blueprint {
  export type Context<T> = {
    key: symbol;
    useProvider(value: T): void;
    useConsumer(): T;
  };

  function getBlueprintGlobalContext(): BLUEPRINT_GLOBAL_CONTEXT_TYPE {
    const global = BLUEPRINT_GLOBAL_CONTEXT;
    if (global === undefined) {
      throw new Error(
        'Blueprint context access outside of Blueprint execution. ' +
          'Make sure to call this function only within a Blueprint (inside Blueprint.toObservable or Store.fromBlueprint).'
      );
    }
    return global;
  }

  function provideContext<T>(key: symbol, value: T): void {
    const global = getBlueprintGlobalContext();
    useObservable(
      new BasicObservable<void>(create => {
        const temp = global.getUserCtx()[key];
        global.getUserCtx()[key] = value;
        return Releasable.sequential([
          create(undefined),
          new BasicReleasable(async () => {
            if (temp === undefined) {
              delete global.getUserCtx()[key];
            } else {
              global.getUserCtx()[key] = temp;
            }
          }),
        ]);
      })
    );
  }

  function consumeContext<T>(key: symbol): T {
    const global = getBlueprintGlobalContext();
    const value = global.getUserCtx()[key];
    if (value === undefined) {
      const keyDescription = key.description || '<anonymous>';
      throw new Error(
        `No context value provided for key: ${keyDescription}. ` +
          'Make sure a parent Blueprint called useProvider() for this context.'
      );
    }
    // Type assertion is safe here because:
    // 1. The context key is type-branded (created by createContext<T>())
    // 2. The value is set by useProvider() with the correct type
    // 3. The symbol key ensures type consistency at compile time
    return value as T;
  }

  export function useUserContext(): UserContext {
    const global = getBlueprintGlobalContext();
    return { ...global.getUserCtx() };
  }

  /**
   * Create a context
   */
  export function createContext<T>(): Context<T> {
    return {
      key: Symbol('Quon.Context'),
      useProvider(value: T): void {
        provideContext(this.key, value);
      },
      useConsumer(): T {
        return consumeContext<T>(this.key);
      },
    };
  }

  export function toObservable<T>(
    blueprint: () => T,
    userCtx?: UserContext
  ): Observable<T> {
    const initialUserCtx = userCtx ?? {};

    // Run Blueprint with history (Array-based implementation)
    function runBlueprintWithHistory(
      history: BlueprintResult[]
    ): Observable<T> {
      let currentIndex = 0;

      // Function to chain Observables
      function use<U>(observable: Observable<U>): U {
        if (currentIndex < history.length) {
          // History available: return the historical value and advance index
          const value = history[currentIndex];
          currentIndex++;
          return value;
        } else {
          // History exhausted: create continuation and chain Observable
          const continuation = (v: U): Observable<T> => {
            // Array approach: copy array and append new value
            return runBlueprintWithHistory([...history, v]);
          };

          // Throw exception to return Observable from outer scope
          throw new BlueprintChainException<U, T>(observable, continuation);
        }
      }

      // Execute the Blueprint
      const temp = BLUEPRINT_GLOBAL_CONTEXT;
      BLUEPRINT_GLOBAL_CONTEXT = {
        use,
        getUserCtx: () => initialUserCtx,
      };
      try {
        const result = blueprint();
        BLUEPRINT_GLOBAL_CONTEXT = temp;
        return Observable.pure(result);
      } catch (e) {
        BLUEPRINT_GLOBAL_CONTEXT = temp;
        if (BlueprintChainException.isBlueprintChainException(e)) {
          // Catch Chain exception: chain Observable with continuation
          return e.observable.flatMap(e.continuation) as Observable<T>;
        }
        // If user code caught and re-threw a BlueprintChainException,
        // or if this is a genuine user error, re-throw it
        throw e;
      }
    }

    return runBlueprintWithHistory([]);
  }

  export function useObservable<T>(observable: Observable<T>): T {
    const global = getBlueprintGlobalContext();
    return global.use(observable);
  }

  export function use<T>(observable: Observable<T>): T {
    return useObservable(observable);
  }

  export function useNever(): never {
    return useObservable(BasicObservable.never<never>());
  }

  export function useGuard(predicate: () => boolean): void {
    return useObservable(
      new BasicObservable<void>(create => {
        if (!predicate()) {
          return Releasable.noop;
        }
        return create(undefined);
      })
    );
  }

  export function useIterable<T>(iterable: Iterable<T>): T {
    return useObservable(
      new BasicObservable<T>(create => {
        const releasables: Releasable[] = [];
        for (const value of iterable) {
          const r = create(value);
          releasables.push(r);
        }
        return Releasable.sequential(releasables.reverse());
      })
    );
  }

  export function useParallel<T, U>(
    leftBlueprint: () => T,
    rightBlueprint: () => U
  ): T | U {
    return useObservable(
      Blueprint.toObservable(leftBlueprint).merge(
        Blueprint.toObservable(rightBlueprint)
      )
    );
  }

  export function useEffect<T>(
    maker: (
      addReleasable: (releasable: Releasable) => void,
      abortSignal: AbortSignal
    ) => Promise<T> | T
  ): T {
    return useObservable(
      new BasicObservable<T>(create => {
        const abortController = new AbortController();
        const computationReleasable = new CompositeReleasable();
        const valueReleasable = new CompositeReleasable();

        // Start async operation
        const makerResult = maker((r: Releasable) => {
          computationReleasable.add(r);
        }, abortController.signal);

        if (makerResult instanceof Promise) {
          makerResult
            .then(value => {
              if (!abortController.signal.aborted) {
                valueReleasable.add(create(value));
              }
            })
            .catch(err => {
              // Log error to help with debugging
              if (!abortController.signal.aborted) {
                console.error(
                  'Error in Blueprint.useEffect:',
                  err instanceof Error ? err.message : err
                );
                if (err instanceof Error && err.stack) {
                  console.error('Stack trace:', err.stack);
                }
              }
              // Note: Errors are logged but not propagated to avoid breaking the Observable chain
              // Users should handle errors within their maker function if they need custom error handling
            });
        } else {
          if (!abortController.signal.aborted) {
            valueReleasable.add(create(makerResult));
          }
        }

        return Releasable.sequential([
          valueReleasable,
          {
            release: async () => {
              abortController.abort();
            },
          },
          computationReleasable,
        ]);
      })
    );
  }

  export function useTimeout(delayMs: number): void {
    return useObservable(
      new BasicObservable<void>(create => {
        const valueReleasable = new CompositeReleasable();
        const timeout = setTimeout(() => {
          valueReleasable.add(create(undefined));
        }, delayMs);
        return Releasable.parallel([
          {
            release: async () => {
              clearTimeout(timeout);
            },
          },
          valueReleasable,
        ]);
      })
    );
  }

  // ============================================================================
  // Store-related convenience functions
  // ============================================================================

  /**
   * Create a Store from a Blueprint outside of a Blueprint context.
   * This is the main entry point for creating root Stores.
   */
  export function toStore<T>(blueprint: () => T): Store<T> {
    return new Store(Blueprint.toObservable(blueprint));
  }

  /**
   * Create a Store from a Blueprint within a Blueprint context.
   * The created Store will be a child of the current Blueprint.
   */
  export function useStore<T>(blueprint: () => T): Store<T> {
    const userContext = Blueprint.useUserContext();
    const obs = Blueprint.toObservable(blueprint, userContext);
    return Blueprint.use(Store.newStoreObservable(obs));
  }

  /**
   * Create a single-value cell within a Blueprint.
   * The setter replaces the current value (releases old, creates new).
   * This is a convenience wrapper around Store.newCellObservable().
   */
  export function useCell<T>(
    initialValue: T
  ): [Store<T>, (newValue: T) => Promise<void>] {
    return Blueprint.use(Store.newCellObservable(initialValue));
  }

  /**
   * Create a multi-value portal within a Blueprint.
   * The setter is a Blueprint function that adds/removes values.
   * Multiple values can coexist in the Store.
   * This is a convenience wrapper around Store.newPortalObservable().
   */
  export function usePortal<T>(): [Store<T>, (newValue: T) => void] {
    return Blueprint.use(
      Store.newPortalObservable<T>().map(([s, set]) => [
        s,
        (value: T) => {
          return Blueprint.use(set(value));
        },
      ])
    );
  }
}
