// E: Mods, pick 1 of 3 (CP2).

import { test, assert, near } from './lib.mjs';
import { EV } from '../src/core/events.js';
import { BRICK, SRC, DROP, HEAT, LIVES, PULL, SIM, SPEED, PICKS } from '../src/core/constants.js';
import { setPhase } from '../src/core/world.js';
import { createRng } from '../src/core/rng.js';
import { MODS, MOD, MOD_COUNT, modChoices, applyMod, hasMod, isModLevel } from '../src/economy/mods.js';
import { createRun } from '../src/economy/economy.js';
import { MOD_FX, DROP_FX } from '../src/economy/tuning.js';
import { rig, level } from './fixtures/E/rig.mjs';

const withMods = (ids, opts = {}) => {
  const run = createRun({ seed: 11 });
  for (const id of ids) applyMod(run, id);
  return rig({ run, ...opts });
};

test('twelve Mods, ids match their place, short facts', () => {
  assert.equal(MOD_COUNT, 12);
  MODS.forEach((m, i) => {
    assert.equal(m.id, i);
    assert.ok(m.name.length <= 14, m.name);
    assert.ok(m.fact.length <= 48, m.fact);
    assert.ok(!/\b(unleash|powerful|ultimate|epic|seamless)\b|\u2014/i.test(m.fact), m.fact);
  });
  assert.deepEqual(PICKS.MOD_LEVELS.filter(isModLevel), [13, 16, 19, 23, 26, 29]);
  assert.equal(isModLevel(14), false);
});

test('Mod choices: three different, seeded by the run and the level', () => {
  const run = createRun({ seed: 42 });
  run.levelN = 13;
  const a = modChoices(run).map((m) => m.id);
  const b = modChoices(run).map((m) => m.id);
  assert.equal(a.length, 3);
  assert.equal(new Set(a).size, 3);
  assert.deepEqual(a, b, 'same run, same level: same three');
  const seen = new Set();
  for (let s = 1; s <= 40; s++) {
    const r = createRun({ seed: s });
    r.levelN = 16;
    for (const m of modChoices(r)) seen.add(m.id);
  }
  assert.equal(seen.size, MOD_COUNT, 'every Mod can be offered');
  const viaRng = modChoices(run, createRng(5)).map((m) => m.id);
  assert.deepEqual(viaRng, modChoices(run, createRng(5)).map((m) => m.id));
});

test('taken Mods are not offered again (Extra life may repeat)', () => {
  const run = createRun({ seed: 9 });
  for (const m of MODS) if (m.id !== MOD.LIFE && m.id !== MOD.MAGNET) applyMod(run, m.id);
  for (let lv = 13; lv < 40; lv++) {
    run.levelN = lv;
    const ids = modChoices(run).map((m) => m.id).sort();
    assert.deepEqual(ids, [MOD.LIFE, MOD.MAGNET].sort());
  }
});

test('applyMod: Extra life adds a life up to five; others are taken once', () => {
  const run = createRun();
  applyMod(run, MOD.LIFE);
  applyMod(run, MOD.LIFE);
  applyMod(run, MOD.LIFE);
  assert.equal(run.lives, LIVES.MAX);
  applyMod(run, MOD.MAGNET);
  applyMod(run, MOD.MAGNET);
  assert.equal(run.mods.filter((m) => m === MOD.MAGNET).length, 1);
  assert.ok(hasMod(run, MOD.MAGNET));
  applyMod(run, 99);
  assert.equal(run.mods.length, 4);
});

test('Extra life is not offered at 5 lives; taken at 5 anyway it is a free miss', () => {
  for (let s = 1; s <= 60; s++) {
    const run = createRun({ seed: s });
    run.lives = LIVES.MAX;
    for (const lv of PICKS.MOD_LEVELS) {
      run.levelN = lv;
      const ids = modChoices(run).map((m) => m.id);
      assert.equal(ids.length, 3);
      assert.ok(!ids.includes(MOD.LIFE), `seed ${s} level ${lv}: ${ids}`);
    }
  }
  // Below max lives it stays in the pool.
  let offered = 0;
  for (let s = 1; s <= 60; s++) {
    const run = createRun({ seed: s });
    run.levelN = 13;
    if (modChoices(run).some((m) => m.id === MOD.LIFE)) offered++;
  }
  assert.ok(offered > 5, `offered below max lives in ${offered} of 60 runs`);
  // Pool short (every other Mod taken): Extra life is still offered, and it is never a dead pick.
  const full = createRun({ seed: 3 });
  full.lives = LIVES.MAX;
  for (const m of MODS) if (m.id !== MOD.LIFE && m.id !== MOD.MAGNET) applyMod(full, m.id);
  assert.deepEqual(modChoices(full).map((m) => m.id).sort(), [MOD.LIFE, MOD.MAGNET].sort());
  const before = full.freeMiss | 0;
  applyMod(full, MOD.LIFE);
  assert.equal(full.lives, LIVES.MAX);
  assert.equal(full.freeMiss, before + 1);
  // The free miss works in play: the lost ball costs no life.
  const r = rig({ run: full });
  r.emit(EV.OUT_OF_BALLS);
  r.step();
  assert.equal(r.world.run.lives, LIVES.MAX);
  assert.equal(r.events(EV.FREE_MISS).length, 1);
});

