// G: the legibility check's maths (tools/qa/lib/legible.mjs, tools/qa/lib/png.mjs) on synthetic
// images, so a wrong mask or a wrong decode can never pass silently. The browser half
// (tools/qa/legibility.mjs) is run by hand: it needs Chrome.

import { deflateSync } from 'node:zlib';
import { test, assert, near } from './lib.mjs';
import { decodePNG, encodePNG, crc32 } from '../tools/qa/lib/png.mjs';
import {
  relLum, contrast, homography, applyH, invert3, convexHull, polySigned, unionSigned, silhouette,
  paddleSigned, measureRegion, paddleGeometry, ballGeometry, overlayCrop,
} from '../tools/qa/lib/legible.mjs';

/** A PNG the way other encoders write it: RGB or RGBA, a different filter on every row. */
function encodeFiltered(width, height, rgba, alpha) {
  const bpp = alpha ? 4 : 3;
  const stride = width * bpp;
  const rows = [];
  let prev = new Uint8Array(stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const cur = new Uint8Array(stride);
    for (let x = 0; x < width; x++) for (let k = 0; k < bpp; k++) cur[x * bpp + k] = rgba[(y * width + x) * 4 + k];
    const f = y % 5;
    const out = new Uint8Array(stride + 1);
    out[0] = f;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      out[i + 1] = (cur[i] - pred) & 0xff;
    }
    rows.push(out);
    prev = cur;
  }
  const chunk = (kind, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(kind, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // two IDAT chunks, as long images get
  const z = deflateSync(Buffer.concat(rows));
  const half = z.length >> 1;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', z.subarray(0, half)), chunk('IDAT', z.subarray(half)), chunk('IEND', Buffer.alloc(0))]);
}

function noise(width, height, seed = 7) {
  const d = new Uint8Array(width * height * 4);
  let s = seed;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    d[i] = (i & 3) === 3 ? 255 : (s >>> 16) & 0xff;
  }
  return d;
}

test('png: our own encoder and decoder round-trip', () => {
  const d = noise(37, 23);
  const img = decodePNG(encodePNG(37, 23, d));
  assert.equal(img.width, 37);
  assert.equal(img.height, 23);
  assert.deepEqual(Buffer.from(img.data), Buffer.from(d));
});

test('png: RGB and RGBA files with every row filter decode exactly', () => {
  const d = noise(29, 31, 3);
  for (const alpha of [false, true]) {
    const img = decodePNG(encodeFiltered(29, 31, d, alpha));
    assert.deepEqual(Buffer.from(img.data), Buffer.from(d), alpha ? 'RGBA' : 'RGB');
  }
  assert.throws(() => decodePNG(Buffer.from('not a png at all')), /not a PNG/);
});

test('luminance and contrast follow WCAG', () => {
  near(relLum(255, 255, 255), 1);
  near(relLum(0, 0, 0), 0);
  near(contrast(1, 0), 21);
  near(relLum(119, 119, 119), 0.1845, 1e-3); // #777 on black is about 4.7:1
  near(contrast(relLum(119, 119, 119), 0), 4.69, 0.01);
  assert.ok(contrast(0.1, 0.3) < 1, 'a brighter ring gives a ratio under 1');
});

test('homography maps a plane exactly and inverts', () => {
  const src = [[0, 0], [720, 0], [720, 1080], [0, 1080]];
  const dst = [[100, 50], [620, 80], [700, 900], [40, 860]]; // a tilted camera's trapezoid
  const H = homography(src, dst);
  for (let i = 0; i < 4; i++) {
    const [u, v] = applyH(H, ...src[i]);
    near(u, dst[i][0], 1e-6);
    near(v, dst[i][1], 1e-6);
  }
  const Hi = invert3(H);
  for (const p of [[360, 540], [12, 1000], [700, 3]]) {
    const [x, y] = applyH(Hi, ...applyH(H, ...p));
    near(x, p[0], 1e-6);
    near(y, p[1], 1e-6);
  }
});

