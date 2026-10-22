// B: the three bosses (src/content/bosses.js, bosses/*.js).

import { test, assert } from './lib.mjs';
import { BF, SRC, HAZARD, PADDLE, RING, HORIZONTAL } from '../src/core/constants.js';
import { getLevel, getStage, stagesOf } from '../src/levels/index.js';
import { BOSS_PARTS } from '../src/content/bosses.js';
import { STOKER, STOKER_PARTS } from '../src/content/bosses/stoker.js';
import { CRUCIBLE_PARTS, CORE_PARTS, CRUCIBLE_SPEC, CORE_SPECS } from '../src/content/bosses/orbit.js';
import { CONTENT } from '../src/content/bricks.js';
import { EV } from '../src/core/events.js';
import { createReader, next } from '../src/core/bus.js';
import { createWorld } from '../src/core/world.js';
import { runHeadless } from '../src/core/headless.js';
import { makeSystems } from '../src/systems.js';
import { createRun } from '../src/economy/economy.js';
import { createRobot } from '../src/sim/robot.js';
import { contentWorld } from './fixtures/B/helpers.mjs';

const COOL = Math.ceil(CONTENT.CORE_COOLDOWN_MS / 8.33) + 1;

function groupOf(world, g) {
  const B = world.bricks;
  const out = [];
  for (let i = 0; i < B.count; i++) if (B.alive[i] && (B.flags[i] & BF.BOSS) && B.group[i] === g) out.push(i);
  return out;
}

function hitCoreTimes(t, core, n) {
  for (let k = 0; k < n; k++) {
    t.hit(core);
    t.step(COOL);
  }
}

test('The Stoker: armoured jaw, a core with a cooldown, phase 2 regrows the jaw and sways', () => {
  const t = contentWorld(getLevel(10));
  const w = t.world;
  const jaw = groupOf(w, STOKER_PARTS.JAW);
  const core = groupOf(w, STOKER_PARTS.CORE);
  const head = groupOf(w, STOKER_PARTS.HEAD);
  assert.equal(jaw.length, 6);
  assert.equal(core.length, 1, 'the W cells are fused into one core brick');
  assert.equal(w.bricks.w[core[0]], 120);
  assert.ok(head.length > 20);
  assert.equal(w.boss.id, 'stoker');
  assert.equal(w.level.remaining, STOKER.HP);
  t.hit(jaw[0]);
  t.hit(jaw[0]);
  assert.equal(w.bricks.alive[jaw[0]], 1, 'a jaw plate is armour');
  t.hit(jaw[0]);
  assert.equal(w.bricks.alive[jaw[0]], 0);
  t.step(1);
  assert.ok(Math.abs(w.boss.open - 1 / 6) < 1e-6, 'boss.open follows the broken plates');
  t.hit(head[0], SRC.LASER, -1);
  assert.equal(w.bricks.alive[head[0]], 1, 'the head only deflects');
  t.hit(core[0]);
  t.hit(core[0]);
  assert.equal(w.boss.hp, STOKER.HP - 1, 'one hit per cooldown');
  t.step(COOL);
  hitCoreTimes(t, core[0], STOKER.HP - 1 - STOKER.PHASE2_AT);
  assert.equal(w.boss.phase, 2);
  assert.equal(w.level.remaining, STOKER.PHASE2_AT);
  assert.ok(jaw.every((i) => w.bricks.alive[i]), 'the jaw slammed shut');
  assert.ok(t.events().some((e) => e.name === 'BOSS_PHASE' && e.a === 2));
  const x0 = w.bricks.x[head[0]];
  t.step(90);
  assert.notEqual(w.bricks.x[head[0]], x0, 'the head sways');
  assert.ok(w.bricks.flags[head[0]] & BF.MOVING);
  for (let k = 0; k < 3; k++) t.hit(jaw[1]);
  assert.equal(w.bricks.alive[jaw[1]], 0);
  hitCoreTimes(t, core[0], 1);
  assert.equal(w.bricks.alive[jaw[1]], 1, 'phase 2: the jaw shuts again behind a ball that scores');
  for (let k = 0; k < 3; k++) t.hit(jaw[4]);
  t.step(Math.ceil(20000 / 8.33));
  assert.equal(w.bricks.alive[jaw[4]], 0, 'an open jaw stays open until a ball uses it (no timer)');
  hitCoreTimes(t, core[0], 1);
  assert.equal(w.bricks.alive[jaw[4]], 1, 'and shuts behind the ball that scored');
  hitCoreTimes(t, core[0], STOKER.PHASE2_AT - 2);
  assert.equal(w.level.remaining, 0);
  assert.ok(t.events().some((e) => e.name === 'BOSS_DEFEATED'));
  t.step(80);
  for (let i = 0; i < w.bricks.count; i++) assert.ok(!(w.bricks.alive[i] && (w.bricks.flags[i] & BF.BOSS)), 'every boss brick broke');
  assert.equal(w.boss.active, false);
});

