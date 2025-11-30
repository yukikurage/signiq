import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LogCapture } from './test-utils';
import {
  useEffect,
  useTimeout,
  usePortal,
  toRoutine,
  useAtom,
  useDerivation,
  Atom,
  useFork,
  useConnection,
  createContext,
} from '../src';

const useLog = (logs: LogCapture, label: string, releaseLabel?: string): void =>
  useEffect(addRelease => {
    logs.log(`${label}`);
    if (releaseLabel) {
      addRelease(async () => {
        logs.log(`${releaseLabel}`);
      });
    }
  });

describe('Blueprint basic functionality', () => {
  it('should create a pure blueprint and collect its value', async () => {
    const logs = new LogCapture();

    const blueprint = (): void => {
      const value = 42;
      useLog(logs, `value: ${value}`);
    };

    const app = toRoutine(blueprint).initialize();
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = logs.expect(['value: 42']);
    assert.strictEqual(result.passed, true, result.message);

    await app.finalize();
  });

  describe('Blueprint useAtom functionality', () => {
    it('should create an atom and update values', async () => {
      const logs = new LogCapture();

      const blueprint = (): void => {
        const atom = useAtom<number>(0);

        useDerivation(atom, value => {
          useLog(logs, `value: ${value}`, `released: ${value}`);
        });

        useTimeout(20);
        useEffect(() => atom.set(5));

        useTimeout(20);
        useEffect(() => atom.set(10));
      };

      const app = toRoutine(blueprint).initialize();

      // 初期値
      await new Promise(resolve => setTimeout(resolve, 10));
      let result = logs.expect(['value: 0']);
      assert.strictEqual(result.passed, true, result.message);

      // 最初の更新
      await new Promise(resolve => setTimeout(resolve, 20));
      result = logs.expect(['value: 0', 'released: 0', 'value: 5']);
      assert.strictEqual(result.passed, true, result.message);

      // 2回目の更新
      await new Promise(resolve => setTimeout(resolve, 20));
      result = logs.expect([
        'value: 0',
        'released: 0',
        'value: 5',
        'released: 5',
        'value: 10',
      ]);
      assert.strictEqual(result.passed, true, result.message);

      await app.finalize();
    });

    it('should skip duplicate values', async () => {
      const logs = new LogCapture();

      const blueprint = (): void => {
        const atom = useAtom<number>(1);

        useDerivation(atom, value => {
          useLog(logs, `value: ${value}`);
        });

        useTimeout(10);
        useEffect(() => atom.set(2));
        useTimeout(10);

        useTimeout(10);
        useEffect(() => atom.set(3));
      };

      const app = toRoutine(blueprint).initialize();
      await new Promise(resolve => setTimeout(resolve, 60));

      const result = logs.expect(['value: 1', 'value: 2', 'value: 3']);
      assert.strictEqual(result.passed, true, result.message);

      await app.finalize();
    });

    it('should handle function updates', async () => {
      const logs = new LogCapture();

      const blueprint = (): void => {
        const atom = useAtom<number>(0);

        useDerivation(atom, value => {
          useLog(logs, `count: ${value}`);
        });

        useTimeout(10);
        useEffect(() => atom.modify(prev => prev + 1));

        useTimeout(10);
        useEffect(() => atom.modify(prev => prev * 2));
      };

      const app = toRoutine(blueprint).initialize();
      await new Promise(resolve => setTimeout(resolve, 40));

      const result = logs.expect(['count: 0', 'count: 1', 'count: 2']);
      assert.strictEqual(result.passed, true, result.message);

      await app.finalize();
    });

    it('should handle multiple observers independently', async () => {
      const logs = new LogCapture();

      const blueprint = (): void => {
        const atom = useAtom<number>(0);

        useDerivation(atom, value => {
          useLog(logs, `observer1: ${value}`, `release1: ${value}`);
        });

        useDerivation(atom, value => {
          useLog(logs, `observer2: ${value}`, `release2: ${value}`);
        });

        useTimeout(10);
        useEffect(() => atom.set(1));

        useTimeout(10);
        useEffect(() => atom.set(2));
      };

      const app = toRoutine(blueprint).initialize();
      await new Promise(resolve => setTimeout(resolve, 40));

      const result = logs.expect([
        'observer1: 0',
        'observer2: 0',
        'release1: 0',
        'release2: 0',
        'observer1: 1',
        'observer2: 1',
        'release1: 1',
        'release2: 1',
        'observer1: 2',
        'observer2: 2',
      ]);
      assert.strictEqual(result.passed, true, result.message);

      await app.finalize();
    });
  });

  describe('Blueprint usePortal functionality', () => {
    it('should create a portal and update values', async () => {
      const logs = new LogCapture();

      const blueprint = (): void => {
        const portal = usePortal();

        const refetchAtom = useAtom<number>(0);

        useDerivation(portal, value => {
          useLog(logs, `created: ${value}`, `released: ${value}`);
        });

        useDerivation(refetchAtom, refetch => {
          useConnection(portal, refetch);
        });

        useDerivation(refetchAtom, refetch => {
          useTimeout(10);
          useConnection(portal, refetch + 100);
        });

        useTimeout(20);
        useEffect(() => refetchAtom.set(5));

        useTimeout(20);
        useEffect(() => refetchAtom.set(10));
      };

      const app = toRoutine(blueprint).initialize();

      // Wait for all operations to complete
      await new Promise(resolve => setTimeout(resolve, 60));

      // CellRealm is synchronous, so updates happen immediately:
      // When setRefetch(5), first store sees 5 immediately and creates portal value
      // Then old values (0) are released
      // Then second store (with timeout) completes and creates portal value (105)
      // Then old value (100) is released
      const result = logs.expect([
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

      await app.finalize();
    });
  });

  describe('Blueprint cancellation functionality', () => {
    it('should be cancellable white executing', async () => {
      const logs = new LogCapture();

      const blueprint = (): void => {
        const cell1 = useAtom<number>(0);
        const cell2 = useAtom<number>(100);

        useDerivation(cell1, value1 => {
          useLog(logs, `value1: ${value1}`);
          useTimeout(20);
          // Depends 2nd state
          useDerivation(cell2, value2 => {
            useLog(logs, `value2: ${value2}`);
          });
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

      const app = toRoutine(blueprint).initialize();

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

      await app.finalize();
    });
  });

  describe('Blueprint context functionality', () => {
    it('should use context properly', async () => {
      const logs = new LogCapture();

      const counterCtx = createContext<Atom<number>>();

      const blueprint = (): void => {
        const cell = useAtom<number>(0);
        counterCtx.useProvider(cell);

        useDerivation(cell, value => {
          useLog(logs, `count: ${value}`);
        });

        useFork(() => {
          const counter = counterCtx.useConsumer();
          useTimeout(20);
          useEffect(() => counter.set(1));
          useTimeout(20);
          useEffect(() => counter.set(2));
        });

        useTimeout(60);
      };

      const app = toRoutine(blueprint).initialize();

      await new Promise(resolve => setTimeout(resolve, 100));
      const result = logs.expect(['count: 0', 'count: 1', 'count: 2']);
      assert.strictEqual(result.passed, true, result.message);

      await app.finalize();
    });
  });

  describe('Store resource management', () => {
    it('should be safe to call release() multiple times', async () => {
      const logs = new LogCapture();

      const blueprint = (): void => {
        useLog(logs, 'created');
      };

      const app = toRoutine(blueprint).initialize();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Call release multiple times - should be idempotent
      await app.finalize();
      await app.finalize();
      await app.finalize();

      const result = logs.expect(['created']);
      assert.strictEqual(result.passed, true, result.message);
    });
  });

  describe('Blueprint multiple cell dependencies', () => {
    it('should fire observer only once for two cell dependencies', async () => {
      const logs = new LogCapture();

      const blueprint = (): void => {
        const cell1 = useAtom<number>(1);
        const cell2 = useAtom<string>('a');

        useDerivation(cell1.combine(cell2), ([value1, value2]) => {
          useLog(logs, `value1: ${value1}, value2: ${value2}`);
        });

        useTimeout(10);
        useEffect(() => cell1.set(2));

        useTimeout(10);
        useEffect(() => cell2.set('b'));
      };

      const app = toRoutine(blueprint).initialize();
      await new Promise(resolve => setTimeout(resolve, 40));

      // Should only fire once for initial values, once for cell1 change, once for cell2 change
      const result = logs.expect([
        'value1: 1, value2: a',
        'value1: 2, value2: a',
        'value1: 2, value2: b',
      ]);
      assert.strictEqual(result.passed, true, result.message);

      await app.finalize();
    });
  });
});
