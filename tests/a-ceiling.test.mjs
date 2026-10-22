// A: the ceiling (PLAN.md 11, 2026-10-22; ART.md 12a.1; src/sim/ceiling.js).
// Every bottom level gets a top wall 120 units above its highest brick at level start (at least 60
// units of clear space, never above y 90), every left level a far wall 120 units past its farthest
// column, ring levels none; boss parts count with their whole turn. The ball, lasers and the
// robot's casts never pass it, and no brick in play is ever cut by it (a-clearable checks that on
// every step of every robot clear). Levels B still has to move are listed with the reason.
// A2 calls (K/status/A2.md, review 2026-10-22):
// - nothing to reach over the top (no breakable or weak brick within 120 of the top, no turning
//   boss part): 60 clear instead of 120 (The Stoker);
// - bricks that enter later (march feed rows, scrolled rows) keep 60 clear above their entry line;
// - left mode: the far wall never goes past the field edge (x 720), so a far column within 120 of
//   it leaves less than 120 clear, the way y 90 does in bottom mode; under 60 is a Request to B;
// - boss armour skated over (the ball past the boss's top edge, or far edge in left mode) is a dead
//   bounce for the anti-loop rules, so a ball skating over The Stoker's head gets nudged.
import { readFileSync, readdirSync } from 'node:fs';
import { test, assert, eventStreamHasher } from './lib.mjs';
import { CEILING, FIELD, SPEED, BF } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { createWorld, stepWorld } from '../src/core/world.js';
import { createInputFrame } from '../src/core/input-frame.js';
import { makeSystems } from '../src/systems.js';
import { LEVELS, getStage, stagesOf, generateOverburn } from '../src/levels/index.js';
import { createRun } from '../src/economy/economy.js';
import { createRobot } from '../src/sim/robot.js';
import { runHeadless } from '../src/core/headless.js';
import { computeField, brickReach, entryLine, topBandUseful } from '../src/sim/ceiling.js';
import { createBrickGrid, rebuildGrid } from '../src/sim/collide.js';
import { createCaster, castPath } from '../src/sim/aim.js';
import { moveBall } from '../src/sim/ball.js';
import { nudge } from '../src/sim/feel.js';
import { LASER_HALF } from '../src/sim/bodies.js';
import { createRng } from '../src/core/rng.js';
import { M_BOTTOM, M_LEFT } from '../src/sim/field.js';
import { physicsWorld, launchAt, recorder, steps, SOLID } from './fixtures/A/sim.mjs';
import { ceilingProblem } from './fixtures/A/ceiling.mjs';

/**
 * Levels that cannot keep the rule with today's level data, with the reason. Each is a Request to
 * B in K/status/A2.md. The check below still holds them to everything else (the ceiling never sits
 * below where bricks enter, never cuts a brick at the start).
 */
const RULE_PENDING = Object.freeze({
  // empty since B's 932d7b8 (2026-10-22): march feed rows enter on the wall's starting top row,
  // The Flue's rows join at y 150, Broadside sits 60 nearer the paddle, level.entryY on every level
});

const field = (w) => ({ ceilingY: w.field.ceilingY, farX: w.field.farX, clear: w.field.clear });
const levelWorld = (def, seed = 1) => createWorld({ level: def, seed, run: createRun({ seed, levelN: def.n }), systems: makeSystems() });

/**
 * The rule, checked on a world at level start. Returns '' or what is wrong. `pending` relaxes only
 * the clear-space and y 90 parts (never the entry line, never a cut).
 */
