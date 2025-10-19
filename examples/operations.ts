import {
  withAtom,
  withResource,
  withExternal,
  withWait,
  launchRoutine,
} from './src';

// Test atom peek and set methods
function AtomMethodsTest(): void {
  withExternal(() => console.log('=== Atom Methods Test ==='));

  const counter = withAtom<number>(10);

  // Test peek (should not create dependency)
  withExternal(() => {
    console.log('Initial value (peek):', counter.peek());
  });

  // Test set method
  withExternal(() => {
    const current = counter.peek() ?? 0;
    counter.set(current * 2);
    console.log('After set (x2):', counter.peek());
  });

  withWait(10);

  withExternal(() => {
    const current = counter.peek() ?? 0;
    counter.set(current + 5);
    console.log('After set (+5):', counter.peek());
  });

  withWait(100);
}

// Test interval operation using withExternal
function IntervalTest(): void {
  withExternal(() => console.log('\n=== Interval Test ==='));

  let count = 0;
  withExternal(addDisposer => {
    const intervalId = setInterval(() => {
      console.log(`Interval callback ${++count}`);
    }, 100);

    addDisposer(() => {
      clearInterval(intervalId);
      console.log('Interval cleared');
    });
  });
}

// Test cleanup with withExternal
function CleanupTest(): void {
  withExternal(() => console.log('\n=== Cleanup Test ==='));

  withExternal(() => console.log('Starting cleanup test...'));

  withExternal(addDisposer => {
    console.log('Setting up resource...');
    addDisposer(async () => {
      console.log('Cleanup executed!');
    });
  });

  withExternal(() => console.log('Cleanup test main logic completed'));
}

// Test complex derived values operation
function ComplexDerivedTest(): void {
  withExternal(() => console.log('\n=== Complex Derived Test ==='));

  const x = withAtom<number>(2);
  const y = withAtom<number>(3);

  // Derive a value that depends on both atoms
  const sum = withResource(() => x() + y());
  const product = withResource(() => x() * y());

  // Combine multiple derived values
  const combined = withResource(() => {
    const sumValue = sum();
    const productValue = product();
    return `sum: ${sumValue}, product: ${productValue}`;
  });

  withResource(() => {
    const result = combined();
    withExternal(() => {
      console.log('Combined result:', result);
    });
  });

  withWait(100);
  withExternal(() => x.set(5));

  withWait(100);
  withExternal(() => y.set(7));

  withWait(100);
}

// Test nested resources
function NestedResourceTest(): void {
  withExternal(() => console.log('\n=== Nested Resource Test ==='));

  const trigger = withAtom<number>(0);
  const data = withAtom<string>('initial');

  withResource(() => {
    const triggerValue = trigger();
    withExternal(() => {
      console.log(`Outer resource triggered: ${triggerValue}`);
    });

    // Nested resource
    withResource(() => {
      const dataValue = data();
      withExternal(() => {
        console.log(`  Inner resource sees data: ${dataValue}`);
      });
    });
  });

  withWait(100);
  withExternal(() => trigger.set(1));

  withWait(100);
  withExternal(() => data.set('updated'));

  withWait(100);
  withExternal(() => trigger.set(2));

  withWait(100);
}

// Run all tests
(async () => {
  console.log('Starting comprehensive operation tests...\n');

  const tests = [
    { name: 'AtomMethodsTest', fn: AtomMethodsTest, delay: 200 },
    { name: 'IntervalTest', fn: IntervalTest, delay: 450 },
    { name: 'CleanupTest', fn: CleanupTest, delay: 200 },
    { name: 'ComplexDerivedTest', fn: ComplexDerivedTest, delay: 400 },
    { name: 'NestedResourceTest', fn: NestedResourceTest, delay: 500 },
  ];

  for (const test of tests) {
    const app = launchRoutine(test.fn);
    await new Promise(resolve => setTimeout(resolve, test.delay));
    await app.exit();
    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between tests
  }

  console.log('\nAll operation tests completed!');
})();
