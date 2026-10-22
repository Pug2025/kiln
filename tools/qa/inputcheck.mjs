#!/usr/bin/env node
// Kiln QA (G): the PLAN §10 input checklist, driven with real input in headless Chrome (DevTools
// Input.dispatch*: browser hit testing, Pointer Events and the game's own listeners, exactly the
// path a finger, mouse or key takes). The game's InputFrame is read by wrapping
// window.__kiln.input.sample, and the world shows what the sim did with it.
//
// Touch sizes (iPhone 14 Pro, Pixel 7):
//   grab          a finger landing away from the paddle does not move it; dragging moves it by the
//                 finger's own field distance (relative grab, 1:1)
//   two-finger    while finger 1 steers, a finger-2 tap launches the ball, and finger 1 still steers
//   finger-pull   (level 7, Pull) a finger-2 hold Pulls while finger 1 steers; letting go of the
//                 hold fires no action (a hold is a pure Pull)
//   cancel-pause  a pointercancel (an iOS system gesture) pauses
//   one-handed    thumb pad on (through the save, as the setting does): the pad sits in the
//                 bottom-right corner, a pad tap launches, a pad hold Pulls, and thumb strokes inside
//                 the lower-right thumb zone take the paddle to both ends of its track (bottom 1,
//                 horizontal 17) or round every eighth of the ring (21); left-handed mirrors the pad
// Desktop (1280x800):
//   mouse         the paddle follows the mouse 1:1; a left click launches
//   right-pull    (level 7) holding the right button Pulls, opens no context menu, fires no action
//   left-hold     holding the left button past 180 ms Pulls
//   keyboard      title to play with Enter only; arrows steer (Shift faster); Space launches; Shift
//                 alone Pulls; P pauses, Enter resumes, Esc pauses, arrows + Enter reach the level
//                 map, Enter plays again; M toggles sound
// Both:
//   tab-switch    opening another tab pauses (hidden + blur), and coming back does not resume
//   errors        no exception or console.error while all of this ran
//
//   node tools/qa/inputcheck.mjs                        iPhone 14 Pro, Pixel 7, desktop
//   node tools/qa/inputcheck.mjs --devices desktop --json out.json
//
// Exit 1 if any check fails. URLs carry mute=1 (implied by level= too); Chrome runs --mute-audio.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, serveStatic } from './lib/cdp.mjs';
import { getDevice, emulateDevice } from './lib/devices.mjs';
import { keyEvent, key, mouseMove, mouseButton, click, touches, liftAll, forgetTouches, tap } from './lib/input.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const o = { devices: ['iphone14pro', 'pixel7', 'desktop'], root: resolve(HERE, '..', '..'), url: '', json: '', headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === '--devices') o.devices = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--root') o.root = resolve(v());
    else if (a === '--url') o.url = v();
    else if (a === '--json') o.json = v();
    else if (a === '--headed') o.headed = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown option ${a} (try --help)`);
  }
  for (const d of o.devices) getDevice(d);
  return o;
}

// In the page, once per load: field <-> screen through the renderer's own rest camera, the input
// frame counters (wrapping input.sample, which main.js calls as a method every sim step) and a
// contextmenu witness.
const HELPERS = `(() => {
  const k = window.__kiln;
  if (!k || !k.input || !k.renderer) return false;
  if (window.__qa) return true;
  const o = { x: 0, y: 0 };
  const qa = window.__qa = {
    toField(sx, sy) { return k.renderer.screenToField(sx, sy, o) ? [o.x, o.y] : null; },
    toScreen(fx, fy) {
      const fr = k.renderer.fieldRect({});
      let sx = fr.x + fx / 720 * fr.w, sy = fr.y + fy / 1080 * fr.h;
      for (let i = 0; i < 10; i++) {
        const a = qa.toField(sx, sy), bx = qa.toField(sx + 1, sy), by = qa.toField(sx, sy + 1);
        if (!a || !bx || !by) break;
        const ex = fx - a[0], ey = fy - a[1];
        if (Math.abs(ex) + Math.abs(ey) < 0.05) break;
        const j11 = bx[0] - a[0], j21 = bx[1] - a[1], j12 = by[0] - a[0], j22 = by[1] - a[1];
        const det = j11 * j22 - j12 * j21;
        if (Math.abs(det) < 1e-12) break;
        sx += (ex * j22 - ey * j12) / det;
        sy += (ey * j11 - ex * j21) / det;
      }
      return [sx, sy];
    },
    in: { n: 0, action: 0, pull: 0, steer: 0, axis: 0 },
    ctx: { menu: 0, prevented: 0 },
  };
  const inp = k.input, orig = inp.sample.bind(inp);
  inp.sample = (frame, world) => {
    orig(frame, world);
    const q = qa.in;
    q.n++;
    if (frame.action) q.action++;
    if (frame.pull) q.pull++;
    if (frame.steer) q.steer++;
    if (frame.axis) q.axis++;
  };
  window.addEventListener('contextmenu', (e) => { qa.ctx.menu++; if (e.defaultPrevented) qa.ctx.prevented++; });
  return true;
})()`;

const STATE = `(() => {
  const k = window.__kiln, w = k.world, p = w && w.paddle;
  return {
    mode: k.app.mode, paused: !!k.app.paused, ui: k.ui.current, phase: w ? w.phase : null,
    n: w ? w.level.def.n : 0, lmode: w ? w.level.mode : null, pull: !!(w && w.level.rules.pull),
    px: p ? p.x : 0, py: p ? p.y : 0, pa: p ? p.angle : 0, pw: p ? p.w : 0, pulling: !!(p && p.pulling),
    in: Object.assign({}, window.__qa ? window.__qa.in : {}), ctx: Object.assign({}, window.__qa ? window.__qa.ctx : {}),
    vis: document.visibilityState,
  };
})()`;

const r1 = (v) => Math.round(v * 10) / 10;

/** A check's verdict: '' passes; any text is the failure. */
function verdict(cond, why) {
  return cond ? '' : why;
}

async function page0(chrome, device) {
  const page = await chrome.newPage();
  const sink = { errors: [] };
  await page.send('Runtime.enable');
  page.on('Runtime.exceptionThrown', (e) => sink.errors.push(`exception: ${e.exceptionDetails.exception?.description?.split('\n')[0] || e.exceptionDetails.text}`));
  page.on('Runtime.consoleAPICalled', (e) => {
    if (e.type === 'error') sink.errors.push(`console.error: ${e.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
  });
  await emulateDevice(page, device);
  page.sink = sink;
  return page;
}

