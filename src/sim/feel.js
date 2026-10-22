// Kiln: fairness and ceremony (OWNER: A): anti-loop nudges, the last-brick slow-mo, the near
// miss, the top-speed slow-time, and the aim line. Runs in physics.post, after content and economy
// settled the step.
//
// Slow-mo never changes the step: it sets world.timeScale, which main.js feeds to its
// accumulator. Every slow-mo has an end time in sim ms; timeScale always comes back to 1.

import { FIELD, ANTILOOP, SLOWMO, BF, RING, PADDLE, HORIZONTAL, PHYS, SPEED } from '../core/constants.js';
import { EV } from '../core/events.js';
import { emit } from '../core/bus.js';
import { setPhase } from '../core/world.js';
import { clampFlat } from './ball.js';
import { BOUNCE, bounceCore, velNormOf } from './paddle.js';
import { M_LEFT, M_RING, RING_FACE, paddleTrack, halfReach, angleDiff } from './field.js';

const DEG = Math.PI / 180;
/** Ceremony length in sim ms: 600 ms real at 25% = 150 ms of sim time. */
export const CEREMONY_SIM_MS = SLOWMO.LAST_REAL_MS * SLOWMO.LAST_SCALE;
export const NEAR_MISS_SIM_MS = SLOWMO.NEAR_MISS_REAL_MS * SLOWMO.NEAR_MISS_SCALE;
/** Top-speed slow-time: 80 ms real at half speed = the ball's last 40 sim ms before the paddle line. */
export const TOP_SLOW_SIM_MS = PHYS.TOP_SLOW_REAL_MS * PHYS.TOP_SLOW_SCALE;
const TOP_SLOW_LEAD_S = TOP_SLOW_SIM_MS / 1000;
const TOP_SLOW_REARM_S = 2 * TOP_SLOW_LEAD_S;
/** A ball at least this fast (u/s) is a top-speed ball (the top tier, or the cap by Fast). */
const TOP_SPEED = SPEED.TIERS[SPEED.TIERS.length - 1] - 0.5;
/** A near miss re-arms once the ball is this far from the last brick again. */
const NEAR_REARM = 30;
/** A ball counts as "just broke the last brick" for this long (timer ends do not get the ceremony). */
const RECENT_BREAK_MS = 500;
/** Anti-loop watches balls only while at most this many are in play. */
const MULTI_FREE = 2;
/** Paddle face lines: bottom mode y, left mode x. */
const FACE_BOTTOM = PADDLE.Y - PADDLE.H / 2;
const FACE_LEFT = HORIZONTAL.PADDLE_X + PADDLE.H / 2;

// ------------------------------------------------------------------ anti-loop

/** Set ball b's velocity to (vx, vy) turned by `deg` degrees. */
function turnFrom(b, vx, vy, deg) {
  const a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
  b.vx = vx * c - vy * s;
  b.vy = vx * s + vy * c;
}

/**
 * Rotate a ball's velocity by `deg` degrees and keep it off the flat. If the 12 degree clamp would
 * eat the turn (a looping ball is often pinned at exactly 12 degrees from the paddle track), the
 * ball turns the same amount the other way instead, so every nudge really turns it. Answers the
 * turn applied.
 */
export function rotate(mc, b, deg) {
  const vx = b.vx, vy = b.vy;
  turnFrom(b, vx, vy, deg);
  const rx = b.vx, ry = b.vy;
  clampFlat(mc, b);
  if (b.vx === rx && b.vy === ry) return deg;
  turnFrom(b, vx, vy, -deg);
  clampFlat(mc, b);
  return -deg;
}

/**
 * The turn of `deg` degrees (its size kept, its sign chosen) that brings a ball nearer the
 * diagonal of bottom / left mode (45 degrees off the paddle track). A ball that loops with nothing
 * broken is pinned near one extreme: skating flat between two faces, or rattling almost straight
 * up and down in a narrow band (over The Stoker's head under the ceiling), and a random turn walks
 * it back and forth there for seconds. Ring mode, and a ball already on the diagonal, keep `deg`.
 */
function towardDiagonal(mc, b, deg) {
  if (mc === M_RING) return deg;
  const a = Math.abs(deg) * DEG, c = Math.cos(a), s = Math.sin(a);
  const vx = b.vx, vy = b.vy;
  const px = vx * c - vy * s, py = vx * s + vy * c;   // turned by +|deg|
  const nx = vx * c + vy * s, ny = -vx * s + vy * c;  // turned by -|deg|
  const dp = Math.abs(Math.abs(px) - Math.abs(py)), dn = Math.abs(Math.abs(nx) - Math.abs(ny));
  if (dp === dn) return deg;
  return dp < dn ? Math.abs(deg) : -Math.abs(deg);
}

