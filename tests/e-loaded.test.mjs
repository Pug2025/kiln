// Real content + economy: a loaded power releases once on break, under the ordinary damage rules.
import { test, assert } from './lib.mjs';
import { createWorld, stepWorld, setPhase } from '../src/core/world.js';
import { createInputFrame } from '../src/core/input-frame.js';
import { emit } from '../src/core/bus.js';
import { EV } from '../src/core/events.js';
import { BF, SRC, DROP } from '../src/core/constants.js';
import { createContent } from '../src/content/content.js';
import { createEconomy, createRun } from '../src/economy/economy.js';
import { getLevel } from '../src/levels/index.js';
import { level } from './fixtures/B/helpers.mjs';

function rig(material = '2', def) {
  const world = createWorld({
    level: def || level(['?..........a'], { loaded: { '0,0': material }, carriers: { '0,0': 'laser' }, drops: { rate: 0, table: { fog: 1 } } }),
    run: createRun(), seed: 1, systems: { content: createContent(), economy: createEconomy() },
  });
  const drops = [], frame = createInputFrame();
  world.api.spawnDrop = (x, y, kind) => { drops.push(kind); return drops.length - 1; };
  setPhase(world, 'play');
  const carrier = Array.from({ length: world.bricks.count }, (_, i) => i).find((i) => world.bricks.flags[i] & BF.LOADED);
  return { world, drops, carrier, hit(i = carrier, src = SRC.BALL) {
    emit(world.bus, EV.BRICK_HIT, i, world.bricks.x[i], world.bricks.y[i], 0, src, 0);
    stepWorld(world, frame);
  } };
}

test('loaded glass keeps its good power through damage and releases once only when broken', () => {
  const r = rig();
  r.hit();
  assert.equal(r.world.bricks.hp[r.carrier], 1);
  assert.deepEqual(r.drops, []);
  assert.equal(r.world.bricks.drop[r.carrier], DROP.LASER);
  r.hit();
  assert.deepEqual(r.drops, [DROP.LASER], 'fixed good power wins over the bad random table at rate zero');
  r.hit();
  assert.deepEqual(r.drops, [DROP.LASER]);
});

test('loaded armour retains three ball hits or one laser/fire hit', () => {
  const r = rig('A');
  r.hit(); r.hit();
  assert.equal(r.world.bricks.hp[r.carrier], 1);
  assert.deepEqual(r.drops, []);
  r.hit();
  assert.deepEqual(r.drops, [DROP.LASER]);
  for (const src of [SRC.LASER, SRC.FIRE, SRC.EXPLOSION, SRC.OVERLOAD, SRC.MEGA]) {
    const s = rig('A'); s.hit(s.carrier, src);
    assert.equal(s.world.bricks.alive[s.carrier], 0);
    assert.deepEqual(s.drops, [DROP.LASER], `source ${src}`);
  }
});

test('a loaded final brick retains suppression of unusable drops after the win', () => {
  const r = rig();
  r.hit(1); r.hit(); r.hit();
  assert.equal(r.world.level.remaining, 0);
  assert.deepEqual(r.drops, []);
});

test('boss loaded Laser is usable scenery and never damages the boss on release', () => {
  for (const n of [20, 30]) {
    const r = rig('2', getLevel(n));
    const hp = r.world.boss.hp;
    r.hit();
    assert.deepEqual(r.drops, []);
    r.hit();
    assert.deepEqual(r.drops, [DROP.LASER]);
    assert.equal(r.world.boss.hp, hp);
    assert.equal(r.world.level.remaining, hp);
  }
});
