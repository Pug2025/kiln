// Kiln: credits (OWNER: D). Every line exactly as E's data gives it (src/audio/credits.js; PLAN §7
// "Credits"), then the type and engine. Web addresses are links.

import { h } from '../dom.js';
import { panel, button } from './parts.js';

// web addresses (https://… or www.…) become plain links that open in a new tab; never a file
const URL_RE = /(https?:\/\/[^\s,)]+|www\.[^\s,)]+)/g;

function line(text) {
  const p = h('p');
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const shown = m[0].replace(/[.;:]+$/, '');
    if (m.index > last) p.appendChild(document.createTextNode(text.slice(last, m.index)));
    const href = shown.startsWith('http') ? shown : `https://${shown}`;
    if (/\.md$/i.test(href)) p.appendChild(document.createTextNode(shown));
    else p.appendChild(h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, shown));
    last = m.index + shown.length;
  }
  if (last < text.length) p.appendChild(document.createTextNode(text.slice(last)));
  return p;
}

/** data: { lines:[string], extra?:[string], onBack() } */
export function credits(data, { el, nav }) {
  const lines = [...(data.lines || []), ...(data.extra || [])];
  const back = button(nav, 'Back', () => data.onBack());
  el.appendChild(h('div.stack.wide', panel('Credits', h('div.scroll.credits', lines.map(line)), h('div.foot', back))));
  return { initial: 0, onBack: data.onBack };
}
