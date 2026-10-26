// Kiln: the fire at the kiln mouth and the decorative sparks rising from it (OWNER: C). ART 9.1.
//
// One fire number drives everything warm: fire = base(combo multiplier) * breath + flare * 0.9.
//   base 0.55 / 0.70 / 0.85 / 1.00 and breathing rate 1.25 / 1.50 / 1.75 / 2.00 rad/s at x1/x2/x3/x5,
//   eased over 0.6 s; flares: paddle hit 0.6, perfect hit 0.8, ball lost 1.0, halving every 0.25 s.
// The fire light, haze warmth, back-wall glow and paddle heat line all read `value`.
//
// The kiln mouth stays at the bottom of the screen in every field mode (C call: the fire belongs to
// the kiln, not to the field; it rises as fire does).

import * as THREE from 'three';
import { FIELD } from '../core/constants.js';
import { LOOK } from './look.js';
import { FIT } from './fit.js';
import { PAL_VEC3 } from './materials.js';
import { FIRE_VERT, FIRE_FRAG, SPARK_VERT, SPARK_FRAG } from './shaders.js';

/** A fire ShaderMaterial for the kiln mouth. */
export function fireMaterial(opts = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending, // as look test 02 (src * alpha + dst)
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uOctaves: { value: opts.octaves ?? 5 },
      uAspect: { value: opts.aspect ?? 3 },
      uSoft: { value: opts.soft ?? 0 },
      // the flame's band: foot (world y) up to the lip (uClipY); tips at uTip band heights
      uFootY: { value: opts.footY ?? FOOT_Y },
      uTip: { value: 0.55 },
      uFlow: { value: 0 },
      uHot: { value: 0 },
      uHeatLo: { value: opts.heatLo ?? PAL_VEC3.heatLo },
      uHeatHi: { value: opts.heatHi ?? PAL_VEC3.heatHi },
      // legibility (ART 12b), written per frame by setLegibility()
      uClipY: { value: 1e5 },
      uFlareClipY: { value: 1e5 },
      uPadA: { value: new Float32Array([-1e5, -1e5]) },
      uPadB: { value: new Float32Array([-1e5, -1e5]) },
      uPadR: { value: 8 },
      uBand: { value: 0 },
      // Actual drawing-buffer capsule, shared by the two depths after camera update.
      uScreenA: { value: new Float32Array(2) },
      uScreenB: { value: new Float32Array(2) },
      uScreenR: { value: 0 },
      uScreenF: { value: 1 },
      uScreenStrength: { value: 0 },
    },
    vertexShader: FIRE_VERT,
    fragmentShader: FIRE_FRAG,
  });
}

// ART 12b: the flame tips stay under the kiln lip (field y 1030 in bottom mode); a ball-drop flare
// may climb FLARE_CLIMB units higher only away from the paddle; the fire dims to 35% inside the
// paddle band so it never blooms over the paddle.
const FLARE_CLIMB = 150;
const BAND_DIM = 0.65;

// C call (review 2026-10-22): the fire is drawn in the band it can be seen in. Its foot is the
// bottom of the kiln mouth the camera fit keeps in view (field y 1080 + FIT.MOUTH = 1150, world
// -610); its tips reach the lip at x5. Each plane runs from just under the foot (the soft foot fade)
// up to the highest a climbing flare may reach (the bottom-mode lip + FLARE_CLIMB): nothing is drawn
// to be clipped away. The deep plane's foot is the hearth floor (-700).
const FOOT_Y = FIELD.H / 2 - (FIELD.H + FIT.MOUTH); // -610
const DEEP_FOOT_Y = -700;
const LIP_Y_BOTTOM = FIELD.H / 2 - 1030; // -490
const PLANE_TOP = LIP_Y_BOTTOM + FLARE_CLIMB + 10; // -330

// the flame height in band units (1 = the lip): about 60% of the band at x1, the lip at x5 (C call)
const TIP_X1 = 0.62;
const TIP_X5 = 0.95;

/**
 * @param {THREE.Scene} scene
 */
