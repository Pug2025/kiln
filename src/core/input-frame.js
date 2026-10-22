// Kiln — the input frame: what the player (or the robot) asks for during ONE sim step.
//
// The input module (D, src/input/input.js) fills one preallocated frame before every step from
// pointer, touch and keys. The robot player (A, src/sim/robot.js) fills the same frame from the
// world state. The sim reads it and never sees the DOM.
//
// Steering is given as a target point in FIELD units. The sim (A, src/sim/field.js) turns it into
// the paddle's position for the current mode: x in bottom mode, y in horizontal mode, the bearing
// from the ring centre in ring mode. Relative grab (touch) is applied by the input module before
// the point is written, so the paddle never jumps under a finger.

/**
 * @returns {import('./types.js').InputFrame}
 */
export function createInputFrame() {
  return {
    steer: false, // true when tx/ty hold a steering target this step
    tx: 0,        // steering target, field units
    ty: 0,
    axis: 0,      // keyboard steering −1…1 (arrows); used when steer is false
    fast: false,  // Shift held with arrows: KEY_SPEED_FAST
    action: false,   // EDGE: pressed since the last step (launch, release, laser, perfect hit)
    pull: false,     // HELD: Pull
    overload: false, // EDGE: fire the equipped Overload
  };
}

/** Clear the one-step edges after a step consumed them. Held values stay. */
export function clearEdges(frame) {
  frame.action = false;
  frame.overload = false;
}

/** Copy a frame (tests, replays). */
export function copyFrame(dst, src) {
  dst.steer = src.steer;
  dst.tx = src.tx;
  dst.ty = src.ty;
  dst.axis = src.axis;
  dst.fast = src.fast;
  dst.action = src.action;
  dst.pull = src.pull;
  dst.overload = src.overload;
  return dst;
}
