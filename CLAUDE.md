# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Build**: `npm run build` - Compiles TypeScript to JavaScript in `dist/`
- **Lint**: `npm run lint` - Runs ESLint on TypeScript files
- **Lint Fix**: `npm run lint:fix` - Fixes auto-fixable ESLint issues
- **Format**: `npm run format` - Formats code with Prettier
- **Format Check**: `npm run format:check` - Checks code formatting

## Architecture

This is a reactive programming library built around **Routines** - generator-based coroutines that manage dependencies and async operations.

### Core Concepts

- **Routine**: Generator function that yields control flow instructions (`src/routine.ts`)
- **Slot**: Reactive state container with getter/setter (`src/operation.ts`)
- **Observer**: Manages routine lifecycle and dependency tracking (`src/operation.ts`)

### Key Files

- `src/routine.ts`: Defines the `Routine` type and yield instruction types
- `src/operation.ts`: Implements slots, observers, and reactive operations
- `src/index.ts`: Main entry point

### Reactive System

The library uses a dependency tracking system where:

1. Slots store values and notify dependents when changed
2. Observers manage routine execution and re-run when dependencies change
3. Routines can yield instructions for deferred cleanup, dependency registration, and promise awaiting

## Code Style

- TypeScript with strict configuration
- ESLint enforces explicit return types and no `any` usage
- Prettier formatting with single quotes and 2-space indentation
- All source code in `src/`, compiled output in `dist/`
