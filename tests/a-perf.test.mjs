// A: the step is cheap and does not allocate (CP3, RULES "60 fps on a mid phone").
//
// 1. Speed: the heaviest level (most bricks of every level and stage) played by the robot for 6
//    sim minutes, a fresh world whenever one ends, in under 3 s of Node time (best of up to 3).
// 2. Allocation: the stress field (tests/fixtures/A/stress.mjs: a wall that never clears, a
//    moving row, multiball kept at 3 or more, up to 12 balls) is played for 12 sim minutes to warm
//    up, then the heap is watched for 6 more sim minutes of the same game, in 72 chunks of 600
//    steps. The sum of the heap's rises over those 6 minutes must stay under 2 MB (brief A): V8
//    allocates a box for every fractional number passed across a call it does not inline, so this
//    catches hot-path regressions (one such call per ball per step is about 6 MB here), and a burst
//    that repeats. The warm-up is 12 minutes, not 6, because in the first minutes a chunk can
//    carry a one-off 2-3 MB when a rare branch (a corner, a push-out, a crowd nudge) first runs and
//    V8 deoptimises and recompiles that function; by minute 12 those have all run (review
//    2026-10-22: minutes 6-12 rose 5.7 MB in two such chunks, minutes 12-18 rose 0.08 MB). The
//    median chunk times the chunks is printed as the steady rate.
import { test, assert } from './lib.mjs';
import v8 from 'node:v8';
import vm from 'node:vm';
import { SIM } from '../src/core/constants.js';
import { createWorld, stepWorld } from '../src/core/world.js';
import { createInputFrame, clearEdges } from '../src/core/input-frame.js';
import { makeSystems } from '../src/systems.js';
import { LEVELS, stagesOf } from '../src/levels/index.js';
import { parseLevel } from '../src/levels/parser.js';
import { createRun } from '../src/economy/economy.js';
import { createRobot } from '../src/sim/robot.js';
import { predictCrossing } from '../src/sim/feel.js';
import { modeCode } from '../src/sim/field.js';
import { STRESS, brickCount } from './fixtures/A/stress.mjs';

const SIX_MIN_STEPS = Math.round(6 * 60 * 1000 / SIM.DT_MS);

/** A real gc when the flag can be set at run time (global.gc is not required). */
function getGc() {
  try {
    v8.setFlagsFromString('--expose-gc');
    return vm.runInNewContext('gc');
  } catch {
    return null;
  }
}

function heaviestLevel() {
  let best = null, bestN = -1;
  for (const l of LEVELS) {
    for (const d of stagesOf(l)) {
      const n = brickCount(parseLevel, d);
      if (n > bestN) { bestN = n; best = d; }
    }
  }
  return { def: best, bricks: bestN };
}

/**
 * A cheap deterministic player for the stress field: stands under the first ball to arrive with
 * an offset that cycles through five values, launches held balls. (The robot would spend most of
 * its time planning shots at a sealed brick.)
 */
function createFollower() {
  const cross = { s: 0.5, t: 0.5, x: 0.5, y: 0.5 };
  return {
    fill(frame, world) {
      frame.action = false;
      frame.overload = false;
      frame.pull = false;
      frame.axis = 0;
      const mc = modeCode(world.level.mode);
      let bt = Infinity, bx = world.paddle.x, held = false;
      for (let i = 0; i < world.balls.length; i++) {
        const b = world.balls[i];
        if (!b.alive) continue;
        if (b.held) { held = true; continue; }
        if (predictCrossing(mc, b, cross) && cross.t < bt) { bt = cross.t; bx = cross.x; }
      }
      const off = ((((world.step / 97) | 0) % 5) - 2) * 14;
      frame.steer = true;
      frame.tx = bx + off;
      frame.ty = world.paddle.y;
      if (held && world.time - world.paddle.lastActionMs > 200) frame.action = true;
    },
  };
}

/** Keep at least `min` balls in play (the test's own multiball, through the physics api). */
function topUp(world, min) {
  if (world.phase !== 'play' || world.step % 60 !== 0) return;
  let live = 0;
  for (let j = 0; j < world.balls.length; j++) if (world.balls[j].alive && !world.balls[j].held) live++;
  if (live > 0 && live < min) world.api.splitBalls(1);
}

