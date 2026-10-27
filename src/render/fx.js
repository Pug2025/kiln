// Kiln: break fragments and burst particles (OWNER: C).
//
// Fragments (ART 8): a break throws 8 glass + 4 ceramic fragments (dodecahedra squashed to
// 6.75 x 4.5 x 1.95), gravity 560, tumble +-12 rad/s; ceramic ones glow #FFD9A8 at
// 2.2 * e^(-1.6 t) + .05 PER FRAGMENT (instanced attribute); all gone by 2.4 s.
// Bursts: CPU ring buffer of points for hit sparks and the ball's thin trail.
// Decoration only, so Math.random is fine here (never game state).

import * as THREE from 'three';
import { FIELD } from '../core/constants.js';
import { LOOK } from './look.js';
import { PAL, PAL_VEC3 } from './materials.js';
import { BURST_VERT, BURST_FRAG } from './shaders.js';

const HW = FIELD.W / 2;
const HH = FIELD.H / 2;

function pool(n) {
  return {
    n,
    head: 0,
    on: new Uint8Array(n),
    x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n),
    rx: new Float32Array(n), ry: new Float32Array(n), wx: new Float32Array(n), wy: new Float32Array(n),
    s: new Float32Array(n), t0: new Float32Array(n), heat: new Float32Array(n),
  };
}

