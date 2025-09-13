import { slot, observe, derive, wait, launch, Routine } from './src';

// Simple counter example
async function* counterExample(): Routine<void> {
  console.log('=== Counter Example ===');

  // Create a reactive slot with initial value 0
  const counter = yield* slot(0);

  // Create an observer that logs the counter value
  yield* observe(async function* () {
    const value = yield* counter.get();
    console.log('Counter value:', value);
  });

  // Update the counter value after 1 second
  yield* wait(100);
  counter.set(1);

  yield* wait(100);
  counter.set(2);

  yield* wait(100);
  counter.set(3);

  yield* wait(100);
}

// Derived value example
async function* derivedExample(): Routine<void> {
  console.log('\n=== Derived Value Example ===');

  // Create a base slot
  const baseValue = yield* slot(5);

  // Create a derived slot that doubles the base value
  const doubledValue = yield* derive(async function* () {
    const value = yield* baseValue.get();
    return value * 2;
  });

  // Observer for the doubled value
  yield* observe(async function* () {
    const value = yield* doubledValue.get();
    console.log('Doubled value:', value);
  });

  // Update base value
  yield* wait(100);
  baseValue.set(10);

  yield* wait(100);
  baseValue.set(15);

  yield* wait(100);
}

// Run the examples
(async () => {
  const counterApp = await launch(counterExample);
  counterApp.quit();

  const derivedApp = await launch(derivedExample);
  derivedApp.quit();

  console.log('\nTest completed!');
})();