/** Open a level (or the title with level 0) with the player in control, helpers installed. */
async function open(page, base, level, extra = '') {
  await liftAll(page);
  const u = new URL(base);
  if (level) u.searchParams.set('level', String(level));
  u.searchParams.set('seed', '1');
  u.searchParams.set('mute', '1');
  for (const [k, v] of new URLSearchParams(extra)) u.searchParams.set(k, v);
  await page.navigate(u.href);
  if (level) {
    // a Mod or Overload pick (or a gate) comes first on some levels: take the selected card with Enter
    const ready = `window.__kiln && window.__kiln.world && window.__kiln.app.mode === 'play' && window.__kiln.world.level.def.n === ${level}`;
    const until = Date.now() + 30000;
    for (;;) {
      const s = await page.eval(`(() => { const k = window.__kiln; if (!k || !k.ui) return 'loading'; if (${ready}) return 'ready'; return k.app.mode === 'menu' && /^(pick|gate)$/.test(k.ui.current || '') ? 'pick' : 'wait'; })()`).catch(() => 'loading');
      if (s === 'ready') break;
      if (Date.now() > until) throw new Error(`level ${level} did not start (${s})`);
      if (s === 'pick') {
        await sleep(400);
        await key(page, 'Enter');
      }
      await sleep(200);
    }
    await page.eval(`window.__kiln.world.run.lives = 9; true`); // strokes may lose a ball or two
  } else {
    await page.waitFor(`window.__kiln && document.body.classList.contains('ready') && window.__kiln.ui.current === 'title'`, { timeoutMs: 30000 });
  }
  await page.waitFor(HELPERS, { timeoutMs: 10000 });
  await sleep(300);
}

const state = (page) => page.eval(STATE);
const screenOf = (page, fx, fy) => page.eval(`window.__qa.toScreen(${fx}, ${fy})`);
const fieldOf = (page, sx, sy) => page.eval(`window.__qa.toField(${sx}, ${sy})`);

async function waitState(page, cond, ms = 1500) {
  const until = Date.now() + ms;
  let s = await state(page);
  while (!cond(s) && Date.now() < until) {
    await sleep(40);
    s = await state(page);
  }
  return s;
}

