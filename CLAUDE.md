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

- `src/observable.ts`: Core Observable implementation
- `src/blueprint.ts`: Blueprint DSL implementation
- `src/store.ts`: Store class for managing Observable values with lifecycle
- `src/releasable.ts`: Releasable interface and composition utilities
- `src/bilink-map.ts`: Bidirectional map for managing Observer-Value relationships
- `src/task-queue.ts`: Task queue for managing async operations
- `src/index.ts`: Main entry point that exports all public APIs + convenience re-exports
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
  - `map<U>(f: (value: T) => U): Observable<U>` - Transform values
  - `flatMap<U>(f: (value: T) => Observable<U>): Observable<U>` - Transform and flatten
  - `filter(predicate: (value: T) => boolean): Observable<T>` - Filter values
  - `merge<U>(other: Observable<U>): Observable<T | U>` - Merge two streams
  - `Observable.pure<T>(value: T)` - Create Observable with single value
  - `Observable.never<T>()` - Create Observable that emits nothing

#### Blueprint

Blueprints are synchronous-style functions that compose Observables. All `useX` functions must be called at the top level of a Blueprint (not inside conditionals, loops, or callbacks).

**Core Blueprint APIs:**

- **`Blueprint.toObservable<T>(blueprint: () => T, userCtx?: UserContext): Observable<T>`**
  - Converts a Blueprint function into an Observable

- **`Blueprint.use<T>(observable: Observable<T>): T`** (also exported as `use()`)
  - Uses an Observable within a Blueprint (creates flatMap chain)
  - Throws `BlueprintChainException` internally for control flow

- **`Blueprint.useEffect<T>(maker: (addReleasable, abortSignal) => T | Promise<T>): T`** (also exported as `useEffect()`)
  - Executes side effects with proper cleanup
  - Use `addReleasable()` to register cleanup functions
  - `abortSignal` indicates when the effect is being cancelled
  - Should be used for all I/O, timers, console.log, and other side effects

- **`Blueprint.useTimeout(delayMs: number): void`** (also exported as `useTimeout()`)
  - Pauses Blueprint execution for specified milliseconds

- **`Blueprint.useNever(): never`** (also exported as `useNever()`)
  - Stops Blueprint execution (no values emitted)

- **`Blueprint.useGuard(predicate: () => boolean): void`** (also exported as `useGuard()`)
  - Conditionally continues execution (like filter)

- **`Blueprint.useIterable<T>(iterable: Iterable<T>): T`** (also exported as `useIterable()`)
  - Iterates over values, emitting each one

**Store-related Blueprint APIs:**

- **`Blueprint.toStore<T>(blueprint: () => T): Store<T>`** (also exported as `toStore()`)
  - Create a Store from a Blueprint outside of a Blueprint context
  - This is the main entry point for creating root Stores

- **`Blueprint.useStore<T>(blueprint: () => T): Store<T>`** (also exported as `useStore()`)
  - Create a Store from a Blueprint within a Blueprint context
  - The created Store will be a child of the current Blueprint

- **`Blueprint.useCell<T>(initialValue: T): [Store<T>, (newValue: T) => Promise<void>]`** (also exported as `useCell()`)
  - Create a single-value cell within a Blueprint
  - The setter replaces the current value (releases old, creates new)

- **`Blueprint.usePortal<T>(): [Store<T>, (newValue: T) => void]`** (also exported as `usePortal()`)
  - Create a multi-value portal within a Blueprint
  - The setter is a Blueprint function that adds/removes values
  - Multiple values can coexist in the Store

**Context APIs:**

- **`Blueprint.useUserContext(): UserContext`**
  - Returns current context values

- **`Blueprint.createContext<T>(): Context<T>`**
  - Creates a context for dependency injection
  - Returns object with `key`, `useProvider(value)`, and `useConsumer()`

#### Store

**Store Class:**

- **`new Store<T>(observable: Observable<T>)`**
  - Creates a Store that manages multiple values from an Observable
  - Each value gets its own lifecycle (Releasable)

- **`store.peek(): Iterable<T>`**
  - Returns current values without creating dependencies

- **`store.release(): Promise<void>`**
  - Releases all resources (idempotent)

**Low-level Store Factory Functions (Observable-based):**

