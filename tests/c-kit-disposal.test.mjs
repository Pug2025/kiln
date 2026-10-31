// Actual production loader, with only Three loaders and fetch replaced by controllable IO.
import { register } from 'node:module';
import { test, assert } from './lib.mjs';
import { createHeadroomAssets } from '../src/render/headroom-assets.js';
const stubURL = new URL('./fixtures/C/kit-loader-stub.mjs', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec,ctx,next){if(spec==='three'||spec==='three/addons/loaders/GLTFLoader.js')return{url:${JSON.stringify(stubURL)},shortCircuit:true};return next(spec,ctx);}`)}`);
const stub = await import(stubURL);
const { loadKit } = await import('../src/render/kit.js');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };
// The model path waits on import('three/addons/...'), which the resolve hook above serves from
// Node's loader thread: real time, not a fixed number of event-loop turns. Under the gate's
// parallel workers 30 turns were sometimes too few (2 of 4 full runs on main d59935a), so wait by
// the clock instead, still failing if the boundary never comes.
const until = async predicate => { const end = Date.now() + 5000; while (!predicate() && Date.now() < end) await new Promise(setImmediate); assert.ok(predicate(), 'expected asynchronous loader boundary becomes available'); };
const image = name => ({ name, closes: 0, close() { this.closes++; } });
const disposable = name => ({ name, disposals: 0, dispose() { this.disposals++; } });
function fixture(manifest, { bitmap = false, fetchResponse = null, textResponse = null } = {}) {
  stub.reset();
  const previousFetch = globalThis.fetch, previousBitmap = globalThis.createImageBitmap;
  if (bitmap) globalThis.createImageBitmap = () => {}; else delete globalThis.createImageBitmap;
  const state = { disposed: false, upload: true }, uploads = [], callbacks = [], fetches = [];
  const headroomJobs = [];
  const material = name => ({ name, map: { previous: name }, normalMap: { previous: name + '-normal' }, normalScale: { previous: true }, needsUpdate: false });
  const M = { core: material('core'), fragCeramic: material('fragments'), bossCore: material('boss'),
    matte: material('matte'), matteP: material('matte-plain'), matteFree: material('matte-free'), tex: { existing: true } };
  for (const m of [M.core, M.bossCore]) m.userData = { u: { uVeinMask: { value: 0 } } };
  const originals = Object.fromEntries(Object.entries(M).filter(([name]) => name !== 'tex').map(([name, value]) => [name, { ...value }]));
  globalThis.fetch = async (...args) => { fetches.push(args); return fetchResponse ? fetchResponse.promise : { ok: true, text: () => textResponse ? textResponse.promise : Promise.resolve(manifest) }; };
  const h = { M, isDisposed: () => state.disposed, canUpload: () => state.upload, aniso: 8,
    gl: { initTexture(texture) { uploads.push(texture); assert.equal(state.disposed, false, 'no upload after renderer disposal'); assert.equal(state.upload, true, 'no upload while context is lost'); } },
    onDropAtlas: (...args) => { callbacks.push(['drop', ...args]); assert.equal(state.disposed, false); },
    onPlate: (...args) => { callbacks.push(['plate', ...args]); assert.equal(state.disposed, false); },
    onHeadroomReady(ready, decode) {
      for (const path of ready) if (path.startsWith('img/headroom/')) headroomJobs.push(decode(path, true)
        .then(texture => { if (texture) callbacks.push(['plate', path.split('/').at(-1).split('.')[0], texture]); }));
    },
    onModel: (...args) => { callbacks.push(['model', ...args]); assert.equal(state.disposed, false); },
  };
  function untouched() {
    for (const [name, value] of Object.entries(originals)) assert.deepEqual(M[name], value, name + ' remains unchanged');
    assert.deepEqual(M.tex, { existing: true }); assert.deepEqual(callbacks, []);
  }
  return { state, uploads, callbacks, fetches, M, h, untouched,
    start: async () => { const ready = await loadKit(h, 'https://kit.test/'); await Promise.all(headroomJobs); return ready; },
    request(path) { const request = stub.STUB.requests.find(row => row.url.endsWith(path)); assert.ok(request, path + ' requested'); return request; },
    restore() { globalThis.fetch = previousFetch; if (previousBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = previousBitmap; },
  };
}
const pair = 'textures/crackle.png\ntextures/crackle_n.png';
const trio = pair + '\ntextures/crackle_mask.png';

test('READY exposes decode-only headroom IO before common completion, without eager inactive-world requests', async () => {
  const manifest = ['glyphs/drops.png', 'img/headroom/ember.webp', 'img/headroom/ember_glow.png', 'img/headroom/blaze.webp'];
  const f = fixture(manifest.join('\n')), bound = [], uploaded = [];
  const assets = createHeadroomAssets({ select() {}, detach() {}, bind: (...args) => bound.push(args), upload: t => uploaded.push(t) });
  assets.activate('ember');
  f.h.onHeadroomReady = (ready, decode) => assets.configure(ready, decode);
  try {
    let completed = false; const loading = f.start().then(() => { completed = true; });
    await until(() => stub.STUB.requests.length === 3);
    assert.ok(!stub.STUB.requests.some(r => r.url.endsWith('blaze.webp')));
    const far = new stub.Texture(image('far')), mask = new stub.Texture(image('mask'));
    f.request('img/headroom/ember.webp').onLoad(far); f.request('img/headroom/ember_glow.png').onLoad(mask); await flush();
    assert.equal(completed, false, 'common download still pending');
    assert.equal(bound.at(-1)[1].far, far); assert.deepEqual(uploaded, [far, mask]);
    assert.equal(far.colorSpace, stub.SRGBColorSpace); assert.equal(mask.colorSpace, stub.NoColorSpace);
    assert.equal(f.uploads.length, 0, 'headroom decoder never eagerly uploads');
    f.request('glyphs/drops.png').onLoad(new stub.Texture(image('drop'))); await loading;
    assert.equal(f.uploads.length, 1, 'common drop retains its existing eager upload');
    assets.dispose(); assert.equal(far.image.closes, 1); assert.equal(mask.image.closes, 1);
  } finally { f.restore(); }
});

test('registered vein mask swaps with its glaze and grooves, including the boss material, without a context upload', async () => {
  const f = fixture(trio); f.state.upload = false;
  const [c, n, mask] = ['glaze', 'normal', 'mask'].map(name => new stub.Texture(image(name)));
  try {
    const loading = f.start(); await until(() => stub.STUB.requests.length === 3);
    f.request('textures/crackle_mask.png').onLoad(mask); await flush();
    assert.equal(f.M.core.userData.u.uVeinMask.value, 0, 'no mask reaches a material before its registered normal');
    assert.equal(f.M.core.map.previous, 'core');
    f.request('textures/crackle.png').onLoad(c); f.request('textures/crackle_n.png').onLoad(n); await loading;
    for (const m of [f.M.core, f.M.bossCore]) {
      assert.equal(m.map, c); assert.equal(m.normalMap, n); assert.equal(m.emissiveMap, mask);
      assert.equal(m.userData.u.uVeinMask.value, 1);
    }
    assert.equal(f.M.fragCeramic.map, c); assert.equal(f.M.fragCeramic.emissiveMap, undefined);
    assert.equal(f.M.tex.crackleMask, mask);
    assert.equal(mask.colorSpace, stub.NoColorSpace); assert.equal(mask.wrapS, stub.RepeatWrapping);
    assert.equal(f.uploads.length, 0); assert.ok([c, n, mask].every(t => t.disposals === 0));
  } finally { f.restore(); }
});

test('disposal before the registered trio commit releases its mask along with the glaze and normal', async () => {
  const f = fixture(trio, { bitmap: true });
  const images = ['glaze', 'normal', 'mask'].map(image);
  try {
    const loading = f.start(); await until(() => stub.STUB.requests.length === 3);
    f.request('textures/crackle.png').onLoad(images[0]); f.request('textures/crackle_n.png').onLoad(images[1]);
    await flush(); f.state.disposed = true; f.request('textures/crackle_mask.png').onLoad(images[2]);
    await loading; f.untouched();
    assert.equal(f.uploads.length, 2);
    assert.ok(stub.STUB.textures.every(t => t.disposals === 1)); assert.ok(images.every(i => i.closes === 1));
  } finally { f.restore(); }
});

test('a missing optional vein mask retains the registered glaze pair and the luminance fallback', async () => {
  const f = fixture(trio), c = new stub.Texture(image('glaze')), n = new stub.Texture(image('normal'));
  try {
    const loading = f.start(); await until(() => stub.STUB.requests.length === 3);
    f.request('textures/crackle.png').onLoad(c); f.request('textures/crackle_n.png').onLoad(n);
    f.request('textures/crackle_mask.png').onError(new Error('optional mask missing')); await loading;
    for (const m of [f.M.core, f.M.bossCore]) {
      assert.equal(m.map, c); assert.equal(m.normalMap, n); assert.equal(m.emissiveMap, c);
      assert.equal(m.userData.u.uVeinMask.value, 0);
    }
    assert.equal(f.M.tex.crackleMask, undefined); assert.equal(c.disposals, 0); assert.equal(n.disposals, 0);
  } finally { f.restore(); }
});

test('disposed before kit loading makes no fetch, decoder, upload or assignment', async () => {
  const f = fixture(pair); f.state.disposed = true;
  try {
    const ready = await f.start(); assert.equal(ready.size, 0); assert.equal(f.fetches.length, 0);
    assert.equal(stub.STUB.requests.length, 0); assert.equal(f.uploads.length, 0); f.untouched();
  } finally { f.restore(); }
});

test('disposal while manifest fetch or manifest text is pending prevents every asset request', async () => {
  for (const stage of ['fetch', 'text']) {
    const boundary = deferred(), f = fixture(pair, stage === 'fetch' ? { fetchResponse: boundary } : { textResponse: boundary });
    try {
      const loading = f.start(); await flush(); assert.equal(f.fetches.length, 1);
      f.state.disposed = true;
      boundary.resolve(stage === 'fetch' ? { ok: true, text: async () => pair } : pair);
      const ready = await loading; assert.equal(ready.size, 0); assert.equal(stub.STUB.requests.length, 0);
      assert.equal(f.uploads.length, 0); f.untouched();
    } finally { f.restore(); }
  }
});

test('disposal between bitmap pair decodes discards both resources once without later upload or partial material mutation', async () => {
  const f = fixture(pair, { bitmap: true }), first = image('crackle'), second = image('normal');
  try {
    const loading = f.start(); await until(() => stub.STUB.requests.length === 2);
    assert.ok(stub.STUB.requests.every(row => row.kind === 'bitmap'));
    f.request('textures/crackle.png').onLoad(first); await flush(); assert.equal(f.uploads.length, 1);
    f.state.disposed = true; f.request('textures/crackle_n.png').onLoad(second);
    await loading; f.untouched(); assert.equal(f.uploads.length, 1);
    assert.equal(stub.STUB.textures.length, 2); assert.ok(stub.STUB.textures.every(texture => texture.disposals === 1));
    assert.equal(first.closes, 1); assert.equal(second.closes, 1);
  } finally { f.restore(); }
});

test('disposal after both texture callbacks but before the pair commit cannot mutate materials', async () => {
  const f = fixture(pair), first = new stub.Texture(image('crackle')), second = new stub.Texture(image('normal'));
  try {
    const loading = f.start(); await until(() => stub.STUB.requests.length === 2);
    f.request('textures/crackle.png').onLoad(first); f.request('textures/crackle_n.png').onLoad(second);
    f.state.disposed = true; await loading;
    f.untouched(); assert.equal(first.disposals, 1); assert.equal(second.disposals, 1);
    assert.equal(first.image.closes, 1); assert.equal(second.image.closes, 1);
    assert.deepEqual(f.uploads, [first, second], 'only the uploads before disposal occurred');
  } finally { f.restore(); }
});

test('late drop, plate and backdrop decode callbacks after disposal neither upload nor invoke consumer hooks', async () => {
  const paths = ['glyphs/drops.png', 'img/headroom/ember.webp', 'img/backdrop.webp'];
  const f = fixture(paths.join('\n'), { bitmap: true });
  try {
    const loading = f.start(); await until(() => stub.STUB.requests.length === 3);
    f.state.disposed = true;
    const images = paths.map(path => image(path)); paths.forEach((path, index) => f.request(path).onLoad(images[index]));
    await loading; f.untouched(); assert.equal(f.uploads.length, 0);
    assert.ok(stub.STUB.textures.every(texture => texture.disposals === 1)); assert.ok(images.every(bitmap => bitmap.closes === 1));
  } finally { f.restore(); }
});

test('bitmap failure after disposal does not start a second texture-loader request', async () => {
  const f = fixture('glyphs/drops.png', { bitmap: true });
  try {
    const loading = f.start(); await until(() => stub.STUB.requests.length === 1);
    f.state.disposed = true; f.request('glyphs/drops.png').onError(new Error('decode failure'));
    await loading; assert.equal(stub.STUB.requests.length, 1); assert.equal(f.uploads.length, 0); f.untouched();
  } finally { f.restore(); }
});

test('a late model callback after disposal releases shared model geometry, materials and bitmap textures once', async () => {
  const f = fixture('models/stoker.glb'), geometry = disposable('geometry'), material = disposable('material');
  const texture = new stub.Texture(image('model-map')); material.map = material.normalMap = texture;
  const model = { traverse(fn) { for (const object of [{ geometry, material: [material, material] }, { geometry, material }]) fn(object); } };
  try {
    const loading = f.start(); await until(() => stub.STUB.requests.some(row => row.kind === 'model'));
    f.state.disposed = true; f.request('models/stoker.glb').onLoad({ scene: model }); await loading;
    f.untouched(); assert.equal(f.uploads.length, 0); assert.equal(geometry.disposals, 1); assert.equal(material.disposals, 1);
    assert.equal(texture.disposals, 1); assert.equal(texture.image.closes, 1);
  } finally { f.restore(); }
});

test('a lost context keeps decoded CPU textures assignable without upload or disposal for later restoration', async () => {
  const paths = ['textures/crackle.png', 'textures/crackle_n.png', 'textures/obsidian.png', 'textures/obsidian_n.png', 'glyphs/drops.png', 'img/headroom/ember.webp'];
  const f = fixture(paths.join('\n')); f.state.upload = false;
  try {
    const loading = f.start(); await until(() => stub.STUB.requests.length === paths.length);
    const textures = paths.map(path => new stub.Texture(image(path)));
    paths.forEach((path, index) => f.request(path).onLoad(textures[index])); await loading;
    assert.equal(f.uploads.length, 0); assert.ok(textures.every(texture => texture.disposals === 0 && texture.image.closes === 0));
    assert.equal(f.M.core.map, textures[0]); assert.equal(f.M.core.normalMap, textures[1]);
    assert.equal(f.M.fragCeramic.map, textures[0]); assert.equal(f.M.tex.crackleN, textures[1]);
    assert.equal(f.M.matteFree.map, textures[2]); assert.equal(f.M.matteFree.normalMap, textures[3]);
    assert.deepEqual(f.callbacks.map(row => row[0]), ['drop', 'plate']);
    assert.equal(f.callbacks[0][1], textures[4]); assert.equal(f.callbacks[1][2], textures[5]);
    f.state.upload = true; f.h.gl.initTexture(f.M.core.map);
    assert.deepEqual(f.uploads, [textures[0]], 'the same retained CPU owner remains usable by the restoration path');
  } finally { f.restore(); }
});

test('an optional failed normal texture discards its decoded partner without changing the procedural materials', async () => {
  const f = fixture(trio), first = new stub.Texture(image('crackle')), mask = new stub.Texture(image('mask'));
  try {
    const loading = f.start(); await until(() => stub.STUB.requests.length === 3);
    f.request('textures/crackle_mask.png').onLoad(mask);
    f.request('textures/crackle.png').onLoad(first); f.request('textures/crackle_n.png').onError(new Error('missing optional normal'));
    await loading; f.untouched(); assert.equal(first.disposals, 1); assert.equal(first.image.closes, 1);
    assert.equal(mask.disposals, 1); assert.equal(mask.image.closes, 1);
  } finally { f.restore(); }
});
