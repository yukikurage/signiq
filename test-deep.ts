import {
  context,
  interval$,
  launch,
  observe$,
  ReadonlySlot,
  Routine,
  slot$,
  Slot,
  wait$,
  deepSlot$,
} from './src';

type NestedObject = {
  a: number;
  b: {
    c: string;
    d: boolean;
  };
  e: number[];
};

async function* deepSlotExample(): Routine<void> {
  console.log('=== Deep Slot$ Example ===');

  const deep$ = yield* deepSlot$<NestedObject>({
    a: 1,
    b: { c: 'hello', d: true },
    e: [10, 20, 30],
  });

  yield* observe$(async function* () {
    const value = {
      a: yield* deep$.a(),
      b: {
        c: yield* deep$.b.c(),
        d: yield* deep$.b.d(),
      },
      e: [
        yield* (yield* deep$.e())[0](),
        yield* (yield* deep$.e())[1](),
        yield* (yield* deep$.e())[2](),
      ],
    };
    console.log('Deep slot value:', value);
  });

  yield* wait$(20);
  deep$.a.modify(x => x + 1);

  yield* wait$(20);
  deep$.b.c.set('world');

  yield* wait$(20);
  deep$.e.peek()[1].modify(x => x + 5);

  yield* wait$(20);
  deep$.b.d.set(false);

  yield* wait$(50);
}

// Run the examples
(async () => {
  const deepApp = launch(deepSlotExample);
  await deepApp.ready;
  await deepApp.quit();
  console.log('\nTest completed!');
})();
