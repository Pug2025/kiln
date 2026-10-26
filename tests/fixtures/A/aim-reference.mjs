// Frozen uncached cast from a7e10fb, retained only as an independent numerical reference.
// Original src/sim/aim.js SHA-256: bdf5f6785830392da3192cc7d0ece0637de1c13672602a5c7311c8686bef0ca1.
// Keep this baseline algorithm unchanged when optimizing production aim.js.
import { FIELD, BF, RING, PADDLE, HORIZONTAL, SPIN } from '../../../src/core/constants.js';
import { sweepRectCore, sweepCircleCore, COLLIDE as CQ, queryGrid } from '../../../src/sim/collide.js';
import { M_BOTTOM, M_LEFT, RING_FACE } from '../../../src/sim/field.js';
const FACE_BOTTOM = PADDLE.Y - PADDLE.H / 2;
const FACE_LEFT = HORIZONTAL.PADDLE_X + PADDLE.H / 2;
const SEG = 400, SPIN_SEG = 40, MOTION_SEG = 60;

/**
 * @param {object} c
 * @param {import('../core/types.js').World} world
 * @param {object} grid brick grid (collide.js) rebuilt for this world
 * @param {number} mc mode code
 * @param {number} x @param {number} y start
 * @param {number} dx @param {number} dy unit direction
 * @param {number} r ball radius
 * @param {number} maxBounces dead bounces allowed before giving up
 * @param {number} maxLen total path length
 * @param {number} [skip] a brick index to ignore (the one just hit)
 */
