// G: integration checks across systems. These hold at every stage of the build, so they guard
// main while A to F merge, the full campaign 1 to 30 included.

import { test, skip, assert } from './lib.mjs';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUS_CAP } from '../src/core/bus.js';
import { getLevel, getStage, LEVELS, CAMPAIGN_LENGTH } from '../src/levels/index.js';
import { generateOverburn } from '../src/levels/overburn.js';
import { createSave, memoryStorage } from '../src/economy/save.js';
import { bankRun } from '../src/economy/forge.js';
import { createRun } from '../src/economy/economy.js';
import { playWorld, playCampaign, SIX_MINUTES_MS } from '../tools/qa/lib/play.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The planning files never reach the public repo (PLAN §8, BUILD-STATUS publish condition).
const PLANNING = [/^PLAN\.md$/, /^ART\.md$/, /^CHANGELOG\.md$/, /^HANDOFF[^/]*$/, /^BUILD-STATUS\.md$/,
  /^team\//, /^status\//, /^research\//, /^look-tests\//, /^art\//, /^plan-site\//, /^\.worktrees\//, /^\.merge-lock/];

function gitFiles() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return null; // not a git checkout (a downloaded copy): nothing to check
  }
}

test('no planning file is tracked', () => {
  const files = gitFiles();
  if (!files) return;
  const bad = files.filter((f) => PLANNING.some((re) => re.test(f)));
  assert.deepEqual(bad, [], `planning files tracked by git: ${bad.join(', ')}`);
});

/** Levels that stress different systems; only the ones that exist yet are played. */
const SAMPLE = [1, 7, 10, 17, 21, 24, 28];
const SAMPLE_SIM_MS = 45000;

function sampleDefs() {
  const defs = SAMPLE.map((n) => getLevel(n)).filter(Boolean);
  const core = getLevel(30);
  if (core) for (let d = core; d; d = d.continues ? getStage(d.continues) : null) defs.push(d);
  return defs;
}

test('same seed, same event stream', () => {
  for (const def of sampleDefs()) {
    const a = playWorld(def, { seed: 11, maxSimMs: SAMPLE_SIM_MS });
    const b = playWorld(def, { seed: 11, maxSimMs: SAMPLE_SIM_MS });
    assert.ok(a.events > 0, `${def.id}: the bus carried events`);
    assert.equal(a.events, b.events, `${def.id}: event count differs between two runs of seed 11`);
    assert.equal(a.hash, b.hash, `${def.id}: event stream differs between two runs of seed 11`);
    assert.equal(a.result.steps, b.result.steps, `${def.id}: step count differs`);
    assert.equal(a.world.run.score, b.world.run.score, `${def.id}: score differs`);
  }
}, { timeout: 180000 });

test('no bus reader loses events, even one that reads once per frame', () => {
  for (const def of sampleDefs()) {
    const r = playWorld(def, { seed: 3, maxSimMs: SAMPLE_SIM_MS });
    assert.equal(r.lost, 0, `${def.id}: a reader reading every step lost ${r.lost} events`);
    assert.ok(r.maxWindow < BUS_CAP, `${def.id}: ${r.maxWindow} events within one frame's steps (bus holds ${BUS_CAP})`);
    assert.equal(r.problem, '', `${def.id}: ${r.problem} at step ${r.problemStep}`);
  }
}, { timeout: 180000 });

test('Overburn waves 1 to 5 are the same for the same seed', () => {
  const seed = 20261021;
  for (let wave = 1; wave <= 5; wave++) {
    const a = generateOverburn(seed, wave);
    const b = generateOverburn(seed, wave);
    assert.deepEqual(a, b, `wave ${wave} layout differs for one seed`);
    const pa = playWorld(a, { seed, maxSimMs: 20000 });
    const pb = playWorld(b, { seed, maxSimMs: 20000 });
    assert.equal(pa.hash, pb.hash, `wave ${wave} plays differently for one seed`);
  }
}, { timeout: 120000 });

