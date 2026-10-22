// Kiln: collision primitives and the brick broadphase (OWNER: A). Pure maths, no allocation in
// the hot path: every function writes into an `out` object the caller owns.
//
// Swept tests take a start point (px, py) and a DISPLACEMENT (dx, dy) and return the fraction
// t in [0, 1] of the displacement at first contact, or -1 for no contact. Contact normals point
// from the obstacle toward the moving circle.
//
// A circle of radius r against an axis-aligned rectangle is a point against the rectangle grown
// by r with rounded corners (Minkowski sum). The first contact is the earliest of the four
// offset faces (limited to the face's extent) and the four corner circles.

import { BF } from '../core/constants.js';

const EPS_T = 1e-7;

// No allocation per call. V8 boxes every fractional number passed to, or returned from, a call
// it does not inline, and these bodies are too big to inline. So the work is done by cores that
// take no numbers: the caller writes the inputs into the scratch Q (exported as COLLIDE), calls
// the core, which answers 1 (contact) or 0 and leaves t or the depth in Q.t. Hot loops (ball,
// lasers, robot) use the cores directly; the wrappers with plain arguments are for everything
// else and for tests. The fields start as doubles so their storage stays unboxed.
const Q = { px: 0.5, py: 0.5, dx: 0.5, dy: 0.5, r: 0.5, cx: 0.5, cy: 0.5, hw: 0.5, hh: 0.5, t: 0.5 };

/**
 * Swept circle vs axis-aligned rectangle with corner circles.
 * @param {number} px start x  @param {number} py start y
 * @param {number} dx displacement x  @param {number} dy displacement y
 * @param {number} r circle radius
 * @param {number} cx rect centre x  @param {number} cy rect centre y
 * @param {number} hw half width  @param {number} hh half height
 * @param {{nx:number, ny:number, corner:number}} out normal; corner = -1 face, else 0..3
 *   (bit 0: +x side, bit 1: +y side)
 * @returns {number} t in [0,1] or -1
 */
export function sweepCircleRect(px, py, dx, dy, r, cx, cy, hw, hh, out) {
  Q.px = px; Q.py = py; Q.dx = dx; Q.dy = dy; Q.r = r; Q.cx = cx; Q.cy = cy; Q.hw = hw; Q.hh = hh;
  return sweepRectCore(out) ? Q.t : -1;
}

/** Core of sweepCircleRect: inputs px py dx dy r cx cy hw hh in COLLIDE, t out. */
export function sweepRectCore(out) {
  const px = Q.px, py = Q.py, dx = Q.dx, dy = Q.dy, r = Q.r, cx = Q.cx, cy = Q.cy, hw = Q.hw, hh = Q.hh;
  let best = 2;
  let nx = 0, ny = 0, corner = -1;
  // faces
  if (dx > 0) {
    const plane = cx - hw - r;
    const t = (plane - px) / dx;
    if (t >= -EPS_T && t < best) {
      const y = py + dy * t;
      if (y >= cy - hh && y <= cy + hh) { best = t; nx = -1; ny = 0; corner = -1; }
    }
  } else if (dx < 0) {
    const plane = cx + hw + r;
    const t = (plane - px) / dx;
    if (t >= -EPS_T && t < best) {
      const y = py + dy * t;
      if (y >= cy - hh && y <= cy + hh) { best = t; nx = 1; ny = 0; corner = -1; }
    }
  }
  if (dy > 0) {
    const plane = cy - hh - r;
    const t = (plane - py) / dy;
    if (t >= -EPS_T && t < best) {
      const x = px + dx * t;
      if (x >= cx - hw && x <= cx + hw) { best = t; nx = 0; ny = -1; corner = -1; }
    }
  } else if (dy < 0) {
    const plane = cy + hh + r;
    const t = (plane - py) / dy;
    if (t >= -EPS_T && t < best) {
      const x = px + dx * t;
      if (x >= cx - hw && x <= cx + hw) { best = t; nx = 0; ny = 1; corner = -1; }
    }
  }
  // corners (only the ones the motion can reach first)
  const a = dx * dx + dy * dy;
  if (a > 0) {
    for (let k = 0; k < 4; k++) {
      const sx = k & 1 ? 1 : -1, sy = k & 2 ? 1 : -1;
      const ox = cx + sx * hw, oy = cy + sy * hh;
      const mx = px - ox, my = py - oy;
      const b = mx * dx + my * dy;
      if (b >= 0) continue; // moving away from this corner
      const c = mx * mx + my * my - r * r;
      const disc = b * b - a * c;
      if (disc < 0) continue;
      let t = (-b - Math.sqrt(disc)) / a;
      if (c < 0) t = 0; // starts inside the corner circle: contact now
      if (t >= -EPS_T && t < best) {
        const hx = mx + dx * t, hy = my + dy * t;
        const d = Math.sqrt(hx * hx + hy * hy) || 1;
        best = t; nx = hx / d; ny = hy / d; corner = k;
      }
    }
  }
  if (best > 1) return 0;
  out.nx = nx;
  out.ny = ny;
  out.corner = corner;
  Q.t = best < 0 ? 0 : best;
  return 1;
}

