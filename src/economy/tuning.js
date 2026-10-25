// Kiln: economy tuning (OWNER: E). Every number E chose lives here, with its reason in
// K/status/E.md "Calls". The handoff's exact values stay in src/core/constants.js and are imported,
// never copied. Pure data, no DOM, no clock.

import { BRICK, DROP, DROP_COUNT, PADDLE, OVERLOAD_RULES, SPEED } from '../core/constants.js';

const freeze = (o) => {
  for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') freeze(o[k]);
  return Object.freeze(o);
};

// ---------------------------------------------------------------- score
// Base points per broken brick, before the combo multiplier. Numbered bricks pay 10 per hit point
// so a 9 is worth nine plain bricks of work.
export const BRICK_POINTS = freeze({
  [BRICK.PLAIN]: 10,
  [BRICK.NUMBERED]: 10,      // × hpMax
  [BRICK.ARMOURED]: 50,
  [BRICK.INDESTRUCTIBLE]: 0,
  [BRICK.EXPLOSIVE]: 20,
  [BRICK.GRAVITY]: 20,
  [BRICK.CAVITY]: 30,
  [BRICK.CARRIER]: 20,
  [BRICK.PORTAL]: 0,
  [BRICK.BOSS]: 25,
  [BRICK.WEAK]: 100,
});

export const SCORE = freeze({
  EMBER: 5,              // per ember caught, × multiplier
  PERFECT: 50,           // per perfect hit, × multiplier
  DROP_GOOD: 50,         // per good or cold drop caught, × multiplier
  DROP_BAD: 150,         // per red drop caught: the risk pays, × multiplier
  LIFE_AT_MAX: 500,      // a Life drop caught at max lives, × multiplier
  SENTRY: 100,           // per sentry killed, × multiplier
  BOSS_HIT: 250,         // per boss hit (BOSS_HIT event), × multiplier
  BOSS_DEFEATED: 5000,   // flat
  CLEAR_BASE: 500,       // flat on every clear
  CLEAR_PER_LEVEL: 100,  // flat, × level number
  FLAWLESS: 1000,        // flat, cleared without losing a life this level
  CAVITY_FACTOR: 2,      // freeing a cavity ball doubles the level score at the clear
});

// ---------------------------------------------------------------- music intensity (fx.heatLevel)
// heatLevel = clamp01(HEAT_WEIGHT × HEAT / line + PACE_WEIGHT × pace + danger terms) where the
// meter is in play (from 7), clamp01(pace + danger) before it. The line is the Overload's ready
// line when one is equipped (22 on, where firing at the line is the norm), else the meter's size.
// The pace: every ember caught adds 1, the sum cools by itself over PACE_TAU_MS, and a lost ball,
// an Overload or a bought shield empties it; paceOf reads PACE_FULL catches a second as 1.
// So the music rises with HEAT and with a hot stretch of catching; spending HEAT is heard at once
// (an Overload or a shield takes both terms to 0, Pull drains the HEAT term); a full meter in calm
// play (the serve, a gap between walls) is an even blend, so a held meter cannot pin the full mix.
export const INTENSITY = freeze({
  HEAT_WEIGHT: 0.55,     // a full meter (or a ready Overload) alone: smoothstep(0.35, 0.75, 0.55) = an even blend
  PACE_WEIGHT: 0.6,      // with HEAT full, a third of full pace reaches the full mix
  PACE_TAU_MS: 3000,     // a catch fades from the pace over about 3 s
  PACE_FULL: 2,          // embers caught a second that read as full pace
  LAST_LIFE: 0.15,
  LAST_BRICKS: 0.2,      // ≤ LAST_BRICKS.AT bricks left
  BOSS: 0.25,
});

// ---------------------------------------------------------------- drops (CP2)
// Durations in sim ms. 0 = instant. Infinity = until used or the ball is lost.
export const DROP_MS = freeze([
  20000,    // WIDE
  15000,    // SLOW
  0,        // MULTI (instant)
  12000,    // FIRE
  Infinity, // LASER (until the shots are spent)
  20000,    // CATCH
  8000,     // THRU
  0,        // LIFE (instant)
  15000,    // SHRINK
  12000,    // FAST
  10000,    // FOG
  10000,    // MEGA
]);
if (DROP_MS.length !== DROP_COUNT) throw new Error('DROP_MS must list every drop kind');

