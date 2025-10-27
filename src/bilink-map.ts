import { Releasable } from './releasable';

export class BiLinkMap<A, B, L extends Releasable> {
  private aToB = new Map<A, Map<B, L>>();
  private bToA = new Map<B, Map<A, L>>();

  getAs(): Iterable<A> {
    return this.aToB.keys();
  }

  getBs(): Iterable<B> {
    return this.bToA.keys();
  }

  link(a: A, b: B, link: L): void {
    (this.aToB.get(a) ?? this.aToB.set(a, new Map()).get(a)!).set(b, link);
    (this.bToA.get(b) ?? this.bToA.set(b, new Map()).get(b)!).set(a, link);
  }

  /** A と B のリンクを解除する */
  async unlink(a: A, b: B): Promise<void> {
    const link = this.aToB.get(a)?.get(b);
    if (!link) return;
    this.aToB.get(a)?.delete(b);
    this.bToA.get(b)?.delete(a);
    await link.release();
  }

  /** A に紐づく全てのリンクを解除する */
  async unlinkAllA(a: A): Promise<void> {
    const bs = this.aToB.get(a);
    if (!bs) return;

    // b側からも消しつつ、すべて並列に release
    await Promise.all(
      [...bs].map(async ([b, link]) => {
        this.bToA.get(b)?.delete(a);
        await link.release();
      })
    );

    this.aToB.delete(a);
  }

  /** B に紐づく全てのリンクを解除する */
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

  /** 全てのリンクを解除してクリアする */
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
