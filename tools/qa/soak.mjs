#!/usr/bin/env node
// Kiln QA (G): soak runner. The robot plays many seeds of many levels headless and every world
// is checked: cleared inside 6 sim minutes, at most 3 nudges, no lost bus events, the busiest
// frame below the bus size, balls and paddle finite and in the field, every world.api call used
// is installed. Exit 1 when any world fails.
//
//   node tools/qa/soak.mjs                          every level that exists, seeds 1-5
//   node tools/qa/soak.mjs --levels 1-10,17 --seeds 1-20
//   node tools/qa/soak.mjs --campaign --seeds 1-3   whole runs 1 to 30 (lives and score carried)
//   node tools/qa/soak.mjs --overburn 1-5 --seeds 1-3
//   node tools/qa/soak.mjs --max-sim-s 120 --json out.json --quiet

import { writeFileSync } from 'node:fs';
import { BUS_CAP } from '../../src/core/bus.js';
import { getLevel, getStage, CAMPAIGN_LENGTH } from '../../src/levels/index.js';
import { generateOverburn } from '../../src/levels/overburn.js';
import { playWorld, playCampaign, existingLevels, SIX_MINUTES_MS } from './lib/play.mjs';

const MAX_NUDGES = 3;

function parseList(text) {
  const out = [];
  for (const part of String(text).split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`bad list "${text}" (use 1-5,8)`);
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    for (let i = a; i <= b; i++) out.push(i);
  }
  return out;
}

