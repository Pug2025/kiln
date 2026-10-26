// Kiln: path casting for the robot player (OWNER: A). Pure reads of world state.
//
// castPath() follows a ball-sized circle from a point along a direction through wall, armour and
// sentry bounces until it reaches something breakable, comes back to the paddle side, or runs out
// of length. The robot uses it to pick the paddle offset that sends the ball to a brick, and again
// from that brick to see whether the rebound comes home or gets stuck bouncing off armour.
// The path bends with the ball's spin exactly as ball.js steers it (curvature spin / 1500 per
// unit, fading to nothing over one second of flight), so a shot with paddle motion is cast where
// it really goes.

import { FIELD, BF, RING, PADDLE, HORIZONTAL, SPIN, SIM } from '../core/constants.js';
import { sweepRectCore, sweepCircleCore, COLLIDE as CQ, queryGrid } from './collide.js';
import { M_BOTTOM, M_LEFT, RING_FACE } from './field.js';

const FACE_BOTTOM = PADDLE.Y - PADDLE.H / 2;
const FACE_LEFT = HORIZONTAL.PADDLE_X + PADDLE.H / 2;
const SEG = 400;
/** Segment length while the spin still bends the path. */
const SPIN_SEG = 40;

/**
 * Scratch and result for castPath. One per robot. The number fields start as doubles (0.5) so
 * V8 stores them unboxed: a field that starts as a small integer and later takes a fraction
 * allocates on every write.
 */
export function createCaster(cap) {
  return {
    list: new Int16Array(cap),
    hit: { nx: 0.5, ny: 0.5, corner: -1 },
    brick: -1,       // first breakable brick reached, -1 none
    sentry: -1,      // first sentry reached, -1 none
    dist: 0.5,       // path length to the end
    bounces: 0,      // dead bounces on the way (walls, armour)
    back: false,     // came back to the paddle side
    x: 0.5, y: 0.5,  // where the path ended (ball centre)
    vx: 0.5, vy: 0.5, // direction arriving there
    nx: 0.5, ny: 0.5, // surface normal there (brick or sentry contact)
    // inputs the caller sets before every castPath: the spin at the start (ball.spin units, 0 none)
    // and the path length over which it fades to 0 (ball speed x SPIN.DURATION_MS)
    spin: 0.5,
    decay: 0.5,
    // and, for moving boss parts: seconds until the path starts, and the ball speed along it
    t0: 0.5,
    speed: 0.5,
    /** @type {ReturnType<typeof createMotion>|null} moving boss parts (the robot keeps it current) */
    motion: null,
  };
}

/** Spin, fade length and start time a rebound cast inherits from the end of cast c. */
export function inherit(c, out) {
  out.t0 = c.t0 + c.dist / (c.speed > 0 ? c.speed : 1);
  out.speed = c.speed;
  if (!(c.spin !== 0 && c.dist < c.decay)) {
    out.spin = 0;
    out.decay = 0;
    return;
  }
  out.spin = c.spin * (1 - c.dist / c.decay);
  out.decay = c.decay - c.dist;
}

const MOTION_CAP = 128;
/** Segment length near moving boss parts (about 0.1 s of flight). */
const MOTION_SEG = 60;
// Many candidate shots ask for the same future times. Two ways per set keep both endpoints
// alive even when their hashes collide; all storage is retained for this robot's lifetime.
const MOTION_CACHE_SETS = 64;
const MOTION_CACHE_SLOTS = MOTION_CACHE_SETS * 2;
const MOTION_CACHE_STRIDE = MOTION_CAP * 2;

function createMotionCache() {
  const times = new Float64Array(MOTION_CACHE_SLOTS), input = new Float64Array(1);
  return {
    epoch: 1,
    times,
    keys: new Uint32Array(times.buffer),
    input,
    inputKey: new Uint32Array(input.buffer),
    stamps: new Uint32Array(MOTION_CACHE_SLOTS),
    next: new Uint8Array(MOTION_CACHE_SETS),
    positions: new Float64Array(MOTION_CACHE_SLOTS * MOTION_CACHE_STRIDE),
  };
}

