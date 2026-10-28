// Kiln QA (G): Chrome over the DevTools protocol with nothing but Node 22 (global WebSocket and
// fetch, no npm packages), plus a tiny static file server. Used by frametime.mjs and
// devicecheck.mjs.
//
//   const chrome = await launchChrome({ headless: true });
//   const page = await chrome.newPage();
//   await page.send('Page.enable');
//   page.on('Runtime.consoleAPICalled', (e) => ...);
//   await page.navigate('http://127.0.0.1:8790/?bot=1');
//   const v = await page.eval('window.__kiln.world.step');
//   await chrome.close();

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname, resolve, sep } from 'node:path';

export const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------ orphan guard
// A QA run killed from outside (a Bash timeout, Ctrl-C, a usage-limit stop) never reaches its
// `finally`, and a headless Chrome left behind keeps its GPU context and memory for hours (two
// were found 8 h later on 2026-10-22). Every child started here is guarded twice:
//  1. SIGINT, SIGTERM, SIGHUP and a normal exit kill it and remove its profile at once;
//  2. a detached shell watches this Node process and, when it is gone (even after SIGKILL,
//     which no handler sees), stops the child and removes its profile.

const guarded = new Set(); // { proc, cleanup }
let hooked = false;

/**
 * proc.kill() that cannot hit our own process group. Node keeps the handle of a spawn that failed
 * (missing binary) with no pid, and kill() on it signals pid 0, which is this process group: the
 * shell, the test gate and every sibling die (seen 2026-10-22 with a missing /bin/sh).
 */
export function safeKill(proc, signal = 'SIGTERM') {
  if (!proc || !Number.isInteger(proc.pid) || proc.pid <= 0 || proc.exitCode !== null || proc.signalCode !== null) return false;
  try {
    return proc.kill(signal);
  } catch {
    return false;
  }
}

