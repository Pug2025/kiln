// B: Overburn, the endless daily walls (src/levels/overburn.js).

import { test, assert } from './lib.mjs';
import { generateOverburn, RULES, rulePresent, waveParams } from '../src/levels/overburn.js';
import { parseLevel, checkLevel } from '../src/levels/parser.js';
import { dailySeed } from '../src/core/rng.js';
import { createWorld } from '../src/core/world.js';
import { runHeadless } from '../src/core/headless.js';
import { makeSystems } from '../src/systems.js';
import { createRun } from '../src/economy/economy.js';
import { createRobot } from '../src/sim/robot.js';

const SEEDS = [1, 777, dailySeed(new Date('2026-10-21T12:00:00Z'))];

test('Overburn waves 1–20 parse and are deterministic for a seed', () => {
  for (const seed of SEEDS) {
    for (let wave = 1; wave <= 20; wave++) {
      const a = generateOverburn(seed, wave);
      const b = generateOverburn(seed, wave);
      assert.deepEqual(a, b, `seed ${seed} wave ${wave}`);
      const p = parseLevel(a);
      assert.ok(p.clearable > 0, `seed ${seed} wave ${wave} has bricks`);
      assert.equal(a.n, 30 + wave);
      assert.equal(a.world, 'overburn');
    }
  }
  assert.notDeepEqual(generateOverburn(SEEDS[0], 5).rows, generateOverburn(SEEDS[1], 5).rows, 'another day, another wall');
});

test('every wave passes the campaign design checks (fair, reachable, no loop traps, sits low)', () => {
  for (const seed of SEEDS) {
    for (let wave = 1; wave <= 20; wave++) assert.deepEqual(checkLevel(generateOverburn(seed, wave)), [], `seed ${seed} wave ${wave}`);
  }
});

test('each wave brings one new rule, and the wall carries it (many seeds)', () => {
  const seeds = [...SEEDS, ...Array.from({ length: 80 }, (_, k) => 7919 * (k + 1) + 13)];
  for (const seed of seeds) {
    for (let wave = 1; wave <= RULES.length; wave++) {
      const d = generateOverburn(seed, wave);
      assert.equal(d.adds, RULES[wave - 1].label, `seed ${seed} wave ${wave}: no fallback wall`);
      assert.ok(rulePresent(d, RULES[wave - 1].id), `seed ${seed} wave ${wave}: "${d.adds}" is in the wall`);
    }
    assert.equal(generateOverburn(seed, 13).mode, 'left');
    assert.equal(generateOverburn(seed, 14).mode, 'ring');
    assert.ok(generateOverburn(seed, 15).rules.dark);
    assert.ok(generateOverburn(seed, 20).adds.trim(), 'later waves retain a visible difficulty label');
  }
  // the predicate itself: a wall without the rule fails it
  const plain = generateOverburn(1, 1);
  for (const id of ['numbered', 'explosive', 'armour', 'moving', 'indestructible', 'gravity', 'sentries', 'cavity', 'portals', 'march', 'left', 'ring', 'dark', 'ghosts']) {
    assert.ok(!rulePresent(plain, id), `wave 1 has no ${id}`);
  }
});

test('ring waves carry no Multi drop (balls leave on every side)', () => {
  let rings = 0;
  for (let seed = 1; seed <= 40; seed++) {
    for (let wave = 14; wave <= 30; wave++) {
      const d = generateOverburn(seed, wave);
      if (d.mode !== 'ring') continue;
      rings++;
      assert.ok(!('multi' in d.drops.table), `seed ${seed} wave ${wave}`);
    }
  }
  assert.ok(rings >= 40, `ring waves seen: ${rings}`);
  assert.ok(generateOverburn(1, 1).drops.table.multi > 0, 'bottom waves keep Multi');
});