function ruleProblem(w, pending) {
  const F = w.field, mode = w.level.mode;
  const R = brickReach(w, { top: 0, far: 0, n: 0, turning: 0 });
  if (mode === 'ring' || R.n === 0) {
    return F.ceilingY === 0 && F.farX === FIELD.W && F.clear === 0 ? '' : `no ceiling expected, got ${JSON.stringify(field(w))}`;
  }
  const mc = mode === 'bottom' ? M_BOTTOM : M_LEFT;
  const gap = topBandUseful(w, mc, R) ? CEILING.GAP : CEILING.MIN_CLEAR;
  if (F.gap !== gap) return `gap ${F.gap}, want ${gap} (${gap === CEILING.GAP ? 'something to reach over the top' : 'nothing to reach over the top'})`;
  if (mode === 'bottom') {
    if (F.farX !== FIELD.W) return `bottom mode keeps the side wall at ${FIELD.W}`;
    const top = Math.floor(R.top);
    if (F.ceilingY < 0 || F.ceilingY > top) return `ceiling ${F.ceilingY} cuts the starting wall (top ${top})`;
    const e = entryLine(w);
    if (Number.isFinite(e) && F.ceilingY > Math.max(0, e - CEILING.MIN_CLEAR)) return `ceiling ${F.ceilingY} leaves under ${CEILING.MIN_CLEAR} above the entry line ${e}`;
    if (F.clear !== top - F.ceilingY) return `clear ${F.clear} != ${top - F.ceilingY}`;
    if (pending) return '';
    if (F.ceilingY !== Math.max(CEILING.TOP_MIN, top - gap)) return `ceiling ${F.ceilingY} for a top edge of ${top}`;
  } else {
    if (F.ceilingY !== 0) return 'left mode keeps the top side wall at 0';
    const far = Math.ceil(R.far);
    if (F.farX > FIELD.W || F.farX < far) return `far wall ${F.farX} cuts the starting wall (far edge ${far})`;
    // the far wall sits `gap` past the far column, or at the field edge when that is nearer (Call)
    if (F.farX !== Math.min(FIELD.W, far + gap)) return `far wall ${F.farX} for a far edge of ${far}`;
    if (F.clear !== F.farX - far) return `clear ${F.clear} != ${F.farX - far}`;
    if (pending) return '';
  }
  if (F.clear < CEILING.MIN_CLEAR || F.clear > gap) return `clear space ${F.clear} (want ${CEILING.MIN_CLEAR} to ${gap})`;
  return '';
}

// ---------------------------------------------------------------- the rule on hand-made fields

test('the rule: 120 above the highest brick, never above y 90, never less than 60 clear', () => {
  const at = (y, extra = {}) => physicsWorld({ bricks: [{ x: 90, y: y + 15 }, { x: 330, y: y + 75 }], ceiling: true, ...extra }).world;
  assert.deepEqual(field(at(480)), { ceilingY: 360, farX: 720, clear: 120 });
  assert.deepEqual(field(at(180)), { ceilingY: 90, farX: 720, clear: 90 }, 'never above y 90');
  assert.deepEqual(field(at(150)), { ceilingY: 90, farX: 720, clear: 60 });
  assert.deepEqual(field(at(120)), { ceilingY: 60, farX: 720, clear: 60 }, '60 clear wins over y 90');
  assert.deepEqual(field(at(30)), { ceilingY: 0, farX: 720, clear: 30 }, 'never above the field top');
  assert.deepEqual(field(physicsWorld({ ceiling: true }).world), { ceilingY: 0, farX: 720, clear: 0 }, 'no bricks, no ceiling');
  // a brick that is not in play yet (hidden) does not count
  const hid = physicsWorld({ bricks: [{ x: 90, y: 495 }, { x: 90, y: 105, flags: SOLID | BF.HIDDEN }], ceiling: true }).world;
  assert.equal(hid.field.ceilingY, 360);
});

test('the far wall in left mode, none in ring mode', () => {
  const left = (x) => physicsWorld({ mode: 'left', bricks: [{ x, y: 540, w: 30, h: 60 }, { x: x - 120, y: 300, w: 30, h: 60 }], ceiling: true }).world;
  assert.deepEqual(field(left(495)), { ceilingY: 0, farX: 630, clear: 120 });
  assert.deepEqual(field(left(675)), { ceilingY: 0, farX: 720, clear: 30 }, 'never past the field edge');
  const ring = physicsWorld({ mode: 'ring', bricks: [{ x: 360, y: 540, w: 30, h: 30 }], ceiling: true }).world;
  assert.deepEqual(field(ring), { ceilingY: 0, farX: 720, clear: 0 });
});

