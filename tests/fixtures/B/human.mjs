// B's human-like test player. It sees the balls as they were `lagMs` ago, guesses where the ball
// will meet the paddle line from that stale view (walls folded, bricks never predicted, so it
// reacts to every brick bounce late), moves there at a capped hand speed, and tries to send the
// ball at one target: the boss core on boss levels, otherwise a brick it picks per shot. Each
// approach gets a fresh aim error of up to `errUnits` along the paddle. No Pull, no Overloads,
// no pickups chased; it taps the action to serve and, while Laser shots are loaded, every half
// second. Deterministic for a seed. Not a model of discovery: it already knows to aim at the core.

import { SIM, BF, BRICK, RING } from '../../../src/core/constants.js';
import {
  modeCode, M_RING, M_LEFT, normalAt, tangentAt, halfReach, paddleTrack, angleDiff, trackOf, RING_FACE,
} from '../../../src/sim/field.js';
import { predictCrossing } from '../../../src/sim/feel.js';

const DEG = Math.PI / 180;

/**
 * @param {number} seed
 * @param {{lagMs?:number, errUnits?:number, handSpeed?:number}} [opts]
 *   lagMs: reaction lag; errUnits: the paddle lands up to this far from where it meant to;
 *   handSpeed: the fastest the paddle moves, field units per second
 */
export function createHumanish(seed, opts = {}) {
  const LAG = Math.max(1, Math.round((opts.lagMs ?? 160) / SIM.DT_MS));
  const ERR = opts.errUnits ?? 18;
  const SPEED = (opts.handSpeed ?? 1500) * SIM.DT;
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  // ring buffer of what the player saw, LAG steps deep, per ball: x, y, vx, vy, r, flags
  let seen = null, head = 0, filled = 0;
  const cross = { s: 0, t: 0, x: 0, y: 0 };
  const n = { x: 0, y: 0 }, tg = { x: 0, y: 0 };
  const stale = { x: 0, y: 0, vx: 0, vy: 0, r: 9 };
  let err = 0, approachBall = -1, approachDir = 0, target = -1, aimAt = 0;
  let heldSince = -1, lastTap = -1e9, goal = NaN;

  function pickTarget(world) {
    const B = world.bricks;
    const live = [];
    for (let i = 0; i < B.count; i++) {
      if (!B.alive[i] || (B.flags[i] & BF.HIDDEN)) continue;
      if (world.boss.active ? B.type[i] === BRICK.WEAK : (B.flags[i] & BF.CLEARABLE)) live.push(i);
    }
    return live.length ? live[Math.floor(rnd() * live.length)] : -1;
  }

  return {
    fill(frame, world) {
      const balls = world.balls, mc = modeCode(world.level.mode), p = world.paddle;
      const N = balls.length;
      if (!seen) seen = new Float64Array(LAG * N * 6);
      // record this step
      for (let i = 0; i < N; i++) {
        const b = balls[i], o = (head * N + i) * 6;
        seen[o] = b.x; seen[o + 1] = b.y; seen[o + 2] = b.vx; seen[o + 3] = b.vy; seen[o + 4] = b.r;
        seen[o + 5] = b.alive ? (b.held ? 2 : 1) : 0;
      }
      const old = filled >= LAG - 1 ? (head + 1) % LAG : 0; // the oldest kept view
      head = (head + 1) % LAG;
      if (filled < LAG) filled++;
      frame.action = false;
      frame.pull = false;
      frame.overload = false;
      // serve: a short look, then launch
      let held = false;
      for (let i = 0; i < N; i++) if (balls[i].alive && balls[i].held) held = true;
      if (held) {
        if (heldSince < 0) heldSince = world.time;
        if (world.time - heldSince > 450) { frame.action = true; heldSince = -1; }
      } else heldSince = -1;
      if (!held && world.effects.laserShots > 0 && world.time - lastTap > 500 && world.phase === 'play') {
        frame.action = true;
        lastTap = world.time;
      }
      // the ball (as seen LAG ago) that meets the paddle line first
      let best = -1, bestT = Infinity;
      for (let i = 0; i < N; i++) {
        const o = (old * N + i) * 6;
        if (seen[o + 5] !== 1) continue;
        stale.x = seen[o]; stale.y = seen[o + 1]; stale.vx = seen[o + 2]; stale.vy = seen[o + 3]; stale.r = seen[o + 4];
        if (!predictCrossing(mc, stale, cross)) continue;
        if (cross.t < bestT) { bestT = cross.t; best = i; }
      }
      const reach = halfReach(mc, p);
      const unit = mc === M_RING ? 1 / RING_FACE : 1; // field units to track units
      if (best >= 0) {
        const o = (old * N + best) * 6;
        stale.x = seen[o]; stale.y = seen[o + 1]; stale.vx = seen[o + 2]; stale.vy = seen[o + 3]; stale.r = seen[o + 4];
        predictCrossing(mc, stale, cross);
        const dir = Math.sign(stale.vx) * 2 + Math.sign(stale.vy);
        if (best !== approachBall || dir !== approachDir) {
          // a new approach (or the ball bounced off something): a new guess, a new aim error
          approachBall = best;
          approachDir = dir;
          err = (rnd() * 2 - 1) * ERR;
          if (target < 0 || !world.bricks.alive[target] || world.time - aimAt > 4000) { target = pickTarget(world); aimAt = world.time; }
        }
        let off = 0;
        if (target >= 0) {
          const B = world.bricks;
          const dx = B.x[target] - cross.x, dy = B.y[target] - cross.y;
          normalAt(mc, cross.x, cross.y, n);
          tangentAt(mc, cross.x, cross.y, tg);
          const a = Math.atan2(dx * tg.x + dy * tg.y, dx * n.x + dy * n.y);
          const k = Math.max(-1, Math.min(1, a / (70 * DEG)));
          off = Math.max(-0.85, Math.min(0.85, k / 0.75));
        }
        goal = cross.s - (off * reach + err) * unit;
        if (mc === M_RING && (stale.x - RING.CX) * stale.vx + (stale.y - RING.CY) * stale.vy < 0) {
          // ring field, ball heading inward: it will meet bricks first, so stay under its bearing
          goal = trackOf(mc, stale.x, stale.y);
        }
      } else if (!held) {
        // nothing coming: drift under the nearest ball, as people do
        for (let i = 0; i < N; i++) {
          const o = (old * N + i) * 6;
          if (seen[o + 5] === 1) { goal = trackOf(mc, seen[o], seen[o + 1]); break; }
        }
      }
      const now = paddleTrack(mc, p);
      if (Number.isFinite(goal)) {
        const d = mc === M_RING ? angleDiff(goal, now) : goal - now;
        const step = SPEED * unit;
        const t = now + Math.max(-step, Math.min(step, d));
        frame.steer = true;
        if (mc === M_RING) {
          // the sim reads a bearing from the ring centre
          frame.tx = RING.CX + Math.cos(t) * 300;
          frame.ty = RING.CY + Math.sin(t) * 300;
        } else if (mc === M_LEFT) { frame.tx = 0; frame.ty = t; } else { frame.tx = t; frame.ty = 0; }
      } else frame.steer = false;
    },
  };
}
