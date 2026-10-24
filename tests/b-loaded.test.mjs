// Loaded carriers keep the carrier layout, but combine tougher material with a fixed good power.
import { createHash } from 'node:crypto';
import { test, assert } from './lib.mjs';
import { BF, BRICK, DROP_NAMES } from '../src/core/constants.js';
import { LEVELS, getLevel, stagesOf, twistsFor, applyTwist } from '../src/levels/index.js';
import { parseLevel, anchorLow, unreachable } from '../src/levels/parser.js';
import { level } from './fixtures/B/helpers.mjs';

const all = () => LEVELS.flatMap(stagesOf);
const loaded = (def) => parseLevel(def).bricks.filter((b) => b.flags & BF.LOADED);
const power = (b) => DROP_NAMES[b.drop];

test('loaded metadata preserves the carrier cell and uses its material, HP and fixed good drop', () => {
  const def = level(['???.........'], {
    loaded: { '0,0': '2', '0,1': '4', '0,2': 'A' },
    carriers: { '0,0': 'multi', '0,1': 'life', '0,2': 'laser' },
  });
  const low = anchorLow(def);
  assert.equal(low.rows[17], '???.........');
  assert.deepEqual(low.loaded, { '17,0': '2', '17,1': '4', '17,2': 'A' });
  const bricks = loaded(low);
  assert.deepEqual(bricks.map((b) => [b.type, b.hp, power(b)]), [
    [BRICK.NUMBERED, 2, 'multi'], [BRICK.NUMBERED, 4, 'life'], [BRICK.ARMOURED, 3, 'laser'],
  ]);
  assert.ok(bricks.every((b) => (b.flags & (BF.SOLID | BF.BREAKABLE | BF.CLEARABLE)) === (BF.SOLID | BF.BREAKABLE | BF.CLEARABLE)));
  assert.ok(bricks[2].flags & BF.ARMOURED);
  assert.equal(parseLevel(level(['?...........'])).bricks[0].type, BRICK.CARRIER, 'old ? still means one-hit carrier');
});

test('loaded metadata rejects missing carriers, invalid cells/materials and every unapproved power', () => {
  const def = level(['?a..........'], { loaded: { '0,0': '2' }, carriers: { '0,0': 'laser' } });
  for (const key of ['0,1', '0,12', '1,0', '0,00', '-1,0']) {
    assert.throws(() => parseLevel({ ...def, loaded: { [key]: '2' } }), /not a "\?" cell/);
  }
  for (const material of ['1', '5', 'a', 'E', '?', null]) {
    assert.throws(() => parseLevel({ ...def, loaded: { '0,0': material } }), /material must be/);
  }
  for (const name of [undefined, 'shrink', 'fast', 'fog', 'thru', 'mega', 'wings']) {
    assert.throws(() => parseLevel({ ...def, carriers: { '0,0': name } }), /fixed good drop/);
  }
});

test('campaign preserves all 258 carrier positions and loads only later good powers', () => {
  const manifest = all().map((d) => [d.id, d.rows.flatMap((line, r) => [...line].flatMap((ch, c) => ch === '?' ? [`${r},${c}`] : []))]);
  assert.equal(manifest.reduce((n, [, cells]) => n + cells.length, 0), 258);
  // Fingerprint of every carrier coordinate before loaded bricks, including The Core's stages.
  assert.equal(createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), 'e57a67de195ee58597507511c52530aee9794e36968553c5ddd514921f585c8b');
  const powers = {}, perLevel = new Map();
  for (const def of all()) {
    const loads = loaded(def);
    assert.equal(parseLevel(def).bricks.filter((b) => b.type === BRICK.CARRIER || (b.flags & BF.LOADED)).length, manifest.find(([id]) => id === def.id)[1].length, def.id);
    if (def.n <= 10 || def.kind === 'bonus') assert.equal(loads.length, 0, def.id);
    else assert.ok(loads.length >= 1 && loads.length <= 3, def.id);
    for (const b of loads) {
      assert.ok(['laser', 'multi', 'fire', 'wide', 'catch', 'slow', 'life'].includes(power(b)), def.id);
      powers[power(b)] = (powers[power(b)] || 0) + 1;
      perLevel.set(def.n, (perLevel.get(def.n) || 0) + 1);
      assert.ok(!(b.flags & BF.BOSS), `${def.id}: power carriers are scenery, never boss parts`);
      if (def.mode === 'ring') assert.equal(b.hp, 2, 'small ring faces reserve space for the power mark');
    }
  }
  assert.ok([...perLevel.values()].every((n) => n >= 1 && n <= 3));
  assert.deepEqual(powers, { laser: 13, multi: 14, fire: 6, wide: 4, slow: 2, catch: 1, life: 1 });
});

test('gate transforms preserve loaded carrier material/power and count only actual harder bricks', () => {
  for (const def of all()) for (const door of twistsFor(def.n)) {
    if (def.stage) continue;
    const out = applyTwist(def, door.id);
    const { loaded: ignored, ...unloaded } = def;
    assert.deepEqual(out.rows, applyTwist(unloaded, door.id).rows, `${def.id}: no gate transform changes`);
    assert.deepEqual(loaded(out).map((b) => [b.row, b.col, b.type, b.hp, b.drop]), loaded(def).map((b) => [b.row, b.col, b.type, b.hp, b.drop]), `${def.id}: loaded cost stays fixed`);
    if (door.id.startsWith('heavier+')) {
      const before = new Map(parseLevel(def).bricks.map((b) => [`${b.row},${b.col}`, b.hp]));
      const changed = parseLevel(out).bricks.filter((b) => b.hp === before.get(`${b.row},${b.col}`) + 1).length;
      assert.ok(door.fact.startsWith(`${changed} take 1 more hit, `), `${def.id}: ${door.fact}`);
    }
    assert.ok(door.fact.length <= 40, `${def.id}: short fact`);
  }
});

test('boss Laser carriers retain reachable scenery locations and quick teaching Lasers remain', () => {
  for (const n of [20, 30]) {
    const def = getLevel(n);
    const b = loaded(def).find((b) => power(b) === 'laser');
    assert.deepEqual([b.row, b.col, b.x, b.y, b.hp], [17, 0, 30, 615, 2]);
    assert.ok(!(b.flags & (BF.BOSS | BF.CLEARABLE)));
    assert.deepEqual(unreachable(def), [], def.id);
  }
  for (const n of [11, 18]) {
    assert.ok(parseLevel(getLevel(n)).bricks.some((b) => b.type === BRICK.CARRIER && power(b) === 'laser' && b.hp === 1));
  }
  const stage2 = stagesOf(getLevel(30))[1];
  assert.ok(parseLevel(stage2).bricks.some((b) => b.type === BRICK.CARRIER && power(b) === 'laser' && b.row === 1 && b.col === 6));
});
