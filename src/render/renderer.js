// Kiln: the three.js renderer (OWNER: C). Look test 02 built into the game, to ART.md.
//
// Contract (src/core/types.js -> Renderer):
//   createRenderer(host, opts) -> Promise<Renderer>
//   setWorld(world)            new level / attempt: point the event reader at the new bus, rebuild
//   frame(world, alpha, dt)    draw; alpha 0..1 interpolates px -> x for balls, embers, drops,
//                              hazards, lasers, sentries and MOVING/FALLING bricks; the paddle is
//                              drawn at x/y (latest input, no lag)
//   resize(), setQuality({lite, reduceMotion, reduceTransparency?}), setMenu(on)
//   screenToField(clientX, clientY, out) -> boolean   through the REST camera (the fitted pose
//                              without lean, drift, shake or zoom), so a still finger never moves
//                              the paddle while the camera leans
//   fieldRect(out) -> {x, y, w, h, scale}             the projected field (rest pose), CSS px
//   stats {frameMs, calls, triangles, intervalMs, fps, hist, p50, p95, maxMs, lite, bloom, autoLite}
//   dispose()
// Rules: read world state only, never write it; no allocation per frame (module scratch only);
// effects come from this module's own bus reader.
//
// Modules: fit.js (pure camera maths, Node-tested), rig.js (camera motion), materials.js, kiln.js
// (environment, lights, backdrop, frame), fire.js (kiln mouth + sparks), bricks.js (+ marks.js),
// actors.js (ball, paddle, embers, drops, ...), fx.js (fragments, bursts), post.js (bloom, output).

import * as THREE from 'three';
import { FIELD, RING } from '../core/constants.js';
import { EV, PHASE_CODE } from '../core/events.js';
import { createReader, resetReader, next } from '../core/bus.js';
import { LOOK } from './look.js';
import { PAL, createMaterials } from './materials.js';
import { makeEnvironment, createKiln } from './kiln.js';
import { createFire } from './fire.js';
import { createBricks } from './bricks.js';
import { createActors } from './actors.js';
import { createPieces } from './pieces.js';
import { createOverlays } from './overlays.js';
import { createTrail } from './trail.js';
import { createBoss } from './boss.js';
import { isBossCore, isBossDeflector } from './boss-feedback.js';
import { createHeadroom } from './headroom.js';
import { createFx } from './fx.js';
import { createReadability, updateReadability } from '../core/readability.js';
import { createRig } from './rig.js';
import { createPost } from './post.js';
import { loadKit } from './kit.js';
import { screenToFieldPose, restPose, createPose } from './fit.js';
import { watchContext } from './glcontext.js';
import {
  PACE, STEP_NAMES, createPace, pacePush, pacePushGpu, paceReset, paceMedianIv, paceMedianWork, paceMedianGpu, histQuantile,
  createLadder, ladderDecide, ladderReset,
} from './pace.js';
import { createGpuTimer } from './gputimer.js';

const HW = FIELD.W / 2;
const HH = FIELD.H / 2;
const HIST_N = 100;

/** Resolve after a promise or a timeout, whichever comes first (fonts must never block boot). */
function within(p, ms) {
  return Promise.race([p.catch(() => null), new Promise((r) => setTimeout(r, ms))]);
}

/**
 * @param {HTMLElement} host
 * @param {{lite?:boolean, reduceMotion?:boolean, reduceTransparency?:boolean, debug?:boolean,
 *   onAutoLite?:() => void}} [opts]
 * @returns {Promise<import('../core/types.js').Renderer>}
 */
