// E: HEAT balance on the real levels, played headless by the sweep's human mode (A's robot with a
// slower hand that looks away now and then). These pin the two reviewer findings of 2026-10-22:
// HEAT shields must not make lives meaningless, and Overloads must not fire back to back.
// Margins are wide on purpose: they catch a broken rule, not a small retune by A or B.

import { test, assert } from './lib.mjs';
import { LEVELS } from '../src/levels/index.js';
import { sweepLevel } from './fixtures/E/sweep.mjs';

const SEEDS = [1, 2, 3];

test('HEAT shields save well under half the lives a lapsing player loses (levels 7 to 21)', () => {
  let without = 0, withShields = 0, bought = 0;
  for (const seed of SEEDS) {
    for (const l of LEVELS) {
      if (l.n < 7 || l.n > 21 || l.kind === 'boss' || l.kind === 'bonus') continue;
      for (const s of sweepLevel(l, seed, { human: true, shields: false })) without += s.lives;
      for (const s of sweepLevel(l, seed, { human: true, shields: true })) {
        withShields += s.lives;
        bought += s.shields;
      }
    }
  }
  assert.ok(without >= 15, `the human mode loses lives (${without})`);
  assert.ok(bought > 0, 'shields were bought');
  // Measured 2026-10-22: 38 without, 26 with (68%). Cheap rebuyable shields gave 5 (13%).
  assert.ok(withShields >= 0.55 * without, `lives lost with shields ${withShields} vs ${without} without`);
});

test('Overloads fire about 1 to 3 times a level and Purge leaves most of the wall to the ball (22 to 29)', () => {
  const by = { 1: [0, 0, 0, 0], 2: [0, 0, 0, 0], 3: [0, 0, 0, 0] }; // worlds, Overloads, Overload bricks, bricks
  for (const seed of SEEDS) {
    const kind = 1 + (seed % 3); // the sweep's pick: Purge, Quench, Fork by seed
    for (const l of LEVELS) {
      if (l.n < 22 || l.n > 29 || l.kind === 'bonus') continue;
      for (const s of sweepLevel(l, seed, { human: true })) {
        const b = by[kind];
        b[0]++;
        b[1] += s.overloads;
        b[2] += s.ovBricks;
        b[3] += s.broken;
      }
    }
  }
  for (const [kind, [worlds, fired, own, broken]] of Object.entries(by)) {
    const each = fired / worlds;
    // Measured 2026-10-22: Purge 1.6, Quench 2.4, Fork 2.0 (Purge broke 18% of the bricks).
    // Before the vent and the no-ember rule: Purge 3.6 to 9, Quench 12, Fork 5.7.
    assert.ok(each >= 0.8 && each <= 4.5, `Overload ${kind}: ${each.toFixed(1)} a level`);
    assert.ok(own <= 0.3 * broken, `Overload ${kind} broke ${own} of ${broken} bricks itself`);
  }
});
