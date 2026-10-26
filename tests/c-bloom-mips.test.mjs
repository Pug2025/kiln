// Exercise the actual owned bloom/composer graph with pinned Three objects and a renderer spy.
import { register } from 'node:module';
import { test, assert, near } from './lib.mjs';
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
const { tightBloomFactor } = await import('../src/render/bloom.js');
const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');

function fixture(antialias = false) {
  let target = null, scissorTest = true;
  const viewport = new THREE.Vector4(2, 3, 400, 800), scissor = new THREE.Vector4(4, 5, 300, 700);
  const activeViewport = viewport.clone(), activeScissor = scissor.clone();
  let activeScissorTest = scissorTest;
  const color = new THREE.Color(.02, .03, .04), written = new Set(), calls = [];
  const renderer = {
    autoClear: true, outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: LOOK.EXPOSURE,
    getPixelRatio: () => 2, getContextAttributes: () => ({ antialias }),
    getClearColor: out => out.copy(color), getClearAlpha: () => .7,
    setClearColor(){ throw Error('post does not change the clear color'); }, clear(){},
    getRenderTarget: () => target, setRenderTarget: value => {
      target = value; activeViewport.copy(value ? value.viewport : viewport);
      activeScissor.copy(value ? value.scissor : scissor); activeScissorTest = value ? value.scissorTest : scissorTest;
    },
    getViewport: out => out.copy(viewport), setViewport: value => { viewport.copy(value); activeViewport.copy(value); },
    getScissor: out => out.copy(scissor), setScissor: value => { scissor.copy(value); activeScissor.copy(value); },
    getScissorTest: () => scissorTest, setScissorTest: value => { scissorTest = value; activeScissorTest = value; },
    activeViewport, activeScissor, getActiveScissorTest: () => activeScissorTest,
    initTexture(texture) { assert.ok(texture.isDataTexture); written.add(texture); },
    render(object) {
      const material = object.isScene ? null : object.material;
      const samplers = material ? [...material.fragmentShader.matchAll(/texture2D\s*\(\s*(\w+)\s*,/g)].map(m => m[1]) : [];
      for (const name of new Set(samplers)) {
        const texture = material.uniforms[name]?.value;
        const blank = texture?.isDataTexture && texture.image.data.every(v => v === 0);
        assert.ok(texture && (blank || written.has(texture)), `${name}: sample fresh writes or initialized black`);
        assert.notEqual(texture, target?.texture, 'no read/write texture feedback');
      }
      calls.push({ material, target, samplers,
        direction: material?.uniforms.direction ? [...material.uniforms.direction.value] : null });
      if (renderer.failAt === calls.length) throw Error('injected draw failure');
      if (target) written.add(target.texture);
    },
  };
  const post = createPost(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
  const output = post.composer.passes.at(-1);
  return { post, output, calls, written, renderer, viewport, scissor,
    clear() { calls.length = 0; written.clear(); } };
}

test('Full writes three color-only half-resolution targets and combines once without scene writeback', () => {
  const f = fixture(), b = f.post.bloom;
  f.post.render();
  assert.equal(f.calls.length, 5, 'scene, bright, horizontal, vertical, final output');
  const [scene, bright, horizontal, vertical, output] = f.calls;
  assert.equal(scene.material, null);
  assert.equal(bright.material, b.materialHighPassFilter);
  assert.equal(horizontal.material, b.blurMaterial); assert.equal(vertical.material, b.blurMaterial);
  assert.deepEqual(horizontal.direction, [1, 0]); assert.deepEqual(vertical.direction, [0, 1]);
  assert.deepEqual([bright.target, horizontal.target, vertical.target], Object.values(b.targets));
  assert.equal(f.calls.filter(c => c.target === scene.target).length, 1, 'scene MSAA target is never written by bloom');
  assert.equal(output.material, f.output.material); assert.equal(output.target, null);
  assert.equal(f.output.uniforms.tDiffuse.value, scene.target.texture);
  assert.equal(f.output.uniforms.uBloomTexture.value, b.texture);
  assert.equal(b.compositeMaterial, f.output.material, 'diagnostic alias is the actual output combine');
  assert.ok(Object.hasOwn(f.output.material.defines, 'ACES_FILMIC_TONE_MAPPING'));
  assert.ok(Object.hasOwn(f.output.material.defines, 'SRGB_TRANSFER'));
  for (const target of Object.values(b.targets)) {
    assert.equal(target.texture.type, THREE.HalfFloatType); assert.equal(target.samples, 0);
    assert.equal(target.depthBuffer, false); assert.equal(target.stencilBuffer, false);
    assert.equal(target.texture.generateMipmaps, false);
  }
  f.post.dispose();
});

test('Lite binds transparent black and skips all bloom stages without changing output variants or guards', () => {
  for (const antialias of [false, true]) {
    const f = fixture(antialias), b = f.post.bloom, u = f.output.uniforms;
    const buffers = ['uMaskA', 'uMaskB', 'uRes', 'uBallMasks'].map(n => u[n].value);
    f.post.render(); const version = f.output.material.version;
    const target = new THREE.WebGLRenderTarget(8, 8); f.renderer.setRenderTarget(target);
    for (const lite of [true, false, true, false]) {
      f.clear(); f.post.setBloom(!lite); f.post.setSaturation(lite ? .9 : 1); f.post.render();
      assert.equal(f.calls.length, lite ? 2 : 5);
      assert.equal(f.calls.filter(c => c.target === null).length, 1);
      assert.equal(f.calls.at(-1).material, f.output.material);
      assert.equal(f.renderer.getRenderTarget(), target);
      assert.equal(u.uBloomEnabled.value, lite ? 0 : 1);
      if (lite) {
        assert.ok(u.uBloomTexture.value.isDataTexture);
        assert.deepEqual([...u.uBloomTexture.value.image.data], [0, 0, 0, 0]);
        assert.ok(f.calls.every(c => c.material === null || c.material === f.output.material));
      } else assert.equal(u.uBloomTexture.value, b.texture);
      assert.equal(f.output.material.version, version);
      assert.equal(u.uSat.value, lite ? .9 : 1);
      assert.equal(u.toneMappingExposure.value, LOOK.EXPOSURE);
      ['uMaskA', 'uMaskB', 'uRes', 'uBallMasks'].forEach((n, i) => assert.equal(u[n].value, buffers[i]));
    }
    f.post.dispose(); target.dispose();
  }
});

test('kernel data retains the native five taps, sigma and unnormalized composite energy', () => {
  const f = fixture(), b = f.post.bloom;
  const native = new UnrealBloomPass(new THREE.Vector2(256, 256), .18, .1, .9);
  const radius = 3, sigma = radius / 2.5;
  const weights = b.blurMaterial.uniforms.gaussianCoefficients.value;
  assert.deepEqual([...weights], [0, 1, 2].map(i => Math.fround(Math.exp(-.5 * i * i / (sigma * sigma)))));
  const sum = weights[0] + 2 * weights[1] + 2 * weights[2];
  const impulse = [weights[2], weights[1], weights[0], weights[1], weights[2]].map(w => w / sum);
  near(impulse.reduce((a, b) => a + b), 1); assert.deepEqual(impulse, [...impulse].reverse());
  for (const value of [0, .5, 2]) near(impulse.reduce((a, weight) => a + value * weight, 0), value);
  assert.equal(b.materialHighPassFilter.uniforms.luminosityThreshold.value, native.threshold);
  assert.equal(b.materialHighPassFilter.uniforms.smoothWidth.value, native.highPassUniforms.smoothWidth.value);
  near(tightBloomFactor(b.strength, b.radius), .1656, 1e-12);
  near(tightBloomFactor(b.strength, b.radius) ** 2, .02742336, 1e-12);
  // Native blur overwrites alpha one; keep that independent of source threshold coverage.
  const nativeAlpha = native.separableBlurMaterials[0].fragmentShader.match(/gl_FragColor\s*=\s*vec4\([^;]+,\s*([\d.]+)\);/)[1];
  const actualAlpha = b.blurMaterial.fragmentShader.match(/gl_FragColor\s*=\s*vec4\([^;]+,\s*([\d.]+)\);/)[1];
  assert.equal(Number(actualAlpha), Number(nativeAlpha));
  native.dispose(); native.materialHighPassFilter.dispose(); f.post.dispose();
});

test('resize preserves target and uniform identities, half sizing once, minimum dimensions and MSAA policy', () => {
  const f = fixture(), b = f.post.bloom, targets = Object.values(b.targets), inv = b.blurMaterial.uniforms.invSize.value;
  for (const [W, H, pr, lite, off, samples] of [[391, 845, 2, false, false, LOOK.MSAA_HI_DPR],
    [1, 1, 1, true, false, LOOK.MSAA_LITE], [320, 568, 1, false, false, LOOK.MSAA],
    [390, 844, 1, true, true, 0], [1280, 800, 2, false, false, LOOK.MSAA_HI_DPR]]) {
    f.post.setBloom(!lite); f.post.setMsaaOff(off); f.post.setSize(W, H, pr);
    const w = Math.max(1, Math.round(W * pr / 2)), h = Math.max(1, Math.round(H * pr / 2));
    for (const target of targets) { assert.equal(target.width, w); assert.equal(target.height, h); }
    assert.deepEqual(Object.values(b.targets), targets);
    assert.equal(b.blurMaterial.uniforms.invSize.value, inv);
    near(inv[0], 1 / w); near(inv[1], 1 / h);
    for (const target of [f.post.composer.renderTarget1, f.post.composer.renderTarget2]) assert.equal(target.samples, samples);
    assert.deepEqual([...f.output.uniforms.uRes.value], [W * pr, H * pr]);
  }
  f.post.dispose();
});

test('offscreen warm-up prepares the real passes even in Lite and restores caller state on success and failure', () => {
  const f = fixture(), target = new THREE.WebGLRenderTarget(9, 7);
  f.post.setSize(390, 844, 2); f.post.setBloom(false); f.post.setSaturation(.9);
  const viewport = f.viewport.clone(), scissor = f.scissor.clone(), u = f.output.uniforms;
  const blank = u.uBloomTexture.value, guards = u.uBallMasks.value;
  f.renderer.setRenderTarget(target); f.renderer.autoClear = false;
  for (const fail of [false, true]) {
    f.clear(); f.renderer.failAt = fail ? 2 : 0;
    if (fail) assert.throws(() => f.post.warmUp(), /injected/); else f.post.warmUp();
    assert.ok(f.calls.every(c => c.target !== null && c.material !== null), 'no scene or canvas draw in preparation');
    if (!fail) {
      assert.equal(f.calls.length, 4);
      assert.equal(f.calls.at(-1).material, f.output.material);
      assert.deepEqual([f.calls.at(-1).target.width, f.calls.at(-1).target.height], [1, 1]);
    }
    assert.equal(f.renderer.getRenderTarget(), target); assert.equal(f.renderer.autoClear, false);
    assert.ok(f.viewport.equals(viewport)); assert.ok(f.scissor.equals(scissor)); assert.equal(f.renderer.getScissorTest(), true);
    assert.ok(f.renderer.activeViewport.equals(target.viewport), 'caller target viewport overrides saved canvas defaults');
    assert.ok(f.renderer.activeScissor.equals(target.scissor));
    assert.equal(f.renderer.getActiveScissorTest(), target.scissorTest);
    assert.equal(f.post.bloomOn, false); assert.equal(f.post.bloom.enabled, false);
    assert.equal(u.uBloomEnabled.value, 0); assert.equal(u.uBloomTexture.value, blank);
    assert.equal(u.uBallMasks.value, guards); assert.equal(u.uSat.value, .9);
  }
  f.post.dispose(); target.dispose();
});

test('post render restores the caller after a side-chain draw failure', () => {
  const f = fixture(), target = new THREE.WebGLRenderTarget(9, 7);
  f.renderer.setRenderTarget(target); f.renderer.failAt = 3;
  assert.throws(() => f.post.render(), /injected/);
  assert.equal(f.renderer.getRenderTarget(), target); assert.equal(f.renderer.autoClear, true);
  f.post.dispose(); target.dispose();
});

test('every owned target, material, blank texture and private geometry disposes once after resize and warm-up', () => {
  const f = fixture(), b = f.post.bloom;
  f.post.setSize(390, 844, 2); f.post.setBloom(false); const blank = f.output.uniforms.uBloomTexture.value;
  f.post.warmUp(); const warmTarget = f.calls.at(-1).target;
  const owned = [f.post.composer.renderTarget1, f.post.composer.renderTarget2, f.post.composer.copyPass.material,
    f.output.material, ...Object.values(b.targets), b.materialHighPassFilter, b.blurMaterial, b.geometry, blank, warmTarget];
  const counts = new Map(owned.map(o => [o, 0]));
  for (const object of owned) object.addEventListener('dispose', () => counts.set(object, counts.get(object) + 1));
  f.post.dispose(); f.post.dispose(); b.dispose();
  for (const object of owned) assert.equal(counts.get(object), 1);
});
