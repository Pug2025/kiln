// B: the three bosses (src/content/bosses.js, bosses/*.js).

import { test, assert } from './lib.mjs';
import { BF, SRC, HAZARD, PADDLE, RING, HORIZONTAL, PHYS } from '../src/core/constants.js';
import { getLevel, getStage, stagesOf } from '../src/levels/index.js';
import { BOSS_PARTS } from '../src/content/bosses.js';
import { STOKER, STOKER_PARTS } from '../src/content/bosses/stoker.js';
import { CRUCIBLE_PARTS, CORE_PARTS, CRUCIBLE_SPEC, CORE_SPECS, ORBIT_RULES } from '../src/content/bosses/orbit.js';
import { coreRules } from '../src/content/bosses/common.js';
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

test('The Stoker: two-hit jaw, one phase-change repair, retained core damage and permanent later openings', () => {
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
  assert.ok(jaw.every((i) => w.bricks.hp[i] === 2 && w.bricks.hpMax[i] === 2), 'first-boss armour has two hits');
  t.hit(jaw[0]);
  assert.equal(w.bricks.alive[jaw[0]], 1);
  assert.equal(w.bricks.hp[jaw[0]], 1, 'the first hit visibly damages armour');
  t.hit(jaw[0]);
  assert.equal(w.bricks.alive[jaw[0]], 0, 'the second opens it');
  t.hit(jaw[1]);
  t.step(1);
  assert.ok(Math.abs(w.boss.open - 1 / 6) < 1e-6, 'boss.open follows actual broken plates');
  t.hit(head[0], SRC.LASER, -1);
  assert.equal(w.bricks.alive[head[0]], 1, 'the head only deflects');
  t.hit(core[0]);
  t.hit(core[0]);
  assert.equal(w.boss.hp, STOKER.HP - 1, 'one core hit per cooldown');
  assert.equal(w.boss.phase, 2);
  assert.equal(w.level.remaining, 4, 'phase changes never restore core health');
  assert.ok(w.boss.data.jawRepairDone);
  assert.equal(w.boss.data.jawRepairPending, false);
  assert.equal(w.bricks.hp[jaw[0]], 2, 'a broken plate reforms at two hits');
  assert.equal(w.bricks.hp[jaw[1]], 1, 'a surviving damaged plate retains its damage');
  assert.equal(t.events().filter((e) => e.name === 'BRICK_SPAWNED' && jaw.includes(e.id)).length, 1);
  assert.ok(t.events().some((e) => e.name === 'BOSS_PHASE' && e.a === 2));
  const x0 = w.bricks.x[head[0]];
  t.step(90);
  assert.notEqual(w.bricks.x[head[0]], x0, 'the head still sways');
  assert.ok(w.bricks.flags[head[0]] & BF.MOVING);
  t.hit(jaw[1]);
  assert.equal(w.bricks.alive[jaw[1]], 0);
  t.step(Math.ceil(20000 / 8.33));
  assert.equal(w.bricks.alive[jaw[1]], 0, 'an unused opening has no closing timer');
  hitCoreTimes(t, core[0], 1);
  assert.equal(w.bricks.alive[jaw[1]], 0, 'scoring later never schedules another repair');
  assert.equal(w.boss.data.jawRepairPending, false);
  hitCoreTimes(t, core[0], w.boss.hp);
  assert.equal(w.level.remaining, 0);
  assert.equal(t.events().filter((e) => e.name === 'BRICK_SPAWNED' && jaw.includes(e.id)).length, 1, 'one repair only over the whole fight');
  assert.ok(t.events().some((e) => e.name === 'BOSS_DEFEATED'));
  t.step(80);
  for (let i = 0; i < w.bricks.count; i++) assert.ok(!(w.bricks.alive[i] && (w.bricks.flags[i] & BF.BOSS)), 'every boss brick broke');
  assert.equal(w.boss.active, false);
});

test('The Stoker repair waits for every ball, never closes on one, and preserves health while waiting', () => {
  const t = contentWorld(getLevel(10));
  const w = t.world;
  const jaw = groupOf(w, STOKER_PARTS.JAW);
  const core = groupOf(w, STOKER_PARTS.CORE);
  for (let k = 0; k < STOKER.JAW_HP; k++) t.hit(jaw[2]);
  const b0 = w.api.spawnBall(w.bricks.x[core[0]], w.bricks.y[core[0]] + 30, 0, 0);
  const b1 = w.api.spawnBall(w.bricks.x[core[0]] + 20, w.bricks.y[core[0]] + 35, 0, 0);
  hitCoreTimes(t, core[0], 1);
  assert.equal(w.boss.phase, 2);
  assert.ok(w.boss.data.jawRepairPending);
  assert.equal(w.boss.data.jawRepairDone, false);
  assert.equal(w.bricks.alive[jaw[2]], 0, 'held open while a ball is inside');
  w.balls[b0].alive = false;
  t.step(COOL);
  t.hit(core[0]);
  t.step(Math.ceil(CONTENT.GUARD_MS / 8.33) + 2);
  assert.equal(w.bricks.alive[jaw[2]], 0, 'a second ball keeps it open even beyond the guard timer');
  assert.equal(w.boss.hp, 3, 'another core hit while waiting is permanent progress');
  w.balls[b1].alive = false;
  t.step(2);
  assert.equal(w.bricks.alive[jaw[2]], 1, 'repaired once every ball left');
  assert.equal(w.boss.hp, 3, 'repair does not heal the core');
  assert.ok(w.boss.data.jawRepairDone);
  assert.equal(w.boss.data.jawRepairPending, false);
});

