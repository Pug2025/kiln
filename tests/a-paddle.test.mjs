// A: the paddle. Bounce rule, 1:1 steering, perfect hits, speed tiers, spin, catch.
import { test, assert, near } from './lib.mjs';
import { SPEED, PERFECT, ANGLE, SIM, PADDLE, FIELD, PHYS } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { bounceDir, VEL_REF } from '../src/sim/paddle.js';
import { steerPaddle, M_BOTTOM, M_LEFT, M_RING } from '../src/sim/field.js';
import { physicsWorld, launchAt, recorder, steps } from './fixtures/A/sim.mjs';

const DEG = Math.PI / 180;
const angleFromUp = (vx, vy) => Math.atan2(vx, -vy) / DEG;

test('bounce angle: 75% hit position + 25% paddle velocity, at most 70° from the normal', () => {
  const n = { x: 0, y: 0 }, t = { x: 0, y: 0 }, o = { x: 0, y: 0 };
  const cases = [
    [1, 0, 0.75 * 70], [0, 1, 0.25 * 70], [1, 1, 70], [-1, 0, -0.75 * 70], [0.5, -1, (0.375 - 0.25) * 70], [3, 3, 70],
  ];
  for (const [off, vel, deg] of cases) {
    bounceDir(M_BOTTOM, 360, 992, off, vel, n, t, o);
    near(angleFromUp(o.x, o.y), deg, 1e-9, `off ${off} vel ${vel}`);
  }
  assert.equal(ANGLE.MAX_FROM_NORMAL_DEG, 70);
  // left mode: the normal points right, positive offset (further down the bar) sends it down
  bounceDir(M_LEFT, 48, 540, 1, 0, n, t, o);
  near(Math.atan2(o.y, o.x) / DEG, 52.5, 1e-9);
  // ring mode at the bottom of the ring: the normal points to the centre (up)
  bounceDir(M_RING, 360, 540 + 312, 0, 0, n, t, o);
  near(o.x, 0, 1e-9);
  near(o.y, -1, 1e-9);
});

test('paddle steers 1:1 and stays inside the field', () => {
  const { world } = physicsWorld();
  steerPaddle(world, 500, 0);
  assert.equal(world.paddle.x, 500);
  assert.equal(world.paddle.y, PADDLE.Y);
  steerPaddle(world, -100, 0);
  assert.equal(world.paddle.x, PADDLE.W / 2);
  steerPaddle(world, 5000, 0);
  assert.equal(world.paddle.x, FIELD.W - PADDLE.W / 2);
});

/** Drop ball 0 onto a still paddle at an offset; returns the PADDLE_HIT event and the world. */
function dropOnPaddle(offset, opts = {}) {
  const env = physicsWorld(opts);
  const { world, frame } = env;
  frame.steer = true;
  frame.tx = 360;
  frame.ty = 1000;
  steps(world, frame, 1);
  launchAt(world, 360 + offset * 60, 900, 0, SPEED.TIERS[0]);
  const rec = recorder(world);
  const evs = [];
  for (let i = 0; i < 120; i++) {
    steps(world, frame, 1, opts.before ? (f, w) => opts.before(f, w, evs) : null);
    evs.push(...rec());
    if (evs.some((e) => e.type === EV.PADDLE_HIT) && !opts.keepGoing) break;
  }
  return { ...env, evs, hit: evs.find((e) => e.type === EV.PADDLE_HIT) };
}

test('the ball leaves a still paddle along the bounce rule', () => {
  for (const off of [-0.8, -0.3, 0, 0.5, 1]) {
    const { world, hit } = dropOnPaddle(off);
    assert.ok(hit, `offset ${off}: paddle hit`);
    near(hit.a, off, 0.02, 'reported offset');
    const b = world.balls[0];
    near(angleFromUp(b.vx, b.vy), 0.75 * off * 70, 1.5, `offset ${off}: angle`);
    near(Math.hypot(b.vx, b.vy), SPEED.TIERS[0], 1e-6, 'speed is the tier speed');
  }
});

