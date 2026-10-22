// A: swept collision. Ball vs bricks at absurd speeds, corners, seams, the 12 degree rule.
import { test, assert, near } from './lib.mjs';
import { SPEED, ANGLE, BF, FIELD } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { createRng } from '../src/core/rng.js';
import { rebuildGrid, sweepCircleRect, circleRectOverlap } from '../src/sim/collide.js';
import { moveBall } from '../src/sim/ball.js';
import { physicsWorld, launchAt, recorder, overlapsBrick, SOLID } from './fixtures/A/sim.mjs';

const SIN12 = Math.sin(ANGLE.MIN_FROM_EDGE_DEG * Math.PI / 180);

/** One raw physics move of ball 0 (no speed renormalisation, so tests can go past the cap). */
function rawMove(world, ctx, bi = 0) {
  rebuildGrid(ctx.grid, world.bricks);
  const b = world.balls[bi];
  b.px = b.x;
  b.py = b.y;
  moveBall(ctx, bi);
}

test('swept circle vs rect: face and corner contacts', () => {
  const out = { nx: 0, ny: 0, corner: -1 };
  // straight up into the bottom face
  let t = sweepCircleRect(0, 100, 0, -100, 9, 0, 0, 30, 15, out);
  near(t, (100 - 15 - 9) / 100, 1e-9);
  assert.deepEqual([out.nx, out.ny, out.corner], [0, 1, -1]);
  // diagonal into the bottom-left corner: normal points from the corner to the centre
  const d = 9 / Math.SQRT2;
  t = sweepCircleRect(-30 - d - 50, 15 + d + 50, 100, -100, 9, 0, 0, 30, 15, out);
  near(t, 0.5, 1e-9);
  near(out.nx, -Math.SQRT1_2, 1e-9);
  near(out.ny, Math.SQRT1_2, 1e-9);
  assert.equal(out.corner, 2);
  // a miss
  assert.equal(sweepCircleRect(100, 100, 0, -200, 9, 0, 0, 30, 15, out), -1);
  // overlap helper
  assert.ok(circleRectOverlap(0, 20, 9, 0, 0, 30, 15, out) > 0);
  assert.ok(circleRectOverlap(0, 40, 9, 0, 0, 30, 15, out) < 0);
});

test('no tunnelling at 20× top speed', () => {
  const rng = createRng(20);
  const fast = SPEED.CAP * 20;
  // a one-brick-thick wall across the field at y = 300, and a scatter of single bricks below it
  const bricks = [];
  for (let c = 0; c < 12; c++) bricks.push({ x: 30 + c * 60, y: 300 });
  for (let k = 0; k < 10; k++) bricks.push({ x: 30 + rng.int(0, 11) * 60, y: 495 + rng.int(0, 5) * 30, flags: BF.SOLID });
  let hitsSeen = 0;
  for (let trial = 0; trial < 400; trial++) {
    const { world, ctx } = physicsWorld({ bricks });
    ctx.paddleLive = false; // the paddle would set the speed back to a tier
    const ang = rng.range(-80, 80) * Math.PI / 180; // from straight up
    let x = rng.range(20, 700), y = rng.range(330, 460);
    while (overlapsBrick(world, x, y, 9, 0) >= 0) y += 7;
    launchAt(world, x, y, Math.sin(ang) * fast, -Math.cos(ang) * fast);
    const rec = recorder(world);
    for (let s = 0; s < 6; s++) {
      rawMove(world, ctx);
      const b = world.balls[0];
      assert.ok(b.y > 300 + 15, `trial ${trial} step ${s}: ball got past the wall (y ${b.y.toFixed(2)})`);
      assert.equal(overlapsBrick(world, b.x, b.y, b.r), -1, `trial ${trial}: ball inside a brick`);
      assert.ok(b.x >= b.r - 1e-6 && b.x <= FIELD.W - b.r + 1e-6, 'inside the side walls');
      // keep it fast: no renormalisation in rawMove, but reflections keep speed
      const sp = Math.hypot(b.vx, b.vy);
      near(sp, fast, fast * 1e-6, 'reflection keeps speed');
    }
    if (rec().some((e) => e.type === EV.BRICK_HIT)) hitsSeen++;
  }
  assert.ok(hitsSeen > 300, `most fast balls hit the wall (${hitsSeen})`);
});

