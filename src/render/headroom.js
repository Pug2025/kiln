// Kiln: the headroom backdrop (OWNER: C). ART 12a: the upper back wall of the kiln above the
// formation, painted, layered and alive, one subject per world and per boss arena.
//
// Layers (true 3D depth, so the camera's lean and drift give real parallax):
//   far plate  z -240, 1000 x 1500, the painting; focal detail in its top 45%, falling to black
//              toward the wall; sides fade into the kiln interior (desktop gutters)
//   mid layer  z -140, the cut-out structure (alpha), in front of the plate
//   near haze  the kiln's existing haze planes
// Animation in the plate shader: an emissive mask (the mask file, or the plate's hot areas by
// threshold) breathing with the fire number and brightening with HEAT; heat shimmer just above the
// wall; a soft light sweep across the glass every 7 s; the level-clear wave climbing from the wall;
// a pulse on boss phase changes. Readability: plate luminance capped at 30% outside its emitters,
// emitters capped under the bloom threshold, so the ball and bricks stay the brightest things.
// Lite: the far plate only, static. Reduce motion: static plate, emissive steady.
// Plates: procedural canvases until F's img/headroom/<name>.webp (+ _mid, _mask) are final.

import * as THREE from 'three';
import { FIELD } from '../core/constants.js';
import { PAL_VEC3 } from './materials.js';
import { LOOK } from './look.js';
import { NOISE, withOutput } from './shaders.js';
import { screenToPlane, projectWorld } from './fit.js';

const HH = FIELD.H / 2;
export const PLATES = ['ember', 'blaze', 'whiteheat', 'stoker', 'crucible', 'core'];
const FAR_Z = -240;
const MID_Z = -140;
const ART_ASPECT = 2 / 3;      // portrait 1024 x 1536 plates
const BOTTOM_FIELD_Y = 860;    // the plates end (in black) a little below the wall
const WALL_FIELD_Y = 640;      // formations sit low: the wall's lower edge (B's rule y >= 600)
// mid-layer pivots in plate uv (ARTKIT.md "Headroom layers", plate pixels 1024 x 1536, y down)
// the kit's plates arrive graded for display; ACES at exposure 1.1 lifts their mid tones, so the
// body is scaled back toward the painted values and the glow add stays a small breath on top
const KIT_BODY = 0.5;
const KIT_KNEE = 2.0;
const KIT_GLOW = 0.12;
// behind the formation and the ball's path the plate steps back (ART 12a readability)
const QUIET_BODY = 0.5;
const QUIET_EMIT = 0.3;
// behind D's HUD (phone band, gutters) and the plate's peak (review 2026-10-22: the White Heat slats
// measured 4x the bricks behind the phone HUD; ART 15.2: peak <= .6 linear and <= .25x the ball;
// tests/c-look checks the cap through ACES)
const HUD_BODY = LOOK.PLATE_HUD_BODY;
const PLATE_CAP = LOOK.PLATE_CAP;
const PIVOT = {
  stoker: [513 / 1024, 1 - 306 / 1536],   // the port
  crucible: [0.5, 1.0],                    // the top centre (sway)
  core: [515 / 1024, 1 - 435 / 1536],     // the sphere
};

