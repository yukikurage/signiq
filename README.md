# Quon Core

A lightweight reactive programming library using generator-based routines for TypeScript/JavaScript.

## Installation

```bash
npm install @quon/core
```

## Quick Start

```typescript
import { slot$, observe$, launch } from '@quon/core';

// Create a reactive counter example
async function* example() {
  // Create a reactive slot with initial value 0
  const counter$ = yield* slot$(0);

  // Observe changes and log them
  yield* observe$(async function* () {
    const value = yield* counter$();
    console.log('Counter value:', value);
  });

  // Update the counter value
  counter$.set(1);
  counter$.set(2);
  counter$.set(3);
}

// Launch the app
const app = await launch(example);
app.quit();
```

## Core Concepts

- **Routine**: Generator functions that yield control flow instructions
- **Slot**: Reactive state containers with automatic dependency tracking
- **Observer**: Manages routine lifecycle and re-execution on dependency changes
- **Derive**: Creates readonly computed values that automatically update

## API

> **Note**: Functions with `$` suffix return `Routine<T>` and must be called with `yield*`

### `slot$<T>(initialValue: T)`

Creates a reactive slot with getter/setter methods.

```typescript
const count$ = yield * slot$(0);
const value = yield * count$(); // Get current value
count$.set(5); // Set new value
```

### `observe$(routine)`

Observes a routine and re-runs it when dependencies change.

```typescript
yield *
  observe$(async function* () {
    const value = yield* someSlot$();
    console.log('Value changed:', value);
  });
```

### `derive$(routine)`

Creates a readonly slot derived from other reactive values.

```typescript
const doubled$ =
  yield *
  derive$(async function* () {
    const value = yield* baseValue$();
    return value * 2;
  });
```

### `wait$(milliseconds)`

Pauses execution for the specified number of milliseconds.

```typescript
yield * wait$(1000); // Wait 1 second
```

### `launch(routine)`

Launches an app routine and returns an object with a quit method.

```typescript
const app = await launch(myRoutine);
await app.quit(); // Clean shutdown
```

## Examples

### Derived Values

```typescript
async function* derivedExample() {
  // Base reactive value
  const temperature$ = yield* slot$(20);

  // Derived Fahrenheit value
  const fahrenheit$ = yield* derive$(async function* () {
    const celsius = yield* temperature$();
    return (celsius * 9) / 5 + 32;
  });

  // Observer that logs both values
  yield* observe$(async function* () {
    const c = yield* temperature$();
    const f = yield* fahrenheit$();
    console.log(`${c}°C = ${f}°F`);
  });

  // Update temperature
  temperature$.set(25);
  temperature$.set(30);
}
```

## License

MIT