test('corner hit reflects off the corner circle', () => {
  // brick centred (360, 300), 60 x 30; its bottom-left corner is (330, 315)
  const { world, ctx } = physicsWorld({ bricks: [{ x: 360, y: 300 }] });
  const s = 400 / Math.SQRT2;
  const d = 9 / Math.SQRT2;
  // aim the centre at the point r out from the corner along the 45 degree diagonal
  launchAt(world, 330 - d - 2, 315 + d + 2, s, -s);
  const rec = recorder(world);
  rawMove(world, ctx);
  const b = world.balls[0];
  const ev = rec().filter((e) => e.type === EV.BRICK_HIT);
  assert.equal(ev.length, 1);
  near(b.vx, -s, 1e-6, 'vx reverses');
  near(b.vy, s, 1e-6, 'vy reverses');
  // an off-diagonal corner hit: the outgoing direction mirrors the incoming about the corner normal
  const w2 = physicsWorld({ bricks: [{ x: 360, y: 300 }] });
  const nx = -Math.cos(Math.PI / 6), ny = Math.sin(Math.PI / 6); // 30 degrees below the -x axis
  const cx = 330 + nx * 9, cy = 315 + ny * 9;                    // contact centre
  const vx = 300, vy = -260;
  launchAt(w2.world, cx - vx / 120 * 0.5, cy - vy / 120 * 0.5, vx, vy);
  rawMove(w2.world, w2.ctx);
  const b2 = w2.world.balls[0];
  const dot = vx * nx + vy * ny;
  const ex = vx - 2 * dot * nx, ey = vy - 2 * dot * ny;
  near(b2.vx, ex, 1e-3, 'mirrored vx');
  near(b2.vy, ey, 1e-3, 'mirrored vy');
});

test('seam hit damages both bricks', () => {
  for (const x of [360, 360.5, 359.3]) {
    const { world, ctx } = physicsWorld({ bricks: [{ x: 330, y: 300 }, { x: 390, y: 300 }] });
    launchAt(world, x, 340, 0, -500);
    const rec = recorder(world);
    for (let k = 0; k < 8; k++) rawMove(world, ctx);
    const hits = rec().filter((e) => e.type === EV.BRICK_HIT).map((e) => e.id).sort();
    assert.deepEqual(hits, [0, 1], `x ${x}: both bricks hit`);
    const b = world.balls[0];
    near(b.vx, 0, 1e-6, `x ${x}: no sideways kick off a flat seam`);
    assert.ok(b.vy > 0);
  }
  // an inside corner (a brick above and a brick to the right): the ball comes straight back
  const { world, ctx } = physicsWorld({ bricks: [{ x: 330, y: 300 }, { x: 390, y: 330 }] });
  const s = 300;
  launchAt(world, 360 - 9 - 6, 315 + 9 + 6, s, -s);
  const rec = recorder(world);
  for (let k = 0; k < 4; k++) rawMove(world, ctx);
  const hits = rec().filter((e) => e.type === EV.BRICK_HIT).map((e) => e.id).sort();
  assert.deepEqual(hits, [0, 1]);
  const b = world.balls[0];
  assert.ok(b.vx < 0 && b.vy > 0, 'inside corner sends it back the way it came');
});

