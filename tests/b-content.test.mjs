// B: brick rules and level mechanics in the content system (src/content/content.js).

import { test, assert, near } from './lib.mjs';
import { SRC, BF, DROP, DROP_NAMES, HAZARD, SENTRY, WALL } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { emit } from '../src/core/bus.js';
import { CONTENT } from '../src/content/bricks.js';
import { SCROLL_ENTRY_Y } from '../src/levels/parser.js';
import { contentWorld, level, brickAt, names } from './fixtures/B/helpers.mjs';

test('plain breaks in one hit, numbered take their number', () => {
  const t = contentWorld(level(['a3..........']));
  const a = brickAt(t.world, 0, 0), n = brickAt(t.world, 0, 1);
  assert.equal(t.world.level.remaining, 2);
  t.hit(a);
  assert.equal(t.world.bricks.alive[a], 0);
  t.hit(n);
  assert.equal(t.world.bricks.hp[n], 2);
  t.hit(n);
  assert.equal(t.world.bricks.alive[n], 1);
  t.hit(n);
  assert.equal(t.world.bricks.alive[n], 0);
  assert.equal(t.world.level.remaining, 0);
  assert.deepEqual(names(t.events(), ['BRICK_BROKEN', 'BRICK_DAMAGED']), [`BRICK_BROKEN:${a}`, `BRICK_DAMAGED:${n}`, `BRICK_DAMAGED:${n}`, `BRICK_BROKEN:${n}`]);
  const rem = t.events().filter((e) => e.name === 'REMAINING').map((e) => e.a);
  assert.deepEqual(rem, [2, 1, 0]);
});

test('armour takes 3 ball hits or 1 laser', () => {
  const t = contentWorld(level(['AAA.........']));
  const [a, b, c] = [0, 1, 2].map((col) => brickAt(t.world, 0, col));
  t.hit(a);
  t.hit(a);
  assert.equal(t.world.bricks.alive[a], 1, 'two ball hits leave it standing');
  t.hit(a);
  assert.equal(t.world.bricks.alive[a], 0, 'the third breaks it');
  t.hit(b, SRC.LASER, -1);
  assert.equal(t.world.bricks.alive[b], 0, 'one laser');
  t.world.effects.fire = true;
  t.hit(c, SRC.BALL);
  assert.equal(t.world.bricks.alive[c], 0, 'one fire-ball hit');
});

test('Heavy ball deals 2 damage', () => {
  const t = contentWorld(level(['3A..........']));
  t.world.effects.ballKind = 1;
  const n = brickAt(t.world, 0, 0), a = brickAt(t.world, 0, 1);
  t.hit(n);
  assert.equal(t.world.bricks.hp[n], 1);
  t.hit(a);
  t.hit(a);
  assert.equal(t.world.bricks.alive[a], 0, 'armour falls to two heavy hits');
});

test('indestructible never breaks; portals and sealed balls ignore hits', () => {
  const t = contentWorld(level(['X(.....)....', 'CCC.........', 'C*C.........', 'CCC.........']));
  const x = brickAt(t.world, 0, 0), p = brickAt(t.world, 0, 1), s = brickAt(t.world, 2, 1);
  for (let k = 0; k < 5; k++) t.hit(x, SRC.EXPLOSION, -1);
  t.world.effects.mega = true;
  t.hit(x);
  t.hit(p);
  t.hit(s);
  assert.equal(t.world.bricks.alive[x], 1);
  assert.equal(t.world.bricks.alive[p], 1);
  assert.equal(t.world.bricks.alive[s], 1);
  assert.deepEqual(names(t.events(), ['BRICK_BROKEN', 'BRICK_DAMAGED']), []);
});

test('pierce, Mega, Purge and blasts break anything breakable outright', () => {
  const t = contentWorld(level(['9999A.......']));
  const ids = [0, 1, 2, 3, 4].map((c) => brickAt(t.world, 0, c));
  t.hit(ids[0], SRC.BALL, 0, true);
  t.hit(ids[1], SRC.MEGA, 0);
  t.hit(ids[2], SRC.OVERLOAD, -1);
  t.hit(ids[3], SRC.EXPLOSION, -1);
  t.hit(ids[4], SRC.BALL, 0, true);
  for (const i of ids) assert.equal(t.world.bricks.alive[i], 0, `brick ${i}`);
});

