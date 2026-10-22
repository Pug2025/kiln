// Kiln: pure input maths (OWNER: D). No DOM, no clock: Node tests import this file directly.
//
//   relative grab   the paddle keeps the offset it had when the finger landed, so it never jumps
//                   and the finger never covers it; at a wall the offset slips so the paddle
//                   answers the moment the finger turns back (no dead zone)
//   press timing    a press up to TOUCH.TAP_MS is a tap (action only), longer is a hold (Pull);
//                   it fires on press only when the action matters then (actionMattersNow)
//   areas           the steering area (lower 70% of the screen) and the thumb pad's hit circle
//   keys            arrow keys to a steering axis per field mode

import { FIELD, TOUCH, PERFECT } from '../core/constants.js';

/** Finger travel (CSS px) under which a short one-finger press still counts as a tap. */
export const TAP_SLOP_PX = 12;
/** Extra radius (CSS px) around the thumb pad that still hits it: thumbs land loosely. */
export const PAD_SLOP_PX = 14;
/** Thumb pad gap from the screen edges (CSS px), added to the safe-area inset. */
export const PAD_MARGIN_PX = 20;

/** @returns {{active:boolean, offX:number, offY:number}} */
export function createGrab() {
  return { active: false, offX: 0, offY: 0 };
}

/**
 * The finger lands: remember how far the paddle sits from it (field units).
 * @param {{active:boolean, offX:number, offY:number}} grab
 */
export function beginGrab(grab, fingerX, fingerY, paddleX, paddleY) {
  grab.active = true;
  grab.offX = paddleX - fingerX;
  grab.offY = paddleY - fingerY;
  return grab;
}

export function endGrab(grab) {
  grab.active = false;
  return grab;
}

/**
 * Where the paddle can go along its track (field units) for a mode. Ring mode steers by bearing,
 * so it has no linear limit (axis null).
 * @param {'bottom'|'left'|'ring'} mode
 * @param {number} paddleLen  current paddle length along its track (world.paddle.w)
 * @param {{axis:'x'|'y'|null, min:number, max:number}} out
 */
export function paddleLimits(mode, paddleLen, out) {
  const half = paddleLen / 2;
  if (mode === 'left') {
    out.axis = 'y';
    out.min = half;
    out.max = FIELD.H - half;
  } else if (mode === 'ring') {
    out.axis = null;
    out.min = 0;
    out.max = 0;
  } else {
    out.axis = 'x';
    out.min = half;
    out.max = FIELD.W - half;
  }
  return out;
}

/**
 * The steering target for a finger at (fingerX, fingerY) with the grab offset applied.
 * When the target passes a wall the offset slips by the overshoot, so turning back moves the
 * paddle at once instead of first eating the overshoot.
 * @param {{active:boolean, offX:number, offY:number}} grab
 * @param {{axis:'x'|'y'|null, min:number, max:number}|null} limits
 * @param {{tx:number, ty:number}} out
 */
export function grabTarget(grab, fingerX, fingerY, limits, out) {
  let tx = fingerX + grab.offX;
  let ty = fingerY + grab.offY;
  if (limits && limits.axis === 'x') {
    if (tx < limits.min) { grab.offX += limits.min - tx; tx = limits.min; }
    else if (tx > limits.max) { grab.offX -= tx - limits.max; tx = limits.max; }
  } else if (limits && limits.axis === 'y') {
    if (ty < limits.min) { grab.offY += limits.min - ty; ty = limits.min; }
    else if (ty > limits.max) { grab.offY -= ty - limits.max; ty = limits.max; }
  }
  out.tx = tx;
  out.ty = ty;
  return out;
}

/**
 * A press that lasted `heldMs`: 'tap' (an action) up to TOUCH.TAP_MS, otherwise 'hold' (Pull).
 * @returns {'tap'|'hold'}
 */
export function classifyPress(heldMs, tapMs = TOUCH.TAP_MS) {
  return heldMs <= tapMs ? 'tap' : 'hold';
}

/** True once a press that began at `downAt` has become a hold (Pull) at `now`. */
export function isHold(downAt, now, tapMs = TOUCH.TAP_MS) {
  return now - downAt > tapMs;
}

// ---------------------------------------------------------------- action presses
// A press on the second finger, the top of the screen, the thumb pad or the left mouse button is
// either an action (a tap) or a Pull (a hold). Perfect hits cannot wait for the release, so the
// press fires at once when the action can matter at that moment: a ball sits on the paddle (launch,
// Catch release) or a ball is inside the perfect-hit window of the paddle. Otherwise it waits: a
// release within TOUCH.TAP_MS fires the action, a longer hold is a pure Pull (no Laser shot spent).

/** Input lag allowed between a press and the sim step that reads it (one frame and a step). */
export const PRESS_LEAD_MS = 25;

/** @returns {{id:number, downAt:number, decided:boolean, fired:boolean}} */
export function createPress() {
  return { id: -1, downAt: 0, decided: false, fired: false };
}

export function pressDown(p, id, now) {
  p.id = id;
  p.downAt = now;
  p.decided = false;
  p.fired = false;
  return p;
}

/** True while a press waits for its first sim step (then pressDecide runs once). */
export function pressPending(p) {
  return p.id !== -1 && !p.decided;
}

/** At the first sim step after the press. @returns {boolean} fire the action now */
export function pressDecide(p, matters) {
  if (!pressPending(p)) return false;
  p.decided = true;
  p.fired = !!matters;
  return p.fired;
}

