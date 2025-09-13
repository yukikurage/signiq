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
    };

export type Routine<TReturn = any> =
  | AsyncGenerator<RoutineYield, TReturn, any>
  | Generator<RoutineYield, TReturn, any>;
