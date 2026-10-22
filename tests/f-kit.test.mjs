// Kiln: art-kit contract tests (OWNER: F). ARTKIT.md is the contract; this file holds the kit to it.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './lib.mjs';
import { DROP_NAMES, BF, FIELD, RING } from '../src/core/constants.js';
import { BOSS_PARTS, BOSS_DRESSING } from '../src/content/bosses.js';
import { CRUCIBLE_SPEC, CORE_SPECS } from '../src/content/bosses/orbit.js';
import { STOKER } from '../src/content/bosses/stoker.js';
import { createWorld } from '../src/core/world.js';
import { createContent } from '../src/content/content.js';
import { getLevel, stagesOf } from '../src/levels/index.js';
import { decodePNG } from '../tools/qa/lib/png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = ['textures', 'glyphs', 'models', 'img', 'icons'];
const GLB_MAX = 400 * 1024;
/** Boss mesh materials C swaps by name (ARTKIT.md "Boss meshes"). */
const BOSS_MATERIALS = ['titanium', 'matte', 'metal', 'ember', 'core'];

/** Rows of the ARTKIT.md "Files" table: { path, w, h, format, status }. */
function readKit() {
  const md = readFileSync(join(root, 'ARTKIT.md'), 'utf8');
  const rows = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/);
    if (!m) continue;
    const size = m[2].trim().match(/^(\d+)\s*[x×]\s*(\d+)$/);
    rows.push({
      path: m[1],
      w: size ? Number(size[1]) : 0,
      h: size ? Number(size[2]) : 0,
      format: m[3].trim(),
      status: m[7].trim(),
    });
  }
  return rows;
}

/** Width, height and (PNG) colour type from a PNG or WebP header. */
function imageInfo(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { kind: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25] };
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return { kind: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    }
    if (chunk === 'VP8 ') {
      return { kind: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { kind: 'webp', w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) };
    }
  }
  return { kind: 'unknown', w: 0, h: 0 };
}

/** Parsed glTF JSON of a .glb, after checking its header. */
function readGlb(buf) {
  assert.equal(buf.readUInt32LE(0), 0x46546c67, 'starts with the glTF magic');
  assert.equal(buf.readUInt32LE(4), 2, 'glTF version 2');
  assert.equal(buf.readUInt32LE(8), buf.length, 'header length matches the file size');
  const jsonLen = buf.readUInt32LE(12);
  assert.equal(buf.readUInt32LE(16), 0x4e4f534a, 'first chunk is JSON');
  return JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(relative(root, p).split('\\').join('/'));
  }
  return out;
}

const kit = readKit();

test('ARTKIT.md lists the kit', () => {
  assert.ok(kit.length >= 30, `expected the full kit, found ${kit.length} rows`);
  for (const r of kit) assert.ok(['placeholder', 'final'].includes(r.status), `${r.path}: status ${r.status}`);
  const paths = new Set(kit.map((r) => r.path));
  assert.equal(paths.size, kit.length, 'no path listed twice');
  for (const name of DROP_NAMES) assert.ok(paths.has(`glyphs/${name}.png`), `glyph for drop ${name}`);
  for (const p of ['glyphs/drops.png', 'textures/crackle.png', 'textures/crackle_n.png',
    'models/stoker.glb', 'models/crucible.glb', 'models/core.glb', 'icons/icon-512.png']) {
    assert.ok(paths.has(p), `${p} is listed`);
  }
});

test('every ARTKIT file exists at its size', () => {
  for (const r of kit) {
    const file = join(root, r.path);
    assert.ok(existsSync(file), `${r.path} exists`);
    if (r.path.endsWith('.glb')) continue;
    const info = imageInfo(readFileSync(file));
    const want = r.path.endsWith('.webp') ? 'webp' : 'png';
    assert.equal(info.kind, want, `${r.path} is a ${want}`);
    assert.deepEqual([info.w, info.h], [r.w, r.h], `${r.path} is ${r.w}x${r.h}`);
    if (info.kind === 'png') {
      const ct = { 'PNG RGB': 2, 'PNG RGBA': 6, 'PNG grey': 0 }[r.format];
      if (ct !== undefined) assert.equal(info.colorType, ct, `${r.path} is ${r.format}`);
    }
  }
});

