// B: the level parser and the design checks (src/levels/parser.js, src/levels/FORMAT.md).

import { test, assert } from './lib.mjs';
import { parseLevel, checkLevel, loopTraps, portalLanes, unreachable, anchorLow, anchorProblem, rulesFor, ANCHOR } from '../src/levels/parser.js';
import { LEVELS, stagesOf } from '../src/levels/index.js';
import { BF, GRID } from '../src/core/constants.js';
import { level } from './fixtures/B/helpers.mjs';

const every = () => LEVELS.flatMap((l) => stagesOf(l));

test('parser rejects bad rows, characters, row counts and ring cells', () => {
  assert.throws(() => parseLevel(level(['abc'])), /length/);
  assert.throws(() => parseLevel(level(['aaaaaaaaaaa#'])), /unknown character/);
  assert.throws(() => parseLevel(level(Array(61).fill('............'))), /rows/);
  assert.throws(() => parseLevel({ ...level([]), rows: [] }), /rows missing/);
  assert.throws(() => parseLevel({ ...level(Array(17).fill('.'.repeat(24))), mode: 'left' }), /exactly 18/);
  const ring = Array(16).fill('.'.repeat(16));
  ring[0] = 'a' + '.'.repeat(15); // corner cell, far outside radius 240
  assert.throws(() => parseLevel({ ...level(ring), mode: 'ring' }), /outside ring radius/);
  assert.throws(() => parseLevel(level(['aaaa.......b'], { motion: [{ row: 3, speed: 50 }] })), /motion row/);
  assert.throws(() => parseLevel(level(['aaaa.......b'], { sentries: [{ kind: 'drone' }] })), /sentry kind/);
  assert.throws(() => parseLevel(level(['aaaa.......?'], { carriers: { '0,1': 'wide' } })), /not a "\?" cell/);
  assert.throws(() => parseLevel(level(['aaaa.......?'], { carriers: { '0,11': 'wings' } })), /unknown drop/);
});

test('portals pair; every * enclosed by C', () => {
  const p = parseLevel(level(['(..........)', 'a..........a']));
  const a = p.bricks.find((b) => b.col === 0 && b.row === 0);
  const z = p.bricks.find((b) => b.col === 11 && b.row === 0);
  assert.equal(p.bricks[a.link], z);
  assert.equal(p.bricks[z.link], a);
  assert.throws(() => parseLevel(level(['(...........'])), /paired/);
  assert.throws(() => parseLevel(level(['((.........)'])), /twice/);
  // a sealed ball must be closed on all four sides by shell cells
  const ok = parseLevel(level(['....CCC.....', '....C*C.....', '....CCC.....']));
  const ball = ok.bricks.find((b) => b.flags & BF.CAVITY_BALL);
  assert.equal(ball.group, 0);
  assert.equal(ok.bricks.filter((b) => b.group === 0).length, 5, 'the four touching shell cells share the group');
  assert.throws(() => parseLevel(level(['....CCC.....', '....C*......', '....CCC.....'])), /not enclosed/);
  assert.throws(() => parseLevel(level(['....C*C.....', '....CCC.....'])), /not enclosed/);
  const two = parseLevel(level(['...CCCC.....', '...C**C.....', '...CCCC.....']));
  assert.equal(two.bricks.filter((b) => b.flags & BF.CAVITY_BALL).length, 2);
});

test('boss cells only in boss levels; boss levels name a boss', () => {
  assert.throws(() => parseLevel(level(['.....W......'])), /only in boss levels/);
  assert.throws(() => parseLevel(level(['.....B......'], { kind: 'boss' })), /boss level needs boss/);
  const p = parseLevel(level(['....BWWB....', '....AAAA....'], { kind: 'boss', boss: 'stoker' }));
  assert.ok(p.bricks.every((b) => !(b.flags & BF.CLEARABLE) || (b.flags & BF.WEAK)), 'only the weak point counts in a boss level');
});

test('no facing indestructible loop traps', () => {
  assert.equal(loopTraps(level(['X....X......'])).length, 1, 'a row lane between two X');
  assert.equal(loopTraps(level(['X...........', '............', 'X...........'])).length, 1, 'a column lane');
  assert.equal(loopTraps(level(['XX..a.XX....'])).length, 0, 'a brick between them is fine');
  assert.equal(loopTraps(level(['XXXXXXXXXXXX'])).length, 0, 'a solid run is a wall');
  assert.equal(loopTraps(level(['X..(...)..X.'])).length, 1, 'portals are not solid');
  for (const d of every()) assert.deepEqual(loopTraps(d), [], `${d.id}`);
});

