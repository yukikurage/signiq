import { BiLinkMap } from './bilink-map';
import { Routine, Effect } from './routine';
import { Structural } from './structural';

export abstract class Source<T> {
  public abstract subscribe: (
    listener: (val: T) => Routine<void>
  ) => Routine<void>;

  public map = <U>(fn: (val: T) => U): Source<U> => {
    const source = this;
    return new (class extends Source<U> {
      public subscribe = (listener: (val: U) => Routine<void>) =>
        source.subscribe(val => listener(fn(val)));
    })();
  };

  public merge = (other: Source<T>): Source<T> => {
    const source = this;
    const otherSource = other;
    return new (class extends Source<T> {
      public subscribe = (listener: (val: T) => Routine<void>) =>
        Routine.all([
          source.subscribe(listener),
          otherSource.subscribe(listener),
        ]).map(() => {});
    })();
  };

  public flatMap = <U>(fn: (val: T) => Source<U>): Source<U> => {
    const source = this;
    return new (class extends Source<U> {
      public subscribe = (listener: (val: U) => Routine<void>) =>
        source.subscribe(val => fn(val).subscribe(listener));
    })();
  };

  public combine = <U>(other: Source<U>): Source<[T, U]> => {
    const source = this;
    const otherSource = other;
    return source.flatMap(val => otherSource.map(otherVal => [val, otherVal]));
  };

  public static combineAll = <U extends unknown[]>(
    ...sources: {
      [K in keyof U]: Source<U[K]>;
    }
  ): Source<U> => {
    if (sources.length === 0) {
      return new (class extends Source<U> {
        public subscribe = (listener: (val: U) => Routine<void>) =>
          listener([] as unknown as U);
      })();
    }

    return new (class extends Source<U> {
      public subscribe = (listener: (val: U) => Routine<void>) => {
        const chain = (index: number, collected: unknown[]): Routine<void> => {
          if (index === sources.length) {
            return listener(collected as U);
          }
          return sources[index]!.subscribe(val =>
            chain(index + 1, [...collected, val])
          );
        };
        return chain(0, []);
      };
    })();
  };

  public filter = (predicate: (val: T) => boolean): Source<T> => {
    const source = this;
    return new (class extends Source<T> {
      public subscribe = (listener: (val: T) => Routine<void>) =>
        source.subscribe(val =>
          predicate(val) ? listener(val) : Routine.resolve(undefined)
        );
    })();
  };

  public derive = <U>(fn: (val: T) => Routine<U>): Routine<Source<U>> => {
    const source = this;
    return new Effect(addFinalizeFn => {
      const portal = new Portal<U>();
      addFinalizeFn(() => portal.finalize());
      return portal;
    }).then(portal =>
      source.subscribe(val => fn(val).then(portal.connect)).map(() => portal)
    );
  };
}

export class Atom<T extends Structural> extends Source<T> {
  private biLinks: BiLinkMap<{ value: T }, (value: T) => Routine<void>>;
  private currentValue: { value: T };

  constructor(value: T) {
    super();
    this.currentValue = { value };
    this.biLinks = new BiLinkMap();
    this.biLinks.linkAllA(this.currentValue, valToRoutine =>
      valToRoutine(value)
    );
  }

  public subscribe = (listener: (value: T) => Routine<void>): Routine<void> => {
    const source = this;
    return new Effect(addFinalizeFn => {
      source.biLinks.linkAllB(listener, val => listener(val.value));
      addFinalizeFn(() => {
        return source.biLinks.unlinkAllB(listener);
      });
    });
  };

  public modify = (modifier: (prevValue: T) => T): void => {
    const newValue = modifier(this.currentValue.value);
    if (newValue === this.currentValue.value) {
      return;
    }
    this.biLinks.unlinkAllA(this.currentValue);
    this.currentValue = { value: newValue };
    this.biLinks.linkAllA(this.currentValue, valToRoutine =>
      valToRoutine(newValue)
    );
  };

  public set = (newValue: T): void => {
    this.modify(() => newValue);
  };

  public finalize = (): MaybePromise<void> => {
    return this.biLinks.unlinkAllA(this.currentValue);
  };
}

export class Portal<T> extends Source<T> {
  private biLinks: BiLinkMap<{ value: T }, (value: T) => Routine<void>>;

  constructor() {
    super();
    this.biLinks = new BiLinkMap();
  }

  public subscribe = (callback: (val: T) => Routine<void>): Routine<void> => {
    const source = this;
    return new Effect(addFinalizeFn => {
      source.biLinks.linkAllB(callback, val => callback(val.value));
      addFinalizeFn(() => {
        return source.biLinks.unlinkAllB(callback);
      });
    });
  };

  public connect = (value: T): Routine<void> => {
    const source = this;
    const valueRef = { value };
    return new Effect(addFinalizeFn => {
      addFinalizeFn(() => {
        return source.biLinks.unlinkAllA(valueRef);
      });
      source.biLinks.linkAllA(valueRef, valToRoutine => valToRoutine(value));
    });
  };

  public finalize = (): MaybePromise<void> => {
    return this.biLinks.unlinkAll();
  };
}
