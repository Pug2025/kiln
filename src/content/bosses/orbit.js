// Kiln: rotating-armour bosses (OWNER: B): The Crucible (20) and the 3 stages of The Core (30).
//
// A white-hot core ('W' cells, static) sits inside one or two rings of square titanium plates that
// rotate around it. Each ring has a gap; the ball must get through the gap(s) to reach the core,
// and once inside it rattles between core and plates (at most two counted hits per entry, 500 ms
// apart; then the core cools until every ball is out). The 'B' cells drawn in the level rows mark
// the rings; the script lays the plates out exactly (evenly spaced, spacing ≤ the plate size so
// the ring is sealed at every angle).

import { SIM, BF, BRICK, HAZARD } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { emit } from '../../core/bus.js';
import {
  buildRing, placeRing, gapBearing, resetBoss, hitCore, startCascade, stepCascade,
  indicesWhere, centreOf, aimAtPaddle, endEntry, ballWithin, fuseCells,
} from './common.js';

/** Distance from the centre where a bolt fired `from: 'core'` appears (just outside the W cells). */
const CORE_MUZZLE = 40;

/**
 * @typedef {object} OrbitRing
 * @property {number} r       radius of the plate centres
 * @property {number} slots   evenly spaced plate positions (2πr / slots ≤ 30)
 * @property {number[]} gaps  empty slots (slot k sits at bearing k · 2π/slots; π/2 is the bottom)
 * @property {number} omega   rad/s (field coordinates: positive turns clockwise on screen)
 * @property {number} omega2  rad/s once the core is at half hp or less
 * @property {number} group   bricks.group of its plates
 */

/**
 * @typedef {object} OrbitSpec
 * @property {string} id         'crucible' | 'core'
 * @property {number} hp
 * @property {number} phase      boss.phase while this script runs (The Core: the stage)
 * @property {boolean} final     the last stage: BOSS_DEFEATED (else STAGE_CLEARED)
 * @property {number} coreGroup  bricks.group of the W cells
 * @property {number} bodyGroup  bricks.group of any static B cells left over
 * @property {OrbitRing[]} rings
 * @property {boolean} phase2Event  emit BOSS_PHASE 2 at half hp (The Crucible)
 * @property {{kind:number, everyMs:number, speed:number, r:number, from:'gap'|'edge'|'core'}|null} attack
 */

export function createOrbitBoss(spec) {
  let ctx;
  /** @type {ReturnType<typeof buildRing>[]} */
  let rings = [];
  let cx = 360, cy = 360;
  const outerR = spec.rings[spec.rings.length - 1].r;
  let half = false;
  const v = { x: 0, y: 0 };

  function fire(world) {
    const a = spec.attack;
    const outer = rings[rings.length - 1];
    let bearing;
    if (a.from === 'gap') {
      bearing = gapBearing(outer, spec.rings[spec.rings.length - 1].slots, spec.rings[spec.rings.length - 1].gaps);
      // only when the gap faces the paddle side
      const px = world.paddle.x - cx, py = world.paddle.y - cy;
      const len = Math.hypot(px, py) || 1;
      if (Math.cos(bearing) * (px / len) + Math.sin(bearing) * (py / len) < 0.5) return false;
    } else {
      bearing = Math.atan2(world.paddle.y - cy, world.paddle.x - cx);
    }
    // from the gap: just outside the outer ring; from the core: out of the heart, through the
    // armour, so a bolt travels the whole radius (about 1.4 s) before it reaches the paddle
    const d = a.from === 'core' ? CORE_MUZZLE : outer.r + 26;
    const x = cx + Math.cos(bearing) * d, y = cy + Math.sin(bearing) * d;
    aimAtPaddle(world, x, y, a.speed, 0, v);
    world.api.spawnHazard(x, y, v.x, v.y, a.kind, a.r);
    emit(world.bus, EV.BOSS_ATTACK, 0, x, y, a.kind);
    return true;
  }

  return {
    id: spec.id,

    init(world, c) {
      ctx = c;
      const B = world.bricks;
      const coreList = fuseCells(world, indicesWhere(world, (i) => B.type[i] === BRICK.WEAK));
      const plates = indicesWhere(world, (i) => B.type[i] === BRICK.BOSS);
      for (const i of coreList) B.group[i] = spec.coreGroup;
      const centre = centreOf(world, coreList);
      cx = centre.x;
      cy = centre.y;
      rings = spec.rings.map((r) => buildRing(world, ctx, plates, {
        cx, cy, r: r.r, slots: r.slots, gaps: r.gaps, group: r.group, omega: r.omega,
      }));
      for (const i of plates) { // B cells the rings did not need
        B.alive[i] = 0;
        B.flags[i] &= ~BF.MOVING;
      }
      B.version++;
      half = false;
      resetBoss(world, spec.id, spec.hp, cx, cy);
      world.boss.phase = spec.phase;
      world.boss.open = 1;
      if (spec.phase > 1) emit(world.bus, EV.BOSS_PHASE, 0, cx, cy, spec.phase);
      ctx.setRemaining(spec.hp);
    },

    move(world) {
      const boss = world.boss;
      const d = boss.data;
      boss.px = boss.x;
      boss.py = boss.y;
      boss.pangle = boss.angle;
      if (d.dying || !boss.active) {
        stepCascade(world, ctx);
        return;
      }
      boss.t += SIM.DT_MS;
      for (let k = 0; k < rings.length; k++) {
        const ring = rings[k];
        const w = half ? spec.rings[k].omega2 : spec.rings[k].omega;
        ring.theta += w * SIM.DT;
        placeRing(world, ring);
      }
      boss.angle = rings.length ? rings[0].theta : 0;
      d.angle2 = rings.length > 1 ? rings[1].theta : 0;
      // an entry lasts until every ball is back outside the outer ring
      endEntry(world, ballWithin(world, cx, cy, outerR));
      if (spec.attack && world.phase === 'play') {
        d.attackAcc += SIM.DT_MS;
        if (d.attackAcc >= spec.attack.everyMs && fire(world)) d.attackAcc = 0;
      }
    },

    onHit(world, i, src) {
      const B = world.bricks;
      const boss = world.boss;
      if (!boss.active || boss.data.dying) return;
      if (B.group[i] !== spec.coreGroup) return; // plates deflect
      void src;
      if (!hitCore(world, ctx, i)) return;
      if (boss.hp === 0) {
        startCascade(world, ctx, 600, spec.final, spec.phase);
        return;
      }
      if (!half && boss.hp * 2 <= boss.hpMax) {
        half = true;
        boss.state = 1;
        boss.data.phaseAt = world.time;
        if (spec.phase2Event) {
          boss.phase = 2;
          emit(world.bus, EV.BOSS_PHASE, 0, boss.x, boss.y, 2);
        }
      }
    },
  };
}

