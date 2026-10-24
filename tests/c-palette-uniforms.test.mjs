// Palette transitions must update existing shader buffers, including materials in another renderer.
import { register } from 'node:module';
import { test, assert } from './lib.mjs';
import { colorVec3, writeColorVec3 } from '../src/render/palette-uniforms.js';

// Only Color, Vector2 and material construction are needed; this test never creates WebGL.
const three = `
  export class Color {
    constructor(hex) {
      const n = typeof hex === 'number' ? hex : parseInt(hex.slice(1), 16);
      const linear = c => c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
      this.r = linear(((n >> 16) & 255) / 255);
      this.g = linear(((n >> 8) & 255) / 255);
      this.b = linear((n & 255) / 255);
    }
    copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
    lerp(c, a) { this.r += (c.r-this.r)*a; this.g += (c.g-this.g)*a; this.b += (c.b-this.b)*a; return this; }
  }
  export class Vector2 { constructor(x, y) { this.x=x; this.y=y; } }
  export class MeshStandardMaterial { constructor(opts) { Object.assign(this, opts); this.userData={}; } }
  export class ShaderMaterial { constructor(opts) { Object.assign(this, opts); } }
`;
const threeURL = `data:text/javascript,${encodeURIComponent(three)}`;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const { PAL, PAL_VEC3, coreMaterial, syncPaletteUniforms } = await import('../src/render/materials.js');
const { fireMaterial } = await import('../src/render/fire.js');
const channels = c => [c.r, c.g, c.b].map(Math.fround);

test('shader vec3: keeps linear HDR channels and rewrites scaled phone text without drift', () => {
  const color = { r: .015, g: 1.35, b: -.07 };
  const out = colorVec3(color, 1.25);
  assert.ok(out instanceof Float32Array);
  assert.deepEqual([...out], [color.r * 1.25, color.g * 1.25, color.b * 1.25].map(Math.fround));
  for (const scale of [.9, 1.25, .9, 1.25]) {
    assert.equal(writeColorVec3(out, color, scale), out, 'buffer identity is stable');
    assert.deepEqual([...out], [color.r * scale, color.g * scale, color.b * scale].map(Math.fround));
  }
  assert.deepEqual(color, { r: .015, g: 1.35, b: -.07 }, 'source color is unchanged');
});

test('palette: last-life transition and recovery update existing materials across renderer instances', () => {
  const first = coreMaterial({}), second = coreMaterial({}), fire = fireMaterial();
  const heat = PAL_VEC3.heatLo, high = [...PAL_VEC3.heatHi];
  const target = { r: .88, g: .12, b: .024 };
  assert.deepEqual([...heat], channels(PAL.heatLo));
  for (const esc of [0, .15, .5, 1, .6, 0]) {
    PAL.heatLo.copy(PAL.heatLoRest).lerp(target, esc);
    syncPaletteUniforms();
    assert.equal(PAL_VEC3.heatLo, heat, 'sync never replaces the shared buffer');
    for (const material of [first, second]) {
      assert.equal(material.userData.u.uHeatLo.value, heat);
      assert.deepEqual([...material.userData.u.uHeatLo.value], channels(PAL.heatLo));
    }
    assert.equal(fire.uniforms.uHeatLo.value, heat);
    assert.equal(coreMaterial({}).userData.u.uHeatLo.value, heat, 'new renderer materials retain current palette');
    assert.deepEqual([...heat], channels(PAL.heatLo), 'new material does not reset the palette');
    assert.deepEqual([...PAL_VEC3.heatHi], high, 'immutable palette color is untouched');
  }
});

test('fire palette: caller-supplied live color overrides retain their identity', () => {
  const low = { r: .2, g: .3, b: .4 }, high = new Float32Array([1, .8, .6]);
  const fire = fireMaterial({ heatLo: low, heatHi: high });
  low.r = .7;
  assert.equal(fire.uniforms.uHeatLo.value, low);
  assert.equal(fire.uniforms.uHeatHi.value, high);
  assert.equal(fire.uniforms.uHeatLo.value.r, .7);
});
