// Every contact a ball or laser makes with a boss, and what the game did with it. Deterministic
// for a seed; the imprecise controller is the predictive robot seen through a reaction lag and a
// drifting aim error (tests/fixtures/B/sloppy.mjs), not a model of human discovery.
// node tests/fixtures/B/boss-contacts.mjs --level 20 --seeds 6 --err 24 --lag 150 --out /tmp/contacts.json
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hereRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Outcome names, in the order the summary prints them. */
export const OUTCOMES = ['counted', 'cooldown', 'guard', 'shell-outside', 'shell-inside', 'jaw', 'head', 'beaten', 'silent'];

/**
 * @param {{root?:string, n?:number, seeds?:number, human?:boolean, errUnits?:number, lagMs?:number, maxSimMs?:number, keep?:boolean}} [o]
 */
export async function measureContacts(o = {}) {
  const root = resolve(o.root || hereRoot);
  const load = (p) => import(pathToFileURL(resolve(root, p)).href);
  // the game comes from --root (so an older checkout can be measured); the players from here
  const mine = (p) => import(pathToFileURL(resolve(hereRoot, p)).href);
  const [{ createWorld }, { runHeadless }, { makeSystems }, { createRun }, { createSloppyRobot }, { createHumanish }, { getLevel, stagesOf }, { EV }, { createReader, next }, { BF, BRICK }] = await Promise.all([
    load('src/core/world.js'), load('src/core/headless.js'), load('src/systems.js'), load('src/economy/economy.js'),
    mine('tests/fixtures/B/sloppy.mjs'), mine('tests/fixtures/B/human.mjs'), load('src/levels/index.js'), load('src/core/events.js'), load('src/core/bus.js'), load('src/core/constants.js'),
  ]);
  const n = o.n ?? 20, seeds = o.seeds ?? 6;
  const runs = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const run = createRun({ seed, levelN: n });
    let totalMs = 0, cleared = true;
    const stages = [];
    for (const def of stagesOf(getLevel(n))) {
      const w = createWorld({ level: def, seed: seed * 1000 + 31 * def.n + (def.stage | 0), run, systems: makeSystems() });
      const rd = createReader(w.bus, 'boss-contacts', 0);
      const contacts = [];
      const counts = Object.fromEntries(OUTCOMES.map((k) => [k, 0]));
      let pending = []; // core contacts this step, waiting for their BOSS_HIT / BOSS_BLOCKED
      const ringR = () => {
        // the outermost plate radius, measured once from the live bricks
        const B = w.bricks;
        let r = 0;
        for (let i = 0; i < B.count; i++) if (B.alive[i] && (B.flags[i] & BF.MOVING) && (B.flags[i] & BF.BOSS)) r = Math.max(r, Math.hypot(B.x[i] - w.boss.x, B.y[i] - w.boss.y));
        return r;
      };
      const R = def.boss === 'stoker' ? 0 : ringR();
      const r0 = R; // inner rings sit inside this; a contact point outside a plate's own radius is "outside"
      void r0;
      const player = o.human
        ? createHumanish(seed * 7 + def.n, { errUnits: o.errUnits ?? 18, lagMs: o.lagMs ?? 160 })
        : createSloppyRobot(seed * 7 + def.n, { errUnits: o.errUnits ?? 12, lagMs: o.lagMs ?? 0 });
      const res = runHeadless(w, player, {
        maxSimMs: o.maxSimMs ?? 8 * 60 * 1000,
        onStep(world) {
          const B = world.bricks;
          while (next(rd)) {
            const t = Math.round(world.time);
            if (rd.type === EV.BRICK_HIT && (B.flags[rd.id] & BF.BOSS)) {
              const i = rd.id;
              if (B.type[i] === BRICK.WEAK) { pending.push({ t, x: Math.round(rd.x), y: Math.round(rd.y), src: rd.b, hp: world.boss.hp }); continue; }
              let kind;
              if (def.boss === 'stoker') kind = B.type[i] === BRICK.ARMOURED ? 'jaw' : 'head';
              else {
                const pr = Math.hypot(B.x[i] - world.boss.x, B.y[i] - world.boss.y);
                const cr = Math.hypot(rd.x - world.boss.x, rd.y - world.boss.y);
                kind = cr >= pr ? 'shell-outside' : 'shell-inside';
              }
              counts[kind]++;
              contacts.push({ t, outcome: kind, src: rd.b });
            } else if (rd.type === EV.BOSS_HIT || rd.type === EV.BOSS_BLOCKED) {
              const c = pending.shift() || { t, src: -1 };
              c.outcome = rd.type === EV.BOSS_HIT ? 'counted' : rd.a ? 'guard' : 'cooldown';
              counts[c.outcome]++;
              contacts.push(c);
            }
          }
          // a contact with no outcome on a beaten core is part of its break-up; any other is silent
          for (const c of pending) { c.outcome = world.boss.hp <= 0 ? 'beaten' : 'silent'; counts[c.outcome]++; contacts.push(c); }
          pending = [];
        },
      });
      totalMs += res.simMs;
      const core = contacts.filter((c) => c.outcome === 'counted' || c.outcome === 'cooldown' || c.outcome === 'guard' || c.outcome === 'silent');
      // The playtest's dozen: in every run of 12 consecutive core contacts, how many counted?
      let worstDozen = Infinity, dozens = 0, dozenSum = 0;
      for (let k = 0; k + 12 <= core.length; k++) {
        const got = core.slice(k, k + 12).filter((c) => c.outcome === 'counted').length;
        worstDozen = Math.min(worstDozen, got);
        dozenSum += got;
        dozens++;
      }
      const countedT = core.filter((c) => c.outcome === 'counted').map((c) => c.t);
      const gaps = countedT.slice(1).map((t, k) => t - countedT[k]).sort((a, b) => a - b);
      stages.push({
        id: def.id, cleared: res.cleared, phase: res.phase, simMs: res.simMs, livesLost: res.livesLost, hpLeft: w.boss.hp, hpMax: w.boss.hpMax,
        counts, coreContacts: core.length, countedShare: core.length ? +(counts.counted / core.length).toFixed(3) : 0,
        worstDozen: dozens ? worstDozen : null, meanDozen: dozens ? +(dozenSum / dozens).toFixed(2) : null,
        firstCountedMs: countedT[0] ?? null, medianGapMs: gaps.length ? gaps[gaps.length >> 1] : null, longestGapMs: gaps.length ? gaps[gaps.length - 1] : null,
        contacts: o.keep ? contacts : undefined,
      });
      if (!res.cleared) { cleared = false; break; }
    }
    runs.push({ seed, cleared, simMs: totalMs, stages });
  }
  return { n, seeds, controller: o.human ? 'human' : 'sloppy', errUnits: o.errUnits ?? (o.human ? 18 : 12), lagMs: o.lagMs ?? (o.human ? 160 : 0), runs };
}

