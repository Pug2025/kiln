// Resource facts use the real equipped ability, shield allowance and saved Forge prices.
export function resourceFact(world, touch = false) {
  const e = world.econ, level = world.level;
  if (level.total > 0 && level.remaining <= 0) return `${(e.embersCaught | 0) + (e.embersAutoBanked | 0)} embers banked`;
  if (!level.rules.heat) return 'Embers buy Forge upgrades';
  if (world.paddle?.pulling) return 'Pull active · uses HEAT';
  if (e.ventMs > 0) return 'Cooldown: HEAT paused';
  if (!(e.heat > 0)) return 'Catch embers to fill HEAT';
  const power = ['', 'Purge', 'Quench', 'Fork'][world.run.overload | 0] || '';
  const shield = !power && e.shieldCost > 0 ? 'Shield' : '';
  const use = power || shield;
  return level.rules.pull ? touch ? 'Hold 2nd finger for Pull' : 'Hold mouse button for Pull'
    : use ? `${use} uses HEAT` : 'Embers buy Forge upgrades';
}

export function forgeProgress(model) {
  const wallet = Math.max(0, model?.embers | 0);
  let next = null;
  for (const item of model?.items || []) {
    if (item.rank >= item.max || !(item.price > 0)) continue;
    if (!next || item.price < next.price) next = item;
  }
  return { wallet, nextName: next?.name || '', nextPrice: next?.price || 0,
    nextReady: !!next && wallet >= next.price };
}

export function forgeProgressFact(p) {
  if (!p.nextPrice) return 'All Forge upgrades complete';
  return p.nextReady ? `${p.nextName} ready · ${p.nextPrice} embers`
    : `${Math.max(0, p.nextPrice - p.wallet)} more for ${p.nextName} · ${p.nextPrice}`;
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