function chainRun() {
  const t = contentWorld(level(['.E.E........', '..E.........', '..EEE.......', 'aaaaaaaaaaaa']));
  t.hit(brickAt(t.world, 1, 2));
  t.step(60);
  return t;
}

test('explosions chain deterministically', () => {
  const a = chainRun(), b = chainRun();
  const ea = a.events().map((e) => `${e.step}:${e.name}:${e.id}`);
  const eb = b.events().map((e) => `${e.step}:${e.name}:${e.id}`);
  assert.deepEqual(ea, eb, 'same layout, same hit, same events in the same steps');
  const boom = a.events().filter((e) => e.name === 'EXPLOSION');
  const B = a.world.bricks;
  const order = boom.map((e) => `${B.row[e.id]},${B.col[e.id]}`);
  // the first blast is at once; the two in row 0 go off together in index order, then the row below
  assert.equal(order[0], '1,2');
  assert.deepEqual(order.slice(1, 3), ['0,1', '0,3']);
  assert.ok(order.includes('2,4'), 'the chain reaches the far end');
  assert.equal(boom.length, 6, 'every explosive went off once');
  const steps = boom.map((e) => e.step);
  assert.ok(steps[1] - steps[0] >= Math.floor(CONTENT.CHAIN_MS / 8.34), 'each link waits CHAIN_MS');
  for (let c = 1; c < 6; c++) assert.equal(B.alive[brickAt(a.world, 3, c)], 0, `the floor row under the chain broke (col ${c})`);
  assert.equal(B.alive[brickAt(a.world, 3, 0)], 1, 'two cells from every blast');
  assert.equal(B.alive[brickAt(a.world, 3, 11)], 1, 'outside every blast');
});

test('fire splash damages the 3 x 3 around the hit', () => {
  const t = contentWorld(level(['222.2.......', '222.........', '222.........']));
  t.world.effects.fire = true;
  t.hit(brickAt(t.world, 1, 1));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) assert.equal(t.world.bricks.hp[brickAt(t.world, r, c)], 1, `${r},${c}`);
  assert.equal(t.world.bricks.hp[brickAt(t.world, 0, 4)], 2, 'two cells away is untouched');
});

test('carriers carry a drop: fixed ones keep theirs, random ones roll from the table at load', () => {
  const d = level(['??????......'], { carriers: { '0,0': 'life' }, drops: { rate: 0.1, table: { fog: 1 } } });
  const t = contentWorld(d);
  assert.equal(t.world.bricks.drop[brickAt(t.world, 0, 0)], DROP.LIFE);
  for (let c = 1; c < 6; c++) assert.equal(t.world.bricks.drop[brickAt(t.world, 0, c)], DROP.FOG);
  const u = contentWorld(level(['??????......']));
  for (let c = 0; c < 6; c++) {
    const k = u.world.bricks.drop[brickAt(u.world, 0, c)];
    assert.ok(k >= 0 && k < DROP_NAMES.length);
  }
  const again = contentWorld(level(['??????......']));
  assert.deepEqual([...again.world.bricks.drop.slice(0, 6)], [...u.world.bricks.drop.slice(0, 6)], 'same seed, same rolls');
});

test('purgeRows clears the 3 rows nearest the paddle', () => {
  const t = contentWorld(level(['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc', '2222222222X2', 'aaaaaaaaaaaa']));
  const broke = t.world.api.purgeRows(3);
  assert.equal(broke, 35);
  for (let c = 0; c < 12; c++) {
    assert.equal(t.world.bricks.alive[brickAt(t.world, 0, c)], 1);
    assert.equal(t.world.bricks.alive[brickAt(t.world, 1, c)], 1);
    assert.equal(t.world.bricks.alive[brickAt(t.world, 4, c)], 0);
  }
  assert.equal(t.world.bricks.alive[brickAt(t.world, 3, 10)], 1, 'indestructible stays');
  assert.equal(t.events().find((e) => e.name === 'PURGED').a, 3);
});

