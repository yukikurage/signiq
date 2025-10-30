import Benchmark from 'benchmark';

var suite = new Benchmark.Suite();

// add tests
suite
  .add('RegExp#test', function () {
    /o/.test('Hello World!');
  })
  .add('String#indexOf', function () {
    'Hello World!'.indexOf('o') > -1;
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
