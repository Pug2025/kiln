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
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COLOR } from '../core/constants.js';
import { NOISE, PLAIN_VERT, withOutput } from './shaders.js';
import { createMaterials } from './materials.js';
import { makeEnvironment } from './kiln.js';
import { LOOK } from './look.js';

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
  let shaderOrigin = null; // a new owner starts its own decorative phase, independent of page uptime

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
      if (S.owner !== handle || !Number.isFinite(t)) return;
      if (shaderOrigin === null) shaderOrigin = t;
      const shaderT = Math.max(0, t - shaderOrigin);
      mat.uniforms.uTime.value = shaderT * 1.4;
      mat.uniforms.uIntensity.value = (opts.intensity ?? 1) * (1 + 0.15 * Math.sin(shaderT * 2.1));
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

// ART 15 C16: a real, fixed 5 by 6 brick wall. Its two instanced meshes use the game's exact
// rounded slabs, heated ceramic and smoked glass. Keep one renderer for the session, just like
// the I flame: title round trips must never consume another browser WebGL slot.
const WALL_COLS = 5, WALL_ROWS = 6, WALL_COUNT = WALL_COLS * WALL_ROWS;
const WALL_TURN = 8 * Math.PI / 180;
const WALL_FRAME_MS = 1000 / 30;
let titleWall = null;
let titleWallFailed = false;
let activeTitleWall = null;

function sharedTitleWall() {
  if (titleWall) return titleWall;
  if (titleWallFailed) return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'kiln-title-wall';
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none' });
  let gl;
  try {
    gl = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    titleWallFailed = true;
    return null; // title.js keeps the level-card fallback visible
  }
  gl.setClearColor(0x000000, 0);
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = LOOK.EXPOSURE;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
  camera.position.set(0, 30, 620);
  camera.lookAt(0, 0, 0);
  const M = createMaterials(gl);
  // This small scene needs only the two brick materials and their low-resolution procedural
  // crackle maps. Drop unused material/texture resources before anything reaches the GPU.
  for (const [key, mat] of Object.entries(M)) if (key !== 'tex' && key !== 'shell' && key !== 'core') mat.dispose();
  M.tex.brushed.dispose();
  M.tex.glow.dispose();
  M.tex.neutralMap?.dispose();
  M.tex.neutralNormal?.dispose();
  // The arena's last-life palette is mutable. The title always uses its resting heat colours.
  M.core.userData.u.uHeatLo.value = new THREE.Color(COLOR.HEAT_LO);
  M.core.userData.u.uHeatHi.value = new THREE.Color(COLOR.HEAT_HI);
  scene.environment = makeEnvironment(gl);

  const root = new THREE.Group();
  root.name = 'title-wall';
  root.rotation.x = -0.10;
  scene.add(root);
  const S = LOOK.SHELL, C = LOOK.CORE;
  const coreGeo = new RoundedBoxGeometry(C.w, C.h, C.d, C.seg, C.r);
  const heat = new THREE.InstancedBufferAttribute(new Float32Array(WALL_COUNT), 1);
  coreGeo.setAttribute('aHeat', heat);
  const core = new THREE.InstancedMesh(coreGeo, M.core, WALL_COUNT);
  const shell = new THREE.InstancedMesh(new RoundedBoxGeometry(S.w, S.h, S.d, S.seg, S.r), M.shell, WALL_COUNT);
  core.frustumCulled = shell.frustumCulled = false;
  shell.renderOrder = 5;
  const matrix = new THREE.Matrix4();
  for (let row = 0; row < WALL_ROWS; row++) for (let col = 0; col < WALL_COLS; col++) {
    const i = row * WALL_COLS + col;
    matrix.makeTranslation((col - 2) * 60, (2.5 - row) * 30, 0);
    core.setMatrixAt(i, matrix);
    shell.setMatrixAt(i, matrix);
    // Heat gathers at the foot and in the centre, with a few cooler cells breaking up the grid.
    heat.array[i] = 0.16 + row * 0.10 + (2 - Math.abs(col - 2)) * 0.12 + ((row + col * 2) % 4) * 0.035;
  }
  root.add(core, shell);
  const hemi = new THREE.HemisphereLight(0x2c3440, 0x2a1408, 0.4);
  const key = new THREE.DirectionalLight(0xd6dfeb, 1.5);
  key.position.set(-260, 760, 900);
  const rim = new THREE.DirectionalLight(0x9fc4d8, 0.7);
  rim.position.set(240, 520, -700);
  const fire = new THREE.PointLight(0xff7a1a, 70000, 1250, 2);
  fire.position.set(0, -260, 120);
  scene.add(hemi, key, rim, fire);
  titleWall = { gl, canvas, scene, camera, root, owner: null, host: null, lost: false, draws: 0 };
  // Listeners belong to the single persistent canvas. A lost decorative context exposes the
  // existing image; only a restored, successfully drawn frame hides it again.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    titleWall.lost = true;
    if (titleWall.owner) titleWall.owner.suspend();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    titleWall.lost = false;
    // PMREM's GPU target is not recreated by three.js after a context restore.
    scene.environment.dispose();
    scene.environment = makeEnvironment(gl);
    if (titleWall.owner) titleWall.owner.resize();
  });
  return titleWall;
}

