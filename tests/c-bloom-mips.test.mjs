import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import * as THREE from '../vendor/three/0.160.0/build/three.module.js';
import { LOOK } from '../src/render/look.js';

const threeURL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
const addonURL = new URL('../vendor/three/0.160.0/examples/jsm/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ${JSON.stringify(addonURL)} + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const { createPost } = await import('../src/render/post.js');
const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');

function fixture(antialias = false) {
  let target = null;
  const color = new THREE.Color(.02, .03, .04), written = new Set(), calls = [];
  const renderer = {
    autoClear: true, outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: LOOK.EXPOSURE,
    getPixelRatio: () => 2, getContextAttributes: () => ({ antialias }),
    getClearColor: out => out.copy(color), getClearAlpha: () => .7,
    setClearColor(){}, setClearAlpha(){}, clear(){},
    getRenderTarget: () => target, setRenderTarget: value => { target = value; },
    state: { buffers: { stencil: { setTest(){} } } },
    render(object) {
      const material = object.isScene ? null : object.material;
      // Follow the real pass's emitted sampling graph, not a second hand-written render loop.
      const samplers = material ? [...material.fragmentShader.matchAll(/texture2D\s*\(\s*(\w+)\s*,/g)].map(m => m[1]) : [];
      for (const name of new Set(samplers)) {
        const texture = material.uniforms[name]?.value;
        assert.ok(texture && written.has(texture), `${name}: only a texture rendered this frame may be sampled`);
      }
      calls.push({ material, target, samplers });
      if (target) written.add(target.texture);
    },
  };
  const post = createPost(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
  return { post, calls, written, renderer, clear() { calls.length = 0; written.clear(); } };
}

test('actual Full render graph has two blur draws and reads only the tightest initialized mip texture', () => {
  const f = fixture(), b = f.post.bloom;
  f.post.render();
  assert.equal(f.calls.length, 7, 'scene, bright, two blurs, composite, blend, output');
  assert.deepEqual(f.calls.filter(c => b.separableBlurMaterials.includes(c.material)).map(c => c.target),
    [0].flatMap(i => [b.renderTargetsHorizontal[i], b.renderTargetsVertical[i]]));
  const composite = f.calls.find(c => c.material === b.compositeMaterial);
  assert.deepEqual(composite.samplers, ['blurTexture1']);
  for (let i = 1; i < 5; i++) {
    assert.equal(f.written.has(b.renderTargetsHorizontal[i].texture), false);
    assert.equal(f.written.has(b.renderTargetsVertical[i].texture), false);
  }
  assert.equal(b.nMips, 1); assert.equal(b.compositeMaterial.defines.NUM_MIPS, 1);
  assert.deepEqual(b.compositeMaterial.uniforms.bloomFactors.value, [1]);
  assert.equal(b.bloomTintColors.length, 1);
  assert.equal(b.strength, LOOK.BLOOM_STRENGTH); assert.equal(b.threshold, LOOK.BLOOM_THRESHOLD);
  assert.equal(b.radius, LOOK.BLOOM_RADIUS);
  f.post.dispose();
});

test('pinned native five-mip reference takes eight more blur draws', () => {
  const f = fixture(), reference = new UnrealBloomPass(new THREE.Vector2(256, 256), .18, .1, .9);
  const input = new THREE.WebGLRenderTarget(10, 10);
  f.written.add(input.texture);
  reference.render(f.renderer, null, input, 0, false);
  assert.equal(f.calls.length, 13, 'bright, ten blur draws, composite and blend');
  assert.equal(f.calls.filter(c => reference.separableBlurMaterials.includes(c.material)).length, 10);
  reference.dispose(); input.dispose(); f.post.dispose();
});

test('Lite routes have zero bloom draws and toggles do not recreate guards or shader variants', () => {
  for (const antialias of [false, true]) {
    const f = fixture(antialias), b = f.post.bloom, cm = b.compositeMaterial;
    const guards = ['uMaskA', 'uMaskB', 'uRes', 'uBallMasks'].map(n => cm.uniforms[n].value);
    f.post.render(); const version = cm.version;
    for (const lite of [true, false, true, false]) {
      f.clear(); f.post.setBloom(!lite); f.post.render();
      assert.equal(f.calls.length, lite ? antialias ? 1 : 2 : 7);
      if (lite) assert.ok(f.calls.every(c => !b.separableBlurMaterials.includes(c.material) && c.material !== cm));
      assert.equal(cm.version, version, 'mip configuration is constructor-only');
      assert.equal(b.nMips, 1);
      ['uMaskA', 'uMaskB', 'uRes', 'uBallMasks'].forEach((n, i) => assert.equal(cm.uniforms[n].value, guards[i]));
    }
    f.post.dispose();
  }
});

test('resize updates active mip sizes and disposal retains all five native mip-resource slots', () => {
  const f = fixture(), b = f.post.bloom;
  assert.equal(b.renderTargetsHorizontal.length, 5); assert.equal(b.renderTargetsVertical.length, 5);
  assert.equal(b.separableBlurMaterials.length, 5);
  const inactive = [1, 2, 3, 4].map(i => [b.renderTargetsHorizontal[i].width, b.renderTargetsVertical[i].height]);
  for (const [W, H, pr] of [[390, 844, 2], [320, 568, 1], [1280, 800, 2]]) {
    f.post.setSize(W, H, pr);
    let w = Math.round(W * pr / 2), h = Math.round(H * pr / 2);
    for (let i = 0; i < 1; i++) {
      for (const rt of [b.renderTargetsHorizontal[i], b.renderTargetsVertical[i]]) {
        assert.equal(rt.width, w); assert.equal(rt.height, h);
      }
      w = Math.round(w / 2); h = Math.round(h / 2);
    }
    assert.deepEqual([1, 2, 3, 4].map(i => [b.renderTargetsHorizontal[i].width, b.renderTargetsVertical[i].height]), inactive);
  }
  // Check all retained mip slots, including inactive 1/2/3/4, using the actual native owner. The
  // vendor's separate high-pass material disposal omission predates this mip specialization.
  const owned = [b.renderTargetBright, ...b.renderTargetsHorizontal, ...b.renderTargetsVertical,
    ...b.separableBlurMaterials, b.compositeMaterial, b.blendMaterial, b.basic];
  const disposed = new Map(owned.map(o => [o, 0]));
  for (const o of owned) o.addEventListener('dispose', () => disposed.set(o, disposed.get(o) + 1));
  f.post.dispose();
  for (const o of owned) assert.equal(disposed.get(o), 1, 'even never-rendered mip resources are disposed once');
});

test('constructor specialization refuses an unexpected pinned shader before partial mutation', () => {
  const source = readFileSync(new URL('../src/render/post.js', import.meta.url), 'utf8');
  const body = source.match(/function useTightBloomMip\(bloom\) \{([\s\S]*?)\n\}/)[1];
  const configure = new Function('bloom', body);
  for (const change of [b => { b.compositeMaterial.fragmentShader += '\n'; }, b => { b.compositeMaterial.defines.NUM_MIPS = 4; }]) {
    const b = new UnrealBloomPass(new THREE.Vector2(256, 256), .18, .1, .9);
    change(b);
    const shader = b.compositeMaterial.fragmentShader, factors = b.compositeMaterial.uniforms.bloomFactors.value;
    assert.throws(() => configure(b), /pinned r160/);
    assert.equal(b.nMips, 5); assert.equal(factors.length, 5);
    assert.equal(b.bloomTintColors.length, 5); assert.equal(b.compositeMaterial.fragmentShader, shader);
    b.dispose();
  }
});
