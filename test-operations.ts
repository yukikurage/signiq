import {
  slot,
  observe,
  derive,
  wait,
  launch,
  clock,
  interval,
  until,
  checkpoint,
  defer,
  Routine,
} from './src';

// Test slot modify and peek methods
async function* slotMethodsTest(): Routine<void> {
  console.log('=== Slot Methods Test ===');

  const counter = yield* slot(10);

  // Test peek (should not create dependency)
  console.log('Initial value (peek):', counter.peek());

  // Test modify method
  counter.modify(x => x * 2);
  console.log('After modify (x2):', counter.peek());

  counter.modify(x => x + 5);
  console.log('After modify (+5):', counter.peek());

  yield* wait(100);
}

// Test clock operation
async function* clockTest(): Routine<void> {
  console.log('\n=== Clock Test ===');

  const cl = yield* clock(50); // Update every 50ms

  let count = 0;
  yield* observe(async function* () {
    const timestamp = yield* cl.get();
    console.log(`Clock tick ${++count}:`, new Date(timestamp).toISOString());
  });

  // Let it run for a bit
  yield* wait(250);
  console.log('Clock test completed');
}

// Test interval operation
async function* intervalTest(): Routine<void> {
  console.log('\n=== Interval Test ===');

  let intervalCount = 0;
  yield* interval(
    async function* (clockValue) {
      console.log(`Interval callback ${++intervalCount}, clock:`, clockValue);
      yield* checkpoint(); // Allow cancellation
    },
    100 // Every 100ms
  );

  // Let it run for a bit
  yield* wait(350);
  console.log('Interval test completed');
}

// Test until operation
async function* untilTest(): Routine<void> {
  console.log('\n=== Until Test ===');

  const progressSlot = yield* slot(0);

  // Start a process that will update the progress
  (async () => {
    for (let i = 1; i <= 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 80));
      progressSlot.set(i);
    }
  })();

  // Wait until progress reaches 3
  const result = yield* until(value => value >= 3, progressSlot);
  console.log('Until condition met with value:', result);

  yield* wait(100);
}

// Test defer operation
async function* deferTest(): Routine<void> {
  console.log('\n=== Defer Test ===');

  console.log('Starting defer test...');

  yield* defer(async () => {
    console.log('Deferred cleanup executed!');
  });

  yield* wait(100);
  console.log('Defer test main logic completed');
  // Cleanup should execute when this routine completes
}

// Test complex derive operation
async function* complexDeriveTest(): Routine<void> {
  console.log('\n=== Complex Derive Test ===');

  const x = yield* slot(2);
  const y = yield* slot(3);

  // Derive a value that depends on both slots
  const sum = yield* derive(async function* () {
    const xVal = yield* x.get();
    const yVal = yield* y.get();
    return xVal + yVal;
  });

  const product = yield* derive(async function* () {
    const xVal = yield* x.get();
    const yVal = yield* y.get();
    return xVal * yVal;
  });

  // Combine multiple derived values
  const combined = yield* derive(async function* () {
    const sumVal = yield* sum.get();
    const prodVal = yield* product.get();
    return `sum: ${sumVal}, product: ${prodVal}`;
  });

  yield* observe(async function* () {
    const result = yield* combined.get();
    console.log('Combined result:', result);
  });

  yield* wait(100);
  x.set(5);

  yield* wait(100);
  y.set(7);

  yield* wait(100);
}

// Test nested observers
async function* nestedObserverTest(): Routine<void> {
  console.log('\n=== Nested Observer Test ===');

  const trigger = yield* slot(0);
  const data = yield* slot('initial');

  yield* observe(async function* () {
    const triggerVal = yield* trigger.get();
    console.log(`Outer observer triggered: ${triggerVal}`);

    // Nested observer
    yield* observe(async function* () {
      const dataVal = yield* data.get();
      console.log(`  Inner observer sees data: ${dataVal}`);
    });
  });

  yield* wait(100);
  trigger.set(1);

  yield* wait(100);
  data.set('updated');

  yield* wait(100);
  trigger.set(2);

  yield* wait(100);
}

// Run all tests
(async () => {
  console.log('Starting comprehensive operation tests...\n');

  const tests = [
    slotMethodsTest,
    clockTest,
    intervalTest,
    untilTest,
    deferTest,
    complexDeriveTest,
    nestedObserverTest,
  ];

  for (const test of tests) {
    const app = await launch(test);
    await app.quit();
    await new Promise(resolve => setTimeout(resolve, 200)); // Small delay between tests
  }

  console.log('\n🎉 All operation tests completed!');
})();