These functions are Blueprint-independent and return Observables. They are the foundation for Blueprint convenience wrappers.

- **`Store.newStoreObservable<T>(obs: Observable<T>): Observable<Store<T>>`**
  - Wrap an Observable in a Store as an effect Observable
  - The Store is created synchronously and returned

- **`Store.newCellObservable<T>(initialValue: T): Observable<[Store<T>, (newValue: T) => Promise<void>]>`**
  - Create an Observable that provides a single-value cell
  - The setter replaces the current value (releases old, creates new)
  - Skips duplicates and queued values

- **`Store.newPortalObservable<T>(): Observable<[Store<T>, (newValue: T) => Observable<void>]>`**
  - Create an Observable that provides a multi-value portal
  - The setter returns an Observable<void> that represents adding/removing a value
  - Multiple values can coexist in the Store

#### Releasable

- **`Releasable.parallel(set: Iterable<Releasable>): Releasable`**
  - Releases all in parallel (uses Promise.allSettled)

- **`Releasable.sequential(set: Iterable<Releasable>): Releasable`**
  - Releases in order (awaits each)

- **`Releasable.noop`**
  - No-op releasable

### Important Patterns

1. **All `useX` functions must be called at Blueprint top level**: Don't call inside if/loops/callbacks
2. **Side effects must use `useEffect`**: All I/O, console.log, timers, etc.
3. **Cleanup via releasables**: Use `addReleasable()` to register cleanup (cleared in reverse order)
4. **Never catch exceptions across `use()` boundaries**: BlueprintChainException is used for control flow internally
5. **Store manages multiple values**: Each value from Observable gets independent lifecycle
6. **Context is Blueprint-scoped**: Use `useProvider()` in parent, `useConsumer()` in child
7. **Separation of concerns**: Store provides low-level Observable-based APIs; Blueprint provides convenience wrappers
8. **No circular dependencies**: Store → Observable (no Blueprint dependency), Blueprint → Store (one-way dependency)

### Design Constraints

1. **Synchronous Blueprint execution**: Blueprints run synchronously until a `use()` call
2. **Exception-based control flow**: `BlueprintChainException` is thrown internally to implement continuations
3. **Global context during Blueprint execution**: `BLUEPRINT_GLOBAL_CONTEXT` is set/restored synchronously
4. **Array-based history**: Blueprint uses array copying for execution history (benchmarked 1.13x faster than persistent Queue/LinkedList)
5. **Observable-first design**: Store factory functions return Observables, Blueprint provides wrappers

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

1. **Don't catch exceptions around `use()` calls**: This will break Blueprint control flow
2. **Don't call `useX` functions conditionally**: Must be at top level
3. **Don't forget to call `release()`**: Memory leaks will occur
4. **Don't use side effects outside `useEffect`**: Breaks determinism
5. **Don't share Store across unrelated Blueprints**: Each should have its own lifecycle

## API Design Notes

### Convenience Re-exports (React-like Pattern)

Following React's design pattern, frequently used functions are re-exported directly from the main module:

```typescript
// These work without the Blueprint. prefix:
import { use, useEffect, useTimeout, useCell, usePortal, useStore, toStore } from '@quon/core';

// Less common functions still use the namespace:
import { Blueprint } from '@quon/core';
Blueprint.createContext();
Blueprint.useUserContext();
```

### Two-Layer API Design

**Store Module (Low-level, Observable-based):**
- `Store.newStoreObservable()` - Returns `Observable<Store<T>>`
- `Store.newCellObservable()` - Returns `Observable<[Store<T>, Setter]>`
- `Store.newPortalObservable()` - Returns `Observable<[Store<T>, (T) => Observable<void>]>`

**Blueprint Module (High-level, Convenience):**
- `Blueprint.toStore()` / `toStore()` - Uses `toObservable()` + `new Store()`
- `Blueprint.useStore()` / `useStore()` - Uses `newStoreObservable()` + `use()`
- `Blueprint.useCell()` / `useCell()` - Uses `newCellObservable()` + `use()`
- `Blueprint.usePortal()` / `usePortal()` - Uses `newPortalObservable()` + `use()` + `map()`

This separation ensures:
1. Store has no Blueprint dependency (no circular deps)
2. Observable-based APIs are composable and testable
3. Blueprint provides ergonomic wrappers for common use cases
