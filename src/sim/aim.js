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
/** Sentries a cast lists once (the world has 16); a world with more checks them every stretch. */
const SENTRY_CAP = 64;

/**
 * Scratch and result for castPath. One per robot. The number fields start as doubles (0.5) so
 * V8 stores them unboxed: a field that starts as a small integer and later takes a fraction
 * allocates on every write.
 */
export function createCaster(cap) {
  return {
    list: new Int16Array(cap),
    // the live sentries of this cast (they do not move while it is cast) and the moving boss
    // parts one stretch of it can reach (item 23)
    sentries: new Int16Array(SENTRY_CAP),
    cand: new Int16Array(MOTION_CAP),
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
// A slot holds one time; each part's position at that time is worked out the first time a cast
// needs it (placePart), so a part that no cast comes near costs no cos and sin (item 23).
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
    // a slot's fill number (new for every time it takes) and, per slot and part, the fill
    // number its position was worked out in: equal means the position is current
    fill: new Uint32Array(MOTION_CACHE_SLOTS),
    fillNext: 1,
    placed: new Uint32Array(MOTION_CACHE_SLOTS * MOTION_CAP),
  };
}

/** Work out part k's position at slot's time (the same arithmetic the eager cache used). */
function placePart(m, slot, k) {
  const cache = m.cache, time = cache.times[slot], start = slot * MOTION_CACHE_STRIDE;
  const cx = m.cx + m.vx * time, cy = m.cy + m.vy * time;
  const rx = m.rx[k], ry = m.ry[k], w = m.w[k];
  const ca = Math.cos(w * time), sa = Math.sin(w * time);
  cache.positions[start + k * 2] = cx + rx * ca - ry * sa;
  cache.positions[start + k * 2 + 1] = cy + rx * sa + ry * ca;
  cache.placed[slot * MOTION_CAP + k] = cache.fill[slot];
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
  // a new fill number: no part of this slot is placed for the new time yet
  let fill = cache.fillNext;
  if (fill === 0xffffffff) { cache.placed.fill(0); fill = 1; }
  cache.fillNext = fill + 1;
  cache.fill[slot] = fill;
  cache.times[slot] = cache.input[0];
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
    rho: new Float64Array(MOTION_CAP),  // distance from the centre now (constant while it turns)
    hd: new Float64Array(MOTION_CAP),   // half diagonal of its box
    alpha: new Float64Array(MOTION_CAP), // its angle about the centre now (index only)
    cx: 0.5, cy: 0.5,                   // boss centre now
    vx: 0.5, vy: 0.5,                   // its velocity
    R: 0.5,                             // reach of every part from the centre (bounding circle)
    innerR: 0.5,                        // clear hole before angular chord motion and ball radius
    orbitR: 0.5, maxOmega: 0.5,          // conservative chord-travel bound
    cache: createMotionCache(),
    // The angular index (item 23), built the first time a cast needs it in a step: the parts in
    // groups that turn at the same rate (a ring) and lie in the same distance shell, each group
    // sorted by angle, with its band of distances. A cast stretch then looks only at the parts
    // of each group within its angular reach instead of at every part.
    indexed: false,
    groups: 0,
    gStart: new Int16Array(MOTION_CAP + 1),
    gW: new Float64Array(MOTION_CAP),      // the group's middle rate
    gSpread: new Float64Array(MOTION_CAP), // how far a member's rate is from it, at most
    gRhoMin: new Float64Array(MOTION_CAP), // nearest member centre
    gHdMax: new Float64Array(MOTION_CAP),  // largest member half diagonal
    gBandLo: new Float64Array(MOTION_CAP), // min over members of rho - hd
    gBandHi: new Float64Array(MOTION_CAP), // max over members of rho + hd
    order: new Int16Array(MOTION_CAP),     // members, group after group, each by angle
    orderAlpha: new Float64Array(MOTION_CAP),
    byRate: new Int16Array(MOTION_CAP),    // scratch
    range: new Float64Array(2),            // scratch: an angle range for collectRange
    mark: new Uint32Array(MOTION_CAP),     // scratch: candidates of one stretch (marked with markNow)
    markNow: 0,
  };
}

/** Rates (rad/s) closer than this to the previous part's join its group. */
const GROUP_RATE_GAP = 0.01;
/**
 * Distance shells a rate group is split into (upper bounds; the last is open). A group's angular
 * reach grows as its nearest member comes closer to the centre, so the parts near the centre of
 * a turning head do not widen the reach of its outer ring.
 */
const SHELLS = [40, 80, 160, 320, Infinity];
/** Extra angle every reach gets (rounding of the angles, far below anything that matters). */
const ANGLE_SLACK = 1e-6;
const TAU = 2 * Math.PI;