/**
 * Swept circle vs circle (combined radius R, the obstacle centre fixed).
 * @returns {number} t in [0,1] or -1; out.nx/ny = normal from the obstacle at contact
 */
export function sweepCircleCircle(px, py, dx, dy, ox, oy, R, out) {
  Q.px = px; Q.py = py; Q.dx = dx; Q.dy = dy; Q.cx = ox; Q.cy = oy; Q.r = R;
  return sweepCircleCore(out) ? Q.t : -1;
}

/** Core of sweepCircleCircle: inputs px py dx dy, obstacle cx cy, combined radius r. */
export function sweepCircleCore(out) {
  const dx = Q.dx, dy = Q.dy, R = Q.r;
  const mx = Q.px - Q.cx, my = Q.py - Q.cy;
  const a = dx * dx + dy * dy;
  const b = mx * dx + my * dy;
  const c = mx * mx + my * my - R * R;
  if (c < 0) {
    if (b >= 0) return 0; // inside and leaving
    const d = Math.sqrt(mx * mx + my * my) || 1;
    out.nx = mx / d;
    out.ny = my / d;
    Q.t = 0;
    return 1;
  }
  if (a <= 0 || b >= 0) return 0;
  const disc = b * b - a * c;
  if (disc < 0) return 0;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t > 1) return 0;
  const hx = mx + dx * t, hy = my + dy * t;
  const d = Math.sqrt(hx * hx + hy * hy) || 1;
  out.nx = hx / d;
  out.ny = hy / d;
  Q.t = t < 0 ? 0 : t;
  return 1;
}

/**
 * Swept point leaving a circle from the inside: first t where |p + d t - o| reaches R while
 * moving outward. Used for the ring paddle face and the ring shield.
 * @returns {number} t in [0,1] or -1; out.nx/ny = inward normal at contact
 */
export function sweepExitCircle(px, py, dx, dy, ox, oy, R, out) {
  Q.px = px; Q.py = py; Q.dx = dx; Q.dy = dy; Q.cx = ox; Q.cy = oy; Q.r = R;
  return sweepExitCore(out) ? Q.t : -1;
}

/** Core of sweepExitCircle: inputs px py dx dy, centre cx cy, radius r. */
export function sweepExitCore(out) {
  const dx = Q.dx, dy = Q.dy, R = Q.r;
  const mx = Q.px - Q.cx, my = Q.py - Q.cy;
  const a = dx * dx + dy * dy;
  if (a <= 0) return 0;
  const b = mx * dx + my * dy;
  const c = mx * mx + my * my - R * R;
  let t;
  if (c >= 0) {
    if (b <= 0) return 0; // outside and moving inward
    t = 0;
  } else {
    const disc = b * b - a * c;
    t = (-b + Math.sqrt(disc)) / a;
    if (t > 1) return 0;
  }
  const hx = mx + dx * t, hy = my + dy * t;
  const d = Math.sqrt(hx * hx + hy * hy) || 1;
  out.nx = -hx / d;
  out.ny = -hy / d;
  Q.t = t < 0 ? 0 : t;
  return 1;
}

