import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LogCapture } from './test-utils';
import {
  Blueprint,
  CellRealm,
  use,
  useEffect,
  useTimeout,
  useGuard,
  toStore,
  useStore,
  useCell,
  usePortal,
} from '../src';

const useLog = (logs: LogCapture, label: string, releaseLabel?: string) =>
  useEffect(addRelease => {
    logs.log(`${label}`);
    if (releaseLabel) {
      addRelease({
        release: async () => {
          logs.log(`${releaseLabel}`);
        },
      });
    }
  });

describe('Blueprint basic functionality', () => {
  it('should create a pure blueprint and collect its value', async () => {
    const logs = new LogCapture();

    const blueprint = () => {
      const value = 42;
      useLog(logs, `value: ${value}`);
    };

    const store = toStore(blueprint);
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect(['value: 42']);
    assert.strictEqual(result.passed, true, result.message);

    await store.release();
  });

  it('should filter values correctly', async () => {
    const logs = new LogCapture();

    const blueprint = () => {
      const value = Blueprint.useIterable([1, 2, 3, 4, 5]);
      useGuard(() => value % 2 === 0);
      useLog(logs, `filtered: ${value}`);
    };

    const store = toStore(blueprint);
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect(['filtered: 2', 'filtered: 4']);
    assert.strictEqual(result.passed, true, result.message);

    await store.release();
  });

  it('should handle never blueprint', async () => {
    const logs = new LogCapture();

    const blueprint = () => {
      const value = Blueprint.useNever();
      useLog(logs, `never: ${value}`);
    };

    const store = toStore(blueprint);
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect([]);
    assert.strictEqual(result.passed, true, result.message);

    await store.release();
  });

  describe('Blueprint useCell functionality', () => {
    it('should create a cell and update values', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const cell = useCell<number>(0);

        useStore(() => {
          const value = use(cell);
          useLog(logs, `value: ${value}`, `released: ${value}`);
        });

        useTimeout(20);
        useEffect(() => cell.set(5));

        useTimeout(20);
        useEffect(() => cell.set(10));
      };

      const store = toStore(blueprint);

      // 初期値
      await new Promise(resolve => setTimeout(resolve, 10));
      let result = logs.expect(['value: 0']);
      assert.strictEqual(result.passed, true, result.message);

      // 最初の更新
      await new Promise(resolve => setTimeout(resolve, 20));
      result = logs.expect(['value: 0', 'value: 5', 'released: 0']);
      assert.strictEqual(result.passed, true, result.message);

      // 2回目の更新
      await new Promise(resolve => setTimeout(resolve, 20));
      result = logs.expect([
        'value: 0',
        'value: 5',
        'released: 0',
        'value: 10',
        'released: 5',
      ]);
      assert.strictEqual(result.passed, true, result.message);

      await store.release();
    });

    it('should skip duplicate values', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const cell = useCell<number>(1);

        useStore(() => {
          useLog(logs, `value: ${use(cell)}`);
        });

        useTimeout(20);
        useEffect(() => cell.set(2));

        useTimeout(10);
        useEffect(() => cell.set(2));

        useTimeout(10);
        useEffect(() => cell.set(3));
      };

      const store = toStore(blueprint);
      await new Promise(resolve => setTimeout(resolve, 60));

      const result = logs.expect(['value: 1', 'value: 2', 'value: 3']);
      assert.strictEqual(result.passed, true, result.message);

      await store.release();
    });

    it('should handle function updates', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const cell = useCell<number>(0);

        useStore(() => {
          useLog(logs, `count: ${use(cell)}`);
        });

        useTimeout(10);
        useEffect(() => cell.modify(prev => prev + 1));

        useTimeout(10);
        useEffect(() => cell.modify(prev => prev * 2));
      };

      const store = toStore(blueprint);
      await new Promise(resolve => setTimeout(resolve, 40));

      const result = logs.expect(['count: 0', 'count: 1', 'count: 2']);
      assert.strictEqual(result.passed, true, result.message);

      await store.release();
    });

    it('should handle multiple observers independently', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const cell = useCell<number>(0);

        useStore(() => {
          const value = use(cell);
          useLog(logs, `observer1: ${value}`, `release1: ${value}`);
        });

        useStore(() => {
          const value = use(cell);
          useLog(logs, `observer2: ${value}`, `release2: ${value}`);
        });

        useTimeout(10);
        useEffect(() => cell.set(1));

        useTimeout(10);
        useEffect(() => cell.set(2));
      };

      const store = toStore(blueprint);
      await new Promise(resolve => setTimeout(resolve, 40));

      const result = logs.expect([
        'observer1: 0',
        'observer2: 0',
        'observer1: 1',
        'observer2: 1',
        'release1: 0',
        'release2: 0',
        'observer1: 2',
        'observer2: 2',
        'release1: 1',
        'release2: 1',
      ]);
      assert.strictEqual(result.passed, true, result.message);

      await store.release();
    });
  });

  describe('Blueprint usePortal functionality', () => {
    it('should create a portal and update values', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const [valueStore, useValuePortal] = usePortal();

        const refetchCell = Blueprint.useCell<number>(0);

        useStore(() => {
          const value = use(valueStore);
          useLog(logs, `created: ${value}`, `released: ${value}`);
        });

        useStore(() => {
          const refetch = use(refetchCell);
          useValuePortal(refetch);
        });

        useStore(() => {
          const refetch = use(refetchCell);
          useTimeout(10);
          useValuePortal(refetch + 100);
        });

        useTimeout(20);
        useEffect(() => refetchCell.set(5));

        useTimeout(20);
        useEffect(() => refetchCell.set(10));
      };

      const store = toStore(blueprint);

      // Wait for all operations to complete
      await new Promise(resolve => setTimeout(resolve, 60));

      // CellRealm is synchronous, so updates happen immediately:
      // When setRefetch(5), first store sees 5 immediately and creates portal value
      // Then old values (0) are released
      // Then second store (with timeout) completes and creates portal value (105)
      // Then old value (100) is released
      let result = logs.expect([
        'created: 0',
        'created: 100',
        'created: 5',
        'released: 0',
        'released: 100',
        'created: 105',
        'created: 10',
        'released: 5',
        'released: 105',
        'created: 110',
      ]);
      assert.strictEqual(result.passed, true, result.message);

      await store.release();
    });
  });

  describe('Blueprint cancellation functionality', () => {
    it('should be cancellable white executing', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const cell1 = useCell<number>(0);
        const cell2 = useCell<number>(100);

        useStore(() => {
          // Depends 1st state
          const value1 = use(cell1);
          useLog(logs, `value1: ${value1}`);
          useTimeout(20);
          // Depends 2nd state
          const value2 = use(cell2);
          useLog(logs, `value2: ${value2}`);
        });

        useTimeout(50);
        // -> "value1: 0", "value2: 100"
        useEffect(() => cell1.set(1));
        useTimeout(10);
        useEffect(() => cell1.set(2));
        useTimeout(30);
        // cancel before "value2: 100" is logged
        // -> "value1: 1", "value1: 2", "value2: 100"
        useEffect(() => cell2.set(200));
        useTimeout(10);
        // Resume from `Blueprint.use(cell2)`  (no value1 logs)
        // -> "value2: 200"
      };

      const store = toStore(blueprint);

      // 2回目の更新
      await new Promise(resolve => setTimeout(resolve, 100));
      const result = logs.expect([
        'value1: 0',
        'value2: 100',
        'value1: 1',
        'value1: 2',
        'value2: 100',
        'value2: 200',
      ]);
      assert.strictEqual(result.passed, true, result.message);

      await store.release();
    });
  });

  describe('Blueprint context functionality', () => {
    it('should use context properly', async () => {
      const logs = new LogCapture();

      const counterCtx = Blueprint.createContext<CellRealm<number>>();

      const blueprint = () => {
        const cell = useCell<number>(0);
        counterCtx.useProvider(cell);

        useStore(() => {
          const counter = counterCtx.useConsumer();
          useLog(logs, `count: ${use(counter)}`);
        });

        useStore(() => {
          const counter = counterCtx.useConsumer();
          useTimeout(20);
          useEffect(() => counter.set(1));
          useTimeout(20);
          useEffect(() => counter.set(2));
        });

        useTimeout(60);
      };

      const store = toStore(blueprint);

      await new Promise(resolve => setTimeout(resolve, 100));
      const result = logs.expect(['count: 0', 'count: 1', 'count: 2']);
      assert.strictEqual(result.passed, true, result.message);

      await store.release();
    });
  });

  describe('Store resource management', () => {
    it('should be safe to call release() multiple times', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        useLog(logs, 'created');
      };

      const store = toStore(blueprint);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Call release multiple times - should be idempotent
      await store.release();
      await store.release();
      await store.release();

      const result = logs.expect(['created']);
      assert.strictEqual(result.passed, true, result.message);
    });
  });

  describe('Blueprint multiple cell dependencies', () => {
    it('should fire observer only once for two cell dependencies', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const cell1 = useCell<number>(1);
        const cell2 = useCell<string>('a');

        useStore(() => {
          const value1 = use(cell1);
          const value2 = use(cell2);
          useLog(logs, `value1: ${value1}, value2: ${value2}`);
        });

        useTimeout(10);
        useEffect(() => cell1.set(2));

        useTimeout(10);
        useEffect(() => cell2.set('b'));
      };

      const store = toStore(blueprint);
      await new Promise(resolve => setTimeout(resolve, 40));

      // Should only fire once for initial values, once for cell1 change, once for cell2 change
      const result = logs.expect([
        'value1: 1, value2: a',
        'value1: 2, value2: a',
        'value1: 2, value2: b',
      ]);
      assert.strictEqual(result.passed, true, result.message);

      await store.release();
    });
  });

  describe('Blueprint useTransition functionality', () => {
    it('should avoid glitch with single persisted cell', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const cell = useCell<number>(1);

        const [valueRealm, isTransitioningRealm] =
          Blueprint.useTransition(cell);

        useStore(() => {
          const value = use(valueRealm);
          const isTransitioning = use(isTransitioningRealm);
          useLog(
            logs,
            `value: ${value}, transitioning: ${isTransitioning}`,
            `released: ${value}, transitioning: ${isTransitioning}`
          );
        });

        useTimeout(10);
        useEffect(() => cell.set(2));

        useTimeout(10);
        useEffect(() => cell.set(3));
      };

      const store = toStore(blueprint);
      await new Promise(resolve => setTimeout(resolve, 50));

      const actualLogs = logs.getLogs();

      // With single persisted cell, should not have duplicate updates
      // Initial: null, true -> 1, false
      // Update to 2: 2, false
      // Update to 3: 3, false
      const result = logs.expect([
        'value: null, transitioning: true',
        'value: 1, transitioning: false',
        'released: null, transitioning: true',
        'value: 2, transitioning: false',
        'released: 1, transitioning: false',
        'value: 3, transitioning: false',
        'released: 2, transitioning: false',
      ]);
      assert.strictEqual(result.passed, true, result.message);

      await store.release();
    });

    it('should track value changes independently from source realm', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const cell = useCell<number>(0);

        const [valueRealm, isTransitioningRealm] =
          Blueprint.useTransition(cell);

        // Observer that logs both value and transitioning state
        useStore(() => {
          const value = use(valueRealm);
          const isTransitioning = use(isTransitioningRealm);
          useLog(logs, `value: ${value}, transitioning: ${isTransitioning}`);
        });

        // Change cell values
        useTimeout(10);
        useEffect(() => cell.set(1));

        useTimeout(10);
        useEffect(() => cell.set(2));
      };

      const store = toStore(blueprint);
      await new Promise(resolve => setTimeout(resolve, 40));

      const actualLogs = logs.getLogs();

      // Verify we get value updates
      const hasValue0 = actualLogs.some(log => log.includes('value: 0'));
      const hasValue1 = actualLogs.some(log => log.includes('value: 1'));
      const hasValue2 = actualLogs.some(log => log.includes('value: 2'));

      assert.strictEqual(hasValue0, true, 'Should have value: 0');
      assert.strictEqual(hasValue1, true, 'Should have value: 1');
      assert.strictEqual(hasValue2, true, 'Should have value: 2');

      await store.release();
    });
  });
});
