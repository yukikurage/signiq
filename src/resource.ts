export interface Resource {
  release(): Promise<void>;
}

export class BasicResource implements Resource {
  constructor(private onRelease: () => Promise<void>) {}

  public async release(): Promise<void> {
    await this.onRelease();
  }
}

export class CompositeResource implements Resource {
  private resources: Resource[] = [];

  public add(resource: Resource): void {
    this.resources.push(resource);
  }

  public async release(): Promise<void> {
    for (const r of [...this.resources].reverse()) {
      await r.release();
    }
    this.resources = [];
  }
}

export namespace Resource {
  export function parallel(set: Iterable<Resource>): Resource {
    return {
      release: async () => {
        await Promise.allSettled([...set].map(r => r.release()));
      },
    };
  }

  export function sequential(set: Iterable<Resource>): Resource {
    return {
      release: async () => {
        for (const r of [...set]) {
          await r.release();
        }
      },
    };
  }

  export const noop: Resource = { release: async () => {} };
}
