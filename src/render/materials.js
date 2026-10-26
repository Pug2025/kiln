// Kiln: palette, textures and the shared materials (OWNER: C). Ported from look test 02.
//
// Every material is built ONCE per renderer and reused across worlds (recreating materials per
// level leaks GPU programs and memory). Kit files from F (ARTKIT.md paths) load in the background;
// until they arrive, or when one is missing, procedural canvas textures stand in, so the game
// never waits on the kit.

import * as THREE from 'three';
import { COLOR } from '../core/constants.js';
import { colorVec3, writeColorVec3 } from './palette-uniforms.js';

// ---------------------------------------------------------------- palette (shared Color objects)
// HEAT_LO is mutable: the last-life escalation shifts it toward #F36123 and every material that
// holds this object follows. App-owned shader uniforms share the flat buffers below.
export const PAL = {
  base: new THREE.Color(COLOR.WORLD_BASE),
  graphite: new THREE.Color(COLOR.WORLD_GRAPHITE),
  heatLo: new THREE.Color(COLOR.HEAT_LO),
  heatHi: new THREE.Color(COLOR.HEAT_HI),
  text: new THREE.Color(COLOR.TEXT),
  cold: new THREE.Color(COLOR.COLD),
  warn: new THREE.Color(COLOR.WARN),
  heatLoRest: new THREE.Color(COLOR.HEAT_LO),
};

// Shared with PAL across renderer instances; creating another renderer never resets either.
export const PAL_VEC3 = {
  base: colorVec3(PAL.base),
  graphite: colorVec3(PAL.graphite),
  heatLo: colorVec3(PAL.heatLo),
  heatHi: colorVec3(PAL.heatHi),
};

/** Call immediately after changing PAL.heatLo so every shader sees the same transition. */
export function syncPaletteUniforms() {
  writeColorVec3(PAL_VEC3.heatLo, PAL.heatLo);
}

/** Two renderer-owned samplers let opaque standard materials share map/normal shader features. */
export function createNeutralTextures() {
  const neutralMap = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  neutralMap.name = 'kiln-neutral-white';
  neutralMap.colorSpace = THREE.SRGBColorSpace;
  const neutralNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  neutralNormal.name = 'kiln-neutral-normal';
  neutralNormal.colorSpace = THREE.NoColorSpace;
  for (const texture of [neutralMap, neutralNormal]) {
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
  }
  return { neutralMap, neutralNormal };
}

