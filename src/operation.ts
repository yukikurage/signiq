import { Routine } from './routine';

export interface ReadonlySlot<T> {
  get(): Routine<T>;
  peek(): T; // get the current value without registering dependency
}

export interface Slot<T> extends ReadonlySlot<T> {
  set(value: T): void;
  modify(updater: (currentValue: T) => T): void;
}

export type Context<Value> = {
  use: () => Routine<Value>;
  provide: (value: Value) => Routine<void>;
};

export async function* slot<T>(initialValue: T): Routine<Slot<T>> {
  let currentValue = initialValue; // current value (mutable)

  const store: Set<() => void> = new Set(); // callbacks (when value changes)
  const set = (value: T) => {
    if (value !== currentValue) {
      currentValue = value;
      store.forEach(cb => cb()); // notify all callbacks
    }
  };
  const modify = (updater: (currentValue: T) => T) => {
    set(updater(currentValue));
  };
  function* get(): Routine<T> {
    yield { type: 'addDependency' as const, store }; // register dependency
    return currentValue;
  }

  return { get, peek: () => currentValue, set, modify };
}

type MiniObservable<T> = {
  set(value: T): void;
  get(): T;
  observe(cb: (v: T) => void): void; // returns cancel function
  observeOnce(cb: (v: T) => void): void; // returns cancel function
};

function makeInternalMiniObservable<T>(initialValue: T) {
  let currentValue = initialValue; // current value (mutable)

  const store: Set<(v: T) => void> = new Set();
  const set = (value: T) => {
    if (value !== currentValue) {
      currentValue = value;
      store.forEach(cb => cb(value)); // notify all callbacks
    }
  };
  const get = () => currentValue;
  const observe = (cb: (v: T) => void) => {
    store.add(cb);
  };
  const observeOnce = (cb: (v: T) => void) => {
    const cancel = () => {
      store.delete(wrappedCb);
    };
    const wrappedCb = (v: T) => {
      cb(v);
      cancel();
    };
    store.add(wrappedCb);
  };
  return { set, get, observe, observeOnce };
}

export async function* observe(
  mkRoutine: () => Routine<void> // routine factory
): Routine<void> {
  const ctxs = yield* getContexts();

  const deferredFunctions: Set<() => Promise<void> | void> = new Set(); // deferred functions, execute by `recall` or parent routine cancellation
  let parentCancelled: MiniObservable<boolean> =
    makeInternalMiniObservable(false); // whether parent routine is canceled
  let cancelled = makeInternalMiniObservable(false); // whether this routine is canceled

  let processCount = makeInternalMiniObservable(0);

  (async () => {
    processCount.set(processCount.get() + 1); // Main loop
    while (true) {
      // [restart]
      if (parentCancelled.get()) {
        break; // stop if parent routine canceled
      }
      const childCtxs = { ...ctxs }; // Copy context (mutable state)
      cancelled.set(false); // reset cancellation
      const itr = mkRoutine();
      let lastResult: any = undefined;
      // Start the routine
      processCount.set(processCount.get() + 1); // Routine loop
      while (true) {
        if (cancelled.get()) {
          const deferredPromises = Array.from(deferredFunctions).map(fn =>
            fn()
          );
          deferredFunctions.clear(); // clear all deferred functions
          (async () => {
            processCount.set(processCount.get() + 1);
            await Promise.allSettled(deferredPromises); // execute all deferred functions
            processCount.set(processCount.get() - 1);
          })();
          break; // stop if cancelled --> [restart]
        }
        const { value, done } = await itr.next(lastResult); // execute until next yield
        if (done) {
          // wait until cancelled
          await new Promise<void>(resolve => {
            cancelled.observeOnce(v => {
              if (v) {
                resolve();
              }
            });
          });
          break; // stop if done --> [restart]
        }
        if (value.type === 'defer') {
          deferredFunctions.add(value.cleanup); // defer execution
          lastResult = undefined;
        } else if (value.type === 'addDependency') {
          const cancel = () => {
            cancelled.set(true);
          };
          value.store.add(cancel); // add dependency
          deferredFunctions.add(async () => {
            value.store.delete(cancel); // cleanup when routine canceled
          });
          lastResult = undefined;
        } else if (value.type === 'getContexts') {
          lastResult = childCtxs; // provide container
        }
      }
      processCount.set(processCount.get() - 1);
    }
    processCount.set(processCount.get() - 1);
  })();

  // Cleanup when parent routine is canceled
  // wait until all processes are done
  defer(() => {
    cancelled.set(true);
    parentCancelled.set(true);
    return new Promise<void>(resolve => {
      if (processCount.get() === 0) {
        resolve();
      } else {
        processCount.observeOnce(count => {
          if (count === 0) {
            resolve();
          }
        });
      }
    });
  });
}

