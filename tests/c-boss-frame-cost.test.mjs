// Item 21 (Oct 27): the boss crack overlay (core-damage.js) allocated about 0.18 KB a frame per crack
// shown, because it called Vector3.set, Quaternion.setFromAxisAngle, Matrix4.compose, Color.lerp and
// Math.hypot for every segment and V8 boxes each fractional argument of a call it does not inline
// (level 30 went over the 32 KB frame budget in the browser gate). frame() now writes the instance
// arrays itself. These tests hold both halves: what it draws is what the three.js calls drew, and a
// frame allocates nothing. Also: the brick wall's ring shape is built up front, not in the frame
// that starts The Core's last stage.
import { register } from 'node:module';
import v8 from 'node:v8';
import vm from 'node:vm';
import { test, assert } from './lib.mjs';
import { getLevel, stagesOf } from '../src/levels/index.js';
import { createWorld } from '../src/core/world.js';
import { makeSystems } from '../src/systems.js';
import { createRun } from '../src/economy/economy.js';
import { BF, BRICK, FIELD } from '../src/core/constants.js';
import { LOOK } from '../src/render/look.js';
import { cracksShown, CRACK_SEGS } from '../src/render/boss-feedback.js';

const threeURL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
const addonURL = new URL('../vendor/three/0.160.0/examples/jsm/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ${JSON.stringify(addonURL)} + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const THREE = await import(threeURL);
const { PAL } = await import('../src/render/materials.js');
const { createCoreDamage, CRACK_GROW_S, CRACK_FRESH_S, BLOCK_FLASH_S, SMALL_CORE_PX } = await import('../src/render/core-damage.js');

const HW = FIELD.W / 2, HH = FIELD.H / 2;

function bossWorld(levelN, stage = 0) {
  const def = stagesOf(getLevel(levelN))[stage];
  return createWorld({ level: def, seed: 5, run: createRun({ seed: 5, levelN }), systems: makeSystems() });
}

function coreOf(w) {
  const B = w.bricks;
  for (let i = 0; i < B.count; i++) if (B.alive[i] && B.type[i] === BRICK.WEAK && (B.flags[i] & BF.BOSS)) return i;
  return -1;
}

/**
 * The overlay as item 20 drew it, through three.js objects (the reference for the same look): its
 * reveal times, crack widths, rotation, scale and colours, step for step.
 */
function reference() {
  const fresh = PAL.heatHi.clone().multiplyScalar(0.92);
  const ember = PAL.heatLo.clone().lerp(PAL.heatHi, 0.5).multiplyScalar(0.88);
  const coldEmber = PAL.heatLo.clone().multiplyScalar(0.5);
  const ashCol = new THREE.Color(0x5f5d5a);
  const tmp = new THREE.Color(), m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const q = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
  const zCut = LOOK.SHELL.d / 2 + 0.7, zHeat = zCut + 0.2;
  const revealT = new Float32Array(24).fill(-1e9);
  let shown = -1, blockT = -1e9;
  return {
    blocked(t) { blockT = t; },
    frame(w, plan, alpha, t, cold, read) {
      const B = w.bricks, core = coreOf(w);
      const want = cracksShown(w.boss);
      if (shown < 0) shown = want;
      if (want > shown) for (let k = shown; k < want; k++) revealT[k] = t;
      shown = want;
      const moving = (B.flags[core] & (BF.MOVING | BF.FALLING)) !== 0;
      const cx = (moving ? B.px[core] + (B.x[core] - B.px[core]) * alpha : B.x[core]) - HW;
      const cy = HH - (moving ? B.py[core] + (B.y[core] - B.py[core]) * alpha : B.y[core]);
      const px = read.small || B.w[core] * read.scale < SMALL_CORE_PX ? 1 / read.scale : 0;
      const wHeat = Math.max(1.7, 1.5 * px), wCut = wHeat + Math.max(2.6, 1.5 * px);
      const b = t - blockT, dull = b >= 0 && b < BLOCK_FLASH_S ? 1 - b / BLOCK_FLASH_S : 0;
      const out = [];
      for (let s = 0; s < plan.length / 5; s++) {
        const k = plan[s * 5 + 4];
        if (k >= shown) continue;
        const age = t - revealT[k];
        const grow = Math.min(1, 0.25 + 0.75 * Math.max(0, age / CRACK_GROW_S));
        const x0 = plan[s * 5], y0 = plan[s * 5 + 1], x1 = plan[s * 5 + 2], y1 = plan[s * 5 + 3];
        const dx = (x1 - x0) * grow, dy = (y1 - y0) * grow;
        const l = Math.hypot(dx, dy);
        if (l < 0.01) continue;
        q.setFromAxisAngle(zAxis, Math.atan2(-dy, dx));
        pos.set(cx + x0 + dx / 2, cy - (y0 + dy / 2), zCut);
        scl.set(l + wCut * 0.6, wCut, 1);
        m4.compose(pos, q, scl);
        const cut = m4.toArray();
        pos.z = zHeat;
        scl.set(l, wHeat, 1);
        m4.compose(pos, q, scl);
        const heat = m4.toArray();
        const f = age < CRACK_FRESH_S ? 1 - age / CRACK_FRESH_S : 0;
        tmp.copy(cold ? coldEmber : ember).lerp(fresh, f);
        if (dull > 0) tmp.lerp(ashCol, dull);
        out.push({ cut, heat, colour: tmp.toArray() });
      }
      return out;
    },
  };
}

function compare(damage, ref, w, alpha, t, cold, read, label) {
  damage.frame(w, alpha, t, cold);
  const want = ref.frame(w, damage.plan, alpha, t, cold, read);
  const cuts = damage.group.getObjectByName('boss-core-cuts');
  const heat = damage.group.getObjectByName('boss-core-cracks');
  assert.equal(heat.count, want.length, `${label}: ${want.length} segments drawn`);
  assert.equal(cuts.count, want.length, `${label}: one dark cut under each`);
  const f32 = (v) => Math.fround(v);
  // the arrays are Float32; the only arithmetic difference is Math.hypot vs Math.sqrt (an ulp)
  const near = (a, b) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(b));
  const cutCol = new THREE.Color(0x07080a);
  for (let n = 0; n < want.length; n++) {
    for (let e = 0; e < 16; e++) {
      const gc = cuts.instanceMatrix.array[n * 16 + e], gh = heat.instanceMatrix.array[n * 16 + e];
      assert.ok(near(gc, f32(want[n].cut[e])), `${label}: cut ${n} matrix[${e}] ${gc} vs ${want[n].cut[e]}`);
      assert.ok(near(gh, f32(want[n].heat[e])), `${label}: crack ${n} matrix[${e}] ${gh} vs ${want[n].heat[e]}`);
    }
    for (let c = 0; c < 3; c++) {
      assert.equal(heat.instanceColor.array[n * 3 + c], f32(want[n].colour[c]), `${label}: crack ${n} colour[${c}]`);
      assert.equal(cuts.instanceColor.array[n * 3 + c], f32(cutCol.toArray()[c]), `${label}: cut ${n} stays dark`);
    }
  }
  return want.length;
}

