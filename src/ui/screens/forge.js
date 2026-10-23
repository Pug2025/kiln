// Kiln: The Forge (OWNER: D). Embers banked across runs buy ranks (E's rules and prices). Rows:
// name and fact, rank marks, price, Buy. The screen updates in place after a purchase.

import { h } from '../dom.js';
import { panel, button, stat } from './parts.js';
import { formatScore } from '../layout.js';

/**
 * data: { model:{embers, items:[{id, name, fact, rank, max, price, affordable}]}, onBuy(id) → model,
 *         ball?:{kinds:[{id, name}], current, onChange(id)}, onBack() }
 */
export function forge(data, { el, nav }) {
  let model = data.model;
  const balance = h('div');
  const rows = model.items.map(() => {
    const name = h('div.name');
    const fact = h('div.fact');
    const ranks = h('div.ranks');
    const buy = button(null, 'Buy', () => {});
    return { el: h('div.forge-row', h('div', name, fact), ranks, buy), name, fact, ranks, buy };
  });
  rows.forEach((r, i) => nav.add(r.buy, () => {
    const it = model.items[i];
    if (!it || !it.affordable) return;
    model = data.onBuy(it.id) || model;
    paint();
  }));
  // the ball the next run starts with, once The Forge has unlocked more than one
  let ballRow = null;
  const ball = data.ball;
  if (ball && ball.kinds && ball.kinds.length > 1) {
    let idx = Math.max(0, ball.kinds.findIndex((k) => k.id === ball.current));
    const value = h('span.detail', ball.kinds[idx].name);
    ballRow = h('button.row', { type: 'button' }, h('span.label', 'Starting ball'), value, h('span.arrow', { 'aria-hidden': 'true' }, '›'));
    nav.add(ballRow, () => {
      idx = (idx + 1) % ball.kinds.length;
      value.textContent = ball.kinds[idx].name;
      ball.onChange(ball.kinds[idx].id);
    });
  }
  const back = button(null, 'Back', () => data.onBack());
  nav.add(back, () => data.onBack());

  function paint() {
    balance.replaceChildren(stat('Forge wallet', formatScore(model.embers | 0)));
    model.items.forEach((it, i) => {
      const r = rows[i];
      r.name.textContent = it.name;
      r.fact.textContent = it.fact || '';
      r.ranks.replaceChildren(...Array.from({ length: it.max }, (_, j) => h(j < it.rank ? 'i.on' : 'i')));
      const maxed = it.rank >= it.max;
      r.buy.textContent = maxed ? 'Max' : formatScore(it.price);
      r.buy.classList.toggle('off', maxed || !it.affordable);
      r.buy.dataset.sound = 'buy';
      r.buy.setAttribute('aria-label', maxed ? `${it.name}: max rank` : `Buy ${it.name} for ${it.price} embers`);
    });
  }
  paint();
  el.appendChild(h('div.stack.wide', panel('The Forge',
    h('div.sub', 'Spend embers on permanent upgrades. They apply from your next run.'),
    h('div.stats', balance),
    h('div.scroll', rows.map((r) => r.el)),
    ballRow ? h('div.menu', ballRow) : null,
    h('div.foot', back))));
  return { initial: 0, onBack: data.onBack };
}