/** 8-connected parts of a boolean mask (w x h), as arrays of [x, y] edge pixels. */
function partEdges(mask, w, h) {
  const lab = new Int32Array(w * h);
  const edges = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s]) continue;
    const id = edges.length + 1;
    const edge = [];
    const stack = [s];
    lab[s] = id;
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p - x) / w;
      let inside = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) { inside = false; continue; }
          const q = yy * w + xx;
          if (!mask[q]) { if (dx === 0 || dy === 0) inside = false; continue; }
          if (!lab[q]) { lab[q] = id; stack.push(q); }
        }
      }
      if (!inside) edge.push([x, y]);
    }
    edges.push(edge);
  }
  return edges;
}

// The brief: no detail under 2 px when a glyph is drawn 24 px tall. Separate strokes (MULTI's
// rings, LASER's beams and base, LIFE's chevron and bar ...) stay 24 px apart or more at 256.
test('drop glyphs keep 24 px or more between separate strokes at 256 (2 px at 24)', () => {
  for (const name of DROP_NAMES) {
    const img = decodePNG(readFileSync(join(root, `glyphs/${name}.png`)));
    const { width: w, height: h, data } = img;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] > 127 ? 1 : 0;
    const parts = partEdges(mask, w, h).filter((e) => e.length > 8);
    let gap = Infinity;
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        for (const [ax, ay] of parts[i]) {
          for (const [bx, by] of parts[j]) gap = Math.min(gap, Math.hypot(ax - bx, ay - by) - 1);
        }
      }
    }
    if (parts.length > 1) assert.ok(gap >= 24, `${name}: strokes ${gap.toFixed(1)} px apart at 256 (${(gap * 24 / 256).toFixed(2)} px at 24)`);
  }
  // LIFE is the lives bar with a chevron above it (ART 15.5 F2): two parts, the wider one below
  const img = decodePNG(readFileSync(join(root, 'glyphs/life.png')));
  const mask = new Uint8Array(img.width * img.height);
  for (let i = 0; i < mask.length; i++) mask[i] = img.data[i * 4 + 3] > 127 ? 1 : 0;
  const parts = partEdges(mask, img.width, img.height).filter((e) => e.length > 8);
  assert.equal(parts.length, 2, 'life: a chevron and a bar');
  const box = (e) => e.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [1e9, 1e9, -1e9, -1e9]);
  const [top, low] = parts.map(box).sort((a, b) => a[1] - b[1]);
  assert.ok(low[2] - low[0] > top[2] - top[0], 'life: the bar is wider than the chevron above it');
  assert.ok(low[3] - low[1] < 30, 'life: the bar is one stroke tall');
});

// ART 15.5 F3: the slot's edge is a 1 px titanium hairline at 40% (#C0C4CA), not a heat outline.
test('app icon slot has a neutral titanium hairline, not an orange rim', () => {
  for (const [path, size, hfrac, ratio] of [['icons/icon-512.png', 512, 0.68, 3.8], ['icons/icon-192.png', 192, 0.68, 3.8], ['icons/icon-180.png', 180, 0.68, 3.8]]) {
    const img = decodePNG(readFileSync(join(root, path)));
    let hh = Math.round(size * hfrac);
    let ww = Math.round(hh / ratio);
    if ((size - ww) % 2) ww++;
    if ((size - hh) % 2) hh++;
    const x0 = (size - ww) / 2, y0 = (size - hh) / 2;
    const px = (x, y) => [0, 1, 2].map((k) => img.data[(y * size + x) * 4 + k]);
    // the hairline: the row just above the slot's top edge, across its middle half
    for (let x = x0 + Math.round(ww / 4); x < x0 + Math.round((3 * ww) / 4); x++) {
      const [r, g, b] = px(x, y0 - 1);
      assert.ok(r - b <= 12 && Math.abs(r - g) <= 12, `${path} rim at (${x}, ${y0 - 1}) is ${r},${g},${b}: neutral titanium`);
      assert.ok(r >= 60 && r <= 120, `${path} rim at (${x}, ${y0 - 1}) is ${r},${g},${b}: titanium at about 40% over the void`);
    }
    const [r2, g2, b2] = px(x0 + (ww >> 1), y0 - 3);
    assert.ok(r2 < 40 && g2 < 40 && b2 < 40, `${path}: void 3 px above the slot (${r2},${g2},${b2}), the hairline is 1 px`);
  }
});

