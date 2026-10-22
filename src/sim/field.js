// Kiln — field geometry per mode (OWNER: A). Bricks never know the mode; only this file does.
//
// Pure maths, no world writes except steerPaddle / nudgePaddle / setTrack (the paddle is A's).
// C and D may import any export here (mode transforms, track <-> field point, ring bearing).
//
// Every mode is described by the same few ideas:
//   track    the paddle's 1-D coordinate: bottom = x, left = y, ring = bearing (radians, field
//            coords, y down, so PI/2 is straight down)
//   normal   unit vector from the paddle face into the field (where the bricks are)
//   tangent  unit vector of increasing track coordinate at a point
//   local    (u, v) of a point relative to the paddle: u along the track from the paddle centre
//            (ring: arc length on the face circle), v = distance in front of the paddle face
//   away     the direction falling bodies (embers, drops, bombs) travel: away from the bricks
//   lost     where a ball or body has left play
//
// Mode codes (hot loops switch on these): 0 bottom, 1 left, 2 ring.

import { FIELD, PADDLE, HORIZONTAL, RING } from '../core/constants.js';

export const M_BOTTOM = 0;
export const M_LEFT = 1;
export const M_RING = 2;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Ring face radius: the inner face of the arc paddle (centre line R_PADDLE minus half thickness). */
export const RING_FACE = RING.R_PADDLE - PADDLE.H / 2;
/** Shield line positions per mode (cold power: one miss bounces off it). */
export const SHIELD_LINE = Object.freeze({ bottom: 1060, left: 16, ring: 340 });

/** @param {string} mode */
export function modeCode(mode) {
  return mode === 'left' ? M_LEFT : mode === 'ring' ? M_RING : M_BOTTOM;
}

/** Wrap an angle difference to (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/** Ring bearing of a field point from the ring centre (radians, y down: PI/2 = bottom). */
export function ringBearing(x, y) {
  return Math.atan2(y - RING.CY, x - RING.CX);
}

/** Ring arc span (radians) for a paddle length (120 = 40 degrees; Wide and Shrink scale it). */
export function ringSpanFor(w) {
  return RING.SPAN_DEG * DEG * (w / PADDLE.W);
}

/**
 * Half the paddle's reach along the track, in track-local units (u): bottom/left = w/2,
 * ring = half the arc length on the face circle.
 * @param {number} mc mode code
 * @param {import('../core/types.js').Paddle} p
 */
export function halfReach(mc, p) {
  return mc === M_RING ? (p.span / 2) * RING_FACE : p.w / 2;
}

/**
 * Track coordinate of a field point for a mode.
 * @param {number} mc
 */
export function trackOf(mc, x, y) {
  if (mc === M_LEFT) return y;
  if (mc === M_RING) return ringBearing(x, y);
  return x;
}

/** Track coordinate of the paddle now. */
export function paddleTrack(mc, p) {
  return mc === M_LEFT ? p.y : mc === M_RING ? p.angle : p.x;
}

/** Track coordinate of the paddle on the previous step. */
export function paddlePrevTrack(mc, p) {
  return mc === M_LEFT ? p.py : mc === M_RING ? ringBearing(p.px, p.py) : p.px;
}

/**
 * Paddle centre (on the track line) for a track coordinate. Writes out.x / out.y.
 * @param {number} mc
 * @param {number} t
 * @param {{x:number,y:number}} out
 */
export function trackPoint(mc, t, out) {
  if (mc === M_LEFT) {
    out.x = HORIZONTAL.PADDLE_X;
    out.y = t;
  } else if (mc === M_RING) {
    out.x = RING.CX + Math.cos(t) * RING.R_PADDLE;
    out.y = RING.CY + Math.sin(t) * RING.R_PADDLE;
  } else {
    out.x = t;
    out.y = PADDLE.Y;
  }
  return out;
}

/** Clamp a track coordinate to where the paddle can be (ring: wrap to (-PI, PI]). */
export function clampTrack(mc, t, halfW) {
  if (mc === M_LEFT) return clamp(t, halfW, FIELD.H - halfW);
  if (mc === M_RING) return angleDiff(t, 0);
  return clamp(t, halfW, FIELD.W - halfW);
}

/**
 * Put the paddle at a track coordinate (clamped). Writes x, y, angle.
 * @param {import('../core/types.js').World} world
 * @param {number} t
 */
export function setTrack(world, t) {
  const p = world.paddle;
  const mc = modeCode(world.level.mode);
  const tt = clampTrack(mc, t, p.w / 2);
  if (mc === M_LEFT) {
    p.x = HORIZONTAL.PADDLE_X;
    p.y = tt;
    p.angle = 0;
  } else if (mc === M_RING) {
    p.angle = tt;
    p.x = RING.CX + Math.cos(tt) * RING.R_PADDLE;
    p.y = RING.CY + Math.sin(tt) * RING.R_PADDLE;
  } else {
    p.x = tt;
    p.y = PADDLE.Y;
    p.angle = 0;
  }
}

/**
 * Move the paddle toward a steering target (field units) for the world's mode, 1:1.
 * Writes paddle.x / y / angle; the caller has already copied the previous values.
 * Ring mode: the target's bearing from the centre (a target at the centre keeps the angle).
 * @param {import('../core/types.js').World} world
 * @param {number} tx
 * @param {number} ty
 */