test('bricks that come into play later enter 60 or more below the ceiling', () => {
  const rules = { marchMs: 15000, marchRows: ['bbbbbbbbbbbb'], marchFeed: 4 };
  const { world } = physicsWorld({ bricks: [{ x: 90, y: 495 }], rules, ceiling: true });
  assert.equal(entryLine(world), 90, 'today a march feed enters on grid row 0');
  // review 2026-10-22: at y 90 the feed rows sat flush against the ceiling and the ball could not
  // get behind them (Compactor break-throughs 12 to 3); they keep 60 clear above them
  assert.equal(world.field.ceilingY, 30);
  world.level.entryY = 480; // B moves the feed to the wall's starting top row
  computeField(world);
  assert.equal(world.field.ceilingY, 360);
  assert.equal(world.field.clear, 120);
  world.level.entryY = 400; // a feed line inside the 120: it still keeps 60 above it
  computeField(world);
  assert.equal(world.field.ceilingY, 340);
  const none = physicsWorld({ bricks: [{ x: 90, y: 495 }], rules: { ...rules, marchFeed: 0 }, ceiling: true }).world;
  assert.equal(none.field.ceilingY, 360, 'a march with nothing to feed needs no room');
  const scroll = physicsWorld({ bricks: [{ x: 90, y: 495 }], rules: { scrollSpeed: 70 }, ceiling: true }).world;
  assert.equal(scroll.field.ceilingY, 0, 'scrolled rows are revealed at the field top today');
});

test('a boss part that turns counts with its whole turn', () => {
  // a plate 150 from the boss centre (360, 420) now level with it: at the top of its turn its top
  // edge is at 420 - 150 - 15 = 255
  const { world, physics } = physicsWorld({
    bricks: [{ x: 510, y: 420, w: 30, h: 30, flags: SOLID | BF.BOSS | BF.MOVING }, { x: 90, y: 615 }],
  });
  Object.assign(world.boss, { active: true, x: 360, y: 420, px: 360, py: 420 });
  computeField(world);
  assert.deepEqual(field(world), { ceilingY: 135, farX: 720, clear: 120 });
  // a still boss part (the Stoker's head sways sideways only) counts where it is
  world.bricks.flags[0] = SOLID | BF.BOSS;
  computeField(world);
  assert.equal(world.field.ceilingY, 285);
  void physics;
});

