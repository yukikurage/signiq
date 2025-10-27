import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Blueprint } from '../src/blueprint';
import { LogCapture } from './test-utils';

const logBlueprint = (logs: LogCapture, label: string) =>
  Blueprint.effect(() => {
    logs.log(`${label}`);
  });

describe('Blueprint basic functionality', () => {
  it('should create a pure blueprint and collect its value', async () => {
    const logs = new LogCapture();

    const blueprint = Blueprint.build(() => {
      const value = Blueprint.pure(42).use;
      logBlueprint(logs, `value: ${value}`).use;
    });

    const cluster = blueprint.launch();
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect(['value: 42']);
    assert.strictEqual(result.passed, true, result.message);

    await cluster.release();
  });

  it('should map values correctly', async () => {
    const logs = new LogCapture();

    const blueprint = Blueprint.build(() => {
      const value = Blueprint.pure(10).map(x => x * 2).use;
      logBlueprint(logs, `mapped: ${value}`).use;
    });

    const cluster = blueprint.launch();
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect(['mapped: 20']);
    assert.strictEqual(result.passed, true, result.message);

    await cluster.release();
  });

  it('should filter values correctly', async () => {
    const logs = new LogCapture();
    const blueprint = Blueprint.build(() => {
      const value = Blueprint.fromIterable([1, 2, 3, 4, 5]).filter(
        x => x % 2 === 0
      ).use;
      logBlueprint(logs, `filtered: ${value}`).use;
    });

    const cluster = blueprint.launch();
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect(['filtered: 2', 'filtered: 4']);
    assert.strictEqual(result.passed, true, result.message);

    await cluster.release();
  });

  it('should handle never blueprint', async () => {
    const logs = new LogCapture();

    const blueprint = Blueprint.build(() => {
      const value = Blueprint.never().use;
      logBlueprint(logs, `never: ${value}`).use;
    });

    const cluster = blueprint.launch();
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect([]);
    assert.strictEqual(result.passed, true, result.message);

    await cluster.release();
  });

  it('should support flatMap with inner blueprints', async () => {
    const logs = new LogCapture();

    const blueprint = Blueprint.build(() => {
      const x = Blueprint.fromIterable([1, 2]).use;
      const value = Blueprint.pure(x * 10).use;
      logBlueprint(logs, `flatMapped: ${value}`).use;
    });

    const cluster = blueprint.launch();
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect(['flatMapped: 10', 'flatMapped: 20']);
    assert.strictEqual(result.passed, true, result.message);

    await cluster.release();
  });

  describe('Blueprint channel functionality', () => {
    it('should create a channel and update values', async () => {
      const logs = new LogCapture();

      const blueprint = Blueprint.build(() => {
        const [valueCluster, setValue] = Blueprint.state(0).use;
        Blueprint.build(() => {
          const value = valueCluster.view().use;
          logBlueprint(logs, `value: ${JSON.stringify(value)}`).use;
        }).instantiate().use;

        Blueprint.wait(20).use;
        Blueprint.effect(async () => await setValue(5)).use;

        Blueprint.wait(20).use;
        Blueprint.effect(async () => await setValue(10)).use;
      });

      const cluster = blueprint.launch();

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

      await cluster.release();
    });

    it('should skip duplicate values in channel', async () => {
      const logs = new LogCapture();

      const blueprint = Blueprint.build(() => {
        const [valueInst, setValue] = Blueprint.state(1).use;
        Blueprint.build(() => {
          const value = valueInst.view().use;
          logBlueprint(logs, `value: ${value}`).use;
        }).instantiate().use;

        Blueprint.wait(20).use;
        Blueprint.effect(async () => await setValue(2)).use;

        Blueprint.wait(10).use;
        Blueprint.effect(async () => await setValue(2)).use; // 同じ値なのでスキップ

        Blueprint.wait(10).use;
        Blueprint.effect(async () => await setValue(3)).use;
      });

      const cluster = blueprint.launch();
      await new Promise(resolve => setTimeout(resolve, 60));

      const result = logs.expect(['value: 1', 'value: 2', 'value: 3']);
      assert.strictEqual(result.passed, true, result.message);

      await cluster.release();
    });
  });
});
