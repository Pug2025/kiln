// Kiln — the world: state allocation, the fixed-step pipeline and the phase machine.
//
// One world per level attempt. createWorld() allocates every pool up front (nothing in the step
// allocates), installs default no-op world.api calls, then lets each system init in this order:
// content (B: bricks from the level), physics (A: paddle, first ball on the paddle),
// economy (E: HEAT, combo, lives from the run).
//
// stepWorld() runs ONE fixed step (SIM.DT) through PIPELINE. The order is the contract that lets
// A, B and E work apart:
//
//   1 physics.pre      A  paddle from input, serve/launch/release, lasers fired, Pull flag
//   2 content.move     B  moving rows, march-down, scrolling, gravity falls, bosses, sentries, timers
//   3 physics.move     A  balls, lasers, embers, drops, hazards: integrate + collide; emits hits,
//                         catches, losses
//   4 content.resolve  B  apply BRICK_HIT / SENTRY_HIT / HAZARD_HIT: damage, breaks, chains,
//                         cavity release, boss reactions, level.remaining
//   5 economy.step     E  react to everything since its last read: embers and drops to spawn
//                         (via world.api), HEAT, combo, score, lives, drop effects, Overloads
//   6 physics.post     A  last-brick ceremony and near-miss slow-mo, anti-loop, aim line,
//                         phase changes (play → clearing → cleared)
//
// Systems talk through three channels only: the event bus (facts that happened), world.api
// (requests to the owner of a pool: "spawn embers here"), and documented state fields with a
// single writer each (see src/core/types.js). Read src/ARCHITECTURE.md before changing any of it.

import { SIM, FIELD, GRID, PADDLE, BALL, EMBERS, DROPS, POOL, HEAT, DROP_COUNT, LIVES, RING } from './constants.js';
import { EV, PHASE_CODE } from './events.js';
import { createBus, emit } from './bus.js';
import { createRng } from './rng.js';

export const PIPELINE = Object.freeze([
  ['physics', 'pre'],
  ['content', 'move'],
  ['physics', 'move'],
  ['content', 'resolve'],
  ['economy', 'step'],
  ['physics', 'post'],
]);

const MODE_CODE = { bottom: 0, left: 1, ring: 2 };

/** Normalise level rules so every flag exists (B's parser may do more). */
export function defaultRules(rules = {}) {
  return {
    pull: false,
    overloads: false,
    heat: false,
    timerMs: 0,
    noFail: false,
    marchMs: 0,
    marchRows: [],
    scrollSpeed: 0,
    fever: false,
    rainMs: 0,
    dark: false,
    ghosts: false,
    megaRescue: false,
    aimAt: 0,
    ...rules,
  };
}

/** A run with defaults. Economy (E) owns the real createRun; this keeps tests and stubs simple. */
export function defaultRun(seed = 1) {
  return {
    seed,
    levelN: 1,
    lives: LIVES.START,
    score: 0,
    mods: [],
    overload: 0,
    ballKind: 0,
    twist: null,
    overburnWave: 0,
    embersBanked: 0,
  };
}

function makeBricks(cap) {
  return {
    count: 0,
    version: 0,
    alive: new Uint8Array(cap),
    type: new Uint8Array(cap),
    flags: new Uint16Array(cap),
    hp: new Int16Array(cap),
    hpMax: new Int16Array(cap),
    tier: new Uint8Array(cap),
    x: new Float32Array(cap),
    y: new Float32Array(cap),
    w: new Float32Array(cap),
    h: new Float32Array(cap),
    px: new Float32Array(cap),
    py: new Float32Array(cap),
    col: new Int16Array(cap),
    row: new Int16Array(cap),
    link: new Int16Array(cap).fill(-1),
    drop: new Int8Array(cap).fill(-1),
    group: new Int16Array(cap).fill(-1),
    hitMs: new Float32Array(cap).fill(-1e9),
  };
}

