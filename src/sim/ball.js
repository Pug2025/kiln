// Kiln: one ball through one step (OWNER: A): speed, spin, Pull, then a swept, iterative resolve
// against walls, the shield line, the paddle (and its afterimages), sentries and bricks.
//
// Rules (PLAN §2, §7):
// - Swept circle vs rounded rectangle: no tunnelling at any speed (tests use 20x the cap).
// - Up to MAX_REFLECT reflections per step (plus passes through breakable bricks); what is left
//   of the step after that is dropped, never skipped through a wall.
// - Seam hits: every brick touched within SEAM_TOL units of the first contact is hit too, and the
//   reflection uses their combined normal. A corner shared with a solid neighbour reflects as the
//   flat face it really is (no sideways kick off a seam); a neighbour the ball is passing through
//   does not count. A contact whose normal would not turn the ball falls back to the true contact
//   normals, so every counted reflection changes the flight (no ball frozen on a corner).
// - At most one BRICK_HIT per ball per brick per step.
// - Never flatter than 12 degrees from the surface just hit; in bottom/left mode also never
//   flatter than 12 degrees from the paddle's track (no endless side-to-side rallies).
// - Moving and falling bricks, sentries: resolved with relative velocity at their position at
//   the contact time, so the ball never sinks into them.
// - Reflection keeps speed: after every bounce the speed is set back to the target speed, except
//   that a ball always leaves a moving obstacle faster than the obstacle follows it.
// - Portals: the ball leaves the twin cell at the entry offset, limited so it fits inside the twin.
// - The top wall in bottom mode is the ceiling and the far wall in left mode is world.field.farX
//   (ceiling.js, fixed at level start): the ball never goes past them into the headroom.

import { SIM, FIELD, ANGLE, BF, SRC, PADDLE, RING, SPIN, PULL } from '../core/constants.js';
import { EV } from '../core/events.js';
import { emit } from '../core/bus.js';
import {
  sweepRectCore, sweepCircleCore, sweepExitCore, overlapBallBrick, COLLIDE as CQ, queryGrid,
} from './collide.js';
import {
  M_BOTTOM, M_LEFT, M_RING, RING_FACE, SHIELD_LINE, paddleTrack, halfReach, angleDiff,
} from './field.js';

const DEG = Math.PI / 180;
const MAX_REFLECT = 4;
const MAX_ITERS = 10;
const SEAM_TOL = 0.75;              // units: bricks touched this close to the first contact are hit too
const SIN_MIN = Math.sin(ANGLE.MIN_FROM_EDGE_DEG * DEG);
const COS_MIN = Math.cos(ANGLE.MIN_FROM_EDGE_DEG * DEG);
export const IGN = 8;               // pass-through bricks remembered per ball
export const PORTAL_COOLDOWN_MS = 350;
const K_NONE = 0, K_WALL = 1, K_PADDLE = 2, K_SENTRY = 3, K_SHIELD = 4;

// ------------------------------------------------------------------ small vector helpers

/**
 * Keep a direction at least 12 degrees off a surface (unit normal n), leaving it on the n side.
 * Writes ctx.v (same speed). (The step itself uses bounceOff, the same rule without number
 * arguments.)
 */
export function clampOffSurface(ctx, vx, vy, nx, ny) {
  const s = Math.sqrt(vx * vx + vy * vy);
  if (s <= 0) {
    ctx.v.x = vx;
    ctx.v.y = vy;
    return;
  }
  const vn = (vx * nx + vy * ny) / s;
  if (vn >= SIN_MIN) {
    ctx.v.x = vx;
    ctx.v.y = vy;
    return;
  }
  // tangential direction (keep its sign; if none, pick +tangent)
  let tx = vx / s - vn * nx, ty = vy / s - vn * ny;
  const tl = Math.sqrt(tx * tx + ty * ty);
  if (tl < 1e-9) {
    tx = -ny;
    ty = nx;
  } else {
    tx /= tl;
    ty /= tl;
  }
  ctx.v.x = (nx * SIN_MIN + tx * COS_MIN) * s;
  ctx.v.y = (ny * SIN_MIN + ty * COS_MIN) * s;
}

/**
 * Bounce ball b off the unit normal (ctx.nX, ctx.nY) of an obstacle moving at (ctx.oX, ctx.oY):
 * reflect the velocity relative to the obstacle, then clampOffSurface. Writes b.vx/vy. The
 * numbers travel in ctx because a call V8 does not inline boxes every fractional argument.
 */
function bounceOff(ctx, b) {
  const nx = ctx.nX, ny = ctx.nY;
  let vx = b.vx, vy = b.vy;
  const rel = (vx - ctx.oX) * nx + (vy - ctx.oY) * ny;
  if (rel < 0) {
    vx -= 2 * rel * nx;
    vy -= 2 * rel * ny;
  }
  const s = Math.sqrt(vx * vx + vy * vy);
  if (s > 0) {
    const vn = (vx * nx + vy * ny) / s;
    if (vn < SIN_MIN) {
      let tx = vx / s - vn * nx, ty = vy / s - vn * ny;
      const tl = Math.sqrt(tx * tx + ty * ty);
      if (tl < 1e-9) {
        tx = -ny;
        ty = nx;
      } else {
        tx /= tl;
        ty /= tl;
      }
      vx = (nx * SIN_MIN + tx * COS_MIN) * s;
      vy = (ny * SIN_MIN + ty * COS_MIN) * s;
    }
  }
  b.vx = vx;
  b.vy = vy;
}