test('heaviest level: 6 sim minutes with the robot in under 3 s', () => {
  const { def, bricks } = heaviestLevel();
  assert.ok(def && bricks > 0, 'found the heaviest level');
  const frame = createInputFrame();
  const play = (steps) => {
    let world = null, robot = null, worlds = 0;
    for (let n = 0; n < steps; n++) {
      if (!world || world.phase === 'cleared' || world.phase === 'over') {
        const run = createRun({ seed: 3 + worlds, levelN: def.n });
        world = createWorld({ level: def, seed: 3 + worlds, run, systems: makeSystems() });
        robot = createRobot();
        worlds++;
      }
      robot.fill(frame, world);
      stepWorld(world, frame);
      clearEdges(frame);
    }
    return worlds;
  };
  play(Math.round(30000 / SIM.DT_MS)); // warm-up: 30 sim s
  // wall-clock time on a shared machine: the best of up to three tries (other agents' builds and
  // the parallel test files can stall one try)
  const times = [];
  let worlds = 0;
  for (let k = 0; k < 3 && !(times.length && Math.min(...times) < 3000); k++) {
    const t0 = performance.now();
    worlds = play(SIX_MIN_STEPS);
    times.push(performance.now() - t0);
  }
  const ms = Math.min(...times);
  console.log(`    ${def.id} (${bricks} bricks): 6 sim min in ${times.map((t) => t.toFixed(0)).join(' / ')} ms, ${worlds} plays`);
  assert.ok(ms < 3000, `${def.id}: 6 sim minutes took ${times.map((t) => t.toFixed(0)).join(' / ')} ms`);
}, { timeout: 60000 });

test('no allocation in the step: under 2 MB over 6 sim minutes after warm-up', () => {
  const gc = getGc();
  const run = createRun({ seed: 11, levelN: STRESS.n });
  run.lives = 1e6;
  const world = createWorld({ level: STRESS, seed: 11, run, systems: makeSystems() });
  const ctl = createFollower();
  const f = createInputFrame();
  let maxBalls = 0;
  const play = (steps) => {
    for (let n = 0; n < steps; n++) {
      ctl.fill(f, world);
      stepWorld(world, f);
      clearEdges(f);
      topUp(world, 3);
      let live = 0;
      for (let j = 0; j < world.balls.length; j++) if (world.balls[j].alive) live++;
      if (live > maxBalls) maxBalls = live;
    }
  };
  play(2 * SIX_MIN_STEPS); // warm-up: 12 sim minutes, so every rare branch has run and been compiled
  const hits0 = world.stats.paddleHits;
  if (gc) gc();
  // the heap after every chunk; growth is the sum of the rises (a collection in between only
  // hides what it freed, it never adds)
  let prev = process.memoryUsage().heapUsed, grown = 0;
  const rises = [];
  for (let n = 0; n < SIX_MIN_STEPS; n += 600) {
    play(Math.min(600, SIX_MIN_STEPS - n));
    const h = process.memoryUsage().heapUsed;
    rises.push(h > prev ? h - prev : 0);
    if (h > prev) grown += h - prev;
    prev = h;
  }
  assert.notEqual(world.phase, 'cleared', 'the stress field never clears');
  assert.ok(maxBalls >= 3, `multiball in play (${maxBalls})`);
  const sorted = rises.slice().sort((p, q) => p - q);
  const steady = sorted[sorted.length >> 1] * rises.length / 1e6;
  const mb = grown / 1e6;
  console.log(`    stress: up to ${maxBalls} balls, ${world.stats.paddleHits - hits0} paddle hits; steady ` +
    `${steady.toFixed(2)} MB (${(steady * 1e6 / SIX_MIN_STEPS).toFixed(1)} bytes a step), heap growth ${mb.toFixed(2)} MB, ` +
    `worst chunk ${(sorted[sorted.length - 1] / 1e3).toFixed(0)} KB${gc ? '' : ', no gc'}`);
  assert.ok(mb < 2, `the heap grew ${mb.toFixed(2)} MB in 6 sim minutes after a 12 minute warm-up ` +
    `(worst chunk ${(sorted[sorted.length - 1] / 1e3).toFixed(0)} KB, steady ${steady.toFixed(2)} MB)`);
}, { timeout: 60000 });
