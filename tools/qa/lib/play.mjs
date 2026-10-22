// Kiln QA (G): headless play helpers shared by tools/qa/soak.mjs and tests/g-*.test.mjs.
// Everything here drives the real systems (makeSystems) with A's robot through runHeadless, the
// same way main.js plays in the browser, and watches the event bus while it runs.

import { SIM, FIELD } from '../../../src/core/constants.js';
import { createWorld } from '../../../src/core/world.js';
import { runHeadless } from '../../../src/core/headless.js';
import { makeSystems } from '../../../src/systems.js';
import { getLevel, getStage, LEVELS, CAMPAIGN_LENGTH } from '../../../src/levels/index.js';
import { createRun } from '../../../src/economy/economy.js';
import { createRobot } from '../../../src/sim/robot.js';
import { eventStreamHasher, busWindow } from './stream.mjs';

export const SIX_MINUTES_MS = 6 * 60 * 1000;

/** The world seed main.js uses for a level or stage of a run (kept in step with src/main.js). */
export function worldSeed(run, def) {
  return run.seed + def.n * 31 + (def.stage | 0);
}

/** Every campaign level number that exists right now. */
export function existingLevels() {
  return LEVELS.map((l) => l.n);
}

/**
 * Sanity of the moving bodies: finite positions inside the field (a little slack for the ball
 * leaving through the open side).
 * @returns {string} '' when fine, otherwise what is wrong
 */
export function bodyProblem(world) {
  for (let i = 0; i < world.balls.length; i++) {
    const b = world.balls[i];
    if (!b.alive) continue;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
      return `ball ${i} is not finite (${b.x}, ${b.y})`;
    }
    const m = 4 * b.r + 40;
    if (b.x < -m || b.x > FIELD.W + m || b.y < -m || b.y > FIELD.H + m) return `ball ${i} left the field at (${b.x.toFixed(1)}, ${b.y.toFixed(1)})`;
  }
  const p = world.paddle;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 'paddle is not finite';
  return '';
}

/**
 * Play one level (or stage) definition with the robot and watch the bus.
 * @param {import('../../../src/core/types.js').LevelDef} def
 * @param {{seed?:number, run?:object, maxSimMs?:number, robot?:object, checkEvery?:number}} [opts]
 */
export function playWorld(def, opts = {}) {
  const world = createWorld({ level: def, seed: opts.seed ?? 1, run: opts.run, systems: makeSystems() });
  const hash = eventStreamHasher(world.bus);
  const win = busWindow(world.bus, SIM.MAX_STEPS_PER_FRAME);
  const checkEvery = opts.checkEvery ?? 120;
  let problem = '';
  let problemStep = -1;
  const t0 = performance.now();
  const result = runHeadless(world, opts.robot || createRobot(), {
    maxSimMs: opts.maxSimMs ?? SIX_MINUTES_MS,
    onStep(w) {
      hash.update();
      win.sample();
      if (!problem && w.step % checkEvery === 0) {
        problem = bodyProblem(w);
        if (problem) problemStep = w.step;
      }
    },
  });
  hash.update();
  if (!problem) {
    problem = bodyProblem(world);
    if (problem) problemStep = world.step;
  }
  return {
    world,
    result,
    hash: hash.hex(),
    events: hash.count,
    lost: hash.lost,
    maxWindow: win.max,
    problem,
    problemStep,
    apiMissing: { ...world.stats.apiMissing },
    wallMs: performance.now() - t0,
  };
}

/**
 * One campaign run from level `from` to `to` with one run state (lives, score, Mods carried),
 * The Core's stages chained through def.continues exactly as main.js does. Missing level
 * numbers are skipped and listed (content still being written).
 * onWorld(row, run, def) runs after each world, with the run state as it stands then (a test can
 * bank it into a save there, as main.js does at each clear).
 * @param {{seed?:number, from?:number, to?:number, maxSimMs?:number, onWorld?:(r:object, run:object, def:object)=>void}} [opts]
 */
export function playCampaign(opts = {}) {
  const run = createRun({ seed: opts.seed ?? 1 });
  const from = opts.from ?? 1;
  const to = opts.to ?? CAMPAIGN_LENGTH;
  const worlds = [];
  const missing = [];
  let outcome = 'finished';
  outer: for (let n = from; n <= to; n++) {
    let def = getLevel(n);
    if (!def) {
      missing.push(n);
      continue;
    }
    while (def) {
      run.levelN = def.n;
      const r = playWorld(def, { seed: worldSeed(run, def), run, maxSimMs: opts.maxSimMs });
      const row = {
        n: def.n, id: def.id, stage: def.stage | 0, mode: def.mode || 'bottom',
        phase: r.result.phase, cleared: r.result.cleared, simMs: r.result.simMs,
        livesLost: r.result.livesLost, nudges: r.result.nudges, lives: run.lives, score: run.score,
        events: r.events, lost: r.lost, maxWindow: r.maxWindow, problem: r.problem, hash: r.hash,
      };
      worlds.push(row);
      if (opts.onWorld) opts.onWorld(row, run, def);
      if (r.result.phase === 'over') { outcome = 'over'; break outer; }
      if (!r.result.cleared) { outcome = 'stuck'; break outer; }
      def = def.continues ? getStage(def.continues) : null;
    }
  }
  return { outcome, run, worlds, missing };
}
