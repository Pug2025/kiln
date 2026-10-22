// E: embers, HEAT, combo, score, lives, level clear (CP1).

import { test, assert, near } from './lib.mjs';
import { EV, PHASE_CODE } from '../src/core/events.js';
import { BRICK, SRC, HEAT, LIVES, PULL, SIM, EMBERS, OVERLOAD } from '../src/core/constants.js';
import { setPhase, createWorld } from '../src/core/world.js';
import { runHeadless } from '../src/core/headless.js';
import { makeSystems } from '../src/systems.js';
import { getLevel } from '../src/levels/index.js';
import { createRobot } from '../src/sim/robot.js';
import { multFor, nextStepAt, halveCombo, brickPoints, clearBonus, heatPerEmber, intensity } from '../src/economy/score.js';
import { createRun } from '../src/economy/economy.js';
import { SCORE, INTENSITY } from '../src/economy/tuning.js';
import { fullMixTarget } from '../src/audio/music.js';
import { chooseOverload } from '../src/economy/overloads.js';
import { rig, level } from './fixtures/E/rig.mjs';

const breakBrick = (r, type = BRICK.PLAIN, id = 0) => r.emit(EV.BRICK_BROKEN, id, 100, 200, type, SRC.BALL, 0);
const catchEmbers = (r, n) => {
  for (let i = 0; i < n; i++) r.emit(EV.EMBER_CAUGHT, i, 360, 1000);
  r.step();
};

test('embers 2 to 4 per brick', () => {
  const r = rig({ remaining: 700 });
  for (let i = 0; i < 600; i++) breakBrick(r, BRICK.PLAIN, i);
  r.step();
  assert.equal(r.calls.embers.length, 600);
  const seen = new Set(r.calls.embers);
  for (const n of r.calls.embers) assert.ok(n >= EMBERS.MIN && n <= EMBERS.MAX, `got ${n}`);
  assert.deepEqual([...seen].sort(), [2, 3, 4], 'all of 2, 3 and 4 occur');
  assert.equal(r.events(EV.EMBERS_BURST).length, 600);
  assert.equal(r.world.econ.bricksBroken, 600);
});

test('embers per brick are deterministic for a seed', () => {
  const a = rig({ seed: 9 }), b = rig({ seed: 9 }), c = rig({ seed: 10 });
  for (const r of [a, b, c]) {
    for (let i = 0; i < 40; i++) breakBrick(r);
    r.step();
  }
  assert.deepEqual(a.calls.embers, b.calls.embers);
  assert.notDeepEqual(a.calls.embers, c.calls.embers);
});

test('ember catch: +4 HEAT and +1 combo; HEAT ×2 at 3 bricks or fewer', () => {
  const r = rig({ remaining: 20 });
  catchEmbers(r, 3);
  assert.equal(r.world.econ.heat, 3 * HEAT.PER_EMBER);
  assert.equal(r.world.econ.combo, 3);
  assert.equal(r.world.run.embersBanked, 3);
  r.world.level.remaining = 3;
  catchEmbers(r, 1);
  assert.equal(r.world.econ.heat, 3 * HEAT.PER_EMBER + 2 * HEAT.PER_EMBER);
  assert.equal(heatPerEmber(4, 0), 4, 'no doubling once nothing is left');
  assert.equal(heatPerEmber(4, 4), 4);
  assert.equal(heatPerEmber(4, 1), 8);
});

test('HEAT caps at the meter and announces HEAT_FULL once', () => {
  const r = rig();
  catchEmbers(r, 40);
  assert.equal(r.world.econ.heat, HEAT.MAX);
  assert.equal(r.events(EV.HEAT_FULL).length, 1);
});