test('core damage: the crack overlay draws exactly what the three.js object path drew (growth, fresh, settled, cooled, ash)', () => {
  const cases = [
    { level: 30, stage: 0, read: { small: false, scale: 1.2 } },
    { level: 30, stage: 2, read: { small: false, scale: 0.45 } }, // small core: the 1.5 CSS px floor
    { level: 20, stage: 0, read: { small: true, scale: 0.8 } }, // a phone
  ];
  let drawn = 0;
  for (const c of cases) {
    const w = bossWorld(c.level, c.stage);
    const label = `L${c.level} stage ${c.stage + 1}`;
    const damage = createCoreDamage(new THREE.Group());
    damage.setWorld(w);
    damage.setReadability(c.read);
    const ref = reference();
    w.boss.hp = w.boss.hpMax - 1;
    drawn += compare(damage, ref, w, 1, 2, false, c.read, `${label} restored damage`);
    w.boss.hp = 1; // the rest open now: growing, then white-hot, then their ember
    for (const t of [3, 3.03, 3.08, 3.2, 3.5, 6]) drawn += compare(damage, ref, w, 0.5, t, false, c.read, `${label} t ${t}`);
    drawn += compare(damage, ref, w, 1, 7, true, c.read, `${label} cooled`);
    damage.blocked(8); ref.blocked(8);
    for (const t of [8, 8.1, 8.3]) drawn += compare(damage, ref, w, 1, t, true, c.read, `${label} blocked t ${t}`);
    assert.equal(damage.group.getObjectByName('boss-core-cracks').count, (w.boss.hpMax - 1) * CRACK_SEGS, `${label}: every crack shown`);
  }
  assert.ok(drawn > 200, `segments compared (${drawn})`);
});

