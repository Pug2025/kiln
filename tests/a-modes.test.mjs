// A: the three field modes, Pull, anti-loop, the aim line, the near miss.
import { test, assert, near } from './lib.mjs';
import { SIM, RING, HORIZONTAL, PADDLE, PULL, SPEED, ANTILOOP, SLOWMO, BF, FIELD, PHYS } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { createWorld } from '../src/core/world.js';
import { runHeadless } from '../src/core/headless.js';
import { makeSystems } from '../src/systems.js';
import { createRobot } from '../src/sim/robot.js';
import {
  trackToField, fieldToTrack, ringBearing, toLocal, fromLocal, awayAt, normalAt, isLost, M_BOTTOM, M_LEFT, M_RING,
} from '../src/sim/field.js';
import { nudge } from '../src/sim/feel.js';
import { createRng } from '../src/core/rng.js';
import { physicsWorld, launchAt, recorder, steps, SOLID } from './fixtures/A/sim.mjs';
import { LEFT_TEST, RING_TEST, FRAME_TEST } from './fixtures/A/levels.mjs';

test('field geometry: track <-> field, local frames, away and lost in every mode', () => {
  const o = { x: 0, y: 0 }, l = { u: 0, v: 0 };
  assert.deepEqual(trackToField('bottom', 200, o), { x: 200, y: PADDLE.Y });
  assert.deepEqual(trackToField('left', 300, { x: 0, y: 0 }), { x: HORIZONTAL.PADDLE_X, y: 300 });
  const r = trackToField('ring', Math.PI / 2, { x: 0, y: 0 });
  near(r.x, RING.CX, 1e-9);
  near(r.y, RING.CY + RING.R_PADDLE, 1e-9);
  near(fieldToTrack('ring', RING.CX + 10, RING.CY), 0, 1e-12);
  near(ringBearing(RING.CX, RING.CY + 5), Math.PI / 2, 1e-12);
  for (const mc of [M_BOTTOM, M_LEFT, M_RING]) {
    const t = mc === M_RING ? 1.1 : 333;
    toLocal(mc, t, 400, 500, l);
    fromLocal(mc, t, l.u, l.v, o);
    near(o.x, 400, 1e-9);
    near(o.y, 500, 1e-9);
  }
  assert.deepEqual(awayAt(M_BOTTOM, 1, 2, o), { x: 0, y: 1 });
  assert.deepEqual(awayAt(M_LEFT, 1, 2, { x: 0, y: 0 }), { x: -1, y: 0 });
  const a = awayAt(M_RING, RING.CX + 3, RING.CY + 4, { x: 0, y: 0 });
  near(a.x, 0.6, 1e-12);
  near(a.y, 0.8, 1e-12);
  const n = normalAt(M_RING, RING.CX, RING.CY + 100, { x: 0, y: 0 });
  near(n.y, -1, 1e-12);
  assert.ok(isLost(M_BOTTOM, 100, FIELD.H + 10, 9) && !isLost(M_BOTTOM, 100, FIELD.H, 9));
  assert.ok(isLost(M_LEFT, -10, 500, 9) && !isLost(M_LEFT, 0, 500, 9));
  assert.ok(isLost(M_RING, RING.CX + RING.R_LOSS + 1, RING.CY, 9) && !isLost(M_RING, RING.CX + RING.R_LOSS - 1, RING.CY, 9));
});

test('left mode: the paddle is a bar at x = 40 moving along y, the ball bounces right', () => {
  const { world, frame } = physicsWorld({ mode: 'left' });
  frame.steer = true;
  frame.tx = 500;
  frame.ty = 700;
  steps(world, frame, 1);
  assert.equal(world.paddle.x, HORIZONTAL.PADDLE_X);
  assert.equal(world.paddle.y, 700);
  launchAt(world, 200, 700, -SPEED.TIERS[0], 0);
  const rec = recorder(world);
  steps(world, frame, 60);
  const hit = rec().find((e) => e.type === EV.PADDLE_HIT);
  assert.ok(hit, 'paddle hit');
  near(hit.x, HORIZONTAL.PADDLE_X + PADDLE.H / 2, 1e-6);
  assert.ok(world.balls[0].vx > 0, 'back toward the bricks');
});

