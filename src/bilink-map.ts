import { Routine, Effect } from './routine';

type RoutineState =
  | {
      state: 'initialized';
      finalize: () => MaybePromise<void>;
    }
  | {
      state: 'finalizing';
      promise: Promise<void>;
    };

export class BiLinkMap<A, B> {
  private aToB = new Map<A, Map<B, RoutineState>>();
  private bToA = new Map<B, Map<A, RoutineState>>();

  getAs(): Iterable<A> {
    return this.aToB.keys();
  }

  getBs(): Iterable<B> {
    return this.bToA.keys();
  }

  link(a: A, b: B, component: Routine<void>): void {
    const { finalize } = component.initialize();
    if (!this.aToB.has(a)) {
      this.aToB.set(a, new Map());
    }
    if (!this.bToA.has(b)) {
      this.bToA.set(b, new Map());
    }
    this.aToB.get(a)!.set(b, {
      state: 'initialized',
      finalize,
    });
    this.bToA.get(b)!.set(a, {
      state: 'initialized',
      finalize,
    });
  }

  /** Unlink A and B */
  unlink(a: A, b: B): MaybePromise<void> {
    const link = this.aToB.get(a)?.get(b);
    if (!link) return;
    if (link.state === 'finalizing') return link.promise;
    const maybePromise = link.finalize();
    if (maybePromise instanceof Promise) {
      const finalizePromise = maybePromise.then(() => {
        this.aToB.get(a)?.delete(b);
        this.bToA.get(b)?.delete(a);
      });
      const newLink = {
        state: 'finalizing' as const,
        promise: finalizePromise,
      };
      this.aToB.get(a)?.set(b, newLink);
      this.bToA.get(b)?.set(a, newLink);
      return finalizePromise;
    }
    this.aToB.get(a)?.delete(b);
    this.bToA.get(b)?.delete(a);
    return;
  }

  /** Link A to all B */
  linkAllA(a: A, component: (b: B) => Routine<void>): void {
    this.aToB.set(a, new Map());
    const bs = this.bToA.keys();
    [...bs].map(b => this.link(a, b, component(b)));
  }

  /** Link B to all A */
  linkAllB(b: B, component: (a: A) => Routine<void>): void {
    this.bToA.set(b, new Map());
    const as = this.aToB.keys();
    [...as].map(a => this.link(a, b, component(a)));
  }

  /** Unlink all links associated with A */
  unlinkAllA(a: A): MaybePromise<void> {
    const bs = this.bToA.keys();
    const promises = [...bs].map(b => this.unlink(a, b));
    if (promises.some(p => p instanceof Promise)) {
      return Promise.all(promises).then(() => {
        this.aToB.delete(a);
      });
    }
    this.aToB.delete(a);
  }

  /** Unlink all links associated with B */
  unlinkAllB(b: B): MaybePromise<void> {
    const as = this.aToB.keys();
    const promises = [...as].map(a => this.unlink(a, b));
    if (promises.some(p => p instanceof Promise)) {
      return Promise.all(promises).then(() => {
        this.bToA.delete(b);
      });
    }
    this.bToA.delete(b);
  }

  /** Unlink and clear all links */
  unlinkAll(): MaybePromise<void> {
    const as = this.aToB.keys();
    const promises = [...as].map(a => this.unlinkAllA(a));
    if (promises.some(p => p instanceof Promise)) {
      return Promise.all(promises).then(() => {});
    }
    return;
  }
}
