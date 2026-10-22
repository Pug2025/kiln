#!/usr/bin/env node
// Kiln QA (G): automated device checks (brief G task 3, the part a script can judge).
// For each device size it loads the game in headless Chrome with the robot playing and checks:
//   boots     window.__kiln.world exists and steps
//   errors    no exception, console.error, failed request or 4xx/5xx response
//   bot       the robot plays (sim steps advance, the ball leaves the paddle)
//   noscroll  the page cannot scroll in either direction (100dvh layout, no overflow)
//   stage     the game stage fills the viewport and the play field sits inside it
//   hud       every visible HUD text is at least 11 px and inside the viewport, and (through D's
//             __kiln.hudCheck) no HUD button sits over HUD text
//   nozoom    viewport meta forbids zoom and the stage has touch-action: none
//   targets   (touch sizes) every button, link, map tab, slider and toggle that can be hit is at
//             least 44x44 px (--min-target N), on the play view and on every screen opened with
//             --screens; a link inside a line of text is exempt (WCAG 2.5.8 inline exception)
// and saves a screenshot per device (plus one per glass screen with --screens).
// The input checklist (two-finger action, Pull, keyboard-only, tab switch, one-handed modes) is
// tools/qa/inputcheck.mjs; installable, offline and updates are tools/qa/pwacheck.mjs.
//
//   node tools/qa/devicecheck.mjs                       all five sizes, level 1
//   node tools/qa/devicecheck.mjs --devices pixel7,desktop --level 17 --screens
//   node tools/qa/devicecheck.mjs --reduce              prefers-reduced-motion/transparency + the game settings
//   node tools/qa/devicecheck.mjs --url http://localhost:8790/ --out /tmp/shots --json report.json
//
// Exit 1 if any check fails on any device. Screenshots go to tools/qa/out/devicecheck/ (ignored by git).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, serveStatic } from './lib/cdp.mjs';
import { getDevice, emulateDevice, CHECK_ORDER } from './lib/devices.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Every glass screen, opened through window.__kiln (D's openers; results, pick and gate show sample
// data). `call` is the opener expression (default show<Name>()), `expect` the ui.current names
// that count as shown: the gate's two doors are drawn by the pick screen.
const SCREENS = [
  { name: 'pause', call: "pause('qa')" },
  { name: 'title' }, { name: 'map' }, { name: 'forge' }, { name: 'settings' }, { name: 'credits' },
  { name: 'results', call: 'showResults()' },
  { name: 'results-over', call: "showResults('over')", expect: ['results'] },
  { name: 'pick', call: 'showPick()' },
  { name: 'pick-overload', call: "showPick('overload')", expect: ['pick'] },
  { name: 'gate', call: 'showGate(14)', expect: ['gate', 'pick'] },
];
const MIN_FONT_PX = 11;