test('nothing to reach over the top: 60 clear instead of 120 (The Stoker)', () => {
  const ARMOUR = BF.SOLID | BF.BOSS; // unbreakable boss plate
  // a wall of armour (top edge 400) with breakable bricks only 120 or more below its top
  const wall = (extra = []) => physicsWorld({
    bricks: [{ x: 300, y: 415, flags: ARMOUR }, { x: 360, y: 445, flags: ARMOUR }, { x: 90, y: 535 }, ...extra], ceiling: true,
  }).world;
  assert.deepEqual({ ...field(wall()), gap: wall().field.gap }, { ceilingY: 340, farX: 720, clear: 60, gap: 60 });
  // a breakable brick inside the top band (top edge 505 < 400 + 120): a break-through has something to break
  assert.equal(wall([{ x: 600, y: 520 }]).field.ceilingY, 280);
  // a boss weak point in the band counts the same
  assert.equal(wall([{ x: 600, y: 520, flags: BF.SOLID | BF.BOSS | BF.WEAK }]).field.ceilingY, 280);
  // indestructible bricks on top of a plain wall: nothing to break up there either
  assert.equal(wall([{ x: 600, y: 415, flags: BF.SOLID }]).field.ceilingY, 340);
  // a boss part that turns: the ball must get round it to the opening, so 120
  const turn = physicsWorld({ bricks: [{ x: 360, y: 415, flags: ARMOUR | BF.MOVING }, { x: 90, y: 615 }] }).world;
  Object.assign(turn.boss, { active: true, x: 360, y: 415, px: 360, py: 415 });
  computeField(turn);
  assert.equal(turn.field.gap, 120);
  // left mode: the same rule along x
  const left = physicsWorld({ mode: 'left', bricks: [{ x: 495, y: 300, w: 30, h: 60, flags: ARMOUR }, { x: 300, y: 300, w: 30, h: 60 }], ceiling: true }).world;
  assert.deepEqual(field(left), { ceilingY: 0, farX: 570, clear: 60 });
  // the campaign: only The Stoker (plates on top, the core and jaw inside and below) qualifies
  for (const level of LEVELS) {
    for (const def of stagesOf(level)) {
      const w = levelWorld(def);
      if (w.level.mode === 'ring') continue;
      assert.equal(w.field.gap, def.id === 'the-stoker' ? 60 : 120, `${def.id}: gap ${w.field.gap}`);
    }
  }
  assert.deepEqual(field(levelWorld(getStage('the-stoker'))), { ceilingY: 300, farX: 720, clear: 60 });
});

test('boss armour skated over is a dead bounce; level with or inside the boss it is progress', () => {
  const ARMOUR = BF.SOLID | BF.BOSS;
  const hitOnce = (y, vy, extra = []) => {
    const { world, frame } = physicsWorld({ bricks: [{ x: 360, y: 415, flags: ARMOUR }, { x: 60, y: 900 }, ...extra] });
    const b = launchAt(world, 360, y, 0, vy);
    b.bouncesNoBrick = 5;
    const rec = recorder(world);
    let hit = -1;
    steps(world, frame, 60, () => { if (hit < 0 && rec().some((e) => e.type === EV.BRICK_HIT)) hit = b.bouncesNoBrick; });
    return hit;
  };
  assert.equal(hitOnce(330, SPEED.TIERS[0]), 6, 'onto the top of the boss: one more dead bounce');
  assert.equal(hitOnce(500, -SPEED.TIERS[0]), 0, 'into it from below: progress');
  // the same plate as the floor of a ring (a plate of the same boss 200 higher): the ball is inside
  // the boss, rattling round its core, and that is the fight (The Crucible, The Core)
  assert.equal(hitOnce(330, SPEED.TIERS[0], [{ x: 600, y: 215, flags: ARMOUR }]), 0, 'inside the boss: progress');
  // a ball skating in a 60-unit band between the ceiling and a full-width plate gets nudged for
  // bounces with nothing broken (before 2026-10-22 every plate hit counted as progress: no nudge)
  const plates = [];
  for (let x = 30; x < 720; x += 60) plates.push({ x, y: 415, flags: ARMOUR });
  plates.push({ x: 60, y: 900 });
  const { world, frame } = physicsWorld({ bricks: plates, ceiling: true });
  assert.equal(world.field.ceilingY, 340);
  world.paddle.x = 60;
  const ang = 30 * Math.PI / 180;
  launchAt(world, 200, 370, Math.cos(ang) * SPEED.TIERS[0], -Math.sin(ang) * SPEED.TIERS[0]);
  const rec = recorder(world);
  steps(world, frame, 6 * 120);
  // NUDGE b = reason: 0 bounces with nothing broken, 1 a repeated pattern (both count dead bounces)
  const nudges = rec().filter((e) => e.type === EV.NUDGE && (e.b === 0 || e.b === 1));
  assert.ok(nudges.length >= 1, 'nudged for bounces with nothing broken');
});