function parseArgs(argv) {
  const o = { levels: null, seeds: [1, 2, 3, 4, 5], campaign: false, overburn: null, maxSimMs: SIX_MINUTES_MS, json: '', quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--levels') o.levels = parseList(val());
    else if (a === '--seeds') o.seeds = parseList(val());
    else if (a === '--campaign') o.campaign = true;
    else if (a === '--overburn') o.overburn = parseList(val());
    else if (a === '--max-sim-s') o.maxSimMs = Number(val()) * 1000;
    else if (a === '--json') o.json = val();
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown option ${a} (try --help)`);
  }
  return o;
}

/** What is wrong with one played world ('' when nothing). */
function issues(r, maxSimMs) {
  const out = [];
  if (!r.result.cleared) out.push(r.result.phase === 'over' ? 'run over' : `not cleared in ${Math.round(maxSimMs / 1000)} s`);
  if (r.result.nudges > MAX_NUDGES) out.push(`${r.result.nudges} nudges`);
  if (r.lost) out.push(`${r.lost} events lost`);
  if (r.maxWindow >= BUS_CAP) out.push(`${r.maxWindow} events in one frame`);
  if (r.problem) out.push(r.problem);
  const missing = Object.keys(r.apiMissing);
  if (missing.length) out.push(`api missing: ${missing.join(' ')}`);
  return out.join('; ');
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

function soakLevels(defs, seeds, opts, log) {
  const rows = [];
  log(`${pad('level', 22)}${pad('mode', 7)}${lpad('cleared', 9)}${lpad('med s', 7)}${lpad('max s', 7)}${lpad('lives-', 7)}${lpad('nudge', 6)}${lpad('ev/frm', 8)}${lpad('wall s', 8)}  issues`);
  for (const def of defs) {
    const runs = seeds.map((seed) => {
      const r = playWorld(def, { seed, maxSimMs: opts.maxSimMs });
      return { seed, r, issue: issues(r, opts.maxSimMs) };
    });
    const cleared = runs.filter((x) => x.r.result.cleared).length;
    const sims = runs.map((x) => x.r.result.simMs / 1000);
    const bad = runs.filter((x) => x.issue);
    const row = {
      id: def.id, n: def.n, stage: def.stage | 0, mode: def.mode || 'bottom', seeds: seeds.length, cleared,
      medianSimS: median(sims), maxSimS: Math.max(...sims),
      livesLost: runs.reduce((s, x) => s + x.r.result.livesLost, 0),
      maxNudges: Math.max(...runs.map((x) => x.r.result.nudges)),
      maxWindow: Math.max(...runs.map((x) => x.r.maxWindow)),
      wallS: runs.reduce((s, x) => s + x.r.wallMs, 0) / 1000,
      failures: bad.map((x) => ({ seed: x.seed, issue: x.issue, hash: x.r.hash })),
    };
    rows.push(row);
    const label = `${def.n}${row.stage > 1 ? `.${row.stage}` : ''} ${def.id}`;
    const issueText = bad.length ? bad.slice(0, 3).map((x) => `seed ${x.seed}: ${x.issue}`).join(' | ') + (bad.length > 3 ? ` (+${bad.length - 3})` : '') : '';
    log(`${pad(label.slice(0, 21), 22)}${pad(row.mode, 7)}${lpad(`${cleared}/${seeds.length}`, 9)}${lpad(row.medianSimS.toFixed(0), 7)}${lpad(row.maxSimS.toFixed(0), 7)}${lpad(row.livesLost, 7)}${lpad(row.maxNudges, 6)}${lpad(row.maxWindow, 8)}${lpad(row.wallS.toFixed(1), 8)}  ${issueText}`);
  }
  return rows;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.help) {
    console.log('see the header of tools/qa/soak.mjs');
    process.exit(0);
  }
  const log = opts.quiet ? () => {} : (s) => console.log(s);
  const report = { when: new Date().toISOString(), maxSimMs: opts.maxSimMs, seeds: opts.seeds, levels: [], campaigns: [], overburn: [] };
  let failed = 0;

  if (opts.campaign) {
    log(`Campaign runs, levels 1-${CAMPAIGN_LENGTH}, seeds ${opts.seeds.join(',')}`);
    for (const seed of opts.seeds) {
      const c = playCampaign({ seed, maxSimMs: opts.maxSimMs });
      const last = c.worlds[c.worlds.length - 1];
      const bad = c.worlds.filter((w) => w.lost || w.problem || w.maxWindow >= BUS_CAP);
      const ok = c.outcome === 'finished' && !c.missing.length && !bad.length;
      if (!ok) failed++;
      report.campaigns.push({ seed, outcome: c.outcome, missing: c.missing, lives: c.run.lives, score: c.run.score, worlds: c.worlds });
      log(`  seed ${seed}: ${c.outcome}${last ? ` at ${last.n}${last.stage > 1 ? `.${last.stage}` : ''} ${last.id}` : ''}, ${c.worlds.length} worlds, lives ${c.run.lives}, score ${c.run.score}` +
        `${c.missing.length ? `, missing levels ${c.missing.join(',')}` : ''}${bad.length ? `, ${bad.length} worlds with bus/body problems` : ''}`);
    }
  }

  if (opts.overburn) {
    log(`Overburn waves ${opts.overburn.join(',')}, seeds ${opts.seeds.join(',')}`);
    const defs = opts.overburn.map((w) => generateOverburn(20261021, w));
    report.overburn = soakLevels(defs, opts.seeds, opts, log);
    failed += report.overburn.reduce((s, r) => s + r.failures.length, 0);
  }

  if (!opts.campaign && !opts.overburn || opts.levels) {
    const ns = opts.levels || existingLevels();
    const defs = [];
    const missing = [];
    for (const n of ns) {
      const def = getLevel(n);
      if (!def) { missing.push(n); continue; }
      for (let d = def; d; d = d.continues ? getStage(d.continues) : null) defs.push(d);
    }
    log(`Levels ${ns.join(',')}${missing.length ? ` (missing: ${missing.join(',')})` : ''}, seeds ${opts.seeds.join(',')}, ${opts.maxSimMs / 1000} sim s each`);
    report.levels = soakLevels(defs, opts.seeds, opts, log);
    report.missingLevels = missing;
    failed += report.levels.reduce((s, r) => s + r.failures.length, 0);
  }

  report.failed = failed;
  if (opts.json) writeFileSync(opts.json, JSON.stringify(report, null, 2));
  console.log(failed ? `\nSOAK FAILED: ${failed} world(s) or run(s) with problems` : '\nsoak ok');
  process.exit(failed ? 1 : 0);
}

main();
