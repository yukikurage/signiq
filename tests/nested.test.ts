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

describe('Nested resources', () => {
  it('should handle nested withResource calls', async () => {
    const logs = new LogCapture();

    function Test(): void {
      const trigger = withAtom<number>(0);
      const data = withAtom<string>('initial');

      withResource(() => {
        const triggerValue = trigger();
        withExternal(() => {
          logs.log(`Outer: ${triggerValue}`);
        });

        withResource(() => {
          const dataValue = data();
          withExternal(() => {
            logs.log(`Inner: ${dataValue}`);
          });
        });
      });

      withWait(10);
      withExternal(() => trigger.set(1));

      withWait(10);
      withExternal(() => data.set('updated'));

      withWait(10);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 100));
    await app.exit();

    // When trigger changes, both outer and inner re-run
    // When data changes, only inner re-runs
    const result = logs.expect([
      'Outer: 0',
      'Inner: initial',
      'Outer: 1',
      'Inner: initial',
      'Inner: updated',
    ]);
    assert.strictEqual(result.passed, true, result.message);
  });

  it('should properly clean up nested resources', async () => {
    const logs = new LogCapture();

    function Test(): void {
      const trigger = withAtom<number>(0);

      withResource(() => {
        const value = trigger();
        withExternal(addDisposer => {
          logs.log(`Outer setup: ${value}`);
          addDisposer(() => {
            logs.log(`Outer cleanup: ${value}`);
          });
        });

        withResource(() => {
          withExternal(addDisposer => {
            logs.log(`Inner setup: ${value}`);
            addDisposer(() => {
              logs.log(`Inner cleanup: ${value}`);
            });
          });
        });
      });

      withWait(10);
      withExternal(() => trigger.set(1));

      withWait(10);
    }

    const app = launchRoutine(Test);
    await new Promise(resolve => setTimeout(resolve, 100));
    await app.exit();

    // Should see setup/cleanup for value 0, then setup for value 1, then final cleanup
    const result = logs.expectContains([
      'Outer setup: 0',
      'Inner setup: 0',
      'Inner cleanup: 0',
      'Outer cleanup: 0',
      'Outer setup: 1',
      'Inner setup: 1',
    ]);
    assert.strictEqual(result.passed, true, result.message);
  });
});
