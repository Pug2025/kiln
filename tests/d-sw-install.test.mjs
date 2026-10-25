// Kiln: a failed update must preserve the last complete offline build.
import { test, assert } from './lib.mjs';
import { worker, flush } from './fixtures/D/service-worker.mjs';

test('an unavailable required module rejects a worker upgrade before takeover', async () => {
  const w = worker({ fetch: async (url) => new Response('', { status: url.endsWith('/src/main.js') ? 503 : 200 }) });
  await assert.rejects(w.install(), /Cannot cache src\/main\.js: 503/);
  assert.equal(w.waiting, 0, 'incomplete build never requests activation');
  assert.ok(w.cached('kiln-core-previous', 'index.html'), 'previous offline build remains');
  assert.deepEqual([...w.stored.keys()], ['kiln-core-previous'], 'partial failed cache is removed after writes settle');
  assert.equal(w.attempts.get('https://kiln.test/game/src/main.js'), 2, 'one retry, not a nested retry loop');
  const diagnostic = w.messages.find((message) => message.stage === 'install-fetch' && message.attempt === 2);
  assert.equal(diagnostic.url, 'https://kiln.test/game/src/main.js');
  assert.equal(diagnostic.status, 503);
  assert.equal(diagnostic.severity, 'warning');
  assert.ok(w.messages.some((message) => message.client === 'other'), 'install warnings reach uncontrolled windows');
  assert.equal(w.timerCount, 0);
});

test('a complete required cache permits the new worker to take over', async () => {
  const w = worker();
  await w.install();
  assert.equal(w.waiting, 1);
  for (const path of ['index.html', 'src/main.js', 'src/app/pwa.js', 'manifest.webmanifest']) assert.ok(w.cached(w.core, path), path);
  assert.equal(w.timerCount, 0);
});

test('a transient required fetch retries once and then completes the installation', async () => {
  const w = worker({ fetch: async (url, attempt) => {
    if (url.endsWith('/src/main.js') && attempt === 1) throw new TypeError('Network disconnected');
    return new Response('complete');
  } });
  await w.install();
  assert.equal(w.waiting, 1);
  assert.equal(w.attempts.get('https://kiln.test/game/src/main.js'), 2);
  assert.equal(await w.cached(w.core, 'src/main.js').text(), 'complete');
  assert.match(w.messages.find((message) => message.url.endsWith('/src/main.js')).error, /disconnected/);
  assert.equal(w.timerCount, 0);
});

test('a missing required file does not retry or delete an existing same-build cache', async () => {
  const w = worker({ fetch: async (url) => new Response('missing', { status: url.endsWith('/src/main.js') ? 404 : 200 }) });
  w.addCache(w.core, { 'index.html': 'existing complete index' });
  await assert.rejects(w.install(), /Cannot cache src\/main\.js: 404/);
  assert.equal(w.waiting, 0);
  assert.ok(w.cached(w.core, 'index.html'));
  assert.ok(w.cached('kiln-core-previous', 'index.html'));
  assert.equal(w.attempts.get('https://kiln.test/game/src/main.js'), 1);
});

test('failed installation waits for every late write before removing its partial cache', async () => {
  let finishLate, enteredLate = false;
  const late = new Promise((resolve) => { finishLate = resolve; });
  const w = worker({
    fetch: async (url) => new Response('', { status: url.endsWith('/src/main.js') ? 404 : 200 }),
    onPut: async (name, path) => { if (path.endsWith('/src/ui/ui.js')) { enteredLate = true; await late; } },
  });
  const installed = assert.rejects(w.install(), /Cannot cache src\/main\.js: 404/);
  await flush();
  assert.equal(enteredLate, true);
  assert.equal(w.stored.has(w.core), true, 'cleanup cannot race a pending write');
  finishLate();
  await installed;
  assert.equal(w.stored.has(w.core), false);
  assert.ok(w.cached('kiln-core-previous', 'src/main.js'));
});