/**
 * Nudge a ball 4 to 7 degrees (seeded) and report why. A nudge for bounces with nothing broken or
 * a repeated pattern turns the ball toward the diagonal (towardDiagonal); the others keep the
 * seeded direction.
 * @param {number} reason 0 bounces with no brick, 1 repeated pattern, 2 away too long,
 *   3 portal trips with nothing broken
 */
export function nudge(ctx, bi, reason) {
  const w = ctx.world, b = w.balls[bi], rng = w.rng.physics;
  let deg = rng.sign() * rng.range(ANTILOOP.NUDGE_MIN_DEG, ANTILOOP.NUDGE_MAX_DEG);
  if (reason === 0 || reason === 1) deg = towardDiagonal(ctx.mc, b, deg);
  deg = rotate(ctx.mc, b, deg);
  w.stats.nudges++;
  b.bouncesNoBrick = 0;
  ctx.sigN[bi] = 0;
  ctx.portalTrips[bi] = 0;
  ctx.progressMs[bi] = w.time;
  emit(w.bus, EV.NUDGE, bi, b.x, b.y, deg, reason);
}

/**
 * Check every free ball for the three loop signs. With three or more balls in play the bounce
 * count and pattern rules rest (a crowd of balls clearing a field is busy, and a nudge there is
 * noise), but the 12 s rule still watches each ball: one ball that has met neither the paddle nor
 * anything breakable for 12 s is stuck whatever the others do.
 */
export function antiLoop(ctx) {
  const w = ctx.world;
  let free = 0;
  for (let bi = 0; bi < w.balls.length; bi++) if (w.balls[bi].alive && !w.balls[bi].held) free++;
  const crowd = free > MULTI_FREE;
  for (let bi = 0; bi < w.balls.length; bi++) {
    const b = w.balls[bi];
    if (!b.alive || b.held) continue;
    if (crowd) {
      b.bouncesNoBrick = 0;
      ctx.sigN[bi] = 0;
      ctx.portalTrips[bi] = 0;
      if (w.time - ctx.progressMs[bi] > ANTILOOP.AWAY_MS) nudge(ctx, bi, 2);
      continue;
    }
    if (b.bouncesNoBrick >= ANTILOOP.BOUNCES_NO_BRICK) {
      nudge(ctx, bi, 0);
      continue;
    }
    // paddle -> portal -> ... -> paddle with nothing broken: a paddle contact clears the other
    // counters, so portal trips are counted until something breakable is hit (B's request)
    if (ctx.portalTrips[bi] >= PHYS.PORTAL_TRIPS) {
      nudge(ctx, bi, 3);
      continue;
    }
    const n = ctx.sigN[bi];
    const L = ANTILOOP.PATTERN_LEN;
    if (n >= 2 * L) {
      const base = bi * 8 + n - 2 * L;
      let same = true;
      for (let k = 0; k < L; k++) {
        if (ctx.sig[base + k] !== ctx.sig[base + L + k]) { same = false; break; }
      }
      if (same) {
        nudge(ctx, bi, 1);
        continue;
      }
    }
    if (w.time - ctx.progressMs[bi] > ANTILOOP.AWAY_MS) nudge(ctx, bi, 2);
  }
}

// ------------------------------------------------------------------ slow-mo, ceremony, near miss

/** Start a slow-mo for `simMs` of sim time at `scale` (the longer of overlapping ones wins). */
export function slowmo(ctx, simMs, scale) {
  const w = ctx.world;
  const end = w.time + simMs;
  if (end > ctx.slowUntil) ctx.slowUntil = end;
  w.timeScale = Math.min(w.timeScale, scale);
}

/**
 * PLAN §1 fix 4 ("too fast"): as a ball flying at top speed comes within TOP_SLOW_SIM_MS of the
 * paddle line, time runs at PHYS.TOP_SLOW_SCALE for PHYS.TOP_SLOW_REAL_MS of real time, so the
 * slow-time ends as the ball arrives. Once per approach: it re-arms when the ball heads away again
 * (a paddle hit) or is more than twice that far off.
 */
export function topSlow(ctx) {
  const w = ctx.world;
  for (let bi = 0; bi < w.balls.length; bi++) {
    const b = w.balls[bi];
    if (!b.alive || b.held) continue;
    if (!predictCrossing(ctx.mc, b, ctx.cross) || ctx.cross.t > TOP_SLOW_REARM_S) {
      ctx.topArmed[bi] = 1;
      continue;
    }
    if (!ctx.topArmed[bi] || ctx.cross.t > TOP_SLOW_LEAD_S) continue;
    if (b.vx * b.vx + b.vy * b.vy < TOP_SPEED * TOP_SPEED) continue;
    ctx.topArmed[bi] = 0;
    slowmo(ctx, TOP_SLOW_SIM_MS, PHYS.TOP_SLOW_SCALE);
  }
}

