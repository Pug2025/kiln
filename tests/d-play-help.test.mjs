import { test, assert } from './lib.mjs';
import { controlHints } from '../src/ui/play-help.js';
import { getLevel } from '../src/levels/index.js';
import { parseLevel } from '../src/levels/parser.js';

test('first-use help follows parsed defaults when a later level has no explicit ability rules', () => {
  const def = getLevel(10), rules = parseLevel(def).rules, seen = { launch: true };
  assert.equal(def.rules.pull, undefined);
  const help = controlHints(rules, seen, false).join(' ');
  assert.match(help, /Pull.*paddle/);
  assert.match(help, /mouse button/);
  assert.match(help, /Shield.*100 HEAT.*save one miss/);
  assert.doesNotMatch(help, /Overload/);
  assert.deepEqual(controlHints(rules, seen, false), [], 'help is remembered after showing it');
});

test('revised Pull help reaches an existing player once without replaying other controls', () => {
  const seen = { launch: true, pull: true, shield: true };
  assert.deepEqual(controlHints(parseLevel(getLevel(1)).rules, seen, true), []);
  const help = controlHints(parseLevel(getLevel(7)).rules, seen, true);
  assert.equal(help.length, 1);
  assert.match(help[0], /second finger/);
  assert.match(help[0], /release.*HEAT/);
  assert.equal(seen.pull, 2);
  assert.deepEqual(controlHints(parseLevel(getLevel(8)).rules, seen, true), []);
});

test('Overload introduction does not advertise buying a Shield after it has been replaced', () => {
  const help = controlHints(parseLevel(getLevel(22)).rules, {}, true).join(' ');
  assert.match(help, /Tap to launch/);
  assert.match(help, /Pull/);
  assert.match(help, /Overload.*empties HEAT/);
  assert.doesNotMatch(help, /Shield/);
});
