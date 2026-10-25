// Bloom protection uses the actual drawn ball centres. This is renderer data only;
// simulation positions, boss heat and the existing paddle protection remain unchanged.
import { BALL, FIELD } from '../core/constants.js';

export const BALL_BLOOM = Object.freeze({
  MAX: BALL.MAX,
  INNER: 25 / BALL.R,
  FEATHER: 45 / BALL.R,
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
    const radius = Math.min(Math.hypot((ex - cx) * width / 2, (ey - cy) * height / 2),
      Math.hypot((fx - cx) * width / 2, (fy - cy) * height / 2));
    if (!(radius > 0 && Number.isFinite(radius))) continue;
    const j = count++ * 4;
    out[j] = (cx + 1) * width / 2;
    out[j + 1] = (cy + 1) * height / 2;
    out[j + 2] = radius * BALL_BLOOM.INNER;
    out[j + 3] = radius * BALL_BLOOM.FEATHER;
  }
  return count;
}
