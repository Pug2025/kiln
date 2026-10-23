import { h } from '../dom.js';
import { panel, button } from './parts.js';

export const GUIDE = Object.freeze([
  ['Bricks', 'A number or group of dots shows hits left. Silver edges mark armour. Locked bricks cannot break.'],
  ['Embers', 'The small glowing chips fill HEAT and build your score multiplier when caught. They also become permanent currency for The Forge. Earlier misses stay missed.'],
  ['Power drops', 'The larger marked cells change your paddle or balls for this level: Wide, Multi, Laser and more. Red-marked drops are penalties. Laser adds two emitters; each quick action fires a pair of bolts. A held ball launches first.'],
  ['HEAT', 'From level 7, hold Pull to draw the ball toward you. Spending 100 HEAT buys one Shield per level: one saved miss, lasting 20 seconds. From level 22, your chosen Overload spends HEAT on Purge, Quench or Fork instead.'],
  ['The Forge', 'Embers stay in your wallet across runs. Spend them on permanent upgrades. Purchases take effect when you start your next run.'],
  ['Winning', 'Remaining airborne embers and the final reward are banked automatically. The results show the amount and your Forge wallet. Unused power drops end with the level; they are not collected or carried forward.'],
  ['Mouse and keyboard', 'Move the mouse to steer. Space or a quick click launches, releases a held ball or fires Laser. Hold the mouse button or Shift for Pull. Q or E uses Shield or your Overload. P or Esc pauses.'],
  ['Phone', 'Drag in the lower play area to steer. A quick tap launches, releases or fires Laser. Hold a second finger, the top area or the optional Thumb pad for Pull. The labelled corner button uses Shield or your Overload.'],
]);

export function guide(data, { el, nav }) {
  const content = h('div.scroll.guide-copy', { tabindex: '0', role: 'region', 'aria-label': 'How Kiln works' },
    GUIDE.map(([title, fact]) => h('section', h('h2', title), h('p', fact))));
  const back = button(nav, 'Back', () => data.onBack());
  el.appendChild(h('div.stack.wide', panel('How it works', content, h('div.foot', back))));
  return { initial: 0, onBack: data.onBack, keys(e) {
    const down = e.code === 'PageDown' || (e.target === content && e.code === 'ArrowDown');
    const up = e.code === 'PageUp' || (e.target === content && e.code === 'ArrowUp');
    if (!down && !up) return false;
    content.scrollBy(0, (down ? 1 : -1) * (e.code.startsWith('Page') ? content.clientHeight * 0.75 : 48));
    return true;
  } };
}