/**
 * emit(type, id, x, y, a, b, c) at the ball's edge facing the surface whose normal is in
 * ctx.nX/nY (the contact point). Only whole numbers cross the call.
 */
function emitEdge(ctx, b, type, id, a, bb, c) {
  emit(ctx.world.bus, type, id, b.x - ctx.nX * b.r, b.y - ctx.nY * b.r, a, bb, c);
}

/**
 * After a bounce off an obstacle moving toward the ball (normal and velocity in ctx nX nY oX oY)
 * and the speed reset: the ball must leave faster than the obstacle follows, or the obstacle
 * catches it again at once (a gravity brick falling faster than the ball). Adds the missing part
 * along the normal; the next step's steer sets the speed back.
 */
function separate(ctx, b) {
  const nx = ctx.nX, ny = ctx.nY;
  const on = ctx.oX * nx + ctx.oY * ny;
  if (on <= 0) return;
  const need = on + 1 - (b.vx * nx + b.vy * ny);
  if (need > 0) {
    b.vx += need * nx;
    b.vy += need * ny;
  }
}

/**
 * BRICK_HIT for brick i from ball b, at most once per ball per brick per step (the contact point
 * faces ctx.nX/nY). Answers 1 when it emitted.
 */
function hitBrick(ctx, b, bi, i, src, c) {
  const n = ctx.stepHitN;
  for (let k = 0; k < n; k++) if (ctx.stepHit[k] === i) return 0;
  if (n < ctx.stepHit.length) {
    ctx.stepHit[n] = i;
    ctx.stepHitN = n + 1;
  }
  emitEdge(ctx, b, EV.BRICK_HIT, i, bi, src, c);
  return 1;
}

/** Skip brick i for the rest of this ball's step (a contact that cannot turn the ball). */
function skipBrick(ctx, i) {
  if (ctx.skipN < ctx.skip.length) ctx.skip[ctx.skipN++] = i;
}

function skipped(ctx, i) {
  for (let k = 0; k < ctx.skipN; k++) if (ctx.skip[k] === i) return true;
  return false;
}

/**
 * Bottom/left mode: never flatter than 12 degrees from the paddle track (horizontal in bottom
 * mode, vertical in left mode). Ring mode has no walls to rally between. Modifies the ball.
 */
export function clampFlat(mc, b) {
  if (mc === M_RING) return;
  const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
  if (s <= 0) return;
  if (mc === M_BOTTOM) {
    if (Math.abs(b.vy) >= SIN_MIN * s) return;
    const sy = b.vy < 0 ? -1 : b.vy > 0 ? 1 : -1;
    b.vy = sy * SIN_MIN * s;
    b.vx = (b.vx < 0 ? -1 : 1) * COS_MIN * s;
  } else {
    if (Math.abs(b.vx) >= SIN_MIN * s) return;
    const sx = b.vx < 0 ? -1 : b.vx > 0 ? 1 : 1;
    b.vx = sx * SIN_MIN * s;
    b.vy = (b.vy < 0 ? -1 : 1) * COS_MIN * s;
  }
}

/** Set a ball's velocity to a unit direction times speed. */
export function setVel(b, dx, dy, speed) {
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  b.vx = (dx / l) * speed;
  b.vy = (dy / l) * speed;
}

/** Scale a ball's velocity to a speed, keeping its direction. */
export function setSpeed(b, speed) {
  const l = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
  if (l <= 0) return;
  b.vx = (b.vx / l) * speed;
  b.vy = (b.vy / l) * speed;
}

// ------------------------------------------------------------------ speed, spin, pull

/**
 * Speed the ball should have this step (u/s), cap included.
 * tier (+1 while a perfect-hit boost runs) x effects.ballSpeedScale (Slow, Fast, Quench and the
 * Heavy ball, all folded in by E) x last bricks x Pull.
 */
export function targetSpeed(ctx, b) {
  calcTarget(ctx, b);
  return ctx.target;
}

/** targetSpeed into ctx.target (no number crosses the call: see collide.js Q). */
function calcTarget(ctx, b) {
  const w = ctx.world;
  let tier = b.tier + (b.boostMs > 0 ? 1 : 0);
  if (tier > 5) tier = 5;
  let s = ctx.tiers[tier] * (w.effects.ballSpeedScale > 0 ? w.effects.ballSpeedScale : 1);
  if (ctx.lastBricks) s *= ctx.lastBricksScale;
  if (w.paddle.pulling) s *= PULL.SPEED_SCALE;
  ctx.target = s > ctx.cap ? ctx.cap : s;
}

/** Scale a ball's velocity to ctx.target (or ctx.speed0 with useSpeed0), keeping its direction. */
function speedTo(ctx, b, useSpeed0) {
  const speed = useSpeed0 ? ctx.speed0 : ctx.target;
  const l = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
  if (l <= 0) return;
  b.vx = (b.vx / l) * speed;
  b.vy = (b.vy / l) * speed;
}

/** Spin and Pull bend the flight; then the speed is set to the target. */
export function steerBall(ctx, bi) {
  const w = ctx.world;
  const b = w.balls[bi];
  const dt = SIM.DT;
  if (b.spin !== 0) {
    const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    const ang = (b.spin * s / SPIN.MIN_RADIUS) * dt;
    const c = Math.cos(ang), sn = Math.sin(ang);
    const vx = b.vx * c - b.vy * sn;
    b.vy = b.vx * sn + b.vy * c;
    b.vx = vx;
    // linear decay to zero over SPIN.DURATION_MS from the value it started with
    const step = Math.abs(ctx.spin0[bi]) * (SIM.DT_MS / SPIN.DURATION_MS);
    if (Math.abs(b.spin) <= step) b.spin = 0;
    else b.spin -= Math.sign(b.spin) * step;
  }
  if (w.paddle.pulling) {
    const p = w.paddle;
    const dx = p.x - b.x, dy = p.y - b.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    b.vx += (dx / d) * PULL.ACCEL * dt;
    b.vy += (dy / d) * PULL.ACCEL * dt;
  }
  calcTarget(ctx, b);
  speedTo(ctx, b, false);
  clampFlat(ctx.mc, b);
}

