// Actual fire construction and CPU updates with pinned Three, without a canvas or WebGL.
// These fixtures do not establish shader pixels, native uploads, allocation or frame budgets.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { test, assert, near } from './lib.mjs';
import { LOOK } from '../src/render/look.js';

const threeURL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
const addonURL = new URL('../vendor/three/0.160.0/examples/jsm/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ${JSON.stringify(addonURL)} + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const THREE = await import(threeURL);
const { createFire } = await import('../src/render/fire.js');
const fresh = () => createFire(new THREE.Scene());

function advance(fire, count, from = 0) {
  for (let i = 1; i <= count; i++) {
    fire.update(from + i * .1, .1);
    assert.ok(Number.isFinite(fire.st.intro), 'ordinary updates keep introduction finite');
  }
}

test('new-world fire introduction progresses from zero through half to full over 1.2 real seconds', () => {
  const fire = fresh();
  assert.equal(LOOK.FIRE_INTRO_S, 1.2);
  fire.reset(true);
  fire.update(0, 0);
  assert.equal(fire.st.intro, 0);
  assert.equal(fire.st.value, 0);
  assert.equal(fire.main.uniforms.uIntensity.value, 0);
  assert.equal(fire.backM.uniforms.uIntensity.value, 0);
  assert.equal(fire.main.uniforms.uTip.value, 0);
  assert.equal(fire.backM.uniforms.uTip.value, 0);
  advance(fire, 6);
  near(fire.st.intro, .5, 1e-12);
  assert.ok(fire.st.value > 0 && fire.main.uniforms.uTip.value > 0, 'halfway has positive intensity and tip height');
  advance(fire, 6, .6);
  near(fire.st.intro, 1, 1e-12);
  advance(fire, 30, 1.2);
  assert.equal(fire.st.intro, 1, 'the ramp saturates instead of overshooting');
});

test('introduction uses the renderer real-dt bound rather than jumping after a long frame', () => {
  const fire = fresh();
  fire.reset(true);
  fire.update(1, 1);
  assert.ok(Number.isFinite(fire.st.intro));
  near(fire.st.intro, .1 / 1.2, 1e-12, 'one oversized delta advances the intro by at most 100ms');
  const intro = fire.st.intro;
  fire.update(1, 0);
  assert.equal(fire.st.intro, intro, 'a zero-delta draw cannot advance introduction');
});

test('same-world reset preserves a partial or completed introduction and its integrated phase and flow', () => {
  const fire = fresh();
  fire.reset(true);
  advance(fire, 6);
  const partial = { intro: fire.st.intro, phase: fire.st.phase, flow: fire.st.flow };
  fire.reset(false);
  for (const [key, value] of Object.entries(partial)) assert.equal(fire.st[key], value, key);
  fire.update(.7, .1);
  near(fire.st.intro, 7 / 12, 1e-12, 'same-world binding continues the existing ramp');
  advance(fire, 5, .7);
  fire.reset(false);
  near(fire.st.intro, 1, 1e-12);
  fire.update(1.3, .1);
  assert.equal(fire.st.intro, 1, 'a completed introduction does not replay');
  fire.reset(true);
  assert.equal(fire.st.intro, 0, 'only a real new-world reset starts a new introduction');
  assert.equal(fire.st.phase, 0);
  assert.equal(fire.st.flow, 0);
});

test('reduced motion snaps introduction to full while preserving flow and phase, and disabling it does not replay', () => {
  const fire = fresh();
  fire.reset(true);
  advance(fire, 3);
  const phase = fire.st.phase, flow = fire.st.flow;
  fire.setReducedMotion(true);
  assert.equal(fire.st.intro, 1);
  assert.equal(fire.st.phase, phase);
  assert.equal(fire.st.flow, flow);
  fire.setReducedMotion(false);
  assert.equal(fire.st.intro, 1);
  assert.equal(fire.st.phase, phase);
  assert.equal(fire.st.flow, flow);
  fire.update(.4, .1);
  assert.equal(fire.st.intro, 1);
  assert.ok(fire.st.flow > flow, 'ordinary fire integration continues after the setting changes');
  fire.setReducedMotion(true);
  fire.reset(true);
  assert.equal(fire.st.intro, 1, 'new worlds remain fully introduced while reduced motion is enabled');
  fire.update(.1, .1);
  assert.equal(fire.st.intro, 1);
  fire.setReducedMotion(false);
  fire.reset(true);
  assert.equal(fire.st.intro, 0, 'a later new world uses the ordinary introduction again');
});

test('actual renderer quality application routes reduced motion to fire without resetting integrated clocks', () => {
  const source = readFileSync(new URL('../src/render/renderer.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function applyQuality() {');
  const end = source.indexOf('  function resize() {', start);
  assert.ok(start > 0 && end > start, 'the actual quality function has explicit boundaries');
  const makeApply = new Function('env', `with (env) {\n${source.slice(start, end)}\nreturn applyQuality;\n}`);
  const fire = fresh(), trace = [];
  const record = label => (...args) => trace.push([label, ...args]);
  const env = {
    fire, q: { lite: false, reduceMotion: false }, ladder: { step: 0 }, stats: {},
    rig: { st: {} }, kiln: { setLite: record('kiln') },
    post: { setMsaaOff: record('msaa'), setBloom: record('bloom') },
    headroom: { setQuality: record('headroom') }, resize: record('resize'), applyMenu: record('menu'),
  };
  const apply = makeApply(env);
  fire.reset(true); advance(fire, 3);
  const intro = fire.st.intro, phase = fire.st.phase, flow = fire.st.flow;
  apply();
  assert.equal(fire.st.intro, intro, 'ordinary quality application preserves the partial ramp');
  env.q.lite = true; env.q.reduceMotion = true;
  apply();
  assert.equal(fire.st.intro, 1, 'the real renderer function invokes the reduced-motion setter');
  assert.equal(fire.st.reduceMotion, true);
  assert.equal(fire.sparks.geometry.drawRange.count, 206, 'the real quality path also keeps its Lite prefix');
  env.q.lite = false; env.q.reduceMotion = false;
  apply();
  assert.equal(fire.st.reduceMotion, false);
  assert.equal(fire.st.intro, 1, 'restoring ordinary quality cannot replay introduction');
  assert.equal(fire.st.phase, phase); assert.equal(fire.st.flow, flow);
  assert.equal(fire.sparks.geometry.drawRange.count, 620);
  assert.equal(env.rig.st.reduceMotion, false);
  assert.deepEqual(trace.filter(row => row[0] === 'headroom'),
    [['headroom', false, false], ['headroom', true, true], ['headroom', false, false]]);
  fire.reset(true);
  assert.equal(fire.st.intro, 0, 'the real quality path has also disabled the reduced-motion latch');
});

test('early combo and held climbing flare stay integrated beneath introduction without replacing legibility masks', () => {
  const fire = fresh(), reference = fresh();
  reference.setReducedMotion(true);
  const expectedMasks = [];
  for (const f of [fire, reference]) {
    f.reset(true);
    f.setMult(5);
    f.flare(.8, .25, true);
    f.setLegibility(-490, -40, -460, 40, -460, 13);
    f.setScreenLegibility(110, 170, 240, 170, 17, 46, .9);
    expectedMasks.push([f.main, f.backM].map(mat => Object.fromEntries(
      ['uClipY', 'uFlareClipY', 'uPadA', 'uPadB', 'uPadR', 'uBand',
        'uScreenA', 'uScreenB', 'uScreenR', 'uScreenF', 'uScreenStrength']
        .map(key => [key, { reference: mat.uniforms[key].value,
          value: ArrayBuffer.isView(mat.uniforms[key].value) ? [...mat.uniforms[key].value] : mat.uniforms[key].value }]))));
  }
  advance(fire, 3); advance(reference, 3);
  near(fire.st.intro, .25, 1e-12);
  for (const key of ['base', 'omega', 'phase', 'flare', 'climb', 'hold', 'target', 'targetOmega', 'combo', 'flow']) {
    assert.equal(fire.st[key], reference.st[key], key + ' integration is independent of the introduction');
  }
  assert.ok(fire.st.base > LOOK.FIRE_BY_MULT[1] && fire.st.flare > 0 && fire.st.climb > 0);
  near(fire.st.value, reference.st.value * fire.st.intro, 1e-12);
  for (const name of ['main', 'backM']) {
    for (const key of ['uIntensity', 'uTip']) near(fire[name].uniforms[key].value,
      reference[name].uniforms[key].value * fire.st.intro, 1e-12);
    for (const key of ['uFlow', 'uHot']) assert.equal(fire[name].uniforms[key].value, reference[name].uniforms[key].value);
  }
  [fire, reference].forEach((f, index) => [f.main, f.backM].forEach((mat, materialIndex) => {
    for (const [key, expected] of Object.entries(expectedMasks[index][materialIndex])) {
      assert.equal(mat.uniforms[key].value, expected.reference, key + ' storage is retained');
      assert.deepEqual(ArrayBuffer.isView(expected.reference) ? [...mat.uniforms[key].value] : mat.uniforms[key].value,
        expected.value, key + ' mask values are retained');
    }
  }));
});

test('one quarter of sparks is taller and smaller with unchanged legacy random draws and prefix counts', () => {
  const fire = fresh(), geometry = fire.sparks.geometry;
  const { aSeed, aSize, aRand, aLift } = geometry.attributes;
  assert.equal(LOOK.SPARKS, 620); assert.equal(LOOK.SPARKS_LITE, 206);
  assert.equal(aLift.itemSize, 1); assert.equal(aLift.count, 620);
  let state = 12345, tallFull = 0, tallLite = 0;
  // Reproduce the old six draws per spark: seed, size, rare-large decision, then xyz randomness.
  // Exact comparisons protect the existing field against an accidental extra PRNG draw.
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 620; i++) {
    const seed = random(), size = 1.6 + random() * 3.2 * (random() < .12 ? 2 : 1);
    const tall = i % 4 === 0;
    assert.equal(aSeed.array[i], Math.fround(seed), 'seed' + i);
    for (let axis = 0; axis < 3; axis++) assert.equal(aRand.array[i * 3 + axis], Math.fround(random()), 'random' + i + '/' + axis);
    assert.equal(aLift.array[i], Math.fround(tall ? 1.35 : 1), 'lift' + i);
    assert.equal(aSize.array[i], Math.fround(size * (tall ? .7 : 1)), 'size' + i);
    if (tall) { tallFull++; if (i < 206) tallLite++; }
  }
  assert.equal(tallFull, 155); assert.equal(tallLite, 52);
  fire.setLite(true);
  assert.equal(geometry.drawRange.start, 0); assert.equal(geometry.drawRange.count, 206);
  fire.setLite(false);
  assert.equal(geometry.drawRange.start, 0); assert.equal(geometry.drawRange.count, 620);
  assert.equal(fire.sparkMat.uniforms.uScale.value, 1, 'the initial point scale is unchanged');
  assert.equal(fire.sparkMat.uniforms.uHeight.value, 980, 'the common height is unchanged');
});

test('spark attribute objects, buffers, values and upload versions remain fixed through updates and quality changes', () => {
  const fire = fresh(), geometry = fire.sparks.geometry;
  const uploads = Object.fromEntries(Object.entries(geometry.attributes).map(([key, attribute]) => [key,
    { attribute, array: attribute.array, version: attribute.version, values: [...attribute.array] }]));
  assert.ok(uploads.aLift, 'the static per-spark lift is part of the constructed geometry');
  fire.reset(true);
  for (let i = 1; i <= 30; i++) {
    if (i === 4) fire.setMult(5);
    if (i === 8) fire.flare(.8, .2, true);
    if (i === 11) fire.setLite(true);
    if (i === 14) fire.setReducedMotion(true);
    if (i === 17) fire.reset(false);
    if (i === 20) fire.setLite(false);
    if (i === 23) fire.setReducedMotion(false);
    fire.update(i * .1, .1);
    for (const [key, before] of Object.entries(uploads)) {
      assert.equal(geometry.attributes[key], before.attribute, key + ' attribute');
      assert.equal(geometry.attributes[key].array, before.array, key + ' array');
      assert.equal(geometry.attributes[key].version, before.version, key + ' upload version');
      assert.deepEqual([...geometry.attributes[key].array], before.values, key + ' contents');
    }
  }
});
