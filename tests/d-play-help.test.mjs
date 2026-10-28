import { test, assert } from './lib.mjs';
import { controlHints } from '../src/ui/play-help.js';
import { getLevel } from '../src/levels/index.js';
import { parseLevel } from '../src/levels/parser.js';

test('first-use help follows parsed defaults when a later level has no explicit ability rules', () => {
  const def = getLevel(10), rules = parseLevel(def).rules, seen = { launch: true };
  assert.equal(def.rules.pull, undefined);
  const help = controlHints(rules, seen, false).join(' ');
  assert.match(help, /mouse button.*Pull balls in/);
  assert.match(help, /Q or E: Shield \(100 HEAT\) saves a miss/);
  assert.doesNotMatch(help, /Overload/);
  assert.deepEqual(controlHints(rules, seen, false), [], 'help is remembered after showing it');
});

test('the first HEAT card is two short lines: one Pull line and one Shield line', () => {
  for (const touch of [true, false]) {
    const help = controlHints(parseLevel(getLevel(7)).rules, { launch: true }, touch);
    assert.equal(help.length, 2);
    for (const line of help) {
      assert.ok(line.length <= 41, `one card line at 390 px: "${line}"`);
      assert.ok(!/;/.test(line), `no semicolon fragments: "${line}"`);
    }
  }
});

test('revised Pull help reaches an existing player once without replaying other controls', () => {
  const seen = { launch: true, pull: true, shield: true };
  assert.deepEqual(controlHints(parseLevel(getLevel(1)).rules, seen, true), []);
  const help = controlHints(parseLevel(getLevel(7)).rules, seen, true);
  assert.equal(help.length, 1);
  assert.match(help[0], /second finger/);
  assert.match(help[0], /Pull balls in/);
  assert.equal(seen.pull, 2);
  assert.deepEqual(controlHints(parseLevel(getLevel(8)).rules, seen, true), []);
});

test('Overload introduction does not advertise buying a Shield after it has been replaced', () => {
  const help = controlHints(parseLevel(getLevel(22)).rules, {}, true).join(' ');
  assert.match(help, /Tap to launch/);
  assert.match(help, /Pull/);
  assert.match(help, /bottom button fires your Overload/);
  assert.match(controlHints(parseLevel(getLevel(22)).rules, {}, false).join(' '), /Q or E uses your Overload and empties HEAT/);
  assert.doesNotMatch(help, /Shield/);
});

test('every phone control line is one card line at 390 px', () => {
  const lines = new Set();
  for (const n of [1, 7, 10, 22]) for (const line of controlHints(parseLevel(getLevel(n)).rules, {}, true)) lines.add(line);
  assert.equal(lines.size, 4, 'launch, Pull, Shield and Overload lines');
  for (const line of lines) assert.ok(line.length <= 41, `one card line at 390 px: "${line}"`);
});