/** End slow-mo whose time is up. */
export function tickSlowmo(ctx) {
  const w = ctx.world;
  if (w.timeScale !== 1 && w.time >= ctx.slowUntil) {
    w.timeScale = 1;
    ctx.slowUntil = 0;
  }
}

/** Reset presentation hints (serve, phase end). */
export function resetFx(ctx) {
  const w = ctx.world;
  w.timeScale = 1;
  ctx.slowUntil = 0;
  w.fx.zoom = 1;
  w.fx.zoomX = FIELD.W / 2;
  w.fx.zoomY = FIELD.H / 2;
}

/** Ball to focus the ceremony on: the one that broke the last brick, else any live ball. */
function focusBall(ctx) {
  const w = ctx.world;
  const k = ctx.lastBreakBall;
  if (k >= 0 && k < w.balls.length && w.balls[k].alive) return w.balls[k];
  for (let i = 0; i < w.balls.length; i++) if (w.balls[i].alive) return w.balls[i];
  return null;
}

/**
 * Phase changes: play -> clearing (ceremony) -> cleared when level.remaining reaches 0.
 * Timed levels whose clock ran out go straight to cleared.
 */
export function levelEnd(ctx) {
  const w = ctx.world;
  const ph = w.phase;
  if ((ph === 'play' || ph === 'serve') && w.level.remaining <= 0) {
    const recent = w.time - ctx.lastBreakMs <= RECENT_BREAK_MS;
    if (!recent) {
      resetFx(ctx);
      setPhase(w, 'cleared');
      return;
    }
    emit(w.bus, EV.LAST_BRICK, 0, ctx.lastBreakX, ctx.lastBreakY);
    setPhase(w, 'clearing');
    ctx.ceremonyEnd = w.time + CEREMONY_SIM_MS;
    ctx.slowUntil = ctx.ceremonyEnd;
    w.timeScale = SLOWMO.LAST_SCALE;
    w.fx.zoom = SLOWMO.LAST_ZOOM;
    const b = focusBall(ctx);
    w.fx.zoomX = b ? b.x : ctx.lastBreakX;
    w.fx.zoomY = b ? b.y : ctx.lastBreakY;
    w.fx.aim = false;
    return;
  }
  if (ph === 'clearing') {
    const b = focusBall(ctx);
    if (b) {
      w.fx.zoomX = b.x;
      w.fx.zoomY = b.y;
    }
    if (w.time >= ctx.ceremonyEnd) {
      resetFx(ctx);
      setPhase(w, 'cleared');
    }
  }
}

/** Index of the single remaining clearable brick, or -1. Cached until it breaks. */
function lastBrick(ctx) {
  const w = ctx.world, B = w.bricks;
  const i = ctx.lastIdx;
  if (i >= 0 && B.alive[i] && (B.flags[i] & BF.CLEARABLE) && !(B.flags[i] & BF.HIDDEN)) return i;
  ctx.lastIdx = -1;
  for (let k = 0; k < B.count; k++) {
    if (B.alive[k] && (B.flags[k] & BF.CLEARABLE) && !(B.flags[k] & BF.HIDDEN)) {
      ctx.lastIdx = k;
      return k;
    }
  }
  return -1;
}

/** Near miss on the last brick: a ball passes within 12 units without touching it. */
export function nearMiss(ctx) {
  const w = ctx.world;
  if (w.phase !== 'play' || w.level.remaining !== 1 || w.level.kind === 'boss') {
    ctx.nearGap.fill(1e9);
    return;
  }
  const i = lastBrick(ctx);
  if (i < 0) return;
  const B = w.bricks;
  for (let bi = 0; bi < w.balls.length; bi++) {
    const b = w.balls[bi];
    if (!b.alive || b.held) { ctx.nearGap[bi] = 1e9; continue; }
    // pointRectDistance written out (a call that is not inlined boxes its numbers)
    let fx = Math.abs(b.x - B.x[i]) - B.w[i] / 2, fy = Math.abs(b.y - B.y[i]) - B.h[i] / 2;
    if (fx < 0) fx = 0;
    if (fy < 0) fy = 0;
    const gap = Math.sqrt(fx * fx + fy * fy) - b.r;
    const prev = ctx.nearGap[bi];
    if (gap > NEAR_REARM) ctx.nearArmed[bi] = 1;
    // the closest approach just passed, it was close, it did not touch
    if (ctx.nearArmed[bi] && gap > prev && prev <= SLOWMO.NEAR_MISS_DIST && prev > 0.5) {
      ctx.nearArmed[bi] = 0;
      emit(w.bus, EV.NEAR_MISS, bi, b.x, b.y, prev);
      slowmo(ctx, NEAR_MISS_SIM_MS, SLOWMO.NEAR_MISS_SCALE);
    }
    ctx.nearGap[bi] = gap;
  }
}