/** bricks.group values for the rotating bosses (F names mesh nodes `part-<name>`). */
export const CRUCIBLE_PARTS = Object.freeze({ RING: 0, CORE: 1 });
export const CORE_PARTS = Object.freeze({ INNER: 0, OUTER: 1, CORE: 2 });

/** The Crucible (20): one ring, phase 2 reverses and speeds up; slag spills out of the gap. */
export const CRUCIBLE_SPEC = Object.freeze({
  id: 'crucible',
  hp: 20,
  phase: 1,
  final: true,
  coreGroup: CRUCIBLE_PARTS.CORE,
  bodyGroup: CRUCIBLE_PARTS.RING,
  phase2Event: true,
  rings: [{ r: 150, slots: 32, gaps: [23, 24, 25, 26], omega: 0.45, omega2: -0.8, group: CRUCIBLE_PARTS.RING }],
  attack: { kind: HAZARD.SLAG, everyMs: 3000, speed: 190, r: 14, from: 'gap' },
});

/** The Core (30): 3 stage worlds, one field mode each, weak point behind rotating armour. */
export const CORE_SPECS = Object.freeze([
  null,
  // stage 1, bottom: one ring with two opposite gaps (they start at the sides); two drifters guard
  {
    id: 'core', hp: 5, phase: 1, final: false, coreGroup: CORE_PARTS.CORE, bodyGroup: CORE_PARTS.INNER,
    phase2Event: false,
    rings: [{ r: 110, slots: 24, gaps: [23, 0, 1, 11, 12, 13], omega: 0.6, omega2: 1.0, group: CORE_PARTS.INNER }],
    attack: null,
  },
  // stage 2, left: one ring, the gap turns toward the paddle; bombers on the far side (level rows)
  {
    id: 'core', hp: 6, phase: 2, final: false, coreGroup: CORE_PARTS.CORE, bodyGroup: CORE_PARTS.INNER,
    phase2Event: false,
    rings: [{ r: 130, slots: 28, gaps: [5, 6, 7, 8], omega: 0.6, omega2: 0.9, group: CORE_PARTS.INNER }],
    attack: { kind: HAZARD.BOLT, everyMs: 3400, speed: 230, r: 10, from: 'gap' },
  },
  // stage 3, ring: two counter-rotating rings; their gaps line up every few seconds; the heart
  // itself fires (from the centre, so a bolt crosses the whole radius before it arrives)
  {
    id: 'core', hp: 8, phase: 3, final: true, coreGroup: CORE_PARTS.CORE, bodyGroup: CORE_PARTS.INNER,
    phase2Event: false,
    rings: [
      { r: 95, slots: 20, gaps: [5, 6, 7], omega: 0.7, omega2: 0.95, group: CORE_PARTS.INNER },
      { r: 165, slots: 35, gaps: [26, 27, 28, 29], omega: -0.5, omega2: -0.7, group: CORE_PARTS.OUTER },
    ],
    attack: { kind: HAZARD.BOLT, everyMs: 3200, speed: 190, r: 10, from: 'core' },
  },
]);