test('a nudge for bounces with nothing broken turns the ball toward the diagonal', () => {
  // a ball skating flat (12 degrees) or rattling almost straight across a narrow band (85) turns
  // toward 45 degrees off the paddle track, never further away (a random turn walked it back and
  // forth: 16 s over The Stoker's head on one seed)
  const s = SPEED.TIERS[0];
  for (const [mode, deg0, sx] of [['bottom', 85, 1], ['bottom', 85, -1], ['bottom', 12, 1], ['bottom', 12, -1], ['bottom', -80, 1], ['left', 85, 1], ['left', 12, -1]]) {
    const { world, ctx } = physicsWorld({ mode, bricks: [{ x: 600, y: 900, w: 30, h: 30 }] });
    const a = deg0 * Math.PI / 180;
    const b = mode === 'bottom'
      ? launchAt(world, 360, 500, sx * Math.cos(a) * s, -Math.sin(a) * s)
      : launchAt(world, 300, 540, Math.sin(a) * s, sx * Math.cos(a) * s);
    const off = () => (mode === 'bottom' ? Math.atan2(Math.abs(b.vy), Math.abs(b.vx)) : Math.atan2(Math.abs(b.vx), Math.abs(b.vy))) * 180 / Math.PI;
    const before = Math.abs(off() - 45);
    for (const reason of [0, 1]) {
      const was = Math.abs(off() - 45);
      nudge(ctx, 0, reason);
      assert.ok(Math.abs(off() - 45) <= was - 3.9, `${mode} ${deg0} reason ${reason}: ${was.toFixed(1)} to ${Math.abs(off() - 45).toFixed(1)} off the diagonal`);
    }
    assert.ok(Math.abs(off() - 45) < before);
  }
});

test('The Stoker: no ball skates over its head for long (perfect robot, seeds 16-30)', () => {
  // review 2026-10-22: 11.85 s and 25 armour hits in a row with no nudge on seed 23; main 19.7 s
  let worst = 0, worstAt = '';
  for (let seed = 16; seed <= 30; seed++) {
    const def = getStage('the-stoker');
    const w = createWorld({ level: def, seed: seed * 1000 + def.n * 31 + 1, run: createRun({ seed, levelN: def.n }), systems: makeSystems() });
    const B = w.bricks;
    let top0 = Infinity;
    for (let i = 0; i < B.count; i++) if (B.alive[i] && !(B.flags[i] & BF.HIDDEN)) top0 = Math.min(top0, B.y[i] - B.h[i] / 2);
    const since = new Float64Array(w.balls.length).fill(-1);
    const rd = recorder(w);
    runHeadless(w, createRobot({ perfect: true }), {
      maxSimMs: 120000,
      onStep: (ww) => {
        const broke = rd().some((e) => e.type === EV.BRICK_BROKEN || e.type === EV.BOSS_HIT);
        for (let i = 0; i < ww.balls.length; i++) {
          const b = ww.balls[i];
          const up = b.alive && !b.held && b.y < top0;
          if (!up || broke) since[i] = -1;
          else if (since[i] < 0) since[i] = ww.time;
          else if (ww.time - since[i] > worst) { worst = ww.time - since[i]; worstAt = `seed ${seed} t ${(ww.time / 1000).toFixed(1)} s`; }
        }
      },
    });
  }
  assert.ok(worst <= 6000, `longest stretch over the head with nothing broken: ${(worst / 1000).toFixed(2)} s (${worstAt})`);
}, { timeout: 120000 });

test('release: the renderer draws the ceiling from world.field (deploy holds until it does)', () => {
  // A ceiling the renderer does not draw is a ball bouncing off empty air (review 2026-10-22,
  // ART 12a.1: bar, glass pane, camera reframed). Between releases this only prints; with
  // KILN_RELEASE=1 (G's deploy) it fails, so nothing ships until C reads world.field.
  const dir = new URL('../src/render/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.js'));
  const src = files.map((f) => readFileSync(new URL(String(f), dir), 'utf8')).join('\n');
  const missing = ['ceilingY', 'farX'].filter((k) => !src.includes(k));
  if (process.env.KILN_RELEASE === '1') assert.deepEqual(missing, [], 'src/render never reads world.field (ART 12a.1)');
  else if (missing.length) console.log(`    pending C: src/render does not read world.field.${missing.join(' / ')} yet; a release fails here`);
});

