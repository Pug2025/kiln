// Kiln — run a world in Node with no DOM, no three.js, no audio and no clock.
// The robot player (A, src/sim/robot.js) is a Controller: it fills the same InputFrame the real
// input module fills. Tests, the clearable check and G's soak runs all go through here.

import { SIM } from './constants.js';
import { EV } from './events.js';
import { createReader, next } from './bus.js';
import { createInputFrame, clearEdges } from './input-frame.js';
import { createWorld, stepWorld } from './world.js';

/**
 * Step a world until it is cleared, over, or out of time.
 * @param {import('./types.js').World} world
 * @param {import('./types.js').Controller} controller
 * @param {{maxSimMs?:number, onStep?:(w:import('./types.js').World)=>void}} [opts]
 * @returns {import('./types.js').HeadlessResult}
 */
export function runHeadless(world, controller, opts = {}) {
  const maxSteps = Math.ceil((opts.maxSimMs ?? 6 * 60 * 1000) / SIM.DT_MS);
  const frame = createInputFrame();
  const rd = createReader(world.bus, 'headless', 0);
  let livesLost = 0;
  let steps = 0;
  while (steps < maxSteps && world.phase !== 'cleared' && world.phase !== 'over') {
    controller.fill(frame, world);
    stepWorld(world, frame);
    clearEdges(frame);
    steps++;
    while (next(rd)) if (rd.type === EV.LIFE_LOST) livesLost++;
    if (opts.onStep) opts.onStep(world);
  }
  return {
    cleared: world.phase === 'cleared',
    phase: world.phase,
    steps,
    simMs: world.time,
    remaining: world.level.remaining,
    livesLost,
    nudges: world.stats.nudges,
    score: world.run.score,
  };
}

/**
 * Convenience: build a world for a level with the given systems and play it with a controller.
 * @param {import('./types.js').LevelDef} level
 * @param {import('./types.js').Systems} systems
 * @param {import('./types.js').Controller} controller
 * @param {{seed?:number, run?:import('./types.js').RunState, maxSimMs?:number}} [opts]
 */
export function playLevel(level, systems, controller, opts = {}) {
  const world = createWorld({ level, seed: opts.seed ?? 1, run: opts.run, systems });
  const result = runHeadless(world, controller, opts);
  return { world, result };
}
