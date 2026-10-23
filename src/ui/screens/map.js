// Kiln: the level map (OWNER: D). Three worlds of ten and Overburn, as tabs. Each cell shows the
// number and a mark: cleared (a line), locked (dim). The card under the grid gives the facts for
// the selected level and the one primary button. Mouse: hover selects, click plays. Touch: the
// first tap selects, a second tap on the same cell plays. Keys: arrows move, Enter plays.

import { h, pad2 } from '../dom.js';
import { panel, button, stat } from './parts.js';
import { formatScore } from '../layout.js';

const KIND = { bonus: 'Bonus', boss: 'Boss' };

/**
 * data: { model: mapModel(), selected?: n, tab?: 'ember'|'blaze'|'whiteheat'|'overburn',
 *         onPlay(n), onOverburn(), onBack() }
 */
export function map(data, { el, nav }) {
  const m = data.model;
  const tabsDef = [...m.worlds.map((w) => ({ id: w.id, name: w.name, open: w.open })), { id: 'overburn', name: 'Overburn', open: m.overburn.open }];
  let sel = data.selected || m.current;
  let tab = data.tab || (sel > 30 ? 'overburn' : m.worlds[Math.min(2, Math.floor((sel - 1) / 10))].id);
  let armed = false;

  const tabEls = tabsDef.map((t) => h('button.tab', { type: 'button', role: 'tab' }, t.name));
  tabEls.forEach((b, i) => { if (!tabsDef[i].open) b.classList.add('locked'); });
  const cellEls = [];
  const all = [];
  for (const w of m.worlds) {
    for (const lv of w.levels) {
      const c = h('button.cell', { type: 'button', 'aria-label': `Level ${lv.n} ${lv.name}` },
        h('b', pad2(lv.n)), h('span', KIND[lv.kind] || ''));
      c.classList.add(lv.state);
      c.dataset.world = w.id;
      cellEls.push(c);
      all.push(lv);
    }
  }
  const info = h('div.info');
  const best = h('div');
  const playBtn = button(null, 'Play', () => play(), { primary: true });
  const card = h('div.mapcard.fillcard', info, best, playBtn);
  const cells = h('div.cells', cellEls);
  const back = button(null, 'Back', () => data.onBack && data.onBack());

  const art = h('img.world-art', { alt: '', decoding: 'async', draggable: 'false' });
  el.appendChild(h('div.stack.wide', panel('Levels', h('div.tabs', { role: 'tablist' }, tabEls), art, cells, card, h('div.foot', back))));

  // nav order: tabs, cells, play, back
  tabEls.forEach((b, i) => nav.add(b, () => showTab(tabsDef[i].id, true)));
  cellEls.forEach((c, i) => {
    c.addEventListener('pointerdown', () => { armed = all[i].n === sel; });
    nav.add(c, (how) => {
      const lv = all[i];
      const was = armed || how === 'key';
      armed = false;
      choose(lv.n);
      if (was && lv.state !== 'locked') data.onPlay(lv.n);
    });
  });
  nav.add(playBtn, () => play());
  nav.add(back, () => data.onBack && data.onBack());

  function play() {
    if (tab === 'overburn') { if (m.overburn.open) data.onOverburn(); return; }
    const lv = all.find((l) => l.n === sel);
    if (lv && lv.state !== 'locked') data.onPlay(lv.n);
  }

  const put = (el, ...kids) => el.replaceChildren(...kids.filter(Boolean));

  function choose(n) {
    sel = n;
    const lv = all.find((l) => l.n === n);
    put(info,
      h('div.n', `Level ${pad2(lv.n)}${KIND[lv.kind] ? `  ·  ${KIND[lv.kind]}` : ''}`),
      h('div.name', lv.name),
      lv.adds ? h('div.adds', lv.adds) : null);
    put(best, lv.best ? stat('Best', formatScore(lv.best)) : null);
    const locked = lv.state === 'locked';
    playBtn.textContent = locked ? 'Locked' : 'Play';
    playBtn.classList.toggle('off', locked);
  }

  function showTab(id, fromUser) {
    tab = id;
    tabEls.forEach((b, i) => { b.classList.toggle('cur', tabsDef[i].id === id); b.setAttribute('aria-selected', tabsDef[i].id === id ? 'true' : 'false'); });
    cellEls.forEach((c) => { c.hidden = c.dataset.world !== id; });
    art.src = `img/levels/${id}.webp`; // F's level-map card for the world (ARTKIT.md)
    cells.hidden = id === 'overburn';
    if (id === 'overburn') {
      const o = m.overburn;
      put(info, h('div.n', 'Endless'), h('div.name', 'Overburn'),
        h('div.adds', o.open ? 'New levels each day. Waves get harder as you play.' : 'Clear The Core to unlock.'));
      put(best, o.bestWave ? h('div.stats', stat('Best wave', String(o.bestWave)), stat('Best', formatScore(o.best))) : null);
      playBtn.textContent = o.open ? 'Play' : 'Locked';
      playBtn.classList.toggle('off', !o.open);
      return;
    }
    if (fromUser) {
      const w = m.worlds.find((x) => x.id === id);
      const first = w.levels.find((l) => l.state === 'open') || w.levels.find((l) => l.state === 'cleared') || w.levels[0];
      choose(first.n);
    } else choose(sel);
  }

  showTab(tab, false);
  const initial = tab === 'overburn' ? nav.count - 2 : tabEls.length + all.findIndex((l) => l.n === sel);
  return { initial: Math.max(0, initial), onBack: data.onBack };
}
