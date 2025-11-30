// Convenience re-exports for frequently used functions (React-like design)
export * from './routine';
export * from './source';
export * from './blueprint';

import * as B from './blueprint';

/**
 * Uses a Routine within a Blueprint.
 * The Routine is initialized when the Blueprint executes this line.
 * If the Routine is asynchronous, the Blueprint execution pauses until it completes.
 * @param routine The Routine to use.
 */
export const use = B.use;

/**
 * Executes a side effect with automatic cleanup.
 * The effect function is called when the Blueprint executes.
 * The cleanup function (registered via addFinalizeFn) is called when the Blueprint scope ends.
 * @param maker A function that performs the side effect. It receives `addFinalizeFn` to register cleanup logic and `abortSignal` for cancellation.
 */
export const useEffect = B.useEffect;

/**
 * Pauses execution for a specified duration.
 * @param delayMs The duration to wait in milliseconds.
 */
export const useTimeout = B.useTimeout;

/**
 * Creates a managed single-value state (Atom).
 * The Atom holds a value that can be updated.
 * @param initialValue The initial value of the Atom.
 * @returns An Atom instance.
 */
export const useAtom = B.useAtom;

/**
 * Creates a dynamic multi-value state (Portal).
 * The Portal allows connecting multiple values dynamically.
 * @returns A Portal instance.
 */
export const usePortal = B.usePortal;

/**
 * Connects a value to a Portal.
 * The value remains connected as long as the current Blueprint scope is active.
 * @param portal The Portal to connect to.
 * @param val The value to connect.
 */
export const useConnection = B.useConnection;

/**
 * Derives a new Source by applying a Blueprint to each value emitted by the input Source.
 * This is similar to `switchMap` in other reactive libraries, but uses a Blueprint for the mapping logic.
 * @param source The input Source.
 * @param blueprint A function that takes a value from the source and returns a new value (or performs side effects).
 * @returns A new Source emitting the derived values.
 */
export const useDerivation = B.useDerivation;

/**
 * Runs two Blueprints in parallel and returns their results as a tuple.
 * @param leftBlueprint The first Blueprint.
 * @param rightBlueprint The second Blueprint.
 * @returns A tuple containing the results of both Blueprints.
 */
export const useAll = B.useAll;

/**
 * Forks a Blueprint execution into a separate Fiber (background task).
 * The forked Blueprint runs independently.
 * @param blueprint The Blueprint to fork.
 * @returns A Fiber representing the running task.
 */
export const useFork = B.useFork;

/**
 * Joins a forked Fiber, waiting for its completion and returning its result.
 * @param fiber The Fiber to join.
 * @returns The result of the forked Blueprint.
 */
export const useJoin = B.useJoin;

/**
 * Converts a Blueprint function into a Routine.
 * The Routine can then be initialized and executed.
 * @param blueprint The Blueprint function.
 * @returns A Routine representing the Blueprint.
 */
export const toRoutine = B.toRoutine;
