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

This is a reactive programming library built around **Routines** - a synchronous-style API for managing reactive state and side effects with automatic cleanup.

### Core Concepts

- **Atom**: Reactive state container with getter/setter that tracks dependencies
- **Resource**: Computed values that automatically update when dependencies change
- **External Effects**: Side effects (I/O, timers, etc.) with cleanup lifecycle
- **Context**: Type-safe dependency injection system using symbols
- **Routine**: The underlying execution model that manages lifecycle and cleanup

### Key Files

- `src/routine.ts`: Core routine implementation with node-based execution model
- `src/resource.ts`: Implements `withAtom`, `withResource`, `withExternal`, `withWait`, and `launchRoutine`
- `src/context.ts`: Context API for dependency injection
- `src/task-queue.ts`: Task queue for managing async operations
- `src/index.ts`: Main entry point that exports all public APIs

### Reactive System

The library uses a node-based execution model where:

1. **Atoms** store values and notify dependents when changed via create/delete functions
2. **Resources** manage computed values and automatically re-run when dependencies change
3. **External effects** handle side effects with proper cleanup via disposers
4. **Nodes** represent execution points in the routine:
   - Each node can have a "node result" (value or empty)
   - CREATE transitions node from empty to having a value
   - DELETE transitions node back to empty and triggers cleanup
   - Dependencies are tracked automatically when atoms are called
5. **Context API** provides type-safe dependency injection using symbols

### API Conventions

- **`withAtom<T>(initialValue?: T)`**: Creates a reactive atom
  - Call as `atom()` to read value (creates dependency)
  - Call `atom.peek()` to read without creating dependency
  - Call `atom.set(value)` to update value
- **`withResource<T>(routine: () => T)`**: Creates a computed resource
  - Automatically re-runs when dependencies change
  - Returns a `Resource<T>` that can be called to get current value
- **`withExternal<T>(fn: (addDisposer, abortSignal) => T | Promise<T>)`**: Executes side effects
  - Use `addDisposer()` to register cleanup functions
  - `abortSignal` indicates when the effect is being cancelled
  - Should be used for all I/O, timers, and other side effects
- **`withWait(ms: number)`**: Pauses execution for specified milliseconds
- **`launchRoutine(routine: () => void)`**: Launches a routine, returns `{ exit: () => Promise<void> }`
- **`createContext<T>()`**: Creates a context for dependency injection
  - Use `context.withProvider(value, routine)` to provide a value
  - Use `context.withContext()` to consume the value

### Important Patterns

1. **Side effects must use `withExternal`**: All I/O, console.log, timers, etc. should be wrapped in `withExternal`
2. **Cleanup via disposers**: Use `addDisposer()` to register cleanup functions (cleared in reverse order)
3. **Reactive dependencies**: Calling an atom or resource as a function creates a dependency
4. **Peek for non-reactive reads**: Use `atom.peek()` when you don't want to create a dependency
5. **Nested resources are allowed**: Resources can contain other resources for complex computations

## Code Style

- TypeScript with strict configuration
- ESLint enforces explicit return types and no `any` usage
- Prettier formatting with single quotes and 2-space indentation
- All source code in `src/`, tests in `tests/`, examples in `examples/`
- Compiled output in `dist/`
- No `$` suffix convention (unlike the old API)
- Synchronous-style function calls (no `yield*` or `async function*`)

## Testing

- Tests use Node.js built-in test runner (`node:test`)
- Test files are in `tests/` directory with `.test.ts` suffix
- Use `LogCapture` utility from `tests/test-utils.ts` to capture and assert log outputs
- Tests should be fast and isolated
- Each test should clean up after itself by calling `app.exit()`
