// Public material inputs may share shader features without replacing any real surface detail.
import { register } from 'node:module';
import { test, assert } from './lib.mjs';

const three = `
  export const SRGBColorSpace='srgb', NoColorSpace='', NearestFilter=1003, TangentSpaceNormalMap=0;
  export class Material { onBeforeCompile() {} }
  export class Color { constructor() { this.r=.1; this.g=.2; this.b=.3; } }
  export class DataTexture {
    constructor(data, width, height) { this.image={data,width,height}; }
  }
`;
const threeURL = `data:text/javascript,${encodeURIComponent(three)}`;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const { createNeutralTextures, unifyStandardMaterial, unifyStandardMaterials } = await import('../src/render/materials.js');
const { Material } = await import(threeURL);

function material(overrides = {}) {
  return {
    isMeshStandardMaterial: true, transparent: false, map: null, normalMap: null, bumpMap: null,
    onBeforeCompile: Material.prototype.onBeforeCompile,
    normalMapType: 0, normalScale: { x: 1, y: 1, set(x, y) { this.x=x; this.y=y; } },
    color: { r: .2, g: .3, b: .4 }, roughness: .38, metalness: .9, envMapIntensity: 2.4,
    ...overrides,
  };
}

test('standard features: two tiny neutral samplers are owned separately by each renderer', () => {
  const a = createNeutralTextures(), b = createNeutralTextures();
  assert.notEqual(a.neutralMap, b.neutralMap);
  assert.notEqual(a.neutralNormal, b.neutralNormal);
  assert.deepEqual([...a.neutralMap.image.data], [255, 255, 255, 255]);
  assert.deepEqual([...a.neutralNormal.image.data], [128, 128, 255, 255]);
  assert.equal(a.neutralMap.colorSpace, 'srgb');
  assert.equal(a.neutralNormal.colorSpace, '');
  for (const texture of [a.neutralMap, a.neutralNormal]) {
    assert.equal(texture.image.width, 1);
    assert.equal(texture.image.height, 1);
    assert.equal(texture.minFilter, 1003);
    assert.equal(texture.magFilter, 1003);
    assert.equal(texture.generateMipmaps, false);
    assert.equal(texture.needsUpdate, true);
  }
});

test('standard features: missing samplers share fallbacks while numeric appearance stays intact', () => {
  const tex = createNeutralTextures(), a = material(), map = {}, b = material({ map });
  const color = a.color, normalScale = a.normalScale;
  for (const m of [a, b]) {
    assert.equal(unifyStandardMaterial(m, tex), true);
    assert.equal(m.normalMap, tex.neutralNormal);
    assert.equal(m.normalScale.x, 0);
    assert.equal(m.normalScale.y, 0);
    assert.equal(m.roughness, .38);
    assert.equal(m.metalness, .9);
    assert.equal(m.envMapIntensity, 2.4);
    assert.equal(m.needsUpdate, true);
    m.needsUpdate = false;
    assert.equal(unifyStandardMaterial(m, tex), false, 'another warm-up is idempotent');
    assert.equal(m.needsUpdate, false);
  }
  assert.equal(a.map, tex.neutralMap);
  assert.equal(b.map, map);
  assert.equal(a.color, color);
  assert.deepEqual(color, { r: .2, g: .3, b: .4 });
  assert.equal(a.normalScale, normalScale);
});

test('standard features: existing and later kit maps keep their real normal scales', () => {
  const tex = createNeutralTextures(), map = {}, normal = {};
  const scale = { x: .6, y: .6, set() { throw new Error('real normal scale must not change'); } };
  const real = material({ map, normalMap: normal, normalScale: scale });
  assert.equal(unifyStandardMaterial(real, tex), false);
  assert.equal(real.map, map);
  assert.equal(real.normalMap, normal);
  assert.equal(real.normalScale, scale);
  const fallback = material();
  unifyStandardMaterial(fallback, tex);
  // loadKit/refreshMaps replace the shared fallback with a finished texture and its scale.
  fallback.map = map; fallback.normalMap = normal; fallback.normalScale = scale;
  assert.equal(unifyStandardMaterial(fallback, tex), false);
  assert.equal(fallback.normalMap, normal);
  assert.equal(fallback.normalScale.x, .6);
});

test('standard features: hidden and multi-material meshes normalize, glass and transparent materials stay intact', () => {
  const tex = createNeutralTextures(), hidden = material(), a = material(), b = material();
  const glass = material({ isMeshPhysicalMaterial: true }), transparent = material({ transparent: true });
  const objects = [{}, { visible: false, material: hidden }, { material: [a, b, glass, transparent] }];
  unifyStandardMaterials({ traverse(fn) { objects.forEach(fn); } }, tex);
  for (const m of [hidden, a, b]) {
    assert.equal(m.map, tex.neutralMap);
    assert.equal(m.normalMap, tex.neutralNormal);
  }
  for (const m of [glass, transparent]) {
    assert.equal(m.map, null);
    assert.equal(m.normalMap, null);
    assert.equal(m.normalScale.x, 1);
  }
});

test('standard features: normal fallback never suppresses bump maps or changes object-space normals', () => {
  const tex = createNeutralTextures(), bump = material({ bumpMap: {} }), objectSpace = material({ normalMapType: 1 });
  for (const m of [bump, objectSpace]) {
    unifyStandardMaterial(m, tex);
    assert.equal(m.normalMap, null);
    assert.equal(m.normalScale.x, 1);
    assert.equal(m.normalScale.y, 1);
  }
});

test('standard features: a custom compile hook is identified by function identity, preserving its original samplers', () => {
  const tex = createNeutralTextures();
  const hook = ({ onBeforeCompile() {} }).onBeforeCompile;
  assert.equal(hook.toString(), Material.prototype.onBeforeCompile.toString(), 'identical source text is still a distinct hook');
  assert.notEqual(hook, Material.prototype.onBeforeCompile);
  const custom = material({ onBeforeCompile: hook, map: { name: 'ceramic' } });
  const map = custom.map;
  assert.equal(unifyStandardMaterial(custom, tex), false);
  assert.equal(custom.map, map);
  assert.equal(custom.normalMap, null);
  assert.equal(custom.normalScale.x, 1);
  assert.equal(custom.normalScale.y, 1);
  assert.equal(custom.needsUpdate, undefined);
  // A later custom boss clone may already inherit neutral references from its ordinary base.
  const inherited = material({ onBeforeCompile: hook, map: tex.neutralMap, normalMap: tex.neutralNormal });
  inherited.normalScale.set(0, 0);
  assert.equal(unifyStandardMaterial(inherited, tex), false);
  assert.equal(inherited.normalMap, tex.neutralNormal, 'no provenance restoration or new mutation');
});
