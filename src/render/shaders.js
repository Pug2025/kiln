// Kiln: GLSL sources (OWNER: C). Ported from look test 02 (fire from test 01).

import { LOOK } from './look.js';

/**
 * Append three's tone mapping and output colour-space chunks to a ShaderMaterial fragment shader.
 * In the bloom path the scene renders into a linear target and both chunks are no-ops (the output
 * pass does ACES + sRGB for everything); in lite the scene draws straight to the canvas, and
 * without them every custom shader (fire, haze, sparks, glyphs) would skip ACES and sRGB.
 */
export function withOutput(src) {
  const k = src.lastIndexOf('}');
  return `${src.slice(0, k)}\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n${src.slice(k)}`;
}

export const NOISE = `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p, int oct){ float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 6; i++){ if (i >= oct) break; v += a * vnoise(p); p = m * p; a *= 0.5; } return v; }
`;

export const PLAIN_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export const FIRE_VERT = `varying vec2 vUv; varying vec3 vW;
  void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

// The fire: two scrolling fbm layers under a tongue envelope; premultiplied additive output.
// The flame is drawn in the BAND between its foot (uFootY, world y) and the kiln lip (uClipY): yy is
// 0 at the foot and 1 at the lip, and the tips reach yy = uTip (C call, review 2026-10-22: the old
// 340-unit flame had its top 62% clipped by the lip, so the combo only changed what was hidden).
// The combo shows in what stays on screen: the tips climb from half the band (x1) to the lip (x5),
// the noise scrolls faster (uFlow is integrated on the CPU, so a rate change never jumps) and the
// core runs hotter (uHot 0..1).
// Legibility (ART 12b): flame tips stay under the kiln lip (uClipY); a ball-drop flare may climb to
// uFlareClipY only away from the paddle; inside a 60-unit band around the paddle (the capsule
// uPadA..uPadB, radius uPadR, world units) the fire dims by uBand so it never blooms over it.
export const FIRE_FRAG = withOutput(`
  precision highp float; varying vec2 vUv; varying vec3 vW;
  uniform float uTime, uIntensity, uAspect, uSoft, uFootY, uTip, uFlow, uHot; uniform int uOctaves; uniform vec3 uHeatLo, uHeatHi;
  uniform float uClipY, uFlareClipY, uPadR, uBand; uniform vec2 uPadA, uPadB;
  uniform vec2 uScreenA, uScreenB; uniform float uScreenR, uScreenF, uScreenStrength;
  ${NOISE}
  float screenBand(){
    vec2 pa = gl_FragCoord.xy - uScreenA, ba = uScreenB - uScreenA;
    float k = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    return 1.0 - smoothstep(uScreenR, uScreenR + uScreenF, length(pa - ba * k));
  }
  float legible(out float dim){
    vec2 pa = vW.xy - uPadA, ba = uPadB - uPadA;
    float k = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    float dPad = length(pa - ba * k) - uPadR;
    float nearPad = 1.0 - smoothstep(40.0, 60.0, dPad);
    float clipY = mix(uFlareClipY, uClipY, nearPad);
    dim = 1.0 - max(uBand * nearPad, uScreenStrength * screenBand());
    return 1.0 - smoothstep(clipY - 14.0, clipY, vW.y);
  }
  void main(){
    vec2 uv = vUv; float t = uTime;
    float yy = (vW.y - uFootY) / max(uClipY - uFootY, 1.0);
    // noise in world units (110 units per noise unit): flame-sized tongues in a 120-unit band
    vec2 q = vec2(vW.x / 110.0 * uAspect / 3.0, (vW.y - uFootY) / 110.0);
    // columns: a slow, vertically stretched field decides how tall each tongue is
    float n1 = fbm(vec2(q.x * 1.4 + t * 0.07, q.y * 0.55 - uFlow * 0.9), uOctaves);
    // licks: finer turbulence rising through the tongues
    int detailOctaves = uOctaves > 4 ? uOctaves - 2 : 2;
    float n2 = fbm(vec2(q.x * 3.2 - t * 0.11 + 9.0, q.y * 1.6 - uFlow * 2.4), detailOctaves);
    float col1 = smoothstep(0.3, 0.72, n1);
    float tip = max(uTip * (0.32 + 0.95 * col1), 0.05);
    float f = (0.66 + 0.18 * uHot) * (1.0 - yy / tip) + (n2 - 0.5) * 0.75 + (col1 - 0.5) * 0.12;
    f -= uSoft * 0.2;
    float side = smoothstep(0.0, 0.08, uv.x) * smoothstep(0.0, 0.08, 1.0 - uv.x);
    f *= side; f = clamp(f, 0.0, 1.0); f = pow(f, 1.25);
    // heat-low body, heat-high tongues, white only in the hottest roots (more of it as the combo climbs)
    vec3 col = mix(vec3(0.0), uHeatLo * 0.85, smoothstep(0.06, 0.4, f));
    col = mix(col, uHeatHi, smoothstep(0.5, 0.85, f));
    col = mix(col, vec3(1.0, 0.97, 0.9), smoothstep(0.88, 1.0, f) * (0.35 + 0.65 * uHot));
    float base = smoothstep(0.35, 0.05, yy) * side;
    float a = smoothstep(0.05, 0.32, f) * 0.9 + base * (0.16 + 0.1 * uHot);
    // the foot fades out over the bottom fifth of the band along a ragged line (review 2026-10-22):
    // the flame never ends in a straight edge, at any size
    float foot = yy + 0.35 * (n1 - 0.5) + 0.15 * (n2 - 0.5);
    a *= smoothstep(0.03, 0.24, foot);
    float dim;
    float clip = legible(dim);
    a *= clip;
    gl_FragColor = vec4(col * a * dim * (0.6 + 0.3 * uIntensity) * (1.0 - uSoft * 0.55), a);
  }`);

// Constant per-plane parameters share the same program across the three sorted haze draws.
export const HAZE_VERT = `
  attribute vec4 aHaze; varying vec2 vUv;
  #if __VERSION__ >= 300
    flat varying vec4 vHaze;
  #else
    varying vec4 vHaze;
  #endif
  void main(){
    vUv = uv; vHaze = aHaze;
    vec4 local = instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * local;
  }`;

export const HAZE_FRAG = withOutput(`
  precision highp float; varying vec2 vUv;
  #if __VERSION__ >= 300
    flat varying vec4 vHaze;
  #else
    varying vec4 vHaze;
    uniform vec3 uParams[4];
  #endif
  uniform float uTimes[4], uWarm; uniform vec3 uHeatLo;
  ${NOISE}
  void main(){
    // CPU offsets retain the original float32 values even after long sessions. Constant indices
    // also work on WebGL 1 implementations that restrict uniform-array indexing.
    float uTime = vHaze.w < 0.5 ? uTimes[0] : vHaze.w < 1.5 ? uTimes[1] : vHaze.w < 2.5 ? uTimes[2] : uTimes[3];
    #if __VERSION__ >= 300
      vec3 params = vHaze.xyz;
    #else
      // Smooth interpolation can perturb a noise seed. WebGL 1 selects the same static float32
      // parameters by layer instead; only the integer layer's threshold travels through a varying.
      vec3 params = vHaze.w < 0.5 ? uParams[0] : vHaze.w < 1.5 ? uParams[1] : vHaze.w < 2.5 ? uParams[2] : uParams[3];
    #endif
    float uSeed = params.x, uAlpha = params.y, uTint = params.z;
    vec2 p = vUv * vec2(3.0, 2.2) + uSeed;
    float n = fbm(vec2(p.x + uTime * 0.015, p.y - uTime * 0.05), 4);
    float n2 = fbm(vec2(p.x * 2.1 - uTime * 0.01 + 4.0, p.y * 2.0 - uTime * 0.09), 3);
    float d = smoothstep(0.35, 0.75, n * 0.7 + n2 * 0.45);
    float vert = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
    float side = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
    float a = d * vert * side * uAlpha;
    vec3 col = mix(vec3(uTint), uHeatLo * 0.45, smoothstep(0.42, 0.0, vUv.y) * uWarm);
    gl_FragColor = vec4(col, a);
  }`);

export const BACK_VERT = `varying vec2 vUv; varying vec3 vPos; void main(){ vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export const BACK_FRAG = withOutput(`
  precision highp float; varying vec2 vUv; varying vec3 vPos; uniform float uGlow; uniform vec3 uHeatLo, uGraphite, uBase;
  ${NOISE}
  void main(){
    vec2 p = vPos.xy;
    float rib = 0.5 + 0.5 * sin(p.x * 0.042); rib = smoothstep(0.2, 0.9, rib) * 0.35;
    vec3 col = mix(uBase, uGraphite, 0.55 + rib);
    float d = length((p - vec2(0.0, -900.0)) * vec2(0.55, 1.0));
    col += uHeatLo * exp(-d * 0.0024) * 0.13 * uGlow;
    float v = smoothstep(2600.0, 600.0, length(p)); col *= 0.35 + 0.65 * v;
    col += (hash(floor(p * 0.5)) - 0.5) * 0.012;
    gl_FragColor = vec4(col, 1.0);
  }`);

export const SHAFT_FRAG = withOutput(`
  precision highp float; varying vec2 vUv; uniform float uTime;
  void main(){
    float x = smoothstep(0.0, 0.45, vUv.x) * smoothstep(1.0, 0.55, vUv.x);
    float y = smoothstep(0.1, 0.75, vUv.y) * (0.6 + 0.4 * smoothstep(0.75, 1.0, vUv.y));
    float a = x * y * 0.085 * (0.9 + 0.1 * sin(uTime * 0.4));
    gl_FragColor = vec4(vec3(0.62, 0.7, 0.8) * a, a);
  }`);

// Sparks: GPU points whose positions are a function of time and seed (no CPU work per frame).
export const SPARK_VERT = `
  attribute float aSeed; attribute float aSize; attribute vec3 aRand;
  uniform float uTime, uScale, uWidth, uHeight, uFlare;
  varying float vLife; varying float vSeed;
  void main(){
    float speed = 0.045 + 0.07 * aRand.y;
    float life = fract(uTime * speed + aSeed); vLife = life; vSeed = aSeed;
    float x = (aRand.x - 0.5) * uWidth; x += sin(uTime * 0.6 + aSeed * 40.0) * 22.0 + sin(uTime * 1.7 + aSeed * 17.0) * 7.0;
    float y = -560.0 + life * uHeight * (1.0 + 0.25 * uFlare);
    float z = (aRand.z - 0.5) * 260.0 - 60.0;
    vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
    float s = aSize * (1.0 - life * 0.55) * (1.0 + uFlare * 0.5);
    gl_PointSize = s * uScale / -mv.z; gl_Position = projectionMatrix * mv;
  }`;

export const SPARK_FRAG = withOutput(`
  precision highp float; varying float vLife; varying float vSeed; uniform vec3 uHeatLo, uHeatHi; uniform float uTime;
  void main(){
    vec2 q = gl_PointCoord - 0.5; float r = length(q); float disc = smoothstep(0.5, 0.08, r);
    float fade = smoothstep(0.0, 0.08, vLife) * smoothstep(1.0, 0.55, vLife); if (fade < 0.02) discard;
    float flick = 0.7 + 0.3 * sin(uTime * (9.0 + fract(vSeed * 5.0) * 8.0) + vSeed * 100.0);
    vec3 col = mix(uHeatHi, uHeatLo, smoothstep(0.1, 0.7, vLife));
    gl_FragColor = vec4(col * disc * fade * flick * ${LOOK.SPARK_GAIN.toFixed(3)}, disc * fade * flick);
  }`);

// Burst particles (hit sparks, ball trail): CPU-written ring buffer of points.
export const BURST_VERT = `
  attribute float aLife; attribute float aSize; attribute float aGain; attribute float aCold; varying float vLife; varying float vGain; varying float vCold; uniform float uScale;
  void main(){ vLife = aLife; vGain = aGain; vCold = aCold; vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * aLife * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`;

export const BURST_FRAG = withOutput(`
  precision highp float; varying float vLife; varying float vGain; varying float vCold; uniform vec3 uHeatLo, uHeatHi;
  void main(){ if (vLife < 0.03) discard; float r = length(gl_PointCoord - 0.5); float d = smoothstep(0.5, 0.1, r);
    vec3 c = mix(mix(uHeatLo, uHeatHi, vLife * vLife), vec3(0.28, 0.31, 0.35), vCold);
    gl_FragColor = vec4(c * d * vGain * vLife, d * vLife); }`);
