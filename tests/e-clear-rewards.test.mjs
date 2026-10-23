import { test, assert } from './lib.mjs';
import { BF, BRICK, SRC, DROP, EMBERS, SIM } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { emit, createReader, next } from '../src/core/bus.js';
import { createWorld, stepWorld, setPhase } from '../src/core/world.js';
import { createInputFrame } from '../src/core/input-frame.js';
import { createRng } from '../src/core/rng.js';
import { makeSystems } from '../src/systems.js';
import { getLevel, getStage } from '../src/levels/index.js';
import { createRun } from '../src/economy/economy.js';
import { brickPoints, clearBonus } from '../src/economy/score.js';
import { SCORE } from '../src/economy/tuning.js';
import { MOD_FX } from '../src/economy/tuning.js';
import { MOD } from '../src/economy/mods.js';
import { bankRun } from '../src/economy/forge.js';
import { defaultSave } from '../src/economy/save.js';
import { CONTENT } from '../src/content/bricks.js';
import { rig, level } from './fixtures/E/rig.mjs';

const liveEmbers = w => Array.from(w.embers.alive).reduce((n, v) => n + v, 0);
const snapshot = w => [w.econ.levelScore, w.run.score, w.econ.embersCaught, w.econ.embersAutoBanked, w.run.embersBanked, w.econ.combo, w.econ.heat];
function actualWorld(def, seed = 17, run) {
  const w = createWorld({ level: def, seed, run: run || createRun({ seed, levelN: def.n }), systems: makeSystems() });
  const frame = createInputFrame();
  return { w, frame, step(n = 1) { for (let k = 0; k < n; k++) stepWorld(w, frame); } };
}
function hit(w, i, src = SRC.BALL) {
  emit(w.bus, EV.BRICK_HIT, i, w.bricks.x[i], w.bricks.y[i], -1, src);
  w.systems.content.resolve(w);
  w.systems.economy.step(w, createInputFrame());
}

test('normal final hit banks only still-live and final-hit embers; removes unused capsules without effects', () => {
  const t = actualWorld(level({ rows: ['aa..........'], drops: { rate: 0, table: {} } }));
  const { w } = t;
  hit(w, 0);
  assert.ok(liveEmbers(w) >= 2, 'ordinary play still releases catchable embers');
  // These were already missed before the win. They must never reappear in the bank.
  w.embers.alive.fill(0); w.embers.count = 0;
  w.api.spawnEmbers(100, 100, 3);
  w.api.spawnDrop(100, 120, DROP.LASER);
  w.api.spawnDrop(130, 120, DROP.SHRINK);
  const expected = createRng(0); expected.state = w.rng.economy.state;
  const finalYield = expected.int(EMBERS.MIN, EMBERS.MAX);
  hit(w, 1);
  assert.equal(w.econ.embersAutoBanked, 3 + finalYield);
  assert.equal(w.run.embersBanked, 3 + finalYield);
  assert.equal(w.econ.embersCaught, 0, 'auto-bank does not pretend the paddle caught them');
  assert.equal(w.econ.combo, 0);
  assert.equal(w.econ.heat, 0);
  assert.equal(liveEmbers(w), 0);
  assert.ok(w.drops.every(d => !d.alive));
  assert.equal(w.econ.dropsCaught, 0);
  assert.equal(w.effects.laserShots, 0);
  assert.equal(w.effects.paddleW, 120, 'the red drop was not auto-applied');
  const done = snapshot(w);
  t.step(SIM.HZ * 3);
  assert.deepEqual(snapshot(w), done, 'results do not change during the clear ceremony');
});

test('win settlement is one-time, cannot farm synthetic late events, and save banking remains idempotent', () => {
  const r = rig({ remaining: 1 });
  r.world.level.remaining = 0;
  r.emit(EV.BRICK_BROKEN, 0, 100, 200, BRICK.PLAIN, SRC.BALL); r.step();
  const done = snapshot(r.world);
  for (let k = 0; k < 3; k++) {
    r.emit(EV.BRICK_BROKEN, 0, 100, 200, BRICK.PLAIN, SRC.BALL);
    r.emit(EV.EMBER_CAUGHT, 0, 100, 200);
    r.emit(EV.DROP_CAUGHT, 0, 100, 200, DROP.LIFE);
    r.emit(EV.BOSS_HIT); r.emit(EV.BOSS_DEFEATED); r.emit(EV.PERFECT_HIT);
    r.world.api.applyDrop(DROP.LASER);
    setPhase(r.world, 'cleared'); r.step();
  }
  assert.deepEqual(snapshot(r.world), done);
  assert.equal(r.world.econ.dropsCaught, 0);
  assert.equal(r.world.effects.laserShots, 0);
  const save = defaultSave(), raw = r.world.run.embersBanked;
  assert.equal(bankRun(save, r.world.run).gain, raw);
  assert.equal(bankRun(save, r.world.run).gain, 0, 'result and subsequent run banking cannot duplicate currency');
  assert.equal(save.forge.embers, raw);
});

