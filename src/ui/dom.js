// Kiln: tiny DOM helpers for the glass layer (OWNER: D). Cold path only (screens, not the HUD).

/**
 * h('div.panel.wide', {attrs}, ...children) → element. Children: nodes, strings, arrays, null.
 * attrs: plain attributes, plus `on: {click: fn}`, `style: 'css'`, `data: {k: v}`.
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'data') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv;
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'text') el.textContent = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, kids) {
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Section label: caps kicker on a 1 px hairline (R10). */
export function kicker(text, extra) {
  return h('div.kicker', h('span', text), extra || null);
}

/** Two-digit level number. */
export const pad2 = (n) => String(n).padStart(2, '0');