test('cache denial and quota failures prevent takeover and preserve the old complete build', async () => {
  for (const failure of ['open', 'put']) {
    const w = worker({ cacheFault: async (action, name) => {
      if (action === failure && name.startsWith('kiln-core-') && name !== 'kiln-core-previous') throw new Error(`${failure} denied`);
    } });
    await assert.rejects(w.install(), new RegExp(`${failure} denied`));
    assert.equal(w.waiting, 0);
    assert.ok(w.cached('kiln-core-previous', 'index.html'));
    assert.ok(w.messages.some((message) => message.stage === (failure === 'open' ? 'install-cache-open' : 'install-cache-write')));
  }
});

test('activation still claims clients and removes only superseded core caches', async () => {
  const w = worker();
  w.addCache(w.runtime, { 'https://fonts.gstatic.com/font.woff2': 'font' });
  w.addCache('another-app', { 'index.html': 'other app' });
  await w.install(); await w.activate();
  assert.equal(w.claimed, 1);
  assert.equal(w.stored.has('kiln-core-previous'), false);
  assert.equal(w.stored.has(w.core), true);
  assert.equal(w.stored.has(w.runtime), true);
  assert.equal(w.stored.has('another-app'), true);
});

test('required install waits for body EOF and caches the original response bytes and metadata', async () => {
  let finishBody, written = null;
  const bytes = new Uint8Array([0, 255, 31, 139, 8, 10, 200, 0]);
  const response = new Response(new ReadableStream({ start(controller) {
    finishBody = () => { controller.enqueue(bytes); controller.close(); };
  } }), { status: 201, statusText: 'Created', headers: { 'Content-Type': 'application/javascript', 'Content-Encoding': 'gzip', 'X-Version': 'frozen' } });
  const w = worker({ fetch: async (url) => url.endsWith('/src/main.js') ? response : new Response('asset'),
    onPut: async (name, path, value) => { if (path.endsWith('/src/main.js')) written = value; } });
  const installed = w.install();
  await flush();
  assert.equal(written, null, 'a body still in flight cannot enter cache.put');
  assert.equal(w.waiting, 0);
  finishBody(); await installed;
  assert.equal(written, response, 'no synthetic response changes URL, status, headers or encoding');
  const cached = w.cached(w.core, 'src/main.js');
  assert.equal(cached.status, 201);
  assert.equal(cached.statusText, 'Created');
  assert.equal(cached.headers.get('Content-Encoding'), 'gzip');
  assert.equal(cached.headers.get('X-Version'), 'frozen');
  assert.deepEqual(new Uint8Array(await cached.arrayBuffer()), bytes);
  assert.equal(w.waiting, 1);
  assert.equal(w.timerCount, 0);
});

test('a required response body failure retries once before the only cache write', async () => {
  let writes = 0;
  const w = worker({ fetch: async (url, attempt) => {
    if (url.endsWith('/src/main.js') && attempt === 1) return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([1]));
      queueMicrotask(() => controller.error(new Error('Body connection lost')));
    } }));
    return new Response('complete retry');
  }, onPut: async (name, path) => { if (path.endsWith('/src/main.js')) writes++; } });
  await w.install();
  assert.equal(w.attempts.get('https://kiln.test/game/src/main.js'), 2);
  assert.equal(writes, 1);
  assert.equal(await w.cached(w.core, 'src/main.js').text(), 'complete retry');
  const warning = w.messages.find((message) => message.stage === 'install-fetch-body');
  assert.equal(warning.url, 'https://kiln.test/game/src/main.js');
  assert.equal(warning.status, 200, 'body failure retains the actually observed response status');
  assert.equal(warning.attempt, 1);
  assert.match(warning.error, /Body connection lost/);
  assert.equal(w.timerCount, 0);
});