// ------------------------------------------------------------------ pass-through bookkeeping

function ignored(ctx, bi, i) {
  const base = bi * IGN, n = ctx.ignN[bi];
  for (let k = 0; k < n; k++) if (ctx.ign[base + k] === i) return true;
  return false;
}

function addIgnore(ctx, bi, i) {
  if (ignored(ctx, bi, i)) return;
  const base = bi * IGN;
  let n = ctx.ignN[bi];
  if (n >= IGN) {
    for (let k = 1; k < IGN; k++) ctx.ign[base + k - 1] = ctx.ign[base + k];
    n = IGN - 1;
  }
  ctx.ign[base + n] = i;
  ctx.ignN[bi] = n + 1;
}

/** Forget pass-through bricks the ball no longer overlaps. */
function pruneIgnore(ctx, bi) {
  const w = ctx.world, b = w.balls[bi], B = w.bricks;
  const base = bi * IGN;
  let n = ctx.ignN[bi], k = 0;
  while (k < n) {
    const i = ctx.ign[base + k];
    const keep = B.alive[i] && !(B.flags[i] & BF.HIDDEN) && overlapBallBrick(b, 0.5, B, i, ctx.hit) === 1;
    if (keep) k++;
    else {
      ctx.ign[base + k] = ctx.ign[base + n - 1];
      n--;
    }
  }
  ctx.ignN[bi] = n;
}

/** Can this ball pass through brick i right now (Thru, Mega, or a pierce left)? */
function canPass(ctx, b, i, pierceLeft) {
  const B = ctx.world.bricks;
  if (!(B.flags[i] & BF.BREAKABLE)) return false;
  const fx = ctx.world.effects;
  return fx.thru || fx.mega || pierceLeft > 0;
}

/** The damage source this ball hits with. */
export function ballSrc(ctx) {
  const fx = ctx.world.effects;
  return fx.mega ? SRC.MEGA : fx.fire ? SRC.FIRE : SRC.BALL;
}

// ------------------------------------------------------------------ anti-loop bookkeeping hooks

/** A bounce that broke nothing (wall, indestructible, boss armour), where the ball is now. */
function noteDeadBounce(ctx, bi, surface) {
  const b = ctx.world.balls[bi];
  b.bouncesNoBrick++;
  pushSigQ(ctx, bi, surface, Math.floor(b.x / 10), Math.floor(b.y / 10));
}

/**
 * Does ball b's contact with brick i count as progress for the anti-loop rules? Anything
 * breakable and a boss's weak point do. Unbreakable boss armour does while the ball is level with
 * or inside the boss (a ball rattling around or inside a moving boss is the fight), but not once
 * the ball is over the whole boss, past its top edge (bottom) or its far edge (left): a ball
 * skating between the ceiling and the top of a boss breaks nothing and must count its bounces
 * like any other loop (The Stoker, review 2026-10-22). Ring mode has no ceiling, so every boss
 * contact there stays progress. The boss's reach is read only on an armour contact (rare).
 */
function isProgressHit(ctx, b, i) {
  const B = ctx.world.bricks, f = B.flags[i];
  if (f & (BF.BREAKABLE | BF.WEAK)) return true;
  if (!(f & BF.BOSS)) return false;
  const mc = ctx.mc;
  if (mc !== M_BOTTOM && mc !== M_LEFT) return true;
  let reach = mc === M_BOTTOM ? Infinity : -Infinity;
  for (let k = 0; k < B.count; k++) {
    const g = B.flags[k];
    if (!B.alive[k] || !(g & BF.BOSS) || (g & BF.HIDDEN)) continue;
    if (mc === M_BOTTOM) {
      const t = B.y[k] - B.h[k] / 2;
      if (t < reach) reach = t;
    } else {
      const r = B.x[k] + B.w[k] / 2;
      if (r > reach) reach = r;
    }
  }
  return mc === M_BOTTOM ? b.y >= reach : b.x <= reach;
}

/** A hit on something breakable: progress, the loop counters reset. */
function noteProgress(ctx, bi) {
  const b = ctx.world.balls[bi];
  b.bouncesNoBrick = 0;
  ctx.sigN[bi] = 0;
  ctx.portalTrips[bi] = 0;
  ctx.progressMs[bi] = ctx.world.time;
}

/** Record a bounce signature (surface + contact cell) for the repeated-pattern check. */
export function pushSig(ctx, bi, surface, x, y) {
  pushSigQ(ctx, bi, surface, Math.floor(x / 10), Math.floor(y / 10));
}

/** pushSig with the contact cell already in whole numbers (qx, qy = coordinate / 10, floored). */
function pushSigQ(ctx, bi, surface, qx, qy) {
  const sig = ((surface * 131 + qx) * 137 + qy) | 0;
  const base = bi * 8;
  const n = ctx.sigN[bi];
  if (n < 8) {
    ctx.sig[base + n] = sig;
    ctx.sigN[bi] = n + 1;
  } else {
    for (let k = 1; k < 8; k++) ctx.sig[base + k - 1] = ctx.sig[base + k];
    ctx.sig[base + 7] = sig;
  }
}

