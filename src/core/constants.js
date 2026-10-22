// Kiln — shared constants. Every exact value from HANDOFF_2026-10-21_build.md lives here.
// "Copy, do not round": the numbers below are the approved values. A change to any of them is a
// Call (logged with its reason in the changer's status file) made by the section's owner (see the
// OWNER line on each section and team/FILEMAP.md). New constants are appended in the owner's
// "appends" block at the end of this file.
//
// Coordinates: field units, origin top-left, x right, y down. The field is 720 × 1080 in every mode.
// Time: the sim runs fixed steps of 1/120 s. Durations below are milliseconds of SIM time unless
// a name says REAL (wall-clock time the player sees, used only for slow-mo ceremonies).

const freeze = (o) => {
  for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') freeze(o[k]);
  return Object.freeze(o);
};

// ---------------------------------------------------------------- simulation clock (OWNER: A)
export const SIM = freeze({
  HZ: 120,
  DT: 1 / 120,            // seconds per step
  DT_MS: 1000 / 120,      // 8.333… ms per step
  MAX_STEPS_PER_FRAME: 8, // main.js drops leftover time beyond this (tab was asleep)
});

// ---------------------------------------------------------------- field and grids (OWNER: B)
export const FIELD = freeze({ W: 720, H: 1080 });

// Brick grids per field mode. Cells are axis-aligned rectangles; a brick fills one cell.
// bottom: 12 columns × 60×30 cells from y=90, up to 20 rows (60 rows for scrolling levels).
// left:   24 columns × 18 rows of 30×60 cells covering the field (horizontal mode).
// ring:   16 × 16 cells of 30×30 centred on the ring centre; only cells whose centre is inside
//         radius 240 may hold bricks (ARCH call: square cells keep collision axis-aligned).
export const GRID = freeze({
  bottom: { cols: 12, rows: 20, cw: 60, ch: 30, x0: 0, y0: 90, maxRows: 60 },
  left:   { cols: 24, rows: 18, cw: 30, ch: 60, x0: 0, y0: 0, maxRows: 18 },
  ring:   { cols: 16, rows: 16, cw: 30, ch: 30, x0: 120, y0: 300, maxRows: 16, rMax: 240 },
});

// ---------------------------------------------------------------- field modes (OWNER: A)
export const MODE = freeze({ BOTTOM: 'bottom', LEFT: 'left', RING: 'ring' });

// Horizontal mode: the paddle is a vertical bar at x=40 moving along y.
export const HORIZONTAL = freeze({ PADDLE_X: 40 });

// Ring mode: paddle on an arc around the centre; the ball is lost beyond R_LOSS.
export const RING = freeze({
  CX: 360, CY: 540,
  R_PADDLE: 320,
  SPAN_DEG: 40,
  R_LOSS: 350,
  R_BRICKS: 240,
});

// ---------------------------------------------------------------- paddle (OWNER: A)
export const PADDLE = freeze({
  Y: 1000,            // bottom mode: paddle centre line
  W: 120,             // normal width
  W_WIDE: 180,        // Wide drop
  W_SHRINK: 80,       // Shrink drop
  H: 16,
  KEY_SPEED: 900,     // arrow keys, units/s
  KEY_SPEED_FAST: 1500, // arrow keys with Shift
});

// ---------------------------------------------------------------- ball (OWNER: A)
export const BALL = freeze({
  R: 9,
  MAX: 12,            // pool size (multiball, Fever, cavity balls)
});

// Speed tiers 0–5. Tier +1 every 6 paddle contacts and on a perfect hit; resets to the level's
// base tier on a lost ball. 760 u/s = 6.33 units per step, below one brick height.
export const SPEED = freeze({
  TIERS: [460, 510, 560, 620, 690, 760], // 2026-10-21 18:45 lead request from the owner's playtest (was 420, 480, 540, 610, 680)
  CAP: 760,
  CONTACTS_PER_TIER: 6,
});

