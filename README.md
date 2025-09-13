# Quon Core

A lightweight reactive programming library using generator-based routines for TypeScript/JavaScript.

## Installation

```bash
npm install @quon/core
```

## Quick Start

```typescript
import { slot, observe, launch } from '@quon/core';

// Create a reactive slot
async function* example() {
  const counter = yield* slot(0);

  // Observe changes
  yield* observe(async function* () {
    const value = yield* counter.get();
    console.log('Counter:', value);
  });

  // Update value
  counter.set(1);
  counter.set(2);
}

// Launch the app
const app = await launch(example);
await app.quit();
```

## Core Concepts

- **Routine**: Generator functions that yield control flow instructions
- **Slot**: Reactive state containers with automatic dependency tracking
- **Observer**: Manages routine lifecycle and re-execution on dependency changes

## API

### `slot<T>(initialValue: T)`
Creates a reactive slot with getter/setter methods.

### `observe(routine)`
Observes a routine and re-runs it when dependencies change.

### `derive(routine)`
Creates a readonly slot derived from another routine.

### `launch(routine)`
Launches an app routine and returns quit function.

## License

MIT