/** Drag finger `id` (with `others` held still) from a to b in `steps` moves. */
async function drag(page, id, a, b, others = [], steps = 6, stepMs = 16) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await touches(page, [...others, { id, x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t }]);
    await sleep(stepMs);
  }
}

async function heatUp(page) {
  await page.eval(`(() => { const e = window.__kiln.world.econ; e.heat = e.heatMax || 100; return true; })()`);
}

// ------------------------------------------------------------------------------ the tab switch

async function tabSwitch(chrome, page, base) {
  await open(page, base, 1);
  await key(page, 'Space').catch(() => {});
  const s0 = await state(page);
  const { targetId } = await chrome.conn.send('Target.createTarget', { url: 'about:blank' });
  const s1 = await waitState(page, (s) => s.paused, 2000);
  await chrome.conn.send('Target.activateTarget', { targetId: page.targetId });
  await sleep(1000);
  const s2 = await state(page);
  await chrome.conn.send('Target.closeTarget', { targetId }).catch(() => {});
  return verdict(!s0.paused && s1.paused && s1.ui === 'pause', `another tab did not pause the game (hidden: ${s1.vis}, paused ${s1.paused}, screen ${s1.ui})`)
    || verdict(s2.paused && s2.vis === 'visible', `coming back resumed by itself (paused ${s2.paused}, ${s2.vis})`);
}

// ------------------------------------------------------------------------------ touch