test('glyph atlas is 4 x 3 cells of 256', () => {
  const info = imageInfo(readFileSync(join(root, 'glyphs/drops.png')));
  assert.deepEqual([info.w, info.h], [4 * 256, 3 * 256]);
  assert.equal(DROP_NAMES.length, 12);
});

test('no unlisted files in shipped folders', () => {
  const listed = new Set(kit.map((r) => r.path));
  const extra = SHIPPED.flatMap((d) => walk(join(root, d))).filter((p) => !listed.has(p));
  assert.deepEqual(extra, [], 'every shipped art file is in ARTKIT.md');
});

test('glb files are valid and small', () => {
  for (const r of kit.filter((k) => k.path.endsWith('.glb'))) {
    const buf = readFileSync(join(root, r.path));
    assert.ok(buf.length < GLB_MAX, `${r.path} is ${buf.length} bytes, limit ${GLB_MAX}`);
    const gltf = readGlb(buf);
    assert.equal(gltf.asset.version, '2.0');
    const mats = (gltf.materials || []).map((m) => m.name);
    assert.ok(mats.includes('titanium'), `${r.path} has material titanium`);
    for (const m of mats) assert.ok(BOSS_MATERIALS.includes(m), `${r.path} material ${m} is one of ${BOSS_MATERIALS}`);
    // `core` (C's crackle hot-core) is The Core's sphere only, behind its petals
    if (!r.path.endsWith('/core.glb')) assert.ok(!mats.includes('core'), `${r.path} uses no core material`);
    const nodes = (gltf.nodes || []).map((n) => n.name);
    const id = r.path.slice('models/'.length, -'.glb'.length);
    const want = [...(BOSS_PARTS[id] || []).map((p) => p.name), ...(BOSS_DRESSING[id] || [])];
    assert.ok(want.length > 0, `${id} is a boss in src/content/bosses.js`);
    for (const n of want) assert.ok(nodes.includes(`part-${n}`), `${r.path} has node part-${n}`);
  }
});

test('boss meshes carry UVs so C\'s brushed titanium and obsidian maps apply', () => {
  for (const r of kit.filter((k) => k.path.endsWith('.glb'))) {
    const buf = readFileSync(join(root, r.path));
    const gltf = readGlb(buf);
    const jsonLen = buf.readUInt32LE(12);
    const bin = buf.subarray(20 + jsonLen + 8);
    for (const mesh of gltf.meshes) {
      for (const p of mesh.primitives) {
        const mat = gltf.materials[p.material].name;
        const where = `${r.path} ${mesh.name} (${mat})`;
        assert.ok(p.attributes.TEXCOORD_0 !== undefined, `${where} has TEXCOORD_0`);
        const a = gltf.accessors[p.attributes.TEXCOORD_0];
        assert.equal(a.type, 'VEC2', `${where} UV is VEC2`);
        assert.equal(a.componentType, 5126, `${where} UV is float`);
        assert.equal(a.count, gltf.accessors[p.attributes.POSITION].count, `${where} one UV per vertex`);
        // a mesh with one shared UV samples a single texel: the map would render flat
        const bv = gltf.bufferViews[a.bufferView];
        const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
        const stride = bv.byteStride || 8;
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < a.count; i++) {
          const u = bin.readFloatLE(off + i * stride);
          lo = Math.min(lo, u);
          hi = Math.max(hi, u);
        }
        if (mat === 'titanium' || mat === 'matte') assert.ok(hi - lo > 0.5, `${where} UVs span ${(hi - lo).toFixed(2)} repeats across`);
      }
    }
  }
});

