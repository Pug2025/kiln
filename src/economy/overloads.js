// Kiln: Overloads (OWNER: E). From level 22 the run carries one Overload, fired from HEAT with
// the overload input: Purge (clears the lowest rows), Quench (all balls slow), Fork (every ball
// splits). Pure data and maths here; the economy system fires them.

import { OVERLOAD, OVERLOAD_NAMES } from '../core/constants.js';
import { OVERLOAD_COST, FORGE_FX } from './tuning.js';
import { runRanks } from './forge.js';

const SPLIT_WORDS = ['', 'two', 'three', 'four'];

/** One short line for an Overload's pick card at a given power (overloadPower). */
function factFor(id, pw) {
  if (id === OVERLOAD.PURGE) return `Clears ${pw.purgeRows} rows nearest the paddle`;
  if (id === OVERLOAD.QUENCH) return `All balls at half speed for ${pw.quenchMs / 1000} s`;
  return `Splits each ball into ${SPLIT_WORDS[pw.forkExtra] || pw.forkExtra + 1}`; // splitBalls(n): n + 1 balls
}

const RANK0 = Object.freeze({
  ventMs: FORGE_FX.VENT_MS[0], purgeRows: FORGE_FX.PURGE_ROWS[0], quenchMs: FORGE_FX.QUENCH_MS[0], forkExtra: FORGE_FX.FORK_EXTRA[0],
});

const card = (id, name, pw) => Object.freeze({ id, key: OVERLOAD_NAMES[id], name, fact: factFor(id, pw), cost: OVERLOAD_COST[id] });

/**
 * The three Overloads for D's pick screen at Forge rank 0. `fact` is one short line. A run with
 * "Overload power" ranks gets its own facts from overloadChoices(run).
 */
export const OVERLOADS = Object.freeze([
  card(OVERLOAD.PURGE, 'Purge', RANK0),
  card(OVERLOAD.QUENCH, 'Quench', RANK0),
  card(OVERLOAD.FORK, 'Fork', RANK0),
]);

/** The pick cards for this run: the same three, with facts at the run's Forge "Overload power". */
export function overloadChoices(run) {
  const pw = overloadPower(run);
  return OVERLOADS.map((o) => card(o.id, o.name, pw));
}

/**
 * Equip an Overload for the rest of the run (one per run: a second call is ignored).
 * @returns {boolean} true if it was equipped
 */
export function chooseOverload(run, id) {
  if (run.overload) return false;
  if (id !== OVERLOAD.PURGE && id !== OVERLOAD.QUENCH && id !== OVERLOAD.FORK) return false;
  run.overload = id;
  return true;
}

/**
 * HEAT an Overload needs to be ready (firing spends the whole meter). 0 if none. The Forge does
 * not lower it: the vent, not the price, spaces Overloads out, so "Overload power" shortens that.
 */
export function overloadCost(run, id = run.overload) {
  void run;
  return id ? OVERLOAD_COST[id] : 0;
}

/** Vent after firing, Purge rows, Quench length and Fork split for this run's Forge rank. */
export function overloadPower(run) {
  const r = runRanks(run).overload;
  return {
    ventMs: FORGE_FX.VENT_MS[r],
    purgeRows: FORGE_FX.PURGE_ROWS[r],
    quenchMs: FORGE_FX.QUENCH_MS[r],
    forkExtra: FORGE_FX.FORK_EXTRA[r],
  };
}
