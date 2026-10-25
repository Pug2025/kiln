// Kiln: worker handover during a page's first online visit.
import { test, assert } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function page({ controlled = false, safe = false, updated = false, registrationError = null, complete = false } = {}) {
  let toastSafe = safe;
  const sw = new EventTarget();
  sw.controller = controlled ? {} : null;
  sw.register = () => registrationError ? Promise.reject(registrationError) : Promise.resolve({});
  let reloads = 0;
  const stored = new Map();
  if (updated) stored.set('kiln.updated', '1');
  const timers = [];
  const polls = [];
  const toasts = [];
  const diagnostics = [];
  const messages = [];
  sw.ready = Promise.resolve({ active: { postMessage: (message) => messages.push(message) } });
  const sandbox = {
    URLSearchParams,
    URL,
    location: { href: 'https://kiln.test/game/?sw=1', search: '?sw=1', hostname: 'localhost', reload() { reloads++; } },
    navigator: { serviceWorker: sw, userAgent: 'test', platform: 'test' },
    window: new EventTarget(), document: new EventTarget(),
    sessionStorage: { getItem: (k) => stored.get(k), setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) },
    performance: { getEntriesByType: () => [{ name: 'https://fonts.googleapis.com/css?family=Inter' }, { name: 'https://kiln.test/game/vendor/three/0.160.0/build/three.module.js' }] },
    setInterval(f) { polls.push(f); }, setTimeout(f, ms) { timers.push({ f, ms }); }, console: { ...console, warn() {} },
  };
  sandbox.document.readyState = complete ? 'complete' : 'loading';
  const source = readFileSync(new URL('../src/app/pwa.js', import.meta.url), 'utf8')
    .replace('export function initPwa', 'function initPwa');
  runInNewContext(`${source}\nglobalThis.initPwa = initPwa;`, sandbox);
  const pwa = sandbox.initPwa({ canReload: () => safe, canToast: () => toastSafe, toast(t) { toasts.push(t); }, diagnostic: (record) => diagnostics.push(record) });
  return {
    claim() { sw.controller = {}; sw.dispatchEvent(new Event('controllerchange')); },
    play() { safe = false; toastSafe = false; },
    pause() { toastSafe = true; for (const f of polls) f(); },
    safePoint() { safe = true; toastSafe = true; pwa.safePoint(); },
    timers() { for (const { f } of timers.splice(0)) f(); },
    load() { sandbox.window.dispatchEvent(new Event('load')); },
    get warmTimers() { return timers.filter((timer) => timer.ms === 4000).length; },
    get reloads() { return reloads; }, stored,
    toasts, diagnostics, messages,
  };
}

test('first install stays in play, then a real upgrade waits for a safe point', () => {
  const p = page();
  p.claim();
  assert.equal(p.reloads, 0, 'initial install does not reload');
  p.safePoint();
  assert.equal(p.reloads, 0, 'initial install does not queue a reload');
  // A second controller is a real new worker, even without a navigation since first install.
  p.play();
  p.claim();
  assert.equal(p.reloads, 0, 'first-visit upgrade does not interrupt play');
  p.safePoint();
  assert.equal(p.reloads, 1, 'upgrade is recognized on the first-visit page');
  assert.equal(p.stored.get('kiln.updated'), '1', 'upgrade carries the once-only toast over reload');
});

test('a failed worker registration records its exact URL and leaves network startup usable', async () => {
  const p = page({ registrationError: new Error('Registration blocked') });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(p.reloads, 0);
  assert.equal(p.diagnostics.length, 1);
  assert.equal(p.diagnostics[0].stage, 'service-worker-register');
  assert.equal(p.diagnostics[0].url, 'https://kiln.test/game/sw.js');
  assert.equal(p.diagnostics[0].message, 'Registration blocked');
});

test('offline font and music warm-up schedules once when startup misses the window load event', async () => {
  for (const complete of [false, true]) {
    const p = page({ complete });
    assert.equal(p.warmTimers, complete ? 1 : 0);
    p.load(); p.load();
    assert.equal(p.warmTimers, 1);
    p.timers();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(p.messages.length, 2);
    assert.equal(p.messages[0].type, 'cache-urls');
    assert.deepEqual([...p.messages[0].urls], ['https://fonts.googleapis.com/css?family=Inter']);
    assert.equal(p.messages[1].type, 'warm');
  }
});

test('a controlled page does not reload during play and reloads once at the map', () => {
  const p = page({ controlled: true });
  p.claim();
  assert.equal(p.reloads, 0);
  p.safePoint();
  assert.equal(p.reloads, 1);
  p.safePoint();
  assert.equal(p.reloads, 1, 'safe-point polling does not reload twice');
});

test('the upgrade toast waits while playing and appears once at the next safe point', () => {
  const p = page({ controlled: true, safe: true, updated: true });
  p.play();
  p.timers();
  assert.deepEqual(p.toasts, [], 'a quick launch before the toast timer stays quiet');
  assert.equal(p.stored.get('kiln.updated'), '1', 'notice survives until it can be shown');
  p.safePoint();
  assert.deepEqual(p.toasts, ['Kiln updated']);
  assert.equal(p.stored.has('kiln.updated'), false);
  p.safePoint();
  assert.deepEqual(p.toasts, ['Kiln updated'], 'notice is shown only once');
});

test('a paused game permits the pending toast without permitting an update reload', () => {
  const p = page({ controlled: true, updated: true });
  p.claim();
  p.timers();
  p.pause();
  assert.equal(p.reloads, 0, 'pause is not a reload safe point');
  assert.deepEqual(p.toasts, ['Kiln updated'], 'paused game permits the notice');
});

test('another worker upgrade preserves its reload marker over an older deferred notice', () => {
  const p = page({ controlled: true, updated: true });
  p.play();
  p.timers();
  p.claim();
  p.safePoint();
  assert.equal(p.reloads, 1);
  assert.deepEqual(p.toasts, [], 'the departing page does not show the older notice');
  assert.equal(p.stored.get('kiln.updated'), '1', 'the incoming page retains its upgrade notice');
});
