// Execute the independent production guard with deterministic document, storage and clock faults.
import { test, assert } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = /<script id="kiln-startup">([\s\S]*?)<\/script>/.exec(html)[1];
const sandbox = { URL };
runInNewContext(source, sandbox);
const guard = sandbox.kilnStartupGuard;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

class Target {
  listeners = new Map();
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  fire(name, extra = {}) { for (const fn of [...this.listeners.get(name) || []]) fn({ target: this, ...extra }); }
}
class Element extends Target {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.style = {}; this.children = []; this.attrs = new Map(); }
  setAttribute(k, v) { this.attrs.set(k, v); }
  hasAttribute(k) { return this.attrs.has(k); }
  append(...nodes) { this.children.push(...nodes); }
  focus() { this.focused = true; }
}
function page({ online = true, stored = new Map(), denied = false, body = true, visibility, loadMain = async () => ({ boot: async () => {} }) } = {}) {
  const doc = new Target(), win = new Target(), timers = new Map();
  let timerId = 0, reloads = 0, clock = 0;
  const links = [];
  doc.baseURI = 'https://kiln.test/game/?level=23&seed=1';
  doc.readyState = 'loading';
  if (visibility) doc.visibilityState = visibility; // left out: a browser without the Page Visibility API
  win.performance = { now: () => clock };
  doc.body = body ? new Element('body') : null;
  doc.createElement = (tag) => new Element(tag);
  doc.querySelectorAll = (selector) => links.filter((link) => selector.split(',').some((part) => link.hasAttribute(/\[([^\]]+)\]/.exec(part)[1])));
  doc.getElementById = (id) => doc.body?.children.find((node) => node.id === id) || null;
  win.navigator = { onLine: online, serviceWorker: new Target() };
  win.location = { reload() { reloads++; } };
  win.setTimeout = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms, due: clock + ms }); return id; };
  win.clearTimeout = (id) => timers.delete(id);
  win.sessionStorage = {
    getItem(k) { if (denied) throw new Error('Storage denied'); return stored.get(k) || null; },
    setItem(k, v) { if (denied) throw new Error('Storage denied'); stored.set(k, v); },
    removeItem(k) { if (denied) throw new Error('Storage denied'); stored.delete(k); },
  };
  const api = guard(win, doc, loadMain);
  return {
    api, win, doc, stored, timers,
    link(path, kind = 'module') { const el = new Element('link'); el.href = new URL(path, doc.baseURI).href; el.setAttribute(`data-kiln-${kind}`, ''); links.push(el); return el; },
    expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
    /** Let `ms` pass on the page clock, firing every timer that falls due, in order (a hidden tab fires them too). */
    pass(ms) {
      const end = clock + ms;
      for (;;) {
        let next = null;
        for (const [id, timer] of timers) if (timer.due <= end && (!next || timer.due < next[1].due)) next = [id, timer];
        if (!next) break;
        clock = Math.max(clock, next[1].due);
        timers.delete(next[0]);
        next[1].fn();
      }
      clock = end;
    },
    show(state) { doc.visibilityState = state; doc.fire('visibilitychange'); },
    get reloads() { return reloads; },
    get box() { return doc.getElementById('startup-recovery'); },
  };
}

test('startup publishes hooks without waiting for a native frame and marks ready only after a driven frame', async () => {
  let calls = 0, advance;
  const p = page({ loadMain: async () => ({ boot: async (api) => { calls++; api.stage('first-frame'); advance = () => api.ready(); } }) });
  await p.api.start();
  await p.api.start();
  assert.equal(calls, 1);
  assert.equal(p.api.snapshot().ready, false);
  assert.equal(typeof advance, 'function', 'held-rAF QA can drive the first frame');
  advance();
  assert.equal(p.api.snapshot().ready, true);
  assert.equal(p.timers.size, 0);
  p.win.fire('error', { error: new Error('runtime failure') });
  assert.equal(p.api.snapshot().failed, false, 'runtime recovery keeps its own owner');
});

test('a nested required URL is retained before one persisted automatic reload and manual retry remains usable', () => {
  const stored = new Map(), p = page({ stored });
  const link = p.link('src/render/post.js');
  p.doc.fire('error', { target: link });
  const failure = p.api.snapshot().records.find((record) => record.kind === 'resource');
  assert.equal(failure.url, 'https://kiln.test/game/src/render/post.js');
  assert.equal(failure.stage, 'modules');
  assert.equal(failure.status, null, 'a link error does not reveal an HTTP status');
  assert.equal(stored.get('kiln.startup.retry'), '1');
  p.expire(200);
  assert.equal(p.reloads, 1);
  const next = page({ stored });
  next.doc.fire('error', { target: next.link('src/render/post.js') });
  next.expire(200);
  assert.equal(next.reloads, 0, 'the following document cannot auto-reload again');
  const button = next.box.children[1];
  assert.equal(button.textContent, 'Tap to retry');
  assert.match(button.style.cssText, /min-height:44px/);
  assert.ok(button.focused);
  button.fire('click'); button.fire('click');
  assert.equal(next.reloads, 1, 'one explicit tap is one navigation');
});

