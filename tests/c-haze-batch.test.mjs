// Real Three geometry and fitting, without a canvas or WebGL context.
import { register } from 'node:module';
import { test, assert, near } from './lib.mjs';
import * as THREE from '../vendor/three/0.160.0/build/three.module.js';
import { createPose, fitCamera } from '../src/render/fit.js';
import { ceilingLayout } from '../src/render/ceiling.js';
import { LOOK } from '../src/render/look.js';

const threeURL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
const addonURL = new URL('../vendor/three/0.160.0/examples/jsm/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ${JSON.stringify(addonURL)} + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const { createKiln } = await import('../src/render/kiln.js');
const { createHeadroom } = await import('../src/render/headroom.js');
const { PAL_VEC3 } = await import('../src/render/materials.js');
const original = [
  { z: -90, alpha: .11, seed: 1.3, tint: .2 },
  { z: -260, alpha: .11, seed: 4.1, tint: .16 },
  { z: -480, alpha: .12, seed: 7.7, tint: .12 },
  { z: -760, alpha: .13, seed: 2.2, tint: .09 },
];
function fixture() {
  const scene = new THREE.Scene(), plain = new THREE.MeshBasicMaterial();
  const kiln = createKiln(scene, { wallGlass: plain, titaniumP: plain, ribs: plain, pillars: plain,
    grate: plain.clone(), tex: { glow: new THREE.Texture() } });
  return { kiln, scene };
}
function layers(mesh) {
  const matrix = new THREE.Matrix4(), result = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    const attr = mesh.geometry.attributes.aHaze.array;
    result.push({ index: attr[i * 4 + 3], z: mesh.position.z + matrix.elements[14],
      y: mesh.position.y + matrix.elements[13], seed: attr[i * 4], alpha: attr[i * 4 + 1], tint: attr[i * 4 + 2] });
  }
  return result;
}

test('haze batches preserve all four layers, straight alpha and shared live palette with one fewer full draw', () => {
  const { kiln } = fixture();
  assert.equal(kiln.haze.length, 3);
  assert.deepEqual(kiln.haze.flatMap(layers).map(x => x.index), [3, 2, 1, 0], 'far pair primitives stay back to front');
  const material = kiln.haze[0].material;
  for (const mesh of kiln.haze) {
    assert.ok(mesh.isInstancedMesh);
    assert.equal(mesh.renderOrder, -3);
    assert.equal(mesh.material, material, 'one instanced program and uniform set');
    assert.equal(mesh.material.depthWrite, false);
    assert.equal(mesh.material.transparent, true);
    assert.equal(mesh.material.premultipliedAlpha, false);
    assert.equal(mesh.material.blending, THREE.NormalBlending);
    assert.equal(mesh.material.uniforms.uHeatLo.value, PAL_VEC3.heatLo);
    assert.deepEqual([...mesh.material.uniforms.uParams.value], original.flatMap(x => [x.seed, x.alpha, x.tint]).map(Math.fround),
      'WebGL 1 fallback retains exact uniform values instead of interpolating a noise seed');
    assert.ok(mesh.boundingSphere.radius > 0, 'bounds exist before warm-up and drawing');
    for (const layer of layers(mesh)) {
      const old = original[layer.index];
      assert.deepEqual(layer, { index: layer.index, z: old.z, y: -120,
        seed: Math.fround(old.seed), alpha: Math.fround(old.alpha), tint: Math.fround(old.tint) });
    }
  }
});

test('haze clocks retain original CPU float32 offsets through long sessions without touching static uploads', () => {
  const { kiln } = fixture();
  const material = kiln.haze[0].material, times = material.uniforms.uTimes.value;
  const params = material.uniforms.uParams.value, initialParams = [...params];
  const uploads = kiln.haze.map(mesh => ({ matrix: mesh.instanceMatrix, array: mesh.instanceMatrix.array,
    matrixVersion: mesh.instanceMatrix.version, attr: mesh.geometry.attributes.aHaze,
    attrVersion: mesh.geometry.attributes.aHaze.version, bounds: mesh.boundingSphere.clone() }));
  for (const t of [0, .37, 60, 32768.125, 1e7 + .75]) for (const fire of [0, .55, 1]) {
    assert.equal(kiln.update(t, fire, 1, .8), .8);
    assert.equal(material.uniforms.uTimes.value, times);
    assert.equal(material.uniforms.uParams.value, params);
    assert.deepEqual([...params], initialParams);
    assert.deepEqual([...times], original.map((_, i) => Math.fround(t + i * 7)));
    near(material.uniforms.uWarm.value, .35 + .45 * fire);
    kiln.haze.forEach((mesh, i) => {
      assert.equal(mesh.instanceMatrix, uploads[i].matrix);
      assert.equal(mesh.instanceMatrix.array, uploads[i].array);
      assert.equal(mesh.instanceMatrix.version, uploads[i].matrixVersion);
      assert.equal(mesh.geometry.attributes.aHaze, uploads[i].attr);
      assert.equal(mesh.geometry.attributes.aHaze.version, uploads[i].attrVersion);
      assert.ok(mesh.boundingSphere.equals(uploads[i].bounds));
    });
  }
});