test('ring mode: the paddle follows the pointer bearing; the ball is lost beyond 350', () => {
  const { world, frame } = physicsWorld({ mode: 'ring' });
  frame.steer = true;
  frame.tx = RING.CX + 100;
  frame.ty = RING.CY;
  steps(world, frame, 1);
  near(world.paddle.angle, 0, 1e-12);
  near(world.paddle.x, RING.CX + RING.R_PADDLE, 1e-9);
  // a ball flying outward at bearing 0 bounces off the arc
  launchAt(world, RING.CX, RING.CY, SPEED.TIERS[0], 0);
  const rec = recorder(world);
  steps(world, frame, 120);
  let ev = rec();
  const hit = ev.find((e) => e.type === EV.PADDLE_HIT);
  assert.ok(hit, 'arc hit');
  near(Math.hypot(hit.x - RING.CX, hit.y - RING.CY), RING.R_PADDLE - PADDLE.H / 2, 1e-6);
  // the ball heads back across the centre toward bearing PI; point the paddle down instead
  frame.tx = RING.CX;
  frame.ty = RING.CY + 100;
  steps(world, frame, 240);
  ev = rec();
  assert.ok(ev.some((e) => e.type === EV.BALL_LOST), 'lost');
  const lost = ev.find((e) => e.type === EV.BALL_LOST);
  assert.ok(Math.hypot(lost.x - RING.CX, lost.y - RING.CY) > RING.R_LOSS);
});

for (const [name, level] of [['left', LEFT_TEST], ['ring', RING_TEST], ['framed bottom', FRAME_TEST]]) {
  test(`robot clears a ${name} test field (seeds 1-3)`, () => {
    for (const seed of [1, 2, 3]) {
      const world = createWorld({ level, seed, systems: makeSystems() });
      const res = runHeadless(world, createRobot());
      assert.ok(res.cleared, `seed ${seed}: ${res.remaining} left, phase ${res.phase}`);
      assert.ok(res.nudges <= 3, `seed ${seed}: ${res.nudges} nudges`);
    }
  });
}

/**
 * Ring mode: outward balls at seeded bearings, one at a time, while the pointer moves by `kind`
 * ('still', 'turn' at a hand speed of `speed` u/s along the ring, 'jiggle' 6 units around the
 * centre through four bearings), with a new pointer sample every `per` steps. Answers balls saved.
 */
function ringSaves(kind, per, n, speed = 0) {
  const { world, frame } = physicsWorld({ mode: 'ring' });
  const rng = createRng(11);
  frame.steer = true;
  frame.tx = RING.CX + 100;
  frame.ty = RING.CY;
  steps(world, frame, 1);
  const rec = recorder(world);
  let saved = 0, g = 0;
  for (let k = 0; k < n; k++) {
    const a = rng.range(-Math.PI, Math.PI);
    launchAt(world, RING.CX + Math.cos(a) * 200, RING.CY + Math.sin(a) * 200, Math.cos(a) * 560, Math.sin(a) * 560);
    let done = false;
    for (let i = 0; i < 200 && !done; i++, g++) {
      if (g % per === 0 && kind !== 'still') {
        const bear = kind === 'jiggle' ? ((g / per) % 4) * Math.PI / 2 : g * SIM.DT * speed / RING.R_PADDLE;
        const rad = kind === 'jiggle' ? 6 : 300;
        frame.tx = RING.CX + Math.cos(bear) * rad;
        frame.ty = RING.CY + Math.sin(bear) * rad;
      }
      steps(world, frame, 1);
      for (const e of rec()) {
        if (e.type === EV.PADDLE_HIT) { saved++; done = true; }
        if (e.type === EV.BALL_LOST) done = true;
      }
    }
    world.balls[0].alive = false;
    world.phase = 'play';
  }
  return saved;
}

