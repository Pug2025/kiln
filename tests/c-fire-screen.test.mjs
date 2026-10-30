import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { test, assert, near } from './lib.mjs';
import * as THREE from '../vendor/three/0.160.0/build/three.module.js';
import { FIELD, PADDLE, RING } from '../src/core/constants.js';
import { paddleBloomRadius } from '../src/render/ball-bloom.js';
import { paddleSourceRadius, protectBed } from '../src/render/paddle-source.js';

const threeURL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const { createFire } = await import('../src/render/fire.js');
const { FIRE_FRAG } = await import('../src/render/shaders.js');

test('fire planes retain their world band, UVs and normals with constant identity object transforms', () => {
  const scene = new THREE.Scene(), fire = createFire(scene);
  for (const [mesh, halfWidth, bottom, z] of [[fire.mouth, FIELD.W / 2, -612, -30],
    [fire.deep, (FIELD.W + 200) / 2, -702, -230]]) {
    mesh.updateMatrixWorld(true);
    assert.ok(mesh.matrixWorld.equals(new THREE.Matrix4()));
    const p = mesh.geometry.attributes.position, n = mesh.geometry.attributes.normal;
    const uv = mesh.geometry.attributes.uv, oldPlane = new THREE.PlaneGeometry(halfWidth * 2, -330 - bottom);
    assert.deepEqual([...uv.array], [...oldPlane.attributes.uv.array], 'same fire sampling coordinates');
    assert.deepEqual([...n.array], [...oldPlane.attributes.normal.array], 'translation leaves normals intact');
    const xs = [], ys = [];
    for (let i = 0; i < p.count; i++) { xs.push(p.getX(i)); ys.push(p.getY(i)); assert.equal(p.getZ(i), z); }
    assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [-halfWidth, halfWidth, bottom, -330]);
    const values = [...p.array], version = p.version;
    for (let frame = 0; frame < 120; frame++) fire.update(frame / 60, 1 / 60);
    assert.equal(p.version, version); assert.deepEqual([...p.array], values, 'fire animation does not rewrite static positions');
  }
});

// Exercise the actual renderer helper without creating a browser or a fake WebGL renderer.
// Its real camera, projection and hull helper run; only post's setter/draw boundary is observed.
const renderer = readFileSync(new URL('../src/render/renderer.js', import.meta.url), 'utf8');
const body = renderer.match(/function bloomMask\(w, alpha\) \{([\s\S]*?)\n  \}/)[1];
const updateGuard = new Function('w', 'alpha', 'width', 'height', 'pr', 'projA', 'projB',
  'padA', 'padB', 'camera', 'rig', 'bloomProjection', 'post', 'actors', 'fire', 'menuOn', 'kiln', 'paddleSourceRadius', body);

