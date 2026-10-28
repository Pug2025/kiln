// Local bloom guards follow drawn geometry. They never change the simulation or scene colour.
import { BALL, FIELD, PADDLE, RING } from '../core/constants.js';
import { LOOK } from './look.js';

export const BALL_BLOOM = Object.freeze({
  MAX: BALL.MAX,
  INNER: 1.5,
  FEATHER: 0.75,
  FILTER_PAD: 2,
});

/**
 * Write drawing-buffer circles (x, y, inner radius, feather) into a fixed vec4 pool.
 * `clip` is projectionMatrix * matrixWorldInverse, in three.js column-major order.
 * Screen Y points up, as in the bloom composite. No allocation or world mutation.
 */
export function writeBallBloom(out, world, alpha, clip, width, height, enabled = true) {
  out.fill(0);
  if (!enabled) return 0;
  const limit = Math.min(BALL_BLOOM.MAX, out.length / 4);
  let count = 0;
  for (let i = 0; i < world.balls.length && count < limit; i++) {
    const b = world.balls[i];
    if (!b.alive || b.sealed >= 0 || !(b.r > 0)) continue;
    const x = (b.held ? b.x : b.px + (b.x - b.px) * alpha) - FIELD.W / 2;
    const y = FIELD.H / 2 - (b.held ? b.y : b.py + (b.y - b.py) * alpha);
    const cw = clip[3] * x + clip[7] * y + clip[15];
    if (!(cw > 0)) continue;
    const cx = (clip[0] * x + clip[4] * y + clip[12]) / cw;
    const cy = (clip[1] * x + clip[5] * y + clip[13]) / cw;
    const xw = cw + clip[3] * b.r, yw = cw - clip[7] * b.r;
    if (!(xw > 0 && yw > 0)) continue;
    const ex = (clip[0] * (x + b.r) + clip[4] * y + clip[12]) / xw;
    const ey = (clip[1] * (x + b.r) + clip[5] * y + clip[13]) / xw;
    const fx = (clip[0] * x + clip[4] * (y - b.r) + clip[12]) / yw;
    const fy = (clip[1] * x + clip[5] * (y - b.r) + clip[13]) / yw;
    // Math.sqrt, not Math.hypot: V8 boxes a builtin call's fractional arguments (item 21)
    const ax = (ex - cx) * width / 2, ay = (ey - cy) * height / 2;
    const bx = (fx - cx) * width / 2, by = (fy - cy) * height / 2;
    const radius = Math.sqrt(Math.max(ax * ax + ay * ay, bx * bx + by * by));
    if (!(radius > 0 && Number.isFinite(radius))) continue;
    const j = count++ * 4;
    out[j] = (cx + 1) * width / 2;
    out[j + 1] = (cy + 1) * height / 2;
    out[j + 2] = radius * BALL_BLOOM.INNER + BALL_BLOOM.FILTER_PAD;
    out[j + 3] = Math.max(1, radius * BALL_BLOOM.FEATHER);
  }
  return count;
}

/**
 * Radius about the projected paddle chord that contains its drawn bar or bent arc. Projecting
 * the local box corners bounds every bevel and arc vertex, including depth and cosmetic lean.
 * The two-pixel pad also covers the bright pass's half-resolution sampling footprint.
 */
export function paddleBloomRadius(p, mode, rotation, clip, width, height, ax, ay, bx, by) {
  const ring = mode === 'ring', halfH = (ring ? PADDLE.H : p.h) / 2 + 2;
  const halfSpan = (p.span > 0 ? p.span : RING.SPAN_DEG * Math.PI / 180) / 2;
  const halfW = ring ? (RING.R_PADDLE + halfH) * Math.sin(Math.min(Math.PI / 2, halfSpan)) : Math.max(8, p.w) / 2;
  const y0 = -halfH;
  // Thin heat, perfect and Catch lines add their local y offset after the bend. Add the full
  // cross-section beyond the sag, rather than rotating that offset with the radial surface.
  const y1 = ring ? RING.R_PADDLE * (1 - Math.cos(Math.min(Math.PI, halfSpan))) + halfH : halfH;
  const halfD = LOOK.PADDLE_DEPTH / 2 + 2;
  const c = Math.cos(rotation), s = Math.sin(rotation), dx = bx - ax, dy = by - ay;
  const length2 = Math.max(1e-4, dx * dx + dy * dy);
  let radius = 0;
  for (let i = 0; i < 8; i++) {
    const lx = i & 1 ? halfW : -halfW, ly = i & 2 ? y1 : y0, z = i & 4 ? halfD : -halfD;
    const x = p.x - FIELD.W / 2 + lx * c - ly * s;
    const y = FIELD.H / 2 - p.y + lx * s + ly * c;
    const cw = clip[3] * x + clip[7] * y + clip[11] * z + clip[15];
    if (!(cw > 0)) continue;
    const sx = ((clip[0] * x + clip[4] * y + clip[8] * z + clip[12]) / cw + 1) * width / 2;
    const sy = ((clip[1] * x + clip[5] * y + clip[9] * z + clip[13]) / cw + 1) * height / 2;
    const k = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / length2));
    const ox = sx - ax - dx * k, oy = sy - ay - dy * k;
    radius = Math.max(radius, Math.sqrt(ox * ox + oy * oy)); // not Math.hypot: V8 boxes its arguments (item 21)
  }
  return radius + BALL_BLOOM.FILTER_PAD;
}
