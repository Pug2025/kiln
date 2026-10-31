// CPU geometry/ownership checks only. No projected clearance, shader pixels or timing claim.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { test, assert, near } from './lib.mjs';
import * as THREE from '../vendor/three/0.160.0/build/three.module.js';

const threeURL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
const addonURL = new URL('../vendor/three/0.160.0/examples/jsm/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ${JSON.stringify(addonURL)} + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const { createKiln } = await import('../src/render/kiln.js');
const { PAL } = await import('../src/render/materials.js');
const { LOOK } = await import('../src/render/look.js');

function fixture() {
  const scene = new THREE.Scene(), plain = new THREE.MeshBasicMaterial();
  const material = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: .75, metalness: .3, envMapIntensity: .45 });
  const kiln = createKiln(scene, { wallGlass: plain, titaniumP: plain, ribs: plain,
    pillars: material, grate: plain.clone(), tex: { glow: new THREE.Texture() } });
  const pillars = scene.getObjectByName('kiln-pillars');
  assert.ok(pillars?.isInstancedMesh, 'the named owner is the actual retained mesh');
  return { scene, kiln, pillars, material };
}

function matrixAt(mesh, index) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix;
}

function assertLegacy(pillars, material) {
  assert.equal(pillars.count, 2);
  for (let i = 0; i < 2; i++) assert.deepEqual(matrixAt(pillars, i).elements,
    new THREE.Matrix4().makeTranslation(i ? 680 : -680, 80, -460).elements);
  assert.ok(material.color.equals(new THREE.Color(0x101216)), 'portrait restores exact legacy channels');
  assert.equal(material.envMapIntensity, .45);
}

function assertCornerBounds(pillars) {
  const box = pillars.geometry.boundingBox, point = new THREE.Vector3();
  for (let i = 0; i < 2; i++) {
    const matrix = matrixAt(pillars, i);
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      point.set(x, y, z).applyMatrix4(matrix);
      assert.ok(pillars.boundingBox.containsPoint(point), 'aggregate box includes each instance corner');
      assert.ok(pillars.boundingSphere.containsPoint(point), 'aggregate sphere includes each instance corner');
    }
  }
}

test('pillar construction retains the exact legacy geometry, count and dedicated material owner', () => {
  const { scene, kiln, pillars, material } = fixture();
  assert.equal(pillars.material, material);
  assert.deepEqual(pillars.geometry.parameters, { width: 70, height: 1900, depth: 700, widthSegments: 1, heightSegments: 1, depthSegments: 1 });
  assertLegacy(pillars, material);
  assertCornerBounds(pillars);
  const initial = [...pillars.instanceMatrix.array], version = pillars.instanceMatrix.version;
  for (const size of [[390, 844], [320, 568], [1000, 1001], [1024, 1024]]) kiln.layoutPillars(...size);
  assert.deepEqual([...pillars.instanceMatrix.array], initial);
  assert.equal(pillars.instanceMatrix.version, version, 'ordinary portrait/square resizes do not upload again');
  assert.equal(scene.children.filter(object => object.material === material).length, 1);
});

test('exploratory landscape keeps owners and changes only the pillar transforms and material values', () => {
  const { scene, kiln, pillars, material } = fixture();
  const geometry = pillars.geometry, instanceMatrix = pillars.instanceMatrix, array = instanceMatrix.array;
  const color = material.color, materialVersion = material.version;
  const box = pillars.boundingBox, sphere = pillars.boundingSphere, children = [...scene.children];
  const other = scene.children.filter(object => object !== pillars).map(object => ({ object,
    geometry: object.geometry, material: object.material, position: object.position.clone(), scale: object.scale.clone(), quaternion: object.quaternion.clone() }));
  kiln.layoutPillars(1280, 800);
  assert.equal(pillars.geometry, geometry); assert.equal(pillars.instanceMatrix, instanceMatrix);
  assert.equal(instanceMatrix.array, array); assert.equal(pillars.material, material); assert.equal(material.color, color);
  assert.equal(pillars.boundingBox, box); assert.equal(pillars.boundingSphere, sphere);
  assert.deepEqual(scene.children, children); assert.equal(pillars.count, 2);
  for (let i = 0; i < 2; i++) {
    const matrix = matrixAt(pillars, i), expected = new THREE.Matrix4().makeScale(50 / 70, 1, 1).setPosition(i ? 880 : -880, 80, -700);
    matrix.elements.forEach((value, j) => near(value, expected.elements[j], 1e-6));
  }
  assert.ok(color.equals(PAL.graphite)); assert.notEqual(color, PAL.graphite, 'copy palette channels without aliasing mutable owner');
  assert.equal(material.envMapIntensity, .3); assert.equal(material.roughness, .75); assert.equal(material.metalness, .3);
  assert.equal(material.version, materialVersion, 'colour/environment values do not request another program');
  for (const old of other) {
    assert.equal(old.object.geometry, old.geometry); assert.equal(old.object.material, old.material);
    assert.ok(old.object.position.equals(old.position)); assert.ok(old.object.scale.equals(old.scale)); assert.ok(old.object.quaternion.equals(old.quaternion));
  }
});

