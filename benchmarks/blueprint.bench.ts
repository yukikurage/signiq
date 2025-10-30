import Benchmark from 'benchmark';
import { Blueprint, Observable, Store, use, useEffect } from '../src';

var suite = new Benchmark.Suite();

// Blueprint with 1000 operations
suite
  .add('without toObservable', function () {
    // 1000 operations directly
    const blueprint = () => {
      for (let i = 0; i < 1000; i++) {
        use(Observable.pure(i));
      }
      return null;
    };

    const store = Blueprint.toStore(blueprint);
    return store;
  })
  .add('with toObservable', function () {
    const observableWith10Ops = Blueprint.toObservable(() => {
      for (let i = 0; i < 10; i++) {
        use(Observable.pure(i));
      }
      return null;
    });

    const observableWith100Ops = Blueprint.toObservable(() => {
      for (let i = 0; i < 10; i++) {
        Blueprint.use(observableWith10Ops);
      }
      return null;
    });

    const blueprint = () => {
      for (let i = 0; i < 11; i++) {
        Blueprint.use(observableWith100Ops);
      }
      return null;
    };

    const store = Blueprint.toStore(blueprint);
    return store;
  })
  .add('without blueprint', function () {
    // 1000 operations flatMapped directly
    const observable = Array.from({ length: 1000 }, (_, i) => i).reduce<
      Observable<number>
    >((acc, curr) => {
      return acc.flatMap(() => Observable.pure(curr));
    }, Observable.pure(0));

    const store = new Store(observable);
    return store;
  })
  // add listeners
  .on('cycle', function (event: Benchmark.Event) {
    console.log(String(event.target));
  })
  .on('complete', function (this: Benchmark.Suite) {
    console.log('Fastest is ' + this.filter('fastest').map('name'));
  })
  // run async
  .run({ async: true });
