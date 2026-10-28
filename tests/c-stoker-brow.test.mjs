// Review Oct 28: the Stoker's titanium head (brow, dome and cheeks) used the shared titanium, whose
// broad frontal brow mirrored the kiln's cool lights and read as a blue-grey slab, the brightest
// thing at the top of the screen. The head now has its own warm, darker titanium twin. These tests
// hold that the Stoker alone changed: its head is warm and darker on the same shader program, while
// the shared titanium (arena lip, Crucible ring, Core shields) is untouched.
import { register } from 'node:module';
import { test, assert } from './lib.mjs';

const threeURL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
const addonURL = new URL('../vendor/three/0.160.0/examples/jsm/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ${JSON.stringify(addonURL)} + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const THREE = await import(threeURL);
const { PAL } = await import('../src/render/materials.js');
const { createBoss, STOKER_TITANIUM } = await import('../src/render/boss.js');

const SHARED = { color: 0xc0c4ca, roughness: 0.38, metalness: 0.9, envMapIntensity: 2.4 };

function kit() {
  const map = new THREE.Texture();
  const titanium = new THREE.MeshStandardMaterial({ ...SHARED, map });
  const M = {
    titaniumP: titanium.clone(),
    matteP: new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 1, metalness: 0, envMapIntensity: 0 }),
    darkMetalP: new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.45, metalness: 0.9, envMapIntensity: 0.9 }),
    tex: { glow: new THREE.Texture(), crackle: new THREE.Texture(), crackleN: new THREE.Texture() },
  };
  const scene = new THREE.Scene();
  const boss = createBoss(scene, M);
  return { M, scene, boss, root: scene.getObjectByName('boss') };
}

/** A glTF-like scene: each part a group of one mesh per primitive, named as GLTFLoader names them. */
function model(parts) {
  const g = new THREE.Group();
  for (const [part, materials] of Object.entries(parts)) {
    const node = new THREE.Group();
    node.name = part;
    materials.forEach((name, k) => {
      const mat = new THREE.MeshStandardMaterial();
      mat.name = name;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      mesh.name = `${part}_${k + 1}`;
      node.add(mesh);
    });
    g.add(node);
  }
  return g;
}

const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const meshOf = (g, name) => g.getObjectByName(name);

test('the Stoker head is warm dark titanium of its own on the same trimmed program', () => {
  const { M, boss } = kit();
  const stoker = model({ 'part-core': ['ember'], 'part-head': ['titanium', 'metal', 'matte'], 'part-jaw': ['titanium', 'metal'] });
  boss.setModel('stoker', stoker);
  const head = meshOf(stoker, 'part-head_1').material;
  assert.notEqual(head, M.titaniumP);
  assert.equal(head.customProgramCacheKey(), 'kiln-boss-route-throat', 'the head keeps the live throat cut and its program');
  assert.equal(head.type, 'MeshStandardMaterial');
  assert.equal(head.metalness, SHARED.metalness);
  assert.equal(head.roughness, SHARED.roughness);
  assert.equal(head.map, M.titaniumP.map, 'the same brushed grain');
  assert.equal(head.color.getHex(), STOKER_TITANIUM.color);
  // warm: red over green over blue, and well under the shared titanium's brightness and reflection
  assert.ok(head.color.r > head.color.g && head.color.g > head.color.b, 'warm tint');
  assert.ok(head.color.r / head.color.b >= 1.8, `red well over blue (linear r/b ${(head.color.r / head.color.b).toFixed(2)})`);
  assert.ok(lum(head.color) < 0.5 * lum(M.titaniumP.color), 'darker than the shared titanium');
  assert.ok(head.envMapIntensity < SHARED.envMapIntensity / 2, 'reflection turned down');
  // a faint heat-low floor, never a glow
  assert.ok(head.emissive.r > head.emissive.g && head.emissive.g > head.emissive.b, 'heat-low emissive');
  assert.ok(head.emissive.r > 0 && head.emissive.r <= 0.06 * PAL.heatLoRest.r, 'faint');
  // the head's metal and matte keep their shared bases (trimmed); the jaw stays hidden
  assert.equal(meshOf(stoker, 'part-head_2').material.color.getHex(), M.darkMetalP.color.getHex());
  assert.equal(meshOf(stoker, 'part-head_3').material.color.getHex(), M.matteP.color.getHex());
  assert.equal(stoker.getObjectByName('part-jaw').visible, false);
});

test('the Stoker placeholder uses the same warm titanium before the model arrives', () => {
  const { M, root } = kit();
  const stokerGroup = root.children[0];
  const metal = [];
  stokerGroup.traverse((o) => { if (o.isMesh && o.material.metalness > 0.5 && o.material !== M.darkMetalP) metal.push(o.material); });
  assert.equal(metal.length, 3, 'brow and two cheeks (the hidden jaw is dark metal)');
  for (const m of metal) {
    assert.notEqual(m, M.titaniumP);
    assert.equal(m.color.getHex(), STOKER_TITANIUM.color);
  }
});

test('the shared titanium and the other bosses keep their titanium', () => {
  const { M, boss, root } = kit();
  boss.setModel('stoker', model({ 'part-head': ['titanium'] }));
  const crucible = model({ 'part-ring': ['titanium'], 'part-core': ['titanium', 'ember'] });
  boss.setModel('crucible', crucible);
  const core = model({ 'part-shell': ['titanium'], 'part-frame': ['titanium'] });
  boss.setModel('core', core);
  assert.equal(M.titaniumP.color.getHex(), SHARED.color);
  assert.equal(M.titaniumP.envMapIntensity, SHARED.envMapIntensity);
  assert.equal(M.titaniumP.emissive.getHex(), 0);
  for (const name of ['part-ring_1', 'part-core_1']) {
    const m = meshOf(crucible, name).material;
    assert.equal(m.color.getHex(), SHARED.color, name);
    assert.equal(m.envMapIntensity, SHARED.envMapIntensity, name);
  }
  assert.equal(meshOf(core, 'part-shell_1').material.color.getHex(), SHARED.color);
  assert.equal(meshOf(core, 'part-frame_1').material, M.titaniumP, 'untrimmed titanium is the shared material itself');
  // the Crucible and Core placeholders too
  for (const g of root.children.slice(1, 3)) {
    g.traverse((o) => { if (o.isMesh && o.material.metalness > 0.5) assert.equal(o.material.color.getHex(), SHARED.color); });
  }
});
