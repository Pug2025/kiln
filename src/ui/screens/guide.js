import { h } from '../dom.js';
import { panel, button } from './parts.js';

export const GUIDE = Object.freeze([
  ['Phone controls', 'Drag low on the screen to steer. Tap to launch, release or shoot. Hold a second finger for Pull, which bends balls toward your paddle and uses HEAT.'],
  ['Mouse and keyboard', 'Move the mouse or use arrows to steer. Click or Space launches, releases or fires Laser. Hold a mouse button for Pull. Shift pulls without arrows; Shift with arrows moves faster. Q or E uses Shield or your Overload. P or Esc pauses.'],
  ['Pull', 'Available from level 7. Pull bends balls toward your paddle and slows them while held. Short holds can bring awkward shots within reach. Release to stop. It normally uses 40 HEAT per second and stops when HEAT runs out. It does not catch balls automatically.'],
  ['Bricks', 'Lines show hits left. Silver bricks are armour. A lock means the brick cannot break.'],
  ['Loaded bricks', 'Tough bricks with a white power mark hold good drops.'],
  ['Embers', 'Catch the small orange embers to fill HEAT, raise your score multiplier and earn currency for The Forge.'],
  ['Power drops', 'Catch a marked drop for a power. Red drops have drawbacks. Laser adds two emitters to the paddle; each tap, click or Space press fires a pair of bolts. A ball on the paddle launches first. Most powers end with the level. There can be up to 12 balls at once.'],
  ['HEAT and Shield', 'HEAT is available from level 7. Pull uses it while held. A Shield costs 100 HEAT, saves one miss and expires after 20 seconds. You can buy one per level. From level 22, your chosen Overload replaces that purchase: Purge clears rows, Quench slows balls and Fork adds balls. Firing it empties HEAT; the meter cannot refill during its cooldown.'],
  ['The Forge', 'Embers stay in your wallet between runs. Spend them on permanent upgrades. Purchases apply from your next run.'],
  ['Winning', 'When a level ends, embers still on screen and the final reward are banked automatically. Earlier missed embers are gone. Uncaught power drops disappear. Results show your earnings and Forge wallet.'],
  ['Extra phone button', 'In Settings, Show action button adds an optional button. Tap it to launch, release or shoot; hold it for Pull. The other bottom button uses Shield or your Overload.'],
]);

export function guide(data, { el, nav }) {
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const first = touch ? 'Phone controls' : 'Mouse and keyboard';
  const other = touch ? 'Mouse and keyboard' : 'Phone controls';
  const sections = [GUIDE.find(([title]) => title === first),
    ...GUIDE.filter(([title]) => title !== first && title !== other), GUIDE.find(([title]) => title === other)];
  const content = h('div.scroll.guide-copy', { tabindex: '0', role: 'region', 'aria-label': 'How to play Kiln' },
    sections.map(([title, fact]) => h('section', h('h2', title), h('p', fact))));
  const back = button(nav, 'Back', () => data.onBack());
  el.appendChild(h('div.stack.wide', panel('How to play', content, h('div.foot', back))));
  return { initial: 0, onBack: data.onBack, keys(e) {
    const down = e.code === 'PageDown' || (e.target === content && e.code === 'ArrowDown');
    const up = e.code === 'PageUp' || (e.target === content && e.code === 'ArrowUp');
    if (!down && !up) return false;
    content.scrollBy(0, (down ? 1 : -1) * (e.code.startsWith('Page') ? content.clientHeight * 0.75 : 48));
    return true;
  } };
}
