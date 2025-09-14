import { Routine } from './routine';

export interface ReadonlySlot<T> {
  peek(): T; // get the current value without registering dependency
  (): Routine<T>;
}

export interface Slot<T> extends ReadonlySlot<T> {
  set(value: T): void;
  modify(updater: (currentValue: T) => T): void;
}

export type Context<Value> = {
  use$: () => Routine<Value>;
  provide$: (value: Value) => Routine<void>;
};

export async function* slot$<T>(initialValue: T): Routine<Slot<T>> {
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
  async function* get$(): Routine<T> {
    yield { type: 'addDependency' as const, store }; // register dependency
    return currentValue;
  }

  get$.peek = () => currentValue; // peek method
  get$.set = set; // set method
  get$.modify = modify; // modify method

  return get$;
}

type MiniObservable<T> = {
  set(value: T): void;
  get(): T;
  observe(cb: (v: T, cancel: () => void) => void): () => void; // returns cancel function
};

function makeInternalMiniObservable<T>(initialValue: T): MiniObservable<T> {
  let currentValue = initialValue; // current value (mutable)

  const store: Set<(v: T) => void> = new Set();
  const set = (value: T) => {
    if (value !== currentValue) {
      currentValue = value;
      store.forEach(cb => cb(value)); // notify all callbacks
    }
  };
  const get = () => currentValue;
  const observe = (cb: (v: T, cancel: () => void) => void) => {
    const _cb = (v: T) => {
      cb(v, cancel);
    };
    const cancel = () => {
      store.delete(_cb);
    };
    store.add(_cb);
    cb(currentValue, cancel); // initial call
    return cancel;
  };
  return { set, get, observe };
}

// spawn a child routine
async function spawnChildRoutine<T>(
  mkRoutine$: () => Routine<T>,
  modifyProcessCount: (delta: number) => void,
  ctxs: Record<symbol, any>,
  parentCancelled: MiniObservable<boolean>
): Promise<T | undefined> {
  const deferredFunctions: Set<() => Promise<void> | void> = new Set();
  const cancelled = makeInternalMiniObservable(false);
  const mutCtxsStore = { ...ctxs }; // Copy context (mutable state)

  const cancel = async () => {
    const deferredPromises = Array.from(deferredFunctions).map(fn => fn());
    deferredFunctions.clear();
    cancelled.set(true); // cancel current routine

    modifyProcessCount(1); // defer loop
    await Promise.allSettled(deferredPromises); // execute all deferred functions
    modifyProcessCount(-1); // end of defer loop
  };

  const respawn = () => {
    cancel();
    spawnChildRoutine(mkRoutine$, modifyProcessCount, ctxs, parentCancelled); // respawn
  };

  // sync with parent cancellation
  const removeSync = parentCancelled.observe((v, remove) => {
    if (v) {
      remove();
      cancel();
    }
  });
  // if child is cancelled, stop syncing
  cancelled.observe((v, remove) => {
    if (v) {
      remove();
      removeSync();
    }
  });
  const itr = mkRoutine$();

  /* MAIN LOOP */
  modifyProcessCount(1); // routine loop

  let finalResult: T | undefined = undefined;
  let lastResult: any = undefined;
  while (true) {
    const { value, done } = await itr.next(lastResult); // execute until next yield\
    if (done) {
      finalResult = value; // capture final result
      break; // stop if done
    }
    if (value.type === 'defer') {
      if (cancelled.get()) {
        modifyProcessCount(1);
        await value.cleanup(); // execute immediately if cancelled
        modifyProcessCount(-1);
      }
      deferredFunctions.add(value.cleanup); // defer execution
      lastResult = undefined;
    } else if (cancelled.get()) {
      lastResult = undefined;
      break; // stop if cancelled
    } else if (value.type === 'addDependency') {
      value.store.add(respawn);
      deferredFunctions.add(() => {
        value.store.delete(respawn);
      });
      lastResult = undefined;
    } else if (value.type === 'getContexts') {
      lastResult = mutCtxsStore;
    } else if (value.type === 'checkpoint') {
      lastResult = undefined;
    } else {
      throw new Error('Unknown yield type');
    }
  }

  modifyProcessCount(-1); // end of routine loop

  return finalResult; // return final result
}

export async function* observe$(
  mkRoutine$: () => Routine<void> // routine factory
): Routine<void> {
  const ctxs = yield* getContexts();

  const parentCancelled: MiniObservable<boolean> =
    makeInternalMiniObservable(false); // whether parent routine is canceled

  let processCount = makeInternalMiniObservable(0);

  // start the first routine
  spawnChildRoutine(
    mkRoutine$,
    delta => processCount.set(processCount.get() + delta),
    ctxs,
    parentCancelled
  );

  // Cleanup when parent routine is canceled
  // wait until all processes are done
  yield* defer$(() => {
    parentCancelled.set(true);
    return new Promise<void>(resolve => {
      processCount.observe((count, remove) => {
        if (count === 0) {
          remove();
          resolve();
        }
      });
    });
  });
}

