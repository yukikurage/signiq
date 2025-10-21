import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  withAtom,
  withResource,
  withExternal,
  withWait,
  launchRoutine,
} from '../src';
import { LogCapture } from './test-utils';

describe('Basic atom operations', () => {
  it('should create and update atom values', async () => {
    const logs = new LogCapture();

    function Test(): void {
      const counter = withAtom<number>(0);

      withResource(() => {
        const value = counter();
        withExternal(() => {
          logs.log(`Counter: ${value}`);
        });
      });

      withWait(10);
      withExternal(() => counter.set(1));

      withWait(10);
      withExternal(() => counter.set(2));

      withWait(10);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 100));
    await app.exit();

    const result = logs.expect(['Counter: 0', 'Counter: 1', 'Counter: 2']);
    assert.strictEqual(result.passed, true, result.message);
  });

  it('should support peek without creating dependencies', async () => {
    const logs = new LogCapture();

    function Test(): void {
      const counter = withAtom<number>(10);

      withExternal(() => {
        logs.log(`Peek: ${counter.peek()}`);
      });

      withWait(10);

      withExternal(async () => {
        await counter.set(20);
        logs.log(`After set: ${counter.peek()}`);
      });

      withWait(10);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 100));
    await app.exit();

    const result = logs.expect(['Peek: 10', 'After set: 20']);
    assert.strictEqual(result.passed, true, result.message);
  });
});

describe('Derived values with withResource', () => {
  it('should compute derived values correctly', async () => {
    const logs = new LogCapture();

    function Test(): void {
      const x = withAtom<number>(2);
      const y = withAtom<number>(3);

      const sum = withResource(() => x() + y());

      withResource(() => {
        const result = sum();
        withExternal(() => {
          logs.log(`Sum: ${result}`);
        });
      });

      withWait(10);
      withExternal(() => x.set(5));

      withWait(10);
      withExternal(() => y.set(7));

      withWait(10);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 100));
    await app.exit();

    const result = logs.expect(['Sum: 5', 'Sum: 8', 'Sum: 12']);
    assert.strictEqual(result.passed, true, result.message);
  });

  it('should handle complex derived computations', async () => {
    const logs = new LogCapture();

    function Test(): void {
      const x = withAtom<number>(2);
      const y = withAtom<number>(3);

      const sum = withResource(() => x() + y());
      const product = withResource(() => x() * y());
      const combined = withResource(() => `${sum()}+${product()}`);

      withResource(() => {
        const result = combined();
        withExternal(() => {
          logs.log(result);
        });
      });

      withWait(10);
      withExternal(() => x.set(4));

      withWait(10);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 100));
    await app.exit();

    // When x changes, both sum and product change
    // The behavior may vary, so we just check that we get the final correct value
    const result = logs.expect(['5+6', '7+12']);
    assert.strictEqual(result.passed, true, result.message);
  });
});

describe('Cleanup with withExternal', () => {
  it('should execute cleanup functions on exit', async () => {
    const logs = new LogCapture();

    function Test(): void {
      withExternal(addDisposer => {
        logs.log('Setup');
        addDisposer(() => {
          logs.log('Cleanup');
        });
      });

      withWait(50);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 100));
    await app.exit();

    const result = logs.expect(['Setup', 'Cleanup']);
    assert.strictEqual(result.passed, true, result.message);
  });

  it('should clear intervals on cleanup', async () => {
    const logs = new LogCapture();

    function Test(): void {
      let count = 0;
      withExternal(addDisposer => {
        const intervalId = setInterval(() => {
          logs.log(`Tick ${++count}`);
        }, 20);

        addDisposer(() => {
          clearInterval(intervalId);
          logs.log('Interval cleared');
        });
      });

      withWait(100);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 150));
    await app.exit();

    // Should have at least a few ticks and the cleanup message
    const result = logs.expectContains(['Tick 1', 'Interval cleared']);
    assert.strictEqual(result.passed, true, result.message);
  });
});
