// Kiln: helpers every boss script shares (OWNER: B). Pure maths on the brick store; no DOM, no
// clock, no randomness.

import { BF, BRICK, SRC } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { emit } from '../../core/bus.js';
import { CONTENT } from '../bricks.js';

/** Plate size for rotating armour (square so the ring stays sealed at every angle). */
export const PLATE = 30;

/**
 * Lay out a sealed ring of square plates. `slots` evenly spaced positions around the circle
 * (spacing must be ≤ PLATE so no gap ever opens between two plates at any rotation); the slots
 * listed in `gaps` stay empty. Plates reuse the given brick slots first (the B cells drawn in the
 * level rows), then new slots; leftover reused slots are removed silently.
 * @param {import('../../core/types.js').World} world
 * @param {object} ctx  content helpers (allocBrick)
 * @param {number[]} reuse  brick indices free to become plates
 * @param {{cx:number, cy:number, r:number, slots:number, gaps:number[], group:number, omega:number, theta0?:number}} o
 * @returns {{ids:Int16Array, base:Float32Array, cx:number, cy:number, r:number, theta:number, omega:number, group:number}}
 */
export function buildRing(world, ctx, reuse, o) {
  const B = world.bricks;
  const step = (2 * Math.PI) / o.slots;
  if (step * o.r > PLATE + 1e-6) throw new Error(`ring r ${o.r} with ${o.slots} slots leaves gaps between plates`);
  const ids = [];
  const base = [];
  for (let k = 0; k < o.slots; k++) {
    if (o.gaps.includes(k)) continue;
    const i = reuse.length ? reuse.shift() : ctx.allocBrick();
    if (i < 0) break;
    B.alive[i] = 1;
    B.type[i] = BRICK.BOSS;
    B.flags[i] = BF.SOLID | BF.BOSS | BF.MOVING;
    B.hp[i] = B.hpMax[i] = 0;
    B.tier[i] = 0;
    B.w[i] = B.h[i] = PLATE;
    B.link[i] = -1;
    B.drop[i] = -1;
    B.group[i] = o.group;
    B.hitMs[i] = -1e9;
    ids.push(i);
    base.push(k * step);
  }
  const ring = {
    ids: Int16Array.from(ids),
    base: Float32Array.from(base),
    cx: o.cx,
    cy: o.cy,
    r: o.r,
    theta: o.theta0 || 0, // a starting turn (the model part turns with it, so its cuts stay true)
    omega: o.omega,
    group: o.group,
  };
  placeRing(world, ring);
  for (const i of ring.ids) {
    B.px[i] = B.x[i];
    B.py[i] = B.y[i];
  }
  B.version++;
  return ring;
}

/** Put every plate of a ring at its angle (theta added). */
export function placeRing(world, ring) {
  const B = world.bricks;
  for (let k = 0; k < ring.ids.length; k++) {
    const i = ring.ids[k];
    const a = ring.base[k] + ring.theta;
    B.x[i] = ring.cx + Math.cos(a) * ring.r;
    B.y[i] = ring.cy + Math.sin(a) * ring.r;
  }
}

/** Bearing of the middle of a ring's gap (field coordinates), given its empty slots. */
export function gapBearing(ring, slots, gaps) {
  const step = (2 * Math.PI) / slots;
  let sx = 0, sy = 0;
  for (const k of gaps) {
    sx += Math.cos(k * step);
    sy += Math.sin(k * step);
  }
  return Math.atan2(sy, sx) + ring.theta;
}

/** Brick indices of a type / flag in the store (init time only). */
export function indicesWhere(world, pred) {
  const B = world.bricks;
  const out = [];
  for (let i = 0; i < B.count; i++) if (B.alive[i] && pred(i, B)) out.push(i);
  return out;
}

/**
 * Fuse a boss's weak-point cells into one brick when they fill a rectangle (the 2 x 2 or 1 x 2 'W'
 * block): the core is one body with no seams inside it, so a ball cannot catch on an inner
 * corner. The first cell grows to the block; the others leave the store. Init time only.
 * @returns {number[]} the weak-point bricks left
 */
export function fuseCells(world, ids) {
  if (ids.length < 2) return ids;
  const B = world.bricks;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, area = 0;
  for (const i of ids) {
    x0 = Math.min(x0, B.x[i] - B.w[i] / 2);
    x1 = Math.max(x1, B.x[i] + B.w[i] / 2);
    y0 = Math.min(y0, B.y[i] - B.h[i] / 2);
    y1 = Math.max(y1, B.y[i] + B.h[i] / 2);
    area += B.w[i] * B.h[i];
  }
  if (Math.abs(area - (x1 - x0) * (y1 - y0)) > 1) return ids; // not one solid block
  const k = ids[0];
  B.x[k] = B.px[k] = (x0 + x1) / 2;
  B.y[k] = B.py[k] = (y0 + y1) / 2;
  B.w[k] = x1 - x0;
  B.h[k] = y1 - y0;
  for (let n = 1; n < ids.length; n++) B.alive[ids[n]] = 0;
  B.version++;
  return [k];
}

/** Centre of a set of bricks. */
export function centreOf(world, ids) {
  const B = world.bricks;
  let x = 0, y = 0;
  for (const i of ids) {
    x += B.x[i];
    y += B.y[i];
  }
  return { x: x / Math.max(1, ids.length), y: y / Math.max(1, ids.length) };
}

/** The core rules a boss was reset with (cooldown, counted hits per entry, guard time). */
export function coreRules(boss) {
  return boss?.data?.rules || DEFAULT_RULES;
}

