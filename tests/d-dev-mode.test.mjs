// Kiln: the dev build (?dev=1). Its save lives in its own slot, started from the real save, and
// nothing it does reaches the real save; every level and Overburn are open; it is not silenced.

import { test, assert } from './lib.mjs';
import { installTreeDom } from './fixtures/D/dom.mjs';
import { STORAGE_KEY } from '../src/core/constants.js';
import { createSave, memoryStorage, defaultSave, BAD_KEY, DEV_KEY } from '../src/economy/save.js';
import { mapModel, recordClear } from '../src/app/flow.js';
import { qaMuted } from '../src/audio/audio.js';
import { LEVEL_NAMES } from '../src/levels/index.js';
import { title } from '../src/ui/screens/title.js';
import { map } from '../src/ui/screens/map.js';

/** A memory storage that records every key read, written and removed. */
function tracked() {
  const mem = memoryStorage();
  const log = { get: [], set: [], remove: [] };
  return {
    log,
    getItem: (k) => { log.get.push(k); return mem.getItem(k); },
    setItem: (k, v) => { log.set.push(k); mem.setItem(k, v); },
    removeItem: (k) => { log.remove.push(k); mem.removeItem(k); },
  };
}

const DEV = { key: DEV_KEY, seedFrom: STORAGE_KEY };

test('dev save: its own slot, started once from the real save, never written back', () => {
  assert.notEqual(DEV_KEY, STORAGE_KEY);
  assert.ok(DEV_KEY.startsWith('kiln.'), 'kiln. prefix: the site is shared with other games');
  const store = tracked();
  const real = defaultSave();
  real.forge.embers = 900;
  real.forge.ranks.lives = 2;
  real.campaign.unlocked = 6;
  real.campaign.cleared[5] = true;
  real.settings.music = 0.2;
  createSave(store).write(real);
  const realRaw = store.getItem(STORAGE_KEY);
  store.log.set.length = 0; // only what the dev slot does from here

  const dev = createSave(store, DEV);
  const d = dev.load();
  assert.equal(d.forge.embers, 900, 'the Forge wallet comes across');
  assert.equal(d.forge.ranks.lives, 2, 'Forge ranks come across');
  assert.equal(d.settings.music, 0.2, 'settings come across');
  assert.equal(d.campaign.unlocked, 6);
  assert.ok(store.getItem(DEV_KEY), 'the slot is stored at once, so the copy happens a single time');

  // Dev play: clear late levels, spend, reset. The real save stays byte for byte as it was.
  recordClear(d, 25, 5000);
  d.forge.embers = 3;
  dev.write(d);
  dev.reset();
  dev.write(d);
  assert.equal(store.getItem(STORAGE_KEY), realRaw);
  for (const k of [...store.log.set, ...store.log.remove]) assert.notEqual(k, STORAGE_KEY, 'never writes the real key');

  // Later real progress does not copy over again: the slot keeps its own state.
  const later = createSave(store).load();
  later.forge.embers = 5000;
  createSave(store).write(later);
  const again = createSave(store, DEV).load();
  assert.equal(again.forge.embers, 3);
  assert.equal(again.campaign.cleared[25], true);
});

test('dev save: no real save gives a fresh slot; a broken slot is kept aside under its own name', () => {
  const store = tracked();
  const d = createSave(store, DEV).load();
  assert.deepEqual(d, defaultSave());
  assert.equal(store.getItem(STORAGE_KEY), null, 'no real save appears');

  store.setItem(STORAGE_KEY, JSON.stringify(defaultSave()));
  store.setItem(BAD_KEY, 'the real rescue copy');
  store.setItem(DEV_KEY, '{not json');
  createSave(store, DEV).load();
  assert.equal(store.getItem(`${DEV_KEY}.bad`), '{not json');
  assert.equal(store.getItem(BAD_KEY), 'the real rescue copy', 'the real save\'s rescue copy is untouched');

  // A broken real save starts the slot fresh and is left exactly as it was.
  const s2 = tracked();
  s2.setItem(STORAGE_KEY, '{broken');
  assert.deepEqual(createSave(s2, DEV).load(), defaultSave());
  assert.equal(s2.getItem(STORAGE_KEY), '{broken');
  assert.equal(s2.getItem(BAD_KEY), null);
});

