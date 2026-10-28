// E: Overloads and the HEAT shield (CP2).

import { test, assert } from './lib.mjs';
import { EV } from '../src/core/events.js';
import { OVERLOAD, OVERLOAD_RULES, SIM, SRC, BRICK } from '../src/core/constants.js';
import { setPhase, createWorld, stepWorld } from '../src/core/world.js';
import { createInputFrame, clearEdges } from '../src/core/input-frame.js';
import { createReader, next } from '../src/core/bus.js';
import { makeSystems } from '../src/systems.js';
import { LEVELS, stagesOf } from '../src/levels/index.js';
import { OVERLOADS, chooseOverload, overloadCost, overloadPower, overloadChoices } from '../src/economy/overloads.js';
import { createRun } from '../src/economy/economy.js';
import { OVERLOAD_COST, OVERLOAD_VENT_MS, QUENCH_SCALE, SHIELD, MOD_FX, FORGE_FX } from '../src/economy/tuning.js';
import { FORGE_ITEMS } from '../src/economy/forge.js';
import { MOD, applyMod } from '../src/economy/mods.js';
import { rig, level } from './fixtures/E/rig.mjs';

function armed(id, opts = {}) {
  const run = createRun({ seed: 3, save: opts.save });
  chooseOverload(run, id);
  const r = rig({ run, level: level({ n: 22, rules: { overloads: true, heat: true, pull: true } }) });
  setPhase(r.world, 'play');
  return r;
}
const fill = (r, heat) => { r.world.api.addHeat(heat); r.step(); };
const fire = (r) => { r.frame.overload = true; r.step(); };

test('Overload data for the pick screen; one per run', () => {
  assert.deepEqual(OVERLOADS.map((o) => o.name), ['Purge', 'Quench', 'Fork']);
  assert.deepEqual(OVERLOADS.map((o) => o.cost), [75, 50, 60]);
  const run = createRun();
  assert.equal(chooseOverload(run, OVERLOAD.QUENCH), true);
  assert.equal(chooseOverload(run, OVERLOAD.PURGE), false, 'one per run');
  assert.equal(run.overload, OVERLOAD.QUENCH);
  assert.equal(chooseOverload(createRun(), 9), false);
});

test('Purge clears the lowest 3 rows, ready at 75 HEAT, and spends the whole meter', () => {
  const r = armed(OVERLOAD.PURGE);
  assert.equal(r.world.econ.overloadCost, OVERLOAD_COST[OVERLOAD.PURGE]);
  fill(r, 70);
  fire(r);
  assert.equal(r.calls.purge.length, 0, 'not enough HEAT: nothing');
  assert.equal(r.world.econ.heat, 70);
  fill(r, 20);
  fire(r);
  assert.deepEqual(r.calls.purge, [OVERLOAD_RULES.PURGE_ROWS]);
  assert.equal(r.world.econ.heat, 0, 'the whole meter');
  const ev = r.events(EV.OVERLOAD_FIRED);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].a, ev[0].b], [OVERLOAD.PURGE, 90]);
});

test('Quench slows all balls for 3 s', () => {
  const r = armed(OVERLOAD.QUENCH);
  fill(r, 60);
  fire(r);
  assert.equal(r.world.effects.ballSpeedScale, QUENCH_SCALE);
  r.step(Math.floor(OVERLOAD_RULES.QUENCH_MS / SIM.DT_MS) - 3);
  assert.equal(r.world.effects.ballSpeedScale, QUENCH_SCALE);
  r.step(4);
  assert.equal(r.world.effects.ballSpeedScale, 1);
});

test('Fork splits every ball', () => {
  const r = armed(OVERLOAD.FORK);
  fill(r, 60);
  fire(r);
  assert.deepEqual(r.calls.split, [1]);
  assert.equal(r.world.econ.heat, 0);
});

test('Overloads only fire in play; the input is an edge', () => {
  const r = armed(OVERLOAD.FORK);
  fill(r, 100);
  setPhase(r.world, 'cleared');
  fire(r);
  assert.equal(r.calls.split.length, 0);
  setPhase(r.world, 'play');
  fire(r);
  r.step(10);
  assert.equal(r.calls.split.length, 1, 'one press, one Fork');
});

