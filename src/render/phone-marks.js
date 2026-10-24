// Phone brick information uses field-space geometry sized from the stable rest-view scale.
// Pure helpers keep dense hit encoding and atlas ink bounds testable without a canvas or WebGL.
export const PHONE_MARKS = Object.freeze({ CAP_PX: 12.2, ROW_GAP_PX: 1.3, STROKE_PX: 1.25,
  HIT_STROKE_PX: 3.05, HIT_GAP_PX: 0.8 });

/** Fill reusable layout facts. Upright marks use the brick's actual field width and height. */
export function phoneMarkLayout(info, width, height, out) {
  const scale = Math.max(0.05, Number(info?.scale) || 1);
  out.small = !!info?.small;
  out.scale = scale;
  out.innerW = Math.max(8, width - 4);
  out.innerH = Math.max(8, height - 4);
  out.digits = !out.small || height * scale >= PHONE_MARKS.CAP_PX + PHONE_MARKS.ROW_GAP_PX;
  out.glyphH = out.small ? PHONE_MARKS.CAP_PX / scale : 15;
  out.stroke = out.small ? PHONE_MARKS.STROKE_PX / scale : 1;
  out.icon = out.small ? Math.min(12 / scale, out.innerW, out.innerH) : 18;
  return out;
}

/** Fixed channels do not move as HP falls. A numeral is the explicit no-fit fallback. */
export function hitLineLayout(info, width, height, maxHits, out) {
  const small = !!info?.small, scale = Math.max(0.05, Number(info?.scale) || 1);
  const count = Math.max(1, Math.min(9, maxHits | 0));
  const pad = small ? 0.2 / scale : 0.8;
  const innerW = Math.max(0.1, width - 4 - pad * 2), innerH = Math.max(0.1, height - 4 - pad * 2);
  const stroke = small ? PHONE_MARKS.HIT_STROKE_PX / scale : 2.4;
  const gap = small ? PHONE_MARKS.HIT_GAP_PX / scale : 4;
  const span = count * stroke + (count - 1) * gap;
  out.count = count;
  out.compact = false;
  if (span <= innerW && stroke <= innerH) {
    out.cols = count; out.rows = 1;
    out.w = stroke; out.h = Math.min(18, innerH);
  } else if (span <= innerH && stroke <= innerW) {
    out.cols = 1; out.rows = count;
    out.w = Math.min(18, innerW); out.h = stroke;
  } else {
    out.compact = true;
    out.cols = Math.min(count, Math.max(1, Math.floor((innerW + gap) / (stroke + gap))));
    out.rows = Math.ceil(count / out.cols);
    out.w = Math.max(stroke, Math.min(stroke * 1.35, (innerW - gap * (out.cols - 1)) / out.cols));
    out.h = stroke;
  }
  out.gap = gap;
  out.width = out.cols * out.w + (out.cols - 1) * gap;
  out.height = out.rows * out.h + (out.rows - 1) * gap;
  out.pad = pad;
  out.fallback = out.width > innerW + 1e-6 || out.height > innerH + 1e-6;
  out.mode = out.fallback ? 'glyph' : out.compact ? 'compact' : 'lines';
  out.floorMet = !out.fallback && (!small || Math.min(out.w, out.h) * scale >= 3);
  // Ink, backing and row gaps must fit the real cell. Dense fallback caps are intentionally
  // smaller than the ordinary portal-letter cap; no numeral can spill into the next brick.
  out.glyphH = Math.min(PHONE_MARKS.CAP_PX / scale, innerH, innerW);
  return out;
}

/** Channel positions are stable, including the unlit channels after a hit. */
export function hitLinePosition(index, plan, out) {
  const row = Math.floor(index / plan.cols), col = index % plan.cols;
  out.x = (col - (plan.cols - 1) / 2) * (plan.w + plan.gap);
  out.y = ((plan.rows - 1) / 2 - row) * (plan.h + plan.gap);
  return out;
}

/** Loaded marks reserve a side strip on slabs, or a lower row on square/tall faces. */
export function loadedMarkLayout(info, width, height, out) {
  const small = !!info?.small, scale = Math.max(0.05, Number(info?.scale) || 1);
  const pad = small ? 0.2 / scale : 0.8;
  const innerW = Math.max(0.1, width - 4), innerH = Math.max(0.1, height - 4);
  const stroke = small ? PHONE_MARKS.HIT_STROKE_PX / scale : 7.5;
  const gap = small ? PHONE_MARKS.HIT_GAP_PX / scale : 3;
  out.stacked = width <= height * 1.25;
  const targetH = out.stacked ? stroke : small ? Math.min(6 / scale, Math.max(stroke, innerW * 0.2)) : stroke;
  out.powerH = Math.min(targetH, Math.max(0.1, innerH - pad * 2), Math.max(0.1, innerW - pad * 2) / 1.6);
  out.powerW = out.powerH * 1.6;
  out.powerX = out.stacked ? 0 : innerW / 2 - pad - out.powerW / 2;
  out.powerY = out.stacked ? -innerH / 2 + pad + out.powerH / 2 : 0;
  out.lineX = out.stacked ? 0 : -(out.powerW + gap) / 2;
  out.lineY = out.stacked ? (out.powerH + gap) / 2 : 0;
  out.lineWidth = out.stacked ? width : Math.max(0.1, width - out.powerW - gap);
  out.lineHeight = out.stacked ? Math.max(0.1, height - out.powerH - gap) : height;
  out.pad = pad;
  out.powerFloorMet = !small || out.powerH * scale >= 3;
  return out;
}

/** Pixel ink bounds become a cell-local UV rectangle, with half a texel of edge coverage. */
export function glyphInkRect(x0, y0, x1, y1, cellWidth, cellHeight, out) {
  out.x = Math.max(0, x0 - 0.5) / cellWidth;
  out.y = Math.max(0, cellHeight - y1 - 1.5) / cellHeight;
  out.w = Math.min(cellWidth, x1 - x0 + 2) / cellWidth;
  out.h = Math.min(cellHeight, y1 - y0 + 2) / cellHeight;
  out.aspect = (x1 - x0 + 2) / (y1 - y0 + 2);
  return out;
}

/** Eight target-corner segments stay strictly inside the real fused weak rectangle. */
export function phoneTargetSegment(index, width, height, scale, out) {
  const s = Math.max(0.05, scale || 1), inset = 2;
  const stroke = Math.min(PHONE_MARKS.STROKE_PX / s, width / 8, height / 8);
  const length = Math.min(6 / s, width * 0.24, height * 0.24);
  const corner = index >> 1, sideX = corner & 1 ? 1 : -1, sideY = corner & 2 ? 1 : -1;
  const horizontal = !(index & 1);
  out.w = horizontal ? length : stroke;
  out.h = horizontal ? stroke : length;
  out.x = sideX * (width / 2 - inset - out.w / 2);
  out.y = sideY * (height / 2 - inset - out.h / 2);
  return out;
}