// Game logic stays deterministic and headless (ARCHITECTURE "Game logic ... never imports the DOM,
// three.js, audio, performance.now(), Date.now() or Math.random()").
const LOGIC = ['src/core', 'src/sim', 'src/content', 'src/levels', 'src/economy', 'src/systems.js'];
// a three.js module specifier: 'three', 'three/addons/...', or a CDN URL of three
const THREE = String.raw`['"](?:three(?:\/[^'"]*)?|https?:[^'"]*\/three(?:@[^/'"]*)?(?:\/[^'"]*)?)['"]`;
// [pattern, what, the one file allowed to use it (an edge the architecture names)]
const FORBIDDEN = [
  [/\bMath\.random\s*\(/, 'Math.random()'],
  [/\bDate\.now\s*\(/, 'Date.now()'],
  [/\bnew\s+Date\b|(?<![\w$.])Date\s*\(/, 'the wall clock (new Date)', 'src/core/rng.js'], // dailySeed's default
  [/\bperformance\s*\.\s*now\s*\(/, 'performance.now()'],
  [/\b(?:set(?:Timeout|Interval|Immediate)|queueMicrotask)\s*\(/, 'timers (setTimeout, setInterval)'],
  [/\b(?:request|cancel)AnimationFrame\b/, 'requestAnimationFrame'],
  [/\b(document|window|navigator)\s*\./, 'the DOM'],
  [/(?<![\w$.])(?:innerWidth|innerHeight|outerWidth|outerHeight|devicePixelRatio)\b/, 'the window size (innerWidth, devicePixelRatio)'],
  [new RegExp(String.raw`\bfrom\s+${THREE}|\bimport\s+${THREE}`), 'three.js'],
  [new RegExp(String.raw`\bimport\s*\(\s*${THREE}`), 'three.js (dynamic import)'],
  [/AudioContext\b/, 'audio (AudioContext)'],
  [/\bnew\s+Audio\s*\(/, 'audio (new Audio)'],
  [/\b(?:localStorage|sessionStorage|indexedDB)\b/, 'browser storage', 'src/economy/save.js'], // createSave's default storage
  [/\bcrypto\s*\.\s*(?:getRandomValues|randomUUID)\b/, 'crypto randomness'],
];

function walk(path, out = []) {
  const st = statSync(path);
  if (st.isFile()) {
    if (/\.m?js$/.test(path)) out.push(path);
    return out;
  }
  for (const f of readdirSync(path)) walk(join(path, f), out);
  return out;
}

/** Remove comments and string contents so prose that names a rule does not trip it. */
function codeOnly(src) {
  const keep = new RegExp(`^${THREE}$`); // module specifiers of three stay: the import rules read them
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, (s) => (keep.test(s) ? s : "''"));
}

/** Every forbidden use in one file's source: ['path:line uses what', ...]. `rel` is from the repo root. */
function scanLogic(rel, src) {
  const bad = [];
  codeOnly(src).split('\n').forEach((line, i) => {
    for (const [re, what, allowedIn] of FORBIDDEN) {
      if (allowedIn && rel === allowedIn) continue;
      if (re.test(line)) bad.push(`${rel}:${i + 1} uses ${what}`);
    }
  });
  return bad;
}

test('the logic purity scan catches clock, timer, audio, window and three.js leaks', () => {
  const caught = (line, file = 'src/sim/x.js') => scanLogic(file, line).length > 0;
  for (const line of [
    'const t = new Date().getTime();', 'const s = Date();', 'setTimeout(tick, 16);', 'const id = setInterval(f, 5);',
    'queueMicrotask(f);', 'const ctx = new webkitAudioContext();', 'const ctx = new AudioContext();',
    'const T = await import("three");', "const A = await import('three/addons/x.js');",
    "import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';",
    "import { Vector3 } from 'three';", 'new Audio("x.mp3").play();', 'const w = innerWidth;',
    'const r = devicePixelRatio || 1;', 'const s = localStorage.getItem(k);', 'window.innerHeight',
    'crypto.getRandomValues(buf);', 'requestAnimationFrame(step);', 'Math.random()', 'performance.now()',
  ]) assert.ok(caught(line), `not caught: ${line}`);
  for (const line of [
    'const w = field.innerWidth;', '// Date.now() is never used here', "const s = 'setTimeout(';",
    "/** @type {import('../core/types.js').World} */", 'const updated = level.date;', 'const k = audioKey;',
    "const m = await import('./data/ember.js');",
  ]) assert.ok(!caught(line), `false alarm: ${line}`);
  assert.ok(!caught('export function dailySeed(date = new Date()) {', 'src/core/rng.js'), 'rng.js may read the date (dailySeed)');
  assert.ok(caught('const d = new Date();', 'src/core/world.js'), 'no other logic file may');
  assert.ok(!caught('store = globalThis.localStorage;', 'src/economy/save.js'), 'save.js may default to localStorage');
  assert.ok(caught('store = globalThis.localStorage;', 'src/economy/economy.js'), 'no other logic file may');
});

test('game logic never reads the clock, Math.random, the DOM, three.js or audio', () => {
  const bad = [];
  for (const top of LOGIC) {
    let files;
    try { files = walk(join(ROOT, top)); } catch { continue; }
    for (const file of files) bad.push(...scanLogic(relative(ROOT, file).split('\\').join('/'), readFileSync(file, 'utf8')));
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

// Phase 3 (G): switched on once all 30 levels exist and the robot clears them one by one (CP2).
const campaignReady = LEVELS.length >= CAMPAIGN_LENGTH;
// On in the gate since 2026-10-22 (all 30 levels exist, about 1.5 s): it guards main while B and E
// still merge. KILN_CAMPAIGN=0 skips it for a quick local run.
const campaignSkip = !campaignReady
  ? `waits for all ${CAMPAIGN_LENGTH} levels (CP2): ${LEVELS.length} exist`
  : process.env.KILN_CAMPAIGN === '0' ? 'KILN_CAMPAIGN=0' : '';
// One campaign play serves both tests below (about 4 s). Each clear is banked into a save the way
// main.js's bankClear does (E's bankRun on the save data, then a write).
let campaignOnce = null;
function campaign() {
  if (campaignOnce) return campaignOnce;
  const storage = memoryStorage();
  const save = createSave(storage);
  const data = save.load();
  let lastScore = 0;
  let banked = 0;
  const c = playCampaign({
    seed: 1,
    maxSimMs: SIX_MINUTES_MS,
    onWorld(row, run, def) {
      const levelScore = row.score - lastScore;
      lastScore = row.score;
      if (!row.cleared) return;
      // a campaign level counts as cleared when its last stage is (The Core: stage 3)
      const cleared = def.n <= CAMPAIGN_LENGTH && !def.continues;
      banked += bankRun(data, run, { cleared, n: def.n, levelScore: cleared ? levelScore : undefined, wave: 0 }).gain;
      save.write(data);
    },
  });
  campaignOnce = { c, storage, save, data, banked };
  return campaignOnce;
}

test('full campaign 1 to 30 in one run', () => {
  const { c } = campaign();
  const last = c.worlds[c.worlds.length - 1];
  assert.deepEqual(c.missing, [], `levels missing: ${c.missing.join(', ')}`);
  assert.equal(c.outcome, 'finished', `the run ended "${c.outcome}" at ${last && last.id} (lives ${c.run.lives})`);
  assert.ok(c.worlds.some((w) => w.stage > 1), 'The Core chained into its later stages');
  for (const w of c.worlds) {
    assert.equal(w.lost, 0, `${w.id}: bus lost events`);
    assert.equal(w.problem, '', `${w.id}: ${w.problem}`);
  }
  assert.ok(c.run.score > 0, 'score carried across the run');
}, { timeout: 900000, skip: campaignSkip });

// Brief G task 2: the save survives a whole run. The clears were banked during the campaign play
// above; the run's end is banked the way endRun does; then a new session reads the storage back.
test('save round trip after a full campaign run', () => {
  const { c, storage, save, data } = campaign();
  let { banked } = campaign();
  assert.equal(c.outcome, 'finished');
  banked += bankRun(data, c.run, { over: false, n: c.run.levelN, wave: 0 }).gain; // endRun after the last level
  Object.assign(data.settings, { music: 0.35, sfx: 0.5, lite: true, liteSet: true, leftHanded: true, thumbPad: true });
  save.write(data);

  const back = createSave(storage).load(); // a new session on the same storage
  assert.deepEqual(back, data, 'the save reads back exactly as written');
  assert.equal(back.campaign.unlocked, CAMPAIGN_LENGTH + 1, 'every level cleared unlocks Overburn');
  for (let n = 1; n <= CAMPAIGN_LENGTH; n++) assert.equal(back.campaign.cleared[String(n)], true, `level ${n} recorded as cleared`);
  assert.equal(Object.keys(back.campaign.best).length, CAMPAIGN_LENGTH, 'a best score for each level');
  assert.ok(back.forge.embers > 0, 'the run banked embers');
  assert.equal(back.forge.embers, banked, 'embers banked = the sum of every bankRun gain');
  assert.equal(back.stats.runs, undefined, 'a finished campaign is not a lost run');
  assert.deepEqual(
    { music: back.settings.music, sfx: back.settings.sfx, lite: back.settings.lite, liteSet: back.settings.liteSet, leftHanded: back.settings.leftHanded, thumbPad: back.settings.thumbPad },
    { music: 0.35, sfx: 0.5, lite: true, liteSet: true, leftHanded: true, thumbPad: true },
  );
  // the next run starts from the loaded save (The Forge reads it)
  const next = createRun({ seed: 2, save: back });
  assert.ok(next.lives >= 1 && next.score === 0);
}, { timeout: 900000, skip: campaignSkip });
