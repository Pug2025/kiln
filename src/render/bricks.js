// Kiln: the brick wall (OWNER: C). Glass-and-ceramic cells as instanced meshes.
//
// Groups (one InstancedMesh pair each, compacted: only the bricks of that look are drawn):
//   GLASS  smoked-glass shell over a ceramic core (plain, numbered, explosive, carrier, gravity,
//          weak points)          heat per instance (aHeat)
//   CLEAR  cavity glass over a core (cavity shells, portals, sealed-ball cells without a core)
//   TI     brushed titanium slab (armoured, boss armour)
//   MATTE  matte black slab (indestructible)
// Core and shell share one transform per live slot; ruptures expand them separately. Shapes:
// the 56x26 slab (bottom mode, turned 90 degrees in left mode) and a 26x26 square (ring mode),
// built once and kept for later worlds.
//
// The static wall is rebuilt only when bricks.version changes or a brick's alive/flags/type changed
// (cheap scan per frame, so B's choices about version bumps never leave stale instances).
// MOVING/FALLING bricks are re-written every frame, interpolated px -> x by alpha.
// A broken brick becomes a RUPTURE for 0.16 s (vein heat +1.3), then the renderer spawns
// fragments; ruptures sit in reserved slots after the live ones.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FIELD, POOL, BRICK, BF, GRID } from '../core/constants.js';
import { LOOK } from './look.js';
import { createMarks } from './marks.js';
import { createCoreDamage, BLOCK_FLASH_S } from './core-damage.js';
import { isBossCore, coreProtected, blockDullsCore, CORE_COOL_HEAT } from './boss-feedback.js';
import { PAL, createCoreState } from './materials.js';
import { STOKER_TITANIUM } from './boss.js';

const HW = FIELD.W / 2;
const HH = FIELD.H / 2;
const RUPT = 48;
const CAP = POOL.BRICKS + RUPT;
/** A blocked contact dips a hot core's own heat by this share of LOOK.HEAT_WEAK, easing back. */
const BLOCK_DIP = 0.45;

export const G_GLASS = 0;
export const G_CLEAR = 1;
export const G_TI = 2;
export const G_MATTE = 3;

/** Which look group a brick belongs to. */
export function groupOf(type, flags) {
  if (flags & BF.CAVITY_BALL) return G_CLEAR;
  switch (type) {
    case BRICK.ARMOURED: case BRICK.BOSS: return G_TI;
    case BRICK.INDESTRUCTIBLE: return G_MATTE;
    case BRICK.CAVITY: case BRICK.PORTAL: return G_CLEAR;
    default: return G_GLASS;
  }
}

const easeOut = (k) => 1 - (1 - k) * (1 - k) * (1 - k);

/**
 * @param {THREE.Scene} scene
 * @param {ReturnType<import('./materials.js').createMaterials>} M
 */