/** Cache the time in retained scratch; only object/integer arguments cross this hot call. */
function motionAt(m, keep) {
  const cache = m.cache, lo = cache.inputKey[0], hi = cache.inputKey[1];
  let hash = lo ^ hi;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  const bucket = (hash ^ (hash >>> 16)) & (MOTION_CACHE_SETS - 1), first = bucket * 2;
  const epoch = cache.epoch;
  for (let way = 0; way < 2; way++) {
    const slot = first + way;
    if (cache.stamps[slot] === epoch && cache.keys[slot * 2] === lo && cache.keys[slot * 2 + 1] === hi) {
      cache.next[bucket] = 1 - way;
      return slot;
    }
  }
  let slot = cache.stamps[first] !== epoch ? first
    : cache.stamps[first + 1] !== epoch ? first + 1 : first + cache.next[bucket];
  if (slot === keep) slot = first + (slot === first ? 1 : 0);
  cache.next[bucket] = slot === first ? 1 : 0;
  const time = cache.input[0], start = slot * MOTION_CACHE_STRIDE;
  const cx = m.cx + m.vx * time, cy = m.cy + m.vy * time;
  for (let k = 0; k < m.n; k++) {
    const rx = m.rx[k], ry = m.ry[k], w = m.w[k];
    const ca = Math.cos(w * time), sa = Math.sin(w * time);
    cache.positions[start + k * 2] = cx + rx * ca - ry * sa;
    cache.positions[start + k * 2 + 1] = cy + rx * sa + ry * ca;
  }
  cache.times[slot] = time;
  cache.stamps[slot] = epoch;
  return slot;
}

/**
 * Moving boss parts as the cast sees them: each turns about the boss centre at its own rate
 * (rings, counter-rotating rings) while the centre drifts (a swaying head), so the cast can find
 * where a part will be when the ball gets there instead of where it is now.
 */
export function createMotion() {
  return {
    n: 0,
    idx: new Int16Array(MOTION_CAP),
    rx: new Float64Array(MOTION_CAP),   // offset from the boss centre now
    ry: new Float64Array(MOTION_CAP),
    w: new Float64Array(MOTION_CAP),    // rad/s about the centre
    cx: 0.5, cy: 0.5,                   // boss centre now
    vx: 0.5, vy: 0.5,                   // its velocity
    R: 0.5,                             // reach of every part from the centre (bounding circle)
    innerR: 0.5,                        // clear hole before angular chord motion and ball radius
    orbitR: 0.5, maxOmega: 0.5,          // conservative chord-travel bound
    cache: createMotionCache(),
  };
}

/** Read the moving boss parts from this step's world (their motion over the last step). */
export function updateMotion(m, world, grid) {
  const cache = m.cache;
  cache.epoch = (cache.epoch + 1) >>> 0;
  if (cache.epoch === 0) { cache.stamps.fill(0); cache.epoch = 1; }
  m.n = 0;
  const boss = world.boss;
  if (!grid.moving || !boss || !boss.active) return;
  const B = world.bricks, dt = SIM.DT;
  const cx = boss.x, cy = boss.y;
  const vbx = (boss.x - boss.px) / dt, vby = (boss.y - boss.py) / dt;
  let R = 0, innerR = Infinity, orbitR = 0, maxOmega = 0;
  for (let k = 0; k < grid.liveCount && m.n < MOTION_CAP; k++) {
    const i = grid.live[k];
    const f = B.flags[i];
    if (!(f & BF.BOSS) || !(f & BF.MOVING) || !(f & BF.SOLID)) continue;
    const rx = B.x[i] - cx, ry = B.y[i] - cy;
    const vx = (B.x[i] - B.px[i]) / dt - vbx, vy = (B.y[i] - B.py[i]) / dt - vby;
    const r2 = rx * rx + ry * ry;
    const j = m.n++;
    m.idx[j] = i;
    m.rx[j] = rx;
    m.ry[j] = ry;
    m.w[j] = r2 > 1 ? (rx * vy - ry * vx) / r2 : 0;
    const radius = Math.sqrt(r2), halfDiagonal = Math.sqrt(B.w[i] * B.w[i] + B.h[i] * B.h[i]) / 2;
    const reach = radius + halfDiagonal;
    if (reach > R) R = reach;
    if (radius - halfDiagonal < innerR) innerR = radius - halfDiagonal;
    if (radius > orbitR) orbitR = radius;
    if (Math.abs(m.w[j]) > maxOmega) maxOmega = Math.abs(m.w[j]);
  }
  m.cx = cx;
  m.cy = cy;
  m.vx = vbx;
  m.vy = vby;
  m.R = R;
  m.innerR = Math.max(0, innerR);
  m.orbitR = orbitR;
  m.maxOmega = maxOmega;
}

