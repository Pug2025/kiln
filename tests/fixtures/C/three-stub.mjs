// C: a stand-in for the parts of three.js that src/render/wordmark.js touches, so Node can check
// how many WebGL renderers (browser WebGL slots) the title flame uses. Counts live in STUB.

export const STUB = { renderers: 0, renders: 0, disposed: 0, contextsLost: 0 };

export const SRGBColorSpace = 'srgb';
export const CustomBlending = 5;
export const OneFactor = 201;
export const OneMinusSrcAlphaFactor = 205;

export class WebGLRenderer {
  constructor(opts = {}) {
    STUB.renderers++;
    this.domElement = opts.canvas;
    this.outputColorSpace = '';
  }
  setClearColor() {}
  setPixelRatio(pr) { this.pr = pr; }
  setSize(w, h) { this.w = w; this.h = h; }
  render() { STUB.renders++; }
  dispose() { STUB.disposed++; }
  forceContextLoss() { STUB.contextsLost++; }
}

export class Color {
  constructor(c) { this.c = c; }
}

export class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}

export class ShaderMaterial {
  constructor(o = {}) { Object.assign(this, o); }
  dispose() {}
}

export class Scene {
  constructor() { this.children = []; }
  add(o) { this.children.push(o); }
}

export class OrthographicCamera {
  constructor() { this.position = { x: 0, y: 0, z: 0 }; }
}

export class PlaneGeometry {
  dispose() {}
}

export class Mesh {
  constructor(geometry, material) { this.geometry = geometry; this.material = material; }
}

// ---- a minimal DOM: elements with parents, styles and sizes ----

export function fakeElement(tag = 'div', w = 0, h = 0) {
  const el = {
    tagName: tag.toUpperCase(),
    style: {},
    className: '',
    clientWidth: w,
    clientHeight: h,
    parentNode: null,
    children: [],
    appendChild(c) {
      if (c.parentNode) c.remove();
      c.parentNode = el;
      el.children.push(c);
      return c;
    },
    remove() {
      const p = el.parentNode;
      if (!p) return;
      p.children = p.children.filter((x) => x !== el);
      el.parentNode = null;
    },
  };
  return el;
}

/** Install document, window, getComputedStyle and ResizeObserver shims. */
export function installDom() {
  globalThis.document = { createElement: (tag) => fakeElement(tag) };
  globalThis.window = { devicePixelRatio: 2 };
  globalThis.getComputedStyle = (el) => ({ position: el.style.position || 'static' });
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(fn) { this.fn = fn; this.targets = new Set(); observers.push(this); }
    observe(el) { this.targets.add(el); }
    unobserve(el) { this.targets.delete(el); }
    disconnect() { this.targets.clear(); }
  };
  return { observers };
}
