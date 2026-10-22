// Kiln — the physics system (OWNER: A): paddle, balls, lasers, embers, drops, hazards, collision,
// catches, losses, the last-brick ceremony, anti-loop and phase changes.
//
// Pipeline slots (src/core/world.js):
//   pre(world, input)  - paddle from input (1:1), serve/launch/release, lasers fired, Pull flag,
//                        a late perfect hit (action pressed just after a contact)
//   move(world, input) - integrate and collide every moving body; emit hits, catches, losses
//   post(world, input) - ceremony slow-mo (world.timeScale), near miss, anti-loop, aim line, phases
// World API installed here: spawnBall, splitBalls, serve, spawnEmbers, spawnDrop, spawnHazard.
//
// Module map: field.js (mode geometry) · ceiling.js (the ceiling and far wall, world.field) ·
// collide.js (swept primitives, brick grid) · paddle.js (steering, bounce rule) · ball.js (one
// ball through one step) · bodies.js (embers, drops, hazards, lasers) · feel.js (anti-loop,
// ceremony, near miss, aim line) · robot.js (the player).

import { SIM, SPEED, PERFECT, POOL, BALL, PHYS, BF } from '../core/constants.js';
import { EV } from '../core/events.js';
import { emit, createReader, next } from '../core/bus.js';
import { setPhase, liveBalls } from '../core/world.js';
import { createBrickGrid, rebuildGrid } from './collide.js';
import { modeCode, paddleTrack, halfReach, fromLocal, normalAt, RING_FACE, M_BOTTOM, M_LEFT } from './field.js';
import {
  bounceDir, spinSign, velNormOf, createPaddleState, updatePaddle, resetPaddleHistory,
} from './paddle.js';
import { moveBall, steerBall, targetSpeed, setVel, ballLost, IGN, pushSig } from './ball.js';
import {
  spawnEmbers, spawnDrop, spawnHazard, fireLasers, stepEmbers, stepDrops, stepHazards, stepLasers,
} from './bodies.js';
import { antiLoop, levelEnd, nearMiss, topSlow, aimLine, tickSlowmo, resetFx } from './feel.js';
import { computeField } from './ceiling.js';

const DEG = Math.PI / 180;

/**
 * Everything physics keeps per world besides world state: scratch vectors, the brick grid and
 * per-ball bookkeeping. Created once per world; nothing here is allocated during a step.
 * @param {import('../core/types.js').World} world
 */
