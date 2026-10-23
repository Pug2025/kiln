#!/usr/bin/env node
// Kiln QA (G): paddle and ball legibility check (LEAD request 2026-10-21 19:40, ART.md 12b).
//
// Plays a level with the robot in headless Chrome (mute=1, autolite=0), stops the frame loop and
// steps frames by hand (window.__kiln.advance), then for each state takes a screenshot and measures
// the mean luminance of the paddle against a ring 40 field units wide around it, and the same for
// the ball. Contrast is WCAG's (L1 + 0.05) / (L2 + 0.05) on relative luminance; below 3:1 fails.
// The plain ratio of the two means is printed beside it ("means 8.3x"; --metric plain judges by it).
//
// The paddle is its drawn silhouette (each paddle mesh's box through the live camera; the ring arc
// bent in 16 pieces as its shader bends it); its ring lies on the plane of its front face and
// leaves out 32 units around any ball (the ball and its halo are meant to be brighter). The ball is
// its projected disc; its ring lies on the play plane and includes its own halo.
//
// States: x1 and x5 (combo multiplier held by the script; three frames each: the fire's breathing
// peak, then a third and two thirds of a breath later) and a ball-drop flare at x1 and x5 (the ball
// is put just past the loss edge beside the paddle; frames 50 ms and 150 ms after the loss; lives are
// held so the last-life look never starts).
//
//   node tools/qa/legibility.mjs                         iPhone 14 Pro + desktop, levels 1 11 23, lite off
//   node tools/qa/legibility.mjs --levels 17,21 --lite both
//   node tools/qa/legibility.mjs --url http://localhost:8790/ --shots    measure a running server, keep crops
//
// Options: --devices iphone14pro,desktop (lib/devices.mjs names) --levels 1,11,23 --lite off|on|both
// --min 3 --metric wcag|plain --ring 40 --seed 1 --params "a=b" --root <checkout> --shots (every crop,
// not only failures)
// --out <dir> --json <file> --headed
//
// Crops (object outlined green, ring edges cyan) go to tools/qa/out/legibility/ (ignored by git).
// Exit 1 if any measurement is under --min or cannot be made.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, serveStatic } from './lib/cdp.mjs';
import { getDevice, emulateDevice } from './lib/devices.mjs';
import { decodePNG, encodePNG } from './lib/png.mjs';
import { measureRegion, paddleGeometry, ballGeometry, overlayCrop } from './lib/legible.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const o = {
    devices: ['iphone14pro', 'desktop'], levels: [1, 11, 23], lite: 'off', min: 3, metric: 'wcag', ring: 40, seed: 1, params: '',
    url: '', root: resolve(HERE, '..', '..'), shots: false, out: '', json: '', headed: false,
    gap: 2, insetPx: 1, gapPx: 1, insetUnits: 1.5,
    ballClear: 32, // field units around a ball (its halo is 40 wide) left out of the paddle's ring
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
    if (a === '--devices') o.devices = list(v());
    else if (a === '--levels' || a === '--level') o.levels = list(v()).map(Number);
    else if (a === '--lite') o.lite = v();
    else if (a === '--min') o.min = Number(v());
    else if (a === '--metric') o.metric = v();
    else if (a === '--ring') o.ring = Number(v());
    else if (a === '--seed') o.seed = Number(v());
    else if (a === '--params') o.params = v();
    else if (a === '--url') o.url = v();
    else if (a === '--root') o.root = resolve(v());
    else if (a === '--shots') o.shots = true;
    else if (a === '--out') o.out = resolve(v());
    else if (a === '--json') o.json = v();
    else if (a === '--headed') o.headed = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown option ${a} (try --help)`);
  }
  if (!['off', 'on', 'both'].includes(o.lite)) throw new Error('--lite is off, on or both');
  if (!['wcag', 'plain'].includes(o.metric)) throw new Error('--metric is wcag or plain');
  if (o.levels.some((n) => !Number.isInteger(n) || n < 1)) throw new Error('--levels takes level numbers, e.g. 1,11,23');
  for (const d of o.devices) getDevice(d);
  if (!o.out) o.out = join(o.root, 'tools', 'qa', 'out', 'legibility');
  return o;
}

function pageUrl(base, o, levelN) {
  const u = new URL(base);
  u.searchParams.set('level', String(levelN));
  u.searchParams.set('seed', String(o.seed));
  u.searchParams.set('bot', '1');
  u.searchParams.set('mute', '1'); // never sound on the owner's speakers (LEAD 19:25); Chrome also runs --mute-audio
  u.searchParams.set('autolite', '0');
  for (const [k, v] of new URLSearchParams(o.params)) u.searchParams.set(k, v);
  return u.href;
}

// Runs in the page before the game: holds requestAnimationFrame on demand, steps frames by hand
// with the combo and lives forced first.
const QA_SRC = `(() => {
  if (window.__kilnLeg) return;
  const raf = window.requestAnimationFrame.bind(window);
  const held = [];
  const L = window.__kilnLeg = {
    hold: false, combo: -1, mult: 1, lives: 0,
    release() { L.hold = false; for (const cb of held.splice(0)) raf(cb); },
    force() {
      const w = window.__kiln && window.__kiln.world;
      if (!w) return;
      if (L.combo >= 0) { w.econ.combo = L.combo; w.econ.mult = L.mult; }
      if (L.lives > 0 && w.run) { w.run.lives = L.lives; w.fx.lastLife = L.lives === 1; }
    },
    step(n, pred) {
      for (let i = 0; i < n; i++) {
        L.force();
        window.__kiln.advance(1, 1000 / 60);
        L.force();
        if (pred && pred()) return i + 1;
      }
      return -1;
    },
    inFlight() {
      const w = window.__kiln.world;
      return w.phase === 'play' && w.balls.some((b) => b.alive && !b.held && b.sealed < 0);
    },
  };
  window.requestAnimationFrame = (cb) => raf((t) => { if (L.hold) held.push(cb); else cb(t); });
})();`;

// The drawn frame's geometry: the play plane's corners on screen (CSS px), the paddle's footprint
// (field units) and on-screen silhouette, the ball, and the fire state.
const GEOM_SRC = `(async () => {
  const k = window.__kiln, w = k.world, R = k.renderer, I = R._internals;
  const C = await import(new URL('src/core/constants.js', document.baseURI).href);
  const { FIELD, RING, SIM } = C;
  const HW = FIELD.W / 2, HH = FIELD.H / 2;
  const cam = I.camera;
  const rect = I.gl.domElement.getBoundingClientRect();
  const v = new cam.position.constructor();
  const css = () => [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height];
  const at = (fx, fy) => { v.set(fx - HW, HH - fy, 0).project(cam); return css(); };
  const quad = [[0, 0], [FIELD.W, 0], [FIELD.W, FIELD.H], [0, FIELD.H]].map(([x, y]) => at(x, y));
  const p = w.paddle, mode = w.level.mode;
  const pad = mode === 'ring'
    ? { kind: 'arc', cx: RING.CX, cy: RING.CY, R: RING.R_PADDLE, half: p.h / 2, angle: p.angle, span: p.span > 0 ? p.span : (RING.SPAN_DEG * Math.PI) / 180 }
    : mode === 'left' ? { kind: 'rect', cx: p.x, cy: p.y, hw: p.h / 2, hh: p.w / 2 } : { kind: 'rect', cx: p.x, cy: p.y, hw: p.w / 2, hh: p.h / 2 };
  // the drawn paddle's silhouette: each visible mesh's box, through its world matrix and the camera;
  // the ring paddle is bent in its vertex shader (actors.js bendable), so it is cut into 16 pieces
  // and each piece bent the same way
  const hulls = [];
  let zFront = -Infinity;
  I.actors.pad.updateMatrixWorld(true);
  I.actors.pad.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry) return;
    const m = o.material;
    if (!m || m.blending === 2 || (m.transparent && m.opacity <= 0.01)) return; // additive flashes are not the bar
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    const u = m.userData && m.userData.bend;
    const bent = !!(u && u.uBend.value > 0);
    const N = bent ? 16 : 1;
    for (let k = 0; k < N; k++) {
      const pts = [];
      // pieces overlap by a third so their joins sit inside the union, not on an edge
      const d = (b.max.x - b.min.x) / N;
      const xs = [Math.max(b.min.x, b.min.x + d * (k - 0.35)), Math.min(b.max.x, b.min.x + d * (k + 1.35))];
      for (const x of xs) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        let tx = x, ty = y;
        if (u) {
          const sx = x * u.uLen.value;
          tx = sx;
          if (bent) {
            const th = (sx / u.uR.value) * u.uBend.value, rho = u.uR.value - y;
            tx = rho * Math.sin(th);
            ty = u.uR.value - rho * Math.cos(th);
          }
        }
        v.set(tx, ty, z).applyMatrix4(o.matrixWorld);
        if (v.z > zFront) zFront = v.z;
        v.project(cam);
        pts.push(css());
      }
      hulls.push(pts);
    }
  });
  // the paddle's ring lies on the plane of its front face (what the eye sees around it); the ball's
  // on the play plane through its centre
  const atZ = (fx, fy, z) => { v.set(fx - HW, HH - fy, z).project(cam); return css(); };
  const quadPad = [[0, 0], [FIELD.W, 0], [FIELD.W, FIELD.H], [0, FIELD.H]].map(([x, y]) => atZ(x, y, hulls.length ? zFront : 0));
  let ball = null;
  const alpha = k.app && typeof k.app.acc === 'number' ? k.app.acc / SIM.DT : 0;
  const balls = w.balls.filter((q) => q.alive && q.sealed < 0).map((q) => (q.held ? [q.x, q.y] : [q.px + (q.x - q.px) * alpha, q.py + (q.y - q.py) * alpha]));
  const b = w.balls.find((q) => q.alive && !q.held && q.sealed < 0);
  if (b) {
    const fx = b.px + (b.x - b.px) * alpha, fy = b.py + (b.y - b.py) * alpha;
    const c = at(fx, fy), ex = at(fx + b.r, fy), ey = at(fx, fy + b.r);
    ball = { fx, fy, r: b.r, cx: c[0], cy: c[1], rcss: Math.min(Math.hypot(ex[0] - c[0], ex[1] - c[1]), Math.hypot(ey[0] - c[0], ey[1] - c[1])) };
  }
  const st = I.fire && I.fire.st;
  return {
    viewport: [innerWidth, innerHeight], field: { w: FIELD.W, h: FIELD.H }, quad, quadPad, zFront: hulls.length ? +zFront.toFixed(2) : 0,
    pad, hulls, ball, balls, mode,
    level: w.level.n, phase: w.phase, mult: w.econ.mult, lives: w.run && w.run.lives,
    fire: st ? +st.value.toFixed(3) : null, flare: st ? +st.flare.toFixed(3) : null,
    lite: !!(R.quality && R.quality.lite), bloom: !!(I.post && I.post.bloomOn),
  };
})()`;

// Puts the first free ball just past the loss edge, beside the paddle, moving out.
const DROP_SRC = `(async () => {
  const k = window.__kiln, w = k.world, p = w.paddle;
  const { FIELD, RING } = await import(new URL('src/core/constants.js', document.baseURI).href);
  const b = w.balls.find((q) => q.alive && !q.held && q.sealed < 0);
  if (!b) return false;
  let x, y, vx = 0, vy = 0;
  if (w.level.mode === 'left') {
    x = -b.r - 2;
    y = p.y + p.w / 2 + 24 <= FIELD.H - 12 ? p.y + p.w / 2 + 24 : p.y - p.w / 2 - 24;
    vx = -600;
  } else if (w.level.mode === 'ring') {
    const span = p.span > 0 ? p.span : (RING.SPAN_DEG * Math.PI) / 180;
    const a = p.angle + span / 2 + 0.12, r = RING.R_LOSS + b.r + 2;
    x = RING.CX + Math.cos(a) * r; y = RING.CY + Math.sin(a) * r;
    vx = Math.cos(a) * 600; vy = Math.sin(a) * 600;
  } else {
    x = p.x + p.w / 2 + 24 <= FIELD.W - 12 ? p.x + p.w / 2 + 24 : p.x - p.w / 2 - 24;
    y = FIELD.H + b.r + 2;
    vy = 600;
  }
  b.x = b.px = x; b.y = b.py = y; b.vx = vx; b.vy = vy;
  return true;
})()`;

const BOOTED = 'window.__kiln && window.__kiln.world && window.__kiln.world.step > 0';

function fmt(r) {
  return r ? `${r.wcag.toFixed(2)}:1 (means ${r.plain.toFixed(1)}x)` : 'n/a';
}

/** One measured frame. */
async function capture(page, o, tag, keep) {
  const frame = await page.eval(GEOM_SRC);
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  const img = decodePNG(Buffer.from(shot.data, 'base64'));
  const scale = img.width / frame.viewport[0];
  const pad = measureRegion(img, scale, paddleGeometry(frame, o), o);
  const ball = frame.ball ? measureRegion(img, scale, ballGeometry(frame, o), o) : null;
  const val = (m) => (o.metric === 'plain' ? m.plain : m.ratio);
  const bad = (m) => m && (val(m) < o.min || m.objN < 12 || m.ringN < 40);
  const files = [];
  if (o.shots || bad(pad) || bad(ball)) {
    mkdirSync(o.out, { recursive: true });
    for (const [what, m] of [['paddle', pad], ['ball', ball]]) {
      if (!m || !m.crop.w || !m.crop.h) continue;
      const c = overlayCrop(img, m.crop);
      const f = join(o.out, `${tag}-${what}.png`);
      writeFileSync(f, encodePNG(c.width, c.height, c.data));
      files.push(f);
    }
    if (keep) {
      const f = join(o.out, `${tag}-full.png`);
      writeFileSync(f, Buffer.from(shot.data, 'base64'));
      files.push(f);
    }
  }
  const pick = (m) => m && { ratio: +val(m).toFixed(2), wcag: +m.ratio.toFixed(2), plain: +m.plain.toFixed(2), obj: +m.obj.toFixed(4), ring: +m.ring.toFixed(4), ringP95: +m.ringP95.toFixed(4), objPx: m.objN, ringPx: m.ringN };
  return { tag, fire: frame.fire, flare: frame.flare, mult: frame.mult, phase: frame.phase, lite: frame.lite, bloom: frame.bloom, paddle: pick(pad), ball: pick(ball), files };
}

const STATES = [
  { id: 'x1', combo: 0, mult: 1, flare: false },
  { id: 'x5', combo: 50, mult: 5, flare: false },
  { id: 'flare-x1', combo: 0, mult: 1, flare: true },
  { id: 'flare-x5', combo: 50, mult: 5, flare: true },
];

async function measureLevel(page, o, levelN, prefix, log) {
  const out = [];
  const ev = (s) => page.eval(s, { timeoutMs: 60000 });
  await ev('window.__kilnLeg.hold = true');
  await sleep(100);
  await ev('(window.__kilnLeg.combo = -1, window.__kilnLeg.lives = 0)');
  if ((await ev('window.__kilnLeg.step(900, window.__kilnLeg.inFlight)')) < 0) throw new Error(`level ${levelN}: the ball never left the paddle`);
  await ev('window.__kilnLeg.step(90)'); // camera intro, first hits
  for (const s of STATES) {
    await ev(`(window.__kilnLeg.combo = ${s.combo}, window.__kilnLeg.mult = ${s.mult}, window.__kilnLeg.lives = Math.max(2, window.__kiln.world.run.lives))`);
    if ((await ev('window.__kilnLeg.step(900, window.__kilnLeg.inFlight)')) < 0) {
      out.push({ state: s.id, skipped: 'the ball never left the paddle' });
      continue;
    }
    await ev('window.__kilnLeg.step(45)'); // the fire eases to the new multiplier over 0.6 s
    const caps = [];
    if (!s.flare) {
      const omega = await ev('window.__kiln.renderer._internals.fire.st.omega');
      const third = Math.max(1, Math.round((60 * 2 * Math.PI) / (omega || 1.25) / 3));
      await ev('window.__kilnLeg.step(400, () => Math.sin(window.__kiln.renderer._internals.fire.st.phase) > 0.97)');
      caps.push(await capture(page, o, `${prefix}-L${levelN}-${s.id}-peak`, false));
      await ev(`window.__kilnLeg.step(${third})`);
      caps.push(await capture(page, o, `${prefix}-L${levelN}-${s.id}-b`, false));
      await ev(`window.__kilnLeg.step(${third})`);
      caps.push(await capture(page, o, `${prefix}-L${levelN}-${s.id}-c`, false));
    } else {
      const lost0 = await ev('window.__kiln.world.stats.ballsLost');
      if (!(await ev(DROP_SRC))) {
        out.push({ state: s.id, skipped: 'no free ball to drop' });
        continue;
      }
      const n = await ev(`window.__kilnLeg.step(30, () => window.__kiln.world.stats.ballsLost > ${lost0})`);
      if (n < 0) {
        out.push({ state: s.id, skipped: 'the dropped ball was not lost' });
        continue;
      }
      await ev('window.__kilnLeg.step(3)');
      caps.push(await capture(page, o, `${prefix}-L${levelN}-${s.id}-50ms`, false));
      await ev('window.__kilnLeg.step(6)');
      caps.push(await capture(page, o, `${prefix}-L${levelN}-${s.id}-150ms`, false));
    }
    const worst = (k) => caps.filter((c) => c[k]).reduce((m, c) => (!m || c[k].ratio < m[k].ratio ? c : m), null);
    const wp = worst('paddle'), wb = worst('ball');
    out.push({ state: s.id, caps, paddle: wp && wp.paddle, paddleAt: wp && wp.tag, ball: wb && wb.ball, ballAt: wb && wb.tag });
    log(`    ${s.id.padEnd(9)} paddle ${fmt(wp && wp.paddle).padEnd(22)} ball ${fmt(wb && wb.ball).padEnd(22)} fire ${caps.map((c) => c.fire).join(' / ')}${s.flare ? ` (flare ${caps.map((c) => c.flare).join(' / ')})` : ''}`);
  }
  await ev('window.__kilnLeg.release()');
  return out;
}

async function runDevice(o, base, deviceId, lite, log) {
  const device = getDevice(deviceId);
  const chrome = await launchChrome({ headless: !o.headed, width: device.width, height: device.height });
  const errors = [];
  const levels = [];
  try {
    const page = await chrome.newPage();
    await page.send('Runtime.enable');
    page.on('Runtime.exceptionThrown', (e) => errors.push(`exception: ${e.exceptionDetails.exception?.description || e.exceptionDetails.text}`));
    await emulateDevice(page, device);
    await page.send('Page.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: QA_SRC });
    const want = lite === 'on';
    let liteSet = false;
    for (const levelN of o.levels) {
      const url = pageUrl(base, o, levelN);
      const onLevel = `${BOOTED} && window.__kiln.world.level.n === ${levelN}`;
      await page.navigate(url);
      await page.waitFor(onLevel, { timeoutMs: 30000 }).catch(() => {
        throw new Error(`level ${levelN} did not start (${url})${errors.length ? `\n${errors.join('\n')}` : ''}`);
      });
      if (!liteSet) {
        const have = await page.eval('(() => { const s = window.__kiln.save; return s && s.load ? !!s.load().settings.lite : null; })()');
        if (have === null) throw new Error('window.__kiln.save is missing: cannot set lite mode');
        if (have !== want) {
          // as the Settings switch writes it (D's playerSetsLite): lite without liteSet is undone at boot
          await page.eval(`(() => { const s = window.__kiln.save; const d = s.load(); d.settings.lite = ${want}; d.settings.liteSet = true; s.write(d); return true; })()`);
          await page.navigate(url);
          await page.waitFor(onLevel, { timeoutMs: 30000 });
        }
        liteSet = true;
      }
      const info = await page.eval('(() => { const w = window.__kiln.world; return { id: w.level.def.id, mode: w.level.mode, world: w.level.def.world || "", lite: !!window.__kiln.renderer.quality.lite }; })()');
      if (info.lite !== want) throw new Error(`lite should be ${lite} but the renderer has lite ${info.lite ? 'on' : 'off'}`);
      log(`  level ${levelN} ${info.id} (${info.world || '?'}, ${info.mode})`);
      const states = await measureLevel(page, o, levelN, `${deviceId}-lite${lite}`, log);
      levels.push({ level: levelN, ...info, states });
    }
  } finally {
    await chrome.close();
  }
  return { device: deviceId, name: device.name, size: `${device.width}x${device.height}@${device.dpr}`, lite, levels, errors };
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
    console.log('see the header of tools/qa/legibility.mjs');
    return 0;
  }
  const server = o.url ? null : await serveStatic(o.root);
  const base = o.url || server.url.replace('127.0.0.1', 'localhost');
  console.log(`Kiln legibility check (ART 12b): paddle and ball against a ${o.ring}-unit ring, mean luminance, fail under ${o.min}:1`);
  console.log(`${o.url ? o.url : `serving ${relative(process.cwd(), o.root) || '.'}`}; levels ${o.levels.join(' ')}; devices ${o.devices.join(' ')}; lite ${o.lite}`);
  const runs = [];
  const problems = [];
  try {
    for (const deviceId of o.devices) {
      for (const lite of o.lite === 'both' ? ['off', 'on'] : [o.lite]) {
        const d = getDevice(deviceId);
        console.log(`\n${d.name} ${d.width}x${d.height} @${d.dpr}, lite ${lite}`);
        const r = await runDevice(o, base, deviceId, lite, (s) => console.log(s));
        runs.push(r);
        for (const L of r.levels) {
          for (const s of L.states) {
            const where = `${r.device} lite ${lite} level ${L.level} ${s.state}`;
            if (s.skipped) { problems.push(`${where}: not measured (${s.skipped})`); continue; }
            for (const what of ['paddle', 'ball']) {
              const m = s[what];
              if (!m) continue;
              if (m.objPx < 12 || m.ringPx < 40) problems.push(`${where}: ${what} measured on too few pixels (${m.objPx} object, ${m.ringPx} ring)`);
              else if (m.ratio < o.min) problems.push(`${where}: ${what} ${m.ratio}:1 is under ${o.min}:1 (object ${m.obj}, ring ${m.ring}; ${s[`${what}At`]})`);
            }
            if (!s.paddle) problems.push(`${where}: paddle not measured`);
          }
        }
        if (r.errors.length) problems.push(`${r.device} lite ${lite}: page errors: ${[...new Set(r.errors)].slice(0, 3).join(' | ')}`);
      }
    }
  } catch (err) {
    problems.push(`ERROR: ${err.message}`);
  } finally {
    if (server) await server.close();
  }
  const all = (k) => runs.flatMap((r) => r.levels.flatMap((L) => L.states.filter((s) => s[k]).map((s) => ({ r, L, s, m: s[k] }))));
  const worst = (k) => all(k).reduce((a, b) => (!a || b.m.ratio < a.m.ratio ? b : a), null);
  const wp = worst('paddle'), wb = worst('ball');
  const at = (w) => (w ? `${w.m.ratio}:1 (${w.r.device} lite ${w.r.lite}, level ${w.L.level}, ${w.s.state})` : 'n/a');
  console.log(`\nworst paddle ${at(wp)}; worst ball ${at(wb)}`);
  if (problems.length) console.log(`problems:\n  ${problems.join('\n  ')}`);
  if (problems.length || o.shots) console.log(`crops: ${relative(process.cwd(), o.out) || o.out}`);
  console.log(`RESULT: ${problems.length ? 'FAIL' : 'PASS'}`);
  if (o.json) writeFileSync(o.json, JSON.stringify({ when: new Date().toISOString(), options: { ...o, root: undefined }, runs, problems, pass: !problems.length }, null, 2));
  return problems.length ? 1 : 0;
}

process.exit(await main());