test('The Stoker never shuts its jaw on a ball', () => {
  const t = contentWorld(getLevel(10));
  const w = t.world;
  const jaw = groupOf(w, STOKER_PARTS.JAW);
  const core = groupOf(w, STOKER_PARTS.CORE);
  for (let k = 0; k < 3; k++) t.hit(jaw[2]);
  w.api.spawnBall(w.bricks.x[core[0]], w.bricks.y[core[0]] + 30, 0, 0); // a ball inside the mouth
  hitCoreTimes(t, core[0], STOKER.HP - STOKER.PHASE2_AT);
  assert.equal(w.boss.phase, 2);
  assert.equal(w.bricks.alive[jaw[2]], 0, 'held open while the ball is inside');
  w.balls[0].alive = false;
  t.step(2);
  assert.equal(w.bricks.alive[jaw[2]], 1, 'shut once it left');
});

test('The Stoker spits slag toward the paddle', () => {
  const t = contentWorld(getLevel(10));
  t.step(Math.ceil(STOKER.SLAG_MS[0] / 8.33) + 2);
  assert.equal(t.hazards.length, 1);
  const h = t.hazards[0];
  assert.equal(h.kind, HAZARD.SLAG);
  assert.ok(h.vy > 0);
  const px = t.world.paddle.x, py = t.world.paddle.y;
  const tAt = (py - h.y) / h.vy;
  assert.ok(Math.abs(h.x + h.vx * tAt - px) < 2, 'aimed at the paddle');
  assert.ok(t.events().some((e) => e.name === 'BOSS_ATTACK'));
});

function ringGaps(world, ids, cx, cy) {
  const B = world.bricks;
  const pts = ids.map((i) => ({ i, a: Math.atan2(B.y[i] - cy, B.x[i] - cx) })).sort((p, q) => p.a - q.a);
  const gaps = [];
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k], q = pts[(k + 1) % pts.length];
    const dx = Math.abs(B.x[p.i] - B.x[q.i]), dy = Math.abs(B.y[p.i] - B.y[q.i]);
    gaps.push(Math.max(dx, dy) - 30);
  }
  return gaps.sort((a, b) => b - a);
}

test('The Crucible: the ring stays sealed as it turns, one gate; phase 2 reverses and speeds up', () => {
  const t = contentWorld(getLevel(20));
  const w = t.world;
  const ring = groupOf(w, CRUCIBLE_PARTS.RING);
  const core = groupOf(w, CRUCIBLE_PARTS.CORE);
  const spec = CRUCIBLE_SPEC.rings[0];
  assert.equal(ring.length, spec.slots - spec.gaps.length);
  for (const i of ring) assert.equal(w.bricks.w[i], 30);
  for (let k = 0; k < 40; k++) {
    const gaps = ringGaps(w, ring, w.boss.x, w.boss.y);
    assert.ok(gaps[0] > 60, 'the gate is wide enough for the ball');
    assert.ok(gaps[1] <= 1e-3, `every other pair of plates touches (worst ${gaps[1].toFixed(2)})`);
    t.step(23);
  }
  const a0 = w.boss.angle;
  t.step(10);
  assert.ok(w.boss.angle > a0, 'phase 1 turns one way');
  hitCoreTimes(t, core[0], w.boss.hpMax / 2);
  assert.equal(w.boss.phase, 2);
  const a1 = w.boss.angle;
  t.step(10);
  assert.ok(w.boss.angle < a1, 'phase 2 turns the other way');
  assert.ok(Math.abs(w.boss.angle - a1) > Math.abs(a0 - (a0 - 10 * spec.omega * 8.33 / 1000)), 'and faster');
});

test('The Core: stages clear with STAGE_CLEARED, the last with BOSS_DEFEATED', () => {
  const ids = stagesOf(getLevel(30)).map((d) => d.id);
  assert.deepEqual(ids, ['core-1', 'core-2', 'core-3']);
  ids.forEach((id, k) => {
    const t = contentWorld(getStage(id));
    const w = t.world;
    assert.equal(w.boss.phase, k + 1);
    const core = groupOf(w, CORE_PARTS.CORE);
    assert.equal(core.length, 1, 'one fused core brick');
    assert.ok(groupOf(w, CORE_PARTS.INNER).length > 10);
    if (k === 2) assert.ok(groupOf(w, CORE_PARTS.OUTER).length > 20, 'stage 3 has two rings');
    hitCoreTimes(t, core[0], w.boss.hpMax);
    const names = t.events().map((e) => e.name);
    assert.equal(w.level.remaining, 0);
    assert.equal(names.includes('BOSS_DEFEATED'), k === 2, id);
    assert.equal(names.includes('STAGE_CLEARED'), k < 2, id);
  });
});

