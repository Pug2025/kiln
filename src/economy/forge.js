// Kiln: The Forge (OWNER: E). Embers banked across runs buy permanent ranks in six items.
// Pure functions over SaveData and RunState: D's Forge screen calls them, createRun applies them.
// No DOM, no clock.

import { FORGE_FX } from './tuning.js';

export const BALL_KIND = Object.freeze({ STANDARD: 0, HEAVY: 1, SPLITTER: 2, SNIPER: 3 });
export const BALL_KIND_NAMES = Object.freeze(['Standard', 'Heavy', 'Splitter', 'Sniper']);

/**
 * The six items, three ranks each. `fact` is the item's one-line description; `ranks[r-1]` is the
 * short fact for rank r (information, never an instruction); `prices[r-1]` is what rank r costs
 * in banked embers; `max` is the top rank.
 */
export const FORGE_ITEMS = Object.freeze([
  { id: 'lives', name: 'Start lives', fact: 'More lives at the start of each run', ranks: ['Start with 4 lives', 'Start with 5 lives', '5 lives; first miss costs no life'], prices: [200, 500, 1000] },
  { id: 'heat', name: 'HEAT size', fact: 'Store more HEAT', ranks: ['Stores up to 120 HEAT', 'Stores up to 140 HEAT', 'Stores up to 160 HEAT'], prices: [150, 400, 800] },
  { id: 'paddle', name: 'Paddle width', fact: 'Wider starting paddle', ranks: ['Starting width: 120 → 130', 'Starting width: 130 → 140', 'Starting width: 140 → 150'], prices: [150, 400, 800] },
  { id: 'embers', name: 'Ember value', fact: 'More embers saved for The Forge', ranks: ['Banks 25% more embers', 'Banks 50% more embers', 'Banks twice the embers'], prices: [250, 600, 1200] },
  { id: 'overload', name: 'Overload power', fact: 'Stronger effects; shorter HEAT cooldown', ranks: ['HEAT paused 10 s; Purge 4 rows; Quench 4 s', 'HEAT paused 8 s; Quench 5 s; Fork: 3 per ball', 'HEAT paused 6 s; Purge 5 rows; Quench 6 s'], prices: [200, 500, 1000] },
  { id: 'ball', name: 'Ball type', fact: 'Unlock a choice of starting ball', ranks: ['Heavy: 10% slower, 2 damage', 'Splitter: perfect hits add a ball, max 3', 'Sniper: always shows the aim line'], prices: [300, 700, 1400] },
].map((it) => Object.freeze({ ...it, max: it.ranks.length, ranks: Object.freeze(it.ranks), prices: Object.freeze(it.prices) })));

export const FORGE_IDS = Object.freeze(FORGE_ITEMS.map((it) => it.id));
export const MAX_RANK = 3;

const ITEM = Object.fromEntries(FORGE_ITEMS.map((it) => [it.id, it]));

/** Rank 0…3 for every item from a save (missing or bad values read as 0). */
export function ranksOf(save) {
  const src = (save && save.forge && save.forge.ranks) || {};
  const out = {};
  for (const id of FORGE_IDS) {
    const r = Number(src[id]);
    out[id] = Number.isFinite(r) ? Math.max(0, Math.min(MAX_RANK, Math.floor(r))) : 0;
  }
  return out;
}

/** Ranks snapshot carried by a run (all zero when the run has none). */
export function runRanks(run) {
  return (run && run.forge) || ZERO_RANKS;
}
const ZERO_RANKS = Object.freeze(Object.fromEntries(FORGE_IDS.map((id) => [id, 0])));

/**
 * Price of buying `rank` (1…3) of an item, or −1 if there is no such rank.
 * @param {string} id
 * @param {number} rank
 */
export function forgePrice(id, rank) {
  const it = ITEM[id];
  if (!it || rank < 1 || rank > MAX_RANK) return -1;
  return it.prices[rank - 1];
}

/** Next rank's price for this save, or −1 when maxed. */
export function nextPrice(save, id) {
  const r = ranksOf(save)[id];
  return r >= MAX_RANK ? -1 : forgePrice(id, r + 1);
}

/**
 * Buy the next rank of an item with banked embers. Mutates the save.
 * @returns {{ok:boolean, rank:number, price:number, reason?:string}}
 */
