// Screen catalogues share the shipped economy contracts, including during adapter recovery.
import { register } from 'node:module';
import { test, assert } from './lib.mjs';
import { createRng } from '../src/core/rng.js';
import { STORAGE_KEY } from '../src/core/constants.js';
import { createRun } from '../src/economy/economy.js';
import * as mods from '../src/economy/mods.js';
import * as overloads from '../src/economy/overloads.js';
import * as forge from '../src/economy/forge.js';
import { createSave, defaultSave, memoryStorage } from '../src/economy/save.js';

const adapterUrl = new URL('../src/app/adapters.js', import.meta.url).href;
const forgeUrl = new URL('../src/economy/forge.js', import.meta.url).href;
const empty = 'data:text/javascript,export const catalogueTest = true;';
const unpriced = `data:text/javascript,${encodeURIComponent(`import { FORGE_ITEMS as items } from ${JSON.stringify(forgeUrl)};
  export const FORGE_ITEMS = items.map(({ prices, ...item }) => item);`)}`;
// Only the presentation endpoints are stubbed. Economy and save modules run their real code.
// Query variants withhold the optional exports to exercise the actual fallback branches.
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === '../render/renderer.js' || spec === '../render/wordmark.js') return { url: ${JSON.stringify(empty)}, shortCircuit: true };
  if (ctx.parentURL?.startsWith(${JSON.stringify(adapterUrl + '?')}) && ['../economy/mods.js', '../economy/overloads.js', '../economy/forge.js'].includes(spec)) {
    const url = ctx.parentURL.endsWith('?unpriced') && spec.endsWith('/forge.js') ? ${JSON.stringify(unpriced)} : ${JSON.stringify(empty)};
    return { url, shortCircuit: true };
  }
  return next(spec, ctx);
}`)}`);
const api = await (await import(adapterUrl)).loadAdapters();
const fallback = await (await import(`${adapterUrl}?missing`)).loadAdapters();
const unpricedApi = await (await import(`${adapterUrl}?unpriced`)).loadAdapters();
const card = (o) => ({ id: o.id, name: o.name, fact: o.fact, raw: o });

function saveAt(rank, embers = 0) {
  const save = defaultSave();
  save.forge.embers = embers;
  save.forge.ranks = Object.fromEntries(forge.FORGE_IDS.map((id) => [id, rank]));
  return save;
}

test('catalogue: shipped Mod choices and picks use the economy IDs and seeded rules', () => {
  assert.equal(api.real.mods, true);
  for (const seed of [1, 0x12345678, 0xffffffff]) for (const n of [13, 16, 19, 23, 26, 29]) for (const taken of [[], [0, 3, 11]]) for (const lives of [3, 5]) {
    const run = { ...createRun({ seed, levelN: n }), mods: [...taken], lives };
    const rng = createRng(((run.seed | 0) * 31 + n * 7919 + (run.overburnWave | 0)) >>> 0);
    const expected = mods.modChoices(run, rng, 3);
    const offered = api.modChoices(run, n);
    assert.deepEqual(offered, expected.map(card));
    for (const option of offered) {
      const actualRun = structuredClone(run), expectedRun = structuredClone(run);
      api.applyMod(actualRun, option.id);
      mods.applyMod(expectedRun, option.id);
      assert.deepEqual(actualRun, expectedRun, 'the displayed ID applies the displayed Mod');
    }
  }
});

test('catalogue: shipped Overload cards retain rank facts, costs and equip IDs', () => {
  assert.equal(api.real.overloads, true);
  for (let rank = 0; rank <= forge.MAX_RANK; rank++) {
    const run = createRun({ save: saveAt(rank), levelN: 22 });
    const cards = api.overloadChoices(run);
    assert.deepEqual(cards, overloads.overloadChoices(run).map(card));
    for (const option of cards) {
      const picked = structuredClone(run);
      api.chooseOverload(picked, option.id);
      assert.equal(picked.overload, option.id);
      assert.equal(option.raw.cost, overloads.overloadCost(picked));
    }
  }
});