test('combo steps 10/25/50 give ×2/×3/×5', () => {
  assert.deepEqual([0, 9, 10, 24, 25, 49, 50, 200].map(multFor), [1, 1, 2, 2, 3, 3, 5, 5]);
  assert.deepEqual([0, 10, 30, 50].map(nextStepAt), [10, 25, 50, -1]);
  const r = rig();
  const mults = [];
  for (let i = 0; i < 55; i++) {
    catchEmbers(r, 1);
    mults.push(r.world.econ.mult);
  }
  assert.equal(mults[8], 1);   // combo 9
  assert.equal(mults[9], 2);   // combo 10
  assert.equal(mults[24], 3);  // combo 25
  assert.equal(mults[49], 5);  // combo 50
  const steps = r.events(EV.COMBO_STEP).map((e) => [e.a, e.b]);
  assert.deepEqual(steps, [[2, 10], [3, 25], [5, 50]]);
});

test('lost ball halves the combo', () => {
  assert.equal(halveCombo(31), 15);
  assert.equal(halveCombo(1), 0);
  assert.equal(halveCombo(13, 10), 10, 'combo floor');
  const r = rig();
  catchEmbers(r, 31);
  assert.equal(r.world.econ.mult, 3);
  r.emit(EV.OUT_OF_BALLS);
  r.step();
  assert.equal(r.world.econ.combo, 15);
  assert.equal(r.world.econ.mult, 2);
  const h = r.events(EV.COMBO_HALVED);
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].a, h[0].b], [15, 2]);
});

test('lives: a lost ball costs a life and serves; the last one ends the run', () => {
  const r = rig();
  assert.equal(r.world.run.lives, LIVES.START);
  assert.equal(r.world.fx.lastLife, false);
  r.emit(EV.OUT_OF_BALLS);
  r.step();
  assert.equal(r.world.run.lives, 2);
  assert.equal(r.calls.serve, 1);
  r.emit(EV.OUT_OF_BALLS);
  r.step();
  assert.equal(r.world.run.lives, 1);
  assert.equal(r.world.fx.lastLife, true, 'one life left: escalation look');
  r.emit(EV.OUT_OF_BALLS);
  r.step();
  assert.equal(r.world.run.lives, 0);
  assert.equal(r.world.phase, 'over');
  assert.equal(r.calls.serve, 2, 'no serve after the last life');
  assert.deepEqual(r.events(EV.LIFE_LOST).map((e) => e.a), [2, 1, 0]);
  assert.equal(r.events(EV.RUN_OVER).length, 1);
  r.emit(EV.OUT_OF_BALLS);
  r.step();
  assert.equal(r.world.run.lives, 0, 'nothing happens once the run is over');
});

test('no-fail levels serve again without costing a life or the combo', () => {
  const r = rig({ level: level({ kind: 'bonus', rules: { noFail: true, timerMs: 30000 } }) });
  catchEmbers(r, 12);
  r.emit(EV.OUT_OF_BALLS);
  r.step();
  assert.equal(r.world.run.lives, LIVES.START);
  assert.equal(r.world.econ.combo, 12);
  assert.equal(r.calls.serve, 1);
  assert.equal(r.events(EV.LIFE_LOST).length, 0);
});

test('a lost ball during the clear ceremony costs nothing', () => {
  const r = rig();
  setPhase(r.world, 'clearing');
  r.emit(EV.OUT_OF_BALLS);
  r.step();
  assert.equal(r.world.run.lives, LIVES.START);
});

