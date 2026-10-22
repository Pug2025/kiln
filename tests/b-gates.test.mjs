// B: gate doors are a real choice (src/content/gates.js, `doors` in the level data). The plain
// robot (no perfect hits, catches drops) plays the level and both doors on eight seeds: every
// door clears, the two doors play close to each other, and neither plays much faster than the
// level would with no door (a door's payoff does not outweigh its cost). The doors were picked on
// 24 seeds against tighter numbers (within 1.25x of each other, and about the plain level or
// slower; table in K/status/B.md); one robot clear swings 2x between seeds, so this test keeps
// eight fixed seeds and bounds loose enough for an eight-seed median.

import { test, assert } from './lib.mjs';
import { getLevel, twistsFor, applyTwist } from '../src/levels/index.js';
import { createWorld } from '../src/core/world.js';
import { runHeadless } from '../src/core/headless.js';
import { makeSystems } from '../src/systems.js';
import { createRun } from '../src/economy/economy.js';
import { createRobot } from '../src/sim/robot.js';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Median of the plain robot's clear times (s); fails the test if any seed does not clear. */
function clearTime(def, n, what) {
  const t = SEEDS.map((s) => {
    const run = createRun({ seed: s, levelN: n });
    const world = createWorld({ level: def, seed: s * 1000 + 31 * n + 1, run, systems: makeSystems() });
    const r = runHeadless(world, createRobot({ perfect: false }), { maxSimMs: 6 * 60 * 1000 });
    assert.ok(r.cleared, `${what}, seed ${s}: not cleared (${r.remaining} left)`);
    return r.simMs / 1000;
  }).sort((a, b) => a - b);
  return (t[(t.length >> 1) - 1] + t[t.length >> 1]) / 2;
}

test('every level with doors has its own designed pair', () => {
  for (let n = 1; n <= 30; n++) {
    const doors = twistsFor(n);
    if (!doors.length) continue;
    const def = getLevel(n);
    assert.ok(Array.isArray(def.doors) && def.doors.length === 2, `level ${n} names its two doors (doors: [...])`);
    assert.deepEqual(doors.map((d) => d.id), def.doors, `level ${n}: the designed doors are the ones shown`);
  }
});

test('robot: both doors clear, play within 1.5x of each other, and the cost is real', () => {
  const report = [], problems = [];
  for (let n = 1; n <= 30; n++) {
    const doors = twistsFor(n);
    if (!doors.length) continue;
    const def = getLevel(n);
    const base = clearTime(def, n, `level ${n}`);
    const [a, b] = doors.map((d) => clearTime(applyTwist(def, d.id), n, `level ${n} door ${d.id}`));
    report.push(`${n} ${base.toFixed(0)} | ${doors[0].id} ${a.toFixed(0)} | ${doors[1].id} ${b.toFixed(0)}`);
    problems.push(...[
      Math.max(a, b) / Math.min(a, b) > 1.5 ? `level ${n}: ${doors[0].id} ${a.toFixed(0)} s vs ${doors[1].id} ${b.toFixed(0)} s` : '',
      Math.min(a, b) < 0.75 * base ? `level ${n}: a door plays in ${Math.min(a, b).toFixed(0)} s, the level alone ${base.toFixed(0)} s` : '',
    ].filter(Boolean));
  }
  console.log(`    level, alone | door A | door B (median s, 8 seeds):\n    ${report.join('\n    ')}`);
  assert.deepEqual(problems, []);
}, { timeout: 240000 });