/** Every triangle of a .glb as { mat, node, a, b, c } (three.js axes; node translations applied). */
function glbTriangles(buf) {
  const gltf = readGlb(buf);
  const jsonLen = buf.readUInt32LE(12);
  const bin = buf.subarray(20 + jsonLen + 8);
  const out = [];
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    assert.ok(!node.rotation && !node.scale, `${node.name} carries no rotation or scale (C drives it)`);
    const t = node.translation || [0, 0, 0];
    for (const p of gltf.meshes[node.mesh].primitives) {
      assert.ok(p.mode === undefined || p.mode === 4, `${node.name}: triangles only`);
      const pa = gltf.accessors[p.attributes.POSITION];
      const pv = gltf.bufferViews[pa.bufferView];
      const po = (pv.byteOffset || 0) + (pa.byteOffset || 0);
      const ps = pv.byteStride || 12;
      const vert = (i) => [0, 1, 2].map((k) => bin.readFloatLE(po + i * ps + k * 4) + t[k]);
      const ia = gltf.accessors[p.indices];
      const iv = gltf.bufferViews[ia.bufferView];
      const io = (iv.byteOffset || 0) + (ia.byteOffset || 0);
      const size = { 5121: 1, 5123: 2, 5125: 4 }[ia.componentType];
      const index = (k) => (size === 1 ? bin[io + k] : size === 2 ? bin.readUInt16LE(io + k * 2) : bin.readUInt32LE(io + k * 4));
      const mat = gltf.materials[p.material].name;
      for (let k = 0; k + 2 < ia.count; k += 3) out.push({ mat, node: node.name, a: vert(index(k)), b: vert(index(k + 1)), c: vert(index(k + 2)) });
    }
  }
  return out;
}

const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];

// Every camera position the game can reach relative to the boss anchor (tools/art/bosslib.py CAM_BOX):
// a face that none of the eight corners sees is never drawn by a single-sided material.
const CAM_BOX = [[-1000, 1000], [-600, 600], [1000, 6000]];
const CAM_CORNERS = CAM_BOX[0].flatMap((x) => CAM_BOX[1].flatMap((y) => CAM_BOX[2].map((z) => [x, y, z])));

test('boss meshes ship no triangle the camera can never see, and none of zero area', () => {
  for (const r of kit.filter((k) => k.path.endsWith('.glb'))) {
    const tris = glbTriangles(readFileSync(join(root, r.path)));
    let hidden = 0, flat = 0;
    for (const { a, b, c } of tris) {
      const n = cross(sub(b, a), sub(c, a));
      const area2 = Math.hypot(...n);
      if (area2 < 2e-2) { flat++; continue; }
      if (CAM_CORNERS.every((p) => { const d = sub(p, a); return d[0] * n[0] + d[1] * n[1] + d[2] * n[2] <= 0; })) hidden++;
    }
    assert.equal(flat, 0, `${r.path}: ${flat} zero-area triangles`);
    assert.equal(hidden, 0, `${r.path}: ${hidden} of ${tris.length} triangles face away from every camera`);
  }
});

/** A boss level's world, its anchor and the box of each brick group (field units, y down). */
function bossWorld(def) {
  const w = createWorld({ level: def, seed: 1, systems: { content: createContent() } });
  const B = w.bricks;
  const groups = {};
  for (let i = 0; i < B.count; i++) {
    if (!B.alive[i] || !(B.flags[i] & BF.BOSS)) continue;
    const g = (groups[B.group[i]] ||= { lo: [Infinity, Infinity], hi: [-Infinity, -Infinity] });
    g.lo[0] = Math.min(g.lo[0], B.x[i] - B.w[i] / 2); g.hi[0] = Math.max(g.hi[0], B.x[i] + B.w[i] / 2);
    g.lo[1] = Math.min(g.lo[1], B.y[i] - B.h[i] / 2); g.hi[1] = Math.max(g.hi[1], B.y[i] + B.h[i] / 2);
  }
  return { w, boss: w.boss, groups, mode: def.mode };
}

const tris = Object.fromEntries(['stoker', 'crucible', 'core'].map((id) => [id, glbTriangles(readFileSync(join(root, `models/${id}.glb`)))]));
const ptsOf = (ts) => ts.flatMap((t) => [t.a, t.b, t.c]);
const range = (ps, k) => [Math.min(...ps.map((p) => p[k])), Math.max(...ps.map((p) => p[k]))];

// ART 15.5 F1: real hardware, not flat toys
test('boss meshes are 120 units deep or more and 4k to 15k triangles (ART 15.5 F1)', () => {
  for (const [id, ts] of Object.entries(tris)) {
    const [z0, z1] = range(ptsOf(ts), 2);
    assert.ok(z1 - z0 >= 120, `${id} is ${(z1 - z0).toFixed(0)} units deep (z ${z0.toFixed(0)} .. ${z1.toFixed(0)}), at least 120`);
    assert.ok(ts.length >= 4000 && ts.length <= 15000, `${id} has ${ts.length} triangles, 4k to 15k`);
  }
});

