// Exact moving-boss cast equivalence against the frozen pre-cache implementation.
import { test, assert } from './lib.mjs';
import { BF, SIM, RING } from '../src/core/constants.js';
import { createBrickGrid, rebuildGrid } from '../src/sim/collide.js';
import { createCaster, castPath, createMotion, updateMotion, inherit } from '../src/sim/aim.js';
import { modeCode, M_BOTTOM, M_LEFT, M_RING, RING_FACE } from '../src/sim/field.js';
import { getLevel, stagesOf } from '../src/levels/index.js';
import { contentWorld } from './fixtures/B/helpers.mjs';
import { physicsWorld } from './fixtures/A/sim.mjs';
import { castPathReference } from './fixtures/A/aim-reference.mjs';

const outputs = c => ({ brick: c.brick, sentry: c.sentry, dist: c.dist, bounces: c.bounces,
  back: c.back, x: c.x, y: c.y, vx: c.vx, vy: c.vy, nx: c.nx, ny: c.ny, hit: { ...c.hit } });

function pair(world) {
  const grid = createBrickGrid(world.bricks.alive.length), motion = createMotion();
  rebuildGrid(grid, world.bricks); updateMotion(motion, world, grid);
  const actual = createCaster(world.bricks.alive.length), expected = createCaster(world.bricks.alive.length);
  actual.motion = expected.motion = motion;
  return { world, grid, motion, actual, expected };
}

function compare(p, args, { spin = 0, speed = 500, t0 = 0, decay = speed } = {}) {
  for (const c of [p.actual, p.expected]) Object.assign(c, { spin, speed, t0, decay });
  castPath(p.actual, p.world, p.grid, ...args);
  castPathReference(p.expected, p.world, p.grid, ...args);
  assert.deepEqual(outputs(p.actual), outputs(p.expected), `exact cast: ${JSON.stringify({ args, spin, speed, t0, decay })}`);
}

function single({ omega = 1, radius = 60, speedX = 0, speedY = 0, plateCount = 1 } = {}) {
  const cx = 360, cy = 500, bricks = [];
  for (let k = 0; k < plateCount; k++) {
    const a = -Math.PI / 2 + k * Math.PI * 2 / plateCount;
    bricks.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius,
      w: 30, h: 30, flags: BF.SOLID | BF.BREAKABLE | BF.BOSS | BF.MOVING });
  }
  const { world } = physicsWorld({ bricks });
  Object.assign(world.boss, { active: true, x: cx, y: cy, px: cx - speedX * SIM.DT, py: cy - speedY * SIM.DT });
  const B = world.bricks, c = Math.cos(-omega * SIM.DT), s = Math.sin(-omega * SIM.DT);
  for (let k = 0; k < B.count; k++) {
    const rx = B.x[k] - cx, ry = B.y[k] - cy;
    B.px[k] = world.boss.px + rx * c - ry * s;
    B.py[k] = world.boss.py + rx * s + ry * c;
  }
  return pair(world);
}

