import Benchmark from 'benchmark';
import { Blueprint, Observable } from '../src';
import { List } from 'immutable';

const suite = new Benchmark.Suite();

// All tests use 1000 loop iterations for consistency
const LOOP_COUNT = 1000;

// Measure individual overhead components
suite
  .add('Baseline: pure Observable.pure', function () {
    // Just Observable.pure - no Blueprint
    for (let i = 0; i < LOOP_COUNT; i++) {
      const obs = Observable.pure(i);
      obs.observe(() => ({ release: async () => {} }));
    }
  })
  .add('Array copy (history simulation)', function () {
    // Simulate history copying overhead
    const history: number[] = [];
    for (let i = 0; i < LOOP_COUNT; i++) {
      const newHistory = [...history, i]; // Array copy
      history.push(i);
    }
  })
  .add('Exception throw/catch (1000x)', function () {
    // Simulate exception-based control flow
    for (let i = 0; i < LOOP_COUNT; i++) {
      try {
        throw new Error('test');
      } catch (e) {
        // caught
      }
    }
  })
  .add('Array copy O(n²) simulation', function () {
    // Simulate Blueprint's O(n²) array copying
    // Blueprint does: [], [0], [0,1], [0,1,2], ..., [0,1,...,999]
    let history: number[] = [];
    for (let i = 0; i < LOOP_COUNT; i++) {
      history = [...history, i]; // Each iteration copies entire array
    }
  })
  .add('Exception + Array copy O(n²)', function () {
    // Combined: exception AND array copy (closer to real Blueprint)
    let history: number[] = [];
    for (let i = 0; i < LOOP_COUNT; i++) {
      try {
        throw new Error('test');
      } catch (e) {
        history = [...history, i];
      }
    }
  })
  .add('Immutable.List append O(log n)', function () {
    // Immutable.js List - O(log n) append
    let history = List<number>();
    for (let i = 0; i < LOOP_COUNT; i++) {
      history = history.push(i); // O(log n) persistent append
    }
  })
  .add('Exception + Immutable.List O(log n)', function () {
    // Combined: exception AND Immutable.List append
    let history = List<number>();
    for (let i = 0; i < LOOP_COUNT; i++) {
      try {
        throw new Error('test');
      } catch (e) {
        history = history.push(i);
      }
    }
  })
  .add('Global context set/restore', function () {
    // Simulate global context manipulation
    let GLOBAL: any = undefined;
    for (let i = 0; i < LOOP_COUNT; i++) {
      const temp = GLOBAL;
      GLOBAL = { value: i };
      GLOBAL = temp;
    }
  })
  .add('Blueprint: 1000 use()', function () {
    // Blueprint with 1000 use() calls
    const blueprint = () => {
      for (let i = 0; i < LOOP_COUNT; i++) {
        Blueprint.use(Observable.pure(i));
      }
    };
    // Must call observe() to actually execute the Blueprint
    Blueprint.toObservable(blueprint).observe(() => ({
      release: async () => {}
    }));
  })
  .add('Direct flatMap: 1000 calls', function () {
    // Direct Observable flatMap for comparison
    let obs: Observable<number> = Observable.pure(0);
    for (let i = 0; i < LOOP_COUNT; i++) {
      obs = obs.flatMap(() => Observable.pure(i));
    }
    // Must also call observe() for fair comparison
    obs.observe(() => ({ release: async () => {} }));
  })
  .on('cycle', function (event: Benchmark.Event) {
    console.log(String(event.target));
  })
  .on('complete', function (this: Benchmark.Suite) {
    console.log('Fastest is ' + this.filter('fastest').map('name'));
  })
  .run({ async: true });
