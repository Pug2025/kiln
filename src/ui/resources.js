// Resource facts use the real equipped ability, shield allowance and saved Forge prices.
// The HUD asks for one every frame, so every line is a constant string; the one number (embers at
// the end of a level) is cached until it changes. The shield price is E's SHIELD.COST (tests check).
const SHIELD_FACT = 'Shield costs 100 HEAT';
const SPENDS = Object.freeze(['', 'Purge empties HEAT', 'Quench empties HEAT', 'Fork empties HEAT']);
let endCount = -1, endText = '';

/**
 * One short fact under the HEAT meter. `pulled` is true once this player has used Pull, so the
 * Pull control is taught until then and the spending fact shows after.
 */
export function resourceFact(world, touch = false, pulled = false) {
  const e = world.econ, level = world.level;
  if (level.total > 0 && level.remaining <= 0) {
    const n = (e.embersCaught | 0) + (e.embersAutoBanked | 0);
    if (n !== endCount) { endCount = n; endText = `${n} ${n === 1 ? 'ember' : 'embers'}`; }
    return endText;
  }
  if (!level.rules.heat) return '';
  if (world.paddle?.pulling) return 'Pull active · uses HEAT';
  if (e.ventMs > 0) return 'HEAT paused';
  if (!(e.heat > 0)) return 'Catch embers to fill HEAT';
  if (level.rules.pull && !pulled) return touch ? 'Hold 2nd finger for Pull' : 'Hold mouse button for Pull';
  const power = SPENDS[world.run.overload | 0];
  if (power) return power;
  return e.shieldCost > 0 ? SHIELD_FACT : '';
}

export function forgeProgress(model) {
  const wallet = Math.max(0, model?.embers | 0);
  let next = null;
  for (const item of model?.items || []) {
    if (item.rank >= item.max || !(item.price > 0)) continue;
    if (!next || item.price < next.price) next = item;
  }
  return { wallet, nextPrice: next?.price || 0, nextReady: !!next && wallet >= next.price };
}

/**
 * A wallet fact only: it never names an upgrade (players choose what to buy). It sits under
 * 'Forge wallet', so 'an upgrade' is enough.
 */
export function forgeProgressFact(p) {
  if (!p.nextPrice) return 'All Forge upgrades complete';
  if (p.nextReady) return 'Enough for an upgrade';
  const n = Math.max(0, p.nextPrice - p.wallet);
  return `${n} more ${n === 1 ? 'ember' : 'embers'} for an upgrade`;
}

/** A continuing Core stage banks currency without recording the campaign level as cleared. */
export function bankStageRewards(world, save, bank, previous) {
  const key = `${world.level.n}:${world.level.def.stage || 1}`;
  if (previous?.key === key) return previous;
  const before = save.forge.embers | 0;
  bank(save, world.run);
  return { key, caught: (previous?.caught || 0) + (world.econ.embersCaught | 0),
    auto: (previous?.auto || 0) + (world.econ.embersAutoBanked | 0),
    forgeGain: (previous?.forgeGain || 0) + Math.max(0, (save.forge.embers | 0) - before) };
}
