import { BiLinkMap } from './bilink-map';
import { Routine, Effect } from './routine';
import { Structural } from './structural';
import { MaybePromise } from './util';

export abstract class Source<T> {
  public abstract subscribe: (
    listener: (val: T) => Routine<void>
  ) => Routine<void>;

  public map = <U>(fn: (val: T) => U): Source<U> => {
    return new BasicSource<U>(listener =>
      this.subscribe(val => listener(fn(val)))
    );
  };

  public merge = (other: Source<T>): Source<T> => {
    return new BasicSource<T>(listener =>
      Routine.all([this.subscribe(listener), other.subscribe(listener)]).map(
        () => {}
      )
    );
  };

  public flatMap = <U>(fn: (val: T) => Source<U>): Source<U> => {
    return new BasicSource<U>(listener =>
      this.subscribe(val => fn(val).subscribe(listener))
    );
  };

  public combine = <U>(other: Source<U>): Source<[T, U]> => {
    return this.flatMap(val => other.map(otherVal => [val, otherVal]));
  };

  public static combineAll = <U extends unknown[]>(
    ...sources: {
      [K in keyof U]: Source<U[K]>;
    }
  ): Source<U> => {
    if (sources.length === 0) {
      return new BasicSource<U>(listener => listener([] as unknown as U));
    }

    return new BasicSource<U>(listener => {
      const chain = (index: number, collected: unknown[]): Routine<void> => {
        if (index === sources.length) {
          return listener(collected as U);
        }
        return sources[index]!.subscribe(val =>
          chain(index + 1, [...collected, val])
        );
      };
      return chain(0, []);
    });
  };

  public filter = (predicate: (val: T) => boolean): Source<T> => {
    return new BasicSource<T>(listener =>
      this.subscribe(val =>
        predicate(val) ? listener(val) : Routine.resolve(undefined)
      )
    );
  };

  public derive = <U>(fn: (val: T) => Routine<U>): Routine<Source<U>> => {
    return new Effect(addFinalizeFn => {
      const portal = new Portal<U>();
      addFinalizeFn(() => portal.finalize());
      return portal;
    }).then(portal =>
      this.subscribe(val => fn(val).then(u => portal.connect(u))).map(
        () => portal
      )
    );
  };
}

export class BasicSource<T> extends Source<T> {
  constructor(
    private subscribeFn: (listener: (val: T) => Routine<void>) => Routine<void>
  ) {
    super();
  }

  public subscribe = (listener: (val: T) => Routine<void>): Routine<void> => {
    return this.subscribeFn(listener);
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
    return new Effect(addFinalizeFn => {
      this.biLinks.linkAllB(listener, val => listener(val.value));
      addFinalizeFn(() => {
        return this.biLinks.unlinkAllB(listener);
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
    return new Effect(addFinalizeFn => {
      this.biLinks.linkAllB(callback, val => callback(val.value));
      addFinalizeFn(() => {
        return this.biLinks.unlinkAllB(callback);
      });
    });
  };

  public connect(value: T): Routine<void> {
    const valueRef = { value };
    return new Effect(addFinalizeFn => {
      addFinalizeFn(() => {
        return this.biLinks.unlinkAllA(valueRef);
      });
      this.biLinks.linkAllA(valueRef, valToRoutine => valToRoutine(value));
    });
  }

  public finalize = (): MaybePromise<void> => {
    return this.biLinks.unlinkAll();
  };
}