// ------------------------------------------------------------------ aim line

/**
 * Where a ball moving toward the paddle will cross the paddle face, folding wall bounces
 * (bricks ignored: the line only shows once the ball is on its way down). Writes ctx.cross
 * {s: track coordinate at the face, t: seconds, x, y}. Returns false if it is not coming.
 */
export function predictCrossing(mc, b, out) {
  const r = b.r;
  if (mc === M_RING) {
    const mx = b.x - RING.CX, my = b.y - RING.CY;
    const a = b.vx * b.vx + b.vy * b.vy;
    if (a <= 0) return false;
    const R = RING_FACE - r;
    const bb = mx * b.vx + my * b.vy;
    const c = mx * mx + my * my - R * R;
    if (c >= 0 && bb >= 0) {
      out.t = 0;
    } else {
      const disc = bb * bb - a * c;
      if (disc < 0) return false;
      out.t = (-bb + Math.sqrt(disc)) / a;
    }
    const hx = mx + b.vx * out.t, hy = my + b.vy * out.t;
    out.s = Math.atan2(hy, hx);
    out.x = RING.CX + Math.cos(out.s) * RING_FACE;
    out.y = RING.CY + Math.sin(out.s) * RING_FACE;
    return true;
  }
  // bottom / left: the ball's track coordinate folds between the two side walls
  let along, across, vAlong, vAcross, lo, hi;
  if (mc === M_LEFT) {
    along = b.y; vAlong = b.vy; lo = r; hi = FIELD.H - r;
    across = b.x - (FACE_LEFT + r); vAcross = -b.vx;
  } else {
    along = b.x; vAlong = b.vx; lo = r; hi = FIELD.W - r;
    across = (FACE_BOTTOM - r) - b.y; vAcross = b.vy;
  }
  if (vAcross <= 0) return false;
  const t = Math.max(0, across) / vAcross;
  const span = hi - lo;
  let u = along - lo + vAlong * t;
  const period = 2 * span;
  u = ((u % period) + period) % period;
  if (u > span) u = period - u;
  out.t = t;
  out.s = lo + u;
  if (mc === M_LEFT) {
    out.x = FACE_LEFT;
    out.y = out.s;
  } else {
    out.x = out.s;
    out.y = FACE_BOTTOM;
  }
  return true;
}

/**
 * fx.aim*: when the last bricks are up (rules.aimAt) or the Sniper ball is in play, show the
 * line the next ball will leave the paddle along, from where it will meet the paddle.
 */
export function aimLine(ctx) {
  const w = ctx.world, fx = w.fx, p = w.paddle, mc = ctx.mc;
  const want = (ctx.lastBricks || w.effects.aimLine || w.effects.ballKind === 3) &&
    (w.phase === 'play' || w.phase === 'serve');
  if (!want) {
    fx.aim = false;
    return;
  }
  const cur = (mc === M_LEFT ? p.y : mc === M_RING ? p.angle : p.x); // paddleTrack, written out (no boxed result)
  const reach = halfReach(mc, p);
  const scale = mc === M_RING ? RING_FACE : 1;
  // a held ball: its launch line
  let best = -1, bestT = Infinity;
  for (let i = 0; i < w.balls.length; i++) {
    const b = w.balls[i];
    if (!b.alive) continue;
    if (b.held) { best = i; bestT = -1; break; }
    if (predictCrossing(mc, b, ctx.cross) && ctx.cross.t < bestT) {
      best = i;
      bestT = ctx.cross.t;
    }
  }
  if (best < 0) {
    fx.aim = false;
    return;
  }
  const b = w.balls[best];
  let off, cx, cy;
  if (b.held) {
    off = reach > 0 ? b.holdOffset / reach : 0;
    cx = b.x;
    cy = b.y;
  } else {
    predictCrossing(mc, b, ctx.cross);
    const ds = (mc === M_RING ? angleDiff(ctx.cross.s, cur) : ctx.cross.s - cur) * scale;
    if (Math.abs(ds) > reach + b.r) {
      fx.aim = false;
      return;
    }
    off = Math.max(-1, Math.min(1, ds / reach));
    cx = ctx.cross.x;
    cy = ctx.cross.y;
  }
  BOUNCE.cx = cx;
  BOUNCE.cy = cy;
  BOUNCE.off = off;
  BOUNCE.vel = velNormOf(p);
  bounceCore(mc, ctx.p1, ctx.p2, ctx.p3);
  fx.aim = true;
  fx.aimX = cx;
  fx.aimY = cy;
  fx.aimDX = ctx.p3.x;
  fx.aimDY = ctx.p3.y;
}