test('cached casts and rebounds exactly match uncached casts across every boss, pose, mode and spin', () => {
  let cases = 0, rebounds = 0;
  for (const def of [getLevel(10), getLevel(20), ...stagesOf(getLevel(30))]) {
    const env = contentWorld(def), w = env.world, p = pair(w), B = w.bricks, mc = modeCode(def.mode);
    for (let pose = 0; pose < 4; pose++) {
      env.step(pose ? [0, 17, 104, 252][pose] : 0);
      // Exercise both directions/speeds of the orbit rings through actual counted core hits.
      if (pose === 2 && w.boss.id !== 'stoker') {
        const weak = [...Array(B.count).keys()].find(i => B.alive[i] && (B.flags[i] & BF.WEAK));
        for (let hit = 0; hit < 12 && w.boss.hp > w.boss.hpMax / 2; hit++) { env.hit(weak); env.step(61); }
      }
      rebuildGrid(p.grid, B); updateMotion(p.motion, w, p.grid);
      const state = { robot: w.rng.robot.state, physics: w.rng.physics.state, version: B.version,
        hp: [...B.hp], flags: [...B.flags], x: [...B.x], y: [...B.y] };
      for (let ray = 0; ray < 12; ray++) {
        let x, y;
        if (mc === M_RING) {
          const a = ray * Math.PI * 2 / 12;
          x = RING.CX + Math.cos(a) * (RING_FACE - 25); y = RING.CY + Math.sin(a) * (RING_FACE - 25);
        } else if (mc === M_LEFT) { x = 50; y = 100 + ray * 80; }
        else { x = 35 + ray * 59; y = 970; }
        const a = Math.atan2(w.boss.y - y, w.boss.x - x) + (ray % 3 - 1) * 0.27;
        const args = [mc, x, y, Math.cos(a), Math.sin(a), [0, 9, 24][ray % 3], 8, 6000, ray % 4 ? -1 : p.motion.idx[0]];
        compare(p, args, { spin: [0, 1, -1, 0.5][ray % 4], speed: [500.5, 1100, 1400][ray % 3], t0: [0, 0.17, 1.125][ray % 3] });
        cases++;
        if (p.actual.brick >= 0) {
          let dx = p.actual.vx, dy = p.actual.vy;
          const d = dx * p.actual.nx + dy * p.actual.ny;
          if (d < 0) { dx -= 2 * d * p.actual.nx; dy -= 2 * d * p.actual.ny; }
          const nextActual = createCaster(B.alive.length), nextExpected = createCaster(B.alive.length);
          nextActual.motion = nextExpected.motion = p.motion;
          inherit(p.actual, nextActual); inherit(p.expected, nextExpected);
          const rebound = [mc, p.actual.x + p.actual.nx * 0.05, p.actual.y + p.actual.ny * 0.05,
            dx, dy, args[5], 5, 1800, B.hp[p.actual.brick] <= 1 ? p.actual.brick : -1];
          castPath(nextActual, w, p.grid, ...rebound); castPathReference(nextExpected, w, p.grid, ...rebound);
          assert.deepEqual(outputs(nextActual), outputs(nextExpected), `${def.id} pose ${pose} ray ${ray} rebound`);
          rebounds++;
        }
      }
      assert.deepEqual({ robot: w.rng.robot.state, physics: w.rng.physics.state, version: B.version,
        hp: [...B.hp], flags: [...B.flags], x: [...B.x], y: [...B.y] }, state, 'casting never changes simulation or RNG');
    }
  }
  assert.equal(cases, 240);
  assert.ok(rebounds >= 20, `${rebounds} real-hit rebounds tested`);
});

test('repeated exact future times reuse retained positions without more trigonometry', () => {
  const p = single(), args = [M_BOTTOM, 360, 470, 0, -1, 9, 0, 1];
  const cos = Math.cos, sin = Math.sin; let calls = 0;
  const storage = [p.motion.cache.positions, p.motion.cache.times, p.motion.cache.stamps, p.motion.cache.input];
  try {
    Math.cos = x => { calls++; return cos(x); }; Math.sin = x => { calls++; return sin(x); };
    for (const c of [p.actual, p.expected]) Object.assign(c, { spin: 0, decay: 500, speed: 500, t0: 0 });
    castPath(p.actual, p.world, p.grid, ...args);
    assert.equal(calls, 4 * p.motion.n, 'two endpoints computed once');
    const first = outputs(p.actual); calls = 0;
    for (let n = 0; n < 20; n++) castPath(p.actual, p.world, p.grid, ...args);
    assert.equal(calls, 0, 'same time keys do not recalculate moving plates');
    assert.deepEqual(outputs(p.actual), first);
    p.actual.t0 = Number.MIN_VALUE; castPath(p.actual, p.world, p.grid, ...args);
    assert.ok(calls > 0, 'an adjacent positive double is not rounded into the zero-time key');
  } finally { Math.cos = cos; Math.sin = sin; }
  [p.motion.cache.positions, p.motion.cache.times, p.motion.cache.stamps, p.motion.cache.input]
    .forEach((buffer, i) => assert.equal(buffer, storage[i]));
  assert.ok(p.motion.cache.positions.byteLength <= 256 * 1024, 'bounded position storage, no growing Map');
});

