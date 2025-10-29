# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Build**: `npm run build` - Compiles TypeScript to JavaScript in `dist/`
- **Test**: `npm test` - Runs tests using Node.js test runner
- **Test Watch**: `npm run test:watch` - Runs tests in watch mode
- **Examples**: `npm run examples` - Runs example code
- **Lint**: `npm run lint` - Runs ESLint on TypeScript files
- **Lint Fix**: `npm run lint:fix` - Fixes auto-fixable ESLint issues
- **Format**: `npm run format` - Formats code with Prettier
- **Format Check**: `npm run format:check` - Checks code formatting

## Architecture

This is a reactive programming library built around **Observable**, **Blueprint**, and **Store** - providing a declarative API for managing reactive state and side effects with automatic cleanup.

### Core Concepts

- **Observable**: Represents a stream of values over time that can be observed
- **Blueprint**: A synchronous-style DSL for composing Observables using flatMap chains
- **Store**: Manages multiple values from an Observable with automatic lifecycle management
- **Releasable**: Interface for resources that need cleanup, released in proper order
- **Context**: Type-safe dependency injection system for Blueprints

### Key Files

- `src/observable.ts`: Core Observable and Blueprint implementation
- `src/store.ts`: Store class for managing Observable values with lifecycle
- `src/releasable.ts`: Releasable interface and composition utilities
- `src/bilink-map.ts`: Bidirectional map for managing Observer-Value relationships
- `src/task-queue.ts`: Task queue for managing async operations
- `src/index.ts`: Main entry point that exports all public APIs
- `benchmarks/history-comparison.ts`: Performance comparison (Queue vs Array)

### Reactive System

The library uses an Observable-based execution model where:

1. **Observables** represent streams of values that can be transformed and combined
2. **Blueprint** provides a synchronous-style DSL where `useX` functions chain Observables via flatMap
3. **Store** manages multiple concurrent values from an Observable, each with its own lifecycle
4. **Releasables** handle cleanup in reverse order of creation
5. **Context API** provides type-safe dependency injection using symbols

### API Conventions

#### Observable

- **`Observable<T>`**: Base class for reactive value streams
  - `observe(observer: (value: T) => Releasable): Releasable` - Subscribe to value changes
  - `use(): T` - Shorthand for `Blueprint.useObservable(this)` within a Blueprint
  - `flatMap<U>(f: (value: T) => Observable<U>): Observable<U>` - Transform and flatten
  - `filter(predicate: (value: T) => boolean): Observable<T>` - Filter values
  - `merge<U>(other: Observable<U>): Observable<T | U>` - Merge two streams
  - `Observable.pure<T>(value: T)` - Create Observable with single value
  - `Observable.never<T>()` - Create Observable that emits nothing

#### Blueprint

Blueprints are synchronous-style functions that compose Observables. All `useX` functions must be called at the top level of a Blueprint (not inside conditionals, loops, or callbacks).

- **`Blueprint.toObservable<T>(blueprint: () => T, userCtx?: UserContext): Observable<T>`**
  - Converts a Blueprint function into an Observable

- **`Blueprint.useObservable<T>(observable: Observable<T>): T`**
  - Uses an Observable within a Blueprint (creates flatMap chain)
  - Throws `BlueprintChainException` internally for control flow

- **`Blueprint.useEffect<T>(maker: (addReleasable, abortSignal) => T | Promise<T>): T`**
  - Executes side effects with proper cleanup
  - Use `addReleasable()` to register cleanup functions
  - `abortSignal` indicates when the effect is being cancelled
  - Should be used for all I/O, timers, console.log, and other side effects

- **`Blueprint.useTimeout(delayMs: number): void`**
  - Pauses Blueprint execution for specified milliseconds

- **`Blueprint.useNever(): never`**
  - Stops Blueprint execution (no values emitted)

- **`Blueprint.useGuard(predicate: () => boolean): void`**
  - Conditionally continues execution (like filter)

