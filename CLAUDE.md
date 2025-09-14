# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Build**: `npm run build` - Compiles TypeScript to JavaScript in `dist/`
- **Test**: `npm run test` - Runs the test.ts file using tsx
- **Lint**: `npm run lint` - Runs ESLint on TypeScript files
- **Lint Fix**: `npm run lint:fix` - Fixes auto-fixable ESLint issues
- **Format**: `npm run format` - Formats code with Prettier
- **Format Check**: `npm run format:check` - Checks code formatting

## Architecture

This is a reactive programming library built around **Routines** - generator-based coroutines that manage dependencies and async operations.

### Core Concepts

- **Routine**: Generator function that yields control flow instructions (`src/routine.ts`)
- **Slot**: Reactive state container with getter/setter (`src/operation.ts`)
- **Observer**: Manages routine execution and re-run when dependencies change (`src/operation.ts`)
- **Context**: Type-safe dependency injection system using symbols (`src/operation.ts`)
- **Derived Values**: Computed readonly slots that automatically update when dependencies change

### Key Files

- `src/routine.ts`: Defines the `Routine` type and yield instruction types
- `src/operation.ts`: Implements slots, observers, derived values, context, and reactive operations
- `src/index.ts`: Main entry point that exports all public APIs
- `test.ts`: Example usage and testing

### Reactive System

The library uses a sophisticated dependency tracking system where:

1. **Slots** store values and notify dependents when changed via callback sets
2. **Observers** manage routine lifecycle and automatically re-run when dependencies change
3. **Routines** can yield various instruction types:
   - `defer`: Register cleanup functions that run when the routine is cancelled
   - `addDependency`: Register dependency on a slot's callback store
   - `getContexts`: Access the context container for dependency injection
4. **Context API** provides type-safe dependency injection using symbols
5. **Derived slots** create computed values that update when their dependencies change

### API Conventions

- Functions that return `Routine<T>` have the `$` suffix (e.g., `slot$`, `observe$`, `derive$`)
- Context providers and consumers use the same `Context<T>` object
- All async operations use generator functions with proper cleanup via defer
- Dependency tracking is automatic when yielding slot getters

## Code Style

- TypeScript with strict configuration
- ESLint enforces explicit return types and no `any` usage
- Prettier formatting with single quotes and 2-space indentation
- All source code in `src/`, compiled output in `dist/`
- Generator functions use `async function*` syntax
- Reactive values use `$` suffix convention
