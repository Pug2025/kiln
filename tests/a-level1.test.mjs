// A: level 1 end to end with the real systems. Robot clear, the ceremony, losses, embers, drops.
import { test, assert, near } from './lib.mjs';
import { SLOWMO, ANGLE, EMBERS, DROPS, DROP, SIM } from '../src/core/constants.js';
import { EV, PHASE_CODE } from '../src/core/events.js';
import { createWorld, stepWorld } from '../src/core/world.js';
import { createInputFrame, clearEdges } from '../src/core/input-frame.js';
import { createReader, next } from '../src/core/bus.js';
import { runHeadless } from '../src/core/headless.js';
import { makeSystems } from '../src/systems.js';
import { getLevel } from '../src/levels/index.js';
import { createRobot } from '../src/sim/robot.js';
import { physicsWorld, recorder, steps } from './fixtures/A/sim.mjs';

const SIN12 = Math.sin(ANGLE.MIN_FROM_EDGE_DEG * Math.PI / 180);

function play(seed, onStep) {
  const world = createWorld({ level: getLevel(1), seed, systems: makeSystems() });
  const result = runHeadless(world, createRobot(), { onStep });
  return { world, result };
}

test('robot v1 clears Ignition on seeds 1-3 (6 sim minutes, at most 3 nudges)', () => {
  for (const seed of [1, 2, 3]) {
    const { world, result } = play(seed);
    assert.ok(result.cleared, `seed ${seed}: cleared (phase ${result.phase}, ${result.remaining} left)`);
    assert.ok(result.simMs <= 6 * 60 * 1000);
    assert.ok(result.nudges <= 3, `seed ${seed}: ${result.nudges} nudges`);
    assert.equal(world.timeScale, 1, 'slow-mo is over');
    assert.equal(world.fx.zoom, 1);
    assert.deepEqual(world.stats.apiMissing, {}, 'every world.api call is installed');
  }
});

test('last brick: slow-mo at 25% with a 1.3× zoom for 150 sim ms, then cleared', () => {
  const phases = [];
  let lastBrick = null, ceremonyScale = null, ceremonyZoom = null, clearingSteps = 0;
  const { world } = play(2, (w) => {
    if (w.phase === 'clearing') {
      clearingSteps++;
      ceremonyScale = w.timeScale;
      ceremonyZoom = w.fx.zoom;
    }
  });
  const rd = createReader(world.bus, 'check', 0);
  while (next(rd)) {
    if (rd.type === EV.PHASE) phases.push(rd.a);
    if (rd.type === EV.LAST_BRICK) lastBrick = { x: rd.x, y: rd.y };
  }
  assert.ok(lastBrick, 'LAST_BRICK emitted');
  assert.deepEqual(phases.slice(-2), [PHASE_CODE.clearing, PHASE_CODE.cleared]);
  assert.equal(ceremonyScale, SLOWMO.LAST_SCALE);
  assert.equal(ceremonyZoom, SLOWMO.LAST_ZOOM);
  near(clearingSteps * SIM.DT_MS, SLOWMO.LAST_REAL_MS * SLOWMO.LAST_SCALE, SIM.DT_MS + 1e-9, 'ceremony length');
  assert.equal(world.timeScale, 1);
});

test('same seed, same game (physics + robot determinism)', () => {
  const a = play(7), b = play(7);
  assert.equal(a.world.bus.head, b.world.bus.head);
  assert.equal(a.result.steps, b.result.steps);
  assert.equal(a.world.run.score, b.world.run.score);
  assert.equal(a.world.paddle.x, b.world.paddle.x);
});

test('in play the ball is never flatter than 12° from the paddle track', () => {
  let worst = 1;
  play(3, (w) => {
    for (const b of w.balls) {
      if (!b.alive || b.held) continue;
      const s = Math.hypot(b.vx, b.vy);
      if (s > 0) worst = Math.min(worst, Math.abs(b.vy) / s);
    }
  });
  assert.ok(worst >= SIN12 - 1e-9, `flattest flight sin ${worst}`);
});

test('a missed ball: BALL_LOST, OUT_OF_BALLS, a life goes, the serve resets', () => {
  const world = createWorld({ level: getLevel(1), seed: 1, systems: makeSystems() });
  const frame = createInputFrame();
  const rd = createReader(world.bus, 'check', 0);
  const seen = [];
  // launch, then park the paddle in the far corner
  for (let i = 0; i < 1600; i++) {
    frame.steer = true;
    frame.tx = 0;
    frame.ty = 1000;
    frame.action = i === 0;
    stepWorld(world, frame);
    clearEdges(frame);
    while (next(rd)) seen.push(rd.type);
    if (seen.includes(EV.SERVE) && seen.indexOf(EV.BALL_LOST) >= 0 && world.phase === 'serve') break;
  }
  assert.ok(seen.includes(EV.BALL_LOST), 'ball lost');
  assert.ok(seen.indexOf(EV.OUT_OF_BALLS) > seen.indexOf(EV.BALL_LOST));
  assert.equal(world.stats.ballsLost, 1);
  assert.equal(world.phase, 'serve');
  assert.equal(world.run.lives, 2);
  assert.ok(world.balls[0].held);
});

test('embers fall away from the bricks and the paddle catches them; drops too', () => {
  for (const mode of ['bottom', 'left', 'ring']) {
    const { world, frame } = physicsWorld({ mode });
    const p = world.paddle;
    // spawn right in front of the paddle face, a little toward the bricks
    const nx = mode === 'left' ? 1 : mode === 'ring' ? 0 : 0;
    const ny = mode === 'left' ? 0 : -1;
    const made = world.api.spawnEmbers(p.x + nx * 200, p.y + ny * 200, 3);
    assert.equal(made, 3);
    const slot = world.api.spawnDrop(p.x + nx * 150, p.y + ny * 150, DROP.WIDE);
    assert.ok(slot >= 0);
    const rec = recorder(world);
    frame.steer = true;
    frame.tx = p.x;
    frame.ty = p.y;
    steps(world, frame, Math.ceil((250 / EMBERS.FALL) * 1000 / SIM.DT_MS) + 30);
    const ev = rec();
    assert.equal(ev.filter((e) => e.type === EV.EMBER_CAUGHT).length, 3, `${mode}: embers caught`);
    assert.equal(ev.filter((e) => e.type === EV.DROP_CAUGHT && e.a === DROP.WIDE).length, 1, `${mode}: drop caught`);
  }
  // a drop the paddle is not under is missed
  const { world, frame } = physicsWorld();
  world.api.spawnDrop(60, 600, DROP.SLOW);
  const rec = recorder(world);
  frame.steer = true;
  frame.tx = 660;
  frame.ty = 1000;
  steps(world, frame, Math.ceil((600 / DROPS.FALL) * 1000 / SIM.DT_MS));
  assert.ok(rec().some((e) => e.type === EV.DROP_MISSED && e.a === DROP.SLOW));
});