function makeEmbers(cap) {
  return {
    count: 0,
    alive: new Uint8Array(cap),
    x: new Float32Array(cap),
    y: new Float32Array(cap),
    px: new Float32Array(cap),
    py: new Float32Array(cap),
    vx: new Float32Array(cap),
    vy: new Float32Array(cap),
    bornMs: new Float32Array(cap),
  };
}

function makeBall() {
  return {
    alive: false, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, r: BALL.R,
    tier: 0, boostMs: 0, pierce: 0, held: false, holdOffset: 0, spin: 0,
    bouncesNoBrick: 0, lastPaddleMs: -1e9, portalCooldownMs: 0, sealed: -1,
  };
}

const makeMover = () => ({ alive: false, kind: 0, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, r: 0 });

function makeSentry() {
  return { alive: false, kind: 0, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, r: 0, hp: 0, eye: 0, t: 0 };
}

/** Count calls to api functions nobody installed yet (so missing seams show up in tests). */
function missing(world, name, ret) {
  return () => {
    world.stats.apiMissing[name] = (world.stats.apiMissing[name] || 0) + 1;
    return ret;
  };
}

/** No-op system so a world can run before an agent delivers theirs. */
export function noopSystem(name) {
  return { name, init() {} };
}

/**
 * @param {object} opts
 * @param {import('./types.js').LevelDef} opts.level
 * @param {number} [opts.seed]
 * @param {import('./types.js').RunState} [opts.run]
 * @param {Partial<import('./types.js').Systems>} [opts.systems]
 * @returns {import('./types.js').World}
 */