// ------------------------------------------------------------------ overlap repair

/**
 * Push the ball out of any solid brick it overlaps (a brick moved or fell into it, a ball was
 * spawned inside one). A ball moving into a brick it can pass through (Thru, Mega, a pierce left)
 * passes it instead, spending one pierce like any other pass. A push-out bounce follows the same
 * rules as a swept one (12 degrees off the surface and off the paddle track, leaves a moving brick).
 */
export function depenetrate(ctx, bi) {
  const w = ctx.world, b = w.balls[bi], B = w.bricks, fx = w.effects;
  const list = ctx.list;
  for (let pass = 0; pass < 3; pass++) {
    const n = queryGrid(ctx.grid, b.x - b.r - 1, b.y - b.r - 1, b.x + b.r + 1, b.y + b.r + 1, list);
    let moved = false;
    for (let k = 0; k < n; k++) {
      const i = list[k];
      if (!(B.flags[i] & BF.SOLID) || ignored(ctx, bi, i)) continue;
      if (!overlapBallBrick(b, 0, B, i, ctx.hit)) continue;
      const depth = CQ.t;
      if (depth <= 0.01) continue;
      const nx = ctx.hit.nx, ny = ctx.hit.ny;
      const ox = B.flags[i] & (BF.MOVING | BF.FALLING) ? (B.x[i] - B.px[i]) / SIM.DT : 0;
      const oy = B.flags[i] & (BF.MOVING | BF.FALLING) ? (B.y[i] - B.py[i]) / SIM.DT : 0;
      const into = (b.vx - ox) * nx + (b.vy - oy) * ny < 0;
      if (into && canPass(ctx, b, i, b.pierce)) {
        addIgnore(ctx, bi, i);
        if (!fx.thru && !fx.mega) b.pierce--;
        ctx.nX = 0;
        ctx.nY = 0;
        hitBrick(ctx, b, bi, i, ballSrc(ctx), 1);
        noteProgress(ctx, bi);
        continue;
      }
      b.x += nx * (depth + 0.01);
      b.y += ny * (depth + 0.01);
      if (into) {
        ctx.nX = nx;
        ctx.nY = ny;
        ctx.oX = ox;
        ctx.oY = oy;
        bounceOff(ctx, b);
        speedTo(ctx, b, true);
        separate(ctx, b);
        clampFlat(ctx.mc, b);
        hitBrick(ctx, b, bi, i, ballSrc(ctx), 0);
        if (isProgressHit(ctx, b, i)) noteProgress(ctx, bi);
      }
      moved = true;
    }
    if (!moved) break;
  }
}

/** Keep the ball inside the walls of bottom / left mode (the ceiling and far wall: ctx.ceilY, ctx.farX). */
function containWalls(ctx, b) {
  const r = b.r;
  if (ctx.mc === M_BOTTOM) {
    const top = ctx.ceilY + r;
    if (b.x < r) { b.x = r; if (b.vx < 0) b.vx = -b.vx; }
    if (b.x > FIELD.W - r) { b.x = FIELD.W - r; if (b.vx > 0) b.vx = -b.vx; }
    if (b.y < top) { b.y = top; if (b.vy < 0) b.vy = -b.vy; }
  } else if (ctx.mc === M_LEFT) {
    const far = ctx.farX - r;
    if (b.y < r) { b.y = r; if (b.vy < 0) b.vy = -b.vy; }
    if (b.y > FIELD.H - r) { b.y = FIELD.H - r; if (b.vy > 0) b.vy = -b.vy; }
    if (b.x > far) { b.x = far; if (b.vx > 0) b.vx = -b.vx; }
  }
}

// ------------------------------------------------------------------ the paddle test

/**
 * Earliest paddle contact for the displacement in ctx.sdx/sdy. Answers 1 and fills ctx.pad: t,
 * u (track offset from the body that was hit), body (0 paddle, 1/2 ghost), cx/cy contact point;
 * else 0. (No number arguments or result: see collide.js Q.)
 */
