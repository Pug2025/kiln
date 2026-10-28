// Item 23: castPath skips the moving boss parts a stretch cannot reach (distance shells and an
// angular index per ring). Skipping must never change a cast: thousands of casts on every moving
// boss pose, from inside, between and outside the rings, with spin, late start times, slow and
// fast balls, small and large balls and a skipped part, are compared field for field with the
// frozen uncached reference (tests/fixtures/A/aim-reference.mjs).
import { test, assert } from './lib.mjs';
import { BF, SIM, RING } from '../src/core/constants.js';
import { createBrickGrid, rebuildGrid } from '../src/sim/collide.js';
import { createCaster, castPath, createMotion, updateMotion } from '../src/sim/aim.js';
import { modeCode, M_RING, RING_FACE } from '../src/sim/field.js';
import { getLevel, stagesOf } from '../src/levels/index.js';
import { createRng } from '../src/core/rng.js';
import { contentWorld } from './fixtures/B/helpers.mjs';
import { physicsWorld } from './fixtures/A/sim.mjs';
import { castPathReference } from './fixtures/A/aim-reference.mjs';

const outputs = (c) => ({ brick: c.brick, sentry: c.sentry, dist: c.dist, bounces: c.bounces,
  back: c.back, x: c.x, y: c.y, vx: c.vx, vy: c.vy, nx: c.nx, ny: c.ny, hit: { ...c.hit } });

function rig(world) {
  const grid = createBrickGrid(world.bricks.alive.length), motion = createMotion();
  rebuildGrid(grid, world.bricks);
  updateMotion(motion, world, grid);
  const actual = createCaster(world.bricks.alive.length), expected = createCaster(world.bricks.alive.length);
  actual.motion = expected.motion = motion;
  return { world, grid, motion, actual, expected };
}

/** n random casts aimed around the boss; returns how many reached a moving part. */
function fuzz(p, mc, rng, n) {
  const w = p.world, B = w.bricks;
  let movingHits = 0;
  for (let k = 0; k < n; k++) {
    // a start inside the clear hole, between the rings, at the rim or out at the paddle side
    const at = rng.next() * Math.PI * 2, rad = [rng.next() * 60, 60 + rng.next() * 140, 150 + rng.next() * 120, 280 + rng.next() * 30][k % 4];
    let x = w.boss.x + Math.cos(at) * rad, y = w.boss.y + Math.sin(at) * rad;
    if (mc === M_RING) {
      const ex = x - RING.CX, ey = y - RING.CY, d = Math.hypot(ex, ey), lim = RING_FACE - 30;
      if (d > lim) { x = RING.CX + ex / d * lim; y = RING.CY + ey / d * lim; }
    }
    const aim = Math.atan2(w.boss.y - y, w.boss.x - x) + (rng.next() - 0.5) * 2.2;
    const r = [9, 9, 0.5, 24][k % 4];
    const skip = k % 7 === 0 && p.motion.n ? p.motion.idx[k % p.motion.n] : -1;
    const opts = { spin: [0, 0, 1, -1, 0.5][k % 5], speed: [500.5, 900, 1400, 60][k % 4], t0: [0, 0.05, 0.6, 3.4, 11][k % 5] };
    opts.decay = opts.speed;
    for (const c of [p.actual, p.expected]) Object.assign(c, opts);
    const args = [mc, x, y, Math.cos(aim), Math.sin(aim), r, [3, 8][k % 2], [2600, 6000][k % 2], skip];
    castPath(p.actual, w, p.grid, ...args);
    castPathReference(p.expected, w, p.grid, ...args);
    assert.deepEqual(outputs(p.actual), outputs(p.expected), `cast ${k} ${JSON.stringify({ args, opts })}`);
    if (p.actual.brick >= 0 && (B.flags[p.actual.brick] & BF.MOVING)) movingHits++;
  }
  return movingHits;
}

test('the moving-part index never changes a cast on any boss pose (Stoker, Crucible, all Core stages)', () => {
  const rng = createRng(2310);
  let casts = 0, movingHits = 0;
  for (const def of [getLevel(10), getLevel(20), ...stagesOf(getLevel(30))]) {
    const env = contentWorld(def), w = env.world, B = w.bricks, mc = modeCode(def.mode);
    for (let pose = 0; pose < 5; pose++) {
      env.step([0, 23, 140, 260, 61][pose]);
      if (pose === 2) {
        // counted hits: the Stoker starts to sway, the rings change speed after half their hits
        const weak = [...Array(B.count).keys()].find((i) => B.alive[i] && (B.flags[i] & BF.WEAK));
        for (let hit = 0; hit < 12 && weak !== undefined && w.boss.hp > w.boss.hpMax / 2; hit++) { env.hit(weak); env.step(61); }
      }
      const p = rig(w);
      movingHits += fuzz(p, mc, rng, 640);
      casts += 640;
    }
  }
  assert.equal(casts, 16000);
  assert.ok(movingHits > 300, `${movingHits} casts ended on a moving part`);
});

test('the index stays exact for a turning ring around a swaying head with parts at its centre', () => {
  // two counter-rotating rings and a block of plates at the centre, the whole thing drifting
  const cx = 360, cy = 520, bricks = [];
  for (let k = 0; k < 24; k++) {
    const a = k * Math.PI * 2 / 24;
    bricks.push({ x: cx + Math.cos(a) * 165, y: cy + Math.sin(a) * 165, w: 30, h: 30, flags: BF.SOLID | BF.BREAKABLE | BF.BOSS | BF.MOVING, ring: 0.7 });
  }
  for (let k = 0; k < 12; k++) {
    const a = k * Math.PI * 2 / 12;
    bricks.push({ x: cx + Math.cos(a) * 95, y: cy + Math.sin(a) * 95, w: 30, h: 30, flags: BF.SOLID | BF.BREAKABLE | BF.BOSS | BF.MOVING, ring: -0.7 });
  }
  for (const [ox, oy] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]]) {
    bricks.push({ x: cx + ox, y: cy + oy, w: 30, h: 30, flags: BF.SOLID | BF.BREAKABLE | BF.BOSS | BF.MOVING, ring: 0 });
  }
  const { world } = physicsWorld({ bricks: bricks.map(({ ring, ...b }) => b) });
  const vx = 70, vy = -20;
  Object.assign(world.boss, { active: true, x: cx, y: cy, px: cx - vx * SIM.DT, py: cy - vy * SIM.DT });
  const B = world.bricks;
  for (let k = 0; k < B.count; k++) {
    const om = bricks[k].ring, c = Math.cos(-om * SIM.DT), s = Math.sin(-om * SIM.DT);
    const rx = B.x[k] - cx, ry = B.y[k] - cy;
    B.px[k] = world.boss.px + rx * c - ry * s;
    B.py[k] = world.boss.py + rx * s + ry * c;
  }
  const p = rig(world);
  assert.equal(p.motion.n, 41);
  const rng = createRng(77);
  let hits = 0;
  for (const mc of [0, 1, 2]) hits += fuzz(p, mc, rng, 900);
  assert.ok(hits > 100, `${hits} casts ended on a moving part`);
});
