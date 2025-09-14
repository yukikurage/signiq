export type RoutineYield =
  | {
      type: 'defer'; // defer executions
      cleanup: () => Promise<void> | void;
    }
  | {
      type: 'addDependency'; // add dependency
      store: Set<() => void>;
    }
  | {
      type: 'checkpoint'; // checkpoint for cancellation
    }
  | {
      type: 'getContexts';
    };

export type Routine<TReturn = void> = AsyncGenerator<RoutineYield, TReturn>;