export function steerPaddle(world, tx, ty) {
  const mc = modeCode(world.level.mode);
  if (mc === M_RING) {
    const dx = tx - RING.CX, dy = ty - RING.CY;
    if (dx * dx + dy * dy < 1) return;
    setTrack(world, Math.atan2(dy, dx));
  } else setTrack(world, mc === M_LEFT ? ty : tx);
}

/**
 * Keyboard steering: move along the track by `dist` field units (signed). Positive = right on
 * screen in bottom mode, down in left mode, clockwise-as-seen-from-the-bottom (rightward along
 * the bottom arc) in ring mode.
 * @param {import('../core/types.js').World} world
 * @param {number} dist
 */
export function nudgePaddle(world, dist) {
  const p = world.paddle;
  const mc = modeCode(world.level.mode);
  if (mc === M_RING) setTrack(world, p.angle - dist / RING.R_PADDLE);
  else setTrack(world, paddleTrack(mc, p) + dist);
}

/**
 * Unit normal from the paddle face into the field at a field point (ring: inward radial).
 * @param {number} mc
 * @param {{x:number,y:number}} out
 */
export function normalAt(mc, x, y, out) {
  if (mc === M_LEFT) {
    out.x = 1;
    out.y = 0;
  } else if (mc === M_RING) {
    const dx = x - RING.CX, dy = y - RING.CY;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    out.x = -dx / d;
    out.y = -dy / d;
  } else {
    out.x = 0;
    out.y = -1;
  }
  return out;
}

/**
 * Unit tangent of increasing track coordinate at a field point.
 * bottom (1,0); left (0,1); ring (-sin b, cos b) at bearing b.
 */
export function tangentAt(mc, x, y, out) {
  if (mc === M_LEFT) {
    out.x = 0;
    out.y = 1;
  } else if (mc === M_RING) {
    const b = ringBearing(x, y);
    out.x = -Math.sin(b);
    out.y = Math.cos(b);
  } else {
    out.x = 1;
    out.y = 0;
  }
  return out;
}

/**
 * The direction falling bodies travel at a point: away from the bricks, toward the paddle side.
 * bottom (0,1); left (-1,0); ring radially outward.
 */
export function awayAt(mc, x, y, out) {
  if (mc === M_LEFT) {
    out.x = -1;
    out.y = 0;
  } else if (mc === M_RING) {
    const dx = x - RING.CX, dy = y - RING.CY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) {
      out.x = 0;
      out.y = 1;
    } else {
      out.x = dx / d;
      out.y = dy / d;
    }
  } else {
    out.x = 0;
    out.y = 1;
  }
  return out;
}

/**
 * Local paddle coordinates of a field point for a paddle at track coordinate `t`.
 * out.u: along the track from the paddle centre (ring: arc length on the face circle).
 * out.v: distance in front of the paddle face (positive toward the bricks).
 */
export function toLocal(mc, t, x, y, out) {
  if (mc === M_LEFT) {
    out.u = y - t;
    out.v = x - (HORIZONTAL.PADDLE_X + PADDLE.H / 2);
  } else if (mc === M_RING) {
    const dx = x - RING.CX, dy = y - RING.CY;
    out.u = angleDiff(Math.atan2(dy, dx), t) * RING_FACE;
    out.v = RING_FACE - Math.sqrt(dx * dx + dy * dy);
  } else {
    out.u = x - t;
    out.v = (PADDLE.Y - PADDLE.H / 2) - y;
  }
  return out;
}

/** Inverse of toLocal: field point for local (u, v) relative to a paddle at track `t`. */
export function fromLocal(mc, t, u, v, out) {
  if (mc === M_LEFT) {
    out.x = HORIZONTAL.PADDLE_X + PADDLE.H / 2 + v;
    out.y = t + u;
  } else if (mc === M_RING) {
    const b = t + u / RING_FACE;
    const rr = RING_FACE - v;
    out.x = RING.CX + Math.cos(b) * rr;
    out.y = RING.CY + Math.sin(b) * rr;
  } else {
    out.x = t + u;
    out.y = PADDLE.Y - PADDLE.H / 2 - v;
  }
  return out;
}

/**
 * True when a body centred at (x, y) with radius r has left play.
 * bottom: below the field; left: past the left edge; ring: centre beyond R_LOSS.
 */
export function isLost(mc, x, y, r) {
  if (mc === M_LEFT) return x < -r;
  if (mc === M_RING) {
    const dx = x - RING.CX, dy = y - RING.CY;
    return dx * dx + dy * dy > RING.R_LOSS * RING.R_LOSS;
  }
  return y > FIELD.H + r;
}

/** True when a body is far outside the field in any direction (cleanup for stray bodies). */
export function isOutside(x, y, margin) {
  return x < -margin || x > FIELD.W + margin || y < -margin || y > FIELD.H + margin;
}

/**
 * Field-point -> track coordinate for presentation code (C, D): the paddle position a pointer at
 * (x, y) would ask for, before clamping.
 * @param {string} mode
 */
export function fieldToTrack(mode, x, y) {
  return trackOf(modeCode(mode), x, y);
}

/**
 * Track coordinate -> paddle centre for presentation code (C, D).
 * @param {string} mode
 * @param {number} t
 * @param {{x:number,y:number}} [out]
 */
export function trackToField(mode, t, out = { x: 0, y: 0 }) {
  return trackPoint(modeCode(mode), t, out);
}
