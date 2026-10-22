#!/usr/bin/env node
// Kiln QA (G): memory walk (E's request 2026-10-22: peak memory across title, PLAY, level 10 and
// level 11, where the music changes tracks). Node 22, no npm packages.
//
// One page life in headless Chrome with a phone's size: the title (audio unlocked by a tap), then
// each level started through window.__kiln.startLevel with the robot playing. Every 500 ms it
// samples the page's renderer and the GPU process resident memory (ps), the JS heap and
// window.__kiln.audio.state (track, music files held decoded, decodedBytes when E exposes it).
// Prints the peak per step and overall. Safari's own number on an iPhone stays a phase 3 device
// check; `tools/qa/ios-sim.sh mem` reads the simulator's WebKit process the same way.
//
//   node tools/qa/memory.mjs                            title, 1, 10, 11; 15 s each; iPhone 14 Pro
//   node tools/qa/memory.mjs --walk title,1,10,11,21 --dwell 20 --device pixel7
//   node tools/qa/memory.mjs --budget-mb 600            exit 1 if the renderer peak passes 600 MB
//   node tools/qa/memory.mjs --no-audio                 no unlocking tap: no music decoded (the difference
//                                                       between the two runs is the music's share)
//   node tools/qa/memory.mjs --url http://localhost:8790/ --json out.json
//
// Every page URL carries mute=1 (silent, the music still decodes and plays at gain 0).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, serveStatic } from './lib/cdp.mjs';
import { getDevice, emulateDevice } from './lib/devices.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1048576;
const r1 = (v) => Math.round(v * 10) / 10;

