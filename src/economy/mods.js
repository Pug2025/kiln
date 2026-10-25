// Kiln: Mods (OWNER: E). Pick 1 of 3 at levels 13, 16, 19, 23, 26, 29 from a pool of twelve.
// Pure: modChoices is seeded by the run (same seed, same level, same three), applyMod edits the
// run. The economy system reads run.mods when a world starts and turns them into effects.

import { LIVES, PICKS } from '../core/constants.js';
import { createRng, mix32 } from '../core/rng.js';

export const MOD = Object.freeze({
  LIFE: 0, BIG_EMBERS: 1, SHIELD: 2, SLOW_START: 3, DOUBLE_DROPS: 4, PIERCE: 5,
  LONG_CATCH: 6, CHEAP_PULL: 7, BURST: 8, MAGNET: 9, COMBO_FLOOR: 10, MORE_LASERS: 11,
});

/** The pool. `fact` is the one short line on the pick card (information, never an instruction). */
export const MODS = Object.freeze([
  { id: MOD.LIFE, key: 'life', name: 'Extra life', fact: '+1 life', repeat: true },
  { id: MOD.BIG_EMBERS, key: 'big-embers', name: 'Big embers', fact: 'Embers fill HEAT faster.' },
  { id: MOD.SHIELD, key: 'shield', name: 'Shield', fact: 'Start each level with a shield.' },
  { id: MOD.SLOW_START, key: 'slow-start', name: 'Slow start', fact: 'Each launch slows balls for 10 seconds.' },
  { id: MOD.DOUBLE_DROPS, key: 'double-drops', name: 'Rich walls', fact: 'More powers drop.' },
  { id: MOD.PIERCE, key: 'pierce', name: 'Pierce', fact: 'Balls pierce a brick on launch or paddle hits.' },
  { id: MOD.LONG_CATCH, key: 'long-catch', name: 'Long catch', fact: 'Catch lasts for 35 seconds.' },
  { id: MOD.CHEAP_PULL, key: 'cheap-pull', name: 'Cheap Pull', fact: 'Pull drains HEAT more slowly.' },
  { id: MOD.BURST, key: 'burst', name: 'Burst', fact: 'Some bricks drop double embers.' },
  { id: MOD.MAGNET, key: 'magnet', name: 'Magnet', fact: 'Nearby embers drift to the paddle.' },
  { id: MOD.COMBO_FLOOR, key: 'combo-floor', name: 'Steady combo', fact: 'Your multiplier never drops below ×2.' },
  { id: MOD.MORE_LASERS, key: 'more-lasers', name: 'More shots', fact: 'Laser drops refill to 20 shots.' },
].map(Object.freeze));

export const MOD_COUNT = MODS.length;

/** True if the run took this Mod. */
export function hasMod(run, id) {
  const m = run && run.mods;
  if (!m) return false;
  for (let i = 0; i < m.length; i++) if (m[i] === id) return true;
  return false;
}

/** Is this level one of the Mod pick levels (13, 16, 19, 23, 26, 29)? */
export function isModLevel(n) {
  return PICKS.MOD_LEVELS.includes(n);
}

/**
 * The three Mods offered at this pick. Seeded by run.seed and the level (or a given rng), so the
 * same run sees the same three. Mods already taken are not offered again (Extra life may repeat).
 * Extra life is left out at max lives (it would be a dead card), unless the pool runs short.
 * @param {import('../core/types.js').RunState} run
 * @param {import('../core/types.js').Rng} [rng]
 * @param {number} [count]
 * @returns {typeof MODS[number][]}
 */
export function modChoices(run, rng, count = 3) {
  const r = rng || createRng(mix32(run.seed >>> 0, (run.levelN | 0) * 7919 + (run.overburnWave | 0))).fork('mods');
  let pool = MODS.filter((m) => m.repeat || !hasMod(run, m.id));
  if (run.lives >= LIVES.MAX) {
    const noLife = pool.filter((m) => m.id !== MOD.LIFE);
    if (noLife.length >= count) pool = noLife;
  }
  const out = [];
  while (out.length < count && pool.length) {
    const i = Math.floor(r.next() * pool.length);
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}

/**
 * Take a Mod: record it on the run; Extra life adds a life now (max 5), or a free miss when the
 * run is already at 5 lives (never a dead pick).
 * @returns {import('../core/types.js').RunState}
 */
export function applyMod(run, id) {
  const m = MODS[id];
  if (!m) return run;
  if (!m.repeat && hasMod(run, id)) return run;
  run.mods.push(id);
  if (id === MOD.LIFE) {
    if (run.lives >= LIVES.MAX) run.freeMiss = (run.freeMiss | 0) + 1;
    else run.lives += 1;
  }
  return run;
}