export async function* defer$(fn: () => Promise<void> | void): Routine<void> {
  yield {
    type: 'defer' as const,
    cleanup: fn,
  };
}

export async function* checkpoint$(): Routine<void> {
  yield { type: 'checkpoint' as const };
}

async function* getContexts(): Routine<Record<symbol, any>> {
  const container = yield { type: 'getContexts' as const };
  return container as Record<string, any>;
}

export function context<T>(): Context<T> {
  const key = Symbol();
  return {
    use$: async function* () {
      const ctxs = yield* getContexts();
      if (!(key in ctxs)) {
        throw new Error('Context not found');
      }
      return ctxs[key] as T;
    },
    provide$: async function* (value: T) {
      const ctxs = yield* getContexts();
      ctxs[key] = value;
    },
  };
}

function makePromiseAndItsResolve<T>(): [Promise<T>, (v: T) => void] {
  let resolve: (v: T) => void;
  const p = new Promise<T>(r => {
    resolve = r;
  });
  return [p, resolve!];
}

// Derive a readonly slot from a routine
// This operation pauses until the routine produces a initial value
export async function* derive$<T>(
  mkRoutine$: () => Routine<T>
): Routine<ReadonlySlot<T>> {
  let initialValue: T | undefined = undefined;
  let callback: (value: T) => void = v => {
    initialValue = v;
  };

  // start observing the routine
  yield* observe$(async function* () {
    const v = yield* mkRoutine$();
    callback(v);
  });

  if (initialValue === undefined) {
    // wait until the routine produces a value (or parent routine is canceled)
    const [waitFill, resolveFill] = makePromiseAndItsResolve<T>();
    const [waitCancel, resolveCancel] = makePromiseAndItsResolve<void>();
    callback = v => {
      initialValue = v;
      resolveFill(v);
    };
    yield* defer$(() => {
      resolveCancel(); // cancel waiting
    });
    await Promise.race([waitFill, waitCancel]); // wait until filled or canceled
  }
  // at this point, initialValue must be set

  const newSlot: Slot<T> = yield* slot$(initialValue as T);
  callback = v => {
    if (v !== newSlot.peek()) newSlot.set(v);
  };
  return newSlot;
}

// Wait for a specified time (ms)
export async function* wait$(ms: number): Routine<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

// Regularly updated slots
export async function* clock$(ms: number): Routine<ReadonlySlot<number>> {
  const cl = yield* slot$(0);
  const id = setInterval(() => {
    cl.modify(v => v + 1);
  }, ms);
  yield* defer$(() => {
    clearInterval(id);
  });
  return cl;
}

// Call a function regularly (+ dependency)
export async function* interval$<T>(
  fn: (count: number) => Routine<T>,
  ms: number
): Routine<ReadonlySlot<T>> {
  const tick$ = yield* clock$(ms);
  return yield* derive$(async function* () {
    const count = yield* tick$(); // depend on the clock slot
    return yield* fn(count);
  });
}

// Wait until the predicate becomes true
export async function* until$<T>(
  predicate: (v: T) => boolean,
  slot$: ReadonlySlot<T>
): Routine<T> {
  let resolve: (v: T) => void;
  const p = new Promise<T>(r => {
    resolve = r;
  });
  yield* observe$(async function* () {
    const v = yield* slot$(); // depend on the slot
    if (predicate(v)) {
      resolve(v);
    }
  });
  return await p;
}

// Fallback value while routine is initializing
export async function* fallback$<T>(
  mkRoutine$: () => Routine<T>,
  fallbackValue: T
): Routine<ReadonlySlot<T>> {
  const newSlot: Slot<T> = yield* slot$(fallbackValue);
  yield* observe$(async function* () {
    const v = yield* mkRoutine$();
    newSlot.set(v);
  });
  return newSlot;
}

export type App<T> = {
  quit: () => Promise<void>; // Quit the app. Wait until all processes are done.
  ready: Promise<T | undefined>; // Application info (undefined if the main routine is canceled while initializing)
};

export function launch<T>(mkRoutine$: () => Routine<T>): App<T> {
  const parentCancelled: MiniObservable<boolean> =
    makeInternalMiniObservable(false); // whether parent routine is canceled

  let processCount = makeInternalMiniObservable(0);

  const ready = spawnChildRoutine(
    mkRoutine$,
    delta => processCount.set(processCount.get() + delta),
    {},
    parentCancelled
  );

  // start the first routine
  // Cleanup when parent routine is canceled
  // wait until all processes are done
  const quit = async () => {
    parentCancelled.set(true);
    return new Promise<void>(resolve => {
      processCount.observe((count, remove) => {
        if (count === 0) {
          remove();
          resolve();
        }
      });
    });
  };

  return { quit, ready };
}
