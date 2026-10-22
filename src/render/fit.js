// Kiln: pure camera-fit and field <-> world maths (OWNER: C). No three.js import, so Node can test
// it and the UI (D) can use it.
//
// Field units: origin top-left, x right, y down, 720 x 1080. three.js world: X = x - 360,
// Y = 540 - y, Z = 0 on the field plane (one unit = one field unit).
//
// The camera is the look test 02 rig: a 35 degree perspective camera lifted LIFT units above the
// field centre, looking slightly down at (0, look, 0). fitCamera() finds the distance at which the
// projected field corners fill the viewport with the ART margins (x 0.90, or 0.945 under 700 px
// wide; y 0.955) and nudges `look` so the field sits centred vertically.
//
// A camera pose is a plain object { px, py, pz, tx, ty, tz, roll, fov, aspect }: position, look
// target, roll about the view axis (radians, three.js camera.rotateZ sign), vertical FOV in degrees.

import { FIELD } from '../core/constants.js';

export const FIT = Object.freeze({
  FOV: 35,
  LIFT: 150,
  LOOK0: -30,
  DIST0: 1800,
  MARGIN_X: 0.9,
  MARGIN_X_NARROW: 0.945,
  NARROW_PX: 700,
  MARGIN_Y: 0.955,
  ITER: 14,
  // C call (review 2026-10-22, ART 15.3 C4 "mouth fitted from the sill to the screen bottom"): the
  // kiln mouth under the field stays in view. The fire burns in the band from the kiln lip (field
  // y 1030) down to its foot at 1080 + MOUTH, which the fit keeps on screen (the foot fades out, so
  // the screen edge never cuts a flame). The field keeps its own margins, stays centred where there
  // is room (phones) and rises only as far as the mouth needs (short, wide windows: desktop).
  MOUTH: 70,
  MAX_RESERVE: 0.4, // a top reserve never takes more than this share of the height
  MAX_RESERVE_SUM: 0.5, // top and bottom reserves together
});

const HW = FIELD.W / 2;
const HH = FIELD.H / 2;

/** Field (x right, y down) to three.js world (X right, Y up). */
export function fieldToWorld(x, y, out) {
  out.x = x - HW;
  out.y = HH - y;
  return out;
}

/** three.js world to field units. */
export function worldToField(X, Y, out) {
  out.x = X + HW;
  out.y = HH - Y;
  return out;
}

/** A new pose object (allocate once, reuse). */
export function createPose() {
  return { px: 0, py: FIT.LIFT, pz: FIT.DIST0, tx: 0, ty: FIT.LOOK0, tz: 0, roll: 0, fov: FIT.FOV, aspect: 1 };
}

// basis scratch (module level: no allocation per call)
const B = { fx: 0, fy: 0, fz: 0, rx: 0, ry: 0, rz: 0, ux: 0, uy: 0, uz: 0, tanH: 0 };

/** Camera basis for a pose: forward f, right r, up u (roll applied), as three.js would build it. */
function basis(p) {
  let fx = p.tx - p.px, fy = p.ty - p.py, fz = p.tz - p.pz;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  // right = f x worldUp(0,1,0)
  let rx = -fz, ry = 0, rz = fx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  // up = r x f
  let ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  if (p.roll) {
    const c = Math.cos(p.roll), s = Math.sin(p.roll);
    const nrx = rx * c + ux * s, nry = ry * c + uy * s, nrz = rz * c + uz * s;
    const nux = -rx * s + ux * c, nuy = -ry * s + uy * c, nuz = -rz * s + uz * c;
    rx = nrx; ry = nry; rz = nrz; ux = nux; uy = nuy; uz = nuz;
  }
  B.fx = fx; B.fy = fy; B.fz = fz; B.rx = rx; B.ry = ry; B.rz = rz; B.ux = ux; B.uy = uy; B.uz = uz;
  B.tanH = Math.tan((p.fov * Math.PI) / 360);
  return B;
}

/**
 * Project a world point to normalised device coordinates. out.x, out.y in -1..1 when on screen;
 * out.w = depth in front of the camera (> 0 when visible).
 */
