# @quon/core

A lightweight reactive programming library using generator-based routines for managing state and side effects.

## Features

- **Reactive Atoms**: Simple state containers with automatic dependency tracking
- **Resources**: Computed values that automatically update when dependencies change
- **External Effects**: Clean separation of side effects with proper cleanup
- **Context API**: Type-safe dependency injection
- **Lifecycle Management**: Automatic cleanup of resources and effects

## Installation

```bash
npm install @quon/core
```

## Quick Start

```typescript
import { withAtom, withResource, withExternal, launchRoutine } from '@quon/core';

function Counter(): void {
  // Create a reactive atom
  const count = withAtom<number>(0);

  // Create a computed value
  const doubled = withResource(() => count() * 2);

  // Observe changes and perform side effects
  withResource(() => {
    const value = doubled();
    withExternal(() => {
      console.log('Doubled value:', value);
    });
  });

  // Update the count
  withExternal(() => count.set(1));
}

const app = launchRoutine(Counter);
// Later: await app.exit();
```

## Core Concepts

### Atoms

Atoms are reactive state containers:

```typescript
const count = withAtom<number>(0);

// Read value (creates dependency)
const value = count();

// Read without dependency
const value = count.peek();

// Update value
await count.set(1);
```

### Resources

Resources are computed values that automatically update:

```typescript
const x = withAtom<number>(2);
const y = withAtom<number>(3);

// Automatically recomputes when x or y changes
const sum = withResource(() => x() + y());
```

### External Effects

Side effects should be wrapped in `withExternal`:

```typescript
withExternal((addDisposer) => {
  // Setup
  console.log('Starting...');
  const interval = setInterval(() => console.log('tick'), 1000);

  // Cleanup
  addDisposer(() => {
    clearInterval(interval);
    console.log('Stopped');
  });
});
```

### Context API

Type-safe dependency injection:

```typescript
type AppContext = {
  theme: Atom<'light' | 'dark'>;
};

const appContext = createContext<AppContext>();

// Provide context
const theme = withAtom<'light' | 'dark'>('light');
appContext.withProvider({ theme }, () => {
  // Consume context
  const ctx = appContext.withContext();
  if (ctx) {
    const currentTheme = ctx.theme();
    // Use theme...
  }
});
```

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run examples
npm run examples

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
├── src/           # Source code
│   ├── routine.ts     # Core routine implementation
│   ├── resource.ts    # Atoms and resources
│   ├── context.ts     # Context API
│   └── index.ts       # Public exports
├── tests/         # Test files
│   ├── basic.test.ts
│   ├── context.test.ts
│   └── nested.test.ts
└── examples/      # Example usage
    ├── basic.ts
    ├── context.ts
    └── operations.ts
```

## License

MIT