test('perfect hit inside 60 ms raises the tier', () => {
  // pressed 25 ms before the contact
  const early = dropOnPaddle(0, {
    keepGoing: true,
    before(f, w, evs) {
      const b = w.balls[0];
      const ttc = ((PADDLE.Y - PADDLE.H / 2 - b.r) - b.y) / b.vy * 1000;
      if (!evs.some((e) => e.type === EV.PADDLE_HIT) && ttc > 0 && ttc <= 25 && w.paddle.lastActionMs < 0) f.action = true;
    },
  });
  assert.ok(early.evs.some((e) => e.type === EV.PERFECT_HIT), 'early press: perfect');
  assert.equal(early.hit.b, 1);
  assert.equal(early.hit.c, 1, 'tier after the hit is one up');
  const b = early.world.balls[0];
  near(Math.hypot(b.vx, b.vy), SPEED.TIERS[1], 1e-6, 'boosted speed');
  assert.equal(b.pierce, PERFECT.PIERCE);
  assert.equal(early.world.stats.perfectHits, 1);
  // the boost runs out after 1.5 s
  steps(early.world, early.frame, Math.ceil(PERFECT.BOOST_MS / SIM.DT_MS) + 2);
  near(Math.hypot(b.vx, b.vy), SPEED.TIERS[0], 1e-6, 'boost over');

  // pressed 40 ms after the contact
  let hitAt = -1;
  const late = dropOnPaddle(0, {
    keepGoing: true,
    before(f, w, evs) {
      if (hitAt < 0 && evs.some((e) => e.type === EV.PADDLE_HIT)) hitAt = w.time;
      if (hitAt >= 0 && w.time - hitAt >= 40 && w.time - hitAt < 45) f.action = true;
    },
  });
  assert.ok(late.evs.some((e) => e.type === EV.PERFECT_HIT), 'late press: perfect');

  // pressed 90 ms before: nothing
  const miss = dropOnPaddle(0, {
    keepGoing: true,
    before(f, w, evs) {
      const b = w.balls[0];
      const ttc = ((PADDLE.Y - PADDLE.H / 2 - b.r) - b.y) / b.vy * 1000;
      if (!evs.some((e) => e.type === EV.PADDLE_HIT) && ttc > 85 && ttc <= 95 && w.paddle.lastActionMs < 0) f.action = true;
    },
  });
  assert.ok(!miss.evs.some((e) => e.type === EV.PERFECT_HIT), 'too early: no perfect hit');
  assert.equal(miss.hit.b, 0);
});

test('the perfect-hit boost lasts exactly 1.5 s (180 steps), counted from world.time', () => {
  // subtracting 1000/120 ms a step from 1500 drifts to 181 steps; an end time does not
  const env = physicsWorld();
  const { world, frame } = env;
  frame.steer = true;
  frame.tx = 360;
  frame.ty = 1000;
  steps(world, frame, 1);
  launchAt(world, 360, 900, 0, SPEED.TIERS[0]);
  const rec = recorder(world);
  let perfectStep = -1, endStep = -1;
  for (let i = 0; i < 400 && endStep < 0; i++) {
    steps(world, frame, 1, (f, w) => {
      const b = w.balls[0];
      const ttc = ((PADDLE.Y - PADDLE.H / 2 - b.r) - b.y) / b.vy * 1000;
      if (perfectStep < 0 && ttc > 0 && ttc <= 25 && w.paddle.lastActionMs < 0) f.action = true;
    });
    for (const e of rec()) {
      if (e.type === EV.PERFECT_HIT && perfectStep < 0) perfectStep = world.step;
      if (e.type === EV.SPEED_TIER && perfectStep >= 0 && world.step > perfectStep && e.a === 0) endStep = world.step;
    }
  }
  assert.ok(perfectStep > 0, 'perfect hit');
  assert.equal(endStep - perfectStep, Math.round(PERFECT.BOOST_MS / SIM.DT_MS), 'boost length in steps');
});

test('speed tier rises every 6 paddle contacts and resets on serve', () => {
  const { world, frame } = physicsWorld();
  frame.steer = true;
  frame.tx = 360;
  frame.ty = 1000;
  const rec = recorder(world);
  let contacts = 0;
  for (let k = 0; k < 7; k++) {
    launchAt(world, 360, 900, 0, SPEED.TIERS[0]);
    world.balls[0].tier = world.balls[0].tier; // keep the shared tier
    for (let i = 0; i < 60; i++) {
      steps(world, frame, 1);
      if (rec().some((e) => e.type === EV.PADDLE_HIT)) { contacts++; break; }
    }
  }
  assert.equal(contacts, 7);
  assert.equal(world.balls[0].tier, 1, 'one tier up after 6 contacts');
  world.api.serve();
  assert.equal(world.balls[0].tier, 0, 'serve resets to the level tier');
  assert.equal(world.phase, 'serve');
});

test('spin from paddle motion bends the flight and fades within a second', () => {
  const { world, frame } = physicsWorld();
  frame.steer = true;
  frame.tx = 300;
  frame.ty = 1000;
  steps(world, frame, 1);
  launchAt(world, 400, 940, 0, SPEED.TIERS[0]);
  // sweep the paddle right fast as the ball lands
  let hit = false;
  const rec = recorder(world);
  for (let i = 0; i < 40 && !hit; i++) {
    frame.tx += 12; // 12 units per step = 1440 u/s
    steps(world, frame, 1);
    hit = rec().some((e) => e.type === EV.PADDLE_HIT);
  }
  assert.ok(hit);
  const b = world.balls[0];
  assert.ok(b.spin > 0.99, `full spin (${b.spin})`);
  const a0 = Math.atan2(b.vy, b.vx);
  frame.tx = world.paddle.x;
  steps(world, frame, 20);
  const a1 = Math.atan2(b.vy, b.vx);
  assert.ok(a1 > a0, 'the flight bends toward the paddle motion (clockwise in field coordinates)');
  steps(world, frame, Math.ceil(1000 / SIM.DT_MS));
  assert.equal(b.spin, 0, 'spin is gone after a second');
});

