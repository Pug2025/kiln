// Kiln: the content system (OWNER: B): bricks, bosses, sentries, level rules and timers.
//
// Pipeline slots (src/core/world.js):
//   move(world)    before collision: moving rows, march-down, scrolling, gravity falls, boss motion
//                  and attacks, sentry motion and fire, level timers, multiball rain. Every brick
//                  that moves copies x→px / y→py first (renderer interpolation, A's relative velocity).
//   resolve(world) after collision: BRICK_HIT / SENTRY_HIT / HAZARD_HIT since the last read: damage,
//                  breaks, fire splash, explosion chains, cavity release, boss and sentry reactions,
//                  Fever splits, world.level.remaining.
// World API installed here: damageBrick, breakBrick, purgeRows.
//
// Rules of thumb kept everywhere: process bricks in index order and emit in that order
// (determinism); never allocate inside move/resolve; bump bricks.version whenever a brick
// appears, breaks, changes look or starts/stops moving.

import { SIM, BF, BRICK, SRC, SPEED, BALL, DROP_NAMES, GRID, FIELD } from '../core/constants.js';
import { EV } from '../core/events.js';
import { emit, createReader, next } from '../core/bus.js';
import { liveBalls } from '../core/world.js';
import { parseLevel, SCROLL_ENTRY_Y } from '../levels/parser.js';
import { LEGEND } from '../levels/legend.js';
import { twistsFor, applyTwist } from '../levels/index.js';
import { CONTENT, hitDamage, burns } from './bricks.js';
import { createSentries } from './sentries.js';
import { createBoss } from './bosses.js';

const DT = SIM.DT;
const DT_MS = SIM.DT_MS;
const DEG = Math.PI / 180;
const MOVERS = BF.MOVING | BF.FALLING;
const DEFAULT_TABLE = Object.freeze({ wide: 3, multi: 3, slow: 2, fire: 2, laser: 1, life: 1 });

/**
 * Copy a parsed level into the world's brick store.
 * @param {import('../core/types.js').World} world
 * @param {import('../core/types.js').ParsedLevel} parsed
 */
export function loadBricks(world, parsed) {
  const B = world.bricks;
  const list = parsed.bricks;
  if (list.length > B.alive.length) throw new Error(`level ${parsed.def.n}: ${list.length} bricks > pool ${B.alive.length}`);
  B.count = list.length;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    B.alive[i] = 1;
    B.type[i] = p.type;
    B.flags[i] = p.flags;
    B.hp[i] = p.hp;
    B.hpMax[i] = p.hp;
    B.tier[i] = p.tier;
    B.x[i] = B.px[i] = p.x;
    B.y[i] = B.py[i] = p.y;
    B.w[i] = p.w;
    B.h[i] = p.h;
    B.col[i] = p.col;
    B.row[i] = p.row;
    B.link[i] = p.link;
    B.drop[i] = p.drop;
    B.group[i] = p.group;
    B.hitMs[i] = -1e9;
  }
  for (let i = list.length; i < B.alive.length; i++) B.alive[i] = 0;
  B.version++;
}

/** Count bricks that still block clearing (hidden ones included: they are still in the wall). */
export function countRemaining(world) {
  const B = world.bricks;
  let n = 0;
  for (let i = 0; i < B.count; i++) if (B.alive[i] && (B.flags[i] & BF.CLEARABLE)) n++;
  return n;
}

/** Drop weights in DROP_NAMES order from a level's table (empty table → a good default). */
export function dropWeights(table) {
  const t = table && Object.keys(table).length ? table : DEFAULT_TABLE;
  return DROP_NAMES.map((name) => Math.max(0, Number(t[name]) || 0));
}

/**
 * @returns {import('../core/types.js').System}
 */
