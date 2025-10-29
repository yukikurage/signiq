import { Queue } from './queue';
import { BasicReleasable, CompositeReleasable, Releasable } from './releasable';

/**
 * 観測可能な値の集合
 * observe 関数を通じて値の追加を監視できる
 * observe 関数で得られた observation のリリース時には、作った値もすべて Release されることが期待される
 */
export abstract class Observable<T> {
  public abstract observe(observer: (value: T) => Releasable): Releasable;

  /**
   * Blueprint で使用する
   */
  public use(): T {
    return Blueprint.useObservable(this);
  }

  public flatMap<U>(f: (value: T) => Observable<U>): Observable<U> {
    return new BasicObservable<U>(create => {
      // 親 Observable を observe
      return this.observe(value => {
        // 子を取得して observe
        return f(value).observe(v => {
          return create(v);
        });
      });
    });
  }

  public filter(predicate: (value: T) => boolean): Observable<T> {
    return new BasicObservable<T>(create => {
      return this.observe(value => {
        if (predicate(value)) {
          return create(value);
        }
        return Releasable.noop;
      });
    });
  }

  public merge<U>(other: Observable<U>): Observable<T | U> {
    return new BasicObservable<T | U>(create => {
      const releaseLeft = this.observe(value => {
        return create(value);
      });
      const releaseRight = other.observe(value => {
        return create(value);
      });
      return Releasable.parallel([releaseLeft, releaseRight]);
    });
  }

  public static pure<T>(value: T): BasicObservable<T> {
    return new BasicObservable<T>(observer => {
      return observer(value);
    });
  }

  public static never<T>(): BasicObservable<T> {
    return new BasicObservable<T>(_observer => {
      return Releasable.noop;
    });
  }
}

export class BasicObservable<T> extends Observable<T> {
  constructor(
    private readonly subscribeFunc: (
      observer: (value: T) => Releasable
    ) => Releasable
  ) {
    super();
  }

  public observe(observer: (value: T) => Releasable): Releasable {
    return this.subscribeFunc(observer);
  }
}

type BlueprintResult = any;

type UserContext = Record<symbol, BlueprintResult>;

type BLUEPRINT_GLOBAL_CONTEXT_TYPE = {
  use<T>(observable: Observable<T>): T;
  getUserCtx(): UserContext;
};

let BLUEPRINT_GLOBAL_CONTEXT: BLUEPRINT_GLOBAL_CONTEXT_TYPE | undefined =
  undefined;

// Unique symbol to identify BlueprintChainException and prevent accidental catching
const BLUEPRINT_CHAIN_EXCEPTION_SYMBOL = Symbol('BlueprintChainException');

class BlueprintChainException<U, T> {
  // Add a unique symbol property to identify this as a Blueprint control flow exception
  public readonly [BLUEPRINT_CHAIN_EXCEPTION_SYMBOL] = true;

  constructor(
    public readonly observable: Observable<U>,
    public readonly continuation: (value: U) => Observable<T>
  ) {}

  // Helper to check if an error is a BlueprintChainException
  static isBlueprintChainException(error: unknown): error is BlueprintChainException<any, any> {
    return (
      typeof error === 'object' &&
      error !== null &&
      BLUEPRINT_CHAIN_EXCEPTION_SYMBOL in error
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
    }).use();
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
   * コンテキストを作成
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

    // 履歴と一緒に Blueprint を実行する
    function runBlueprintWithHistory(
      history: Queue<BlueprintResult>
    ): Observable<T> {
      let currentHistory = history;

      // Observable をチェインさせるための関数f
      function use<U>(observable: Observable<U>): U {
        const dequeued = Queue.dequeue(currentHistory);

        if (dequeued !== undefined) {
          // 履歴がある場合: 履歴の値を返し、残りの履歴で続行
          const { value, queue: remainingHistory } = dequeued;
          currentHistory = remainingHistory;
          return value;
        } else {
          // 履歴が枯渇した場合: 継続を作成して Store をチェイン
          const continuation = (v: U): Observable<T> => {
            return runBlueprintWithHistory(Queue.enqueue(history, v));
          };

          // 例外を throw して外側で Store を返す
          throw new BlueprintChainException<U, T>(observable, continuation);
        }
      }

      // Blueprint の実行
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
          // Chain 例外をキャッチ: Observable と 継続をチェイン
          // observe に継続を登録する
          return e.observable.flatMap(e.continuation);
        }
        // If user code caught and re-threw a BlueprintChainException,
        // or if this is a genuine user error, re-throw it
        throw e;
      }
    }

    return runBlueprintWithHistory(Queue.empty());
  }

  export function useObservable<T>(observable: Observable<T>): T {
    const global = getBlueprintGlobalContext();
    return global.use(observable);
  }

  export function useNever(): never {
    return BasicObservable.never<never>().use();
  }

  export function useGuard(predicate: () => boolean): void {
    return new BasicObservable<void>(create => {
      if (!predicate()) {
        return Releasable.noop;
      }
      return create(undefined);
    }).use();
  }

  export function useIterable<T>(iterable: Iterable<T>): T {
    return new BasicObservable<T>(create => {
      const releasables: Releasable[] = [];
      for (const value of iterable) {
        const r = create(value);
        releasables.push(r);
      }
      return Releasable.sequential(releasables.reverse());
    }).use();
  }

  export function useEffect<T>(
    maker: (
      addReleasable: (releasable: Releasable) => void,
      abortSignal: AbortSignal
    ) => Promise<T> | T
  ): T {
    return new BasicObservable<T>(create => {
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
    }).use();
  }

  export function useTimeout(delayMs: number): void {
    return new BasicObservable<void>(create => {
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
    }).use();
  }
}
