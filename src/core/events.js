// Kiln — the full event list.
//
// SIM EVENTS go through the world's ring bus (src/core/bus.js) as numbers, never objects:
//   emit(world.bus, EV.BRICK_BROKEN, id, x, y, a, b, c)
// Every record has the same seven fields: id (int), x, y (field units), a, b, c (floats).
// The comment on each code says who emits it and what id/x/y/a/b/c mean. Unused fields are 0.
//
// Code ranges (so parallel agents can append without colliding):
//   1–19 core · 20–59 A physics (append from 45) · 60–109 B content (append from 90)
//   110–159 E economy (append from 140) · 160–199 reserved
//
// APP EVENTS (cold path: screens, settings, save, PWA) go through a small string emitter
// (createEmitter in bus.js). Their names are listed in APP below.

export const EV = Object.freeze({
  // ---- core (src/core/world.js) ----
  LEVEL_START: 1,     // a = level number, b = mode (0 bottom, 1 left, 2 ring)
  PHASE: 2,           // a = new phase code (PHASE_CODE), b = old phase code

  // ---- A physics (src/sim) ----
  SERVE: 20,          // id = ball; x, y = ball on the paddle
  LAUNCH: 21,         // id = ball; x, y; a = vx, b = vy
  PADDLE_HIT: 22,     // id = ball; x, y; a = hit offset −1…1; b = 1 if perfect; c = speed tier after
  PERFECT_HIT: 23,    // id = ball; x, y = contact point
  WALL_HIT: 24,       // id = ball; x, y; a = side (0 left, 1 right, 2 top, 3 ring wall (unused: the ring has none), 4 bottom (left mode))
  BRICK_HIT: 25,      // id = brick; x, y = contact; a = ball index (−1 none); b = SRC.*; c = 1 if pierced
  SENTRY_HIT: 26,     // id = sentry; x, y; a = ball index (−1 laser); b = SRC.*
  BALL_LOST: 27,      // id = ball; x, y = where it left
  OUT_OF_BALLS: 28,   // no live balls left (E decides whether a life is lost)
  SHIELD_USED: 29,    // x, y = where the shield caught the ball
  EMBER_CAUGHT: 30,   // id = ember slot; x, y
  DROP_CAUGHT: 31,    // id = drop slot; x, y; a = DROP kind
  DROP_MISSED: 32,    // id = drop slot; a = DROP kind
  HAZARD_HIT: 33,     // id = hazard slot; x, y; a = hazard kind (paddle was hit by a bomb/blob)
  LASER_FIRED: 34,    // id = first laser slot of the volley; x, y = paddle; a = bolts fired (2). One per action press
  LASER_DONE: 35,     // id = laser slot; x, y (hit something or left the field)
  PULL_START: 36,     // id = ball nearest the paddle
  PULL_END: 37,
  CATCH: 38,          // id = ball held by the Catch effect; x, y
  RELEASE: 39,        // id = ball released from a catch; x, y; a = vx, b = vy
  SPEED_TIER: 40,     // id = ball; a = new tier
  NUDGE: 41,          // id = ball; a = degrees applied; b = reason (0 bounces, 1 pattern, 2 away, 3 portal trips)
  NEAR_MISS: 42,      // id = ball; x, y; a = distance to the last brick
  LAST_BRICK: 43,     // x, y = last brick centre (slow-mo and zoom begin)
  PORTAL: 44,         // id = ball; x, y = exit; a = entry brick; b = exit brick
  // A appends from 45

  // ---- B content (src/content) ----
  BRICK_DAMAGED: 60,  // id = brick; x, y; a = hp left; b = SRC.*
  BRICK_BROKEN: 61,   // id = brick; x, y = centre; a = BRICK type; b = SRC.*; c = ball index (−1 none)
  BRICK_SPAWNED: 62,  // id = brick; x, y (march-down rows, boss armour regrowth)
  EXPLOSION: 63,      // id = brick; x, y = centre; a = radius in cells (1 = 3×3)
  GRAVITY_FALL: 64,   // id = brick; x, y
  GRAVITY_LAND: 65,   // id = brick; x, y
  CAVITY_OPENED: 66,  // id = brick (the sealed cell); x, y; a = ball index released
  ROWS_ADVANCED: 67,  // a = rows moved down (march-down / scrolling)
  REMAINING: 68,      // a = clearable bricks (or boss weak hits) left; emitted when it changes
  TIMER: 69,          // a = seconds left on a timed (bonus) level, emitted once per whole second
  SENTRY_SPAWNED: 70, // id = sentry; x, y; a = kind
  SENTRY_KILLED: 71,  // id = sentry; x, y; a = kind
  SENTRY_FIRED: 72,   // id = hazard slot; x, y; a = hazard kind
  BOSS_HIT: 73,       // x, y; a = hp left; b = hp max
  BOSS_PHASE: 74,     // a = new phase (1-based)
  BOSS_ATTACK: 75,    // x, y; a = attack kind (boss-defined)
  BOSS_DEFEATED: 76,  // x, y
  PURGED: 77,         // a = rows cleared by Purge
  // B appends from 90
  BRICK_BURNT: 90,    // id = brick; x, y = centre; a = BRICK type. Burnt off at the danger line (march-down, The Flue): no score, no embers
  SENTRY_DAMAGED: 91, // id = sentry; x, y; a = hp left; b = SRC.*
  STAGE_CLEARED: 92,  // The Core stages 1 and 2: weak point out, the next stage world follows; x, y; a = stage
  BOSS_GUARD: 93,     // id = core brick; x, y; a = 1 the core cooled (its two hits for this entry are in: it ignores hits), a = 0 hot again (every ball is out)
  BOSS_BLOCKED: 94,   // id = core brick; x, y; a core contact that did not count: a = 1 the core is cooled, a = 0 under 500 ms since the last counted hit
  HAZARD_HEAT_LOST: 95, // id = hazard; x, y = contact; a = HAZARD kind; b = actual HEAT removed (capped at available HEAT). B writes after addHeat

  // ---- E economy (src/economy) ----
  EMBERS_BURST: 110,  // x, y; a = count spawned
  DROP_SPAWNED: 111,  // id = drop slot; x, y; a = DROP kind
  EFFECT_ON: 112,     // a = DROP kind; b = duration ms (0 = until lost/used); c = stack/count
  EFFECT_OFF: 113,    // a = DROP kind
  HEAT_FULL: 114,     // HEAT reached max
  COMBO_STEP: 115,    // a = new multiplier (2, 3, 5); b = combo count
  COMBO_HALVED: 116,  // a = new combo count; b = new multiplier
  SCORE: 117,         // x, y; a = points added; b = multiplier used
  LIFE_LOST: 118,     // a = lives left
  LIFE_GAINED: 119,   // a = lives now
  OVERLOAD_FIRED: 120,// a = OVERLOAD kind; b = HEAT spent
  RUN_OVER: 121,      // a = final score
  LEVEL_CLEARED: 122, // a = level number; b = level score; c = run score
  // E appends from 140
  FREE_MISS: 140,     // a = free misses left this run (Forge "Start lives" rank 3); no life was lost
  SHIELD_BOUGHT: 141, // x, y = paddle; a = HEAT spent; b = shields now (overload input before an Overload is equipped)
  SHIELD_GONE: 142,   // x, y = paddle; a = shields now. A bought shield ran out of time unused (E's SHIELD.HOLD_MS)
});