test('the brick wall builds its ring shape up front: The Core\'s stage 3 adds no meshes after the renderer lists its pools', async () => {
  // Built on the first ring world, the shape cost the frame that ends stage 2 about 8.6 ms (Pixel 7,
  // CPU 4x; 20 ms in all) and its meshes missed the renderer's pool list, so empty ones were never
  // hidden (renderer.js takes that list once, right after createBricks).
  const { installCanvas } = await import('./fixtures/C/marks-three-stub.mjs');
  installCanvas(); // the marks' glyph atlas draws on a 2D canvas; Node has none
  const { createBricks } = await import('../src/render/bricks.js');
  const scene = new THREE.Group(), white = new THREE.MeshBasicMaterial();
  const M = { tex: { glow: null }, shell: white, cavityGlass: white, titanium: new THREE.MeshStandardMaterial(), matte: white,
    core: white, white, white70: white, white50: white, darkMetal: white };
  const wall = createBricks(scene, M);
  const pools = () => { let n = 0; scene.traverse((o) => { if (o.isInstancedMesh) n++; }); return n; };
  const listed = pools();
  for (const [levelN, stage] of [[30, 0], [30, 2], [20, 0], [30, 2]]) {
    const w = bossWorld(levelN, stage);
    wall.setWorld(w);
    wall.frame(1, 0, () => {});
    assert.equal(pools(), listed, `L${levelN} stage ${stage + 1} (${w.level.mode}): no instanced mesh created after the wall`);
  }
  assert.equal(bossWorld(30, 2).level.mode, 'ring', 'The Core\'s last stage is a ring world');
});

test('core damage: a frame of the crack overlay allocates nothing (the Crucible near the end, 11 cracks)', () => {
  let gc = null;
  try { v8.setFlagsFromString('--expose-gc'); gc = vm.runInNewContext('gc'); } catch { /* measured without */ }
  const w = bossWorld(20);
  const damage = createCoreDamage(new THREE.Group());
  damage.setWorld(w);
  damage.setReadability({ small: true, scale: 0.8 });
  w.boss.hp = 1;
  const N = 24000, CHUNK = 600, WARM = 12000;
  // frame times made up front as heap numbers in a generic array, so this loop boxes nothing itself
  // (a fractional number kept in a closure variable would cost a box a frame here)
  const ts = ['generic'];
  for (let k = 1; k <= WARM + N; k++) ts.push(1 + k / 60);
  let i = 1;
  const frames = (n, cold) => {
    for (let k = 0; k < n; k++, i++) {
      if (i % 90 === 0) damage.blocked(ts[i]); // the ash flash runs part of the time
      damage.frame(w, 0.5, ts[i], cold);
    }
  };
  frames(WARM / 2, false); // warm-up: optimised, every branch taken
  frames(WARM / 2, true);
  assert.equal(damage.group.getObjectByName('boss-core-cracks').count, 11 * CRACK_SEGS, 'eleven cracks drawn');
  if (gc) gc();
  // the sum of the heap's rises over 40 chunks (a collection in between only hides what it freed);
  // before this item: about 2 KB a frame here, so tens of megabytes
  let prev = process.memoryUsage().heapUsed, grown = 0;
  for (let n = 0; n < N; n += CHUNK) {
    frames(CHUNK, (n / CHUNK) % 2 === 1);
    const h = process.memoryUsage().heapUsed;
    if (h > prev) grown += h - prev;
    prev = h;
  }
  const perFrame = grown / N;
  console.log(`    crack overlay: ${(grown / 1024).toFixed(1)} KB heap growth over ${N} frames (${perFrame.toFixed(2)} B a frame)`);
  assert.ok(perFrame < 8, `the crack overlay allocates ${perFrame.toFixed(1)} B a frame (11 cracks)`);
}, { timeout: 60000 });