export const DROP_FX = freeze({
  WIDE_ADD: PADDLE.W_WIDE - PADDLE.W,     // +60 on whatever the base width is
  SHRINK_SUB: PADDLE.W - PADDLE.W_SHRINK, // −40
  SLOW_SCALE: 0.75,
  FAST_SCALE: 1.2,
  MULTI_EXTRA: 2,        // splitBalls(2): one ball becomes three ("Multi-3")
  LASER_SHOTS: 12,
  FOG_FADE_MS: 1000,     // fog strength eases out over the last second
  BAD: [DROP.SHRINK, DROP.FAST, DROP.FOG],
  // Default random-drop weights when a carrier breaks on a level with an empty table.
  DEFAULT_TABLE: { wide: 4, slow: 3, multi: 3, fire: 2, laser: 2, catch: 2, thru: 1, life: 1 },
});

// ---------------------------------------------------------------- Overloads + shield (CP2)
// An Overload is ready at its cost and firing it spends the whole meter. Bricks it breaks (and
// blasts it sets off) pay points and drops but no embers, so it never refills itself.
// The cost is only the ready line: what spaces Overloads out is the vent below.
export const OVERLOAD_COST = freeze([0, 75, 50, 60]); // by OVERLOAD.* (none, purge, quench, fork)
// After an Overload the kiln vents: the meter cannot fill for the vent of play (embers still pay
// combo and points). Inferno walls refill 100 HEAT in about 4 s, so the price alone cannot
// space Overloads out; the vent does, and it costs Pull for that time too. The Forge's
// "Overload power" shortens it (FORGE_FX.VENT_MS); this is rank 0.
export const OVERLOAD_VENT_MS = 12000;
export const QUENCH_SCALE = 0.5;     // all balls at half speed while Quench runs
export const FORK_EXTRA = 1;         // splitBalls(1): every ball splits in two
// Before an Overload is equipped the overload input buys a shield: one at a time, PER_LEVEL in
// a level (then econ.shieldCost is 0 and the HUD hides it).
export const SHIELD = freeze({ COST: 100, MAX: 1, PER_LEVEL: 1, HOLD_MS: 20000 });

// ---------------------------------------------------------------- Mods (CP2)
export const MOD_FX = freeze({
  BIG_EMBER_HEAT: 6,       // bigger embers: +6 HEAT each instead of +4
  DOUBLE_DROP_RATE: 2,
  LONG_CATCH_MS: 35000,
  CHEAP_PULL: 0.65,        // Pull costs 26 HEAT/s instead of 40
  BURST_CHANCE: 0.1,       // 1 in 10 broken bricks bursts double embers
  MAGNET_R: 160,
  COMBO_FLOOR: 10,         // combo never below 10, so the multiplier never below ×2
  MORE_LASER_SHOTS: 8,
  SLOW_START_SCALE: SPEED.TIERS[0] / SPEED.TIERS[1], // a tier lower for the first 10 s after each launch
  SLOW_START_MS: 10000,
  PIERCE_FIRST: 1,
  SHIELD_AT_START: 1,
});

// ---------------------------------------------------------------- The Forge (CP2)
export const FORGE_FX = freeze({
  START_LIVES: [3, 4, 5, 5],          // by rank 0–3; rank 3 also gives one free miss per run
  FREE_MISS: [0, 0, 0, 1],
  HEAT_MAX: [100, 120, 140, 160],
  PADDLE_ADD: [0, 10, 20, 30],
  EMBER_VALUE: [1, 1.25, 1.5, 2],     // embers banked per ember earned
  // Overload power: every rank shortens the vent (the thing that limits Overloads) and makes
  // each Overload stronger where a step fits (Purge rows, Quench seconds, Fork balls per ball).
  VENT_MS: [OVERLOAD_VENT_MS, 10000, 8000, 6000],
  PURGE_ROWS: [OVERLOAD_RULES.PURGE_ROWS, 4, 4, 5],
  QUENCH_MS: [OVERLOAD_RULES.QUENCH_MS, 4000, 5000, 6000],
  FORK_EXTRA: [1, 1, 2, 2],        // splitBalls(n): every ball becomes n + 1
  HEAVY_SPEED: 0.9,                   // Heavy ball: slower (E folds it into ballSpeedScale), 2 damage (B)
});
