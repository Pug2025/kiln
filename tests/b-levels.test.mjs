// B: the thirty levels, their stages, picks, gates and twists (src/levels/data, src/content/gates.js).

import { test, assert } from './lib.mjs';
import { LEVELS, LEVEL_NAMES, getLevel, getStage, stagesOf, twistsFor, applyTwist } from '../src/levels/index.js';
import { parseLevel, checkLevel } from '../src/levels/parser.js';
import { PICKS, BRICK, BF } from '../src/core/constants.js';
import { createWorld } from '../src/core/world.js';
import { runHeadless } from '../src/core/headless.js';
import { makeSystems } from '../src/systems.js';
import { createRun } from '../src/economy/economy.js';
import { createRobot } from '../src/sim/robot.js';
import { TWISTS, twistParts } from '../src/content/gates.js';
import { RULES } from '../src/levels/overburn.js';
import { SENTRY_SPEC } from '../src/content/sentries.js';
import { level } from './fixtures/B/helpers.mjs';

const every = () => LEVELS.flatMap((l) => stagesOf(l));

test('every level parses (30 + stages)', () => {
  const all = every();
  assert.equal(LEVELS.length, 30);
  assert.ok(all.length >= 32, 'The Core adds two continuation stages');
  for (const d of all) {
    const p = parseLevel(d);
    assert.ok(p.bricks.length > 0, `${d.id} has bricks`);
    assert.ok(p.bricks.length <= 768, `${d.id} fits the brick pool`);
  }
});