test('portal twins never share a straight lane toward the paddle', () => {
  const stacked = level(['..).........', '..a.........', '............', '..(.........']);
  assert.equal(portalLanes(stacked).length, 1, 'one column, only breakable bricks between');
  assert.ok(checkLevel(stacked).some((p) => /share column 2/.test(p)));
  assert.equal(portalLanes(level(['..)...X.....', '..X.........', '............', '..(.........'])).length, 0, 'an X between them');
  assert.equal(portalLanes(level(['..)...X.....', '............', '....(.......'])).length, 0, 'different columns');
  assert.equal(portalLanes(level(['(..........)'])).length, 0, 'one row is fine in bottom mode');
  const left = { ...level(Array.from({ length: 18 }, (_, r) => (r === 5 ? '......(...a...)...b.....' : '......................b.'))), mode: 'left' };
  assert.equal(portalLanes(left).length, 1, 'left mode: one row is the lane');
  for (const d of every()) assert.deepEqual(portalLanes(d), [], `${d.id}`);
});

test('every clearable brick is reachable', () => {
  assert.equal(unreachable(level(['XXX.........', 'XaX.........', 'XXX.........'])).length, 1, 'boxed in by X');
  assert.equal(unreachable(level(['XXX.........', 'XAX.........', 'X2X.........'])).length, 0, 'breakable walls are passable');
  // a sealed room is reachable through its portal
  const room = ['XXXXX.......', 'Xa)aX.......', 'XXXXX.......', '............', '......(.....'];
  assert.equal(unreachable(level(room)).length, 0);
  assert.equal(unreachable(level(room.map((r) => r.replace(/[()]/g, '.')))).length, 2);
  // left and ring modes start from the paddle side
  const left = Array(18).fill('.'.repeat(24));
  left[5] = '....' + 'X'.repeat(3) + '.'.repeat(17);
  assert.equal(unreachable({ ...level(left), mode: 'left' }).length, 0);
  for (const d of every()) assert.deepEqual(unreachable(d), [], `${d.id}`);
});

test('gravity bricks start supported', () => {
  assert.ok(checkLevel(level(['....G.......', '............'])).some((p) => /nothing under it/.test(p)));
  assert.ok(!checkLevel(level(['....G.......', '....a.......'])).some((p) => /nothing under it/.test(p)));
  assert.throws(() => parseLevel({ ...level(Array(16).fill('.'.repeat(16))), mode: 'ring', rows: Array(16).fill('.'.repeat(16)).map((r, i) => (i === 7 ? '.......G........' : r)) }), /gravity/);
});

test('anchorLow moves a formation down with its carriers and motion', () => {
  const d = level(['aaaaaaaaaaaa', '?..........?', '............'], { carriers: { '1,0': 'wide' }, motion: [{ row: 0, speed: 50 }] });
  const low = anchorLow(d);
  assert.equal(low.rows.length, ANCHOR.ROW + 1);
  assert.equal(low.rows[ANCHOR.ROW], '?..........?');
  assert.deepEqual(low.carriers, { [`${ANCHOR.ROW},0`]: 'wide' });
  assert.equal(low.motion[0].row, ANCHOR.ROW - 1);
  assert.equal(anchorProblem(parseLevel(low)), '');
  assert.notEqual(anchorProblem(parseLevel(d)), '');
  assert.equal(anchorLow({ ...d, mode: 'left' }).rows, d.rows, 'other modes are left alone');
});

test('formations sit low: lowest brick edge y >= 600, horizontal nearest edge x <= 440', () => {
  for (const d of every()) {
    const p = parseLevel(d);
    assert.equal(anchorProblem(p), '', `${d.id}`);
    if ((d.mode || 'bottom') === 'bottom') {
      const lowest = Math.max(...p.bricks.filter((b) => !(b.flags & BF.HIDDEN)).map((b) => b.y + b.h / 2));
      assert.ok(lowest >= 600 && lowest <= GRID.bottom.y0 + GRID.bottom.rows * GRID.bottom.ch, `${d.id}: ${lowest}`);
    }
  }
});

test('rules default by level number: Pull 7, aim line 4, Overloads 22, Mega rescue 23', () => {
  const at = (n) => rulesFor({ n, rows: [] });
  assert.equal(at(6).pull, false);
  assert.equal(at(7).pull, true);
  assert.equal(at(7).heat, true);
  assert.equal(at(3).aimAt, 0);
  assert.equal(at(4).aimAt, 3);
  assert.equal(at(21).overloads, false);
  assert.equal(at(22).overloads, true);
  assert.equal(at(23).megaRescue, true);
  assert.equal(rulesFor({ n: 5, kind: 'bonus', rows: [], rules: { timerMs: 1 } }).noFail, true);
  assert.equal(rulesFor({ n: 9, rows: [], rules: { pull: false } }).pull, false, 'a level can switch a default off');
});
