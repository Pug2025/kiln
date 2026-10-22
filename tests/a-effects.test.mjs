// A: effects physics obeys (E writes world.effects), sentries, hazards, afterimages, splits.
import { test, assert, near } from './lib.mjs';
import { SIM, SPEED, BF, SRC, PADDLE, PHYS, FIELD } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { physicsWorld, launchAt, recorder, steps, SOLID } from './fixtures/A/sim.mjs';

const stillPaddle = (frame, x = 360) => { frame.steer = true; frame.tx = x; frame.ty = 1000; };

test('lasers: one volley of two bolts per press, each stops at the first solid brick', () => {
  const { world, frame } = physicsWorld({ bricks: [{ x: 330, y: 300 }, { x: 390, y: 300 }, { x: 330, y: 240 }] });
  world.effects.laserShots = 5;
  launchAt(world, 600, 500, 0, -SPEED.TIERS[0]);
  stillPaddle(frame);
  steps(world, frame, 1);
  const rec = recorder(world);
  frame.action = true;
  steps(world, frame, 80);
  const ev = rec();
  const fired = ev.filter((e) => e.type === EV.LASER_FIRED);
  assert.equal(fired.length, 1, 'one LASER_FIRED per press');
  assert.equal(fired[0].a, 2);
  const hits = ev.filter((e) => e.type === EV.BRICK_HIT && e.b === SRC.LASER).map((e) => e.id).sort();
  assert.deepEqual(hits, [0, 1], 'each bolt hits the nearest brick above it; the brick behind is untouched');
  assert.equal(ev.filter((e) => e.type === EV.LASER_DONE).length, 2);
  assert.ok(world.lasers.every((l) => !l.alive));
  // no shots, no lasers
  world.effects.laserShots = 0;
  frame.action = true;
  steps(world, frame, 1);
  assert.equal(rec().filter((e) => e.type === EV.LASER_FIRED).length, 0);
});

test('shield: a miss bounces off the floor line and reports SHIELD_USED', () => {
  const { world, frame } = physicsWorld();
  world.effects.shield = 1;
  stillPaddle(frame, 600);
  launchAt(world, 100, 900, 0, SPEED.TIERS[0]);
  const rec = recorder(world);
  steps(world, frame, 60);
  const ev = rec();
  assert.equal(ev.filter((e) => e.type === EV.SHIELD_USED).length, 1);
  assert.ok(!ev.some((e) => e.type === EV.BALL_LOST));
  assert.ok(world.balls[0].vy < 0);
  // E takes the charge away: the next miss is lost
  world.effects.shield = 0;
  world.balls[0].vy = Math.abs(world.balls[0].vy);
  steps(world, frame, 90);
  assert.ok(rec().some((e) => e.type === EV.BALL_LOST));
});

test('thru and mega pass breakable bricks; a perfect-hit pierce passes exactly one', () => {
  const column = [{ x: 330, y: 300 }, { x: 330, y: 270 }, { x: 330, y: 240 }, { x: 330, y: 180, flags: BF.SOLID }];
  for (const mode of ['thru', 'mega']) {
    const { world, frame } = physicsWorld({ bricks: column });
    world.effects[mode] = true;
    stillPaddle(frame, 600);
    launchAt(world, 330, 400, 0, -SPEED.TIERS[0]);
    const rec = recorder(world);
    steps(world, frame, 70);
    // (no content system here, so nothing breaks and the ball passes them again on the way down)
    const ev = rec().filter((e) => e.type === EV.BRICK_HIT);
    assert.deepEqual(ev.slice(0, 4).map((e) => [e.id, e.c]), [[0, 1], [1, 1], [2, 1], [3, 0]],
      `${mode}: passed the three breakable bricks, bounced off the indestructible one`);
    if (mode === 'mega') {
      assert.equal(world.balls[0].r, PHYS.MEGA_R);
      assert.ok(ev.every((e) => e.b === SRC.MEGA));
    }
  }
  const { world, frame } = physicsWorld({ bricks: column });
  stillPaddle(frame, 600);
  const b = launchAt(world, 330, 400, 0, -SPEED.TIERS[0]);
  b.pierce = 1;
  const rec = recorder(world);
  steps(world, frame, 70);
  const ev = rec().filter((e) => e.type === EV.BRICK_HIT);
  assert.deepEqual(ev.map((e) => [e.id, e.c]), [[0, 1], [1, 0]], 'pierced the first, bounced off the second');
  assert.equal(b.pierce, 0);
});

