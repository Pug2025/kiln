// Kiln: brick rules (OWNER: B). Pure functions the content system and the boss scripts share.
// No DOM, no randomness, no clock.

import { BRICK, BF, SRC, WALL } from '../core/constants.js';

/** Content tunables (B's calls, logged in K/status/B.md). */
export const CONTENT = Object.freeze({
  CHAIN_MS: 70,          // a blast reaches the next explosive this much later (the chain ripples)
  BLAST_CELLS: 1.5,      // blast half-size in cells: 1.5 = the 3×3 around the brick
  GRAVITY: 1800,         // falling brick acceleration, units/s²
  FALL_MAX: 700,         // falling brick top speed, units/s
  MARCH_SHIFT_MS: 400,   // a march-down step slides the wall one row over this long
  DANGER_Y: WALL.DANGER_Y, // bottom mode: a brick whose bottom edge passes this line burns off
  FLOOR_Y: 720,          // bottom mode: a falling gravity brick shatters below this line
  FLOOR_X: 120,          // left mode: same, measured from the paddle side
  SCROLL_LINE: 630,      // The Flue: the wall slides down while its lowest brick sits above this
  RAIN_Y: 50,            // multiball rain enters here
  FEVER_SPREAD_DEG: 22,  // Fever: the twin leaves at this angle from the hitting ball
  CORE_COOLDOWN_MS: 500, // a boss weak point ignores hits this long after one lands
  ENTRY_HITS: 2,         // a weak point counts this many hits per entry, then cools (BOSS_GUARD) until every ball is out
  GUARD_MS: 2500,        // ... or until this long has passed, so a ball caught in a cage is not 10 s of dead knocks
  HAZARD_HEAT: 25,       // HEAT a bomb, slag or bolt knocks out of the meter on a paddle hit (never a Shrink)
});

/** Heavy ball id in effects.ballKind (types.js Effects). */
const HEAVY = 1;

/**
 * Damage a hit deals to a brick under the brick rules (PLAN §4):
 * plain 1 · numbered 1 per hit · armoured 3 ball hits, 1 laser or fire hit · Heavy ball 2 ·
 * a pierce (perfect hit, Thru), Mega, a blast or Purge breaks anything breakable outright.
 * @param {number} type   BRICK.*
 * @param {number} flags  BF.*
 * @param {number} hp     hits left
 * @param {number} src    SRC.*
 * @param {boolean} pierced  the ball passed through (BRICK_HIT c = 1)
 * @param {import('../core/types.js').Effects} eff
 * @returns {number} damage (0 = no effect)
 */
export function hitDamage(type, flags, hp, src, pierced, eff) {
  if (!(flags & BF.BREAKABLE) || hp <= 0) return 0;
  const ball = src === SRC.BALL;
  if (src === SRC.EXPLOSION || src === SRC.OVERLOAD || src === SRC.MEGA || (ball && eff.mega) || pierced) return hp;
  const fire = src === SRC.FIRE || (ball && eff.fire);
  if (type === BRICK.ARMOURED && (src === SRC.LASER || fire)) return hp;
  if (ball) return eff.ballKind === HEAVY ? 2 : 1;
  return 1;
}

/** True if a fire splash should follow this hit (fire ball touching a brick). */
export function burns(src, eff) {
  return src === SRC.FIRE || (src === SRC.BALL && eff.fire);
}
