#!/usr/bin/env node
// Kiln QA: a start that is not seen the whole way. Headless Chrome with its normal background
// throttling (the other tools turn it off). Audio is muted (Chrome --mute-audio and mute=1).
//
// --mode background (default): the game opens in a tab created behind another one, so the document
// is hidden and gets no animation frames. The tab stays there for --hidden seconds, then comes forward.
//   hidden    the condition really held: visibilityState 'hidden' and no animation frame while behind
//   held      while hidden the startup never failed, never reloaded the page, never spent its one
//             automatic retry, and none of the hidden time counted toward its 20 s deadline
//
// --mode freeze: a phone app switch during loading. The game opens in front; at its first shader
// completion check another tab comes in front (the page is hidden) and the page is frozen for
// --hidden seconds (Page.setWebLifecycleState, as a browser does to a page in the background), then
// unfrozen while still hidden, and after 3 s comes forward. A probe keeps the driver's answer at
// "still compiling" until the page is back from the freeze, so the switch always lands inside the
// preparation wait (normally about 60 ms).
//   away      the page was seen when it loaded, was hidden before the freeze, and no completion check
//             ran while it was frozen (it really was frozen for --hidden seconds)
//   held      while away the startup never failed, never reloaded the page and never spent its one
//             automatic retry, and its 20 s deadline was held
//
// --mode hold: script held while the page is seen. At the first shader completion check the page's
// script blocks for --hidden seconds (a long task or a paused page), with the driver answering truthfully.
//   blocked   the page stayed seen and its script was blocked for --hidden seconds at that check
//   held      the startup never failed, never reloaded the page and never spent its one retry
//
// Every mode also checks:
//   ready     within --front seconds of coming forward (or of the hold ending) the game is ready
//             (startup ready, body.ready, frames counting) with no recovery screen
//   errors    no exception and no console error
// and saves a screenshot at the end. Freeze and hold need KHR_parallel_shader_compile (the check that
// is probed); without it they fail with "no completion check".
//
//   node tools/qa/hiddenstart.mjs --url http://127.0.0.1:8811/ --hidden 60
//   node tools/qa/hiddenstart.mjs --mode freeze --hidden 15 --device iphone14pro --json r.json
//   node tools/qa/hiddenstart.mjs --mode hold --hidden 15 --out /tmp/shots
//
// Without --url it serves this checkout itself. Exit 1 if any check fails.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, serveStatic } from './lib/cdp.mjs';
import { getDevice, emulateDevice } from './lib/devices.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODES = ['background', 'freeze', 'hold'];

