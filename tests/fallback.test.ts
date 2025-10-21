import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  withAtom,
  withResource,
  withExternal,
  withWait,
  launchRoutine,
  fallback,
} from '../src';
import { LogCapture } from './test-utils';

describe('fallback function', () => {
  it('should use resource value when available', async () => {
    const logs = new LogCapture();

    function Test(): void {
      const source = withAtom<number>(10);
      const withFallback = fallback(0, source);

      withResource(() => {
        const value = withFallback();
        withExternal(() => {
          logs.log(`Value: ${value}`);
        });
      });

      withWait(10);
      withExternal(() => source.set(20));

      withWait(10);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 100));
    await app.exit();

    // fallback returns source value (10), then fallback (0), then updates to 20
    const result = logs.expect(['Value: 10', 'Value: 0', 'Value: 20']);
    assert.strictEqual(result.passed, true, result.message);
  });

  it('should use fallback value when resource is undefined', async () => {
    const logs = new LogCapture();

    function Test(): void {
      const source = withAtom<number | undefined>(undefined);
      const withFallback = fallback(99, source);

      withResource(() => {
        const value = withFallback();
        withExternal(() => {
          logs.log(`Value: ${value}`);
        });
      });

      withWait(10);
      withExternal(() => source.set(42));

      withWait(10);
      withExternal(() => source.set(undefined));

      withWait(10);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 100));
    await app.exit();

    // When source is undefined, fallback returns 99. Then 42, then 99 again
    const result = logs.expect(['Value: 99', 'Value: 42', 'Value: 99']);
    assert.strictEqual(result.passed, true, result.message);
  });

  it('should revert to fallback value on cleanup', async () => {
    const logs = new LogCapture();

    function Test(): void {
      const trigger = withAtom<boolean>(true);

      withResource(() => {
        const shouldRender = trigger();

        if (shouldRender) {
          const source = withAtom<string>('hello');
          const withFallback = fallback('default', source);

          withResource(() => {
            const value = withFallback();
            withExternal(() => {
              logs.log(`Inner value: ${value}`);
            });
          });

          withWait(10);
          withExternal(() => source.set('world'));

          withWait(10);
        } else {
          withExternal(() => {
            logs.log('Cleaned up');
          });
        }
      });

      withWait(10);
      withExternal(() => trigger.set(false));

      withWait(10);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 150));
    await app.exit();

    // fallback returns source value directly ('hello'), then 'world', then cleanup
    const result = logs.expect([
      'Inner value: hello',
      'Inner value: default',
      'Inner value: world',
      'Cleaned up',
    ]);
    assert.strictEqual(result.passed, true, result.message);
  });

  it('should handle multiple fallbacks in sequence', async () => {
    const logs = new LogCapture();

    function Test(): void {
      const source = withAtom<number>(5);
      const first = fallback(10, source);
      const second = fallback(20, first);

      withResource(() => {
        const value = second();
        withExternal(() => {
          logs.log(`Value: ${value}`);
        });
      });

      withWait(10);
      withExternal(() => source.set(undefined));

      withWait(10);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 100));
    await app.exit();

    // Shows initial value 5, then when source becomes undefined, returns 10
    const result = logs.expect([
      'Value: 20',
      'Value: 5',
      'Value: 20',
      'Value: 10',
    ]);
    assert.strictEqual(result.passed, true, result.message);
  });

  it('should work with different types for fallback', async () => {
    const logs = new LogCapture();

    function Test(): void {
      const source = withAtom<string | undefined>('active');
      const withFallback = fallback('inactive', source);

      withResource(() => {
        const value = withFallback();
        withExternal(() => {
          logs.log(`Status: ${value}`);
        });
      });

      withWait(10);
      withExternal(() => source.set(undefined));

      withWait(10);
      withExternal(() => source.set('running'));

      withWait(10);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 100));
    await app.exit();

    // Shows 'active', then 'inactive' when undefined, then 'running'
    const result = logs.expect([
      'Status: active',
      'Status: inactive',
      'Status: running',
    ]);
    assert.strictEqual(result.passed, true, result.message);
  });
});
