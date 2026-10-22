// Kiln: bosses (OWNER: B): The Stoker (10), The Crucible (20), The Core (30, 3 stages).
//
// How a boss plugs into the sim (see src/ARCHITECTURE.md, "Bosses and sentries"):
// - Its body is bricks: 'B' (body/armour) and 'W' (weak point) cells in the level rows, loaded into
//   the brick store with BF.BOSS (+ BF.WEAK) and bricks.group = boss part (table below). The boss
//   script moves them (BF.MOVING; content.move copies px/py first) and changes their flags.
// - A (physics) collides balls and lasers with those bricks like any other brick and emits
//   BRICK_HIT. The content system routes hits on BF.BOSS bricks to the script's onHit().
// - Attacks are hazards: world.api.spawnHazard(x, y, vx, vy, kind, r). A moves them and emits
//   HAZARD_HIT when one touches the paddle; content knocks HEAT out of the meter (CONTENT.HAZARD_HEAT).
// - world.boss holds what the renderer and HUD need (hp, phase, pose, anchor). The renderer draws
//   the boss mesh (F's models/<id>.glb) at world.boss.x/y/angle and the bricks as usual.
// - Boss levels count weak-point hits: level.remaining = boss.hp. W cells carry BF.CLEARABLE so
//   the aim line and the robot treat the core as the target; nothing else is clearable there.
//   A block of W cells is fused into one brick at init (no seams inside the core). The core
//   counts two hits per entry (500 ms apart), then cools (boss.data.guard = 1, BOSS_GUARD a = 1)
//   until every ball has left the boss (the head, the outer ring) or 2.5 s have passed
//   (BOSS_GUARD a = 0). A contact that does not count emits BOSS_BLOCKED, so it never reads as a
//   hit (C: dim core, no flash; E: a dull knock).
// - The level ends when the script sets level.remaining to 0 (BOSS_DEFEATED, or STAGE_CLEARED
//   on The Core's first two stages), then every boss brick breaks in index order over ~0.5 s.

import { createStoker, STOKER_PARTS } from './bosses/stoker.js';
import { createOrbitBoss, CRUCIBLE_SPEC, CORE_SPECS, CRUCIBLE_PARTS, CORE_PARTS } from './bosses/orbit.js';

/**
 * Boss parts by bricks.group value. F names mesh nodes `part-<name>` in models/<boss>.glb; C
 * attaches each node to the bricks of that group (or draws the bricks when a node is missing).
 */
export const BOSS_PARTS = Object.freeze({
  stoker: Object.freeze([
    { group: STOKER_PARTS.HEAD, name: 'head', what: 'furnace head: titanium plates (B cells); deflect the ball; sway in phase 2' },
    { group: STOKER_PARTS.JAW, name: 'jaw', what: 'chin row of armoured plates (A cells); 3 ball hits or 1 laser/fire; regrow at phase 2' },
    { group: STOKER_PARTS.CORE, name: 'core', what: 'white-hot core inside the mouth (the W cells fused into one brick); 5 hits' },
  ]),
  crucible: Object.freeze([
    { group: CRUCIBLE_PARTS.RING, name: 'ring', what: 'rotating ring of square titanium plates (30 x 30, radius 150) with one gap; turns by boss.angle' },
    { group: CRUCIBLE_PARTS.CORE, name: 'core', what: 'white-hot core at the centre (the W cells fused into one brick); 20 hits' },
  ]),
  core: Object.freeze([
    { group: CORE_PARTS.INNER, name: 'shell', what: 'rotating armour ring nearest the core (every stage); turns by boss.angle' },
    { group: CORE_PARTS.OUTER, name: 'outer-shell', what: 'counter-rotating outer ring (stage 3, ring mode); turns by boss.data.angle2' },
    { group: CORE_PARTS.CORE, name: 'core', what: 'the weak point (the W cells fused into one brick); 5 / 6 / 8 hits by stage' },
  ]),
});

/** Mesh nodes with no bricks of their own (static dressing at boss.x / boss.y). */
export const BOSS_DRESSING = Object.freeze({ stoker: [], crucible: ['cradle'], core: ['frame'] });

/**
 * @typedef {object} BossScript
 * @property {string} id
 * @property {(world:import('../core/types.js').World, ctx:object) => void} init   after bricks are loaded
 * @property {(world:import('../core/types.js').World) => void} move              content.move slot
 * @property {(world:import('../core/types.js').World, brick:number, src:number, ball:number, pierced:boolean) => void} onHit  content.resolve slot
 * @property {(world:import('../core/types.js').World, hazard:number, kind:number) => void} [onHazardHit]
 */

/**
 * @param {'stoker'|'crucible'|'core'} id
 * @param {number} [stage]  The Core: 1 (bottom), 2 (left), 3 (ring)
 * @returns {BossScript|null}
 */
export function createBoss(id, stage = 1) {
  if (id === 'stoker') return createStoker();
  if (id === 'crucible') return createOrbitBoss(CRUCIBLE_SPEC);
  if (id === 'core') return createOrbitBoss(CORE_SPECS[Math.max(1, Math.min(3, stage | 0))]);
  return null;
}