export function createFire(scene) {
  const main = fireMaterial();
  const backM = fireMaterial({ soft: 1, octaves: 4, footY: DEEP_FOOT_Y });
  // the mouth sits behind the kiln lip (z -30)
  const mouthB = FOOT_Y - 2;
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.W, PLANE_TOP - mouthB), main);
  mouth.position.set(0, (PLANE_TOP + mouthB) / 2, -30);
  mouth.renderOrder = 2;
  const deepB = DEEP_FOOT_Y - 2;
  const deep = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.W + 200, PLANE_TOP - deepB), backM);
  deep.position.set(0, (PLANE_TOP + deepB) / 2, -230);
  deep.renderOrder = 1;
  scene.add(mouth, deep);
  const mats = [main, backM];

  // decorative sparks rising from the fire (GPU only)
  const N = LOOK.SPARKS;
  const seeds = new Float32Array(N), sizes = new Float32Array(N), rnd = new Float32Array(N * 3);
  let s = 12345;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < N; i++) {
    seeds[i] = r();
    sizes[i] = 1.6 + r() * 3.2 * (r() < 0.12 ? 2 : 1);
    rnd[i * 3] = r(); rnd[i * 3 + 1] = r(); rnd[i * 3 + 2] = r();
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  sg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  sg.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  sg.setAttribute('aRand', new THREE.BufferAttribute(rnd, 3));
  const sparkMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 1 }, uWidth: { value: 700 }, uHeight: { value: 980 }, uFlare: { value: 0 },
      uHeatLo: { value: PAL_VEC3.heatLo }, uHeatHi: { value: PAL_VEC3.heatHi },
    },
    vertexShader: SPARK_VERT,
    fragmentShader: SPARK_FRAG,
  });
  const sparks = new THREE.Points(sg, sparkMat);
  sparks.frustumCulled = false;
  scene.add(sparks);

  const st = {
    value: 0.55,   // the one fire number (after breath and flare)
    base: 0.55,    // eased toward the combo target
    omega: 1.25,
    phase: 0,      // breathing phase (integrated so a rate change never jumps)
    flare: 0,
    climb: 0,      // the part of the flare that may climb above the lip (ball drop, wall firing)
    hold: 0,       // seconds the wall-firing flare is held
    target: 0.55,
    targetOmega: 1.25,
    intro: 1,
    combo: 0,      // 0 at x1 .. 1 at x5 (eased with base)
    flow: 0,       // integrated noise scroll (faster at high combo)
  };

  return {
    main, backM, sparkMat, mouth, deep, sparks, st,

    setLite(lite) {
      main.uniforms.uOctaves.value = lite ? 3 : 5;
      deep.visible = !lite;
      sg.setDrawRange(0, lite ? LOOK.SPARKS_LITE : LOOK.SPARKS);
    },

    /** Combo multiplier 1/2/3/5 sets the breathing target. */
    setMult(mult) {
      const m = mult >= 5 ? 5 : mult >= 3 ? 3 : mult >= 2 ? 2 : 1;
      st.target = LOOK.FIRE_BY_MULT[m];
      st.targetOmega = LOOK.OMEGA_BY_MULT[m];
    },

    /** @param {boolean} [climb] a ball-drop (or wall-firing) flare may climb above the lip */
    flare(v, holdS = 0, climb = false) {
      if (v > st.flare) st.flare = v;
      if (holdS > st.hold) st.hold = holdS;
      if (climb && v > st.climb) st.climb = v;
    },

    /**
     * ART 12b, per frame: the lip line (world y), and the paddle as a capsule a -> b, radius r
     * (world units). The flame tips stay under the lip except a climbing flare away from the paddle.
     */
    setLegibility(lipY, ax, ay, bx, by, r) {
      for (let k = 0; k < 2; k++) {
        const u = mats[k].uniforms;
        u.uClipY.value = lipY;
        u.uFlareClipY.value = lipY + FLARE_CLIMB * Math.min(1, st.climb);
        u.uPadA.value[0] = ax; u.uPadA.value[1] = ay;
        u.uPadB.value[0] = bx; u.uPadB.value[1] = by;
        u.uPadR.value = r;
        u.uBand.value = BAND_DIM;
      }
    },

    /** Drawing-buffer pixels, bottom-left origin, after the drawn paddle and camera update. */
    setScreenLegibility(ax, ay, bx, by, radius, feather, strength = 0) {
      for (let k = 0; k < 2; k++) {
        const u = mats[k].uniforms;
        u.uScreenA.value[0] = ax; u.uScreenA.value[1] = ay;
        u.uScreenB.value[0] = bx; u.uScreenB.value[1] = by;
        u.uScreenR.value = radius;
        u.uScreenF.value = feather;
        u.uScreenStrength.value = strength;
      }
    },

    /** Advance by real dt; returns the fire number. */
    update(t, dt) {
      const k = Math.min(1, dt / LOOK.FIRE_EASE_S * 3); // reaches ~95% of a step in 0.6 s
      st.base += (st.target - st.base) * k;
      st.omega += (st.targetOmega - st.omega) * k;
      st.phase += st.omega * dt;
      if (st.hold > 0) st.hold -= dt;
      else {
        st.flare *= Math.pow(0.5, dt / LOOK.FLARE_HALF_S);
        st.climb *= Math.pow(0.5, dt / LOOK.FLARE_HALF_S);
      }
      const breath = 0.86 + 0.14 * Math.sin(st.phase) + 0.05 * Math.sin(t * 3.7);
      st.value = (st.base * breath + st.flare * 0.9) * st.intro;
      // what the combo changes on screen (C call): flame height in the band, flicker rate, core heat
      const c = Math.max(0, Math.min(1, (st.base - LOOK.FIRE_BY_MULT[1]) / (LOOK.FIRE_BY_MULT[5] - LOOK.FIRE_BY_MULT[1])));
      st.combo = c;
      st.flow += dt * (1 + 0.9 * c + 0.6 * st.flare);
      const tip = (TIP_X1 + (TIP_X5 - TIP_X1) * c) * (0.93 + 0.07 * Math.sin(st.phase)) + 0.25 * st.flare + 1.2 * st.climb;
      const hot = Math.min(1, c + 0.5 * st.flare);
      main.uniforms.uTime.value = t;
      main.uniforms.uIntensity.value = st.value;
      main.uniforms.uTip.value = tip * st.intro;
      main.uniforms.uFlow.value = st.flow;
      main.uniforms.uHot.value = hot;
      backM.uniforms.uTime.value = t * 0.8 + 3;
      backM.uniforms.uIntensity.value = st.value * 0.85;
      backM.uniforms.uTip.value = tip * 0.9 * st.intro;
      backM.uniforms.uFlow.value = st.flow * 0.8 + 3;
      backM.uniforms.uHot.value = hot * 0.5;
      sparkMat.uniforms.uTime.value = t;
      sparkMat.uniforms.uFlare.value = st.flare;
      return st.value;
    },

    reset() {
      for (let k = 0; k < 2; k++) mats[k].uniforms.uScreenStrength.value = 0;
      st.flare = 0;
      st.climb = 0;
      st.hold = 0;
      st.target = LOOK.FIRE_BY_MULT[1];
      st.targetOmega = LOOK.OMEGA_BY_MULT[1];
    },
  };
}
