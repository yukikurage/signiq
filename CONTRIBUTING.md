# Contributing to Quon Core

Thank you for your interest in contributing to Quon Core!

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the project: `npm run build`
4. Run tests: `npm test`

## Development Commands

- `npm run build` - Compile TypeScript
- `npm run lint` - Check code style
- `npm run lint:fix` - Auto-fix linting issues
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting

## Code Style

- Use TypeScript with strict configuration
- Follow ESLint rules (explicit return types, no `any`)
- Use Prettier for formatting (single quotes, 2 spaces)
- Add JSDoc comments for public APIs

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run tests and linting: `npm test && npm run lint`
5. Commit with clear messages
6. Push and create a pull request

## Reporting Issues

Please use GitHub Issues to report bugs or request features. Include:

- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- TypeScript/Node.js versions

## Questions?

Feel free to open an issue for questions or discussions about the library.