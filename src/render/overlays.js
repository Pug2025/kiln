// Kiln: field overlays (OWNER: C).
//   Blackout (level 28, fx.dark): the world is lit only within 150 units of each ball and 200 of
//            the paddle, soft edge 60 (ART 8). A dark plane in front of the field with lantern holes.
//   Fog drop (effects.fog 0..1): drifting smoke over the bricks, thinning toward the paddle, so
//            the wall is hard to read while it lasts.
// Both are single planes with uniforms written in place (no allocation).

import * as THREE from 'three';
import { FIELD, BALL, RING } from '../core/constants.js';
import { PAL } from './materials.js';
import { NOISE, withOutput } from './shaders.js';

const HW = FIELD.W / 2;
const HH = FIELD.H / 2;
const NL = BALL.MAX + 1;

const VERT = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

export function createOverlays(scene) {
  const lanterns = [];
  for (let i = 0; i < NL; i++) lanterns.push(new THREE.Vector4(0, 0, 0, 0));
  const darkMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: { uDark: { value: 0 }, uL: { value: lanterns }, uBase: { value: PAL.base } },
    vertexShader: VERT,
    fragmentShader: withOutput(`precision highp float; varying vec3 vW; uniform float uDark; uniform vec4 uL[${NL}]; uniform vec3 uBase;
      void main(){
        float lit = 0.0;
        for (int i = 0; i < ${NL}; i++) {
          vec4 L = uL[i];
          if (L.z <= 0.0) continue;
          float d = length(vW.xy - L.xy);
          lit = max(lit, 1.0 - smoothstep(L.z - L.w, L.z, d));
        }
        float a = uDark * 0.94 * (1.0 - lit);
        gl_FragColor = vec4(uBase * 0.4 * a, a);
      }`),
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.W + 40, FIELD.H + 40), darkMat);
  dark.position.z = 40;
  dark.renderOrder = 20;
  dark.visible = false;

  const fogMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uFog: { value: 0 }, uTime: { value: 0 }, uMode: { value: 0 }, uHeatLo: { value: PAL.heatLo } },
    vertexShader: VERT,
    fragmentShader: withOutput(`precision highp float; varying vec3 vW; uniform float uFog, uTime, uMode; uniform vec3 uHeatLo;
      ${NOISE}
      void main(){
        // field coordinates (x right, y down)
        vec2 f = vec2(vW.x + ${HW.toFixed(1)}, ${HH.toFixed(1)} - vW.y);
        float cover;
        if (uMode < 0.5) cover = 1.0 - smoothstep(620.0, 900.0, f.y);
        else if (uMode < 1.5) cover = smoothstep(80.0, 330.0, f.x);
        else cover = 1.0 - smoothstep(200.0, ${(RING.R_PADDLE - 30).toFixed(1)}, length(f - vec2(${RING.CX.toFixed(1)}, ${RING.CY.toFixed(1)})));
        vec2 p = f * 0.006;
        float n = fbm(vec2(p.x + uTime * 0.05, p.y - uTime * 0.03), 4);
        float n2 = fbm(vec2(p.x * 2.3 - uTime * 0.08 + 3.0, p.y * 2.0 + uTime * 0.04), 3);
        float d = smoothstep(0.25, 0.7, n * 0.75 + n2 * 0.4);
        // dark smoke with lighter wisps (a grey veil would lift the blacks and read cheap)
        float a = uFog * cover * (0.72 + 0.24 * d);
        vec3 col = mix(vec3(0.045, 0.04, 0.038), vec3(0.15, 0.14, 0.13), d) + uHeatLo * 0.03 * n2;
        gl_FragColor = vec4(col * a, a);
      }`),
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const fog = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.W, FIELD.H), fogMat);
  fog.position.z = 30;
  fog.renderOrder = 19;
  fog.visible = false;
  scene.add(dark, fog);

  let fogNow = 0;

  return {
    setWorld(world) {
      fogMat.uniforms.uMode.value = world.level.mode === 'left' ? 1 : world.level.mode === 'ring' ? 2 : 0;
      fogNow = 0;
    },

    frame(world, alpha, t, dt) {
      // Blackout lanterns
      const d = world.fx.dark || 0;
      dark.visible = d > 0.001;
      if (dark.visible) {
        darkMat.uniforms.uDark.value = d;
        let n = 0;
        const p = world.paddle;
        lanterns[n++].set(p.x - HW, HH - p.y, 200, 60);
        for (let i = 0; i < world.balls.length && n < NL; i++) {
          const b = world.balls[i];
          if (!b.alive) continue;
          lanterns[n++].set(b.px + (b.x - b.px) * alpha - HW, HH - (b.py + (b.y - b.py) * alpha), 150, 60);
        }
        for (; n < NL; n++) lanterns[n].set(0, 0, 0, 0);
      }
      // Fog eases in and out over 0.4 s
      const target = Math.max(0, Math.min(1, world.effects.fog || 0));
      fogNow += (target - fogNow) * Math.min(1, dt / 0.4 * 2.5);
      fog.visible = fogNow > 0.01;
      fogMat.uniforms.uFog.value = fogNow;
      fogMat.uniforms.uTime.value = t;
    },
  };
}