test('gravity bricks fall when undermined, hit what they land on, shatter below the wall', () => {
  const t = contentWorld(level(['G...G.......', 'G...a.......', 'a...........', '............', '2...........']));
  const top = brickAt(t.world, 0, 0), mid = brickAt(t.world, 1, 0), num = brickAt(t.world, 4, 0);
  t.step(2);
  assert.equal(t.world.bricks.flags[mid] & BF.FALLING, 0, 'standing on a brick');
  t.hit(brickAt(t.world, 2, 0));
  t.step(120);
  const B = t.world.bricks;
  assert.equal(B.hp[num], 1, 'the landing knocked a hit off the 2');
  assert.equal(B.flags[mid] & BF.FALLING, 0);
  assert.equal(B.y[mid] + B.h[mid] / 2, B.y[num] - B.h[num] / 2, 'it rests on the brick it hit');
  assert.equal(B.y[top] + B.h[top] / 2, B.y[mid] - B.h[mid] / 2, 'the one above came down too');
  const ev = t.events();
  assert.equal(ev.filter((e) => e.name === 'GRAVITY_FALL').length, 2);
  assert.equal(ev.filter((e) => e.name === 'GRAVITY_LAND').length, 2);
  // knock the footing out from under the other tower: nothing below, it shatters
  const g2 = brickAt(t.world, 0, 4);
  t.hit(brickAt(t.world, 1, 4));
  t.step(240);
  assert.equal(B.alive[g2], 0);
  const shattered = t.events().find((e) => e.name === 'BRICK_BROKEN' && e.id === g2);
  assert.equal(shattered.b, SRC.GRAVITY);
});

test('a broken shell frees its sealed ball: a new ball and CAVITY_OPENED', () => {
  const t = contentWorld(level(['CCC.........', 'C*C.........', 'CCC.........']));
  const below = brickAt(t.world, 2, 1), sealed = brickAt(t.world, 1, 1);
  t.hit(below);
  assert.equal(t.spawned.length, 0, 'a shell takes two hits');
  t.hit(below);
  assert.equal(t.spawned.length, 1);
  assert.ok(t.spawned[0].vy > 0, 'the ball leaves through the hole (down)');
  assert.equal(t.world.bricks.alive[sealed], 0);
  const ev = t.events().find((e) => e.name === 'CAVITY_OPENED');
  assert.equal(ev.id, sealed);
  assert.equal(ev.a, t.spawned[0].i);
  t.hit(brickAt(t.world, 0, 1));
  assert.equal(t.spawned.length, 1, 'freed once');
});

test('moving rows bounce inside the field; wrapping rows loop around', () => {
  const t = contentWorld(level(['aaa.........', '............', 'a...........'], {
    motion: [{ row: 0, speed: 200, dir: 1 }, { row: 2, speed: 400, dir: -1, style: 'wrap' }],
  }));
  const B = t.world.bricks;
  const r0 = [0, 1, 2].map((c) => brickAt(t.world, 0, c));
  const w = brickAt(t.world, 2, 0);
  assert.ok(B.flags[r0[0]] & BF.MOVING);
  let minX = 1e9, maxX = -1e9, wrapped = false, lastW = B.x[w];
  for (let k = 0; k < 900; k++) {
    t.step();
    for (const i of r0) {
      minX = Math.min(minX, B.x[i] - B.w[i] / 2);
      maxX = Math.max(maxX, B.x[i] + B.w[i] / 2);
    }
    if (B.x[w] > lastW + 100) wrapped = true;
    lastW = B.x[w];
    near(B.x[r0[1]] - B.x[r0[0]], 60, 1e-3, 'the row keeps its shape');
  }
  assert.ok(minX >= -1e-3 && maxX <= 720 + 1e-3, `inside the field: ${minX}..${maxX}`);
  assert.ok(minX < 1 && maxX > 719, 'it reached both walls');
  assert.ok(wrapped, 'the wrapping row came back in on the other side');
});