test('level numbers 1–30 present once each with the handoff names', () => {
  assert.deepEqual(LEVELS.map((l) => l.n), Array.from({ length: 30 }, (_, i) => i + 1));
  for (const l of LEVELS) {
    assert.equal(l.name, LEVEL_NAMES[l.n], `level ${l.n}`);
    assert.equal(getLevel(l.n), l);
    assert.equal(l.world, l.n <= 10 ? 'ember' : l.n <= 20 ? 'blaze' : 'whiteheat');
  }
  const ids = every().map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

test('every level passes the design checks', () => {
  for (const d of every()) assert.deepEqual(checkLevel(d, { names: LEVEL_NAMES }), [], d.id);
});

test('level labels and help fit the card without extra punctuation', () => {
  for (const l of LEVELS) {
    const words = l.adds.trim().split(/\s+/).length;
    assert.ok(words >= 2 && words <= 4, `${l.id}: "${l.adds}"`);
    if (l.hint) {
      assert.ok(l.hint.length <= 70, `${l.id}: hint is short`);
      assert.ok(!/!/.test(l.hint), `${l.id}: no exclamations`);
    }
  }
});

test('cards say each thing once: no adds repeats the name or the kind tag, no stale pick or hit-count copy', () => {
  for (const l of LEVELS) {
    if (l.kind === 'boss') assert.ok(!l.adds.includes(l.name), `${l.id}: "${l.adds}" repeats the boss name`);
    assert.ok(!/^(final )?(boss|bonus)\b/i.test(l.adds), `${l.id}: "${l.adds}" repeats the kind tag`);
    assert.ok(!/\bchoose\b/i.test(l.hint || ''), `${l.id}: the pick screen came first`);
    assert.ok(!/\b(numbers?|dots|numbered)\b/i.test(`${l.adds} ${l.hint || ''}`), `${l.id}: hits left are lines`);
    assert.ok(!/;/.test(l.hint || ''), `${l.id}: no semicolon fragments`);
  }
  assert.ok(!RULES.some((r) => /^(Numbered|Black|Drop carriers|Gravity towers|Sealed ball$)/.test(r.label)),
    'Overburn uses the campaign names');
});

test('a card that names a time says it is the level\'s clock, in the level\'s own number', () => {
  // 'ADDS 30 seconds' reads as 30 seconds of extra time, not a level that lasts 30 seconds
  let timed = 0;
  for (const l of LEVELS) {
    const secs = /(\d+)\s*s(?:ec(?:ond)?s?)?\b/i.exec(l.adds);
    if (!secs) continue;
    timed++;
    assert.match(l.adds, /\bclock\b/, `${l.id}: "${l.adds}" names the clock`);
    assert.equal(Number(secs[1]) * 1000, l.rules.timerMs, `${l.id}: "${l.adds}" matches its timer`);
  }
  assert.ok(timed >= 1, 'level 5 names its clock');
});

test('player-facing text: Kiln words only, and the facts are true', () => {
  // the handoff "Do NOT" list: no ceramic-era words on a card, a door or a wave
  const banned = /\b(earthenware|stoneware|porcelain|glaze[sd]?|tin|brass|basalt|plaster|chimes?|workshop|charges?|spells?|gifts?)\b/i;
  const texts = [];
  for (const d of every()) texts.push([d.id, d.adds || ''], [d.id, d.hint || '']);
  for (const [id, t] of Object.entries(TWISTS)) texts.push([id, t.label]);
  for (let n = 1; n <= 30; n++) for (const d of twistsFor(n)) texts.push([`door ${n}`, d.label], [`door ${n}`, d.fact]);
  for (const r of RULES) texts.push(['overburn', r.label]);
  for (const [where, t] of texts) assert.ok(!banned.test(t), `${where}: "${t}"`);
  // facts that name numbers must match the rules
  assert.match(getLevel(18).hint, new RegExp(`${SENTRY_SPEC[0].hp} hits[;,] bombers ${SENTRY_SPEC[1].hp}`));
  const heavier = applyTwist(level(['a2A9E?X.....', 'aaaaaaaaa...']), 'heavier');
  assert.equal(heavier.rows[0], '23A9E?X.....', 'plain and numbered bricks take 1 more hit; the rest are as they were');
  // Every trade keeps its measured effect counts outside the player-facing sentence.
  const count = (d, ch) => d.rows.join('').split(ch).length - 1;
  for (let n = 1; n <= 30; n++) {
    for (const d of twistsFor(n)) {
      const base = getLevel(n), out = applyTwist(base, d.id);
      const [cost, pay] = twistParts(d.id);
      const more = (ch) => count(out, ch) - count(base, ch);
      const hpBefore = new Map(parseLevel(base).bricks.map((b) => [`${b.row},${b.col}`, b.hp]));
      const harder = parseLevel(out).bricks.filter((b) => b.hp === hpBefore.get(`${b.row},${b.col}`) + 1).length;
      const want = {
        moving: (out.motion || []).length - (base.motion || []).length,
        armoured: more('A'),
        heavier: harder,
        explosive: more('E'),
        rich: more('?'),
      };
      assert.deepEqual(d.counts, { [cost]: want[cost], [pay]: want[pay] }, `door into ${n}`);
      if (cost === 'moving') assert.equal((out.motion || []).length - (base.motion || []).length, 2, `door into ${n}: two more sliding lines`);
      if (cost === 'heavier') assert.ok(!/[abc]/.test(out.rows.join('').replace(/\?/g, '')) || more('2') > 0, `door into ${n}: heavier bricks`);
      assert.ok(more(pay === 'explosive' ? 'E' : '?') > 0, `door into ${n}: the payoff is in the wall`);
      assert.ok(!/[\d+]|\b(twist|cost|payoff|heavier|rich)\b/i.test(d.label), `door into ${n}: player words only`);
      const first = { moving: base.mode === 'left' ? 'Columns' : 'Rows', armoured: 'Armoured', heavier: 'Bricks' };
      assert.ok(d.label.startsWith(first[cost]), `door into ${n}: cost comes first`);
      assert.match(d.label, pay === 'explosive' ? /explode\.$/ : /powers inside\.$/, `door into ${n}: names the actual reward`);
    }
  }
  assert.ok(!/full heat/i.test(getLevel(22).hint), 'an Overload is ready at its cost, not at a full meter');
});

test('the rhythm: bonus at 5/15/25, bosses at 10/20/30, the new idea of each level is in place', () => {
  const kind = (n) => getLevel(n).kind;
  for (const n of [5, 15, 25]) {
    assert.equal(kind(n), 'bonus');
    const r = parseLevel(getLevel(n)).rules;
    assert.ok(r.timerMs > 0 && r.noFail, `level ${n} is timed and no-fail`);
  }
  assert.equal(parseLevel(getLevel(5)).rules.timerMs, 30000);
  assert.equal(parseLevel(getLevel(15)).rules.timerMs, 25000);
  assert.equal(parseLevel(getLevel(25)).rules.timerMs, 20000);
  assert.ok(parseLevel(getLevel(15)).rules.rainMs > 0);
  assert.ok(parseLevel(getLevel(25)).rules.fever);
  assert.deepEqual([10, 20, 30].map((n) => getLevel(n).boss), ['stoker', 'crucible', 'core']);
  const types = (n) => new Set(parseLevel(getLevel(n)).bricks.map((b) => b.type));
  assert.ok(types(2).has(BRICK.NUMBERED));
  assert.ok(types(3).has(BRICK.CARRIER));
  assert.ok(types(4).has(BRICK.INDESTRUCTIBLE));
  assert.ok(types(6).has(BRICK.EXPLOSIVE));
  assert.ok(parseLevel(getLevel(7)).rules.pull);
  assert.ok(getLevel(9).motion.length >= 2);
  assert.ok(types(11).has(BRICK.ARMOURED));
  assert.ok(parseLevel(getLevel(12)).bricks.some((b) => b.type === BRICK.CAVITY && b.hp === 0));
  assert.ok(parseLevel(getLevel(14)).rules.marchMs === 15000);
  assert.ok(types(16).has(BRICK.GRAVITY));
  assert.equal(getLevel(17).mode, 'left');
  assert.ok(getLevel(18).sentries.length >= 2);
  assert.equal(getLevel(21).mode, 'ring');
  assert.ok(parseLevel(getLevel(22)).rules.overloads);
  assert.equal(parseLevel(getLevel(24)).def.rows.length, 60);
  assert.ok(parseLevel(getLevel(24)).rules.scrollSpeed > 0);
  assert.ok(types(26).has(BRICK.PORTAL));
  assert.ok(parseLevel(getLevel(27)).rules.ghosts);
  assert.ok(parseLevel(getLevel(28)).rules.dark);
  const full = parseLevel(getLevel(29));
  assert.ok(full.rules.marchMs > 0 && full.def.sentries.length && types(29).has(BRICK.GRAVITY) && types(29).has(BRICK.PORTAL), 'Full burn has everything');
});

test('picks: Mods at 13, 16, 19, 23, 26, 29; the Overload at 22', () => {
  for (const l of LEVELS) {
    const want = PICKS.MOD_LEVELS.includes(l.n) ? 'mod' : l.n === PICKS.OVERLOAD_LEVEL ? 'overload' : undefined;
    assert.equal(l.pick, want, `level ${l.n}`);
  }
});

test('gates from 13, never in front of a bonus or boss level; two doors that pass the checks', () => {
  for (const l of LEVELS) {
    const nextLevel = getLevel(l.n + 1);
    if (l.n < PICKS.GATES_FROM) assert.ok(!l.gate, `no gate after ${l.n}`);
    if (l.gate) assert.ok(nextLevel && nextLevel.kind === 'normal', `gate after ${l.n} leads to a normal level`);
    if (l.n >= PICKS.GATES_FROM && nextLevel && nextLevel.kind === 'normal') assert.ok(l.gate, `gate after ${l.n}`);
  }
  for (let n = 1; n <= 30; n++) {
    const doors = twistsFor(n);
    if (!getLevel(n - 1)?.gate) {
      assert.deepEqual(doors, [], `no doors into ${n}`);
      continue;
    }
    assert.equal(doors.length, 2, `two doors into ${n}`);
    assert.notEqual(doors[0].id, doors[1].id);
    for (const t of doors) {
      const parts = twistParts(t.id);
      assert.ok(parts && parts.length === 2 && TWISTS[parts[0]].kind === 'cost' && TWISTS[parts[1]].kind === 'pay', `${n} ${t.id}: every door is a trade, one cost and one payoff`);
      assert.ok(t.label.length <= 50 && t.label.endsWith('.'), `${n}: "${t.label}" is one short trade sentence`);
      assert.equal(t.fact, '', `${n} ${t.id}: no second line repeating the trade`);
      const twisted = applyTwist(getLevel(n), t.id);
      assert.equal(twisted.twist, t.id);
      assert.notDeepEqual(twisted, getLevel(n));
      assert.deepEqual(checkLevel(twisted, { names: LEVEL_NAMES }), [], `${n} ${t.id}`);
    }
  }
  assert.equal(applyTwist(getLevel(14), 'no-such-twist'), getLevel(14));
});

test('carriers: about one brick in seven on levels with drops', () => {
  let carriers = 0, bricks = 0;
  for (const l of LEVELS) {
    if (l.kind === 'bonus') continue;
    const p = parseLevel(l);
    const clearable = p.bricks.filter((b) => b.type !== BRICK.INDESTRUCTIBLE && b.type !== BRICK.BOSS && b.type !== BRICK.PORTAL && b.hp > 0);
    const c = clearable.filter((b) => b.type === BRICK.CARRIER || (b.flags & BF.LOADED)).length;
    if (l.n >= 3 && (l.drops?.rate || c)) {
      carriers += c;
      bricks += clearable.length;
    }
  }
  const ratio = carriers / bricks;
  assert.ok(ratio > 1 / 20 && ratio < 1 / 4, `carrier ratio ${ratio.toFixed(3)}`);
  assert.ok(parseLevel(getLevel(8)).bricks.filter((b) => b.type === BRICK.CARRIER).length >= 6, 'Friend or foe teaches with six fixed carriers');
});

test('figures: at least 8 band levels carry a shape, not a full-width strip (ART.md 15.7)', () => {
  // level: [figure, target count]. Grid's 18-brick opening was retuned for the first Multi drop;
  // the other targets retain their CP3 counts (2026-10-22, before the figures).
  const FIGURES = {
    2: ['diamond', 18], 4: ['keyhole', 50], 8: ['chevron', 48], 9: ['diamond', 32], 11: ['V', 38],
    12: ['diamond', 50], 13: ['ziggurat', 64], 15: ['funnel', 72], 18: ['arch', 36],
  };
  assert.ok(Object.keys(FIGURES).length >= 8);
  const heights = new Set();
  for (const [n, [figure, target]] of Object.entries(FIGURES)) {
    const l = getLevel(Number(n));
    const where = `${n} ${l.name} (${figure})`;
    const p = parseLevel(l);
    const bricks = p.bricks.filter((b) => !(b.flags & (BF.PORTAL | BF.CAVITY_BALL)));
    assert.ok(Math.abs(bricks.length - target) <= 0.1 * target, `${where}: ${bricks.length} bricks vs target ${target}`);
    let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1, cells = 0;
    const molten = [];
    l.rows.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch === 'c') molten.push([r, c]);
      if ('. S'.includes(ch)) return;
      cells++;
      r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c);
    }));
    const rows = r1 - r0 + 1;
    const box = rows * (c1 - c0 + 1);
    heights.add(rows);
    assert.ok(rows >= 4 && rows <= 9, `${where}: ${rows} rows`);
    assert.ok(cells <= 0.75 * box, `${where}: ${Math.round(100 * (1 - cells / box))}% of the box empty`);
    // the molten bricks: one 4-connected cluster over at least two rows
    assert.ok(molten.length >= 2, `${where}: a molten cluster`);
    const key = (r, c) => `${r},${c}`;
    const left = new Set(molten.map(([r, c]) => key(r, c)));
    const stack = [molten[0]];
    left.delete(key(...molten[0]));
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (left.delete(key(r + dr, c + dc))) stack.push([r + dr, c + dc]);
      }
    }
    assert.equal(left.size, 0, `${where}: the molten bricks form one cluster`);
    assert.ok(new Set(molten.map(([r]) => r)).size >= 2, `${where}: the molten cluster is not a row`);
  }
  assert.ok(heights.size >= 4, `figure heights vary (${[...heights].join(', ')})`);
});