async function touchSuite(chrome, page, base, device, log) {
  const W = device.width, H = device.height;
  const c = {};
  const detail = {};

  // grab + two-finger action, level 1
  await open(page, base, 1);
  let s0 = await state(page);
  const L = [Math.round(W * 0.25), Math.round(H * 0.88)];
  await touches(page, [{ id: 1, x: L[0], y: L[1] }]);
  await sleep(200);
  const s1 = await state(page);
  const M = [L[0] + Math.round(W * 0.2), L[1]];
  await drag(page, 1, L, M);
  await sleep(150);
  const s2 = await state(page);
  const fa = await fieldOf(page, L[0], L[1]);
  const fb = await fieldOf(page, M[0], M[1]);
  const want = fb[0] - fa[0];
  const got = s2.px - s1.px;
  detail.grab = `landing moved the paddle ${r1(s1.px - s0.px)} units; a ${M[0] - L[0]} px drag moved it ${r1(got)} (finger ${r1(want)})`;
  c.grab = verdict(Math.abs(s1.px - s0.px) < 1.5, `the paddle jumped ${r1(s1.px - s0.px)} units when the finger landed`)
    || verdict(Math.abs(got - want) < 4, `drag of ${r1(want)} field units moved the paddle ${r1(got)}`);

  const actionsBefore = s2.in.action;
  const F2 = [Math.round(W * 0.55), Math.round(H * 0.4)];
  await touches(page, [{ id: 1, x: M[0], y: M[1] }, { id: 2, x: F2[0], y: F2[1] }]);
  await sleep(60);
  await touches(page, [{ id: 1, x: M[0], y: M[1] }]);
  const s3 = await waitState(page, (s) => s.phase === 'play', 800);
  const back = [M[0] - Math.round(W * 0.15), M[1]];
  await drag(page, 1, M, back);
  await sleep(150);
  const s4 = await state(page);
  const want2 = (await fieldOf(page, back[0], back[1]))[0] - fb[0];
  await liftAll(page);
  detail.twoFinger = `phase ${s0.phase} -> ${s3.phase}, actions +${s3.in.action - actionsBefore}; finger 1 then moved the paddle ${r1(s4.px - s3.px)} (finger ${r1(want2)})`;
  c['two-finger'] = verdict(s3.phase === 'play' && s3.in.action > actionsBefore, `a second-finger tap while steering did not launch (phase ${s3.phase})`)
    || verdict(Math.abs(s4.px - s3.px - want2) < 4, `after the tap finger 1 moved the paddle ${r1(s4.px - s3.px)}, not ${r1(want2)}`);

  // second-finger hold = Pull, level 7
  await open(page, base, 7);
  await tap(page, Math.round(W * 0.5), Math.round(H * 0.9));
  await waitState(page, (s) => s.phase === 'play', 1000);
  await heatUp(page);
  const P1 = [Math.round(W * 0.3), Math.round(H * 0.88)];
  await touches(page, [{ id: 1, x: P1[0], y: P1[1] }]);
  await sleep(50);
  const p0 = await state(page);
  await touches(page, [{ id: 1, x: P1[0], y: P1[1] }, { id: 2, x: Math.round(W * 0.6), y: Math.round(H * 0.4) }]);
  await sleep(380);
  const p1 = await state(page);
  await touches(page, [{ id: 1, x: P1[0], y: P1[1] }]);
  await sleep(200);
  const p2 = await state(page);
  await liftAll(page);
  detail.fingerPull = `level ${p1.n} (Pull rule ${p1.pull}): pulling ${p1.pulling}, pull steps +${p1.in.pull - p0.in.pull}, actions on release +${p2.in.action - p1.in.action}, pulling after ${p2.pulling}`;
  c['finger-pull'] = verdict(p1.in.pull > p0.in.pull && p1.pulling, `a second-finger hold did not Pull (pull steps +${p1.in.pull - p0.in.pull}, pulling ${p1.pulling}, phase ${p1.phase})`)
    || verdict(p2.in.action === p1.in.action, 'letting go of the hold fired an action')
    || verdict(!p2.pulling, 'still Pulling after the finger lifted');

  // pointercancel pauses
  await touches(page, [{ id: 1, x: P1[0], y: P1[1] }]);
  await sleep(50);
  await page.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  forgetTouches(page);
  const pc = await waitState(page, (s) => s.paused, 1000);
  c['cancel-pause'] = verdict(pc.paused && pc.ui === 'pause', `pointercancel did not pause (paused ${pc.paused}, screen ${pc.ui})`);

  c['tab-switch'] = await tabSwitch(chrome, page, base);

  // one-handed: thumb pad on through the save (what the Settings toggle writes), then reload
  await page.eval(`(() => { const s = window.__kiln.save, d = s.load(); d.settings.thumbPad = true; d.settings.leftHanded = false; s.write(d); return true; })()`);
  const oneHanded = [];
  for (const n of [1, 17, 21]) {
    const r = await oneHand(page, base, n, W, H);
    detail[`oneHanded${n}`] = r.detail;
    if (r.problem) oneHanded.push(`level ${n}: ${r.problem}`);
  }
  // left-handed mirrors the pad
  await page.eval(`(() => { const s = window.__kiln.save, d = s.load(); d.settings.leftHanded = true; s.write(d); return true; })()`);
  await open(page, base, 1);
  const lp = await padCentre(page);
  detail.leftHanded = lp ? `pad at ${lp.map(Math.round).join(',')}` : 'no pad';
  if (!lp || lp[0] > W * 0.3) oneHanded.push(`left-handed: the pad is not bottom-left (${detail.leftHanded})`);
  await page.eval(`(() => { const s = window.__kiln.save, d = s.load(); d.settings.thumbPad = false; d.settings.leftHanded = false; s.write(d); return true; })()`);
  c['one-handed'] = oneHanded.join('; ');
  for (const [k, v] of Object.entries(detail)) log(`    ${k}: ${v}`);
  return { checks: c, detail };
}

async function padCentre(page) {
  return page.eval(`(() => { const p = document.querySelector('.thumbpad'); if (!p || p.hidden) return null; const b = p.getBoundingClientRect(); return b.width ? [b.left + b.width / 2, b.top + b.height / 2, b.width] : null; })()`);
}