test('the walls get hotter every wave: nothing eases, and past the rules something rises', () => {
  const harder = (p, q) => ['tier', 'height', 'density', 'digitMax', 'armour', 'black', 'movingRows', 'drifters'].filter((k) => q[k] > p[k]).length + (q.marchMs < p.marchMs ? 1 : 0);
  for (let wave = 2; wave <= 40; wave++) {
    const p = waveParams(wave - 1), q = waveParams(wave);
    for (const k of ['tier', 'height', 'density', 'digitMax', 'armour', 'black', 'movingRows', 'drifters']) assert.ok(q[k] >= p[k], `wave ${wave}: ${k} never drops`);
    assert.ok(q.marchMs <= p.marchMs, `wave ${wave}: the march never slows`);
    if (wave > RULES.length && wave <= 38) assert.ok(harder(p, q) >= 1, `wave ${wave} ("Hotter") is hotter than wave ${wave - 1}`);
  }
  for (const seed of SEEDS) {
    const tiers = Array.from({ length: 30 }, (_, k) => generateOverburn(seed, k + 1).tier);
    for (let k = 1; k < tiers.length; k++) assert.ok(tiers[k] >= tiers[k - 1], 'speed never drops');
  }
  // the walls show it: armour share past the rules climbs (40 seeds, waves 17 and 30)
  const share = (wave) => {
    let a = 0, all = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = generateOverburn(seed, wave).rows.join('');
      a += (s.match(/A/g) || []).length;
      all += s.replace(/[.()[\]{}*]/g, '').length;
    }
    return a / all;
  };
  assert.ok(share(30) > share(17) * 1.5, `armour share ${share(17).toFixed(3)} -> ${share(30).toFixed(3)}`);
});

test('every field mode gets hotter: bottom, sideways and ring walls (armour, black bricks, numbers)', () => {
  // per mode, over enough seeds that each mode turns up 20+ times at both waves
  const stats = (wave) => {
    const by = {};
    for (let seed = 1; seed <= 300; seed++) {
      const d = generateOverburn(seed * 7919 + 3, wave);
      const s = d.rows.join('');
      const o = (by[d.mode] ||= { n: 0, A: 0, X: 0, all: 0, dmax: 0, sent: 0, moving: 0, shapes: new Set() });
      o.n++;
      o.A += (s.match(/A/g) || []).length;
      o.X += (s.match(/X/g) || []).length;
      o.all += s.replace(/[.()[\]{}*]/g, '').length;
      for (const ch of s) if (ch >= '2' && ch <= '9') o.dmax = Math.max(o.dmax, Number(ch));
      if (d.sentries && d.sentries.length) o.sent++;
      if (d.motion && d.motion.length) o.moving++;
      o.shapes.add(s.replace(/[^.]/g, '#'));
    }
    return by;
  };
  const w17 = stats(17), w30 = stats(30);
  for (const mode of ['bottom', 'left', 'ring']) {
    const p = w17[mode], q = w30[mode];
    assert.ok(p && q && p.n >= 20 && q.n >= 20, `${mode}: seen at waves 17 and 30 (${p && p.n}, ${q && q.n})`);
    assert.ok(q.A / q.all > (p.A / p.all) * 1.5, `${mode}: armour ${(p.A / p.all).toFixed(3)} -> ${(q.A / q.all).toFixed(3)}`);
    assert.ok(q.X / q.all > p.X / p.all, `${mode}: black bricks ${(p.X / p.all).toFixed(3)} -> ${(q.X / q.all).toFixed(3)}`);
    assert.ok(q.dmax > p.dmax, `${mode}: numbers go higher (${p.dmax} -> ${q.dmax})`);
    assert.ok(p.A > 0 && p.sent > 0, `${mode}: armour and sentries at wave 17 already`);
    assert.ok(q.shapes.size >= q.n * 0.8, `${mode}: the walls vary (${q.shapes.size} outlines of ${q.n})`);
  }
  assert.ok(w30.left.moving > 0, 'sideways walls slide columns');
});

test('the robot clears Overburn waves 1–8 (seed 1)', () => {
  const run = createRun({ seed: 1 });
  for (let wave = 1; wave <= 8; wave++) {
    const def = generateOverburn(1, wave);
    const world = createWorld({ level: def, seed: 1 + wave, run, systems: makeSystems() });
    const r = runHeadless(world, createRobot(), { maxSimMs: 6 * 60 * 1000 });
    assert.ok(r.cleared, `wave ${wave}: ${r.phase}, ${r.remaining} left`);
  }
}, { timeout: 60000 });