/**
 * @param {ReturnType<typeof createCaster>} c
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
export function castPath(c, world, grid, mc, x, y, dx, dy, r, maxBounces, maxLen, skip = -1) {
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
      const px = x - cxA, py = y - cyA, dx = mx - (cxB - cxA), dy = my - (cyB - cyA);
      const endX = px + dx, endY = py + dy, length2 = dx * dx + dy * dy;
      const at = length2 > 0 ? Math.max(0, Math.min(1, -(px * dx + py * dy) / length2)) : 0;
      const nearX = px + dx * at, nearY = py + dy * at;
      // Moving centres follow chords between their endpoint rotations. The outer circle
      // contains every chord; the inner hole loses at most radius * angular travel (or 2r).
      // Pad negative-time contacts as well as ordinary grid-style grazing/roundoff slack.
      const pad = 2 + (Math.abs(dx) + Math.abs(dy) + 2 * M.orbitR) * 1e-7;
      const outer = M.R + r + pad;
      const turn = M.maxOmega * (Math.abs(tB - tA) + 8 * Number.EPSILON * (Math.abs(tA) + Math.abs(tB) + 1));
      const inner = M.innerR - M.orbitR * Math.min(2, turn) - r - pad;
      const outside = nearX * nearX + nearY * nearY > outer * outer;
      const inside = inner > 0 && Math.max(px * px + py * py, endX * endX + endY * endY) < inner * inner;
      if (!outside && !inside) {
        const cache = M.cache;
        cache.input[0] = tA;
        const atA = motionAt(M, -1);
        cache.input[0] = tB;
        const atB = motionAt(M, atA);
        const startA = atA * MOTION_CACHE_STRIDE, startB = atB * MOTION_CACHE_STRIDE;
        for (let k = 0; k < M.n; k++) {
          const i = M.idx[k];
          if (i === skip || !B.alive[i]) continue;
          const xa = cache.positions[startA + k * 2], ya = cache.positions[startA + k * 2 + 1];
          const xb = cache.positions[startB + k * 2], yb = cache.positions[startB + k * 2 + 1];
          const qx = x - xa, qy = y - ya, qdx = mx - (xb - xa), qdy = my - (yb - ya);
          const hw = B.w[i] / 2, hh = B.h[i] / 2;
          const padX = 2 + Math.abs(qdx) * 1e-7, padY = 2 + Math.abs(qdy) * 1e-7;
          if (Math.max(qx, qx + qdx) < -hw - r - padX || Math.min(qx, qx + qdx) > hw + r + padX ||
              Math.max(qy, qy + qdy) < -hh - r - padY || Math.min(qy, qy + qdy) > hh + r + padY) continue;
          CQ.px = qx; CQ.py = qy; CQ.dx = qdx; CQ.dy = qdy; CQ.r = r;
          CQ.cx = 0; CQ.cy = 0; CQ.hw = hw; CQ.hh = hh;
          if (sweepRectCore(c.hit) && CQ.t < best) { best = CQ.t; kind = 2; id = i; nx = c.hit.nx; ny = c.hit.ny; }
        }
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
