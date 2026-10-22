// Kiln: score and combo maths (OWNER: E). Pure functions, no world access, so the HUD, the
// results screen and the tests all agree on one formula.
//
// Score = base points × the combo multiplier at that moment, for everything the player does
// (bricks, embers, perfect hits, drops, sentries, boss hits). The clear bonus is flat:
//   CLEAR_BASE + CLEAR_PER_LEVEL × n, + FLAWLESS if no life was lost on the level,
//   then the whole level score doubles if a cavity ball was freed.

import { BRICK, COMBO, LAST_BRICKS } from '../core/constants.js';
import { BRICK_POINTS, SCORE, INTENSITY } from './tuning.js';

/** Multiplier for a combo count: ×1, ×2 at 10, ×3 at 25, ×5 at 50 (COMBO.STEPS). */
export function multFor(combo) {
  const steps = COMBO.STEPS;
  let m = 1;
  for (let i = 0; i < steps.length; i++) if (combo >= steps[i][0]) m = steps[i][1];
  return m;
}

/** Combo count to reach the next multiplier, or −1 at the top step. */
export function nextStepAt(combo) {
  const steps = COMBO.STEPS;
  for (let i = 0; i < steps.length; i++) if (combo < steps[i][0]) return steps[i][0];
  return -1;
}

/** Combo after a lost ball: halved (rounded down), never below the floor (Mod "combo floor"). */
export function halveCombo(combo, floor = 0) {
  return Math.max(floor, Math.floor(combo * COMBO.LOST_BALL_FACTOR));
}

/**
 * Base points for a broken brick before the multiplier.
 * @param {number} type BRICK.*
 * @param {number} hpMax hits the brick started with
 */
export function brickPoints(type, hpMax = 1) {
  const base = BRICK_POINTS[type] ?? 10;
  return type === BRICK.NUMBERED ? base * Math.max(1, hpMax) : base;
}

/**
 * The flat bonus for clearing a level (before the cavity doubling).
 * @param {number} n level number
 * @param {boolean} flawless no life lost on this level
 */
export function clearBonus(n, flawless) {
  return SCORE.CLEAR_BASE + SCORE.CLEAR_PER_LEVEL * Math.max(1, n | 0) + (flawless ? SCORE.FLAWLESS : 0);
}

/** HEAT per ember: ×LAST_BRICKS.HEAT_MULT when 1…3 clearable bricks are left. */
export function heatPerEmber(base, remaining) {
  return remaining > 0 && remaining <= LAST_BRICKS.AT ? base * LAST_BRICKS.HEAT_MULT : base;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Music intensity 0…1 (fx.heatLevel). Where the HEAT meter is in play: HEAT_WEIGHT × HEAT toward
 * its line + PACE_WEIGHT × the pace of catching; before the meter (levels 1-6) the pace alone. Then
 * danger and tension on top. Plain arguments: the economy calls it every step.
 * @param {number} heat
 * @param {number} heatLine HEAT that reads as a full term: the Overload's ready line, else the meter
 * @param {number} pace 0…1 (paceOf)
 * @param {boolean} heatOn the HEAT meter is in play on this level
 * @param {boolean} lastLife
 * @param {boolean} lastBricks
 * @param {boolean} boss
 */
export function intensity(heat, heatLine, pace, heatOn, lastLife, lastBricks, boss) {
  const p = clamp01(pace);
  let v = p;
  if (heatOn) v = INTENSITY.HEAT_WEIGHT * (heatLine > 0 ? clamp01(heat / heatLine) : 0) + INTENSITY.PACE_WEIGHT * p;
  if (lastLife) v += INTENSITY.LAST_LIFE;
  if (lastBricks) v += INTENSITY.LAST_BRICKS;
  if (boss) v += INTENSITY.BOSS;
  return clamp01(v);
}

/**
 * The pace 0…1 from the economy's catch sum (each ember caught adds 1, the sum decays by paceDecay
 * every step, and a lost ball, an Overload or a bought shield empties it): a steady PACE_FULL
 * embers a second reads as 1.
 * @param {number} sum
 */
export function paceOf(sum) {
  return clamp01(sum / ((INTENSITY.PACE_FULL * INTENSITY.PACE_TAU_MS) / 1000));
}

/** Per-step decay of the catch sum for a step of dtMs. */
export function paceDecay(dtMs) {
  return Math.exp(-dtMs / INTENSITY.PACE_TAU_MS);
}
