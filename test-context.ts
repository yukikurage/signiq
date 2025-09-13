import {
  context,
  interval,
  launch,
  observe,
  ReadonlySlot,
  Routine,
  slot,
  Slot,
  wait,
} from './src';

type GlobalCount = {
  globalCount: Slot<number>;
};

const globalCountContext = context<GlobalCount>();

async function* contextExample(): Routine<void> {
  const count = yield* slot(0);
  yield* globalCountContext.provide({ globalCount: count });

  // Child process 1
  yield* interval(childProcess, 100);

  // Child process 2
  yield* observe(displayProcess);

  yield* wait(550);
}

// Child process 1
async function* childProcess(): Routine<void> {
  const { globalCount } = yield* globalCountContext.use();
  globalCount.modify(v => v + 1);
}

// Child process 2
async function* displayProcess(): Routine<void> {
  const { globalCount } = yield* globalCountContext.use();
  yield* observe(async function* () {
    console.log('Global count:', yield* globalCount.get());
  });
}

// Run the example

// Run the examples
(async () => {
  const counterApp = await launch(contextExample);
  counterApp.quit();
  console.log('\nTest completed!');
})();