test('ring mode: a pointer jiggled around the centre saves no more balls than its real travel explains', () => {
  // review 2026-10-22: the pointer's bearing sets the paddle, so a few units of mouse around the
  // centre swung it a quarter turn a frame, and the swept-range rule caught every ball (400/400)
  const N = 150;
  const still = ringSaves('still', 2, N);
  const turn = ringSaves('turn', 2, N, PHYS.RING_SWEEP_MAX);
  for (const per of [1, 2]) {
    const jig = ringSaves('jiggle', per, N);
    console.log(`ring saves of ${N}: still ${still}, turning at ${PHYS.RING_SWEEP_MAX} u/s ${turn}, jiggle (${per} steps a frame) ${jig}`);
    assert.ok(jig <= turn * 1.25 + 5, `jiggle ${per} steps a frame: ${jig} saved, a paddle really turning at ${PHYS.RING_SWEEP_MAX} u/s: ${turn}, still: ${still}`);
  }
  assert.ok(still > N * 0.05 && still < N * 0.25, `a still 40 degree arc saves about a ninth (${still}/${N})`);
});

test('ring mode: a ball level with the arc is hit by an end moving onto it, never by a jump', () => {
  // the ball sits in the paddle band (past the face) just beyond the arc's end, flying outward slowly
  const make = () => {
    const env = physicsWorld({ mode: 'ring' });
    env.frame.steer = true;
    env.frame.tx = RING.CX + 100;
    env.frame.ty = RING.CY;
    steps(env.world, env.frame, 1);
    const half = env.world.paddle.span / 2;
    const a = half + (9 + 6) / (RING.R_PADDLE - PADDLE.H / 2); // 6 units clear of the end
    const R = RING.R_PADDLE;
    const b = launchAt(env.world, RING.CX + Math.cos(a) * R, RING.CY + Math.sin(a) * R, Math.cos(a) * 60, Math.sin(a) * 60);
    return { ...env, b, a, rec: recorder(env.world) };
  };
  // the arc turns toward it at 1200 u/s: its end sweeps onto the ball
  const m = make();
  let hit = false;
  for (let i = 0; i < 4 && !hit; i++) {
    const bear = (i + 1) * 10 / RING.R_PADDLE;
    m.frame.tx = RING.CX + Math.cos(bear) * 100;
    m.frame.ty = RING.CY + Math.sin(bear) * 100;
    steps(m.world, m.frame, 1);
    hit = m.rec().some((e) => e.type === EV.PADDLE_HIT);
  }
  assert.ok(hit, 'the moving end hits it');
  // the arc jumps right onto it (pointer flicked near the centre): it got past the face, no catch
  const j = make();
  j.frame.tx = RING.CX + Math.cos(j.a) * 5;
  j.frame.ty = RING.CY + Math.sin(j.a) * 5;
  steps(j.world, j.frame, 3);
  assert.ok(!j.rec().some((e) => e.type === EV.PADDLE_HIT), 'a jump does not catch it');
});

test('Pull: 900 u/s² toward the paddle, speed x0.85, only with the rule and HEAT', () => {
  const { world, frame } = physicsWorld({ rules: { pull: true } });
  world.econ.heat = 50;
  launchAt(world, 200, 400, 0, -SPEED.TIERS[0]);
  frame.steer = true;
  frame.tx = 600;
  frame.ty = 1000;
  frame.pull = true;
  const rec = recorder(world);
  steps(world, frame, 1);
  assert.ok(world.paddle.pulling);
  const b = world.balls[0];
  near(Math.hypot(b.vx, b.vy), SPEED.TIERS[0] * PULL.SPEED_SCALE, 1e-6, 'trimmed speed');
  assert.ok(b.vx > 0, 'bends toward the paddle');
  steps(world, frame, 60);
  frame.pull = false;
  steps(world, frame, 1);
  assert.ok(!world.paddle.pulling);
  const ev = rec();
  assert.equal(ev.filter((e) => e.type === EV.PULL_START).length, 1);
  assert.equal(ev.filter((e) => e.type === EV.PULL_END).length, 1);
  // no HEAT, or no rule: no Pull
  world.econ.heat = 0;
  frame.pull = true;
  steps(world, frame, 1);
  assert.ok(!world.paddle.pulling, 'no HEAT');
  const w2 = physicsWorld();
  w2.world.econ.heat = 100;
  launchAt(w2.world, 200, 400, 0, -460);
  w2.frame.pull = true;
  steps(w2.world, w2.frame, 1);
  assert.ok(!w2.world.paddle.pulling, 'no rule');
});

