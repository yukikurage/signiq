export interface Releasable {
  release(): Promise<void>;
}

export class CompositeReleasable implements Releasable {
  private releasables: Releasable[] = [];

  public add(releasable: Releasable): void {
    this.releasables.push(releasable);
  }

  public async release(): Promise<void> {
    for (const r of [...this.releasables].reverse()) {
      await r.release();
    }
    this.releasables = [];
  }
}

export namespace Releasable {
  export function parallel(set: Iterable<Releasable>): Releasable {
    return {
      release: async () => {
        await Promise.allSettled([...set].map(r => r.release()));
      },
    };
  }
  export function sequential(set: Iterable<Releasable>): Releasable {
    return {
      release: async () => {
        for (const r of [...set]) {
          await r.release();
        }
      },
    };
  }
  export const noop: Releasable = { release: async () => {} };
}