test('The Forge shortens the vent at every rank and makes Overloads stronger; the cost stays', () => {
  const at = (rank) => createRun({ save: { forge: { ranks: { overload: rank } } } });
  assert.deepEqual(overloadPower(createRun()), { ventMs: 12000, purgeRows: 3, quenchMs: 3000, forkExtra: 1 });
  assert.deepEqual(overloadPower(at(1)), { ventMs: 10000, purgeRows: 4, quenchMs: 4000, forkExtra: 1 });
  assert.deepEqual(overloadPower(at(2)), { ventMs: 8000, purgeRows: 4, quenchMs: 5000, forkExtra: 2 });
  assert.deepEqual(overloadPower(at(3)), { ventMs: 6000, purgeRows: 5, quenchMs: 6000, forkExtra: 2 });
  for (let rank = 1; rank <= 3; rank++) {
    const p = overloadPower(at(rank)), q = overloadPower(at(rank - 1));
    assert.ok(p.ventMs < q.ventMs, `rank ${rank} shortens the vent`);
    assert.ok(p.purgeRows >= q.purgeRows && p.quenchMs > q.quenchMs && p.forkExtra >= q.forkExtra, `rank ${rank} weakens nothing`);
    // The price is only the ready line (the vent spaces Overloads out), so ranks leave it alone.
    for (const id of [OVERLOAD.PURGE, OVERLOAD.QUENCH, OVERLOAD.FORK]) assert.equal(overloadCost(at(rank), id), OVERLOAD_COST[id]);
  }
  const r = armed(OVERLOAD.PURGE, { save: { forge: { ranks: { overload: 2 } } } });
  assert.equal(r.world.econ.overloadCost, 75);
  fill(r, 80);
  fire(r);
  assert.deepEqual(r.calls.purge, [4], 'rank 2 Purge: 4 rows');
  assert.equal(r.world.econ.heat, 0);
  assert.ok(r.world.econ.ventMs > 8000 - 2 * SIM.DT_MS && r.world.econ.ventMs <= 8000, 'rank 2 vents 8 s');
  r.step(steps(8000) + 1);
  assert.equal(r.world.econ.ventMs, 0);
  const f = armed(OVERLOAD.FORK, { save: { forge: { ranks: { overload: 2 } } } });
  fill(f, 60);
  fire(f);
  assert.deepEqual(f.calls.split, [2], 'rank 2 Fork: every ball becomes three');
});

test('the Overload pick cards state the run\'s own power (The Forge ranks), not rank 0', () => {
  const at = (rank) => createRun({ save: { forge: { ranks: { overload: rank } } } });
  assert.deepEqual(overloadChoices(createRun()).map((o) => o.fact), OVERLOADS.map((o) => o.fact), 'rank 0 matches the static cards');
  for (let rank = 0; rank <= 3; rank++) {
    const pw = overloadPower(at(rank));
    const cards = overloadChoices(at(rank));
    assert.deepEqual(cards.map((o) => o.id), [OVERLOAD.PURGE, OVERLOAD.QUENCH, OVERLOAD.FORK]);
    assert.deepEqual(cards.map((o) => o.cost), [75, 50, 60]);
    assert.ok(cards[0].fact.includes(`${pw.purgeRows} rows`), `rank ${rank}: ${cards[0].fact}`);
    assert.ok(cards[1].fact.includes(`${pw.quenchMs / 1000} s`), `rank ${rank}: ${cards[1].fact}`);
    assert.ok(cards[2].fact.endsWith(['two', 'three', 'four'][pw.forkExtra - 1]), `rank ${rank}: ${cards[2].fact}`);
    for (const c of cards) assert.ok(c.fact.length <= 40, `short fact: ${c.fact}`);
  }
});

test('The Forge\'s Overload facts give each rank\'s total from no upgrade, in the tuning\'s numbers', () => {
  const it = FORGE_ITEMS.find((x) => x.id === 'overload');
  const facts = it.ranks.map((f) => f.replace(/ /g, ' ')); // parts are kept whole with no-break spaces
  assert.equal(new Set(facts).size, facts.length, 'no two ranks read the same');
  for (let rank = 1; rank <= 3; rank++) {
    const fact = facts[rank - 1];
    const has = (s) => assert.ok(fact.includes(s), `rank ${rank} "${fact}" says "${s}"`);
    // The Forge shows the next rank's fact, and the top rank's once maxed, so each fact is the
    // total against no upgrade (like 'Paddle 17% wider'), never a step from the rank before.
    const total = (t) => t[rank] - t[0];
    const vent = -total(FORGE_FX.VENT_MS) / 1000, rows = total(FORGE_FX.PURGE_ROWS);
    const quench = total(FORGE_FX.QUENCH_MS) / 1000, fork = total(FORGE_FX.FORK_EXTRA);
    assert.ok(vent > 0, 'every rank shortens the HEAT pause');
    has(`HEAT pause ${vent} s shorter`);
    if (rows) has(`Purge +${rows} row${rows === 1 ? '' : 's'}`);
    else assert.ok(!fact.includes('Purge'), `rank ${rank} does not claim more Purge rows`);
    if (quench) has(`Quench +${quench} s`);
    else assert.ok(!fact.includes('Quench'), `rank ${rank} does not claim a longer Quench`);
    // splitBalls(n) makes every ball n + 1, as that rank's pick card says ('Splits each ball into three')
    if (fork) has(`Fork into ${FORGE_FX.FORK_EXTRA[rank] + 1}`);
    else assert.ok(!fact.includes('Fork'), `rank ${rank} does not claim a bigger Fork`);
    assert.ok(!/cost|;|−/i.test(fact), 'no cost claim (the Forge does not change it), no semicolon fragments, no minus signs');
  }
});

