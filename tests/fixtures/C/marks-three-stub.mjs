// Small CPU stand-in for mark transforms and per-instance colors. No renderer or browser exists.
export const DynamicDrawUsage = 1, LinearMipmapLinearFilter = 2, AdditiveBlending = 3;
export class Color {
  constructor(value = 0) {
    if (typeof value === 'string') value = parseInt(value.replace('#', ''), 16);
    const linear = n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
    this.r = linear(((value >> 16) & 255) / 255);
    this.g = linear(((value >> 8) & 255) / 255);
    this.b = linear((value & 255) / 255);
  }
  clone() { return new Color().copy(this); }
  copy(v) { this.r = v.r; this.g = v.g; this.b = v.b; return this; }
  multiplyScalar(v) { this.r *= v; this.g *= v; this.b *= v; return this; }
  lerp(v, amount) { this.r += (v.r - this.r) * amount; this.g += (v.g - this.g) * amount; this.b += (v.b - this.b) * amount; return this; }
}
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
export class Vector4 { fromArray(a, i) { [this.x, this.y, this.z, this.w] = a.slice(i, i + 4); return this; } }
export class Quaternion {
  setFromAxisAngle(axis, angle) { this.angle = angle; return this; }
  identity() { this.angle = 0; return this; }
  copy(value) { this.angle = value.angle; return this; }
}
export class Matrix4 {
  compose(p, q, s) { this.value = [p.x, p.y, p.z, q.angle || 0, s.x, s.y, s.z]; return this; }
  makeScale(x, y, z) { this.value = [0, 0, 0, 0, x, y, z]; return this; }
}
export class Group {
  constructor() { this.children = []; }
  add(...v) { this.children.push(...v); }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
  getObjectByName(name) { return this.name === name ? this : this.children.map(v => v.getObjectByName?.(name)).find(Boolean); }
}
export class PlaneGeometry {
  constructor(...args) { this.args = args; this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  clone() { return new this.constructor(...this.args); }
}
export class BoxGeometry extends PlaneGeometry {}
export class RoundedBoxGeometry extends BoxGeometry {}
export class Plane { constructor(normal, constant) { this.normal = normal; this.constant = constant; } }
export class SphereGeometry extends PlaneGeometry {}
export class TorusGeometry extends PlaneGeometry {}
export class ShaderMaterial { constructor(opts) { Object.assign(this, opts); } }
export class MeshBasicMaterial extends ShaderMaterial {
  constructor(opts) { super(opts); this.color = opts.color instanceof Color ? opts.color : new Color(opts.color); }
}
export class InstancedBufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
  setUsage() { return this; }
}
export class InstancedMesh extends Group {
  constructor(geometry, material, cap) {
    super(); this.geometry = geometry; this.material = material; this.capacity = cap;
    this.isInstancedMesh = true;
    this.instanceMatrix = { setUsage() {}, array: new Float32Array(cap * 16) }; this.colors = []; this.matrices = [];
  }
  setColorAt(i, color) { this.colors[i] = [color.r, color.g, color.b]; this.instanceColor ||= {}; }
  setMatrixAt(i, matrix) { this.matrices[i] = [...matrix.value]; }
}
export class CanvasTexture { constructor(image) { this.image = image; this.userData = {}; } }
export function installCanvas() {
  globalThis.document = { createElement() {
    return { getContext() { return new Proxy({}, { get(target, key) {
      if (key === 'getImageData') return (x, y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4).fill(255) });
      return () => {};
    }, set() { return true; } }); } };
  } };
}