test('march-down steps the wall, feeds rows on its own top and burns bricks at the danger line', () => {
  const rows = Array(20).fill('............');
  rows[6] = 'aaaaaaaaaaaa';
  rows[19] = 'c...........';
  const t = contentWorld(level(rows, { rules: { marchMs: 500, marchRows: ['bbbbbbbbbbbb'], marchFeed: 2 } }));
  const B = t.world.bricks;
  const first = brickAt(t.world, 6, 0), low = brickAt(t.world, 19, 0);
  const y0 = B.y[first];
  assert.equal(t.world.level.entryY, y0 - 15, 'physics knows where rows enter: the wall top at the start');
  t.step(Math.ceil((500 + CONTENT.MARCH_SHIFT_MS) / 8.33) + 2);
  near(B.y[first], y0 + 30, 1e-3, 'one row down');
  const spawned = t.events().filter((e) => e.name === 'BRICK_SPAWNED');
  assert.equal(spawned.length, 12, 'a new row entered on top');
  for (const e of spawned) near(B.y[e.id], y0, 1e-3, 'where the top row started, touching the wall (not at the field top)');
  assert.equal(t.world.level.remaining, 25);
  t.step(4 * 110);
  assert.equal(B.alive[low], 0, 'the lowest brick crossed the danger line');
  const burnt = t.events().find((e) => e.name === 'BRICK_BURNT');
  assert.equal(burnt.id, low);
  assert.ok(B.y[low] + B.h[low] / 2 > WALL.DANGER_Y);
  assert.ok(!t.events().some((e) => e.name === 'BRICK_BROKEN' && e.id === low), 'no score, no embers');
  assert.equal(t.events().filter((e) => e.name === 'BRICK_SPAWNED').length, 24, 'the feed stops after marchFeed rows');
});

test('The Flue: the wall slides down when cleared from below and reveals hidden rows', () => {
  const rows = Array(25).fill('............');
  rows[0] = 'aaaaaaaaaaaa';
  rows[1] = 'bbbbbbbbbbbb';
  rows[2] = 'cccccccccccc';
  const t = contentWorld(level(rows, { rules: { scrollSpeed: 300 } }));
  const B = t.world.bricks;
  const hidden = brickAt(t.world, 0, 0);
  assert.ok(B.flags[hidden] & BF.HIDDEN, 'rows above the entry line start hidden');
  assert.equal(t.world.level.remaining, 36, 'hidden rows still count');
  assert.equal(t.world.level.entryY, SCROLL_ENTRY_Y, 'physics knows where rows join play');
  const top0 = B.y[hidden] - B.h[hidden] / 2;
  t.step(200);
  assert.equal(B.flags[hidden] & BF.HIDDEN, 0, 'revealed');
  assert.ok(Math.abs(B.y[hidden] - B.h[hidden] / 2 - SCROLL_ENTRY_Y) < 0.01, 'the top row stops on the entry line');
  near(t.world.level.scrollY, (SCROLL_ENTRY_Y - top0) / 30, 1e-3, 'the wall slid until its top row reached the line');
  assert.ok(t.events().filter((e) => e.name === 'ROWS_ADVANCED').length >= 1);
  assert.equal(B.flags[hidden] & BF.MOVING, 0, 'the wall settles when the hidden rows are in');
});

test('The Flue: a row never joins play around a ball; it waits until the ball has gone', () => {
  const rows = Array(25).fill('............');
  rows[0] = 'aaaaaaaaaaaa';
  rows[1] = 'bbbbbbbbbbbb';
  rows[2] = 'cccccccccccc';
  const t = contentWorld(level(rows, { rules: { scrollSpeed: 300 } }));
  const B = t.world.bricks;
  const top = brickAt(t.world, 0, 0), side = brickAt(t.world, 0, 6);
  // a still ball (no physics here) right where the top row's first brick will come to rest
  const ball = t.world.balls[0];
  Object.assign(ball, { alive: true, held: false, x: B.x[top], y: SCROLL_ENTRY_Y + 15, px: B.x[top], py: SCROLL_ENTRY_Y + 15, vx: 0, vy: 0 });
  t.step(200);
  assert.ok(B.flags[top] & BF.HIDDEN, 'still hidden while the ball is inside its cell');
  assert.equal(B.flags[side] & BF.HIDDEN, 0, 'the rest of the row came in');
  ball.y = ball.py = 900;
  t.step(1);
  assert.equal(B.flags[top] & BF.HIDDEN, 0, 'in as soon as the ball has gone, though the wall has stopped');
});