test('anti-loop: a ball boxed in by armour is nudged 4 to 7 degrees and the reason is reported', () => {
  // a closed box of indestructible bricks with the ball bouncing inside, nothing breakable
  const X = BF.SOLID;
  const bricks = [];
  for (let c = 0; c < 6; c++) { bricks.push({ x: 210 + c * 60, y: 300, flags: X }); bricks.push({ x: 210 + c * 60, y: 540, flags: X }); }
  for (let r = 0; r < 7; r++) { bricks.push({ x: 150, y: 330 + r * 30, flags: X }); bricks.push({ x: 570, y: 330 + r * 30, flags: X }); }
  const { world, frame } = physicsWorld({ bricks });
  world.level.remaining = 1;
  launchAt(world, 360, 420, 0, -SPEED.TIERS[0]); // straight up and down: a two-surface loop
  const rec = recorder(world);
  steps(world, frame, 120 * 20);
  const nudges = rec().filter((e) => e.type === EV.NUDGE);
  assert.ok(nudges.length >= 1, 'nudged');
  for (const e of nudges) {
    assert.ok(Math.abs(e.a) >= ANTILOOP.NUDGE_MIN_DEG - 1e-9 && Math.abs(e.a) <= ANTILOOP.NUDGE_MAX_DEG + 1e-9, `${e.a} degrees`);
    assert.ok(e.b === 0 || e.b === 1 || e.b === 2);
  }
  assert.equal(world.stats.nudges, nudges.length);
  assert.ok(nudges.some((e) => e.b === 0 || e.b === 1), 'bounce or pattern rule fired');
});

test('anti-loop: every nudge turns the ball 4 to 7 degrees, also one pinned at the 12 degree clamp', () => {
  // review 2026-10-22: a looping ball is often pinned at exactly 12 degrees from the paddle track;
  // a nudge toward flatter used to be undone by the clamp (0 degree nudges)
  const DEG = Math.PI / 180;
  for (const mode of ['bottom', 'left']) {
    const { world, ctx } = physicsWorld({ mode });
    const rec = recorder(world);
    let fake = { sign: 1, deg: 5 };
    world.rng.physics = { sign: () => fake.sign, range: () => fake.deg };
    let n = 0;
    for (let ang = 12; ang <= 20; ang += 0.5) {
      for (let q = 0; q < 4; q++) {
        for (const sign of [-1, 1]) {
          for (const deg of [ANTILOOP.NUDGE_MIN_DEG, 5.5, ANTILOOP.NUDGE_MAX_DEG]) {
            // a flight `ang` degrees off the paddle track, in each quadrant
            const a = ang * DEG, along = Math.cos(a) * 560, across = Math.sin(a) * 560;
            const sa = q & 1 ? -1 : 1, sc = q & 2 ? -1 : 1;
            const b = launchAt(world, 360, 500, mode === 'bottom' ? sa * along : sc * across, mode === 'bottom' ? sc * across : sa * along);
            const vx = b.vx, vy = b.vy;
            fake = { sign, deg };
            nudge(ctx, 0, 0);
            n++;
            const turned = Math.abs(Math.atan2(vx * b.vy - vy * b.vx, vx * b.vx + vy * b.vy)) / DEG;
            const where = `${mode} ${ang} deg q${q} sign ${sign} ask ${deg}`;
            assert.ok(turned >= ANTILOOP.NUDGE_MIN_DEG - 1e-6 && turned <= ANTILOOP.NUDGE_MAX_DEG + 1e-6, `${where}: turned ${turned.toFixed(2)}`);
            near(turned, deg, 1e-6, where);
            near(Math.hypot(b.vx, b.vy), 560, 1e-6, `${where}: speed kept`);
            const off = Math.abs(mode === 'bottom' ? b.vy : b.vx) / 560;
            assert.ok(off >= Math.sin(12 * DEG) - 1e-9, `${where}: still at least 12 degrees off the track`);
          }
        }
      }
    }
    const ev = rec().filter((e) => e.type === EV.NUDGE);
    assert.equal(ev.length, n);
    assert.ok(ev.every((e) => Math.abs(e.a) >= ANTILOOP.NUDGE_MIN_DEG - 1e-9), 'the event reports the turn made');
  }
});

