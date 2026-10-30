// C: the title flame (src/render/wordmark.js) keeps ONE WebGL renderer for the whole session.
// Review blocker 2026-10-22: a renderer per title mount used up the browser's WebGL slots until
// Chrome dropped the game's own context. Node cannot load three.js, so `three` resolves to a stub
// (tests/fixtures/C/three-stub.mjs) through a module hook registered in this test's worker.

import { register } from 'node:module';
import { test, assert } from './lib.mjs';

const STUB_URL = new URL('./fixtures/C/three-stub.mjs', import.meta.url).href;
const hooks = `export async function resolve(spec, ctx, next) {
  if (spec === 'three' || spec === 'three/addons/geometries/RoundedBoxGeometry.js') return { url: ${JSON.stringify(STUB_URL)}, shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const stub = await import(STUB_URL);
const { observers, frames } = stub.installDom();
const { createWordmarkFlame, wordmarkFlameInfo } = await import('../src/render/wordmark.js');

function slot() {
  return stub.fakeElement('span', 30, 110);
}

function draw(flame, host, t) {
  const count = stub.STUB.renders;
  flame.frame(t);
  assert.equal(stub.STUB.renders, count + 1, 'the actual component drew');
  const row = stub.STUB.renderLog.at(-1), u = row.scene.children[0].material.uniforms;
  // Material uniforms are mutable; copy each draw's numbers rather than retaining references.
  return { time: u.uTime.value, intensity: u.uIntensity.value, opacity: Number(host.children[0].style.opacity) };
}

test('title flame reduced-motion first mount stays static without acquiring a renderer', () => {
  const host = slot(), before = stub.STUB.renderers, count = stub.STUB.renders;
  const f = createWordmarkFlame(host, { reduceMotion: true });
  f.frame(0); f.frame(80000); f.resize(); f.dispose(); f.dispose();
  assert.equal(stub.STUB.renderers, before);
  assert.equal(stub.STUB.renders, count);
  assert.equal(host.children.length, 0);
  assert.match(host.style.background, /linear-gradient/);
  assert.equal(wordmarkFlameInfo().mounted, false);
});

test('title flame: 40 round trips to the title make one WebGL renderer', () => {
  const before = stub.STUB.renderers;
  for (let i = 0; i < 40; i++) {
    const host = slot();
    const f = createWordmarkFlame(host);
    f.frame(i * 0.016);
    f.dispose();
  }
  assert.equal(stub.STUB.renderers - before, before === 0 ? 1 : 0, 'one renderer for the session');
  assert.equal(wordmarkFlameInfo().renderers, 1);
  assert.equal(stub.STUB.disposed, 0, 'the shared renderer is never disposed');
});

test('title flame: the canvas moves into the newest slot; the old slot keeps a static flame', () => {
  const a = slot();
  const b = slot();
  const fa = createWordmarkFlame(a);
  assert.equal(a.children.length, 1, 'slot a holds the canvas');
  const canvas = a.children[0];
  const fb = createWordmarkFlame(b);
  assert.equal(a.children.length, 0, 'slot a gave the canvas up');
  assert.equal(b.children[0], canvas, 'slot b holds the same canvas');
  assert.match(a.style.background, /linear-gradient/, 'slot a is never a dark hole');
  assert.match(b.style.background, /linear-gradient/, 'the live canvas keeps its static underlay');
  assert.equal(canvas.style.opacity, '0', 'a new owner cannot expose the previous owner image');
  // a stale handle neither draws nor takes the canvas back
  const r0 = stub.STUB.renders;
  fa.frame(1);
  assert.equal(stub.STUB.renders, r0, 'the old flame does not draw');
  fb.frame(1);
  assert.equal(stub.STUB.renders, r0 + 1, 'the live flame draws');
  fa.dispose();
  assert.equal(b.children[0], canvas, 'disposing the old flame leaves the new slot alone');
  fb.dispose();
  assert.equal(b.children.length, 0, 'dispose detaches the canvas');
  assert.match(b.style.background, /linear-gradient/, 'a disposed slot fades out with a static flame');
  assert.equal(wordmarkFlameInfo().mounted, false);
});

test('title flame: the resize observer follows the slot that holds the canvas', () => {
  const ro = observers[0];
  assert.ok(ro, 'one observer');
  const a = slot();
  const fa = createWordmarkFlame(a);
  assert.ok(ro.targets.has(a));
  const b = slot();
  createWordmarkFlame(b).dispose();
  assert.equal(ro.targets.size, 0, 'nothing observed after the last slot went');
  fa.dispose();
  assert.equal(observers.length, 1, 'one observer for the session');
});

test('title flame uses its owner mount age rather than growing page uptime', () => {
  const uniforms = () => stub.STUB.renderLog.at(-1).scene.children[0].material.uniforms;
  const low = createWordmarkFlame(slot());
  low.frame(0); low.frame(60);
  const expected = { time: uniforms().uTime.value, intensity: uniforms().uIntensity.value };
  low.dispose();
  const high = createWordmarkFlame(slot());
  high.frame(79940); high.frame(80000);
  assert.equal(uniforms().uTime.value, expected.time);
  assert.equal(uniforms().uIntensity.value, expected.intensity);
  const old = high, newer = createWordmarkFlame(slot());
  old.frame(90000); newer.frame(80001);
  assert.equal(uniforms().uTime.value, 0, 'stale owners cannot initialize a new owner origin');
  newer.frame(80002);
  assert.equal(uniforms().uTime.value, 1.4);
  const count = stub.STUB.renders;
  newer.frame(NaN); assert.equal(stub.STUB.renders, count, 'an invalid page timestamp cannot poison the mount origin');
  newer.dispose(); old.dispose();
});

test('title flame rejects invalid, hidden and zero-size calls before its first valid timestamp', () => {
  const host = slot(), f = createWordmarkFlame(host), count = stub.STUB.renders;
  f.frame(NaN); f.frame(Infinity); f.frame(-Infinity);
  document.hidden = true;
  f.frame(90000);
  document.hidden = false;
  host.clientWidth = 0; f.resize(); f.frame(91000);
  assert.equal(stub.STUB.renders, count, 'ineligible calls cannot initialize the clock');
  host.clientWidth = 30; f.resize();
  assert.deepEqual(draw(f, host, 92000), { time: 0, intensity: 1, opacity: 0 });
  assert.deepEqual(draw(f, host, 92001), { time: 1.4, intensity: 1 + .15 * Math.sin(2.1), opacity: 1 });
  f.dispose();
});

test('title flame wraps two owner-local segments only through a complete hidden draw', () => {
  const ages = [0, .125, .25, 60, 599.5, 599.75, 599.875, 600, 600, 600.125, 600.25,
    601, 1199.5, 1199.75, 1199.875, 1200, 1200.125, 1200.25];
  const replay = origin => {
    const host = slot(), f = createWordmarkFlame(host), rows = ages.map(age => draw(f, host, origin + age));
    f.dispose();
    return rows;
  };
  const low = replay(0), high = replay(79940);
  assert.deepEqual(high, low, 'same owner ages produce the same real uniforms and canvas opacity');
  for (const row of low) assert.ok(row.time >= 0 && row.time < 840 && row.opacity >= 0 && row.opacity <= 1);
  assert.deepEqual(low.slice(0, 3).map(row => row.opacity), [0, .5, 1]);
  assert.equal(low[5].time, low[4].time, 'fade-out holds the last rendered pattern');
  assert.equal(low[6].time, low[4].time); assert.equal(low[6].opacity, .5);
  assert.deepEqual(low[7], { time: 0, intensity: 1, opacity: 0 });
  assert.deepEqual(low[8], low[7], 'a repeated timestamp cannot advance the hidden reveal');
  assert.equal(low[9].opacity, .5); assert.ok(low[9].time > 0, 'motion resumes behind the reveal');
  assert.equal(low[10].opacity, 1);
  assert.deepEqual(low[15], { time: 0, intensity: 1, opacity: 0 });
  assert.equal(low[17].opacity, 1);
  assert.equal(frames.size, 0, 'the flame adds no animation-frame loop');
});

test('title flame a skipped boundary freezes the last image and backward time cannot rewind a fade', () => {
  const host = slot(), f = createWordmarkFlame(host);
  draw(f, host, 0); draw(f, host, .25);
  const prior = draw(f, host, 599), out = draw(f, host, 80000);
  assert.deepEqual(out, prior, 'a huge gap never exposes an arbitrary FBM replacement');
  const half = draw(f, host, 80000.125);
  assert.equal(half.time, prior.time); assert.equal(half.opacity, .5);
  const count = stub.STUB.renders;
  f.frame(79999);
  assert.equal(stub.STUB.renders, count, 'backward input is inert');
  assert.deepEqual(draw(f, host, 80000.125), half);
  assert.deepEqual(draw(f, host, 80000.25), { time: 0, intensity: 1, opacity: 0 });
  assert.deepEqual(draw(f, host, 80000.25), { time: 0, intensity: 1, opacity: 0 });
  const reveal = draw(f, host, 80000.375);
  assert.equal(reveal.opacity, .5); assert.equal(reveal.time, .125 * 1.4);
  f.dispose();
});

test('title flame commits reset time and intensity only while the render call sees zero canvas opacity', () => {
  const host = slot(), f = createWordmarkFlame(host);
  draw(f, host, 0); draw(f, host, .25); draw(f, host, 599.5); draw(f, host, 599.75);
  const renderer = stub.STUB.renderLog.at(-1).renderer, original = renderer.render, seen = [];
  renderer.render = function(scene, camera) {
    const u = scene.children[0].material.uniforms;
    seen.push({ time: u.uTime.value, intensity: u.uIntensity.value, opacity: Number(this.domElement.style.opacity) });
    return original.call(this, scene, camera);
  };
  try {
    draw(f, host, 600);
    assert.deepEqual(seen, [{ time: 0, intensity: 1, opacity: 0 }]);
    const next = draw(f, host, 600.125);
    assert.equal(next.opacity, .5); assert.ok(next.time > 0);
  } finally { renderer.render = original; f.dispose(); }
});

test('title flame resize and takeover keep origins and canvas ownership separate through a wrap', () => {
  const a = slot(), fa = createWordmarkFlame(a);
  draw(fa, a, 0); draw(fa, a, .25); draw(fa, a, 599.5); draw(fa, a, 599.75);
  a.clientWidth = 60; fa.resize();
  const half = draw(fa, a, 599.875);
  assert.equal(half.time, 599.5 * 1.4); assert.equal(half.opacity, .5);
  const b = slot(), fb = createWordmarkFlame(b), canvas = b.children[0];
  const count = stub.STUB.renders;
  fa.frame(600); fa.resize(); fa.dispose();
  assert.equal(stub.STUB.renders, count);
  assert.equal(b.children[0], canvas); assert.equal(canvas.style.opacity, '0');
  assert.deepEqual(draw(fb, b, 80000), { time: 0, intensity: 1, opacity: 0 });
  draw(fb, b, 80000.25); draw(fb, b, 80599.5); draw(fb, b, 80599.75);
  assert.deepEqual(draw(fb, b, 80600), { time: 0, intensity: 1, opacity: 0 });
  b.clientWidth = 40; fb.resize();
  assert.equal(draw(fb, b, 80600.125).time, .125 * 1.4, 'a hidden-frame resize does not restart time');
  fb.dispose();
  fb.frame(90000); fb.resize(); fb.dispose();
  assert.equal(wordmarkFlameInfo().mounted, false);
});

test('title flame context loss conceals every fade state and restoration draws before revealing', () => {
  const states = [
    { frames: [0, .25, 60], restore: 61, age: 61 },
    { frames: [0, .25, 599.5, 599.75, 599.875], restore: 80000, age: 0 },
    { frames: [0, .25, 599.5, 599.75, 600], restore: 600.125, age: .125 },
    { frames: [0, .125], restore: 1, age: 1 },
  ];
  for (const state of states) {
    const host = slot(), f = createWordmarkFlame(host), canvas = host.children[0];
    for (const t of state.frames) draw(f, host, t);
    assert.equal(canvas.listeners.get('webglcontextlost').size, 1);
    assert.equal(canvas.listeners.get('webglcontextrestored').size, 1);
    let prevented = false;
    canvas.dispatch('webglcontextlost', { preventDefault() { prevented = true; } });
    try {
      assert.equal(prevented, true); assert.equal(canvas.style.opacity, '0');
      const count = stub.STUB.renders;
      f.frame(state.restore);
      assert.equal(stub.STUB.renders, count, 'a lost renderer never draws');
    } finally { canvas.dispatch('webglcontextrestored'); }
    const restored = draw(f, host, state.restore);
    assert.equal(restored.opacity, 0); assert.equal(restored.time, state.age * 1.4);
    assert.equal(draw(f, host, state.restore + .25).opacity, 1);
    assert.match(host.style.background, /linear-gradient/);
    f.dispose();
  }
  assert.equal(stub.STUB.disposed, 0);
});

test('title flame a new owner mounted during loss captures only its restored first valid time', () => {
  const a = slot(), fa = createWordmarkFlame(a), canvas = a.children[0];
  draw(fa, a, 0); draw(fa, a, .25);
  canvas.dispatch('webglcontextlost', { preventDefault() {} });
  const b = slot(), fb = createWordmarkFlame(b), count = stub.STUB.renders;
  fb.frame(79940); fa.frame(80000); fa.dispose();
  assert.equal(stub.STUB.renders, count); assert.equal(b.children[0], canvas);
  canvas.dispatch('webglcontextrestored');
  assert.deepEqual(draw(fb, b, 80000), { time: 0, intensity: 1, opacity: 0 });
  assert.equal(draw(fb, b, 80001).time, 1.4);
  fb.dispose();
});

test('title flame draw failure leaves the static underlay and requires recovery before another draw', () => {
  const host = slot(), f = createWordmarkFlame(host);
  draw(f, host, 0);
  const renderer = stub.STUB.renderLog.at(-1).renderer, original = renderer.render;
  renderer.render = () => { throw new Error('fixture draw failed'); };
  try {
    f.frame(.125);
    assert.equal(host.children[0].style.opacity, '0'); assert.match(host.style.background, /linear-gradient/);
    renderer.render = original;
    const count = stub.STUB.renders;
    f.frame(.25);
    assert.equal(stub.STUB.renders, count, 'failed decorative draws are not retried every frame');
    host.children[0].dispatch('webglcontextrestored');
    const restored = draw(f, host, .5);
    assert.equal(restored.time, .7); assert.equal(restored.opacity, 0);
  } finally { renderer.render = original; f.dispose(); }
});

test('title flame failed first draw cannot reveal time before its attempted origin after recovery', () => {
  const host = slot(), f = createWordmarkFlame(host), canvas = host.children[0];
  const renderer = stub.STUB.renderLog.at(-1).renderer, original = renderer.render;
  renderer.render = () => { throw new Error('fixture first draw failed'); };
  try {
    f.frame(100);
    renderer.render = original;
    canvas.dispatch('webglcontextrestored');
    const count = stub.STUB.renders;
    f.frame(99); f.frame(99.25);
    assert.equal(stub.STUB.renders, count, 'input before the attempted origin is inert');
    assert.equal(canvas.style.opacity, '0');
    assert.deepEqual(draw(f, host, 100), { time: 0, intensity: 1, opacity: 0 });
    const reveal = draw(f, host, 100.25);
    assert.equal(reveal.time, .25 * 1.4); assert.equal(reveal.opacity, 1);
  } finally { renderer.render = original; f.dispose(); }
});

test('title flame failed hidden rebase cannot rewind to the previous segment after recovery', () => {
  const host = slot(), f = createWordmarkFlame(host), canvas = host.children[0];
  for (const t of [0, .25, 599.5, 599.75]) draw(f, host, t);
  const renderer = stub.STUB.renderLog.at(-1).renderer, original = renderer.render;
  renderer.render = () => { throw new Error('fixture hidden rebase failed'); };
  try {
    f.frame(600);
    renderer.render = original;
    canvas.dispatch('webglcontextrestored');
    const count = stub.STUB.renders;
    f.frame(599.9);
    assert.equal(stub.STUB.renders, count, 'a failed rebase still bounds the next segment');
    assert.deepEqual(draw(f, host, 600), { time: 0, intensity: 1, opacity: 0 });
    assert.equal(draw(f, host, 600.25).opacity, 1);
  } finally { renderer.render = original; f.dispose(); }
});

test('title flame current owner may dispose while lost and restoration without an owner stays inert', () => {
  const host = slot(), f = createWordmarkFlame(host), canvas = host.children[0];
  draw(f, host, -10); assert.equal(draw(f, host, -9.75).time, .25 * 1.4);
  canvas.dispatch('webglcontextlost', { preventDefault() {} });
  f.dispose();
  const count = stub.STUB.renders;
  canvas.dispatch('webglcontextrestored');
  f.frame(100); f.resize(); f.dispose();
  assert.equal(stub.STUB.renders, count); assert.equal(wordmarkFlameInfo().mounted, false);
  const nextHost = slot(), next = createWordmarkFlame(nextHost);
  assert.equal(nextHost.children[0], canvas);
  f.frame(1000); f.resize();
  assert.deepEqual(draw(next, nextHost, 80000), { time: 0, intensity: 1, opacity: 0 });
  assert.equal(draw(next, nextHost, 80000.25).opacity, 1);
  assert.equal(wordmarkFlameInfo().renderers, 1);
  next.dispose();
});

test('title flame reduced-motion remount retires only the same host live owner and reuses the renderer later', () => {
  const host = slot(), f = createWordmarkFlame(host), canvas = host.children[0];
  draw(f, host, 0); draw(f, host, .25);
  const count = stub.STUB.renders, renderers = stub.STUB.renderers;
  const reduced = createWordmarkFlame(host, { reduceMotion: true });
  f.frame(1); f.resize(); reduced.frame(1); reduced.resize(); reduced.dispose();
  assert.equal(stub.STUB.renders, count); assert.equal(host.children.length, 0);
  assert.equal(wordmarkFlameInfo().mounted, false);
  const nextHost = slot(), next = createWordmarkFlame(nextHost);
  assert.equal(nextHost.children[0], canvas);
  const other = slot(), otherReduced = createWordmarkFlame(other, { reduceMotion: true });
  assert.equal(nextHost.children[0], canvas, 'a different static host cannot detach the live canvas');
  assert.deepEqual(draw(next, nextHost, 80000), { time: 0, intensity: 1, opacity: 0 });
  assert.equal(stub.STUB.renderers, renderers, 'ordinary mounting reuses the session renderer');
  otherReduced.dispose(); f.dispose(); next.dispose();
});
