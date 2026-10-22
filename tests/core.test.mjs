// Kiln — shared-layer smoke tests (written by ARCH; G owns after day one).
// These must keep passing whatever the agents build on top: they pin the contracts.

import { test, assert } from './lib.mjs';
import { SIM, FIELD, GRID, SPEED, PERFECT, COMBO, DROP_COUNT, DROP_NAMES, POOL, EMBERS } from '../src/core/constants.js';
import { EV, EV_NAME } from '../src/core/events.js';
import { createBus, emit, createReader, next } from '../src/core/bus.js';
import { createRng, dailySeed } from '../src/core/rng.js';
import { createInputFrame, clearEdges } from '../src/core/input-frame.js';
import { createWorld, stepWorld, setPhase, PIPELINE } from '../src/core/world.js';
import { runHeadless } from '../src/core/headless.js';
import { makeSystems } from '../src/systems.js';
import { getLevel, getStage, LEVELS, LEVEL_NAMES } from '../src/levels/index.js';
import { parseLevel } from '../src/levels/parser.js';
import { LEGEND } from '../src/levels/legend.js';
import { createRobot } from '../src/sim/robot.js';
import { createSave, memoryStorage } from '../src/economy/save.js';

test('handoff exact values are intact', () => {
  assert.equal(FIELD.W, 720);
  assert.equal(FIELD.H, 1080);
  assert.deepEqual([GRID.bottom.cols, GRID.bottom.cw, GRID.bottom.ch, GRID.bottom.y0], [12, 60, 30, 90]);
  assert.deepEqual([GRID.left.cols, GRID.left.rows, GRID.left.cw, GRID.left.ch], [24, 18, 30, 60]);
  assert.deepEqual(SPEED.TIERS, [460, 510, 560, 620, 690, 760]); // owner's playtest, 18:45 (lead request)
  assert.equal(PERFECT.WINDOW_MS, 60);
  assert.deepEqual(COMBO.STEPS, [[0, 1], [10, 2], [25, 3], [50, 5]]);
  assert.equal(SIM.HZ, 120);
  assert.ok(SPEED.CAP * SIM.DT < GRID.bottom.ch, 'top speed moves less than a brick per step');
});

test('constants are frozen', () => {
  assert.throws(() => { 'use strict'; SPEED.TIERS[0] = 1; });
  assert.ok(Object.isFrozen(GRID.bottom));
});

test('event codes are unique and named', () => {
  const codes = Object.values(EV);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of codes) assert.ok(EV_NAME[c], `code ${c} has a name`);
  assert.ok(codes.every((c) => c > 0 && c < 65536));
});

test('bus: every reader sees every event in order, independently', () => {
  const bus = createBus(8);
  const r1 = createReader(bus, 'one', 0);
  emit(bus, EV.BRICK_HIT, 3, 10, 20, 1, 0, 0);
  emit(bus, EV.BRICK_BROKEN, 3, 10, 20, 1, 0, 0);
  const r2 = createReader(bus, 'two', 0);
  const seen1 = [];
  while (next(r1)) seen1.push([r1.type, r1.id, r1.x]);
  assert.deepEqual(seen1, [[EV.BRICK_HIT, 3, 10], [EV.BRICK_BROKEN, 3, 10]]);
  assert.equal(next(r1), false);
  let n2 = 0;
  while (next(r2)) n2++;
  assert.equal(n2, 2);
});

test('bus: a reader that falls behind skips ahead and counts the loss', () => {
  const bus = createBus(4);
  const r = createReader(bus, 'slow', 0);
  for (let i = 0; i < 10; i++) emit(bus, EV.WALL_HIT, i);
  const ids = [];
  while (next(r)) ids.push(r.id);
  assert.deepEqual(ids, [6, 7, 8, 9]);
  assert.equal(r.lost, 6);
});

test('rng: deterministic, forks independent of order', () => {
  const a = createRng(42), b = createRng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const f1 = createRng(7).fork('economy').next();
  const root = createRng(7);
  root.fork('physics');
  assert.equal(root.fork('economy').next(), f1);
  const r = createRng(1);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(2, 4);
    assert.ok(v >= 2 && v <= 4);
  }
  assert.equal(dailySeed(new Date('2026-10-21T03:00:00Z')), dailySeed(new Date('2026-10-21T22:00:00Z')));
  assert.notEqual(dailySeed(new Date('2026-10-21T00:00:00Z')), dailySeed(new Date('2026-10-22T00:00:00Z')));
});