test('the real save is unchanged by the new options', () => {
  const store = tracked();
  const s = createSave(store);
  assert.deepEqual(s.load(), defaultSave());
  assert.equal(store.getItem(STORAGE_KEY), null, 'loading an empty real save still writes nothing');
  store.setItem(STORAGE_KEY, '{bad');
  s.load();
  assert.equal(store.getItem(BAD_KEY), '{bad');
});

test('dev map: every level and Overburn open, cleared marks kept, normal map unchanged', () => {
  const s = defaultSave();
  recordClear(s, 1, 700);
  const m = mapModel(s, () => null, LEVEL_NAMES, { allOpen: true });
  const states = m.worlds.flatMap((w) => w.levels.map((l) => l.state));
  assert.equal(states.length, 30);
  assert.ok(!states.includes('locked'));
  assert.equal(states[0], 'cleared');
  assert.ok(m.worlds.every((w) => w.open));
  assert.equal(m.overburn.open, true);
  assert.equal(m.current, 2, 'PLAY still continues from the save\'s own progress');
  const normal = mapModel(s, () => null, LEVEL_NAMES);
  assert.equal(normal.worlds[0].levels[2].state, 'locked');
  assert.equal(normal.overburn.open, false);
});

test('dev build is not silenced; agents still silence it with mute=1', () => {
  assert.equal(qaMuted('?dev=1'), false);
  assert.equal(qaMuted('?dev=1&mute=1'), true);
});

test('Dev tag on the title Menu label only in the dev build', () => {
  const build = (dev) => {
    const dom = installTreeDom();
    const saved = globalThis.matchMedia;
    globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
    const nav = { count: 0, add() { this.count++; } };
    const api = title({
      menu: [{ id: 'play', label: 'PLAY' }, { id: 'levels', label: 'LEVELS' }],
      stats: [],
      dev,
      onSelect() {},
    }, { el: dom.root, nav });
    const tags = dom.root.querySelectorAll('.tag').filter((t) => t.classList.contains('dev'));
    const rows = nav.count;
    if (api && api.dispose) api.dispose();
    dom.restore();
    globalThis.matchMedia = saved;
    return { tags, rows };
  };
  const on = build(true);
  assert.equal(on.tags.length, 1);
  assert.equal(on.tags[0].textContent, 'Dev');
  const off = build(false);
  assert.equal(off.tags.length, 0);
  assert.equal(on.rows, off.rows, 'the tag adds nothing to the menu');
});

test('Dev tag on the Levels label only in the dev build', () => {
  const s = defaultSave();
  const build = (dev) => {
    const dom = installTreeDom();
    // the small node tree has no replaceChildren, which the map's card uses
    const proto = Object.getPrototypeOf(dom.root);
    if (!proto.replaceChildren) proto.replaceChildren = function (...kids) { this.childNodes = []; kids.forEach((k) => this.appendChild(k)); };
    const nav = { add() {} };
    const api = map({ model: mapModel(s, () => null, LEVEL_NAMES, { allOpen: dev }), dev, onPlay() {}, onOverburn() {}, onBack() {} }, { el: dom.root, nav });
    const tags = dom.root.querySelectorAll('.tag').filter((t) => t.classList.contains('dev'));
    if (api && api.dispose) api.dispose();
    dom.restore();
    return tags;
  };
  const on = build(true);
  assert.equal(on.length, 1);
  assert.equal(on[0].textContent, 'Dev');
  assert.equal(build(false).length, 0);
});
