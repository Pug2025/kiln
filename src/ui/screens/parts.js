// Kiln: shared pieces for the glass screens (OWNER: D): panel, menu rows, buttons, switches,
// sliders, stat lines. Monochrome white on glass (R16); the heat accent only as the one primary
// button's fill and the selection ring.

import { h, kicker } from '../dom.js';

/** A glass panel with an optional kicker label. */
export function panel(label, ...children) {
  return h('div.panel', label ? kicker(label) : null, ...children);
}

/**
 * Menu rows (44 px, 1 px separators, no zebra). items: [{label, detail, act, off}]
 * @returns {HTMLElement}
 */
export function menu(nav, items) {
  const list = h('div.menu', { role: 'menu' });
  list.switches = [];
  for (const it of items) {
    if (!it) continue;
    if (it.toggle) { // {toggle: true, label, on, change}: an on/off row in the same list
      const s = switchRow(nav, it.label, it.on, it.change);
      list.switches.push(s);
      list.appendChild(s);
      continue;
    }
    const b = h('button.row', { type: 'button', role: 'menuitem', 'aria-disabled': it.off ? 'true' : null },
      h('span.label', it.label),
      it.detail ? h('span.detail', it.detail) : null,
      h('span.arrow', { 'aria-hidden': 'true' }, '›'));
    if (it.off) b.classList.add('off');
    nav.add(b, (how) => { if (!it.off) it.act(how); });
    list.appendChild(b);
  }
  return list;
}

/**
 * A flat button (white 10%), or the one primary button per screen (heat fill). With a nav it is
 * registered at once; with null the caller registers it (nav.add) where it wants it in order.
 */
export function button(nav, label, act, opts = {}) {
  const b = h(`button.btn${opts.primary ? '.primary' : ''}`, { type: 'button', 'aria-disabled': opts.off ? 'true' : null }, label);
  if (opts.off) b.classList.add('off');
  b.dataset.sound = opts.sound || (opts.primary ? 'confirm' : label === 'Back' ? 'back' : 'click');
  if (nav) nav.add(b, (how) => { if (!b.classList.contains('off')) act(how); });
  return b;
}

/** Big number with a caps label under it (results, The Forge, map detail). */
export function stat(label, value, opts = {}) {
  return h(`div.stat${opts.hero ? '.hero' : ''}`, h('b', value), h('span', label));
}

/** On/off switch row. */
export function switchRow(nav, label, on, change) {
  const value = h('span.value', on ? 'On' : 'Off');
  const b = h('button.row.setting', { type: 'button', role: 'switch' },
    h('span.label', label), value, h('span.switch', { 'aria-hidden': 'true' }, h('i')));
  const set = (v) => {
    on = v;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    value.textContent = on ? 'On' : 'Off';
    b.classList.toggle('is-on', on);
  };
  set(on);
  nav.add(b, () => { set(!on); change(on); });
  /** Show a value changed elsewhere (e.g. M pressed while the screen is open). */
  b.setOn = (v) => set(!!v);
  return b;
}

/**
 * Volume slider row (0…1). Left/Right keys step it while it is selected.
 * @returns {{el:HTMLElement, step(d:number):void}}
 */
export function sliderRow(nav, label, value, change) {
  const input = h('input', { type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(value * 100)), 'aria-label': label, tabindex: '-1' });
  const val = h('span.value', `${Math.round(value * 100)}`);
  const row = h('div.row.setting.slider', { tabindex: '0', role: 'group', 'aria-label': label }, h('span.label', label), input, val);
  const paint = () => {
    const v = Number(input.value);
    val.textContent = String(v);
    input.style.setProperty('--v', `${v}%`);
  };
  paint();
  input.addEventListener('input', () => { paint(); change(Number(input.value) / 100); });
  nav.add(row, () => {});
  return {
    el: row,
    step(d) {
      input.value = String(Math.max(0, Math.min(100, Number(input.value) + d * 10)));
      paint();
      change(Number(input.value) / 100);
    },
  };
}

/** Key chip (R17): 1 px rounded square, 20 px tall. */
export function keyChip(k) {
  return h('kbd', k);
}