test('boss levels: only weak points are clearable, remaining and total are the boss hp, every part is named', () => {
  for (const def of [getLevel(10), getLevel(20), ...stagesOf(getLevel(30))]) {
    const t = contentWorld(def);
    const w = t.world;
    const B = w.bricks;
    const named = new Set(BOSS_PARTS[def.boss].map((p) => p.group));
    for (let i = 0; i < B.count; i++) {
      if (!B.alive[i]) continue;
      if (B.flags[i] & BF.CLEARABLE) assert.ok(B.flags[i] & BF.WEAK, `${def.id}: only W cells are clearable`);
      if (B.flags[i] & BF.BOSS) assert.ok(named.has(B.group[i]), `${def.id}: group ${B.group[i]} is in BOSS_PARTS`);
    }
    assert.equal(w.level.remaining, w.boss.hp);
    assert.equal(w.level.total, w.boss.hpMax, `${def.id}: total counts weak-point hits`);
    assert.ok(w.boss.active);
  }
});

const BOSS_DEFS = () => [getLevel(10), getLevel(20), ...stagesOf(getLevel(30))];

function weakPoints(w) {
  const out = [];
  for (let i = 0; i < w.bricks.count; i++) if (w.bricks.alive[i] && (w.bricks.flags[i] & BF.WEAK)) out.push(i);
  return out;
}

/** A point inside each boss (between the core and its armour) where a resting ball counts as in. */
function insidePoint(w, id) {
  const B = w.bricks;
  const c = weakPoints(w)[0];
  if (id === 'the-stoker') return { x: B.x[c], y: B.y[c] + 30 };
  if (w.level.mode === 'left') return { x: B.x[c] + B.w[c] / 2 + 25, y: B.y[c] };
  return { x: B.x[c], y: B.y[c] + B.h[c] / 2 + 25 };
}

test('two core hits, then the core cools (BOSS_GUARD) until every ball is out or 2.5 s pass; ignored hits say so', () => {
  for (const def of BOSS_DEFS()) {
    const t = contentWorld(def);
    const w = t.world;
    const core = weakPoints(w);
    const p = insidePoint(w, def.id);
    const bi = w.api.spawnBall(p.x, p.y, 0, 0);
    const hp0 = w.boss.hp;
    const seen = (name, a) => t.events().filter((e) => e.name === name && (a === undefined || e.a === a)).length;
    t.hit(core[0]);
    t.hit(core[0]); // inside the 500 ms cooldown: blocked, a = 0
    assert.equal(seen('BOSS_BLOCKED', 0), 1, `${def.id}: a hit inside the cooldown says it did not count`);
    t.step(COOL);
    t.hit(core[0]);
    assert.equal(w.boss.hp, hp0 - 2, `${def.id}: two hits counted while the ball stayed in`);
    assert.equal(w.boss.data.guard, 1, `${def.id}: the core cooled`);
    assert.equal(seen('BOSS_GUARD', 1), 1, `${def.id}: BOSS_GUARD a = 1 when it cools`);
    t.step(COOL);
    t.hit(core[0]);
    assert.equal(w.boss.hp, hp0 - 2, `${def.id}: a cooled core ignores the hit`);
    assert.equal(seen('BOSS_BLOCKED', 1), 1, `${def.id}: and says so (BOSS_BLOCKED a = 1)`);
    w.balls[bi].alive = false;
    t.step(1);
    assert.equal(w.boss.data.guard, 0, `${def.id}: the ball left, the core takes hits again`);
    assert.equal(seen('BOSS_GUARD', 0), 1, `${def.id}: BOSS_GUARD a = 0 when it is hot again`);
    hitCoreTimes(t, core[0], 1);
    assert.equal(w.boss.hp, hp0 - 3, `${def.id}: a new entry counts`);
    // a ball that stays in: the core warms again on its own after GUARD_MS
    const t2 = contentWorld(def);
    const core2 = weakPoints(t2.world);
    t2.world.api.spawnBall(p.x, p.y, 0, 0);
    hitCoreTimes(t2, core2[0], 2);
    assert.equal(t2.world.boss.data.guard, 1, `${def.id}: cooled`);
    t2.step(Math.ceil(CONTENT.GUARD_MS / 8.33) + 1);
    assert.equal(t2.world.boss.data.guard, 0, `${def.id}: hot again after ${CONTENT.GUARD_MS} ms with the ball still in`);
    assert.equal(t2.events().filter((e) => e.name === 'BOSS_GUARD' && e.a === 0).length, 1, `${def.id}: and says so`);
  }
});

