import {
  launchRoutine,
  withAtom,
  withExternal,
  withResource,
  withWait,
} from './src';

// Simple counter example
function CounterExample(): void {
  withExternal(() => console.log('=== Counter Example ==='));

  // Create a reactive atom
  const counter = withAtom<number>(0);

  // Create an observer that logs the counter value
  withResource(() => {
    const currentCount = counter();
    withExternal(addDisposer => {
      console.log('Counter value (external):', currentCount);
      addDisposer(() => {
        console.log('Disposing external for counter:', currentCount);
      });
    });
  });

  // Update the counter value after 1 second
  withWait(100);
  withExternal(() => counter.set(1));

  withWait(100);
  withExternal(() => counter.set(2));

  withWait(100);
  withExternal(() => counter.set(3));

  withWait(100);
}

// Derived value example
function DerivedExample(): void {
  withExternal(() => console.log('\n=== Derived Value Example ==='));

  // Create a base atom
  const baseValue = withAtom<number>(5);

  // Create a derived value (computed atom)
  const doubledValue = withResource(() => baseValue() * 2);

  const plusTenValue = withResource(() => baseValue() + 10);

  // Observer for the doubled value
  withResource(() => {
    const base = baseValue();
    const doubled = doubledValue();
    const plusTen = plusTenValue();
    withExternal(addDisposer => {
      console.log(`Base: ${base}, Doubled: ${doubled}, Plus Ten: ${plusTen}`);
      addDisposer(() => {
        console.log('Disposing external for derived values');
      });
    });
  });

  // Update base value
  withWait(100);
  withExternal(() => baseValue.set(10));

  withWait(100);
  withExternal(() => baseValue.set(15));

  withWait(100);
  withExternal(() => baseValue.set(20));

  withWait(100);
}

// Run the examples
const counterApp = launchRoutine(CounterExample);
await new Promise(resolve => setTimeout(resolve, 500));
await counterApp.exit();

const derivedApp = launchRoutine(DerivedExample);
await new Promise(resolve => setTimeout(resolve, 500));
await derivedApp.exit();

console.log('\nTest completed!');
