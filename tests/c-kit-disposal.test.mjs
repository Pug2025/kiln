// Actual production loader, with only Three loaders and fetch replaced by controllable IO.
import { register } from 'node:module';
import { test, assert } from './lib.mjs';
const stubURL = new URL('./fixtures/C/kit-loader-stub.mjs', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec,ctx,next){if(spec==='three'||spec==='three/addons/loaders/GLTFLoader.js')return{url:${JSON.stringify(stubURL)},shortCircuit:true};return next(spec,ctx);}`)}`);
const stub = await import(stubURL);
const { loadKit } = await import('../src/render/kit.js');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };
const until = async predicate => { for (let n = 0; n < 30 && !predicate(); n++) await new Promise(setImmediate); assert.ok(predicate(), 'expected asynchronous loader boundary becomes available'); };
const image = name => ({ name, closes: 0, close() { this.closes++; } });
const disposable = name => ({ name, disposals: 0, dispose() { this.disposals++; } });
function fixture(manifest, { bitmap = false, fetchResponse = null, textResponse = null } = {}) {
  stub.reset();
  const previousFetch = globalThis.fetch, previousBitmap = globalThis.createImageBitmap;
  if (bitmap) globalThis.createImageBitmap = () => {}; else delete globalThis.createImageBitmap;
  const state = { disposed: false, upload: true }, uploads = [], callbacks = [], fetches = [];
  const material = name => ({ name, map: { previous: name }, normalMap: { previous: name + '-normal' }, normalScale: { previous: true }, needsUpdate: false });
  const M = { core: material('core'), fragCeramic: material('fragments'), bossCore: material('boss'),
    matte: material('matte'), matteP: material('matte-plain'), matteFree: material('matte-free'), tex: { existing: true } };
  const originals = Object.fromEntries(Object.entries(M).filter(([name]) => name !== 'tex').map(([name, value]) => [name, { ...value }]));
  globalThis.fetch = async (...args) => { fetches.push(args); return fetchResponse ? fetchResponse.promise : { ok: true, text: () => textResponse ? textResponse.promise : Promise.resolve(manifest) }; };
  const h = { M, isDisposed: () => state.disposed, canUpload: () => state.upload, aniso: 8,
    gl: { initTexture(texture) { uploads.push(texture); assert.equal(state.disposed, false, 'no upload after renderer disposal'); assert.equal(state.upload, true, 'no upload while context is lost'); } },
    onDropAtlas: (...args) => { callbacks.push(['drop', ...args]); assert.equal(state.disposed, false); },
    onPlate: (...args) => { callbacks.push(['plate', ...args]); assert.equal(state.disposed, false); },
    onModel: (...args) => { callbacks.push(['model', ...args]); assert.equal(state.disposed, false); },
  };
  function untouched() {
    for (const [name, value] of Object.entries(originals)) assert.deepEqual(M[name], value, name + ' remains unchanged');
    assert.deepEqual(M.tex, { existing: true }); assert.deepEqual(callbacks, []);
  }
  return { state, uploads, callbacks, fetches, M, h, untouched,
    start: () => loadKit(h, 'https://kit.test/'),
    request(path) { const request = stub.STUB.requests.find(row => row.url.endsWith(path)); assert.ok(request, path + ' requested'); return request; },
    restore() { globalThis.fetch = previousFetch; if (previousBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = previousBitmap; },
  };
}
const pair = 'textures/crackle.png\ntextures/crackle_n.png';

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
  const f = fixture(pair), first = new stub.Texture(image('crackle'));
  try {
    const loading = f.start(); await until(() => stub.STUB.requests.length === 2);
    f.request('textures/crackle.png').onLoad(first); f.request('textures/crackle_n.png').onError(new Error('missing optional normal'));
    await loading; f.untouched(); assert.equal(first.disposals, 1); assert.equal(first.image.closes, 1);
  } finally { f.restore(); }
});
