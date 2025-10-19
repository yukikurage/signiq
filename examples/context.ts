import {
  createContext,
  launchRoutine,
  withAtom,
  withExternal,
  withResource,
  withWait,
  Atom,
} from './src';

type GlobalCount = {
  globalCount: Atom<number>;
};

const globalCountContext = createContext<GlobalCount>();

function ContextExample(): void {
  withExternal(() => console.log('=== Context Example ==='));

  const count = withAtom<number>(0);

  // Provide context to child routines
  globalCountContext.withProvider({ globalCount: count }, () => {
    // Child process 1: Increment counter periodically
    withResource(() => {
      withExternal(addDisposer => {
        const intervalId = setInterval(() => {
          const current = count.peek() ?? 0;
          count.set(current + 1);
        }, 100);

        addDisposer(() => {
          clearInterval(intervalId);
        });
      });
    });

    // Child process 2: Display counter value
    withResource(() => {
      const context = globalCountContext.withContext();
      if (context) {
        const currentCount = context.globalCount();
        withExternal(() => {
          console.log('Global count:', currentCount);
        });
      }
    });
  });

  withWait(550);
}

// Run the example
const counterApp = launchRoutine(ContextExample);
await new Promise(resolve => setTimeout(resolve, 600));
await counterApp.exit();
console.log('\nTest completed!');