function sweepPaddle(ctx, b) {
  const w = ctx.world, p = w.paddle, mc = ctx.mc, r = b.r;
  const dx = ctx.sdx, dy = ctx.sdy;
  let t;
  let s; // ball track coordinate at contact
  let level = false; // the ball starts the step already level with the face (inside the paddle band)
  if (mc === M_RING) {
    const ex = b.x - RING.CX, ey = b.y - RING.CY;
    const dist = Math.sqrt(ex * ex + ey * ey);
    if (dist > RING.R_PADDLE + PADDLE.H / 2 + r * 0.5) return 0; // already behind the paddle
    level = dist > RING_FACE - r + 0.5; // (a ball that only just reached the face still crosses it)
    CQ.px = b.x; CQ.py = b.y; CQ.dx = dx; CQ.dy = dy; CQ.cx = RING.CX; CQ.cy = RING.CY; CQ.r = RING_FACE - r;
    if (!sweepExitCore(ctx.hit)) return 0;
    t = CQ.t;
    const hx = b.x + dx * t, hy = b.y + dy * t;
    s = Math.atan2(hy - RING.CY, hx - RING.CX);
    ctx.pad.cx = RING.CX + Math.cos(s) * RING_FACE;
    ctx.pad.cy = RING.CY + Math.sin(s) * RING_FACE;
  } else {
    // v: distance in front of the face; dv: its change over the displacement
    let v0, dv;
    if (mc === M_LEFT) {
      v0 = b.x - (p.x + PADDLE.H / 2);
      dv = dx;
    } else {
      v0 = (PADDLE.Y - PADDLE.H / 2) - b.y;
      dv = -dy;
    }
    if (dv >= 0) return 0;
    if (v0 >= r) {
      t = (v0 - r) / -dv;
      if (t > 1) return 0;
    } else if (v0 > -PADDLE.H) t = 0; // the paddle swept onto a ball already level with it
    else return 0;
    const hx = b.x + dx * t, hy = b.y + dy * t;
    s = mc === M_LEFT ? hy : hx;
    if (mc === M_LEFT) {
      ctx.pad.cx = p.x + PADDLE.H / 2;
      ctx.pad.cy = hy;
    } else {
      ctx.pad.cx = hx;
      ctx.pad.cy = PADDLE.Y - PADDLE.H / 2;
    }
  }
  // which paddle body reaches it: the paddle (over the range it swept this step) or a ghost
  const reach = halfReach(mc, p) + r;
  const cur = (mc === M_LEFT ? p.y : mc === M_RING ? p.angle : p.x); // paddleTrack, written out (no boxed result)
  const scale = mc === M_RING ? RING_FACE : 1;
  let delta = mc === M_RING ? angleDiff(ctx.prevTrack, cur) : ctx.prevTrack - cur;
  if (mc === M_RING) {
    // Ring mode steers by bearing, so a pointer moved a few units around the centre swings the
    // paddle half a turn in one step. Only the last stretch a hand could really sweep counts
    // (PHYS.RING_SWEEP_MAX u/s along the face, over the steps since the paddle last moved).
    const lim = ctx.ringSweep * ctx.moveGap;
    if (delta > lim) delta = lim;
    else if (delta < -lim) delta = -lim;
  }
  const lo = delta < 0 ? delta : 0, hi = delta > 0 ? delta : 0;
  const ds = mc === M_RING ? angleDiff(s, cur) : s - cur;
  const gap = (ds < lo ? lo - ds : ds > hi ? ds - hi : 0) * scale;
  let body = -1, u = 0, bestGap = Infinity;
  // A ball already level with the ring paddle is hit only by an end of the paddle moving onto it:
  // one the paddle already covered where this step began got past its face, it is not caught
  // now because the paddle jumped onto it.
  const onto = !level || Math.abs(ds - delta) * scale > reach;
  if (gap <= reach && onto) {
    body = 0;
    u = ds * scale;
    bestGap = gap;
  }
  if (w.level.rules.ghosts) {
    for (let g = 0; g < 2; g++) {
      const gc = p.ghostX[g];
      const gd = (mc === M_RING ? angleDiff(s, gc) : s - gc) * scale;
      const ag = Math.abs(gd);
      if (ag <= reach && ag < bestGap) {
        body = g + 1;
        u = gd;
        bestGap = ag;
      }
    }
  }
  if (body < 0) return 0;
  ctx.pad.u = u;
  ctx.pad.body = body;
  ctx.pad.t = t;
  return 1;
}

// ------------------------------------------------------------------ the step

/**
 * Move one free ball through one step. Returns nothing; emits every contact.
 * @param {object} ctx physics context (physics.js)
 * @param {number} bi ball slot
 */