/** Preserve real textures and material values; a zero tangent perturbation keeps the old normal. */
export function unifyStandardMaterial(material, tex) {
  if (!material?.isMeshStandardMaterial || material.isMeshPhysicalMaterial || material.transparent) return false;
  // Custom shaders have their own keys, so extra features cannot merge them with ordinary
  // standards. Leave their existing samplers alone; late clones can still inherit base fallbacks.
  if (material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return false;
  let changed = false;
  if (!material.map) {
    material.map = tex.neutralMap;
    changed = true;
  }
  // A normal map would replace bump mapping, and object-space normals ignore normalScale.
  if (!material.normalMap && !material.bumpMap && material.normalMapType === THREE.TangentSpaceNormalMap) {
    material.normalMap = tex.neutralNormal;
    material.normalScale.set(0, 0);
    changed = true;
  }
  if (changed) material.needsUpdate = true;
  return changed;
}

/** Includes hidden pools and later kit models; called only before shader warm-up, never per frame. */
export function unifyStandardMaterials(root, tex) {
  root.traverse((o) => {
    if (Array.isArray(o.material)) {
      for (const material of o.material) unifyStandardMaterial(material, tex);
    } else unifyStandardMaterial(o.material, tex);
  });
}

// ---------------------------------------------------------------- canvas helpers
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Deterministic tiny PRNG for procedural textures (no Math.random, so every boot looks the same). */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Procedural ceramic crackle (albedo + height) for when textures/crackle.png is not there. */
function proceduralCrackle() {
  const N = 256;
  const r = prng(7);
  const c = canvas(N, N);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = 'rgb(29,29,31)';
  g.fillRect(0, 0, N, N);
  const img = g.getImageData(0, 0, N, N);
  for (let i = 0; i < N * N; i++) {
    const v = (r() - 0.5) * 10;
    img.data[i * 4] += v;
    img.data[i * 4 + 1] += v;
    img.data[i * 4 + 2] += v + 1;
  }
  g.putImageData(img, 0, 0);
  // faint crack lines, wrapped so the tile is seamless
  g.lineWidth = 0.8;
  for (let k = 0; k < 70; k++) {
    let x = r() * N, y = r() * N, a = r() * Math.PI * 2;
    g.strokeStyle = `rgba(70,70,74,${0.25 + r() * 0.35})`;
    for (let s = 0; s < 14; s++) {
      const nx = x + Math.cos(a) * 6, ny = y + Math.sin(a) * 6;
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(nx + ox, ny + oy);
        g.stroke();
      }
      x = nx; y = ny; a += (r() - 0.5) * 0.9;
    }
  }
  // normal map from the albedo luminance (Sobel), tangent space, linear
  const src = g.getImageData(0, 0, N, N).data;
  const nc = canvas(N, N);
  const ng = nc.getContext('2d');
  const out = ng.createImageData(N, N);
  const L = (x, y) => src[(((y + N) % N) * N + ((x + N) % N)) * 4] / 255;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (L(x + 1, y) - L(x - 1, y)) * 6;
    const dy = (L(x, y + 1) - L(x, y - 1)) * 6;
    const l = Math.hypot(dx, dy, 1);
    const o = (y * N + x) * 4;
    out.data[o] = ((-dx / l) * 0.5 + 0.5) * 255;
    out.data[o + 1] = ((dy / l) * 0.5 + 0.5) * 255;
    out.data[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    out.data[o + 3] = 255;
  }
  ng.putImageData(out, 0, 0);
  return { albedo: c, normal: nc };
}

/** Brushed titanium: horizontal grain (ART 8: procedural 512x128 canvas). */
function brushedCanvas() {
  const w = 512, h = 128;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const r = prng(11);
  g.fillStyle = '#a6aab0';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const y = r() * h, l = 30 + r() * 200, a = r() * 0.16;
    const v = r() < 0.5 ? 255 : 0;
    g.strokeStyle = `rgba(${v},${v},${v},${a})`;
    g.lineWidth = 1;
    g.beginPath();
    const x = r() * w;
    g.moveTo(x, y);
    g.lineTo(x + l, y);
    g.stroke();
  }
  return c;
}

/** Soft radial glow sprite. */
function glowCanvas() {
  const s = 64;
  const c = canvas(s, s);
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.3, 'rgba(255,255,255,.5)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, s, s);
  return c;
}

// ---------------------------------------------------------------- glass (Fresnel, premultiplied)
/**
 * Smoked glass: MeshPhysicalMaterial whose alpha follows Fresnel (aMin face-on, aMax at grazing),
 * premultiplied blend so the core shows through the middle and the edges go dark and reflective.
 */
export function glassMaterial(opts = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: opts.color ?? 0x161a20,
    roughness: opts.roughness ?? 0.09,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: opts.env ?? 2.4,
    ior: 1.5,
    specularIntensity: 1,
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: true,
  });
  const u = { uAlphaMin: { value: opts.aMin ?? 0.4 }, uAlphaMax: { value: opts.aMax ?? 0.92 }, uFade: { value: 1 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uAlphaMin, uAlphaMax, uFade;')
      .replace('#include <opaque_fragment>', `
        float fres = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 3.0);
        float a = mix(uAlphaMin, uAlphaMax, fres) * uFade;
        vec3 spec = totalSpecular;
        #ifdef USE_CLEARCOAT
          spec = spec * (1.0 - material.clearcoat * Fcc) + (clearcoatSpecularDirect + clearcoatSpecularIndirect) * material.clearcoat;
        #endif
        vec3 diff = totalDiffuse + totalEmissiveRadiance;
        gl_FragColor = vec4(spec * uFade + diff * a, a);`);
  };
  m.userData.u = u;
  m.customProgramCacheKey = () => 'kiln-glass';
  return m;
}

