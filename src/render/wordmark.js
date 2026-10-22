// Kiln: the live fire inside the I of KILN (OWNER: C). ART 9.2 and 11.1.
//
//   const flame = createWordmarkFlame(slotElement, { intensity: 1 });
//   ... every animation frame: flame.frame(performance.now() / 1000);
//   ... on layout change: flame.resize();   when the screen goes: flame.dispose();
//
// The host is the I slot (D's wordmark markup, e.g. a span .19em x .715em). A small canvas fills
// it; the flame IS the letter: the whole slot burns from an ember floor (never a dark slot) up to
// white-hot licks, hottest near #FFD9A8 at the bottom centre, edges crisp so the letter reads.
// If WebGL is unavailable the slot gets a static heat gradient instead, never a dark hole.
// Look test 02 drew this in a scissor viewport of a shared transparent canvas and the additive
// fire composited to ~0 there (flaw 1); an opaque, premultiplied draw in its own canvas fixes it.
//
// ONE renderer and canvas for the whole session: each title mount used to make a new
// WebGLRenderer, gl.dispose() does not free the browser's WebGL slot, and after about 15 trips back
// to the title Chrome dropped the OLDEST context, the game's own view (review blocker). The canvas
// now moves into each new slot. A slot that loses it (disposed, or a second flame mounted
// elsewhere) keeps a static heat gradient for its exit fade, never a dark hole.

import * as THREE from 'three';
import { COLOR } from '../core/constants.js';
import { NOISE, PLAIN_VERT, withOutput } from './shaders.js';

const FLAME_FRAG = withOutput(`
  precision highp float; varying vec2 vUv;
  uniform float uTime, uIntensity, uAspect; uniform vec2 uPx; uniform vec3 uHeatLo, uHeatHi;
  ${NOISE}
  void main(){
    vec2 uv = vUv; float t = uTime;
    vec2 p = vec2(uv.x * uAspect, uv.y);
    float n1 = fbm(vec2(p.x * 1.6 + t * 0.15, p.y * 2.6 - t * 1.1), 5);
    float n2 = fbm(vec2(p.x * 3.8 - t * 0.2 + 9.0, p.y * 6.0 - t * 2.6), 3);
    float cx = abs(uv.x - 0.5) * 2.0;
    float centre = 1.0 - cx * cx;
    // heat: strongest at the bottom centre, licking upward; never below the ember floor
    float f = (1.1 - uv.y * 0.7) * (0.72 + 0.28 * centre) * (0.85 + 0.15 * uIntensity)
            + (n1 - 0.5) * 0.9 + (n2 - 0.5) * 0.45;
    f = clamp(f, 0.0, 1.0);
    vec3 col = mix(uHeatLo * 0.42, uHeatLo * 1.0, smoothstep(0.1, 0.42, f));
    col = mix(col, uHeatHi, smoothstep(0.48, 0.8, f));
    col = mix(col, vec3(1.0, 0.97, 0.9), smoothstep(0.86, 1.0, f));
    // a faint inner shading toward the slot edges keeps it reading as a solid letter
    col *= 0.86 + 0.14 * centre;
    // crisp letter edges (one device pixel of anti-aliasing)
    float a = smoothstep(0.0, uPx.x, uv.x) * smoothstep(0.0, uPx.x, 1.0 - uv.x)
            * smoothstep(0.0, uPx.y, uv.y) * smoothstep(0.0, uPx.y, 1.0 - uv.y);
    gl_FragColor = vec4(col * a, a);
  }`);

/** The static heat gradient (no WebGL, or a slot whose live flame has moved on). */
function staticFlame(host) {
  host.style.background = `linear-gradient(0deg, ${COLOR.HEAT_HI} 0%, ${COLOR.HEAT_LO} 55%, #5a1f08 100%)`;
}

/**
 * The session's one flame renderer (built on first use, never disposed).
 * @type {null | {gl:any, canvas:any, mat:any, scene:any, cam:any, owner:any, ro:any, host:any, failed:boolean}}
 */