export function moveBall(ctx, bi) {
  const w = ctx.world, b = w.balls[bi], B = w.bricks, fx = w.effects, mc = ctx.mc;
  const hit = ctx.hit, hits = ctx.hits;
  const dt = SIM.DT;
  ctx.speed0 = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
  ctx.stepHitN = 0;
  ctx.skipN = 0;
  pruneIgnore(ctx, bi);
  depenetrate(ctx, bi);
  let rem = 1, tau = 0, refl = 0, iters = 0;
  let paddleDone = false;

  while (rem > 1e-9 && refl < MAX_REFLECT && iters < MAX_ITERS) {
    iters++;
    const r = b.r;
    const shieldOn = fx.shield > ctx.shieldUsed;
    const dx = b.vx * dt * rem, dy = b.vy * dt * rem;
    const dlen = Math.sqrt(dx * dx + dy * dy);
    if (dlen < 1e-9) break;

    // ---- walls, shield, paddle, sentries: the earliest "other" contact
    let bestO = 2, kind = K_NONE, side = 0, onx = 0, ony = 0, sid = -1, sox = 0, soy = 0;
    if (mc === M_BOTTOM) {
      if (dx < 0) { let t = (r - b.x) / dx; if (t < 0) t = 0; if (t <= 1 && t < bestO) { bestO = t; kind = K_WALL; side = 0; onx = 1; ony = 0; } }
      else if (dx > 0) { let t = (FIELD.W - r - b.x) / dx; if (t < 0) t = 0; if (t <= 1 && t < bestO) { bestO = t; kind = K_WALL; side = 1; onx = -1; ony = 0; } }
      // the ceiling (world.field.ceilingY): side 2, the old top wall
      if (dy < 0) { let t = (ctx.ceilY + r - b.y) / dy; if (t < 0) t = 0; if (t <= 1 && t < bestO) { bestO = t; kind = K_WALL; side = 2; onx = 0; ony = 1; } }
      if (dy > 0 && shieldOn) {
        const plane = SHIELD_LINE.bottom - r;
        if (b.y <= plane + 0.01) {
          let t = (plane - b.y) / dy; if (t < 0) t = 0;
          if (t <= 1 && t < bestO) { bestO = t; kind = K_SHIELD; onx = 0; ony = -1; }
        }
      }
    } else if (mc === M_LEFT) {
      if (dy < 0) { let t = (r - b.y) / dy; if (t < 0) t = 0; if (t <= 1 && t < bestO) { bestO = t; kind = K_WALL; side = 2; onx = 0; ony = 1; } }
      else if (dy > 0) { let t = (FIELD.H - r - b.y) / dy; if (t < 0) t = 0; if (t <= 1 && t < bestO) { bestO = t; kind = K_WALL; side = 4; onx = 0; ony = -1; } }
      // the far wall (world.field.farX)
      if (dx > 0) { let t = (ctx.farX - r - b.x) / dx; if (t < 0) t = 0; if (t <= 1 && t < bestO) { bestO = t; kind = K_WALL; side = 1; onx = -1; ony = 0; } }
      if (dx < 0 && shieldOn) {
        const plane = SHIELD_LINE.left + r;
        if (b.x >= plane - 0.01) {
          let t = (plane - b.x) / dx; if (t < 0) t = 0;
          if (t <= 1 && t < bestO) { bestO = t; kind = K_SHIELD; onx = 1; ony = 0; }
        }
      }
    } else if (shieldOn) {
      CQ.px = b.x; CQ.py = b.y; CQ.dx = dx; CQ.dy = dy; CQ.cx = RING.CX; CQ.cy = RING.CY; CQ.r = SHIELD_LINE.ring - r;
      if (sweepExitCore(hit) && CQ.t < bestO) { bestO = CQ.t; kind = K_SHIELD; onx = hit.nx; ony = hit.ny; }
    }
    if (!paddleDone && ctx.paddleLive) {
      ctx.sdx = dx;
      ctx.sdy = dy;
      if (sweepPaddle(ctx, b) && ctx.pad.t < bestO) { bestO = ctx.pad.t; kind = K_PADDLE; }
    }
    const S = w.sentries;
    for (let k = 0; k < S.length; k++) {
      const sn = S[k];
      if (!sn.alive || sn.r <= 0) continue;
      const mdx = sn.x - sn.px, mdy = sn.y - sn.py;
      const sx0 = sn.px + mdx * tau, sy0 = sn.py + mdy * tau;
      CQ.px = b.x - sx0; CQ.py = b.y - sy0; CQ.dx = dx - mdx * rem; CQ.dy = dy - mdy * rem;
      CQ.cx = 0; CQ.cy = 0; CQ.r = r + sn.r;
      if (!sweepCircleCore(hit)) continue;
      const t = CQ.t;
      if (t < bestO) {
        bestO = t; kind = K_SENTRY; sid = k; onx = hit.nx; ony = hit.ny;
        sox = mdx / dt; soy = mdy / dt;
      }
    }

    // ---- bricks: every contact, for seams
    hits.n = 0;
    let bestB = 2;
    {
      const m = r + 8;
      const x0 = (dx < 0 ? b.x + dx : b.x) - m, x1 = (dx > 0 ? b.x + dx : b.x) + m;
      const y0 = (dy < 0 ? b.y + dy : b.y) - m, y1 = (dy > 0 ? b.y + dy : b.y) + m;
      const n = queryGrid(ctx.grid, x0, y0, x1, y1, ctx.list);
      for (let k = 0; k < n; k++) {
        const i = ctx.list[k];
        const fl = B.flags[i];
        if (!(fl & BF.SOLID) || ignored(ctx, bi, i) || (ctx.skipN > 0 && skipped(ctx, i))) continue;
        let bx0 = B.x[i], by0 = B.y[i], bdx = 0, bdy = 0;
        if (fl & (BF.MOVING | BF.FALLING)) {
          const mdx = B.x[i] - B.px[i], mdy = B.y[i] - B.py[i];
          bx0 = B.px[i] + mdx * tau;
          by0 = B.py[i] + mdy * tau;
          bdx = mdx * rem;
          bdy = mdy * rem;
        }
        CQ.px = b.x - bx0; CQ.py = b.y - by0; CQ.dx = dx - bdx; CQ.dy = dy - bdy; CQ.r = r;
        CQ.cx = 0; CQ.cy = 0; CQ.hw = B.w[i] / 2; CQ.hh = B.h[i] / 2;
        if (!sweepRectCore(hit)) continue;
        const t = CQ.t;
        if (hits.n < hits.idx.length) {
          const h = hits.n++;
          hits.idx[h] = i;
          hits.t[h] = t;
          hits.nx[h] = hits.rx[h] = hit.nx;
          hits.ny[h] = hits.ry[h] = hit.ny;
          hits.corner[h] = hit.corner;
        }
        if (t < bestB) bestB = t;
      }
    }

    if (bestB > 1 && bestO > 1) {
      b.x += dx;
      b.y += dy;
      tau += rem;
      rem = 0;
      break;
    }

    if (bestB <= bestO) {
      // ---------------- brick contact (with seams)
      const t = bestB;
      b.x += dx * t;
      b.y += dy * t;
      tau += rem * t;
      rem *= 1 - t;
      const tolT = SEAM_TOL / dlen;
      let allPass = true, nPass = 0, anyBreakable = false;
      let sumx = 0, sumy = 0, pierceLeft = b.pierce;
      let primary = -1, primaryT = 2, hp = 0;
      // pass 1: flatten seam corners, decide pass/reflect
      for (let h = 0; h < hits.n; h++) {
        if (hits.t[h] > t + tolT) { hits.idx[h] = -1; continue; }
        const i = hits.idx[h];
        if (hits.t[h] < primaryT) { primaryT = hits.t[h]; primary = i; hp = h; }
        if (hits.corner[h] >= 0) flattenCorner(ctx, bi, h, i);
        // progress for the anti-loop counters: anything breakable, a weak point, and boss armour
        // while the ball is level with or inside the boss (isProgressHit); armour skated over
        // (the ball past the boss's top edge) is a dead bounce
        if (isProgressHit(ctx, b, i)) anyBreakable = true;
        if (canPass(ctx, b, i, pierceLeft)) {
          if (!fx.thru && !fx.mega) pierceLeft--;
          nPass++;
        } else allPass = false;
        sumx += hits.nx[h];
        sumy += hits.ny[h];
      }
      let nx = 0, ny = 0, ox = 0, oy = 0;
      if (!allPass) {
        // the normal to reflect off (relative to the primary brick's motion): the combined,
        // seam-flattened one; if that would not turn the ball, the true contact normals; then
        // the first contact's own
        if (primary >= 0 && B.flags[primary] & (BF.MOVING | BF.FALLING)) {
          ox = (B.x[primary] - B.px[primary]) / dt;
          oy = (B.y[primary] - B.py[primary]) / dt;
        }
        let l = Math.sqrt(sumx * sumx + sumy * sumy);
        if (l > 1e-6) {
          nx = sumx / l;
          ny = sumy / l;
        }
        if ((b.vx - ox) * nx + (b.vy - oy) * ny >= 0) {
          let rx = 0, ry = 0;
          for (let h = 0; h < hits.n; h++) {
            if (hits.idx[h] < 0) continue;
            rx += hits.rx[h];
            ry += hits.ry[h];
          }
          l = Math.sqrt(rx * rx + ry * ry);
          nx = l > 1e-6 ? rx / l : 0;
          ny = l > 1e-6 ? ry / l : 0;
          if ((b.vx - ox) * nx + (b.vy - oy) * ny >= 0) {
            nx = hits.rx[hp];
            ny = hits.ry[hp];
          }
        }
        if ((b.vx - ox) * nx + (b.vy - oy) * ny >= 0) {
          // nothing here can turn the ball (a contact it is already leaving): not a hit, not a
          // reflection, and these bricks are left alone for the rest of the step
          for (let h = 0; h < hits.n; h++) if (hits.idx[h] >= 0) skipBrick(ctx, hits.idx[h]);
          continue;
        }
      }
      const src = ballSrc(ctx);
      for (let h = 0; h < hits.n; h++) {
        const i = hits.idx[h];
        if (i < 0) continue;
        ctx.nX = hits.nx[h];
        ctx.nY = hits.ny[h];
        hitBrick(ctx, b, bi, i, src, allPass ? 1 : 0);
        if (allPass) addIgnore(ctx, bi, i);
      }
      if (anyBreakable) noteProgress(ctx, bi);
      if (allPass) {
        if (!fx.thru && !fx.mega) b.pierce = Math.max(0, b.pierce - nPass);
        continue;
      }
      ctx.nX = nx;
      ctx.nY = ny;
      ctx.oX = ox;
      ctx.oY = oy;
      bounceOff(ctx, b);
      speedTo(ctx, b, true);
      separate(ctx, b);
      clampFlat(mc, b);
      if (!anyBreakable) noteDeadBounce(ctx, bi, 100 + primary);
      refl++;
      continue;
    }

    // ---------------- other contacts
    const t = bestO;
    b.x += dx * t;
    b.y += dy * t;
    tau += rem * t;
    rem *= 1 - t;
    if (kind === K_WALL) {
      ctx.nX = onx;
      ctx.nY = ony;
      ctx.oX = 0;
      ctx.oY = 0;
      bounceOff(ctx, b);
      clampFlat(mc, b);
      emitEdge(ctx, b, EV.WALL_HIT, bi, side, 0, 0);
      noteDeadBounce(ctx, bi, side);
      refl++;
    } else if (kind === K_SHIELD) {
      ctx.nX = onx;
      ctx.nY = ony;
      ctx.oX = 0;
      ctx.oY = 0;
      bounceOff(ctx, b);
      clampFlat(mc, b);
      ctx.shieldUsed++;
      emitEdge(ctx, b, EV.SHIELD_USED, bi, 0, 0, 0);
      refl++;
    } else if (kind === K_SENTRY) {
      ctx.nX = onx;
      ctx.nY = ony;
      ctx.oX = sox;
      ctx.oY = soy;
      bounceOff(ctx, b);
      speedTo(ctx, b, true);
      separate(ctx, b);
      clampFlat(mc, b);
      emitEdge(ctx, b, EV.SENTRY_HIT, sid, bi, ballSrc(ctx), 0);
      noteProgress(ctx, bi);
      refl++;
    } else if (kind === K_PADDLE) {
      paddleDone = true;
      ctx.onPaddle(bi); // reads ctx.pad
      if (b.held) {
        rem = 0;
        break;
      }
      refl++;
    }
  }

  containWalls(ctx, b);
  depenetrate(ctx, bi);
  // the portal cooldown runs to an end time in sim ms (no drift); ball.portalCooldownMs shows what is left
  const left = ctx.portalEnd[bi] - w.time;
  b.portalCooldownMs = left > 1e-6 ? left : 0;
  if (b.portalCooldownMs === 0) portals(ctx, bi);
}

