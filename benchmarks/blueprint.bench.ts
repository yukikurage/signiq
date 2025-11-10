import Benchmark from 'benchmark';
import { Blueprint, Realm, Store, use, useEffect } from '../src';

var suite = new Benchmark.Suite();

// Blueprint with 1000 operations
suite
  .add('without toRealm', function () {
    // 1000 operations directly
    const blueprint = () => {
      for (let i = 0; i < 1000; i++) {
        use(Realm.pure(i));
      }
      return null;
    };

    const store = Blueprint.toStore(blueprint);
    return store;
  })
  .add('with toRealm', function () {
    const realmWith10Ops = Blueprint.toRealm(() => {
      for (let i = 0; i < 10; i++) {
        use(Realm.pure(i));
      }
      return null;
    });

    const realmWith100Ops = Blueprint.toRealm(() => {
      for (let i = 0; i < 10; i++) {
        Blueprint.use(realmWith10Ops);
      }
      return null;
    });

    const blueprint = () => {
      for (let i = 0; i < 11; i++) {
        Blueprint.use(realmWith100Ops);
      }
      return null;
    };

    const store = Blueprint.toStore(blueprint);
    return store;
  })
  .add('without blueprint', function () {
    // 1000 operations flatMapped directly
    const realm = Array.from({ length: 1000 }, (_, i) => i).reduce<
      Realm<number>
    >((acc, curr) => {
      return acc.flatMap(() => Realm.pure(curr));
    }, Realm.pure(0));

    const store = new Store(realm);
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