test('fire balls report SRC.FIRE and still bounce', () => {
  const { world, frame } = physicsWorld({ bricks: [{ x: 330, y: 300 }] });
  world.effects.fire = true;
  launchAt(world, 330, 400, 0, -SPEED.TIERS[0]);
  const rec = recorder(world);
  steps(world, frame, 30);
  const hit = rec().find((e) => e.type === EV.BRICK_HIT);
  assert.equal(hit.b, SRC.FIRE);
  assert.ok(world.balls[0].vy > 0);
});

test('sentries: balls bounce off them as circles, lasers stop at them', () => {
  const { world, frame } = physicsWorld();
  const s = world.sentries[0];
  Object.assign(s, { alive: true, kind: 0, x: 360, y: 400, px: 360, py: 400, vx: 0, vy: 0, r: 20, hp: 2 });
  launchAt(world, 360, 600, 0, -SPEED.TIERS[0]);
  stillPaddle(frame, 100);
  const rec = recorder(world);
  steps(world, frame, 60);
  let ev = rec();
  const hit = ev.find((e) => e.type === EV.SENTRY_HIT);
  assert.ok(hit, 'SENTRY_HIT');
  assert.equal(hit.id, 0);
  assert.equal(hit.a, 0, 'ball index');
  near(hit.y, 420, 1e-6, 'contact on the circle');
  assert.ok(world.balls[0].vy > 0);
  // a laser from under it
  world.balls[0].alive = false;
  world.effects.laserShots = 1;
  stillPaddle(frame, 360 + 60 - 10);
  steps(world, frame, 1);
  frame.action = true;
  steps(world, frame, 60);
  ev = rec();
  assert.ok(ev.some((e) => e.type === EV.SENTRY_HIT && e.a === -1 && e.b === SRC.LASER), 'laser stopped at the sentry');
});

test('hazards fall on their own velocity and hit the paddle (HAZARD_HIT)', () => {
  const { world, frame } = physicsWorld();
  stillPaddle(frame, 360);
  const slot = world.api.spawnHazard(380, 700, 0, 300, 1, 10);
  assert.ok(slot >= 0);
  world.api.spawnHazard(100, 700, 0, 300, 0, 10); // misses the paddle
  const rec = recorder(world);
  steps(world, frame, 200);
  const ev = rec().filter((e) => e.type === EV.HAZARD_HIT);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].a, 1, 'kind');
  assert.ok(world.hazards.every((h) => !h.alive), 'both gone');
});

test('afterimage paddles trail 80 and 160 ms and deflect the ball', () => {
  const { world, frame } = physicsWorld({ rules: { ghosts: true } });
  frame.steer = true;
  frame.ty = 1000;
  // sweep right at 600 u/s
  for (let i = 0; i < 60; i++) {
    frame.tx = 100 + i * 5;
    steps(world, frame, 1);
  }
  const p = world.paddle;
  near(p.x - p.ghostX[0], 5 * Math.round(80 / SIM.DT_MS), 1e-6, 'first ghost 80 ms behind');
  near(p.x - p.ghostX[1], 5 * Math.round(160 / SIM.DT_MS), 1e-6, 'second ghost 160 ms behind');
  // hold still; drop a ball onto where the second ghost is while the paddle is far ahead
  const g = p.ghostX[1];
  launchAt(world, g, 960, 0, SPEED.TIERS[0]);
  const rec = recorder(world);
  for (let i = 0; i < 8; i++) {
    frame.tx = p.x + 5;
    steps(world, frame, 1);
  }
  assert.ok(rec().some((e) => e.type === EV.PADDLE_HIT), 'a ghost deflected it');
  assert.ok(world.balls[0].vy < 0);
});

