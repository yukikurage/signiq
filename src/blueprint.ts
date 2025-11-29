import { Effect, Fiber, Routine } from './routine';
import { Atom, Portal, Source } from './source';
import { Structural } from './structural';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BlueprintResult = any;

type UserContext = Record<symbol, BlueprintResult>;

type BLUEPRINT_GLOBAL_CONTEXT_TYPE = {
  use<T>(routine: Routine<T>): T;
  getUserCtx(): UserContext;
};

let BLUEPRINT_GLOBAL_CONTEXT: BLUEPRINT_GLOBAL_CONTEXT_TYPE | undefined =
  undefined;

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
    use(
      new Effect<void>(addFinalizeFn => {
        const temp = global.getUserCtx()[key];
        global.getUserCtx()[key] = value;

        addFinalizeFn(() => {
          if (temp === undefined) {
            delete global.getUserCtx()[key];
          } else {
            global.getUserCtx()[key] = temp;
          }
        });
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
   * Convert a Blueprint function into an Routine.
   */
  export function toRoutine<T>(
    blueprint: () => T,
    userCtx?: UserContext
  ): Routine<T> {
    return new Effect<T>(async addFinalizeFn => {
      const routineUserCtx = { ...userCtx };
      const history: BlueprintResult[] = [];
      let currentIndex = 0;

      function use<U>(routine: Routine<U>): U {
        const index = currentIndex;
        currentIndex++;
        if (index < history.length) {
          return history[index];
        }
        const { result, finalize } = routine.initialize();
        addFinalizeFn(finalize);
        if (result instanceof Promise) {
          throw {
            index,
            promise: result,
          };
        }
        history[index] = result;
        return result;
      }

      while (true) {
        const tmp = BLUEPRINT_GLOBAL_CONTEXT;
        BLUEPRINT_GLOBAL_CONTEXT = {
          use: use,
          getUserCtx: () => routineUserCtx,
        };
        try {
          currentIndex = 0;
          const result = blueprint();
          BLUEPRINT_GLOBAL_CONTEXT = tmp;
          return result;
        } catch (e) {
          BLUEPRINT_GLOBAL_CONTEXT = tmp;
          if (e instanceof Object && 'index' in e && 'promise' in e) {
            const result = await e.promise;
            history[e.index as number] = result;
          }
        }
      }
    });
  }

  export function use<T>(routine: Routine<T>): T {
    const global = getBlueprintGlobalContext();
    return global.use(routine);
  }

  export function useAll<T, U>(
    leftBlueprint: () => T,
    rightBlueprint: () => U
  ): [T, U] {
    return use(
      Routine.all([
        Blueprint.toRoutine(leftBlueprint),
        Blueprint.toRoutine(rightBlueprint),
      ])
    );
  }

  export function useFork<T>(blueprint: () => T): Fiber<T> {
    const userCtx = useUserContext();
    return use(Routine.fork(Blueprint.toRoutine(blueprint, userCtx)));
  }

  export function useJoin<T>(fiber: Fiber<T>): T {
    return use(Routine.join(fiber));
  }

  export function useEffect<T>(
    maker: (
      addFinalizeFn: (finalizeFn: () => MaybePromise<void>) => void,
      abortSignal: AbortSignal
    ) => MaybePromise<T>
  ): T {
    return use(
      new Effect<T>((addFinalizeFn, abortSignal) => {
        return maker(addFinalizeFn, abortSignal);
      })
    );
  }

  export function useTimeout(delayMs: number): void {
    return use(
      new Effect<void>((addFinalizeFn, abortSignal) => {
        return new Promise<void>(resolve => {
          const timeout = setTimeout(() => {
            if (!abortSignal.aborted) {
              resolve();
            }
          }, delayMs);

          addFinalizeFn(() => {
            clearTimeout(timeout);
          });
        });
      })
    );
  }

  // ============================================================================
  // Store-related convenience functions
  // ============================================================================

  export function useDerivation<T, U>(
    source: Source<T>,
    blueprint: (val: T) => U
  ): Source<U> {
    const userCtx = useUserContext();
    return use(
      source.derive(v => {
        return toRoutine(() => {
          return blueprint(v);
        }, userCtx);
      })
    );
  }

  /**
   * Create a single-value cell within a Blueprint.
   * The setter replaces the current value (releases old, creates new).
   * This is a convenience wrapper around Store.newCellRealm().
   */
  export function useAtom<T extends Structural>(initialValue: T): Atom<T> {
    return Blueprint.use(
      new Effect<Atom<T>>(addFinalizeFn => {
        const atom = new Atom<T>(initialValue);
        addFinalizeFn(() => {
          atom.finalize();
        });
        return atom;
      })
    );
  }

  /**
   * Create a multi-value portal within a Blueprint.
   * The setter is a Blueprint function that adds/removes values.
   * Multiple values can coexist in the Store.
   * This is a convenience wrapper around Store.newPortalRealm().
   */
  export function usePortal<T>(): Portal<T> {
    return Blueprint.use(
      new Effect<Portal<T>>(addFinalizeFn => {
        const portal = new Portal<T>();
        addFinalizeFn(() => {
          portal.finalize();
        });
        return portal;
      })
    );
  }

  export function useConnection<T>(portal: Portal<T>, val: T): void {
    return Blueprint.use(portal.connect(val));
  }
}