export function projectWorld(pose, X, Y, Z, out) {
  const b = basis(pose);
  const vx = X - pose.px, vy = Y - pose.py, vz = Z - pose.pz;
  const depth = vx * b.fx + vy * b.fy + vz * b.fz;
  const xc = vx * b.rx + vy * b.ry + vz * b.rz;
  const yc = vx * b.ux + vy * b.uy + vz * b.uz;
  out.x = xc / depth / (b.tanH * pose.aspect);
  out.y = yc / depth / b.tanH;
  out.w = depth;
  return out;
}

/** Project a field point (z = 0) to viewport pixels (origin top-left). */
export function fieldToScreen(pose, x, y, W, H, out) {
  projectWorld(pose, x - HW, HH - y, 0, out);
  out.x = ((out.x + 1) / 2) * W;
  out.y = ((1 - out.y) / 2) * H;
  return out;
}

/**
 * Cast a ray through viewport pixel (sx, sy) and intersect the field plane Z = 0.
 * @returns {boolean} false when the ray misses the plane
 */
export function screenToFieldPose(pose, sx, sy, W, H, out) {
  const b = basis(pose);
  const nx = (sx / W) * 2 - 1;
  const ny = 1 - (sy / H) * 2;
  const kx = nx * b.tanH * pose.aspect, ky = ny * b.tanH;
  const dx = b.fx + b.rx * kx + b.ux * ky;
  const dy = b.fy + b.ry * kx + b.uy * ky;
  const dz = b.fz + b.rz * kx + b.uz * ky;
  if (Math.abs(dz) < 1e-9) return false;
  const t = -pose.pz / dz;
  if (t <= 0) return false;
  out.x = pose.px + dx * t + HW;
  out.y = HH - (pose.py + dy * t);
  return true;
}

/**
 * Cast a ray through viewport pixel (sx, sy) and intersect the plane Z = z (three.js world).
 * out.x, out.y are world X, Y. @returns {boolean}
 */
export function screenToPlane(pose, sx, sy, W, H, z, out) {
  const b = basis(pose);
  const nx = (sx / W) * 2 - 1;
  const ny = 1 - (sy / H) * 2;
  const kx = nx * b.tanH * pose.aspect, ky = ny * b.tanH;
  const dx = b.fx + b.rx * kx + b.ux * ky;
  const dy = b.fy + b.ry * kx + b.uy * ky;
  const dz = b.fz + b.rz * kx + b.uz * ky;
  if (Math.abs(dz) < 1e-9) return false;
  const t = (z - pose.pz) / dz;
  if (t <= 0) return false;
  out.x = pose.px + dx * t;
  out.y = pose.py + dy * t;
  return true;
}

const FULL = { x0: 0, y0: 0, x1: FIELD.W, y1: FIELD.H };
const q = { x: 0, y: 0, w: 0 };

/** Bounding box of the projected field corners, in pixels. */
export function fieldBounds(pose, W, H, out, frame = FULL) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 4; i++) {
    fieldToScreen(pose, i & 1 ? frame.x1 : frame.x0, i & 2 ? frame.y1 : frame.y0, W, H, q);
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.y > y1) y1 = q.y;
  }
  out.x0 = x0; out.x1 = x1; out.y0 = y0; out.y1 = y1;
  return out;
}

/** Place the rest pose for a distance and look height (no lean, roll, drift or dolly). */
export function restPose(pose, dist, look, aspect, centreX = 0) {
  pose.px = centreX; pose.py = FIT.LIFT; pose.pz = dist;
  pose.tx = centreX; pose.ty = look; pose.tz = 0;
  pose.roll = 0; pose.fov = FIT.FOV; pose.aspect = aspect;
  return pose;
}

const bb = { x0: 0, x1: 0, y0: 0, y1: 0 };
const tl = { x: 0, y: 0, w: 0 };
const tr = { x: 0, y: 0, w: 0 };

const mo = { x: 0, y: 0, w: 0 };

/** Screen y (px) of the bottom of the kiln mouth: field y FIELD.H + below on the field plane. */
function mouthY(pose, W, H, below) {
  fieldToScreen(pose, 0, FIELD.H + below, W, H, mo);
  return mo.y;
}

