import type { Releasable } from './releasable';

export class TaskQueue<Task> {
  private queue: Array<{
    task: Task;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
  }> = [];

  private running = false;
  private launched = false;
  private stopped = false;
  private handler: ((task: Task) => Promise<any>) | null = null;
  private runningPromise: Promise<void> | null = null;

  // タスクを登録
  public enqueue(task: Task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      if (this.launched) this.run();
    });
  }

  // 後からハンドラを設定して起動
  public launch(handler: (task: Task) => Promise<any>): Releasable {
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

  // TaskQueueを停止
  private async stop(): Promise<void> {
    this.stopped = true;
    this.launched = false;
    // 残りのタスクを全てrejectする
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      item.reject(new Error('TaskQueue stopped'));
    }
    // 実行中のタスクが完了するまで待機
    if (this.runningPromise) {
      await this.runningPromise;
    }
  }

  private async run() {
    if (this.running || !this.handler || this.stopped) return;
    this.running = true;

    // 実行中のプロミスを設定
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
    })();

    await this.runningPromise;
    this.running = false;
    this.runningPromise = null;
  }

  // キューに残っているタスクを取得
  public getRemainingTasks(): readonly Task[] {
    return this.queue.map(item => item.task);
  }
}
