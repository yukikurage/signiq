import { BasicReleasable, CompositeReleasable, Releasable } from './releasable';
import { BasicObservable, EffectObservable, Observable } from './observable';
import { Store } from './store';
import { is, List } from 'immutable';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BlueprintResult = any;

type UserContext = Record<symbol, BlueprintResult>;

type BLUEPRINT_GLOBAL_CONTEXT_TYPE = {
  use<T>(observable: Observable<T>): T;
  getUserCtx(): UserContext;
};

let BLUEPRINT_GLOBAL_CONTEXT: BLUEPRINT_GLOBAL_CONTEXT_TYPE | undefined =
  undefined;

const BLUEPRINT_CHAIN_EXCEPTION_SYMBOL = Symbol('BlueprintChainException');

class BlueprintChainException {
  public readonly [BLUEPRINT_CHAIN_EXCEPTION_SYMBOL]: true = true;
  constructor(public readonly releasable: Releasable) {}
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
      new EffectObservable<void>((addReleasable, _abortSignal) => {
        const temp = global.getUserCtx()[key];
        global.getUserCtx()[key] = value;

        addReleasable(
          new BasicReleasable(async () => {
            if (temp === undefined) {
              delete global.getUserCtx()[key];
            } else {
              global.getUserCtx()[key] = temp;
            }
          })
        );

        return undefined;
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

  /**
   * Convert a Blueprint function into an Observable.
   */
  export function toObservable<T>(
    blueprint: () => T,
    userCtx?: UserContext
  ): Observable<T> {
    const initialUserCtx = userCtx ?? {};

    // Observe blueprint with given history
    // この関数自体は同期的であることに注意。
    function observeBlueprint(
      initialHistory: List<BlueprintResult>,
      create: (value: T) => Releasable
    ): Releasable {
      let history = initialHistory; // let で管理して同期実行時に伸ばす
      let currentIndex = 0;

      // 同期的な releasable を保持するための CompositeReleasable
      const syncResultReleasable: CompositeReleasable =
        new CompositeReleasable();
      let currentResultReleasable: CompositeReleasable = syncResultReleasable;

      // Function to chain Observables
      function use<U>(observable: Observable<U>): U {
        if (currentIndex < history.size) {
          // History available: return the historical value and advance index
          const value = history.get(currentIndex);
          currentIndex++;
          return value;
        } else {
          const currentHistory = history;
          const observeCont = (
            v: U,
            create: (value: T) => Releasable
          ): Releasable => {
            // Immutable.List approach: O(log n) persistent append
            return observeBlueprint(currentHistory.push(v), create);
          };
          let syncResult:
            | undefined
            | {
                tag: 'DONE';
                result: U;
                nextCurrentResultReleasable: CompositeReleasable;
              }
            | {
                tag: 'ASYNC';
              };
          const observer = (v: U): Releasable => {
            if (!syncResult) {
              // nextCurrentResultReleasable を更新する
              const releasable = new CompositeReleasable();
              syncResult = {
                tag: 'DONE',
                result: v,
                nextCurrentResultReleasable: releasable,
              };
              return releasable;
            } else {
              // 非同期 (または二回目以降の) 呼び出し
              return observeCont(v, create);
            }
          };

          const observation = observable.observe(observer);

          if (syncResult?.tag === 'DONE') {
            currentResultReleasable.add(observation);
            currentResultReleasable = syncResult.nextCurrentResultReleasable;
            const result = syncResult.result;
            history = history.push(result);
            currentIndex++;
            syncResult = { tag: 'ASYNC' };
            return result;
          } else {
            // 非同期
            syncResult = { tag: 'ASYNC' };
            currentResultReleasable.add(observation);
            throw BLUEPRINT_CHAIN_EXCEPTION_SYMBOL;
          }
          // }
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
        currentResultReleasable.add(create(result));
        return syncResultReleasable;
      } catch (e) {
        BLUEPRINT_GLOBAL_CONTEXT = temp;
        if (e === BLUEPRINT_CHAIN_EXCEPTION_SYMBOL) {
          return syncResultReleasable;
        }
        // If user code caught and re-threw a BlueprintChainException,
        // or if this is a genuine user error, re-throw it
        throw e;
      }
    }

    return new BasicObservable<T>(create => {
      return observeBlueprint(List<BlueprintResult>(), create);
    });
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
      new EffectObservable<T>((addReleasable, abortSignal) => {
        return maker(addReleasable, abortSignal);
      })
    );
  }

  export function useTimeout(delayMs: number): void {
    return useObservable(
      new EffectObservable<void>((addReleasable, abortSignal) => {
        return new Promise<void>(resolve => {
          const timeout = setTimeout(() => {
            if (!abortSignal.aborted) {
              resolve();
            }
          }, delayMs);

          addReleasable({
            release: async () => {
              clearTimeout(timeout);
            },
          });
        });
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
