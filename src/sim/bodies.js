// Kiln: falling bodies and bolts (OWNER: A): embers, drops, hazards and lasers.
//
// Embers and drops fall "away from the bricks" in every mode (down, left, or out from the ring
// centre) and are caught by the paddle's rectangle (or arc) plus a small grace margin. Hazards
// (B's bombs and slag) fly on the velocity B gave them and hurt the paddle on contact. Lasers fly
// from the paddle's two ends along its normal and stop at the first solid brick or sentry.
// Afterimage paddles deflect balls only; they never catch or get hurt.

import { SIM, EMBERS, DROPS, BF, SRC, PADDLE, RING } from '../core/constants.js';
import { DETAIL } from '../core/readability.js';
import { EV } from '../core/events.js';
import { emit } from '../core/bus.js';
import { sweepRectCore, sweepCircleCore, COLLIDE as CQ, queryGrid } from './collide.js';
import {
  M_BOTTOM, M_LEFT, M_RING, RING_FACE, awayAt, tangentAt, normalAt, toLocal, fromLocal, paddleTrack, halfReach, isLost, isOutside,
} from './field.js';

/** Catch grace around the paddle (units): embers are small, so they get a little more. */
export const EMBER_GRACE = 6;
export const DROP_GRACE = 4;
/** Drop cell half size along the track / across it (ART.md: about 48 x 22). */
export const DROP_HALF_U = DETAIL.DROP_HALF_U;
export const DROP_HALF_V = DETAIL.DROP_HALF_V;
export const EMBER_R = DETAIL.EMBER_R;
/** Embers fan out along the track by this spacing when a brick breaks. */
const EMBER_SPACING = 9;
/** Magnet Mod: lateral pull on embers inside the radius (u/s^2) and the lateral speed cap. */
const MAGNET_ACCEL = 1400;
const MAGNET_MAX = 420;
/** Laser bolts: speed (u/s), half length (2 x 24 bolt), inset from the paddle ends. */
export const LASER_SPEED = 1100;
export const LASER_HALF = 12;
const LASER_INSET = 10;

// ------------------------------------------------------------------ spawning (world.api)

/** api.spawnEmbers(x, y, n): n embers fanned along the track, falling away from the bricks. */
export function spawnEmbers(ctx, x, y, n) {
  const w = ctx.world, E = w.embers, rng = w.rng.physics;
  const a = awayAt(ctx.mc, x, y, ctx.p1);
  const t = tangentAt(ctx.mc, x, y, ctx.p2);
  let made = 0;
  for (let i = 0; i < E.alive.length && made < n; i++) {
    if (E.alive[i]) continue;
    const off = (made - (n - 1) / 2) * EMBER_SPACING + rng.range(-3, 3);
    E.alive[i] = 1;
    E.x[i] = E.px[i] = x + t.x * off;
    E.y[i] = E.py[i] = y + t.y * off;
    E.vx[i] = a.x * EMBERS.FALL;
    E.vy[i] = a.y * EMBERS.FALL;
    E.bornMs[i] = w.time;
    if (i >= E.count) E.count = i + 1;
    made++;
  }
  return made;
}

/** api.spawnDrop(x, y, kind): one drop falling away from the bricks; slot or -1. */
export function spawnDrop(ctx, x, y, kind) {
  const w = ctx.world;
  const a = awayAt(ctx.mc, x, y, ctx.p1);
  for (let i = 0; i < w.drops.length; i++) {
    const d = w.drops[i];
    if (d.alive) continue;
    d.alive = true;
    d.kind = kind;
    d.x = d.px = x;
    d.y = d.py = y;
    d.vx = a.x * DROPS.FALL;
    d.vy = a.y * DROPS.FALL;
    d.r = DROP_HALF_V;
    return i;
  }
  return -1;
}

/** api.spawnHazard(x, y, vx, vy, kind, r): slot or -1. */
export function spawnHazard(ctx, x, y, vx, vy, kind, r) {
  const w = ctx.world;
  for (let i = 0; i < w.hazards.length; i++) {
    const h = w.hazards[i];
    if (h.alive) continue;
    h.alive = true;
    h.kind = kind;
    h.x = h.px = x;
    h.y = h.py = y;
    h.vx = vx;
    h.vy = vy;
    h.r = r > 0 ? r : 8;
    return i;
  }
  return -1;
}

