// E: The Forge's "Overload power" on the real levels, played headless by the sweep's human mode
// (shared by tests/e-forge-purge, e-forge-quench and e-forge-fork, one file per Overload so the
// runner plays them side by side: 2 to 7 s of sweeps each).
// Pins the reviewer finding of 2026-10-22 (third review): a cost discount did nothing once firing
// spent the whole meter and vented 12 s, so ranks were bought for nothing. Every rank must now
// measurably raise how often an Overload fires or how much it does.

import { assert } from '../../lib.mjs';
import { OVERLOAD, SIM } from '../../../src/core/constants.js';
import { LEVELS } from '../../../src/levels/index.js';
import { createRun } from '../../../src/economy/economy.js';
import { overloadPower } from '../../../src/economy/overloads.js';
import { sweepLevel } from './sweep.mjs';

const SEEDS = [1, 2];
export const OVERLOAD_NAMES_E = Object.freeze({ [OVERLOAD.PURGE]: 'Purge', [OVERLOAD.QUENCH]: 'Quench', [OVERLOAD.FORK]: 'Fork' });

/** Overloads per minute of play, and Overload bricks per firing, for one kind at one rank (22 to 29). */
export function measureOverload(kind, rank, seeds = SEEDS) {
  let fired = 0, own = 0, play = 0;
  for (const seed of seeds) {
    for (const l of LEVELS) {
      if (l.n < 22 || l.n > 29 || l.kind === 'bonus') continue;
      for (const s of sweepLevel(l, seed, { human: true, overload: kind, forge: { overload: rank } })) {
        fired += s.overloads;
        own += s.ovBricks;
        play += s.playSteps;
      }
    }
  }
  return { perMin: fired / ((play * SIM.DT) / 60), perFire: own / Math.max(1, fired) };
}

/**
 * Every rank 1-3 must count in play. Each rank shortens the vent by 15% or more (pure check here;
 * e-overloads pins the vent in play), and the levels show it: Overloads a minute of play at rank 3
 * are 1.25x rank 0 or more, no rank lowers them by more than 10%, and Purge breaks 30% more bricks
 * a firing at rank 3 than at rank 0.
 * Why not 5% a rank: a rank that is the vent alone (Fork 1 and 3) gains 5-15% on average, but seed
 * by seed it runs from x0.92 to x1.31, so any change to how levels play flipped the old per-rank
 * bar (A2's ceiling: Fork rank 1 x0.98 on seeds 1-4). The old cost discount fails these bars: the
 * vent did not change and Purge measured x1.11 at rank 3 over rank 0.
 * Measured 2026-10-22, main f903f6f, Overloads a minute at ranks 0-3: Purge 3.25 / 3.73 / 4.43 /
 * 4.89 (seeds 1-4; 14 / 19 / 18 / 26 bricks a firing), Quench 3.25 / 3.62 / 4.46 / 4.92 (seeds
 * 1-4), Fork 3.50 / 3.77 / 4.48 / 5.17 (seeds 1-8); agent/A2 with the ceiling: Purge 3.39 / 3.80 /
 * 4.42 / 5.18, Quench 3.20 / 3.72 / 4.58 / 4.91, Fork 3.45 / 3.69 / 4.58 / 5.22. Seeds 1-2, rank 3
 * over rank 0: Purge x1.49-1.55, Quench x1.47-1.52, Fork x1.48-1.59.
 * @param {number} kind OVERLOAD.*
 * @param {number[]} [seeds]
 */
export function assertEveryRankCounts(kind, seeds = SEEDS) {
  const name = OVERLOAD_NAMES_E[kind];
  const at = (rank) => overloadPower(createRun({ save: { forge: { ranks: { overload: rank } } } }));
  for (let rank = 1; rank <= 3; rank++) {
    assert.ok(at(rank).ventMs <= 0.85 * at(rank - 1).ventMs, `rank ${rank} shortens the vent by 15% or more`);
  }
  const m = [0, 1, 2, 3].map((rank) => measureOverload(kind, rank, seeds));
  const line = m.map((x) => x.perMin.toFixed(2)).join(' / ');
  for (let rank = 1; rank <= 3; rank++) {
    const use = m[rank].perMin / m[rank - 1].perMin;
    assert.ok(use >= 0.9, `${name} rank ${rank} lowers use x${use.toFixed(2)} (a minute at ranks 0-3: ${line})`);
  }
  const whole = m[3].perMin / m[0].perMin;
  assert.ok(whole >= 1.25, `${name}: rank 3 fires x${whole.toFixed(2)} as often as rank 0 (a minute at ranks 0-3: ${line})`);
  if (kind === OVERLOAD.PURGE) {
    const more = m[3].perFire / m[0].perFire;
    assert.ok(more >= 1.3, `Purge breaks x${more.toFixed(2)} bricks a firing at rank 3 (${m[0].perFire.toFixed(1)} to ${m[3].perFire.toFixed(1)})`);
  }
}
