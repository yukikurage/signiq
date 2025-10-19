import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createContext,
  withAtom,
  withResource,
  withExternal,
  withWait,
  launchRoutine,
  Atom,
} from '../src';
import { LogCapture } from './test-utils';

describe('Context API', () => {
  it('should provide and consume context values', async () => {
    const logs = new LogCapture();

    type TestContext = {
      count: Atom<number>;
    };

    const testContext = createContext<TestContext>();

    function Test(): void {
      const count = withAtom<number>(0);

      testContext.withProvider({ count }, () => {
        withResource(() => {
          const ctx = testContext.withContext();
          if (ctx) {
            const value = ctx.count();
            withExternal(() => {
              logs.log(`Count: ${value}`);
            });
          }
        });
      });

      withWait(10);
      withExternal(() => count.set(1));

      withWait(10);
      withExternal(() => count.set(2));

      withWait(10);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 100));
    await app.exit();

    const result = logs.expect(['Count: 0', 'Count: 1', 'Count: 2']);
    assert.strictEqual(result.passed, true, result.message);
  });

  it('should handle nested contexts', async () => {
    const logs = new LogCapture();

    type OuterContext = { value: string };
    type InnerContext = { value: number };

    const outerContext = createContext<OuterContext>();
    const innerContext = createContext<InnerContext>();

    function Test(): void {
      outerContext.withProvider({ value: 'outer' }, () => {
        innerContext.withProvider({ value: 42 }, () => {
          withExternal(() => {
            const outer = outerContext.withContext();
            const inner = innerContext.withContext();
            logs.log(`Outer: ${outer?.value}, Inner: ${inner?.value}`);
          });
        });
      });

      withWait(10);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 50));
    await app.exit();

    const result = logs.expect(['Outer: outer, Inner: 42']);
    assert.strictEqual(result.passed, true, result.message);
  });
});
