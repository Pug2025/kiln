#!/usr/bin/env node
// Kiln QA (G): frame-time test (PLAN §10, brief G task 5). Node 22, no npm packages.
//
// Starts Google Chrome headless with a throwaway profile, emulates a phone, throttles the CPU 4x
// over the DevTools protocol, plays a level with the robot (?bot=1) and records every frame's
// main-thread work (sim steps + render + HUD + audio inside requestAnimationFrame) for 60 s.
// After warm-up (first 30 frames) and level loads it fails when a frame COSTS more than 16 ms
// (its rAF work plus Chrome's long tasks outside rAF in its interval: style, layout, GC, a
// promise callback) or when any frame is DROPPED against the 60 fps target (an interval over
// 25 ms at 60 Hz; see tools/qa/lib/probe.mjs). Runs twice by default: lite off, then lite on.
//
//   node tools/qa/framegate.mjs                                  the standard release gate: this test on
//                                                                levels 20, 24 and 30 (item 21 added 30)
//   node tools/qa/frametime.mjs --level 28 --throttle 4          heaviest level, both lite modes
//   node tools/qa/frametime.mjs --fixture stress                 300 bricks, 3 balls, 100 embers, Blackout
//   node tools/qa/frametime.mjs --level 1 --seconds 10 --lite off --device desktop
//   node tools/qa/frametime.mjs --url http://localhost:8790/ --level 28   use a running server
//   node tools/qa/frametime.mjs --serve-only --fixture stress    serve with the fixture, print the URL
//   node tools/qa/frametime.mjs --print-probe                    probe JS for a built-in browser pass
//
// Options: --seconds 60 --warmup 30 --budget 16 --lite off|on|both --device pixel7|iphone14pro|
// mobile|desktop|desktop1440 --seed 1 --params "debug=1" --root <checkout> --headed --json out.json
// Every page URL carries mute=1 and autolite=0 (the renderer never switches itself to lite during a
// lite-off pass; --params autolite=1 turns that back on). A pass whose renderer ends in the other
// lite mode fails.
// --idle-drops warn  drops while the main thread was idle (no long task, rAF work in budget: the
//                    GPU, the compositor or another process on this shared Mac) are warnings, up
//                    to 1% of the frames; more still fails. Default: every drop fails. (--strict
//                    is still accepted: it is the default now.)
// --toggle-lite-at S switches Lite at S seconds into each pass the way auto-lite and the Settings
//                    switch do (renderer.setQuality during live play), so a stall from shaders
//                    compiled on first use after the switch is measured. The pass then must end in
//                    the other lite mode.
// --alloc-kb 32      after each pass, the JS bytes renderer.frame allocates per frame (C's request:
//                    rAF held, 60 frames drawn by hand under V8's sampling heap profiler, which
//                    counts allocations a GC already freed; bytes / 60, median of 9 trials, and
//                    the 3 functions that allocate most). Over the budget fails the pass
//                    (allocation creeping back means a GC sawtooth). --alloc-kb 0 skips it.
//
// Without --url it serves the checkout it lives in (so a worktree measures its own code). With
// --fixture it registers tests/fixtures/G/<name>.js as level 99 on that served copy only (the
// files on disk are never changed); with --url it relies on the page's ?fixture= hook instead.

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome, serveStatic } from './lib/cdp.mjs';
import { getDevice, emulateDevice } from './lib/devices.mjs';
import { probeSource, allocSummary } from './lib/probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const o = {
    level: 0, fixture: '', throttle: 4, seconds: 60, warmup: 30, budget: 16, lite: 'both', device: 'pixel7',
    seed: 1, params: '', url: '', root: resolve(HERE, '..', '..'), headed: false, json: '', serveOnly: false, printProbe: false,
    idleDrops: 'fail', toggleLiteAt: -1, allocKb: 32,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--level') o.level = Number(v());
    else if (a === '--fixture') o.fixture = v();
    else if (a === '--throttle') o.throttle = Number(v());
    else if (a === '--seconds') o.seconds = Number(v());
    else if (a === '--warmup') o.warmup = Number(v());
    else if (a === '--budget') o.budget = Number(v());
    else if (a === '--lite') o.lite = v();
    else if (a === '--device') o.device = v();
    else if (a === '--seed') o.seed = Number(v());
    else if (a === '--params') o.params = v();
    else if (a === '--url') o.url = v();
    else if (a === '--root') o.root = resolve(v());
    else if (a === '--headed') o.headed = true;
    else if (a === '--strict') o.idleDrops = 'fail';
    else if (a === '--idle-drops') o.idleDrops = v();
    else if (a === '--toggle-lite-at') o.toggleLiteAt = Number(v());
    else if (a === '--alloc-kb') o.allocKb = Number(v());
    else if (a === '--json') o.json = v();
    else if (a === '--serve-only') o.serveOnly = true;
    else if (a === '--print-probe') o.printProbe = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown option ${a} (try --help)`);
  }
  if (!o.level && !o.fixture) o.fixture = 'stress';
  if (o.fixture && !/^[a-z0-9-]+$/.test(o.fixture)) throw new Error(`bad fixture name "${o.fixture}"`);
  if (!['off', 'on', 'both'].includes(o.lite)) throw new Error('--lite is off, on or both');
  if (!['warn', 'fail'].includes(o.idleDrops)) throw new Error('--idle-drops is warn or fail');
  if (o.toggleLiteAt !== -1 && !(o.toggleLiteAt >= 0 && o.toggleLiteAt < o.seconds)) throw new Error('--toggle-lite-at needs a time in seconds inside the pass (0 to --seconds)');
  return o;
}

/** Serve the checkout; with a fixture, register it as a level on the served copy of the registry. */
async function serve(o) {
  let transform = null;
  if (o.fixture) {
    const shim = `
