// Kiln: the ceiling (OWNER: A). PLAN.md 11 (2026-10-22), ART.md 12a.1.
//
// Every bottom-mode level gets a top wall CEILING.GAP (120) units above its highest brick, and
// every left-mode level a far wall 120 units past its farthest brick column, judged once at level
// start. Ring levels have none. The headroom painting stays above the ceiling, behind glass; the
// ball, lasers and the robot's casts never go there.
//
//   bottom: top = highest top edge of any brick in play at the start (boss parts that turn about
//           the boss centre count with their whole turn)
//           gap = 120, or MIN_CLEAR 60 when there is nothing up there to reach (topBandUseful)
//           c = max(TOP_MIN 90, top - gap); if that leaves less than MIN_CLEAR 60, c = max(0, top - 60)
//           (clear space wins over the y 90 limit); then bricks that come into play later
//           (march-down feed rows, scrolled rows) keep MIN_CLEAR 60 above the line where they
//           enter: c = min(c, max(0, entry - 60)), so the ball can still get behind them
//           (world.level.entryY when B sets it, else where they enter today)
//   left:   far = farthest right edge (same rules); farX = min(FIELD.W, far + gap)
//
// "Nothing up there to reach": the clear space above the wall is for break-throughs (a ball over
// the top breaking bricks from above) and for getting round a turning boss to its opening. When
// no brick in the wall's top band (within GAP of its top, or of its far edge in left mode) can be
// broken or scored on and no boss part turns, a ball over the top only skates between the
// ceiling and armour (The Stoker), so the wall gets the minimum clear space instead.
//
// Moving rows slide along the paddle's track and falling bricks fall away from the ceiling, so
// neither changes the reach. physics.init writes world.field once; nothing here runs per step.

import { FIELD, BF, CEILING, GRID } from '../core/constants.js';
import { M_BOTTOM, M_LEFT, modeCode } from './field.js';

/**
 * Farthest reach of the bricks in play now (not HIDDEN): out.top = highest top edge (smallest y),
 * out.far = farthest right edge, out.n = bricks counted, out.turning = boss bricks that turn.
 * Boss bricks that are MOVING turn about the boss centre (The Crucible, The Core), so they count
 * with the whole circle they sweep.
 * @param {import('../core/types.js').World} world
 * @param {{top:number, far:number, n:number, turning:number}} out
 */
export function brickReach(world, out) {
  const B = world.bricks, boss = world.boss;
  let top = Infinity, far = -Infinity, n = 0, turning = 0;
  for (let i = 0; i < B.count; i++) {
    if (!B.alive[i]) continue;
    const f = B.flags[i];
    if (f & BF.HIDDEN) continue;
    n++;
    const hw = B.w[i] / 2, hh = B.h[i] / 2;
    let t = B.y[i] - hh, r = B.x[i] + hw;
    if (boss.active && (f & BF.BOSS) && (f & BF.MOVING)) {
      turning++;
      const d = Math.hypot(B.x[i] - boss.x, B.y[i] - boss.y);
      if (boss.y - d - hh < t) t = boss.y - d - hh;
      if (boss.x + d + hw > r) r = boss.x + d + hw;
    }
    if (t < top) top = t;
    if (r > far) far = r;
  }
  out.top = top;
  out.far = far;
  out.n = n;
  out.turning = turning;
  return out;
}

/**
 * Is there anything to reach over the top of the wall? True when a boss part turns, or when a
 * brick in play whose top edge lies within CEILING.GAP of the wall's top (bottom mode; its far
 * edge within GAP of the far edge in left mode) can be broken (BREAKABLE) or scored on (WEAK).
 * @param {import('../core/types.js').World} world
 * @param {number} mc mode code (M_BOTTOM or M_LEFT)
 * @param {{top:number, far:number, turning:number}} reach from brickReach
 */
export function topBandUseful(world, mc, reach) {
  if (reach.turning > 0) return true;
  const B = world.bricks;
  for (let i = 0; i < B.count; i++) {
    if (!B.alive[i]) continue;
    const f = B.flags[i];
    if (f & BF.HIDDEN || !(f & (BF.BREAKABLE | BF.WEAK))) continue;
    if (mc === M_BOTTOM) {
      if (B.y[i] - B.h[i] / 2 < reach.top + CEILING.GAP) return true;
    } else if (B.x[i] + B.w[i] / 2 > reach.far - CEILING.GAP) return true;
  }
  return false;
}

/**
 * Bottom mode: the top edge of the line where bricks come into play during the level (Infinity
 * when none do). B may set world.level.entryY; otherwise a march-down feed enters on grid row 0
 * and a scrolling wall is revealed at the field top, which is what the content does today.
 * @param {import('../core/types.js').World} world
 */
export function entryLine(world) {
  const lv = world.level;
  if (Number.isFinite(lv.entryY)) return lv.entryY;
  const r = lv.rules;
  let e = Infinity;
  if (r.marchMs > 0) {
    const feed = Number.isFinite(r.marchFeed) ? r.marchFeed : (r.marchRows ? r.marchRows.length : 0);
    if (feed > 0) e = GRID.bottom.y0;
  }
  if (r.scrollSpeed > 0 && e > 0) e = 0;
  return e;
}

const R = { top: 0, far: 0, n: 0, turning: 0 };

/**
 * Work out world.field (ceilingY, farX, clear, gap) from the level's starting state. Whole units:
 * the reach is rounded outward first, so the clear space is exact.
 * @param {import('../core/types.js').World} world
 * @returns {import('../core/types.js').PlayField}
 */
export function computeField(world) {
  const F = world.field, mc = modeCode(world.level.mode);
  F.ceilingY = 0;
  F.farX = FIELD.W;
  F.clear = 0;
  F.gap = 0;
  if (mc !== M_BOTTOM && mc !== M_LEFT) return F;
  brickReach(world, R);
  if (R.n === 0) return F;
  const gap = topBandUseful(world, mc, R) ? CEILING.GAP : CEILING.MIN_CLEAR;
  F.gap = gap;
  if (mc === M_BOTTOM) {
    const top = Math.floor(R.top);
    let c = Math.max(CEILING.TOP_MIN, top - gap);
    if (top - c < CEILING.MIN_CLEAR) c = Math.max(0, top - CEILING.MIN_CLEAR);
    const e = entryLine(world);
    if (Number.isFinite(e)) {
      const ce = Math.max(0, Math.floor(e) - CEILING.MIN_CLEAR);
      if (c > ce) c = ce;
    }
    F.ceilingY = c;
    F.clear = top - c;
  } else {
    const far = Math.ceil(R.far);
    F.farX = Math.min(FIELD.W, far + gap);
    F.clear = F.farX - far;
  }
  return F;
}