test('all bosses and Core stages prepay their guaranteed cascade exactly once before clear results', () => {
  for (const def of [getLevel(10), getLevel(20), getLevel(30), getStage('core-2'), getStage('core-3')]) {
    const t = actualWorld(def), { w } = t, B = w.bricks;
    const core = [...Array(B.count).keys()].find(i => B.alive[i] && B.type[i] === BRICK.WEAK && B.flags[i] & BF.BOSS);
    while (w.boss.hp > 1) {
      hit(w, core);
      t.step(Math.ceil(CONTENT.CORE_COOLDOWN_MS / SIM.DT_MS) + 1);
    }
    // Keep the carry comparison explicit: settlement grants currency, not free combo or HEAT.
    const combo = w.econ.combo, heat = w.econ.heat;
    w.api.spawnEmbers(100, 100, 2);
    const existing = liveEmbers(w), banked = w.run.embersBanked;
    const expected = createRng(0); expected.state = w.rng.economy.state;
    let deathCurrency = 0, deathScore = 0;
    for (let i = 0; i < B.count; i++) if (B.alive[i] && B.flags[i] & BF.BOSS) {
      deathCurrency += expected.int(EMBERS.MIN, EMBERS.MAX);
      deathScore += brickPoints(B.type[i], B.hpMax[i]) * w.econ.mult;
    }
    const score = w.econ.levelScore;
    const beforeBroken = w.econ.bricksBroken;
    const deathBricks = [...Array(B.count).keys()].filter(i => B.alive[i] && B.flags[i] & BF.BOSS).length;
    hit(w, core);
    assert.equal(w.econ.embersAutoBanked, existing + deathCurrency, def.id);
    assert.equal(w.run.embersBanked - banked, existing + deathCurrency);
    assert.equal(w.econ.bricksBroken - beforeBroken, deathBricks, 'guaranteed death bricks counted once');
    assert.equal(w.econ.levelScore, score + deathScore + SCORE.BOSS_HIT * w.econ.mult +
      (def.continues ? 0 : SCORE.BOSS_DEFEATED) + clearBonus(def.n, true), 'all existing brick/hit/defeat rewards and clear bonus settle once');
    assert.equal(w.econ.combo, combo);
    assert.equal(w.econ.heat, heat);
    const final = snapshot(w), rd = createReader(w.bus, 'clear-reward-test', w.bus.head);
    t.step(SIM.HZ * 4);
    assert.deepEqual(snapshot(w), final, `${def.id}: visual cascade cannot pay again`);
    assert.equal(w.boss.active, false);
    while (next(rd)) if (rd.type === EV.LEVEL_CLEARED) {
      assert.equal(rd.b, final[0]); assert.equal(rd.c, final[1], 'announced final score already includes death rewards');
    }
    if (def.continues) {
      const nextWorld = actualWorld(getStage(def.continues), 17, w.run).w;
      assert.equal(nextWorld.econ.combo, combo);
      assert.equal(nextWorld.econ.heat, heat, 'automatic currency does not inflate stage carry');
      assert.equal(nextWorld.econ.embersAutoBanked, 0, 'new-stage settlement metric starts fresh');
      assert.equal(nextWorld.run.embersBanked, final[4]);
    }
  }
});

test('Overload final-hit embers remain excluded from settlement and no unused power drop is spawned', () => {
  const r = rig({ remaining: 1, level: level({ drops: { rate: 1, table: { laser: 1 } } }) });
  r.world.level.remaining = 0;
  r.emit(EV.BRICK_BROKEN, 0, 100, 200, BRICK.PLAIN, SRC.OVERLOAD); r.step();
  assert.equal(r.world.econ.embersAutoBanked, 0);
  assert.equal(r.world.run.embersBanked, 0);
  assert.deepEqual(r.calls.drops, []);
  assert.deepEqual(r.calls.embers, []);
});

test('final-hit settlement keeps the existing seeded Burst yield and remains bounded per brick', () => {
  let doubled = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const run = createRun({ seed }); run.mods.push(MOD.BURST);
    const r = rig({ seed, run, remaining: 1 });
    const expected = createRng(0); expected.state = r.world.rng.economy.state;
    let n = expected.int(EMBERS.MIN, EMBERS.MAX);
    if (expected.chance(MOD_FX.BURST_CHANCE)) { n *= 2; doubled++; }
    r.world.level.remaining = 0;
    r.emit(EV.BRICK_BROKEN, 0, 100, 200, BRICK.PLAIN, SRC.BALL); r.step();
    assert.equal(r.world.econ.embersAutoBanked, n, `seed ${seed}`);
    assert.ok(n >= EMBERS.MIN && n <= EMBERS.MAX * 2);
  }
  assert.ok(doubled > 0 && doubled < 40, 'the sample covers both ordinary and Burst payouts');
});