test('robot: a stay inside a ring scores two core hits, then waits 2.5 s (Crucible and every Core stage)', () => {
  const specs = { 'the-crucible': CRUCIBLE_SPEC, 'core-1': CORE_SPECS[1], 'core-2': CORE_SPECS[2], 'core-3': CORE_SPECS[3] };
  for (const [id, spec] of Object.entries(specs)) {
    const R = spec.rings[spec.rings.length - 1].r;
    const def = getStage(id);
    for (const perfect of [false, true]) {
      for (let seed = 1; seed <= 2; seed++) {
        const run = createRun({ seed, levelN: def.n });
        const world = createWorld({ level: def, seed: seed * 1000 + 31 * def.n + (def.stage || 1), run, systems: makeSystems() });
        const rd = createReader(world.bus, 'stays', 0);
        let inside = false, times = [], worstGap = Infinity, stays = 0;
        const r = runHeadless(world, createRobot({ perfect }), {
          maxSimMs: 6 * 60 * 1000,
          onStep(w) {
            let any = false;
            for (const b of w.balls) if (b.alive && Math.hypot(b.x - w.boss.x, b.y - w.boss.y) < R) any = true;
            while (next(rd)) if (rd.type === EV.BOSS_HIT && any) times.push(w.time);
            if (inside && !any) {
              // within one stay, every third hit comes GUARD_MS or more after the second
              for (let k = CONTENT.ENTRY_HITS; k < times.length; k += CONTENT.ENTRY_HITS) worstGap = Math.min(worstGap, times[k] - times[k - 1]);
              if (times.length) stays++;
              times = [];
            }
            inside = any;
          },
        });
        if (times.length) stays++; // the stay the fight ended in
        assert.ok(r.cleared, `${id} seed ${seed} ${perfect ? 'perfect' : 'plain'}: cleared`);
        assert.ok(worstGap >= CONTENT.GUARD_MS - 10, `${id} seed ${seed}: a third hit ${worstGap} ms after the second in one stay`);
        // coverage, not a count to the hit (A2: the old "stays >= hp over 4 runs" was seed noise)
        assert.ok(stays >= 2, `${id} seed ${seed} ${perfect ? 'perfect' : 'plain'}: the fight took several entries (${stays})`);
      }
    }
  }
}, { timeout: 120000 });

/** Seconds a hazard needs from its spawn point to the paddle line (the paddle face, less its radius). */
function secondsToPaddle(mode, h) {
  if (mode === 'left') return (h.x - (HORIZONTAL.PADDLE_X + PADDLE.H / 2 + h.r)) / -h.vx;
  if (mode === 'ring') {
    const R = RING.R_PADDLE - PADDLE.H / 2 - h.r;
    const px = h.x - RING.CX, py = h.y - RING.CY;
    const a = h.vx * h.vx + h.vy * h.vy, b = 2 * (px * h.vx + py * h.vy), c = px * px + py * py - R * R;
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  }
  return (PADDLE.Y - PADDLE.H / 2 - h.r - h.y) / h.vy;
}

test('every boss attack gives at least 1 s to see it coming', () => {
  for (const def of BOSS_DEFS()) {
    if (def.id === 'core-1') continue; // stage 1 has no attack of its own (drifters guard it)
    const placements = def.mode === 'ring' ? [Math.PI / 2, 0, Math.PI] : [null];
    for (const ang of placements) {
      const t = contentWorld(def);
      const w = t.world;
      if (ang !== null) {
        w.paddle.angle = ang;
        w.paddle.x = RING.CX + Math.cos(ang) * RING.R_PADDLE;
        w.paddle.y = RING.CY + Math.sin(ang) * RING.R_PADDLE;
      }
      t.step(Math.ceil(25000 / 8.33)); // 25 s: every attack pattern fires several times
      const mine = t.hazards.filter((h) => h.kind !== HAZARD.BOMB); // bombs are the sentries'
      assert.ok(mine.length >= 3, `${def.id}: attacks fired (${mine.length})`);
      for (const h of mine) {
        const s = secondsToPaddle(def.mode || 'bottom', h);
        assert.ok(s >= 1.0, `${def.id}: a hazard (kind ${h.kind}) reaches the paddle line in ${s.toFixed(2)} s`);
      }
    }
  }
});