/** The value a share `p` of the way up a sorted list (0.5 the median, 0.9 the 90th percentile). */
function pct(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN;
}

/**
 * One line per stage id: clears, median and 90th percentile of clear times (the median alone
 * hides the long fights: review Oct 27), how the others ended, outcome totals.
 */
export function summarise(result) {
  const lines = [];
  const times = result.runs.filter((r) => r.cleared).map((r) => r.simMs / 1000).sort((a, b) => a - b);
  lines.push(`level ${result.n} ${result.controller} err ${result.errUnits} lag ${result.lagMs}: ${times.length}/${result.runs.length} clear; times ${times.map((t) => t.toFixed(0)).join(',')} s; median ${pct(times, 0.5).toFixed(0)} s, 90th percentile ${pct(times, 0.9).toFixed(0)} s`);
  const ids = [...new Set(result.runs.flatMap((r) => r.stages.map((s) => s.id)))];
  for (const id of ids) {
    const ss = result.runs.flatMap((r) => r.stages.filter((s) => s.id === id));
    const tot = Object.fromEntries(OUTCOMES.map((k) => [k, ss.reduce((a, s) => a + s.counts[k], 0)]));
    const core = tot.counted + tot.cooldown + tot.guard + tot.silent;
    const st = ss.filter((s) => s.cleared).map((s) => s.simMs / 1000).sort((a, b) => a - b);
    const over = ss.filter((s) => !s.cleared && s.phase === 'over').length, slow = ss.filter((s) => !s.cleared && s.phase !== 'over').length;
    lines.push(`  ${id}: ${st.length}/${ss.length} clear (median ${pct(st, 0.5).toFixed(0)} s, 90th percentile ${pct(st, 0.9).toFixed(0)} s; out of lives ${over}, timed out ${slow}); core contacts ${core}, counted ${tot.counted} (${(100 * tot.counted / Math.max(1, core)).toFixed(0)}%), cooldown ${tot.cooldown}, guard ${tot.guard}, silent ${tot.silent} (after defeat ${tot.beaten}); shell outside ${tot['shell-outside']}, inside ${tot['shell-inside']}; jaw ${tot.jaw}, head ${tot.head}; worst dozen ${ss.map((s) => s.worstDozen ?? '-').join(',')}; longest wait ${ss.map((s) => s.longestGapMs === null ? '-' : (s.longestGapMs / 1000).toFixed(0)).join(',')} s`);
  }
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
  const result = await measureContacts({
    root: arg('--root', hereRoot), n: Number(arg('--level', 20)), seeds: Number(arg('--seeds', 6)),
    human: process.argv.includes('--human'), keep: process.argv.includes('--keep'),
    errUnits: arg('--err', null) === null ? undefined : Number(arg('--err')),
    lagMs: arg('--lag', null) === null ? undefined : Number(arg('--lag')),
  });
  const out = arg('--out', '');
  if (out) writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
  console.log(summarise(result));
}