// The heat is inside, never on a surface (ART 1, 14, 15.5 F1): the only glowing materials (`ember`,
// and `core` on The Core's sphere) sit 30 units or more behind the brick plane, inside an opening.
test('boss heat sits only inside openings: the Stoker\'s slot, the Crucible\'s bowl, behind the Core\'s petals', () => {
  const hot = (id) => tris[id].filter((t) => t.mat === 'ember' || t.mat === 'core');
  for (const id of ['stoker', 'crucible', 'core']) {
    const ps = ptsOf(hot(id));
    assert.ok(ps.length > 0, `${id} has its heat`);
    assert.ok(range(ps, 2)[1] <= -30, `${id}: heat front at z ${range(ps, 2)[1].toFixed(1)}, 30 or more behind the brick plane`);
  }
  // The Stoker: no eyes, no port: every glowing point lies inside the one mouth slot (the open row
  // of level 10 around the core cell), 6:1 or wider
  const st = bossWorld(getLevel(10));
  const coreBox = st.groups[2];
  const slot = { x0: -180, x1: 180, y0: -(coreBox.hi[1] - st.boss.y), y1: -(coreBox.lo[1] - st.boss.y) };
  assert.ok((slot.x1 - slot.x0) / (slot.y1 - slot.y0) >= 6, 'the mouth slot is 6:1 or wider');
  for (const p of ptsOf(hot('stoker'))) {
    assert.ok(p[0] >= slot.x0 && p[0] <= slot.x1 && p[1] >= slot.y0 && p[1] <= slot.y1,
      `stoker heat at (${p[0].toFixed(0)}, ${p[1].toFixed(0)}) lies outside the mouth slot`);
  }
  // The Crucible: the pool is no wider than 1.3x the W block (120)
  const cps = ptsOf(hot('crucible'));
  const span = Math.max(range(cps, 0)[1] - range(cps, 0)[0], range(cps, 1)[1] - range(cps, 1)[0]);
  assert.ok(span <= 1.3 * 120, `crucible pool ${span.toFixed(0)} across, at most 156`);
  // The Core: seen from the front, the stage 1 petals cover the sphere but for their three gaps
  const disc = ptsOf(hot('core'));
  const R = Math.max(range(disc, 0)[1], -range(disc, 0)[0]);
  assert.ok(R >= 88 && R <= 92, `core sphere is ${(2 * R).toFixed(0)} across (180)`);
  const N = 2 * Math.ceil(R) + 1, off = Math.ceil(R);
  const covered = new Uint8Array(N * N);
  for (const t of tris.core.filter((q) => q.node === 'part-shell')) {
    const [a, b, c] = [t.a, t.b, t.c];
    const d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(d) < 1e-9) continue;
    for (let y = Math.ceil(Math.min(a[1], b[1], c[1])); y <= Math.max(a[1], b[1], c[1]); y++) {
      for (let x = Math.ceil(Math.min(a[0], b[0], c[0])); x <= Math.max(a[0], b[0], c[0]); x++) {
        if (x < -off || x > off || y < -off || y > off) continue;
        const u = ((b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y)) / d;
        const v = ((c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y)) / d;
        if (u >= 0 && v >= 0 && u + v <= 1) covered[(y + off) * N + x + off] = 1;
      }
    }
  }
  let inDisc = 0, open = 0;
  for (let y = -off; y <= off; y++) {
    for (let x = -off; x <= off; x++) {
      if (x * x + y * y > R * R) continue;
      inDisc++;
      if (!covered[(y + off) * N + x + off]) open++;
    }
  }
  const share = open / inDisc;
  assert.ok(share >= 0.05 && share <= 0.16, `${(share * 100).toFixed(1)}% of the sphere shows between the stage 1 petals (three 12-degree gaps: 5 to 16%)`);
});

