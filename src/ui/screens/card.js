// Kiln: the level card (OWNER: D). Text on the world at the start of a level, drawn like the HUD
// (content layer, no panel, no blur): kicker on a 1 px hairline, number, name, what the level adds,
// an optional fact. It sits in an empty band of the field (ui.js), takes no input (the world is
// serving behind it) and main.js removes it on the first action or after a short time.
// Reduce transparency (R20) gives it the void-75% fill.

import { h, pad2 } from '../dom.js';

export function card(data) {
  const kind = data.kind === 'bonus' ? 'Bonus' : data.kind === 'boss' ? 'Boss' : null;
  return h(data.controls ? 'div.card.controls' : 'div.card', { 'aria-live': 'polite' },
    h('div.kicker', h('span', data.kicker || `Level ${pad2(data.n)}`), kind ? h('span.tag', kind) : null),
    h('div.title', data.name || ''),
    data.adds ? h('div.adds', h('span', 'Adds'), ` ${data.adds}`) : null,
    data.door ? h('div.adds', h('span', 'Wall'), ` ${data.door}`) : null,
    data.hint ? h('div.sub', data.hint) : null);
}
