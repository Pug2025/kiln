// CPU transforms for the kiln frame and contact lifecycle. No DOM or WebGL renderer exists.
import { Color as MarkColor, Vector3 as MarkVector3, Group as MarkGroup, Matrix4 as MarkMatrix4 } from './marks-three-stub.mjs';
export { Vector4, PlaneGeometry, BoxGeometry, RoundedBoxGeometry, TorusGeometry, ShaderMaterial, MeshBasicMaterial, InstancedBufferAttribute } from './marks-three-stub.mjs';
export { PlaneGeometry as RingGeometry } from './marks-three-stub.mjs';
export const CustomBlending = 5, OneFactor = 201, OneMinusSrcAlphaFactor = 205, AdditiveBlending = 3;
export class Color extends MarkColor { setHex(value) { return this.copy(new MarkColor(value)); } }
export class Vector3 extends MarkVector3 { copy(v) { return this.set(v.x, v.y, v.z); } }
export class Group extends MarkGroup {
  constructor() {
    super(); this.position = new Vector3(); this.rotation = new Vector3();
    this.scale = new Vector3(1, 1, 1); this.visible = true;
  }
}
export class Mesh extends Group {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
}
export class Matrix4 extends MarkMatrix4 {
  makeTranslation(x, y, z) { this.makeScale(1, 1, 1); return this.setPosition(x, y, z); }
  makeRotationZ(angle) { this.value = [0, 0, 0, angle, 1, 1, 1]; return this; }
  setPosition(x, y, z) { this.value[0] = x; this.value[1] = y; this.value[2] = z; return this; }
  premultiply(outer) {
    const [x, y, z, angle, sx, sy, sz] = this.value;
    const [ox, oy, oz, turn, ax, ay, az] = outer.value, c = Math.cos(turn), s = Math.sin(turn);
    this.value = [ox + c * ax * x - s * ay * y, oy + s * ax * x + c * ay * y,
      oz + az * z, angle + turn, ax * sx, ay * sy, az * sz];
    return this;
  }
}
export class InstancedMesh extends Mesh {
  constructor(geometry, material, capacity) {
    super(geometry, material); this.capacity = capacity; this.count = capacity;
    this.instanceMatrix = {}; this.matrices = []; this.boundingBox = this.boundingSphere = null;
  }
  setMatrixAt(index, matrix) { this.matrices[index] = [...matrix.value]; }
  // API/owner bookkeeping only; the real-Three pillar tests prove numeric aggregate bounds.
  computeBoundingBox() { this.boundingBox ??= {}; this.boxUpdates = (this.boxUpdates || 0) + 1; }
  computeBoundingSphere() { this.boundingSphere ??= {}; this.boundsUpdates = (this.boundsUpdates || 0) + 1; }
}
export class MeshStandardMaterial {
  constructor(options) { Object.assign(this, options); }
  clone() { return new MeshStandardMaterial(this); }
}
class Light extends Group { constructor(color, intensity) { super(); this.color = new Color(color); this.intensity = intensity; } }
export class HemisphereLight extends Light {}
export class DirectionalLight extends Light {}
export class PointLight extends Light {}
