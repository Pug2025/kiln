import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { createHeadroomAssets, headroomKey } from '../src/render/headroom-assets.js';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const paths = key => [`img/headroom/${key}.webp`, `img/headroom/${key}_mid.webp`, `img/headroom/${key}_glow.png`];
function fixture(keys = ['ember', 'blaze', 'core']) {
  const requests = [], uploads = [], binds = [];
  let bound = null;
  const assets = createHeadroomAssets({
    select() { bound = null; }, detach() { bound = null; },
    upload(texture) { uploads.push(texture); },
    bind(key, bundle) { bound = { key, far: bundle.far, mid: bundle.mid, mask: bundle.mask }; binds.push(bound); },
  });
  function texture(name, image = { closes: 0, close() { this.closes++; } }) {
    return { name, image, disposals: 0, dispose() {
      assert.ok(!bound || ![bound.far, bound.mid, bound.mask].includes(this), 'detach samplers before disposal');
      this.disposals++;
    } };
  }
  return {
    assets, requests, uploads, binds, texture, bound: () => bound,
    configure() { assets.configure(new Set(keys.flatMap(paths)), (path, srgb) => new Promise((resolve, reject) => requests.push({ path, srgb, resolve, reject }))); },
    request(key, channel = 0, occurrence = -1) {
      const rows = requests.filter(row => row.path === paths(key)[channel]);
      assert.ok(rows.length, `requested ${key}/${channel}`); return rows.at(occurrence);
    },
    async finish(key, prefix = key) {
      const textures = [0, 1, 2].map(channel => texture(`${prefix}-${channel}`));
      textures.forEach((value, channel) => this.request(key, channel).resolve(value));
      await flush(); return textures;
    },
  };
}

test('headroom selector follows boss boundaries and Overburn metadata without changing internal IDs', () => {
  assert.equal(headroomKey({ world: 'blaze', boss: 'crucible' }), 'crucible');
  assert.deepEqual([0, 1, 2, 3, 4].map(wave => headroomKey({ world: 'overburn' }, wave)), ['ember', 'ember', 'blaze', 'whiteheat', 'ember']);
  assert.equal(headroomKey({ world: 'whiteheat' }), 'whiteheat');
  assert.equal(headroomKey({ world: 'unknown' }), 'ember');
});

test('activation before READY loads only current art; same-key selection and CPU prefetch do not upload again', async () => {
  const f = fixture(); f.assets.activate('ember'); f.assets.prefetch('blaze');
  assert.equal(f.requests.length, 0); f.configure(); await flush();
  assert.equal(f.requests.length, 6);
  const next = await f.finish('blaze');
  assert.equal(f.uploads.length, 0); assert.equal(f.bound(), null);
  const current = await f.finish('ember');
  assert.deepEqual(f.uploads, current);
  f.assets.activate('ember'); f.assets.prefetch('ember'); f.assets.prefetch('blaze');
  assert.equal(f.requests.length, 6);
  f.assets.activate('blaze');
  assert.deepEqual(f.uploads, [...current, ...next]); assert.equal(f.requests.length, 6);
  assert.ok(current.every(t => t.disposals === 1 && t.image.closes === 1));
  assert.equal(f.bound().key, 'blaze'); f.assets.dispose();
  assert.ok(next.every(t => t.disposals === 1 && t.image.closes === 1));
});

test('stale A to B to A completions cannot replace new A or retain their sources', async () => {
  const f = fixture(); f.configure(); f.assets.activate('ember'); await flush();
  const old = [0, 1, 2].map(channel => f.request('ember', channel));
  f.assets.activate('blaze'); await flush(); f.assets.activate('ember'); await flush();
  const current = await f.finish('ember', 'new-A');
  const stale = old.map((request, channel) => { const t = f.texture(`old-A-${channel}`); request.resolve(t); return t; });
  const b = await f.finish('blaze'); await flush();
  assert.equal(f.bound().far, current[0]); assert.deepEqual(f.uploads, current);
  assert.ok([...stale, ...b].every(t => t.disposals === 1 && t.image.closes === 1));
  f.assets.dispose();
});

test('replacing the one CPU prefetch evicts complete and pending records without binding either', async () => {
  const f = fixture(); f.configure(); f.assets.activate('ember'); await flush(); await f.finish('ember');
  f.assets.prefetch('blaze'); await flush(); const next = await f.finish('blaze');
  f.assets.prefetch('core'); await flush();
  assert.ok(next.every(t => t.disposals === 1));
  const pending = [0, 1, 2].map(channel => f.request('core', channel));
  f.assets.prefetch('blaze'); await flush();
  const stale = pending.map((r, i) => { const t = f.texture(`stale-core-${i}`); r.resolve(t); return t; });
  await flush(); assert.ok(stale.every(t => t.disposals === 1));
  assert.equal(f.bound().key, 'ember'); assert.equal(f.uploads.length, 3); f.assets.dispose();
});