/**
 * A corner contact on a corner shared with a solid neighbour is really a face contact: replace
 * the corner normal with the exposed face's normal. A neighbour this ball is passing through (or
 * leaving alone this step) is not there for it, so the corner stays a corner.
 */
function flattenCorner(ctx, bi, h, i) {
  const w = ctx.world, B = w.bricks, hits = ctx.hits;
  const k = hits.corner[h];
  const sx = k & 1 ? 1 : -1, sy = k & 2 ? 1 : -1;
  const cx = B.x[i] + sx * B.w[i] / 2, cy = B.y[i] + sy * B.h[i] / 2;
  ctx.qx = cx + sx * 2;
  ctx.qy = cy - sy * 2;
  const nbX = neighbourAt(ctx, bi); // neighbour beside
  ctx.qx = cx - sx * 2;
  ctx.qy = cy + sy * 2;
  const nbY = neighbourAt(ctx, bi); // neighbour above/below
  if (nbX && !nbY) {
    hits.nx[h] = 0;
    hits.ny[h] = sy;
  } else if (nbY && !nbX) {
    hits.nx[h] = sx;
    hits.ny[h] = 0;
  }
}

/**
 * 1 if a solid brick that ball bi really meets (not one it passes through or skips this step)
 * contains the point (ctx.qx, ctx.qy), else 0. The point travels in ctx: no boxed arguments.
 */
