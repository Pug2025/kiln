// A: every level that exists can be cleared by the robot player (PLAN §10).
// For each level in LEVELS (and every stage reached through `continues`), seeds 1-3, the robot
// clears it within 6 sim minutes per stage with at most 3 nudges, using the real systems.
// Every physics step of every run is also checked (review 2026-10-22): no live ball stands still
// for 30 steps in play, no ball hits one brick twice in a step, and no ball ends a step inside a
// solid brick it is not passing through. And the ceiling (PLAN 11, 2026-10-22): world.field never
// changes during a level, no ball goes past the ceiling or far wall, and no brick in play (moving
// rows, march-down, scrolling, turning boss parts) or sentry is ever cut by it.
// A failure names the level, stage, seed and step so B can replay it:
//   createWorld({ level: getStage(id), seed, run, systems: makeSystems() }) + createRobot().
import { test, assert } from './lib.mjs';
import { createWorld } from '../src/core/world.js';
import { runHeadless } from '../src/core/headless.js';
import { makeSystems } from '../src/systems.js';
import { LEVELS, getStage } from '../src/levels/index.js';
import { createRun } from '../src/economy/economy.js';
import { createRobot } from '../src/sim/robot.js';
import { BF, POOL } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { createReader, next } from '../src/core/bus.js';
import { queryGrid, circleRectOverlap } from '../src/sim/collide.js';
import { IGN } from '../src/sim/ball.js';
import { ceilingProblem } from './fixtures/A/ceiling.mjs';

const SIX_MIN = 6 * 60 * 1000;
const SEEDS = [1, 2, 3];
const STILL_STEPS = 30;
const OVERLAP_TOL = 0.5;

/**
 * Wrap physics.move to check the step invariants after every move. Returns a function that
 * answers the first problem seen ('' when none).
 */
function watchStep(world) {
  const phys = world.systems.physics;
  const move = phys.move;
  const rd = createReader(world.bus, 'a-clearable', world.bus.head);
  const n = world.balls.length;
  const still = new Int32Array(n), px = new Float64Array(n), py = new Float64Array(n);
  const seen = new Int32Array(n * 32);
  const seenN = new Int32Array(n);
  const list = new Int16Array(POOL.BRICKS);
  const out = { nx: 0, ny: 0 };
  const ceil0 = world.field.ceilingY, far0 = world.field.farX;
  let problem = '';
  phys.move = function (w, input) {
    for (let i = 0; i < n; i++) { px[i] = w.balls[i].x; py[i] = w.balls[i].y; }
    rd.cur = w.bus.head;
    move.call(phys, w, input);
    if (problem) return;
    const ctx = phys.ctx;
    seenN.fill(0);
    while (next(rd)) {
      if (rd.type !== EV.BRICK_HIT || rd.a < 0) continue; // ball hits only (lasers send a = -1)
      const bi = rd.a | 0;
      for (let k = 0; k < seenN[bi]; k++) {
        if (seen[bi * 32 + k] === rd.id) problem = `step ${w.step}: ball ${bi} hit brick ${rd.id} twice in one step`;
      }
      if (seenN[bi] < 32) seen[bi * 32 + seenN[bi]++] = rd.id;
    }
    const B = w.bricks;
    // the ceiling (2026-10-22): fixed for the level, no ball past it, no brick or sentry cut by it
    if (!problem) problem = ceilingProblem(w, ceil0, far0);
    for (let bi = 0; bi < n && !problem; bi++) {
      const b = w.balls[bi];
      if (!b.alive || b.held || w.phase !== 'play') { still[bi] = 0; continue; }
      if (Math.abs(b.x - px[bi]) + Math.abs(b.y - py[bi]) < 0.05) {
        if (++still[bi] >= STILL_STEPS) problem = `step ${w.step}: ball ${bi} still for ${STILL_STEPS} steps at (${b.x.toFixed(2)}, ${b.y.toFixed(2)})`;
      } else still[bi] = 0;
      const k = queryGrid(ctx.grid, b.x - b.r, b.y - b.r, b.x + b.r, b.y + b.r, list);
      for (let j = 0; j < k && !problem; j++) {
        const i = list[j];
        if (!(B.flags[i] & BF.SOLID) || !B.alive[i]) continue;
        const d = circleRectOverlap(b.x, b.y, b.r, B.x[i], B.y[i], B.w[i] / 2, B.h[i] / 2, out);
        if (d <= OVERLAP_TOL) continue;
        let passing = false;
        for (let q = 0; q < ctx.ignN[bi]; q++) if (ctx.ign[bi * IGN + q] === i) passing = true;
        if (!passing) problem = `step ${w.step}: ball ${bi} ${d.toFixed(2)} deep inside brick ${i}`;
      }
    }
  };
  return () => problem;
}

/** Play a level and its chained stages with one run. Returns a list of per-stage results. */
export function clearLevel(level, seed) {
  const run = createRun({ seed, levelN: level.n });
  const out = [];
  let def = level;
  let stage = 1;
  while (def) {
    run.levelN = def.n;
    const world = createWorld({ level: def, seed: seed * 1000 + def.n * 31 + stage, run, systems: makeSystems() });
    const problem = watchStep(world);
    const res = runHeadless(world, createRobot(), { maxSimMs: SIX_MIN });
    out.push({ id: def.id, stage, seed, ...res, lives: run.lives, problem: problem() });
    if (!res.cleared) break;
    def = def.continues ? getStage(def.continues) : null;
    stage++;
  }
  return out;
}

for (const level of LEVELS) {
  test(`robot clears level ${level.n}`, () => {
    for (const seed of SEEDS) {
      for (const r of clearLevel(level, seed)) {
        const where = `level ${level.n} (${r.id}, stage ${r.stage}) seed ${seed}`;
        assert.ok(r.cleared,
          `${where}: not cleared after ${r.steps} steps (phase ${r.phase}, ${r.remaining} left, ${r.livesLost} lives lost)`);
        assert.ok(r.simMs <= SIX_MIN, `${where}: took ${(r.simMs / 1000).toFixed(1)} s`);
        assert.ok(r.nudges <= 3, `${where}: ${r.nudges} nudges (step ${r.steps})`);
        assert.equal(r.problem, '', `${where}: ${r.problem}`);
      }
    }
  }, { timeout: 300000 });
}
