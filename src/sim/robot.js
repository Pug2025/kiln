// Kiln — the robot player (OWNER: A). A Controller: fills the same InputFrame the real input
// module fills, from the world state only (no DOM, no clock, never writes the world). It must
// clear all 30 levels in Node within 6 sim minutes each with at most 3 nudges (CP2, PLAN §10).
//
// How it plays (a perfect player with a believable hand):
// - The paddle moves at most `maxSpeed` u/s along its track (a quick mouse, not a teleport).
// - For the ball that will reach the paddle first it predicts the crossing point (walls folded,
//   bricks re-checked every step), then picks the hit offset and paddle velocity whose outgoing
//   line reaches the best brick: weak points first, then whatever breaks soonest. It arrives a
//   step early so the shot leaves exactly as planned, and taps the action on contact (perfect hit).
// - With time to spare it catches good drops and embers, steps away from bad drops and hazards.
// - Pull: when a ball keeps bouncing without breaking anything, it pulls it home.
// - Overloads: fired when HEAT allows. Serves and caught balls launch toward the best target.

import { SIM, PADDLE, BF, DROP_FAMILY, RING, PERFECT, FIELD, SPEED, SPIN } from '../core/constants.js';
import { createBrickGrid, rebuildGrid } from './collide.js';
import {
  M_RING, M_LEFT, modeCode, paddleTrack, halfReach, angleDiff, trackPoint, toLocal, RING_FACE, clampTrack,
} from './field.js';
import { bounceDir, VEL_REF, spinSign } from './paddle.js';
import { predictCrossing } from './feel.js';
import { createCaster, castPath, inherit, createMotion, updateMotion } from './aim.js';

const OFFSETS = [-0.85, -0.75, -0.65, -0.55, -0.45, -0.35, -0.25, -0.15, -0.05, 0.05, 0.15, 0.25, 0.35,
  0.45, 0.55, 0.65, 0.75, 0.85];
const VELS = [0, -1, 1];
const OFFSETS_FINE = [];
for (let o = -0.9; o <= 0.9001; o += 0.05) OFFSETS_FINE.push(Math.round(o * 100) / 100);
const VELS_FINE = [0, -0.5, 0.5, -1, 1];
/** Scores at or above this reach something breakable (or a sentry). */
const HIT_FLOOR = 1000;
/** Dead bounces in a row before the robot stands under a way home and Pulls. */
const RESCUE_BOUNCES = 4;

/**
 * @param {{maxSpeed?:number, perfect?:boolean, pickups?:boolean, offset?:number}} [opts]
 * @returns {import('../core/types.js').Controller & {debug: object}}
 */