/**
 * Fire a pair of bolts from the paddle's two ends. Returns the first slot or -1.
 * One LASER_FIRED per volley (a = bolts fired), one LASER_DONE per bolt.
 */
export function fireLasers(ctx) {
  const w = ctx.world, p = w.paddle, mc = ctx.mc;
  const t0 = paddleTrack(mc, p);
  const reach = halfReach(mc, p) - LASER_INSET;
  let first = -1, fired = 0;
  for (let side = -1; side <= 1; side += 2) {
    let slot = -1;
    for (let i = 0; i < w.lasers.length; i++) if (!w.lasers[i].alive) { slot = i; break; }
    if (slot < 0) break;
    const L = w.lasers[slot];
    fromLocal(mc, t0, side * reach, LASER_HALF + 2, ctx.p1);
    normalAt(mc, ctx.p1.x, ctx.p1.y, ctx.p2);
    L.alive = true;
    L.kind = 0;
    L.x = L.px = ctx.p1.x;
    L.y = L.py = ctx.p1.y;
    L.vx = ctx.p2.x * LASER_SPEED;
    L.vy = ctx.p2.y * LASER_SPEED;
    L.r = 1;
    if (first < 0) first = slot;
    fired++;
  }
  if (fired) emit(w.bus, EV.LASER_FIRED, first, p.x, p.y, fired);
  return first;
}

// ------------------------------------------------------------------ catching

/**
 * Is the body at (ctx.bx, ctx.by) with half extents (hu along the track, hv across) touching the
 * paddle? (The position travels in ctx: a number passed to a call V8 does not inline is boxed.)
 */
function onPaddle(ctx, hu, hv, grace) {
  const w = ctx.world, p = w.paddle, mc = ctx.mc;
  const loc = toLocal(mc, (mc === M_LEFT ? p.y : mc === M_RING ? p.angle : p.x), ctx.bx, ctx.by, ctx.loc);
  if (loc.v > hv + grace || loc.v < -PADDLE.H - hv) return false;
  return Math.abs(loc.u) <= halfReach(mc, p) + hu + grace;
}

/** Large tangent capsules need the curved paddle's radial projection at late angular corners. */
function onDropPaddle(ctx) {
  const w = ctx.world, info = w.readability;
  const hu = info?.dropHalfU || DROP_HALF_U, hv = info?.dropHalfV || DROP_HALF_V;
  if (!onPaddle(ctx, hu, hv, DROP_GRACE)) return false;
  if (ctx.mc !== M_RING || !info?.small) return true;
  // The legacy arc-distance box alone can accept a capsule past the paddle with a visible gap.
  // Reject on the capsule's radial axis as well, keeping the existing catch grace.
  const nearestAngle = Math.max(0, Math.abs(ctx.loc.u) / RING_FACE - w.paddle.span / 2);
  const paddleProjection = (RING_FACE + PADDLE.H) * Math.cos(nearestAngle);
  return RING_FACE - ctx.loc.v - hv <= paddleProjection + DROP_GRACE;
}

/** isLost(r) or isOutside(margin) for the body at (ctx.bx, ctx.by). */
function gone(ctx, r, margin) {
  const x = ctx.bx, y = ctx.by;
  return isLost(ctx.mc, x, y, r) || isOutside(x, y, margin);
}

// ------------------------------------------------------------------ the step