test('offline and denied storage failures never create automatic reload loops', () => {
  for (const options of [{ online: false }, { denied: true }]) {
    const p = page(options);
    p.doc.fire('error', { target: p.link('vendor/three/0.160.0/build/three.module.js') });
    p.expire(200);
    assert.equal(p.reloads, 0);
    assert.ok(p.box);
    p.box.children[1].fire('click');
    assert.equal(p.reloads, 1);
  }
});

test('recovery survives failure before the body and missing application styles', () => {
  let imports = 0;
  const p = page({ body: false, loadMain: async () => { imports++; } });
  p.doc.fire('error', { target: p.link('css/app.css', 'required') });
  assert.equal(p.api.snapshot().stage, 'styles');
  p.doc.body = new Element('body');
  p.doc.fire('DOMContentLoaded');
  assert.equal(imports, 0, 'a failed document does not start a partial boot');
  assert.match(p.box.style.cssText, /system-ui/);
  assert.equal(p.box.children[0].textContent, 'Kiln could not load.');
});

test('font stylesheet failures are optional and its success enables the nonblocking stylesheet', async () => {
  const failed = page(), font = failed.link('https://fonts.googleapis.com/css?family=Inter', 'fonts');
  failed.doc.fire('error', { target: font });
  await failed.api.fontStyleReady;
  assert.equal(failed.api.snapshot().failed, false);
  assert.equal(failed.reloads, 0);
  const success = page(), loaded = success.link('https://fonts.googleapis.com/css?family=Inter', 'fonts');
  success.doc.fire('load', { target: loaded });
  await success.api.fontStyleReady;
  assert.equal(loaded.media, 'all');
  const late = page(), lateFont = late.link('https://fonts.googleapis.com/css?family=Inter', 'fonts');
  late.api.ready();
  lateFont.fire('load');
  await late.api.fontStyleReady;
  assert.equal(lateFont.media, 'all', 'late fonts still style the DOM after startup listeners are detached');
});

test('application styles and modules load in parallel but an unfinished stylesheet cannot produce false ready', async () => {
  let imports = 0, boots = 0;
  const p = page({ loadMain: async () => { imports++; return { boot: async () => { boots++; } }; } });
  const css = p.link('css/app.css', 'required');
  const started = p.api.start();
  await flush();
  assert.equal(imports, 1);
  assert.equal(boots, 0);
  p.doc.fire('load', { target: css });
  await started;
  assert.equal(boots, 1);
});

test('parallel boot rejection records its actual stage and avoids a programming-error reload loop', async () => {
  const p = page({ loadMain: async () => ({ boot: (api) => api.task('renderer', () => { throw new Error('WebGL unavailable'); }) }) });
  await p.api.start();
  assert.equal(p.api.snapshot().stage, 'renderer');
  assert.equal(p.api.snapshot().failed, true);
  assert.deepEqual([...p.api.snapshot().active], []);
  p.expire(200);
  assert.equal(p.reloads, 0);
});

test('a generic import rejection never mislabels the entry as the unknown failed nested request', async () => {
  const p = page({ loadMain: async () => { throw new TypeError('Failed to fetch dynamically imported module: https://kiln.test/game/src/main.js'); } });
  await p.api.start();
  const failure = p.api.snapshot().records.find((record) => record.kind === 'entry');
  assert.equal(failure.url, null);
  assert.equal(failure.entryUrl, 'https://kiln.test/game/src/main.js');
  p.expire(200);
  assert.equal(p.reloads, 1);
});

test('a stalled import is bounded and records pending URLs without inventing a failed request', async () => {
  const p = page({ loadMain: () => new Promise(() => {}) });
  p.link('src/render/materials.js');
  p.api.start();
  await flush();
  p.expire(20000);
  const failure = p.api.snapshot().records.find((record) => record.kind === 'timeout');
  assert.equal(failure.url, null);
  assert.deepEqual([...failure.pendingUrls], ['https://kiln.test/game/src/render/materials.js']);
  assert.ok(p.box);
  p.expire(200);
  assert.equal(p.reloads, 1);
});