function fixture(width = 390, height = 844, pr = 2, mode = 'bottom', lean = 0) {
  const scene = new THREE.Scene(), fire = createFire(scene);
  const camera = new THREE.PerspectiveCamera(35, width / height, 10, 8000);
  camera.position.set(lean * 55, 150 + lean * 20, 1800);
  camera.lookAt(lean * -10, -30, 0); camera.rotateZ(lean * .08); camera.updateMatrixWorld(true);
  const p = { x: 360, y: 1000, w: 210, h: PADDLE.H, angle: Math.PI / 2, span: 70 * Math.PI / 180 };
  const padA = new THREE.Vector3(), padB = new THREE.Vector3();
  if (mode === 'ring') {
    p.x = RING.CX + Math.cos(p.angle) * RING.R_PADDLE;
    p.y = RING.CY + Math.sin(p.angle) * RING.R_PADDLE;
    for (const [point, a] of [[padA, p.angle - p.span / 2], [padB, p.angle + p.span / 2]]) {
      point.set(RING.CX + Math.cos(a) * RING.R_PADDLE - FIELD.W / 2,
        FIELD.H / 2 - RING.CY - Math.sin(a) * RING.R_PADDLE, 0);
    }
  } else if (mode === 'left') {
    p.x = 40; p.y = 540;
    padA.set(p.x - FIELD.W / 2, FIELD.H / 2 - p.y + p.w / 2, 0);
    padB.set(padA.x, FIELD.H / 2 - p.y - p.w / 2, 0);
  } else {
    padA.set(p.x - p.w / 2 - FIELD.W / 2, FIELD.H / 2 - p.y, 0);
    padB.set(p.x + p.w / 2 - FIELD.W / 2, padA.y, 0);
  }
  const w = { paddle: p, level: { mode } }, calls = [];
  const post = { bloomOn: true, paddleBloomRadius, setBloomMask: (...args) => calls.push(args),
    setBallMasks: () => calls.push('balls') };
  const actors = { pad: { rotation: { z: (mode === 'left' ? -Math.PI / 2 : 0) + lean * .04 } } };
  const kiln = { bedGuard: protectBed(new THREE.MeshBasicMaterial()) };
  const run = (menu = false) => updateGuard(w, .5, width, height, pr,
    new THREE.Vector3(), new THREE.Vector3(), padA, padB, camera, { fit: { rect: { scale: 1 } } },
    new THREE.Matrix4(), post, actors, fire, menu, kiln, paddleSourceRadius);
  return { fire, camera, padA, padB, post, calls, run, kiln };
}

test('fire screen uniforms default off, retain their buffers, and clear across world reset and menus', () => {
  const f = fixture(), materials = [f.fire.main, f.fire.backM];
  const buffers = materials.map(m => ['uPadA', 'uPadB', 'uScreenA', 'uScreenB'].map(n => m.uniforms[n].value));
  for (const m of materials) assert.equal(m.uniforms.uScreenStrength.value, 0);
  f.fire.flare(1, .5, true);
  for (let i = 0; i < 10; i++) {
    f.fire.setLegibility(-490, i / 3, -400, 120 + i / 7, -400, 8);
    f.run();
    for (let k = 0; k < 2; k++) {
      const u = materials[k].uniforms;
      ['uPadA', 'uPadB', 'uScreenA', 'uScreenB'].forEach((n, j) => {
        assert.ok(u[n].value instanceof Float32Array);
        assert.equal(u[n].value, buffers[k][j], 'setters retain fixed GPU-upload buffers');
      });
      assert.deepEqual([...u.uPadA.value], [i / 3, -400].map(Math.fround), 'same Float32 GPU values as Vector2');
      assert.equal(u.uScreenStrength.value, .95);
      assert.equal(u.uBand.value, .65);
      assert.equal(u.uFlareClipY.value, -340, 'screen guard does not change the existing climb clip');
    }
  }
  f.fire.reset();
  for (const m of materials) assert.equal(m.uniforms.uScreenStrength.value, 0, 'new world has no previous screen guard');
  f.run(); f.run(true);
  for (const m of materials) assert.equal(m.uniforms.uScreenStrength.value, 0, 'menu draws retain original fire');
  f.run(false);
  for (const m of materials) assert.equal(m.uniforms.uScreenStrength.value, .95, 'gameplay refreshes after a menu');
  f.fire.setLite(true); assert.equal(f.fire.deep.visible, false);
  f.fire.setLite(false); assert.equal(f.fire.deep.visible, true);
  for (const m of materials) assert.equal(m.uniforms.uScreenStrength.value, .95);
});

