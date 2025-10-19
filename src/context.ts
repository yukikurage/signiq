import {
  QUON_ADD_ROUTINE_USER_CONTEXT,
  QUON_DELETE_ROUTINE_USER_CONTEXT,
  QUON_GET_ROUTINE_USER_CONTEXT,
} from './routine';

export type Context<T> = {
  withProvider: <U>(value: T, childrenRoutine: () => U) => U;
  withContext: () => T | undefined;
};

export function createContext<T>(): Context<T> {
  const key = Symbol('QUON_CONTEXT_KEY');

  return {
    withProvider: <U>(value: T, childrenRoutine: () => U) => {
      QUON_ADD_ROUTINE_USER_CONTEXT(key, value);
      const result = childrenRoutine();
      QUON_DELETE_ROUTINE_USER_CONTEXT(key);
      return result;
    },
    withContext: () => {
      return QUON_GET_ROUTINE_USER_CONTEXT(key);
    },
  };
}