test('colliding endpoint keys stay valid when the bounded cache is full and repeatedly evicted', () => {
  const p = single(), cache = p.motion.cache;
  cache.stamps.fill(cache.epoch); cache.times.fill(123); cache.positions.fill(NaN); cache.next.fill(0);
  // 0 and .12 hash to the same set; a 60-unit segment at speed 500 uses those two endpoints.
  compare(p, [M_BOTTOM, 360, 500, 0, -1, 9, 0, 60]);
  const current = [...cache.times].filter((t, i) => cache.stamps[i] === cache.epoch && (t === 0 || t === 0.12));
  assert.equal(current.length, 2, 'both exact endpoints survive a same-set lookup');
  const buffers = [cache.positions.buffer, cache.times.buffer, cache.stamps.buffer];
  for (let n = 0; n < 300; n++) compare(p, [M_BOTTOM, 360 + n % 7, 500, 0, -1, 9, 0, 60], { t0: n / 1000 });
  [cache.positions.buffer, cache.times.buffer, cache.stamps.buffer].forEach((buffer, i) => assert.equal(buffer, buffers[i]));
});

test('snapshot refresh, inactivity, a new boss and generation wrap cannot reuse stale positions', () => {
  const p = single({ speedX: 23, speedY: -11 }), args = [M_BOTTOM, 360, 500, 0, -1, 9, 3, 800];
  compare(p, args, { t0: 0.4 });
  const cache = p.motion.cache, positions = cache.positions, epoch = cache.epoch;
  p.world.bricks.x[0] += 50; p.world.bricks.px[0] += 50;
  p.world.boss.x += 17; p.world.boss.px += 17;
  updateMotion(p.motion, p.world, p.grid); assert.notEqual(cache.epoch, epoch);
  compare(p, args, { t0: 0.4 });
  p.world.boss.active = false; updateMotion(p.motion, p.world, p.grid);
  assert.equal(p.motion.n, 0); compare(p, args, { t0: 0.4 });
  p.world.boss.active = true; cache.epoch = 0xffffffff;
  cache.stamps.fill(1); cache.times.fill(0.4); cache.positions.fill(NaN);
  updateMotion(p.motion, p.world, p.grid);
  assert.equal(cache.epoch, 1); assert.ok(cache.stamps.every(s => s === 0));
  compare(p, args, { t0: 0.4 });
  const next = single({ omega: -0.8, radius: 90, speedX: -7 }).world;
  rebuildGrid(p.grid, next.bricks); updateMotion(p.motion, next, p.grid); p.world = next;
  compare(p, args, { t0: 0.4 }); assert.equal(cache.positions, positions);
});

test('time keys distinguish nearby doubles and a poisoned signed-zero entry', () => {
  const p = single(), args = [M_BOTTOM, 360, 470, 0, -1, 9, 0, 1], cache = p.motion.cache;
  compare(p, args);
  const zero = [...cache.times].findIndex((t, i) => cache.stamps[i] === cache.epoch && Object.is(t, 0));
  assert.ok(zero >= 0); cache.times[zero] = -0;
  cache.positions.fill(NaN, zero * 256, (zero + 1) * 256);
  compare(p, args); // +0 must not hit the poisoned -0 bit key.
  for (const t0 of [0.3, 0.1 + 0.2, 1.125, 1.125 + Number.EPSILON, Number.MIN_VALUE]) compare(p, args, { t0 });
});

test('conservative moving broadphase retains face, corner, tangent and EPS endpoint contacts exactly', () => {
  const p = single({ omega: 0, radius: 0 }), B = p.world.bricks, cx = B.x[0], cy = B.y[0];
  let contacts = 0, misses = 0;
  for (const r of [0, 0.5, 9, 24]) for (const delta of [-1e-5, -6e-6, -1e-9, 0, 1e-9, 6e-6, 1e-5]) {
    for (const sign of [-1, 1]) {
      const plane = cx - sign * (15 + r);
      for (const x of [plane - sign * 60 + delta, plane + delta]) {
        compare(p, [M_BOTTOM, x, cy, sign, 0, r, 0, 60]);
        if (p.actual.brick >= 0) contacts++; else misses++;
      }
      compare(p, [M_BOTTOM, cx - 45, cy + sign * (15 + r + delta), 1, 0, r, 0, 60]);
      if (p.actual.brick >= 0) contacts++; else misses++;
    }
  }
  assert.ok(contacts > 20 && misses > 20, `contacts ${contacts}, misses ${misses}`);
});