test('anti-loop: with three balls only the 12 s rule runs; boss armour counts as progress', () => {
  const X = BF.SOLID;
  const bricks = [];
  for (let c = 0; c < 6; c++) { bricks.push({ x: 210 + c * 60, y: 300, flags: X }); bricks.push({ x: 210 + c * 60, y: 540, flags: X }); }
  for (let r = 0; r < 7; r++) { bricks.push({ x: 150, y: 330 + r * 30, flags: X }); bricks.push({ x: 570, y: 330 + r * 30, flags: X }); }
  const { world, frame } = physicsWorld({ bricks });
  world.level.remaining = 1;
  launchAt(world, 360, 420, 0, -SPEED.TIERS[0], 0);
  launchAt(world, 300, 420, 120, -SPEED.TIERS[0], 1);
  launchAt(world, 420, 420, -120, -SPEED.TIERS[0], 2);
  const rec = recorder(world);
  steps(world, frame, 120 * 10);
  assert.equal(rec().filter((e) => e.type === EV.NUDGE).length, 0, 'three balls: no bounce or pattern nudges');
  // but a ball that meets neither the paddle nor anything breakable for 12 s is stuck, crowd or
  // not: each of the three boxed balls is nudged by the 12 s rule
  steps(world, frame, 120 * 3);
  const late = rec().filter((e) => e.type === EV.NUDGE);
  assert.deepEqual(late.map((e) => e.id).sort(), [0, 1, 2], 'every boxed ball nudged once');
  assert.ok(late.every((e) => e.b === 2), 'by the 12 s rule');
  // the same box made of boss armour: one ball rattling inside is fighting the boss, not looping
  const boss = physicsWorld({ bricks: bricks.map((b) => ({ ...b, flags: BF.SOLID | BF.BOSS })) });
  boss.world.level.remaining = 1;
  launchAt(boss.world, 360, 420, 0, -SPEED.TIERS[0]);
  const rb = recorder(boss.world);
  steps(boss.world, boss.frame, 120 * 10);
  assert.equal(rb().filter((e) => e.type === EV.NUDGE && e.b === 0).length, 0, 'boss armour: no bounce-count nudges');
});

test('anti-loop: paddle -> portal -> ... -> paddle with nothing broken is nudged after 4 portal trips', () => {
  // B's request: a paddle contact clears the bounce count and the 12 s clock, so a ball cycling
  // through a portal pair and back to the paddle without a brick used to loop for minutes
  const P = BF.PORTAL;
  const { world, frame, ctx } = physicsWorld({ bricks: [{ x: 360, y: 300, flags: P, link: 1 }, { x: 360, y: 600, flags: P, link: 0 }] });
  frame.steer = true;
  frame.tx = 360;
  frame.ty = 1000;
  steps(world, frame, 1);
  launchAt(world, 360, 900, 0, -SPEED.TIERS[0]); // straight up: B -> A -> ceiling -> A -> B -> paddle
  const rec = recorder(world);
  const ev = [];
  for (let i = 0; i < 120 * 20; i++) {
    ctx.sigN[0] = 0; // keep the 4-bounce pattern rule out of it (a moving paddle varies the pattern)
    steps(world, frame, 1);
    ev.push(...rec());
  }
  const nudges = ev.filter((e) => e.type === EV.NUDGE);
  assert.ok(nudges.length >= 1, 'nudged');
  assert.equal(nudges[0].b, 3, 'by the portal rule');
  const first = ev.indexOf(nudges[0]);
  assert.equal(ev.slice(0, first).filter((e) => e.type === EV.PORTAL).length, PHYS.PORTAL_TRIPS, 'on the 4th trip');
  assert.ok(ev.slice(0, first).filter((e) => e.type === EV.PADDLE_HIT).length >= 1, 'paddle contacts in between');
  // the same cycle through a breakable brick (it never breaks: physics only) is play, not a loop
  const w2 = physicsWorld({ bricks: [{ x: 360, y: 300, flags: P, link: 1 }, { x: 360, y: 600, flags: P, link: 0 }, { x: 360, y: 150 }] });
  w2.frame.steer = true;
  w2.frame.tx = 360;
  w2.frame.ty = 1000;
  steps(w2.world, w2.frame, 1);
  launchAt(w2.world, 360, 900, 0, -SPEED.TIERS[0]);
  const r2 = recorder(w2.world);
  let trips = 0, n3 = 0;
  for (let i = 0; i < 120 * 20; i++) {
    w2.ctx.sigN[0] = 0;
    steps(w2.world, w2.frame, 1);
    for (const e of r2()) {
      if (e.type === EV.PORTAL) trips++;
      if (e.type === EV.NUDGE && e.b === 3) n3++;
    }
  }
  assert.ok(trips >= 2 * PHYS.PORTAL_TRIPS, `cycled (${trips} trips)`);
  assert.equal(n3, 0, 'a breakable hit between trips resets the count');
});

