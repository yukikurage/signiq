import { CompositeReleasable, Releasable } from './releasable';

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

  public static pure<T>(value: T): EffectObservable<T> {
    return new EffectObservable<T>((_addReleasable, _abortSignal) => {
      return value;
    });
  }

  public static never<T>(): BasicObservable<T> {
    return new BasicObservable<T>(_observer => {
      return Releasable.noop;
    });
  }

  public static lazy<T>(thunk: () => Observable<T>): BasicObservable<T> {
    return new BasicObservable<T>(observer => {
      return thunk().observe(observer);
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

/**
 * Effect Observable は、一回のみ値を発火させる可能性のある Observable である。
 * また、値が発火した場合、その寿命は observation の寿命と一致する。
 */
export class EffectObservable<T> extends Observable<T> {
  constructor(
    private readonly maker: (
      addReleasable: (releasable: Releasable) => void,
      abortSignal: AbortSignal
    ) => Promise<T> | T
  ) {
    super();
  }

  // 実行し、結果と releasable を取得する
  // releasable は実行することで Promise なら途中でキャンセルできる。
  public run(): {
    result: Promise<T> | T;
    releasable: Releasable;
  } {
    const abortController = new AbortController();
    const computationReleasable = new CompositeReleasable();

    // Start async operation
    const makerResult = this.maker((r: Releasable) => {
      computationReleasable.add(r);
    }, abortController.signal);

    if (makerResult instanceof Promise) {
      const resultPromise = makerResult.then(value => {
        return value;
      });
      return {
        result: resultPromise,
        releasable: Releasable.sequential([
          {
            release: async () => {
              abortController.abort();
            },
          },
          computationReleasable,
        ]),
      };
    } else {
      return {
        result: makerResult,
        releasable: Releasable.sequential([
          {
            release: async () => {
              abortController.abort();
            },
          },
          computationReleasable,
        ]),
      };
    }
  }

  public observe(observer: (value: T) => Releasable): Releasable {
    const { result, releasable } = this.run();
    if (result instanceof Promise) {
      let released = false;
      const asyncReleasable: Releasable = {
        release: async () => {
          released = true;
          await releasable.release();
        },
      };
      result
        .then(value => {
          if (released) return;
          const observationReleasable = observer(value);
          // 値が作成されたなら releasable にそれを追加する
          asyncReleasable.release = async () => {
            await Releasable.sequential([
              observationReleasable, // 値の解放
              releasable, // 計算の解放
            ]).release();
          };
        })
        .catch(_e => {
          // Ignore errors here; they should be handled in the maker function
        });
      return asyncReleasable;
    } else {
      const observationReleasable = observer(result);
      return Releasable.sequential([observationReleasable, releasable]);
    }
  }
}