const steps = (ms) => Math.ceil(ms / SIM.DT_MS);

test('a Purge cannot refill its own cost: its bricks and the blasts it sets off pay points, no embers', () => {
  const r = armed(OVERLOAD.PURGE);
  fill(r, 100);
  fire(r);
  // Three rows of an Overload's own bricks, one of them explosive.
  r.emit(EV.BRICK_BROKEN, 5, 100, 600, BRICK.EXPLOSIVE, SRC.OVERLOAD, -1);
  for (let i = 6; i < 6 + 35; i++) r.emit(EV.BRICK_BROKEN, i, 100, 600, BRICK.PLAIN, SRC.OVERLOAD, -1);
  r.step();
  assert.equal(r.calls.embers.length, 0, 'no embers from the Purge itself');
  assert.ok(r.world.econ.levelScore > 0, 'the bricks still score');
  // The explosive brick's blast, and the chain it sets off, are the Purge's work too.
  r.emit(EV.EXPLOSION, 5, 100, 600, 1);
  r.emit(EV.BRICK_BROKEN, 50, 100, 570, BRICK.EXPLOSIVE, SRC.EXPLOSION, -1);
  r.emit(EV.BRICK_BROKEN, 51, 160, 570, BRICK.PLAIN, SRC.EXPLOSION, -1);
  r.step();
  r.emit(EV.EXPLOSION, 50, 100, 570, 1);
  r.emit(EV.BRICK_BROKEN, 52, 100, 540, BRICK.PLAIN, SRC.EXPLOSION, -1);
  r.step();
  assert.equal(r.calls.embers.length, 0, 'no embers from the chain');
  // A blast the ball set off pays as before.
  r.emit(EV.BRICK_BROKEN, 60, 300, 400, BRICK.EXPLOSIVE, SRC.BALL, 0);
  r.emit(EV.EXPLOSION, 60, 300, 400, 1);
  r.emit(EV.BRICK_BROKEN, 61, 300, 370, BRICK.PLAIN, SRC.EXPLOSION, -1);
  r.step();
  assert.equal(r.calls.embers.length, 2, 'the ball\'s brick and its blast burst embers');
});

test('a Purge on 22 Overload (real systems): no embers from its bricks, HEAT stays spent', () => {
  const l = LEVELS.find((x) => x.n === 22);
  const run = createRun({ seed: 1, levelN: 22 });
  chooseOverload(run, OVERLOAD.PURGE);
  const world = createWorld({ level: stagesOf(l)[0], seed: 1, run, systems: makeSystems() });
  const rd = createReader(world.bus, 'test', 0);
  const frame = createInputFrame();
  stepWorld(world, frame);
  while (next(rd)) { /* skip the level build */ }
  world.econ.heat = world.econ.heatMax;
  frame.overload = true;
  let purged = 0, bursts = 0;
  for (let i = 0; i < steps(1000); i++) {
    stepWorld(world, frame);
    clearEdges(frame);
    while (next(rd)) {
      if (rd.type === EV.BRICK_BROKEN && rd.b === SRC.OVERLOAD) purged++;
      if (rd.type === EV.EMBERS_BURST) bursts++;
    }
  }
  assert.ok(purged >= 12, `the Purge broke ${purged} bricks`);
  assert.equal(bursts, 0, 'nothing but the Purge broke bricks (the ball waits on the paddle)');
  assert.equal(world.econ.heat, 0, 'the meter stays spent');
});

