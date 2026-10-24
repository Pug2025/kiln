// Kiln: worker handover during a page's first online visit.
import { test, assert } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function page({ controlled = false, safe = false, updated = false } = {}) {
  let toastSafe = safe;
  const sw = new EventTarget();
  sw.controller = controlled ? {} : null;
  sw.register = () => Promise.resolve({});
  let reloads = 0;
  const stored = new Map();
  if (updated) stored.set('kiln.updated', '1');
  const timers = [];
  const polls = [];
  const toasts = [];
  const sandbox = {
    URLSearchParams,
    location: { search: '?sw=1', hostname: 'localhost', reload() { reloads++; } },
    navigator: { serviceWorker: sw, userAgent: 'test', platform: 'test' },
    window: new EventTarget(), document: new EventTarget(),
    sessionStorage: { getItem: (k) => stored.get(k), setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) },
    setInterval(f) { polls.push(f); }, setTimeout(f) { timers.push(f); }, console,
  };
  const source = readFileSync(new URL('../src/app/pwa.js', import.meta.url), 'utf8')
    .replace('export function initPwa', 'function initPwa');
  runInNewContext(`${source}\nglobalThis.initPwa = initPwa;`, sandbox);
  const pwa = sandbox.initPwa({ canReload: () => safe, canToast: () => toastSafe, toast(t) { toasts.push(t); } });
  return {
    claim() { sw.controller = {}; sw.dispatchEvent(new Event('controllerchange')); },
    play() { safe = false; toastSafe = false; },
    pause() { toastSafe = true; for (const f of polls) f(); },
    safePoint() { safe = true; toastSafe = true; pwa.safePoint(); },
    timers() { for (const f of timers.splice(0)) f(); },
    get reloads() { return reloads; }, stored,
    toasts,
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