async function oneHand(page, base, n, W, H) {
  await open(page, base, n);
  const pad = await padCentre(page);
  if (!pad) return { problem: 'no thumb pad shown with the setting on', detail: 'no pad' };
  const parts = [`pad ${Math.round(pad[2])} px at ${Math.round(pad[0])},${Math.round(pad[1])}`];
  let problem = '';
  if (pad[0] < W * 0.7 || pad[1] < H * 0.8) problem = `the pad is not in the bottom-right corner (${parts[0]})`;
  // pad tap launches
  const a0 = await state(page);
  await tap(page, pad[0], pad[1], 60);
  const a1 = await waitState(page, (s) => s.phase === 'play', 1000);
  parts.push(`tap: ${a0.phase} -> ${a1.phase}`);
  if (a1.phase !== 'play') problem ||= `a pad tap did not launch (phase ${a1.phase})`;
  // thumb strokes in the lower-right zone, lifting between strokes
  const Z = [W * 0.68, H * 0.74];
  const mode = a1.lmode;
  const seen = { min: Infinity, max: -Infinity, oct: new Set() };
  const note = (s) => {
    const t = mode === 'left' ? s.py : s.px;
    seen.min = Math.min(seen.min, t);
    seen.max = Math.max(seen.max, t);
    seen.oct.add(Math.floor(((s.pa + Math.PI) / (Math.PI / 4)) + 1e-9) % 8);
  };
  note(a1);
  const strokes = [];
  if (mode === 'ring') {
    for (let i = 0; i < 16; i++) strokes.push('ring');
  } else {
    for (let i = 0; i < 6; i++) strokes.push(-1);
    for (let i = 0; i < 12; i++) strokes.push(1);
  }
  for (const dir of strokes) {
    let a;
    let b;
    if (dir === 'ring') {
      const s = await state(page);
      const tx = -Math.sin(s.pa), ty = Math.cos(s.pa); // direction of rising bearing
      const len = W * 0.3;
      a = [Z[0] - tx * len / 2, Z[1] - ty * len / 2];
      b = [Z[0] + tx * len / 2, Z[1] + ty * len / 2];
    } else if (mode === 'left') {
      const len = H * 0.28;
      a = [Z[0], Z[1] - dir * len / 2];
      b = [Z[0], Z[1] + dir * len / 2];
    } else {
      const len = W * 0.26;
      a = [Z[0] - dir * len / 2, Z[1]];
      b = [Z[0] + dir * len / 2, Z[1]];
    }
    await touches(page, [{ id: 1, x: a[0], y: a[1] }]);
    await sleep(40);
    await drag(page, 1, a, b, [], 6, 20);
    await sleep(60);
    note(await state(page));
    await liftAll(page);
    await sleep(40);
  }
  const s = await state(page);
  if (mode === 'ring') {
    parts.push(`strokes reached ${seen.oct.size} of 8 eighths of the ring`);
    if (seen.oct.size < 8) problem ||= `thumb strokes reached only ${seen.oct.size} of 8 eighths of the ring`;
  } else {
    const half = s.pw / 2;
    const end = mode === 'left' ? 1080 - half : 720 - half;
    parts.push(`strokes reached ${r1(seen.min)} to ${r1(seen.max)} of ${r1(half)} to ${r1(end)}`);
    if (seen.min > half + 2 || seen.max < end - 2) problem ||= `thumb strokes reached ${r1(seen.min)} to ${r1(seen.max)}, the track is ${r1(half)} to ${r1(end)}`;
  }
  // pad hold Pulls
  await heatUp(page);
  const h0 = await state(page);
  await liftAll(page);
  await touches(page, [{ id: 5, x: pad[0], y: pad[1] }]);
  await sleep(380);
  const h1 = await state(page);
  await liftAll(page);
  parts.push(`hold: pull steps +${h1.in.pull - h0.in.pull}${h1.pull ? `, pulling ${h1.pulling}` : ' (no Pull rule here)'}`);
  if (h1.in.pull <= h0.in.pull) problem ||= 'a pad hold did not Pull';
  else if (h1.pull && h1.phase === 'play' && !h1.pulling) problem ||= 'a pad hold set Pull but the paddle did not Pull';
  return { problem, detail: parts.join('; ') };
}

// ------------------------------------------------------------------------------ desktop