/** Release. @returns {boolean} fire the action now (a tap that did not fire on press) */
export function pressUp(p, now) {
  const fire = p.id !== -1 && !p.fired && classifyPress(now - p.downAt) === 'tap';
  p.id = -1;
  p.decided = false;
  p.fired = false;
  return fire;
}

/** Held past the tap time: Pull. */
export function pressPull(p, now) {
  return p.id !== -1 && isHold(p.downAt, now);
}

export function pressCancel(p) {
  p.id = -1;
  p.decided = false;
  p.fired = false;
  return p;
}

/**
 * Whether an action press does something right now: a ball held on the paddle, or a free ball that
 * touched the paddle within the perfect-hit window or will reach it within the window (plus input
 * lag). Field geometry per mode: the paddle is a segment along its track (ring: the tangent there).
 * @param {import('../core/types.js').World} world
 */
export function actionMattersNow(world, windowMs = PERFECT.WINDOW_MS, leadMs = PRESS_LEAD_MS) {
  const p = world.paddle;
  const mode = world.level.mode;
  let tx = 1, ty = 0;
  if (mode === 'left') { tx = 0; ty = 1; } else if (mode === 'ring') { tx = -Math.sin(p.angle); ty = Math.cos(p.angle); }
  const half = p.w / 2;
  const reach = (windowMs + leadMs) / 1000;
  const balls = world.balls;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (!b.alive) continue;
    if (b.held) return true;
    if (world.time - b.lastPaddleMs <= windowMs && b.lastPaddleMs > 0) return true;
    const dx = b.x - p.x, dy = b.y - p.y;
    let t = dx * tx + dy * ty;
    if (t < -half) t = -half; else if (t > half) t = half;
    const ex = dx - t * tx, ey = dy - t * ty; // from the nearest point of the paddle to the ball
    const gap = Math.sqrt(ex * ex + ey * ey) - b.r - (p.h || 0) / 2;
    if (gap <= 0) return true;
    const closing = -(b.vx * ex + b.vy * ey) / (gap + b.r + (p.h || 0) / 2); // speed toward it
    if (closing > 0 && gap <= closing * reach) return true;
  }
  return false;
}

/** A one-finger tap only counts if the finger barely moved. */
export function withinTapSlop(dx, dy, slop = TAP_SLOP_PX) {
  return dx * dx + dy * dy <= slop * slop;
}

/** One finger anywhere on the lower part of the screen steers (TOUCH.STEER_AREA = 70%). */
export function inSteerArea(clientY, viewH, area = TOUCH.STEER_AREA) {
  return clientY >= viewH * (1 - area);
}

/**
 * The thumb pad circle in CSS px: 64 px across, bottom-right (bottom-left when left-handed),
 * PAD_MARGIN_PX from the edges plus the safe-area insets.
 * @param {number} viewW
 * @param {number} viewH
 * @param {boolean} leftHanded
 * @param {{top?:number, right?:number, bottom?:number, left?:number}} safe
 * @param {{x:number, y:number, r:number}} out  centre and radius
 */
export function thumbPadCircle(viewW, viewH, leftHanded, safe, out) {
  return cornerCircle(viewW, viewH, leftHanded, safe, TOUCH.THUMB_PAD_PX, out);
}

/** Touch Overload button: 56 px, in the bottom corner opposite the thumb pad. */
export const OVERLOAD_BTN_PX = 56;
export function overloadCircle(viewW, viewH, leftHanded, safe, out) {
  return cornerCircle(viewW, viewH, !leftHanded, safe, OVERLOAD_BTN_PX, out);
}

/** CSS px kept clear between the field's bottom edge and the touch Overload button. */
export const OVERLOAD_CLEAR_PX = 4;

/**
 * Screen y the touch Overload button must stay below: the field's bottom edge, which in bottom
 * mode is the kiln mouth 72 units under the paddle (ART §4: nothing near the paddle but the
 * paddle). In every mode the paddle's track ends inside the field.
 * @param {{y:number, h:number}} rect  renderer.fieldRect()
 */
export function overloadClearY(rect) {
  return rect.y + rect.h + OVERLOAD_CLEAR_PX;
}

/**
 * CSS px the play view still has to give up at the bottom so the touch Overload button fits under
 * `clearY` (0 when it already does). The caller shrinks the view by this, refits and asks again.
 */
export function overloadTrayNeed(viewH, safeBottom, clearY) {
  const top = viewH - (safeBottom || 0) - PAD_MARGIN_PX - OVERLOAD_BTN_PX;
  return Math.max(0, clearY - top);
}

/** A circle of `size` px in a bottom corner (left or right), inside the safe area. */
export function cornerCircle(viewW, viewH, left, safe, size, out) {
  const r = size / 2;
  const side = left ? (safe.left || 0) : (safe.right || 0);
  out.r = r;
  out.x = left ? side + PAD_MARGIN_PX + r : viewW - side - PAD_MARGIN_PX - r;
  out.y = viewH - (safe.bottom || 0) - PAD_MARGIN_PX - r;
  return out;
}

/** Hit test against the pad circle with a little slop. */
export function hitsPad(pad, x, y, slop = PAD_SLOP_PX) {
  const dx = x - pad.x;
  const dy = y - pad.y;
  const r = pad.r + slop;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Arrow keys to the steering axis for a field mode: left/right in bottom and ring mode,
 * up/down in horizontal (left) mode, where left/right also work as a fallback.
 * @returns {number} −1, 0 or 1
 */
export function keyAxis(mode, left, right, up, down) {
  const h = (right ? 1 : 0) - (left ? 1 : 0);
  if (mode === 'left') {
    const v = (down ? 1 : 0) - (up ? 1 : 0);
    return v || h;
  }
  return h;
}
