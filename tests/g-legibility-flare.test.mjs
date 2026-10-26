// Execute the actual QA launcher/reacquisition code against real physics and robot input.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { physicsWorld, launchAt, steps } from './fixtures/A/sim.mjs';
import { createRobot } from '../src/sim/robot.js';
import { BALL, FIELD, SIM, SPEED } from '../src/core/constants.js';

const source = readFileSync(new URL('../tools/qa/legibility.mjs', import.meta.url), 'utf8');
const literal = name => new Function('return ' + source.match(new RegExp('const ' + name + ' = (`[\\s\\S]*?`);'))[1])();
const qa = literal('QA_SRC'), stateSource = literal('FLARE_STATE_SRC');
const body = source.match(/async function ensureFlareBall\(ev\) \{([\s\S]*?)\n\}/)[1];
const ensure = new Function('FLARE_STATE_SRC', `return async function(ev) { ${body} };`)(stateSource);

function harness(fixture) {
  const { world, frame } = fixture, robot = createRobot({ pickups: false, perfect: false, rescue: false });
  world.run = { lives: 3 };
  let advances = 0;
  const window = {
    requestAnimationFrame: () => 0,
    __kiln: { world, app: { mode: 'play', paused: false }, advance() {
      advances++;
      // The real app's 60 Hz frame consumes two 120 Hz sim steps, each with robot input.
      for (let i = 0; i < 2; i++) { robot.fill(frame, world); steps(world, frame, 1); }
    } },
  };
  const context = vm.createContext({ window }); vm.runInContext(qa, context);
  const L = window.__kilnLeg; L.combo = 50; L.mult = 5; L.lives = 3;
  return { world, L, advances: () => advances, ev: async code => vm.runInContext(code, context) };
}

test('a free ball after easing adds no sim frames or world changes before the normal forced loss', async () => {
  const f = physicsWorld(); launchAt(f.world, 360, 600, 0, -300);
  const h = harness(f); h.L.step(45);
  const before = { step: f.world.step, time: f.world.time, ball: { ...f.world.balls[0] },
    combo: f.world.econ.combo, mult: f.world.econ.mult, lives: f.world.run.lives };
  const calls = h.advances(), result = await ensure(h.ev);
  assert.equal(result.ok, true); assert.equal(result.frames, 0);
  assert.equal(h.advances(), calls, 'normal progression has no extra advance call');
  assert.deepEqual({ step: f.world.step, time: f.world.time, ball: { ...f.world.balls[0] },
    combo: f.world.econ.combo, mult: f.world.econ.mult, lives: f.world.run.lives }, before);
  assert.equal(h.L.freeBall({ alive: true, held: false, sealed: -1 }), true);
  for (const b of [{ alive: false, held: false, sealed: -1 }, { alive: true, held: true, sealed: -1 },
    { alive: true, held: false, sealed: 0 }]) assert.equal(h.L.freeBall(b), false);
});

test('a real Catch during the 45-frame gap is released by real robot input before preparing loss', async () => {
  const f = physicsWorld(), { world, frame } = f;
  world.effects.catchOn = true; frame.steer = true; frame.tx = 360; frame.ty = 1000;
  steps(world, frame, 1);
  const speed = SPEED.TIERS[0], contact = world.paddle.y - world.paddle.h / 2 - BALL.R;
  launchAt(world, 380, contact - speed * 86 * SIM.DT, 0, speed);
  steps(world, frame, 90); // 45 render frames; collision lands near its end.
  assert.equal(world.balls[0].held, true, 'real paddle collision catches the ball');
  const h = harness(f), result = await ensure(h.ev);
  assert.equal(result.before.freeCount, 0); assert.equal(result.before.balls[0].held, true);
  assert.equal(result.ok, true); assert.ok(result.frames > 0 && result.frames <= 900);
  assert.equal(world.balls[0].held, false, 'physics consumed the robot release action');
  assert.equal(world.phase, 'play'); assert.equal(world.econ.mult, 5); assert.equal(world.run.lives, 3);
});

test('a real loss followed by a held serve reacquires through the real launcher without changing lives', async () => {
  const f = physicsWorld(), { world, frame } = f;
  launchAt(world, 40, FIELD.H + BALL.R + 2, 0, 600); steps(world, frame, 1);
  assert.equal(world.stats.ballsLost, 1); assert.equal(world.balls[0].alive, false);
  world.api.serve(); // Same public physics serve operation used after a life is lost.
  const h = harness(f), result = await ensure(h.ev);
  assert.equal(result.before.phase, 'serve'); assert.equal(result.before.freeCount, 0);
  assert.equal(result.ok, true); assert.ok(result.frames > 0 && result.frames <= 900);
  assert.equal(result.after.phase, 'play'); assert.ok(result.after.freeCount > 0);
  assert.equal(world.stats.ballsLost, 1, 'reacquisition does not manufacture the flare loss');
  assert.equal(world.run.lives, 3); assert.equal(world.econ.combo, 50); assert.equal(world.econ.mult, 5);
});

test('a terminal phase remains an explicit bounded failure with actual ball diagnostics', async () => {
  const f = physicsWorld(); f.world.phase = 'cleared';
  for (const b of f.world.balls) b.alive = false;
  const h = harness(f), result = await ensure(h.ev);
  assert.equal(result.ok, false); assert.equal(result.frames, -1); assert.equal(h.advances(), 900);
  assert.equal(result.after.phase, 'cleared'); assert.equal(result.after.freeCount, 0);
  assert.ok(result.after.balls.every(b => !b.alive));
});