test('anti-loop: 12 s away from the paddle without breaking anything', () => {
  const { world, frame } = physicsWorld();
  world.level.remaining = 1;
  const b = launchAt(world, 360, 500, 0, -SPEED.TIERS[0]);
  const rec = recorder(world);
  // keep it away: no paddle, no bricks; force the bounce counter low so only the timer can fire
  for (let i = 0; i < Math.ceil(ANTILOOP.AWAY_MS / SIM.DT_MS) + 10; i++) {
    b.bouncesNoBrick = 0;
    world.systems.physics.ctx.sigN[0] = 0;
    if (b.y > 900) { b.y = 500; b.vy = -Math.abs(b.vy); }
    steps(world, frame, 1);
  }
  const n = rec().filter((e) => e.type === EV.NUDGE);
  assert.equal(n.length, 1);
  assert.equal(n[0].b, 2);
});

test('last bricks: the aim line shows from the paddle and the ball slows 10%', () => {
  const { world, frame } = physicsWorld({ bricks: [{ x: 300, y: 300 }, { x: 420, y: 300 }], rules: { aimAt: 3 } });
  frame.steer = true;
  frame.tx = 360;
  frame.ty = 1000;
  launchAt(world, 380, 800, 0, SPEED.TIERS[0]);
  steps(world, frame, 1);
  const fx = world.fx;
  assert.ok(fx.aim, 'aim line on');
  near(fx.aimY, PADDLE.Y - PADDLE.H / 2, 1e-6, 'starts on the paddle face');
  near(fx.aimX, 380, 1e-6, 'where the ball will meet it');
  assert.ok(fx.aimDY < 0 && fx.aimDX > 0, 'points up and right (hit right of centre)');
  const b = world.balls[0];
  near(Math.hypot(b.vx, b.vy), SPEED.TIERS[0] * 0.9, 1e-6, 'ball slowed 10%');
  // with more bricks than aimAt: no line
  const w2 = physicsWorld({ bricks: [{ x: 300, y: 300 }, { x: 420, y: 300 }, { x: 540, y: 300 }, { x: 180, y: 300 }], rules: { aimAt: 3 } });
  launchAt(w2.world, 380, 800, 0, 460);
  steps(w2.world, w2.frame, 1);
  assert.ok(!w2.world.fx.aim);
});

