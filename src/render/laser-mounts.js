// Laser hardware follows the same field transforms as the real bolts. Pure, allocation-free.
import { modeCode, paddleTrack, halfReach, fromLocal, normalAt } from '../sim/field.js';
import { LASER_HALF } from '../sim/bodies.js';

export const LASER_MOUNT = Object.freeze({ INSET: 10, FRONT: LASER_HALF + 2, WIDTH: 14, LENGTH: 22, FLASH_S: 0.08 });
const normal = { x: 0, y: 0 };

export function laserMountsActive(world) {
  return world.effects.laserShots > 0;
}

/** Writes field x/y, inward normal nx/ny and scene rotation for a mount whose local +Y fires. */
export function laserMountPose(mode, paddle, side, out) {
  const mc = modeCode(mode);
  fromLocal(mc, paddleTrack(mc, paddle), side * (halfReach(mc, paddle) - LASER_MOUNT.INSET), LASER_MOUNT.FRONT, out);
  normalAt(mc, out.x, out.y, normal);
  out.nx = normal.x;
  out.ny = normal.y;
  out.rotation = Math.atan2(-normal.y, normal.x) - Math.PI / 2;
  return out;
}

export function laserMuzzleFlash(now, firedAt) {
  const elapsed = now - firedAt;
  return elapsed < 0 ? 0 : Math.max(0, 1 - elapsed / LASER_MOUNT.FLASH_S);
}