/**
 * A decorative wall with one active owner. Reduced motion draws one still; hidden/zero-sized
 * walls do no work. dispose() stops its clock, releases observers and detaches/shrinks the canvas.
 * @param {HTMLElement} host
 * @param {{reduceMotion?:boolean|(()=>boolean), onActive?:(active:boolean)=>void}} [opts]
 * @returns {null | {ready:boolean, resize():void, dispose():void}}
 */
export function createTitleWall(host, opts = {}) {
  if (activeTitleWall) activeTitleWall.dispose();
  let S = titleWall;
  let disposed = false, raf = 0, width = 0, height = 0, start = null, lastDraw = null;
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reducedNow = () => typeof opts.reduceMotion === 'function'
    ? !!opts.reduceMotion() : !!opts.reduceMotion || !!(mq && mq.matches);
  let reduced = reducedNow();
  let reportedActive = false;
  const activity = (active) => {
    if (reportedActive === active) return;
    reportedActive = active;
    if (opts.onActive) opts.onActive(active);
  };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
  const canDraw = () => !disposed && activeTitleWall === handle && S && S.owner === handle && !S.lost && !document.hidden && width > 0 && height > 0;
  const draw = (now) => {
    raf = 0;
    if (!canDraw()) return;
    // The wall moves at most 0.14 degrees in 1/30 second. Keep its slow drift smooth while
    // avoiding a second scene draw on every game frame. Retain the interval remainder so
    // small timestamp rounding never turns a 30 Hz target into an accidental 20 Hz cadence.
    if (!reduced && lastDraw !== null) {
      const intervals = Math.floor((now - lastDraw + 0.5) / WALL_FRAME_MS);
      if (intervals < 1) { raf = requestAnimationFrame(draw); return; }
      lastDraw += intervals * WALL_FRAME_MS;
    } else lastDraw = now;
    if (start === null) start = now;
    // A full excursion from -8 to +8 degrees and back takes 12 seconds. The bounded clock
    // repeats exactly after 600 seconds, preserving precision on a title left open overnight.
    const t = ((now - start) / 1000) % 600;
    S.root.rotation.y = reduced ? 0 : Math.sin(t * Math.PI / 6) * WALL_TURN;
    S.gl.render(S.scene, S.camera);
    S.draws++;
    if (!handle.ready) {
      handle.ready = true;
      host.classList.add('live');
      activity(!reduced);
    }
    if (!reduced) raf = requestAnimationFrame(draw);
  };
  const handle = {
    // title.js leaves the fallback image visible until the first successful draw.
    ready: false,
    resize() {
      if (disposed || activeTitleWall !== handle) return;
      // Mount happens before title.js is attached. ResizeObserver supplies the first real size.
      width = host.clientWidth;
      height = host.clientHeight;
      stop();
      lastDraw = null;
      if (document.hidden || width <= 0 || height <= 0) { handle.suspend(); return; }
      // A short phone hides this decoration. Do not create a context or upload its resources
      // until there is actually room for it; the menu and existing fallback need no renderer.
      if (!S) S = sharedTitleWall();
      if (!S) return;
      S.owner = handle;
      S.host = host;
      if (S.canvas.parentNode !== host) host.appendChild(S.canvas);
      if (!canDraw()) return;
      // Native CSS resolution is enough for the slow, large slabs; MSAA keeps their bevels
      // smooth without paying the 2.25x fragment load of a 1.5 DPR decorative canvas.
      S.gl.setPixelRatio(Math.min(1, window.devicePixelRatio || 1));
      S.gl.setSize(width, height, false);
      S.camera.aspect = width / height;
      // Fit the full wall at either 8-degree extreme without reading layout in the hot loop.
      const fit = Math.max(190, 320 / S.camera.aspect);
      S.camera.position.z = fit / (2 * Math.tan(Math.PI / 12)) / 0.83;
      S.camera.lookAt(0, 0, 0);
      S.camera.updateProjectionMatrix();
      raf = requestAnimationFrame(draw);
    },
    suspend() {
      stop();
      activity(false);
      handle.ready = false;
      host.classList.remove('live');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      activity(false);
      handle.ready = false;
      stop();
      if (ro) ro.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('resize', handle.resize);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', motion);
      host.classList.remove('live');
      if (activeTitleWall === handle) activeTitleWall = null;
      if (!S || S.owner !== handle) return;
      S.canvas.remove();
      S.gl.setSize(1, 1, false);
      S.owner = null;
      S.host = null;
    },
  };
  const visibility = () => document.hidden ? handle.suspend() : handle.resize();
  const motion = () => {
    const next = reducedNow();
    if (next === reduced) return;
    reduced = next;
    handle.suspend();
    handle.resize();
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handle.resize) : null;
  activeTitleWall = handle;
  if (ro) ro.observe(host);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('resize', handle.resize);
  if (mq && mq.addEventListener) mq.addEventListener('change', motion);
  handle.resize();
  if (titleWallFailed) { handle.dispose(); return null; }
  return handle;
}

/** QA: resource counts and pose; `internals` exposes the renderer for timer-query witnesses. */
export function titleWallInfo(internals = false) {
  const S = titleWall;
  if (internals) return S;
  return { renderers: S ? 1 : 0, mounted: !!(S && S.owner), host: S ? S.host : null,
    bricks: S ? WALL_COUNT : 0, draws: S ? S.draws : 0, rotation: S ? S.root.rotation.y : 0,
    geometries: S ? S.gl.info.memory.geometries : 0, textures: S ? S.gl.info.memory.textures : 0,
    programs: S ? S.gl.info.programs.length : 0 };
}
