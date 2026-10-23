// Kiln: results and run over (OWNER: D). The score is the hero (the only heat-coloured text on
// the glass layer, R14); the rest are labelled numbers. One primary button.
// ART 15.6 D7: after a clear the level score counts up from the score before the clear bonus to
// the final score (from 180 ms, 450 ms ease-out, tabular numerals); the "+bonus" stat fades in
// 60 ms before the count ends; the stats fade in 40 ms apart. Reduce motion: the final score at
// once and a plain fade.

import { h, pad2 } from '../dom.js';
import { panel, button, stat } from './parts.js';
import { formatScore } from '../layout.js';
import { forgeProgressFact } from '../resources.js';

export const COUNT = Object.freeze({ DELAY_MS: 180, MS: 450, BONUS_LEAD_MS: 60, STAGGER_MS: 40 });

/**
 * The hero's value `elapsed` ms after the screen mounts: `from` until DELAY_MS, then an ease-out
 * cubic to `to` over MS. Whole points only.
 * @param {number} from
 * @param {number} to
 * @param {number} elapsed
 */
export function countValue(from, to, elapsed) {
  const t = Math.max(0, Math.min(1, (elapsed - COUNT.DELAY_MS) / COUNT.MS));
  const e = 1 - (1 - t) ** 3;
  return Math.round(from + (to - from) * e);
}

/**
 * data: { kind:'cleared'|'over'|'campaign'|'wave', n, name, wave, score, runScore, embers, best,
 *         newBest, bonus, flawless, reached, nextLabel, onNext(), onMap(),
 *         install?:{label, fact, onInstall()} }
 */
export function results(data, { el, nav, reduceMotion }) {
  const k = data.kind;
  const label = k === 'over' ? 'Run over'
    : k === 'campaign' ? 'The Core  ·  Cleared'
      : k === 'wave' ? `Overburn  ·  Wave ${data.wave}`
        : `Level ${pad2(data.n)}  ·  Cleared`;
  const runHero = k === 'over' || k === 'campaign';
  const heroLabel = runHero ? 'Run score' : 'Level score';
  const heroValue = (runHero ? data.runScore : data.score) | 0;
  const bonus = data.bonus | 0;
  const stats = [];
  if (!runHero) stats.push(stat('Run score', formatScore(data.runScore | 0)));
  let bonusStat = null;
  if (bonus > 0) { bonusStat = stat('Clear bonus', `+${formatScore(bonus)}`); stats.push(bonusStat); }
  if (k === 'over' && data.reached) stats.push(stat('Reached', data.reached));
  stats.push(stat(runHero ? 'Run embers' : 'Level embers', formatScore(data.embers | 0)));
  let rewards = null;
  if (data.rewards) {
    const r = data.rewards;
    rewards = h('div.resource-summary',
      h('p.wallet', `Forge wallet ${formatScore(r.wallet | 0)} · +${formatScore(r.forgeGain | 0)}`),
      h('p', forgeProgressFact(r)));
  }
  // a new best is a tag on the hero (the number is already there); the old best only when it differs
  const newBest = !!data.newBest && !runHero;
  if (data.best && !newBest && (runHero || (data.best | 0) !== heroValue)) stats.push(stat('Best', formatScore(data.best)));
  stats.forEach((s, i) => s.style.setProperty('--i', String(i)));
  const next = button(null, data.nextLabel || 'Next', () => data.onNext && data.onNext(), { primary: true });
  const map = data.onMap ? button(null, 'Levels', () => data.onMap()) : null;
  let install = null;
  if (data.install) {
    const ib = button(null, data.install.label || 'Install', () => data.install.onInstall());
    install = h('div.mapcard.fillcard', h('div.info', h('div.n', 'Install'), h('div.adds', data.install.fact || 'Add Kiln to your Home Screen.')), ib);
    nav.add(ib, () => data.install.onInstall());
  }
  if (map) nav.add(map, () => data.onMap());
  nav.add(next, () => data.onNext && data.onNext());

  // the count-up: only a level score with a clear bonus counts, and never under reduce motion
  const counts = !runHero && bonus > 0 && bonus <= heroValue && !(reduceMotion && reduceMotion());
  const from = counts ? heroValue - bonus : heroValue;
  const hero = stat(heroLabel, formatScore(from), { hero: true });
  const heroNum = hero.querySelector('b');
  if (newBest) hero.querySelector('span').appendChild(h('em.tag', 'New best'));
  if (bonusStat && counts) bonusStat.classList.add('late');

  el.appendChild(h('div.stack',
    panel(label,
      data.name || data.flawless ? h('div.sub', [data.name, data.flawless ? 'No lives lost' : ''].filter(Boolean).join('  ·  ')) : null,
      h('div.hero-wrap', hero),
      h('div.stats', stats),
      rewards,
      install,
      h('div.foot', map, next))));

  let raf = 0;
  let settle = 0;
  if (counts) {
    const t0 = performance.now();
    let shown = from;
    const show = (v) => { if (v !== shown) { shown = v; heroNum.textContent = formatScore(v); } };
    const tick = (now) => {
      show(countValue(from, heroValue, now - t0));
      raf = shown === heroValue ? 0 : requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // a background tab gets no animation frames: the final score lands anyway
    settle = setTimeout(() => { if (raf) cancelAnimationFrame(raf); raf = 0; show(heroValue); }, COUNT.DELAY_MS + COUNT.MS + 100);
  }
  return {
    initial: nav.count - 1,
    onBack: data.onMap || null,
    dispose() { if (raf) cancelAnimationFrame(raf); clearTimeout(settle); },
  };
}