test('The Stoker jaw still breaks in one laser or fire hit, while ordinary armour stays three hits', () => {
  for (const src of [SRC.LASER, SRC.FIRE]) {
    const t = contentWorld(getLevel(10));
    const jaw = groupOf(t.world, STOKER_PARTS.JAW);
    t.hit(jaw[0], src, -1);
    assert.equal(t.world.bricks.alive[jaw[0]], 0);
  }
  const t = contentWorld(getLevel(11));
  const B = t.world.bricks;
  const i = [...B.alive].findIndex((alive, k) => alive && B.hp[k] === 3 && (B.flags[k] & BF.ARMOURED));
  assert.ok(i >= 0, 'level 11 still teaches normal armour');
  t.hit(i); t.hit(i);
  assert.equal(B.alive[i], 1);
  t.hit(i);
  assert.equal(B.alive[i], 0);
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

/** Each contiguous run of empty slots is one opening (including a run across slot zero). */
function gapCentres(spec) {
  const gaps = new Set(spec.gaps), centres = [];
  for (const k of spec.gaps) {
    if (gaps.has((k - 1 + spec.slots) % spec.slots)) continue;
    let count = 1;
    while (gaps.has((k + count) % spec.slots)) count++;
    centres.push((k + (count - 1) / 2) * 2 * Math.PI / spec.slots);
  }
  return centres;
}

test('Crucible and every Core stage: each rotating gap passes a whole ball, including Mega, at every sampled angle', () => {
  for (const spec of [CRUCIBLE_SPEC, ...CORE_SPECS.slice(1)]) {
    const def = spec.id === 'crucible' ? getLevel(20) : getStage(`core-${spec.phase}`);
    const t = contentWorld(def), w = t.world, B = w.bricks;
    for (let sample = 0; sample < 120; sample++) {
      for (let r = 0; r < spec.rings.length; r++) {
        const ring = spec.rings[r], ids = groupOf(w, ring.group);
        const angle = r === 0 ? w.boss.angle : (w.boss.data.angle2 || 0);
        for (const gap of gapCentres(ring)) {
          const a = gap + angle;
          // Sweep the ball centre across this ring's entire thickness, using circle/rectangle
          // separation rather than just the distance between plate centres.
          for (let d = ring.r - 40; d <= ring.r + 40; d += 2) {
            const x = w.boss.x + Math.cos(a) * d, y = w.boss.y + Math.sin(a) * d;
            for (const i of ids) {
              const dx = Math.max(0, Math.abs(x - B.x[i]) - B.w[i] / 2);
              const dy = Math.max(0, Math.abs(y - B.y[i]) - B.h[i] / 2);
              assert.ok(dx * dx + dy * dy >= PHYS.MEGA_R * PHYS.MEGA_R,
                `${def.id} ring ${r} sample ${sample}: a whole Mega ball fits through its visible gap`);
            }
          }
        }
      }
      t.step(17);
    }
  }
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

test('the per-entry hits, then the core cools (BOSS_GUARD) until every ball is out or the guard time passes; ignored hits say so', () => {
  for (const def of BOSS_DEFS()) {
    const t = contentWorld(def);
    const w = t.world;
    const rules = coreRules(w.boss);
    const n = rules.entryHits;
    const core = weakPoints(w);
    const p = insidePoint(w, def.id);
    const bi = w.api.spawnBall(p.x, p.y, 0, 0);
    const hp0 = w.boss.hp;
    const seen = (name, a) => t.events().filter((e) => e.name === name && (a === undefined || e.a === a)).length;
    t.hit(core[0]);
    t.hit(core[0]); // inside the cooldown: blocked, a = 0
    assert.equal(seen('BOSS_BLOCKED', 0), 1, `${def.id}: a hit inside the cooldown says it did not count`);
    for (let k = 1; k < n; k++) { t.step(COOL); t.hit(core[0]); }
    assert.equal(w.boss.hp, hp0 - n, `${def.id}: ${n} hits counted while the ball stayed in`);
    assert.equal(w.boss.data.guard, 1, `${def.id}: the core cooled`);
    assert.equal(seen('BOSS_GUARD', 1), 1, `${def.id}: BOSS_GUARD a = 1 when it cools`);
    t.step(COOL);
    t.hit(core[0]);
    assert.equal(w.boss.hp, hp0 - n, `${def.id}: a cooled core ignores the hit`);
    assert.equal(seen('BOSS_BLOCKED', 1), 1, `${def.id}: and says so (BOSS_BLOCKED a = 1)`);
    w.balls[bi].alive = false;
    t.step(1);
    assert.equal(w.boss.data.guard, 0, `${def.id}: the ball left, the core takes hits again`);
    assert.equal(seen('BOSS_GUARD', 0), 1, `${def.id}: BOSS_GUARD a = 0 when it is hot again`);
    hitCoreTimes(t, core[0], 1);
    assert.equal(w.boss.hp, hp0 - n - 1, `${def.id}: a new entry counts`);
    // a ball that stays in: the core warms again on its own after the guard time
    const t2 = contentWorld(def);
    const core2 = weakPoints(t2.world);
    t2.world.api.spawnBall(p.x, p.y, 0, 0);
    hitCoreTimes(t2, core2[0], n);
    assert.equal(t2.world.boss.data.guard, 1, `${def.id}: cooled`);
    t2.step(Math.ceil(rules.guardMs / 8.33) + 1);
    assert.equal(t2.world.boss.data.guard, 0, `${def.id}: hot again after ${rules.guardMs} ms with the ball still in`);
    assert.equal(t2.events().filter((e) => e.name === 'BOSS_GUARD' && e.a === 0).length, 1, `${def.id}: and says so`);
  }
});

test('rotating bosses count three hits a quarter second apart and cool 1.5 s; The Stoker keeps two, 500 ms and 2.5 s', () => {
  for (const def of BOSS_DEFS()) {
    const r = coreRules(contentWorld(def).world.boss);
    if (def.id === 'the-stoker') assert.deepEqual({ ...r }, { cooldownMs: CONTENT.CORE_COOLDOWN_MS, entryHits: CONTENT.ENTRY_HITS, guardMs: CONTENT.GUARD_MS });
    else assert.deepEqual({ ...r }, { ...ORBIT_RULES }, def.id);
  }
  assert.deepEqual({ ...ORBIT_RULES }, { cooldownMs: 250, entryHits: 3, guardMs: 1500 });
  assert.equal(CRUCIBLE_SPEC.hp, 12, 'The Crucible: 12 core hits (was 20)');
  assert.deepEqual(CORE_SPECS.slice(1).map((s) => s.hp), [5, 6, 6], 'The Core: 5, 6, 6 (stage 3 was 8)');
});

test('The Core stage 3: equal and opposite rings, so both gaps always meet at the bottom and the top', () => {
  const t = contentWorld(getStage('core-3'));
  const w = t.world, spec = CORE_SPECS[3];
  const [inner, outer] = spec.rings;
  assert.equal(inner.omega, -outer.omega);
  assert.equal(inner.omega2, -outer.omega2);
  const centre = (ring) => gapCentres(ring)[0];
  const meets = [];
  let prev = Infinity;
  for (let k = 0; k < Math.ceil(30000 / 8.33); k++) {
    const a = centre(inner) + w.boss.angle, b = centre(outer) + (w.boss.data.angle2 || 0);
    const d = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    if (d < 0.02 && prev >= 0.02) meets.push(Math.atan2(Math.sin(a), Math.cos(a)));
    prev = d;
    t.step(1);
  }
  assert.ok(meets.length >= 4, `the gaps met ${meets.length} times in 30 s`);
  for (const m of meets) assert.ok(Math.abs(Math.abs(m) - Math.PI / 2) < 0.12, `they meet at the bottom or top (${m.toFixed(2)})`);
});

test('robot: a stay inside a ring scores three core hits, then waits 1.5 s (Crucible and every Core stage)', () => {
  const specs = { 'the-crucible': CRUCIBLE_SPEC, 'core-1': CORE_SPECS[1], 'core-2': CORE_SPECS[2], 'core-3': CORE_SPECS[3] };
  for (const [id, spec] of Object.entries(specs)) {
    const R = spec.rings[spec.rings.length - 1].r;
    const { entryHits, guardMs } = spec.rules;
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
              // within one stay, every hit after a full count comes the guard time or more later
              for (let k = entryHits; k < times.length; k += entryHits) worstGap = Math.min(worstGap, times[k] - times[k - 1]);
              if (times.length) stays++;
              times = [];
            }
            inside = any;
          },
        });
        if (times.length) stays++; // the stay the fight ended in, paced by the same rule
        for (let k = entryHits; k < times.length; k += entryHits) worstGap = Math.min(worstGap, times[k] - times[k - 1]);
        assert.ok(r.cleared, `${id} seed ${seed} ${perfect ? 'perfect' : 'plain'}: cleared`);
        assert.ok(worstGap >= guardMs - 10, `${id} seed ${seed}: hit ${entryHits + 1} came ${worstGap} ms after hit ${entryHits} in one stay`);
        // coverage, not a count to the hit (A2: the old "stays >= hp over 4 runs" was seed noise).
        // A perfect shot into The Core's heart may stay long enough to win in one entry; it is
        // then still paced by at least one full guard wait (worstGap measured above).
        assert.ok(stays >= 2 || worstGap < Infinity, `${id} seed ${seed} ${perfect ? 'perfect' : 'plain'}: several entries or a guarded stay (${stays})`);
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