async function desktopSuite(chrome, page, base, device, log) {
  const c = {};
  const detail = {};
  // mouse 1:1 and a left click, level 1
  await open(page, base, 1);
  const row = 1000;
  const misses = [];
  for (const fx of [200, 520, 360]) {
    const [sx, sy] = await screenOf(page, fx, row);
    await mouseMove(page, sx, sy);
    await sleep(150);
    const s = await state(page);
    if (Math.abs(s.px - fx) > 2) misses.push(`mouse at ${fx} put the paddle at ${r1(s.px)}`);
  }
  detail.mouse = misses.join(', ') || 'paddle followed the mouse to 200, 520 and 360';
  const [cx, cy] = await screenOf(page, 360, row);
  const m0 = await state(page);
  await click(page, cx, cy);
  const m1 = await waitState(page, (s) => s.phase === 'play', 800);
  c.mouse = misses.join('; ') || verdict(m0.phase === 'serve' && m1.phase === 'play', `a left click did not launch (phase ${m0.phase} -> ${m1.phase})`);

  // right button and left hold = Pull, level 7
  await open(page, base, 7);
  const [px, py] = await screenOf(page, 360, row);
  await click(page, px, py);
  await waitState(page, (s) => s.phase === 'play', 800);
  await heatUp(page);
  const q0 = await state(page);
  await mouseButton(page, px, py, 'right', true);
  await sleep(350);
  const q1 = await state(page);
  await mouseButton(page, px, py, 'right', false);
  await sleep(150);
  const q2 = await state(page);
  detail.rightPull = `pulling ${q1.pulling}, pull steps +${q1.in.pull - q0.in.pull}, context menus ${q2.ctx.menu} (prevented ${q2.ctx.prevented}), actions +${q2.in.action - q0.in.action}`;
  c['right-pull'] = verdict(q1.pulling && q1.in.pull > q0.in.pull, `holding the right button did not Pull (pulling ${q1.pulling}, phase ${q1.phase})`)
    || verdict(q2.ctx.menu === q2.ctx.prevented, 'the right button opened the context menu')
    || verdict(q2.in.action === q0.in.action, 'the right button fired an action')
    || verdict(!q2.pulling, 'still Pulling after the right button was let go');
  await heatUp(page);
  const l0 = await state(page);
  await mouseButton(page, px, py, 'left', true);
  await sleep(380);
  const l1 = await state(page);
  await mouseButton(page, px, py, 'left', false);
  await sleep(150);
  const l2 = await state(page);
  detail.leftHold = `pulling ${l1.pulling}, pull steps +${l1.in.pull - l0.in.pull}, actions on release +${l2.in.action - l1.in.action}`;
  c['left-hold'] = verdict(l1.in.pull > l0.in.pull && l1.pulling, `a left hold did not Pull (pulling ${l1.pulling})`)
    || verdict(l2.in.action === l1.in.action, 'letting go of a left hold fired an action');

  // keyboard only: from the title
  c.keyboard = await keyboardOnly(page, base, detail);
  c['tab-switch'] = await tabSwitch(chrome, page, base);
  for (const [k, v] of Object.entries(detail)) log(`    ${k}: ${v}`);
  return { checks: c, detail };
}

