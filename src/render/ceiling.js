// The physical ceiling and the camera's decorative band share one field-space contract.
// Pure maths: the renderer never derives a collision wall from the surviving bricks.
import { FIELD } from '../core/constants.js';

export const CEILING_ART = Object.freeze({ BAND: 150, BAR: 8, DEPTH: 24, GLINT_S: 0.22 });

/** Reuse `out` across levels. Bar coordinates describe its inner (collision) edge. */
export function ceilingLayout(mode, field, out = {}) {
  const bottom = mode === 'bottom' && Number.isFinite(field?.ceilingY) && field.ceilingY > 0;
  const left = mode === 'left' && Number.isFinite(field?.farX) && field.farX > 0;
  out.active = bottom || left;
  out.vertical = left;
  out.edge = bottom ? field.ceilingY : left ? field.farX : 0;
  out.x0 = 0;
  out.y0 = bottom ? Math.max(0, out.edge - CEILING_ART.BAND) : 0;
  out.x1 = left ? Math.min(FIELD.W, out.edge + CEILING_ART.BAND) : FIELD.W;
  out.y1 = FIELD.H;
  out.barX = left ? out.edge + CEILING_ART.BAR / 2 : FIELD.W / 2;
  out.barY = bottom ? out.edge - CEILING_ART.BAR / 2 : FIELD.H / 2;
  out.barLength = left ? FIELD.H + 24 : FIELD.W + 24;
  out.paneX = left ? (out.edge + FIELD.W) / 2 : FIELD.W / 2;
  out.paneY = bottom ? out.edge / 2 : FIELD.H / 2;
  out.paneW = left ? Math.max(0, FIELD.W - out.edge) : FIELD.W + 24;
  out.paneH = bottom ? out.edge : FIELD.H + 24;
  return out;
}

/** Event wall IDs are simulation-owned: 2 is top, 1 is right. Ring has no ceiling. */
export function isCeilingHit(layout, wall) {
  return layout.active && wall === (layout.vertical ? 1 : 2);
}
