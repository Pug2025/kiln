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

/** A ring's empty slots split into contiguous openings (a run may wrap past slot zero). */
export function gapRuns(ring) {
  const set = new Set(ring.gaps), out = [];
  for (const k of ring.gaps) {
    if (set.has((k - 1 + ring.slots) % ring.slots)) continue;
    const run = [k];
    while (set.has((run[run.length - 1] + 1) % ring.slots) && run.length < ring.slots) run.push((run[run.length - 1] + 1) % ring.slots);
    out.push(run);
  }
  return out;
}

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
  const outerSpec = spec.rings[spec.rings.length - 1];
  const outerR = outerSpec.r;
  const outerRuns = gapRuns(outerSpec);
  let half = false;
  const v = { x: 0, y: 0 };

  function fire(world) {
    const a = spec.attack;
    const outer = rings[rings.length - 1];
    let bearing;
    if (a.from === 'gap') {
      // the opening that faces the paddle side best (a ring may have more than one)
      const px = world.paddle.x - cx, py = world.paddle.y - cy;
      const len = Math.hypot(px, py) || 1;
      let face = -2;
      bearing = 0;
      for (const run of outerRuns) {
        const b = gapBearing(outer, outerSpec.slots, run);
        const f = Math.cos(b) * (px / len) + Math.sin(b) * (py / len);
        if (f > face) { face = f; bearing = b; }
      }
      if (face < 0.5) return false;
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
        cx, cy, r: r.r, slots: r.slots, gaps: r.gaps, group: r.group, omega: r.omega, theta0: r.theta0 || 0,
      }));
      for (const i of plates) { // B cells the rings did not need
        B.alive[i] = 0;
        B.flags[i] &= ~BF.MOVING;
      }
      B.version++;
      half = false;
      resetBoss(world, spec.id, spec.hp, cx, cy, spec.rules);
      world.boss.phase = spec.phase;
      world.boss.open = 1;
      // the rings' starting turn (stage 3 starts with both gaps at the bottom)
      world.boss.angle = world.boss.pangle = rings.length ? rings[0].theta : 0;
      world.boss.data.angle2 = rings.length > 1 ? rings[1].theta : 0;
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

/**
 * Core rules for the rotating bosses (common.js hitCore). A trip through the gap usually ends in a
 * rattle between core and ring, so it counts three hits a quarter second apart, then the core
 * cools for at most 1.5 s. The Stoker keeps CONTENT's rules (two hits, 500 ms, 2.5 s).
 * (Oct 27, item 20: at two hits, 500 ms and 2.5 s, only about 40% of a human-like player's core
 * contacts counted and the worst dozen in a row counted twice; now about 70%.)
 */
export const ORBIT_RULES = Object.freeze({ cooldownMs: 250, entryHits: 3, guardMs: 1500 });

/**
 * The Crucible (20): one ring, phase 2 reverses and speeds up; slag spills out of the gap.
 * Oct 27 (item 20): 12 hits (was 20), so with ORBIT_RULES a human-like player clears it in about
 * two minutes instead of four to six. The gap stays four slots: the shipped ring model is cut to it.
 */
export const CRUCIBLE_SPEC = Object.freeze({
  id: 'crucible',
  hp: 12,
  phase: 1,
  final: true,
  coreGroup: CRUCIBLE_PARTS.CORE,
  bodyGroup: CRUCIBLE_PARTS.RING,
  phase2Event: true,
  rings: [{ r: 150, slots: 32, gaps: [23, 24, 25, 26], omega: 0.45, omega2: -0.8, group: CRUCIBLE_PARTS.RING }],
  attack: { kind: HAZARD.SLAG, everyMs: 3000, speed: 190, r: 14, from: 'gap' },
  rules: ORBIT_RULES,
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
    rules: ORBIT_RULES,
  },
  // stage 2, left: one ring, the gap turns toward the paddle; bombers on the far side (level rows)
  {
    id: 'core', hp: 6, phase: 2, final: false, coreGroup: CORE_PARTS.CORE, bodyGroup: CORE_PARTS.INNER,
    phase2Event: false,
    rings: [{ r: 130, slots: 28, gaps: [5, 6, 7, 8], omega: 0.6, omega2: 0.9, group: CORE_PARTS.INNER }],
    attack: { kind: HAZARD.BOLT, everyMs: 3400, speed: 230, r: 10, from: 'gap' },
    rules: ORBIT_RULES,
  },
  // stage 3, ring: two counter-rotating rings; the heart itself fires (from the centre, so a bolt
  // crosses the whole radius before it arrives). Oct 27 (item 20): the rings turn at equal and
  // opposite speeds from either side of the bottom, so the gaps always meet at the bottom and the
  // top (every 7 s, every 5 s past half health), a rhythm a player can learn; 6 hits (was 8).
  // Before, the meeting point wandered and both test players mostly failed here.
  // Review Oct 27: the inner gap is five slots (was three), so the two openings overlap for longer
  // at each meeting. With the ring skate turn (ANTILOOP), a human-like player (160 ms) cleared this
  // stage in 64 of 64 runs, median 50 s, 90th percentile 125 s (three slots: 58 to 61 of 64, 90th
  // percentile 200 to 320 s). The renderer trims the inner shell through the live gap.
  {
    id: 'core', hp: 6, phase: 3, final: true, coreGroup: CORE_PARTS.CORE, bodyGroup: CORE_PARTS.INNER,
    phase2Event: false,
    rings: [
      // the outer gap keeps the slots the shipped outer shell is cut to (f-kit); theta0 starts the
      // gaps 77 degrees either side of the bottom (inner middle slot 6 = 108 degrees, outer middle
      // 27.5 of 35 = 282.9), so the first meeting is at the bottom 3 s in, not on the serve
      { r: 95, slots: 20, gaps: [4, 5, 6, 7, 8], omega: 0.45, omega2: 0.6, theta0: (90 - 77 - 108) * Math.PI / 180, group: CORE_PARTS.INNER },
      { r: 165, slots: 35, gaps: [26, 27, 28, 29], omega: -0.45, omega2: -0.6, theta0: (90 + 77 - 27.5 * 360 / 35) * Math.PI / 180, group: CORE_PARTS.OUTER },
    ],
    attack: { kind: HAZARD.BOLT, everyMs: 3200, speed: 190, r: 10, from: 'core' },
    rules: ORBIT_RULES,
  },
]);
