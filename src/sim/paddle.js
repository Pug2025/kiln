// Kiln: the paddle (OWNER: A): 1:1 steering, width easing, afterimage ghosts, and the bounce rule.
//
// Bounce rule (PLAN §2): the outgoing direction leans from the paddle normal toward the track
// tangent by  70 deg x clamp(0.75 x hit offset + 0.25 x paddle velocity, -1, 1).  The incoming
// angle does not matter, so a player (and the robot) can read and aim every shot.
// Paddle velocity is normalised by VEL_REF: a paddle moving 1200 u/s or faster gives the full 25%.
// Spin: the same normalised velocity, decaying to zero over SPIN.DURATION_MS, bends the flight
// toward the direction the paddle was moving (radius SPIN.MIN_RADIUS at full spin).

import { SIM, PADDLE, ANGLE, RING, PHYS } from '../core/constants.js';
import {
  M_LEFT, M_RING, modeCode, normalAt, tangentAt, setTrack, steerPaddle, nudgePaddle, paddleTrack,
  angleDiff, ringSpanFor,
} from './field.js';

const DEG = Math.PI / 180;
/** Paddle speed along the track that gives the full velocity share of the bounce angle and full spin. */
export const VEL_REF = PHYS.VEL_REF;
/** Paddle width eases toward effects.paddleW with this time constant (sim ms). */
const WIDTH_TAU_MS = 90;
/** Afterimage paddles trail by these many steps (80 ms and 160 ms at 120 Hz). */
export const GHOST_STEPS = [Math.round(80 / SIM.DT_MS), Math.round(160 / SIM.DT_MS)];
const HIST = 32;
/**
 * Paddle speed is the last move divided by the time since the move before it, up to this many
 * steps (33 ms). A display frame holds 1 to 4 sim steps that share one pointer target (60 Hz: 2,
 * 30 Hz: 4): the paddle moves on the first and stands on the rest, so a per-step difference reads
 * double, then zero. The speed is held over the still steps of the frame, and falls to 0 once the
 * paddle stands longer than the gap it last moved after.
 */
export const VEL_GAP_MAX = 4;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Outgoing unit direction off the paddle at a contact point.
 * @param {number} mc mode code
 * @param {number} cx contact x  @param {number} cy contact y
 * @param {number} off hit offset -1..1 (positive = toward increasing track)
 * @param {number} velNorm paddle velocity / VEL_REF, clamped -1..1
 * @param {{x:number,y:number}} n scratch  @param {{x:number,y:number}} t scratch
 * @param {{x:number,y:number}} out
 */
export function bounceDir(mc, cx, cy, off, velNorm, n, t, out) {
  BOUNCE.cx = cx;
  BOUNCE.cy = cy;
  BOUNCE.off = off;
  BOUNCE.vel = velNorm;
  return bounceCore(mc, n, t, out);
}

/**
 * Inputs of bounceCore (contact point, offset, normalised velocity). bounceDir is a small
 * wrapper that fills it, so a call that is not inlined passes no fractional numbers (V8 would
 * allocate a box for each; see collide.js Q).
 */
export const BOUNCE = { cx: 0.5, cy: 0.5, off: 0.5, vel: 0.5 };

/** bounceDir with its numbers in BOUNCE. */
export function bounceCore(mc, n, t, out) {
  const cx = BOUNCE.cx, cy = BOUNCE.cy, off = BOUNCE.off, velNorm = BOUNCE.vel;
  normalAt(mc, cx, cy, n);
  tangentAt(mc, cx, cy, t);
  const k = clamp(ANGLE.POS_WEIGHT * off + ANGLE.VEL_WEIGHT * velNorm, -1, 1);
  const a = k * ANGLE.MAX_FROM_NORMAL_DEG * DEG;
  const c = Math.cos(a), s = Math.sin(a);
  out.x = n.x * c + t.x * s;
  out.y = n.y * c + t.y * s;
  return out;
}

/** Which way a positive track velocity turns the flight (rotation sign in field coords). */
export function spinSign(mc) {
  return mc === M_RING ? -1 : 1;
}

/** Normalised paddle velocity for the bounce angle and spin. */
export function velNormOf(p) {
  return clamp(p.vel / VEL_REF, -1, 1);
}

/**
 * Per-world paddle helper state (afterimage history).
 */
export function createPaddleState() {
  // still: steps the paddle has stood since it last moved; gap: steps that move came after
  return { hist: new Float32Array(HIST), head: 0, filled: 0, prevTrack: 0, still: VEL_GAP_MAX, gap: 1 };
}

/**
 * Steer the paddle for one step: width easing, 1:1 steering or keys, velocity, ghosts.
 * @param {import('../core/types.js').World} world
 * @param {import('../core/types.js').InputFrame} input
 * @param {ReturnType<typeof createPaddleState>} ps
 */
export function updatePaddle(world, input, ps) {
  const p = world.paddle;
  const mc = modeCode(world.level.mode);
  // paddleTrack written out: a call V8 does not inline returns its number in a new box
  const prev = (mc === M_LEFT ? p.y : mc === M_RING ? p.angle : p.x);
  // width eases toward the effect target
  const target = world.effects.paddleW > 0 ? world.effects.paddleW : PADDLE.W;
  const dw = target - p.w;
  if (Math.abs(dw) < 0.25) p.w = target;
  else p.w += dw * (1 - Math.exp(-SIM.DT_MS / WIDTH_TAU_MS));
  p.span = ringSpanFor(p.w);
  if (input.steer) steerPaddle(world, input.tx, input.ty);
  else if (input.axis) {
    nudgePaddle(world, input.axis * (input.fast ? PADDLE.KEY_SPEED_FAST : PADDLE.KEY_SPEED) * SIM.DT);
  } else setTrack(world, prev); // re-clamp after a width change
  const now = (mc === M_LEFT ? p.y : mc === M_RING ? p.angle : p.x);
  // speed over the time since the paddle last moved (VEL_GAP_MAX: one display frame, not one step)
  const d = mc === M_RING ? angleDiff(now, prev) * RING.R_PADDLE : now - prev;
  if (d > 1e-9 || d < -1e-9) {
    const k = ps.still + 1 < VEL_GAP_MAX ? ps.still + 1 : VEL_GAP_MAX;
    p.vel = d / (k * SIM.DT);
    ps.gap = k;
    ps.still = 0;
  } else {
    if (ps.still < VEL_GAP_MAX) ps.still++;
    if (ps.still >= ps.gap) p.vel = 0;
  }
  ps.prevTrack = prev;
  // afterimage history (track coordinates)
  ps.hist[ps.head] = now;
  ps.head = (ps.head + 1) % HIST;
  if (ps.filled < HIST) ps.filled++;
  if (world.level.rules.ghosts) {
    for (let g = 0; g < 2; g++) {
      const back = Math.min(GHOST_STEPS[g], ps.filled - 1);
      p.ghostX[g] = ps.hist[(ps.head - 1 - back + HIST * 2) % HIST];
    }
  } else {
    p.ghostX[0] = now;
    p.ghostX[1] = now;
  }
}

/** Fill the ghost history with the current position (new world, serve). */
export function resetPaddleHistory(world, ps) {
  const mc = modeCode(world.level.mode);
  const now = paddleTrack(mc, world.paddle);
  ps.hist.fill(now);
  ps.filled = HIST;
  ps.prevTrack = now;
  ps.still = VEL_GAP_MAX;
  ps.gap = 1;
  world.paddle.vel = 0;
  world.paddle.ghostX[0] = now;
  world.paddle.ghostX[1] = now;
}