/**
 * Overlap of a circle with a rectangle: penetration depth and push-out normal.
 * @returns {number} depth (> 0 when overlapping, else <= 0); out.nx/ny = push direction
 */
export function circleRectOverlap(x, y, r, cx, cy, hw, hh, out) {
  Q.px = x; Q.py = y; Q.r = r; Q.cx = cx; Q.cy = cy; Q.hw = hw; Q.hh = hh;
  overlapCore(out);
  return Q.t;
}

function overlapCore(out) {
  const r = Q.r, hw = Q.hw, hh = Q.hh;
  const dx = Q.px - Q.cx, dy = Q.py - Q.cy;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax <= hw && ay <= hh) {
    // centre inside the rectangle: push out through the nearest face
    const ex = hw - ax, ey = hh - ay;
    if (ex < ey) {
      out.nx = dx >= 0 ? 1 : -1;
      out.ny = 0;
      Q.t = ex + r;
      return 1;
    }
    out.nx = 0;
    out.ny = dy >= 0 ? 1 : -1;
    Q.t = ey + r;
    return 1;
  }
  const qx = ax > hw ? hw : ax, qy = ay > hh ? hh : ay; // closest point (folded)
  const fx = ax - qx, fy = ay - qy;
  const d2 = fx * fx + fy * fy;
  if (d2 >= r * r) {
    Q.t = r - Math.sqrt(d2);
    return 0;
  }
  const d = Math.sqrt(d2) || 1;
  out.nx = (fx / d) * (dx >= 0 ? 1 : -1);
  out.ny = (fy / d) * (dy >= 0 ? 1 : -1);
  Q.t = r - d;
  return 1;
}

/** The scratch above, read-only for callers: `COLLIDE.t` is the t or depth of the last call. */
export { Q as COLLIDE };

/**
 * circleRectOverlap of ball `b` (radius b.r + grow) with brick `i`, taking no computed numbers
 * (nothing to box when it is not inlined). The depth is left in COLLIDE.t.
 * @returns {number} 1 when they overlap (depth > 0), else 0
 */
export function overlapBallBrick(b, grow, B, i, out) {
  Q.px = b.x; Q.py = b.y; Q.r = b.r + grow;
  Q.cx = B.x[i]; Q.cy = B.y[i]; Q.hw = B.w[i] / 2; Q.hh = B.h[i] / 2;
  return overlapCore(out);
}

/** Distance from a point to a rectangle's surface (0 inside). */
export function pointRectDistance(x, y, cx, cy, hw, hh) {
  const fx = Math.max(Math.abs(x - cx) - hw, 0);
  const fy = Math.max(Math.abs(y - cy) - hh, 0);
  return Math.sqrt(fx * fx + fy * fy);
}

// ------------------------------------------------------------------ brick broadphase

const CELL = 30;
const GW = 24, GH = 36;             // the 720 x 1080 field in 30-unit cells
const NCELL = GW * GH;
const PER_BRICK = 9;

/**
 * A uniform grid over the field holding every collidable brick (solid or portal, alive, not
 * hidden). Rebuilt once per step with a counting sort; queries dedupe with a stamp per brick.
 * @param {number} cap brick pool size
 */
export function createBrickGrid(cap) {
  return {
    cap,
    count: new Int32Array(NCELL),
    start: new Int32Array(NCELL + 1),
    items: new Int16Array(cap * PER_BRICK),
    stamp: new Uint32Array(cap),
    query: 1,
    overflow: false,
    // compact list of collidable bricks (for brute-force fallbacks and the robot)
    live: new Int16Array(cap),
    liveCount: 0,
    moving: false,     // any MOVING/FALLING brick this step
    version: -1,
  };
}

// x | 0 truncates toward zero, which only differs from floor below 0 (clamped to cell 0 anyway),
// and turns NaN into cell 0 instead of a NaN cell.
const cellX = (x) => { const c = (x / CELL) | 0; return c < 0 ? 0 : c >= GW ? GW - 1 : c; };
const cellY = (y) => { const c = (y / CELL) | 0; return c < 0 ? 0 : c >= GH ? GH - 1 : c; };