export function createFx(scene, M) {
  const root = new THREE.Group();
  root.name = 'fx';
  scene.add(root);

  // ---------------------------------------------------------------- fragments
  const fragGeo = new THREE.DodecahedronGeometry(1, 0);
  fragGeo.scale(LOOK.FRAG_SIZE[0], LOOK.FRAG_SIZE[1], LOOK.FRAG_SIZE[2]);
  const NG = Math.round(LOOK.FRAG_POOL * 2 / 3), NC = LOOK.FRAG_POOL - NG;
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x15171c, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
    envMapIntensity: 2.0, transparent: true, opacity: 0.9,
  });
  const glass = new THREE.InstancedMesh(fragGeo, glassMat, NG);
  glass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glass.frustumCulled = false;
  glass.count = 0;
  glass.renderOrder = 6;

  const cg = fragGeo.clone().scale(0.7, 0.8, 1.2);
  const glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(NC), 1);
  glowAttr.setUsage(THREE.DynamicDrawUsage);
  cg.setAttribute('aGlow', glowAttr);
  const ceramicMat = new THREE.MeshStandardMaterial({
    color: 0x2a2c30, map: M.tex.crackle, roughness: 0.75, metalness: 0.05,
    emissive: PAL.heatHi.clone(), emissiveIntensity: 1, envMapIntensity: 0.5,
  });
  ceramicMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow;');
  };
  ceramicMat.customProgramCacheKey = () => 'kiln-frag-ceramic';
  M.fragCeramic = ceramicMat;
  const ceramic = new THREE.InstancedMesh(cg, ceramicMat, NC);
  ceramic.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ceramic.frustumCulled = false;
  ceramic.count = 0;
  root.add(glass, ceramic);

  const PG = pool(NG), PC = pool(NC);

  // ---------------------------------------------------------------- burst points
  const NB = 480;
  const bpos = new Float32Array(NB * 3), blife = new Float32Array(NB), bsize = new Float32Array(NB);
  const bvel = new Float32Array(NB * 2), bdecay = new Float32Array(NB), bgain = new Float32Array(NB);
  const bcold = new Float32Array(NB);
  const bg = new THREE.BufferGeometry();
  const bposA = new THREE.BufferAttribute(bpos, 3).setUsage(THREE.DynamicDrawUsage);
  const blifeA = new THREE.BufferAttribute(blife, 1).setUsage(THREE.DynamicDrawUsage);
  const bsizeA = new THREE.BufferAttribute(bsize, 1).setUsage(THREE.DynamicDrawUsage);
  const bgainA = new THREE.BufferAttribute(bgain, 1).setUsage(THREE.DynamicDrawUsage);
  const bcoldA = new THREE.BufferAttribute(bcold, 1).setUsage(THREE.DynamicDrawUsage);
  bg.setAttribute('position', bposA);
  bg.setAttribute('aLife', blifeA);
  bg.setAttribute('aSize', bsizeA);
  bg.setAttribute('aGain', bgainA);
  bg.setAttribute('aCold', bcoldA);
  // per point gain (review 2026-10-22, ART 14: bloom only on the ball, molten cores, fire and the
  // rupture): hit sparks LOOK.BURST_GAIN keep heat-high under 0.85 linear, the ball's own trail
  // dots LOOK.TRAIL_GAIN may cross the bloom threshold
  const burstMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 1 }, uHeatLo: { value: PAL_VEC3.heatLo }, uHeatHi: { value: PAL_VEC3.heatHi } },
    vertexShader: BURST_VERT,
    fragmentShader: BURST_FRAG,
  });
  const bursts = new THREE.Points(bg, burstMat);
  bursts.frustumCulled = false;
  bursts.renderOrder = 9;
  root.add(bursts);
  let bhead = 0;
  let bliveAny = false;

  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const eul = new THREE.Euler();

  function spawnFrag(P, cx, cy, w, h, isCore, t, heat) {
    const k = P.head;
    P.head = (P.head + 1) % P.n;
    const a = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 220;
    P.on[k] = 1;
    P.x[k] = cx + (Math.random() - 0.5) * w * 0.9;
    P.y[k] = cy + (Math.random() - 0.5) * h * 0.8;
    P.z[k] = isCore ? 0 : LOOK.SHELL.d / 2 - 2;
    P.vx[k] = Math.cos(a) * sp;
    P.vy[k] = Math.sin(a) * sp + 140;
    P.vz[k] = 80 + Math.random() * 160;
    P.rx[k] = Math.random() * 6;
    P.ry[k] = Math.random() * 6;
    P.wx[k] = (Math.random() - 0.5) * 2 * LOOK.FRAG_TUMBLE;
    P.wy[k] = (Math.random() - 0.5) * 2 * LOOK.FRAG_TUMBLE;
    P.s[k] = 0.7 + Math.random() * 0.6;
    P.t0[k] = t;
    P.heat[k] = heat;
  }

  function stepPool(P, mesh, dt, t, attr) {
    let n = 0;
    for (let k = 0; k < P.n; k++) {
      if (!P.on[k]) continue;
      const el = t - P.t0[k];
      if (el >= LOOK.FRAG_LIFE_S) { P.on[k] = 0; continue; }
      P.x[k] += P.vx[k] * dt;
      P.y[k] += P.vy[k] * dt;
      P.z[k] += P.vz[k] * dt;
      P.vy[k] -= LOOK.FRAG_GRAVITY * dt;
      P.vz[k] -= 120 * dt;
      P.rx[k] += P.wx[k] * dt;
      P.ry[k] += P.wy[k] * dt;
      const fade = el > LOOK.FRAG_LIFE_S - 0.4 ? (LOOK.FRAG_LIFE_S - el) / 0.4 : 1;
      const s = P.s[k] * fade;
      pos.set(P.x[k], P.y[k], P.z[k]);
      quat.setFromEuler(eul.set(P.rx[k], P.ry[k], 0));
      scl.set(s, s, s);
      m4.compose(pos, quat, scl);
      mesh.setMatrixAt(n, m4);
      if (attr) attr.array[n] = (2.2 * Math.exp(-1.6 * el) + 0.05) * Math.min(1.6, 0.5 + P.heat[k]);
      n++;
    }
    mesh.count = n;
    if (n) mesh.instanceMatrix.needsUpdate = true;
    if (attr && n) attr.needsUpdate = true;
  }

  return {
    root,

    /** Fragments for a broken brick; cx, cy in world units. */
    breakAt(cx, cy, w, h, t, heat, rotated) {
      const ww = rotated ? h : w, hh = rotated ? w : h;
      for (let i = 0; i < LOOK.FRAG_GLASS; i++) spawnFrag(PG, cx, cy, ww, hh, false, t, heat);
      for (let i = 0; i < LOOK.FRAG_CERAMIC; i++) spawnFrag(PC, cx, cy, ww, hh, true, t, heat);
    },

    /** n burst points at a world position; gain LOOK.BURST_GAIN keeps them under the bloom threshold. */
    burst(x, y, z, n, spread, speed, size, life = 1, gain = LOOK.BURST_GAIN, cold = 0) {
      for (let i = 0; i < n; i++) {
        const k = bhead;
        bhead = (bhead + 1) % NB;
        bpos[k * 3] = x;
        bpos[k * 3 + 1] = y;
        bpos[k * 3 + 2] = z;
        blife[k] = 1;
        bgain[k] = gain;
        bcold[k] = cold;
        bdecay[k] = 2.4 / life;
        bsize[k] = size * (0.6 + Math.random() * 0.8);
        const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
        bvel[k * 2] = Math.cos(a) * s * spread;
        bvel[k * 2 + 1] = Math.sin(a) * s * spread;
      }
      bliveAny = true;
    },

    /** A short carbon-grey contact, deliberately separate from a successful molten core hit. */
    blocked(x, y) {
      this.burst(x, y, 8, 4, 0.7, 55, 5, 0.28, 0.55, 1);
    },

    /**
     * Permanent boss armour: a pale, very short metal tick, mostly neutral so warm stays the colour
     * of damage (review Oct 27: warm armour sparks read as a smaller damage burst). Not the core's
     * slow grey puff either: smaller, quicker and lighter.
     */
    armour(x, y) {
      this.burst(x, y, 8, 4, 0.8, 150, 3.5, 0.16, 1, 0.75);
    },

    setScale(s) {
      burstMat.uniforms.uScale.value = s;
    },

    clear() {
      PG.on.fill(0);
      PC.on.fill(0);
      blife.fill(0);
      glass.count = 0;
      ceramic.count = 0;
      blifeA.needsUpdate = true;
    },

    frame(dt, t) {
      stepPool(PG, glass, dt, t, null);
      stepPool(PC, ceramic, dt, t, glowAttr);
      if (bliveAny) {
        let any = false;
        for (let i = 0; i < NB; i++) {
          if (blife[i] <= 0) continue;
          blife[i] -= dt * bdecay[i];
          bpos[i * 3] += bvel[i * 2] * dt;
          bpos[i * 3 + 1] += bvel[i * 2 + 1] * dt;
          bvel[i * 2 + 1] += 90 * dt;
          if (blife[i] < 0) blife[i] = 0;
          else any = true;
        }
        bposA.needsUpdate = true;
        blifeA.needsUpdate = true;
        bsizeA.needsUpdate = true;
        bgainA.needsUpdate = true;
        bcoldA.needsUpdate = true;
        bliveAny = any;
      }
    },
  };
}

export { HW, HH };
