// Kiln: title (OWNER: D). The KILN wordmark whose I is live fire (C's createWordmarkFlame; a CSS
// flame until it mounts, never a dark slot), the menu on glass, a few facts, key chips on
// desktop. The live attract world plays behind it, blurred.
// ART 15.6 D2: a wall of bricks fills the rest of the screen. Desktop (1100 px and wider): a glass
// panel on the right holding the wall, the facts under it and the one primary button (Continue).
// Phones: the same wall under the menu with no panel (never glass on glass). The wall is C's live
// one when it exists (data.mountWall), else the current world's level-card art.

import { h } from '../dom.js';
import { panel, menu, stat, keyChip, button } from './parts.js';
import { ICONS } from '../icons.js';

export const WIDE_TITLE = '(min-width: 1100px)';

/**
 * data: { menu:[{id, label, detail}], stats:[{label, value}], onSelect(id), mountFlame(slot),
 *         muted, onMute(), wall?:{art, label}, mountWall?(slot), primary?:{id, label, detail} }
 */
export function title(data, { el, nav }) {
  const wide = typeof matchMedia === 'function' && matchMedia(WIDE_TITLE).matches;
  const slot = h('span.slot.css-flame', { 'aria-hidden': 'true' });
  const mark = h('div.mark', { role: 'img', 'aria-label': 'Kiln' }, 'K', slot, 'LN');
  // desktop: the run's next step is the panel's primary button, so the menu does not repeat it
  const primary = wide && data.primary ? data.primary : null;
  const items = (data.menu || [])
    .filter((m) => !primary || m.id !== primary.id)
    .map((m) => ({ label: m.label, detail: m.detail, act: () => data.onSelect(m.id) }));
  const stats = data.stats && data.stats.length ? h('div.stats', data.stats.map((s) => stat(s.label, s.value))) : null;
  const keys = h('div.keys',
    h('span', keyChip('↑'), keyChip('↓'), ' Select'),
    h('span', keyChip('↵'), ' Confirm'),
    h('span', keyChip('F'), ' Fullscreen'),
    h('span', keyChip('M'), ' Sound'));

  // the wall: C's live wall in this box when it mounts; until then (or without it) the art
  const wallBox = h('div.wall.fillcard', { 'aria-hidden': 'true' });
  if (data.wall && data.wall.art) wallBox.appendChild(h('img.wall-art', { src: data.wall.art, alt: '', decoding: 'async', draggable: 'false' }));
  let side;
  let primaryBtn = null;
  if (primary) {
    primaryBtn = button(null, primary.label, () => data.onSelect(primary.id), { primary: true });
    const detail = primary.detail ? h('span.detail', primary.detail) : null;
    side = h('div.title-side', panel(data.wall && data.wall.label ? data.wall.label : '', wallBox, stats, h('div.foot', detail, h('span.spacer'), primaryBtn)));
  } else {
    side = h('div.title-side.plain', wallBox, stats);
  }
  el.appendChild(h('div.title-grid', mark, panel('Menu', menu(nav, items)), keys));
  el.appendChild(side);
  if (primaryBtn) nav.add(primaryBtn, () => data.onSelect(primary.id)); // after the menu rows
  // sound on/off, one tap away (M on desktop)
  const soundBtn = h('button.icon-btn.corner', { type: 'button' });
  const paintSound = (muted) => {
    soundBtn.innerHTML = muted ? ICONS.muted : ICONS.sound;
    soundBtn.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
    soundBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  };
  paintSound(!!data.muted);
  soundBtn.addEventListener('click', () => data.onMute && data.onMute());
  if (data.onMute) el.appendChild(soundBtn);
  let flame = null;
  let wall = null;
  const mount = (fn) => {
    if (flame || !fn) return;
    flame = fn(slot);
    if (flame) slot.classList.remove('css-flame');
  };
  const mountWall = (fn) => {
    if (wall || !fn) return;
    wall = fn(wallBox);
    if (wall) wallBox.classList.add('live');
  };
  mount(data.mountFlame);
  mountWall(data.mountWall);
  return {
    // desktop: the primary button (the run's next step); phones: the first menu row
    initial: primaryBtn ? nav.count - 1 : 0,
    /** Mount the live flame and wall later (three.js loads after the title's first paint). */
    mountFlame: mount,
    mountWall,
    setMuted: paintSound,
    dispose() {
      if (flame && flame.dispose) flame.dispose();
      if (wall && wall.dispose) wall.dispose();
    },
  };
}