/** True for a brick the ball can touch: alive, not hidden, solid or a portal. */
export function collidable(B, i) {
  return B.alive[i] && !(B.flags[i] & BF.HIDDEN) && (B.flags[i] & (BF.SOLID | BF.PORTAL)) !== 0;
}

/**
 * Rebuild the grid from the brick store. Cheap (one pass to count, one to fill).
 * @param {ReturnType<typeof createBrickGrid>} g
 * @param {import('../core/types.js').BrickStore} B
 */
export function rebuildGrid(g, B) {
  const count = g.count, start = g.start, items = g.items, live = g.live;
  count.fill(0);
  let n = 0;
  let moving = false;
  for (let i = 0; i < B.count; i++) {
    if (!collidable(B, i)) continue;
    live[n++] = i;
    if (B.flags[i] & (BF.MOVING | BF.FALLING)) moving = true;
    const hw = B.w[i] / 2, hh = B.h[i] / 2;
    const x0 = cellX(B.x[i] - hw - 0.5), x1 = cellX(B.x[i] + hw + 0.5);
    const y0 = cellY(B.y[i] - hh - 0.5), y1 = cellY(B.y[i] + hh + 0.5);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) count[cy * GW + cx]++;
  }
  g.liveCount = n;
  g.moving = moving;
  let s = 0;
  for (let c = 0; c < NCELL; c++) {
    start[c] = s;
    s += count[c];
  }
  start[NCELL] = s;
  g.overflow = s > items.length;
  if (g.overflow) return;
  count.fill(0); // reuse as a fill cursor
  for (let k = 0; k < n; k++) {
    const i = live[k];
    const hw = B.w[i] / 2, hh = B.h[i] / 2;
    const x0 = cellX(B.x[i] - hw - 0.5), x1 = cellX(B.x[i] + hw + 0.5);
    const y0 = cellY(B.y[i] - hh - 0.5), y1 = cellY(B.y[i] + hh + 0.5);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * GW + cx;
        items[start[c] + count[c]++] = i;
      }
    }
  }
  g.version = B.version;
}

/**
 * Collect the collidable bricks whose cells touch an AABB into `out` (Int16Array), no duplicates.
 * @returns {number} how many were written
 */
export function queryGrid(g, x0, y0, x1, y1, out) {
  // a small wrapper that hands whole cell numbers to the loop (no boxed arguments, see Q)
  return queryCells(g, cellX(x0), cellY(y0), cellX(x1), cellY(y1), out);
}

/** queryGrid over a range of cells (clamped integers). */
export function queryCells(g, cx0, cy0, cx1, cy1, out) {
  let n = 0;
  if (g.overflow) {
    for (let k = 0; k < g.liveCount && n < out.length; k++) out[n++] = g.live[k];
    return n;
  }
  // the stamp stays a small integer (V8 boxes integers past 2^30)
  if (g.query >= 0x3fffffff) { g.stamp.fill(0); g.query = 0; }
  g.query++;
  const stamp = g.stamp, items = g.items, start = g.start;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = cy * GW + cx;
      for (let k = start[c], e = start[c + 1]; k < e; k++) {
        const i = items[k];
        if (stamp[i] === g.query) continue;
        stamp[i] = g.query;
        if (n < out.length) out[n++] = i;
      }
    }
  }
  return n;
}

/**
 * Index of a SOLID collidable brick containing the point, or -1 (corner exposure tests).
 * @param {(i:number) => boolean} [skip]
 */
export function solidBrickAt(g, B, x, y, list) {
  const n = queryGrid(g, x, y, x, y, list);
  for (let k = 0; k < n; k++) {
    const i = list[k];
    if (!(B.flags[i] & BF.SOLID)) continue;
    if (Math.abs(x - B.x[i]) < B.w[i] / 2 && Math.abs(y - B.y[i]) < B.h[i] / 2) return i;
  }
  return -1;
}
