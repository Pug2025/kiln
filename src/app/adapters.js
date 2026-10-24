// Kiln: adapters to other agents' screen-facing exports (OWNER: D).
//
// The screens need pure data and rules owned by E (Mods, Overloads, The Forge, banking, credits,
// music track names), B (gate twists) and C (the wordmark flame). Each is looked up by name in the
// owner's seeded entry module first, then in the module the brief names (only if present.js, which
// sw-files.mjs generates from git, says it exists), and falls back to fallbacks.js meanwhile. Shapes are normalised to {id, name, fact} for the
// screens. Nothing here touches world state.

import * as economy from '../economy/economy.js';
import * as saveMod from '../economy/save.js';
import * as levels from '../levels/index.js';
import * as audioMod from '../audio/audio.js';
import * as renderMod from '../render/renderer.js';
import { createRng } from '../core/rng.js';
import { worldOf } from './flow.js';
import { MODS, OVERLOADS, FORGE_ITEMS, forgePrice, TWISTS, TWIST_FACTS, CREDIT_LINES } from './fallbacks.js';
import { PRESENT } from './present.js';

/** Where the brief says each export lives (loaded only when the entry modules lack it). */
const HOME = {
  modChoices: '../economy/mods.js', applyMod: '../economy/mods.js', MODS: '../economy/mods.js',
  OVERLOADS: '../economy/overloads.js', chooseOverload: '../economy/overloads.js', overloadChoices: '../economy/overloads.js',
  FORGE_ITEMS: '../economy/forge.js', forgePrice: '../economy/forge.js', nextPrice: '../economy/forge.js',
  buyRank: '../economy/forge.js', bankRun: '../economy/forge.js', recordClear: '../economy/forge.js',
  ballKindsUnlocked: '../economy/forge.js', BALL_KIND_NAMES: '../economy/forge.js',
  creditLines: '../audio/credits.js', CREDIT_LINES: '../audio/credits.js', CREDITS: '../audio/credits.js',
  trackFor: '../audio/music.js',
  createWordmarkFlame: '../render/wordmark.js',
  createTitleWall: '../render/wordmark.js', // ART 15.6 C16, when C ships it
  twistsFor: '../levels/twists.js', applyTwist: '../levels/twists.js',
};

const pickName = (o) => o && (o.name ?? o.label ?? o.title);
const pickFact = (o) => o && (o.fact ?? o.desc ?? o.description ?? o.text ?? o.effect ?? '');

/** Normalise one option (object, id or name) against an optional pool. */
function norm(item, pool) {
  if (item && typeof item === 'object') {
    const id = item.id ?? item.key ?? pickName(item);
    return { id, name: String(pickName(item) ?? id), fact: String(pickFact(item) || ''), raw: item };
  }
  const found = pool && pool.find((p) => p.id === item || p.key === item || pickName(p) === item);
  if (found) return norm(found);
  return { id: item, name: String(item), fact: '', raw: item };
}

const asList = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);

/**
 * Resolve every optional export once at boot.
 * @returns {Promise<object>} the normalised adapter API (see the bottom of this file)
 */
export async function loadAdapters() {
  const found = {};
  const entry = [economy, saveMod, levels, audioMod, renderMod];
  for (const name of Object.keys(HOME)) {
    for (const ns of entry) if (ns[name] !== undefined) { found[name] = ns[name]; break; }
  }
  const missing = [...new Set(Object.keys(HOME).filter((n) => found[n] === undefined).map((n) => HOME[n]))]
    .filter((path) => PRESENT.includes(path.slice(3))); // never ask for a file that is not there
  await Promise.all(missing.map(async (path) => {
    try {
      const mod = await import(path);
      for (const [name, home] of Object.entries(HOME)) if (home === path && found[name] === undefined && mod[name] !== undefined) found[name] = mod[name];
    } catch { /* not built yet: the fallback stays */ }
  }));
  return makeApi(found);
}