test('SW install warnings add exact context without interrupting network boot, and records stay bounded', () => {
  const p = page();
  for (let i = 0; i < 25; i++) p.win.navigator.serviceWorker.fire('message', { data: {
    type: 'kiln-startup-diagnostic', stage: 'install-fetch', build: 'test-build', url: `https://kiln.test/game/file-${i}.js`, status: 503, error: null, attempt: 2,
  } });
  const snap = p.api.snapshot();
  assert.equal(snap.failed, false);
  assert.equal(snap.records.length, 16);
  assert.equal(snap.records.at(-1).status, 503);
  assert.equal(snap.records.at(-1).build, 'test-build');
  snap.records.length = 0;
  assert.equal(p.api.snapshot().records.length, 16, 'QA snapshot cannot mutate the journal');
  p.api.ready();
  assert.equal(p.stored.has('kiln.startup.retry'), false);
  p.win.navigator.serviceWorker.fire('message', { data: {
    type: 'kiln-startup-diagnostic', stage: 'install-fetch', url: 'https://kiln.test/game/late-install.js', status: 503,
  } });
  assert.equal(p.api.snapshot().records.at(-1).url, 'https://kiln.test/game/late-install.js', 'late background install diagnostics are retained');
  assert.equal(p.api.snapshot().failed, false);
});

test('post-ready cache warnings cannot evict the pinned fatal failure and successful recovery episode', () => {
  const stored = new Map(), failed = page({ stored });
  failed.doc.fire('error', { target: failed.link('src/render/post.js') });
  failed.expire(200);
  const recovered = page({ stored });
  recovered.api.ready();
  for (let i = 0; i < 25; i++) recovered.win.navigator.serviceWorker.fire('message', { data: {
    type: 'kiln-startup-diagnostic', stage: 'cache-write', url: `https://kiln.test/game/asset-${i}.js`, error: 'Quota denied',
  } });
  const snapshot = recovered.api.snapshot();
  assert.equal(snapshot.records.length, 16);
  assert.equal(snapshot.episode.failure.url, 'https://kiln.test/game/src/render/post.js');
  assert.equal(snapshot.episode.retries[0].kind, 'automatic-retry');
  assert.equal(snapshot.episode.recovery.stage, 'ready');
  snapshot.episode.failure.url = 'changed';
  assert.equal(recovered.api.snapshot().episode.failure.url, 'https://kiln.test/game/src/render/post.js');
  const laterPage = page({ stored });
  assert.equal(laterPage.api.snapshot().episode.recovery.stage, 'ready', 'the completed episode survives a later navigation');
});

// A boot like main.js: it reaches 'first-frame' and is ready only on its first drawn frame, which a
// hidden page never gets. `frame` delivers that first frame (the page has come forward).
function bootToFirstFrame() {
  const boot = { frame: null };
  boot.loadMain = async () => ({ boot: async (api) => { api.stage('first-frame'); boot.frame = () => api.ready(); } });
  return boot;
}

test('a page hidden for 60 s holds the startup deadline and boots when it comes forward', async () => {
  const b = bootToFirstFrame(), p = page({ visibility: 'hidden', loadMain: b.loadMain });
  await p.api.start();
  assert.equal(p.api.snapshot().stage, 'first-frame', 'boot runs while hidden and waits for its first frame');
  assert.equal(p.api.snapshot().deadlineHeld, true);
  assert.equal(p.timers.size, 0, 'no startup deadline runs while hidden');
  for (let s = 0; s < 60; s++) p.pass(1000); // a background tab still runs its timers
  let snap = p.api.snapshot();
  assert.equal(snap.failed, false);
  assert.equal(snap.deadlineMs, 20000, 'none of the hidden minute counted');
  assert.ok(!snap.records.some((r) => r.kind === 'timeout'));
  assert.equal(p.box, null);
  assert.equal(p.reloads, 0);
  assert.equal(p.stored.has('kiln.startup.retry'), false, 'no automatic retry was spent');
  p.show('visible');
  assert.equal(p.api.snapshot().deadlineHeld, false, 'the deadline runs again once the page can be seen');
  p.pass(16);
  b.frame();
  snap = p.api.snapshot();
  assert.equal(snap.ready, true);
  assert.equal(snap.failed, false);
  assert.equal(p.timers.size, 0);
  p.show('hidden'); p.show('visible'); p.pass(60000);
  assert.equal(p.timers.size, 0, 'visibility after ready arms nothing');
  assert.equal(p.reloads, 0);
  assert.equal(p.box, null);
});

test('only visible time counts: 5 s shown, 10 min hidden, then the rest of the same 20 s', async () => {
  const b = bootToFirstFrame(), p = page({ visibility: 'visible', loadMain: b.loadMain });
  await p.api.start();
  p.pass(5000);
  p.show('hidden');
  p.pass(600000);
  assert.equal(p.api.snapshot().failed, false);
  assert.equal(p.api.snapshot().deadlineMs, 15000);
  p.show('visible');
  p.show('visible'); // a repeated event does not restart or double the deadline
  assert.equal(p.timers.size, 1);
  p.pass(14999);
  assert.equal(p.api.snapshot().failed, false);
  p.pass(1);
  const snap = p.api.snapshot();
  assert.equal(snap.failed, true, 'a stall fails after 20 s of visible time in total');
  assert.equal(snap.records.find((r) => r.kind === 'timeout').stage, 'first-frame');
});