export function createCtx(world) {
  const nb = world.balls.length;
  return {
    world,
    mc: modeCode(world.level.mode),
    grid: createBrickGrid(POOL.BRICKS),
    list: new Int16Array(POOL.BRICKS),
    list2: new Int16Array(64),
    hits: {
      n: 0,
      idx: new Int16Array(16),
      t: new Float64Array(16),
      nx: new Float64Array(16),
      ny: new Float64Array(16),
      rx: new Float64Array(16),   // the true contact normals (nx/ny may be seam-flattened)
      ry: new Float64Array(16),
      corner: new Int8Array(16),
    },
    stepHit: new Int16Array(16),  // bricks the ball in hand has hit this step (one BRICK_HIT each)
    stepHitN: 0,
    skip: new Int16Array(8),      // bricks it leaves alone for the rest of this step
    skipN: 0,
    qx: 0.5,                      // a point handed to neighbourAt (ball.js)
    qy: 0.5,
    hit: { nx: 0, ny: 0, corner: -1 },
    v: { x: 0, y: 0 },
    p1: { x: 0, y: 0 },
    p2: { x: 0, y: 0 },
    p3: { x: 0, y: 0 },
    loc: { u: 0, v: 0 },
    pad: { t: 0.5, u: 0.5, body: 0, cx: 0.5, cy: 0.5 },
    sdx: 0.5,         // displacement handed to sweepPaddle (ball.js)
    sdy: 0.5,
    cross: { s: 0, t: 0, x: 0, y: 0 },
    // per ball
    ign: new Int16Array(nb * IGN),
    ignN: new Uint8Array(nb),
    spin0: new Float64Array(nb),
    caught: new Uint8Array(nb),
    caughtAt: new Float64Array(nb),
    perfected: new Uint8Array(nb),
    progressMs: new Float64Array(nb),
    boostEnd: new Float64Array(nb),   // sim ms when the perfect-hit boost ends (ball.boostMs = what is left)
    portalEnd: new Float64Array(nb),  // sim ms when the portal cooldown ends
    sig: new Int32Array(nb * 8),
    sigN: new Uint8Array(nb),
    portalTrips: new Uint8Array(nb),  // portal trips since the ball last hit something breakable
    nearGap: new Float64Array(nb).fill(1e9),
    nearArmed: new Uint8Array(nb).fill(1),
    topArmed: new Uint8Array(nb).fill(1), // top-speed slow-time not yet spent on this approach
    // speed
    tiers: SPEED.TIERS,
    cap: SPEED.CAP,
    lastBricksScale: 0.9,
    lastBricks: false,
    tier: 0,
    baseTier: 0,
    // step state
    prevTrack: 0,
    moveGap: 1,       // steps since the paddle's move before this one (paddle.js ps.gap)
    ringSweep: PHYS.RING_SWEEP_MAX * SIM.DT / RING_FACE, // ring catch sweep per step of gap, radians
    speed0: 0.5,
    target: 0.5,      // calcTarget's answer (ball.js)
    nX: 0.5,          // bounce normal and obstacle velocity for bounceOff (ball.js)
    nY: 0.5,
    oX: 0.5,
    oY: 0.5,
    bx: 0.5,          // body position handed to the catch and loss tests (bodies.js)
    by: 0.5,
    paddleLive: true,
    ceilY: 0.5,       // world.field.ceilingY and farX, read by ball.js and bodies.js every step
    farX: 0.5,
    shieldUsed: 0,
    usedPress: -1e9,
    slowUntil: 0,
    ceremonyEnd: 0,
    lastBreakX: 0,
    lastBreakY: 0,
    lastBreakMs: -1e9,
    lastBreakBall: -1,
    lastIdx: -1,
    onPaddle: null,
  };
}

/**
 * @returns {import('../core/types.js').System & {ctx: object}}
 */