// ---------------------------------------------------------------- what bounces off it

test('the ball bounces off the ceiling and never goes above it, even at 20x the top speed', () => {
  const bricks = [{ x: 30, y: 495 }, { x: 690, y: 495 }];
  // at a tier speed, through the whole pipeline: it meets the ceiling and comes back down
  const { world, frame } = physicsWorld({ bricks, ceiling: true });
  assert.equal(world.field.ceilingY, 360);
  const b = launchAt(world, 360, 700, 0, -SPEED.TIERS[0]);
  const rec = recorder(world);
  let minY = Infinity;
  steps(world, frame, 120, () => { if (b.y < minY) minY = b.y; });
  const walls = rec().filter((e) => e.type === EV.WALL_HIT && e.a === 2);
  assert.equal(walls.length, 1, 'it met the ceiling once');
  assert.ok(Math.abs(walls[0].y - 360) < 0.01, `the contact is on the ceiling (${walls[0].y})`);
  assert.ok(minY >= 360 + b.r - 1e-6, `highest point ${minY}`);
  assert.ok(b.vy > 0, 'on its way back down');
  // 20x the top speed at any angle, one ball step at a time (a full step would set the speed back)
  const rng = createRng(12);
  const fast = SPEED.CAP * 20;
  for (let trial = 0; trial < 200; trial++) {
    const t = physicsWorld({ bricks, ceiling: true });
    t.ctx.paddleLive = false;
    const ang = rng.range(-78, 78) * Math.PI / 180;
    const ball = launchAt(t.world, rng.range(80, 640), rng.range(380, 470), Math.sin(ang) * fast, -Math.cos(ang) * fast);
    for (let s = 0; s < 6; s++) {
      rebuildGrid(t.ctx.grid, t.world.bricks);
      ball.px = ball.x;
      ball.py = ball.y;
      moveBall(t.ctx, 0);
      assert.ok(ball.y >= 360 + ball.r - 1e-6, `trial ${trial} step ${s}: y ${ball.y.toFixed(3)} is past the ceiling`);
    }
  }
});

test('the ball bounces off the far wall in left mode', () => {
  const { world, frame } = physicsWorld({ mode: 'left', bricks: [{ x: 495, y: 105, w: 30, h: 60 }], ceiling: true });
  assert.equal(world.field.farX, 630);
  const b = launchAt(world, 200, 540, SPEED.TIERS[0], 0);
  const rec = recorder(world);
  let maxX = -Infinity;
  steps(world, frame, 120, () => { if (b.x > maxX) maxX = b.x; });
  const walls = rec().filter((e) => e.type === EV.WALL_HIT && e.a === 1);
  assert.ok(walls.length >= 1 && Math.abs(walls[0].x - 630) < 0.01, 'it met the far wall');
  assert.ok(maxX <= 630 - b.r + 1e-6, `farthest point ${maxX}`);
});

test('new balls spawn inside the ceiling/far wall with their interpolation origin inside too', () => {
  for (const mode of ['bottom', 'left', 'ring']) for (const mega of [false, true]) {
    const { world } = physicsWorld({ mode, bricks: [{ x: 495, y: 495, w: 30, h: 30 }], ceiling: true });
    world.effects.mega = mega;
    // Leave the other outer bounds alone: bottom's x and left's y still have their normal handling.
    const x = mode === 'bottom' ? -20 : 700, y = mode === 'left' ? -20 : 50;
    const slot = world.api.spawnBall(x, y, 1, 1), ball = world.balls[slot];
    assert.ok(slot >= 0);
    assert.equal(ball.x, mode === 'left' ? world.field.farX - ball.r : x, `${mode} mega ${mega}: x`);
    assert.equal(ball.y, mode === 'bottom' ? world.field.ceilingY + ball.r : y, `${mode} mega ${mega}: y`);
    assert.equal(ball.px, ball.x, 'interpolation starts at the actual spawn');
    assert.equal(ball.py, ball.y, 'interpolation starts at the actual spawn');
    const inside = world.api.spawnBall(360, 700, 1, 1), valid = world.balls[inside];
    assert.equal(valid.x, 360, 'a valid position stays unchanged');
    assert.equal(valid.y, 700, 'a valid position stays unchanged');
  }
});