// Every node stays inside the arena wherever B puts the boss: The Stoker sways 60 each way (its
// cells already reach x +-300, so the cowl must not), The Core's stage 2 sits at x 510.
test('boss meshes stay inside the arena at every anchor (Stoker sway included)', () => {
  const half = range(ptsOf(tris.stoker), 0);
  assert.ok(Math.max(-half[0], half[1]) + STOKER.SWAY <= FIELD.W / 2,
    `stoker half-width ${Math.max(-half[0], half[1]).toFixed(1)} + sway ${STOKER.SWAY} must be ${FIELD.W / 2} or less`);
  const turning = new Set(['part-ring', 'part-shell', 'part-shell-s2', 'part-shell-s3', 'part-outer-shell']);
  const shown = { 1: ['part-shell'], 2: ['part-shell-s2'], 3: ['part-shell-s3', 'part-outer-shell'] };
  for (const def of [getLevel(10), getLevel(20), ...stagesOf(getLevel(30))]) {
    const { boss, mode } = bossWorld(def);
    const id = boss.id;
    const sway = id === 'stoker' ? STOKER.SWAY : 0;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, rMax = 0;
    for (const t of tris[id]) {
      if (id === 'core' && t.node.startsWith('part-shell') || t.node === 'part-outer-shell') {
        if (!(shown[boss.phase] || []).includes(t.node)) continue;
      }
      for (const p of [t.a, t.b, t.c]) {
        if (turning.has(t.node)) {
          const r = Math.hypot(p[0], p[1]);
          rMax = Math.max(rMax, r);
          x0 = Math.min(x0, -r); x1 = Math.max(x1, r); y0 = Math.min(y0, -r); y1 = Math.max(y1, r);
        } else {
          const drop = t.node === 'part-jaw' ? 60 : 0;          // the jaw drops by open * 60
          x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
          y0 = Math.min(y0, p[1] - drop); y1 = Math.max(y1, p[1]);
          rMax = Math.max(rMax, Math.hypot(p[0], p[1]));
        }
      }
    }
    const where = `${def.id} (${mode}, anchor ${boss.x.toFixed(0)}, ${boss.y.toFixed(0)})`;
    assert.ok(boss.x + x0 - sway >= 0 && boss.x + x1 + sway <= FIELD.W, `${where}: x ${(boss.x + x0 - sway).toFixed(0)} .. ${(boss.x + x1 + sway).toFixed(0)} inside 0 .. ${FIELD.W}`);
    // only the Crucible's hangers may reach into the top wall they hang from
    assert.ok(boss.y - y1 >= -30 && boss.y - y0 <= FIELD.H, `${where}: y ${(boss.y - y1).toFixed(0)} .. ${(boss.y - y0).toFixed(0)} inside the field`);
    if (mode === 'ring') assert.ok(rMax <= RING.R_BRICKS, `${where}: reaches r ${rMax.toFixed(0)}, inside the brick radius ${RING.R_BRICKS}`);
  }
});

/** Field bearings (radians, clockwise on screen) of a ring's open gap, as B lays the plates out. */
function gapArc(r, slots, gaps) {
  const step = (2 * Math.PI) / slots;
  const half = Math.atan(15 / r);
  const sorted = [...gaps].sort((a, b) => a - b);
  return [(sorted[0] - 1) * step + half, (sorted[sorted.length - 1] + 1) * step - half];
}

