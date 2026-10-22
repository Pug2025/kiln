// Kiln: sentries (OWNER: B): dark drones with one orange eye. They drift, deflect the ball, take two
// or 3 ball hits (1 laser, fire, blast or a perfect-hit ball), and bombers drop bombs the
// paddle must dodge.
//
// Seam: B owns world.sentries (spawn, motion, hp, firing). A treats each live sentry as a circle
// (x, y, r): balls bounce off it and lasers stop on it; A emits SENTRY_HIT (a = ball or −1 for a
// laser, b = SRC.*). B reacts in content.resolve. Bombs are hazards (world.api.spawnHazard); a
// paddle hit by one knocks HEAT out of the meter (content.js, HAZARD_HIT).
//
// Motion is a pure function of the sentry's age, so it is deterministic and costs nothing:
//   bottom mode: drifters trace a slow figure eight around their spawn, bombers patrol across it;
//   left mode:   the same with the axes swapped (they patrol along the paddle's track);
//   ring mode:   both orbit the ring centre at their spawn radius.

import { SIM, SENTRY, HAZARD, SRC, FIELD, RING, BF, PADDLE, HORIZONTAL } from '../core/constants.js';
import { EV } from '../core/events.js';
import { emit } from '../core/bus.js';

const DT = SIM.DT;
const HIDDEN = BF.HIDDEN;
const SOLID = BF.SOLID;
const KIND = Object.freeze({ drifter: SENTRY.DRIFTER, bomber: SENTRY.BOMBER });

/** Per kind: radius, hit points, motion. B's calls, logged in K/status/B.md. */
export const SENTRY_SPEC = Object.freeze([
  Object.freeze({ name: 'drifter', r: 18, hp: 2, along: 110, across: 36, omega: 0.55 }),
  Object.freeze({ name: 'bomber', r: 20, hp: 3, along: 240, across: 10, omega: 0.4 }),
]);

export const BOMB = Object.freeze({
  FIRST_MS: 1600,  // first bomb after spawning
  EVERY_MS: 3200,  // then one every
  SPEED: 240,      // units/s, straight toward the paddle side
  R: 10,
  LEAD_S: 1.2,     // a bomb never reaches the paddle line sooner than this: one dropped low falls slower
});

/**
 * Distance from (x, y) to the paddle line along a bomb's path (bombs fall straight toward the
 * paddle side: +y in bottom mode, −x in left mode, outward in ring mode). The paddle line is the
 * paddle's face less the bomb's radius.
 */
export function bombDistance(mode, x, y) {
  if (mode === 'left') return x - (HORIZONTAL.PADDLE_X + PADDLE.H / 2 + BOMB.R);
  if (mode === 'ring') return RING.R_PADDLE - PADDLE.H / 2 - BOMB.R - Math.hypot(x - RING.CX, y - RING.CY);
  return PADDLE.Y - PADDLE.H / 2 - BOMB.R - y;
}

/** Bomb speed from a drop point: BOMB.SPEED, or slower so it needs at least BOMB.LEAD_S. */
export function bombSpeed(mode, x, y) {
  return Math.max(20, Math.min(BOMB.SPEED, bombDistance(mode, x, y) / BOMB.LEAD_S));
}

const SAFE_Y = 860;   // bottom mode: drifters never come lower than this (the paddle zone stays clear)
const SAFE_X = 180;   // left mode: the same, measured from the paddle side

/** Bombs a bomber of this age (ms) has dropped so far. */
const shots = (age) => (age < BOMB.FIRST_MS ? 0 : 1 + Math.floor((age - BOMB.FIRST_MS) / BOMB.EVERY_MS));

