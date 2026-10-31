import { test, assert } from './lib.mjs';
import { readFileSync } from 'node:fs';

// Execute the production closure with UI and task boundaries under test control.
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = main.indexOf('  function results(');
const end = main.indexOf('  // QA openers', start);
assert.ok(start >= 0 && end > start, 'production results closure is present');
const bindResults = new Function('renderer', 'ui', 'QA', 'setTimeout', `${main.slice(start, end)}\nreturn results;`);

function fixture(prefetch = true) {
  const calls = [], jobs = [];
  const renderer = { setMenu() {} };
  if (prefetch) renderer.prefetchHeadroom = (...args) => calls.push(['prefetch', ...args]);
  const ui = { current: null, setHudVisible() {}, card() {}, show: (...args) => calls.push(['show', ...args]) };
  const results = bindResults(renderer, ui, { bot: false }, (fn) => jobs.push(fn));
  return { calls, jobs, ui, results };
}

test('next-world art waits until the deferred results screen has been built', () => {
  const f = fixture(), data = {}, next = { n: 10, world: 'ember', boss: { id: 'stoker' } };
  f.results(data, next);
  assert.deepEqual(f.calls, [], 'no request competes with the clear/bank/save task');
  f.jobs[0]();
  assert.deepEqual(f.calls, [['show', 'results', data], ['prefetch', next, undefined]]);
});

test('a superseding screen prevents both results construction and art prefetch', () => {
  const f = fixture();
  f.results({}, { world: 'blaze' });
  f.ui.current = 'levels';
  f.jobs[0]();
  assert.deepEqual(f.calls, []);
});

test('loss, completion and sample results without next metadata do not prefetch', () => {
  for (const kind of ['over', 'campaign', 'cleared']) {
    const f = fixture(), data = { kind };
    f.results(data);
    f.jobs[0]();
    assert.deepEqual(f.calls, [['show', 'results', data]]);
  }
});

test('Overburn forwards only subject metadata and the upcoming wave', () => {
  const f = fixture(), next = { world: 'overburn' };
  f.results({}, next, 4);
  f.jobs[0]();
  assert.deepEqual(f.calls[1], ['prefetch', next, 4]);
});

test('renderers without the optional art capability still show results', () => {
  const f = fixture(false);
  f.results({}, { world: 'ember' });
  assert.doesNotThrow(() => f.jobs[0]());
  assert.equal(f.calls[0][0], 'show');
});