test('score: brick points × multiplier, numbered pays per hit point, perfect hit, ember', () => {
  assert.equal(brickPoints(BRICK.PLAIN), 10);
  assert.equal(brickPoints(BRICK.NUMBERED, 3), 30);
  assert.equal(brickPoints(BRICK.ARMOURED, 3), 50);
  const r = rig();
  breakBrick(r, BRICK.PLAIN);
  r.step();
  assert.equal(r.world.run.score, 10);
  r.world.bricks.hpMax[5] = 4;
  breakBrick(r, BRICK.NUMBERED, 5);
  r.step();
  assert.equal(r.world.run.score, 50);
  catchEmbers(r, 10); // ember points at ×1 for the first 9, ×2 from the 10th
  assert.equal(r.world.econ.mult, 2);
  assert.equal(r.world.run.score, 50 + 9 * SCORE.EMBER + 2 * SCORE.EMBER);
  const before = r.world.run.score;
  r.emit(EV.PERFECT_HIT, 0, 360, 1000);
  breakBrick(r, BRICK.PLAIN);
  r.step();
  assert.equal(r.world.run.score - before, 2 * SCORE.PERFECT + 2 * 10);
  assert.equal(r.world.econ.levelScore, r.world.run.score);
  const sc = r.events(EV.SCORE);
  assert.ok(sc.every((e) => e.a > 0));
});

test('level clear: flat bonus, flawless bonus, LEVEL_CLEARED once', () => {
  assert.equal(clearBonus(1, true), SCORE.CLEAR_BASE + SCORE.CLEAR_PER_LEVEL + SCORE.FLAWLESS);
  assert.equal(clearBonus(7, false), SCORE.CLEAR_BASE + 7 * SCORE.CLEAR_PER_LEVEL);
  const r = rig({ level: level({ n: 4 }) });
  breakBrick(r);
  r.step();
  setPhase(r.world, 'cleared');
  r.step(3);
  const lc = r.events(EV.LEVEL_CLEARED);
  assert.equal(lc.length, 1);
  assert.equal(lc[0].a, 4);
  assert.equal(lc[0].b, 10 + clearBonus(4, true));
  assert.equal(lc[0].c, r.world.run.score);
  assert.equal(r.world.econ.flawless, true);
});

test('the clear bonus is in the score the moment the last brick goes, before the phase turns cleared', () => {
  const r = rig({ level: level({ n: 2 }), remaining: 1 });
  setPhase(r.world, 'play');
  r.world.level.remaining = 0; // B broke the last clearable brick this step
  breakBrick(r);
  r.step();
  assert.equal(r.world.phase, 'play', 'physics has not run the ceremony yet');
  assert.equal(r.world.econ.clearBonus, clearBonus(2, true));
  assert.equal(r.world.run.score, 10 + clearBonus(2, true));
  assert.equal(r.events(EV.LEVEL_CLEARED).length, 0, 'announced only when the phase turns cleared');
  setPhase(r.world, 'cleared');
  r.step();
  const lc = r.events(EV.LEVEL_CLEARED);
  assert.equal(lc.length, 1);
  assert.equal(lc[0].b, 10 + clearBonus(2, true), 'bonus counted once');
});

test('level clear after a lost life is not flawless; a freed cavity ball doubles the level score', () => {
  const r = rig({ level: level({ n: 12 }) });
  breakBrick(r);
  r.emit(EV.OUT_OF_BALLS);
  r.emit(EV.CAVITY_OPENED, 3, 100, 100, 1);
  r.step();
  setPhase(r.world, 'cleared');
  r.step();
  const lc = r.events(EV.LEVEL_CLEARED)[0];
  const before = 10 + clearBonus(12, false);
  assert.equal(r.world.econ.flawless, false);
  assert.equal(lc.b, before * 2);
  assert.equal(r.world.econ.cavityBonus, before);
});

test('HEAT drains 40 per second while pulling', () => {
  const r = rig();
  catchEmbers(r, 25); // 100 HEAT
  assert.equal(r.world.econ.heat, 100);
  r.world.paddle.pulling = true;
  r.step(SIM.HZ); // one second
  near(r.world.econ.heat, 100 - PULL.HEAT_PER_S, 1e-6);
  r.step(SIM.HZ * 3);
  assert.equal(r.world.econ.heat, 0, 'never below zero');
  r.world.paddle.pulling = false;
});