test('timed levels count down, emit TIMER once a second and end with remaining 0', () => {
  const t = contentWorld(level(['aaaaaaaaaaaa'], { kind: 'bonus', rules: { timerMs: 2000 } }));
  t.step(260);
  assert.equal(t.world.level.timeLeftMs, 0);
  assert.equal(t.world.level.remaining, 0);
  assert.deepEqual(t.events().filter((e) => e.name === 'TIMER').map((e) => e.a), [2, 1, 0]);
});

test('multiball rain and Fever spawn balls', () => {
  const t = contentWorld(level(['aaaaaaaaaaaa'], { kind: 'bonus', rules: { timerMs: 20000, rainMs: 500 } }));
  t.step(130);
  assert.equal(t.spawned.length, 2);
  assert.ok(t.spawned.every((s) => s.vy > 0 && s.y === CONTENT.RAIN_Y));
  const f = contentWorld(level(['aaaaaaaaaaaa'], { kind: 'bonus', rules: { timerMs: 20000, fever: true } }));
  f.world.api.spawnBall(360, 600, 100, -400);
  f.hit(brickAt(f.world, 0, 0), SRC.BALL, 0);
  assert.equal(f.spawned.length, 2, 'the hit split the ball');
  assert.notEqual(f.spawned[1].vx, 100);
});

test('sentries: spawn, deflect and take hits, die to a laser; bombers bomb; a hazard hit costs HEAT, never a Shrink', () => {
  const t = contentWorld(level(['aaaaaaaaaaaa'], {
    sentries: [{ kind: 'drifter', x: 200, y: 700 }, { kind: 'bomber', x: 500, y: 650 }, { kind: 'drifter', x: 600, y: 760, atMs: 1000 }],
  }));
  t.step(1);
  const live = () => t.world.sentries.filter((s) => s.alive);
  assert.equal(live().length, 2, 'the third waits for its time');
  const drifter = t.world.sentries.findIndex((s) => s.alive && s.kind === SENTRY.DRIFTER);
  emit(t.world.bus, EV.SENTRY_HIT, drifter, 0, 0, 0, SRC.BALL);
  t.world.systems.content.resolve(t.world, t.frame);
  assert.equal(t.world.sentries[drifter].hp, 1);
  emit(t.world.bus, EV.SENTRY_HIT, drifter, 0, 0, -1, SRC.LASER);
  t.world.systems.content.resolve(t.world, t.frame);
  assert.equal(t.world.sentries[drifter].alive, false);
  t.step(240);
  assert.equal(live().length, 2, 'the late drifter arrived');
  assert.ok(t.hazards.length >= 1, 'the bomber dropped a bomb');
  assert.equal(t.hazards[0].kind, HAZARD.BOMB);
  assert.ok(t.hazards[0].vy > 0, 'toward the paddle');
  const names2 = t.events().map((e) => e.name);
  for (const n of ['SENTRY_SPAWNED', 'SENTRY_DAMAGED', 'SENTRY_KILLED', 'SENTRY_FIRED']) assert.ok(names2.includes(n), n);
  for (const s of live()) assert.ok(s.y <= 860 && s.y >= 105 + 15 + s.r, 'sentries stay between the wall and the paddle zone');
  emit(t.world.bus, EV.HAZARD_HIT, 0, 0, 0, HAZARD.BOMB);
  t.world.systems.content.resolve(t.world, t.frame);
  assert.deepEqual(t.drops, [], 'a hazard never applies a drop (PLAN §1: shrink only from a red drop the player caught)');
  assert.deepEqual(t.heat, [-CONTENT.HAZARD_HEAT], 'it knocks HEAT out of the meter');
});

test('a blast kills sentries in reach', () => {
  const t = contentWorld(level(['............', '............', '.....E......'], { sentries: [{ kind: 'drifter', x: 330, y: 190, along: 0, across: 0 }] }));
  t.step(1);
  assert.equal(t.world.sentries.filter((s) => s.alive).length, 1);
  t.hit(brickAt(t.world, 2, 5));
  assert.equal(t.world.sentries.filter((s) => s.alive).length, 0);
});

test('Blackout sets fx.dark; content never allocates the world api twice', () => {
  const t = contentWorld(level(['aaaaaaaaaaaa'], { rules: { dark: true } }));
  assert.equal(t.world.fx.dark, 1);
  assert.equal(typeof t.world.api.purgeRows, 'function');
  assert.deepEqual(t.world.stats.apiMissing, {});
});