test('catalogue: shipped Forge keeps every rank fact, price and affordability boundary', () => {
  assert.equal(api.real.forge, true);
  for (let rank = 0; rank <= forge.MAX_RANK; rank++) for (const item of forge.FORGE_ITEMS) {
    const price = rank < item.max ? item.prices[rank] : 0;
    for (const embers of [Math.max(0, price - 1), price, 10000]) {
      const save = saveAt(rank, embers), before = structuredClone(save);
      const model = api.forgeModel(save);
      assert.deepEqual(save, before, 'building the screen never writes the save');
      assert.equal(model.embers, embers);
      assert.deepEqual(model.items.map((it) => it.id), forge.FORGE_IDS);
      const row = model.items.find((it) => it.id === item.id);
      assert.deepEqual({ id: row.id, name: row.name, fact: row.fact, max: row.max, rank: row.rank, price: row.price, affordable: row.affordable },
        { id: item.id, name: item.name, fact: item.ranks[Math.min(rank, item.max - 1)], max: item.max, rank, price, affordable: rank < item.max && embers >= price });
    }
  }
});

test('catalogue: unavailable optional exports still use canonical records and Forge prices', () => {
  assert.equal(fallback.real.mods, false);
  assert.equal(fallback.real.overloads, false);
  assert.equal(fallback.real.forge, false);
  for (let seed = 1; seed <= 24; seed++) {
    const cards = fallback.modChoices(createRun({ seed, levelN: 13 }), 13);
    assert.equal(cards.length, 3);
    for (const option of cards) assert.deepEqual(option, card(mods.MODS.find((m) => m.id === option.id)));
  }
  assert.deepEqual(fallback.overloadChoices(createRun()), overloads.OVERLOADS.map(card));
  for (let rank = 0; rank <= forge.MAX_RANK; rank++) {
    const save = saveAt(rank, 10000);
    assert.deepEqual(fallback.forgeModel(save), api.forgeModel(save), 'fallback rows use the same names, IDs, rank facts and prices');
    const withoutRaw = (model) => model.items.map(({ raw, ...row }) => row);
    assert.deepEqual(withoutRaw(unpricedApi.forgeModel(save)), withoutRaw(api.forgeModel(save)), 'missing price arrays resolve against canonical per-item prices');
  }
});

test('catalogue: shipped and fallback purchases round-trip with the existing save keys', () => {
  for (const item of forge.FORGE_ITEMS) for (let rank = 0; rank < item.max; rank++) for (const enough of [false, true]) {
    const original = saveAt(rank, item.prices[rank] - (enough ? 0 : 1));
    const expected = structuredClone(original);
    const result = forge.buyRank(expected, item.id);
    for (const adapter of [api, fallback, unpricedApi]) {
      const save = structuredClone(original);
      assert.equal(adapter.buyRank(save, item.id), result.ok);
      assert.deepEqual(save, expected);
      const storage = memoryStorage(), saved = createSave(storage);
      saved.write(save);
      assert.deepEqual(createSave(storage).load(), expected, 'every purchased rank survives reloading');
      assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)).forge.ranks, expected.forge.ranks);
    }
  }
  for (const adapter of [api, fallback, unpricedApi]) {
    const maxed = saveAt(forge.MAX_RANK, 10000), before = structuredClone(maxed);
    for (const id of [...forge.FORGE_IDS, 'ember', 'unknown']) assert.equal(adapter.buyRank(maxed, id), false);
    assert.deepEqual(maxed, before, 'maxed and obsolete IDs cannot spend embers');
  }
});

test('catalogue: existing v0 and v1 saves keep progress and every canonical Forge rank', () => {
  for (const raw of [
    { unlocked: 17, best: { 3: 4200 }, embers: 640, ranks: { lives: 1, heat: 2, embers: 3 }, settings: { sfx: .5 } },
    { ...saveAt(2, 640), campaign: { unlocked: 31, cleared: { 30: true }, best: { 30: 9000 } }, overburn: { best: 50000, bestWave: 9, lastSeed: 123 } },
  ]) {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    const saved = createSave(storage), loaded = saved.load(), before = structuredClone(loaded);
    assert.deepEqual(fallback.forgeModel(loaded), api.forgeModel(loaded));
    assert.deepEqual(loaded, before);
    saved.write(loaded);
    assert.deepEqual(createSave(storage).load(), before);
    assert.equal(before.forge.ranks.embers, raw.forge?.ranks.embers ?? raw.ranks.embers);
    assert.equal(before.campaign.unlocked, raw.campaign?.unlocked ?? raw.unlocked);
  }
});