// Perfect hit: action within 60 ms of a paddle contact → one tier up for 1.5 s, pierces the
// first brick, paddle edge flares white with a bass thump.
export const PERFECT = freeze({
  WINDOW_MS: 60,
  BOOST_MS: 1500,
  PIERCE: 1,
});

// Bounce angle off the paddle: 75% from where it hits, 25% from paddle velocity; at most 70°
// from the paddle normal, never flatter than 12° from the edge (any surface).
export const ANGLE = freeze({
  POS_WEIGHT: 0.75,
  VEL_WEIGHT: 0.25,
  MAX_FROM_NORMAL_DEG: 70,
  MIN_FROM_EDGE_DEG: 12,
});

// Spin from paddle motion curves the flight for about a second (radius ~1500 at full spin).
export const SPIN = freeze({ DURATION_MS: 1000, MIN_RADIUS: 1500 });

// Pull: hold to accelerate the ball toward the paddle centre. Costs HEAT.
export const PULL = freeze({
  ACCEL: 900,          // units/s²
  SPEED_SCALE: 0.85,   // ball speed ×0.85 while pulling
  HEAT_PER_S: 40,      // of HEAT.MAX
});

// ---------------------------------------------------------------- economy (OWNER: E)
export const HEAT = freeze({ MAX: 100, PER_EMBER: 4 });

// Embers: 2–4 per broken brick, fall at 220 u/s; caught = +4 HEAT and +1 combo. Missed embers
// cost nothing.
export const EMBERS = freeze({
  MIN: 2,
  MAX: 4,
  FALL: 220,
  COMBO_PER: 1,
  MAX_LIVE: 256,       // pool size
});

// Combo multiplier ×1 → ×2 at 10 → ×3 at 25 → ×5 at 50; a lost ball halves the combo count.
export const COMBO = freeze({
  STEPS: [[0, 1], [10, 2], [25, 3], [50, 5]], // [combo count reached, multiplier]
  LOST_BALL_FACTOR: 0.5,
});

export const LIVES = freeze({ START: 3, MAX: 5 });

// Drops (the falling cells with a lit glyph).
export const DROPS = freeze({
  FALL: 160,
  MAX_LIVE: 12,        // pool size
});

// Drop kinds. Colour family: heat (good), cold (cold powers: slow, catch), warn (bad), rare.
// Ids are stable: renderer glyph atlas, audio and save all index by them.
export const DROP = freeze({
  WIDE: 0, SLOW: 1, MULTI: 2, FIRE: 3, LASER: 4, CATCH: 5,
  THRU: 6, LIFE: 7, SHRINK: 8, FAST: 9, FOG: 10, MEGA: 11,
});
export const DROP_COUNT = 12;
export const DROP_NAMES = freeze(['wide', 'slow', 'multi', 'fire', 'laser', 'catch',
  'thru', 'life', 'shrink', 'fast', 'fog', 'mega']);
export const DROP_FAMILY = freeze(['heat', 'cold', 'heat', 'heat', 'heat', 'cold',
  'heat', 'heat', 'warn', 'warn', 'warn', 'rare']);

// Mega-ball rescue: a rare drop that only appears when ≤5 bricks remain for 20 s.
export const MEGA_RESCUE = freeze({ BRICKS: 5, AFTER_MS: 20000 });

// Overloads (fired from HEAT): Purge clears 3 rows, Quench slows all balls 3 s, Fork splits.
export const OVERLOAD = freeze({ NONE: 0, PURGE: 1, QUENCH: 2, FORK: 3 });
export const OVERLOAD_NAMES = freeze(['', 'purge', 'quench', 'fork']);
export const OVERLOAD_RULES = freeze({ PURGE_ROWS: 3, QUENCH_MS: 3000 });

// Levels with a Mod pick (1 of 3) at level start; the Overload pick is at 22; gates first at 13.
export const PICKS = freeze({
  MOD_LEVELS: [13, 16, 19, 23, 26, 29],
  OVERLOAD_LEVEL: 22,
  GATES_FROM: 13,
});

