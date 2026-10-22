// Kiln: picks (OWNER: D). One screen for the Mod pick (1 of 3), the Overload pick (1 of 3, level
// 22) and the gate (two doors from level 13). Cards are fills inside one glass panel (never glass
// on glass). A tap or click chooses a card; the one primary button takes it. Enter on a card takes
// it at once. Labels and facts only.

import { h } from '../dom.js';
import { panel, button } from './parts.js';

/**
 * data: { kicker, options:[{id, name, fact, tag?}], confirm:'Take', onPick(id), sub? }
 */
export function pick(data, { el, nav }) {
  const opts = data.options || [];
  let chosen = 0;
  const cards = opts.map((o) => h('button.pick', { type: 'button' },
    h('span.name', o.name), o.fact ? h('span.fact', o.fact) : null, o.tag ? h('span.tag', o.tag) : null));
  const grid = h('div.picks', cards);
  grid.style.setProperty('--n', String(Math.max(1, opts.length)));
  let done = false;
  const take = (i) => {
    if (done || !opts[i]) return;
    done = true;
    data.onPick(opts[i].id, opts[i]);
  };
  const confirm = button(null, data.confirm || 'Take', () => take(chosen), { primary: true });
  const mark = (i) => {
    chosen = i;
    cards.forEach((c, j) => c.classList.toggle('chosen', j === i));
  };
  cards.forEach((c, i) => nav.add(c, (how) => { mark(i); if (how === 'key') take(i); }));
  nav.add(confirm, () => take(chosen));
  mark(0);
  el.appendChild(h('div.stack.wide', panel(data.kicker || 'Pick one',
    data.sub ? h('div.sub', data.sub) : null, grid, h('div.foot', confirm))));
  return { initial: 0 };
}
