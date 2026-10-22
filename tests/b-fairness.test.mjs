// B: fairness of hazards and bosses for a person, not just the robot (src/content/sentries.js,
// bosses/stoker.js, content.js HAZARD_HIT). PLAN §1 frustration fixes: no ball-eating holes,
// shrink only from a red drop the player chose to catch, every attack readable.

import { test, assert } from './lib.mjs';
import { HAZARD, PADDLE, RING, HORIZONTAL, DROP } from '../src/core/constants.js';
import { LEVELS, getLevel, stagesOf } from '../src/levels/index.js';
import { generateOverburn } from '../src/levels/overburn.js';
import { createWorld } from '../src/core/world.js';
import { runHeadless } from '../src/core/headless.js';
import { makeSystems } from '../src/systems.js';
import { createRun } from '../src/economy/economy.js';
import { createRobot } from '../src/sim/robot.js';
import { contentWorld } from './fixtures/B/helpers.mjs';
import { createSloppyRobot } from './fixtures/B/sloppy.mjs';

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

/** Every level, stage and Overburn wave (8 days × waves 1-40) that carries a bomber. */
function bomberDefs() {
  const out = [];
  for (const l of LEVELS) for (const d of stagesOf(l)) if ((d.sentries || []).some((s) => s.kind === 'bomber')) out.push(d);
  for (let seed = 1; seed <= 8; seed++) {
    for (let wave = 1; wave <= 40; wave++) {
      const d = generateOverburn(seed * 7919, wave);
      if ((d.sentries || []).some((s) => s.kind === 'bomber')) out.push(d);
    }
  }
  return out;
}

test('sentry bombs give at least 1 s to see them coming, on every level and Overburn wave', () => {
  const defs = bomberDefs();
  assert.ok(defs.length >= 10, `bombers to check (${defs.length})`);
  let bombs = 0;
  for (const def of defs) {
    const t = contentWorld(def);
    t.step(Math.ceil(70000 / 8.33)); // 70 s: marching walls push the bombers down as far as they go
    const mine = t.hazards.filter((h) => h.kind === HAZARD.BOMB);
    assert.ok(mine.length >= 1, `${def.id}: the bomber fired`);
    for (const h of mine) {
      const s = secondsToPaddle(def.mode || 'bottom', h);
      assert.ok(s >= 1.0, `${def.id}: a bomb reaches the paddle line in ${s.toFixed(2)} s (from ${h.x.toFixed(0)}, ${h.y.toFixed(0)})`);
    }
    bombs += mine.length;
  }
  assert.ok(bombs > 100, `bombs checked (${bombs})`);
});

/** Share of play steps with the paddle shrunk, plain robot, over seeds; every stage counts. */
function shrunkShare(n, seeds) {
  let play = 0, shrunk = 0, hits = 0;
  for (const s of seeds) {
    const run = createRun({ seed: s, levelN: n });
    for (const d of stagesOf(getLevel(n))) {
      const world = createWorld({ level: d, seed: s * 1000 + 31 * d.n + (d.stage | 0), run, systems: makeSystems() });
      const r = runHeadless(world, createRobot({ perfect: false }), {
        maxSimMs: 6 * 60 * 1000,
        onStep(w) {
          if (w.phase !== 'play') return;
          play++;
          if (w.econ.effectMs[DROP.SHRINK] > 0) shrunk++;
        },
      });
      hits += r.livesLost;
      if (!r.cleared) break;
    }
  }
  return { share: shrunk / Math.max(1, play), play };
}

test('hazards never shrink the paddle: boss and sentry levels keep it full width (robot, 2 seeds)', () => {
  const levels = LEVELS.filter((l) => l.kind === 'boss' || stagesOf(l).some((d) => (d.sentries || []).length)).map((l) => l.n);
  assert.ok(levels.includes(10) && levels.includes(18) && levels.includes(29) && levels.includes(30));
  for (const n of levels) {
    const { share } = shrunkShare(n, [1, 2]);
    assert.ok(share <= 0.2, `${n} ${getLevel(n).name}: the paddle was shrunk ${(share * 100).toFixed(0)}% of play`);
  }
}, { timeout: 60000 });

/** Median seconds to clear level n for the imprecise robot; also runs lost. */
function sloppyClears(n, seeds, err) {
  const times = [];
  let over = 0;
  for (const s of seeds) {
    const run = createRun({ seed: s, levelN: n });
    let total = 0, ok = true;
    for (const d of stagesOf(getLevel(n))) {
      const world = createWorld({ level: d, seed: s * 1000 + 31 * d.n + (d.stage | 0), run, systems: makeSystems() });
      const r = runHeadless(world, createSloppyRobot(s * 7 + d.n, { errUnits: err }), { maxSimMs: 8 * 60 * 1000 });
      total += r.simMs / 1000;
      if (!r.cleared) { ok = false; if (r.phase === 'over') over++; break; }
    }
    times.push(ok ? total : Infinity);
  }
  times.sort((a, b) => a - b);
  return { median: times[times.length >> 1], over };
}

test('The Stoker is fair for an imprecise player: within 1.5x of levels 8 and 9, no run lost (aim error ±12)', () => {
  const seeds = [1, 2, 3, 4];
  const ref = [8, 9].map((n) => sloppyClears(n, seeds, 12));
  const stoker = sloppyClears(10, seeds, 12);
  assert.equal(stoker.over, 0, 'no run ends at The Stoker');
  const base = Math.max(ref[0].median, ref[1].median);
  assert.ok(stoker.median <= 1.5 * base, `The Stoker ${stoker.median.toFixed(0)} s vs levels 8 and 9 ${ref.map((r) => r.median.toFixed(0)).join(' / ')} s`);
}, { timeout: 60000 });