// ---------------------------------------------------------------- feel and fairness (OWNER: A)
// Last brick: 600 ms of real time at 25% speed with a 1.3× zoom on the ball.
// Near miss on the last brick (within 12 units): 200 ms real time slow-mo.
// main.js scales the accumulator by world.timeScale, so the sim itself always takes DT steps:
// 600 ms real at 25% = 150 ms of sim time.
export const SLOWMO = freeze({
  LAST_REAL_MS: 600,
  LAST_SCALE: 0.25,
  LAST_ZOOM: 1.3,
  NEAR_MISS_REAL_MS: 200,
  NEAR_MISS_SCALE: 0.25, // ARCH call: the handoff gives no scale for the near miss; same as last brick
  NEAR_MISS_DIST: 12,
});

// Anti-loop: nudge the ball 4–7° after 10 bounces with no brick, a repeated 4-bounce pattern,
// or 12 s away from the paddle.
export const ANTILOOP = freeze({
  NUDGE_MIN_DEG: 4,
  NUDGE_MAX_DEG: 7,
  BOUNCES_NO_BRICK: 10,
  PATTERN_LEN: 4,
  AWAY_MS: 12000,
});

// Last bricks: at ≤3 clearable bricks a faint aim line shows from the paddle, the ball slows 10%,
// HEAT fills faster (ARCH call: ×2).
export const LAST_BRICKS = freeze({ AT: 3, BALL_SPEED_SCALE: 0.9, HEAT_MULT: 2 });

// ---------------------------------------------------------------- bricks (OWNER: B)
// Brick types (bricks.type). Behaviour lives in src/content; collision reads only bricks.flags.
export const BRICK = freeze({
  EMPTY: 0,
  PLAIN: 1,          // 1 hit; look tier 1–3 in bricks.tier
  NUMBERED: 2,       // 2–9 hits, number shown inside the glass
  ARMOURED: 3,       // 3 ball hits, 1 laser/fire hit
  INDESTRUCTIBLE: 4,
  EXPLOSIVE: 5,      // 3×3 blast, chains
  GRAVITY: 6,        // falls when the brick under it goes
  CAVITY: 7,         // shell around a sealed ball
  CARRIER: 8,        // always releases a drop
  PORTAL: 9,         // trigger: the ball enters and leaves from its twin (bricks.link)
  BOSS: 10,          // boss body / armour
  WEAK: 11,          // boss weak point
});

// Brick flags (bricks.flags bitfield). Written by B; read by A (collision), C (render), E.
export const BF = freeze({
  SOLID: 1,          // the ball reflects off it
  BREAKABLE: 2,      // takes damage
  CLEARABLE: 4,      // counts toward level.remaining
  MOVING: 8,         // position changes over time: renderer re-reads x/y every frame
  FALLING: 16,       // gravity brick currently falling
  HIDDEN: 32,        // not drawn, not collided (scrolled out, not yet arrived)
  PORTAL: 64,        // non-solid trigger
  BOSS: 128,         // belongs to the boss (bricks.group = boss part)
  WEAK: 256,         // boss weak point
  EXPLOSIVE: 512,
  ARMOURED: 1024,
  CAVITY_BALL: 2048, // the cell holds a sealed ball (non-solid until freed)
});

// Damage sources (BRICK_HIT event `b`).
export const SRC = freeze({
  BALL: 0, LASER: 1, FIRE: 2, EXPLOSION: 3, OVERLOAD: 4, BOSS: 5, GRAVITY: 6, MEGA: 7,
});

// ---------------------------------------------------------------- pools (OWNER: A)
export const POOL = freeze({
  BRICKS: 768,       // 60 scrolling rows × 12, also covers left (432) and ring grids
  HAZARDS: 24,       // sentry bombs, boss projectiles
  LASERS: 16,
  SENTRIES: 16,
});

