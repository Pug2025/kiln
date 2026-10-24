// C: a stand-in for the parts of three.js that src/render/wordmark.js touches, so Node can check
// how many WebGL renderers (browser WebGL slots) the title flame uses. Counts live in STUB.

export const STUB = { renderers: 0, renders: 0, disposed: 0, contextsLost: 0, instances: [], renderLog: [], textures: [] };

export const SRGBColorSpace = 'srgb';
export const NoColorSpace = '';
export const NearestFilter = 1003;
export const CustomBlending = 5;
export const OneFactor = 201;
export const OneMinusSrcAlphaFactor = 205;
export const ACESFilmicToneMapping = 4;
export const RepeatWrapping = 1000;
export const BackSide = 1;

export class WebGLRenderer {
  constructor(opts = {}) {
    if (STUB.failRenderer) throw new Error('WebGL unavailable');
    STUB.renderers++;
    this.domElement = opts.canvas;
    this.outputColorSpace = '';
    this.capabilities = { getMaxAnisotropy: () => 4 };
    this.info = { memory: { geometries: 2, textures: 3 }, programs: [1, 2] };
  }
  setClearColor() {}
  setPixelRatio(pr) { this.pr = pr; }
  setSize(w, h) { this.w = w; this.h = h; }
  render(scene, camera) { STUB.renders++; STUB.renderLog.push({ renderer: this, scene, camera }); }
  dispose() { STUB.disposed++; }
  forceContextLoss() { STUB.contextsLost++; }
}

export class Color {
  constructor(c) { this.c = c; }
  clone() { return new Color(this.c); }
  multiplyScalar() { return this; }
}

export class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}

export class ShaderMaterial {
  constructor(o = {}) { Object.assign(this, o); this.userData = {}; }
  clone() { const m = new this.constructor(); Object.assign(m, this); return m; }
  dispose() {}
}
export class MeshStandardMaterial extends ShaderMaterial {}
export class MeshPhysicalMaterial extends ShaderMaterial {}
export class MeshBasicMaterial extends ShaderMaterial {}
class Texture {
  constructor(image) { this.image = image; this.disposals = 0; STUB.textures.push(this); }
  dispose() { this.disposals++; }
}
export class CanvasTexture extends Texture {}
export class DataTexture extends Texture {
  constructor(data, width, height) { super({ data, width, height }); this.isDataTexture = true; }
}

const xyz = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
class Object3D {
  constructor() { this.position = xyz(); this.rotation = xyz(); this.children = []; }
  add(...objects) { this.children.push(...objects); }
}

export class Scene extends Object3D {}
export class Group extends Object3D {}

export class OrthographicCamera {
  constructor() { this.position = { x: 0, y: 0, z: 0 }; }
}
export class PerspectiveCamera extends Object3D { lookAt() {} updateProjectionMatrix() {} }

export class PlaneGeometry {
  constructor(...args) { this.args = args; this.attributes = {}; }
  setAttribute(key, value) { this.attributes[key] = value; }
  dispose() {}
}
export class BoxGeometry extends PlaneGeometry {}
export class RoundedBoxGeometry extends PlaneGeometry {}
export class InstancedBufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } }
export class Matrix4 { makeTranslation(x, y, z) { this.xyz = [x, y, z]; return this; } }

export class Mesh extends Object3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
}
export class InstancedMesh extends Mesh {
  constructor(geometry, material, count) { super(geometry, material); this.count = count; this.matrices = []; STUB.instances.push(this); }
  setMatrixAt(i, matrix) { this.matrices[i] = [...matrix.xyz]; }
}
export class HemisphereLight extends Object3D {}
export class DirectionalLight extends Object3D {}
export class PointLight extends Object3D {}
export class PMREMGenerator { fromScene() { return { texture: { dispose() {} } }; } dispose() {} }

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
    classList: { values: new Set(), add(v) { this.values.add(v); }, remove(v) { this.values.delete(v); }, contains(v) { return this.values.has(v); } },
    listeners: new Map(),
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); },
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); },
    dispatch(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); },
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
  if (tag === 'canvas') el.getContext = () => ({
    fillRect() {}, getImageData: (x, y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    createRadialGradient: () => ({ addColorStop() {} }),
  });
  return el;
}

/** Install document, window, getComputedStyle and ResizeObserver shims. */
export function installDom() {
  globalThis.document = Object.assign(fakeElement('document'), { createElement: (tag) => fakeElement(tag), hidden: false });
  globalThis.window = Object.assign(fakeElement('window'), { devicePixelRatio: 2 });
  globalThis.getComputedStyle = (el) => ({ position: el.style.position || 'static' });
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(fn) { this.fn = fn; this.targets = new Set(); observers.push(this); }
    observe(el) { this.targets.add(el); }
    unobserve(el) { this.targets.delete(el); }
    disconnect() { this.targets.clear(); }
  };
  let nextFrame = 1;
  const frames = new Map();
  globalThis.requestAnimationFrame = (fn) => { const id = nextFrame++; frames.set(id, fn); return id; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  return { observers, frames, frame(now) { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(now); } };
}
