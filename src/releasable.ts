export interface Releasable {
  release(): Promise<void>;
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
