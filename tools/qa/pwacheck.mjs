#!/usr/bin/env node
// Kiln QA (G): installable, offline and quiet updates (PLAN §10 "offline launch from Home Screen"
// and "Updated toast after deploy"; brief G tasks 4 and 6). Headless Chrome on a served copy of
// the game, with D's ?sw=1 so the service worker runs on localhost. Three acts on one profile:
//
//  1 install  the start URL boots (Pixel 7 emulation); the manifest parses with no errors and
//             Chrome lists no installability errors; every manifest icon and the apple-touch-icon
//             load as PNGs of their declared size; the worker takes control; its core cache holds
//             every shipped file in sw.js's list; the runtime cache holds every three.js and Google
//             Fonts file the page used; the music is warmed into the cache (on a good connection).
//  2 offline  Chrome's HTTP cache is cleared (only the worker's caches count), Chrome is closed, the
//             server stopped, and Chrome started again on the same profile with every host except
//             localhost unresolvable (the CDN and Google Fonts too; a probe proves both are gone):
//             the start URL boots to the title, and after a tap (audio unlock) levels 1 and 10 play
//             (sim steps, frames drawn, the level's music decoded or streamed from the cache), with no failed
//             request and nothing logged as an error.
//  3 update   the server returns with a new BUILD in sw.js (the served copy only, never the disk).
//             During live play the new worker takes over but the page never reloads; at the level
//             map (reached by a real tap on Pause, then Levels) it reloads into the new build and
//             says "Updated" once; the old build's cache is gone.
//
//   node tools/qa/pwacheck.mjs                      all three acts, Pixel 7
//   node tools/qa/pwacheck.mjs --device desktop --levels 1,10,30 --json out.json
//
// Exit 1 if any check fails. The served copy is K/.worktrees/G by default (--root).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, serveStatic } from './lib/cdp.mjs';
import { getDevice, emulateDevice } from './lib/devices.mjs';
import { tap, click, centerOfText } from './lib/input.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CDN = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/three@|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;
const RUNTIME = 'kiln-runtime-v1';
const UPDATED_TOAST = 'Kiln updated';

function parseArgs(argv) {
  const o = { device: 'pixel7', root: resolve(HERE, '..', '..'), levels: [1, 10], json: '', headed: false, warmSeconds: 120 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--device') o.device = v();
    else if (a === '--root') o.root = resolve(v());
    else if (a === '--levels') o.levels = v().split(',').map(Number).filter((n) => n > 0);
    else if (a === '--json') o.json = v();
    else if (a === '--warm-seconds') o.warmSeconds = Number(v());
    else if (a === '--headed') o.headed = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown option ${a} (try --help)`);
  }
  getDevice(o.device);
  return o;
}

/** sw.js's shipped file list (between FILES:BEGIN and FILES:END). */
export function swFiles(swText) {
  const m = /FILES:BEGIN[^\n]*\n([\s\S]*?)\/\/ FILES:END/.exec(swText);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** Width and height from a PNG's IHDR, or null when it is not a PNG. */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

const CACHES = `(async () => {
  const out = {};
  for (const n of await caches.keys()) out[n] = (await (await caches.open(n)).keys()).map((r) => r.url);
  return out;
})()`;

/** Attach the error and network listeners every act uses. */
async function watch(page, sink) {
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  page.on('Runtime.exceptionThrown', (e) => sink.errors.push(`exception: ${e.exceptionDetails.exception?.description?.split('\n')[0] || e.exceptionDetails.text}`));
  page.on('Runtime.consoleAPICalled', (e) => {
    if (e.type === 'error') sink.errors.push(`console.error: ${e.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
  });
  const urls = new Map();
  sink.requested = sink.requested || new Set();
  page.on('Network.requestWillBeSent', (e) => {
    urls.set(e.requestId, e.request.url);
    sink.requested.add(e.request.url);
  });
  page.on('Network.responseReceived', (e) => {
    if (e.response.status >= 400) sink.network.push(`${e.response.status} ${e.response.url}`);
    if (e.response.fromServiceWorker) sink.fromSw++;
  });
  page.on('Network.loadingFailed', (e) => {
    // the offline act's own reachability probes are meant to fail
    if (!e.canceled && !String(urls.get(e.requestId)).includes('kiln-qa-probe')) sink.network.push(`failed (${e.errorText}) ${urls.get(e.requestId) || e.requestId}`);
  });
}

