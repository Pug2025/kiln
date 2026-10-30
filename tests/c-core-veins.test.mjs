// Real retained material inputs and the pinned standard shader, without WebGL or a browser.
import { register } from 'node:module';
import { test, assert } from './lib.mjs';
const threeURL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const THREE = await import(threeURL);
const { coreMaterial, createCoreState } = await import('../src/render/materials.js');
function compiled(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  return shader;
}

test('core mask uses a native retained sampler and registers only the normal UV with the cropped atlas', () => {
  const tex = { crackle: new THREE.Texture(), crackleN: new THREE.Texture(), crackleMask: new THREE.Texture() };
  const core = coreMaterial(tex), sh = compiled(core);
  assert.equal(core.emissiveMap, tex.crackleMask); assert.equal(core.map, tex.crackle); assert.equal(core.normalMap, tex.crackleN);
  assert.equal(sh.uniforms.uVeinMask.value, 1);
  assert.ok(sh.vertexShader.includes('vNormalMapUv = mix(vNormalMapUv, vCoreUv, uVeinMask)'));
  assert.ok(sh.fragmentShader.includes('texture2D(emissiveMap, vCoreUv).rg'));
  assert.ok(sh.fragmentShader.includes('(vMapUv - 0.5)'), 'centre shading retains the uncropped local face UV');
  assert.ok(sh.fragmentShader.includes('veins.g * 0.35 * smoothstep'), 'hairlines stay soft and fade below device-pixel width');
  assert.ok(!sh.fragmentShader.includes('#include <emissivemap_fragment>'), 'the native mask is never also added as unbounded RGB emission');
  const fallback = coreMaterial({ crackle: tex.crackle, crackleN: tex.crackleN });
  assert.equal(fallback.emissiveMap, tex.crackle); assert.equal(fallback.userData.u.uVeinMask.value, 0);
});

test('brick rupture brightens bounded veins while the boss retains its contained white-hot heart', () => {
  const tex = { crackle: null, crackleN: null };
  const brick = compiled(coreMaterial(tex)), boss = compiled(coreMaterial(tex, { instanced: false, heat: 1.25, seed: 0.3 }));
  assert.ok(brick.fragmentShader.includes('float slab = (body + pulse) * 0.01'), 'whole-core rupture flash stays suppressed');
  assert.ok(brick.fragmentShader.includes('uVeinMask * (1.0 - vCoreHeart)'), 'fused boss cores retain their original body and cap with the mask active');
  assert.ok(brick.fragmentShader.includes('mix(0.72, mix(0.6, 1.0, vRupture), veinBody)'), 'the procedural title keeps its original cap while registered veins use the new budget');
  assert.ok(brick.fragmentShader.includes('min(cap, slab + lines)'));
  assert.ok(!brick.fragmentShader.includes('whiteCore'));
  assert.equal(boss.uniforms.uHeatValue.value, 1.25); assert.equal(boss.uniforms.uSeed.value, 0.3);
  assert.ok(boss.fragmentShader.includes('max(h - 1.0, 0.0) * 1.8 * whiteCore'));
  assert.ok(boss.fragmentShader.includes('smoothstep(0.9, 1.0, h) * whiteCore * 1.25'));
  assert.ok(!boss.fragmentShader.includes('slab + lines'), 'brick attenuation never enters the boss heart shader');
});

test('retained core state starts with distinct stable seeds and no rupture phase', () => {
  const a = createCoreState(48), b = createCoreState(48);
  assert.ok(a.isInstancedBufferAttribute); assert.equal(a.itemSize, 2); assert.equal(a.count, 48);
  assert.deepEqual(a.array, b.array); assert.notEqual(a.array, b.array);
  assert.equal(new Set(Array.from({ length: 48 }, (_, i) => a.array[i * 2])).size, 48);
  for (let i = 0; i < 48; i++) {
    assert.ok(a.array[i * 2] >= 0 && a.array[i * 2] < 1); assert.equal(a.array[i * 2 + 1], 0);
  }
});

test('R1 fused heart emission keeps the complete former slab result as a floor, including old bright cracks', () => {
  const sh = compiled(coreMaterial({ crackle: null, crackleN: null }));
  assert.ok(sh.fragmentShader.includes('if (vCoreHeart > 0.5)'));
  assert.ok(sh.fragmentShader.includes('crack = max(crack, smoothstep(0.09, 0.30, lum))'));
  // Evaluate the actual injected scalar expressions; vCoreHeart=1 and uVeinMask=1 represent
  // the real fused brick with R1 active. The legacy crack can exceed the new mask at this UV.
  const mix = (a, b, k) => a * (1 - k) + b * k;
  function scalar(name, values) {
    const expression = sh.fragmentShader.match(new RegExp(`float ${name} = ([^;]+);`))[1];
    return Function(...Object.keys(values), 'min', 'max', 'pow', 'mix', `return ${expression};`)
      (...Object.values(values), Math.min, Math.max, Math.pow, mix);
  }
  for (const [h, centre, oldCrack, maskCrack] of [[1.15, 1, 0, 0], [1.75, 0.4, 1, 0], [3, 1, 0.7, 0.2], [0.045, 0.1, 1, 0]]) {
    const values = { h, centre, crack: Math.max(oldCrack, maskCrack), uVeinMask: 1, vCoreHeart: 1, vRupture: 0 };
    for (const name of ['veinBody', 'body', 'veinGain', 'lineGain', 'lines', 'pulse', 'cap', 'emission']) values[name] = scalar(name, values);
    const oldBody = Math.min(h, 1) ** 2 * (0.12 + 0.42 * centre);
    const oldLines = Math.min(h, 1.2) * 0.45 * oldCrack * (0.5 + 0.5 * centre);
    const oldPulse = Math.max(h - 1, 0) * 0.12 * centre ** 4;
    assert.equal(values.body, oldBody); assert.equal(values.pulse, oldPulse); assert.equal(values.cap, 0.72);
    assert.ok(values.emission >= Math.min(0.72, oldBody + oldLines + oldPulse), `heat ${h}: R1 never dims a fused heart`);
  }
});
