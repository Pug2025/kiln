import { h } from '../dom.js';
import { panel, button } from './parts.js';

export const GUIDE = Object.freeze([
  ['Phone controls', 'Drag low on the screen to steer. Tap to launch, release or shoot. Hold a second finger for Pull.'],
  ['Mouse and keyboard', 'Move the mouse or use arrows to steer. Click or Space launches, releases or fires Laser. Hold a mouse button or Shift for Pull. Shift with arrows moves faster. Q or E uses Shield or your Overload. P or Esc pauses.'],
  ['Perfect hit', 'Tap, click or press Space just as the ball meets the paddle. The ball speeds up and goes through a brick.'],
  ['Pull', 'From level 7. While held, Pull bends balls toward your paddle and slows them.'],
  ['Bricks', 'Lines show hits left. Silver bricks are armour. A lock means the brick cannot break.'],
  ['Loaded bricks', 'Tough bricks with a white power mark hold good drops.'],
  ['Embers', 'Small orange embers fill HEAT, raise your score multiplier and buy upgrades in The Forge.'],
  ['Power drops', 'A marked drop gives a power. Red drops have drawbacks. Catch holds the ball on the paddle for a moment. Fire burns the bricks around each hit. Laser fires bolts from the paddle. Most powers end with the level. There can be up to 12 balls at once.'],
  ['HEAT and Shield', 'Pull uses HEAT while held. A Shield costs 100 HEAT, saves one miss and lasts 20 seconds. One per level. From level 22, your chosen Overload replaces Shield: Purge clears rows, Quench slows balls and Fork adds balls. Firing it empties HEAT, and HEAT pauses before it refills.'],
  ['The Forge', 'Embers stay in your Forge wallet between runs. Upgrades are permanent and apply from your next run.'],
  ['End of a level', 'Embers still on screen when you clear a level are caught for you.'],
  ['Action button', 'In Settings, Show action button adds a button. Tap it to launch, release or shoot. Hold it for Pull. The other bottom button uses Shield or your Overload.'],
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