function parseArgs(argv) {
  const o = {
    devices: CHECK_ORDER, level: 1, seed: 1, url: '', root: resolve(HERE, '..', '..'), out: '', json: '',
    screens: false, reduce: false, playSeconds: 4, headed: false, params: '', minTarget: 44,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--devices') o.devices = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--level') o.level = Number(v());
    else if (a === '--seed') o.seed = Number(v());
    else if (a === '--url') o.url = v();
    else if (a === '--root') o.root = resolve(v());
    else if (a === '--out') o.out = resolve(v());
    else if (a === '--json') o.json = v();
    else if (a === '--screens') o.screens = true;
    else if (a === '--reduce') o.reduce = true;
    else if (a === '--play-seconds') o.playSeconds = Number(v());
    else if (a === '--params') o.params = v();
    else if (a === '--min-target') o.minTarget = Number(v());
    else if (a === '--headed') o.headed = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown option ${a} (try --help)`);
  }
  if (!o.out) o.out = join(o.root, 'tools', 'qa', 'out', 'devicecheck');
  for (const d of o.devices) getDevice(d); // validates names
  return o;
}

const BOOTED = 'window.__kiln && window.__kiln.world && window.__kiln.world.step > 0';

/** Everything the page can tell us about its own layout, in one evaluation. */
const LAYOUT_PROBE = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const de = document.documentElement, body = document.body;
  const stage = document.getElementById('stage');
  const canvas = stage && stage.querySelector('canvas');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const k = window.__kiln;
  let field = null;
  try { const fr = { x: 0, y: 0, w: 0, h: 0, scale: 1 }; k.renderer.fieldRect(fr); field = [Math.round(fr.x), Math.round(fr.y), Math.round(fr.w), Math.round(fr.h)]; } catch (e) {}
  const texts = [];
  const ui = document.getElementById('ui');
  if (ui) {
    const walker = document.createTreeWalker(ui, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.trim();
      if (!t) continue;
      const el = n.parentElement;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      let hidden = false;
      for (let p = el; p && p !== ui; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.display === 'none' || ps.visibility === 'hidden' || +ps.opacity === 0 || p.hidden) { hidden = true; break; }
      }
      if (hidden) continue;
      texts.push({ text: t.slice(0, 40), px: parseFloat(cs.fontSize), box: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] });
    }
  }
  const meta = document.querySelector('meta[name=viewport]');
  return {
    viewport: [vw, vh],
    scroll: [Math.max(de.scrollWidth, body ? body.scrollWidth : 0), Math.max(de.scrollHeight, body ? body.scrollHeight : 0)],
    canScroll: (() => { const x = scrollX, y = scrollY; scrollTo(50, 50); const moved = scrollX !== 0 || scrollY !== 0; scrollTo(x, y); return moved; })(),
    stage: r(stage), canvas: r(canvas), field,
    touchAction: stage ? getComputedStyle(stage).touchAction : '',
    viewportMeta: meta ? meta.content : '',
    texts,
    screen: k.ui && 'current' in k.ui ? k.ui.current : null,
  };
})()`;

const MIN_TARGET_PX = 44; // LEAD 19:05 (mute button) and D's coarse rule: every button and map tab

/**
 * Touch targets that can be hit right now (the element at the centre of its box is it or inside
 * it) and are smaller than `min` px either way. Buttons, links, map tabs, sliders, toggles.
 */
const targetsProbe = (min) => `(() => {
  const MIN = ${Number(min) || MIN_TARGET_PX};
  const vw = innerWidth, vh = innerHeight;
  const sel = 'button, a[href], [role=button], [role=tab], [role=switch], .btn, .tab, input:not([type=hidden]), select';
  const coarse = matchMedia('(pointer: coarse)').matches;
  const seen = new Set();
  const small = [];
  let count = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (seen.has(el)) continue;
    seen.add(el);
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || (hit !== el && !el.contains(hit))) continue; // covered, faded out or inert: not a target now
    count++;
    // WCAG 2.5.8's inline exception: a link inside a line of text (the credit lines' links) is
    // sized by that text's line height
    const p = el.parentElement;
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && p &&
        p.textContent.trim().length > el.textContent.trim().length) continue;
    if (b.width + 0.5 < MIN || b.height + 0.5 < MIN) {
      const label = (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 30);
      small.push(label + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
    }
  }
  return { coarse, count, small, min: MIN };
})()`;

function judgeTargets(T, where) {
  if (!T) return '';
  if (!T.coarse) return `(${where}) the page does not see a coarse pointer, so its 44 px rule is off`;
  if (!T.count) return `(${where}) no touch target found (the probe saw nothing to judge)`;
  return T.small.length ? `(${where}) under ${T.min} px: ${T.small.join(', ')}` : '';
}

function judgeLayout(L) {
  const checks = {};
  const [vw, vh] = L.viewport;
  checks.noscroll = !L.canScroll && L.scroll[0] <= vw + 1 && L.scroll[1] <= vh + 1
    ? 'ok' : `page scrolls (content ${L.scroll[0]}x${L.scroll[1]} in ${vw}x${vh})`;
  const s = L.stage;
  checks.stage = !s ? 'no #stage' : Math.abs(s[2] - vw) > 1 || Math.abs(s[3] - vh) > 1 || s[0] !== 0 || s[1] !== 0
    ? `#stage is ${s.join(',')} in a ${vw}x${vh} viewport` : !L.canvas ? 'no canvas' : !L.field ? 'renderer.fieldRect unavailable'
      : L.field[0] < -1 || L.field[1] < -1 || L.field[0] + L.field[2] > vw + 1 || L.field[1] + L.field[3] > vh + 1
        ? `play field ${L.field.join(',')} spills out of ${vw}x${vh}` : 'ok';
  const small = L.texts.filter((t) => t.px < MIN_FONT_PX);
  const outside = L.texts.filter((t) => t.box[0] < -1 || t.box[1] < -1 || t.box[2] > vw + 1 || t.box[3] > vh + 1);
  checks.hud = !L.texts.length ? 'no visible HUD text'
    : small.length ? `text under ${MIN_FONT_PX}px: ${small.map((t) => `"${t.text}" ${t.px}px`).join(', ')}`
      : outside.length ? `text outside the viewport: ${outside.map((t) => `"${t.text}"`).join(', ')}` : 'ok';
  const noZoom = /user-scalable\s*=\s*no/.test(L.viewportMeta) || /maximum-scale\s*=\s*1(\.0)?\b/.test(L.viewportMeta);
  checks.nozoom = noZoom && L.touchAction === 'none' ? 'ok' : `viewport "${L.viewportMeta}", #stage touch-action ${L.touchAction || 'unset'}`;
  return checks;
}

async function checkDevice(o, base, id, log) {
  const device = getDevice(id);
  const chrome = await launchChrome({ headless: !o.headed, width: device.width, height: device.height });
  const errors = [];
  const network = [];
  const shots = [];
  const checks = {};
  const tag = `${id}${o.reduce ? '-reduce' : ''}`;
  try {
    const page = await chrome.newPage();
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    await page.send('Network.enable');
    page.on('Runtime.exceptionThrown', (e) => errors.push(`exception: ${e.exceptionDetails.exception?.description?.split('\n')[0] || e.exceptionDetails.text}`));
    page.on('Runtime.consoleAPICalled', (e) => {
      if (e.type === 'error') errors.push(`console.error: ${e.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
    });
    page.on('Network.responseReceived', (e) => {
      if (e.response.status >= 400) network.push(`${e.response.status} ${e.response.url}`);
    });
    page.on('Network.loadingFailed', (e) => {
      if (!e.canceled) network.push(`failed (${e.errorText}) request ${e.requestId}`);
    });
    await emulateDevice(page, device);
    if (o.reduce) {
      await page.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-reduced-transparency', value: 'reduce' }],
      });
    }
    const u = new URL(base);
    u.searchParams.set('level', String(o.level));
    u.searchParams.set('seed', String(o.seed));
    u.searchParams.set('bot', '1');
    u.searchParams.set('mute', '1'); // never sound on the owner's speakers (LEAD 19:25); Chrome also runs --mute-audio
    for (const [k, v] of new URLSearchParams(o.params)) u.searchParams.set(k, v);
    await page.navigate(u.href);
    try {
      await page.waitFor(BOOTED, { timeoutMs: 30000 });
      checks.boots = 'ok';
    } catch {
      checks.boots = 'the game did not start within 30 s';
    }
    if (checks.boots === 'ok' && o.reduce) {
      const set = await page.eval(`(() => { const s = window.__kiln.save; if (!s) return false; const d = s.load(); d.settings.reduceMotion = true; d.settings.reduceTransparency = true; s.write(d); return true; })()`);
      if (set) {
        await page.navigate(u.href);
        await page.waitFor(BOOTED, { timeoutMs: 30000 }).catch(() => { checks.boots = 'the game did not restart with reduce settings'; });
      }
    }
    if (checks.boots === 'ok') {
      const before = await page.eval('({ step: window.__kiln.world.step, head: window.__kiln.world.bus.head })');
      let launched = false;
      const until = Date.now() + o.playSeconds * 1000;
      while (Date.now() < until) {
        await sleep(250);
        launched = launched || (await page.eval(`window.__kiln.world.phase !== 'serve'`));
      }
      const after = await page.eval('({ step: window.__kiln.world.step, head: window.__kiln.world.bus.head, phase: window.__kiln.world.phase, hits: window.__kiln.world.stats.paddleHits, broken: window.__kiln.world.stats.bricksBroken })');
      const steps = after.step - before.step;
      const expected = o.playSeconds * 120 * 0.5;
      checks.bot = steps >= expected && launched
        ? 'ok' : `the robot did not play (${steps} steps in ${o.playSeconds} s, launched ${launched}, phase ${after.phase})`;
      const L = await page.eval(LAYOUT_PROBE);
      Object.assign(checks, judgeLayout(L));
      const file = join(o.out, `${tag}.png`);
      writeFileSync(file, await page.screenshot());
      shots.push(file);
      // D's hudCheck (when present): no HUD button (pause, mute) may sit over HUD text
      const hc = await page.eval(`typeof window.__kiln.hudCheck === 'function' ? window.__kiln.hudCheck() : null`).catch(() => null);
      if (hc && Array.isArray(hc.overlaps) && hc.overlaps.length && checks.hud === 'ok') {
        checks.hud = `HUD button over HUD text (${hc.mode} mode): ${hc.overlaps.join(', ')}`;
      }
      // touch devices: every target on the play view (and on each screen below) is 44 px or more
      const targetProblems = [];
      if (device.touch) {
        const t = judgeTargets(await page.eval(targetsProbe(o.minTarget)), 'play');
        if (t) targetProblems.push(t);
      }
      if (o.screens) {
        // Each screen is opened the way the game opens it (window.__kiln.pause / show<Name>, which
        // pass the real data). A screen with no opener on __kiln is listed as skipped, not failed.
        // Some screens mount in the next task (results waits a tick after the clear frame), so the
        // opener's result is polled for up to a second.
        const screens = {};
        const skipped = [];
        for (const scr of SCREENS) {
          const name = scr.name;
          const expect = scr.expect || [name];
          const fnName = (scr.call || `show${name[0].toUpperCase()}${name.slice(1)}()`).replace(/\(.*$/, '');
          let shown = await page.eval(`(() => {
            const k = window.__kiln;
            if (typeof k[${JSON.stringify(fnName)}] !== 'function') return 'no opener';
            try { k.${scr.call || `${fnName}()`}; } catch (e) { return 'threw: ' + e.message; }
            return k.ui.current === undefined ? 'shown' : (k.ui.current || 'nothing mounted');
          })()`);
          if (shown === 'no opener') {
            skipped.push(name);
            continue;
          }
          for (let t = 0; t < 20 && shown === 'nothing mounted'; t++) {
            await sleep(50);
            shown = await page.eval(`window.__kiln.ui.current || 'nothing mounted'`);
          }
          if (!expect.includes(shown) && shown !== 'shown') {
            screens[name] = shown === 'nothing mounted' ? 'nothing mounted after 1 s' : `${shown} shown instead`;
            continue;
          }
          await sleep(400); // panel enter animation (180 ms) plus a frame or two
          const shot = join(o.out, `${tag}-${name}.png`);
          writeFileSync(shot, await page.screenshot());
          shots.push(shot);
          const lay = judgeLayout(await page.eval(LAYOUT_PROBE));
          screens[name] = lay.noscroll === 'ok' ? 'ok' : lay.noscroll;
          if (device.touch) {
            const t = judgeTargets(await page.eval(targetsProbe(o.minTarget)), name);
            if (t) targetProblems.push(t);
          }
        }
        checks.screens = Object.entries(screens).filter(([, v]) => v !== 'ok').map(([k, v]) => `${k}: ${v}`).join('; ') || 'ok';
        checks.screensDetail = { ...screens, skipped };
        log(`  screens shown: ${Object.keys(screens).join(', ') || 'none'}${skipped.length ? `; no opener on window.__kiln for: ${skipped.join(', ')}` : ''}`);
      }
      if (device.touch) checks.targets = targetProblems.join('; ') || 'ok';
    }
  } finally {
    await chrome.close();
  }
  const uniqErrors = [...new Set(errors)];
  const uniqNet = [...new Set(network)];
  checks.errors = uniqErrors.length || uniqNet.length ? [...uniqErrors, ...uniqNet].slice(0, 8).join(' | ') : 'ok';
  const failing = Object.entries(checks).filter(([k, v]) => k !== 'screensDetail' && v !== 'ok');
  log(`${device.name} ${device.width}x${device.height}${o.reduce ? ' (reduce motion + transparency)' : ''}: ${failing.length ? 'FAIL' : 'PASS'}`);
  for (const [k, v] of Object.entries(checks)) if (k !== 'screensDetail') log(`  ${v === 'ok' ? 'ok  ' : 'FAIL'} ${k}${v === 'ok' ? '' : `: ${v}`}`);
  log(`  screenshots: ${shots.map((s) => relative(process.cwd(), s)).join(', ')}`);
  return { device: id, name: device.name, size: [device.width, device.height], pass: !failing.length, checks, errors: uniqErrors, network: uniqNet, shots };
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  if (o.help) {
    console.log('see the header of tools/qa/devicecheck.mjs');
    return 0;
  }
  mkdirSync(o.out, { recursive: true });
  const server = o.url ? null : await serveStatic(o.root);
  const base = o.url || server.url.replace('127.0.0.1', 'localhost');
  console.log(`Kiln device check: level ${o.level}, ${o.devices.length} devices, ${base}`);
  const results = [];
  try {
    for (const id of o.devices) {
      try {
        results.push(await checkDevice(o, base, id, (s) => console.log(s)));
      } catch (err) {
        console.log(`${id}: ERROR ${err.message}`);
        results.push({ device: id, pass: false, checks: { run: err.message } });
      }
    }
  } finally {
    if (server) await server.close();
  }
  const failed = results.filter((r) => !r.pass);
  if (o.json) writeFileSync(o.json, JSON.stringify({ when: new Date().toISOString(), level: o.level, reduce: o.reduce, results }, null, 2));
  console.log(`\nRESULT: ${failed.length ? `FAIL (${failed.map((r) => r.device).join(', ')})` : 'PASS'} on ${results.length} device(s)`);
  return failed.length ? 1 : 0;
}

process.exit(await main());
