// E's economy sweep (dev tool, not a test): play every level and stage headless with the robot
// and print one line of economy facts per world, so drop durations, scores, HEAT prices and the
// music curve can be tuned against the real 30 levels.
//   node tests/fixtures/E/sweep.mjs [seeds, e.g. 1,2,3] [levels, e.g. 22-30] [human] [noshield] [sum]
// Each level gets the run a player would carry there: the first Mod offered at every pick level
// up to it, and from 22 an Overload (Purge, Quench, Fork by seed).
// `human`: a slower hand that looks away now and then (LAPSE below: the paddle freezes), so balls
// are lost and embers missed the way a person loses them; use it to judge the music curve. The
// human buys a shield whenever HEAT allows (before an Overload is equipped), unless `noshield`.
// `sum`: one totals line per seed after the rows (lives lost, shields, Overloads per world).
// Columns: `music` share of time (%) on the stripped mix / a blend / the full mix; `h50` share of
// play time with HEAT at 50 or more; `ov` Overloads fired (`gap` median seconds between them) and
// `ovb` bricks an Overload broke itself; `sh` shields bought / used.

import { LEVELS, stagesOf } from '../../../src/levels/index.js';
import { createWorld, stepWorld } from '../../../src/core/world.js';
import { createInputFrame, clearEdges } from '../../../src/core/input-frame.js';
import { createReader, next } from '../../../src/core/bus.js';
import { EV } from '../../../src/core/events.js';
import { DROP_NAMES, SRC, PICKS } from '../../../src/core/constants.js';
import { makeSystems } from '../../../src/systems.js';
import { createRun } from '../../../src/economy/economy.js';
import { createRobot } from '../../../src/sim/robot.js';
import { modChoices, applyMod } from '../../../src/economy/mods.js';
import { chooseOverload } from '../../../src/economy/overloads.js';
import { pathToFileURL } from 'node:url';

const MAX_MS = 6 * 60 * 1000;

/** Human mode: paddle speed u/s; a lapse every EVERY..EVERY+EVERY_RND ms lasting FOR..FOR+FOR_RND ms. */
const LAPSE = { SPEED: 1400, EVERY: 3000, EVERY_RND: 5000, FOR: 900, FOR_RND: 900 };

/** The robot with lapses: now and then it looks away (paddle frozen, no taps). */
function createLapses(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  let nextAt = LAPSE.EVERY + rnd() * LAPSE.EVERY_RND;
  let until = -1;
  let tx = 0, ty = 0;
  return {
    apply(frame, world) {
      const t = world.time;
      if (t >= nextAt && until < 0) {
        until = t + LAPSE.FOR + rnd() * LAPSE.FOR_RND;
        tx = frame.tx;
        ty = frame.ty;
      }
      if (until >= 0) {
        if (t < until) {
          frame.tx = tx;
          frame.ty = ty;
          frame.action = false;
          frame.pull = false;
          frame.overload = false;
          return;
        }
        until = -1;
        nextAt = t + LAPSE.EVERY + rnd() * LAPSE.EVERY_RND;
      }
    },
  };
}

/** A shield can be bought now (the overload input before an Overload is equipped). */
function wantShield(world) {
  const e = world.econ;
  return world.phase === 'play' && !world.run.overload && !!world.level.rules.heat &&
    world.effects.shield < 1 && e.shieldCost > 0 && e.heat >= e.shieldCost;
}

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};

/**
 * Play one level (all its stages) on one seed; returns one row per stage world.
 * @param {object} l level def
 * @param {number} seed
 * @param {{human?:boolean, shields?:boolean, overload?:number, forge?:object, tweak?:(world:object)=>void, onStep?:(world:object)=>void}|boolean} [opts]
 *   human: lapses; shields: buy shields (default on in human mode); overload: the Overload from 22
 *   (default Purge, Quench, Fork by seed); forge: The Forge ranks the run carries ({overload: 2});
 *   tweak: called on each new world; onStep: called after every step with the world
 */
