import { test, assert } from './lib.mjs';
import { worker, flush } from './fixtures/D/service-worker.mjs';

test('worker cache reads never mix active core, old or partially installed builds', async () => {
  const w = worker();
  w.addCache('kiln-core-incomplete-update', { 'src/main.js': 'partial new main' });
  w.addCache(w.core, { 'index.html': 'active index', 'src/content/content.js': 'active content' });
  assert.equal(await (await w.fetch('src/main.js')).text(), 'network', 'missing active file uses network, not another build');
  assert.equal(await (await w.fetch('src/content/content.js?retry=1')).text(), 'active content');
  assert.equal(await (await w.fetch('?level=23', { mode: 'navigate' })).text(), 'active index');
  assert.equal(w.globalMatches, 0);
});

test('cache read, open and write failures cannot hide a successful critical network response', async () => {
  for (const failure of ['match', 'open', 'put']) {
    const w = worker({ cacheFault: async (action) => { if (action === failure) throw new Error(`${failure} denied`); } });
    const response = await w.fetch('src/main.js');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'network');
    assert.equal(w.calls.length, 1);
    assert.ok(w.messages.some((message) => message.url === 'https://kiln.test/game/src/main.js' && message.error === `${failure} denied`));
    assert.ok(w.messages.every((message) => message.client === 'target'), 'fetch warnings stay with the affected client');
  }
});

test('a late lifetime-extension rejection cannot hide successful network responses', async () => {
  const w = worker();
  assert.equal(await (await w.fetch('src/main.js', { waitUntilError: true })).text(), 'network');
  assert.equal(await (await w.fetch('https://fonts.gstatic.com/font.woff2', { waitUntilError: true })).text(), 'network');
  await flush();
  assert.equal(w.calls.length, 2);
  assert.equal(w.timerCount, 0);
});

test('an unusable cached response permits network recovery instead of becoming a persistent failure', async () => {
  const w = worker();
  w.addCache(w.core, { 'src/main.js': new Response('bad old response', { status: 503 }) });
  assert.equal(await (await w.fetch('src/main.js')).text(), 'network');
  assert.equal(w.calls.length, 1);
  assert.equal(w.messages[0].stage, 'cache-response');
  assert.equal(w.messages[0].status, 503);
  assert.equal(w.cached(w.core, 'src/main.js').status, 200);
});

test('critical HTTP retries are bounded and preserve exact status and URL diagnostics', async () => {
  for (const status of [408, 429, 500, 503]) {
    const w = worker({ fetch: async (url, attempt) => new Response(attempt === 1 ? 'retry' : 'success', { status: attempt === 1 ? status : 200 }) });
    assert.equal(await (await w.fetch('src/main.js?v=exact')).text(), 'success');
    assert.equal(w.calls.length, 2);
    assert.equal(w.messages.length, 1);
    assert.equal(w.messages[0].url, 'https://kiln.test/game/src/main.js?v=exact');
    assert.equal(w.messages[0].status, status);
    assert.equal(w.messages[0].error, null);
    assert.equal(w.messages[0].attempt, 1);
    assert.equal(w.timerCount, 0);
  }
  const persistent = worker({ fetch: async () => new Response('unavailable', { status: 503 }) });
  assert.equal((await persistent.fetch('src/main.js')).status, 503);
  assert.equal(persistent.calls.length, 2);
  const missing = worker({ fetch: async () => new Response('missing', { status: 404 }) });
  assert.equal((await missing.fetch('src/main.js')).status, 404);
  assert.equal(missing.calls.length, 1);
});

test('network failures retry once and a stalled critical fetch times out without leaking timers', async () => {
  const dropped = worker({ fetch: async () => { throw new TypeError('Network disconnected'); } });
  await assert.rejects(dropped.fetch('vendor/three/0.160.0/build/three.module.js'), /disconnected/);
  assert.equal(dropped.calls.length, 2);
  assert.equal(dropped.timerCount, 0);
  const stalled = worker({ fetch: async () => new Promise(() => {}) });
  const request = stalled.request('src/main.js');
  const rejection = assert.rejects(request.response, /timed out after 8000 ms/);
  await flush(); stalled.expireDeadlines();
  await flush(); stalled.expireDeadlines();
  await rejection;
  assert.equal(stalled.calls.length, 2);
  assert.ok(stalled.calls.every((call) => call.init.signal.aborted));
  assert.equal(stalled.messages.length, 2);
  assert.equal(stalled.messages[1].status, null, 'timeouts do not invent an HTTP status');
  assert.equal(stalled.timerCount, 0);
});

test('navigation cache failure falls back to a bounded same-origin network request', async () => {
  const w = worker({ cacheFault: async (action) => { if (action === 'open') throw new Error('Cache storage denied'); },
    fetch: async (url, attempt) => new Response('page', { status: attempt === 1 ? 503 : 200 }) });
  assert.equal(await (await w.fetch('?level=23', { mode: 'navigate' })).text(), 'page');
  assert.equal(w.calls.length, 2);
  assert.ok(w.messages.some((message) => message.stage === 'navigate-fetch' && message.url === 'https://kiln.test/game/?level=23'));
});

test('external fonts use only the runtime cache and survive cache API failure', async () => {
  const url = 'https://fonts.gstatic.com/s/intertight/font.woff2';
  const w = worker();
  w.addCache(w.core, { [url]: 'wrong core font' });
  w.addCache(w.runtime, { [url]: 'runtime font' });
  assert.equal(await (await w.fetch(url)).text(), 'runtime font');
  assert.equal(w.calls.length, 0);
  const denied = worker({ cacheFault: async () => { throw new Error('Cache denied'); } });
  assert.equal(await (await denied.fetch(url)).text(), 'network');
  assert.equal(denied.calls.length, 1);
  assert.equal(denied.globalMatches, 0);
});