export async function createRenderer(host, opts = {}) {
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const canvas = document.createElement('canvas');
  canvas.className = 'kiln-canvas';
  // the kiln's base colour under the canvas: a lost context or a frame not drawn yet is a dark kiln,
  // never a white page
  canvas.style.background = '#0f0d0c';
  host.appendChild(canvas);

  // screen vignette (ART 7: 14%, last life 25%); a sibling of the canvas so it never blurs
  const vignette = document.createElement('div');
  vignette.className = 'kiln-vignette';
  Object.assign(vignette.style, {
    position: 'absolute', inset: '0', pointerEvents: 'none',
    background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,1) 100%)',
    opacity: String(LOOK.VIGNETTE),
  });
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(vignette);

  // C call (review 2026-10-22): the canvas is multisampled (and has a depth buffer) only when the
  // game boots in lite, the one path that draws the scene straight to it. Full quality draws into the
  // composer's own MSAA target and only an output quad reaches the canvas, so a multisampled
  // backbuffer there was memory and a resolve per frame for nothing (780x1688 on a 3x phone).
  const bootLite = !!opts.lite;
  const gl = new THREE.WebGLRenderer({ canvas, antialias: bootLite, depth: bootLite, stencil: false, powerPreference: 'high-performance' });
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = LOOK.EXPOSURE;
  gl.setClearColor(PAL.base, 1);
  gl.info.autoReset = false; // the composer renders several passes; count them all per frame
  gl.localClippingEnabled = true; // bricks.js clips the wall at the field's top edge

  const q = {
    lite: !!opts.lite,
    reduceMotion: opts.reduceMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches,
    reduceTransparency: opts.reduceTransparency ?? matchMedia('(prefers-reduced-transparency: reduce)').matches,
  };

  const scene = new THREE.Scene();
  scene.background = PAL.base;
  scene.fog = new THREE.Fog(PAL.base, LOOK.FOG_NEAR, LOOK.FOG_FAR);
  const camera = new THREE.PerspectiveCamera(35, 1, 10, 8000);

  // fonts first: the digit atlas needs Inter Tight (never wait more than 2.5 s)
  if (document.fonts && document.fonts.load) {
    await within(Promise.all([
      document.fonts.load('600 100px "Inter Tight"'),
      document.fonts.load('700 100px "Inter Tight"'),
    ]), 2500);
  }

  const M = createMaterials(gl);
  scene.environment = makeEnvironment(gl);
  const kiln = createKiln(scene, M);
  const fire = createFire(scene);
  const fx = createFx(scene, M);
  const bricks = createBricks(scene, M);
  const actors = createActors(scene, M);
  const pieces = createPieces(scene, M);
  const boss = createBoss(scene, M);
  const trailFx = createTrail(scene);
  const overlays = createOverlays(scene);
  const headroom = createHeadroom(scene);
  const rig = createRig(camera);
  const details = createReadability();
  const post = createPost(gl, scene, camera);
  // every instanced pool: an empty one is hidden before the draw, so three neither sets up its
  // program nor issues a zero-instance draw call (review 2026-10-22)
  const pools = [];
  scene.traverse((o) => { if (o.isInstancedMesh) pools.push(o); });
  loadKit({
    M,
    gl,
    aniso: Math.min(8, gl.capabilities.getMaxAnisotropy()),
    onDropAtlas: (t) => actors.setDropAtlas(t),
    onModel: (id, s) => boss.setModel(id, s),
    onPlate: (name, t) => headroom.setPlate(name, t),
  }).then(() => {
    // the kit swapped maps into materials (new programs) and added the boss meshes: compile them
    // now, not at the first break, drop or boss of play
    if (!disposed) { boss.refreshMaps(); warmUp(); }
  }).catch(() => {});
  let disposed = false;
  // a lost WebGL context (GPU reset, too many contexts): stop drawing, say so, and when three has
  // rebuilt its GPU state on the restore, size the targets and compile the shaders again
  const glWatch = watchContext(canvas, {
    host,
    onRestored() {
      if (disposed) return;
      gpuTimer.rebuild();
      resize();
      warmUp();
    },
  });

  // ---- state ----
  let reader = null;
  let world = null;
  let t = 0;
  let lastNow = performance.now();
  let width = 1, height = 1, pr = 1;
  let breakBoost = 0;
  let clearHold = 0;
  let esc = 0; // last-life escalation 0..1
  let menuOn = false;
  let menuSkip = 0;
  const restCam = createPose();
  const padA = new THREE.Vector3(), padB = new THREE.Vector3();
  const projA = new THREE.Vector3(), projB = new THREE.Vector3();
  const lastLifeColor = new THREE.Color(LOOK.HEAT_LO_LAST);

  const stats = {
    frameMs: 0, calls: 0, triangles: 0, intervalMs: 0, fps: 0,
    hist: new Uint32Array(HIST_N), p50: 0, p95: 0, maxMs: 0, frames: 0,
    lite: q.lite, bloom: !q.lite, autoLite: false, autoLiteWhy: '', workP50: 0, renderMs: 0, pixelRatio: 1,
    // GPU time of the draw where the browser has a GPU timer (-1 without), its median, and the
    // quality ladder's step (pace.js STEP_NAMES)
    gpuMs: -1, gpuP50: -1, gpuTimer: false, step: 0, stepName: STEP_NAMES[0],
    worst: { ms: 0, updateMs: 0, renderMs: 0, t: 0, programs: 0 },
    resetHist() { this.hist.fill(0); this.maxMs = 0; this.frames = 0; this.worst.ms = 0; },
  };
  const pace = createPace();
  const ladder = createLadder();
  const gpuTimer = createGpuTimer(gl.getContext());
  stats.gpuTimer = gpuTimer.available;
  let lastVisible = true;
  const autoLiteOn = params.get('autolite') !== '0';
  let fpsAcc = 0, fpsN = 0;

  function applyQuality() {
    rig.st.reduceMotion = q.reduceMotion;
    post.setMsaaOff(ladder.step >= 1);
    kiln.setLite(q.lite, ladder.step >= 2);
    fire.setLite(q.lite);
    headroom.setQuality(q.lite, q.reduceMotion);
    post.setBloom(!q.lite);
    stats.lite = q.lite;
    stats.bloom = !q.lite;
    resize();
    applyMenu();
  }

  function resize() {
    width = Math.max(1, host.clientWidth || window.innerWidth);
    height = Math.max(1, host.clientHeight || window.innerHeight);
    const cap = ladder.step >= 4 ? 1 : ladder.step >= 3 ? 1.5 : LOOK.MAX_DPR; // the quality ladder
    pr = q.lite ? 1 : Math.min(cap, window.devicePixelRatio || 1);
    stats.pixelRatio = pr;
    gl.setPixelRatio(pr);
    gl.setSize(width, height, false);
    rig.resize(width, height);
    updateReadability(width, height, rig.fit.rect.scale * 0.9, details);
    bricks.setReadability(details);
    pieces.setReadability(details);
    restPose(restCam, rig.fit.dist, rig.fit.look, width / height, rig.fit.centreX);
    headroom.layout(restCam, width, height, rig.fitOpts.frame);
    // fog follows the fitted distance (C call): phones fit the field farther away, and a fixed fog
    // dimmed every brick there (look test 02 flaw 3)
    const shift = rig.fit.dist - LOOK.FOG_REF_DIST;
    scene.fog.near = LOOK.FOG_NEAR + shift;
    scene.fog.far = LOOK.FOG_FAR + shift;
    post.setSize(width, height, pr);
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    const s = (height * pr) / (2 * tanHalf);
    fire.sparkMat.uniforms.uScale.value = s;
    fx.setScale(s);
  }

  function applyMenu() {
    const blur = !q.reduceTransparency;
    canvas.classList.toggle('menu', menuOn);
    canvas.style.filter = menuOn
      ? `${blur ? `blur(${LOOK.MENU_BLUR_PX}px) ` : ''}brightness(${1 - LOOK.MENU_DIM})`
      : (post.direct && esc > 0.001 ? `saturate(${1 - LOOK.DESAT_LAST * esc})` : '');
    canvas.style.transform = menuOn && blur && !q.reduceMotion ? 'scale(1.06)' : '';
  }

  // ---- events ----
  function drain() {
    if (!reader) return;
    while (next(reader)) {
      const r = reader;
      switch (r.type) {
        case EV.BRICK_HIT:
          // Core contact alone may be ignored. Its actual outcome owns all feedback below.
          if (isBossDeflector(world, r.id)) fx.blocked(r.x - HW, HH - r.y);
          else if (!isBossCore(world, r.id)) fx.burst(r.x - HW, HH - r.y, 10, 6, 1, 200, 6);
          break;
        case EV.BRICK_DAMAGED:
          bricks.hit(r.id, t);
          break;
        case EV.BRICK_BROKEN:
          bricks.broken(r.id, r.x, r.y, r.a | 0, t);
          break;
        case EV.BRICK_BURNT:
          bricks.broken(r.id, r.x, r.y, r.a | 0, t, true);
          break;
        case EV.BRICK_SPAWNED:
          bricks.spawned(r.id, t);
          break;
        case EV.EXPLOSION:
          fx.burst(r.x - HW, HH - r.y, 12, 30, 1.6, 260, 8);
          breakBoost = Math.max(breakBoost, 1);
          break;
        case EV.PADDLE_HIT:
          fire.flare(LOOK.FLARE_PADDLE);
          fx.burst(r.x - HW, HH - r.y, 4, 8, 1, 130, 5);
          break;
        case EV.PERFECT_HIT:
          fire.flare(LOOK.FLARE_PERFECT);
          actors.perfect(t);
          break;
        case EV.BALL_LOST:
          fire.flare(LOOK.FLARE_LOST, 0, true);
          rig.shake(t);
          break;
        case EV.WALL_HIT:
          if (!kiln.wallHit(r.a | 0, r.x, r.y, t)) fx.burst(r.x - HW, HH - r.y, 4, 3, 1, 110, 4);
          break;
        case EV.PHASE:
          if ((r.a | 0) === PHASE_CODE.cleared) fireWall();
          break;
        case EV.LEVEL_CLEARED:
          fireWall();
          break;
        case EV.EMBER_CAUGHT:
          actors.catchTick();
          break;
        case EV.SHIELD_USED:
          pieces.shieldUsed(t);
          break;
        case EV.LASER_FIRED:
          actors.laserFired(t);
          break;
        case EV.PORTAL:
          fx.burst(r.x - HW, HH - r.y, 6, 10, 1, 160, 5);
          break;
        case EV.SENTRY_DAMAGED:
          fx.burst(r.x - HW, HH - r.y, 4, 8, 1, 160, 5);
          break;
        case EV.STAGE_CLEARED:
          // The Core stages 1 and 2: the weak point goes out (no full-screen flash, ART 14)
          fx.burst(r.x - HW, HH - r.y, 10, 40, 1.8, 280, 9);
          fire.flare(0.9, 0.4);
          headroom.bossPulse();
          breakBoost = Math.max(breakBoost, 1);
          break;
        case EV.SENTRY_KILLED:
          fx.burst(r.x - HW, HH - r.y, 6, 24, 1.3, 220, 7);
          breakBoost = Math.max(breakBoost, 0.6);
          break;
        case EV.BOSS_HIT:
          bricks.hit(r.id, t);
          fx.burst(r.x - HW, HH - r.y, 8, 16, 1.2, 220, 7);
          fire.flare(0.5);
          break;
        case EV.BOSS_BLOCKED:
          fx.blocked(r.x - HW, HH - r.y);
          break;
        case EV.BOSS_GUARD:
          bricks.coreGuard(r.id, !!r.a);
          break;
        case EV.BOSS_PHASE:
          headroom.bossPulse();
          fire.flare(0.9);
          breakBoost = Math.max(breakBoost, 1);
          break;
        case EV.BOSS_DEFEATED:
          fx.burst(r.x - HW, HH - r.y, 10, 60, 2, 300, 9);
          fire.flare(1.0, 0.8);
          breakBoost = Math.max(breakBoost, 1);
          break;
        default:
      }
    }
  }

  function fireWall() {
    if (bricks.clearing) return;
    bricks.fireWall(t);
    headroom.clear(t + LOOK.CLEAR_SWEEP_S * 0.6);
    fire.flare(1.0, LOOK.CLEAR_HOLD_S, true);
    clearHold = LOOK.CLEAR_HOLD_S;
  }

  function onRuptureEnd(rp) {
    if (rp.burn) {
      // burnt off: sparks lift from where the slab was, nothing to pick up
      fx.burst(rp.x - HW, HH - rp.y, 8, 14, 1, 180, 6);
      return;
    }
    const rotated = world && world.level.mode === 'left';
    fx.breakAt(rp.x - HW, HH - rp.y, rp.w, rp.h, t, rp.heat, rotated);
    fx.burst(rp.x - HW, HH - rp.y, 10, 26, 1.2, 240, 8);
    breakBoost = Math.max(breakBoost, 1);
  }

  /**
   * Compile every shader up front (hidden pieces too: bosses, overlays, ghosts, trail) so the first
   * break, drop or boss never stalls a frame on a shader compile.
   */
  function warmUp() {
    const hidden = [];
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    try {
      actors.warmTextures(gl);
      // both output paths: straight to the canvas (lite: ACES + sRGB in each shader) and into the
      // composer's target (bloom: linear, no tone mapping). three compiles a separate program for
      // each, and a first drop or burst on the bloom path cost a 80-150 ms compile under 4x throttle.
      gl.setRenderTarget(null);
      gl.compile(scene, camera);
      gl.setRenderTarget(post.composer.renderTarget1);
      gl.compile(scene, camera);
      gl.setRenderTarget(null);
    } catch (e) {
      console.warn('[kiln] shader warm-up', e);
    }
    for (const o of hidden) o.visible = false;
  }

  // ---- per-frame helpers (no allocation) ----

  /** ART 12b: tell the fire where the lip and the paddle are (the paddle as a capsule). */
  function legibility(w) {
    const p = w.paddle;
    const mode = w.level.mode;
    const half = Math.max(8, p.w) / 2;
    let ax, ay, bx, by;
    if (mode === 'ring') {
      const span = p.span > 0 ? p.span : (RING.SPAN_DEG * Math.PI) / 180;
      const a0 = p.angle - span / 2, a1 = p.angle + span / 2;
      ax = RING.CX + Math.cos(a0) * RING.R_PADDLE - HW;
      ay = HH - (RING.CY + Math.sin(a0) * RING.R_PADDLE);
      bx = RING.CX + Math.cos(a1) * RING.R_PADDLE - HW;
      by = HH - (RING.CY + Math.sin(a1) * RING.R_PADDLE);
    } else if (mode === 'left') {
      ax = bx = p.x - HW;
      ay = HH - (p.y - half);
      by = HH - (p.y + half);
    } else {
      ax = p.x - half - HW;
      bx = p.x + half - HW;
      ay = by = HH - p.y;
    }
    fire.setLegibility(kiln.lipY, ax, ay, bx, by, p.h / 2);
    padA.set(ax, ay, 0);
    padB.set(bx, by, 0);
  }

  /** ART 12b: keep the bloom off the paddle (after the camera moved this frame). */
  function bloomMask(w) {
    if (!post.bloomOn) return;
    const bw = width * pr, bh = height * pr;
    projA.copy(padA).project(camera);
    projB.copy(padB).project(camera);
    const ax = (projA.x + 1) * 0.5 * bw, ay = (projA.y + 1) * 0.5 * bh;
    const bx = (projB.x + 1) * 0.5 * bw, by = (projB.y + 1) * 0.5 * bh;
    const len = Math.hypot(padB.x - padA.x, padB.y - padA.y);
    const pxPerUnit = len > 1 ? Math.hypot(bx - ax, by - ay) / len : rig.fit.rect.scale * pr;
    // a long feather (80 units): with the fire right under the lip a short one cut a dark pill out
    // of the fire's glow round the paddle
    post.setBloomMask(ax, ay, bx, by, (w.paddle.h / 2 + 34) * pxPerUnit, 80 * pxPerUnit);
  }
  function leadX(w) {
    for (let i = 0; i < w.balls.length; i++) if (w.balls[i].alive && w.balls[i].sealed < 0) return w.balls[i].x;
    return w.paddle.x;
  }

  function trail(w, alpha) {
    for (let i = 0; i < w.balls.length; i++) {
      const b = w.balls[i];
      if (!b.alive || b.held || b.sealed >= 0) continue;
      if (Math.random() < 0.5) {
        const x = b.px + (b.x - b.px) * alpha, y = b.py + (b.y - b.py) * alpha;
        fx.burst(x - HW, HH - y, 2, 1, 1, 60, 5, 1, LOOK.TRAIL_GAIN);
      }
    }
  }

  function timing(now) {
    const iv = Math.min(250, now - lastNow);
    lastNow = now;
    stats.intervalMs = iv;
    const b = Math.min(HIST_N - 1, iv | 0);
    stats.hist[b]++;
    stats.frames++;
    if (stats.frames > 30 && iv > stats.maxMs) stats.maxMs = iv;
    fpsAcc += iv;
    fpsN++;
    if (fpsAcc > 500) {
      stats.fps = Math.round((fpsN * 1000) / fpsAcc);
      fpsAcc = 0;
      fpsN = 0;
    }
  }

  /**
   * End of a frame: the pacing window gets this frame's interval, the renderer's own work and any
   * GPU timer result, then the quality ladder decides (C call, pace.js): one step down when the
   * frame is slow for 3 s, a trial step when a steady 30 Hz cadence may be a cap or a GPU (kept only
   * if the cadence improves), lite only at the last step. Visible page only, after a 5 s warm-up;
   * a hidden tab's gap is never counted.
   */
  function paceFrame(workMs) {
    const visible = document.visibilityState === 'visible';
    if (!visible || !lastVisible) {
      paceReset(pace);
      ladder.slowSince = -1;
    }
    lastVisible = visible;
    if (!visible) return;
    pacePush(pace, stats.intervalMs, workMs);
    stats.p50 = paceMedianIv(pace);
    stats.p95 = histQuantile(pace.ivHist, pace.fill, 0.95);
    stats.workP50 = paceMedianWork(pace);
    stats.gpuP50 = paceMedianGpu(pace);
    if (q.lite || !autoLiteOn || t <= 5) return;
    const act = ladderDecide(ladder, pace, t);
    if (act === 'none' || act === 'keep') return;
    stats.step = ladder.step;
    stats.stepName = STEP_NAMES[ladder.step];
    stats.autoLiteWhy = ladder.why;
    paceReset(pace);
    if (ladder.step >= PACE.MAX_STEP) {
      // the last step is lite (no bloom, 1x pixels, a third of the sparks); D shows "Lite mode on"
      // and never saves it (ART 15.6 D1)
      q.lite = true;
      stats.autoLite = true;
      applyQuality();
      warmUp();
      if (opts.onAutoLite) opts.onAutoLite(ladder.why);
      return;
    }
    applyQuality();
  }

  /** @type {import('../core/types.js').Renderer} */
  const api = {
    setWorld(w) {
      world = w;
      reader = reader ? resetReader(reader, w.bus, w.bus.head) : createReader(w.bus, 'render', w.bus.head);
      kiln.setMode(w.level.mode, w.field);
      rig.setWorld(w);
      bricks.setWorld(w);
      actors.setWorld(w);
      pieces.setWorld(w);
      boss.setWorld(w);
      overlays.setWorld(w);
      headroom.setWorld(w);
      resize();
      trailFx.reset();
      fire.reset();
      fx.clear();
      clearHold = 0;
      breakBoost = 0;
      rig.intro(t);
    },

    frame(w, alpha, realDt) {
      const now = performance.now();
      timing(now);
      const dt = Math.min(0.1, Math.max(0, realDt || 0));
      t += dt;
      if (w !== world) api.setWorld(w);
      drain();

      // escalation (R19): last life
      const tgt = w.fx.lastLife ? 1 : 0;
      const prevEsc = esc;
      esc += Math.sign(tgt - esc) * Math.min(Math.abs(tgt - esc), dt / LOOK.ESCALATE_S);
      if (esc !== prevEsc) {
        PAL.heatLo.copy(PAL.heatLoRest).lerp(lastLifeColor, esc);
        vignette.style.opacity = String(LOOK.VIGNETTE + (LOOK.VIGNETTE_LAST - LOOK.VIGNETTE) * esc);
        post.setSaturation(1 - LOOK.DESAT_LAST * esc);
        if (post.direct && Math.abs(esc - prevEsc) > 0.02) applyMenu();
      }

      // fire: breathes with the combo, flares on hits and losses
      fire.setMult(w.econ.mult || 1);
      const fi = fire.update(t, dt);
      legibility(w);
      if (clearHold > 0) clearHold -= dt;
      breakBoost = Math.max(0, breakBoost - dt * 2.5);
      kiln.update(t, fi, clearHold > 0 ? 2 : 1, breakBoost);
      headroom.frame(w, t, dt, fi);
      const fl = kiln.fireLight;
      const want = LOOK.FIRE_LIGHT_BASE + LOOK.FIRE_LIGHT_GAIN * fi + LOOK.FIRE_LIGHT_BREAK * (breakBoost + (clearHold > 0 ? 1 : 0));
      fl.intensity += (want - fl.intensity) * Math.min(1, dt * 6);

      bricks.frame(alpha, t, onRuptureEnd);
      actors.frame(w, alpha, t, fire, dt);
      pieces.frame(w, alpha, t);
      boss.frame(w, alpha, t, fi);
      trailFx.frame(w, alpha, t);
      overlays.frame(w, alpha, t, dt);
      trail(w, alpha);
      fx.frame(dt, t);
      rig.update(t, dt, leadX(w), w.fx);
      bloomMask(w);

      // under a menu the canvas sits behind a 40 px blur: draw every third frame there (C call),
      // which spares phones the full scene plus the blur filter at 60 fps
      menuSkip = menuOn ? (menuSkip + 1) % 3 : 0;
      if (menuSkip !== 0 || glWatch.lost) {
        stats.frameMs = performance.now() - now;
        paceFrame(stats.frameMs);
        return;
      }
      const t0 = performance.now();
      for (let i = 0; i < pools.length; i++) pools[i].visible = pools[i].count > 0;
      gl.info.reset();
      gpuTimer.begin();
      post.render();
      gpuTimer.end();
      const t1 = performance.now();
      stats.frameMs = t1 - now;
      stats.renderMs = t1 - t0;
      const g = gpuTimer.poll();
      if (g >= 0) {
        stats.gpuMs = g;
        pacePushGpu(pace, g);
      }
      paceFrame(stats.frameMs);
      stats.calls = gl.info.render.calls;
      stats.triangles = gl.info.render.triangles;
      // the worst frame since resetHist(), split into scene update and draw (for G's harness)
      if (stats.frameMs > stats.worst.ms) {
        stats.worst.ms = stats.frameMs;
        stats.worst.updateMs = t0 - now;
        stats.worst.renderMs = t1 - t0;
        stats.worst.t = t;
        stats.worst.programs = gl.info.programs ? gl.info.programs.length : 0;
      }
    },

    resize,

    detailInfo(out) { return Object.assign(out, details); },

    /**
     * D's reserves: keep `top` CSS px clear above the field (the HUD band on tablet portrait,
     * near-square and short viewports) and `bottom` CSS px under it (the touch Overload button).
     * The canvas stays full screen; the field fits between them (the kiln mouth's fire may burn in
     * the bottom reserve). Takes effect at the next resize(); fieldRect() and screenToField()
     * follow it.
     * @param {{top?:number, bottom?:number}} r
     */
    setReserve(r = {}) {
      rig.fitOpts.top = Math.max(0, Number(r.top) || 0);
      rig.fitOpts.bottom = Math.max(0, Number(r.bottom) || 0);
    },

    setQuality(nq = {}) {
      const wasLite = q.lite;
      if (nq.lite !== undefined) q.lite = !!nq.lite;
      if (nq.reduceMotion !== undefined) q.reduceMotion = !!nq.reduceMotion;
      if (nq.reduceTransparency !== undefined) q.reduceTransparency = !!nq.reduceTransparency;
      if (q.lite !== wasLite) {
        // the player chose (D calls this with the saved switch on every settings change, so only a
        // real change counts): back to the top of the quality ladder
        ladderReset(ladder);
        stats.step = 0;
        stats.stepName = STEP_NAMES[0];
        if (!q.lite) {
          stats.autoLite = false;
          stats.autoLiteWhy = '';
        }
      }
      paceReset(pace);
      ladder.slowSince = -1;
      applyQuality();
      // lite and full quality compile different shader variants (G's request: level 24 compiled
      // them in play, 50 to 70 ms frames): compile the new set now, behind the settings screen
      if (q.lite !== wasLite) warmUp();
    },

    setMenu(on) {
      menuOn = !!on;
      applyMenu();
    },

    screenToField(clientX, clientY, out) {
      const r = canvas.getBoundingClientRect();
      return screenToFieldPose(restCam, clientX - r.left, clientY - r.top, r.width || width, r.height || height, out);
    },

    fieldRect(out) {
      const r = canvas.getBoundingClientRect();
      const f = rig.fit.rect;
      out.x = r.left + f.x;
      out.y = r.top + f.y;
      out.w = f.w;
      out.h = f.h;
      out.scale = f.scale;
      out.fieldX = f.fieldX;
      out.fieldY = f.fieldY;
      out.fieldW = f.fieldW;
      out.fieldH = f.fieldH;
      return out;
    },

    stats,

    /** For the debug overlay and QA scripts. */
    get quality() {
      return q;
    },
    _internals: { glWatch, gl, scene, camera, rig, post, fire, bricks, actors, pieces, boss, overlays, headroom, fx, kiln, M },

    dispose() {
      disposed = true;
      glWatch.dispose();
      post.dispose();
      gl.dispose();
      canvas.remove();
      vignette.remove();
    },
  };

  applyQuality();
  warmUp();
  if (opts.debug ?? params.get('debug') === '1') {
    import('../debug/overlay.js').then((m) => m.createOverlay(api, host)).catch((e) => console.warn('[kiln] debug overlay', e));
  }
  return api;
}