test('Lite and hazeOne retain original layer two, restore full order and avoid repeated static rewrites', () => {
  const { kiln } = fixture();
  const far = kiln.haze[0], geometry = far.geometry, material = far.material;
  for (const [lite, one, expected] of [[true, false, [2]], [false, true, [2]], [true, true, [2]],
    [false, false, [3, 2, 1, 0]], [false, true, [2]], [false, false, [3, 2, 1, 0]]]) {
    kiln.setLite(lite, one);
    assert.deepEqual(kiln.haze.flatMap(layers).map(x => x.index), expected);
    assert.equal(far.geometry, geometry); assert.equal(far.material, material);
    for (const mesh of kiln.haze) assert.equal(mesh.visible, mesh.count > 0, 'empty pools stay hidden by renderer contract');
    const matrixVersion = far.instanceMatrix.version, attrVersion = geometry.attributes.aHaze.version;
    const bounds = far.boundingSphere.clone();
    kiln.setLite(lite, one);
    assert.equal(far.instanceMatrix.version, matrixVersion);
    assert.equal(geometry.attributes.aHaze.version, attrVersion);
    assert.ok(far.boundingSphere.equals(bounds));
    near(far.boundingSphere.center.z + far.position.z, expected.length === 1 ? -480 : -620);
  }
});

test('haze aggregate bounds contain every transformed corner after each quality switch', () => {
  const { kiln } = fixture(), point = new THREE.Vector3(), matrix = new THREE.Matrix4();
  for (const lite of [false, true, false]) {
    kiln.setLite(lite);
    for (const mesh of kiln.haze) for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      for (const x of [-950, 950]) for (const y of [-750, 750]) {
        point.set(x, y, 0).applyMatrix4(matrix);
        assert.ok(mesh.boundingSphere.distanceToPoint(point) <= 1e-8, 'frustum culling cannot discard a visible haze corner');
      }
    }
  }
});

test('far haze pair preserves the old transparent sequence across fitted modes and bounded camera motion', () => {
  const { kiln, scene } = fixture(), headroom = createHeadroom(scene);
  const sizes = [[320, 568], [390, 844], [375, 667], [412, 915], [768, 1024], [800, 557],
    [1024, 768], [1280, 800], [1440, 900], [2560, 1080]];
  const frames = [ceilingLayout('ring'),
    ...[90, 300, 450, 600, 780].map(ceilingY => ceilingLayout('bottom', { ceilingY })),
    ...[90, 270, 450, 570, 720].map(farX => ceilingLayout('left', { farX }))];
  let minimum = Infinity, unsafeTriple = false;
  // Camera direction is affine in lean/drift and intro/zoom. Extremal box corners bound all
  // intermediate motion. Shake, focus dolly translation and roll do not alter relative depth.
  for (const [W, H] of sizes) for (const frame of frames) {
    for (const [top, bottom] of [[0, 0], [100, 70], [150, 70], [H * .4, H * .1]]) {
      const pose = createPose(), fit = fitCamera(W, H, pose, {}, { frame, top, bottom });
      headroom.layout(pose, W, H, frame);
      const art = [headroom.far, headroom.mid].map((mesh, i) => ({ id: `art${i}`, position: mesh.position }));
      for (const lean of [-340 * LOOK.LEAN, 340 * LOOK.LEAN]) for (const dx of [-16, 16]) {
        for (const dy of [-8, 8]) for (const ratio of [1 / 1.3, LOOK.INTRO_DOLLY]) {
          const direction = new THREE.Vector3(lean * (LOOK.LEAN_LOOK - LOOK.LEAN_POS) - dx * .7,
            fit.look - 150 - dy * .7, -fit.dist * ratio).normalize();
          const depth = position => position.dot(direction);
          const old = original.map((layer, i) => ({ id: `haze${i}`, position: new THREE.Vector3(0, -120, layer.z) }));
          const pair = kiln.haze[0];
          const batch = { id: 'pair', position: pair.boundingSphere.center.clone().add(pair.position) };
          const before = [...art, ...old].sort((a, b) => depth(b.position) - depth(a.position)).map(x => x.id);
          const after = [...art, old[0], old[1], batch].sort((a, b) => depth(b.position) - depth(a.position))
            .flatMap(x => x.id === 'pair' ? ['haze3', 'haze2'] : [x.id]);
          assert.deepEqual(after, before);
          for (const plate of art) minimum = Math.min(minimum, depth(old[2].position) - depth(plate.position));
          if (depth(old[1].position) < depth(art[0].position)) unsafeTriple = true;
        }
      }
    }
  }
  assert.ok(minimum > 80, `nearest batched layer stays behind art, minimum gap ${minimum}`);
  assert.ok(unsafeTriple, 'three-layer batching would change existing art interleaving in this envelope');
});
