// Shared pickup footprint. Composition writes stable view facts at layout, never in a sim step.
export const DETAIL = Object.freeze({
  PHONE_EDGE: 600, DROP_HALF_U: 24, DROP_HALF_V: 11, EMBER_R: 3,
  DROP_HALF_U_PX: 22, DROP_HALF_V_PX: 18, DROP_GLYPH_PX: 24, EMBER_DIAMETER_PX: 6,
});

export function createReadability() {
  return { small: false, width: 0, height: 0, scale: 1,
    dropHalfU: DETAIL.DROP_HALF_U, dropHalfV: DETAIL.DROP_HALF_V, emberR: DETAIL.EMBER_R };
}

/** Scale is conservative CSS pixels per field unit in the resting camera, independent of DPR. */
export function updateReadability(width, height, scale, out) {
  out.width = Math.max(1, width || 1); out.height = Math.max(1, height || 1);
  out.small = Math.min(out.width, out.height) <= DETAIL.PHONE_EDGE;
  out.scale = Math.max(0.1, Number.isFinite(scale) ? scale : 1);
  out.dropHalfU = out.small ? Math.max(DETAIL.DROP_HALF_U, DETAIL.DROP_HALF_U_PX / out.scale) : DETAIL.DROP_HALF_U;
  out.dropHalfV = out.small ? Math.max(DETAIL.DROP_HALF_V, DETAIL.DROP_HALF_V_PX / out.scale) : DETAIL.DROP_HALF_V;
  out.emberR = out.small ? Math.max(DETAIL.EMBER_R, DETAIL.EMBER_DIAMETER_PX / 2 / out.scale) : DETAIL.EMBER_R;
  return out;
}

/** Capsules follow their catch frame; upright glyphs are posed separately. */
export function dropRotation(mode, x, y) {
  return mode === 'left' ? -Math.PI / 2 : mode === 'ring' ? Math.PI / 2 - Math.atan2(y - 540, x - 360) : 0;
}
