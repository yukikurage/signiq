export type QUON_INTERNAL_DisposableComputation<T> = (
  resolve: (result: T) => void
) => (resolveDispose: () => void) => void;

export type QUON_INTERNAL_Subscription<T> = {
  dispose: (resolveDispose: () => void) => void;
  callback: (value: T) => QUON_INTERNAL_DisposableComputation<void>;
};

export type QUON_INTERNAL_Channel<T> = {
  subscribers: Set<QUON_INTERNAL_Subscription<T>>;
  value: T; // Mutate
};

export function QUON_INTERNAL_makeNewState<T>(
  initValue: T
): QUON_INTERNAL_Channel<T> {
  return { subscribers: new Set(), value: initValue };
}

export function QUON_INTERNAL_makeSubscribeFunction<T>(
  state: QUON_INTERNAL_Channel<T>,
  callback: (value: T) => QUON_INTERNAL_DisposableComputation<void>
): QUON_INTERNAL_DisposableComputation<void> {
  return resolve => {
    let initialized = false;
    const internalCallback: (
      value: T
    ) => QUON_INTERNAL_DisposableComputation<void> =
      (value: T) => (internalResolve: () => void) => {
        return callback(value)(() => {
          internalResolve();
          if (!initialized) {
            initialized = true;
            resolve(); // Resolve only once after the first callback
          }
        });
      };

    const initDispose = internalCallback(state.value)(() => {});

    const subscription: QUON_INTERNAL_Subscription<T> = {
      dispose: initDispose,
      callback: internalCallback,
    };
    state.subscribers.add(subscription);

    return resolveDispose => {
      state.subscribers.delete(subscription);
      subscription.dispose(resolveDispose); // Finalize
    };
  };
}

export function QUON_INTERNAL_modifyState<T>(
  state: QUON_INTERNAL_Channel<T>,
  update: (currentValue: T) => T
): void {
  const newValue = update(state.value);
  if (newValue !== state.value) {
    state.value = newValue;
    state.subscribers.forEach(sub => {
      sub.dispose(() => {});
      sub.dispose = sub.callback(state.value);
    });
  }
}

export type QUON_INTERNAL_State<T> = {
  getValue: () => T;
  subscribe: (
    callback: (value: T) => QUON_INTERNAL_DisposableComputation<void>
  ) => QUON_INTERNAL_DisposableComputation<void>;
};

export function QUON_INTERNAL_channelToState<T>(
  channel: QUON_INTERNAL_Channel<T>
): QUON_INTERNAL_State<T> {
  return {
    getValue: () => channel.value,
    subscribe: callback =>
      QUON_INTERNAL_makeSubscribeFunction(channel, callback),
  };
}

export function QUON_INTERNAL_joinState<T>(
  state: QUON_INTERNAL_State<QUON_INTERNAL_State<T>>
): QUON_INTERNAL_State<T> {
  return {
    getValue: () => state.getValue().getValue(),
    subscribe: callback =>
      state.subscribe(innerState => innerState.subscribe(callback)),
  };
}
