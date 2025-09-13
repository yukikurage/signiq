# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-09-14

### Added
- Initial release of Quon Core reactive programming library
- Core reactive system with routines, slots, and observers
- `slot()` - Create reactive state containers
- `observe()` - Watch and react to state changes
- `derive()` - Create computed values from other routines
- `launch()` - Launch application routines
- Utility functions: `wait()`, `clock()`, `interval()`, `until()`
- TypeScript support with full type definitions
- Generator-based coroutines for async operations
- Automatic dependency tracking and cleanup

### Features
- Lightweight and minimalistic design
- No external dependencies
- Full TypeScript support
- Async/await compatible
- Memory leak prevention with automatic cleanup