/**
 * Fit the field into a W x H viewport (CSS pixels). Writes the rest pose into `pose` and returns
 * `out` = { dist, look, marginX, marginY, top, mouthY } plus the projected field rect for the HUD:
 * rect = { x, y, w, h, scale } (x, y = top-left corner of the projected top edge; w = top edge
 * width; h = projected height top to bottom; scale = w / 720).
 * opts.top: CSS px kept clear above the field (D's HUD reserve); opts.bottom: CSS px kept clear
 * under the field (D's touch Overload button). The field fits into the viewport between them, the
 * canvas stays full screen. opts.below: field units under the field kept in view (the kiln mouth,
 * FIT.MOUTH by default); the mouth may burn in the bottom reserve (it is decoration), never off
 * screen. The field is centred between the reserves and rises only as far as the mouth needs.
 * opts.frame: field-space bounds to frame (the playable area plus the ceiling's art band). Rays
 * still use the original field coordinates; the returned rect carries that range for UI overlays.
 * @param {{top?:number, bottom?:number, below?:number, frame?:object}} [opts]
 */
export function fitCamera(W, H, pose, out, opts) {
  W = Math.max(1, W);
  H = Math.max(1, H);
  const aspect = W / H;
  const mx = W < FIT.NARROW_PX ? FIT.MARGIN_X_NARROW : FIT.MARGIN_X;
  const my = FIT.MARGIN_Y;
  const top = opts && opts.top > 0 ? Math.min(opts.top, H * FIT.MAX_RESERVE) : 0;
  const bottom = opts && opts.bottom > 0 ? Math.min(opts.bottom, H * FIT.MAX_RESERVE_SUM - top) : 0;
  const below = opts && opts.below >= 0 ? opts.below : FIT.MOUTH;
  const frame = opts?.frame || FULL;
  const fieldW = frame.x1 - frame.x0;
  const centreX = (frame.x0 + frame.x1) / 2 - HW;
  const avail = H - top - bottom;
  const centre = top + avail / 2;
  // the field's top never rises above its margin under the top reserve; from there to the screen's
  // bottom edge is the room for the field and the mouth together
  const extAvail = H - (top + ((1 - my) * avail) / 2);
  let dist = FIT.DIST0;
  let look = FIT.LOOK0;
  for (let i = 0; i < FIT.ITER; i++) {
    restPose(pose, dist, look, aspect, centreX);
    fieldBounds(pose, W, H, bb, frame);
    const w = (bb.x1 - bb.x0) / W;
    const h = (bb.y1 - bb.y0) / avail;
    const e = (Math.max(bb.y1, mouthY(pose, W, H, below)) - bb.y0) / extAvail;
    dist *= Math.max(w / mx, h / my, e);
    restPose(pose, dist, look, aspect, centreX);
    fieldBounds(pose, W, H, bb, frame);
    fieldToScreen(pose, frame.x0, frame.y0, W, H, tl);
    fieldToScreen(pose, frame.x1, frame.y0, W, H, tr);
    const pxPerUnit = (tr.x - tl.x) / fieldW;
    const fieldH = bb.y1 - bb.y0;
    const ext = Math.max(0, mouthY(pose, W, H, below) - bb.y1);
    // centred between the reserves, raised just enough to keep the mouth on screen
    const target = centre - Math.max(0, centre + fieldH / 2 + ext - H);
    const mid = (bb.y0 + bb.y1) / 2;
    look -= ((mid - target) / pxPerUnit) * 0.9;
  }
  restPose(pose, dist, look, aspect, centreX);
  fieldToScreen(pose, frame.x0, frame.y0, W, H, tl);
  fieldToScreen(pose, frame.x1, frame.y0, W, H, tr);
  fieldBounds(pose, W, H, bb, frame);
  out.dist = dist;
  out.look = look;
  out.centreX = centreX;
  out.marginX = mx;
  out.marginY = my;
  out.top = top;
  out.bottom = bottom;
  out.mouthY = mouthY(pose, W, H, below);
  const r = out.rect || (out.rect = { x: 0, y: 0, w: 0, h: 0, scale: 1 });
  r.x = tl.x;
  r.y = tl.y;
  r.w = tr.x - tl.x;
  r.h = bb.y1 - tl.y;
  r.scale = r.w / fieldW;
  r.fieldX = frame.x0;
  r.fieldY = frame.y0;
  r.fieldW = fieldW;
  r.fieldH = frame.y1 - frame.y0;
  out.bounds = out.bounds || { x0: 0, x1: 0, y0: 0, y1: 0 };
  out.bounds.x0 = bb.x0; out.bounds.x1 = bb.x1; out.bounds.y0 = bb.y0; out.bounds.y1 = bb.y1;
  return out;
}

/** Clamp helper shared by the camera rig. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