test('the actual after-camera helper gives Full and Lite the same buffer-space capsule and current pose', () => {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) for (const pr of [1, 2]) {
    for (const mode of ['bottom', 'left', 'ring']) for (const lean of [-1, 0, 1]) {
      const f = fixture(width, height, pr, mode, lean);
      f.run();
      const a = f.padA.clone().project(f.camera), b = f.padB.clone().project(f.camera);
      const expectedA = [(a.x + 1) * width * pr / 2, (a.y + 1) * height * pr / 2];
      const expectedB = [(b.x + 1) * width * pr / 2, (b.y + 1) * height * pr / 2];
      const scale = Math.hypot(expectedB[0] - expectedA[0], expectedB[1] - expectedA[1]) / f.padA.distanceTo(f.padB);
      const mask = f.calls[0], u = f.fire.main.uniforms;
      const bedA = f.kiln.bedGuard.uniforms.uBedA.value, bedB = f.kiln.bedGuard.uniforms.uBedB.value;
      assert.deepEqual([...bedA.slice(0, 2)], expectedA.map(Math.fround));
      assert.deepEqual([...bedB.slice(0, 2)], expectedB.map(Math.fround));
      assert.ok(bedA[2] >= mask[4], 'source protection contains the actual drawn body');
      assert.equal(bedB[2], 1);
      assert.deepEqual([...u.uScreenA.value], expectedA.map(Math.fround));
      assert.deepEqual([...u.uScreenB.value], expectedB.map(Math.fround));
      near(u.uScreenR.value, mask[4] + 8 * scale, 1e-10, 'same actual hull plus eight field units');
      near(u.uScreenF.value, 80 * scale, 1e-10);
      for (const name of ['uScreenA', 'uScreenB']) {
        assert.deepEqual([...f.fire.backM.uniforms[name].value], [...u[name].value], 'both fire depths share screen position');
      }
      f.post.bloomOn = false; f.calls.length = 0; f.run();
      assert.equal(f.calls.length, 0, 'Lite adds no post draw or post setter work');
      assert.deepEqual([...u.uScreenA.value], expectedA.map(Math.fround));
      assert.equal(u.uScreenStrength.value, .95, 'source guard runs even when bloom is disabled');
      assert.equal(bedB[2], 1, 'bed protection also refreshes with Lite bloom disabled');
      f.run(true); assert.equal(bedB[2], 0, 'menu restores the original bed');
      f.run(false); assert.equal(bedB[2], 1);
      f.camera.position.x += 40; f.camera.updateMatrixWorld(true); f.run();
      assert.notDeepEqual([...u.uScreenA.value], expectedA.map(Math.fround), 'camera changes cannot leave stale screen coordinates');
    }
  }
});

test('the emitted fire attenuation combines guards by maximum and preserves distant source pixels', () => {
  const expression = FIRE_FRAG.match(/dim = ([^;]+);/)[1];
  const attenuation = new Function('uBand', 'nearPad', 'uScreenStrength', 'screenBand', 'max', `return ${expression};`);
  const gain = (world, screen, strength = .95) => attenuation(.65, world, strength, () => screen, Math.max);
  near(gain(0, 1), .05, 1e-12, 'screen body keeps five percent of the direct source');
  assert.equal(gain(0, 0), 1, 'outside both guards is unchanged');
  for (const world of [0, .25, .5, 1]) {
    near(gain(world, 0), 1 - .65 * world, 1e-12, 'outside screen mask retains exact world dim');
    near(gain(world, 1, 0), 1 - .65 * world, 1e-12, 'default/menu screen guard is inert');
    for (const screen of [0, .25, .5, 1]) {
      near(gain(world, screen), Math.min(1 - .65 * world, 1 - .95 * screen), 1e-12,
        'overlap never compounds the two attenuations');
    }
  }
  const featherExpression = FIRE_FRAG.match(/float screenBand\(\)\{[\s\S]*?return ([^;]+);/)[1]
    .replace('length(pa - ba * k)', 'distance');
  const smoothstep = (lo, hi, x) => { const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
  const feather = new Function('uScreenR', 'uScreenF', 'distance', 'smoothstep', `return ${featherExpression};`);
  assert.equal(feather(12, 80, 0, smoothstep), 1);
  assert.equal(feather(12, 80, 12, smoothstep), 1);
  near(feather(12, 80, 52, smoothstep), .5, 1e-12);
  assert.equal(feather(12, 80, 92, smoothstep), 0);
  assert.equal(feather(12, 80, 300, smoothstep), 0);
});