/** Move embers; catch, magnet, cleanup. */
export function stepEmbers(ctx) {
  const w = ctx.world, E = w.embers, dt = SIM.DT, mc = ctx.mc;
  const magnet = w.effects.magnet;
  const p = w.paddle;
  let top = 0;
  for (let i = 0; i < E.count; i++) {
    if (!E.alive[i]) continue;
    E.px[i] = E.x[i];
    E.py[i] = E.y[i];
    if (magnet > 0) {
      const dx = p.x - E.x[i], dy = p.y - E.y[i];
      if (dx * dx + dy * dy < magnet * magnet) {
        const t = tangentAt(mc, E.x[i], E.y[i], ctx.p2);
        const loc = toLocal(mc, (mc === M_LEFT ? p.y : mc === M_RING ? p.angle : p.x), E.x[i], E.y[i], ctx.loc);
        const dir = loc.u > 0 ? -1 : 1;
        let lat = E.vx[i] * t.x + E.vy[i] * t.y;
        lat += dir * MAGNET_ACCEL * dt;
        if (lat > MAGNET_MAX) lat = MAGNET_MAX;
        if (lat < -MAGNET_MAX) lat = -MAGNET_MAX;
        const a = awayAt(mc, E.x[i], E.y[i], ctx.p1);
        E.vx[i] = a.x * EMBERS.FALL + t.x * lat;
        E.vy[i] = a.y * EMBERS.FALL + t.y * lat;
      }
    } else if (mc === M_RING) {
      // ring: keep falling radially outward from where it is now
      const a = awayAt(mc, E.x[i], E.y[i], ctx.p1);
      E.vx[i] = a.x * EMBERS.FALL;
      E.vy[i] = a.y * EMBERS.FALL;
    }
    E.x[i] += E.vx[i] * dt;
    E.y[i] += E.vy[i] * dt;
    ctx.bx = E.x[i];
    ctx.by = E.y[i];
    if (w.phase !== 'over' && onPaddle(ctx, w.readability?.emberR || EMBER_R, w.readability?.emberR || EMBER_R, EMBER_GRACE)) {
      E.alive[i] = 0;
      emit(w.bus, EV.EMBER_CAUGHT, i, E.x[i], E.y[i]);
      continue;
    }
    if (gone(ctx, 10, 40)) {
      E.alive[i] = 0;
      continue;
    }
    top = i + 1;
  }
  E.count = top;
}

/** Move drops; catch or miss. */
export function stepDrops(ctx) {
  const w = ctx.world, dt = SIM.DT, mc = ctx.mc;
  for (let i = 0; i < w.drops.length; i++) {
    const d = w.drops[i];
    if (!d.alive) continue;
    d.px = d.x;
    d.py = d.y;
    if (mc === M_RING) {
      const a = awayAt(mc, d.x, d.y, ctx.p1);
      d.vx = a.x * DROPS.FALL;
      d.vy = a.y * DROPS.FALL;
    }
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    ctx.bx = d.x;
    ctx.by = d.y;
    if (w.phase !== 'over' && onDropPaddle(ctx)) {
      d.alive = false;
      emit(w.bus, EV.DROP_CAUGHT, i, d.x, d.y, d.kind);
      continue;
    }
    // A large phone capsule may still meet the paddle after its centre crosses the loss ring.
    // Keep it until the whole radial footprint leaves; legacy desktop cleanup is unchanged.
    const lost = mc === M_RING && w.readability?.small
      ? Math.hypot(d.x - RING.CX, d.y - RING.CY) > RING.R_LOSS + w.readability.dropHalfV
      : gone(ctx, w.readability?.dropHalfU || DROP_HALF_U, 60);
    if (lost) {
      d.alive = false;
      emit(w.bus, EV.DROP_MISSED, i, d.x, d.y, d.kind);
    }
  }
}

/** Move hazards; hit the paddle or leave. */
export function stepHazards(ctx) {
  const w = ctx.world, dt = SIM.DT, mc = ctx.mc;
  for (let i = 0; i < w.hazards.length; i++) {
    const h = w.hazards[i];
    if (!h.alive) continue;
    h.px = h.x;
    h.py = h.y;
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    ctx.bx = h.x;
    ctx.by = h.y;
    if (w.phase !== 'over' && w.phase !== 'cleared' && onPaddle(ctx, h.r, h.r, 0)) {
      h.alive = false;
      emit(w.bus, EV.HAZARD_HIT, i, h.x, h.y, h.kind);
      continue;
    }
    if (isOutside(h.x, h.y, 80) || (mc === M_RING && isLost(mc, h.x, h.y, h.r + 20))) h.alive = false;
  }
}

