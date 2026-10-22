// Test helpers for the ceiling (PLAN 11, 2026-10-22): the per-step invariants a-clearable and
// a-ceiling check while the robot plays.
import { BF } from '../../../src/core/constants.js';

export const CEIL_TOL = 0.01;

/**
 * Levels whose bricks still cross the ceiling line while they move, with the reason. Each is a
 * Request to B in K/status/A2.md; drop the entry once B's change lands (the check then holds).
 */
export const CUT_PENDING = Object.freeze({
  // empty since B's 932d7b8 (2026-10-22): The Flue's rows join play at y 150, under its ceiling (y 90)
});

/**
 * The first ceiling problem in this world right now, or '': world.field changed since the start
 * (ceil0, far0), a ball is past the ceiling or far wall, a brick in play or a sentry is cut by it.
 * Ring levels have no ceiling.
 * @param {import('../../../src/core/types.js').World} w
 */
export function ceilingProblem(w, ceil0, far0) {
  const F = w.field, mode = w.level.mode;
  if (F.ceilingY !== ceil0 || F.farX !== far0) return `step ${w.step}: world.field changed during the level`;
  if (mode === 'ring') return '';
  const bottom = mode === 'bottom';
  for (let bi = 0; bi < w.balls.length; bi++) {
    const b = w.balls[bi];
    if (!b.alive) continue;
    if (bottom ? b.y < F.ceilingY + b.r - CEIL_TOL : b.x > F.farX - b.r + CEIL_TOL) {
      return `step ${w.step}: ball ${bi} at (${b.x.toFixed(2)}, ${b.y.toFixed(2)}) is past the ceiling`;
    }
  }
  const B = w.bricks;
  if (!CUT_PENDING[w.level.def.id]) {
    for (let i = 0; i < B.count; i++) {
      if (!B.alive[i] || (B.flags[i] & BF.HIDDEN)) continue;
      if (bottom ? B.y[i] - B.h[i] / 2 < F.ceilingY - CEIL_TOL : B.x[i] + B.w[i] / 2 > F.farX + CEIL_TOL) {
        return `step ${w.step}: brick ${i} at (${B.x[i].toFixed(1)}, ${B.y[i].toFixed(1)}) is cut by the ceiling`;
      }
    }
  }
  for (const s of w.sentries) {
    if (!s.alive) continue;
    if (bottom ? s.y - s.r < F.ceilingY - CEIL_TOL : s.x + s.r > F.farX + CEIL_TOL) {
      return `step ${w.step}: a sentry at (${s.x.toFixed(1)}, ${s.y.toFixed(1)}) is past the ceiling`;
    }
  }
  return '';
}