test('optional maps stay unattached before far and may fail without removing the valid far', async () => {
  const f = fixture(); f.configure(); f.assets.activate('core'); await flush();
  const mask = f.texture('mask'); f.request('core', 2).resolve(mask); await flush();
  assert.equal(f.bound(), null); assert.equal(f.uploads.length, 0);
  f.request('core', 1).reject(new Error('optional missing'));
  const far = f.texture('far'); f.request('core').resolve(far); await flush();
  assert.equal(f.bound().far, far); assert.equal(f.bound().mid, null); assert.equal(f.bound().mask, mask);
  assert.deepEqual(f.uploads, [far, mask]); f.assets.dispose();
});

test('failed far releases optional sources already decoded and those arriving later', async () => {
  const f = fixture(); f.configure(); f.assets.activate('core'); await flush();
  const mid = f.texture('mid'), mask = f.texture('mask');
  f.request('core', 1).resolve(mid); await flush(); f.request('core').resolve(null); await flush();
  f.request('core', 2).resolve(mask); await flush();
  assert.equal(f.bound(), null); assert.equal(f.uploads.length, 0);
  assert.equal(mid.disposals, 1); assert.equal(mask.disposals, 1); f.assets.dispose();
  assert.equal(mid.image.closes, 1); assert.equal(mask.image.closes, 1);
});

test('context restore binds/uploads only active sources and preserves CPU prefetch for later promotion', async () => {
  const f = fixture(); f.configure(); f.assets.activate('ember'); await flush();
  const a = await f.finish('ember'); f.assets.prefetch('blaze'); await flush();
  f.assets.contextLost(); const b = await f.finish('blaze');
  f.assets.activate('blaze'); assert.equal(f.bound(), null); assert.deepEqual(f.uploads, a);
  assert.ok(b.every(t => !t.disposals && !t.image.closes));
  f.assets.prefetch('core'); await flush(); const c = await f.finish('core');
  f.assets.contextRestored(); assert.equal(f.bound().far, b[0]); assert.deepEqual(f.uploads, [...a, ...b]);
  f.assets.contextLost(); f.assets.contextRestored(); assert.deepEqual(f.uploads, [...a, ...b, ...b]);
  assert.ok(c.every(t => !t.disposals && !t.image.closes)); f.assets.dispose();
  assert.ok([...a, ...b, ...c].every(t => t.disposals === 1 && t.image.closes === 1));
});

test('dispose before READY and during decode prevents late binding/upload and closes each bitmap once', async () => {
  const early = fixture(); early.assets.activate('ember'); early.assets.dispose(); early.configure(); await flush();
  assert.equal(early.requests.length, 0);
  const f = fixture(); f.configure(); f.assets.activate('ember'); f.assets.prefetch('blaze'); await flush();
  const shared = { closes: 0, close() { this.closes++; } };
  const textures = f.requests.map((r, i) => f.texture(`pending-${i}`, shared));
  f.assets.contextLost(); f.assets.dispose(); f.assets.dispose(); f.assets.contextRestored();
  f.requests.forEach((r, i) => r.resolve(textures[i])); await flush();
  assert.equal(f.bound(), null); assert.equal(f.uploads.length, 0);
  assert.ok(textures.every(t => t.disposals === 1)); assert.equal(shared.closes, 1);
});

const threeURL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec,ctx,next){if(spec==='three')return{url:${JSON.stringify(threeURL)},shortCircuit:true};return next(spec,ctx);}`)}`);
const THREE = await import(threeURL);
const { createHeadroom } = await import('../src/render/headroom.js');