/** @returns {import('./sentries.js').SentryController} */
export function createSentries() {
  /** @type {{kind:number, x:number, y:number, atMs:number, everyMs:number, slot:number, born:number, diedAt:number, done:boolean, phase:number, along:number, across:number, angle:number, radius:number}[]} */
  let spawns = [];
  let mode = 'bottom';

  function place(world, sp, s, age) {
    const spec = SENTRY_SPEC[sp.kind];
    const t = age / 1000;
    const w = spec.omega;
    let x, y;
    if (mode === 'ring') {
      const a = sp.angle + w * t * (sp.kind === SENTRY.BOMBER ? 0.6 : 1);
      const r = sp.radius + spec.across * Math.sin(2 * w * t + sp.phase);
      x = RING.CX + Math.cos(a) * r;
      y = RING.CY + Math.sin(a) * r;
    } else {
      const along = sp.along * Math.sin(w * t + sp.phase);
      const across = sp.across * Math.sin(2 * w * t + sp.phase);
      if (mode === 'left') {
        x = sp.x + across;
        y = sp.y + along;
        x = Math.max(SAFE_X, Math.min(FIELD.W - s.r, x));
        y = Math.max(s.r, Math.min(FIELD.H - s.r, y));
      } else {
        x = sp.x + along;
        y = sp.y + across;
        x = Math.max(s.r, Math.min(FIELD.W - s.r, x));
        y = Math.max(s.r, Math.min(SAFE_Y, y));
      }
    }
    s.x = x;
    s.y = y;
  }

  function spawn(world, k) {
    const sp = spawns[k];
    const pool = world.sentries;
    let slot = -1;
    for (let i = 0; i < pool.length; i++) if (!pool[i].alive) { slot = i; break; }
    if (slot < 0) return;
    const spec = SENTRY_SPEC[sp.kind];
    const s = pool[slot];
    s.alive = true;
    s.kind = sp.kind;
    s.r = spec.r;
    s.hp = spec.hp;
    s.t = 0;
    s.eye = Math.PI / 2;
    sp.slot = slot;
    sp.born = world.time;
    place(world, sp, s, 0);
    s.px = s.x;
    s.py = s.y;
    s.vx = s.vy = 0;
    emit(world.bus, EV.SENTRY_SPAWNED, slot, s.x, s.y, s.kind);
  }

  function kill(world, i) {
    const s = world.sentries[i];
    if (!s.alive) return;
    s.alive = false;
    s.vx = s.vy = 0;
    for (const sp of spawns) {
      if (sp.slot === i) {
        sp.slot = -1;
        sp.diedAt = world.time;
        if (!(sp.everyMs > 0)) sp.done = true;
      }
    }
    emit(world.bus, EV.SENTRY_KILLED, i, s.x, s.y, s.kind);
  }

  /** Direction "toward the paddle side" from a point (bombs fall this way). */
  function awayFromBricks(x, y, out) {
    if (mode === 'left') { out.x = -1; out.y = 0; }
    else if (mode === 'ring') {
      const dx = x - RING.CX, dy = y - RING.CY;
      const len = Math.hypot(dx, dy) || 1;
      out.x = dx / len;
      out.y = dy / len;
    } else { out.x = 0; out.y = 1; }
    return out;
  }
  const dir = { x: 0, y: 1 };

  return {
    init(world, list) {
      mode = world.level.mode;
      for (const s of world.sentries) s.alive = false;
      spawns = list.map((e, k) => {
        const kind = KIND[e.kind] ?? SENTRY.DRIFTER;
        const spec = SENTRY_SPEC[kind];
        const dx = e.x - RING.CX, dy = e.y - RING.CY;
        return {
          kind,
          x: e.x,
          y: e.y,
          atMs: e.atMs | 0,
          everyMs: e.everyMs | 0,
          slot: -1,
          born: 0,
          diedAt: -1e9,
          done: false,
          phase: k * 1.7,
          along: e.along ?? spec.along,
          across: e.across ?? spec.across,
          angle: Math.atan2(dy, dx),
          radius: Math.hypot(dx, dy),
        };
      });
    },

    move(world) {
      if (!spawns.length) return;
      const pool = world.sentries;
      for (let k = 0; k < spawns.length; k++) {
        const sp = spawns[k];
        if (sp.slot >= 0 || sp.done) continue;
        const due = sp.diedAt < 0 ? sp.atMs : sp.diedAt + sp.everyMs;
        if (world.time >= due) spawn(world, k);
      }
      const fire = world.phase === 'play';
      // bottom mode: sentries keep below the wall (the wall may march down onto their path)
      let floor = -1e9;
      if (mode === 'bottom') {
        const B = world.bricks;
        for (let i = 0; i < B.count; i++) {
          if (!B.alive[i] || (B.flags[i] & HIDDEN) || !(B.flags[i] & SOLID)) continue;
          const bottom = B.y[i] + B.h[i] / 2;
          if (bottom > floor) floor = bottom;
        }
      }
      for (let k = 0; k < spawns.length; k++) {
        const sp = spawns[k];
        if (sp.slot < 0) continue;
        const s = pool[sp.slot];
        s.px = s.x;
        s.py = s.y;
        const age = world.time - sp.born;
        s.t = age;
        place(world, sp, s, age);
        if (s.y < floor + s.r + 10) s.y = Math.min(SAFE_Y, floor + s.r + 10);
        s.vx = (s.x - s.px) / DT;
        s.vy = (s.y - s.py) / DT;
        // the eye follows the nearest live ball, else the paddle
        let tx = world.paddle.x, ty = world.paddle.y, best = 1e18;
        for (let b = 0; b < world.balls.length; b++) {
          const ball = world.balls[b];
          if (!ball.alive) continue;
          const d = (ball.x - s.x) ** 2 + (ball.y - s.y) ** 2;
          if (d < best) { best = d; tx = ball.x; ty = ball.y; }
        }
        s.eye = Math.atan2(ty - s.y, tx - s.x);
        if (s.kind === SENTRY.BOMBER && fire) {
          const prev = age - SIM.DT_MS;
          if (shots(age) > shots(prev)) {
            awayFromBricks(s.x, s.y, dir);
            const bx = s.x + dir.x * (s.r + 4), by = s.y + dir.y * (s.r + 4);
            const v = bombSpeed(mode, bx, by);
            const h = world.api.spawnHazard(bx, by, dir.x * v, dir.y * v, HAZARD.BOMB, BOMB.R);
            if (h >= 0) emit(world.bus, EV.SENTRY_FIRED, h, s.x, s.y, HAZARD.BOMB);
          }
        }
      }
    },

    onHit(world, i, src, ball) {
      if (i < 0 || i >= world.sentries.length) return;
      const s = world.sentries[i];
      if (!s.alive) return;
      const eff = world.effects;
      const b = ball >= 0 && ball < world.balls.length ? world.balls[ball] : null;
      const lethal = src === SRC.LASER || src === SRC.FIRE || src === SRC.EXPLOSION || src === SRC.OVERLOAD
        || src === SRC.MEGA || (src === SRC.BALL && (eff.fire || eff.mega)) || (b && b.boostMs > 0);
      s.hp -= lethal ? s.hp : eff.ballKind === 1 ? 2 : 1;
      if (s.hp <= 0) kill(world, i);
      else emit(world.bus, EV.SENTRY_DAMAGED, i, s.x, s.y, s.hp, src);
    },

    /** A blast rectangle (centre ± hw/hh) kills every sentry it touches. */
    blast(world, x, y, hw, hh) {
      const pool = world.sentries;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        if (!s.alive) continue;
        if (Math.abs(s.x - x) <= hw + s.r && Math.abs(s.y - y) <= hh + s.r) kill(world, i);
      }
    },

    /** Live sentries (tests, HUD). */
    count(world) {
      let n = 0;
      for (const s of world.sentries) if (s.alive) n++;
      return n;
    },
  };
}

/**
 * @typedef {object} SentryController
 * @property {(world:import('../core/types.js').World, spawns:object[]) => void} init
 * @property {(world:import('../core/types.js').World) => void} move       content.move slot
 * @property {(world:import('../core/types.js').World, sentry:number, src:number, ball:number) => void} onHit
 * @property {(world:import('../core/types.js').World, x:number, y:number, hw:number, hh:number) => void} blast
 * @property {(world:import('../core/types.js').World) => number} count
 */
