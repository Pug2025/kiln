// A: the robot's path cast (src/sim/aim.js). The robot proves every level clears, so its cast
// must see what the ball really does: the bend that paddle motion puts on the ball, and boss
// parts that turn while the ball is on its way.
import { test, assert } from './lib.mjs';
import { BF, SIM, SPEED } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { createBrickGrid, rebuildGrid } from '../src/sim/collide.js';
import { createCaster, castPath, createMotion, updateMotion } from '../src/sim/aim.js';
import { M_BOTTOM } from '../src/sim/field.js';
import { physicsWorld, launchAt, recorder, SOLID } from './fixtures/A/sim.mjs';

/** A caster and a grid over the world's bricks, with spin, timing and motion inputs set. */
function caster(world, { spin = 0, speed = SPEED.TIERS[0], motion = null } = {}) {
  const grid = createBrickGrid(world.bricks.alive.length);
  rebuildGrid(grid, world.bricks);
  const c = createCaster(world.bricks.alive.length);
  c.spin = spin;
  c.decay = speed * 1;
  c.t0 = 0;
  c.speed = speed;
  c.motion = motion;
  if (motion) updateMotion(motion, world, grid);
  return { c, grid };
}

test('the cast bends with spin exactly as the ball flies', () => {
  // a row of narrow bricks across the top; the ball leaves (360, 800) 8 degrees right of straight
  // up with full spin from a paddle swept right
  const bricks = [];
  for (let k = 0; k < 24; k++) bricks.push({ x: 15 + k * 30, y: 200, w: 30 });
  for (const spin of [1, -1, 0.5]) {
    const { world, frame } = physicsWorld({ bricks });
    const a = 8 * Math.PI / 180;
    const dx = Math.sin(a), dy = -Math.cos(a);
    const b = launchAt(world, 360, 800, dx * SPEED.TIERS[0], dy * SPEED.TIERS[0]);
    b.spin = spin;
    world.systems.physics.ctx.spin0[0] = spin;
    const rec = recorder(world);
    let hit = -1;
    for (let s = 0; s < 400 && hit < 0; s++) {
      world.systems.physics.move(world, frame);
      const e = rec().find((ev) => ev.type === EV.BRICK_HIT);
      if (e) hit = e.id;
    }
    assert.ok(hit >= 0, 'the ball reached the row');
    const bent = caster(world, { spin });
    castPath(bent.c, world, bent.grid, M_BOTTOM, 360, 800, dx, dy, b.r, 3, 2600);
    assert.equal(bent.c.brick, hit, `spin ${spin}: the cast lands on the brick the ball hit`);
    const straight = caster(world, { spin: 0 });
    castPath(straight.c, world, straight.grid, M_BOTTOM, 360, 800, dx, dy, b.r, 3, 2600);
    assert.notEqual(straight.c.brick, hit, `spin ${spin}: a straight cast would have missed it`);
  }
});

test('the cast meets a turning boss part where it will be when the ball gets there', () => {
  // one plate on a ring of radius 60 around a boss at (360, 300), turning at 1 rad/s
  const cx = 360, cy = 300, w = 1;
  const rot = (x, y, ang) => [x * Math.cos(ang) - y * Math.sin(ang), x * Math.sin(ang) + y * Math.cos(ang)];
  const [px, py] = rot(0, -60, -w * SIM.DT);
  const { world } = physicsWorld({
    bricks: [{ x: cx, y: cy - 60, w: 30, h: 30, flags: BF.SOLID | BF.BREAKABLE | BF.BOSS | BF.MOVING }],
  });
  const B = world.bricks;
  B.px[0] = cx + px;
  B.py[0] = cy + py;
  Object.assign(world.boss, { active: true, x: cx, y: cy, px: cx, py: cy });
  // straight up from x = 406: the plate gets there about 0.9 s from now, not where it is now
  const motion = createMotion();
  const moving = caster(world, { motion });
  assert.equal(motion.n, 1, 'one moving part');
  assert.ok(Math.abs(motion.w[0] - w) < 1e-3, `turn rate ${motion.w[0]}`);
  castPath(moving.c, world, moving.grid, M_BOTTOM, 406, 700, 0, -1, 9, 3, 2600);
  assert.equal(moving.c.brick, 0, 'the cast meets the plate where it will be');
  const still = caster(world, {});
  castPath(still.c, world, still.grid, M_BOTTOM, 406, 700, 0, -1, 9, 3, 2600);
  assert.equal(still.c.brick, -1, 'a cast against the plate where it is now goes past');
  // and the ball, flown by the physics with the plate turned each step, does meet it
  const env = physicsWorld({
    bricks: [{ x: cx, y: cy - 60, w: 30, h: 30, flags: BF.SOLID | BF.BREAKABLE | BF.BOSS | BF.MOVING }],
  });
  const W = env.world, BB = W.bricks;
  launchAt(W, 406, 700, 0, -SPEED.TIERS[0]);
  const rec = recorder(W);
  let met = false;
  for (let s = 1; s < 200 && !met; s++) {
    const [ax, ay] = rot(0, -60, w * s * SIM.DT);
    BB.px[0] = BB.x[0];
    BB.py[0] = BB.y[0];
    BB.x[0] = cx + ax;
    BB.y[0] = cy + ay;
    W.systems.physics.move(W, env.frame);
    met = rec().some((e) => e.type === EV.BRICK_HIT && e.id === 0);
  }
  assert.ok(met, 'the real ball meets the plate too');
  void SOLID;
});
