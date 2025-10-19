import {
  QUON_CREATE_NODE,
  QUON_RUN_ROUTINE_EXTERNAL,
  QUON_RUN_ROUTINE_INTERNAL,
} from './routine';

export type Resource<T> = {
  // 現在のリソースを取得する (undefined もあり得る) これは Quon Routine 外で使用する
  peek: () => T | undefined;
  // 現在のリソースを取得する。これは Quon Routine 内で使用する。これが呼ばれた Quon Routine はリソースの変更に合わせて再実行される
  (): T;
};

export type Atom<T> = Resource<T> & {
  // リソースの変更をリクエストする。これは Quon Routine 外で使用する
  set: (value?: T) => Promise<void>;
};

export function withAtom<T>(initialValue?: T): Atom<T> {
  return QUON_CREATE_NODE<Atom<T>>(() => {
    let value: T | undefined = initialValue;

    const createFunctions: Set<(value: T) => void> = new Set();
    const deleteFunctions: Set<() => Promise<void>> = new Set();

    function peek(): T | undefined {
      return value;
    }

    let currentContext = 0;
    async function set(newValue?: T) {
      const ctx = ++currentContext;
      if (newValue === value) return;
      if (value !== undefined) {
        await Promise.all(Array.from(deleteFunctions).map(fn => fn()));
      }
      if (ctx !== currentContext) return;
      value = newValue;
      if (newValue !== undefined) {
        createFunctions.forEach(fn => fn(newValue));
      }
    }

    const withReceive = () =>
      QUON_CREATE_NODE<T>((createFn, deleteFn) => {
        createFunctions.add(createFn);
        deleteFunctions.add(deleteFn);
        const disposer = async () => {
          createFunctions.delete(createFn);
          deleteFunctions.delete(deleteFn);
        };
        if (value !== undefined) {
          return {
            type: 'value' as const,
            disposer,
            value,
          };
        } else {
          return {
            type: 'empty' as const,
            disposer,
          };
        }
      });

    const atom = Object.assign(withReceive, {
      peek,
      set,
    });
    return {
      type: 'value' as const,
      disposer: async () => {
        await set(undefined);
      },
      value: atom,
    };
  });
}

export function withResource<T>(initRoutine: () => T): Resource<T> {
  const atom = withAtom<T>();

  const internalRoutine = QUON_CREATE_NODE<() => void>(() => {
    const internalRoutine = () => {
      const v = initRoutine();
      QUON_CREATE_NODE<void>(() => {
        atom.set(v);
        return {
          type: 'value' as const,
          disposer: async () => {
            atom.set(undefined);
          },
          value: undefined,
        };
      });
    };
    return {
      type: 'value' as const,
      disposer: async () => {},
      value: internalRoutine,
    };
  });

  QUON_RUN_ROUTINE_INTERNAL(internalRoutine);

  return atom;
}

export function withExternal<T>(
  async: (
    addDisposer: (disposer: () => MaybePromise<void>) => void,
    abortSignal: AbortSignal
  ) => MaybePromise<T>
): T {
  return QUON_CREATE_NODE<T>(createFunction => {
    const currentDisposers: Array<() => MaybePromise<void>> = [];
    const abortController = new AbortController();

    const maybePromise = async(disposer => {
      currentDisposers.push(disposer);
    }, abortController.signal);

    const disposer = async () => {
      abortController.abort();
      // 逆順
      const reversed = currentDisposers.slice().reverse();
      for (const disposer of reversed) {
        const result = disposer();
        if (result instanceof Promise) {
          await result;
        }
      }
    };

    if (maybePromise instanceof Promise) {
      maybePromise.then(value => {
        createFunction(value);
      });
      return {
        type: 'empty',
        disposer,
      };
    } else {
      return {
        type: 'value',
        disposer,
        value: maybePromise,
      };
    }
  });
}

export const withWait = (intervalMs: number): void => {
  withExternal(async addDisposer => {
    await new Promise<void>(resolve => {
      const intervalId = setInterval(() => {
        resolve();
      }, intervalMs);
      addDisposer(() => {
        clearInterval(intervalId);
        resolve();
      });
    });
  });
};

export const launchRoutine = (
  routine: () => void
): { exit: () => Promise<void> } => {
  const { cancel } = QUON_RUN_ROUTINE_EXTERNAL(routine);
  return { exit: cancel };
};
