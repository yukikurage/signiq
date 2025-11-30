import { MaybePromise } from './util';

export type Fiber<T> = {
  result: MaybePromise<T>;
};

export abstract class Routine<T> {
  public abstract initialize: () => {
    result: MaybePromise<T>;
    finalize: () => MaybePromise<void>;
  };

  public map = <U>(fn: (result: T) => U): Routine<U> => {
    return new BasicRoutine(() => {
      const { result, finalize } = this.initialize();
      return {
        result: result instanceof Promise ? result.then(fn) : fn(result),
        finalize,
      };
    });
  };

  public then = <U>(fn: (result: T) => Routine<U>): Routine<U> => {
    return new BasicRoutine(() => {
      const { result, finalize } = this.initialize();
      let innerFinalize: (() => MaybePromise<void>) | undefined;
      let isFinalized = false;
      let innerResult: MaybePromise<U>;

      if (result instanceof Promise) {
        innerResult = result.then(val => {
          if (isFinalized) {
            throw new Error('Routine finalized');
          }
          const inner = fn(val).initialize();
          innerFinalize = inner.finalize;
          return inner.result;
        });
      } else {
        const inner = fn(result).initialize();
        innerFinalize = inner.finalize;
        innerResult = inner.result;
      }
      return {
        result: innerResult,
        finalize: (): MaybePromise<void> => {
          isFinalized = true;
          if (innerFinalize) {
            const res = innerFinalize();
            if (res instanceof Promise) {
              return res.then(finalize);
            }
          }
          return finalize();
        },
      };
    });
  };

  public static resolve = <T>(value: T): Routine<T> => {
    return new (class extends Routine<T> {
      public initialize = (): {
        result: MaybePromise<T>;
        finalize(): MaybePromise<void>;
      } => {
        return {
          result: value,
          finalize: () => undefined,
        };
      };
    })();
  };

  public static all = <T extends unknown[]>(routines: {
    [K in keyof T]: Routine<T[K]>;
  }): Routine<T> => {
    return new (class extends Routine<T> {
      public initialize = (): {
        result: MaybePromise<T>;
        finalize(): MaybePromise<void>;
      } => {
        const initializeResults = routines.map(routine => {
          return routine.initialize();
        });
        const results = initializeResults.map(result => result.result);
        const finalizes = initializeResults.map(result => result.finalize);
        return {
          result: results.some(result => result instanceof Promise)
            ? (Promise.all(results) as Promise<T>)
            : (results as T),
          finalize: (): MaybePromise<void> => {
            const finalizeResults = finalizes.map(finalize => finalize());
            return finalizeResults.some(result => result instanceof Promise)
              ? Promise.all(finalizeResults).then(() => {})
              : undefined;
          },
        };
      };
    })();
  };

  public static fork = <T>(routine: Routine<T>): Routine<Fiber<T>> => {
    return new BasicRoutine(() => {
      const { result, finalize } = routine.initialize();
      return {
        result: { result },
        finalize,
      };
    });
  };

  public static join = <T>(fiber: Fiber<T>): Routine<T> => {
    return new BasicRoutine(() => {
      return {
        result: fiber.result,
        finalize: (): MaybePromise<void> => {},
      };
    });
  };
}

export class BasicRoutine<T> extends Routine<T> {
  constructor(
    private readonly initializeFn: () => {
      result: MaybePromise<T>;
      finalize(): MaybePromise<void>;
    }
  ) {
    super();
  }

  public initialize = (): {
    result: MaybePromise<T>;
    finalize(): MaybePromise<void>;
  } => {
    return this.initializeFn();
  };
}

export class Effect<T> extends Routine<T> {
  constructor(
    private readonly initializeFn: (
      addFinalizeFn: (finalizeFn: () => MaybePromise<void>) => void,
      abortSignal: AbortSignal
    ) => MaybePromise<T>
  ) {
    super();
  }

  public initialize = (): {
    result: MaybePromise<T>;
    finalize(): MaybePromise<void>;
  } => {
    const finalizeFns: Array<() => MaybePromise<void>> = [];
    const abortController = new AbortController();

    let isFinalized = false;
    let cleanupResult: MaybePromise<void>;

    const finalize = (): MaybePromise<void> => {
      if (isFinalized) return cleanupResult;
      isFinalized = true;

      abortController.abort();

      let chain: Promise<void> | undefined;
      // finalizeFns を逆順実行
      for (let i = finalizeFns.length - 1; i >= 0; i--) {
        const fn = finalizeFns[i];
        if (!fn) continue;

        if (chain) {
          chain = chain.then(() => fn());
        } else {
          const res = fn();
          if (res instanceof Promise) {
            chain = res;
          }
        }
      }

      cleanupResult = chain;
      return cleanupResult;
    };

    return {
      result: this.initializeFn(finalizeFn => {
        finalizeFns.push(finalizeFn);
      }, abortController.signal),
      finalize,
    };
  };
}