function neighbourAt(ctx, bi) {
  const B = ctx.world.bricks, x = ctx.qx, y = ctx.qy, list = ctx.list2;
  const n = queryGrid(ctx.grid, x, y, x, y, list);
  for (let k = 0; k < n; k++) {
    const i = list[k];
    if (!(B.flags[i] & BF.SOLID)) continue;
    if (Math.abs(x - B.x[i]) >= B.w[i] / 2 || Math.abs(y - B.y[i]) >= B.h[i] / 2) continue;
    if (ignored(ctx, bi, i) || (ctx.skipN > 0 && skipped(ctx, i))) continue;
    return 1;
  }
  return 0;
}

/**
 * Teleport through a portal pair: the ball leaves the twin with the entry offset (limited so the
 * whole ball fits inside the twin cell, never overlapping the twin's neighbours) and the same
 * velocity. A ball bigger than the twin cell (Mega in a 30-tall cell) leaves on the twin's centre
 * line, shifted toward a side with room; if no side has room, the portal cannot take it and it
 * rolls on over the cell.
 */
function portals(ctx, bi) {
  const w = ctx.world, b = w.balls[bi], B = w.bricks;
  const n = queryGrid(ctx.grid, b.x, b.y, b.x, b.y, ctx.list2);
  for (let k = 0; k < n; k++) {
    const i = ctx.list2[k];
    if (!(B.flags[i] & BF.PORTAL)) continue;
    if (Math.abs(b.x - B.x[i]) > B.w[i] / 2 || Math.abs(b.y - B.y[i]) > B.h[i] / 2) continue;
    const j = B.link[i];
    if (j < 0 || !B.alive[j] || (B.flags[j] & BF.HIDDEN)) continue;
    let ox = b.x - B.x[i], oy = b.y - B.y[i];
    const mx = B.w[j] / 2 - b.r, my = B.h[j] / 2 - b.r;
    ox = mx <= 0 ? 0 : ox > mx ? mx : ox < -mx ? -mx : ox;
    oy = my <= 0 ? 0 : oy > my ? my : oy < -my ? -my : oy;
    const x0 = b.x, y0 = b.y;
    b.x = B.x[j] + ox;
    b.y = B.y[j] + oy;
    if ((mx < 0 || my < 0) && !clearOfBricks(ctx, b)) {
      let ok = false;
      for (let s = 0; s < 4 && !ok; s++) {
        const sx = s === 0 ? 1 : s === 1 ? -1 : 0, sy = s === 2 ? 1 : s === 3 ? -1 : 0;
        if ((sx !== 0 && mx >= 0) || (sy !== 0 && my >= 0)) continue;
        b.x = B.x[j] + ox + sx * (0.01 - mx);
        b.y = B.y[j] + oy + sy * (0.01 - my);
        ok = clearOfBricks(ctx, b) === 1;
      }
      if (!ok) {
        b.x = x0;
        b.y = y0;
        continue;
      }
    }
    b.px = b.x;
    b.py = b.y;
    ctx.portalEnd[bi] = w.time + PORTAL_COOLDOWN_MS;
    b.portalCooldownMs = PORTAL_COOLDOWN_MS;
    if (ctx.portalTrips[bi] < 255) ctx.portalTrips[bi]++; // anti-loop: trips with nothing broken

    emit(w.bus, EV.PORTAL, bi, b.x, b.y, i, j);
    return;
  }
}

/** 1 if ball b overlaps no solid brick where it stands (ctx.list as scratch), else 0. */
function clearOfBricks(ctx, b) {
  const B = ctx.world.bricks, list = ctx.list;
  const n = queryGrid(ctx.grid, b.x - b.r, b.y - b.r, b.x + b.r, b.y + b.r, list);
  for (let k = 0; k < n; k++) {
    const i = list[k];
    if (!(B.flags[i] & BF.SOLID)) continue;
    if (overlapBallBrick(b, 0, B, i, ctx.hit) && CQ.t > 0.01) return 0;
  }
  return 1;
}

/** Has this ball left play? */
export function ballLost(ctx, b) {
  // isLost written out: no numbers passed across a call
  const mc = ctx.mc;
  if (mc === M_LEFT) return b.x < -b.r;
  if (mc === M_RING) {
    const dx = b.x - RING.CX, dy = b.y - RING.CY;
    return dx * dx + dy * dy > RING.R_LOSS * RING.R_LOSS;
  }
  return b.y > FIELD.H + b.r;
}