export function buyRank(save, id) {
  if (!ITEM[id]) return { ok: false, rank: 0, price: -1, reason: 'unknown' };
  const ranks = ranksOf(save);
  const rank = ranks[id];
  if (rank >= MAX_RANK) return { ok: false, rank, price: -1, reason: 'max' };
  const price = forgePrice(id, rank + 1);
  const embers = Math.max(0, Math.floor(Number(save.forge && save.forge.embers) || 0));
  if (embers < price) return { ok: false, rank, price, reason: 'embers' };
  if (!save.forge) save.forge = { embers: 0, ranks: {} };
  if (!save.forge.ranks) save.forge.ranks = {};
  save.forge.embers = embers - price;
  save.forge.ranks[id] = rank + 1;
  return { ok: true, rank: rank + 1, price };
}

/** Ball kinds this save may start a run with (Standard always; the rest by the ball item's rank). */
export function ballKindsUnlocked(save) {
  const r = ranksOf(save).ball;
  const out = [BALL_KIND.STANDARD];
  for (let k = 1; k <= r; k++) out.push(k);
  return out;
}

/**
 * Record a cleared campaign level: cleared flag, next level unlocked (31 = Overburn), best level
 * score. Mutates the save. bankRun calls it when result.cleared; D may call it on its own.
 * @param {import('../core/types.js').SaveData} save
 * @param {number} n level number
 * @param {number} [levelScore]
 * @param {import('../core/types.js').RunState} [run] unused, kept for D's adapter signature
 */
export function recordClear(save, n, levelScore, run) {
  void run;
  if (!save.campaign) save.campaign = { unlocked: 1, best: {}, cleared: {} };
  if (!save.campaign.best) save.campaign.best = {};
  if (!save.campaign.cleared) save.campaign.cleared = {};
  if (!save.stats) save.stats = {};
  if (!(n >= 1)) return;
  const key = String(n);
  if (n <= 30) {
    save.campaign.cleared[key] = true;
    save.campaign.unlocked = Math.max(save.campaign.unlocked | 0, Math.min(31, n + 1));
  }
  if (levelScore != null) save.campaign.best[key] = Math.max(save.campaign.best[key] | 0, levelScore | 0);
  save.stats.levelsCleared = (save.stats.levelsCleared | 0) + 1;
}

/** Embers banked for one raw ember earned, at this run's rank. */
export function emberValue(run) {
  return FORGE_FX.EMBER_VALUE[runRanks(run).embers];
}

/**
 * Move a run's new embers into the save and record progress. Safe to call after every level and
 * again at the end of the run: only embers caught since the last call are banked (run.banked).
 * Mutates both. D calls it from the results screen.
 * @param {import('../core/types.js').SaveData} save
 * @param {import('../core/types.js').RunState} run
 * @param {{cleared?:boolean, over?:boolean, n?:number, levelScore?:number, wave?:number}} [result]
 *   wave: the Overburn wave reached (or run.overburnWave)
 * @returns {{gain:number, embers:number}}
 */
export function bankRun(save, run, result = {}) {
  if (!save.forge) save.forge = { embers: 0, ranks: {} };
  if (!save.campaign) save.campaign = { unlocked: 1, best: {}, cleared: {} };
  if (!save.overburn) save.overburn = { best: 0, bestWave: 0, lastSeed: 0 };
  if (!save.stats) save.stats = {};
  const raw = Math.max(0, (run.embersBanked | 0) - (run.banked | 0));
  const gain = Math.floor(raw * emberValue(run));
  save.forge.embers = Math.max(0, Math.floor(Number(save.forge.embers) || 0)) + gain;
  run.banked = run.embersBanked | 0;

  const n = result.n ?? result.levelN ?? run.levelN;
  const st = save.stats;
  st.embersBanked = (st.embersBanked | 0) + gain;
  if (result.cleared && n >= 1) recordClear(save, n, result.levelScore);
  const wave = Math.max(run.overburnWave | 0, result.wave | 0);
  if (wave > 0) {
    save.overburn.best = Math.max(save.overburn.best | 0, run.score | 0);
    save.overburn.bestWave = Math.max(save.overburn.bestWave | 0, wave);
  }
  if (result.over) {
    st.runs = (st.runs | 0) + 1;
    st.bestRun = Math.max(st.bestRun | 0, run.score | 0);
  }
  return { gain, embers: save.forge.embers };
}
