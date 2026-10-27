// Kiln: lasting boss core damage (OWNER: C). Item 20, Oct 27: a dozen counted hits on The Crucible
// left its core looking exactly as it started. Every counted hit now opens one more fine fracture
// across the core face: a dark cut with heat inside, the same thin seam language as the armour.
// The newest crack flashes white-hot and runs out over a tenth of a second, then settles to an
// ember glow that stays for the rest of the fight. Cracks follow boss.hp (state, not events), so a
// restored or rebuilt world shows exactly the damage done. A cooled (guarded) core keeps its cracks
// at a low ember, so damage is visibly kept while it cannot be hurt. A blocked contact turns the
// cracks ash for a moment while the core's own heat dips (bricks.js): the core's material dulls,
// no box is laid over it (review Oct 27). A core under SMALL_CORE_PX on screen (The Core's last
// stage on a desktop) keeps its cracks at least 1.5 CSS px wide, as a phone always does.

import * as THREE from 'three';
import { FIELD, BF, BRICK } from '../core/constants.js';
import { LOOK } from './look.js';
import { PAL } from './materials.js';
import { crackPlan, cracksShown, CRACK_SEGS, MAX_CRACKS } from './boss-feedback.js';

const HW = FIELD.W / 2;
const HH = FIELD.H / 2;
const CAP = MAX_CRACKS * CRACK_SEGS;
/** Fresh crack: runs out over GROW_S, white-hot for FRESH_S, then settles to its ember. */
export const CRACK_GROW_S = 0.1;
export const CRACK_FRESH_S = 0.35;
/** A blocked contact's ash flash on the cracks (and the heat dip on the core, bricks.js). */
export const BLOCK_FLASH_S = 0.2;
/** A core narrower than this many CSS px gets the phone's crack width floor on every screen. */
export const SMALL_CORE_PX = 48;

