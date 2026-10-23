import { test, assert } from './lib.mjs';
import { installTreeDom } from './fixtures/D/dom.mjs';
import { resourceFact, forgeProgress, forgeProgressFact, bankStageRewards } from '../src/ui/resources.js';
import { guide, GUIDE } from '../src/ui/screens/guide.js';
import { results } from '../src/ui/screens/results.js';
import { createHud } from '../src/ui/hud.js';
import { createWorld } from '../src/core/world.js';
import { makeSystems } from '../src/systems.js';
import { getLevel } from '../src/levels/index.js';
import { DROP } from '../src/core/constants.js';
import { defaultSave } from '../src/economy/save.js';
import { createRun } from '../src/economy/economy.js';
import { bankRun, emberValue } from '../src/economy/forge.js';

test('resource fact names available HEAT uses and the real equipped Overload; win names banked count', () => {
  const w = createWorld({ level: getLevel(1), systems: makeSystems() });
  assert.equal(resourceFact(w), 'Embers → Forge');
  const heat = createWorld({ level: getLevel(7), systems: makeSystems() });
  assert.equal(resourceFact(heat), 'HEAT → Pull / Shield');
  heat.econ.shieldCost = 0;
  assert.equal(resourceFact(heat), 'HEAT → Pull', 'a shield already bought cannot be advertised again');
  for (const [id, name] of [[1, 'Purge'], [2, 'Quench'], [3, 'Fork']]) {
    heat.run.overload = id;
    assert.equal(resourceFact(heat), `HEAT → Pull / ${name}`);
  }
  heat.level.remaining = 0; heat.econ.embersCaught = 12; heat.econ.embersAutoBanked = 7;
  assert.equal(resourceFact(heat), '19 embers banked');
});

test('HUD keeps the resource fact until an opening power explanation occupies its reserved row', () => {
  const dom = installTreeDom();
  try {
    const hud = createHud(dom.root), w = createWorld({ level: getLevel(1), systems: makeSystems() });
    const key = name => hud.el.querySelectorAll('[data-k]').find(n => n.dataset.k === name);
    hud.update(w, 0);
    assert.equal(key('bossFact').hidden, false);
    assert.equal(key('bossFact').textContent, 'Embers → Forge');
    hud.openingDrop(DROP.WIDE, false, 0, 10); hud.update(w, 10);
    assert.equal(key('bossFact').hidden, true);
    assert.equal(key('dropFact').hidden, false);
    hud.update(w, 3000);
    assert.equal(key('bossFact').hidden, false);
    assert.equal(key('dropFact').hidden, true);
    w.level.remaining = 0; w.econ.embersAutoBanked = 21; hud.update(w, 4000);
    assert.equal(key('bossFact').textContent, '21 embers banked');
  } finally { dom.restore(); }
});

test('Forge progress uses saved wallet/current next ranks and handles an affordable or completed Forge', () => {
  const model = { embers: 40, items: [{ name: 'Maxed', rank: 3, max: 3, price: 0 },
    { name: 'Paddle', rank: 0, max: 3, price: 180 }, { name: 'Lives', rank: 1, max: 3, price: 300 }] };
  let p = forgeProgress(model);
  assert.equal(p.nextName, 'Paddle'); assert.equal(p.nextPrice, 180);
  assert.equal(forgeProgressFact(p), '140 more for Paddle · 180');
  model.embers = 200; p = forgeProgress(model);
  assert.equal(forgeProgressFact(p), 'Paddle ready · 180 embers');
  assert.equal(forgeProgressFact(forgeProgress({ embers: 600, items: [] })), 'All Forge upgrades complete');
});

test('Core stage banking records real Forge conversion once without marking the campaign level cleared', () => {
  const save = defaultSave(); save.forge.ranks.embers = 2;
  const run = createRun({ save, levelN: 30 });
  run.embersBanked = 11;
  let bankCalls = 0;
  const bank = (d, r) => { bankCalls++; return bankRun(d, r); };
  const w = { level: { n: 30, def: { stage: 1 } }, run, econ: { embersCaught: 4, embersAutoBanked: 7 } };
  const first = bankStageRewards(w, save, bank, null);
  assert.equal(first.forgeGain, Math.floor(11 * emberValue(run)));
  assert.notEqual(first.forgeGain, 11, 'raw count is not presented as actual converted currency');
  assert.equal(save.campaign.cleared['30'], undefined);
  assert.equal(bankStageRewards(w, save, bank, first), first);
  assert.equal(bankCalls, 1);
  run.embersBanked += 8; w.level.def.stage = 2; w.econ.embersCaught = 3; w.econ.embersAutoBanked = 5;
  const second = bankStageRewards(w, save, bank, first);
  assert.equal(second.caught, 7); assert.equal(second.auto, 12);
  assert.equal(second.forgeGain, Math.floor(11 * emberValue(run)) + Math.floor(8 * emberValue(run)));
  assert.equal(save.campaign.cleared['30'], undefined);
});

test('guide is an accessible scroll region with the real resource/desktop/phone rules and Back action', () => {
  const dom = installTreeDom();
  try {
    let back = 0;
    const nav = { count: 0, add() { this.count++; } };
    const api = guide({ onBack: () => back++ }, { el: dom.root, nav });
    const copy = dom.root.querySelector('.guide-copy');
    assert.equal(copy.getAttribute('role'), 'region'); assert.equal(copy.getAttribute('tabindex'), '0');
    assert.equal(copy.querySelectorAll('section').length, GUIDE.length);
    assert.match(copy.textContent, /100 HEAT/); assert.match(copy.textContent, /next run/);
    assert.match(copy.textContent, /second finger/); assert.match(copy.textContent, /banked automatically/);
    api.onBack(); assert.equal(back, 1);
  } finally { dom.restore(); }
});

test('results show ember totals, converted Forge gain and wallet without a collection breakdown', () => {
  for (const kind of ['cleared', 'wave', 'campaign', 'over']) {
    const dom = installTreeDom();
    try {
      const api = results({ kind, n: 10, wave: 1, score: 10000, runScore: 10000, embers: 14,
        rewards: { caught: 5, auto: 9, forgeGain: 21, wallet: 121, nextName: 'Paddle', nextPrice: 180 }, onNext() {} },
      { el: dom.root, nav: { count: 0, add() { this.count++; } }, reduceMotion: () => true });
      const summary = dom.root.querySelector('.resource-summary').textContent;
      assert.doesNotMatch(summary, /caught|auto-banked/);
      assert.match(dom.root.textContent, /14/);
      assert.match(summary, /Forge wallet 121 · \+21/);
      assert.match(summary, /59 more for Paddle/);
      api.dispose();
    } finally { dom.restore(); }
  }
});