export function castPathReference(c, world, grid, mc, x, y, dx, dy, r, maxBounces, maxLen, skip = -1) {
  const B = world.bricks, S = world.sentries;
  c.brick = -1;
  c.sentry = -1;
  c.bounces = 0;
  c.back = false;
  c.nx = 0;
  c.ny = 0;
  const spin0 = c.spin, decay = c.decay;
  const ceil = world.field.ceilingY, far = world.field.farX; // the ceiling / far wall (ceiling.js)
  const M = c.motion && c.motion.n > 0 ? c.motion : null;
  const speed = c.speed > 0 ? c.speed : 1;
  let len = 0, pend = 0;
  for (let iter = 0; iter < 160 && len < maxLen; iter++) {
    // spin bends the path (ball.js turns the velocity by spin * speed / 1500 per second, fading
    // linearly to 0): short segments, each turning half its bend before and half after
    let seg = Math.min(SEG, maxLen - len);
    // near moving boss parts: short segments, each part swept from where it is at the segment's
    // start to where it is at its end
    let nearBoss = false;
    if (M) {
      const tA = c.t0 + len / speed;
      const ex = x - (M.cx + M.vx * tA), ey = y - (M.cy + M.vy * tA);
      const reach = M.R + r + seg;
      if (ex * ex + ey * ey < reach * reach) {
        nearBoss = true;
        if (seg > MOTION_SEG) seg = MOTION_SEG;
      }
    }
    let ang = 0;
    if (spin0 !== 0 && len < decay) {
      if (seg > SPIN_SEG) seg = SPIN_SEG;
      const mid = len + seg / 2;
      if (mid < decay) ang = spin0 * (1 - mid / decay) * seg / SPIN.MIN_RADIUS;
    }
    const turn = pend + ang / 2;
    pend = ang / 2;
    if (turn !== 0) {
      const cs = Math.cos(turn), sn = Math.sin(turn);
      const tx = dx * cs - dy * sn;
      dy = dx * sn + dy * cs;
      dx = tx;
    }
    const mx = dx * seg, my = dy * seg;
    let best = 2, kind = 0, nx = 0, ny = 0, id = -1;
    if (mc === M_BOTTOM) {
      if (mx < 0) { const t = (r - x) / mx; if (t >= 0 && t < best) { best = t; kind = 1; nx = 1; ny = 0; } }
      else if (mx > 0) { const t = (FIELD.W - r - x) / mx; if (t >= 0 && t < best) { best = t; kind = 1; nx = -1; ny = 0; } }
      if (my < 0) { const t = (ceil + r - y) / my; if (t >= 0 && t < best) { best = t; kind = 1; nx = 0; ny = 1; } }
      if (my > 0) { const t = (FACE_BOTTOM - r - y) / my; if (t >= 0 && t < best) { best = t; kind = 9; } }
    } else if (mc === M_LEFT) {
      if (my < 0) { const t = (r - y) / my; if (t >= 0 && t < best) { best = t; kind = 1; nx = 0; ny = 1; } }
      else if (my > 0) { const t = (FIELD.H - r - y) / my; if (t >= 0 && t < best) { best = t; kind = 1; nx = 0; ny = -1; } }
      if (mx > 0) { const t = (far - r - x) / mx; if (t >= 0 && t < best) { best = t; kind = 1; nx = -1; ny = 0; } }
      if (mx < 0) { const t = (FACE_LEFT + r - x) / mx; if (t >= 0 && t < best) { best = t; kind = 9; } }
    } else {
      // ring: home when it reaches the paddle circle moving outward
      const ex = x - RING.CX, ey = y - RING.CY;
      const R = RING_FACE - r;
      const a = mx * mx + my * my, b = ex * mx + ey * my, cc = ex * ex + ey * ey - R * R;
      if (cc < 0) {
        const t = (-b + Math.sqrt(b * b - a * cc)) / a;
        if (t >= 0 && t < best) { best = t; kind = 9; }
      } else if (b > 0) { best = 0; kind = 9; }
    }
    const x0 = Math.min(x, x + mx) - r - 2, x1 = Math.max(x, x + mx) + r + 2;
    const y0 = Math.min(y, y + my) - r - 2, y1 = Math.max(y, y + my) + r + 2;
    const n = queryGrid(grid, x0, y0, x1, y1, c.list);
    for (let k = 0; k < n; k++) {
      const i = c.list[k];
      if (i === skip || !(B.flags[i] & BF.SOLID)) continue;
      if (M && (B.flags[i] & BF.BOSS) && (B.flags[i] & BF.MOVING)) continue; // swept below
      CQ.px = x; CQ.py = y; CQ.dx = mx; CQ.dy = my; CQ.r = r;
      CQ.cx = B.x[i]; CQ.cy = B.y[i]; CQ.hw = B.w[i] / 2; CQ.hh = B.h[i] / 2;
      if (sweepRectCore(c.hit) && CQ.t < best) { best = CQ.t; kind = 2; id = i; nx = c.hit.nx; ny = c.hit.ny; }
    }
    if (nearBoss) {
      const tA = c.t0 + len / speed, tB = tA + seg / speed;
      const cxA = M.cx + M.vx * tA, cyA = M.cy + M.vy * tA;
      const cxB = M.cx + M.vx * tB, cyB = M.cy + M.vy * tB;
      for (let k = 0; k < M.n; k++) {
        const i = M.idx[k];
        if (i === skip || !B.alive[i]) continue;
        const rx = M.rx[k], ry = M.ry[k], w = M.w[k];
        const ca = Math.cos(w * tA), sa = Math.sin(w * tA), cb = Math.cos(w * tB), sb = Math.sin(w * tB);
        const xa = cxA + rx * ca - ry * sa, ya = cyA + rx * sa + ry * ca;
        const xb = cxB + rx * cb - ry * sb, yb = cyB + rx * sb + ry * cb;
        CQ.px = x - xa; CQ.py = y - ya; CQ.dx = mx - (xb - xa); CQ.dy = my - (yb - ya); CQ.r = r;
        CQ.cx = 0; CQ.cy = 0; CQ.hw = B.w[i] / 2; CQ.hh = B.h[i] / 2;
        if (sweepRectCore(c.hit) && CQ.t < best) { best = CQ.t; kind = 2; id = i; nx = c.hit.nx; ny = c.hit.ny; }
      }
    }
    for (let k = 0; k < S.length; k++) {
      const s = S[k];
      if (!s.alive || s.r <= 0) continue;
      CQ.px = x; CQ.py = y; CQ.dx = mx; CQ.dy = my; CQ.cx = s.x; CQ.cy = s.y; CQ.r = r + s.r;
      if (sweepCircleCore(c.hit) && CQ.t < best) { best = CQ.t; kind = 3; id = k; nx = c.hit.nx; ny = c.hit.ny; }
    }
    if (best > 1) {
      x += mx;
      y += my;
      len += seg;
      continue;
    }
    x += mx * best;
    y += my * best;
    len += seg * best;
    c.nx = nx;
    c.ny = ny;
    if (kind === 9) { c.back = true; break; }
    if (kind === 2 && (B.flags[id] & BF.BREAKABLE)) { c.brick = id; break; }
    if (kind === 3) { c.sentry = id; break; }
    // dead bounce: reflect and go on
    const d = dx * nx + dy * ny;
    if (d < 0) {
      dx -= 2 * d * nx;
      dy -= 2 * d * ny;
    }
    c.bounces++;
    if (c.bounces > maxBounces) break;
    x += nx * 0.01;
    y += ny * 0.01;
  }
  c.dist = len;
  c.x = x;
  c.y = y;
  c.vx = dx;
  c.vy = dy;
  return c;
}