test('full 128-part snapshots and skipped/dead parts remain exact', () => {
  const p = single({ omega: -0.8, plateCount: 128 }), B = p.world.bricks;
  assert.equal(p.motion.n, 128);
  for (let n = 0; n < 20; n++) {
    if (n === 10) B.alive[127] = 0;
    const a = -Math.PI / 2 + n * 0.11;
    compare(p, [M_BOTTOM, 360, 780, Math.cos(a), Math.sin(a), 9, 3, 1000, n % 2 ? 0 : -1], { t0: n % 4 / 7, spin: n % 3 - 1 });
  }
});

test('outer and clear-hole bounds skip moving transforms while static cores and sentries still collide', () => {
  const p = single({ radius: 160, plateCount: 28 }), B = p.world.bricks, core = B.count++;
  B.alive[core] = 1; B.flags[core] = BF.SOLID | BF.BREAKABLE;
  B.x[core] = B.px[core] = 360; B.y[core] = B.py[core] = 450;
  B.w[core] = B.h[core] = 10; B.hp[core] = 1;
  rebuildGrid(p.grid, B); updateMotion(p.motion, p.world, p.grid);
  const rays = [
    [M_BOTTOM, 360, 800, 0, 1, 9, 0, 400], // old broadphase shortens to 60, still outside the ring
    [M_BOTTOM, 360, 500, 0, -1, 9, 0, 60], // whole segment is in the clear hole; core is static
  ];
  for (const args of rays) {
    for (const c of [p.actual, p.expected]) Object.assign(c, { spin: 0, decay: 500, speed: 500, t0: 0 });
    castPathReference(p.expected, p.world, p.grid, ...args);
    const cos = Math.cos, sin = Math.sin; let calls = 0;
    try {
      Math.cos = x => { calls++; return cos(x); }; Math.sin = x => { calls++; return sin(x); };
      castPath(p.actual, p.world, p.grid, ...args);
    } finally { Math.cos = cos; Math.sin = sin; }
    assert.deepEqual(outputs(p.actual), outputs(p.expected));
    assert.equal(calls, 0, 'disjoint moving ring does not populate the future-position cache');
  }
  assert.equal(p.actual.brick, core, 'static core inside the hole is still reached');
  B.alive[core] = 0; rebuildGrid(p.grid, B); updateMotion(p.motion, p.world, p.grid);
  Object.assign(p.world.sentries[0], { alive: true, x: 360, y: 470, r: 10 });
  compare(p, rays[1]); assert.equal(p.actual.sentry, 0, 'inner cull never skips sentries');
});

test('fast angular chords can cross the nominal hole and are never culled as empty', () => {
  const p = single({ omega: Math.PI / 0.12, radius: 160 });
  compare(p, [M_BOTTOM, 360, 500, 0, -1, 9, 0, 60]);
  assert.equal(p.actual.brick, 0, 'near half-turn moving chord crosses the centre before the cast ends');
});

test('annular culls remain exact with fast turns, drifting centres and grazing radial endpoints', () => {
  let cases = 0;
  for (const omega of [0, 0.45, -0.8, 40, -90]) for (const [speedX, speedY] of [[0, 0], [280, -170], [-800, 450]]) {
    const p = single({ omega, radius: 150, plateCount: 12, speedX, speedY });
    for (const mc of [M_BOTTOM, M_LEFT, M_RING]) for (let n = 0; n < 8; n++) {
      const a = n * Math.PI / 4, radius = [0, p.motion.innerR, p.motion.R, p.motion.R + 24][n % 4];
      const delta = n % 2 ? -1e-8 : 1e-8;
      const x = 360 + Math.cos(a) * (radius + delta), y = 500 + Math.sin(a) * (radius + delta);
      compare(p, [mc, x, y, -Math.cos(a), -Math.sin(a), [0, 9, 24][n % 3], 3, 800],
        { speed: [10, 500, 1400][n % 3], t0: [0, 0.3, 1.125, 1e16][n % 4], spin: n % 3 - 1 });
      cases++;
    }
  }
  assert.equal(cases, 360);
});
