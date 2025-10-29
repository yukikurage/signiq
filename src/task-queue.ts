import type { Releasable } from './releasable';

export class TaskQueue<Task, Result = void> {
  private queue: Array<{
    task: Task;
    resolve: (value: Result) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  private running = false;
  private launched = false;
  private stopped = false;
  private handler: ((task: Task) => Promise<Result>) | null = null;
  private runningPromise: Promise<void> | null = null;

  // Register a task
  public enqueue(task: Task): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      // Check if stopped before enqueueing to prevent hanging promises
      if (this.stopped) {
        reject(new Error('TaskQueue is stopped'));
        return;
      }
      this.queue.push({ task, resolve, reject });
      if (this.launched) this.run();
    });
  }

  // Set handler later and launch
  public launch(handler: (task: Task) => Promise<Result>): Releasable {
    this.handler = handler;
    this.launched = true;
    this.stopped = false;
    this.run();
    return {
      release: async () => {
        await this.stop();
      },
    };
  }

  // Stop the TaskQueue
  private async stop(): Promise<void> {
    this.stopped = true;
    this.launched = false;
    // Reject all remaining tasks
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      item.reject(new Error('TaskQueue stopped'));
    }
    // Wait until the running task completes
    if (this.runningPromise) {
      await this.runningPromise;
    }
  }

  private run() {
    if (this.running || !this.handler || this.stopped) return;
    this.running = true;

    // Set the running promise
    this.runningPromise = (async () => {
      while (this.queue.length > 0 && !this.stopped) {
        const item = this.queue.shift()!;
        const { task, resolve, reject } = item;
        try {
          const result = await this.handler!(task);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      }
      this.running = false;
      this.runningPromise = null;

      // Check if new tasks were added during processing
      if (this.queue.length > 0 && !this.stopped) {
        this.run();
      }
    })();
  }

  // Get tasks remaining in the queue
  public getRemainingTasks(): readonly Task[] {
    return this.queue.map(item => item.task);
  }
}
