// Kiln QA (G): legibility maths for tools/qa/legibility.mjs (LEAD request 2026-10-21 19:40, ART 12b).
// Pure functions, no browser: the CLI hands in a screenshot and the frame's geometry.
//
// Contrast is WCAG's (L1 + 0.05) / (L2 + 0.05) on MEAN relative luminance: the object's pixels
// against the pixels of a 40-unit ring around it (field units, measured on the play plane).
// Below 1 means the ring is brighter than the object.

/** sRGB 8-bit to linear light. */
export const LINEAR = (() => {
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

/** Relative luminance (WCAG) of an 8-bit sRGB colour. */
export function relLum(r, g, b) {
  return 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];
}

/** Contrast of a against b; under 1 when b is brighter. */
export function contrast(a, b) {
  return (a + 0.05) / (b + 0.05);
}

// ------------------------------------------------------------------ homography (plane to screen)

/** Solve A x = b (n x n, Gaussian elimination with partial pivoting). */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('singular homography (points in a line?)');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * The 3x3 homography (row-major, h22 = 1) taking four source points to four destination points.
 * @param {number[][]} src [[x,y] x4]
 * @param {number[][]} dst [[x,y] x4]
 */
export function homography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solve(A, b), 1];
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) throw new Error('homography is not invertible');
  const r = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return r.map((v) => v / det);
}

// ------------------------------------------------------------------ shapes

/** Convex hull (Andrew's monotone chain), counter-clockwise in a y-down frame's maths sense. */
export function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const hi = [];
  for (let k = p.length - 1; k >= 0; k--) {
    const q = p[k];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
    hi.push(q);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Signed distance to a convex polygon (from convexHull): positive inside (depth to the nearest
 * edge), negative outside (minus the distance to the boundary).
 */
export function polySigned(poly, x, y) {
  let inside = true;
  let edge = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const ex = bx - ax, ey = by - ay;
    const len = Math.hypot(ex, ey) || 1;
    const s = (ex * (y - ay) - ey * (x - ax)) / len; // > 0 on the inner side (counter-clockwise hull)
    if (s < 0) inside = false;
    edge = Math.min(edge, segDist(x, y, ax, ay, bx, by));
  }
  return inside ? edge : -edge;
}

/**
 * Signed distance in field units from (fx, fy) to the paddle footprint on the play plane:
 * negative inside. shape: {kind:'rect', cx, cy, hw, hh} or {kind:'arc', cx, cy, R, half, angle, span}.
 */
export function paddleSigned(s, fx, fy) {
  if (s.kind === 'arc') {
    const dx = fx - s.cx, dy = fy - s.cy;
    const rad = Math.hypot(dx, dy);
    let d = Math.atan2(dy, dx) - s.angle;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const over = Math.abs(d) - s.span / 2; // radians past the arc's end (negative: within it)
    if (over <= 0) {
      const radial = Math.abs(rad - s.R) - s.half; // > 0 outside the band
      return radial > 0 ? radial : Math.max(radial, over * s.R);
    }
    // past an end: distance to that end face (a radial segment, R - half to R + half)
    const a = s.angle + Math.sign(d) * (s.span / 2);
    const c = Math.cos(a), sn = Math.sin(a);
    const r0 = s.R - s.half, r1 = s.R + s.half;
    return segDist(fx, fy, s.cx + c * r0, s.cy + sn * r0, s.cx + c * r1, s.cy + sn * r1);
  }
  const qx = Math.abs(fx - s.cx) - s.hw;
  const qy = Math.abs(fy - s.cy) - s.hh;
  if (qx <= 0 && qy <= 0) return Math.max(qx, qy);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
}

// ------------------------------------------------------------------ measuring

/**
 * Measure one object against its ring in a screenshot.
 * @param {{width:number,height:number,data:Uint8Array}} img  RGBA screenshot
 * @param {number} scale  image pixels per CSS pixel
 * @param {object} g  geometry: { Hinv (CSS -> field), box:[x0,y0,x1,y1] CSS, inObj(cssX,cssY,fx,fy) -> bool,
 *   ringDist(cssX,cssY,fx,fy) -> field units from the object's edge (or -1 when excluded) }
 * @param {{ring:number, gap:number}} o
 */
export function measureRegion(img, scale, g, o) {
  const x0 = Math.max(0, Math.floor(g.box[0] * scale));
  const y0 = Math.max(0, Math.floor(g.box[1] * scale));
  const x1 = Math.min(img.width, Math.ceil(g.box[2] * scale));
  const y1 = Math.min(img.height, Math.ceil(g.box[3] * scale));
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0);
  const mask = new Uint8Array(w * h); // 1 object, 2 ring
  let objSum = 0, objN = 0, ringSum = 0, ringN = 0;
  const ringLums = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const cx = (x + 0.5) / scale, cy = (y + 0.5) / scale;
      const [fx, fy] = applyH(g.Hinv, cx, cy);
      const i = (y * img.width + x) * 4;
      const L = relLum(img.data[i], img.data[i + 1], img.data[i + 2]);
      if (g.inObj(cx, cy, fx, fy)) {
        objSum += L;
        objN++;
        mask[(y - y0) * w + (x - x0)] = 1;
        continue;
      }
      const d = g.ringDist(cx, cy, fx, fy);
      if (d > o.gap && d <= o.ring) {
        ringSum += L;
        ringN++;
        ringLums.push(L);
        mask[(y - y0) * w + (x - x0)] = 2;
      }
    }
  }
  const obj = objN ? objSum / objN : 0;
  const ring = ringN ? ringSum / ringN : 0;
  ringLums.sort((a, b) => a - b);
  const ringP95 = ringLums.length ? ringLums[Math.min(ringLums.length - 1, Math.floor(ringLums.length * 0.95))] : 0;
  return {
    obj, ring, objN, ringN, ringP95,
    ratio: contrast(obj, ring),
    plain: obj / Math.max(ring, 1e-6), // plain ratio of the means, for comparison only
    crop: { x: x0, y: y0, w, h, mask },
  };
}