// ---------------------------------------------------------------- ceramic core (per-instance heat)
const HEAT_GLSL = `
  float h = clamp(vHeat, 0.0, 3.0);
  float lum = dot(texture2D(map, vMapUv).rgb, vec3(0.33));
  float crack = smoothstep(0.09, 0.30, lum);
  vec2 cuv = (vMapUv - 0.5) * vec2(1.0, 1.35);
  float centre = 1.0 - smoothstep(0.12, 0.62, length(cuv));
  vec3 hot = mix(uHeatLo, uHeatHi, smoothstep(0.55, 1.4, h) * (0.35 + 0.65 * centre));
  float body = pow(min(h, 1.0), 2.0) * (0.35 + 0.95 * centre);
  float lines = min(h, 1.2) * 0.9 * crack * (0.5 + 0.5 * centre);
  // A hit whitens the contained centre, not the complete slab. A uniform white flash
  // flooded the ball's surroundings with bloom even while its core stayed clearly drawn.
  float whiteCore = centre * centre * centre * centre;
  totalEmissiveRadiance += hot * (body + lines) + vec3(1.0, 0.95, 0.85) * max(h - 1.0, 0.0) * 1.8 * whiteCore;
  // molten (heat 1, tier 3; explosive peaks; weak points): a white-hot centre that crosses the bloom
  // threshold through the shell (ART 7 lists molten cores as bloom sources; C call, review 2026-10-22)
  totalEmissiveRadiance += vec3(1.0, 0.9, 0.72) * smoothstep(0.9, 1.0, h) * whiteCore * 1.25;
  diffuseColor.rgb *= 1.0 - 0.45 * min(h, 1.0);`;

// Live bricks retain heat colour and contained crack light without white HDR plates. Boss
// materials keep their existing contained-heart treatment; this is the instanced brick path.
const BRICK_HEAT_GLSL = `
  float h = clamp(vHeat < 0.0 ? -vHeat - 1.0 : vHeat, 0.0, 3.0);
  float lum = dot(texture2D(map, vMapUv).rgb, vec3(0.33));
  float crack = smoothstep(0.09, 0.30, lum);
  vec2 cuv = (vMapUv - 0.5) * vec2(1.0, 1.35);
  float centre = 1.0 - smoothstep(0.12, 0.62, length(cuv));
  vec3 hot = mix(uHeatLo, uHeatHi, smoothstep(0.55, 1.4, h) * (0.35 + 0.65 * centre));
  float body = pow(min(h, 1.0), 2.0) * (0.12 + 0.42 * centre);
  float lines = min(h, 1.2) * 0.45 * crack * (0.5 + 0.5 * centre);
  float pulse = max(h - 1.0, 0.0) * 0.12 * pow(centre, 4.0);
  vec3 emission = hot * min(0.72, body + lines + pulse);
  // Preserve the existing very brief, dim rupture cue. It never becomes a white flash.
  totalEmissiveRadiance += emission * (vHeat < 0.0 ? 0.01 : 1.0);
  diffuseColor.rgb *= 1.0 - 0.45 * min(h, 1.0);`;

/**
 * Ceramic core: crackle albedo + normal, heat from the instanced attribute `aHeat` (0 cold, 1
 * molten, above 1 flash; negative encodes -(1 + rupture heat)). `instanced: false` reads heat
 * from the uniform uHeatValue instead.
 */
export function coreMaterial(tex, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0x383b41,
    map: tex.crackle,
    normalMap: tex.crackleN,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.8,
    metalness: 0.05,
    envMapIntensity: 0.5,
  });
  const instanced = opts.instanced !== false;
  const u = { uHeatLo: { value: PAL_VEC3.heatLo }, uHeatHi: { value: PAL_VEC3.heatHi }, uHeatValue: { value: opts.heat ?? 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${instanced ? 'attribute float aHeat;' : 'uniform float uHeatValue;'}\nvarying float vHeat;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvHeat = ${instanced ? 'aHeat' : 'uHeatValue'};`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHeat; uniform vec3 uHeatLo, uHeatHi;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${instanced ? BRICK_HEAT_GLSL : HEAT_GLSL}`);
  };
  m.userData.u = u;
  m.customProgramCacheKey = () => (instanced ? 'kiln-core-i-calm' : 'kiln-core-u');
  return m;
}

