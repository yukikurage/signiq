import { Resource } from './resource';

export class BiLinkMap<A, B, L extends Resource> {
  private aToB = new Map<A, Map<B, L>>();
  private bToA = new Map<B, Map<A, L>>();

  getAs(): Iterable<A> {
    return this.aToB.keys();
  }

  getBs(): Iterable<B> {
    return this.bToA.keys();
  }

  async link(a: A, b: B, link: L): Promise<void> {
    // Release existing link if it exists to prevent memory leaks
    const existingLink = this.aToB.get(a)?.get(b);
    if (existingLink) {
      await existingLink.release();
    }

    (this.aToB.get(a) ?? this.aToB.set(a, new Map()).get(a)!).set(b, link);
    (this.bToA.get(b) ?? this.bToA.set(b, new Map()).get(b)!).set(a, link);
  }

  /** Unlink A and B */
  async unlink(a: A, b: B): Promise<void> {
    const link = this.aToB.get(a)?.get(b);
    if (!link) return;
    this.aToB.get(a)?.delete(b);
    this.bToA.get(b)?.delete(a);
    await link.release();
  }

  /** Unlink all links associated with A */
  async unlinkAllA(a: A): Promise<void> {
    const bs = this.aToB.get(a);
    if (!bs) return;

    // Delete from B side as well, and release all in parallel
    await Promise.all(
      [...bs].map(async ([b, link]) => {
        this.bToA.get(b)?.delete(a);
        await link.release();
      })
    );

    this.aToB.delete(a);
  }

  /** Unlink all links associated with B */
  async unlinkAllB(b: B): Promise<void> {
    const as = this.bToA.get(b);
    if (!as) return;

    await Promise.all(
      [...as].map(async ([a, link]) => {
        this.aToB.get(a)?.delete(b);
        await link.release();
      })
    );

    this.bToA.delete(b);
  }

  /** Unlink and clear all links */
  async unlinkAll(): Promise<void> {
    const allLinks: L[] = [];
    for (const [, inner] of this.aToB) {
      for (const [, link] of inner) allLinks.push(link);
    }
    this.aToB.clear();
    this.bToA.clear();
    await Promise.all(allLinks.map(l => l.release()));
  }

  clear(): void {
    this.aToB.clear();
    this.bToA.clear();
  }
}