export function sweepLevel(l, seed, opts = {}) {
  if (typeof opts === 'boolean') opts = { human: opts };
  const human = !!opts.human;
  const shields = opts.shields ?? human;
  const out = [];
  const run = createRun({ seed, levelN: l.n, save: opts.forge ? { forge: { embers: 0, ranks: opts.forge } } : undefined });
  for (const m of PICKS.MOD_LEVELS) {
    if (m > l.n) break;
    run.levelN = m;
    applyMod(run, modChoices(run)[0].id);
  }
  run.levelN = l.n;
  if (l.n >= 22) chooseOverload(run, opts.overload || 1 + (seed % 3));
  for (const d of stagesOf(l)) {
    const world = createWorld({ level: d, seed: seed * 1000 + d.n * 31 + (d.stage | 0), run, systems: makeSystems() });
    if (opts.tweak) opts.tweak(world);
    const bot = createRobot(human ? { maxSpeed: LAPSE.SPEED } : {});
    const lapses = human ? createLapses(seed * 1000 + d.n * 31 + (d.stage | 0)) : null;
    const frame = createInputFrame();
    const rd = createReader(world.bus, 'sweep', 0);
    const s = {
      id: d.id, n: d.n, kind: d.kind, embersSpawned: 0, drops: {}, dropsCaught: 0, maxMult: 1, maxHeat: 0,
      lives: 0, overloads: 0, ovAt: [], ovBricks: 0, ventSteps: 0, shields: 0, shieldsUsed: 0, hl: [0, 0, 0], h50: 0,
      playSteps: 0, nan: 0, burnt: 0, broken: 0, bossBroken: 0, dropsAfterClear: 0,
    };
    let won = false;
    while (world.time < MAX_MS && world.phase !== 'cleared' && world.phase !== 'over') {
      bot.fill(frame, world);
      if (shields && wantShield(world)) frame.overload = true;
      if (lapses) lapses.apply(frame, world);
      stepWorld(world, frame);
      clearEdges(frame);
      if (opts.onStep) opts.onStep(world);
      const hl = world.fx.heatLevel;
      s.hl[hl < 0.35 ? 0 : hl < 0.75 ? 1 : 2]++;
      if (world.phase === 'play') {
        s.playSteps++;
        if (world.econ.heat >= 50) s.h50++;
        if (world.econ.ventMs > 0) s.ventSteps++;
      }
      if (!Number.isFinite(world.run.score) || !Number.isFinite(world.econ.heat) || !Number.isFinite(hl)) s.nan++;
      s.maxHeat = Math.max(s.maxHeat, world.econ.heat);
      s.maxMult = Math.max(s.maxMult, world.econ.mult);
      while (next(rd)) {
        switch (rd.type) {
          case EV.EMBERS_BURST: s.embersSpawned += rd.a; break;
          case EV.DROP_SPAWNED: {
            const k = DROP_NAMES[rd.a];
            s.drops[k] = (s.drops[k] || 0) + 1;
            if (won) s.dropsAfterClear++;
            break;
          }
          case EV.DROP_CAUGHT: s.dropsCaught++; break;
          case EV.LIFE_LOST: s.lives++; break;
          case EV.OVERLOAD_FIRED: s.overloads++; s.ovAt.push(world.time); break;
          case EV.SHIELD_BOUGHT: s.shields++; break;
          case EV.SHIELD_USED: s.shieldsUsed++; break;
          case EV.BRICK_BURNT: s.burnt++; break;
          case EV.BRICK_BROKEN:
            s.broken++;
            if (rd.b === SRC.BOSS) s.bossBroken++;
            if (rd.b === SRC.OVERLOAD) s.ovBricks++;
            break;
          default: break;
        }
      }
      if (world.level.total > 0 && world.level.remaining <= 0) won = true;
    }
    const tot = s.hl[0] + s.hl[1] + s.hl[2] || 1;
    const gaps = [];
    for (let k = 1; k < s.ovAt.length; k++) gaps.push((s.ovAt[k] - s.ovAt[k - 1]) / 1000);
    Object.assign(s, {
      phase: world.phase,
      t: Math.round(world.time / 1000),
      score: world.econ.levelScore,
      bonus: world.econ.clearBonus + world.econ.cavityBonus,
      caught: world.econ.embersCaught,
      api: Object.keys(world.stats.apiMissing || {}).join(','),
      hlp: s.hl.map((v) => Math.round((100 * v) / tot)).join('/'),
      h50p: Math.round((100 * s.h50) / (s.playSteps || 1)),
      gap: median(gaps),
    });
    out.push(s);
    if (world.phase === 'over') break;
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const seeds = (process.argv[2] || '1').split(',').map(Number);
  const [lo, hi] = (process.argv[3] || '1-30').split('-').map(Number);
  const human = process.argv.includes('human');
  const shields = human && !process.argv.includes('noshield');
  const sum = process.argv.includes('sum');
  for (const seed of seeds) {
    const t = { plays: 0, lives: 0, shields: 0, used: 0, ov: 0, ovPlays: 0, ovb: 0, broken: 0 };
    for (const l of LEVELS) {
      if (l.n < lo || l.n > hi) continue;
      for (const s of sweepLevel(l, seed, { human, shields })) {
        const dr = Object.entries(s.drops).map(([k, v]) => k + v).join(' ');
        console.log(
          `${seed} ${s.id.padEnd(24)} ${s.phase.padEnd(7)} ${String(s.t).padStart(4)}s ` +
          `score ${String(s.score).padStart(7)} bonus ${String(s.bonus).padStart(6)} ` +
          `embers ${s.caught}/${s.embersSpawned} broken ${s.broken} boss ${s.bossBroken} burnt ${s.burnt} ` +
          `x${s.maxMult} heat ${Math.round(s.maxHeat)} h50 ${s.h50p} lost ${s.lives} ` +
          `ov ${s.overloads} gap ${s.gap} ovb ${s.ovBricks} sh ${s.shields}/${s.shieldsUsed} ` +
          `music ${s.hlp} drops[${dr}] caught ${s.dropsCaught} late ${s.dropsAfterClear}` +
          (s.nan ? ` NaN ${s.nan}` : '') + (s.api ? ` api ${s.api}` : ''),
        );
        t.plays++;
        t.lives += s.lives;
        t.shields += s.shields;
        t.used += s.shieldsUsed;
        t.broken += s.broken;
        if (s.n >= 22) { t.ov += s.overloads; t.ovPlays++; t.ovb += s.ovBricks; }
      }
    }
    if (sum) {
      console.log(
        `${seed} SUM worlds ${t.plays} lost ${t.lives} shields ${t.shields}/${t.used} ` +
        `overloads ${t.ov} in ${t.ovPlays} worlds (${(t.ov / (t.ovPlays || 1)).toFixed(1)} each), ` +
        `Overload bricks ${t.ovb} of ${t.broken}`,
      );
    }
  }
}