test('never flatter than 12°', () => {
  // grazing a side wall and a brick face: the outgoing angle is at least 12 degrees off the surface
  const g = 3 * Math.PI / 180;
  const { world, ctx } = physicsWorld({ bricks: [] });
  launchAt(world, 700, 600, Math.sin(g) * 500, -Math.cos(g) * 500); // 3 degrees off the right wall
  const rec = recorder(world);
  for (let k = 0; k < 90; k++) rawMove(world, ctx);
  assert.ok(rec().some((e) => e.type === EV.WALL_HIT && e.a === 1), 'it grazed the right wall');
  let b = world.balls[0];
  assert.ok(Math.abs(b.vx) / Math.hypot(b.vx, b.vy) >= SIN12 - 1e-9, 'off the wall by 12 degrees');
  const w2 = physicsWorld({ bricks: [{ x: 360, y: 300, w: 600 }] });
  launchAt(w2.world, 200, 330, Math.cos(g) * 500, -Math.sin(g) * 500); // 3 degrees under the face
  for (let k = 0; k < 60; k++) rawMove(w2.world, w2.ctx);
  b = w2.world.balls[0];
  assert.ok(b.vy > 0 && b.vy / Math.hypot(b.vx, b.vy) >= SIN12 - 1e-9, 'off the brick face by 12 degrees');
  // and in bottom mode no flight is ever flatter than 12 degrees from the horizontal
  const w3 = physicsWorld({ bricks: [] });
  launchAt(w3.world, 360, 500, 500, -10);
  w3.world.systems.physics.move(w3.world, w3.frame);
  b = w3.world.balls[0];
  assert.ok(Math.abs(b.vy) / Math.hypot(b.vx, b.vy) >= SIN12 - 1e-9);
});

test('moving bricks: a brick sliding into the ball pushes it out, never through', () => {
  const { world, ctx } = physicsWorld({ bricks: [{ x: 300, y: 400, flags: SOLID | BF.MOVING }] });
  const B = world.bricks;
  launchAt(world, 345 + 9 + 0.5, 400, 0, -0.001);
  // the brick slides right 6 units per step into a ball that barely moves
  for (let k = 0; k < 20; k++) {
    B.px[0] = B.x[0];
    B.x[0] += 6;
    rawMove(world, ctx);
    const b = world.balls[0];
    assert.equal(overlapsBrick(world, b.x, b.y, b.r), -1, `step ${k}: ball inside the moving brick`);
    assert.ok(b.x > B.x[0], 'ball stays on its side of the brick');
  }
});

test('portals: the ball leaves the twin with the same offset and velocity', () => {
  const { world, ctx } = physicsWorld({
    bricks: [
      { x: 150, y: 400, flags: BF.PORTAL, link: 1 },
      { x: 570, y: 200, flags: BF.PORTAL, link: 0 },
    ],
  });
  launchAt(world, 152, 420, 0, -400);
  const rec = recorder(world);
  for (let k = 0; k < 5; k++) rawMove(world, ctx);
  const ev = rec().filter((e) => e.type === EV.PORTAL);
  assert.equal(ev.length, 1);
  const b = world.balls[0];
  assert.ok(Math.abs(b.x - 572) < 1 && b.y < 215 && b.y > 160, `exits the twin (${b.x}, ${b.y})`);
  near(b.vy, -400, 1e-9);
});

// ------------------------------------------------------------------ review regressions (2026-10-22)

/** BRICK_HIT counts per brick for the events of one step. */
function hitsPerBrick(evs) {
  const m = new Map();
  for (const e of evs) if (e.type === EV.BRICK_HIT) m.set(e.id, (m.get(e.id) || 0) + 1);
  return m;
}