/** Reverse lookup for logs and tests: EV_NAME[25] === 'BRICK_HIT'. */
export const EV_NAME = Object.freeze(
  Object.fromEntries(Object.entries(EV).map(([k, v]) => [v, k])),
);

// World phases. world.phase holds the string; PHASE events carry the code.
export const PHASES = Object.freeze(['serve', 'play', 'clearing', 'cleared', 'over']);
export const PHASE_CODE = Object.freeze({ serve: 0, play: 1, clearing: 2, cleared: 3, over: 4 });
//   serve    — a ball sits on the paddle waiting for the action (after start and after a life)
//   play     — at least one ball is in flight
//   clearing — the last-brick ceremony (slow-mo + zoom) is running; input still steers
//   cleared  — level done; main.js shows results and moves on (sim keeps stepping embers out)
//   over     — no lives left; main.js shows results

// App (cold path) event names for createEmitter(). Payload is one plain object.
export const APP = Object.freeze({
  SCREEN: 'screen',             // {name, prev}
  PAUSE: 'pause',               // {reason: 'user'|'hidden'|'blur'|'pointercancel'}
  RESUME: 'resume',             // {}
  SETTINGS: 'settings',         // {settings} after any change
  SAVED: 'saved',               // {save}
  LEVEL_REQUEST: 'level',       // {n, gate?} UI asks main to start level n
  RUN_RESULT: 'run-result',     // {cleared, n, score, run}
  UPDATE_READY: 'update-ready', // a new service worker build is waiting
  INSTALLABLE: 'installable',   // beforeinstallprompt captured
  QUALITY: 'quality',           // {lite}
  AUDIO_UNLOCKED: 'audio-unlocked',
});
