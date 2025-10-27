import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LogCapture } from './test-utils';
import { Quon } from '../src';

const useLog = (logs: LogCapture, label: string) =>
  Quon.useEffect(() => {
    logs.log(`${label}`);
  });

describe('Blueprint basic functionality', () => {
  it('should create a pure blueprint and collect its value', async () => {
    const logs = new LogCapture();

    const blueprint = () => {
      const value = 42;
      useLog(logs, `value: ${value}`);
    };

    const store = Quon.instantiate(blueprint);
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect(['value: 42']);
    assert.strictEqual(result.passed, true, result.message);

    await store.release();
  });

  it('should filter values correctly', async () => {
    const logs = new LogCapture();

    const blueprint = () => {
      const value = Quon.useIterable([1, 2, 3, 4, 5]);
      Quon.useGuard(() => value % 2 === 0);
      useLog(logs, `filtered: ${value}`);
    };

    const store = Quon.instantiate(blueprint);
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect(['filtered: 2', 'filtered: 4']);
    assert.strictEqual(result.passed, true, result.message);

    await store.release();
  });

  it('should handle never blueprint', async () => {
    const logs = new LogCapture();

    const blueprint = () => {
      const value = Quon.useNever();
      useLog(logs, `never: ${value}`);
    };

    const store = Quon.instantiate(blueprint);
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect([]);
    assert.strictEqual(result.passed, true, result.message);

    await store.release();
  });

  describe('Blueprint channel functionality', () => {
    it('should create a channel and update values', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const [valueStore, setValue] = Quon.useState(0);
        Quon.instantiate(() => {
          useLog(logs, `value: ${valueStore.use()}`);
        });

        Quon.useTimeout(20);
        Quon.useEffect(async () => await setValue(5));

        Quon.useTimeout(20);
        Quon.useEffect(async () => await setValue(10));
      };

      const store = Quon.instantiate(blueprint);

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

    it('should skip duplicate values in channel', async () => {
      const logs = new LogCapture();

      const blueprint = () => {
        const [valueStore, setValue] = Quon.useState(1);

        Quon.instantiate(() => {
          useLog(logs, `value: ${valueStore.use()}`);
        });

        Quon.useTimeout(20);
        Quon.useEffect(async () => await setValue(2));

        Quon.useTimeout(10);
        Quon.useEffect(async () => await setValue(2));

        Quon.useTimeout(10);
        Quon.useEffect(async () => await setValue(3));
      };

      const store = Quon.instantiate(blueprint);
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
        const [value1Store, setValue1] = Quon.useState(0);
        const [value2Store, setValue2] = Quon.useState(100);

        Quon.instantiate(() => {
          // Depends 1st state
          useLog(logs, `value1: ${value1Store.use()}`);
          Quon.useTimeout(20);
          // Depends 2nd state
          useLog(logs, `value2: ${value2Store.use()}`);
        });

        Quon.useTimeout(30);
        // -> "value1: 0", "value2: 100"

        Quon.useEffect(async () => await setValue1(1));
        Quon.useTimeout(10);
        Quon.useEffect(async () => await setValue1(2));
        Quon.useTimeout(30);
        // cancel before "value2: 100" is logged
        // -> "value1: 1", "value1: 2", "value2: 100"

        Quon.useEffect(async () => await setValue2(200));
        Quon.useTimeout(10);
        // Resume from `value2Store.use()`  (no value1 logs)
        // -> "value2: 200"
      };

      const store = Quon.instantiate(blueprint);

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
});
