import { Releasable } from './releasable';

/**
 * A collection of observable values
 * Value additions can be monitored through the observe function
 * When an observation obtained from the observe function is released,
 * all created values are expected to be released as well
 */
export abstract class Observable<T> {
  public abstract observe(observer: (value: T) => Releasable): Releasable;

  public map<U>(f: (value: T) => U): Observable<U> {
    return new BasicObservable<U>(create => {
      return this.observe(value => {
        return create(f(value));
      });
    });
  }

  public flatMap<U>(f: (value: T) => Observable<U>): Observable<U> {
    return new BasicObservable<U>(create => {
      // Observe the parent Observable
      return this.observe(value => {
        // Get and observe the child
        return f(value).observe(v => {
          return create(v);
        });
      });
    });
  }

  public filter(predicate: (value: T) => boolean): Observable<T> {
    return new BasicObservable<T>(create => {
      return this.observe(value => {
        if (predicate(value)) {
          return create(value);
        }
        return Releasable.noop;
      });
    });
  }

  public merge<U>(other: Observable<U>): Observable<T | U> {
    return new BasicObservable<T | U>(create => {
      const releaseLeft = this.observe(value => {
        return create(value);
      });
      const releaseRight = other.observe(value => {
        return create(value);
      });
      return Releasable.parallel([releaseLeft, releaseRight]);
    });
  }

  public static pure<T>(value: T): BasicObservable<T> {
    return new BasicObservable<T>(observer => {
      return observer(value);
    });
  }

  public static never<T>(): BasicObservable<T> {
    return new BasicObservable<T>(_observer => {
      return Releasable.noop;
    });
  }
}

export class BasicObservable<T> extends Observable<T> {
  constructor(
    private readonly subscribeFunc: (
      observer: (value: T) => Releasable
    ) => Releasable
  ) {
    super();
  }

  public observe(observer: (value: T) => Releasable): Releasable {
    return this.subscribeFunc(observer);
  }
}

export class SyncObservable<T> extends Observable<T> {
  constructor(private readonly init: () => { value: T; release: Releasable }) {
    super();
  }

  public observe(observer: (value: T) => Releasable): Releasable {
    const { value, release } = this.init();
    const observerRelease = observer(value);
    return Releasable.sequential([observerRelease, release]);
  }
}