test('Big embers: 6 HEAT per ember', () => {
  const r = withMods([MOD.BIG_EMBERS]);
  r.emit(EV.EMBER_CAUGHT, 0, 360, 1000);
  r.step();
  assert.equal(r.world.econ.heat, MOD_FX.BIG_EMBER_HEAT);
});

test('Shield Mod: one shield at every level start', () => {
  const r = withMods([MOD.SHIELD]);
  assert.equal(r.world.effects.shield, 1);
  const r2 = rig({ run: r.world.run });
  assert.equal(r2.world.effects.shield, 1);
  assert.equal(rig().world.effects.shield, 0);
});

test('Slow start: a tier slower for 10 s after each launch', () => {
  const r = withMods([MOD.SLOW_START]);
  setPhase(r.world, 'play');
  r.emit(EV.LAUNCH, 0, 360, 990, 0, -460);
  r.step();
  near(r.world.effects.ballSpeedScale, SPEED.TIERS[0] / SPEED.TIERS[1], 1e-9);
  r.step(Math.floor(MOD_FX.SLOW_START_MS / SIM.DT_MS) + 1);
  assert.equal(r.world.effects.ballSpeedScale, 1);
});

test('Rich walls: drop chance ×2', () => {
  const lv = level({ drops: { rate: 0.2, table: { wide: 1 } } });
  const count = (r) => {
    for (let i = 0; i < 500; i++) r.emit(EV.BRICK_BROKEN, i, 100, 200, BRICK.PLAIN, SRC.BALL, 0);
    r.step();
    return r.calls.drops.length;
  };
  const base = count(rig({ level: lv, remaining: 600 }));
  const rich = count(withMods([MOD.DOUBLE_DROPS], { level: lv, remaining: 600 }));
  assert.ok(base > 70 && base < 130, `base ${base}`);
  assert.ok(rich > 160 && rich < 240, `rich ${rich}`);
});

test('Pierce, Magnet: fixed effects for physics', () => {
  const r = withMods([MOD.PIERCE, MOD.MAGNET]);
  assert.equal(r.world.effects.pierceFirst, MOD_FX.PIERCE_FIRST);
  assert.equal(r.world.effects.magnet, MOD_FX.MAGNET_R);
  const plain = rig();
  assert.equal(plain.world.effects.pierceFirst, 0);
  assert.equal(plain.world.effects.magnet, 0);
});

test('Long catch: Catch lasts 35 s', () => {
  const r = withMods([MOD.LONG_CATCH]);
  r.emit(EV.DROP_CAUGHT, 0, 360, 1000, DROP.CATCH);
  r.step();
  assert.ok(r.world.econ.effectMs[DROP.CATCH] > 30000);
});

test('Cheap Pull: Pull costs 26 HEAT per second', () => {
  const r = withMods([MOD.CHEAP_PULL]);
  r.world.api.addHeat(HEAT.MAX);
  r.world.paddle.pulling = true;
  r.step(SIM.HZ);
  near(r.world.econ.heat, HEAT.MAX - PULL.HEAT_PER_S * MOD_FX.CHEAP_PULL, 1e-6);
});

test('Burst: about 1 in 10 bricks drops double embers', () => {
  const r = withMods([MOD.BURST], { remaining: 3000 });
  for (let i = 0; i < 2000; i++) r.emit(EV.BRICK_BROKEN, i, 100, 200, BRICK.PLAIN, SRC.BALL, 0);
  r.step();
  const doubled = r.calls.embers.filter((n) => n > 4).length;
  const even = r.calls.embers.filter((n) => n === 4 || n === 6 || n === 8).length;
  assert.ok(doubled > 100 && doubled < 260, `doubled ${doubled}`);
  assert.ok(Math.max(...r.calls.embers) <= 8 && even > 0);
});

test('Combo floor: the multiplier never drops below ×2', () => {
  const r = withMods([MOD.COMBO_FLOOR]);
  assert.equal(r.world.econ.combo, MOD_FX.COMBO_FLOOR);
  assert.equal(r.world.econ.mult, 2);
  r.emit(EV.OUT_OF_BALLS);
  r.step();
  assert.equal(r.world.econ.combo, MOD_FX.COMBO_FLOOR);
  assert.equal(r.world.econ.mult, 2);
});

test('More lasers: 20 shots per Laser drop', () => {
  const r = withMods([MOD.MORE_LASERS]);
  r.emit(EV.DROP_CAUGHT, 0, 360, 1000, DROP.LASER);
  r.step();
  assert.equal(r.world.effects.laserShots, DROP_FX.LASER_SHOTS + MOD_FX.MORE_LASER_SHOTS);
});
