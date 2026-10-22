// E: save data v1, migrations and sanitising (CP1).

import { test, assert } from './lib.mjs';
import { STORAGE_KEY } from '../src/core/constants.js';
import { createSave, memoryStorage, defaultSave, migrate, MIGRATIONS, SAVE_VERSION, BAD_KEY } from '../src/economy/save.js';

test('save v1 round trip and migration', () => {
  // Round trip.
  const mem = memoryStorage();
  const s = createSave(mem);
  const d = s.load();
  assert.equal(d.v, SAVE_VERSION);
  d.campaign.unlocked = 9;
  d.campaign.best['3'] = 4200;
  d.campaign.cleared['3'] = true;
  d.forge.embers = 640;
  d.forge.ranks.heat = 2;
  d.overburn.bestWave = 4;
  d.settings.music = 0.25;
  d.settings.muted = true;
  s.write(d);
  const e = createSave(mem).load();
  assert.deepEqual(e, d);
  // v0 (no version, the flat day-one shape) migrates into v1.
  mem.setItem(STORAGE_KEY, JSON.stringify({ unlocked: 5, best: { 2: 900 }, embers: 120, ranks: { lives: 1 }, settings: { sfx: 0.5 } }));
  const m = createSave(mem).load();
  assert.equal(m.v, 1);
  assert.equal(m.campaign.unlocked, 5);
  assert.equal(m.campaign.best['2'], 900);
  assert.equal(m.forge.embers, 120);
  assert.equal(m.forge.ranks.lives, 1);
  assert.equal(m.settings.sfx, 0.5);
  assert.equal(m.settings.music, 0.8, 'missing settings take defaults');
  assert.equal(m.unlocked, undefined, 'old top-level fields are moved, not duplicated');
  assert.equal(typeof MIGRATIONS[0], 'function', 'a migration exists for every version below the current');
});

test('save: corrupt or hostile data loads as a playable save', () => {
  const mem = memoryStorage();
  mem.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(createSave(mem).load(), defaultSave());
  mem.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
  assert.deepEqual(createSave(mem).load(), defaultSave());
  const bad = migrate({
    v: 1,
    campaign: { unlocked: 999, best: { 1: 'lots', 2: 50 }, cleared: { 1: 'yes', 2: true } },
    forge: { embers: -40, ranks: { lives: 7, heat: 'x', bogus: 3 } },
    overburn: { best: NaN, bestWave: 2.7 },
    settings: { music: 3, sfx: -1, muted: 'no', lite: true },
    stats: { runs: 4, junk: 'x' },
  });
  assert.equal(bad.campaign.unlocked, 31);
  assert.deepEqual(bad.campaign.best, { 2: 50 });
  assert.deepEqual(bad.campaign.cleared, { 2: true });
  assert.equal(bad.forge.embers, 0);
  assert.deepEqual(bad.forge.ranks, { lives: 3, heat: 0 });
  assert.equal(bad.overburn.best, 0);
  assert.equal(bad.overburn.bestWave, 2);
  assert.equal(bad.settings.music, 1);
  assert.equal(bad.settings.sfx, 0);
  assert.equal(bad.settings.muted, false);
  assert.equal(bad.settings.lite, true);
  assert.deepEqual(bad.stats, { runs: 4 });
});

test('save: an unreadable save is kept aside before the next write replaces it', () => {
  const mem = memoryStorage();
  const broken = '{"v":1,"forge":{"embers":4200,"ranks":{"lives":2}},"campaign":{"unlocked":17'; // cut off mid-write
  mem.setItem(STORAGE_KEY, broken);
  const s = createSave(mem);
  assert.deepEqual(s.load(), defaultSave());
  s.write(defaultSave());
  assert.equal(mem.getItem(BAD_KEY), broken, 'the original string survives the write');
  assert.equal(BAD_KEY, `${STORAGE_KEY}.bad`);
  // A readable save never touches the side key; a missing save writes nothing there.
  const ok = memoryStorage();
  ok.setItem(STORAGE_KEY, JSON.stringify(defaultSave()));
  createSave(ok).load();
  assert.equal(ok.getItem(BAD_KEY), null);
  const none = memoryStorage();
  createSave(none).load();
  assert.equal(none.getItem(BAD_KEY), null);
  // A storage that reads but cannot write still loads a playable save.
  const ro = { getItem: (k) => (k === STORAGE_KEY ? 'garbage' : null), setItem() { throw new Error('full'); }, removeItem() {} };
  assert.deepEqual(createSave(ro).load(), defaultSave());
});

test('save: a newer build\'s fields survive an older build, and reset clears', () => {
  const mem = memoryStorage();
  mem.setItem(STORAGE_KEY, JSON.stringify({ ...defaultSave(), v: 3, newThing: { a: 1 }, settings: { ...defaultSave().settings, haptics: true } }));
  const s = createSave(mem);
  const d = s.load();
  assert.equal(d.v, 3);
  assert.deepEqual(d.newThing, { a: 1 });
  assert.equal(d.settings.haptics, true);
  s.write(d);
  assert.deepEqual(JSON.parse(mem.getItem(STORAGE_KEY)).newThing, { a: 1 });
  assert.deepEqual(s.reset(), defaultSave());
  assert.equal(mem.getItem(STORAGE_KEY), null);
});

test('save: a storage that throws never stops the game', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('x'); } };
  const s = createSave(broken);
  assert.deepEqual(s.load(), defaultSave());
  s.write(defaultSave());
  assert.deepEqual(s.reset(), defaultSave());
});