export function createWorld({ level, seed = 1, run = null, systems = {} }) {
  if (!level) throw new Error('createWorld: level is required');
  const mode = level.mode || 'bottom';
  const grid = GRID[mode];
  if (!grid) throw new Error(`createWorld: unknown mode "${mode}"`);
  const root = createRng(seed);

  /** @type {import('./types.js').World} */
  const world = {
    seed,
    step: 0,
    time: 0,
    phase: 'serve',
    phaseMs: 0,
    timeScale: 1,
    level: {
      def: level,
      n: level.n | 0,
      mode,
      grid,
      rules: defaultRules(level.rules),
      kind: level.kind || 'normal',
      remaining: 0,
      total: 0,
      timeLeftMs: -1,
      elapsedMs: 0,
      scrollY: 0,
      entryY: NaN, // B, content.init: where bricks join play later (NaN = none); a double from the start, so the shape never changes
    },
    // the play box's movable walls (A computes them in physics.init from the starting bricks)
    field: { ceilingY: 0, farX: FIELD.W, clear: 0, gap: 0 },
    paddle: {
      x: mode === 'left' ? 40 : FIELD.W / 2,
      y: mode === 'left' ? FIELD.H / 2 : mode === 'ring' ? RING.CY + RING.R_PADDLE : PADDLE.Y,
      px: 0, py: 0,
      angle: mode === 'ring' ? Math.PI / 2 : 0,
      w: PADDLE.W,
      h: PADDLE.H,
      span: (RING.SPAN_DEG * Math.PI) / 180,
      vel: 0,
      pulling: false,
      lastActionMs: -1e9,
      contacts: 0,
      ghostX: new Float32Array(2),
      flareMs: -1e9,
    },
    balls: Array.from({ length: BALL.MAX }, makeBall),
    bricks: makeBricks(POOL.BRICKS),
    embers: makeEmbers(EMBERS.MAX_LIVE),
    drops: Array.from({ length: DROPS.MAX_LIVE }, makeMover),
    hazards: Array.from({ length: POOL.HAZARDS }, makeMover),
    lasers: Array.from({ length: POOL.LASERS }, makeMover),
    sentries: Array.from({ length: POOL.SENTRIES }, makeSentry),
    boss: {
      active: false, id: '', phase: 0, hp: 0, hpMax: 0, x: 0, y: 0, px: 0, py: 0,
      angle: 0, pangle: 0, open: 0, state: 0, t: 0, data: {},
    },
    econ: {
      heat: 0,
      heatMax: HEAT.MAX,
      combo: 0,
      mult: 1,
      levelScore: 0,
      embersCaught: 0,
      embersAutoBanked: 0,
      dropsCaught: 0,
      bricksBroken: 0,
      overloadCost: HEAT.MAX,
      effectMs: new Float32Array(DROP_COUNT),
    },
    effects: {
      paddleW: PADDLE.W,
      ballSpeedScale: 1,
      catchOn: false,
      laserShots: 0,
      shield: 0,
      fire: false,
      thru: false,
      mega: false,
      fog: 0,
      pierceFirst: 0,
      magnet: 0,
      ballKind: 0,
      aimLine: false,
    },
    run: run || defaultRun(seed),
    fx: {
      zoom: 1, zoomX: FIELD.W / 2, zoomY: FIELD.H / 2,
      aim: false, aimX: 0, aimY: 0, aimDX: 0, aimDY: -1,
      lastLife: false, dark: 0, heatLevel: 0,
    },
    bus: createBus(),
    rng: {
      physics: root.fork('physics'),
      content: root.fork('content'),
      economy: root.fork('economy'),
      robot: root.fork('robot'),
    },
    api: /** @type {any} */ ({}),
    stats: { nudges: 0, paddleHits: 0, perfectHits: 0, bricksBroken: 0, ballsLost: 0, apiMissing: {} },
    systems: {
      physics: systems.physics || noopSystem('physics'),
      content: systems.content || noopSystem('content'),
      economy: systems.economy || noopSystem('economy'),
    },
  };
  world.paddle.px = world.paddle.x;
  world.paddle.py = world.paddle.y;

  const api = world.api;
  api.spawnBall = missing(world, 'spawnBall', -1);
  api.splitBalls = missing(world, 'splitBalls', 0);
  api.serve = missing(world, 'serve', undefined);
  api.spawnEmbers = missing(world, 'spawnEmbers', 0);
  api.settlePickups = missing(world, 'settlePickups', 0);
  api.spawnDrop = missing(world, 'spawnDrop', -1);
  api.spawnHazard = missing(world, 'spawnHazard', -1);
  api.damageBrick = missing(world, 'damageBrick', undefined);
  api.breakBrick = missing(world, 'breakBrick', undefined);
  api.purgeRows = missing(world, 'purgeRows', 0);
  api.addScore = missing(world, 'addScore', undefined);
  api.addHeat = missing(world, 'addHeat', undefined);
  api.applyDrop = missing(world, 'applyDrop', undefined);

  emit(world.bus, EV.LEVEL_START, 0, 0, 0, world.level.n, MODE_CODE[mode] ?? 0);
  world.systems.content.init(world);
  world.systems.physics.init(world);
  world.systems.economy.init(world);
  return world;
}

/**
 * Advance the world by exactly one fixed step (SIM.DT). Deterministic for a given seed and inputs.
 * @param {import('./types.js').World} world
 * @param {import('./types.js').InputFrame} input
 */
export function stepWorld(world, input) {
  world.step++;
  world.time = world.step * SIM.DT_MS; // from the step count, so no float drift
  world.bus.step = world.step;
  const s = world.systems;
  for (let i = 0; i < PIPELINE.length; i++) {
    const sys = s[PIPELINE[i][0]];
    const fn = sys[PIPELINE[i][1]];
    if (fn) fn.call(sys, world, input);
  }
}

/**
 * The only way to change world.phase. Emits PHASE (a = new code, b = old code).
 * @param {import('./types.js').World} world
 * @param {import('./types.js').Phase} phase
 */
export function setPhase(world, phase) {
  if (world.phase === phase) return;
  if (!(phase in PHASE_CODE)) throw new Error(`setPhase: unknown phase "${phase}"`);
  const old = world.phase;
  world.phase = phase;
  world.phaseMs = world.time;
  emit(world.bus, EV.PHASE, 0, 0, 0, PHASE_CODE[phase], PHASE_CODE[old]);
}

/** Live balls count (helper used by several systems). */
export function liveBalls(world) {
  let n = 0;
  for (let i = 0; i < world.balls.length; i++) if (world.balls[i].alive) n++;
  return n;
}
