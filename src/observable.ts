import { Releasable } from './releasable';

/**
 * 観測可能な値の集合
 * observe 関数を通じて値の追加を監視できる
 * observe 関数で得られた observation のリリース時には、作った値もすべて Release されることが期待される
 */
export interface Observable<T> {
  observe(observer: (value: T) => Releasable): Releasable;
}

export namespace Observable {
  export function make<T>(
    subscribe: (observer: (value: T) => Releasable) => Releasable
  ): Observable<T> {
    return {
      observe: (observer: (value: T) => Releasable): Releasable => {
        return subscribe(observer);
      },
    };
  }

  export function pure<T>(value: T): Observable<T> {
    return Observable.make<T>(observer => {
      return observer(value);
    });
  }

  export function never<T>(): Observable<T> {
    return Observable.make<T>(_observer => {
      return Releasable.noop;
    });
  }
}