function makeApi(f) {
  const modPool = asList(f.MODS);
  const overloadPool = asList(f.OVERLOADS);
  const forgePool = asList(f.FORGE_ITEMS);

  return {
    real: {
      mods: typeof f.modChoices === 'function',
      overloads: typeof f.chooseOverload === 'function',
      forge: typeof f.buyRank === 'function',
      twists: typeof f.twistsFor === 'function',
      credits: !!(f.CREDIT_LINES || f.CREDITS),
      wordmark: typeof f.createWordmarkFlame === 'function',
    },

    /** Three Mods for this run at this level. */
    modChoices(run, n) {
      const rng = createRng(((run.seed | 0) * 31 + n * 7919 + (run.overburnWave | 0)) >>> 0);
      if (typeof f.modChoices === 'function') {
        try { return asList(f.modChoices(run, rng, 3)).map((m) => norm(m, modPool)); } catch (e) { console.warn('[kiln] modChoices', e); }
      }
      const pool = MODS.slice();
      const out = [];
      while (out.length < 3 && pool.length) out.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
      return out.map((m) => norm(m));
    },
    applyMod(run, id) {
      if (typeof f.applyMod === 'function') f.applyMod(run, id);
    },

    /** The Overload pick cards, with facts for the run's Forge rank when E gives them. */
    overloadChoices(run) {
      if (typeof f.overloadChoices === 'function') {
        try {
          const own = asList(f.overloadChoices(run)).map((o) => norm(o, overloadPool)).filter((o) => o.id !== 0 && o.id !== '' && o.name);
          if (own.length) return own;
        } catch (e) { console.warn('[kiln] overloadChoices', e); }
      }
      const pool = overloadPool.length ? overloadPool : OVERLOADS;
      return pool.map((o) => norm(o)).filter((o) => o.id !== 0 && o.id !== '' && o.name);
    },
    chooseOverload(run, id) {
      if (typeof f.chooseOverload === 'function') f.chooseOverload(run, id);
    },

    /**
     * The Forge as the screen shows it. Each item's fact is what the next rank gives (the top
     * rank's fact once maxed), from E's per-rank facts when it has them.
     */
    forgeModel(save) {
      const ranks = save.forge.ranks || {};
      const pool = forgePool.length ? forgePool : FORGE_ITEMS;
      const embers = save.forge.embers | 0;
      const items = pool.map((it) => {
        const o = norm(it);
        const perRank = Array.isArray(it.ranks) ? it.ranks : null;
        const max = it.max ?? (perRank ? perRank.length : Array.isArray(it.prices) ? it.prices.length : 3);
        const rank = Math.max(0, Math.min(max, ranks[o.id] | 0));
        let price = 0;
        if (rank < max) {
          if (typeof f.nextPrice === 'function') price = f.nextPrice(save, o.id);
          else if (typeof f.forgePrice === 'function') price = f.forgePrice(o.id, rank + 1);
          else if (Array.isArray(it.prices)) price = it.prices[rank];
          else price = forgePrice(o.id, rank + 1);
          price = Math.max(0, price | 0);
        }
        const fact = perRank ? String(perRank[Math.min(rank, max - 1)] || '') : o.fact;
        return { ...o, fact, max, rank, price, affordable: rank < max && embers >= price };
      });
      return { embers, items };
    },
    /** Buy the next rank of an item; true when bought. */
    buyRank(save, id) {
      if (typeof f.buyRank === 'function') {
        const r = f.buyRank(save, id);
        return r && typeof r === 'object' ? !!r.ok : !!r;
      }
      const m = this.forgeModel(save).items.find((it) => it.id === id);
      if (!m || !m.affordable) return false;
      save.forge.embers -= m.price;
      save.forge.ranks[id] = m.rank + 1;
      return true;
    },
    /** Ball kinds this save may start a run with, as {id, name}. */
    ballKinds(save) {
      const names = asList(f.BALL_KIND_NAMES).length ? asList(f.BALL_KIND_NAMES) : ['Standard', 'Heavy', 'Splitter', 'Sniper'];
      const ids = typeof f.ballKindsUnlocked === 'function' ? asList(f.ballKindsUnlocked(save)) : [0];
      return ids.map((id) => ({ id, name: names[id] || String(id) }));
    },

    /**
     * Bank the run's new embers (E banks only what is new since the last call, so this runs after
     * every cleared level and again when the run ends). result: {cleared, over, n, levelScore, wave}.
     * @returns {boolean} true when E also recorded the clear (campaign progress, bests)
     */
    bankRun(save, run, result) {
      if (typeof f.bankRun === 'function') { f.bankRun(save, run, result); return true; }
      if (result.cleared) return false; // the caller records the clear (flow.recordClear)
      save.forge.embers = (save.forge.embers | 0) + Math.max(0, (run.embersBanked | 0) - (run.banked | 0));
      if (result.wave) {
        save.overburn.best = Math.max(save.overburn.best | 0, run.score | 0);
        save.overburn.bestWave = Math.max(save.overburn.bestWave | 0, result.wave | 0);
      }
      return false;
    },

    /** Gate doors for the next level. */
    twistsFor(n) {
      if (typeof f.twistsFor === 'function') {
        try {
          const t = asList(f.twistsFor(n)).map((x) => norm(x));
          const def = typeof levels.getLevel === 'function' ? levels.getLevel(n) : null;
          for (const d of t) {
            if (d.fact) continue;
            d.fact = d.id === 'moving' && def && def.mode === 'left' ? 'Two columns slide' : TWIST_FACTS[d.id] || '';
          }
          if (t.length >= 2) return t.slice(0, 2);
        } catch (e) { console.warn('[kiln] twistsFor', e); }
      }
      return TWISTS.map((t) => norm(t));
    },
    applyTwist(def, id) {
      if (typeof f.applyTwist === 'function') {
        try { return f.applyTwist(def, id) || def; } catch (e) { console.warn('[kiln] applyTwist', e); }
      }
      return def;
    },

    creditLines() {
      if (typeof f.creditLines === 'function') {
        try {
          const l = asList(f.creditLines()).filter((x) => typeof x === 'string' && x);
          if (l.length) return l;
        } catch { /* fall through */ }
      }
      const src = f.CREDIT_LINES || f.CREDITS;
      const lines = asList(src).map((l) => (typeof l === 'string' ? l : l && (l.line ?? l.text ?? pickName(l))))
        .filter(Boolean);
      return lines.length ? lines : CREDIT_LINES;
    },

    createWordmarkFlame: typeof f.createWordmarkFlame === 'function' ? f.createWordmarkFlame : null,
    /** C's live title wall (ART 15.6 C16): createTitleWall(host, {reduceMotion}) returns {dispose()}. */
    createTitleWall: typeof f.createTitleWall === 'function' ? f.createTitleWall : null,

    /** Music track for a level def. */
    trackFor(def) {
      if (typeof f.trackFor === 'function') {
        try { return f.trackFor(def); } catch { /* fall through */ }
      }
      if (def.world === 'overburn' || def.n > 30) return 'overburn';
      if (def.kind === 'boss') return 'boss';
      return def.world || worldOf(def.n);
    },
  };
}
