// Phone brick information uses field-space geometry sized from the stable rest-view scale.
// Pure helpers keep dense hit encoding and atlas ink bounds testable without a canvas or WebGL.
export const PHONE_MARKS = Object.freeze({ CAP_PX: 12.2, ROW_GAP_PX: 1.3, PIP_PX: 2.5, STROKE_PX: 1.25 });

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

/** A compact count stays within its slab instead of letting enlarged digits cover nearby rows. */
export function phonePipLayout(count, width, height, scale, out) {
  out.count = Math.max(0, Math.min(9, count | 0));
  out.cols = Math.min(out.count || 1, width > height * 1.25 ? 5 : 3);
  out.rows = Math.ceil(out.count / out.cols) || 1;
  const s = Math.max(0.05, scale || 1);
  out.size = Math.min(PHONE_MARKS.PIP_PX / s,
    Math.max(1, width - 4) / (out.cols + (out.cols - 1) * 0.5),
    Math.max(1, height - 4) / (out.rows + (out.rows - 1) * 0.5));
  out.gap = out.size * 0.5;
  out.width = out.cols * out.size + (out.cols - 1) * out.gap;
  out.height = out.rows * out.size + (out.rows - 1) * out.gap;
  return out;
}

/** Position one pip in the reusable count layout, centred row by row. */
export function phonePipPosition(index, plan, out) {
  const row = Math.floor(index / plan.cols), col = index % plan.cols;
  const rowCount = Math.min(plan.cols, plan.count - row * plan.cols);
  out.x = (col - (rowCount - 1) / 2) * (plan.size + plan.gap);
  out.y = ((plan.rows - 1) / 2 - row) * (plan.size + plan.gap);
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