function reapAllSync() {
  for (const g of guarded) {
    safeKill(g.proc, 'SIGKILL');
    if (g.cleanup) try { rmSync(g.cleanup, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  guarded.clear();
}

function hookProcess() {
  if (hooked) return;
  hooked = true;
  process.on('exit', reapAllSync);
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.once(sig, () => {
      reapAllSync();
      process.exit(code);
    });
  }
}

// $1 = the Node pid to watch, $2 = the child pid, $3 = a folder to remove (or empty), $4 = poll s.
// The loop ends quietly when the child exits first (close() already cleaned up).
const WATCHDOG = [
  'while kill -0 "$1" 2>/dev/null; do kill -0 "$2" 2>/dev/null || exit 0; sleep "$4"; done',
  'kill -TERM "$2" 2>/dev/null',
  'i=0; while kill -0 "$2" 2>/dev/null && [ $i -lt 10 ]; do sleep 0.3; i=$((i+1)); done',
  'kill -KILL "$2" 2>/dev/null',
  '[ -n "$3" ] && rm -rf "$3"',
  'exit 0',
].join('\n');

/**
 * Make sure `proc` (and `cleanup`, a folder) does not outlive this Node process, however it ends.
 * Returns release(), to call once the child has been closed normally.
 * @param {import('node:child_process').ChildProcess} proc
 * @param {{cleanup?:string, pollSeconds?:number, watchPid?:number}} [opts]
 *   watchPid: the process whose death triggers the reap (default this one; tests use a helper)
 */
export function guardChild(proc, opts = {}) {
  if (!proc || !Number.isInteger(proc.pid) || proc.pid <= 0) return () => {}; // never started
  const entry = { proc, cleanup: opts.cleanup || '' };
  guarded.add(entry);
  hookProcess();
  let dog = null;
  try {
    dog = spawn('/bin/sh', ['-c', WATCHDOG, 'kiln-qa-watchdog', String(opts.watchPid || process.pid), String(proc.pid), entry.cleanup, String(opts.pollSeconds || 1)], {
      detached: true,
      stdio: 'ignore',
    });
    dog.on('error', () => {}); // no /bin/sh: the signal handlers still cover most endings
    dog.unref();
  } catch { /* same */ }
  proc.once('exit', () => guarded.delete(entry));
  return () => {
    guarded.delete(entry);
    safeKill(dog, 'SIGKILL');
  };
}

export function findChrome() {
  if (process.env.KILN_CHROME) return process.env.KILN_CHROME;
  const p = CHROME_PATHS.find((c) => existsSync(c));
  if (!p) throw new Error('Google Chrome not found (set KILN_CHROME to its binary)');
  return p;
}

/**
 * Start Chrome with a throwaway profile and the DevTools port open on 127.0.0.1.
 * `profile` reuses a folder (a relaunch that must find the service worker and caches of an earlier
 * launch); with `keepProfile` that folder survives close() and the guard, otherwise it goes with
 * the browser like a throwaway one.
 * @param {{headless?:boolean, width?:number, height?:number, args?:string[], chrome?:string,
 *   profile?:string, keepProfile?:boolean, throttle?:boolean}} [opts]
 */
export async function launchChrome(opts = {}) {
  const profile = opts.profile || mkdtempSync(join(tmpdir(), 'kiln-chrome-'));
  const dropProfile = !(opts.profile && opts.keepProfile);
  // a reused profile still holds the last browser's port: wait for this browser's own
  if (opts.profile) rmSync(join(profile, 'DevToolsActivePort'), { force: true });
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    // `throttle` keeps Chrome's normal background-tab throttling (a check of what a real background tab does)
    ...(opts.throttle ? [] : [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ]),
    '--disable-extensions',
    '--disable-component-update',
    '--disable-sync',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    `--window-size=${opts.width || 1280},${opts.height || 900}`,
    ...(opts.headless === false ? [] : ['--headless=new']),
    ...(opts.args || []),
    'about:blank',
  ];
  const bin = opts.chrome || findChrome();
  const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let spawnError = null;
  proc.on('error', (err) => { spawnError = err; });
  const release = guardChild(proc, { cleanup: dropProfile ? profile : '' });
  let stderr = '';
  proc.stderr?.on('data', (c) => { stderr = (stderr + c).slice(-4000); });
  const portFile = join(profile, 'DevToolsActivePort');
  const abandon = (msg) => {
    safeKill(proc, 'SIGKILL');
    if (dropProfile) try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    release();
    return Object.assign(new Error(msg), { profile });
  };
  if (!proc.pid) throw abandon(`Chrome could not be started (${bin})`);
  let port = 0;
  for (let i = 0; i < 200 && !port; i++) {
    if (spawnError) throw abandon(`Chrome could not be started (${bin}): ${spawnError.message}`);
    if (proc.exitCode !== null) throw abandon(`Chrome exited early (${proc.exitCode}): ${stderr}`);
    if (existsSync(portFile)) {
      const [p] = readFileSync(portFile, 'utf8').split('\n');
      port = Number(p) || 0;
    }
    if (!port) await sleep(50);
  }
  if (!port) throw abandon(`Chrome did not open its DevTools port: ${stderr}`);
  let version;
  let conn;
  try {
    version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    conn = await connect(version.webSocketDebuggerUrl);
  } catch (err) {
    throw abandon(`Chrome DevTools unreachable on port ${port}: ${err.message}`);
  }
  let closed = false;
  return {
    port,
    version: version.Browser,
    conn,
    proc,
    /** New tab attached through a flat session. */
    async newPage(url = 'about:blank') {
      const { targetId } = await conn.send('Target.createTarget', { url });
      const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
      return makePage(conn, sessionId, targetId);
    },
    async close() {
      if (closed) return;
      closed = true;
      try { await Promise.race([conn.send('Browser.close'), sleep(2000)]); } catch { /* already gone */ }
      conn.close();
      for (let i = 0; i < 40 && proc.exitCode === null; i++) await sleep(50);
      safeKill(proc, 'SIGKILL');
      // a relaunch on this profile must not find it still locked by the old browser
      for (let i = 0; i < 40 && proc.exitCode === null && proc.signalCode === null; i++) await sleep(50);
      if (dropProfile) try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
      release();
    },
  };
}

/** A DevTools connection: send(method, params, sessionId) and on(event, fn, sessionId). */
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error(`cannot connect to ${wsUrl}`)), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const handlers = new Map(); // `${sessionId}|${method}` → Set<fn>
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}${msg.error.data ? ` (${msg.error.data})` : ''}`));
      else p.resolve(msg.result);
      return;
    }
    const set = handlers.get(`${msg.sessionId || ''}|${msg.method}`);
    if (set) for (const fn of set) fn(msg.params);
  });
  ws.addEventListener('close', () => {
    for (const p of pending.values()) p.reject(new Error(`DevTools connection closed during ${p.method}`));
    pending.clear();
  });
  return {
    send(method, params = {}, sessionId) {
      const msg = { id: ++id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      return new Promise((resolve, reject) => {
        pending.set(msg.id, { resolve, reject, method });
        ws.send(JSON.stringify(msg));
      });
    },
    on(method, fn, sessionId = '') {
      const k = `${sessionId}|${method}`;
      if (!handlers.has(k)) handlers.set(k, new Set());
      handlers.get(k).add(fn);
      return () => handlers.get(k).delete(fn);
    },
    close() {
      try { ws.close(); } catch { /* ignore */ }
    },
  };
}

function makePage(conn, sessionId, targetId) {
  const page = {
    sessionId,
    targetId,
    send: (method, params) => conn.send(method, params, sessionId),
    on: (method, fn) => conn.on(method, fn, sessionId),
    /** Evaluate an expression in the page (awaits promises) and return its value. */
    async eval(expression, { timeoutMs = 30000 } = {}) {
      const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error(`page eval failed: ${d.exception?.description || d.text}`);
      }
      return r.result.value;
    },
    /** Navigate and wait for the load event. */
    async navigate(url, { timeoutMs = 30000 } = {}) {
      await page.send('Page.enable');
      const loaded = new Promise((res) => {
        const off = page.on('Page.loadEventFired', () => { off(); res(); });
      });
      const r = await page.send('Page.navigate', { url });
      if (r.errorText) throw new Error(`navigate ${url}: ${r.errorText}`);
      await Promise.race([loaded, sleep(timeoutMs).then(() => { throw new Error(`load timed out: ${url}`); })]);
    },
    /** Poll an expression until it is truthy; returns its value. */
    async waitFor(expression, { timeoutMs = 20000, everyMs = 100 } = {}) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        let v;
        try { v = await page.eval(expression); } catch { v = undefined; }
        if (v) return v;
        if (Date.now() > until) throw new Error(`timed out waiting for: ${expression}`);
        await sleep(everyMs);
      }
    },
    async screenshot() {
      const r = await page.send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(r.data, 'base64');
    },
  };
  return page;
}

// ------------------------------------------------------------------------------ static server

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serve a folder on 127.0.0.1 (a free port) with no caching.
 * @param {string} root
 * @param {{transform?:(urlPath:string, body:Buffer)=>Buffer|string|null, port?:number,
 *   onRequest?:(urlPath:string)=>void}} [opts]
 *   transform may rewrite a file's body for QA runs (never touches the disk); port reopens a
 *   server on the same origin (a service worker's scope is its origin); onRequest sees every path
 */
export async function serveStatic(root, opts = {}) {
  const base = resolve(root);
  const server = createServer((req, res) => {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    if (opts.onRequest) opts.onRequest(urlPath);
    const file = resolve(base, `.${urlPath}`);
    if (file !== base && !file.startsWith(base + sep)) {
      res.writeHead(403).end();
      return;
    }
    let st;
    try { st = statSync(file); } catch { st = null; }
    if (!st || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      return;
    }
    const headers = { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (opts.transform) {
      const body = readFileSync(file);
      const out = opts.transform(urlPath, body);
      res.writeHead(200, headers).end(out == null ? body : out);
      return;
    }
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  });
  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(opts.port || 0, '127.0.0.1', () => { server.off('error', rej); res(); });
  });
  const { port } = server.address();
  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    // a browser's keep-alive sockets would hold close() open until they time out
    close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }),
  };
}