test('HEAT and combo carry into The Core next stage, and reset on a new level', () => {
  const r = rig({ level: level({ n: 30, continues: 'core-2' }) });
  catchEmbers(r, 12);
  setPhase(r.world, 'cleared');
  r.step();
  assert.equal(r.world.run.carryHeat, 48);
  assert.equal(r.world.run.carryCombo, 12);
  const r2 = rig({ level: level({ n: 30, stage: 2 }), run: r.world.run });
  assert.equal(r2.world.econ.heat, 48);
  assert.equal(r2.world.econ.combo, 12);
  assert.equal(r2.world.econ.mult, 2);
  assert.equal(r.world.run.carryHeat, -1, 'carry is used once');
  const r3 = rig({ run: r.world.run });
  assert.equal(r3.world.econ.heat, 0);
  assert.equal(r3.world.econ.combo, 0);
});

const stepMs = (r, ms) => r.step(Math.ceil(ms / SIM.DT_MS));
const heatLevel7 = () => rig({ level: level({ n: 7, rules: { heat: true, pull: true } }) });

test('fx.heatLevel: HEAT and the pace of catching where the meter is in play, the pace alone before it', () => {
  assert.equal(intensity(0, 100, 0, true, false, false, false), 0);
  assert.equal(intensity(100, 100, 0, false, false, false, false), 0, 'HEAT counts only with the meter in play');
  assert.equal(intensity(0, 100, 1, false, false, false, false), 1, 'before the meter the pace alone reaches the full mix');
  near(intensity(100, 100, 0, true, false, false, false), INTENSITY.HEAT_WEIGHT, 1e-12);
  near(intensity(160, 160, 0, true, false, false, false), INTENSITY.HEAT_WEIGHT, 1e-12, 'a bigger meter (The Forge) reads the same when full');
  near(intensity(0, 100, 1, true, false, false, false), INTENSITY.PACE_WEIGHT, 1e-12);
  const danger = intensity(0, 100, 0, true, true, true, true);
  assert.ok(danger > 0.5 && danger <= 1);
  // The real system, with nothing happening: silence in the music's terms, at any level.
  for (const r of [rig(), heatLevel7()]) {
    r.step(30);
    assert.equal(r.world.fx.heatLevel, 0, `level ${r.world.level.n}: no HEAT, no catches`);
  }
  // Level 1 (no meter): a burst of catches lifts it, calm play lets it settle.
  const r = rig();
  catchEmbers(r, 6);
  assert.equal(fullMixTarget(r.world.fx.heatLevel), 1, `6 catches at once: ${r.world.fx.heatLevel}`);
  stepMs(r, 3000);
  const mid = r.world.fx.heatLevel;
  assert.ok(mid > 0.2 && mid < 0.6, `3 s later: ${mid}`);
  stepMs(r, 12000);
  assert.ok(r.world.fx.heatLevel < 0.05, `15 s of calm: ${r.world.fx.heatLevel}`);
});

test('full HEAT alone is an even blend; catching takes it to the full mix; a lost ball brings it down', () => {
  const r = heatLevel7();
  catchEmbers(r, 25);
  assert.equal(r.world.econ.heat, r.world.econ.heatMax);
  assert.equal(fullMixTarget(r.world.fx.heatLevel), 1, 'a full meter while catching');
  // HEAT is only spent, never lost: a held meter in calm play must not pin the full mix.
  stepMs(r, 20000);
  const held = fullMixTarget(r.world.fx.heatLevel);
  assert.ok(held > 0.4 && held < 0.6, `full HEAT, 20 s without a catch: full-mix share ${held}`);
  catchEmbers(r, 4);
  assert.equal(fullMixTarget(r.world.fx.heatLevel), 1, 'a few catches on a full meter: the full mix again');
  r.emit(EV.OUT_OF_BALLS);
  r.step();
  assert.equal(r.world.econ.heat, r.world.econ.heatMax, 'HEAT is kept');
  const mix = fullMixTarget(r.world.fx.heatLevel);
  assert.ok(mix < 0.6, `HEAT full, ball lost: full-mix share ${mix}`);
});

