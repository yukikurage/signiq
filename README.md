# @quon/core

A lightweight reactive programming library built around **Observable**, **Blueprint**, and **Store** - providing a declarative API for managing reactive state and side effects with automatic cleanup.

## Features

- **Observable Streams**: Represent values that change over time
- **Blueprint DSL**: Synchronous-style syntax for composing reactive operations
- **Store Management**: Handle multiple concurrent values with automatic lifecycle
- **Context API**: Type-safe dependency injection for Blueprints
- **Automatic Cleanup**: Resources are released in proper order automatically

## Installation

```bash
npm install @quon/core
```

## Quick Start

```typescript
import { use, useEffect, useTimeout, useCell, useStore, toStore } from '@quon/core';

const counterApp = () => {
  // Create a state with getter and setter
  const [count, setCount] = useCell(0);

  // Create a reactive computation that observes count
  useStore(() => {
    const value = use(count);
    useEffect(() => {
      console.log('Count:', value);
    });
  });

  // Update count after 1 second
  useTimeout(1000);
  useEffect(async () => {
    await setCount(1);
  });

  useTimeout(1000);
  useEffect(async () => {
    await setCount(2);
  });
};

const store = toStore(counterApp);

// Later: cleanup
// await store.release();
```

## Core Concepts

### Observable

`Observable<T>` represents a stream of values over time. It can be transformed, filtered, and combined.

```typescript
import { Observable } from '@quon/core';

// Create from a value
const obs = Observable.pure(42);

// Transform values
const doubled = obs.flatMap(x => Observable.pure(x * 2));

// Filter values
const evens = obs.filter(x => x % 2 === 0);

// Merge streams
const combined = obs1.merge(obs2);
```

### Blueprint

`Blueprint` is a synchronous-style DSL for composing Observables. All `useX` functions must be called at the top level of a Blueprint.

```typescript
import { Blueprint, toStore } from '@quon/core';

const myBlueprint = () => {
  // Iterate over values
  const num = Blueprint.useIterable([1, 2, 3, 4, 5]);

  // Filter with guard
  Blueprint.useGuard(() => num % 2 === 0);

  // Side effects
  Blueprint.useEffect(() => {
    console.log('Even number:', num);
  });
};

const store = toStore(myBlueprint);
```

#### Important Blueprint Rules

1. **`useX` functions must be at the top level** - However, you CAN use `if` and loops if they depend only on `const` values (including values created within the Blueprint). When a dependency changes, the Blueprint re-executes from the beginning, canceling all subsequent processing.
2. **Don't catch exceptions across `use()` boundaries** - This breaks Blueprint control flow
3. **Side effects must use `useEffect`** - All I/O, console.log, timers, etc.

### Store

`Store<T>` represents a **collection of values** that are acquired and released over time, rather than a single changing value. Multiple values can coexist simultaneously in a Store.

```typescript
import { Blueprint, toStore } from '@quon/core';

// Create from Blueprint
const store = toStore(() => {
  const value = Blueprint.useIterable([1, 2, 3]);
  Blueprint.useEffect(() => console.log(value));
});

// Get ALL current values (multiple can exist simultaneously)
const values = [...store.peek()]; // [1, 2, 3]

// Cleanup
await store.release();
```

#### useCell - Managed Single Value

Creates a Store that holds at most one value at a time. When you set a new value, the old value is released and replaced.

```typescript
import { use, useEffect, useCell, useStore } from '@quon/core';

const myApp = () => {
  const [count, setCount] = useCell(0);

  useStore(() => {
    console.log('Count is:', use(count));
  });

  // Replace the current value (releases old, creates new)
  await setCount(5);
};
```

#### usePortal - Dynamic Value Collection

Creates a Store where you can add/remove values within a Blueprint. **Multiple values can coexist** - each call to the setter function adds or removes a value from the Store.

```typescript
import { use, useEffect, usePortal, useStore } from '@quon/core';

const myApp = () => {
  const [items, useAddItem] = usePortal<number>();

  useStore(() => {
    const item = use(items);
    console.log('Item:', item);
  });

  // The setter is a Blueprint function (useX) - must be called within a Blueprint
  useStore(() => {
    useAddItem(1); // Adds value 1 (exists while this Blueprint scope is active)
  });

  useStore(() => {
    useAddItem(2); // Adds value 2 (both 1 and 2 now exist in the Store)
  });

  // When a Blueprint scope exits, its values are automatically released
};
```

### Context

Type-safe dependency injection for Blueprints:

```typescript
import { Blueprint, useStore } from '@quon/core';

// Create context
const ThemeContext = Blueprint.createContext<'light' | 'dark'>();

const app = () => {
  // Provide value
  ThemeContext.useProvider('dark');

  useStore(() => {
    // Consume value
    const theme = ThemeContext.useConsumer();
    console.log('Current theme:', theme);
  });
};
```

## API Reference

### Convenience Exports (React-like)

These functions are exported directly for convenience:

- **`use<T>(observable: Observable<T>): T`**
  - Shorthand for `Blueprint.use()` - uses Observable within Blueprint

- **`useEffect<T>(maker: (addReleasable, abortSignal) => T | Promise<T>): T`**
  - Executes side effects with cleanup
  - Use for all I/O, console.log, timers, etc.

