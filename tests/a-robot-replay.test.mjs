// Item 23: the robot's shot search got cheaper, and its play must not change. For every run below
// two worlds start from the same seed: one is played by the production robot (src/sim/robot.js and
// aim.js), the other by the frozen copy from main 980f042 (tests/fixtures/A/robot-reference.mjs).
// They step in lockstep. During serve/play the two input frames and the chosen shot (offset, paddle velocity,
// score, the ball and crossing it was planned for) and the plan count must be identical, compared
// with Object.is, so not even the last bit of a number may differ. The worlds then stay identical
// too, which the end checks (step, phase, bricks left, score, the robot's random stream).
//
// The runs cover The Core's three stages (bottom, left and ring fields with moving boss parts and
// the fine search at its last brick), the Crucible, the Stoker, a left and a ring level, a dense
// late level and the opening, over several seeds, with the default robot and the imprecise one.
// During clearing both worlds receive the production reward-collection input. This intentionally
// replaces the old robot's shot searches after the last brick; no planning or RNG advances then.
import { test, assert } from './lib.mjs';
import { createWorld, stepWorld } from '../src/core/world.js';
import { createInputFrame, clearEdges } from '../src/core/input-frame.js';
import { makeSystems } from '../src/systems.js';
import { getLevel, stagesOf } from '../src/levels/index.js';
import { createRun } from '../src/economy/economy.js';
import { createRobot } from '../src/sim/robot.js';
import { createRobot as createReferenceRobot } from './fixtures/A/robot-reference.mjs';
import { physicsWorld, launchAt } from './fixtures/A/sim.mjs';

const FRAME = ['steer', 'tx', 'ty', 'axis', 'fast', 'action', 'pull', 'overload'];
const PLAN = ['ball', 's', 'off', 'vel', 'score', 'at'];

/**
 * Play level n (all its stages) with both robots in lockstep. Returns what was compared.
 * @param {number} n @param {number} seed @param {object} [opts] robot options
 * @param {number} [maxStageMs] sim time per stage
 */
function replay(n, seed, opts = {}, maxStageMs = 150000) {
  const runA = createRun({ seed, levelN: n }), runB = createRun({ seed, levelN: n });
  const robotA = createRobot(opts), robotB = createReferenceRobot(opts);
  const fa = createInputFrame(), fb = createInputFrame();
  let steps = 0, plans = 0, fine = 0;
  for (const def of stagesOf(getLevel(n))) {
    const worldSeed = seed * 1000 + 31 * def.n + (def.stage | 0);
    const a = createWorld({ level: def, seed: worldSeed, run: runA, systems: makeSystems() });
    const b = createWorld({ level: def, seed: worldSeed, run: runB, systems: makeSystems() });
    const maxSteps = Math.ceil(maxStageMs / (1000 / 120));
    for (let s = 0; s < maxSteps && a.phase !== 'cleared' && a.phase !== 'over'; s++) {
      const before = robotA.debug.plans;
      robotA.fill(fa, a);
      if (a.phase === 'clearing') Object.assign(fb, fa);
      else robotB.fill(fb, b);
      for (const k of FRAME) {
        if (!Object.is(fa[k], fb[k])) {
          assert.fail(`level ${n} ${def.id} seed ${seed} step ${a.step}: input ${k} ${fa[k]} vs reference ${fb[k]}`);
        }
      }
      if (robotA.debug.plans !== robotB.debug.plans) {
        assert.fail(`level ${n} ${def.id} seed ${seed} step ${a.step}: ${robotA.debug.plans} plans vs reference ${robotB.debug.plans}`);
      }
      for (const k of PLAN) {
        if (!Object.is(robotA.debug.plan[k], robotB.debug.plan[k])) {
          assert.fail(`level ${n} ${def.id} seed ${seed} step ${a.step}: plan.${k} ${robotA.debug.plan[k]} vs reference ${robotB.debug.plan[k]}`);
        }
      }
      if (robotA.debug.plans !== before) {
        plans++;
        // a plan that ends below 1000 found nothing breakable in either fan: it ran the fine fan
        if (robotA.debug.lastScore < 1000) fine++;
      }
      stepWorld(a, fa);
      stepWorld(b, fb);
      clearEdges(fa);
      clearEdges(fb);
      steps++;
    }
    for (const k of ['step', 'phase', 'time']) assert.equal(a[k], b[k], `level ${n} ${def.id} seed ${seed}: world ${k}`);
    assert.equal(a.level.remaining, b.level.remaining, `level ${n} ${def.id} seed ${seed}: bricks left`);
    assert.equal(a.run.score, b.run.score, `level ${n} ${def.id} seed ${seed}: score`);
    assert.equal(a.rng.robot.state, b.rng.robot.state, `level ${n} ${def.id} seed ${seed}: the robot's random stream`);
    if (a.phase !== 'cleared') break;
  }
  return { steps, plans, fine };
}

test('the robot chooses the same shots as main 980f042 on The Core, every stage, three seeds', () => {
  let plans = 0, fine = 0;
  for (const seed of [1, 2, 3]) {
    const r = replay(30, seed);
    plans += r.plans;
    fine += r.fine;
  }
  // the comparison has to reach the expensive search, or it proves nothing about it
  assert.ok(plans > 300, `${plans} plans compared`);
  assert.ok(fine > 20, `${fine} plans ran the fine fan`);
}, { timeout: 180000 });

test('the robot chooses the same shots as main 980f042 on the other bosses and every field mode', () => {
  let plans = 0;
  for (const [n, seeds] of [[20, [1, 2]], [10, [1, 2]], [21, [1, 2]], [17, [1]], [24, [1]], [1, [1]]]) {
    for (const seed of seeds) plans += replay(n, seed).plans;
  }
  assert.ok(plans > 300, `${plans} plans compared`);
}, { timeout: 180000 });

test('the imprecise robot (no perfect hits, no pickups) also chooses the same shots on The Core', () => {
  const r = replay(30, 4, { perfect: false, pickups: false }, 120000);
  assert.ok(r.plans > 100, `${r.plans} plans compared`);
}, { timeout: 120000 });

test('after the final brick the robot collects rewards without planning shots or spending RNG', () => {
  const { world, frame } = physicsWorld();
  launchAt(world, 360, 900, 0, 600);
  world.phase = 'clearing'; world.level.remaining = 0;
  const E = world.embers;
  E.count = 1; E.alive[0] = 1;
  E.x[0] = 440; E.y[0] = 850; E.vx[0] = 0; E.vy[0] = 400;
  const robot = createRobot(), random = world.rng.robot.state;
  const before = { ...robot.debug.plan }, step = world.step;
  frame.action = frame.overload = frame.pull = true;
  robot.fill(frame, world);
  assert.equal(robot.debug.plans, 0, 'no fan search after the last brick');
  assert.deepEqual(robot.debug.plan, before, 'no replacement shot plan');
  assert.equal(world.rng.robot.state, random);
  assert.equal(world.step, step);
  assert.equal(world.phase, 'clearing');
  assert.equal(frame.action, false); assert.equal(frame.overload, false); assert.equal(frame.pull, false);
  assert.equal(frame.steer, true, 'reward collection remains active');
  assert.ok(frame.tx > world.paddle.x, 'steer toward the falling ember');
  E.alive[0] = 0;
  robot.fill(frame, world);
  assert.equal(frame.steer, false, 'wait when there is nothing to collect');
  assert.equal(robot.debug.plans, 0);
  assert.equal(world.rng.robot.state, random);
});
