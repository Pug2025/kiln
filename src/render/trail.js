// Kiln: the Fire-ball trail (OWNER: C). ART 9.3: while Fire is active each ball trails a flame
// ribbon 54 units long (6 radii), width 18 -> 0, intensity following the speed tier; only its root
// crosses the bloom threshold. CPU ribbon from each ball's recent path, written in place.

import * as THREE from 'three';
import { FIELD, BALL } from '../core/constants.js';
import { PAL } from './materials.js';
import { NOISE, withOutput } from './shaders.js';

const HW = FIELD.W / 2;
const HH = FIELD.H / 2;
const HIST = 24;
const SEG = 12;
const LEN = 54;
const WIDTH = 18;

export function createTrail(scene) {
  const NB = BALL.MAX;
  const hx = new Float32Array(NB * HIST), hy = new Float32Array(NB * HIST);
  const hn = new Int32Array(NB), hHead = new Int32Array(NB);
  const vPerBall = (SEG + 1) * 2;
  const posArr = new Float32Array(NB * vPerBall * 3);
  const uvArr = new Float32Array(NB * vPerBall * 2);
  const gainArr = new Float32Array(NB * vPerBall);
  const idx = [];
  for (let b = 0; b < NB; b++) {
    for (let s = 0; s < SEG; s++) {
      const o = b * vPerBall + s * 2;
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
    for (let s = 0; s <= SEG; s++) {
      const o = b * vPerBall + s * 2;
      uvArr[o * 2] = s / SEG; uvArr[o * 2 + 1] = 0;
      uvArr[(o + 1) * 2] = s / SEG; uvArr[(o + 1) * 2 + 1] = 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  const posA = new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage);
  const gainA = new THREE.BufferAttribute(gainArr, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posA);
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  geo.setAttribute('aGain', gainA);
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uHeatLo: { value: PAL.heatLo }, uHeatHi: { value: PAL.heatHi } },
    vertexShader: `attribute float aGain; varying vec2 vUv; varying float vGain;
      void main(){ vUv = uv; vGain = aGain; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: withOutput(`precision highp float; varying vec2 vUv; varying float vGain; uniform float uTime; uniform vec3 uHeatLo, uHeatHi;
      ${NOISE}
      void main(){
        float along = vUv.x; float across = abs(vUv.y - 0.5) * 2.0;
        float n = fbm(vec2(along * 4.0 - uTime * 6.0, vUv.y * 3.0 + uTime * 1.3), 3);
        float body = (1.0 - smoothstep(0.35 + 0.4 * n, 1.0, across)) * (1.0 - along);
        vec3 col = mix(uHeatHi, uHeatLo, smoothstep(0.05, 0.6, along));
        col = mix(col, vec3(1.0, 0.97, 0.9) * 2.2, (1.0 - smoothstep(0.0, 0.12, along)) * (1.0 - across));
        float a = body * (0.55 + 0.45 * n) * vGain;
        gl_FragColor = vec4(col * a, a);
      }`),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.visible = false;
  scene.add(mesh);

  return {
    reset() {
      hn.fill(0);
      mesh.visible = false;
    },

    frame(world, alpha, t) {
      const on = !!world.effects.fire;
      mat.uniforms.uTime.value = t;
      let any = false;
      for (let b = 0; b < NB; b++) {
        const ball = world.balls[b];
        const base = b * vPerBall;
        const live = on && ball && ball.alive && !ball.held && ball.sealed < 0;
        if (!live) {
          hn[b] = 0;
          for (let v = 0; v < vPerBall; v++) gainArr[base + v] = 0;
          continue;
        }
        any = true;
        const x = ball.px + (ball.x - ball.px) * alpha - HW;
        const y = HH - (ball.py + (ball.y - ball.py) * alpha);
        // record the path (a new sample every 3 units of travel; a teleport restarts it)
        const k0 = b * HIST;
        let d2 = 0;
        if (hn[b] > 0) {
          const dx = x - hx[k0 + hHead[b]], dy = y - hy[k0 + hHead[b]];
          d2 = dx * dx + dy * dy;
          if (d2 > 80 * 80) hn[b] = 0; // a teleport (portal) restarts the ribbon, no smear
        }
        if (hn[b] === 0 || d2 >= 9) {
          hHead[b] = (hHead[b] + 1) % HIST;
          hx[k0 + hHead[b]] = x;
          hy[k0 + hHead[b]] = y;
          if (hn[b] < HIST) hn[b]++;
        }
        // walk back along the path for LEN units, writing SEG + 1 cross sections
        const gain = 0.55 + 0.45 * Math.min(1, (ball.tier || 0) / 5);
        let px = x, py = y, walked = 0, j = 0, dirx = 0, diry = 1;
        for (let sIdx = 0; sIdx <= SEG; sIdx++) {
          const want = (sIdx / SEG) * LEN;
          while (walked < want && j < hn[b] - 1) {
            const a = (hHead[b] - j + HIST) % HIST, c = (hHead[b] - j - 1 + HIST) % HIST;
            const ax = j === 0 ? x : hx[k0 + a], ay = j === 0 ? y : hy[k0 + a];
            const sx = hx[k0 + c] - ax, sy = hy[k0 + c] - ay;
            const sl = Math.hypot(sx, sy);
            if (sl < 1e-4) { j++; continue; }
            if (walked + sl >= want) {
              const f = (want - walked) / sl;
              px = ax + sx * f;
              py = ay + sy * f;
              dirx = -sx / sl; diry = -sy / sl;
              walked = want;
              break;
            }
            walked += sl;
            px = hx[k0 + c];
            py = hy[k0 + c];
            dirx = -sx / sl; diry = -sy / sl;
            j++;
          }
          const w = (WIDTH / 2) * (1 - sIdx / SEG);
          const o = base + sIdx * 2;
          posArr[o * 3] = px - diry * w; posArr[o * 3 + 1] = py + dirx * w; posArr[o * 3 + 2] = -1;
          posArr[(o + 1) * 3] = px + diry * w; posArr[(o + 1) * 3 + 1] = py - dirx * w; posArr[(o + 1) * 3 + 2] = -1;
          const g = walked >= want - 0.01 ? gain : 0;
          gainArr[o] = g;
          gainArr[o + 1] = g;
        }
      }
      mesh.visible = any;
      if (any) {
        posA.needsUpdate = true;
        gainA.needsUpdate = true;
      }
    },
  };
}