export function createBricks(scene, M) {
  const root = new THREE.Group();
  root.name = 'bricks';
  scene.add(root);

  // The six Stoker jaw plates share the brow's finish without changing shared armour.
  // Keep one retained material on the existing pools so boot prepares its instanced program.
  const titanium = M.titanium.clone();

  // ---- shapes (lazily) ----
  const shapes = {};
  function shape(name) {
    if (shapes[name]) return shapes[name];
    const sq = name === 'square';
    const S = LOOK.SHELL, C = LOOK.CORE;
    const sw = sq ? S.h : S.w, cw = sq ? C.h : C.w;
    const shellGeo = new RoundedBoxGeometry(sw, S.h, S.d, S.seg, S.r);
    const coreBase = new RoundedBoxGeometry(cw, C.h, C.d, C.seg, C.r);
    const groups = [];
    for (let g = 0; g < 4; g++) {
      const hasCore = g === G_GLASS || g === G_CLEAR;
      const shellMat = g === G_GLASS ? M.shell : g === G_CLEAR ? M.cavityGlass : g === G_TI ? titanium : M.matte;
      const shell = new THREE.InstancedMesh(shellGeo, shellMat, CAP);
      shell.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      shell.count = 0;
      shell.frustumCulled = false;
      shell.renderOrder = hasCore ? 5 : 0;
      root.add(shell);
      let core = null, heat = null, coreMatrix = null, coreState = null;
      if (hasCore) {
        const cg = coreBase.clone();
        heat = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
        heat.setUsage(THREE.DynamicDrawUsage);
        // Positive heat is live; negative -(1 + heat) identifies a transient rupture.
        cg.setAttribute('aHeat', heat);
        coreState = createCoreState(CAP).setUsage(THREE.DynamicDrawUsage);
        cg.setAttribute('aCoreState', coreState);
        core = new THREE.InstancedMesh(cg, M.core, CAP);
        core.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        core.count = 0;
        core.frustumCulled = false;
        root.add(core);
        coreMatrix = core.instanceMatrix.array;
      }
      groups.push({
        g, shell, core, heat, coreMatrix, coreState,
        brickOf: new Int32Array(CAP),
        live: 0,
        count: 0,
        noCore: new Uint8Array(CAP), // sealed-ball cells: glass only
        dirtyM: false,
      });
    }
    shapes[name] = { name, groups, cellW: sq ? 30 : 60, cellH: 30 };
    return shapes[name];
  }

  let cur = shape('slab');
  // The ring-mode shape is built here too, not on the first ring world (item 21, Oct 27). Built
  // then, it cost the frame that ends The Core's stage 2 about 8.6 ms (Pixel 7, CPU 4x: 20 ms in
  // all, over the frame budget), and its meshes came after the renderer's list of instanced pools,
  // so an empty one was never hidden and still cost a draw setup every ring frame.
  shape('square');
  let mode = 'bottom';
  let world = null;

  // per-brick renderer state (real seconds)
  const flashT = new Float32Array(POOL.BRICKS).fill(-1e9);
  const spawnT = new Float32Array(POOL.BRICKS).fill(-1e9);
  const lastAlive = new Uint8Array(POOL.BRICKS);
  const lastFlags = new Uint16Array(POOL.BRICKS);
  const lastType = new Uint8Array(POOL.BRICKS);
  const lastHpBand = new Uint8Array(POOL.BRICKS);
  const slotOf = new Int32Array(POOL.BRICKS).fill(-1);
  const grpOf = new Int8Array(POOL.BRICKS).fill(-1);
  const inMotionRow = new Uint8Array(POOL.BRICKS);
  const motionRow = new Uint8Array(256); // grid rows with rails (level.def.motion)
  let anyMotion = false;
  let lastCount = -1;
  let version = -1;

  // ruptures (broken bricks flashing before fragments fly)
  const rupt = [];
  for (let k = 0; k < RUPT; k++) rupt.push({ on: false, x: 0, y: 0, w: 0, h: 0, g: 0, heat: 0, t0: 0, type: 0, tier: 0, brick: -1, burn: false, heart: false });
  let ruptHead = 0;

  // level-clear wall firing
  let clearT0 = -1;

  // scratch
  // A brick's placement (field x, y, w, h and a scale) goes through `place`, not call arguments:
  // V8 boxes every fractional argument of a call it does not inline, and on boss levels the ring
  // bricks are placed every frame (item 21: about 0.4 KB a frame on The Core).
  const place = new Float64Array(5);
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const qRot = new THREE.Quaternion();
  const qId = new THREE.Quaternion();
  // left mode turns the slab -90 degrees so its "under" side faces the paddle (marks.js agrees)
  const qLeft = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
  let force = false;
  let lastT = 0; // renderer seconds of the latest frame (event hooks without their own time)
  let blockT = -1e9; // renderer seconds of the last blocked core contact that dulls the core
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  const marks = createMarks(root, M);
  const coreDamage = createCoreDamage(root);

  // Rows scrolling in from above (B unhides a row as it reaches the field) were drawn above the top
  // glass wall, over the phone HUD (review 2026-10-22). Every brick-wall material is clipped at the
  // physical ceiling (or left-mode far wall), so a row slides in from behind the bar. Shared materials
  // (core, matte, dark metal, white marks) also serve pickups and pieces, which never go up there.
  // The renderer turns on local clipping (gl.localClippingEnabled).
  const topClip = [new THREE.Plane(new THREE.Vector3(0, -1, 0), HH)];
  M.titanium.clippingPlanes = topClip; // later paddle clones inherit the original ceiling plane
  root.traverse((o) => {
    if (!o.isInstancedMesh) return;
    o.material.clippingPlanes = topClip;
    if (o.material.isShaderMaterial) o.material.clipping = true;
  });
  // (the ring-mode square shape, built later, uses these same materials)

  function useShape(name) {
    const next = shape(name);
    if (next === cur) return;
    for (const gr of cur.groups) {
      gr.shell.count = 0;
      if (gr.core) gr.core.count = 0;
    }
    cur = next;
  }

  /** Brick transform into m4 (interpolated when it moves). */
  function compose(i, alpha, sMul) {
    const B = world.bricks;
    const moving = (B.flags[i] & (BF.MOVING | BF.FALLING)) !== 0;
    place[0] = moving ? B.px[i] + (B.x[i] - B.px[i]) * alpha : B.x[i];
    place[1] = moving ? B.py[i] + (B.y[i] - B.py[i]) * alpha : B.y[i];
    place[2] = B.w[i];
    place[3] = B.h[i];
    place[4] = sMul;
    composePlace();
  }

  /** m4 from place (field x, y, w, h and a scale). */
  function composePlace() {
    const sMul = place[4];
    pos.set(place[0] - HW, HH - place[1], 0);
    if (mode === 'left') {
      qRot.copy(qLeft);
      scl.set((place[3] / cur.cellW) * sMul, (place[2] / cur.cellH) * sMul, sMul);
    } else {
      qRot.copy(qId);
      scl.set((place[2] / cur.cellW) * sMul, (place[3] / cur.cellH) * sMul, sMul);
    }
    m4.compose(pos, qRot, scl);
  }

  function setSlot(gr, slot, noCore) {
    gr.shell.setMatrixAt(slot, m4);
    if (gr.core) {
      if (noCore) gr.core.setMatrixAt(slot, zero);
      else gr.core.setMatrixAt(slot, m4);
    }
  }

  function rebuild(alpha, t) {
    const B = world.bricks;
    for (const gr of cur.groups) gr.live = 0;
    for (let i = 0; i < B.count; i++) {
      lastAlive[i] = B.alive[i];
      lastFlags[i] = B.flags[i];
      lastType[i] = B.type[i];
      lastHpBand[i] = B.hp[i] > 4 ? 1 : 0;
      slotOf[i] = -1;
      grpOf[i] = -1;
      if (!B.alive[i] || (B.flags[i] & BF.HIDDEN)) continue;
      // The first boss's permanent head is dark, while its breakable chin uses warm titanium.
      const g = world.boss?.id === 'stoker' && B.type[i] === BRICK.BOSS ? G_MATTE : groupOf(B.type[i], B.flags[i]);
      const gr = cur.groups[g];
      const slot = gr.live++;
      gr.brickOf[slot] = i;
      if (gr.coreState) {
        gr.coreState.array[slot * 2] = ((i + 1) * 0.61803398875) % 1;
        gr.coreState.array[slot * 2 + 1] = isBossCore(world, i) ? -1 : 0;
      }
      gr.noCore[slot] = (B.flags[i] & BF.CAVITY_BALL) ? 1 : 0;
      slotOf[i] = slot;
      grpOf[i] = g;
      compose(i, alpha, spawnScale(i, t));
      setSlot(gr, slot, gr.noCore[slot]);
    }
    for (const gr of cur.groups) {
      gr.shell.instanceMatrix.needsUpdate = true;
      if (gr.core) gr.core.instanceMatrix.needsUpdate = true;
      if (gr.coreState) gr.coreState.needsUpdate = true;
    }
    lastCount = B.count;
    version = B.version;
    marks.rebuild(world, mode, slotOf, grpOf, alpha);
  }

  function spawnScale(i, t) {
    const k = (t - spawnT[i]) / LOOK.REFORM_SETTLE_S;
    return k >= 1 || k < 0 ? 1 : 0.6 + 0.4 * easeOut(k);
  }

  /** Did anything structural change since the last rebuild? */
  function changed() {
    const B = world.bricks;
    if (B.version !== version || B.count !== lastCount) return true;
    for (let i = 0; i < B.count; i++) {
      if (B.alive[i] !== lastAlive[i] || B.flags[i] !== lastFlags[i] || B.type[i] !== lastType[i] || (B.hp[i] > 4 ? 1 : 0) !== lastHpBand[i]) return true;
    }
    return false;
  }

  /** Base heat of a live brick (ART 8 table). */
  function baseHeat(i, t) {
    const B = world.bricks;
    const type = B.type[i];
    if (B.flags[i] & BF.CAVITY_BALL) return 0;
    switch (type) {
      case BRICK.PLAIN:
        return inMotionRow[i] ? LOOK.HEAT_MOVING : LOOK.HEAT_TIER[B.tier[i]] ?? LOOK.HEAT_TIER[1];
      case BRICK.NUMBERED: {
        const mx = B.hpMax[i] || 1;
        return LOOK.HEAT_NUMBERED_MIN + LOOK.HEAT_NUMBERED_SPAN * Math.max(0, B.hp[i]) / mx;
      }
      case BRICK.EXPLOSIVE: {
        const k = 0.5 + 0.5 * Math.sin(t * LOOK.EXPLOSIVE_RATE + i * 0.7);
        return LOOK.EXPLOSIVE_LO + (LOOK.EXPLOSIVE_HI - LOOK.EXPLOSIVE_LO) * k;
      }
      case BRICK.WEAK: return isBossCore(world, i) && coreProtected(world) ? CORE_COOL_HEAT : LOOK.HEAT_WEAK;
      case BRICK.CAVITY:
        return LOOK.HEAT_NUMBERED_MIN + (LOOK.HEAT_SPECIAL - LOOK.HEAT_NUMBERED_MIN) * Math.max(0, B.hp[i]) / (B.hpMax[i] || 1);
      case BRICK.CARRIER: case BRICK.GRAVITY: case BRICK.PORTAL:
        return inMotionRow[i] ? LOOK.HEAT_MOVING : LOOK.HEAT_SPECIAL;
      default: return 0.12;
    }
  }

  /**
   * Extra heat from hits, re-forming and the level-clear sweep; a blocked core dips. Reads the
   * brick's y itself: passed in, it cost V8 a boxed number per brick per frame (item 21).
   */
  function extraHeat(i, t) {
    const core = isBossCore(world, i);
    if (core && coreProtected(world)) return 0;
    let h = 0;
    const kf = (t - flashT[i]) / LOOK.HIT_FLASH_S;
    if (kf >= 0 && kf < 1) h += LOOK.HIT_FLASH * (1 - kf);
    if (core) {
      const kb = (t - blockT) / BLOCK_FLASH_S;
      if (kb >= 0 && kb < 1) h -= BLOCK_DIP * LOOK.HEAT_WEAK * (1 - kb);
    }
    const ks = (t - spawnT[i]) / LOOK.REFORM_SETTLE_S;
    if (ks >= 0 && ks < 1) h += LOOK.REFORM_GLOW * (1 - ks);
    if (clearT0 >= 0) h += sweepHeat(world.bricks.y[i], t);
    return h;
  }

  /** ART 9.4: a heat front from the kiln mouth to the top in 0.7 s; each cell 0 -> 1.4 -> 0.2. */
  function sweepHeat(y, t) {
    const pass = clearT0 + LOOK.CLEAR_SWEEP_S * (FIELD.H - y) / FIELD.H;
    const k = (t - pass) / LOOK.CLEAR_CELL_S;
    if (k < 0) return 0;
    if (k < 0.3) return LOOK.CLEAR_PEAK * (k / 0.3);
    if (k < 1) return LOOK.CLEAR_PEAK + (LOOK.CLEAR_REST - LOOK.CLEAR_PEAK) * ((k - 0.3) / 0.7);
    return LOOK.CLEAR_REST;
  }

  return {
    root,
    marks,
    coreDamage,
    setReadability(info) { marks.setReadability(info); coreDamage.setReadability(info); version = -1; },

    setWorld(w) {
      world = w;
      mode = w.level.mode;
      titanium.color.copy(M.titanium.color);
      titanium.emissive.copy(M.titanium.emissive);
      titanium.envMapIntensity = M.titanium.envMapIntensity;
      if (w.boss?.id === 'stoker') {
        titanium.color.setHex(STOKER_TITANIUM.color);
        titanium.envMapIntensity = STOKER_TITANIUM.envMapIntensity;
        titanium.emissive.copy(PAL.heatLoRest).multiplyScalar(STOKER_TITANIUM.heat);
      }
      const clip = topClip[0];
      if (mode === 'left') {
        clip.normal.set(-1, 0, 0);
        clip.constant = (w.field?.farX ?? FIELD.W) - FIELD.W / 2;
      } else {
        clip.normal.set(0, -1, 0);
        clip.constant = HH - (mode === 'bottom' ? w.field?.ceilingY || 0 : 0);
      }
      useShape(mode === 'ring' ? 'square' : 'slab');
      flashT.fill(-1e9);
      spawnT.fill(-1e9);
      blockT = -1e9;
      inMotionRow.fill(0);
      motionRow.fill(0);
      anyMotion = false;
      const motion = w.level.def.motion || [];
      for (const m of motion) if (m.row >= 0 && m.row < 256) { motionRow[m.row] = 1; anyMotion = true; }
      for (const r of rupt) r.on = false;
      clearT0 = -1;
      version = -1;
      lastCount = -1;
      marks.setWorld(w, mode);
      coreDamage.setWorld(w);
    },

    /** Event hooks (called from the renderer's bus reader). t = renderer seconds. */
    hit(i, t) {
      if (i >= 0 && i < POOL.BRICKS) {
        flashT[i] = t;
      }
      marks.hit(i, t);
    },
    coreGuard(i, active) {
      // Readiness itself is evaluated every frame from sim time. Reopening never replays an old
      // hit flash; the core re-heats with the short re-forming glow so "hot again" is seen.
      if (!active && i >= 0 && i < POOL.BRICKS) {
        flashT[i] = -1e9;
        spawnT[i] = lastT;
      }
    },
    /**
     * A core contact that did not count (BOSS_BLOCKED; guard = the core is cooled): the core's
     * own heat dips and its cracks flash ash for a moment, unless it is the rattle of a counted
     * hit (blockDullsCore). The grey puff and dull knock come from the renderer and audio.
     */
    coreBlocked(t, guard) {
      if (!blockDullsCore(world, guard)) return;
      blockT = t;
      coreDamage.blocked(t);
    },
    spawned(i, t) {
      if (i >= 0 && i < POOL.BRICKS) spawnT[i] = t;
    },
    /**
     * Returns the rupture record (the renderer spawns fragments when it ends). burn = BRICK_BURNT:
     * a row burnt off at the danger line heats up and shrinks away, no fragments.
     */
    broken(i, x, y, type, t, burn = false) {
      const B = world.bricks;
      const r = rupt[ruptHead];
      ruptHead = (ruptHead + 1) % RUPT;
      r.on = true;
      r.brick = i;
      r.x = x;
      r.y = y;
      r.w = i >= 0 ? B.w[i] : 60;
      r.h = i >= 0 ? B.h[i] : 30;
      r.type = type;
      r.tier = i >= 0 ? B.tier[i] : 1;
      r.g = world.boss?.id === 'stoker' && type === BRICK.BOSS ? G_MATTE : groupOf(type, i >= 0 ? B.flags[i] & ~BF.CAVITY_BALL : 0);
      r.heat = i >= 0 && grpOf[i] >= 0 ? baseHeat(i, t) : 0.5;
      r.t0 = t;
      r.burn = burn;
      r.heart = isBossCore(world, i);
      return r;
    },
    fireWall(t) {
      clearT0 = t;
    },
    get clearing() {
      return clearT0 >= 0;
    },

    /**
     * Per frame: rebuild if needed, move moving bricks, write heat, draw ruptures.
     * @param {(r:object) => void} onRuptureEnd called when a rupture's flash ends
     */
    frame(alpha, t, onRuptureEnd) {
      if (!world) return;
      lastT = t;
      const B = world.bricks;
      if (force || changed()) {
        force = false;
        rebuild(alpha, t);
      }
      // motion-row flag per brick (rails); cheap and robust to B's row bookkeeping
      if (anyMotion) for (let i = 0; i < B.count; i++) inMotionRow[i] = B.row[i] >= 0 ? motionRow[B.row[i] & 255] : 0;
      for (const gr of cur.groups) {
        let moved = false;
        const hb = gr.heat ? gr.heat.array : null;
        for (let s = 0; s < gr.live; s++) {
          const i = gr.brickOf[s];
          const f = B.flags[i];
          const sm = spawnScale(i, t);
          if ((f & (BF.MOVING | BF.FALLING)) || sm < 1) {
            compose(i, alpha, sm);
            setSlot(gr, s, gr.noCore[s]);
            moved = true;
          }
          if (hb) hb[s] = baseHeat(i, t) + extraHeat(i, t);
        }
        // ruptures after the live slots
        let n = gr.live;
        for (let k = 0; k < RUPT; k++) {
          const r = rupt[k];
          if (!r.on || r.g !== gr.g) continue;
          const el = t - r.t0;
          const dur = r.burn ? LOOK.BURN_S : LOOK.RUPTURE_S;
          if (el >= dur) {
            r.on = false;
            onRuptureEnd(r);
            continue;
          }
          const kb = el / dur;
          place[0] = r.x; place[1] = r.y; place[2] = r.w; place[3] = r.h;
          place[4] = r.burn ? 1 - 0.85 * kb * kb : 1 + 0.03 * kb;
          composePlace();
          setSlot(gr, n, false);
          if (!r.burn && gr.core) {
            place[4] = 1 + 0.10 * kb;
            composePlace();
            gr.core.setMatrixAt(n, m4);
          }
          if (hb) hb[n] = r.burn ? r.heat + LOOK.BURN_HEAT * Math.min(1, kb * 1.6) : -(1 + r.heat + LOOK.RUPTURE_FLASH * Math.min(1, el / 0.08));
          if (gr.coreState) {
            gr.coreState.array[n * 2] = ((r.brick + 1) * 0.61803398875) % 1;
            const phase = r.burn ? 0 : Math.min(1, el / 0.08);
            gr.coreState.array[n * 2 + 1] = r.heart ? -(1 + phase) : phase;
          }
          n++;
          moved = true;
        }
        if (n !== gr.count) moved = true;
        gr.count = n;
        gr.shell.count = n;
        if (gr.core) gr.core.count = n;
        if (moved) {
          gr.shell.instanceMatrix.needsUpdate = true;
          if (gr.core) gr.core.instanceMatrix.needsUpdate = true;
        }
        if (gr.heat) gr.heat.needsUpdate = true;
        if (gr.coreState) gr.coreState.needsUpdate = true;
      }
      marks.frame(world, alpha, t, slotOf);
      coreDamage.frame(world, alpha, t, coreProtected(world));
    },

    /** Heat a brick shows right now (fragments copy it). */
    heatAt(i, t) {
      return world && i >= 0 ? baseHeat(i, t) : 0.5;
    },
  };
}

export { GRID };
