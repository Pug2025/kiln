// A tiny stand-in for the browser so Node can drive src/input/input.js (D's tests only).
// Elements accept the calls input.js makes; listeners are kept so tests can fire pointer events.

function fakeEl() {
  const listeners = {};
  const classes = new Set();
  return {
    listeners,
    hidden: false,
    className: '',
    textContent: '',
    style: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => { const v = on === undefined ? !classes.has(c) : !!on; if (v) classes.add(c); else classes.delete(c); return v; },
      contains: (c) => classes.has(c),
    },
    setAttribute() {},
    appendChild(c) { return c; },
    remove() {},
    setPointerCapture() {},
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
  };
}

/**
 * Install window/document shims for a viewW x viewH touch screen. Returns the stage element and
 * fire(type, ev) for pointer events (pointerdown goes to the stage, the rest to the window).
 */
export function installDom(viewW = 400, viewH = 800) {
  const win = fakeEl();
  win.innerWidth = viewW;
  win.innerHeight = viewH;
  win.devicePixelRatio = 1;
  win.matchMedia = () => ({ matches: true, addEventListener() {} });
  const doc = fakeEl();
  doc.hidden = false;
  doc.body = fakeEl();
  doc.createElement = () => fakeEl();
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' });
  const stage = fakeEl();
  const fire = (type, ev) => {
    const e = { button: 0, pointerType: 'touch', preventDefault() {}, stopPropagation() {}, target: null, ...ev };
    const on = type === 'pointerdown' ? stage : win;
    for (const fn of on.listeners[type] || []) fn(e);
  };
  /** The screen maps straight onto the 720 x 1080 field. */
  const mapper = {
    screenToField(x, y, out) { out.x = (x / viewW) * 720; out.y = (y / viewH) * 1080; return true; },
  };
  return { stage, fire, mapper };
}

export function removeDom() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.getComputedStyle;
}

/**
 * A node tree just big enough for the glass screens built with src/ui/dom.js h(): elements with
 * children, text, classes, attributes, dataset, style and querySelector/All by tag or .class.
 * Returns { root, text(el), find(el, sel), findAll(el, sel), restore() }.
 */
export function installTreeDom() {
  class Node {
    constructor() { this.childNodes = []; this.parentNode = null; }
    appendChild(c) {
      if (c.parentNode) c.parentNode.childNodes = c.parentNode.childNodes.filter((n) => n !== c);
      c.parentNode = this; this.childNodes.push(c); return c;
    }
    get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
    set textContent(v) { this.childNodes = [new Text(String(v))]; }
  }
  class Text extends Node {
    constructor(t) { super(); this.data = t; }
    get textContent() { return this.data; }
    set textContent(v) { this.data = String(v); }
  }
  class Element extends Node {
    constructor(tag) {
      super();
      this.tagName = tag.toUpperCase();
      this.hidden = false;
      this.className = '';
      this.attrs = {};
      this.dataset = {};
      const props = {};
      this.style = { setProperty: (k, v) => { props[k] = v; }, getPropertyValue: (k) => props[k] || '' };
      const el = this;
      this.classList = {
        add: (...c) => { const s = new Set(el.className.split(' ').filter(Boolean)); c.forEach((x) => s.add(x)); el.className = [...s].join(' '); },
        remove: (...c) => { el.className = el.className.split(' ').filter((x) => x && !c.includes(x)).join(' '); },
        contains: (c) => el.className.split(' ').includes(c),
        toggle: (c, on) => { const v = on === undefined ? !el.classList.contains(c) : !!on; if (v) el.classList.add(c); else el.classList.remove(c); return v; },
      };
    }
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'class') this.className = String(v);
      else if (k === 'hidden') this.hidden = true;
      else if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v);
    }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    get children() { return this.childNodes.filter((c) => c instanceof Element); }
    set innerHTML(value) { this.childNodes = []; this.insertAdjacentHTML('beforeend', value); }
    insertAdjacentHTML(position, value) {
      if (position !== 'beforeend') throw new Error(`tree DOM: unsupported insertion ${position}`);
      const stack = [this];
      for (const token of String(value).match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith('</')) { stack.pop(); continue; }
        if (!token.startsWith('<')) { stack[stack.length - 1].appendChild(new Text(token)); continue; }
        const tag = /^<([\w-]+)/.exec(token)[1];
        const node = new Element(tag);
        const attrs = token.slice(tag.length + 1).replace(/\/?\s*>$/, '');
        for (const m of attrs.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) node.setAttribute(m[1], m[2] || '');
        stack[stack.length - 1].appendChild(node);
        if (!token.endsWith('/>') && !['br', 'hr', 'img', 'input'].includes(tag)) stack.push(node);
      }
    }
    addEventListener() {}
    removeEventListener() {}
    remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((c) => c !== this); }
    matches(sel) {
      if (sel.startsWith('[')) return this.getAttribute(sel.slice(1, -1)) !== null;
      return sel.startsWith('.') ? this.classList.contains(sel.slice(1)) : this.tagName === sel.toUpperCase();
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => { for (const c of n.childNodes) if (c instanceof Element) { if (c.matches(sel)) out.push(c); walk(c); } };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  const saved = { document: globalThis.document, Node: globalThis.Node, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
  globalThis.Node = Node;
  globalThis.document = {
    createElement: (t) => new Element(t),
    createTextNode: (t) => new Text(t),
  };
  const frames = new Map();
  let nextId = 0;
  globalThis.requestAnimationFrame = (fn) => { frames.set(++nextId, fn); return nextId; };
  globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
  return {
    root: new Element('div'),
    /** Run the queued animation frames at time `now` (ms). */
    frame(now) { const list = [...frames.values()]; frames.clear(); for (const fn of list) fn(now); },
    restore() {
      globalThis.document = saved.document;
      globalThis.Node = saved.Node;
      globalThis.requestAnimationFrame = saved.raf;
      globalThis.cancelAnimationFrame = saved.caf;
      if (saved.document === undefined) delete globalThis.document;
      if (saved.Node === undefined) delete globalThis.Node;
      if (saved.raf === undefined) { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; }
    },
  };
}
