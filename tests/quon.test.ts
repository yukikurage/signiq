import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LogCapture } from './test-utils';
import { Store } from '../src';
import { Blueprint } from '../src/observable';

const useLog = (logs: LogCapture, label: string, releaseLabel?: string) =>
  Blueprint.useEffect(addRelease => {
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

    const store = Store.fromBlueprint(blueprint);
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect(['value: 42']);
    assert.strictEqual(result.passed, true, result.message);

    await store.release();
  });

  it('should filter values correctly', async () => {
    const logs = new LogCapture();

    const blueprint = () => {
      const value = Blueprint.useIterable([1, 2, 3, 4, 5]);
      Blueprint.useGuard(() => value % 2 === 0);
      useLog(logs, `filtered: ${value}`);
    };

    const store = Store.fromBlueprint(blueprint);
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

    const store = Store.fromBlueprint(blueprint);
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect([]);
    assert.strictEqual(result.passed, true, result.message);

    await store.release();
  });

  describe('Blueprint channel functionality', () => {
    it('should create a channel and update values', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const [valueStore, setValue] = Store.useState(0);
        Store.useBlueprint(() => {
          useLog(logs, `value: ${valueStore.use()}`);
        });

        Blueprint.useTimeout(20);
        Blueprint.useEffect(async () => await setValue(5));

        Blueprint.useTimeout(20);
        Blueprint.useEffect(async () => await setValue(10));
      };

      const store = Store.fromBlueprint(blueprint);

      // 初期値
      await new Promise(resolve => setTimeout(resolve, 10));
      let result = logs.expect(['value: 0']);
      assert.strictEqual(result.passed, true, result.message);

      // 最初の更新
      await new Promise(resolve => setTimeout(resolve, 20));
      result = logs.expect(['value: 0', 'value: 5']);
      assert.strictEqual(result.passed, true, result.message);

      // 2回目の更新
      await new Promise(resolve => setTimeout(resolve, 20));
      result = logs.expect(['value: 0', 'value: 5', 'value: 10']);
      assert.strictEqual(result.passed, true, result.message);

      await store.release();
    });

    it('should create a portal and update values', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const [valueStore, useValuePortal] = Store.usePortal();

        const [refetchStore, setRefetch] = Store.useState<number>(0);

        Store.useBlueprint(() => {
          const value = valueStore.use();
          useLog(logs, `created: ${value}`, `released: ${value}`);
        });

        Store.useBlueprint(() => {
          const refetch = refetchStore.use();
          useValuePortal(refetch);
        });

        Store.useBlueprint(() => {
          const refetch = refetchStore.use();
          Blueprint.useTimeout(10);
          useValuePortal(refetch + 100);
        });

        Blueprint.useTimeout(20);
        Blueprint.useEffect(async () => await setRefetch(5));

        Blueprint.useTimeout(20);
        Blueprint.useEffect(async () => await setRefetch(10));
      };

      const store = Store.fromBlueprint(blueprint);

      // 初期値
      await new Promise(resolve => setTimeout(resolve, 60));
      let result = logs.expect([
        'created: 0',
        'created: 100',
        'released: 0',
        'released: 100',
        'created: 5',
        'created: 105',
        'released: 5',
        'released: 105',
        'created: 10',
        'created: 110',
      ]);
      assert.strictEqual(result.passed, true, result.message);

      await store.release();
    });

    it('should skip duplicate values in channel', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const [valueStore, setValue] = Store.useState(1);

        Store.useBlueprint(() => {
          useLog(logs, `value: ${valueStore.use()}`);
        });

        Blueprint.useTimeout(20);
        Blueprint.useEffect(async () => await setValue(2));

        Blueprint.useTimeout(10);
        Blueprint.useEffect(async () => await setValue(2));

        Blueprint.useTimeout(10);
        Blueprint.useEffect(async () => await setValue(3));
      };

      const store = Store.fromBlueprint(blueprint);
      await new Promise(resolve => setTimeout(resolve, 60));

      const result = logs.expect(['value: 1', 'value: 2', 'value: 3']);
      assert.strictEqual(result.passed, true, result.message);

      await store.release();
    });
  });

  describe('Blueprint cancellation functionality', () => {
    it('should be cancellable white executing', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const [value1Store, setValue1] = Store.useState(0);
        const [value2Store, setValue2] = Store.useState(100);

        Store.useBlueprint(() => {
          // Depends 1st state
          useLog(logs, `value1: ${value1Store.use()}`);
          Blueprint.useTimeout(20);
          // Depends 2nd state
          useLog(logs, `value2: ${value2Store.use()}`);
        });

        Blueprint.useTimeout(30);
        // -> "value1: 0", "value2: 100"

        Blueprint.useEffect(async () => await setValue1(1));
        Blueprint.useTimeout(10);
        Blueprint.useEffect(async () => await setValue1(2));
        Blueprint.useTimeout(30);
        // cancel before "value2: 100" is logged
        // -> "value1: 1", "value1: 2", "value2: 100"

        Blueprint.useEffect(async () => await setValue2(200));
        Blueprint.useTimeout(10);
        // Resume from `value2Store.use()`  (no value1 logs)
        // -> "value2: 200"
      };

      const store = Store.fromBlueprint(blueprint);

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

      const counterCtx = Blueprint.createContext<{
        count: Store<number>;
        setCount: (value: number) => Promise<void>;
      }>();

      const blueprint = () => {
        const [count, setCount] = Store.useState(0);
        counterCtx.useProvider({ count, setCount });

        Store.useBlueprint(() => {
          const counter = counterCtx.useConsumer();
          useLog(logs, `count: ${counter.count.use()}`);
        });

        Store.useBlueprint(() => {
          const counter = counterCtx.useConsumer();
          Blueprint.useTimeout(20);
          Blueprint.useEffect(async () => await counter.setCount(1));
          Blueprint.useTimeout(20);
          Blueprint.useEffect(async () => await counter.setCount(2));
        });

        Blueprint.useTimeout(60);
      };

      const store = Store.fromBlueprint(blueprint);

      await new Promise(resolve => setTimeout(resolve, 100));
      const result = logs.expect(['count: 0', 'count: 1', 'count: 2']);
      assert.strictEqual(result.passed, true, result.message);

      await store.release();
    });
  });
});
