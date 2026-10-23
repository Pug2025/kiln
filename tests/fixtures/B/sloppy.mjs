// B's test player: A's robot (no perfect hits) seen through a reaction lag and an aim error that
// drifts. It still plans shots with full geometry; it is not a model of human discovery or
// ability. Deterministic for a seed.

import { SIM } from '../../../src/core/constants.js';
import { createRobot } from '../../../src/sim/robot.js';

/**
 * @param {number} seed
 * @param {{errUnits?:number, lagMs?:number, driftMs?:number, pickups?:boolean}} [opts]
 *   errUnits: the aim misses by up to this much, a new miss every driftMs; lagMs: reaction lag
 */
export function createSloppyRobot(seed, opts = {}) {
  const ERR = opts.errUnits ?? 12;
  const DRIFT = opts.driftMs ?? 400;
  const bot = createRobot({ perfect: false, pickups: opts.pickups ?? true });
  const lag = Math.max(1, Math.round((opts.lagMs ?? 0) / SIM.DT_MS));
  const qx = new Float64Array(lag), qy = new Float64Array(lag), qs = new Uint8Array(lag);
  let k = 0, s = seed >>> 0, err = 0, errAt = -1e9;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  return {
    fill(frame, world) {
      bot.fill(frame, world);
      if (world.time - errAt > DRIFT) { err = (rnd() * 2 - 1) * ERR; errAt = world.time; }
      const tx = frame.tx, ty = frame.ty, st = frame.steer;
      frame.tx = qx[k]; frame.ty = qy[k]; frame.steer = !!qs[k];
      if (frame.steer) { frame.tx += err; frame.ty += err; }
      qx[k] = tx; qy[k] = ty; qs[k] = st ? 1 : 0;
      k = (k + 1) % lag;
    },
  };
}