test('The Core chains bottom → left → ring', () => {
  const s1 = getLevel(30);
  assert.equal(s1.mode, 'bottom');
  assert.equal(s1.continues, 'core-2');
  const s2 = getStage('core-2');
  assert.equal(s2.mode, 'left');
  assert.equal(s2.stage, 2);
  assert.equal(s2.continues, 'core-3');
  const s3 = getStage('core-3');
  assert.equal(s3.mode, 'ring');
  assert.equal(s3.stage, 3);
  assert.ok(!s3.continues);
  assert.deepEqual(stagesOf(s1).map((d) => d.id), ['core-1', 'core-2', 'core-3']);
  for (const d of stagesOf(s1)) {
    assert.equal(d.n, 30);
    assert.equal(d.boss, 'core');
    assert.equal(d.name, 'The Core');
  }
});

test('robot sweep: every level and stage clears headless (seed 1, 6 sim minutes)', () => {
  const slow = [];
  for (const l of LEVELS) {
    const run = createRun({ seed: 1 });
    for (const d of stagesOf(l)) {
      const world = createWorld({ level: d, seed: 1 + d.n * 31 + (d.stage | 0), run, systems: makeSystems() });
      const r = runHeadless(world, createRobot(), { maxSimMs: 6 * 60 * 1000 });
      if (!r.cleared) slow.push(`${d.id} (${r.phase}, ${r.remaining} left)`);
      assert.deepEqual(world.stats.apiMissing, {}, `${d.id}: every world.api call is installed`);
    }
  }
  assert.deepEqual(slow, [], 'levels the robot could not clear');
}, { timeout: 120000 });
