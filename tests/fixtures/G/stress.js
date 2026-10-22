// Kiln QA fixture (G): the frame-budget stress level from PLAN §10, "a 300-brick, 3-ball,
// 100-ember fog level". Not part of the campaign: tools/qa/frametime.mjs registers it as level 99
// only on the page it serves itself (or D's ?fixture= hook loads it), and its frame probe keeps
// 3 balls and 100 embers alive with Blackout on (`load` below).
//
// Horizontal mode is the only grid with room for 300 visible bricks (24 x 18 cells of 30 x 60).
// Columns 0-6 stay open for the paddle at x=40 and the ball; columns 7-23 hold the wall.
// Mostly multi-hit bricks, yet the robot's piercing perfect hits still break about 3 a second with
// 3 balls: about 260 left at 12 s, 130 at 60 s (frametime.mjs prints the average it measured under).

const PATTERN = '9c5b9A9c5b9A9c5b9'; // 17 cells, columns 7-23

const rows = [];
for (let r = 0; r < 18; r++) {
  let wall = PATTERN.slice(r % 6) + PATTERN.slice(0, r % 6);
  if (r === 0 || r === 17) wall = '...' + wall.slice(3); // 306 - 6 = 300 bricks
  rows.push('.......' + wall);
}

/** @type {import('../../../src/core/types.js').LevelDef} */
export const level = {
  n: 99,
  id: 'qa-stress',
  name: 'QA stress',
  world: 'qa',
  kind: 'normal',
  mode: 'left',
  tier: 2,
  rows,
  drops: { rate: 0, table: {} },
  rules: { dark: true },
};

/**
 * What the frame probe keeps alive while it measures. HEAT is held at 0: the run starts with an
 * Overload equipped, and 100 caught embers would fire it every couple of seconds (about 50 bricks a
 * shot), which emptied the wall in 12 s. Overload frames are measured on the real levels instead.
 */
export const load = { balls: 3, embers: 100, dark: true, heat: 0 };

export const BRICKS = rows.join('').replace(/\./g, '').length;