function judge(name, problem, checks, log) {
  checks[name] = problem || 'ok';
  log(`  ${problem ? 'FAIL' : 'ok  '} ${name}${problem ? `: ${problem}` : ''}`);
}

const BOOTED = `window.__kiln && document.body.classList.contains('ready') && !!window.__kiln.ui.current`;

/** Start level n the way the game does and let it play for `ms`; returns what was seen. */
async function playLevel(page, n, ms, device) {
  // startLevel may await a Mod/Overload choice. Do not await its promise through Runtime.evaluate.
  await page.eval(`window.__kiln.startLevel(${n}); true`);
  for (let i = 0; i < 6; i++) {
    const state = await page.waitFor(`window.__kiln.ui.current === 'pick' ? 'pick' : (window.__kiln.world && window.__kiln.world.level.def.n === ${n} && window.__kiln.app.mode === 'play' ? 'play' : '')`, { timeoutMs: 20000 });
    if (state === 'play') break;
    const choose = await page.eval(`(() => { const b = document.querySelector('#ui button.btn.primary'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    if (!choose) throw new Error(`level ${n}: no pre-level Choose button`);
    await (device.touch ? tap(page, ...choose) : click(page, ...choose));
    await sleep(200);
  }
  await page.waitFor(`window.__kiln.world && window.__kiln.world.level.def.n === ${n} && window.__kiln.app.mode === 'play'`, { timeoutMs: 20000 });
  const launchAt = await page.eval(`(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.8]; })()`);
  await (device.touch ? tap(page, ...launchAt) : click(page, ...launchAt));
  await page.waitFor(`window.__kiln.world.phase === 'play'`, { timeoutMs: 5000 });
  const a = await page.eval(`({ steps: window.__kiln.stats.steps, frames: window.__kiln.stats.frames })`);
  await sleep(ms);
  return page.eval(`({ steps: window.__kiln.stats.steps - ${a.steps}, frames: window.__kiln.stats.frames - ${a.frames},
    track: window.__kiln.audio.state.track, decoded: window.__kiln.audio.state.decoded, streaming: !!window.__kiln.audio.state.streaming,
    context: window.__kiln.audio.state.context })`);
}

/**
 * The level's music is playing from what the browser holds: a pair decoded, or (E, 1ce4679) a
 * one-mix track streaming from a blob of the cached file (state.streaming is set only once the
 * fetch gave a file and the element plays it).
 */
const MUSIC_ON = `(() => { const s = window.__kiln.audio.state; return { decoded: s.decoded || 0, streaming: !!s.streaming }; })()`;

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  if (o.help) {
    console.log('see the header of tools/qa/pwacheck.mjs');
    return 0;
  }
  const log = (s) => console.log(s);
  const device = getDevice(o.device);
  const swText = readFileSync(join(o.root, 'sw.js'), 'utf8');
  const files = swFiles(swText);
  if (!files || !/const BUILD = '[^']*';/.test(swText)) {
    console.error('sw.js has no FILES list or no BUILD line');
    return 2;
  }
  const lazy = (f) => f.startsWith('audio/music/');
  const coreFiles = files.filter((f) => !lazy(f));
  const music = files.filter(lazy);
  let build = 'qa-1';
  const served = [];
  const serveOpts = {
    transform: (p, body) => {
      if (p !== '/sw.js') return null;
      let source = body.toString('utf8').replace(/const BUILD = '[^']*';/, `const BUILD = '${build}';`);
      // A real failed fetch during installation, without altering a shipped file on disk.
      if (build === 'qa-failed') source = source.replace('const FILES = [', "const FILES = [\n  'kiln-qa-required-missing.js',");
      return source;
    },
    onRequest: (p) => served.push(p),
  };
  let server = await serveStatic(o.root, serveOpts);
  const port = server.port;
  const base = `http://localhost:${port}/`;
  // start_url is ./ ; on localhost D's ?sw=1 turns the worker on (without it pwa.js removes it)
  const start = `${base}?sw=1&mute=1`;
  const profile = mkdtempSync(join(tmpdir(), 'kiln-pwa-'));
  const checks = {};
  const notes = {};
  const sink = { errors: [], network: [], fromSw: 0 };
  let chrome = null;
  const exerciseUpgrade = async (page, label, nextBuild) => {
    const detail = notes[label] = {};
    const result = (name, problem) => judge(`${label}-${name}`, problem, checks, log);
    let navigations = 0;
    await page.send('Page.enable');
    const unwatch = page.on('Page.frameNavigated', (e) => { if (!e.frame.parentId) navigations++; });
    const firstBuild = await page.eval(`caches.keys().then((k) => k.filter((n) => n.startsWith('kiln-core-')).join(','))`);
    await page.eval(`window.__qaMark = 1; window.__qaCC = 0; navigator.serviceWorker.addEventListener('controllerchange', () => { window.__qaCC++; }); true`);
    const live = await playLevel(page, o.levels[0] || 1, 500, device);
    const navBefore = navigations;
    build = nextBuild;
    // what a deploy looks like to an open page: its next update check (pwa.js runs one whenever the
    // tab becomes visible again; the browser on navigations) finds a changed sw.js
    await page.eval(`navigator.serviceWorker.getRegistration().then((r) => r && r.update()).then(() => true)`);
    const took = await page.waitFor(`window.__qaCC > 0 || (window.__qaMark !== 1 && 'reloaded')`, { timeoutMs: 30000 }).catch(() => 0);
    await sleep(4000); // pwa.js checks for a safe point every 1.5 s
    const stillPlaying = await page.eval(`window.__qaMark === 1 && window.__kiln.app.mode === 'play'`).catch(() => false);
    result('update-takes-over', took ? '' : `the new worker did not take control within 30 s (caches before: ${firstBuild})`);
    result('no-reload-in-play', stillPlaying && navigations === navBefore ? '' : `the page reloaded or left play during live play (${navigations - navBefore} navigations)`);
    // the player's way out: Pause (a real tap on the HUD button, P on desktop), then Levels
    const pauseAt = await page.eval(`(() => { const b = document.querySelector('[aria-label="Pause"], .hud .pause, button.pause'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    if (pauseAt) await (device.touch ? tap(page, pauseAt[0], pauseAt[1]) : click(page, pauseAt[0], pauseAt[1]));
    else await page.eval(`window.__kiln.pause('user')`);
    await page.waitFor(`window.__kiln.ui.current === 'pause'`, { timeoutMs: 5000 }).catch(() => {});
    await sleep(300);
    const levelsAt = await centerOfText(page, '^Levels');
    if (levelsAt) await (device.touch ? tap(page, levelsAt[0], levelsAt[1]) : click(page, levelsAt[0], levelsAt[1]));
    else await page.eval(`window.__kiln.showMap()`);
    const reloadedAt = Date.now();
    const reloaded = await page.waitFor(`window.__qaMark === undefined && !!(${BOOTED})`, { timeoutMs: 8000 }).catch(() => false);
    let toast = '';
    if (reloaded) {
      toast = await page.waitFor(`(() => { const t = document.querySelector('.toast.in'); return t && t.textContent.trim(); })()`, { timeoutMs: 5000, everyMs: 50 }).catch(() => '');
    }
    detail.toastAfterMs = toast ? Date.now() - reloadedAt : null;
    result('reload-at-safe-point', reloaded ? '' : `no reload within 8 s of reaching the level map (pause found ${!!pauseAt}, Levels found ${!!levelsAt})`);
    detail.updatedToast = toast;
    result('updated-toast', toast === UPDATED_TOAST ? '' : `toast "${toast}" after the reload`);
    if (o.json && toast === UPDATED_TOAST) {
      detail.toastScreenshot = `${o.json.replace(/\.json$/i, '')}-${label}-toast.png`;
      writeFileSync(detail.toastScreenshot, await page.screenshot());
    }
    const cacheMap = await page.eval(CACHES);
    const coreNames = Object.keys(cacheMap).filter((n) => n.startsWith('kiln-core-'));
    result('old-cache-dropped', coreNames.join(',') === `kiln-core-${nextBuild}` ? '' : `core caches now: ${coreNames.join(', ') || 'none'}`);
    // "Updated" is said once: a second reload is quiet
    await page.eval(`window.__qaMark = 2; location.reload(); true`).catch(() => {});
    await sleep(500);
    const secondReload = await page.waitFor(`window.__qaMark === undefined && !!(${BOOTED})`, { timeoutMs: 20000 }).catch(() => false);
    result('second-reload', secondReload ? '' : 'the once-only check did not reach a fresh boot');
    const again = await page.waitFor(`(() => { const t = document.querySelector('.toast.in'); return t && t.textContent.trim(); })()`, { timeoutMs: 2500, everyMs: 50 }).catch(() => '');
    result('updated-once', again === UPDATED_TOAST ? 'the update toast came back on the next reload' : '');
    detail.live = live;
    unwatch();
  };
  log(`Kiln PWA check: ${device.name} ${device.width}x${device.height}, ${base}, ${coreFiles.length} core files + ${music.length} music`);
  try {
    // ------------------------------------------------------------------ 1 install
    log('1 install (online)');
    chrome = await launchChrome({ headless: !o.headed, width: device.width, height: device.height, profile, keepProfile: true });
    let page = await chrome.newPage();
    await watch(page, sink);
    await emulateDevice(page, device);
    await page.navigate(start);
    await page.waitFor(BOOTED, { timeoutMs: 30000 }).catch(() => {});
    judge('boots', (await page.eval(`!!(${BOOTED})`)) ? '' : 'the game did not reach a screen in 30 s', checks, log);

    const man = await page.send('Page.getAppManifest');
    let manifest = null;
    try { manifest = JSON.parse(man.data || 'null'); } catch { /* reported below */ }
    const manProblems = [...(man.errors || []).map((e) => e.message)];
    if (!man.url) manProblems.push('no <link rel=manifest>');
    else if (!manifest) manProblems.push('manifest is not JSON');
    else {
      if (manifest.display !== 'standalone' && manifest.display !== 'fullscreen') manProblems.push(`display ${manifest.display}`);
      if (!manifest.start_url) manProblems.push('no start_url');
      const sizes = (manifest.icons || []).map((i) => i.sizes);
      if (!sizes.includes('192x192') || !sizes.includes('512x512')) manProblems.push(`icons ${sizes.join(' ')} (192 and 512 needed)`);
    }
    judge('manifest', manProblems.join('; '), checks, log);

    // icons: each one loads and is a PNG of its declared size (Node fetch, not the page)
    const iconProblems = [];
    const touchIcon = await page.eval(`(document.querySelector('link[rel=apple-touch-icon]') || {}).href || ''`);
    const icons = [...((manifest && manifest.icons) || []).map((i) => ({ url: new URL(i.src, man.url).href, sizes: i.sizes })),
      ...(touchIcon ? [{ url: touchIcon, sizes: '180x180' }] : [])];
    if (!touchIcon) iconProblems.push('no apple-touch-icon link (iOS Home Screen icon)');
    for (const ic of icons) {
      try {
        const r = await fetch(ic.url);
        const size = r.ok ? pngSize(Buffer.from(await r.arrayBuffer())) : null;
        if (!r.ok) iconProblems.push(`${r.status} ${ic.url}`);
        else if (!size) iconProblems.push(`${ic.url} is not a PNG`);
        else if (`${size[0]}x${size[1]}` !== ic.sizes) iconProblems.push(`${ic.url.slice(base.length)} is ${size[0]}x${size[1]}, declared ${ic.sizes}`);
      } catch (err) {
        iconProblems.push(`${ic.url}: ${err.message}`);
      }
    }
    judge('icons', iconProblems.join('; '), checks, log);

    const ctl = await page.waitFor(`navigator.serviceWorker && navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL`, { timeoutMs: 30000 }).catch(() => '');
    judge('worker', ctl ? '' : 'no service worker controls the page after 30 s (is ?sw=1 honoured?)', checks, log);

    const inst = await page.send('Page.getInstallabilityErrors').catch((e) => ({ installabilityErrors: [{ errorId: e.message }] }));
    const instErr = (inst.installabilityErrors || []).map((e) => e.errorId + (e.errorArguments?.length ? ` (${e.errorArguments.map((a) => `${a.name}=${a.value}`).join(', ')})` : ''));
    judge('installable', instErr.join('; '), checks, log);

    log('1b upgrade on the original first-install page');
    await exerciseUpgrade(page, 'first-visit', 'qa-first-upgrade');

    // core cache: every shipped file except the music, which is warmed after
    const coreName = `kiln-core-${build}`;
    let cacheMap = {};
    let missing = coreFiles;
    for (let t = 0; t < 60 && missing.length; t++) {
      cacheMap = await page.eval(CACHES);
      const have = new Set((cacheMap[coreName] || []).map((u) => new URL(u).pathname.slice(1)));
      missing = coreFiles.filter((f) => !have.has(f));
      if (missing.length) await sleep(500);
    }
    judge('core-cache', missing.length ? `${coreName} lacks ${missing.length} of ${coreFiles.length}: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' ...' : ''}` : '', checks, log);

    // runtime cache: every CDN module and font file the page requested (from DevTools' own network
    // log: Resource Timing, which pwa.js reads, does not list the Google Fonts files in Chrome 155)
    const used = [...sink.requested].filter((u) => CDN.test(u));
    let notCached = used;
    for (let t = 0; t < 40 && notCached.length; t++) {
      cacheMap = await page.eval(CACHES);
      const have = new Set(cacheMap[RUNTIME] || []);
      notCached = used.filter((u) => !have.has(u));
      if (notCached.length) await sleep(500);
    }
    notes.cdnFiles = used.length;
    judge('runtime-cache', !used.length ? 'the page used no three.js file from the CDN (import map changed?)'
      : notCached.length ? `${notCached.length} of ${used.length} not cached: ${notCached.slice(0, 4).join(', ')}` : '', checks, log);

    // music warmed into the core cache in the background
    const t0 = Date.now();
    let cold = music;
    while (cold.length && Date.now() - t0 < o.warmSeconds * 1000) {
      cacheMap = await page.eval(CACHES);
      const have = new Set((cacheMap[coreName] || []).map((u) => new URL(u).pathname.slice(1)));
      cold = music.filter((f) => !have.has(f));
      if (cold.length) await sleep(1000);
    }
    notes.warmSeconds = Math.round((Date.now() - t0) / 100) / 10;
    judge('music-warm', cold.length ? `${cold.length} of ${music.length} music files not cached after ${o.warmSeconds} s: ${cold.slice(0, 3).join(', ')}` : '', checks, log);
    log(`  (${used.length} CDN files, music warm after ${notes.warmSeconds} s, ${sink.fromSw} responses from the worker so far)`);
    judge('errors-online', [...new Set([...sink.errors, ...sink.network])].slice(0, 6).join(' | '), checks, log);
    log('1c failed upgrade preserves the last complete offline build');
    const stableBuild = build;
    await page.eval(`window.__qaFailedCC = 0; navigator.serviceWorker.addEventListener('controllerchange', () => window.__qaFailedCC++); true`);
    build = 'qa-failed';
    const failedState = await page.eval(`(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      let w = null;
      r.addEventListener('updatefound', () => { w = r.installing; }, { once: true });
      await r.update();
      w = w || r.installing;
      if (!w) return 'no installing worker';
      return new Promise((resolve) => {
        const check = () => { if (w.state === 'redundant' || w.state === 'activated') resolve(w.state); };
        w.addEventListener('statechange', check); check();
        setTimeout(() => resolve('timeout: ' + w.state), 20000);
      });
    })()`);
    judge('failed-upgrade-rejected', failedState === 'redundant' ? '' : `failed worker state: ${failedState}`, checks, log);
    const unchanged = await page.eval(`window.__qaFailedCC === 0`);
    const preserved = await page.eval(`caches.has(${JSON.stringify(coreName)})`);
    judge('failed-upgrade-preserves-worker', unchanged && preserved ? '' : `controller unchanged: ${unchanged}, previous cache present: ${preserved}`, checks, log);
    const partial = await page.eval(`caches.has('kiln-core-qa-failed')`);
    judge('failed-upgrade-cache-cleaned', partial ? 'the failed upgrade retained its partial cache' : '', checks, log);
    build = stableBuild;
    // only the worker's caches may count offline: Chrome's own HTTP cache would keep three.js (a
    // year-long max-age) where Safari may not
    await page.send('Network.clearBrowserCache');
    await chrome.close();
    chrome = null;

    // ------------------------------------------------------------------ 2 offline
    log('2 offline relaunch (server stopped, every host but localhost unresolvable)');
    await server.close();
    server = null;
    served.length = 0;
    const off = { errors: [], network: [], fromSw: 0 };
    chrome = await launchChrome({
      headless: !o.headed, width: device.width, height: device.height, profile, keepProfile: true,
      args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost'],
    });
    page = await chrome.newPage();
    await watch(page, off);
    await emulateDevice(page, device);
    await page.navigate(start).catch((e) => off.network.push(`navigate: ${e.message}`));
    await page.waitFor(BOOTED, { timeoutMs: 30000 }).catch(() => {});
    const offScreen = await page.eval(`window.__kiln && window.__kiln.ui ? window.__kiln.ui.current : null`).catch(() => null);
    judge('offline-boot', offScreen ? '' : 'the start URL did not boot offline', checks, log);
    // proof the network really is gone: a CDN file and a same-origin file nobody cached both fail
    const reach = await page.eval(`Promise.all([
      fetch('https://cdn.jsdelivr.net/npm/three@0.160.0/package.json?kiln-qa-probe=' + Date.now()).then((r) => 'cdn ' + r.status, () => ''),
      fetch('kiln-qa-probe-' + Date.now() + '.txt').then((r) => 'localhost ' + r.status, () => ''),
    ]).then((a) => a.filter(Boolean).join(', '))`).catch((e) => `probe failed: ${e.message}`);
    judge('offline-is-offline', reach ? `still reachable: ${reach}` : '', checks, log);
    const plays = [];
    if (offScreen) {
      // a real tap unlocks the audio as a player's first tap does, so the music is fetched and decoded
      await tap(page, 4, 4);
      for (const n of o.levels) {
        try {
          const r = await playLevel(page, n, 3000, device);
          let m = { decoded: r.decoded || 0, streaming: !!r.streaming };
          for (let t = 0; t < 50 && !m.decoded && !m.streaming; t++) {
            await sleep(100);
            m = await page.eval(MUSIC_ON);
          }
          const how = m.streaming ? 'streaming from the cached file' : `${m.decoded} decoded`;
          plays.push(`level ${n}: ${r.steps} steps, ${r.frames} frames, music ${r.track || 'none'} (${how}, context ${r.context})`);
          if (r.steps < 120 || r.frames < 30) off.network.push(`level ${n} did not play offline (${r.steps} steps, ${r.frames} frames in 3 s)`);
          if (!m.decoded && !m.streaming) off.network.push(`level ${n}: no music offline, neither decoded nor streaming (track ${r.track}, context ${r.context})`);
        } catch (err) {
          off.network.push(`level ${n}: ${err.message}`);
        }
      }
    }
    for (const p of plays) log(`  ${p}`);
    judge('offline-play', [...new Set([...off.errors, ...off.network])].slice(0, 8).join(' | '), checks, log);
    notes.offlinePlays = plays;
    await chrome.close();
    chrome = null;

    // ------------------------------------------------------------------ 3 update
    log('3 update (server back; a new BUILD once live play has started)');
    // the browser checks sw.js on every navigation, so the new BUILD appears only once the page is
    // in live play: the takeover must then happen under a player, not at the title
    server = await serveStatic(o.root, { ...serveOpts, port });
    const upd = { errors: [], network: [], fromSw: 0 };
    chrome = await launchChrome({ headless: !o.headed, width: device.width, height: device.height, profile });
    page = await chrome.newPage();
    await watch(page, upd);
    await emulateDevice(page, device);
    await page.navigate(start);
    await page.waitFor(BOOTED, { timeoutMs: 30000 });
    await exerciseUpgrade(page, 'returning-visit', 'qa-2');
    judge('errors-update', [...new Set([...upd.errors, ...upd.network])].slice(0, 6).join(' | '), checks, log);
  } catch (err) {
    judge('run', err.message, checks, log);
  } finally {
    if (chrome) await chrome.close();
    if (server) await server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  const failed = Object.entries(checks).filter(([, v]) => v !== 'ok');
  if (o.json) writeFileSync(o.json, JSON.stringify({ when: new Date().toISOString(), device: o.device, checks, notes }, null, 2));
  log(`\nRESULT: ${failed.length ? `FAIL (${failed.map(([k]) => k).join(', ')})` : 'PASS'} (${Object.keys(checks).length} checks)`);
  return failed.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