export async function* defer(fn: () => Promise<void> | void): Routine<void> {
  yield {
    type: 'defer' as const,
    cleanup: fn,
  };
}

export async function* checkpoint(): Routine<void> {
  yield { type: 'checkpoint' as const };
}

async function* getContexts(): Routine<Record<symbol, any>> {
  const container = yield { type: 'getContexts' as const };
  return container as Record<string, any>;
}

export function context<T>(): Context<T> {
  const key = Symbol();
  return {
    use: async function* () {
      const ctxs = yield* getContexts();
      if (!(key in ctxs)) {
        throw new Error('Context not found');
      }
      return ctxs[key] as T;
    },
    provide: async function* (value: T) {
      console.log('Providing context');
      const ctxs = yield* getContexts();
      ctxs[key] = value;
    },
  };
}

// Derive a readonly slot from a routine
// This operation pauses until the routine produces a initial value
export async function* derive<T>(
  mkRoutine: () => Routine<T>
): Routine<ReadonlySlot<T>> {
  // make promise & its resolve function
  let resolve: (value: T) => void;
  const p = new Promise<T>(r => {
    resolve = r;
  });

  // start observing the routine
  yield* observe(async function* () {
    const v = yield* mkRoutine();
    resolve(v);
  });

  // wait until the routine produces a value
  const initialValue = await p;
  const newSlot: Slot<T> = yield* slot(initialValue);

  resolve = v => {
    newSlot.set(v);
  };
  return newSlot;
}

// Wait for a specified time (ms)
export async function* wait(ms: number): Routine<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

// Regularly updated slots
export async function* clock(ms: number): Routine<ReadonlySlot<number>> {
  const cl = yield* slot(0);
  const id = setInterval(() => {
    cl.modify(v => v + 1);
  }, ms);
  yield* defer(() => {
    clearInterval(id);
  });
  return cl;
}

// Call a function regularly (+ dependency)
export async function* interval(
  fn: (count: number) => Routine<void>,
  ms: number
): Routine<void> {
  const cl = yield* clock(ms);
  yield* observe(async function* () {
    const count = yield* cl.get(); // depend on clock
    yield* fn(count); // call the function
  });
}

// Wait until the predicate becomes true
export async function* until<T>(
  predicate: (v: T) => boolean,
  slot: ReadonlySlot<T>
): Routine<T> {
  let resolve: (v: T) => void;
  const p = new Promise<T>(r => {
    resolve = r;
  });
  yield* observe(async function* () {
    const v = yield* slot.get(); // depend on the slot
    if (predicate(v)) {
      resolve(v);
    }
  });
  return await p;
}

export type App<T> = {
  quit: () => Promise<void>; // Quit the app. Wait until all processes are done.
  result: T; // Result of the app routine
};

export async function launch<T>(mkRoutine: () => Routine<T>): Promise<App<T>> {
  const deferredFunctions: Set<() => Promise<void> | void> = new Set(); // deferred functions, execute by `recall` or parent routine cancellation

  const itr = mkRoutine();
  let result;

  // Start the app routine
  let lastResult: any = undefined;
  let childCtxs = {};
  while (true) {
    const { value, done } = await itr.next(lastResult); // execute until next yield
    if (done) {
      result = value;
      break; // stop if done --> next
    }
    if (value.type === 'defer') {
      deferredFunctions.add(value.cleanup); // defer execution
      lastResult = undefined;
    } else if (value.type === 'addDependency') {
      throw new Error(
        'App routine cannot depend on slots. Use observe() instead.'
      );
    } else if (value.type === 'getContexts') {
      lastResult = childCtxs; // provide container
    }
  }

  // Cleanup when parent routine is canceled
  // wait until all processes are done
  const quit = async () => {
    const deferredPromises = Array.from(deferredFunctions).map(fn => fn());
    deferredFunctions.clear();
    await Promise.allSettled(deferredPromises); // execute all deferred functions
  };

  return { quit, result };
}