- **`Blueprint.useIterable<T>(iterable: Iterable<T>): T`**
  - Iterates over values, emitting each one

- **`Blueprint.useUserContext(): UserContext`**
  - Returns current context values

- **`Blueprint.createContext<T>(): Context<T>`**
  - Creates a context for dependency injection
  - Returns object with `key`, `useProvider(value)`, and `useConsumer()`

#### Store

- **`new Store<T>(observable: Observable<T>)`**
  - Creates a Store that manages multiple values from an Observable
  - Each value gets its own lifecycle (Releasable)

- **`Store.fromBlueprint<T>(blueprint: () => T): Store<T>`**
  - Creates a Store from a Blueprint function

- **`Store.useBlueprint<T>(blueprint: () => T): Store<T>`**
  - Creates a Store from a Blueprint AND registers it in the parent Blueprint
  - Must be called within a Blueprint

- **`Store.useState<T>(initialValue: T): [Store<T>, (newValue: T) => Promise<void>]`**
  - Creates a single-value Store with a setter function
  - Setter replaces the current value (skips duplicates and queued values)
  - Must be called within a Blueprint

- **`Store.usePortal<T>(): [Store<T>, (newValue: T) => void]`**
  - Creates a multi-value Store with a setter function
  - Setter adds new values (multiple values can coexist)
  - Values are automatically released when Blueprint scope exits
  - Must be called within a Blueprint

- **`store.peek(): Iterable<T>`**
  - Returns current values without creating dependencies

- **`store.release(): Promise<void>`**
  - Releases all resources (idempotent)

#### Releasable

- **`Releasable.parallel(set: Iterable<Releasable>): Releasable`**
  - Releases all in parallel (uses Promise.allSettled)

- **`Releasable.sequential(set: Iterable<Releasable>): Releasable`**
  - Releases in order (awaits each)

- **`Releasable.noop`**
  - No-op releasable

### Important Patterns

1. **All `useX` functions must be called at Blueprint top level**: Don't call inside if/loops/callbacks
2. **Side effects must use `Blueprint.useEffect`**: All I/O, console.log, timers, etc.
3. **Cleanup via releasables**: Use `addReleasable()` to register cleanup (cleared in reverse order)
4. **Never catch exceptions across `.use()` boundaries**: BlueprintChainException is used for control flow internally
5. **Store manages multiple values**: Each value from Observable gets independent lifecycle
6. **Context is Blueprint-scoped**: Use `useProvider()` in parent, `useConsumer()` in child

### Design Constraints

1. **Synchronous Blueprint execution**: Blueprints run synchronously until a `.use()` call
2. **Exception-based control flow**: `BlueprintChainException` is thrown internally to implement continuations
3. **Global context during Blueprint execution**: `BLUEPRINT_GLOBAL_CONTEXT` is set/restored synchronously
4. **Array-based history**: Blueprint uses array copying for execution history (benchmarked 1.13x faster than persistent Queue/LinkedList)

## Code Style

- TypeScript with strict configuration
- ESLint enforces explicit return types and minimal `any` usage
- Prettier formatting with single quotes and 2-space indentation
- All source code in `src/`, tests in `tests/`, examples in `examples/`
- Compiled output in `dist/`
- `useX` prefix indicates Blueprint-only functions
- Synchronous-style function calls (no `yield*` or `async function*`)

## Testing

- Tests use Node.js built-in test runner (`node:test`)
- Test files are in `tests/` directory with `.test.ts` suffix
- Use `LogCapture` utility from `tests/test-utils.ts` to capture and assert log outputs
- Tests should be fast and isolated
- Each test should clean up after itself by calling `store.release()`

## Common Pitfalls

1. **Don't catch exceptions around `.use()` calls**: This will break Blueprint control flow
2. **Don't call `useX` functions conditionally**: Must be at top level
3. **Don't forget to call `release()`**: Memory leaks will occur
4. **Don't use side effects outside `useEffect`**: Breaks determinism
5. **Don't share Store across unrelated Blueprints**: Each should have its own lifecycle