test('persistent required body failure rejects without takeover or a partial cache write', async () => {
  let writes = 0;
  const w = worker({ fetch: async (url) => url.endsWith('/src/main.js') ? new Response(new ReadableStream({ start(controller) {
    queueMicrotask(() => controller.error(new Error('Body connection lost')));
  } })) : new Response('asset'), onPut: async (name, path) => { if (path.endsWith('/src/main.js')) writes++; } });
  await assert.rejects(w.install(), /Response body failed: Body connection lost/);
  assert.equal(w.attempts.get('https://kiln.test/game/src/main.js'), 2);
  assert.equal(writes, 0);
  assert.equal(w.waiting, 0);
  assert.equal(w.stored.has(w.core), false);
  assert.ok(w.cached('kiln-core-previous', 'index.html'));
  assert.equal(w.timerCount, 0);
});

test('the install deadline stays active after headers and aborts both stalled body attempts', async () => {
  let aborted = 0, writes = 0;
  const w = worker({ fetch: async (url, attempt, init) => {
    if (!url.endsWith('/src/main.js')) return new Response('asset');
    return new Response(new ReadableStream({ start(controller) {
      init.signal.addEventListener('abort', () => { aborted++; controller.error(new Error('Body aborted')); }, { once: true });
    } }));
  }, onPut: async (name, path) => { if (path.endsWith('/src/main.js')) writes++; } });
  const rejected = assert.rejects(w.install(), /Response body failed: Fetch timed out after 8000 ms/);
  // Ordinary completed responses need a native stream task turn, but no real timeout elapses.
  for (let i = 0; i < 20; i++) { await flush(); if (w.timerCount === 1) break; }
  assert.equal(w.timerCount, 1, 'the sole pending deadline belongs to the body, not its headers');
  w.expireDeadlines(); await flush();
  assert.equal(w.attempts.get('https://kiln.test/game/src/main.js'), 2);
  assert.equal(w.timerCount, 1, 'the retry gets one fresh bounded deadline');
  w.expireDeadlines(); await rejected;
  assert.equal(aborted, 2);
  assert.equal(writes, 0);
  assert.equal(w.timerCount, 0);
  assert.equal(w.stored.has(w.core), false);
  assert.ok(w.cached('kiln-core-previous', 'index.html'));
});

test('a timed-out attempt finishing late cannot write into a failed installation after cleanup', async () => {
  let finishLate, writes = 0;
  const w = worker({ fetch: async (url, attempt) => {
    if (!url.endsWith('/src/main.js')) return new Response('asset');
    if (attempt === 2) return new Response('missing', { status: 404 });
    // Deliberately ignore abort to exercise a late mock/network completion after the race lost.
    return new Response(new ReadableStream({ start(controller) {
      finishLate = () => { controller.enqueue(new Uint8Array([99])); controller.close(); };
    } }));
  }, onPut: async (name, path) => { if (path.endsWith('/src/main.js')) writes++; } });
  const rejected = assert.rejects(w.install(), /Cannot cache src\/main\.js: 404/);
  for (let i = 0; i < 20; i++) { await flush(); if (w.timerCount === 1) break; }
  assert.equal(w.timerCount, 1);
  w.expireDeadlines(); await rejected;
  assert.equal(w.stored.has(w.core), false);
  assert.equal(writes, 0);
  finishLate(); await flush();
  assert.equal(writes, 0, 'losing transfer has no cache write continuation');
  assert.equal(w.stored.has(w.core), false, 'cleanup remains final after late body completion');
  assert.equal(w.timerCount, 0);
});

test('a stalled broadcast client lookup cannot hold a failed required installation', async () => {
  const w = worker({ clientsMatchAll: () => new Promise(() => {}),
    fetch: async (url) => new Response('asset', { status: url.endsWith('/src/main.js') ? 404 : 200 }) });
  let failure = null;
  w.install().catch((error) => { failure = error; });
  for (let i = 0; i < 20; i++) { await flush(); if (failure) break; }
  assert.match(failure?.message || '', /Cannot cache src\/main\.js: 404/);
  assert.equal(w.waiting, 0);
  assert.equal(w.stored.has(w.core), false);
  assert.ok(w.cached('kiln-core-previous', 'index.html'));
  assert.equal(w.timerCount, 1, 'broadcast delivery has a bounded best-effort lifetime');
  w.expireDiagnostics(); await flush();
  assert.equal(w.timerCount, 0);
});