test('splitBalls fans copies 15 degrees apart at the same speed', () => {
  const { world } = physicsWorld();
  const b = launchAt(world, 360, 500, 0, -SPEED.TIERS[0]);
  const made = world.api.splitBalls(2);
  assert.equal(made, 2);
  const live = world.balls.filter((x) => x.alive);
  assert.equal(live.length, 3);
  const angles = live.map((x) => Math.round(Math.atan2(x.vx, -x.vy) * 180 / Math.PI)).sort((p, q) => p - q);
  assert.deepEqual(angles, [-PHYS.SPLIT_DEG, 0, PHYS.SPLIT_DEG]);
  for (const x of live) near(Math.hypot(x.vx, x.vy), Math.hypot(b.vx, b.vy), 1e-9);
  // the pool never overflows
  world.api.splitBalls(10);
  assert.equal(world.balls.filter((x) => x.alive).length, world.balls.length);
});

test('spawnBall and spawnDrop return slots; a spawned ball flies at the tier speed', () => {
  const { world, frame } = physicsWorld();
  const i = world.api.spawnBall(300, 500, 0, 0);
  assert.ok(i >= 0);
  steps(world, frame, 1);
  const b = world.balls[i];
  near(Math.hypot(b.vx, b.vy), SPEED.TIERS[0], 1e-6);
  assert.ok(b.vy < 0, 'toward the bricks');
  assert.equal(world.phase, 'play');
  for (let k = 0; k < 20; k++) world.api.spawnDrop(100, 100, 0);
  assert.equal(world.drops.filter((d) => d.alive).length, world.drops.length);
  assert.equal(world.api.spawnDrop(100, 100, 0), -1);
});

test('Wide eases the paddle to 180 and widens its reach', () => {
  const { world, frame } = physicsWorld();
  world.effects.paddleW = PADDLE.W_WIDE;
  stillPaddle(frame, 360);
  steps(world, frame, 120);
  assert.equal(world.paddle.w, PADDLE.W_WIDE);
  launchAt(world, 360 + 85, 900, 0, SPEED.TIERS[0]); // beyond a normal paddle's reach
  const rec = recorder(world);
  steps(world, frame, 40);
  assert.ok(rec().some((e) => e.type === EV.PADDLE_HIT));
  assert.ok(world.paddle.x === 360 && FIELD.W === 720);
});

test('Splitter splits on a perfect hit while fewer than 3 balls are alive', () => {
  // one ball falls on the still paddle; the press lands 25 ms before the contact
  const perfectDrop = (extraBalls) => {
    const { world, frame } = physicsWorld();
    world.effects.ballKind = 2;
    stillPaddle(frame, 360);
    steps(world, frame, 1);
    launchAt(world, 360, 900, 0, SPEED.TIERS[0]);
    for (let k = 0; k < extraBalls; k++) launchAt(world, 100 + k * 40, 200, 0, -SPEED.TIERS[0], k + 1);
    const rec = recorder(world);
    let perfect = false;
    for (let i = 0; i < 120 && !perfect; i++) {
      steps(world, frame, 1, (f, w) => {
        const b = w.balls[0];
        const ttc = ((PADDLE.Y - PADDLE.H / 2 - b.r) - b.y) / b.vy * 1000;
        if (ttc > 0 && ttc <= 25 && w.paddle.lastActionMs < 0) f.action = true;
      });
      perfect = rec().some((e) => e.type === EV.PERFECT_HIT);
    }
    assert.ok(perfect, 'the press made a perfect hit');
    return world.balls.filter((x) => x.alive).length;
  };
  assert.equal(perfectDrop(0), 2, 'one ball becomes two');
  assert.equal(perfectDrop(1), 3, 'two become three');
  assert.equal(perfectDrop(2), 3, 'three stay three');
});
