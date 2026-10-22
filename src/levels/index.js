// Kiln: the level registry (OWNER: B). Everything that needs a level asks here.

import ember from './data/ember.js';
import blaze from './data/blaze.js';
import whiteheat from './data/whiteheat.js';
import { twistPair, applyTwistDef, twistApplies } from '../content/gates.js';

export { generateOverburn } from './overburn.js';

/** Every level and continuation stage. */
const ALL = [...ember, ...blaze, ...whiteheat];

/** Campaign levels in order (1–30); continuation stages excluded. */
export const LEVELS = ALL.filter((l) => !l.stage || l.stage === 1).sort((p, q) => p.n - q.n);

/**
 * A level or continuation stage by id (The Core's stages: def.continues → getStage(id)).
 * @param {string} id
 * @returns {import('../core/types.js').LevelDef|null}
 */
export function getStage(id) {
  return ALL.find((l) => l.id === id) || null;
}

/** Every stage reachable from a level through `continues`, in order (the level itself first). */
export function stagesOf(def) {
  const out = [];
  let d = def;
  while (d && out.length < 8) {
    out.push(d);
    d = d.continues ? getStage(d.continues) : null;
  }
  return out;
}

/** Level names by number, from the handoff (the registry test checks data against this). */
export const LEVEL_NAMES = Object.freeze([
  '', 'Ignition', 'Grid', 'Supply drop', 'Blast door', 'Burn-off', 'Vents', 'Outposts',
  'Friend or foe', 'Conveyor', 'The Stoker', 'Hull plating', 'Containment', 'Loadout', 'Compactor',
  'Shrapnel', 'Stacks', 'Broadside', 'Sentries', 'Smelter', 'The Crucible', 'Reactor', 'Overload',
  'Bulkheads', 'The Flue', 'Meltdown', 'Wormholes', 'Afterimage', 'Blackout', 'Full burn', 'The Core',
]);

export const CAMPAIGN_LENGTH = 30;

/**
 * @param {number} n level number
 * @returns {import('../core/types.js').LevelDef|null}
 */
export function getLevel(n) {
  return LEVELS.find((l) => l.n === n) || null;
}

/** Highest level number that exists right now. */
export function lastLevel() {
  return LEVELS.length ? LEVELS[LEVELS.length - 1].n : 0;
}

// ------------------------------------------------------------------ gates (from level 13)

/**
 * The two doors in front of level n: two {id, label, fact}. Empty when no gate leads into n (the level
 * before has no `gate`, or n is a bonus or boss level). D shows the doors after level n−1 is
 * cleared; the chosen id goes to applyTwist(getLevel(n), id) and the world starts with that def
 * (also stored as run.twist; content applies run.twist itself if handed the plain def).
 * @param {number} n the level the doors lead into
 * @returns {{id:string, label:string, fact:string}[]}
 */
export function twistsFor(n) {
  const before = getLevel(n - 1);
  const def = getLevel(n);
  if (!before || !before.gate || !def || def.kind === 'boss' || def.kind === 'bonus') return [];
  return twistPair(def);
}

/**
 * A new LevelDef with a gate twist applied (def.twist = id). Unknown or inapplicable ids return
 * the def unchanged.
 * @param {import('../core/types.js').LevelDef} def
 * @param {string} id
 * @returns {import('../core/types.js').LevelDef}
 */
export function applyTwist(def, id) {
  return twistApplies(def, id) ? applyTwistDef(def, id) : def;
}
