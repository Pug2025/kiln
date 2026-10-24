// Kiln: a failed update must preserve the last complete offline build.
import { test, assert } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function worker(failed = '') {
  const handlers = new Map();
  const stored = new Map([['kiln-core-previous', new Map([['index.html', { ok: true }]])]]);
  let waiting = 0;
  const sandbox = {
    self: {
      addEventListener: (name, fn) => handlers.set(name, fn),
      skipWaiting: async () => { waiting++; },
    },
    caches: {
      has: async (name) => stored.has(name),
      delete: async (name) => stored.delete(name),
      async open(name) {
        if (!stored.has(name)) stored.set(name, new Map());
        return { put: async (path, response) => stored.get(name).set(path, response) };
      },
    },
    fetch: async (path) => ({ ok: path !== failed, status: path === failed ? 503 : 200 }),
  };
  runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), sandbox);
  return {
    install() { let work; handlers.get('install')({ waitUntil(p) { work = p; } }); return work; },
    get waiting() { return waiting; }, stored,
  };
}

test('an unavailable required module rejects a worker upgrade before takeover', async () => {
  const w = worker('src/main.js');
  await assert.rejects(w.install(), /Cannot cache src\/main\.js: 503/);
  assert.equal(w.waiting, 0, 'incomplete build never requests activation');
  assert.ok(w.stored.get('kiln-core-previous').has('index.html'), 'previous offline build remains');
  assert.deepEqual([...w.stored.keys()], ['kiln-core-previous'], 'partial failed cache is removed after writes settle');
});

test('a complete required cache permits the new worker to take over', async () => {
  const w = worker();
  await w.install();
  assert.equal(w.waiting, 1);
  const current = [...w.stored].find(([name]) => name !== 'kiln-core-previous')[1];
  for (const path of ['index.html', 'src/main.js', 'src/app/pwa.js', 'manifest.webmanifest']) assert.ok(current.has(path), path);
});