test('only tuple changes rewrite two matrices, issue one upload and refresh retained aggregate bounds', () => {
  const { kiln, pillars } = fixture();
  const initialVersion = pillars.instanceMatrix.version, initialBox = pillars.boundingBox.clone(), initialSphere = pillars.boundingSphere.clone();
  const owners = { box: pillars.boundingBox, sphere: pillars.boundingSphere };
  const calls = { matrix: 0, box: 0, sphere: 0 };
  for (const [method, key] of [['setMatrixAt', 'matrix'], ['computeBoundingBox', 'box'], ['computeBoundingSphere', 'sphere']]) {
    const actual = pillars[method].bind(pillars);
    pillars[method] = (...args) => { calls[key]++; return actual(...args); };
  }
  kiln.layoutPillars(1280, 800);
  assert.deepEqual(calls, { matrix: 2, box: 1, sphere: 1 });
  assert.equal(pillars.instanceMatrix.version, initialVersion + 1);
  assert.equal(pillars.boundingBox, owners.box); assert.equal(pillars.boundingSphere, owners.sphere);
  near(pillars.boundingBox.min.x, -905, 1e-5); near(pillars.boundingBox.max.x, 905, 1e-5);
  assert.equal(pillars.boundingBox.min.z, -1050); assert.equal(pillars.boundingBox.max.z, -350);
  assert.ok(!pillars.boundingBox.equals(initialBox)); assert.ok(!pillars.boundingSphere.equals(initialSphere));
  assertCornerBounds(pillars);
  const changedBox = pillars.boundingBox.clone(), changedSphere = pillars.boundingSphere.clone();
  for (const size of [[1280, 800], [2560, 1080], [568, 320], [1001, 1000]]) kiln.layoutPillars(...size);
  assert.deepEqual(calls, { matrix: 2, box: 1, sphere: 1 });
  assert.equal(pillars.instanceMatrix.version, initialVersion + 1);
  assert.ok(pillars.boundingBox.equals(changedBox)); assert.ok(pillars.boundingSphere.equals(changedSphere));
});

test('portrait return restores exact matrices, colour and bounds without changing retained owners', () => {
  const { kiln, pillars, material } = fixture();
  const initial = [...pillars.instanceMatrix.array], box = pillars.boundingBox.clone(), sphere = pillars.boundingSphere.clone();
  const color = material.color, version = pillars.instanceMatrix.version;
  kiln.layoutPillars(844, 390); kiln.layoutPillars(390, 844);
  assertLegacy(pillars, material);
  assert.deepEqual([...pillars.instanceMatrix.array], initial); assert.equal(material.color, color);
  assert.equal(pillars.instanceMatrix.version, version + 2);
  assert.ok(pillars.boundingBox.equals(box)); assert.ok(pillars.boundingSphere.equals(sphere));
  assertCornerBounds(pillars);
  kiln.setLite(true); kiln.setLite(false);
  for (const mode of ['bottom', 'left', 'ring']) { kiln.setMode(mode, {}); kiln.update(60, .6, 1, 0, 1); }
  assertLegacy(pillars, material);
  assert.deepEqual([...pillars.instanceMatrix.array], initial);
  assert.equal(pillars.instanceMatrix.version, version + 2, 'quality/world/frame work does not own pillar placement');
});

test('actual renderer resize supplies current CSS dimensions after rig fit and rest pose', () => {
  const source = readFileSync(new URL('../src/render/renderer.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function resize() {'), end = source.indexOf('  function applyMenu() {', start);
  assert.ok(start > 0 && end > start);
  const makeResize = new Function('env', `with (env) {\n${source.slice(start, end)}\nreturn resize;\n}`);
  const trace = [], record = name => (...args) => trace.push({ name, args });
  const env = { width: 0, height: 0, pr: 1, host: { clientWidth: 1280, clientHeight: 800 },
    q: { lite: true }, ladder: { step: 0 }, LOOK, stats: {}, details: {}, restCam: {}, camera: { fov: 35 },
    gl: { setPixelRatio() {}, setSize() {} }, scene: { fog: {} },
    rig: { resize: record('rig'), fit: { dist: 2000, look: 0, centreX: 0, rect: { scale: .7 } }, fitOpts: { frame: {} } },
    updateReadability() {}, bricks: { setReadability() {} }, pieces: { setReadability() {} },
    restPose: record('rest'), kiln: { layoutPillars: record('pillars') }, headroom: { layout: record('headroom') },
    post: { setSize() {} }, fire: { sparkMat: { uniforms: { uScale: { value: 0 } } } }, fx: { setScale() {} },
  };
  const resize = makeResize(env); resize();
  assert.deepEqual(trace.map(row => row.name), ['rig', 'rest', 'pillars', 'headroom']);
  assert.deepEqual(trace[2].args, [1280, 800]);
  trace.length = 0; env.host.clientWidth = 390; env.host.clientHeight = 844; resize();
  assert.deepEqual(trace[2].args, [390, 844]);
});