test('a stalled boot while visible still fails at 20 s, retries once, then offers the manual retry', async () => {
  const stored = new Map(), b = bootToFirstFrame();
  const p = page({ stored, visibility: 'visible', loadMain: b.loadMain });
  await p.api.start();
  p.pass(19999);
  assert.equal(p.api.snapshot().failed, false);
  assert.equal(p.box, null);
  p.pass(1);
  const snap = p.api.snapshot();
  assert.equal(snap.failed, true);
  const timeout = snap.records.find((r) => r.kind === 'timeout');
  assert.equal(timeout.message, 'Startup timed out');
  assert.equal(timeout.stage, 'first-frame');
  assert.equal(snap.deadlineMs, 0);
  assert.equal(p.box.children[0].textContent, 'Kiln could not load.');
  assert.equal(stored.get('kiln.startup.retry'), '1');
  p.show('hidden'); p.show('visible');
  p.pass(200);
  assert.equal(p.reloads, 1, 'the one automatic retry');
  const next = page({ stored, visibility: 'visible', loadMain: bootToFirstFrame().loadMain });
  await next.api.start();
  next.pass(19999);
  assert.equal(next.api.snapshot().failed, false);
  next.pass(1);
  assert.equal(next.api.snapshot().failed, true, 'the retried document has the same deadline');
  next.pass(60000);
  assert.equal(next.reloads, 0, 'no second automatic reload');
  next.box.children[1].fire('click');
  assert.equal(next.reloads, 1, 'manual retry still works');
});

test('the automatic retry document may load hidden and still boots when it comes forward', async () => {
  const stored = new Map();
  const first = page({ stored, visibility: 'visible', loadMain: bootToFirstFrame().loadMain });
  await first.api.start();
  first.pass(20200);
  assert.equal(first.reloads, 1);
  const b = bootToFirstFrame(), retried = page({ stored, visibility: 'hidden', loadMain: b.loadMain });
  await retried.api.start();
  retried.pass(60000);
  assert.equal(retried.api.snapshot().failed, false);
  assert.equal(retried.box, null);
  retried.show('visible');
  retried.pass(16);
  b.frame();
  const snap = retried.api.snapshot();
  assert.equal(snap.ready, true);
  assert.equal(snap.episode.failure.kind, 'timeout');
  assert.equal(snap.episode.recovery.stage, 'ready');
  assert.equal(stored.has('kiln.startup.retry'), false, 'a good start clears the retry for next time');
});

test('a shader-preparation timeout or a lost context during boot gets the one automatic retry; other renderer errors do not', async () => {
  const graphicsError = (kind) => kind === 'timeout'
    ? Object.assign(new Error('Shader preparation completion deadline exceeded'), { name: 'TimeoutError', code: 'SHADER_PREPARATION_TIMEOUT' })
    : Object.assign(new Error('Shader preparation cancelled: context-lost'), { name: 'AbortError', code: 'SHADER_PREPARATION_ABORTED' });
  for (const kind of ['timeout', 'context-lost']) {
    const stored = new Map();
    const boot = () => ({ boot: (api) => api.task('renderer', () => { throw graphicsError(kind); }) });
    const p = page({ stored, visibility: 'visible', loadMain: async () => boot() });
    await p.api.start();
    const snap = p.api.snapshot();
    assert.equal(snap.failed, true);
    const failure = snap.records.find((r) => r.kind === 'entry');
    assert.equal(failure.stage, 'renderer');
    assert.equal(failure.message, graphicsError(kind).message);
    assert.equal(stored.get('kiln.startup.retry'), '1');
    p.pass(200);
    assert.equal(p.reloads, 1, `${kind}: one automatic reload`);
    const next = page({ stored, visibility: 'visible', loadMain: async () => boot() });
    await next.api.start();
    next.pass(60000);
    assert.equal(next.reloads, 0, `${kind}: never a second automatic reload`);
    next.box.children[1].fire('click');
    assert.equal(next.reloads, 1, `${kind}: manual retry still works`);
  }
  const other = page({ visibility: 'visible', loadMain: async () => ({ boot: (api) => api.task('renderer', () => { throw new Error('Shader link failed: bad program'); }) }) });
  await other.api.start();
  other.pass(200);
  assert.equal(other.api.snapshot().failed, true);
  assert.equal(other.reloads, 0, 'a broken shader is not retried automatically');
});