function parseArgs(argv) {
  const o = { walk: ['title', '1', '10', '11'], dwell: 15, device: 'iphone14pro', url: '', root: resolve(HERE, '..', '..'), json: '', budgetMb: 0, headed: false, audio: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--walk') o.walk = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--dwell') o.dwell = Number(v());
    else if (a === '--device') o.device = v();
    else if (a === '--url') o.url = v();
    else if (a === '--root') o.root = resolve(v());
    else if (a === '--json') o.json = v();
    else if (a === '--budget-mb') o.budgetMb = Number(v());
    else if (a === '--headed') o.headed = true;
    else if (a === '--no-audio') o.audio = false;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown option ${a} (try --help)`);
  }
  for (const s of o.walk) if (s !== 'title' && !(Number(s) >= 1)) throw new Error(`--walk step "${s}" is not "title" or a level number`);
  getDevice(o.device);
  return o;
}

/**
 * Physical footprint in bytes of each pid: macOS `footprint` (dirty + compressed memory, the
 * figure iOS uses to stop a tab) when it works, else resident memory from ps (counts shared pages).
 */
let useFootprint = process.platform === 'darwin';
function memoryOf(pids) {
  if (useFootprint && pids.length) {
    try {
      const args = ['-f', 'bytes'];
      for (const p of pids) args.push('--pid', String(p));
      const text = execFileSync('footprint', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 });
      const out = {};
      for (const m of text.matchAll(/\[(\d+)\]:.*?Footprint:\s*(\d+)\s*B/g)) out[Number(m[1])] = Number(m[2]);
      if (Object.keys(out).length) return { kind: 'footprint', bytes: out };
    } catch { /* fall back to ps */ }
    useFootprint = false;
  }
  return { kind: 'rss', bytes: rss(pids) };
}

/** Resident memory in bytes of each pid (ps; 0 for a pid that is gone). */
function rss(pids) {
  const out = {};
  if (!pids.length) return out;
  let text = '';
  try {
    text = execFileSync('ps', ['-o', 'pid=,rss=', '-p', pids.join(',')], { encoding: 'utf8' });
  } catch (err) {
    text = String(err.stdout || '');
  }
  for (const line of text.split('\n')) {
    const [pid, kb] = line.trim().split(/\s+/).map(Number);
    if (pid) out[pid] = (kb || 0) * 1024;
  }
  return out;
}

const AUDIO = `(() => {
  const a = window.__kiln && window.__kiln.audio && window.__kiln.audio.state;
  if (!a) return null;
  return { context: a.context, unlocked: a.unlocked, track: a.track, decoded: a.decoded, decodedBytes: a.decodedBytes ?? null };
})()`;

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  if (o.help) {
    console.log('see the header of tools/qa/memory.mjs');
    return 0;
  }
  const device = getDevice(o.device);
  const server = o.url ? null : await serveStatic(o.root);
  const base = o.url || server.url.replace('127.0.0.1', 'localhost');
  const chrome = await launchChrome({ headless: !o.headed, width: device.width, height: device.height });
  const errors = [];
  const steps = [];
  let baseline = null;
  let failed = false;
  try {
    const page = await chrome.newPage();
    await page.send('Runtime.enable');
    page.on('Runtime.exceptionThrown', (e) => errors.push(`exception: ${e.exceptionDetails.exception?.description || e.exceptionDetails.text}`));
    await emulateDevice(page, device);
    const procInfo = async () => {
      const { processInfo } = await chrome.conn.send('SystemInfo.getProcessInfo');
      return {
        renderers: processInfo.filter((p) => p.type === 'renderer').map((p) => p.id),
        gpu: processInfo.filter((p) => p.type === 'GPU').map((p) => p.id),
      };
    };
    // what Chrome itself costs on an empty page, so the game's share can be read off
    const p0 = await procInfo();
    const m0 = memoryOf([...p0.renderers, ...p0.gpu]).bytes;
    baseline = {
      rendererMB: r1(Math.max(0, ...p0.renderers.map((id) => m0[id] || 0)) / MB),
      gpuMB: r1(p0.gpu.reduce((t, id) => t + (m0[id] || 0), 0) / MB),
    };
    // bot=1: the robot plays and picks; it boots straight into level 1, so the title comes from showTitle()
    const u = new URL(base);
    u.searchParams.set('bot', '1');
    u.searchParams.set('mute', '1');
    await page.navigate(u.href);
    await page.waitFor('window.__kiln && window.__kiln.ui && window.__kiln.audio', { timeoutMs: 30000 });
    // a real tap (CDP input counts as a user gesture) unlocks the audio as a player's first tap does
    for (const type of o.audio ? ['touchStart', 'touchEnd'] : []) {
      await page.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 4, y: 4 }] });
    }
    console.log(`Kiln memory walk: ${o.walk.join(' > ')}, ${o.dwell} s each, ${device.name} ${device.width}x${device.height}, ${chrome.version} headless`);
    console.log(`empty page first: renderer ${baseline.rendererMB} MB, GPU ${baseline.gpuMB} MB\n`);
    let kind = '';
    for (const step of o.walk) {
      const call = step === 'title' ? 'window.__kiln.showTitle()' : `window.__kiln.startLevel(${Number(step)})`;
      await page.eval(`(() => { ${call}; return true; })()`);
      const s = { step, track: null, decoded: 0, decodedBytes: null, rendererMB: 0, gpuMB: 0, heapMB: 0, level: null, context: null };
      const until = Date.now() + o.dwell * 1000;
      while (Date.now() < until) {
        await sleep(500);
        const p = await procInfo();
        const mem = memoryOf([...p.renderers, ...p.gpu]);
        kind = mem.kind;
        const m = mem.bytes;
        const rMax = Math.max(0, ...p.renderers.map((id) => m[id] || 0));
        const gSum = p.gpu.reduce((t, id) => t + (m[id] || 0), 0);
        const h = await page.send('Runtime.getHeapUsage');
        const a = await page.eval(AUDIO);
        s.rendererMB = Math.max(s.rendererMB, r1(rMax / MB));
        s.rendererEndMB = r1(rMax / MB); // the last sample: a peak far above it was transient
        s.gpuMB = Math.max(s.gpuMB, r1(gSum / MB));
        s.heapMB = Math.max(s.heapMB, r1(h.usedSize / MB));
        if (a) {
          s.track = a.track || s.track;
          s.context = a.context;
          s.decoded = Math.max(s.decoded, a.decoded || 0);
          if (a.decodedBytes != null) s.decodedBytes = Math.max(s.decodedBytes || 0, a.decodedBytes);
        }
      }
      s.level = await page.eval('window.__kiln.world && window.__kiln.world.level ? window.__kiln.world.level.n : null').catch(() => null);
      steps.push(s);
      const dec = s.decodedBytes != null ? `, decoded ${r1(s.decodedBytes / MB)} MB` : '';
      console.log(`${step.padEnd(6)} track ${String(s.track).padEnd(12)} files held decoded ${s.decoded}${dec} | renderer peak ${s.rendererMB} MB (end ${s.rendererEndMB}), GPU ${s.gpuMB} MB, JS heap ${s.heapMB} MB (audio ${s.context})`);
    }
    const peak = steps.reduce((m, s) => (s.rendererMB > m.rendererMB ? s : m), steps[0]);
    console.log(`\npeak renderer ${peak.rendererMB} MB at "${peak.step}" (GPU process peak ${Math.max(...steps.map((s) => s.gpuMB))} MB; ${kind === 'footprint' ? 'physical footprint, macOS footprint' : 'resident memory, ps (counts shared pages)'})`);
    if (steps.every((s) => s.decodedBytes == null)) console.log('decoded music bytes: not exposed by window.__kiln.audio.state (decodedBytes); the renderer figure includes them');
    if (steps.some((s) => s.context !== 'running')) console.log('note: the AudioContext was not running for some steps, so their music was not decoded');
    if (errors.length) {
      console.log(`page errors (${errors.length}):\n  ${[...new Set(errors)].slice(0, 8).join('\n  ')}`);
      failed = true;
    }
    if (o.budgetMb && peak.rendererMB > o.budgetMb) {
      console.log(`FAIL: renderer peak ${peak.rendererMB} MB is over the ${o.budgetMb} MB budget`);
      failed = true;
    }
  } catch (err) {
    console.error(`\nERROR: ${err.message}`);
    failed = true;
  } finally {
    await chrome.close();
    if (server) await server.close();
  }
  if (o.json) writeFileSync(o.json, JSON.stringify({ device: o.device, walk: o.walk, dwell: o.dwell, audio: o.audio, baseline, steps, errors }, null, 2));
  console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
  return failed ? 1 : 0;
}

process.exitCode = await main();
