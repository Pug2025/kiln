// VM fixture for the real worker. No network, wall-clock waits or browser is needed.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../../sw.js', import.meta.url), 'utf8');
const scope = 'https://kiln.test/game/';
const key = (request) => new URL(typeof request === 'string' ? request : request.url, scope).href;
export const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise(setImmediate); // Node's native cloned Response streams also use task turns.
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

export function worker(options = {}) {
  const handlers = new Map(), timers = new Map();
  const stored = new Map(), calls = [], messages = [], attempts = new Map();
  let waiting = 0, claimed = 0, timerId = 0, globalMatches = 0;
  const core = /^const BUILD = '([^']+)'/m.exec(source)[1];
  const current = `kiln-core-${core}`;
  const runtime = 'kiln-runtime-v1';
  const addCache = (name, entries = {}) => {
    const cache = new Map(Object.entries(entries).map(([path, body]) => [key(path), body instanceof Response ? body.clone() : new Response(body)]));
    stored.set(name, cache); return cache;
  };
  addCache('kiln-core-previous', { 'index.html': 'old complete index', 'src/main.js': 'old complete main' });
  const fault = async (action, name, path) => { if (options.cacheFault) await options.cacheFault(action, name, path); };
  const clients = ['target', 'other'].map((id) => ({ id, postMessage: (data) => messages.push({ client: id, ...data }) }));
  const sandbox = {
    URL, Response, AbortController,
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      // Retry delays advance as microtasks; deadlines advance explicitly in the stall test.
      if (ms < 1000) queueMicrotask(() => { if (timers.delete(id)) fn(); });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    self: {
      location: { href: `${scope}sw.js`, origin: new URL(scope).origin }, registration: { scope },
      addEventListener: (name, fn) => handlers.set(name, fn),
      skipWaiting: async () => { waiting++; },
      clients: {
        get: async (id) => options.clientsGet ? options.clientsGet(id) : clients.find((client) => client.id === id),
        matchAll: async () => options.clientsMatchAll ? options.clientsMatchAll() : clients,
        claim: async () => { claimed++; },
      },
    },
    caches: {
      has: async (name) => { await fault('has', name); return stored.has(name); },
      keys: async () => { await fault('keys'); return [...stored.keys()]; },
      delete: async (name) => { await fault('delete', name); return stored.delete(name); },
      match: async () => { globalMatches++; throw new Error('Global cache lookup is forbidden'); },
      async open(name) {
        await fault('open', name);
        if (!stored.has(name)) stored.set(name, new Map());
        const map = stored.get(name);
        return {
          async match(request, { ignoreSearch = false } = {}) {
            const path = key(request);
            await fault('match', name, path);
            const matchKey = ignoreSearch ? [...map.keys()].find((url) => url.split('?')[0] === path.split('?')[0]) : path;
            return map.get(matchKey)?.clone();
          },
          async put(request, response) {
            const path = key(request);
            await fault('put', name, path);
            if (options.onPut) await options.onPut(name, path, response);
            map.set(path, response.clone());
          },
        };
      },
    },
    async fetch(request, init = {}) {
      const url = key(request), attempt = (attempts.get(url) || 0) + 1;
      attempts.set(url, attempt);
      calls.push({ url, attempt, init, request });
      return options.fetch ? options.fetch(url, attempt, init, request) : new Response('network');
    },
  };
  runInNewContext(source, sandbox);
  const request = (path, opts = {}) => {
    const background = [];
    const req = { url: key(path), method: opts.method || 'GET', mode: opts.mode || 'cors', headers: new Headers(opts.headers) };
    let response;
    handlers.get('fetch')({ request: req, clientId: opts.clientId ?? 'target', resultingClientId: opts.resultingClientId,
      respondWith: (work) => { response = Promise.resolve(work); }, waitUntil: (work) => {
        if (opts.waitUntilError) throw Object.assign(new Error('Event lifetime closed'), { name: 'InvalidStateError' });
        background.push(work);
      } });
    return {
      response,
      async finish() {
        const result = response && await response;
        let done = 0;
        while (done < background.length) { const next = background.slice(done); done = background.length; await Promise.all(next); }
        return result;
      },
    };
  };
  return {
    core: current, runtime, calls, messages, attempts, stored, addCache, request,
    async fetch(path, opts) { return request(path, opts).finish(); },
    install() { let work; handlers.get('install')({ waitUntil: (promise) => { work = promise; } }); return work; },
    activate() { let work; handlers.get('activate')({ waitUntil: (promise) => { work = promise; } }); return work; },
    async message(data) {
      const lifetimes = [];
      handlers.get('message')({ data, source: { id: 'target' }, waitUntil: (promise) => lifetimes.push(promise) });
      let done = 0;
      while (done < lifetimes.length) { const next = lifetimes.slice(done); done = lifetimes.length; await Promise.all(next); }
    },
    expireDeadlines() {
      for (const [id, timer] of [...timers]) if (timer.ms >= 8000 && timers.delete(id)) timer.fn();
    },
    expireDiagnostics() {
      for (const [id, timer] of [...timers]) if (timer.ms === 1000 && timers.delete(id)) timer.fn();
    },
    cached(name, path) { return stored.get(name)?.get(key(path)); },
    get waiting() { return waiting; }, get claimed() { return claimed; },
    get timerCount() { return timers.size; }, get globalMatches() { return globalMatches; },
  };
}
