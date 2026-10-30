// The decorative title wall must remain bounded across title visits and stop all hidden work.
import { register } from 'node:module';
import { test, assert, near } from './lib.mjs';

const STUB_URL = new URL('./fixtures/C/three-stub.mjs', import.meta.url).href;
const hooks = `export async function resolve(spec, ctx, next) {
  if (spec === 'three' || spec === 'three/addons/geometries/RoundedBoxGeometry.js') return { url: ${JSON.stringify(STUB_URL)}, shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
const stub = await import(STUB_URL);
const dom = stub.installDom();
const { createTitleWall, titleWallInfo } = await import('../src/render/wordmark.js');
const host = (w = 500, h = 360) => stub.fakeElement('div', w, h);

test('title wall: 30 real glass/core cells use fixed instance matrices and heat', () => {
  const h = host();
  const wall = createTitleWall(h);
  assert.equal(wall.ready, false, 'the fallback remains until the first frame');
  dom.frame(1000);
  assert.ok(wall.ready && h.classList.contains('live'));
  assert.equal(stub.STUB.instances.length, 2, 'exactly two instanced meshes');
  const [core, shell] = stub.STUB.instances;
  assert.deepEqual(core.material.color, new stub.Color(0x383b41), 'the procedural title retains its original glaze tint');
  assert.equal(core.material.userData.u.uVeinMask.value, 0, 'the private title does not claim an R1 mask it never loads');
  assert.equal(core.count, 30);
  assert.equal(shell.count, 30);
  assert.deepEqual(core.matrices, shell.matrices, 'cores and shells stay aligned');
  assert.equal(new Set(core.matrices.map((m) => m[0])).size, 5);
  assert.equal(new Set(core.matrices.map((m) => m[1])).size, 6);
  const heat = core.geometry.attributes.aHeat.array;
  assert.equal(heat.length, 30);
  assert.ok(heat.every((v) => v > 0 && v < 1.1));
  assert.ok(heat[27] > heat[2], 'the wall heats toward its foot');
  const retained = new Set([core.material.map, core.material.normalMap]);
  assert.equal(retained.size, 2, 'the core retains its crackle and normal maps');
  for (const texture of stub.STUB.textures) {
    assert.equal(texture.disposals, retained.has(texture) ? 0 : 1,
      'retain sampled core textures and dispose every unused texture exactly once');
  }
  wall.dispose();
  assert.equal(dom.frames.size, 0);
});

test('title wall: the 12 second turn stays within eight degrees and reduced motion is still', () => {
  const wall = createTitleWall(host());
  dom.frame(1000);
  near(titleWallInfo().rotation, 0);
  dom.frame(4000);
  near(titleWallInfo().rotation, 8 * Math.PI / 180);
  dom.frame(10000);
  near(titleWallInfo().rotation, -8 * Math.PI / 180);
  dom.frame(13000);
  near(titleWallInfo().rotation, 0);
  wall.dispose();
  const reduced = createTitleWall(host(), { reduceMotion: true });
  dom.frame(20000);
  near(titleWallInfo().rotation, 0);
  assert.equal(dom.frames.size, 0, 'a still schedules no follow-up frame');
  const draws = titleWallInfo().draws;
  dom.frame(23000);
  assert.equal(titleWallInfo().draws, draws);
  reduced.dispose();
});

test('title wall: the decorative scene draws at 30 Hz while the game keeps its RAF cadence', () => {
  const before = titleWallInfo().draws;
  const wall = createTitleWall(host());
  for (let i = 0; i <= 120; i++) dom.frame(1000 + i * (1000 / 60));
  assert.equal(titleWallInfo().draws - before, 61, 'two seconds include the first frame and sixty timed draws');
  assert.equal(dom.frames.size, 1, 'one owner callback remains scheduled');
  wall.dispose();
  assert.equal(dom.frames.size, 0);
});

test('title wall: the matching cut follows real drawing and restores hidden, reduced and disposed titles', () => {
  const events = [];
  const h = host(0, 0);
  const wall = createTitleWall(h, { onActive: (on) => events.push(on) });
  assert.deepEqual(events, [], 'detached titles do not reduce the attract cadence');
  h.clientWidth = 390; h.clientHeight = 184;
  wall.resize(); dom.frame(1000);
  assert.deepEqual(events, [true]);
  h.clientHeight = 0;
  wall.resize();
  assert.deepEqual(events, [true, false], 'CSS-hidden decoration restores normal menus');
  h.clientHeight = 184;
  wall.resize(); dom.frame(1100);
  document.hidden = true;
  document.dispatch('visibilitychange');
  assert.deepEqual(events, [true, false, true, false], 'a hidden document restores normal cadence');
  document.hidden = false;
  document.dispatch('visibilitychange'); dom.frame(1200);
  wall.dispose();
  assert.deepEqual(events, [true, false, true, false, true, false]);
  const reduced = createTitleWall(host(), { reduceMotion: true, onActive: (on) => events.push(on) });
  dom.frame(1300); reduced.dispose();
  assert.equal(events.length, 6, 'a still wall needs no matching cut');
});

test('title wall: an OS reduce-motion change stops motion and restores the background cadence', () => {
  const oldMedia = window.matchMedia;
  const listeners = new Set();
  const mq = { matches: false, addEventListener(type, fn) { listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); } };
  window.matchMedia = () => mq;
  const events = [];
  const wall = createTitleWall(host(), { onActive: (on) => events.push(on) });
  try {
    dom.frame(1000);
    mq.matches = true;
    for (const fn of listeners) fn();
    dom.frame(1100);
    assert.equal(titleWallInfo().rotation, 0);
    assert.equal(dom.frames.size, 0);
    assert.deepEqual(events, [true, false]);
    mq.matches = false;
    for (const fn of listeners) fn();
    dom.frame(1200);
    assert.deepEqual(events, [true, false, true]);
  } finally { wall.dispose(); window.matchMedia = oldMedia; }
  assert.equal(listeners.size, 0, 'the owner releases its media listener');
});

test('title wall: an initial OS motion preference does not latch the live main getter', () => {
  const oldMedia = window.matchMedia;
  const listeners = new Set();
  const mq = { matches: true, addEventListener(type, fn) { listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); } };
  window.matchMedia = () => mq;
  const events = [];
  const wall = createTitleWall(host(), { reduceMotion: () => mq.matches, onActive: (on) => events.push(on) });
  try {
    dom.frame(1000);
    assert.equal(dom.frames.size, 0);
    assert.deepEqual(events, []);
    mq.matches = false;
    for (const fn of listeners) fn();
    dom.frame(1100);
    assert.deepEqual(events, [true]);
    assert.equal(dom.frames.size, 1);
  } finally { wall.dispose(); window.matchMedia = oldMedia; }
  assert.equal(listeners.size, 0);
});

test('title wall: detached/hidden hosts wait for a size; background tabs stop drawing', () => {
  const h = host(0, 0);
  const wall = createTitleWall(h);
  assert.equal(dom.frames.size, 0);
  assert.equal(wall.ready, false);
  h.clientWidth = 400;
  h.clientHeight = 160;
  dom.observers.at(-1).fn();
  dom.frame(1000);
  assert.equal(wall.ready, true);
  document.hidden = true;
  document.dispatch('visibilitychange');
  assert.equal(dom.frames.size, 0);
  const draws = titleWallInfo().draws;
  dom.frame(2000);
  assert.equal(titleWallInfo().draws, draws);
  document.hidden = false;
  document.dispatch('visibilitychange');
  assert.equal(dom.frames.size, 1);
  dom.frame(3000);
  h.clientHeight = 0;
  dom.observers.at(-1).fn();
  assert.equal(dom.frames.size, 0, 'a CSS-hidden short-phone wall does no work');
  wall.dispose();
});

test('title wall: context loss exposes fallback and restoration resumes one loop', () => {
  const h = host();
  const wall = createTitleWall(h);
  const canvas = h.children[0];
  dom.frame(1000);
  const scene = stub.STUB.renderLog.at(-1).scene;
  const previousEnvironment = stub.STUB.pmrem.at(-1).target;
  let prevented = false;
  canvas.dispatch('webglcontextlost', { preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(dom.frames.size, 0);
  assert.equal(h.classList.contains('live'), false);
  assert.equal(scene.environment, null, 'a lost title retains no map with prior-context GPU handles');
  assert.equal(previousEnvironment.disposals, 1, 'the complete PMREM target retires while the context is lost');
  canvas.dispatch('webglcontextrestored');
  assert.equal(previousEnvironment.disposals, 1, 'restoration does not dispose prior-context GPU handles again');
  assert.notEqual(stub.STUB.pmrem.at(-1).target, previousEnvironment, 'restoration makes a fresh environment');
  assert.equal(scene.environment, stub.STUB.pmrem.at(-1).target.texture);
  assert.equal(stub.STUB.pmrem.at(-1).target.disposals, 0, 'the new title environment remains live');
  assert.equal(dom.frames.size, 1);
  dom.frame(2000);
  assert.equal(h.classList.contains('live'), true);
  wall.dispose();
});

test('title wall: 40 round trips reuse resources and stale disposal cannot stop the next title', () => {
  const before = stub.STUB.renderers;
  const geometry = stub.STUB.instances[0].geometry;
  for (let i = 0; i < 40; i++) {
    const h = host();
    const wall = createTitleWall(h);
    dom.frame(i * 16);
    wall.dispose();
    wall.dispose();
    assert.equal(h.children.length, 0);
    assert.equal(h.classList.contains('live'), false);
    assert.equal(dom.frames.size, 0);
  }
  assert.equal(stub.STUB.renderers, before, 'the same renderer survives every visit');
  assert.equal(stub.STUB.instances.length, 2);
  assert.equal(stub.STUB.instances[0].geometry, geometry);
  assert.equal(document.listeners.get('visibilitychange').size, 0);
  assert.equal(window.listeners.get('resize').size, 0);
  assert.ok(dom.observers.every((ro) => ro.targets.size === 0));
  assert.equal(titleWallInfo().mounted, false);
  const a = host(), b = host();
  const wa = createTitleWall(a), wb = createTitleWall(b);
  wa.dispose();
  assert.equal(a.children.length, 0);
  assert.equal(b.children.length, 1);
  assert.equal(dom.frames.size, 1);
  wb.dispose();
});

test('title wall: unavailable WebGL leaves fallback art and creates no active handle', async () => {
  const unavailable = await import('../src/render/wordmark.js?no-webgl');
  const h = host();
  stub.STUB.failRenderer = true;
  try {
    assert.equal(unavailable.createTitleWall(h), null);
    assert.equal(unavailable.createTitleWall(h), null);
    assert.equal(h.children.length, 0);
    assert.equal(h.classList.contains('live'), false);
    assert.equal(unavailable.titleWallInfo().renderers, 0);
    assert.equal(dom.frames.size, 0);
  } finally { stub.STUB.failRenderer = false; }
});

test('title wall: a short phone allocates no wall context until the wall becomes visible', async () => {
  const lazy = await import('../src/render/wordmark.js?hidden-phone');
  const h = host(0, 0);
  const wall = lazy.createTitleWall(h);
  assert.equal(lazy.titleWallInfo().renderers, 0);
  assert.equal(dom.frames.size, 0);
  h.clientWidth = 390;
  h.clientHeight = 184;
  wall.resize();
  dom.frame(1000);
  assert.equal(lazy.titleWallInfo().renderers, 1);
  assert.equal(wall.ready, true);
  wall.dispose();
});