test('media range semantics and noncritical requests keep their existing single-fetch behavior', async () => {
  const range = worker({ fetch: async () => new Response('partial', { status: 206 }) });
  range.addCache(range.core, { 'audio/music/ambush.m4a': 'whole cached file' });
  assert.equal((await range.fetch('audio/music/ambush.m4a', { headers: { Range: 'bytes=0-9' } })).status, 206);
  assert.equal(range.calls.length, 1);
  const offline = worker({ fetch: async () => { throw new Error('Offline'); } });
  offline.addCache(offline.core, { 'audio/music/ambush.m4a': 'whole cached file' });
  assert.equal(await (await offline.fetch('audio/music/ambush.m4a', { headers: { Range: 'bytes=0-9' } })).text(), 'whole cached file');
  assert.equal(offline.calls.length, 1);
  const optional = worker({ fetch: async () => new Response('unavailable', { status: 503 }) });
  assert.equal((await optional.fetch('models/core.glb')).status, 503);
  assert.equal(optional.calls.length, 1, 'optional art is not a critical retry loop');
  assert.equal(optional.request('src/main.js', { method: 'POST' }).response, undefined);
  assert.equal(optional.request('https://another.example/file.js').response, undefined);
});

test('font and music warm-up tolerate cache denial without rejecting their message lifetime', async () => {
  const w = worker({ cacheFault: async () => { throw new Error('Cache denied'); } });
  await w.message({ type: 'cache-urls', urls: ['https://fonts.googleapis.com/css?family=Inter'] });
  await w.message({ type: 'warm' });
  assert.ok(w.calls.length > 0);
  assert.equal(w.timerCount, 0);
});

test('font warm-up still discovers only Latin faces and ignores unrelated hosts', async () => {
  const css = 'https://fonts.googleapis.com/css?family=Inter';
  const latin = 'https://fonts.gstatic.com/inter-latin.woff2';
  const other = 'https://fonts.gstatic.com/inter-cyrillic.woff2';
  const w = worker({ fetch: async (url) => new Response(url === css ?
    `@font-face { src:url(${latin}); unicode-range: U+0000-00FF; } @font-face { src:url(${other}); unicode-range: U+0400-04FF; }` : 'font') });
  await w.message({ type: 'cache-urls', urls: [css, 'https://another.example/unrelated.js'] });
  assert.deepEqual(w.calls.map((call) => call.url), [css, latin]);
  assert.ok(w.cached(w.runtime, css));
  assert.ok(w.cached(w.runtime, latin));
  assert.equal(w.cached(w.runtime, other), undefined);
});

test('ordinary runtime critical responses still reach the page before their body finishes', async () => {
  let finishBody;
  const w = worker({ fetch: async () => new Response(new ReadableStream({ start(controller) {
    finishBody = () => { controller.enqueue(new Uint8Array([10])); controller.close(); };
  } })) });
  const request = w.request('src/main.js');
  const response = await request.response;
  assert.equal(response.status, 200);
  assert.equal(response.bodyUsed, false);
  assert.equal(w.timerCount, 0, 'runtime keeps its existing headers-only fetch deadline');
  finishBody(); await request.finish();
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([10]));
});

test('a resulting navigation client lookup cannot hold offline retry or error delivery', async () => {
  const never = new Promise(() => {});
  const w = worker({ clientsGet: () => never, fetch: async () => { throw new TypeError('Offline'); } });
  const request = w.request('?level=23', { mode: 'navigate', clientId: '', resultingClientId: 'not-yet-committed' });
  let result = null;
  request.response.then(() => { result = 'unexpected response'; }, (error) => { result = error.message; });
  await flush();
  assert.equal(result, 'Offline', 'respondWith rejects before diagnostics can find the future client');
  assert.equal(w.calls.length, 2, 'offline fetch still gets its single retry');
  assert.equal(w.timerCount, 2, 'only the two bounded diagnostic lifetimes remain');
  w.expireDiagnostics(); await flush();
  assert.equal(w.timerCount, 0);
});

test('a stalled diagnostic client cannot hide a valid response after cache denial', async () => {
  const w = worker({ clientsGet: () => new Promise(() => {}), cacheFault: async (action) => {
    if (action === 'match') throw new Error('Cache read denied');
  } });
  const request = w.request('src/main.js');
  let response;
  request.response.then((value) => { response = value; });
  await flush();
  assert.equal(response?.status, 200);
  assert.equal(await response.text(), 'network');
  assert.equal(w.timerCount, 1, 'diagnostic lookup stays bounded outside response delivery');
  w.expireDiagnostics(); await request.finish();
  assert.equal(w.timerCount, 0);
});

test('late diagnostic lookup rejection and a throwing postMessage never become unhandled failures', async () => {
  let rejectLookup;
  const lookup = new Promise((resolve, reject) => { rejectLookup = reject; });
  const w = worker({ clientsGet: () => lookup, fetch: async () => { throw new Error('Network down'); } });
  const request = w.request('src/main.js');
  let delivered = false;
  request.response.catch(() => { delivered = true; });
  await flush(); assert.equal(delivered, true);
  w.expireDiagnostics(); await flush();
  assert.equal(w.timerCount, 0);
  rejectLookup(new Error('Client closed after lifetime expired')); await flush();
  assert.equal(w.timerCount, 0, 'late rejection is caught after the lifetime race has settled');
  const throwing = worker({ clientsGet: async () => ({ postMessage() { throw new Error('Client gone'); } }),
    fetch: async () => { throw new Error('Network down'); } });
  await assert.rejects(throwing.fetch('src/main.js'), /Network down/);
  await flush(); assert.equal(throwing.timerCount, 0);
});