/** Build the angular index of the parts read by updateMotion (insertion sorts, no allocation). */
function buildIndex(m) {
  m.indexed = true;
  const n = m.n, by = m.byRate;
  for (let i = 0; i < n; i++) {
    const k = i, wk = m.w[k];
    m.alpha[k] = Math.atan2(m.ry[k], m.rx[k]);
    let j = i - 1;
    while (j >= 0 && m.w[by[j]] > wk) { by[j + 1] = by[j]; j--; }
    by[j + 1] = k;
  }
  let g = 0, out = 0;
  for (let i = 0; i < n;) {
    let e = i + 1;
    while (e < n && m.w[by[e]] - m.w[by[e - 1]] <= GROUP_RATE_GAP) e++;
    const wlo = m.w[by[i]], whi = m.w[by[e - 1]];
    for (let sh = 0; sh < SHELLS.length; sh++) {
      const inner = sh > 0 ? SHELLS[sh - 1] : -Infinity, outer = SHELLS[sh];
      const start = out;
      let rhoMin = Infinity, hdMax = 0, bandLo = Infinity, bandHi = -Infinity;
      for (let p = i; p < e; p++) {
        const k = by[p], rho = m.rho[k];
        if (!(rho >= inner && rho < outer)) continue;
        const a = m.alpha[k], hd = m.hd[k];
        let q = out - 1;
        while (q >= start && m.orderAlpha[q] > a) { m.order[q + 1] = m.order[q]; m.orderAlpha[q + 1] = m.orderAlpha[q]; q--; }
        m.order[q + 1] = k;
        m.orderAlpha[q + 1] = a;
        out++;
        if (rho < rhoMin) rhoMin = rho;
        if (hd > hdMax) hdMax = hd;
        if (rho - hd < bandLo) bandLo = rho - hd;
        if (rho + hd > bandHi) bandHi = rho + hd;
      }
      if (out === start) continue;
      m.gStart[g] = start;
      m.gW[g] = (wlo + whi) / 2;
      // the rounding of the middle rate is far below 1e-12 rad/s
      m.gSpread[g] = (whi - wlo) / 2 + 1e-12 * (1 + Math.abs(wlo) + Math.abs(whi));
      m.gRhoMin[g] = rhoMin;
      m.gHdMax[g] = hdMax;
      m.gBandLo[g] = bandLo;
      m.gBandHi[g] = bandHi;
      g++;
    }
    i = e;
  }
  m.gStart[g] = out;
  m.groups = g;
}

/**
 * Add group members p in [s, e) whose angle lies in m.range [lo, hi] (inside [-pi, pi]) to out
 * from position n on. Returns the new count. Members are sorted by angle: a binary search finds
 * the first, the rest follow.
 */
function collectRange(m, s, e, out, n) {
  const lo = m.range[0], hi = m.range[1], A = m.orderAlpha;
  let a = s, b = e;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (A[mid] < lo) a = mid + 1;
    else b = mid;
  }
  for (let p = a; p < e && A[p] <= hi; p++) out[n++] = m.order[p];
  return n;
}