function parseArgs(argv) {
  const o = { url: '', root: resolve(HERE, '..', '..'), mode: 'background', hidden: NaN, front: 10, device: 'desktop', out: '', json: '', params: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--url') o.url = v();
    else if (a === '--root') o.root = resolve(v());
    else if (a === '--mode') o.mode = v();
    else if (a === '--hidden') o.hidden = Number(v());
    else if (a === '--front') o.front = Number(v());
    else if (a === '--device') o.device = v();
    else if (a === '--out') o.out = resolve(v());
    else if (a === '--json') o.json = v();
    else if (a === '--params') o.params = v();
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown option ${a} (try --help)`);
  }
  if (!MODES.includes(o.mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  if (Number.isNaN(o.hidden)) o.hidden = o.mode === 'background' ? 60 : 15;
  getDevice(o.device);
  return o;
}

// Counts animation frames and visibility changes only; it does not change the game.
const PROBE = `(() => {
  window.__hiddenProbe = { rafs: 0, vis: [[Math.round(performance.now()), document.visibilityState]] };
  const raf = window.requestAnimationFrame.bind(window);
  (function count() { raf(() => { window.__hiddenProbe.rafs++; count(); }); })();
  document.addEventListener('visibilitychange', () => window.__hiddenProbe.vis.push([Math.round(performance.now()), document.visibilityState]));
})();`;

// Freeze and hold: watches the shader completion checks (COMPLETION_STATUS_KHR) and signals the first.
// Freeze answers "still compiling" while P.hold is set; hold blocks the page's script once. Other
// program queries pass through untouched. bursts: wall-clock starts of each run of checks (one poll).
const prepProbe = (mode, seconds) => `(() => {
  const P = window.__prepProbe = { checks: 0, first: null, last: null, bursts: [], hold: ${mode === 'freeze'}, blockMs: ${mode === 'hold' ? seconds * 1000 : 0}, blocked: 0 };
  const proto = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
  if (!proto) return;
  const original = proto.getProgramParameter;
  proto.getProgramParameter = function (program, pname) {
    if (pname !== 0x91B1) return original.call(this, program, pname);
    const wall = Date.now();
    P.checks++;
    if (P.last === null || wall - P.last > 5) { if (P.bursts.length < 4000) P.bursts.push(wall); }
    P.last = wall;
    if (P.first === null) {
      P.first = wall;
      try { window.__prepSignal('first-completion-check'); } catch {}
      if (P.blockMs) { const end = wall + P.blockMs; while (Date.now() < end) {} P.blocked = Date.now() - wall; P.last = Date.now(); }
    }
    const value = original.call(this, program, pname);
    return P.hold ? false : value;
  };
})();`;

const STATE = `(() => {
  const s = window.__kilnStartup && window.__kilnStartup.snapshot();
  const box = document.getElementById('startup-recovery');
  let retry = null;
  try { retry = sessionStorage.getItem('kiln.startup.retry'); } catch { retry = 'unreadable'; }
  const P = window.__prepProbe;
  return {
    vis: document.visibilityState, rafs: window.__hiddenProbe ? window.__hiddenProbe.rafs : null,
    visLog: window.__hiddenProbe ? window.__hiddenProbe.vis : null,
    stage: s ? s.stage : null, ready: s ? s.ready : null, failed: s ? s.failed : null,
    deadlineMs: s ? s.deadlineMs : null, deadlineHeld: s ? s.deadlineHeld : null,
    recovery: box ? box.innerText.replace(/\\s+/g, ' ').trim() : null,
    bodyReady: !!(document.body && document.body.classList.contains('ready')),
    frames: window.__kiln && window.__kiln.stats ? window.__kiln.stats.frames : null,
    prep: window.__kiln && window.__kiln.renderer && window.__kiln.renderer.stats ? window.__kiln.renderer.stats.preparation : null,
    probe: P ? { checks: P.checks, first: P.first, last: P.last, hold: P.hold, blocked: P.blocked, bursts: P.bursts.length } : null,
    retry, records: s ? s.records.map((r) => ({ stage: r.stage, kind: r.kind, message: r.message })) : [],
  };
})()`;

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log('node tools/qa/hiddenstart.mjs [--mode background|freeze|hold] [--url U] [--root DIR] [--hidden S] [--front S] [--device NAME] [--params "a=1&b=2"] [--out DIR] [--json FILE]');
    return 0;
  }
  const device = getDevice(o.device);
  const out = o.out || join(HERE, 'out', 'hiddenstart');
  mkdirSync(out, { recursive: true });
  let server = null, chrome = null;
  const report = { mode: o.mode, device: o.device, hiddenSeconds: o.hidden, url: '', samples: [], navigations: 0, errors: [], checks: {} };
  try {
    let base = o.url;
    if (!base) { server = await serveStatic(o.root); base = server.url; }
    const url = new URL(base);
    url.searchParams.set('mute', '1');
    for (const [k, v] of new URLSearchParams(o.params)) url.searchParams.set(k, v);
    report.url = url.href;

    chrome = await launchChrome({ headless: true, throttle: true, width: device.width, height: device.height });
    const { conn } = chrome;
    // background: the game tab is created behind the first tab (about:blank stays in front).
    // freeze and hold: the game tab opens in front; freeze later brings the first tab forward over it.
    const { targetInfos } = await conn.send('Target.getTargets');
    const cover = targetInfos.find((t) => t.type === 'page');
    const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank', background: o.mode === 'background' });
    const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => conn.send(method, params, sessionId);
    const page = { send };
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await emulateDevice(page, device);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    let firstCheck = null;
    if (o.mode !== 'background') {
      await send('Runtime.addBinding', { name: '__prepSignal' });
      await send('Page.addScriptToEvaluateOnNewDocument', { source: prepProbe(o.mode, o.hidden) });
      firstCheck = new Promise((res) => conn.on('Runtime.bindingCalled', (e) => { if (e.name === '__prepSignal') res(Date.now()); }, sessionId));
    }
    conn.on('Runtime.exceptionThrown', (e) => report.errors.push(`exception: ${e.exceptionDetails?.exception?.description || e.exceptionDetails?.text}`), sessionId);
    conn.on('Runtime.consoleAPICalled', (e) => {
      if (e.type === 'error') report.errors.push(`console.error: ${e.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }, sessionId);
    conn.on('Page.frameNavigated', (e) => { if (!e.frame.parentId && e.frame.url !== 'about:blank') report.navigations++; }, sessionId);

    const t0 = Date.now();
    const sample = async (phase) => {
      let v;
      try { v = await evaluate(STATE); } catch (err) { v = { error: err.message }; }
      const s = { t: +((Date.now() - t0) / 1000).toFixed(1), phase, ...v };
      report.samples.push(s);
      console.log(`[${s.t}s] ${phase} vis=${s.vis} rafs=${s.rafs} stage=${s.stage} ready=${s.ready} failed=${s.failed} deadline=${s.deadlineMs}${s.deadlineHeld ? ' held' : ''} frames=${s.frames}${s.probe ? ` checks=${s.probe.checks}` : ''}${s.recovery ? ` recovery="${s.recovery}"` : ''}`);
      return s;
    };
    const c = report.checks;
    const fail = (why) => why;
    const bad = (s) => s.failed || s.recovery || (s.records || []).some((r) => ['timeout', 'automatic-retry', 'entry', 'exception', 'rejection'].includes(r.kind));

    await send('Page.navigate', { url: url.href });
    let comeForward = null; // wall time the page came forward (or the hold ended)
    if (o.mode === 'background') {
      while (Date.now() - t0 < o.hidden * 1000) {
        await sleep(Math.min(2000, Math.max(0, o.hidden * 1000 - (Date.now() - t0))));
        await sample('hidden');
      }
      const behind = report.samples.filter((s) => s.phase === 'hidden' && !s.error);
      const last = behind.at(-1) || {};
      c.hidden = behind.length && behind.every((s) => s.vis === 'hidden' && s.rafs === 0) ? 'ok'
        : fail(`the tab was not really hidden (${behind.map((s) => `${s.vis}/${s.rafs}`).join(' ')})`);
      c.held = behind.some(bad) ? fail('the startup failed or retried while hidden')
        : report.navigations > 1 ? fail(`the page reloaded while hidden (${report.navigations} navigations)`)
          : last.retry ? fail(`the automatic retry was spent (kiln.startup.retry=${last.retry})`)
            : last.deadlineMs !== 20000 || !last.deadlineHeld ? fail(`hidden time counted (deadline ${last.deadlineMs} ms left, held ${last.deadlineHeld})`)
              : 'ok';
      await conn.send('Target.activateTarget', { targetId });
      comeForward = Date.now();
    } else {
      const signalled = await Promise.race([firstCheck, sleep(30000).then(() => null)]);
      report.firstCheckAt = signalled === null ? null : signalled - t0;
      if (signalled === null) {
        c.away = c.blocked = fail('no shader completion check within 30 s (no KHR_parallel_shader_compile?)');
      } else if (o.mode === 'freeze') {
        await conn.send('Target.activateTarget', { targetId: cover.targetId });
        let vis = null;
        for (let i = 0; i < 60 && vis !== 'hidden'; i++) { vis = (await sample('switched away')).vis; if (vis !== 'hidden') await sleep(50); }
        const before = report.samples.at(-1);
        await send('Page.setWebLifecycleState', { state: 'frozen' });
        const frozenAt = Date.now();
        console.log(`[${((frozenAt - t0) / 1000).toFixed(1)}s] frozen for ${o.hidden} s`);
        await sleep(o.hidden * 1000);
        await send('Page.setWebLifecycleState', { state: 'active' });
        const activeAt = Date.now();
        console.log(`[${((activeAt - t0) / 1000).toFixed(1)}s] unfrozen, still hidden`);
        const afterThaw = await sample('unfrozen, hidden');
        await evaluate('window.__prepProbe.hold = false');
        const bursts = await evaluate('window.__prepProbe.bursts');
        for (let i = 0; i < 3; i++) { await sleep(1000); await sample('hidden'); }
        const away = report.samples.filter((s) => s.phase !== 'front' && !s.error);
        const last = away.at(-1) || {};
        const during = bursts.filter((b) => b > frozenAt + 50 && b < activeAt);
        report.freeze = { frozenAt: frozenAt - t0, activeAt: activeAt - t0, seconds: (activeAt - frozenAt) / 1000, checksDuringFreeze: during.length,
          checksBefore: before?.probe?.checks ?? null, checksAfterThaw: afterThaw?.probe?.checks ?? null };
        const loadedSeen = (last.visLog || [])[0]?.[1] === 'visible';
        c.away = !loadedSeen ? fail(`the page was not seen when it loaded (${JSON.stringify(last.visLog)})`)
          : before?.vis !== 'hidden' ? fail(`the page was not hidden before the freeze (${before?.vis})`)
            : during.length ? fail(`${during.length} completion checks ran while frozen`)
              : activeAt - frozenAt < o.hidden * 1000 ? fail('the freeze was shorter than asked')
                : 'ok';
        c.held = away.some(bad) ? fail(`the startup failed or retried while away (${JSON.stringify(away.find(bad)?.records?.filter((r) => r.kind !== 'stage'))})`)
          : report.navigations > 1 ? fail(`the page reloaded while away (${report.navigations} navigations)`)
            : last.retry ? fail(`the automatic retry was spent (kiln.startup.retry=${last.retry})`)
              : !last.deadlineHeld ? fail(`the startup deadline was not held while away (${last.deadlineMs} ms left)`)
                : 'ok';
        await conn.send('Target.activateTarget', { targetId });
        comeForward = Date.now();
      } else {
        // hold: the page's script is blocked inside the first check; evaluations wait until it ends
        await sleep(o.hidden * 1000 + 500);
        const s = await sample('after the hold');
        comeForward = Date.now();
        report.hold = { blockedMs: s.probe?.blocked ?? null };
        const visLog = s.visLog || [];
        c.blocked = !(s.probe?.blocked >= o.hidden * 1000) ? fail(`the script was not blocked for ${o.hidden} s (${s.probe?.blocked} ms)`)
          : !visLog.length || visLog.some(([, v]) => v !== 'visible') ? fail(`the page did not stay seen (${JSON.stringify(visLog)})`)
            : 'ok';
      }
    }

    let front = null, readyAt = null, framesAtReady = null;
    const from = comeForward ?? Date.now();
    while (Date.now() - from < o.front * 1000) {
      await sleep(500);
      front = await sample('front');
      if (readyAt === null && front.ready && front.bodyReady) { readyAt = front.t; framesAtReady = front.frames; }
      if (readyAt !== null && front.t - readyAt >= 2) break;
    }
    const shotName = o.mode === 'background' ? `hidden-${o.hidden}s-${o.device}.png` : `${o.mode}-${o.hidden}s-${o.device}.png`;
    writeFileSync(join(out, shotName), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

    if (o.mode === 'hold') {
      const all = report.samples.filter((s) => !s.error);
      c.held = all.some(bad) ? fail(`the startup failed or retried (${JSON.stringify(all.find(bad)?.records?.filter((r) => r.kind !== 'stage'))})`)
        : report.navigations > 1 ? fail(`the page reloaded (${report.navigations} navigations)`)
          : front?.retry ? fail(`the automatic retry was spent (kiln.startup.retry=${front.retry})`)
            : 'ok';
    }
    c.ready = !front ? fail('no sample after coming forward')
      : front.recovery ? fail(`recovery screen in front: "${front.recovery}"`)
        : readyAt === null ? fail(`not ready ${o.front} s after coming forward (stage ${front.stage})`)
          : !(front.frames > framesAtReady) ? fail('frames stopped after ready')
            : 'ok';
    report.readyAfterFrontSeconds = readyAt === null ? null : +(readyAt - (from - t0) / 1000).toFixed(1);
    report.preparation = front?.prep ?? null;
    c.errors = report.errors.length ? fail(report.errors.slice(0, 5).join(' | ')) : 'ok';
  } finally {
    if (chrome) await chrome.close();
    if (server) await server.close();
  }
  const failed = Object.entries(report.checks).filter(([, v]) => v !== 'ok');
  for (const [k, v] of Object.entries(report.checks)) console.log(`${v === 'ok' ? 'PASS' : 'FAIL'} ${k}${v === 'ok' ? '' : `: ${v}`}`);
  if (report.readyAfterFrontSeconds !== null) console.log(`ready ${report.readyAfterFrontSeconds} s after coming forward`);
  if (o.json) writeFileSync(o.json, JSON.stringify(report, null, 2));
  const label = o.mode === 'background' ? 'HIDDEN START' : o.mode === 'freeze' ? 'FROZEN START' : 'HELD START';
  console.log(`${label} ${failed.length ? 'FAIL' : 'PASS'} (${o.device}, ${o.hidden} s)`);
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code), (err) => { console.error(err.stack || err.message); process.exit(1); });