test('after an Overload the meter vents for 12 s of play: embers pay combo and points, not HEAT', () => {
  const r = armed(OVERLOAD.QUENCH);
  fill(r, 100);
  fire(r);
  assert.equal(r.world.econ.heat, 0);
  assert.ok(r.world.econ.ventMs > OVERLOAD_VENT_MS - 2 * SIM.DT_MS, 'the vent starts');
  r.emit(EV.EMBER_CAUGHT, 0, 360, 1000);
  r.step();
  assert.equal(r.world.econ.heat, 0, 'no HEAT while venting');
  assert.equal(r.world.econ.combo, 1, 'combo still counts');
  assert.ok(r.world.econ.levelScore > 0, 'and points');
  r.world.econ.heat = 100; // even with HEAT (none can arrive), nothing fires while venting
  fire(r);
  assert.equal(r.events(EV.OVERLOAD_FIRED).length, 1);
  r.world.econ.heat = 0;
  // Only play time vents: a ball waiting on the paddle does not run the clock down.
  setPhase(r.world, 'serve');
  const left = r.world.econ.ventMs;
  r.step(steps(20000));
  assert.equal(r.world.econ.ventMs, left);
  setPhase(r.world, 'play');
  r.step(steps(left));
  assert.equal(r.world.econ.ventMs, 0);
  r.emit(EV.EMBER_CAUGHT, 0, 360, 1000);
  r.step();
  assert.equal(r.world.econ.heat, 4, 'the meter fills again');
  r.world.api.addHeat(50);
  fire(r);
  assert.equal(r.events(EV.OVERLOAD_FIRED).length, 2, 'and the next one fires at its cost');
});

test('before an Overload: one shield a level, for a full meter, where the meter is in play', () => {
  const r = rig({ level: level({ n: 8, rules: { pull: true, heat: true } }) });
  setPhase(r.world, 'play');
  assert.equal(SHIELD.COST, 100);
  assert.equal(r.world.econ.shieldCost, SHIELD.COST);
  fill(r, 90);
  fire(r);
  assert.equal(r.world.effects.shield, 0, 'not a full meter: nothing');
  fill(r, 10);
  fire(r);
  assert.equal(r.world.effects.shield, 1);
  assert.equal(r.world.econ.heat, 0);
  assert.equal(r.world.econ.shieldCost, 0, 'none left this level: the HUD hides it');
  const bought = r.events(EV.SHIELD_BOUGHT);
  assert.equal(bought.length, 1);
  assert.equal(bought[0].a, 100);
  r.emit(EV.SHIELD_USED, 0, 360, 1000);
  r.step();
  assert.equal(r.world.effects.shield, 0);
  fill(r, 100);
  fire(r);
  assert.equal(r.world.effects.shield, 0, 'one a level');
  assert.equal(r.world.econ.heat, 100);
  // The next level sells one again.
  const r2 = rig({ run: r.world.run, level: level({ n: 9, rules: { pull: true, heat: true } }) });
  setPhase(r2.world, 'play');
  assert.equal(r2.world.econ.shieldCost, SHIELD.COST);
  fill(r2, 100);
  fire(r2);
  assert.equal(r2.world.effects.shield, 1);
  // No meter (levels 1-6): nothing.
  const early = rig({ level: level({ n: 2 }) });
  setPhase(early.world, 'play');
  fill(early, 100);
  fire(early);
  assert.equal(early.world.effects.shield, 0);
});

test('a bought shield holds 20 s of play, then goes; the Shield Mod\'s never runs out', () => {
  const buy = () => {
    const r = rig({ level: level({ n: 8, rules: { pull: true, heat: true } }) });
    setPhase(r.world, 'play');
    fill(r, 100);
    fire(r);
    assert.equal(r.world.effects.shield, 1);
    return r;
  };
  const r = buy();
  assert.ok(r.world.econ.shieldMs > SHIELD.HOLD_MS - 2 * SIM.DT_MS, 'econ.shieldMs shows the time left');
  setPhase(r.world, 'serve');
  r.step(steps(SHIELD.HOLD_MS) + 10);
  assert.equal(r.world.effects.shield, 1, 'a ball waiting on the paddle does not use it up');
  setPhase(r.world, 'play');
  r.step(steps(SHIELD.HOLD_MS) - 3);
  assert.equal(r.world.effects.shield, 1);
  r.step(4);
  assert.equal(r.world.effects.shield, 0, 'gone after 20 s of play');
  assert.equal(r.events(EV.SHIELD_GONE).length, 1);
  // Used before its time: no SHIELD_GONE later.
  const u = buy();
  u.emit(EV.SHIELD_USED, 0, 360, 1000);
  u.step(steps(SHIELD.HOLD_MS) + 10);
  assert.equal(u.world.effects.shield, 0);
  assert.equal(u.events(EV.SHIELD_GONE).length, 0);
  // The Shield Mod's free shield holds until used.
  const run = createRun({ seed: 2 });
  applyMod(run, MOD.SHIELD);
  const m = rig({ run, level: level({ n: 8, rules: { pull: true, heat: true } }) });
  setPhase(m.world, 'play');
  assert.equal(m.world.effects.shield, MOD_FX.SHIELD_AT_START);
  m.step(steps(SHIELD.HOLD_MS * 2));
  assert.equal(m.world.effects.shield, 1);
});

