// Test helpers for A's physics tests: a world with only the physics system and hand-placed bricks.
import { createWorld, stepWorld } from '../../../src/core/world.js';
import { createInputFrame, clearEdges } from '../../../src/core/input-frame.js';
import { createReader, next } from '../../../src/core/bus.js';
import { createPhysics } from '../../../src/sim/physics.js';
import { computeField } from '../../../src/sim/ceiling.js';
import { BF } from '../../../src/core/constants.js';
import { EV_NAME } from '../../../src/core/events.js';

export const SOLID = BF.SOLID | BF.BREAKABLE | BF.CLEARABLE;

/**
 * A world with A's physics only (content and economy are no-ops). Bricks are written straight into
 * the store: [{x, y, w?, h?, flags?}]. They arrive after physics.init, so the field has no ceiling
 * (world.field.ceilingY 0, farX 720) unless `ceiling` is true: then it is worked out from these
 * bricks as a level start would.
 */
export function physicsWorld({ mode = 'bottom', bricks = [], tier = 0, seed = 1, rules = {}, ceiling = false } = {}) {
  const level = { n: 99, id: 'test', name: 'Test', world: 'ember', kind: 'normal', mode, tier, rows: [], rules };
  const physics = createPhysics();
  const world = createWorld({ level, seed, systems: { physics } });
  const B = world.bricks;
  bricks.forEach((b, i) => {
    B.alive[i] = 1;
    B.type[i] = 1;
    B.flags[i] = b.flags ?? SOLID;
    B.hp[i] = B.hpMax[i] = 1;
    B.x[i] = B.px[i] = b.x;
    B.y[i] = B.py[i] = b.y;
    B.w[i] = b.w ?? 60;
    B.h[i] = b.h ?? 30;
    B.link[i] = b.link ?? -1;
  });
  B.count = bricks.length;
  B.version++;
  world.level.remaining = bricks.length || 99; // an empty test field must not count as cleared
  if (ceiling) {
    computeField(world);
    physics.ctx.ceilY = world.field.ceilingY;
    physics.ctx.farX = world.field.farX;
  }
  return { world, physics, ctx: physics.ctx, frame: createInputFrame() };
}

/** Put ball 0 in flight at (x, y) with velocity (vx, vy); the phase becomes play. */
export function launchAt(world, x, y, vx, vy, bi = 0) {
  const b = world.balls[bi];
  b.alive = true;
  b.held = false;
  b.x = b.px = x;
  b.y = b.py = y;
  b.vx = vx;
  b.vy = vy;
  world.phase = 'play';
  return b;
}

/** Collect events emitted from now on: returns a function that drains them into an array. */
export function recorder(world) {
  const rd = createReader(world.bus, 'test', world.bus.head);
  return () => {
    const out = [];
    while (next(rd)) out.push({ type: rd.type, name: EV_NAME[rd.type], id: rd.id, x: rd.x, y: rd.y, a: rd.a, b: rd.b, c: rd.c });
    return out;
  };
}

/** Step the whole pipeline n times with a frame (edges cleared after each step). */
export function steps(world, frame, n, before) {
  for (let i = 0; i < n; i++) {
    if (before) before(frame, world, i);
    stepWorld(world, frame);
    clearEdges(frame);
  }
}

/** True if a circle overlaps any live solid brick by more than eps. */
export function overlapsBrick(world, x, y, r, eps = 0.05) {
  const B = world.bricks;
  for (let i = 0; i < B.count; i++) {
    if (!B.alive[i] || !(B.flags[i] & BF.SOLID)) continue;
    const fx = Math.max(Math.abs(x - B.x[i]) - B.w[i] / 2, 0);
    const fy = Math.max(Math.abs(y - B.y[i]) - B.h[i] / 2, 0);
    if (Math.sqrt(fx * fx + fy * fy) < r - eps) return i;
  }
  return -1;
}