// ---------------------------------------------------------------- procedural placeholder plates
function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Paint one placeholder subject: far (opaque) and mid (alpha) canvases, 512 x 768. */
function paintPlate(name) {
  const W = 512, H = 768;
  const far = document.createElement('canvas');
  far.width = W; far.height = H;
  const mid = document.createElement('canvas');
  mid.width = W; mid.height = H;
  const g = far.getContext('2d');
  const m = mid.getContext('2d');
  const r = prng(name.length * 977 + name.charCodeAt(0));
  // base: warm dark falling to near black toward the wall
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1d1714');
  bg.addColorStop(0.45, '#120e0c');
  bg.addColorStop(1, '#050404');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const heat = (ctx, x, y, rad, a = 1) => {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, `rgba(255,217,168,${a})`);
    rg.addColorStop(0.25, `rgba(255,122,26,${0.8 * a})`);
    rg.addColorStop(1, 'rgba(255,122,26,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  };
  const metal = (ctx, a) => `rgba(150,156,166,${a})`;
  if (name === 'ember') {
    // vaulted crown of smoked glass on titanium ribs, one seam of heat along the crown
    for (let i = -5; i <= 5; i++) {
      m.strokeStyle = metal(m, 0.55 - Math.abs(i) * 0.03);
      m.lineWidth = 7 - Math.abs(i) * 0.4;
      m.beginPath();
      m.moveTo(W / 2 + i * 70, H * 0.62);
      m.quadraticCurveTo(W / 2 + i * 48, H * 0.18, W / 2, H * 0.07);
      m.stroke();
    }
    g.strokeStyle = 'rgba(255,140,40,0.9)';
    g.lineWidth = 5;
    g.beginPath();
    g.ellipse(W / 2, H * 0.2, W * 0.42, H * 0.1, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    heat(g, W / 2, H * 0.1, 90, 0.35);
  } else if (name === 'blaze') {
    // tall glass conduits carrying molten light up into the dark
    for (let i = 0; i < 6; i++) {
      const x = 50 + i * 82 + (r() - 0.5) * 20;
      const tg = g.createLinearGradient(0, H * 0.7, 0, 0);
      tg.addColorStop(0, 'rgba(255,122,26,0.05)');
      tg.addColorStop(0.6, 'rgba(255,140,40,0.75)');
      tg.addColorStop(1, 'rgba(255,217,168,0.9)');
      g.fillStyle = tg;
      g.fillRect(x - 5, 0, 10, H * 0.7);
      m.strokeStyle = metal(m, 0.5);
      m.lineWidth = 4;
      m.strokeRect(x - 13, -10, 26, H * 0.7);
      for (let y = 40; y < H * 0.68; y += 90) m.strokeRect(x - 17, y, 34, 8);
    }
  } else if (name === 'whiteheat') {
    // plasma seen through slatted heat shields
    heat(g, W / 2, H * 0.22, 230, 0.9);
    heat(g, W / 2, H * 0.22, 90, 1);
    for (let y = 30; y < H * 0.55; y += 34) {
      m.fillStyle = 'rgba(24,26,30,0.96)';
      m.fillRect(0, y, W, 22);
      m.fillStyle = metal(m, 0.35);
      m.fillRect(0, y, W, 2);
    }
  } else if (name === 'stoker') {
    // a vast furnace iris with one orange port
    heat(g, W / 2, H * 0.27, 70, 1);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      m.fillStyle = i % 2 ? 'rgba(60,64,72,0.95)' : 'rgba(40,43,48,0.95)';
      m.beginPath();
      m.moveTo(W / 2 + Math.cos(a) * 60, H * 0.27 + Math.sin(a) * 60);
      m.lineTo(W / 2 + Math.cos(a + 0.5) * 230, H * 0.27 + Math.sin(a + 0.5) * 230);
      m.lineTo(W / 2 + Math.cos(a + 0.9) * 230, H * 0.27 + Math.sin(a + 0.9) * 230);
      m.closePath();
      m.fill();
    }
  } else if (name === 'crucible') {
    // a suspended crucible lip glowing over the arena
    g.strokeStyle = 'rgba(255,170,90,0.95)';
    g.lineWidth = 9;
    g.beginPath();
    g.ellipse(W / 2, H * 0.3, W * 0.38, H * 0.06, 0, 0, Math.PI);
    g.stroke();
    heat(g, W / 2, H * 0.33, 160, 0.45);
    m.fillStyle = 'rgba(30,32,36,0.97)';
    m.beginPath();
    m.ellipse(W / 2, H * 0.27, W * 0.4, H * 0.12, 0, Math.PI, Math.PI * 2);
    m.fill();
    m.strokeStyle = metal(m, 0.5);
    m.lineWidth = 3;
    for (const s of [-1, 1]) {
      m.beginPath();
      m.moveTo(W / 2 + s * W * 0.36, H * 0.25);
      m.lineTo(W / 2 + s * W * 0.2, 0);
      m.stroke();
    }
  } else {
    // core: a sphere of contained white heat behind rotating shields
    heat(g, W / 2, H * 0.26, 170, 1);
    m.strokeStyle = 'rgba(70,74,82,0.95)';
    m.lineWidth = 26;
    for (let i = 0; i < 3; i++) {
      m.beginPath();
      m.arc(W / 2, H * 0.26, 150, i * 2.1, i * 2.1 + 1.3);
      m.stroke();
    }
  }
  // fine grain so the plate never looks flat
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 6;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const tf = new THREE.CanvasTexture(far);
  tf.colorSpace = THREE.SRGBColorSpace;
  const tm = new THREE.CanvasTexture(mid);
  tm.colorSpace = THREE.SRGBColorSpace;
  return { far: tf, mid: tm, mask: null };
}

// ---------------------------------------------------------------- shaders
const VERT = `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

// 1 inside the quiet box (plane world units: left, bottom, right, top), soft over 70 units
const QUIET = `float quiet(vec2 p, vec4 b){
    return smoothstep(b.x - 70.0, b.x + 20.0, p.x) * (1.0 - smoothstep(b.z - 20.0, b.z + 70.0, p.x))
         * smoothstep(b.y - 70.0, b.y + 20.0, p.y) * (1.0 - smoothstep(b.w - 20.0, b.w + 70.0, p.y));
  }`;

// Where D's HUD sits (review 2026-10-22, ART 12a / 15.3 C5): on portrait screens the band above the
// field's top edge (uHud.x = that edge's world y on this plane, uHud.y = 1 on portrait); on every
// screen the gutters outside the side walls (uGut.x = the wall's |x| on this plane, uGut.y = plane
// units per field unit). hudZone() is 1 there: the body drops to HUD_BODY and the emitters go out.
// gutterFade() fades the plate to black from 40 to 180 field units outside the walls. capLum() holds
// the plate's peak under PLATE_CAP (scene linear; ACES at exposure 1.1 shows it at about 0.22, under
// a quarter of the ball's 0.97), with a soft knee from 60% of the cap.
const HUD_GLSL = `
  uniform vec2 uHud, uGut;
  float hudZone(vec3 w){
    float band = uHud.y * smoothstep(uHud.x - 40.0, uHud.x + 10.0, w.y);
    float side = smoothstep(uGut.x, uGut.x + 40.0 * uGut.y, abs(w.x));
    return max(band, side);
  }
  float gutterFade(vec3 w){ return 1.0 - smoothstep(uGut.x + 40.0 * uGut.y, uGut.x + 180.0 * uGut.y, abs(w.x)); }
  vec3 capLum(vec3 c){
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float cap = ${PLATE_CAP.toFixed(3)}, k = 0.6 * cap;
    float Lc = L <= k ? L : k + (cap - k) * (1.0 - exp(-(L - k) / (cap - k)));
    return c * (Lc / max(L, 1e-5));
  }`;

const PLATE_FRAG = withOutput(`
  precision highp float; varying vec2 vUv; varying vec3 vW;
  uniform sampler2D uMap, uMask; uniform float uHasMask, uTime, uFire, uHeat, uMotion, uSweep, uClear, uBoss, uGrade, uWallY;
  uniform float uGraded, uGlowGain, uBodyGain, uQuietBody, uQuietEmit;
  uniform vec3 uHeatLo, uHeatHi; uniform vec4 uCrop, uBox;
  ${NOISE}
  ${QUIET}
  ${HUD_GLSL}
  void main(){
    vec2 uv = uCrop.xy + vUv * uCrop.zw;
    // heat shimmer in a band just above the wall (uWallY is in plane space)
    float band = smoothstep(uWallY - 0.02, uWallY + 0.06, vUv.y) * (1.0 - smoothstep(uWallY + 0.06, uWallY + 0.22, vUv.y));
    uv.x += (vnoise(vec2(uv.x * 40.0, uv.y * 60.0 - uTime * 3.0)) - 0.5) * 0.006 * band * uMotion;
    vec3 c = texture2D(uMap, uv).rgb;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // emissive mask: the glow file, or the plate's hot areas by threshold
    float hot = uHasMask > 0.5 ? texture2D(uMask, uv).r : smoothstep(0.22, 0.6, lum) * smoothstep(0.02, 0.18, c.r - c.b);
    // body: the kit's plates arrive graded (0.30 off the emitters); procedural ones are capped here
    // (kit: a soft knee on the painted emitters, so a hall of glowing conduits never outshines a
    // cool brick wall; the darks pass almost untouched)
    vec3 body = uGraded > 0.5 ? c * uBodyGain / (1.0 + lum * uBodyGain * ${KIT_KNEE.toFixed(2)}) : c * min(1.0, 0.3 / max(lum, 0.3));
    body = mix(body, body * vec3(1.12, 0.86, 0.72), uGrade);
    float breath = mix(1.0, 0.82 + 0.18 * sin(uTime * 1.3) + 0.3 * uFire, uMotion);
    float glow = hot * breath * (0.55 + 0.45 * uHeat) * (1.0 + 0.8 * uBoss);
    vec3 emit = mix(uHeatLo, uHeatHi, smoothstep(0.4, 1.0, hot)) * glow * uGlowGain;
    // light sweeping across the glass (follows the plate's own relief, never a flat sheen)
    float s = fract(uTime / 7.0) * 2.2 - 0.6;
    float sweep = exp(-pow((vUv.x + vUv.y * 0.6 - s) * 7.0, 2.0)) * uSweep * uMotion;
    body += body * sweep * 0.9 + vec3(0.6, 0.66, 0.75) * sweep * lum * 0.12;
    // level clear: the wave climbs from the wall up the painting
    float wave = exp(-pow((vUv.y - (uWallY + uClear * 1.1)) * 6.0, 2.0)) * step(0.001, uClear) * (1.0 - smoothstep(0.85, 1.0, uClear));
    emit += uHeatLo * wave * 0.35 * (0.3 + hot);
    // readability (ART 12a): quiet behind the formation and where the ball travels
    float q = quiet(vW.xy, uBox);
    // behind D's HUD (the phone band, the desktop gutters) the body steps back and the glow goes out
    float hud = hudZone(vW);
    vec3 col = body * mix(1.0, uQuietBody, q) * mix(1.0, ${HUD_BODY.toFixed(2)}, hud) + min(emit, vec3(0.45)) * mix(1.0, uQuietEmit, q) * (1.0 - hud);
    col = capLum(col);
    // fade the sides into the kiln (and out in the gutters) and the bottom to black at the wall
    float a = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(uWallY * 0.5, uWallY + 0.08, vUv.y) * gutterFade(vW);
    gl_FragColor = vec4(col * a, a);
  }`);

// The mid layer: straight alpha. The kit's mid layers match the far plate at rest (same grade,
// same footprint on screen), and may turn, scale, shift or fade about a pivot (plate uv).
const MID_FRAG = withOutput(`
  precision highp float; varying vec2 vUv; varying vec3 vW; uniform sampler2D uMid; uniform float uFire, uBoss, uWallY;
  uniform vec3 uHeatLo; uniform vec4 uCrop, uBox; uniform vec2 uPivot, uShift; uniform float uRot, uScale, uFade, uGain, uTint, uQuietBody;
  ${QUIET}
  ${HUD_GLSL}
  void main(){
    vec2 uv = uCrop.xy + vUv * uCrop.zw;
    // turn and scale about the pivot in plate pixels (1024 x 1536), then shift
    vec2 p = (uv - uPivot - uShift) * vec2(1024.0, 1536.0) / uScale;
    float c = cos(uRot), s0 = sin(uRot);
    p = vec2(c * p.x + s0 * p.y, -s0 * p.x + c * p.y);
    uv = uPivot + p / vec2(1024.0, 1536.0);
    vec4 s = texture2D(uMid, uv);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) s = vec4(0.0);
    float a = s.a * uFade * smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x)
            * smoothstep(uWallY * 0.5, uWallY + 0.08, vUv.y) * gutterFade(vW);
    float knee = uTint > 0.5 ? 1.0 : 1.0 + dot(s.rgb, vec3(0.2126, 0.7152, 0.0722)) * uGain * ${KIT_KNEE.toFixed(2)};
    vec3 col = s.rgb * uGain / knee + uHeatLo * uTint * (0.03 + 0.05 * uFire + 0.08 * uBoss) * (1.0 - vUv.y);
    col *= mix(1.0, uQuietBody, quiet(vW.xy, uBox)) * mix(1.0, ${HUD_BODY.toFixed(2)}, hudZone(vW));
    col = capLum(col);
    gl_FragColor = vec4(col * a, a);
  }`);

/**
 * @param {THREE.Scene} scene
 */
export function createHeadroom(scene) {
  const plates = {};
  const placeholder = {};
  const getPlate = (name) => {
    if (plates[name]) return plates[name];
    if (!placeholder[name]) placeholder[name] = paintPlate(name);
    return placeholder[name];
  };

  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blank.needsUpdate = true;
  const plateMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uMap: { value: blank }, uMask: { value: blank }, uHasMask: { value: 0 },
      uTime: { value: 0 }, uFire: { value: 0.5 }, uHeat: { value: 0 }, uMotion: { value: 1 },
      uSweep: { value: 1 }, uClear: { value: 0 }, uBoss: { value: 0 }, uGrade: { value: 0 },
      uWallY: { value: 0.3 }, uCrop: { value: new THREE.Vector4(0, 0, 1, 1) },
      uGraded: { value: 0 }, uGlowGain: { value: 0.36 }, uBodyGain: { value: 1 },
      uQuietBody: { value: 1 }, uQuietEmit: { value: 1 }, uBox: { value: new THREE.Vector4(0, 0, 0, 0) },
      uHud: { value: new THREE.Vector2(1e5, 0) }, uGut: { value: new THREE.Vector2(1e5, 1) },
      uHeatLo: { value: PAL_VEC3.heatLo }, uHeatHi: { value: PAL_VEC3.heatHi },
    },
    vertexShader: VERT,
    fragmentShader: PLATE_FRAG,
  });
  const midMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uMid: { value: blank }, uFire: { value: 0.5 }, uBoss: { value: 0 }, uHeatLo: { value: PAL_VEC3.heatLo },
      uWallY: { value: 0.3 }, uCrop: { value: new THREE.Vector4(0, 0, 1, 1) },
      uPivot: { value: new THREE.Vector2(0.5, 0.5) }, uShift: { value: new THREE.Vector2(0, 0) },
      uRot: { value: 0 }, uScale: { value: 1 }, uFade: { value: 0.85 }, uGain: { value: 0.26 }, uTint: { value: 1 },
      uQuietBody: { value: 1 }, uBox: { value: new THREE.Vector4(0, 0, 0, 0) },
      uHud: { value: new THREE.Vector2(1e5, 0) }, uGut: { value: new THREE.Vector2(1e5, 1) },
    },
    vertexShader: VERT,
    fragmentShader: MID_FRAG,
  });
  // both layers are unit planes sized per viewport in layout(): from below the wall up past the
  // top of the view, as wide as the view (desktop gutters), the art cover-fitted and anchored at
  // its top (the focal detail lives in the top 45%)
  const far = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), plateMat);
  far.position.set(0, 300, FAR_Z);
  far.renderOrder = -3; // sorted by depth with the haze planes
  const mid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), midMat);
  mid.position.set(0, 300, MID_Z);
  mid.renderOrder = -3;
  scene.add(far, mid);
  const hit = { x: 0, y: 0 };
  const ndc = { x: 0, y: 0, w: 0 };
  const rect = { left: 0, right: 0, top: 0, bottom: 0 };

  /** The far plate's world rect: from below the wall up past the top of the view, view-wide. */
  function fitFar(pose, W, H) {
    let top = 900, left = -900, right = 900;
    if (screenToPlane(pose, W / 2, 0, W, H, FAR_Z, hit)) top = hit.y + 30;
    if (screenToPlane(pose, 0, H * 0.3, W, H, FAR_Z, hit)) left = hit.x;
    if (screenToPlane(pose, W, H * 0.3, W, H, FAR_Z, hit)) right = hit.x;
    const width = Math.min(2000, right - left + 60);
    rect.left = (left + right - width) / 2;
    rect.right = rect.left + width;
    rect.top = top;
    rect.bottom = HH - BOTTOM_FIELD_Y;
  }

  /** Put a layer on a world rect at its depth and cover-fit the art (top-anchored crop). */
  function place(mesh, crop, l, r, t, b) {
    const width = r - l, height = Math.max(200, t - b);
    mesh.scale.set(width, height, 1);
    mesh.position.x = (l + r) / 2;
    mesh.position.y = (t + b) / 2;
    const A = width / height;
    if (A >= ART_ASPECT) crop.set(0, 1 - ART_ASPECT / A, 1, ART_ASPECT / A);
    else crop.set(0.5 - A / ART_ASPECT / 2, 0, A / ART_ASPECT, 1);
  }

  /** Screen pixel of a world point (rest pose), then the same pixel on the mid plane. */
  function toMid(pose, W, H, X, Y, out) {
    projectWorld(pose, X, Y, FAR_Z, ndc);
    const sx = ((ndc.x + 1) / 2) * W, sy = ((1 - ndc.y) / 2) * H;
    if (!screenToPlane(pose, sx, sy, W, H, MID_Z, out)) { out.x = X; out.y = Y; }
    return out;
  }
  const tl = { x: 0, y: 0 }, br = { x: 0, y: 0 };

  // the quiet box: the formation's bounds (field units) stretched toward the paddle, where the ball
  // travels; the plate sits back there (ART 12a "low detail where the ball travels")
  const fbox = { l: 0, t: 0, r: 0, b: 0, ok: false };
  const view = { pose: null, W: 1, H: 1 };
  let boxVersion = -1, boxCount = -1;
  const bc = { x: 0, y: 0 };

  /** Field point on the z = 0 slab, seen through the rest pose, landed on the plane at depth z. */
  function fieldOnPlane(x, y, z, out) {
    projectWorld(view.pose, x - FIELD.W / 2, HH - y, 0, ndc);
    const sx = ((ndc.x + 1) / 2) * view.W, sy = ((1 - ndc.y) / 2) * view.H;
    if (!screenToPlane(view.pose, sx, sy, view.W, view.H, z, out)) { out.x = x - FIELD.W / 2; out.y = HH - y; }
    return out;
  }

  function applyBox() {
    const a = plateMat.uniforms.uBox.value, m = midMat.uniforms.uBox.value;
    if (!fbox.ok || !view.pose) { a.set(0, 0, 0, 0); m.set(0, 0, 0, 0); return; }
    fieldOnPlane(fbox.l, fbox.t, FAR_Z, tl); fieldOnPlane(fbox.r, fbox.b, FAR_Z, bc);
    a.set(tl.x, bc.y, bc.x, tl.y);
    fieldOnPlane(fbox.l, fbox.t, MID_Z, tl); fieldOnPlane(fbox.r, fbox.b, MID_Z, bc);
    m.set(tl.x, bc.y, bc.x, tl.y);
  }

  function scanBox(world) {
    const B = world.bricks;
    boxVersion = B.version;
    boxCount = B.count;
    let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
    for (let i = 0; i < B.count; i++) {
      if (!B.alive[i]) continue;
      const hw = B.w[i] / 2, hh = B.h[i] / 2;
      if (B.x[i] - hw < l) l = B.x[i] - hw;
      if (B.x[i] + hw > r) r = B.x[i] + hw;
      if (B.y[i] - hh < t) t = B.y[i] - hh;
      if (B.y[i] + hh > b) b = B.y[i] + hh;
    }
    fbox.ok = r > l;
    if (!fbox.ok) { applyBox(); return; }
    // the ball crosses the whole field between the formation and the paddle
    const mode = world.level.mode;
    if (mode === 'left') { l = -200; t = Math.min(t, 0); b = Math.max(b, FIELD.H); }
    else if (mode === 'ring') { l = Math.min(l, 0); r = Math.max(r, FIELD.W); t = Math.min(t, 0); b = Math.max(b, FIELD.H); }
    else { l = Math.min(l, 0); r = Math.max(r, FIELD.W); b = FIELD.H + 200; }
    fbox.l = l; fbox.t = t; fbox.r = r; fbox.b = b;
    applyBox();
  }

  const st = { name: '', kit: false, lite: false, reduceMotion: false, clearT0: -1, boss: 0, lastPhase: 0 };

  function use(name, grade) {
    const p = getPlate(name);
    const kit = !!p.kit;
    st.name = name;
    st.kit = kit;
    const u = plateMat.uniforms, v = midMat.uniforms;
    u.uMap.value = p.far;
    u.uMask.value = p.mask || blank;
    u.uHasMask.value = p.mask ? 1 : 0;
    u.uGrade.value = grade;
    u.uGraded.value = kit ? 1 : 0;
    u.uGlowGain.value = st.lite ? 0 : kit ? KIT_GLOW : 0.36; // lite: no glow pass (ARTKIT)
    u.uBodyGain.value = KIT_BODY;
    u.uQuietBody.value = QUIET_BODY;
    u.uQuietEmit.value = QUIET_EMIT;
    v.uQuietBody.value = QUIET_BODY;
    v.uMid.value = p.mid || blank;
    v.uGain.value = kit ? KIT_BODY : 0.26;
    v.uFade.value = kit ? 1 : 0.85;
    v.uTint.value = kit ? 0 : 1;
    const piv = PIVOT[name];
    v.uPivot.value.set(piv ? piv[0] : 0.5, piv ? piv[1] : 0.5);
    v.uRot.value = 0;
    v.uScale.value = 1;
    v.uShift.value.set(0, 0);
    mid.visible = !!p.mid; // lite keeps the mid at rest (ARTKIT "plus the mid at rest")
  }

  return {
    far, mid,

    /**
     * Size both layers for the viewport (rest camera pose from fit.js). The mid layer covers the
     * same screen footprint as the far plate at rest, so the kit's mid art lines up with it exactly
     * and only the camera's lean and drift separate them (parallax).
     */
    layout(pose, W, H, frame) {
      view.pose = pose; view.W = W; view.H = H;
      applyBox();
      // portrait screens put D's HUD in a band above the field: the plate's glow stays low there
      const band = W < H * 0.9 ? 1 : 0;
      const topY = frame?.y0 || 0;
      fieldOnPlane(FIELD.W / 2, topY, FAR_Z, tl);
      plateMat.uniforms.uHud.value.set(tl.y, band);
      fieldOnPlane(FIELD.W / 2, topY, MID_Z, tl);
      midMat.uniforms.uHud.value.set(tl.y, band);
      // the side walls on each plane (at mid height), and plane units per field unit there
      fieldOnPlane(FIELD.W, HH, FAR_Z, tl);
      plateMat.uniforms.uGut.value.set(tl.x, tl.x / (FIELD.W / 2));
      fieldOnPlane(FIELD.W, HH, MID_Z, tl);
      midMat.uniforms.uGut.value.set(tl.x, tl.x / (FIELD.W / 2));
      fitFar(pose, W, H);
      place(far, plateMat.uniforms.uCrop.value, rect.left, rect.right, rect.top, rect.bottom);
      const wallUv = (HH - WALL_FIELD_Y - rect.bottom) / (rect.top - rect.bottom);
      plateMat.uniforms.uWallY.value = wallUv;
      toMid(pose, W, H, rect.left, rect.top, tl);
      toMid(pose, W, H, rect.right, rect.bottom, br);
      place(mid, midMat.uniforms.uCrop.value, tl.x, br.x, tl.y, br.y);
      midMat.uniforms.uWallY.value = wallUv;
    },

    /** A final plate from the kit: name = ember | ember_mid | ember_glow (or _mask) | ... */
    setPlate(key, tex) {
      const m = /^(\w+?)(?:_(mid|mask|glow))?$/.exec(key);
      if (!m || !PLATES.includes(m[1])) return;
      const name = m[1];
      const p = plates[name] || (plates[name] = { far: null, mid: null, mask: null, kit: true });
      if (m[2] === 'mid') p.mid = tex;
      else if (m[2] === 'mask' || m[2] === 'glow') p.mask = tex;
      else p.far = tex;
      if (!p.far) return;
      if (st.name === name) use(name, plateMat.uniforms.uGrade.value);
    },

    setWorld(world) {
      const def = world.level.def;
      let name = def.boss || def.world || 'ember';
      let grade = 0;
      if (name === 'overburn') {
        name = ['ember', 'blaze', 'whiteheat'][Math.max(0, (world.run.overburnWave | 0) - 1) % 3];
        grade = 1;
      }
      if (!PLATES.includes(name)) name = 'ember';
      use(name, grade);
      st.clearT0 = -1;
      st.boss = 0;
      st.lastPhase = world.boss ? world.boss.phase : 0;
      scanBox(world);
    },

    setQuality(lite, reduceMotion) {
      st.lite = lite;
      st.reduceMotion = reduceMotion;
      plateMat.uniforms.uMotion.value = lite || reduceMotion ? 0 : 1;
      plateMat.uniforms.uSweep.value = lite ? 0 : 1;
      if (st.name) use(st.name, plateMat.uniforms.uGrade.value);
    },

    clear(t) {
      st.clearT0 = t;
    },

    bossPulse() {
      st.boss = 1;
    },

    frame(world, t, dt, fire) {
      const u = plateMat.uniforms;
      u.uTime.value = st.reduceMotion || st.lite ? 0 : t;
      u.uFire.value = st.reduceMotion ? 0.6 : fire;
      const e = world.econ;
      u.uHeat.value = e && e.heatMax ? Math.min(1, e.heat / e.heatMax) : 0;
      u.uClear.value = st.clearT0 >= 0 ? Math.min(1, (t - st.clearT0) / 1.4) : 0;
      st.boss = Math.max(0, st.boss - dt * 1.2);
      if (world.boss && world.boss.active) {
        if (world.boss.phase !== st.lastPhase) { st.lastPhase = world.boss.phase; st.boss = 1; }
        u.uBoss.value = st.boss + 0.4 * Math.max(0, Math.min(1, world.boss.open || 0));
      } else u.uBoss.value = st.boss;
      if (world.bricks.version !== boxVersion || world.bricks.count !== boxCount) scanBox(world);
      const v = midMat.uniforms;
      v.uFire.value = u.uFire.value;
      v.uBoss.value = u.uBoss.value;
      // the boss arenas' moving parts (ARTKIT pivots); lite and reduce motion keep them at rest
      if (!st.kit || st.lite || st.reduceMotion) return;
      const open = world.boss && world.boss.active ? Math.max(0, Math.min(1, world.boss.open || 0)) : 0;
      if (st.name === 'stoker') {
        v.uRot.value = 0.035 * Math.sin(t * 0.25) + 0.05 * open;
        v.uScale.value = 1 + 0.06 * open;
      } else if (st.name === 'crucible') {
        v.uRot.value = 0.026 * Math.sin(t * 0.55);
      } else if (st.name === 'core') {
        v.uShift.value.set(0, 0.035 * open);
        v.uScale.value = 1 + 0.05 * open;
        v.uFade.value = 1 - 0.6 * open;
      }
    },
  };
}
