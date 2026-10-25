// The physical ceiling and the camera's decorative band share one field-space contract.
// Pure maths: the renderer never derives a collision wall from the surviving bricks.
import { FIELD } from '../core/constants.js';

export const CEILING_ART = Object.freeze({
  BAND: 150, BAR: 14, DEPTH: 28, RAIL: 4, SEGMENT: 144, JOINT: 2, SHADE: 56, HIT_S: 0.22,
});

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
  out.segments = Math.ceil(out.barLength / CEILING_ART.SEGMENT);
  out.segmentPitch = out.barLength / out.segments;
  // The glass outline only surrounds play. Its 12-unit overlap disappears into the lintel.
  out.wallW = (left ? out.edge : FIELD.W) + 24;
  out.wallH = FIELD.H - (bottom ? out.edge : 0) + 24;
  out.wallX = (left ? out.edge : FIELD.W) / 2;
  out.wallY = ((bottom ? out.edge : 0) + FIELD.H) / 2;
  return out;
}

/** Local lintel coordinates, with positive y away from play. Index zero is its continuous rail. */
export function lintelPiece(layout, index, out = {}) {
  const rail = index === 0;
  out.x = rail ? 0 : -layout.barLength / 2 + (index - 0.5) * layout.segmentPitch;
  out.y = rail ? -(CEILING_ART.BAR - CEILING_ART.RAIL) / 2 : CEILING_ART.RAIL / 2;
  out.w = rail ? layout.barLength : layout.segmentPitch - CEILING_ART.JOINT;
  out.h = rail ? CEILING_ART.RAIL : CEILING_ART.BAR - CEILING_ART.RAIL;
  out.d = rail ? CEILING_ART.DEPTH * 0.85 : CEILING_ART.DEPTH;
  return out;
}

/** Bounded contact light; the same mesh stays allocated at rest and after expiry. */
export function ceilingContact(layout, at, age, out = {}) {
  const active = layout.active && age >= 0 && age < 1;
  out.length = 14 + 34 * Math.max(0, Math.min(1, age));
  const extent = layout.vertical ? FIELD.H : FIELD.W;
  out.at = Math.max(out.length / 2, Math.min(extent - out.length / 2, at)) - extent / 2;
  out.alpha = active ? 0.8 * (1 - age) * (1 - age) : 0;
  return out;
}

/** Event wall IDs are simulation-owned: 2 is top, 1 is right. Ring has no ceiling. */
export function isCeilingHit(layout, wall) {
  return layout.active && wall === (layout.vertical ? 1 : 2);
}