test('multiball rain enters level 15 at its ceiling without interpolating through headroom', () => {
  const world = levelWorld(getStage('shrapnel'));
  const frame = createInputFrame();
  frame.action = true;
  stepWorld(world, frame);
  frame.action = false;
  let rain = null;
  for (let step = 0; step < 200 && !rain; step++) {
    stepWorld(world, frame);
    rain = world.balls.find((ball, i) => i > 0 && ball.alive);
  }
  assert.ok(rain, 'the real level timer spawned a rain ball');
  assert.ok(world.field.ceilingY > 50, 'the rain source is beyond this level\'s ceiling');
  for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
    const y = rain.py + (rain.y - rain.py) * alpha;
    assert.ok(y >= world.field.ceilingY + rain.r, `interpolation alpha ${alpha}: y ${y} stays inside`);
  }
});

test('a laser bolt that meets nothing stops at the ceiling', () => {
  const { world, frame } = physicsWorld({ bricks: [{ x: 30, y: 495 }, { x: 690, y: 495 }], ceiling: true });
  world.effects.laserShots = 5;
  launchAt(world, 600, 800, 0, SPEED.TIERS[0]);
  frame.steer = true;
  frame.tx = 360;
  frame.ty = 1000;
  steps(world, frame, 1);
  const rec = recorder(world);
  frame.action = true;
  let minTip = Infinity;
  steps(world, frame, 80, () => {
    for (const L of world.lasers) if (L.alive && L.y - LASER_HALF < minTip) minTip = L.y - LASER_HALF;
  });
  const done = rec().filter((e) => e.type === EV.LASER_DONE);
  assert.equal(done.length, 2);
  for (const e of done) assert.ok(Math.abs(e.y - 360) < 0.01, `bolt ends on the ceiling (${e.y})`);
  assert.ok(minTip >= 360 - 1e-6, `no bolt flies above it (${minTip})`);
});

test('the robot casts off the ceiling and the far wall', () => {
  for (const [mode, mc, x, y, dx, dy, at] of [['bottom', M_BOTTOM, 360, 900, 0, -1, 360], ['left', M_LEFT, 100, 540, 1, 0, 630]]) {
    const bricks = mode === 'bottom' ? [{ x: 30, y: 495 }, { x: 690, y: 495 }] : [{ x: 495, y: 105, w: 30, h: 60 }];
    const { world } = physicsWorld({ mode, bricks, ceiling: true });
    const grid = createBrickGrid(world.bricks.alive.length);
    rebuildGrid(grid, world.bricks);
    const c = createCaster(world.bricks.alive.length);
    c.spin = 0; c.decay = 0; c.t0 = 0; c.speed = SPEED.TIERS[0];
    castPath(c, world, grid, mc, x, y, dx, dy, 9, 3, 4000);
    assert.ok(c.back, `${mode}: the cast comes home`);
    assert.equal(c.bounces, 1, `${mode}: one bounce`);
    // and a cast that stops at the first bounce shows where it was
    castPath(c, world, grid, mc, x, y, dx, dy, 9, 0, 4000);
    const reach = mode === 'bottom' ? c.y : c.x;
    assert.ok(Math.abs(reach - (mode === 'bottom' ? at + 9 : at - 9)) < 0.05, `${mode}: bounce at ${reach}`);
  }
});