/** Read the moving boss parts from this step's world (their motion over the last step). */
export function updateMotion(m, world, grid) {
  const cache = m.cache;
  cache.epoch = (cache.epoch + 1) >>> 0;
  if (cache.epoch === 0) { cache.stamps.fill(0); cache.epoch = 1; }
  m.n = 0;
  m.indexed = false;
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
    m.rho[j] = radius;
    m.hd[j] = halfDiagonal;
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
  // the sentries that can be met, listed once (a cast changes nothing, so they stay as they are;
  // the stretch loop still checks each one as before); -1: too many to list, check them all
  let live = -1;
  if (S.length <= SENTRY_CAP) {
    live = 0;
    for (let k = 0; k < S.length; k++) if (S[k].alive && S[k].r > 0) c.sentries[live++] = k;
  }
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
        const fillA = cache.fill[atA], fillB = cache.fill[atB];
        const placedA = atA * MOTION_CAP, placedB = atB * MOTION_CAP;
        // Which parts can this stretch touch (item 23)? Seen from the centre, the ball runs along
        // u(s) = (px, py) + s (dx, dy) and part k along the chord v(s) between its two positions.
        // A contact needs |u(s) - v(s)| <= hd + r at one s (sweepRectCore: the ball centre within
        // r of the box). Then |v(s)| lies within hd + r of |u(s)|, which stays between the
        // stretch's nearest and farthest distance (dmin, dmax), and the chord sags inward by at
        // most sag; and the angle between u(s) and v(s) is at most asin(D / |v|), D = hd + r,
        // which is below D / sqrt(|v|^2 - D^2). u(s) keeps to the arc between its end angles
        // (it never passes the centre: dmin > 1) and v(s) to the arc its part turns through
        // (turn < 2 rad). So a part whose ring band is out of distance reach, or whose angle is
        // out of angular reach, cannot touch the ball, and pad (2 units) covers every rounding.
        // Every other part is swept exactly as before and in the same order (by index), so the
        // cast's result is the same to the bit; only the parts that cannot touch are skipped,
        // before their positions are worked out.
        if (!M.indexed) buildIndex(M);
        const dmin = Math.sqrt(nearX * nearX + nearY * nearY);
        const dmax = Math.sqrt(Math.max(px * px + py * py, endX * endX + endY * endY));
        const sag = M.orbitR * Math.min(2, turn);
        const reachLo = dmin - r - pad, reachHi = dmax + r + pad + sag;
        const spanOk = dmin > 1 && turn < 2;
        // the stretch's angles, worked out when a group first needs them (negative phiH: not yet).
        // Both start as fractions so the optimizer types them as doubles from the start: a whole
        // number start deoptimized castPath the first time a stretch needed its angles.
        let phiC = 0.5, phiH = -0.5;
        const tm = (tA + tB) / 2;
        const cand = c.cand;
        let nc = 0;
        for (let g = 0; g < M.groups; g++) {
          if (M.gBandHi[g] < reachLo || M.gBandLo[g] > reachHi) continue;
          const s = M.gStart[g], e = M.gStart[g + 1];
          const D = M.gHdMax[g] + r + pad, rmin = M.gRhoMin[g] - sag;
          // (angles turned through stay small enough to be exact to far below ANGLE_SLACK)
          let H = TAU;
          if (spanOk && rmin > D && Math.abs(tm) * (Math.abs(M.gW[g]) + M.gSpread[g]) < 1e6) {
            if (phiH < 0) {
              const f0 = Math.atan2(py, px);
              let d = Math.atan2(endY, endX) - f0;
              if (d > Math.PI) d -= TAU;
              else if (d < -Math.PI) d += TAU;
              phiC = f0 + d / 2;
              phiH = Math.abs(d) / 2;
            }
            H = phiH + turn / 2 + D / Math.sqrt(rmin * rmin - D * D) + M.gSpread[g] * Math.abs(tm) + ANGLE_SLACK;
          }
          if (H >= Math.PI) {
            for (let p = s; p < e; p++) cand[nc++] = M.order[p];
            continue;
          }
          // the window's centre in the angles the members have now, in [-pi, pi]
          let a = phiC - M.gW[g] * tm;
          a -= TAU * Math.round(a / TAU);
          const lo = a - H, hi = a + H;
          if (lo < -Math.PI) {
            M.range[0] = lo + TAU; M.range[1] = Math.PI; nc = collectRange(M, s, e, cand, nc);
            M.range[0] = -Math.PI; M.range[1] = hi;
          } else if (hi > Math.PI) {
            M.range[0] = lo; M.range[1] = Math.PI; nc = collectRange(M, s, e, cand, nc);
            M.range[0] = -Math.PI; M.range[1] = hi - TAU;
          } else {
            M.range[0] = lo; M.range[1] = hi;
          }
          nc = collectRange(M, s, e, cand, nc);
        }
        // in index order, as the full loop met them: a few are sorted, many are marked and the
        // parts read off in order
        if (nc <= 12) {
          for (let p = 1; p < nc; p++) {
            const k = cand[p];
            let q = p - 1;
            while (q >= 0 && cand[q] > k) { cand[q + 1] = cand[q]; q--; }
            cand[q + 1] = k;
          }
        } else {
          let now = (M.markNow + 1) >>> 0;
          if (now === 0) { M.mark.fill(0); now = 1; }
          M.markNow = now;
          for (let p = 0; p < nc; p++) M.mark[cand[p]] = now;
          nc = 0;
          for (let k = 0; k < M.n; k++) if (M.mark[k] === now) cand[nc++] = k;
        }
        for (let ci = 0; ci < nc; ci++) {
          const k = cand[ci];
          const i = M.idx[k];
          if (i === skip || !B.alive[i]) continue;
          if (cache.placed[placedA + k] !== fillA) placePart(M, atA, k);
          if (cache.placed[placedB + k] !== fillB) placePart(M, atB, k);
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
    for (let j = 0, nj = live >= 0 ? live : S.length; j < nj; j++) {
      const k = live >= 0 ? c.sentries[j] : j;
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