// ---------------------------------------------------------------- input (OWNER: D)
export const TOUCH = freeze({
  TAP_MS: 180,          // second finger: tap ≤180 ms = action, hold = Pull
  STEER_AREA: 0.7,      // one finger anywhere on the lower 70% steers
  THUMB_PAD_PX: 64,
});

// ---------------------------------------------------------------- look tokens (OWNER: C, CSS twin in css/tokens.css owned by D)
// The 3D world keeps look test 02's warm darks; VOID/GRAPHITE are the page background and solid UI
// surfaces only.
export const COLOR = freeze({
  VOID: '#07080A',         // page background behind the canvas
  GRAPHITE: '#121417',     // solid UI surfaces (blur-off fallback fills)
  WORLD_BASE: '#0F0D0C',   // the kiln interior and fog (look test 02)
  WORLD_GRAPHITE: '#1A1816', // the kiln's back wall and ribs
  TEXT: '#F2F4F7',
  GREY: '#8A9099',
  HEAT_LO: '#FF7A1A',      // heat core gradient start
  HEAT_HI: '#FFD9A8',      // heat core gradient end
  COLD: '#5FD4E6',         // cold powers only: slow, Quench, shield, catch
  WARN: '#D72638',         // bad drops, explosive ring
});

export const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=Inter+Tight:wght@600;700&display=swap';

export const STORAGE_KEY = 'kiln.save.v1';

// ================================================================= appends
// Append-only blocks, one per owner, so parallel merges never collide. Add, never edit above.
// ---- A appends ----
// Physics tunables that are A's calls (status/A.md "Calls" gives the reasons).
export const PHYS = freeze({
  CATCH_HOLD_MS: 3000,   // a caught ball releases itself after this long
  MEGA_R: 18,            // Mega ball radius (2x)
  SERVE_OFFSET: 0.35,    // served ball sits at a seeded offset within 35% of the paddle's half length
  SPLIT_DEG: 15,         // split balls fan out 15 degrees apart
  SPLITTER_MAX: 3,       // the Splitter ball splits on a perfect hit only while fewer balls are alive
  VEL_REF: 1200,         // paddle speed (u/s) that gives the full 25% velocity share and full spin
  RING_SWEEP_MAX: 4800,  // ring mode: the paddle's catch sweep counts at most this speed (u/s along the face)
  TOP_SLOW_REAL_MS: 80,  // PLAN §1 fix 4: a top-speed ball reaching the paddle line slows time this long (real ms)
  TOP_SLOW_SCALE: 0.5,   // ... at this time scale (so it covers the ball's last 40 sim ms)
  PORTAL_TRIPS: 4,       // anti-loop: portal trips with nothing breakable hit (paddle contacts or not) before a nudge
});
// The ceiling (PLAN 11, 2026-10-22; ART 12a.1): every bottom and left level gets a wall this far
// beyond its bricks, judged at level start; ring levels have none. world.field holds the result.
export const CEILING = freeze({
  GAP: 120,              // clear space between the highest brick (or a boss's farthest reach) and the ceiling
  MIN_CLEAR: 60,         // never less clear space than this (it wins over TOP_MIN)
  TOP_MIN: 90,           // bottom mode: the ceiling is never above this y (the brick grid's top edge)
});
// ---- B appends ----
// Hazard kinds (world.hazards[i].kind): B spawns them, A moves them, C draws them.
// A paddle hit by any hazard applies the Shrink drop (B's call, see K/status/B.md).
export const HAZARD = freeze({ BOMB: 0, SLAG: 1, BOLT: 2 });
// Sentry kinds (world.sentries[i].kind): drifter wanders and deflects, bomber drops bombs.
export const SENTRY = freeze({ DRIFTER: 0, BOMBER: 1 });
// March-down and The Flue: a brick whose bottom edge passes DANGER_Y (bottom mode) burns off
// (BRICK_BURNT, no score, no embers).
export const WALL = freeze({ DANGER_Y: 780 });
// ---- C appends ----
// ---- D appends ----
// ---- E appends ----
// ---- F/G appends ----