// --- added by tools/qa/frametime.mjs on the served copy only (QA fixture "${o.fixture}") ---
import { level as __qaFixture } from '../../tests/fixtures/G/${o.fixture}.js';
try { const __qaGet = getLevel; getLevel = (n) => (n === __qaFixture.n ? __qaFixture : __qaGet(n)); } catch (e) { /* not reassignable */ }
try { if (!LEVELS.some((l) => l.n === __qaFixture.n)) LEVELS.push(__qaFixture); } catch (e) { /* frozen */ }
`;
    transform = (urlPath, body) => (urlPath === '/src/levels/index.js' ? body.toString('utf8') + shim : null);
  }
  return serveStatic(o.root, { transform });
}

async function loadFixture(o) {
  const mod = await import(pathToFileURL(join(o.root, 'tests', 'fixtures', 'G', `${o.fixture}.js`)).href);
  return { level: mod.level, load: mod.load || null };
}

function pageUrl(base, o, levelN) {
  const u = new URL(base);
  u.searchParams.set('level', String(levelN));
  u.searchParams.set('seed', String(o.seed));
  u.searchParams.set('bot', '1');
  u.searchParams.set('mute', '1'); // never sound on the owner's speakers (LEAD 19:25); Chrome also runs --mute-audio
  // C's renderer switches itself to lite after 3 s of slow frames; a lite-off pass must stay lite off
  u.searchParams.set('autolite', '0');
  if (o.fixture && o.url) u.searchParams.set('fixture', o.fixture);
  for (const [k, v] of new URLSearchParams(o.params)) u.searchParams.set(k, v);
  return u.href;
}

const BOOTED = 'window.__kiln && window.__kiln.world && window.__kiln.world.step > 0';

/**
 * JS bytes renderer.frame allocates a frame (C's request): the game loop held (probe hold, one
 * in-flight frame let through), then per trial V8's sampling heap profiler runs while `frames`
 * frames are drawn by hand. It counts every allocation, also those a young-generation GC already
 * freed (a heap-size delta misses exactly that churn: 40 KB a frame read as 8 KB). Median of the
 * trials, plus the functions that allocate most; null when nothing drew.
 */
async function measureAlloc(page, trials, frames) {
  await page.eval(`(async () => { window.__kilnQA.hold = true; await new Promise((r) => setTimeout(r, 100)); return true; })()`);
  await page.send('HeapProfiler.enable');
  const totals = [];
  const where = new Map();
  try {
    for (let t = 0; t < trials; t++) {
      await page.send('HeapProfiler.collectGarbage');
      await page.send('HeapProfiler.startSampling', {
        samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true,
      });
      const drawn = await page.eval(`window.__kilnQA.drawFrames(${frames})`);
      const { profile } = await page.send('HeapProfiler.stopSampling');
      if (drawn !== frames) return null;
      let total = 0;
      const walk = (node) => {
        total += node.selfSize;
        if (node.selfSize) {
          const cf = node.callFrame;
          const key = `${cf.functionName || '(anonymous)'} ${String(cf.url).replace(/^.*\/(src|node_modules|npm)\//, '$1/')}:${cf.lineNumber + 1}`;
          where.set(key, (where.get(key) || 0) + node.selfSize);
        }
        for (const c of node.children || []) walk(c);
      };
      walk(profile.head);
      totals.push(total);
    }
  } finally {
    await page.eval('window.__kilnQA.release()');
  }
  const out = allocSummary(totals, frames);
  out.top = [...where].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => `${k} ${(v / trials / frames / 1024).toFixed(1)} KB`);
  return out;
}

