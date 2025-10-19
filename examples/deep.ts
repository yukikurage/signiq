import {
  launchRoutine,
  withAtom,
  withExternal,
  withResource,
  withWait,
} from './src';

// Note: deepSlot$ is not available in the new API.
// This test demonstrates a workaround using multiple atoms.

type NestedObject = {
  a: number;
  b: {
    c: string;
    d: boolean;
  };
  e: number[];
};

function DeepSlotExample(): void {
  withExternal(() => console.log('=== Deep Slot Example (Alternative) ==='));

  // Create separate atoms for each nested property
  const a = withAtom<number>(1);
  const c = withAtom<string>('hello');
  const d = withAtom<boolean>(true);
  const e = withAtom<number[]>([10, 20, 30]);

  // Observer that watches all values
  withResource(() => {
    const aValue = a();
    const cValue = c();
    const dValue = d();
    const eValue = e();

    const value = {
      a: aValue,
      b: {
        c: cValue,
        d: dValue,
      },
      e: eValue,
    };

    withExternal(() => {
      console.log('Deep slot value:', value);
    });
  });

  withWait(20);
  withExternal(() => a.set(2));

  withWait(20);
  withExternal(() => c.set('world'));

  withWait(20);
  withExternal(() => {
    const currentE = e.peek();
    if (currentE) {
      currentE[1] = currentE[1] + 5;
      e.set([...currentE]);
    }
  });

  withWait(20);
  withExternal(() => d.set(false));

  withWait(50);
}

// Run the example
const deepApp = launchRoutine(DeepSlotExample);
await new Promise(resolve => setTimeout(resolve, 200));
await deepApp.exit();
console.log('\nTest completed!');