/**
 * Signed distance to a union of convex polygons: positive inside any of them. Polygons whose box
 * (grown by `reach`) misses the point count as -reach, which is all callers need to know.
 */
export function unionSigned(polys, x, y, reach) {
  let best = -reach;
  for (let i = 0; i < polys.length; i++) {
    const q = polys[i];
    if (x < q.box[0] - reach || x > q.box[2] + reach || y < q.box[1] - reach || y > q.box[3] + reach) continue;
    const s = polySigned(q.pts, x, y);
    if (s > best) best = s;
  }
  return best;
}

/** Convex hulls with their boxes, from point clouds (one per drawn piece). */
export function silhouette(clouds) {
  return (clouds || [])
    .map((c) => convexHull(c))
    .filter((pts) => pts.length >= 3)
    .map((pts) => ({ pts, box: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] }));
}

/** Paddle geometry for measureRegion from the page's frame geometry (see legibility.mjs). */
export function paddleGeometry(frame, o) {
  const H = homography(FIELD_QUAD(frame.field), frame.quadPad || frame.quad);
  const Hinv = invert3(H);
  const polys = silhouette(frame.hulls);
  const hull = polys.length ? polys : null;
  const reach = Math.max(o.insetPx, o.gapPx) + 1;
  const s = frame.pad;
  // CSS box: the footprint grown by the ring, through the homography, plus the hull
  const ext = o.ring + 4;
  const pts = [];
  if (s.kind === 'arc') {
    for (let k = 0; k <= 16; k++) {
      const a = s.angle - s.span / 2 - 0.3 + (k / 16) * (s.span + 0.6);
      for (const r of [s.R - s.half - ext, s.R + s.half + ext]) pts.push(applyH(H, s.cx + Math.cos(a) * r, s.cy + Math.sin(a) * r));
    }
  } else {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) pts.push(applyH(H, s.cx + sx * (s.hw + ext), s.cy + sy * (s.hh + ext)));
  }
  if (hull) for (const q of hull) pts.push([q.box[0], q.box[1]], [q.box[2], q.box[3]]);
  const box =[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  // the ball and its halo are meant to be the brightest thing on screen: they are not the paddle's ring
  const balls = frame.balls || [];
  const clear2 = (o.ballClear ?? 0) ** 2;
  const nearBall = (fx, fy) => {
    for (let i = 0; i < balls.length; i++) {
      const dx = fx - balls[i][0], dy = fy - balls[i][1];
      if (dx * dx + dy * dy <= clear2) return true;
    }
    return false;
  };
  const ringOf = (fx, fy) => (nearBall(fx, fy) ? -1 : paddleSigned(s, fx, fy));
  return {
    Hinv,
    box,
    // the object: inside the screen silhouette (bar modes) or inside the footprint (ring arc)
    inObj: hull
      ? (cx, cy) => unionSigned(hull, cx, cy, reach) >= o.insetPx
      : (cx, cy, fx, fy) => paddleSigned(s, fx, fy) <= -o.insetUnits,
    // the ring: field distance from the footprint, never on the bar's own sides
    ringDist: hull
      ? (cx, cy, fx, fy) => (unionSigned(hull, cx, cy, reach) > -o.gapPx ? -1 : ringOf(fx, fy))
      : (cx, cy, fx, fy) => ringOf(fx, fy),
  };
}

/** Ball geometry for measureRegion. */
export function ballGeometry(frame, o) {
  const H = homography(FIELD_QUAD(frame.field), frame.quad);
  const Hinv = invert3(H);
  const b = frame.ball;
  const ext = b.r + o.ring + 4;
  const pts = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) pts.push(applyH(H, b.fx + sx * ext, b.fy + sy * ext));
  const box = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  const inner = Math.max(b.rcss * 0.5, b.rcss - o.insetPx);
  return {
    Hinv,
    box,
    inObj: (cx, cy) => Math.hypot(cx - b.cx, cy - b.cy) <= inner,
    ringDist: (cx, cy, fx, fy) => (Math.hypot(cx - b.cx, cy - b.cy) < b.rcss + o.gapPx ? -1 : Math.hypot(fx - b.fx, fy - b.fy) - b.r),
  };
}

const FIELD_QUAD = (f) => [[0, 0], [f.w, 0], [f.w, f.h], [0, f.h]];

/**
 * A crop of the screenshot with the object outlined in green and the ring's edges in cyan, for a
 * person to check that the masks sit where they should.
 */
export function overlayCrop(img, crop) {
  const { x, y, w, h, mask } = crop;
  const out = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = ((y + j) * img.width + (x + i)) * 4;
      const d = (j * w + i) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = 255;
      const m = mask[j * w + i];
      if (!m) continue;
      const edge = (i === 0 || mask[j * w + i - 1] !== m) || (i === w - 1 || mask[j * w + i + 1] !== m) ||
        (j === 0 || mask[(j - 1) * w + i] !== m) || (j === h - 1 || mask[(j + 1) * w + i] !== m);
      if (!edge) continue;
      if (m === 1) { out[d] = 40; out[d + 1] = 255; out[d + 2] = 60; } else { out[d] = 0; out[d + 1] = 220; out[d + 2] = 255; }
    }
  }
  return { width: w, height: h, data: out };
}