const DEFAULT_RULES = Object.freeze({
  cooldownMs: CONTENT.CORE_COOLDOWN_MS, entryHits: CONTENT.ENTRY_HITS, guardMs: CONTENT.GUARD_MS,
});

/**
 * A weak point took a hit: cooldown, the per-entry cap, hp, BOSS_HIT, remaining. Returns true if
 * it counted. After rules.entryHits counted hits the core cools (boss.data.guard = 1,
 * BOSS_GUARD a = 1) and ignores hits until every ball has left the boss or rules.guardMs has
 * passed (endEntry): a trip inside scores a few hits, then a few more at most every guardMs,
 * never a rattle that takes the whole bar. A contact that does not count emits BOSS_BLOCKED.
 * Rules default to CONTENT (The Stoker); the rotating bosses pass their own (orbit.js).
 * @param {import('../../core/types.js').World} world
 */
export function hitCore(world, ctx, i) {
  const boss = world.boss;
  const d = boss.data;
  const B = world.bricks;
  const rules = coreRules(boss);
  if (boss.hp <= 0) return false;
  if (d.guard || world.time - d.lastCoreMs < rules.cooldownMs) {
    // a contact that does not count says so (C draws a dull puff, E a dull knock), so a cooled
    // core never looks like a normal hit with a bar that does not move
    emit(world.bus, EV.BOSS_BLOCKED, i, B.x[i], B.y[i], d.guard ? 1 : 0);
    return false;
  }
  d.lastCoreMs = world.time;
  boss.hp--;
  B.hitMs[i] = world.time;
  B.version++;
  emit(world.bus, EV.BOSS_HIT, i, B.x[i], B.y[i], boss.hp, boss.hpMax);
  if (++d.entryHits >= rules.entryHits && boss.hp > 0) {
    d.guard = 1;
    d.guardId = i;
    d.guardAt = world.time;
    emit(world.bus, EV.BOSS_GUARD, i, B.x[i], B.y[i], 1);
  }
  ctx.setRemaining(boss.hp);
  return true;
}

/**
 * Call every step with whether any ball is inside the boss (the head, the outer ring). Once none
 * is, the entry is over: the count restarts and a cooled core takes hits again (BOSS_GUARD a = 0).
 * A core cooled for rules.guardMs warms again with a ball still inside (a new count).
 */
export function endEntry(world, anyInside) {
  const d = world.boss.data;
  if (anyInside && !(d.guard && world.time - d.guardAt >= coreRules(world.boss).guardMs)) return;
  d.entryHits = 0;
  if (d.guard) {
    d.guard = 0;
    const B = world.bricks, i = d.guardId;
    B.version++;
    if (i >= 0 && B.alive[i]) emit(world.bus, EV.BOSS_GUARD, i, B.x[i], B.y[i], 0);
  }
}

/** True if any live ball's centre is within `r` of (cx, cy). Reads the balls, never writes them. */
export function ballWithin(world, cx, cy, r) {
  const balls = world.balls;
  for (let k = 0; k < balls.length; k++) {
    const b = balls[k];
    if (!b.alive) continue;
    const dx = b.x - cx, dy = b.y - cy;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

/** Start the defeat (or stage-clear) cascade: every boss brick breaks in index order over `ms`. */
export function startCascade(world, ctx, ms, finalStage, stage) {
  const boss = world.boss;
  const d = boss.data;
  d.dying = true;
  d.dieStart = world.time;
  d.dieMs = ms;
  if (finalStage) emit(world.bus, EV.BOSS_DEFEATED, 0, boss.x, boss.y);
  else emit(world.bus, EV.STAGE_CLEARED, 0, boss.x, boss.y, stage);
  ctx.setRemaining(0);
}

/** Advance the cascade; call from move. */
export function stepCascade(world, ctx) {
  const d = world.boss.data;
  if (!d.dying) return;
  const B = world.bricks;
  const f = Math.min(1, (world.time - d.dieStart) / d.dieMs);
  let total = 0;
  for (let i = 0; i < B.count; i++) if (B.flags[i] & BF.BOSS) total++;
  let k = 0;
  for (let i = 0; i < B.count; i++) {
    if (!(B.flags[i] & BF.BOSS)) continue;
    if (B.alive[i] && k < f * total) ctx.breakBrick(i, SRC.BOSS, -1);
    k++;
  }
  if (f >= 1) {
    d.dying = false;
    world.boss.active = false;
  }
}

/** Fill world.boss for a fresh fight. `rules` overrides the CONTENT core rules for this boss. */
export function resetBoss(world, id, hp, x, y, rules = DEFAULT_RULES) {
  const b = world.boss;
  b.active = true;
  b.id = id;
  b.phase = 1;
  b.hp = b.hpMax = hp;
  b.x = b.px = x;
  b.y = b.py = y;
  b.angle = b.pangle = 0;
  b.open = 0;
  b.state = 0;
  b.t = 0;
  b.data = { lastCoreMs: -1e9, dying: false, dieStart: 0, dieMs: 0, attackAcc: 0, phaseAt: 0, entryHits: 0, guard: 0, guardId: -1, guardAt: 0, rules };
}

/** Aim a hazard from (x, y) at the paddle with speed s; rotate by `spread` radians. */
export function aimAtPaddle(world, x, y, s, spread, out) {
  const dx = world.paddle.x - x, dy = world.paddle.y - y;
  const a = Math.atan2(dy, dx) + spread;
  out.x = Math.cos(a) * s;
  out.y = Math.sin(a) * s;
  return out;
}
