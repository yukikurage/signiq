# @quon/core

A lightweight reactive programming library built around **Source**, **Routine**, and **Atom** - providing a declarative API for managing reactive resources and side effects with automatic cleanup.

## Features

- **Source<T>**: Represents a reactive stream of values.
- **Routine<T>**: Represents a task or process with a lifecycle (initialize/finalize).
- **Blueprint DSL**: Synchronous-style syntax for composing routines.
- **Atom<T>**: Managed single-value state container.
- **Portal<T>**: Dynamic multi-value state container.
- **Automatic Cleanup**: Resources are released in proper order automatically.

## Installation

```bash
npm install @quon/core
```

## Quick Start

```typescript
import {
  toRoutine,
  useAtom,
  useDerivation,
  useEffect,
  useTimeout,
  useConnection,
} from '@quon/core';

const counterApp = () => {
  // Create an atom (state)
  const count = useAtom(0);

  // Derive a value and run a side effect
  useDerivation(count, value => {
    useEffect(() => {
      console.log('Count:', value);
    });
  });

  // Update count after 1 second
  useTimeout(1000);
  useEffect(() => count.set(1));

  useTimeout(1000);
  useEffect(() => count.set(2));
};

// Execute the blueprint
const app = toRoutine(counterApp).initialize();

// Later: cleanup
// await app.finalize();
```

## Core Concepts

### Source<T>

`Source<T>` represents a stream of values that can be observed. It is the fundamental building block for reactive data flow.

```typescript
import { Source, Routine } from '@quon/core';

// Transform values
const doubled = source.map(x => x * 2);

// Filter values
const evens = source.filter(x => x % 2 === 0);

// Combine sources
const combined = Source.combineAll(source1, source2);
```

### Routine<T>

`Routine<T>` represents a process that produces a result `T` and has a lifecycle (it can be finalized). Blueprints are compiled into Routines.

```typescript
import { Routine } from '@quon/core';

const routine = new Routine(...);
const { result, finalize } = routine.initialize();

// ... later
await finalize();
```

### Blueprint

`Blueprint` is a synchronous-style DSL for composing Routines.

```typescript
import { toRoutine, useAtom, useEffect } from '@quon/core';

const myBlueprint = () => {
  const atom = useAtom(0);

  // Side effects must be wrapped in useEffect
  useEffect(() => {
    console.log('Atom created');
  });
};

const app = toRoutine(myBlueprint).initialize();
```

### Atom<T>

`Atom<T>` is a `Source<T>` that holds a single current value. It is similar to a "cell" or "signal" in other libraries.

```typescript
const count = useAtom(0);

// Update value
useEffect(() => count.set(1));

// Modify based on previous value
useEffect(() => count.modify(prev => prev + 1));
```

### Portal<T>

`Portal<T>` is a `Source<T>` that allows dynamic connections. It represents a collection of values where items can be added or removed dynamically.

```typescript
const portal = usePortal<string>();

// Connect a value to the portal
useConnection(portal, 'Hello');
```

## API Reference

### Top-Level Exports

- **`toRoutine<T>(blueprint: () => T): Routine<T>`**
  - Converts a Blueprint function into a Routine.

- **`useAtom<T>(initialValue: T): Atom<T>`**
  - Creates a managed single-value state.

- **`usePortal<T>(): Portal<T>`**
  - Creates a dynamic multi-value state.

- **`useDerivation<T, U>(source: Source<T>, blueprint: (val: T) => U): Source<U>`**
  - Derives a new Source by applying a Blueprint to each value.

- **`useEffect<T>(maker: (addFinalizeFn, abortSignal) => T): T`**
  - Executes a side effect with cleanup.

- **`useTimeout(delayMs: number): void`**
  - Pauses execution for a specified duration.

- **`useConnection<T>(portal: Portal<T>, val: T): void`**
  - Connects a value to a Portal.

- **`use<T>(routine: Routine<T>): T`**
  - Uses a Routine within a Blueprint.

### Classes

- **`Source<T>`**
  - `map<U>(fn: (val: T) => U): Source<U>`
  - `flatMap<U>(fn: (val: T) => Source<U>): Source<U>`
  - `filter(predicate: (val: T) => boolean): Source<T>`
  - `merge(other: Source<T>): Source<T>`
  - `combine<U>(other: Source<U>): Source<[T, U]>`
  - `derive<U>(fn: (val: T) => Routine<U>): Routine<Source<U>>`

- **`Routine<T>`**
  - `initialize(): { result: MaybePromise<T>, finalize: () => MaybePromise<void> }`
  - `static all<T>(routines: Routine<T>[]): Routine<T>`
  - `static race<T>(routines: Routine<T>[]): Routine<T>`
  - `static resolve<T>(value: T): Routine<T>`

## License

MIT