/** One measured pass in a fresh Chrome. */
async function measure(o, url, levelN, lite, fixtureLoad, log) {
  const device = getDevice(o.device);
  const chrome = await launchChrome({ headless: !o.headed, width: device.width, height: device.height });
  const errors = [];
  try {
    const page = await chrome.newPage();
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    page.on('Runtime.exceptionThrown', (e) => errors.push(`exception: ${e.exceptionDetails.exception?.description || e.exceptionDetails.text}`));
    page.on('Runtime.consoleAPICalled', (e) => {
      if (e.type === 'error') errors.push(`console.error: ${e.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    });
    page.on('Log.entryAdded', (e) => {
      if (e.entry.level === 'error') errors.push(`${e.entry.source}: ${e.entry.text}${e.entry.url ? ` (${e.entry.url})` : ''}`);
    });
    await emulateDevice(page, device);
    await page.send('Page.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: probeSource({ target: levelN, warmup: o.warmup, fixture: fixtureLoad }),
    });
    // The game may boot into an attract world and pass pick screens (Mod, Overload) before the
    // asked level starts, so wait for that level, not just for any world.
    const onLevel = `${BOOTED} && window.__kiln.world.level.n === ${levelN}`;
    await page.navigate(url);
    await page.waitFor(BOOTED, { timeoutMs: 30000 }).catch((err) => {
      throw new Error(`the game did not start: ${err.message}\n${errors.join('\n')}`);
    });
    await page.waitFor(onLevel, { timeoutMs: 30000 }).catch(() => {});

    // Lite comes from the player's settings: write it through the game's own save, then reload.
    const want = lite === 'on';
    const have = await page.eval(`(() => { const s = window.__kiln.save; return s && s.load ? !!s.load().settings.lite : null; })()`);
    if (have === null) throw new Error('window.__kiln.save is missing: cannot set lite mode');
    if (have !== want) {
      // as the Settings switch writes it (D's playerSetsLite): lite without liteSet is undone at boot
      await page.eval(`(() => { const s = window.__kiln.save; const d = s.load(); d.settings.lite = ${want}; d.settings.liteSet = true; s.write(d); return true; })()`);
      await page.navigate(url);
      await page.waitFor(BOOTED, { timeoutMs: 30000 });
      await page.waitFor(onLevel, { timeoutMs: 30000 }).catch(() => {});
    }
    const env = await page.eval(`(() => {
      const c = document.querySelector('#stage canvas') || document.querySelector('canvas');
      let gl = '';
      try {
        const t = document.createElement('canvas').getContext('webgl2');
        const x = t && t.getExtension('WEBGL_debug_renderer_info');
        gl = x ? t.getParameter(x.UNMASKED_RENDERER_WEBGL) : '';
      } catch (e) {}
      const w = window.__kiln.world;
      return {
        lite: !!window.__kiln.save.load().settings.lite,
        dpr: devicePixelRatio,
        canvas: c ? [c.width, c.height, +(c.width / Math.max(1, c.clientWidth)).toFixed(2)] : null,
        viewport: [innerWidth, innerHeight],
        gl,
        level: w.level.n, levelId: w.level.def.id, mode: w.level.mode,
      };
    })()`);
    if (env.level !== levelN) {
      throw new Error(`the page is on level ${env.level}, not ${levelN}${o.fixture ? ' (the fixture was not registered: with --url the page needs the ?fixture= hook)' : ''}`);
    }
    if (env.lite !== want) throw new Error(`lite should be ${lite} but the save says ${env.lite}`);

    if (o.throttle > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: o.throttle });
    const heap = async () => {
      await page.send('HeapProfiler.collectGarbage');
      const h = await page.send('Runtime.getHeapUsage');
      return Math.round((h.usedSize / 1048576) * 10) / 10;
    };
    const heapStart = await heap();
    await page.eval('window.__kilnQA.start()');
    const t0 = Date.now();
    const until = t0 + o.seconds * 1000;
    const toggleAt = o.toggleLiteAt >= 0 ? t0 + o.toggleLiteAt * 1000 : Infinity;
    let toggle = null;
    let nextLog = t0 + 10000;
    while (Date.now() < until) {
      await sleep(Math.max(0, Math.min(until, nextLog, toggle ? Infinity : toggleAt) - Date.now()));
      if (!toggle && Date.now() >= toggleAt) {
        // what auto-lite and the Settings switch both end in: renderer.setQuality during live play
        toggle = await page.eval(`(() => {
          const r = window.__kiln.renderer;
          const to = !r.quality.lite;
          r.setQuality({ lite: to });
          return { lite: to, frame: window.__kilnQA.n, atS: ${o.toggleLiteAt} };
        })()`);
        log(`  ... ${o.toggleLiteAt} s: Lite switched ${toggle.lite ? 'on' : 'off'} in live play (renderer.setQuality) at frame #${toggle.frame}`);
      }
      if (Date.now() >= nextLog || Date.now() >= until) {
        nextLog += 10000;
        const n = await page.eval('window.__kilnQA.n');
        log(`  ... ${Math.round((Date.now() - t0) / 1000)} s, ${n} frames`);
      }
    }
    await page.eval('window.__kilnQA.stop()');
    // the renderer's own quality at the end: a lite-off pass that ended in lite measured the wrong thing
    const quality = await page.eval(`(() => {
      const r = window.__kiln.renderer;
      const q = r && r.quality;
      const s = r && r.stats;
      return { lite: q ? !!q.lite : null, autoLite: s ? !!s.autoLite : null };
    })()`);
    const heapEnd = await heap();
    if (o.throttle > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const report = await page.eval(`window.__kilnQA.report(${o.budget}, ${JSON.stringify({ idleDrops: o.idleDrops })})`);
    report.heapMB = { start: heapStart, end: heapEnd };
    if (o.allocKb > 0) {
      report.alloc = await measureAlloc(page, 9, 60);
      if (!report.alloc) {
        report.pass = false;
        report.fails.push('allocation check could not run (no renderer.frame or world)');
      } else if (report.alloc.bytesPerFrame > o.allocKb * 1024) {
        report.pass = false;
        report.fails.push(`renderer.frame allocates ${(report.alloc.bytesPerFrame / 1024).toFixed(1)} KB a frame, over ${o.allocKb} KB`);
      }
    }
    report.quality = quality;
    report.toggle = toggle;
    const endLite = toggle ? toggle.lite : want;
    if (quality.lite !== null && quality.lite !== endLite) {
      report.pass = false;
      const msg = `the renderer ended the pass with lite ${quality.lite ? 'on' : 'off'}${quality.autoLite ? ' (auto-lite tripped)' : ''}, not ${endLite ? 'on' : 'off'}`;
      report.fails.push(msg);
      errors.push(msg);
    }
    return { lite, env, report, errors, chrome: chrome.version };
  } finally {
    await chrome.close();
  }
}

function line(r) {
  const c = r.report.cost;
  const w = r.report.work;
  const iv = r.report.interval;
  const L = r.report.load;
  const load = L ? `${L.bricks} bricks, ${L.balls} balls, ${L.embers} embers${L.darkShare ? `, dark ${Math.round(L.darkShare * 100)}%` : ''}` : 'no load sample';
  const drops = iv.dropped ? `dropped ${iv.dropped} (${iv.idleDropped} idle, ${iv.busyDropped} busy)` : 'dropped 0';
  return `lite ${r.lite.padEnd(3)}: frame max ${c.max} ms, p99 ${c.p99}, p95 ${c.p95}, median ${c.p50} (rAF work max ${w.max}) | ` +
    `${r.report.counted}/${r.report.frames} frames counted, ${r.report.fps} fps, ${drops} (interval median ${iv.p50}, max ${iv.max}, drop over ${iv.dropLimit}) | ${load} | ${r.report.pass ? 'PASS' : 'FAIL'}`;
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (o.help) {
    console.log('see the header of tools/qa/frametime.mjs');
    return 0;
  }
  if (o.printProbe) {
    console.log(probeSource({ target: o.level || 0, warmup: o.warmup }));
    return 0;
  }

  const fixture = o.fixture ? await loadFixture(o) : null;
  const levelN = fixture ? fixture.level.n : o.level;
  const server = o.url ? null : await serve(o);
  const base = o.url || server.url.replace('127.0.0.1', 'localhost');

  if (o.serveOnly) {
    console.log(`Serving ${o.root}${fixture ? ` with fixture "${o.fixture}" as level ${levelN}` : ''}`);
    console.log(pageUrl(base, o, levelN));
    console.log('Ctrl-C to stop.');
    await new Promise(() => {});
  }

  const device = getDevice(o.device);
  const what = fixture ? `fixture "${o.fixture}" (level ${levelN}: ${fixture.level.rows.join('').replace(/\./g, '').length} bricks, keeps ${fixture.load ? `${fixture.load.balls} balls, ${fixture.load.embers} embers${fixture.load.dark ? ', Blackout' : ''}${typeof fixture.load.heat === 'number' ? `, HEAT held at ${fixture.load.heat}` : ''}` : 'nothing extra'})` : `level ${levelN}`;
  console.log(`Kiln frame-time test: ${what}`);
  console.log(`${device.name} ${device.width}x${device.height} @${device.dpr}, CPU ${o.throttle}x, ${o.seconds} s per pass, warm-up ${o.warmup} frames, budget ${o.budget} ms`);
  const modes = o.lite === 'both' ? ['off', 'on'] : [o.lite];
  const runs = [];
  let failed = false;
  try {
    for (const lite of modes) {
      const url = pageUrl(base, o, levelN);
      console.log(`\npass lite ${lite}: ${url}`);
      const r = await measure(o, url, levelN, lite, fixture ? fixture.load : null, (s) => console.log(s));
      runs.push(r);
      if (runs.length === 1) console.log(`${r.chrome}${o.headed ? '' : ' headless'}, GL: ${r.env.gl || 'unknown'}, canvas ${r.env.canvas ? r.env.canvas.join('x').replace(/x([\d.]+)$/, ' @$1') : 'none'}`);
      console.log(line(r));
      console.log(`  JS heap after GC: ${r.report.heapMB.start} MB at start, ${r.report.heapMB.end} MB at end`);
      const al = r.report.alloc;
      if (al) {
        console.log(`  allocation: ${(al.bytesPerFrame / 1024).toFixed(1)} KB a frame in renderer.frame (median of ${al.trials.length} x ${al.frames} frames, rAF held; budget ${o.allocKb} KB; trials ${al.trials.map((b) => (b / 1024).toFixed(1)).join(' ')})`);
        if (al.top && al.top.length) console.log(`    most from: ${al.top.join('; ')}`);
      }
      if (r.report.toggle) console.log(`  Lite switched ${r.report.toggle.lite ? 'on' : 'off'} at ${r.report.toggle.atS} s (frame #${r.report.toggle.frame}); frames after it count`);
      for (const f of r.report.fails || []) console.log(`  FAIL: ${f}`);
      for (const wn of r.report.warnings || []) console.log(`  warning: ${wn}`);
      if (r.report.worst.length) {
        const at = (f) => `#${f.frame} ${f.cost} ms${f.outsideMs ? ` (rAF ${f.work} + ${f.outsideMs} outside)` : ''} at ${f.atS} s (${f.phase}, ${f.remaining} bricks left${f.screen ? `, screen ${f.screen}` : ''})`;
        console.log(`  worst frames: ${r.report.worst.map(at).join('; ')}`);
      }
      if (r.report.gaps && r.report.gaps.length) {
        // who held the frame: main-thread long tasks outside rAF, or nothing on the main thread
        // (then it was the GPU, the compositor or another process on this machine)
        const who = (g) => (g.workBefore > o.budget ? `rAF work ${g.workBefore} ms before it${g.longTaskMs ? ` + ${g.longTaskMs} ms outside rAF` : ''}`
          : g.longTaskMs == null ? 'long tasks unknown'
            : g.idle ? 'main thread idle: GPU/compositor'
              : g.longTaskMs >= 0.5 * (g.gap - g.workBefore) ? `main thread busy ${g.longTaskMs} ms outside rAF`
                : `long tasks ${g.longTaskMs} ms, rest GPU/compositor`);
        const at = (g) => `${g.gap} ms after ${g.atS} s (${g.phase}, ${g.remaining} bricks left${g.screen ? `, screen ${g.screen}` : ''}; ${who(g)})`;
        console.log(`  longest gaps: ${r.report.gaps.map(at).join('; ')}`);
      }
      const lt = r.report.longTasks;
      if (lt && lt.count) console.log(`  long tasks (over 50 ms) while measuring: ${lt.count}, longest ${lt.maxMs} ms, total ${lt.totalMs} ms`);
      const ex = r.report.excluded;
      console.log(`  excluded: ${ex.warmupFrames} warm-up frames (max ${ex.warmupMaxWork} ms), ${ex.loadFrames} level loads (max ${ex.loadMaxWork} ms), level restarts ${r.report.restarts}`);
      if (r.report.sustain) console.log(`  fixture upkeep: ${JSON.stringify(r.report.sustain)}`);
      const g = r.report.game;
      const rw = g.rendererWorst;
      const worstR = rw ? ` (worst ${rw.ms} ms: update ${rw.updateMs}, draw ${rw.renderMs}${rw.programs != null ? `, ${rw.programs} programs` : ''})` : '';
      console.log(`  game: level ${g.level} ${g.levelId}, main.js maxFrameMs ${g.mainMaxFrameMs}, renderer.frame ${g.rendererFrameMs} ms${worstR}, draw calls ${g.drawCalls}, triangles ${g.triangles}`);
      if (r.errors.length) console.log(`  page errors (${r.errors.length}):\n    ${[...new Set(r.errors)].slice(0, 10).join('\n    ')}`);
      if (!r.report.pass) failed = true;
    }
  } catch (err) {
    console.error(`\nERROR: ${err.message}`);
    failed = true;
  } finally {
    if (server) await server.close();
  }
  const maxCost = Math.max(0, ...runs.map((r) => r.report.cost.max));
  const minFps = runs.length ? Math.min(...runs.map((r) => r.report.fps)) : 0;
  const drops = runs.reduce((s, r) => s + r.report.interval.dropped, 0);
  const allocs = runs.map((r) => r.report.alloc).filter(Boolean);
  const alloc = allocs.length ? `; allocation up to ${(Math.max(...allocs.map((a) => a.bytesPerFrame)) / 1024).toFixed(1)} KB a frame (budget ${o.allocKb})` : '';
  console.log(`\nRESULT: ${failed ? 'FAIL' : 'PASS'} (max frame ${maxCost} ms incl. long tasks, budget ${o.budget} ms; ` +
    `lowest ${minFps} fps; ${drops} dropped${o.idleDrops === 'warn' ? ' (idle drops warn)' : ''}${alloc}; ${runs.length} pass${runs.length === 1 ? '' : 'es'})`);
  if (o.json) {
    writeFileSync(o.json, JSON.stringify({ when: new Date().toISOString(), options: { ...o, root: undefined }, device, runs, pass: !failed }, null, 2));
  }
  return failed ? 1 : 0;
}

process.exit(await main());