test('input frame: edges clear, held values stay', () => {
  const f = createInputFrame();
  f.action = true; f.overload = true; f.pull = true;
  clearEdges(f);
  assert.equal(f.action, false);
  assert.equal(f.overload, false);
  assert.equal(f.pull, true);
});

test('legend and parser: level 1 parses into the bottom grid', () => {
  const lvl = getLevel(1);
  assert.equal(lvl.name, LEVEL_NAMES[1]);
  const p = parseLevel(lvl);
  assert.ok(p.bricks.length > 0);
  assert.equal(p.clearable, p.bricks.length);
  for (const b of p.bricks) {
    assert.ok(b.x > 0 && b.x < FIELD.W && b.y > GRID.bottom.y0 && b.y < 1000);
    assert.ok(LEGEND[lvl.rows[b.row][b.col]]);
  }
  assert.throws(() => parseLevel({ ...lvl, rows: ['abc'] }), /length/);
  assert.throws(() => parseLevel({ ...lvl, rows: ['(...........'] }), /paired/);
});

test('level registry: campaign excludes continuation stages; stages resolve by id', () => {
  for (const l of LEVELS) assert.ok(!l.stage || l.stage === 1, `${l.id} is a stage 1`);
  for (const l of LEVELS) if (l.continues) assert.ok(getStage(l.continues), `${l.id} continues to a real stage`);
  assert.equal(getStage('ignition').n, 1);
  assert.equal(getStage('no-such-stage'), null);
});

test('world allocates every pool and runs the pipeline in order', () => {
  const order = [];
  const sys = (name, hooks) => {
    const s = { name, init() { order.push(`${name}.init`); } };
    for (const h of hooks) s[h] = () => order.push(`${name}.${h}`);
    return s;
  };
  const world = createWorld({
    level: getLevel(1),
    systems: { physics: sys('physics', ['pre', 'move', 'post']), content: sys('content', ['move', 'resolve']), economy: sys('economy', ['step']) },
  });
  assert.equal(world.bricks.alive.length, POOL.BRICKS);
  assert.equal(world.embers.alive.length, EMBERS.MAX_LIVE);
  assert.equal(world.econ.effectMs.length, DROP_COUNT);
  assert.equal(DROP_NAMES.length, DROP_COUNT);
  stepWorld(world, createInputFrame());
  assert.deepEqual(order, [
    'content.init', 'physics.init', 'economy.init',
    ...PIPELINE.map(([s, h]) => `${s}.${h}`),
  ]);
  assert.equal(world.step, 1);
  setPhase(world, 'play');
  assert.equal(world.phase, 'play');
  assert.throws(() => setPhase(world, 'nope'));
});

test('missing world.api calls are counted, not thrown', () => {
  const world = createWorld({ level: getLevel(1) });
  world.api.spawnEmbers(1, 2, 3);
  world.api.purgeRows(3);
  assert.equal(world.stats.apiMissing.spawnEmbers, 1);
  assert.equal(world.stats.apiMissing.purgeRows, 1);
});

function playStub(seed, simMs) {
  const world = createWorld({ level: getLevel(1), seed, systems: makeSystems() });
  const result = runHeadless(world, createRobot(), { maxSimMs: simMs });
  return { world, result };
}

test('smoke: the stub sim steps level 1 headless and stays sane', () => {
  const { world, result } = playStub(1, 60000);
  assert.ok(result.steps > 0);
  assert.ok(world.stats.paddleHits > 0, 'the ball reached the paddle');
  assert.ok(world.stats.bricksBroken > 0, 'bricks broke');
  for (const b of world.balls) {
    if (!b.alive) continue;
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
    assert.ok(b.x >= 0 && b.x <= FIELD.W && b.y >= 0 && b.y <= FIELD.H + 2 * b.r);
  }
  assert.deepEqual(world.stats.apiMissing, {}, 'every world.api call used is installed');
});

test('smoke: same seed, same game (determinism)', () => {
  const a = playStub(5, 20000), b = playStub(5, 20000);
  assert.equal(a.world.bus.head, b.world.bus.head);
  assert.equal(a.world.run.score, b.world.run.score);
  assert.equal(a.world.balls[0].x, b.world.balls[0].x);
  assert.equal(a.world.level.remaining, b.world.level.remaining);
});

test('save: round trip through a memory storage, defaults fill gaps', () => {
  const s = createSave(memoryStorage());
  const d = s.load();
  assert.equal(d.v, 1);
  d.campaign.unlocked = 4;
  d.settings.lite = true;
  s.write(d);
  const e = s.load();
  assert.equal(e.campaign.unlocked, 4);
  assert.equal(e.settings.lite, true);
  assert.equal(e.settings.music, 0.8);
});