export function createContent() {
  /** @type {import('../core/types.js').BusReader} */
  let rd;
  /** @type {import('../core/types.js').World} */
  let world;
  let def, parsed, rules, mode, grid, isBoss;
  let boss = null;
  const sentries = createSentries();
  let weights;

  const CAP = 768;
  const diedAt = new Float64Array(CAP);
  const laneOf = new Int8Array(CAP);
  const fallV = new Float32Array(CAP);
  // Explosion queue, kept sorted by due time (insertion order breaks ties).
  const qId = new Int16Array(CAP);
  const qDue = new Float64Array(CAP);
  let qLen = 0;
  // Gravity bricks and sealed balls.
  let gList = new Int16Array(0);
  let sealed = new Int16Array(0);
  let sealedNb = new Int16Array(0); // 4 neighbours per sealed ball (−1 = another sealed cell)
  let supportDirty = true;
  let cavityDirty = false;
  /** @type {{dir:number, speed:number, wrap:boolean, alongX:boolean}[]} */
  let lanes = [];
  // March-down, scrolling, timers, rain.
  let marchAcc = 0, marchShift = 0, marchFeedIdx = 0, marchFeedLeft = 0, marchEntryY = 0, marchEntryRow = 0;
  let scrollLeft = 0, scrolled = 0, scrollRows = 0, scrolling = false, revealWait = false;
  let timerStarted = false, timerDone = false, timerSec = -1;
  let rainAcc = 0, rainSign = 1, feverSign = 1;
  let bins = new Float64Array(64);

  // ---------------------------------------------------------------- bookkeeping

  function setRemaining(n) {
    if (n < 0) n = 0;
    if (n !== world.level.remaining) {
      world.level.remaining = n;
      emit(world.bus, EV.REMAINING, 0, 0, 0, n);
    }
  }

  function allocBrick() {
    const B = world.bricks;
    if (B.count < B.alive.length) return B.count++;
    for (let i = 0; i < B.count; i++) if (!B.alive[i] && diedAt[i] < world.time) return i;
    return -1;
  }

  /** Put a legend brick into slot i (march rows, boss regrowth). Emits BRICK_SPAWNED. */
  function spawnBrick(i, ch, x, y, w, h, col, row) {
    const B = world.bricks;
    const e = LEGEND[ch];
    B.alive[i] = 1;
    B.type[i] = e.type;
    B.flags[i] = isBoss ? e.flags & ~BF.CLEARABLE : e.flags;
    B.hp[i] = B.hpMax[i] = e.hp;
    B.tier[i] = e.tier;
    B.x[i] = B.px[i] = x;
    B.y[i] = B.py[i] = y;
    B.w[i] = w;
    B.h[i] = h;
    B.col[i] = col;
    B.row[i] = row;
    B.link[i] = -1;
    B.drop[i] = e.type === BRICK.CARRIER ? world.rng.content.weighted(weights) : -1;
    B.group[i] = -1;
    B.hitMs[i] = -1e9;
    laneOf[i] = -1;
    fallV[i] = 0;
    B.version++;
    if (B.flags[i] & BF.CLEARABLE) {
      world.level.total++;
      setRemaining(world.level.remaining + 1);
    }
    emit(world.bus, EV.BRICK_SPAWNED, i, x, y, e.type);
  }

  function breakBrick(i, src, ball) {
    const B = world.bricks;
    if (i < 0 || i >= B.count || !B.alive[i]) return;
    B.alive[i] = 0;
    B.hp[i] = 0;
    B.flags[i] &= ~MOVERS;
    B.version++;
    diedAt[i] = world.time;
    world.stats.bricksBroken++;
    emit(world.bus, EV.BRICK_BROKEN, i, B.x[i], B.y[i], B.type[i], src, ball);
    if ((B.flags[i] & BF.CLEARABLE) && !isBoss) setRemaining(world.level.remaining - 1);
    if (B.flags[i] & BF.EXPLOSIVE) queueExplosion(i, src === SRC.EXPLOSION ? world.time + CONTENT.CHAIN_MS : world.time);
    supportDirty = true;
    if (sealed.length) cavityDirty = true;
  }

  /** Remove a brick at the danger line: no score, no embers. */
  function burnBrick(i) {
    const B = world.bricks;
    B.alive[i] = 0;
    B.hp[i] = 0;
    B.flags[i] &= ~MOVERS;
    B.version++;
    diedAt[i] = world.time;
    emit(world.bus, EV.BRICK_BURNT, i, B.x[i], B.y[i], B.type[i]);
    if ((B.flags[i] & BF.CLEARABLE) && !isBoss) setRemaining(world.level.remaining - 1);
    supportDirty = true;
    if (sealed.length) cavityDirty = true;
  }

  /** Apply raw damage to a non-boss brick. */
  function dealDamage(i, dmg, src, ball) {
    const B = world.bricks;
    if (!B.alive[i] || !(B.flags[i] & BF.BREAKABLE) || dmg <= 0) return;
    B.hitMs[i] = world.time;
    B.hp[i] -= dmg;
    if (B.hp[i] <= 0) breakBrick(i, src, ball);
    else {
      B.version++;
      emit(world.bus, EV.BRICK_DAMAGED, i, B.x[i], B.y[i], B.hp[i], src);
    }
  }

  /** A hit under the brick rules (boss bricks go to the boss script). */
  function hitBrick(i, src, ball, pierced, splash) {
    const B = world.bricks;
    if (i < 0 || i >= B.count || !B.alive[i]) return;
    const f = B.flags[i];
    if (f & (BF.PORTAL | BF.HIDDEN | BF.CAVITY_BALL)) return;
    B.hitMs[i] = world.time;
    if (f & BF.BOSS) {
      if (boss) boss.onHit(world, i, src, ball, pierced);
    } else {
      dealDamage(i, hitDamage(B.type[i], f, B.hp[i], src, pierced, world.effects), src, ball);
    }
    if (splash && burns(src, world.effects)) fireSplash(i, ball);
  }

  // ---------------------------------------------------------------- blasts and splashes

  function queueExplosion(i, due) {
    if (qLen >= CAP) return;
    let k = qLen;
    while (k > 0 && qDue[k - 1] > due) {
      qId[k] = qId[k - 1];
      qDue[k] = qDue[k - 1];
      k--;
    }
    qId[k] = i;
    qDue[k] = due;
    qLen++;
  }

  function processExplosions() {
    while (qLen > 0 && qDue[0] <= world.time + 1e-6) {
      const i = qId[0];
      for (let k = 1; k < qLen; k++) {
        qId[k - 1] = qId[k];
        qDue[k - 1] = qDue[k];
      }
      qLen--;
      explode(i);
    }
  }

  function explode(i) {
    const B = world.bricks;
    const x = B.x[i], y = B.y[i];
    const hw = B.w[i] * CONTENT.BLAST_CELLS - 0.5, hh = B.h[i] * CONTENT.BLAST_CELLS - 0.5;
    emit(world.bus, EV.EXPLOSION, i, x, y, 1);
    for (let j = 0; j < B.count; j++) {
      if (j === i || !B.alive[j] || (B.flags[j] & (BF.HIDDEN | BF.PORTAL | BF.CAVITY_BALL))) continue;
      if (Math.abs(B.x[j] - x) > hw || Math.abs(B.y[j] - y) > hh) continue;
      hitBrick(j, SRC.EXPLOSION, -1, false, false);
    }
    sentries.blast(world, x, y, hw, hh);
  }

  function fireSplash(i, ball) {
    const B = world.bricks;
    const x = B.x[i], y = B.y[i];
    const hw = B.w[i] * CONTENT.BLAST_CELLS - 0.5, hh = B.h[i] * CONTENT.BLAST_CELLS - 0.5;
    for (let j = 0; j < B.count; j++) {
      if (j === i || !B.alive[j]) continue;
      if (Math.abs(B.x[j] - x) > hw || Math.abs(B.y[j] - y) > hh) continue;
      hitBrick(j, SRC.FIRE, ball, false, false);
    }
  }

  // ---------------------------------------------------------------- moving walls

  /** Shift every non-boss brick (march-down, scrolling). Marks them MOVING. */
  function shiftWall(dy) {
    const B = world.bricks;
    let revealed = false;
    for (let i = 0; i < B.count; i++) {
      if (!B.alive[i] || (B.flags[i] & BF.BOSS)) continue;
      if (!(B.flags[i] & MOVERS)) {
        B.px[i] = B.x[i];
        B.py[i] = B.y[i];
        B.flags[i] |= BF.MOVING;
        revealed = true; // a flag changed: renderer must re-read
      }
      B.y[i] += dy;
      if ((B.flags[i] & BF.HIDDEN) && B.y[i] - B.h[i] / 2 >= SCROLL_ENTRY_Y - 0.01) { // 0.01: float steps
        if (revealBrick(i)) revealed = true;
      }
    }
    if (revealed) B.version++;
  }

  /**
   * A hidden scrolling row joins play once its top edge is on the entry line, but never around a
   * ball: the band between the ceiling and the entry line is open play space, so a ball can sit
   * where the row slides in. The brick then waits (still hidden) until the ball has left.
   */
  function revealBrick(i) {
    const B = world.bricks;
    if (ballNear(B.x[i], B.y[i], B.w[i] / 2, B.h[i] / 2)) {
      revealWait = true;
      return false;
    }
    B.flags[i] &= ~BF.HIDDEN;
    return true;
  }

  /** Rows held back by a ball join play as soon as it has gone (the wall may have stopped). */
  function revealWaiting() {
    const B = world.bricks;
    revealWait = false;
    let revealed = false;
    for (let i = 0; i < B.count; i++) {
      if (!B.alive[i] || !(B.flags[i] & BF.HIDDEN) || B.y[i] - B.h[i] / 2 < SCROLL_ENTRY_Y - 0.01) continue;
      if (revealBrick(i)) revealed = true;
    }
    if (revealed) B.version++;
  }

  /** The wall stopped: bricks that are not on a rail or falling become static again. */
  function settleWall() {
    const B = world.bricks;
    for (let i = 0; i < B.count; i++) {
      if (!B.alive[i] || (B.flags[i] & (BF.BOSS | BF.FALLING)) || laneOf[i] >= 0) continue;
      if (B.flags[i] & BF.MOVING) {
        B.flags[i] &= ~BF.MOVING;
        B.px[i] = B.x[i];
        B.py[i] = B.y[i];
      }
    }
    B.version++;
  }

  function burnAtDangerLine() {
    const B = world.bricks;
    for (let i = 0; i < B.count; i++) {
      if (!B.alive[i] || (B.flags[i] & BF.BOSS)) continue;
      if (B.y[i] + B.h[i] / 2 > CONTENT.DANGER_Y) burnBrick(i);
    }
  }

  function moveLanes() {
    const B = world.bricks;
    for (let k = 0; k < lanes.length; k++) {
      const L = lanes[k];
      let lo = 1e9, hi = -1e9, any = false;
      for (let i = 0; i < B.count; i++) {
        if (laneOf[i] !== k || !B.alive[i]) continue;
        any = true;
        const c = L.alongX ? B.x[i] : B.y[i];
        const half = (L.alongX ? B.w[i] : B.h[i]) / 2;
        if (c - half < lo) lo = c - half;
        if (c + half > hi) hi = c + half;
      }
      if (!any) continue;
      const limit = L.alongX ? FIELD.W : FIELD.H;
      let d = L.speed * L.dir * DT;
      if (!L.wrap) {
        if (lo + d < 0) { d = -lo; L.dir = 1; }
        else if (hi + d > limit) { d = limit - hi; L.dir = -1; }
      }
      for (let i = 0; i < B.count; i++) {
        if (laneOf[i] !== k || !B.alive[i]) continue;
        if (L.alongX) {
          B.x[i] += d;
          if (L.wrap) {
            const span = limit + B.w[i];
            if (B.x[i] - B.w[i] / 2 >= limit) { B.x[i] -= span; B.px[i] = B.x[i]; }
            else if (B.x[i] + B.w[i] / 2 <= 0) { B.x[i] += span; B.px[i] = B.x[i]; }
          }
        } else {
          B.y[i] += d;
          if (L.wrap) {
            const span = limit + B.h[i];
            if (B.y[i] - B.h[i] / 2 >= limit) { B.y[i] -= span; B.py[i] = B.y[i]; }
            else if (B.y[i] + B.h[i] / 2 <= 0) { B.y[i] += span; B.py[i] = B.y[i]; }
          }
        }
      }
      if (d !== 0) supportDirty = true;
    }
  }

  function marchStep() {
    const ch = grid.ch;
    if (marchShift <= 0) {
      if (world.phase !== 'play') return;
      marchAcc += DT_MS;
      if (marchAcc < rules.marchMs) return;
      marchAcc -= rules.marchMs;
      marchShift = ch;
    }
    const d = Math.min(marchShift, (ch / CONTENT.MARCH_SHIFT_MS) * 1000 * DT);
    shiftWall(d);
    marchShift -= d;
    if (marchShift > 1e-6) return;
    marchShift = 0;
    settleWall();
    burnAtDangerLine();
    if (marchFeedLeft > 0) {
      const line = rules.marchRows[marchFeedIdx % rules.marchRows.length];
      marchFeedIdx++;
      marchFeedLeft--;
      const y = marchEntryY + 0.5 * ch;
      for (let col = 0; col < grid.cols; col++) {
        const chr = line[col];
        if (!LEGEND[chr] || LEGEND[chr].type === BRICK.EMPTY) continue;
        const x = grid.x0 + (col + 0.5) * grid.cw;
        if (ballNear(x, y, grid.cw / 2, ch / 2)) continue;
        const i = allocBrick();
        if (i < 0) break;
        spawnBrick(i, chr, x, y, grid.cw, ch, col, marchEntryRow);
      }
    }
    supportDirty = true;
    emit(world.bus, EV.ROWS_ADVANCED, 0, 0, 0, 1);
  }

  function ballNear(x, y, hw, hh) {
    for (let k = 0; k < world.balls.length; k++) {
      const b = world.balls[k];
      if (!b.alive) continue;
      if (Math.abs(b.x - x) < hw + b.r && Math.abs(b.y - y) < hh + b.r) return true;
    }
    return false;
  }

  function scrollStep() {
    const B = world.bricks;
    if (revealWait) revealWaiting();
    if (scrollLeft <= 0 || world.phase === 'clearing' || world.phase === 'cleared') {
      if (scrolling) { scrolling = false; settleWall(); }
      return;
    }
    let lowest = -1e9;
    for (let i = 0; i < B.count; i++) {
      if (!B.alive[i] || (B.flags[i] & (BF.HIDDEN | BF.BOSS)) || !(B.flags[i] & BF.CLEARABLE)) continue;
      const bottom = B.y[i] + B.h[i] / 2;
      if (bottom > lowest) lowest = bottom;
    }
    if (lowest >= CONTENT.SCROLL_LINE) {
      if (scrolling) { scrolling = false; settleWall(); }
      return;
    }
    scrolling = true;
    const d = Math.min(scrollLeft, rules.scrollSpeed * DT);
    shiftWall(d);
    scrollLeft -= d;
    scrolled += d;
    world.level.scrollY = scrolled / grid.ch;
    const rows = Math.floor(scrolled / grid.ch + 1e-6);
    if (rows > scrollRows) {
      emit(world.bus, EV.ROWS_ADVANCED, 0, 0, 0, rows - scrollRows);
      scrollRows = rows;
    }
    burnAtDangerLine();
    supportDirty = true;
  }

  // ---------------------------------------------------------------- gravity

  function supported(i) {
    const B = world.bricks;
    const left = mode === 'left';
    for (let j = 0; j < B.count; j++) {
      if (j === i || !B.alive[j]) continue;
      const f = B.flags[j];
      if (!(f & BF.SOLID) || (f & (BF.HIDDEN | BF.FALLING))) continue;
      if (left) {
        const ov = Math.min(B.y[i] + B.h[i] / 2, B.y[j] + B.h[j] / 2) - Math.max(B.y[i] - B.h[i] / 2, B.y[j] - B.h[j] / 2);
        if (ov > B.h[i] * 0.25 && Math.abs(B.x[j] + B.w[j] / 2 - (B.x[i] - B.w[i] / 2)) <= 2) return true;
      } else {
        const ov = Math.min(B.x[i] + B.w[i] / 2, B.x[j] + B.w[j] / 2) - Math.max(B.x[i] - B.w[i] / 2, B.x[j] - B.w[j] / 2);
        if (ov > B.w[i] * 0.25 && Math.abs(B.y[j] - B.h[j] / 2 - (B.y[i] + B.h[i] / 2)) <= 2) return true;
      }
    }
    return false;
  }

  function checkSupport() {
    const B = world.bricks;
    supportDirty = false;
    for (let k = 0; k < gList.length; k++) {
      const i = gList[k];
      if (!B.alive[i] || (B.flags[i] & (BF.FALLING | BF.HIDDEN))) continue;
      if (supported(i)) continue;
      if (!(B.flags[i] & BF.MOVING)) {
        B.px[i] = B.x[i];
        B.py[i] = B.y[i];
      }
      B.flags[i] |= BF.FALLING | BF.MOVING;
      fallV[i] = 0;
      B.version++;
      supportDirty = true; // what stood on it is checked next step
      emit(world.bus, EV.GRAVITY_FALL, i, B.x[i], B.y[i]);
    }
  }

  function fallStep() {
    const B = world.bricks;
    const left = mode === 'left';
    for (let k = 0; k < gList.length; k++) {
      const i = gList[k];
      if (!B.alive[i] || !(B.flags[i] & BF.FALLING)) continue;
      fallV[i] = Math.min(CONTENT.FALL_MAX, fallV[i] + CONTENT.GRAVITY * DT);
      const travel = fallV[i] * DT;
      // the nearest brick in the way
      const lead = left ? B.x[i] - B.w[i] / 2 : B.y[i] + B.h[i] / 2;
      let hit = -1, hitAt = 0;
      for (let j = 0; j < B.count; j++) {
        if (j === i || !B.alive[j]) continue;
        const f = B.flags[j];
        if (!(f & BF.SOLID) || (f & (BF.HIDDEN | BF.FALLING))) continue;
        let ov, face, dist;
        if (left) {
          ov = Math.min(B.y[i] + B.h[i] / 2, B.y[j] + B.h[j] / 2) - Math.max(B.y[i] - B.h[i] / 2, B.y[j] - B.h[j] / 2);
          face = B.x[j] + B.w[j] / 2;
          dist = lead - face;
        } else {
          ov = Math.min(B.x[i] + B.w[i] / 2, B.x[j] + B.w[j] / 2) - Math.max(B.x[i] - B.w[i] / 2, B.x[j] - B.w[j] / 2);
          face = B.y[j] - B.h[j] / 2;
          dist = face - lead;
        }
        if (ov <= 2 || dist < -1 || dist > travel) continue;
        if (hit < 0 || dist < hitAt) { hit = j; hitAt = dist; }
      }
      if (hit >= 0) {
        const hf = B.flags[hit];
        // a falling brick knocks one hit off what it lands on; gravity bricks pile up instead
        if ((hf & BF.BREAKABLE) && !(hf & BF.BOSS) && B.type[hit] !== BRICK.GRAVITY) {
          B.hitMs[hit] = world.time;
          dealDamage(hit, hitDamage(B.type[hit], hf, B.hp[hit], SRC.GRAVITY, false, world.effects), SRC.GRAVITY, -1);
        }
        if (!B.alive[hit]) {
          if (left) B.x[i] -= travel; else B.y[i] += travel;
        } else {
          if (left) B.x[i] = B.x[hit] + B.w[hit] / 2 + B.w[i] / 2;
          else B.y[i] = B.y[hit] - B.h[hit] / 2 - B.h[i] / 2;
          B.flags[i] &= ~BF.FALLING;
          if (laneOf[i] < 0) B.flags[i] &= ~BF.MOVING;
          fallV[i] = 0;
          B.version++;
          supportDirty = true;
          emit(world.bus, EV.GRAVITY_LAND, i, B.x[i], B.y[i]);
          continue;
        }
      } else if (left) B.x[i] -= travel;
      else B.y[i] += travel;
      const gone = left ? B.x[i] + B.w[i] / 2 < CONTENT.FLOOR_X : B.y[i] - B.h[i] / 2 > CONTENT.FLOOR_Y;
      if (gone) breakBrick(i, SRC.GRAVITY, -1);
    }
  }

  // ---------------------------------------------------------------- cavities

  function checkCavities() {
    const B = world.bricks;
    cavityDirty = false;
    for (let k = 0; k < sealed.length; k++) {
      const s = sealed[k];
      if (!B.alive[s]) continue;
      let hole = -1;
      for (let n = 0; n < 4; n++) {
        const nb = sealedNb[k * 4 + n];
        if (nb >= 0 && !B.alive[nb]) { hole = nb; break; }
      }
      if (hole < 0) continue;
      const g = B.group[s];
      for (let m = 0; m < sealed.length; m++) {
        const t = sealed[m];
        if (!B.alive[t] || B.group[t] !== g) continue;
        let dx = B.x[hole] - B.x[t], dy = B.y[hole] - B.y[t];
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const a = world.rng.content.range(10, 20) * DEG * world.rng.content.sign();
        const c = Math.cos(a), sn = Math.sin(a);
        const speed = SPEED.TIERS[Math.min(5, def.tier | 0)];
        const ball = world.api.spawnBall(B.x[t], B.y[t], (dx * c - dy * sn) * speed, (dx * sn + dy * c) * speed);
        if (ball < 0) { cavityDirty = true; continue; } // pool full: try again next step
        B.alive[t] = 0;
        diedAt[t] = world.time;
        B.version++;
        emit(world.bus, EV.CAVITY_OPENED, t, B.x[t], B.y[t], ball, g);
      }
    }
  }

  // ---------------------------------------------------------------- timers, rain, Fever

  function timerStep() {
    if (timerDone) return;
    if (!timerStarted) {
      if (world.phase !== 'play') return;
      timerStarted = true;
    }
    if (world.phase !== 'play' && world.phase !== 'serve') return;
    world.level.timeLeftMs -= DT_MS;
    const sec = Math.max(0, Math.ceil(world.level.timeLeftMs / 1000 - 1e-9));
    if (sec !== timerSec) {
      timerSec = sec;
      emit(world.bus, EV.TIMER, 0, 0, 0, sec);
    }
    if (world.level.timeLeftMs <= 0) {
      world.level.timeLeftMs = 0;
      timerDone = true;
      setRemaining(0);
    }
  }

  function rainStep() {
    if (world.phase !== 'play' || timerDone) return;
    rainAcc += DT_MS;
    if (rainAcc < rules.rainMs) return;
    rainAcc -= rules.rainMs;
    if (liveBalls(world) >= BALL.MAX) return;
    const rng = world.rng.content;
    const x = rng.range(120, FIELD.W - 120);
    rainSign = -rainSign;
    const a = (90 + rainSign * rng.range(15, 35)) * DEG; // downward, alternating sides
    const s = SPEED.TIERS[Math.min(5, def.tier | 0)];
    world.api.spawnBall(x, CONTENT.RAIN_Y, Math.cos(a) * s, Math.sin(a) * s);
  }

  function feverSplit(ball) {
    if (timerDone || ball < 0 || ball >= world.balls.length) return;
    const b = world.balls[ball];
    if (!b.alive || liveBalls(world) >= BALL.MAX) return;
    feverSign = -feverSign;
    const a = CONTENT.FEVER_SPREAD_DEG * DEG * feverSign;
    const c = Math.cos(a), s = Math.sin(a);
    world.api.spawnBall(b.x, b.y, b.vx * c - b.vy * s, b.vx * s + b.vy * c);
  }

  // ---------------------------------------------------------------- Purge

  /** Break every breakable brick in the `rows` rows nearest the paddle. Returns bricks broken. */
  function purgeRows(rows) {
    const B = world.bricks;
    const n = Math.max(1, rows | 0);
    const before = world.stats.bricksBroken;
    // depth of a brick: larger = nearer the paddle; quantised to cell bands
    const depth = (i) => (mode === 'left'
      ? Math.round((FIELD.W - B.x[i]) / grid.cw)
      : mode === 'ring'
        ? Math.round(Math.hypot(B.x[i] - 360, B.y[i] - 540) / grid.cw)
        : Math.round(B.y[i] / grid.ch));
    let nb = 0;
    for (let i = 0; i < B.count; i++) {
      if (!B.alive[i] || (B.flags[i] & BF.HIDDEN) || !(B.flags[i] & BF.BREAKABLE)) continue;
      const d = depth(i);
      let seen = false;
      for (let k = 0; k < nb; k++) if (bins[k] === d) { seen = true; break; }
      if (!seen && nb < bins.length) bins[nb++] = d;
    }
    // keep the n largest
    for (let a = 0; a < nb; a++) for (let b = a + 1; b < nb; b++) if (bins[b] > bins[a]) { const t = bins[a]; bins[a] = bins[b]; bins[b] = t; }
    const take = Math.min(n, nb);
    for (let i = 0; i < B.count; i++) {
      if (!B.alive[i] || (B.flags[i] & BF.HIDDEN) || !(B.flags[i] & BF.BREAKABLE)) continue;
      const d = depth(i);
      let inside = false;
      for (let k = 0; k < take; k++) if (bins[k] === d) { inside = true; break; }
      if (inside) hitBrick(i, SRC.OVERLOAD, -1, false, false);
    }
    emit(world.bus, EV.PURGED, 0, 0, 0, take);
    return world.stats.bricksBroken - before;
  }

  // ---------------------------------------------------------------- the system

  /** Helpers the boss scripts and the sentry controller use. */
  const ctx = {
    get world() { return world; },
    setRemaining: (n) => setRemaining(n),
    breakBrick: (i, src, ball) => breakBrick(i, src, ball),
    dealDamage: (i, dmg, src, ball) => dealDamage(i, dmg, src, ball),
    hitDamage: (i, src, pierced) => hitDamage(world.bricks.type[i], world.bricks.flags[i], world.bricks.hp[i], src, pierced, world.effects),
    allocBrick: () => allocBrick(),
    spawnBrick: (i, ch, x, y, w, h, col, row) => spawnBrick(i, ch, x, y, w, h, col, row),
    ballNear: (x, y, hw, hh) => ballNear(x, y, hw, hh),
  };

  return {
    name: 'content',

    init(w) {
      world = w;
      rd = createReader(world.bus, 'content', 0);
      def = world.level.def;
      const tw = world.run && world.run.twist;
      if (tw && !def.twist && twistsFor(def.n).some((t) => t.id === tw)) def = applyTwist(def, tw);
      parsed = parseLevel(def);
      rules = parsed.rules;
      mode = parsed.def.mode || 'bottom';
      grid = GRID[mode];
      isBoss = (def.kind || 'normal') === 'boss';
      world.level.rules = rules;
      weights = dropWeights(def.drops && def.drops.table);
      loadBricks(world, parsed);
      const B = world.bricks;
      // random carriers: roll their drop now so every system agrees on it (E reads bricks.drop)
      for (let i = 0; i < B.count; i++) {
        if (B.type[i] === BRICK.CARRIER && B.drop[i] < 0) B.drop[i] = world.rng.content.weighted(weights);
      }
      diedAt.fill(-1e9);
      laneOf.fill(-1);
      fallV.fill(0);
      qLen = 0;
      // lanes (moving rows / columns)
      lanes = [];
      for (const m of def.motion || []) {
        const k = lanes.length;
        lanes.push({ dir: m.dir === -1 ? -1 : 1, speed: m.speed, wrap: m.style === 'wrap', alongX: mode === 'bottom' });
        for (let i = 0; i < B.count; i++) {
          const on = mode === 'bottom' ? B.row[i] === m.row : B.col[i] === m.col;
          if (on && B.alive[i] && !(B.flags[i] & (BF.PORTAL | BF.CAVITY_BALL))) {
            laneOf[i] = k;
            B.flags[i] |= BF.MOVING;
          }
        }
      }
      // gravity bricks and sealed balls
      const g = [];
      const s = [];
      for (let i = 0; i < B.count; i++) {
        if (B.type[i] === BRICK.GRAVITY) g.push(i);
        if (B.flags[i] & BF.CAVITY_BALL) s.push(i);
      }
      gList = Int16Array.from(g);
      sealed = Int16Array.from(s);
      sealedNb = new Int16Array(s.length * 4).fill(-1);
      const at = new Map();
      for (let i = 0; i < B.count; i++) at.set(`${B.row[i]},${B.col[i]}`, i);
      s.forEach((i, k) => {
        [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc], n) => {
          const j = at.get(`${B.row[i] + dr},${B.col[i] + dc}`);
          if (j !== undefined && !(B.flags[j] & BF.CAVITY_BALL)) sealedNb[k * 4 + n] = j;
        });
      });
      supportDirty = true;
      cavityDirty = false;
      // march, scroll, timer, rain
      marchAcc = 0;
      marchShift = 0;
      marchFeedIdx = 0;
      marchFeedLeft = rules.marchMs > 0 ? (Number.isFinite(rules.marchFeed) ? rules.marchFeed : rules.marchRows.length) : 0;
      scrolled = 0;
      scrollRows = 0;
      scrolling = false;
      revealWait = false;
      let top = 0, topVisible = Infinity;
      for (let i = 0; i < B.count; i++) {
        top = Math.min(top, B.y[i] - B.h[i] / 2);
        if (B.alive[i] && !(B.flags[i] & (BF.HIDDEN | BF.BOSS))) topVisible = Math.min(topVisible, B.y[i] - B.h[i] / 2);
      }
      // a scrolling wall slides until its top row has reached the entry line (rows join play there)
      scrollLeft = rules.scrollSpeed > 0 ? Math.max(0, SCROLL_ENTRY_Y - top) : 0;
      // march feed rows enter on the wall's starting top row, so the wall grows from its own top
      // (A2: physics keeps the ceiling above level.entryY, where new bricks appear)
      marchEntryY = Number.isFinite(topVisible) ? topVisible : grid.y0;
      marchEntryRow = Math.round((marchEntryY - grid.y0) / grid.ch);
      // Every level writes entryY (NaN = no rows enter later), so world.level has one shape on every
      // level: written only on march and scroll levels it gave the hot step code a second map, and
      // V8 threw that code away mid-play once the old level's objects were collected (a-perf).
      world.level.entryY = rules.scrollSpeed > 0 ? SCROLL_ENTRY_Y : rules.marchMs > 0 ? marchEntryY : NaN;
      timerStarted = false;
      timerDone = false;
      timerSec = -1;
      rainAcc = 0;
      world.level.total = parsed.clearable;
      world.level.remaining = parsed.clearable;
      world.level.timeLeftMs = rules.timerMs > 0 ? rules.timerMs : -1;
      world.level.elapsedMs = 0;
      world.level.scrollY = 0;
      world.fx.dark = rules.dark ? 1 : 0;
      world.api.damageBrick = (i, dmg, src, ball) => {
        if (world.bricks.flags[i] & BF.BOSS) { if (boss) boss.onHit(world, i, src, ball, false); } else dealDamage(i, dmg, src, ball);
      };
      world.api.breakBrick = (i, src, ball) => breakBrick(i, src, ball);
      world.api.purgeRows = (n) => purgeRows(n);
      boss = isBoss ? createBoss(def.boss, def.stage || 1) : null;
      if (boss) {
        boss.init(world, ctx);
        world.level.total = world.boss.hpMax; // boss levels count weak-point hits (E's clear bonus)
      }
      sentries.init(world, parsed.sentrySpawns, ctx);
      emit(world.bus, EV.REMAINING, 0, 0, 0, world.level.remaining);
    },

    move(w) {
      if (w.phase === 'over') return;
      w.level.elapsedMs = w.time;
      const B = w.bricks;
      for (let i = 0; i < B.count; i++) {
        if (B.alive[i] && (B.flags[i] & MOVERS)) {
          B.px[i] = B.x[i];
          B.py[i] = B.y[i];
        }
      }
      if (lanes.length) moveLanes();
      if (rules.marchMs > 0) marchStep();
      if (rules.scrollSpeed > 0) scrollStep();
      if (gList.length) {
        if (supportDirty) checkSupport();
        fallStep();
      }
      if (cavityDirty) checkCavities();
      if (boss) boss.move(w, ctx);
      sentries.move(w, ctx);
      if (rules.timerMs > 0) timerStep();
      if (rules.rainMs > 0) rainStep();
    },

    resolve(w) {
      while (next(rd)) {
        switch (rd.type) {
          case EV.BRICK_HIT: {
            const ball = rd.a | 0;
            const src = rd.b | 0;
            hitBrick(rd.id, src, ball, rd.c === 1, true);
            if (rules.fever && src === SRC.BALL && ball >= 0) feverSplit(ball);
            break;
          }
          case EV.SENTRY_HIT:
            sentries.onHit(w, rd.id, rd.b | 0, rd.a | 0, ctx);
            break;
          case EV.HAZARD_HIT: {
            // a bomb, slag or bolt knocks HEAT out of the meter; it never shrinks the paddle (PLAN §1
            // frustration fix 3: shrink only via a red drop the player chose to catch)
            if (w.phase === 'play' || w.phase === 'serve') {
              const before = Number.isFinite(w.econ?.heat) ? w.econ.heat : 0;
              w.api.addHeat(-CONTENT.HAZARD_HEAT);
              const after = Number.isFinite(w.econ?.heat) ? w.econ.heat : before;
              emit(w.bus, EV.HAZARD_HEAT_LOST, rd.id, rd.x, rd.y, rd.a | 0, Math.max(0, before - after));
            }
            if (boss && boss.onHazardHit) boss.onHazardHit(w, rd.id, rd.a | 0);
            break;
          }
          default:
            break;
        }
      }
      processExplosions();
      if (cavityDirty) checkCavities();
    },
  };
}