test('ready prefetch promotion skips procedural painting and same-key Core stages retain the bundle', async () => {
  const previousDocument = globalThis.document;
  let canvases = 0;
  const context = new Proxy({}, { get(target, key) {
    if (key === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => {};
  } });
  globalThis.document = { createElement: () => { canvases++; return { getContext: () => context }; } };
  try {
    const room = createHeadroom(new THREE.Scene()), requests = [];
    const assets = createHeadroomAssets({ select: (...args) => room.select(...args), bind: (...args) => room.setBundle(...args), detach: () => room.detach(), upload() {} });
    assets.activate('ember'); assert.equal(canvases, 2);
    assets.configure(new Set(['img/headroom/ember.webp', 'img/headroom/core.webp', 'img/headroom/core_mid.webp']), path => new Promise(resolve => requests.push({ path, resolve })));
    await flush(); requests[0].resolve(new THREE.Texture()); await flush();
    assets.prefetch('core'); await flush();
    const far = new THREE.Texture(), mid = new THREE.Texture();
    requests.find(r => r.path.endsWith('/core.webp')).resolve(far); requests.find(r => r.path.endsWith('/core_mid.webp')).resolve(mid); await flush();
    const world = stage => ({ level: { def: { boss: 'core', stage }, mode: 'bottom' }, bricks: { version: 0, count: 0 }, boss: { phase: 0 } });
    assets.activate('core'); room.setWorld(world(1));
    assert.equal(canvases, 2, 'ready new-world far binds without painting its fallback');
    assert.equal(room.far.material.uniforms.uMap.value, far); assert.equal(room.mid.material.uniforms.uMid.value, mid);
    assert.equal(room.mid.material.uniforms.uPart.value, -20.2);
    assets.activate('core'); room.setWorld(world(3));
    assert.equal(canvases, 2); assert.equal(room.far.material.uniforms.uMap.value, far);
    assert.equal(room.mid.material.uniforms.uPart.value, 0);
    assets.dispose(); room.dispose();
  } finally { globalThis.document = previousDocument; }
});

test('actual headroom releases procedural GPU wrappers after final bind and borrows only its selected bundle', () => {
  const previousDocument = globalThis.document;
  const context = new Proxy({}, { get(target, key) {
    if (key === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => {};
  } });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try {
    const scene = new THREE.Scene(), room = createHeadroom(scene);
    const samplers = () => [room.far.material.uniforms.uMap.value, room.far.material.uniforms.uMask.value, room.mid.material.uniforms.uMid.value];
    room.select('ember'); const initial = samplers(), counts = new Map();
    for (const t of [initial[0], initial[2]]) t.addEventListener('dispose', () => {
      assert.ok(!samplers().includes(t), 'procedural samplers detach before GPU disposal'); counts.set(t, (counts.get(t) || 0) + 1);
    });
    const far = new THREE.Texture(), mid = new THREE.Texture(), mask = new THREE.Texture();
    room.setBundle('ember', { key: 'ember', far, mid, mask });
    assert.deepEqual(samplers(), [far, mask, mid]); assert.deepEqual([...counts.values()], [1, 1]);
    room.setQuality(true, true); assert.deepEqual(samplers(), [far, mask, mid]);
    room.select('blaze'); assert.ok(samplers().every(t => ![far, mid, mask].includes(t)));
    room.setBundle('ember', { key: 'ember', far, mid, mask }); assert.ok(!samplers().includes(far));
    const placeholders = [samplers()[0], samplers()[2]];
    for (const t of placeholders) t.addEventListener('dispose', () => { assert.ok(!samplers().includes(t)); counts.set(t, (counts.get(t) || 0) + 1); });
    room.detach(); room.dispose(); room.dispose(); assert.equal(scene.children.length, 0);
    assert.ok([...counts.values()].every(n => n === 1));
  } finally { globalThis.document = previousDocument; }
});

test('renderer hooks preserve first-draw kit start and restore active art before hidden-scene warm-up', async () => {
  const source = readFileSync(new URL('../src/render/renderer.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function startKit() {'), end = source.indexOf('\n  // ---- per-frame helpers', start);
  const calls = [], assets = { configure: (...args) => calls.push(['configure', ...args]) };
  const env = {
    kitStarted: false, disposed: false, M: {}, gl: { capabilities: { getMaxAnisotropy: () => 8 } }, glWatch: { lost: false },
    actors: { setDropAtlas() {} }, boss: { setModel() {}, refreshMaps() { calls.push(['common']); } }, backdrop: null,
    headroomAssets: assets, warmUp() { calls.push(['warm']); },
    loadKit(hooks) { calls.push(['load']); hooks.onHeadroomReady('ready', 'decode'); return Promise.resolve(); },
  };
  const run = new Function('env', `with(env){ ${source.slice(start, end)} return startKit; }`)(env);
  assert.equal(calls.length, 0); run(); run();
  assert.deepEqual(calls, [['load'], ['configure', 'ready', 'decode']]);
  await flush(); assert.deepEqual(calls.slice(2), [['common'], ['warm']]);
  const hookStart = source.indexOf('  const glWatch = watchContext('), hookEnd = source.indexOf('\n  });', hookStart) + 6;
  const trace = [], mark = label => () => trace.push(label);
  const hooksEnv = {
    canvas: {}, host: {}, contextEpoch: 0, disposed: false, bootJob: { cancel: mark('cancel') },
    watchContext(canvas, hooks) { return hooks; },
    headroomAssets: { contextLost: mark('art-lost'), contextRestored: mark('art-restore') },
    post: { contextLost: mark('post-lost') }, scene: { environment: { dispose: mark('environment-dispose') } },
    gpuTimer: { rebuild: mark('timer') }, resize: mark('resize'), makeEnvironment: () => ({}), gl: {},
    boss: { refreshMaps: mark('boss') }, warmUp: mark('warm'),
  };
  const hooks = new Function('env', `with(env){ ${source.slice(hookStart, hookEnd)} return glWatch; }`)(hooksEnv);
  hooks.onLost(); hooks.onRestored();
  assert.deepEqual(trace, ['art-lost', 'cancel', 'post-lost', 'environment-dispose', 'timer', 'resize', 'art-restore', 'boss', 'warm']);
});