// ---------------------------------------------------------------- the material set
/**
 * Build every shared texture and material once.
 * @param {THREE.WebGLRenderer} gl
 */
export function createMaterials(gl) {
  const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
  const proc = proceduralCrackle();
  const crackle = new THREE.CanvasTexture(proc.albedo);
  crackle.colorSpace = THREE.SRGBColorSpace;
  crackle.wrapS = crackle.wrapT = THREE.RepeatWrapping;
  crackle.anisotropy = 4;
  const crackleN = new THREE.CanvasTexture(proc.normal);
  crackleN.wrapS = crackleN.wrapT = THREE.RepeatWrapping;
  const brushed = new THREE.CanvasTexture(brushedCanvas());
  brushed.colorSpace = THREE.SRGBColorSpace;
  brushed.wrapS = brushed.wrapT = THREE.RepeatWrapping;
  brushed.anisotropy = aniso;
  const glow = new THREE.CanvasTexture(glowCanvas());
  glow.colorSpace = THREE.SRGBColorSpace;

  // Shared by all normalized materials/clones; material references also expose ownership to
  // scene pruning. As with the other M.tex textures, the renderer's context owns the GPU copies.
  const tex = { crackle, crackleN, brushed, glow, ...createNeutralTextures() };

  const M = {
    tex,
    shell: glassMaterial(),
    wallGlass: glassMaterial({ aMin: 0.28, aMax: 0.9, color: 0x0e1014 }),
    cavityGlass: glassMaterial({ aMin: 0.16, aMax: 0.85, color: 0x1a1e24, env: 1.8 }),
    paddleGlass: glassMaterial({ aMin: 0.3, aMax: 0.9, color: 0x1a1e26, env: 2.6 }),
    core: coreMaterial(tex),
    titanium: new THREE.MeshStandardMaterial({ color: 0xc0c4ca, map: brushed, roughness: 0.38, metalness: 0.9, envMapIntensity: 2.4 }),
    matte: new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 1, metalness: 0, envMapIntensity: 0 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.45, metalness: 0.9, envMapIntensity: 0.9 }),
    // cast grate bars: dark iron, a little heat-low from the coals under them (review 2026-10-22:
    // unlit black bars read as a bench in front of the fire)
    grate: new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.55, metalness: 0.9, envMapIntensity: 0.4, emissive: PAL.heatLoRest.clone().multiplyScalar(0.035) }),
    // ribs lifted from 0x15171b toward graphite (ART 11.4: they read as dark bars through the plate)
    ribs: new THREE.MeshStandardMaterial({ color: 0x24211e, roughness: 0.7, metalness: 0.35, envMapIntensity: 0.45 }),
    pillars: new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.75, metalness: 0.3, envMapIntensity: 0.45 }),
    seam: new THREE.MeshBasicMaterial({ color: 0x111317 }),
    white: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(1.3) }),
    white70: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1), transparent: true, opacity: 0.7, depthWrite: false }),
    white50: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1), transparent: true, opacity: 0.5, depthWrite: false }),
    warn: new THREE.MeshBasicMaterial({ color: PAL.warn.clone().multiplyScalar(1.2) }),
    cold: new THREE.MeshBasicMaterial({ color: PAL.cold.clone(), transparent: true, opacity: 0.6, depthWrite: false }),
  };
  // One material never serves both plain meshes and InstancedMeshes: three keeps one program per
  // material and switches it (getParameters, cache key, allocation) every time the two kinds
  // alternate in a frame (review 2026-10-22: wall glass on the walls and the drop pool did it twice
  // a frame). Instanced users (bricks, marks, pickups) keep the names above; plain meshes (the
  // arena frame, the kiln lips, boss parts) use these twins; the drop shells get their own glass.
  M.titaniumP = M.titanium.clone();
  M.matteP = M.matte.clone();
  // Free-moving instanced bodies never inherit the brick wall's ceiling clipping variant.
  M.matteFree = M.matte.clone();
  M.darkMetalP = M.darkMetal.clone();
  M.wallGlassI = glassMaterial({ aMin: 0.28, aMax: 0.9, color: 0x0e1014 });
  return M;
}