export function createCoreDamage(root) {
  const group = new THREE.Group();
  group.name = 'boss-core-damage';
  root.add(group);
  const geo = new THREE.PlaneGeometry(1, 1);
  // The dark cut keeps a crack readable on a white-hot face; the heat line keeps it readable on
  // a cooled one. Plain colours, no additive glow: the brightest value stays under bloom.
  const cutMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const heatMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const cuts = new THREE.InstancedMesh(geo, cutMat, CAP);
  const heat = new THREE.InstancedMesh(geo, heatMat, CAP);
  cuts.name = 'boss-core-cuts';
  heat.name = 'boss-core-cracks';
  for (const m of [cuts, heat]) {
    m.count = 0;
    m.frustumCulled = false;
    m.setColorAt(0, new THREE.Color(0));
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  cuts.renderOrder = 6;
  heat.renderOrder = 7;
  group.add(cuts, heat);

  const cutCol = new THREE.Color(0x07080a);
  // settled cracks are paler than the orange core (heat leaking through), fresh ones near white
  const fresh = PAL.heatHi.clone().multiplyScalar(0.92);
  const ember = PAL.heatLo.clone().lerp(PAL.heatHi, 0.5).multiplyScalar(0.88);
  const coldEmber = PAL.heatLo.clone().multiplyScalar(0.5);
  const ashCol = new THREE.Color(0x5f5d5a); // dull warm grey, darker than any heat
  const tmp = new THREE.Color();
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);

  let plan = null, shown = 0;
  let planDef = null, planCore = -1, planMax = -1, planW = -1, planH = -1;
  const revealT = new Float32Array(MAX_CRACKS).fill(-1e9);
  let blockT = -1e9;
  const read = { small: false, scale: 1 };
  const zCut = LOOK.SHELL.d / 2 + 0.7, zHeat = zCut + 0.2;

  function coreOf(world) {
    const B = world.bricks;
    for (let i = 0; i < B.count; i++) if (B.alive[i] && B.type[i] === BRICK.WEAK && (B.flags[i] & BF.BOSS)) return i;
    return -1;
  }

  return {
    group,
    get shown() { return shown; },
    setReadability(info) { read.small = !!info?.small; read.scale = info?.scale || 1; },

    /** A new world: forget the old core (the plan is rebuilt from the live core on the next frame). */
    setWorld() {
      plan = null; planDef = null; planCore = -1; shown = 0; blockT = -1e9;
      revealT.fill(-1e9);
      cuts.count = heat.count = 0;
    },

    /** A contact the core did not count: its cracks go ash for a moment. */
    blocked(t) { blockT = t; },

    /**
     * @param {any} world
     * @param {number} alpha
     * @param {number} t renderer seconds
     * @param {boolean} cold the core is cooled (guarded)
     */
    frame(world, alpha, t, cold) {
      const boss = world?.boss;
      const core = boss && boss.active && boss.hpMax > 0 ? coreOf(world) : -1;
      if (core < 0) { cuts.count = heat.count = 0; return; }
      const B = world.bricks;
      // Rebuilt only when the fight changes (not boss.phase: The Crucible's half-health phase keeps
      // its cracks). Compared field by field, so a frame allocates nothing.
      if (world.level.def !== planDef || core !== planCore || boss.hpMax !== planMax || B.w[core] !== planW || B.h[core] !== planH) {
        planDef = world.level.def; planCore = core; planMax = boss.hpMax; planW = B.w[core]; planH = B.h[core];
        const key = `${boss.id}:${world.level.def.id}:${B.w[core]}x${B.h[core]}:${boss.hpMax}`;
        let seed = 7;
        for (let k = 0; k < key.length; k++) seed = (seed * 31 + key.charCodeAt(k)) >>> 0;
        plan = crackPlan(B.w[core], B.h[core], boss.hpMax, seed);
        shown = cracksShown(boss); // a restored fight shows its damage at once, without flashes
        revealT.fill(-1e9);
      }
      const want = cracksShown(boss);
      if (want > shown) for (let k = shown; k < want; k++) revealT[k] = t;
      shown = want;
      const moving = (B.flags[core] & (BF.MOVING | BF.FALLING)) !== 0;
      const cx = (moving ? B.px[core] + (B.x[core] - B.px[core]) * alpha : B.x[core]) - HW;
      const cy = HH - (moving ? B.py[core] + (B.y[core] - B.py[core]) * alpha : B.y[core]);
      // a phone keeps a crack at least 1.5 CSS px wide (its cut 3 px), like the hit-line floor;
      // so does a core too small on screen for field-unit cracks to read (review Oct 27)
      const px = read.small || B.w[core] * read.scale < SMALL_CORE_PX ? 1 / read.scale : 0;
      const wHeat = Math.max(1.7, 1.5 * px), wCut = wHeat + Math.max(2.6, 1.5 * px);
      const b = t - blockT, dull = b >= 0 && b < BLOCK_FLASH_S ? 1 - b / BLOCK_FLASH_S : 0;
      let n = 0;
      for (let s = 0; s < plan.length / 5; s++) {
        const k = plan[s * 5 + 4];
        if (k >= shown) continue;
        const age = t - revealT[k];
        // a quarter of the crack shows on the very frame of the hit, the rest runs out after it
        const grow = Math.min(1, 0.25 + 0.75 * Math.max(0, age / CRACK_GROW_S));
        const x0 = plan[s * 5], y0 = plan[s * 5 + 1], x1 = plan[s * 5 + 2], y1 = plan[s * 5 + 3];
        const dx = (x1 - x0) * grow, dy = (y1 - y0) * grow;
        const l = Math.hypot(dx, dy);
        if (l < 0.01) continue;
        q.setFromAxisAngle(zAxis, Math.atan2(-dy, dx));
        pos.set(cx + x0 + dx / 2, cy - (y0 + dy / 2), zCut);
        scl.set(l + wCut * 0.6, wCut, 1);
        m4.compose(pos, q, scl);
        cuts.setMatrixAt(n, m4);
        cuts.setColorAt(n, cutCol);
        pos.z = zHeat;
        scl.set(l, wHeat, 1);
        m4.compose(pos, q, scl);
        heat.setMatrixAt(n, m4);
        const f = age < CRACK_FRESH_S ? 1 - age / CRACK_FRESH_S : 0;
        tmp.copy(cold ? coldEmber : ember).lerp(fresh, f);
        if (dull > 0) tmp.lerp(ashCol, dull);
        heat.setColorAt(n, tmp);
        n++;
      }
      cuts.count = heat.count = n;
      cuts.instanceMatrix.needsUpdate = heat.instanceMatrix.needsUpdate = true;
      if (cuts.instanceColor) cuts.instanceColor.needsUpdate = true;
      if (heat.instanceColor) heat.instanceColor.needsUpdate = true;
    },
  };
}