export function createRobot(opts = {}) {
  const maxSpeed = opts.maxSpeed ?? 2400;
  const usePerfect = opts.perfect ?? true;
  const usePickups = opts.pickups ?? true;
  const useRescue = opts.rescue ?? true;
  let grid = null, caster = null, caster2 = null, gridWorld = null, gridVersion = -1;
  const motion = createMotion();
  const cross = { s: 0, t: 0, x: 0, y: 0 };
  const n = { x: 0, y: 0 }, tg = { x: 0, y: 0 }, out = { x: 0, y: 0 }, pt = { x: 0, y: 0 };
  const loc = { u: 0, v: 0 };
  // the current plan
  const plan = { ball: -1, s: 0, off: 0, vel: 0, score: 0, at: -1 };
  let pulling = false;
  let rescue = false;
  const escape = { ball: -1, s: NaN, at: -1e9 };
  let overloadAt = -1e9;
  let launchStep = -10; // the last step the robot moved a held ball for a velocity launch

  /**
   * Track coordinate where the paddle gives a rattling ball a clear way home (the straight line
   * from the ball to the paddle centre comes back with few bounces), or NaN.
   */
  function escapeTrack(world, mc, b, cur) {
    let best = -Infinity, bs = NaN;
    const N = mc === M_RING ? 24 : 16;
    for (let k = 0; k < N; k++) {
      let t;
      if (mc === M_RING) t = -Math.PI + (k + 0.5) * (2 * Math.PI / N);
      else {
        const lim = mc === M_LEFT ? FIELD.H : FIELD.W, half = world.paddle.w / 2;
        t = half + (k / (N - 1)) * (lim - 2 * half);
      }
      trackPoint(mc, t, pt);
      let dx = pt.x - b.x, dy = pt.y - b.y;
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= l;
      dy /= l;
      caster.spin = 0;
      caster.decay = 0;
      caster.t0 = 0;
      caster.speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      castPath(caster, world, grid, mc, b.x, b.y, dx, dy, b.r, 2, 1600);
      if (!caster.back) continue;
      const sc = -caster.bounces * 300 - caster.dist * 0.2 - trackDist(mc, t, cur) * 0.05;
      if (sc > best) { best = sc; bs = t; }
    }
    return bs;
  }
  const debug = { plans: 0, lastScore: 0, plan };

  function ensureGrid(world) {
    if (!grid || gridWorld !== world) {
      grid = createBrickGrid(world.bricks.alive.length);
      caster = createCaster(world.bricks.alive.length);
      caster2 = createCaster(world.bricks.alive.length);
      caster.motion = caster2.motion = motion;
      gridWorld = world;
      gridVersion = -1;
      plan.ball = -1;
      pulling = false;
    }
    if (gridVersion !== world.bricks.version || grid.moving) {
      rebuildGrid(grid, world.bricks);
      gridVersion = world.bricks.version;
    }
    updateMotion(motion, world, grid);
  }

  /** Speed the next shot will leave the paddle at (a perfect hit adds the boost tier), and when. */
  let shotSpeed = 500.5, shotT0 = 0.5;
  function setShot(world, b, t0) {
    const tier = Math.min(5, b.tier + (usePerfect ? 1 : 0));
    const sc = world.effects.ballSpeedScale > 0 ? world.effects.ballSpeedScale : 1;
    shotSpeed = Math.min(SPEED.CAP, SPEED.TIERS[tier] * sc);
    shotT0 = t0 > 0 ? t0 : 0;
  }

  /** Score of the shot that leaves the paddle at (cx, cy) with offset/velocity. */
  function scoreShot(world, mc, cx, cy, off, vel, r, deep) {
    bounceDir(mc, cx, cy, off, vel, n, tg, out);
    // start a little in front of the paddle face; paddle motion spins the ball and bends its path,
    // and moving boss parts are met where they will be by then
    const sx = cx + out.x * (r + 0.5), sy = cy + out.y * (r + 0.5);
    caster.spin = vel * spinSign(mc);
    caster.decay = shotSpeed * SPIN.DURATION_MS / 1000;
    caster.t0 = shotT0;
    caster.speed = shotSpeed;
    castPath(caster, world, grid, mc, sx, sy, out.x, out.y, r, deep ? 8 : 3, deep ? 6000 : 2600);
    const B = world.bricks;
    let s;
    if (caster.brick >= 0) {
      const i = caster.brick;
      s = 10000 - caster.dist - caster.bounces * 250;
      if (B.flags[i] & BF.WEAK) s += 4000;
      if (B.flags[i] & BF.EXPLOSIVE) s += 300;
      if (B.flags[i] & BF.CLEARABLE) s += 200;
      if (B.flags[i] & BF.BOSS && !(B.flags[i] & BF.WEAK)) s += 100;
      // the rebound: does it come home or find more bricks, or rattle around the armour?
      let rx = caster.vx, ry = caster.vy;
      const d = rx * caster.nx + ry * caster.ny;
      if (d < 0) { rx -= 2 * d * caster.nx; ry -= 2 * d * caster.ny; }
      inherit(caster, caster2);
      castPath(caster2, world, grid, mc, caster.x + caster.nx * 0.05, caster.y + caster.ny * 0.05, rx, ry, r,
        5, 1800, (B.hp[i] <= 1) ? i : -1);
      if (caster2.brick >= 0) s += 350 - caster2.bounces * 90;
      else if (caster2.sentry >= 0) s += 150 - caster2.bounces * 90;
      else if (caster2.back) s -= caster2.bounces * 90;
      else s -= 700; // stuck bouncing around
    } else if (caster.sentry >= 0) {
      s = 6000 - caster.dist - caster.bounces * 250;
    } else {
      s = -caster.dist * 0.1 - caster.bounces * 50;
    }
    // prefer gentle offsets a little (safety margin), and still paddles
    s -= Math.abs(off) * 40 + Math.abs(vel) * 60;
    return s;
  }

  /** Pick the best offset and velocity for a ball crossing at track coordinate s. */
  function choose(world, mc, b, s, cx, cy, forHeld, bt = 0) {
    let best = -Infinity, bo = 0, bv = 0;
    debug.plans++;
    setShot(world, b, bt);
    const rng = world.rng.robot;
    let hazardsLive = false;
    for (let i = 0; i < world.hazards.length && !hazardsLive; i++) hazardsLive = world.hazards[i].alive;
    for (let i = 0; i < world.drops.length && !hazardsLive; i++) {
      hazardsLive = world.drops[i].alive && DROP_FAMILY[world.drops[i].kind] === 'warn';
    }
    if (forHeld) {
      const reach = halfReach(mc, world.paddle);
      const off = reach > 0 ? b.holdOffset / reach : 0;
      for (let pass = 0; pass < 2 && best < HIT_FLOOR; pass++) {
        const vels = pass ? VELS_FINE : VELS;
        for (let vi = 0; vi < vels.length; vi++) {
          const sc = scoreShot(world, mc, cx, cy, off, vels[vi], b.r, pass === 1) + rng.next() * 0.5;
          if (sc > best) { best = sc; bo = off; bv = vels[vi]; }
        }
      }
    } else {
      // offsets the paddle can actually reach: its centre stays inside the field (bottom / left)
      const reach = halfReach(mc, world.paddle);
      let offLo = -1.5, offHi = 1.5;
      if (mc !== M_RING) {
        const lim = mc === M_LEFT ? FIELD.H : FIELD.W, half = world.paddle.w / 2;
        offLo = (s - (lim - half)) / reach;
        offHi = (s - half) / reach;
      }
      // a velocity shot moves the paddle on the last two steps (paddle.js measures the speed since
      // the previous move), so it needs two steps of room
      const velMargin = (2 * VEL_REF * SIM.DT + 1) / reach;
      // pass 0: coarse fan, short paths; pass 1 (only if nothing breakable was found): fine fan, long paths
      let tried = 0;
      for (let pass = 0; pass < 2 && best < HIT_FLOOR; pass++) {
        const vels = pass ? VELS_FINE : VELS;
        const offs = pass ? OFFSETS_FINE : OFFSETS;
        for (let vi = 0; vi < vels.length; vi++) {
          const m = vels[vi] ? velMargin : 0;
          for (let k = 0; k < offs.length; k++) {
            if (offs[k] < offLo + m || offs[k] > offHi - m) continue;
            tried++;
            let sc = scoreShot(world, mc, cx, cy, offs[k], vels[vi], b.r, pass === 1) + rng.next() * 0.5;
            // stand clear of bombs and bad drops landing where the paddle would wait
            if (hazardsLive && danger(world, mc, s - (offs[k] * reach) / (mc === M_RING ? RING_FACE : 1), bt + 0.3)) sc -= 5000;
            if (sc > best) { best = sc; bo = offs[k]; bv = vels[vi]; }
          }
        }
      }
      if (!tried) {
        // the ball comes down hard against a wall: the paddle goes as far as it can
        bo = Math.max(-1, Math.min(1, offLo > -1 ? offLo : offHi));
        bv = 0;
      } else if (best < HIT_FLOOR) {
        // nothing reachable: explore, never repeat the same dead shot
        for (let k = 0; k < 8; k++) {
          bo = OFFSETS_FINE[rng.int(0, OFFSETS_FINE.length - 1)];
          if (bo >= offLo && bo <= offHi) break;
        }
        bo = Math.max(offLo, Math.min(offHi, bo));
        bv = 0;
      }
    }
    plan.off = bo;
    plan.vel = bv;
    plan.score = best;
    debug.lastScore = best;
  }

  /** Move the paddle toward a track target at most maxSpeed this step. Writes frame.tx/ty. */
  function steerTo(frame, world, mc, target) {
    const p = world.paddle;
    const cur = paddleTrack(mc, p);
    const maxStep = maxSpeed * SIM.DT / (mc === M_RING ? RING.R_PADDLE : 1);
    let d = mc === M_RING ? angleDiff(target, cur) : target - cur;
    if (d > maxStep) d = maxStep;
    if (d < -maxStep) d = -maxStep;
    const t = clampTrack(mc, cur + d, p.w / 2);
    trackPoint(mc, t, pt);
    frame.steer = true;
    frame.tx = pt.x;
    frame.ty = pt.y;
    if (mc === M_RING) {
      // aim the pointer well outside the centre so the bearing is exact
      frame.tx = RING.CX + Math.cos(t) * RING.R_PADDLE;
      frame.ty = RING.CY + Math.sin(t) * RING.R_PADDLE;
    }
  }

  /** Track distance from the paddle to a track coordinate (field units). */
  function trackDist(mc, a, b) {
    return mc === M_RING ? Math.abs(angleDiff(a, b)) * RING.R_PADDLE : Math.abs(a - b);
  }

  /** The best pickup to go for: earliest good drop or ember that reaches the paddle side in time. */
  function pickupTarget(world, mc, cur, limitT) {
    let bestS = NaN, bestT = Infinity, bestW = 0;
    for (let i = 0; i < world.drops.length; i++) {
      const d = world.drops[i];
      if (!d.alive) continue;
      const fam = DROP_FAMILY[d.kind];
      if (fam === 'warn') continue;
      const t = bodyArrival(world, mc, d.x, d.y, d.vx, d.vy, 11);
      if (t < 0 || t > limitT) continue;
      const s = trackOfPoint(mc, d.x, d.y, d.vx, d.vy, t);
      const need = trackDist(mc, s, cur) / maxSpeed;
      if (need > t + 0.02) continue;
      const w = 3;
      if (w > bestW || (w === bestW && t < bestT)) { bestW = w; bestT = t; bestS = s; }
    }
    if (bestW === 0) {
      const E = world.embers;
      for (let i = 0; i < E.count; i++) {
        if (!E.alive[i]) continue;
        const t = bodyArrival(world, mc, E.x[i], E.y[i], E.vx[i], E.vy[i], 3);
        if (t < 0 || t > limitT) continue;
        const s = trackOfPoint(mc, E.x[i], E.y[i], E.vx[i], E.vy[i], t);
        const need = trackDist(mc, s, cur) / maxSpeed;
        if (need > t + 0.02) continue;
        if (t < bestT) { bestT = t; bestS = s; bestW = 1; }
      }
    }
    return bestS;
  }

  /** Seconds until a body moving at (vx, vy) reaches the paddle face, or -1. */
  function bodyArrival(world, mc, x, y, vx, vy, half) {
    toLocal(mc, paddleTrack(mc, world.paddle), x, y, loc);
    const v = loc.v - half;
    let speedIn;
    if (mc === M_RING) speedIn = Math.sqrt(vx * vx + vy * vy); // radially outward
    else if (mc === 0) speedIn = vy;
    else speedIn = -vx;
    if (speedIn <= 0) return -1;
    if (v < -PADDLE.H) return -1;
    return Math.max(0, v) / speedIn;
  }

  function trackOfPoint(mc, x, y, vx, vy, t) {
    const fx = x + vx * t, fy = y + vy * t;
    if (mc === M_RING) return Math.atan2(fy - RING.CY, fx - RING.CX);
    return mc === 0 ? fx : fy;
  }

  /** Is a bad body (warn drop or hazard) about to land on the paddle at track coordinate s? */
  function danger(world, mc, s, withinT) {
    const p = world.paddle;
    const reach = halfReach(mc, p);
    for (let i = 0; i < world.hazards.length; i++) {
      const h = world.hazards[i];
      if (!h.alive) continue;
      const t = bodyArrival(world, mc, h.x, h.y, h.vx, h.vy, h.r);
      if (t < 0 || t > withinT) continue;
      const hs = trackOfPoint(mc, h.x, h.y, h.vx, h.vy, t);
      if (trackDist(mc, hs, s) * (mc === M_RING ? RING_FACE / RING.R_PADDLE : 1) <= reach + h.r + 6) return true;
    }
    for (let i = 0; i < world.drops.length; i++) {
      const d = world.drops[i];
      if (!d.alive || DROP_FAMILY[d.kind] !== 'warn') continue;
      const t = bodyArrival(world, mc, d.x, d.y, d.vx, d.vy, 11);
      if (t < 0 || t > withinT) continue;
      const ds = trackOfPoint(mc, d.x, d.y, d.vx, d.vy, t);
      if (trackDist(mc, ds, s) <= reach + 30) return true;
    }
    return false;
  }

  return {
    debug,
    fill(frame, world) {
      frame.action = false;
      frame.overload = false;
      frame.pull = false;
      frame.axis = 0;
      rescue = false;
      frame.fast = false;
      if (world.phase === 'over' || world.phase === 'cleared') {
        frame.steer = false;
        return;
      }
      ensureGrid(world);
      const mc = modeCode(world.level.mode);
      const p = world.paddle;
      const cur = paddleTrack(mc, p);
      const reach = halfReach(mc, p);
      const scale = mc === M_RING ? RING_FACE : 1;

      // 1. the ball that reaches the paddle first
      let bi = -1, bt = Infinity, held = -1;
      for (let i = 0; i < world.balls.length; i++) {
        const b = world.balls[i];
        if (!b.alive) continue;
        if (b.held) { if (held < 0) held = i; continue; }
        if (predictCrossing(mc, b, cross) && cross.t < bt) { bt = cross.t; bi = i; }
      }

      // 2. a held ball (serve or catch) with nothing else coming: aim it and launch
      if (held >= 0 && (bi < 0 || bt > 0.6)) {
        const b = world.balls[held];
        if (plan.ball !== 100 + held || plan.at !== world.step - 1) {
          choose(world, mc, b, cur, b.x, b.y, true);
          plan.ball = 100 + held;
        }
        plan.at = world.step;
        // launch with the chosen paddle velocity: move vel * VEL_REF a step for two steps and press
        // on the second (paddle.js reads the speed since the previous move)
        const d = plan.vel * VEL_REF * SIM.DT / (mc === M_RING ? RING.R_PADDLE : 1);
        steerTo(frame, world, mc, cur + d);
        const ready = plan.vel === 0 || launchStep === world.step - 1;
        frame.action = ready && world.time - p.lastActionMs > 120;
        launchStep = world.step;
        return;
      }

      // 3. a ball is coming: plan the shot and be there a step early
      if (bi >= 0) {
        const b = world.balls[bi];
        predictCrossing(mc, b, cross);
        const s = cross.s;
        const moved = plan.ball !== bi || Math.abs((mc === M_RING ? angleDiff(s, plan.s) : s - plan.s) * scale) > 1.5;
        if (moved || world.step - plan.at > 30) {
          choose(world, mc, b, s, cross.x, cross.y, false, bt);
          plan.ball = bi;
          plan.s = s;
        }
        plan.at = world.step;
        // paddle centre so that the ball meets it at the chosen offset
        let target = s - (plan.off * reach) / (mc === M_RING ? RING_FACE : 1);
        const stepsLeft = bt / SIM.DT;
        const dv = plan.vel * VEL_REF * SIM.DT / (mc === M_RING ? RING.R_PADDLE : 1);
        // stand back two steps of motion and move the last two steps at the shot's speed (paddle.js
        // reads the speed since the previous move, so the contact step must follow a moving step)
        if (stepsLeft > 2) target -= 2 * dv;
        else if (stepsLeft > 1) target -= dv;
        // time to spare: go for pickups first
        const need = trackDist(mc, target, cur) / maxSpeed;
        if (usePickups && bt - need > 0.35) {
          const ps = pickupTarget(world, mc, cur, bt - need - 0.25);
          if (ps === ps) {
            const back = trackDist(mc, ps, target) / maxSpeed;
            const go = trackDist(mc, ps, cur) / maxSpeed;
            if (go + back + 0.12 < bt) target = ps;
          }
        }
        steerTo(frame, world, mc, target);
        if (usePerfect && stepsLeft <= 1) frame.action = world.time - p.lastActionMs > PERFECT.WINDOW_MS * 2;
      } else {
        // 4. nothing coming. A ball rattling around without breaking anything: stand where it has a
        //    clear way home and Pull it. Otherwise pickups, else wait under the first ball.
        let target = NaN;
        rescue = false;
        if (useRescue && world.level.rules.pull && world.econ.heat > 5 && world.phase === 'play') {
          let worst = 0, wi = -1;
          for (let i = 0; i < world.balls.length; i++) {
            const b = world.balls[i];
            if (b.alive && !b.held && b.bouncesNoBrick > worst) { worst = b.bouncesNoBrick; wi = i; }
          }
          if (worst >= RESCUE_BOUNCES) {
            if (escape.ball !== wi || world.step - escape.at > 12) {
              escape.s = escapeTrack(world, mc, world.balls[wi], cur);
              escape.ball = wi;
              escape.at = world.step;
            }
            if (escape.s === escape.s) {
              target = escape.s;
              rescue = true;
            }
          }
        }
        if (!(target === target) && usePickups) target = pickupTarget(world, mc, cur, 3);
        if (!(target === target)) {
          let fb = -1;
          for (let i = 0; i < world.balls.length; i++) if (world.balls[i].alive && !world.balls[i].held) { fb = i; break; }
          if (fb >= 0) {
            const b = world.balls[fb];
            target = mc === M_RING ? Math.atan2(b.y - RING.CY, b.x - RING.CX) : mc === 0 ? b.x : b.y;
          } else target = cur;
        }
        if (danger(world, mc, target, 0.4)) target += (target > (mc === 0 ? 360 : 540) ? -1 : 1) * reach * 2.2 / (mc === M_RING ? RING.R_PADDLE : 1);
        steerTo(frame, world, mc, target);
      }

      // 5. Pull while rescuing, once the paddle stands where the ball has its way home
      if (rescue) {
        const dd = trackDist(mc, escape.s, paddleTrack(mc, world.paddle));
        if (dd < 30) pulling = true;
      } else pulling = false;
      frame.pull = pulling;

      // 6. Overloads when HEAT allows (not in the last few bricks: save it for a real wall)
      if (world.level.rules.overloads && world.run.overload > 0 && world.econ.heat >= world.econ.overloadCost &&
        world.level.remaining > 4 && world.time - overloadAt > 2000 && world.phase === 'play') {
        frame.overload = true;
        overloadAt = world.time;
      }
    },
  };
}
