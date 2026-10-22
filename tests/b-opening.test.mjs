// The first powers are controlled tastes: one fixed carrier each, zero random drops.
import { test, assert } from './lib.mjs';
import { BRICK, DROP, PADDLE, SRC } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { createWorld, stepWorld, setPhase } from '../src/core/world.js';
import { createInputFrame } from '../src/core/input-frame.js';
import { emit, createReader, next } from '../src/core/bus.js';
import { makeSystems } from '../src/systems.js';
import { getLevel } from '../src/levels/index.js';
import { parseLevel } from '../src/levels/parser.js';
import { measureOpening, summarizeOpening } from '../tools/qa/opening.mjs';

const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const powers = [DROP.WIDE, DROP.MULTI];

test('opening: one exposed fixed Wide/Multi carrier and no random drops; Grid retains numbered bricks', () => {
  for (const n of [1, 2]) {
    const def = getLevel(n), parsed = parseLevel(def);
    const carriers = parsed.bricks.filter((b) => b.type === BRICK.CARRIER);
    assert.equal(carriers.length, 1, `level ${n}: one controlled power`);
    const carrier = carriers[0];
    assert.equal(carrier.drop, powers[n - 1]);
    assert.equal(carrier.hp, 1, 'no numbered brick gates the drop');
    assert.equal(def.drops.rate, 0, 'plain bricks only release embers');
    assert.deepEqual(def.drops.table, {}, 'no sprinkled random carriers');
    assert.ok(!parsed.bricks.some((b) => b.col === carrier.col && b.row > carrier.row), 'the carrier is exposed from the paddle');
    assert.ok(parsed.bricks.length <= (n === 1 ? 16 : 18), 'the opening wall stays small');
  }
  const numbered = parseLevel(getLevel(2)).bricks.filter((b) => b.type === BRICK.NUMBERED);
  assert.ok(numbered.length >= 4, 'four numbered bricks preserve the new lesson');
  assert.ok(numbered.every((b) => b.hp === 2), 'the first numbers need two hits');
});

test('opening: breaking the carrier guarantees a falling drop, while missing it grants no power', () => {
  for (const n of [1, 2]) for (const seed of [1, 7, 12]) {
    const world = createWorld({ level: getLevel(n), seed, systems: makeSystems() });
    setPhase(world, 'play');
    const rd = createReader(world.bus, 'opening-carrier', 0), events = [];
    const read = () => { while (next(rd)) events.push({ type: rd.type, kind: rd.a }); };
    const B = world.bricks;
    const carrier = Array.from({ length: B.count }, (_, i) => i).find((i) => B.type[i] === BRICK.CARRIER);
    const frame = createInputFrame();
    frame.steer = true;
    frame.tx = 660;
    frame.ty = PADDLE.Y;
    emit(world.bus, EV.BRICK_HIT, carrier, B.x[carrier], B.y[carrier], 0, SRC.BALL);
    stepWorld(world, frame);
    read();
    assert.deepEqual(events.filter((e) => e.type === EV.DROP_SPAWNED).map((e) => e.kind), [powers[n - 1]]);
    assert.equal(events.filter((e) => e.type === EV.EFFECT_ON).length, 0, 'breaking is not catching');
    // Keep the paddle away as the actual drop falls past it. The ball remains held.
    for (let k = 0; k < 500; k++) { stepWorld(world, frame); read(); }
    assert.deepEqual(events.filter((e) => e.type === EV.DROP_MISSED).map((e) => e.kind), [powers[n - 1]]);
    assert.equal(events.filter((e) => e.type === EV.DROP_CAUGHT || e.type === EV.EFFECT_ON).length, 0);
    assert.equal(world.paddle.w, PADDLE.W);
    assert.equal(world.balls.filter((b) => b.alive).length, 1);
  }
});

test('opening: full-system sample clears faster and releases both powers within 20 seconds', async () => {
  const samples = await measureOpening({ seeds: SEEDS });
  const summary = summarizeOpening(samples);
  assert.equal(samples.length, 48);
  for (const s of samples) {
    const where = `level ${s.n}, perfect ${s.perfect}, seed ${s.seed}`;
    assert.ok(s.cleared, `${where}: cleared`);
    assert.equal(s.drops.length, 1, `${where}: only the fixed drop`);
    assert.ok(s.drops[0].seconds <= 20, `${where}: early release at ${s.drops[0].seconds}s`);
    assert.ok(s.clearSeconds <= 35, `${where}: no long opening tail (${s.clearSeconds}s)`);
    assert.ok(s.maxUnproductiveOvertopSeconds <= 3, `${where}: above-wall idle trip is short (${s.maxUnproductiveOvertopSeconds}s)`);
    if (s.catches.length) {
      assert.ok(s.catches[0].seconds <= 25, `${where}: catch within the opening`);
      assert.equal(s.effects[0].kind, s.n === 1 ? 'wide' : 'multi', `${where}: the real effect activates`);
      if (s.n === 1) assert.equal(s.maxPaddleWidth, PADDLE.W_WIDE, `${where}: visibly wider paddle`);
      else assert.ok(s.maxBalls >= 3, `${where}: Multi makes three live balls`);
    }
  }
  for (const s of summary) {
    const where = `level ${s.n}, perfect ${s.perfect}`;
    assert.ok(s.medianSeconds <= (s.n === 1 ? 25 : 20), `${where}: shorter median (${s.medianSeconds}s)`);
    assert.ok(s.catches >= 10, `${where}: reachable drops (${s.catches}/12 caught)`);
  }
  const repeat = await measureOpening({ seeds: [1], levels: [1], perfectModes: [false] });
  assert.deepEqual(repeat[0], samples[0], 'same seed and controller reproduce timings and pickup events');
});