test('a 60 Hz hand: the bounce and spin read the hand speed whichever step of the frame the hit lands in', () => {
  // review 2026-10-22: a display frame holds 2 sim steps (60 Hz) or 4 (30 Hz) that share one
  // pointer target, so the paddle moves on the first step and stands on the rest. A per-step
  // difference read 1200 then 0 u/s for a steady 600 u/s hand (a 17.5 degree swing, spin on/off).
  const n = { x: 0, y: 0 }, t = { x: 0, y: 0 }, o = { x: 0, y: 0 };
  const speed = 600, x0 = 250;
  for (const per of [1, 2, 4]) { // sim steps per display frame: 120, 60 and 30 Hz screens
    const phases = new Set();
    for (let k = 0; k < 20; k++) {
      const { world, frame } = physicsWorld();
      frame.steer = true;
      frame.tx = x0;
      frame.ty = 1000;
      steps(world, frame, 1);
      const b = launchAt(world, 330, 900 + k * 0.97, 0, SPEED.TIERS[0]);
      const rec = recorder(world);
      let hit = null;
      for (let i = 1; i < 80 && !hit; i++) {
        if (i % per === 0) frame.tx = x0 + speed * i * SIM.DT; // the pointer as each frame samples it
        steps(world, frame, 1);
        hit = rec().find((e) => e.type === EV.PADDLE_HIT);
        if (hit) phases.add(i % per);
      }
      const where = `${per} steps a frame, start ${k}`;
      assert.ok(hit, `${where}: paddle hit`);
      bounceDir(M_BOTTOM, hit.x, hit.y, hit.a, speed / VEL_REF, n, t, o);
      near(angleFromUp(b.vx, b.vy), angleFromUp(o.x, o.y), 1e-6, `${where}: outgoing angle`);
      near(b.spin, speed / VEL_REF, 1e-9, `${where}: spin`);
      near(world.paddle.vel, speed, 1e-6, `${where}: paddle speed`);
    }
    assert.equal(phases.size, per, `${per} steps a frame: hits landed on every step of the frame`);
  }
  // a paddle that stops reads 0 once it has stood longer than its last gap between moves
  const { world, frame } = physicsWorld();
  frame.steer = true;
  frame.ty = 1000;
  for (let i = 0; i < 7; i++) {
    frame.tx = 300 + (i >> 1) * 10; // 60 Hz, 600 u/s; the last step (i = 6) moves
    steps(world, frame, 1);
  }
  near(world.paddle.vel, 600, 1e-6);
  steps(world, frame, 1);
  near(world.paddle.vel, 600, 1e-6, 'the still step of a moving frame keeps the speed');
  steps(world, frame, 1);
  assert.equal(world.paddle.vel, 0, 'a frame with no move: stopped');
});

test('catch holds the ball on the paddle and the action releases it', () => {
  const { world, frame } = physicsWorld();
  world.effects.catchOn = true;
  frame.steer = true;
  frame.tx = 360;
  frame.ty = 1000;
  steps(world, frame, 1);
  launchAt(world, 380, 900, 0, SPEED.TIERS[0]);
  const rec = recorder(world);
  let ev = [];
  for (let i = 0; i < 60; i++) { steps(world, frame, 1); ev.push(...rec()); if (ev.some((e) => e.type === EV.CATCH)) break; }
  const b = world.balls[0];
  assert.ok(b.held, 'held');
  near(b.holdOffset, 20, 0.5);
  frame.tx = 300;
  steps(world, frame, 3);
  near(b.x, 320, 0.5, 'rides the paddle at its offset');
  frame.action = true;
  steps(world, frame, 1);
  ev = rec();
  assert.ok(ev.some((e) => e.type === EV.RELEASE));
  assert.ok(!b.held && b.vy < 0);
  // and it releases itself after PHYS.CATCH_HOLD_MS
  launchAt(world, 360, 900, 0, SPEED.TIERS[0]);
  for (let i = 0; i < 60 && !b.held; i++) steps(world, frame, 1);
  assert.ok(b.held);
  steps(world, frame, Math.ceil(PHYS.CATCH_HOLD_MS / SIM.DT_MS) + 1);
  assert.ok(!b.held, 'auto release');
});

test('paddle width eases toward the effect and the ring span follows it', () => {
  const { world, frame } = physicsWorld({ mode: 'ring' });
  world.effects.paddleW = PADDLE.W_WIDE;
  steps(world, frame, 120);
  near(world.paddle.w, PADDLE.W_WIDE, 1e-9);
  near(world.paddle.span, 60 * DEG, 1e-9);
  assert.equal(VEL_REF, PHYS.VEL_REF);
});