async function keyboardOnly(page, base, detail) {
  await open(page, base, 0);
  const path = ['title'];
  for (let i = 0; i < 10; i++) {
    const s = await state(page);
    if (s.mode === 'play' && !s.paused) break;
    await key(page, 'Enter');
    await sleep(700);
    const t = await state(page);
    path.push(t.mode === 'play' ? `play ${t.n}` : t.ui || 'none');
  }
  detail.keyboardPath = path.join(' > ');
  const s0 = await state(page);
  if (s0.mode !== 'play') return `Enter alone did not get from the title into play (${detail.keyboardPath})`;
  await page.waitFor(HELPERS, { timeoutMs: 5000 });
  const problems = [];
  // arrows: to the left wall, then measured runs right at 900 and (Shift) 1500 units/s
  await keyEvent(page, 'ArrowLeft', true);
  await sleep(1200);
  await keyEvent(page, 'ArrowLeft', false);
  const k0 = await state(page);
  await keyEvent(page, 'ArrowRight', true);
  await sleep(250);
  await keyEvent(page, 'ArrowRight', false);
  const k1 = await state(page);
  await keyEvent(page, 'Shift', true);
  await keyEvent(page, 'ArrowRight', true);
  await sleep(150);
  await keyEvent(page, 'ArrowRight', false);
  await keyEvent(page, 'Shift', false);
  const k2 = await state(page);
  const vSlow = (k1.px - k0.px) / 0.25;
  const vFast = (k2.px - k1.px) / 0.15;
  detail.keys = `left wall ${r1(k0.px)}; arrow ${Math.round(vSlow)} u/s, Shift+arrow ${Math.round(vFast)} u/s`;
  if (k0.px > k0.pw / 2 + 2) problems.push(`ArrowLeft did not reach the left wall (${r1(k0.px)})`);
  if (vSlow < 400) problems.push(`ArrowRight moved the paddle at ${Math.round(vSlow)} u/s`);
  if (vFast < vSlow * 1.25) problems.push(`Shift did not speed the arrows up (${Math.round(vSlow)} vs ${Math.round(vFast)} u/s)`);
  // Space launches; Shift alone Pulls
  const sp0 = await state(page);
  await key(page, 'Space');
  const sp1 = await waitState(page, (s) => s.phase === 'play', 800);
  if (sp0.phase === 'serve' && sp1.phase !== 'play') problems.push(`Space did not launch (phase ${sp1.phase})`);
  const sh0 = await state(page);
  await keyEvent(page, 'Shift', true);
  await sleep(250);
  const sh1 = await state(page);
  await keyEvent(page, 'Shift', false);
  if (sh1.in.pull <= sh0.in.pull) problems.push('Shift alone did not set Pull');
  // P pauses, Enter resumes, Esc pauses, arrows + Enter reach the level map, Enter plays
  await key(page, 'KeyP');
  const pp = await waitState(page, (s) => s.paused && s.ui === 'pause', 1000);
  if (!pp.paused) problems.push('P did not pause');
  await sleep(250);
  await key(page, 'Enter');
  const pr = await waitState(page, (s) => !s.paused, 1000);
  if (pr.paused) problems.push('Enter on the pause menu did not resume');
  await key(page, 'Escape');
  const pe = await waitState(page, (s) => s.paused && s.ui === 'pause', 1000);
  if (!pe.paused) problems.push('Esc did not pause');
  await sleep(250);
  for (let i = 0; i < 6; i++) await key(page, 'ArrowDown');
  await key(page, 'Enter');
  const pm = await waitState(page, (s) => s.ui === 'map', 1500);
  if (pm.ui !== 'map') problems.push(`arrows + Enter on the pause menu did not reach the level map (screen ${pm.ui})`);
  let pl = pm;
  for (let i = 0; i < 4 && !(pl.mode === 'play' && !pl.paused); i++) {
    await key(page, 'Enter');
    pl = await waitState(page, (s) => s.mode === 'play' && !s.paused, 1200);
  }
  detail.keyboardMenus = `P ${pp.ui}, Enter ${pr.paused ? 'still paused' : 'resumed'}, Esc ${pe.ui}, Levels ${pm.ui}, Enter ${pl.mode === 'play' ? `play ${pl.n}` : pl.ui}`;
  if (!(pl.mode === 'play' && !pl.paused)) problems.push(`Enter on the level map did not start a level (screen ${pl.ui})`);
  // M toggles sound (saved setting)
  const mute0 = await page.eval(`window.__kiln.save.load().settings.muted`);
  await key(page, 'KeyM');
  await sleep(200);
  const mute1 = await page.eval(`window.__kiln.save.load().settings.muted`);
  await key(page, 'KeyM');
  if (!!mute0 === !!mute1) problems.push(`M did not toggle sound (muted ${mute0} -> ${mute1})`);
  return problems.join('; ');
}

// ------------------------------------------------------------------------------ main

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  if (o.help) {
    console.log('see the header of tools/qa/inputcheck.mjs');
    return 0;
  }
  const server = o.url ? null : await serveStatic(o.root);
  const base = o.url || server.url.replace('127.0.0.1', 'localhost');
  console.log(`Kiln input check: ${o.devices.join(', ')}, ${base}`);
  const results = [];
  const log = (s) => console.log(s);
  try {
    for (const id of o.devices) {
      const device = getDevice(id);
      const chrome = await launchChrome({ headless: !o.headed, width: device.width, height: device.height });
      let res;
      try {
        const page = await page0(chrome, device);
        log(`${device.name} ${device.width}x${device.height}`);
        res = device.touch ? await touchSuite(chrome, page, base, device, log) : await desktopSuite(chrome, page, base, device, log);
        res.checks.errors = [...new Set(page.sink.errors)].slice(0, 6).join(' | ');
      } catch (err) {
        res = { checks: { run: err.message.split('\n')[0] }, detail: {} };
      } finally {
        await chrome.close();
      }
      const failing = Object.entries(res.checks).filter(([, v]) => v);
      for (const [k, v] of Object.entries(res.checks)) log(`  ${v ? 'FAIL' : 'ok  '} ${k}${v ? `: ${v}` : ''}`);
      results.push({ device: id, pass: !failing.length, ...res });
    }
  } finally {
    if (server) await server.close();
  }
  const failed = results.filter((r) => !r.pass);
  if (o.json) writeFileSync(o.json, JSON.stringify({ when: new Date().toISOString(), results }, null, 2));
  console.log(`\nRESULT: ${failed.length ? `FAIL (${failed.map((r) => r.device).join(', ')})` : 'PASS'} on ${results.length} device(s)`);
  return failed.length ? 1 : 0;
}

process.exit(await main());