test('spending HEAT is heard: a shield, an Overload and Pull bring the music down', () => {
  // A shield (levels 7 to 21) spends 100 HEAT: both terms go to 0.
  const s = heatLevel7();
  setPhase(s.world, 'play');
  catchEmbers(s, 25);
  assert.equal(fullMixTarget(s.world.fx.heatLevel), 1);
  s.frame.overload = true;
  s.step();
  assert.equal(s.events(EV.SHIELD_BOUGHT).length, 1);
  assert.equal(s.world.fx.heatLevel, 0, 'shield bought: the stripped mix');
  // Pull drains the HEAT term while it is held.
  const p = heatLevel7();
  catchEmbers(p, 25);
  stepMs(p, 20000);
  const before = p.world.fx.heatLevel;
  p.world.paddle.pulling = true;
  stepMs(p, 1000);
  p.world.paddle.pulling = false;
  assert.ok(p.world.econ.heat < 70, `Pull spent HEAT: ${p.world.econ.heat}`);
  assert.ok(before - p.world.fx.heatLevel > 0.15, `Pull for 1 s: ${before} to ${p.world.fx.heatLevel}`);
  // An Overload (22 on): the HEAT term reads the ready line, firing takes both terms to 0, and the
  // vent keeps the HEAT term at 0 while catches still lift the pace.
  const run = createRun({ seed: 3 });
  chooseOverload(run, OVERLOAD.PURGE);
  const o = rig({ run, level: level({ n: 22, rules: { overloads: true, heat: true, pull: true } }) });
  setPhase(o.world, 'play');
  catchEmbers(o, 19);
  assert.equal(o.world.econ.heat, 76);
  stepMs(o, 20000);
  near(o.world.fx.heatLevel, INTENSITY.HEAT_WEIGHT, 0.01, 'a ready Overload reads as a full HEAT term');
  catchEmbers(o, 6);
  assert.equal(fullMixTarget(o.world.fx.heatLevel), 1);
  o.frame.overload = true;
  o.step();
  assert.equal(o.events(EV.OVERLOAD_FIRED).length, 1);
  assert.equal(o.world.fx.heatLevel, 0, 'Overload fired: the stripped mix');
  catchEmbers(o, 30);
  assert.equal(o.world.econ.heat, 0, 'venting');
  assert.ok(o.world.fx.heatLevel <= INTENSITY.PACE_WEIGHT + 1e-9, `venting, catching: ${o.world.fx.heatLevel}`);
  assert.ok(fullMixTarget(o.world.fx.heatLevel) < 1, 'the full mix waits for HEAT');
});

test('createRun: three lives, no Mods, the run fields E writes', () => {
  const run = createRun({ seed: 77 });
  assert.equal(run.seed, 77);
  assert.equal(run.lives, LIVES.START);
  assert.deepEqual(run.mods, []);
  assert.equal(run.overload, 0);
  assert.equal(run.freeMiss, 0);
  assert.equal(run.carryHeat, -1);
  assert.ok(run.forge && run.forge.lives === 0);
});

test('with the real systems, level 1 plays headless: embers spawn and are caught, score adds up', () => {
  const world = createWorld({ level: getLevel(1), seed: 3, systems: makeSystems() });
  const res = runHeadless(world, createRobot(), { maxSimMs: 60000 });
  assert.ok(res.steps > 0);
  assert.ok(world.econ.bricksBroken > 0, 'bricks broke');
  assert.ok(world.econ.embersCaught > 0, 'embers were caught');
  assert.ok(world.run.score > 0);
  assert.equal(world.econ.levelScore, world.run.score);
  assert.ok(Number.isFinite(world.econ.heat) && world.econ.heat >= 0 && world.econ.heat <= world.econ.heatMax);
  assert.deepEqual(world.stats.apiMissing, {});
}, { timeout: 60000 });