// ---------------------------------------------------------------- every level

test('every level and stage keeps the rule at the start (pending ones: see RULE_PENDING)', () => {
  const problems = [];
  for (const level of LEVELS) {
    for (const def of stagesOf(level)) {
      const w = levelWorld(def);
      const p = ruleProblem(w, !!RULE_PENDING[def.id]);
      if (p) problems.push(`${def.n} ${def.id}: ${p}`);
    }
  }
  assert.deepEqual(problems, []);
  for (const id of Object.keys(RULE_PENDING)) {
    const w = levelWorld(getStage(id));
    if (!ruleProblem(w, false)) console.log(`    ${id} keeps the full rule now: take it off RULE_PENDING`);
  }
});

test('boss arenas: a whole turn of every boss part stays clear of the ceiling', () => {
  for (const id of ['the-stoker', 'the-crucible', 'core-1', 'core-2']) {
    const w = levelWorld(getStage(id));
    const frame = createInputFrame(); // the ball waits on the paddle while the armour turns
    const left = w.level.mode === 'left';
    let reach = left ? -Infinity : Infinity;
    for (let s = 0; s < 15 * 120; s++) {
      stepWorld(w, frame);
      const B = w.bricks;
      for (let i = 0; i < B.count; i++) {
        if (!B.alive[i] || (B.flags[i] & BF.HIDDEN)) continue;
        if (left) reach = Math.max(reach, B.x[i] + B.w[i] / 2);
        else reach = Math.min(reach, B.y[i] - B.h[i] / 2);
      }
    }
    const room = left ? w.field.farX - reach : reach - w.field.ceilingY;
    assert.ok(room >= CEILING.MIN_CLEAR - 1e-6, `${id}: the closest a boss part came to the ceiling was ${room.toFixed(1)}`);
    if (!left) assert.ok(room <= CEILING.GAP + 1e-6, `${id}: ${room.toFixed(1)} clear above the arena`);
  }
});

test('Overburn: a sample of seeds and waves keeps the rule, and the robot plays them inside it', () => {
  const problems = [];
  const sample = [];
  for (const seed of [1, 777, 20261021, 4242]) {
    for (let wave = 1; wave <= 20; wave++) {
      const def = generateOverburn(seed, wave);
      const w = levelWorld(def, seed);
      const march = (def.rules.marchMs | 0) > 0; // feed rows enter on the wall's top row (B, 932d7b8)
      const p = ruleProblem(w, false);
      if (p) problems.push(`seed ${seed} wave ${wave} (${def.mode || 'bottom'}${march ? ', march' : ''}): ${p}`);
      if (seed === 777 || (seed === 1 && wave % 4 === 1)) sample.push({ def, seed, wave });
    }
  }
  assert.deepEqual(problems, []);
  for (const { def, seed, wave } of sample) {
    const w = levelWorld(def, seed);
    const c0 = w.field.ceilingY, f0 = w.field.farX;
    let problem = '';
    runHeadless(w, createRobot(), { maxSimMs: 45000, onStep: (ww) => { if (!problem) problem = ceilingProblem(ww, c0, f0); } });
    assert.equal(problem, '', `seed ${seed} wave ${wave}: ${problem}`);
  }
}, { timeout: 300000 });

test('determinism: the same level and seed give the same ceiling and the same game', () => {
  for (const id of ['ignition', 'the-crucible', 'core-2', 'broadside']) {
    const run = () => {
      const w = levelWorld(getStage(id), 5);
      const h = eventStreamHasher(w.bus);
      runHeadless(w, createRobot(), { maxSimMs: 30000, onStep: () => h.update() });
      h.update();
      return { f: field(w), hash: h.hex(), steps: w.step };
    };
    const a = run(), b = run();
    assert.deepEqual(a, b, `${id}: two runs of seed 5 differ`);
  }
}, { timeout: 120000 });
