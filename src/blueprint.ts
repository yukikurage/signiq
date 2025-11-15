import { BasicResource, CompositeResource, Resource } from './resource';
import { BasicRealm, CellRealm, EffectRealm, Realm } from './realm';
import { Store } from './store';
import { is, List } from 'immutable';
import { Structural } from './structural';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BlueprintResult = any;

type UserContext = Record<symbol, BlueprintResult>;

type BLUEPRINT_GLOBAL_CONTEXT_TYPE = {
  use<T>(realm: Realm<T>): T;
  getUserCtx(): UserContext;
};

let BLUEPRINT_GLOBAL_CONTEXT: BLUEPRINT_GLOBAL_CONTEXT_TYPE | undefined =
  undefined;

const BLUEPRINT_CHAIN_EXCEPTION_SYMBOL = Symbol('BlueprintChainException');

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
          'Make sure to call this function only within a Blueprint (inside Blueprint.toRealm or Store.fromBlueprint).'
      );
    }
    return global;
  }

  function provideContext<T>(key: symbol, value: T): void {
    const global = getBlueprintGlobalContext();
    useRealm(
      new EffectRealm<void>((addResource, _abortSignal) => {
        const temp = global.getUserCtx()[key];
        global.getUserCtx()[key] = value;

        addResource(
          new BasicResource(async () => {
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
   * Convert a Blueprint function into an Realm.
   */
  export function toRealm<T>(
    blueprint: () => T,
    userCtx?: UserContext
  ): Realm<T> {
    const initialUserCtx = userCtx ?? {};

    // Observe blueprint with given history
    // この関数自体は同期的であることに注意。
    function observeBlueprint(
      initialHistory: List<BlueprintResult>,
      create: (value: T) => Resource
    ): Resource {
      let history = initialHistory; // let で管理して同期実行時に伸ばす
      let currentIndex = 0;

      // 同期的な resource を保持するための CompositeResource
      const syncResultResource: CompositeResource = new CompositeResource();
      let currentResultResource: CompositeResource = syncResultResource;

      // Function to chain Realms
      function use<U>(realm: Realm<U>): U {
        if (currentIndex < history.size) {
          // History available: return the historical value and advance index
          const value = history.get(currentIndex);
          currentIndex++;
          return value;
        } else {
          const currentHistory = history;
          const observeCont = (
            v: U,
            create: (value: T) => Resource
          ): Resource => {
            // Immutable.List approach: O(log n) persistent append
            return observeBlueprint(currentHistory.push(v), create);
          };
          let syncResult:
            | undefined
            | {
                tag: 'DONE';
                result: U;
                nextCurrentResultResource: CompositeResource;
              }
            | {
                tag: 'ASYNC';
              };
          const observer = (v: U): Resource => {
            if (!syncResult) {
              // nextCurrentResultResource を更新する
              const resource = new CompositeResource();
              syncResult = {
                tag: 'DONE',
                result: v,
                nextCurrentResultResource: resource,
              };
              return resource;
            } else {
              // 非同期 (または二回目以降の) 呼び出し
              return observeCont(v, create);
            }
          };

          const observation = realm.instantiate(observer);

          if (syncResult?.tag === 'DONE') {
            currentResultResource.add(observation);
            currentResultResource = syncResult.nextCurrentResultResource;
            const result = syncResult.result;
            history = history.push(result);
            currentIndex++;
            syncResult = { tag: 'ASYNC' };
            return result;
          } else {
            // 非同期
            syncResult = { tag: 'ASYNC' };
            currentResultResource.add(observation);
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
        currentResultResource.add(create(result));
        return syncResultResource;
      } catch (e) {
        BLUEPRINT_GLOBAL_CONTEXT = temp;
        if (e === BLUEPRINT_CHAIN_EXCEPTION_SYMBOL) {
          return syncResultResource;
        }
        // If user code caught and re-threw a BlueprintChainException,
        // or if this is a genuine user error, re-throw it
        throw e;
      }
    }

    return new BasicRealm<T>(create => {
      return observeBlueprint(List<BlueprintResult>(), create);
    });
  }

  export function useRealm<T>(realm: Realm<T>): T {
    const global = getBlueprintGlobalContext();
    return global.use(realm);
  }

  export function use<T>(realm: Realm<T>): T {
    return useRealm(realm);
  }

  export function useNever(): never {
    return useRealm(BasicRealm.never<never>());
  }

  export function useGuard(predicate: () => boolean): void {
    return useRealm(
      new BasicRealm<void>(create => {
        if (!predicate()) {
          return Resource.noop;
        }
        return create(undefined);
      })
    );
  }

  export function useIterable<T>(iterable: Iterable<T>): T {
    return useRealm(
      new BasicRealm<T>(create => {
        const resources: Resource[] = [];
        for (const value of iterable) {
          const r = create(value);
          resources.push(r);
        }
        return Resource.sequential(resources.reverse());
      })
    );
  }

  export function useParallel<T, U>(
    leftBlueprint: () => T,
    rightBlueprint: () => U
  ): T | U {
    return useRealm(
      Blueprint.toRealm(leftBlueprint).merge(Blueprint.toRealm(rightBlueprint))
    );
  }

  export function useEffect<T>(
    maker: (
      addResource: (resource: Resource) => void,
      abortSignal: AbortSignal
    ) => Promise<T> | T
  ): T {
    return useRealm(
      new EffectRealm<T>((addResource, abortSignal) => {
        return maker(addResource, abortSignal);
      })
    );
  }

  export function useTimeout(delayMs: number): void {
    return useRealm(
      new EffectRealm<void>((addResource, abortSignal) => {
        return new Promise<void>(resolve => {
          const timeout = setTimeout(() => {
            if (!abortSignal.aborted) {
              resolve();
            }
          }, delayMs);

          addResource({
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
    return new Store(Blueprint.toRealm(blueprint));
  }

  /**
   * Create a Store from a Blueprint within a Blueprint context.
   * The created Store will be a child of the current Blueprint.
   */
  export function useStore<T>(blueprint: () => T): Store<T> {
    const userContext = Blueprint.useUserContext();
    const rlm = Blueprint.toRealm(blueprint, userContext);
    return Blueprint.use(Store.newStoreRealm(rlm));
  }

  /**
   * Create a single-value cell within a Blueprint.
   * The setter replaces the current value (releases old, creates new).
   * This is a convenience wrapper around Store.newCellRealm().
   */
  export function useCell<T extends Structural>(initialValue: T): CellRealm<T> {
    return Blueprint.use(
      new EffectRealm<CellRealm<T>>((addResource, _abortSignal) => {
        const cell = new CellRealm(initialValue);
        addResource(cell);
        return cell;
      })
    );
  }

  /**
   * Create a multi-value portal within a Blueprint.
   * The setter is a Blueprint function that adds/removes values.
   * Multiple values can coexist in the Store.
   * This is a convenience wrapper around Store.newPortalRealm().
   */
  export function usePortal<T>(): [Store<T>, (newValue: T) => void] {
    return Blueprint.use(
      Store.newPortalRealm<T>().map(([s, set]) => [
        s,
        (value: T) => {
          return Blueprint.use(set(value));
        },
      ])
    );
  }

  export function usePersisted<T, U extends Structural>(
    source: Realm<T>,
    initialValue: U,
    onCreate?: (
      source: T,
      prevValue: U
    ) => {
      result: U;
      onDelete?: (prevValue: U) => U;
    }
  ): Realm<U> {
    return use(CellRealm.persisted<T, U>(source, initialValue, onCreate));
  }

  export function useTransition<T extends Structural>(
    realm: Realm<T>
  ): [Realm<T | null>, Realm<boolean>] {
    // Use a single persisted cell to avoid glitch (diamond problem)
    const combinedCell = Blueprint.usePersisted<
      T,
      {
        value: T | null;
        isTransitioning: boolean;
        valueId: number;
      }
    >(
      realm,
      { value: null, isTransitioning: true, valueId: 0 },
      (source, prev) => {
        const newId = prev.valueId + 1;
        return {
          result: {
            value: source,
            isTransitioning: false,
            valueId: newId,
          },
          onDelete: prevValue => {
            if (prevValue.valueId === newId) {
              return {
                ...prevValue,
                isTransitioning: true,
              };
            } else {
              return prevValue;
            }
          },
        };
      }
    );

    return [combinedCell.map(v => v.value), combinedCell.map(v => v.isTransitioning)];
  }
}