test('a ball piercing a brick never freezes on the next brick\'s corner', () => {
  // The Crucible, seed 1, step 5817: a perfect-hit pierce takes the ball into weak point 31
  // (below) while it meets the bottom-left corner of 27 (above). The pierced brick used to count
  // as the corner's neighbour, so the corner read as a face the ball was already leaving: no
  // reflection, contact again at t = 0, four BRICK_HITs a step with the ball standing still.
  const above = [BF.SOLID | BF.BOSS, BF.SOLID, BF.SOLID | BF.BREAKABLE | BF.BOSS | BF.WEAK];
  for (const flags of above) {
    const { world, ctx } = physicsWorld({ bricks: [{ x: 330, y: 405, flags }, { x: 330, y: 435 }] });
    ctx.paddleLive = false;
    const b = launchAt(world, 290.85, 432.51, 480.6, -588.7);
    b.pierce = 1;
    const rec = recorder(world);
    let pierced = false;
    for (let s = 0; s < 60; s++) {
      const x0 = b.x, y0 = b.y;
      rawMove(world, ctx);
      const evs = rec();
      if (evs.some((e) => e.type === EV.BRICK_HIT && e.id === 1 && e.c === 1)) pierced = true;
      for (const [id, n] of hitsPerBrick(evs)) assert.ok(n <= 1, `flags ${flags} step ${s}: brick ${id} hit ${n} times`);
      assert.ok(Math.hypot(b.x - x0, b.y - y0) > 1, `flags ${flags} step ${s}: the ball stood still at (${b.x.toFixed(2)}, ${b.y.toFixed(2)})`);
      // never inside the brick above (the lower one it may pass through)
      const fx = Math.max(Math.abs(b.x - 330) - 30, 0), fy = Math.max(Math.abs(b.y - 405) - 15, 0);
      assert.ok(Math.hypot(fx, fy) >= b.r - 0.05, `flags ${flags} step ${s}: inside the brick above`);
    }
    assert.ok(pierced, 'the pierce went into the lower brick');
  }
});

test('one BRICK_HIT per ball per brick per step: a brick falling faster than the ball lets it go', () => {
  // Stacks, seed 5, step 7619: a ball going up at 560 u/s meets a gravity brick falling at
  // 700 u/s head-on, three quarters into the step. After the bounce the ball is slower than the
  // brick, which used to catch it again at once: four hits in one step.
  const { world, frame, ctx } = physicsWorld({ bricks: [{ x: 360, y: 500, flags: SOLID | BF.FALLING | BF.MOVING }], tier: 2 });
  const B = world.bricks;
  const b = launchAt(world, 360, 500 + 15 + 9 + 8, 0, -SPEED.TIERS[2]);
  b.tier = 2;
  const rec = recorder(world);
  let contacts = 0;
  for (let s = 0; s < 30; s++) {
    B.px[0] = B.x[0];
    B.py[0] = B.y[0];
    B.y[0] += 700 / 120;
    world.systems.physics.move(world, frame);
    const per = hitsPerBrick(rec());
    if (per.has(0)) contacts++;
    assert.ok((per.get(0) || 0) <= 1, `step ${s}: ${per.get(0)} hits on the falling brick`);
    assert.equal(overlapsBrick(world, b.x, b.y, b.r), -1, `step ${s}: inside the falling brick`);
    assert.ok(b.y > B.y[0], 'the ball stays below the brick');
  }
  assert.ok(contacts >= 1, 'the brick caught up with the ball');
  void ctx;
});

test('portal exit: the whole ball fits inside the twin cell, never in its neighbours', () => {
  // the twin (570, 200) is boxed in by solid bricks on all eight sides
  const ring = [];
  for (const [dx, dy] of [[-60, 0], [60, 0], [0, -30], [0, 30], [-60, -30], [60, -30], [-60, 30], [60, 30]]) {
    ring.push({ x: 570 + dx, y: 200 + dy });
  }
  const bricks = [{ x: 150, y: 400, flags: BF.PORTAL, link: 1 }, { x: 570, y: 200, flags: BF.PORTAL, link: 0 }, ...ring];
  for (const [ox, oy] of [[28, 12], [-28, -12], [0, 14.5], [29, 0], [-5, -14]]) {
    const { world, ctx } = physicsWorld({ bricks });
    ctx.paddleLive = false;
    const b = launchAt(world, 150 + ox, 400 + oy, 0, 0); // sitting in the entry cell
    b.pierce = 1;
    const rec = recorder(world);
    rawMove(world, ctx);
    assert.equal(rec().filter((e) => e.type === EV.PORTAL).length, 1, `offset ${ox},${oy}: teleported`);
    assert.equal(overlapsBrick(world, b.x, b.y, b.r), -1, `offset ${ox},${oy}: overlaps a neighbour of the twin`);
    near(b.x - 570, Math.max(-21, Math.min(21, ox)), 0.05, 'x offset kept, limited to the cell');
    near(b.y - 200, Math.max(-6, Math.min(6, oy)), 0.05, 'y offset kept, limited to the cell');
    rawMove(world, ctx);
    assert.equal(rec().filter((e) => e.type === EV.BRICK_HIT).length, 0, 'no neighbour is hit or passed');
    assert.equal(b.pierce, 1, 'the pierce is still there');
  }
});