export function createPhysics() {
  /** @type {ReturnType<typeof createCtx>} */
  let ctx = null;
  let rd = null;
  const ps = createPaddleState();

  // ---------------------------------------------------------------- per-ball state

  function resetBall(bi) {
    const b = ctx.world.balls[bi];
    b.boostMs = 0;
    b.pierce = 0;
    b.spin = 0;
    b.bouncesNoBrick = 0;
    b.lastPaddleMs = -1e9;
    b.portalCooldownMs = 0;
    b.sealed = -1;
    b.held = false;
    b.holdOffset = 0;
    b.r = ctx.world.effects.mega ? PHYS.MEGA_R : BALL.R;
    ctx.ignN[bi] = 0;
    ctx.boostEnd[bi] = 0;
    ctx.portalEnd[bi] = 0;
    ctx.spin0[bi] = 0;
    ctx.caught[bi] = 0;
    ctx.perfected[bi] = 0;
    ctx.progressMs[bi] = ctx.world.time;
    ctx.sigN[bi] = 0;
    ctx.portalTrips[bi] = 0;
    ctx.nearGap[bi] = 1e9;
    ctx.nearArmed[bi] = 1;
    ctx.topArmed[bi] = 1;
  }

  function freeSlot() {
    const balls = ctx.world.balls;
    for (let i = 0; i < balls.length; i++) if (!balls[i].alive) return i;
    return -1;
  }

  function setTierAll(t) {
    const w = ctx.world;
    ctx.tier = t;
    for (let i = 0; i < w.balls.length; i++) {
      const b = w.balls[i];
      if (!b.alive || b.tier === t) continue;
      b.tier = t;
      emit(w.bus, EV.SPEED_TIER, i, b.x, b.y, Math.min(5, t + (b.boostMs > 0 ? 1 : 0)));
    }
  }

  /** Put a held ball on the paddle face at its hold offset. */
  function placeHeld(b) {
    const w = ctx.world, p = w.paddle;
    fromLocal(ctx.mc, paddleTrack(ctx.mc, p), b.holdOffset, b.r + 0.01, ctx.p1);
    b.x = ctx.p1.x;
    b.y = ctx.p1.y;
  }

  // ---------------------------------------------------------------- world.api

  function serve() {
    const w = ctx.world;
    for (let i = 0; i < w.balls.length; i++) w.balls[i].alive = false;
    const bi = 0;
    const b = w.balls[bi];
    resetBall(bi);
    b.alive = true;
    b.held = true;
    ctx.tier = ctx.baseTier;
    b.tier = ctx.baseTier;
    w.paddle.contacts = 0;
    const reach = halfReach(ctx.mc, w.paddle);
    b.holdOffset = w.rng.physics.range(-PHYS.SERVE_OFFSET, PHYS.SERVE_OFFSET) * reach;
    b.vx = b.vy = 0;
    placeHeld(b);
    b.px = b.x;
    b.py = b.y;
    if (w.paddle.pulling) {
      w.paddle.pulling = false;
      emit(w.bus, EV.PULL_END);
    }
    resetFx(ctx);
    w.fx.aim = false;
    setPhase(w, 'serve');
    emit(w.bus, EV.SERVE, bi, b.x, b.y);
  }

  function spawnBall(x, y, vx, vy) {
    const w = ctx.world;
    const bi = freeSlot();
    if (bi < 0) return -1;
    const b = w.balls[bi];
    resetBall(bi);
    b.alive = true;
    b.tier = ctx.tier;
    // Rain and other scripted sources may start beyond the playable wall. Keep both ends of
    // the first rendered interpolation inside it, rather than waiting for moveBall to contain it.
    if (ctx.mc === M_BOTTOM) y = Math.max(y, ctx.ceilY + b.r);
    else if (ctx.mc === M_LEFT) x = Math.min(x, ctx.farX - b.r);
    b.x = b.px = x;
    b.y = b.py = y;
    if (vx === 0 && vy === 0) {
      normalAt(ctx.mc, x, y, ctx.p1); // toward the bricks
      vx = ctx.p1.x;
      vy = ctx.p1.y;
    }
    setVel(b, vx, vy, targetSpeed(ctx, b));
    if (w.phase === 'serve') setPhase(w, 'play');
    return bi;
  }

  /** Each free ball gains `extra` copies fanned 15 degrees apart. Returns balls created. */
  function splitBalls(extra) {
    const w = ctx.world;
    if (!(extra > 0)) return 0;
    let made = 0;
    const n = w.balls.length;
    // snapshot which balls split, so new balls do not split again in this call
    let mask = 0;
    for (let i = 0; i < n; i++) if (w.balls[i].alive && !w.balls[i].held) mask |= 1 << i;
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      made += splitOne(i, extra);
    }
    return made;
  }

  function splitOne(i, extra) {
    const w = ctx.world;
    const src = w.balls[i];
    let made = 0;
    for (let k = 1; k <= extra; k++) {
      const bi = freeSlot();
      if (bi < 0) break;
      const b = w.balls[bi];
      resetBall(bi);
      const ang = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * PHYS.SPLIT_DEG * DEG;
      const c = Math.cos(ang), s = Math.sin(ang);
      b.alive = true;
      b.tier = src.tier;
      b.boostMs = src.boostMs;
      ctx.boostEnd[bi] = ctx.boostEnd[i];
      ctx.portalEnd[bi] = ctx.portalEnd[i];
      b.r = src.r;
      b.x = b.px = src.x;
      b.y = b.py = src.y;
      b.vx = src.vx * c - src.vy * s;
      b.vy = src.vx * s + src.vy * c;
      b.portalCooldownMs = src.portalCooldownMs;
      made++;
    }
    return made;
  }

  // ---------------------------------------------------------------- perfect hits

  function perfect(bi, x, y) {
    const w = ctx.world, b = w.balls[bi], p = w.paddle;
    ctx.perfected[bi] = 1;
    ctx.usedPress = p.lastActionMs;
    b.boostMs = PERFECT.BOOST_MS;
    ctx.boostEnd[bi] = w.time + PERFECT.BOOST_MS;
    if (b.pierce < PERFECT.PIERCE) b.pierce = PERFECT.PIERCE;
    p.flareMs = w.time;
    w.stats.perfectHits++;
    emit(w.bus, EV.PERFECT_HIT, bi, x, y);
    emit(w.bus, EV.SPEED_TIER, bi, b.x, b.y, Math.min(5, b.tier + 1));
    const l = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (l > 0) setVel(b, b.vx, b.vy, targetSpeed(ctx, b));
    // Splitter: a perfect hit splits the ball, while fewer than 3 are alive (no runaway counts)
    if (w.effects.ballKind === 2 && liveBalls(w) < PHYS.SPLITTER_MAX) splitOne(bi, 1);
  }

  /** A paddle contact (called from ball.js with the contact in ctx.pad: u, body, cx, cy). */
  function onPaddle(bi) {
    const u = ctx.pad.u, body = ctx.pad.body, cx = ctx.pad.cx, cy = ctx.pad.cy;
    const w = ctx.world, b = w.balls[bi], p = w.paddle, mc = ctx.mc;
    const reach = halfReach(mc, p);
    const off = reach > 0 ? Math.max(-1, Math.min(1, u / reach)) : 0;
    w.stats.paddleHits++;
    b.lastPaddleMs = w.time;
    b.bouncesNoBrick = 0;
    ctx.progressMs[bi] = w.time;
    ctx.perfected[bi] = 0;
    pushSig(ctx, bi, 2000 + body, cx, cy);
    // speed tier: +1 every 6 contacts, shared by every ball in play
    p.contacts++;
    if (p.contacts >= SPEED.CONTACTS_PER_TIER) {
      p.contacts = 0;
      if (ctx.tier < 5) setTierAll(ctx.tier + 1);
    }
    if (w.effects.catchOn && body === 0) {
      b.held = true;
      b.holdOffset = Math.max(-reach, Math.min(reach, u));
      b.vx = b.vy = 0;
      b.spin = 0;
      ctx.caught[bi] = 1;
      ctx.caughtAt[bi] = w.time;
      placeHeld(b);
      emit(w.bus, EV.CATCH, bi, b.x, b.y);
      return;
    }
    const vn = body === 0 ? velNormOf(p) : 0;
    bounceDir(mc, cx, cy, off, vn, ctx.p1, ctx.p2, ctx.p3);
    b.pierce = 0;
    const early = w.time - p.lastActionMs <= PERFECT.WINDOW_MS && p.lastActionMs !== ctx.usedPress;
    b.spin = vn * spinSign(mc);
    ctx.spin0[bi] = b.spin;
    setVel(b, ctx.p3.x, ctx.p3.y, targetSpeed(ctx, b));
    if (early) perfect(bi, cx, cy);
    if (w.effects.pierceFirst > 0 && b.pierce < w.effects.pierceFirst) b.pierce = w.effects.pierceFirst;
    emit(w.bus, EV.PADDLE_HIT, bi, cx, cy, off, early ? 1 : 0, Math.min(5, b.tier + (b.boostMs > 0 ? 1 : 0)));
  }

  /** Launch (serve) or release (catch) a held ball along the paddle bounce rule. */
  function launch(bi) {
    const w = ctx.world, b = w.balls[bi], p = w.paddle, mc = ctx.mc;
    const reach = halfReach(mc, p);
    const off = reach > 0 ? Math.max(-1, Math.min(1, b.holdOffset / reach)) : 0;
    fromLocal(mc, paddleTrack(mc, p), b.holdOffset, 0, ctx.p1);
    const cx = ctx.p1.x, cy = ctx.p1.y;
    const vn = velNormOf(p);
    bounceDir(mc, cx, cy, off, vn, ctx.p1, ctx.p2, ctx.p3);
    b.held = false;
    b.spin = vn * spinSign(mc);
    ctx.spin0[bi] = b.spin;
    ctx.progressMs[bi] = w.time;
    setVel(b, ctx.p3.x, ctx.p3.y, targetSpeed(ctx, b));
    if (ctx.caught[bi]) {
      ctx.caught[bi] = 0;
      emit(w.bus, EV.RELEASE, bi, b.x, b.y, b.vx, b.vy);
    } else {
      if (w.effects.pierceFirst > 0) b.pierce = w.effects.pierceFirst;
      emit(w.bus, EV.LAUNCH, bi, b.x, b.y, b.vx, b.vy);
    }
    if (w.phase === 'serve') setPhase(w, 'play');
  }

  // ---------------------------------------------------------------- the system

  return {
    name: 'physics',
    get ctx() {
      return ctx;
    },

    init(world) {
      ctx = createCtx(world);
      ctx.onPaddle = onPaddle;
      computeField(world); // the ceiling, from the bricks content.init just laid out
      ctx.ceilY = world.field.ceilingY;
      ctx.farX = world.field.farX;
      ctx.baseTier = Math.max(0, Math.min(5, world.level.def.tier | 0));
      ctx.tier = ctx.baseTier;
      rd = createReader(world.bus, 'physics', world.bus.head);
      world.api.serve = serve;
      world.api.spawnBall = spawnBall;
      world.api.splitBalls = splitBalls;
      world.api.spawnEmbers = (x, y, n) => spawnEmbers(ctx, x, y, n);
      world.api.spawnDrop = (x, y, kind) => spawnDrop(ctx, x, y, kind);
      world.api.spawnHazard = (x, y, vx, vy, kind, r) => spawnHazard(ctx, x, y, vx, vy, kind, r);
      world.paddle.w = world.effects.paddleW > 0 ? world.effects.paddleW : world.paddle.w;
      resetPaddleHistory(world, ps);
      serve();
    },

    pre(world, input) {
      const p = world.paddle;
      p.px = p.x;
      p.py = p.y;
      if (world.phase === 'over') return;
      updatePaddle(world, input, ps);
      ctx.prevTrack = ps.prevTrack;
      ctx.moveGap = ps.gap;
      const live = world.phase === 'play' || world.phase === 'serve' || world.phase === 'clearing';
      let launched = false;
      if (input.action) {
        p.lastActionMs = world.time;
        // late perfect hit: the press came just after a contact
        for (let i = 0; i < world.balls.length; i++) {
          const b = world.balls[i];
          if (!b.alive || b.held || ctx.perfected[i]) continue;
          if (world.time - b.lastPaddleMs <= PERFECT.WINDOW_MS && ctx.usedPress !== p.lastActionMs) {
            perfect(i, b.x, b.y);
            break;
          }
        }
      }
      // held balls ride the paddle; the action launches / releases them
      for (let i = 0; i < world.balls.length; i++) {
        const b = world.balls[i];
        if (!b.alive || !b.held) continue;
        b.px = b.x;
        b.py = b.y;
        if (b.r !== (world.effects.mega ? PHYS.MEGA_R : BALL.R)) b.r = world.effects.mega ? PHYS.MEGA_R : BALL.R;
        placeHeld(b);
        const holdMs = world.effects.catchMs > 0 ? world.effects.catchMs : PHYS.CATCH_HOLD_MS;
        const auto = ctx.caught[i] && world.time - ctx.caughtAt[i] >= holdMs;
        if (live && (input.action || auto)) {
          launch(i);
          launched = true;
        }
      }
      if (input.action && !launched && world.phase === 'play' && world.effects.laserShots > 0) fireLasers(ctx);
      // Pull
      let free = false;
      for (let i = 0; i < world.balls.length; i++) {
        if (world.balls[i].alive && !world.balls[i].held) { free = true; break; }
      }
      const want = !!input.pull && world.level.rules.pull && world.econ.heat > 0 &&
        world.phase === 'play' && free;
      if (want !== p.pulling) {
        p.pulling = want;
        if (want) {
          let near = -1, nd = Infinity;
          for (let i = 0; i < world.balls.length; i++) {
            const b = world.balls[i];
            if (!b.alive || b.held) continue;
            const d = (b.x - p.x) * (b.x - p.x) + (b.y - p.y) * (b.y - p.y);
            if (d < nd) { nd = d; near = i; }
          }
          emit(world.bus, EV.PULL_START, near, p.x, p.y);
        } else emit(world.bus, EV.PULL_END, 0, p.x, p.y);
      }
    },

    move(world) {
      if (world.phase === 'over') return;
      rebuildGrid(ctx.grid, world.bricks);
      const rules = world.level.rules;
      ctx.lastBricks = rules.aimAt > 0 && world.level.remaining > 0 && world.level.remaining <= rules.aimAt &&
        world.level.kind !== 'boss';
      ctx.paddleLive = true;
      ctx.shieldUsed = 0;
      const megaR = world.effects.mega ? PHYS.MEGA_R : BALL.R;
      let lost = false;
      for (let i = 0; i < world.balls.length; i++) {
        const b = world.balls[i];
        if (!b.alive || b.held) continue;
        b.px = b.x;
        b.py = b.y;
        b.r = megaR;
        if (b.boostMs > 0) {
          // counted to an end time in sim ms, so 1.5 s is exactly 180 steps (no drift)
          const left = ctx.boostEnd[i] - world.time;
          if (left > 1e-6) b.boostMs = left;
          else {
            b.boostMs = 0;
            emit(world.bus, EV.SPEED_TIER, i, b.x, b.y, b.tier);
          }
        }
        steerBall(ctx, i);
        moveBall(ctx, i);
        if (ballLost(ctx, b)) {
          b.alive = false;
          world.stats.ballsLost++;
          emit(world.bus, EV.BALL_LOST, i, b.x, b.y);
          lost = true;
        }
      }
      if (lost && liveBalls(world) === 0 && (world.phase === 'play' || world.phase === 'serve')) {
        emit(world.bus, EV.OUT_OF_BALLS);
      }
      stepEmbers(ctx);
      stepDrops(ctx);
      stepHazards(ctx);
      stepLasers(ctx);
    },

    post(world) {
      while (next(rd)) {
        if (rd.type === EV.BRICK_BROKEN) {
          if (world.bricks.flags[rd.id] & BF.CLEARABLE || world.bricks.flags[rd.id] & BF.WEAK) {
            ctx.lastBreakX = rd.x;
            ctx.lastBreakY = rd.y;
            ctx.lastBreakMs = world.time;
            ctx.lastBreakBall = rd.c | 0;
          }
        } else if (rd.type === EV.BOSS_DEFEATED) {
          ctx.lastBreakX = rd.x;
          ctx.lastBreakY = rd.y;
          ctx.lastBreakMs = world.time;
        }
      }
      if (world.phase === 'over') {
        if (world.timeScale !== 1 || world.fx.zoom !== 1) resetFx(ctx);
        world.fx.aim = false;
        return;
      }
      tickSlowmo(ctx);
      levelEnd(ctx);
      if (world.phase === 'play') {
        antiLoop(ctx);
        nearMiss(ctx);
        topSlow(ctx);
      }
      aimLine(ctx);
    },
  };
}
