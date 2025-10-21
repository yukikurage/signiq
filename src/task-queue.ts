export class TaskQueue<Task> {
  private queue: Array<{
    task: Task;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
  }> = [];

  private running = false;
  private launched = false;
  private handler: ((task: Task) => Promise<any>) | null = null;

  // タスクを登録
  public enqueue(task: Task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      if (this.launched) this.run();
    });
  }

  // 後からハンドラを設定して起動
  public launch(handler: (task: Task) => Promise<any>) {
    this.handler = handler;
    this.launched = true;
    this.run();
  }

  private async run() {
    if (this.running || !this.handler) return;
    this.running = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      const { task, resolve, reject } = item;
      try {
        const result = await this.handler(task);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }
    this.running = false;
  }

  // キューに残っているタスクを取得
  public getRemainingTasks(): readonly Task[] {
    return this.queue.map((item) => item.task);
  }
}