let shared = null;

function sharedFlame() {
  if (shared) return shared;
  const canvas = document.createElement('canvas');
  canvas.className = 'kiln-wordmark-flame';
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', borderRadius: 'inherit' });
  let gl = null;
  try {
    gl = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
  } catch {
    gl = null;
  }
  if (!gl) {
    shared = { gl: null, canvas: null, mat: null, scene: null, cam: null, owner: null, ro: null, host: null, failed: true };
    return shared;
  }
  gl.setClearColor(0x000000, 0);
  gl.outputColorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uAspect: { value: 1 },
      uPx: { value: new THREE.Vector2(0.01, 0.01) },
      uHeatLo: { value: new THREE.Color(COLOR.HEAT_LO) },
      uHeatHi: { value: new THREE.Color(COLOR.HEAT_HI) },
    },
    vertexShader: PLAIN_VERT,
    fragmentShader: FLAME_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 2);
  cam.position.z = 1;
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat));
  shared = { gl, canvas, mat, scene, cam, owner: null, ro: null, host: null, failed: false };
  // follow the current slot's size without reading layout every frame
  if (typeof ResizeObserver !== 'undefined') {
    shared.ro = new ResizeObserver(() => {
      if (shared.owner) shared.owner.resize();
    });
  }
  return shared;
}

/**
 * @param {HTMLElement} host the I slot
 * @param {{intensity?:number, reduceMotion?:boolean}} [opts]
 * @returns {{resize():void, frame(t:number):void, dispose():void}}
 */
export function createWordmarkFlame(host, opts = {}) {
  const S = sharedFlame();
  if (S.failed) {
    // no WebGL: a static heat gradient, never a dark slot
    staticFlame(host);
    return { resize() {}, frame() {}, dispose() {} };
  }
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const { gl, mat, canvas } = S;

  const handle = {
    /** Size the shared canvas to this slot (only while this slot holds it). */
    resize() {
      if (S.owner !== handle) return;
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      const pr = Math.min(2, window.devicePixelRatio || 1);
      gl.setPixelRatio(pr);
      gl.setSize(w, h, false);
      // ART 11.1: uAspect 3 across the slot's own width (a narrow slot keeps ~1 tongue across)
      mat.uniforms.uAspect.value = Math.max(0.6, 3 * (w / h));
      mat.uniforms.uPx.value.set(1 / (w * pr), 1 / (h * pr));
    },
    /** @param {number} t seconds */
    frame(t) {
      if (S.owner !== handle) return;
      mat.uniforms.uTime.value = t * 1.4;
      mat.uniforms.uIntensity.value = (opts.intensity ?? 1) * (1 + 0.15 * Math.sin(t * 2.1));
      gl.render(S.scene, S.cam);
    },
    dispose() {
      if (S.owner === handle) {
        if (S.ro) S.ro.disconnect();
        canvas.remove();
        S.owner = null;
        S.host = null;
      }
      // the old screen fades out over its exit: its I keeps a static flame, never a dark hole
      staticFlame(host);
    },
    /** Another slot took the canvas while this one was still mounted. */
    lose() {
      staticFlame(host);
    },
  };

  // take the canvas from the previous slot (a slot never disposed keeps a static flame)
  if (S.owner) S.owner.lose();
  if (S.ro) S.ro.disconnect();
  S.owner = handle;
  S.host = host;
  host.style.background = '';
  host.appendChild(canvas);
  if (S.ro) S.ro.observe(host);
  handle.resize();
  return { resize: handle.resize, frame: handle.frame, dispose: handle.dispose };
}

/** QA: how many flame renderers this session made (0 or 1) and which slot holds the canvas. */
export function wordmarkFlameInfo() {
  return { renderers: shared && !shared.failed ? 1 : 0, mounted: !!(shared && shared.owner), host: shared ? shared.host : null };
}