test('a top-speed ball slows time for 80 ms (real) as it reaches the paddle, once per approach', () => {
  // PLAN §1 fix 4: "80 ms slow-time when a top-tier ball nears the paddle"
  const run = (tier, mode) => {
    const { world, frame } = physicsWorld({ mode });
    frame.steer = true;
    frame.tx = mode === 'left' ? 40 : 360;
    frame.ty = mode === 'left' ? 540 : 1000;
    steps(world, frame, 1);
    const b = mode === 'left' ? launchAt(world, 400, 540, -SPEED.TIERS[tier], 0) : launchAt(world, 360, 700, 0, SPEED.TIERS[tier]);
    b.tier = tier;
    const rec = recorder(world);
    const episodes = []; // [start sim ms, slow sim ms]
    const hits = [];
    let scales = new Set();
    for (let i = 0; i < 120 * 8; i++) {
      const slowBefore = world.timeScale < 1;
      steps(world, frame, 1);
      if (world.timeScale < 1) {
        scales.add(world.timeScale);
        if (!slowBefore) episodes.push([world.time, 0]);
        episodes[episodes.length - 1][1] += SIM.DT_MS;
      }
      for (const e of rec()) if (e.type === EV.PADDLE_HIT) hits.push(world.time);
    }
    return { world, episodes, hits, scales };
  };
  for (const mode of ['bottom', 'left']) {
    const top = run(5, mode);
    assert.ok(top.hits.length >= 3, `${mode}: several approaches (${top.hits.length})`);
    assert.equal(top.episodes.length, top.hits.length, `${mode}: one slow-time per approach`);
    assert.deepEqual([...top.scales], [PHYS.TOP_SLOW_SCALE]);
    for (let k = 0; k < top.hits.length; k++) {
      const [start, simMs] = top.episodes[k];
      // 80 ms of real time at half speed is 40 sim ms; it covers the ball's last 40 sim ms
      near(simMs / PHYS.TOP_SLOW_SCALE, PHYS.TOP_SLOW_REAL_MS, 2 * SIM.DT_MS, `${mode} approach ${k}: real ms`);
      assert.ok(top.hits[k] >= start && top.hits[k] <= start + PHYS.TOP_SLOW_REAL_MS * PHYS.TOP_SLOW_SCALE + SIM.DT_MS,
        `${mode} approach ${k}: the ball reaches the paddle inside the slow-time`);
    }
    assert.equal(top.world.timeScale, 1, 'time back to normal');
    const slow = run(3, mode);
    assert.ok(slow.hits.length >= 2, `${mode}: approaches below the top tier (${slow.hits.length})`);
    assert.equal(slow.episodes.length, 0, `${mode}: no slow-time below the top tier`);
  }
  // ring: an outward top-speed ball meets the arc inside one slow-time
  const { world, frame } = physicsWorld({ mode: 'ring' });
  frame.steer = true;
  frame.tx = RING.CX + 100;
  frame.ty = RING.CY;
  steps(world, frame, 1);
  launchAt(world, RING.CX, RING.CY, SPEED.TIERS[5], 0).tier = 5;
  const rec = recorder(world);
  let slowAt = -1, hitAt = -1;
  for (let i = 0; i < 80 && hitAt < 0; i++) {
    steps(world, frame, 1);
    if (world.timeScale < 1 && slowAt < 0) slowAt = world.time;
    if (rec().some((e) => e.type === EV.PADDLE_HIT)) hitAt = world.time;
  }
  assert.ok(slowAt > 0 && hitAt >= slowAt && hitAt <= slowAt + PHYS.TOP_SLOW_REAL_MS * PHYS.TOP_SLOW_SCALE + SIM.DT_MS, `ring: slow ${slowAt}, hit ${hitAt}`);
});

test('near miss on the last brick: NEAR_MISS and a 200 ms slow-mo that ends', () => {
  const { world, frame } = physicsWorld({ bricks: [{ x: 360, y: 300 }] });
  world.level.remaining = 1;
  // pass the brick's right side 6 units clear, going up
  launchAt(world, 360 + 30 + 9 + 6, 600, 0, -SPEED.TIERS[0]);
  const rec = recorder(world);
  let minScale = 1;
  for (let i = 0; i < 120; i++) {
    steps(world, frame, 1);
    minScale = Math.min(minScale, world.timeScale);
  }
  const ev = rec().filter((e) => e.type === EV.NEAR_MISS);
  assert.equal(ev.length, 1);
  near(ev[0].a, 6, 0.6);
  assert.equal(minScale, SLOWMO.NEAR_MISS_SCALE);
  assert.equal(world.timeScale, 1, 'slow-mo over');
});