test('turning boss parts leave B\'s ring gaps open (Crucible ring, Core outer keepers)', () => {
  const checks = [
    ['crucible', 'part-ring', CRUCIBLE_SPEC.rings[0]],
    ['core', 'part-outer-shell', CORE_SPECS[3].rings[1]],
  ];
  for (const [id, node, ring] of checks) {
    const [b0, b1] = gapArc(ring.r, ring.slots, ring.gaps);
    for (const p of ptsOf(tris[id].filter((t) => t.node === node))) {
      // mesh angle a (counter-clockwise, y up) is field bearing -a
      let b = -Math.atan2(p[1], p[0]);
      while (b < b0 - 1e-6) b += 2 * Math.PI;
      const inside = b > b0 + 0.01 && b < b1 - 0.01;
      assert.ok(!inside, `${id} ${node}: a point at bearing ${(b * 180 / Math.PI).toFixed(1)} lies over the gap ${(b0 * 180 / Math.PI).toFixed(1)} .. ${(b1 * 180 / Math.PI).toFixed(1)}`);
    }
  }
  // and the Crucible's plates close up to B's gap: its open arc is B's, not wider (a rebuild reads
  // B's gaps from orbit.js; this fails when B changes them and the mesh was not rebuilt)
  const ring = CRUCIBLE_SPEC.rings[0];
  const [b0, b1] = gapArc(ring.r, ring.slots, ring.gaps);
  const bs = ptsOf(tris.crucible.filter((t) => t.node === 'part-ring')).map((p) => ((-Math.atan2(p[1], p[0])) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
  let widest = bs[0] + 2 * Math.PI - bs[bs.length - 1];
  for (let i = 1; i < bs.length; i++) widest = Math.max(widest, bs[i] - bs[i - 1]);
  const deg = (v) => (v * 180 / Math.PI).toFixed(1);
  assert.ok(widest <= b1 - b0 + (2 * Math.PI) / 180, `crucible ring opens ${deg(widest)} degrees, B's gap is ${deg(b1 - b0)}`);
});

/** The game's own code and pages: what can load a shipped art file. */
function gameText() {
  const files = [...walk(join(root, 'src')), ...walk(join(root, 'css')), 'index.html', 'manifest.webmanifest']
    .filter((f) => /\.(m?js|css|html|webmanifest)$/.test(f) && existsSync(join(root, f)));
  return files.map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
}

/** Loaded by path, or by a templated path (its folder and its name both appear, as in `models/${id}.glb`). */
function loadedBy(text, path) {
  if (text.includes(path)) return true;
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  const stem = path.slice(dir.length).replace(/\.\w+$/, '');
  return text.includes(dir) && new RegExp(`['"\`]${stem}['"\`]`).test(text);
}

const bytes = (dir) => walk(join(root, dir)).reduce((n, p) => n + statSync(join(root, p)).size, 0);

test('F\'s shipped files are all loaded by the game and stay small', () => {
  const text = gameText();
  const sources = new Set(DROP_NAMES.map((n) => `glyphs/${n}.png`)); // atlas sources (ARTKIT.md)
  for (const p of ['glyphs', 'models', 'icons'].flatMap((d) => walk(join(root, d)))) {
    if (sources.has(p)) continue;
    assert.ok(loadedBy(text, p), `${p} ships but nothing in src/, css/, index.html or the manifest loads it`);
  }
  const f = bytes('glyphs') + bytes('models') + bytes('icons');
  assert.ok(f < 1200 * 1024, `glyphs + models + icons are ${Math.round(f / 1024)} KB, budget 1200 KB`);
});

// textures/ and img/ belong to R (FILEMAP). F never fails a merge on R's files: this only prints
// advice (unloaded files, payload over ART 15.4 R11's 2.5 MB for textures/ plus img/), so R1's
// crackle_mask.png at 1024 or a file C loads only after R1 never blocks anyone.
test('textures/ and img/ (R\'s): advice only, never a failure', () => {
  const text = gameText();
  const unused = walk(join(root, 'textures')).filter((p) => !loadedBy(text, p));
  const t = bytes('textures') + bytes('img');
  const notes = [];
  if (unused.length) notes.push(`not loaded by src/ yet: ${unused.join(', ')}`);
  if (t > 2.5 * 1048576) notes.push(`textures/ + img/ are ${(t / 1048576).toFixed(2)} MB (R11 budget 2.5 MB)`);
  if (notes.length) console.log(`  note for R (f-kit, advice only): ${notes.join('; ')}`);
});

test('Blender scripts refuse to run outside headless Blender (the GUI window is shared)', () => {
  const dir = join(root, 'tools/art');
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.py'))) {
    const src = readFileSync(join(dir, name), 'utf8');
    if (!/^import bpy\b/m.test(src)) continue;
    assert.match(src, /if not bpy\.app\.background:\s*\n\s*raise SystemExit/, `tools/art/${name} guards bpy.app.background`);
  }
  for (const name of readdirSync(dir).filter((n) => /^boss_\w+\.py$/.test(n))) {
    assert.match(readFileSync(join(dir, name), 'utf8'), /^import bosslib\b/m, `tools/art/${name} goes through bosslib (guarded)`);
  }
});

test('ARTKIT.READY lists only final files', () => {
  const ready = join(root, 'ARTKIT.READY');
  if (!existsSync(ready)) return;
  const byPath = new Map(kit.map((r) => [r.path, r]));
  const lines = readFileSync(ready, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const line of lines) {
    const path = line.split(/\s+/)[0];
    const row = byPath.get(path);
    assert.ok(row, `${path} in ARTKIT.READY is listed in ARTKIT.md`);
    assert.equal(row.status, 'final', `${path} is marked final in ARTKIT.md`);
  }
  for (const r of kit.filter((k) => k.status === 'final')) {
    assert.ok(lines.some((l) => l.split(/\s+/)[0] === r.path), `final ${r.path} is in ARTKIT.READY`);
  }
});