test('portal exit: a Mega ball too big for the twin leaves toward the side with room, or not at all', () => {
  // Wormholes, seed 7, step 9391: a Mega ball (radius 18) left a 30-tall twin 3 units inside the
  // indestructible brick above it
  const portalsAt = [{ x: 150, y: 400, flags: BF.PORTAL, link: 1 }, { x: 570, y: 200, flags: BF.PORTAL, link: 0 }];
  const above = { x: 570, y: 170, flags: BF.SOLID }, below = { x: 570, y: 230, flags: BF.SOLID };
  for (const [bricks, goes] of [[[...portalsAt, above], true], [[...portalsAt, below], true], [[...portalsAt, above, below], false]]) {
    const { world, ctx } = physicsWorld({ bricks });
    ctx.paddleLive = false;
    world.effects.mega = true;
    const b = launchAt(world, 150, 400, 0, 0);
    b.r = 18;
    const rec = recorder(world);
    rawMove(world, ctx);
    const went = rec().some((e) => e.type === EV.PORTAL);
    assert.equal(went, goes, `${bricks.length - 2} solid neighbours: ${goes ? 'teleports' : 'stays'}`);
    assert.equal(overlapsBrick(world, b.x, b.y, b.r), -1, 'never inside a brick');
  }
});

test('a push-out spends one pierce per brick passed and never passes a brick the ball is leaving', () => {
  // one pierce left, overlapping two breakable bricks it is moving into: one passes, one reflects
  const { world, ctx } = physicsWorld({ bricks: [{ x: 330, y: 300 }, { x: 390, y: 300 }] });
  ctx.paddleLive = false;
  const b = launchAt(world, 360, 320, 0, -500);
  b.pierce = 1;
  const rec = recorder(world);
  rawMove(world, ctx);
  const hits = rec().filter((e) => e.type === EV.BRICK_HIT);
  assert.equal(hits.filter((e) => e.c === 1).length, 1, 'exactly one brick passed');
  assert.equal(b.pierce, 0, 'the pierce is spent');
  // moving away from the brick it overlaps: pushed out, no hit, the pierce kept
  const w2 = physicsWorld({ bricks: [{ x: 360, y: 300 }] });
  w2.ctx.paddleLive = false;
  const b2 = launchAt(w2.world, 360, 320, 0, 500);
  b2.pierce = 1;
  const r2 = recorder(w2.world);
  rawMove(w2.world, w2.ctx);
  assert.equal(r2().filter((e) => e.type === EV.BRICK_HIT).length, 0, 'no hit on a brick it is leaving');
  assert.equal(b2.pierce, 1, 'pierce kept');
  assert.equal(overlapsBrick(w2.world, b2.x, b2.y, b2.r), -1, 'pushed out');
});

test('a push-out bounce keeps 12° off the surface and off the paddle track', () => {
  // a brick moved onto a ball skimming along under it: the push-out reflects it
  const { world, ctx } = physicsWorld({ bricks: [{ x: 360, y: 300, w: 300 }] });
  ctx.paddleLive = false;
  const b = launchAt(world, 360, 320, 500, -20);
  const rec = recorder(world);
  rawMove(world, ctx);
  assert.ok(rec().some((e) => e.type === EV.BRICK_HIT), 'it bounced off the brick');
  assert.ok(b.vy > 0, 'away from the brick');
  assert.ok(b.vy / Math.hypot(b.vx, b.vy) >= SIN12 - 1e-9, `${(Math.asin(b.vy / Math.hypot(b.vx, b.vy)) * 180 / Math.PI).toFixed(1)} degrees`);
});