/** Move laser bolts; the leading tip stops at the first solid brick or sentry. */
export function stepLasers(ctx) {
  const w = ctx.world, B = w.bricks, dt = SIM.DT;
  for (let li = 0; li < w.lasers.length; li++) {
    const L = w.lasers[li];
    if (!L.alive) continue;
    L.px = L.x;
    L.py = L.y;
    const sp = Math.sqrt(L.vx * L.vx + L.vy * L.vy) || 1;
    const ux = L.vx / sp, uy = L.vy / sp;
    const tx = L.x + ux * LASER_HALF, ty = L.y + uy * LASER_HALF; // tip
    const dx = L.vx * dt, dy = L.vy * dt;
    let best = 2, bi = -1, si = -1;
    const n = queryGrid(ctx.grid, Math.min(tx, tx + dx) - 2, Math.min(ty, ty + dy) - 2,
      Math.max(tx, tx + dx) + 2, Math.max(ty, ty + dy) + 2, ctx.list);
    for (let k = 0; k < n; k++) {
      const i = ctx.list[k];
      if (!(B.flags[i] & BF.SOLID)) continue;
      CQ.px = tx; CQ.py = ty; CQ.dx = dx; CQ.dy = dy; CQ.r = 1;
      CQ.cx = B.x[i]; CQ.cy = B.y[i]; CQ.hw = B.w[i] / 2; CQ.hh = B.h[i] / 2;
      const t = sweepRectCore(ctx.hit) ? CQ.t : -1;
      if (t >= 0 && t < best) { best = t; bi = i; }
    }
    const S = w.sentries;
    for (let k = 0; k < S.length; k++) {
      const s = S[k];
      if (!s.alive || s.r <= 0) continue;
      CQ.px = tx; CQ.py = ty; CQ.dx = dx; CQ.dy = dy; CQ.cx = s.x; CQ.cy = s.y; CQ.r = s.r + 1;
      const t = sweepCircleCore(ctx.hit) ? CQ.t : -1;
      if (t >= 0 && t < best) { best = t; si = k; bi = -1; }
    }
    // the ceiling (bottom) or far wall (left) stops a bolt that met nothing: it never flies into
    // the headroom
    let wallT = 2;
    if (ctx.mc === M_BOTTOM && dy < 0) wallT = (ctx.ceilY - ty) / dy;
    else if (ctx.mc === M_LEFT && dx > 0) wallT = (ctx.farX - tx) / dx;
    if (wallT < 0) wallT = 0;
    if (wallT <= 1 && wallT < best) {
      const hx = tx + dx * wallT, hy = ty + dy * wallT;
      L.x = hx - ux * LASER_HALF;
      L.y = hy - uy * LASER_HALF;
      L.alive = false;
      emit(w.bus, EV.LASER_DONE, li, hx, hy);
      continue;
    }
    if (best <= 1) {
      const hx = tx + dx * best, hy = ty + dy * best;
      if (si >= 0) emit(w.bus, EV.SENTRY_HIT, si, hx, hy, -1, SRC.LASER);
      else emit(w.bus, EV.BRICK_HIT, bi, hx, hy, -1, SRC.LASER, 0);
      L.x = hx - ux * LASER_HALF;
      L.y = hy - uy * LASER_HALF;
      L.alive = false;
      emit(w.bus, EV.LASER_DONE, li, hx, hy);
      continue;
    }
    L.x += dx;
    L.y += dy;
    const gone = ctx.mc === M_RING
      ? (L.x - RING.CX) * (L.x - RING.CX) + (L.y - RING.CY) * (L.y - RING.CY) > RING.R_LOSS * RING.R_LOSS && ((L.x - RING.CX) * L.vx + (L.y - RING.CY) * L.vy) > 0
      : isOutside(L.x, L.y, LASER_HALF);
    if (gone) {
      L.alive = false;
      emit(w.bus, EV.LASER_DONE, li, L.x, L.y);
    }
  }
}