- **`useTimeout(delayMs: number): void`**
  - Pauses execution for specified milliseconds

- **`useGuard(predicate: () => boolean): void`**
  - Conditionally continues (like filter)

- **`useIterable<T>(iterable: Iterable<T>): T`**
  - Iterates over values, emitting each

- **`useNever(): never`**
  - Stops execution (no values emitted)

- **`useCell<T>(initialValue: T): [Store<T>, (value: T) => Promise<void>]`**
  - Managed single-value Store (setter replaces value, deduplicates)

- **`usePortal<T>(): [Store<T>, (value: T) => void]`**
  - Dynamic value collection Store (setter adds/removes values)

- **`useStore<T>(blueprint: () => T): Store<T>`**
  - Creates Store within parent Blueprint (registers for cleanup)

- **`toStore<T>(blueprint: () => T): Store<T>`**
  - Creates Store from Blueprint (external use)

### Blueprint Namespace

- **`Blueprint.toObservable<T>(blueprint: () => T): Observable<T>`**
  - Converts Blueprint to Observable

- **`Blueprint.createContext<T>(): Context<T>`**
  - Creates context for dependency injection

- **`Blueprint.useUserContext(): UserContext`**
  - Returns current context values

### Store

- **`new Store<T>(observable: Observable<T>)`**
  - Creates Store from Observable directly

- **`Store.newStoreObservable<T>(obs: Observable<T>): Observable<Store<T>>`**
  - Low-level: Wraps Observable in Store, returns effect Observable

- **`Store.newCellObservable<T>(initialValue: T): Observable<[Store<T>, Setter]>`**
  - Low-level: Single-value cell Observable

- **`Store.newPortalObservable<T>(): Observable<[Store<T>, (T) => Observable<void>]>`**
  - Low-level: Multi-value portal Observable

- **`store.peek(): Iterable<T>`**
  - Returns current values without creating dependencies

- **`store.release(): Promise<void>`**
  - Releases all resources (idempotent)

### Observable Methods

- **`observable.observe(observer: (value: T) => Releasable): Releasable`**
  - Subscribe to value changes

- **`observable.flatMap<U>(f: (value: T) => Observable<U>): Observable<U>`**
  - Transform and flatten

- **`observable.filter(predicate: (value: T) => boolean): Observable<T>`**
  - Filter values

- **`observable.merge<U>(other: Observable<U>): Observable<T | U>`**
  - Merge two streams

### Releasable

Resources that need cleanup:

- **`Releasable.parallel(set: Iterable<Releasable>): Releasable`**
  - Releases all in parallel

- **`Releasable.sequential(set: Iterable<Releasable>): Releasable`**
  - Releases in order

- **`Releasable.noop`**
  - No-op releasable

## Common Pitfalls

1. ❌ **Don't catch exceptions around `use()` calls**

   ```typescript
   // BAD - breaks Blueprint control flow
   try {
     const value = use(observable);
   } catch (e) {
     // This will catch internal BlueprintChainException
   }
   ```

2. ❌ **Don't call `useX` inside conditionals that depend on mutable values**

   ```typescript
   // BAD - if depends on reactive value
   let mutableValue = 0;
   // ... somewhere else, mutableValue changes ...
   if (mutableValue > 5) {
     const value = use(observable); // Wrong!
   }

   // OK - if depends on const value
   const constValue = use(reactiveValue);
   if (constValue > 5) {
     const value = use(observable); // This is fine
   }
   ```

3. ❌ **Don't forget to call `release()`**

   ```typescript
   const store = toStore(myApp);
   // ... use store ...
   await store.release(); // Important!
   ```

4. ❌ **Don't use side effects outside `useEffect`**
   ```typescript
   // BAD - breaks determinism
   const value = use(observable);
   console.log(value); // Should be in useEffect
   ```

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build
npm run build

# Lint
npm run lint

# Format
npm run format
```

## Project Structure

```
quon/
├── src/                  # Source code
│   ├── observable.ts     # Observable implementation
│   ├── blueprint.ts      # Blueprint DSL implementation
│   ├── store.ts          # Store class for value collection management
│   ├── releasable.ts     # Releasable interface and utilities
│   ├── bilink-map.ts     # Bidirectional map for observers/values
│   ├── task-queue.ts     # Task queue for async operations
│   └── index.ts          # Public exports + convenience re-exports
├── tests/                # Test files
│   ├── quon.test.ts      # Main test suite
│   └── test-utils.ts     # Test utilities
└── examples/             # Example usage (if any)
```

## Architecture Notes

- **Synchronous Blueprint execution**: Blueprints run synchronously until a `use()` call, then re-execute from the beginning when dependencies change
- **Exception-based control flow**: `BlueprintChainException` is used internally for continuations
- **Array-based history**: Blueprint uses array copying for execution history (benchmarked 1.13x faster than persistent Queue/LinkedList)
- **Automatic lifecycle**: Store manages acquisition and release of value collections automatically
- **Value collections, not single values**: Store represents a set of values that exist simultaneously, acquired and released over time
- **Separation of concerns**: Store provides low-level Observable-based APIs; Blueprint provides convenience wrappers

## License

MIT