test('hulls and signed distances: inside depth, outside distance, unions', () => {
  const sq = convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5], [2, 8]]);
  assert.equal(sq.length, 4);
  near(polySigned(sq, 5, 5), 5);
  near(polySigned(sq, 1, 5), 1);
  near(polySigned(sq, 13, 5), -3);
  near(polySigned(sq, 13, 14), -5);
  const polys = silhouette([[[0, 0], [10, 0], [10, 10], [0, 10]], [[20, 0], [30, 0], [30, 10], [20, 10]]]);
  near(unionSigned(polys, 25, 5, 3), 5);
  near(unionSigned(polys, 15, 5, 10), -5);
  near(unionSigned(polys, 100, 100, 3), -3); // far from every box: the reach
  // a rectangle footprint and a ring arc
  const rect = { kind: 'rect', cx: 360, cy: 1000, hw: 60, hh: 8 };
  near(paddleSigned(rect, 360, 1000), -8);
  near(paddleSigned(rect, 360, 1048), 40);
  near(paddleSigned(rect, 450, 1000), 30);
  const arc = { kind: 'arc', cx: 360, cy: 540, R: 320, half: 8, angle: Math.PI / 2, span: (40 * Math.PI) / 180 };
  near(paddleSigned(arc, 360, 540 + 320), -8);
  near(paddleSigned(arc, 360, 540 + 360), 32);
  const end = Math.PI / 2 + (20 * Math.PI) / 180;
  near(paddleSigned(arc, 360 + Math.cos(end + 0.1) * 320, 540 + Math.sin(end + 0.1) * 320), 320 * Math.sin(0.1), 1e-6);
});

/** A synthetic frame: field units map 1:1 to CSS px, the image is 2x (a DPR 2 screenshot). */
function scene({ padLum = 150, ringLum = 10, hot = 0, ball = null } = {}) {
  const W = 400, H = 300, S = 2;
  const data = new Uint8Array(W * S * H * S * 4);
  const put = (x, y, v) => {
    const i = (y * W * S + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  };
  for (let y = 0; y < H * S; y++) {
    for (let x = 0; x < W * S; x++) {
      const fx = (x + 0.5) / S, fy = (y + 0.5) / S;
      let v = ringLum;
      if (Math.abs(fx - 200) <= 60 && Math.abs(fy - 150) <= 8) v = padLum;
      else if (hot && fy > 170 && fy < 190) v = hot; // fire tips inside the ring, under the paddle
      if (ball && Math.hypot(fx - ball[0], fy - ball[1]) <= 9) v = 255;
      put(x, y, v);
    }
  }
  const frame = {
    viewport: [W, H],
    field: { w: 720, h: 1080 },
    quad: [[0, 0], [720, 0], [720, 1080], [0, 1080]],
    pad: { kind: 'rect', cx: 200, cy: 150, hw: 60, hh: 8 },
    hulls: [[[140, 142], [260, 142], [260, 158], [140, 158]]],
    balls: ball ? [ball] : [],
    ball: ball ? { fx: ball[0], fy: ball[1], r: 9, cx: ball[0], cy: ball[1], rcss: 9 } : null,
  };
  return { img: { width: W * S, height: H * S, data }, frame, scale: S };
}

const O = { ring: 40, gap: 2, insetPx: 1, gapPx: 1, insetUnits: 1.5, ballClear: 32 };

test('measure: paddle mean against its 40-unit ring, masks where they belong', () => {
  const { img, frame, scale } = scene();
  const m = measureRegion(img, scale, paddleGeometry(frame, O), O);
  near(m.obj, relLum(150, 150, 150), 1e-9);
  near(m.ring, relLum(10, 10, 10), 1e-9);
  near(m.ratio, contrast(relLum(150, 150, 150), relLum(10, 10, 10)), 1e-9);
  // ring area: (120 + 2*40) x (16 + 2*40) with rounded corners, minus the paddle and its 2-unit gap
  const ringArea = (200 * 96 - (4 - Math.PI) * 40 * 40) - (124 * 20 - (4 - Math.PI) * 4);
  near(m.ringN / (scale * scale), ringArea, ringArea * 0.03);
  near(m.objN / (scale * scale), 118 * 14, 118 * 14 * 0.05);
  const c = overlayCrop(img, m.crop);
  assert.equal(c.width, m.crop.w);
  assert.ok(c.data.some((v, i) => i % 4 === 1 && v === 255), 'the paddle outline is drawn');
});

test('measure: fire inside the ring lowers the ratio; a ball and its halo do not count', () => {
  const calm = measureRegion(scene().img, 2, paddleGeometry(scene().frame, O), O);
  const s = scene({ hot: 230 });
  const fire = measureRegion(s.img, 2, paddleGeometry(s.frame, O), O);
  assert.ok(fire.ratio < calm.ratio / 2, `fire ${fire.ratio} vs calm ${calm.ratio}`);
  const b = scene({ ball: [200, 125] }); // the ball sitting on the paddle, inside its ring
  const withBall = measureRegion(b.img, 2, paddleGeometry(b.frame, O), O);
  near(withBall.ring, calm.ring, 1e-9);
  const ball = measureRegion(b.img, 2, ballGeometry(b.frame, O), O);
  near(ball.obj, 1, 1e-9);
  assert.ok(ball.ring > relLum(10, 10, 10), 'the paddle sits in the ball ring');
});
