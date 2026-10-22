// Kiln: drops (OWNER: E). Which drop a broken brick releases, and what each of the twelve does.
// Pure helpers; the economy system calls them with its own preallocated state, so nothing here
// allocates per step.
//
// Effects (one of each kind at a time; catching it again refreshes it):
//   Wide / Shrink cancel each other, Slow / Fast cancel each other (catching one while the other
//   runs ends both). Multi splits every ball into three. Life adds a life (max 5; at max it pays
//   points). Laser gives shots that last until spent or a life is lost. Every timed effect ends
//   when the last ball is lost. Mega only appears as the rescue drop (≤5 bricks for 20 s).

import { DROP, DROP_COUNT, DROP_NAMES, DROP_FAMILY } from '../core/constants.js';
import { DROP_FX } from './tuning.js';

/** Is this a red (bad) drop? */
export function isBad(kind) {
  return DROP_FAMILY[kind] === 'warn';
}

/** The kind a drop cancels when caught, or −1. */
export function cancels(kind) {
  switch (kind) {
    case DROP.WIDE: return DROP.SHRINK;
    case DROP.SHRINK: return DROP.WIDE;
    case DROP.SLOW: return DROP.FAST;
    case DROP.FAST: return DROP.SLOW;
    default: return -1;
  }
}

/**
 * Fill `out` (length DROP_COUNT) with weights by kind from a level's drop table (names → weight).
 * Mega is always 0: it only comes as the rescue drop. Falls back to DROP_FX.DEFAULT_TABLE when the
 * table is empty, so a carrier always has something to release.
 * @param {{rate?:number, table?:Object<string, number>}|undefined} drops
 * @param {Float64Array} out
 */
export function tableWeights(drops, out) {
  out.fill(0);
  let total = 0;
  const table = drops && drops.table;
  if (table) {
    for (let k = 0; k < DROP_COUNT; k++) {
      const w = Number(table[DROP_NAMES[k]]);
      if (k !== DROP.MEGA && Number.isFinite(w) && w > 0) {
        out[k] = w;
        total += w;
      }
    }
  }
  if (total > 0) return out;
  for (let k = 0; k < DROP_COUNT; k++) {
    const w = DROP_FX.DEFAULT_TABLE[DROP_NAMES[k]];
    if (w) out[k] = w;
  }
  return out;
}

/** Chance (0…1) that a broken non-carrier brick releases a random drop. */
export function dropRate(drops, scale = 1) {
  const r = Number(drops && drops.rate);
  if (!Number.isFinite(r) || r <= 0) return 0;
  return Math.min(1, r * scale);
}
