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
import { SHIELD } from '../src/economy/tuning.js';

test('resource facts explain earning HEAT, the input for Pull until first used, then spending and the pause', () => {
  const w = createWorld({ level: getLevel(1), systems: makeSystems() });
  assert.equal(resourceFact(w), '', 'no HEAT yet: no line (the L1 card already says what embers buy)');
  const heat = createWorld({ level: getLevel(7), systems: makeSystems() });
  assert.match(resourceFact(heat), /Catch embers.*HEAT/);
  heat.econ.heat = 40;
  assert.match(resourceFact(heat, true), /Hold.*finger.*Pull/);
  assert.match(resourceFact(heat, false), /Hold.*mouse.*Pull/);
  // once the player has pulled, the tip gives way to what the HEAT is spent on
  assert.equal(resourceFact(heat, true, true), `Shield costs ${SHIELD.COST} HEAT`);
  assert.equal(resourceFact(heat, false, true), `Shield costs ${SHIELD.COST} HEAT`);
  heat.paddle.pulling = true;
  assert.match(resourceFact(heat), /Pull active.*HEAT/);
  heat.paddle.pulling = false;
  heat.econ.ventMs = 1000;
  assert.equal(resourceFact(heat, false, true), 'HEAT paused');
  heat.econ.ventMs = 0;
  heat.level.rules.pull = false;
  assert.equal(resourceFact(heat), `Shield costs ${SHIELD.COST} HEAT`, 'a level without Pull shows the spending fact');
  heat.econ.shieldCost = 0;
  assert.equal(resourceFact(heat), '', 'a spent shield allowance is not advertised again');
  heat.level.rules.pull = true;
  for (const [id, name] of [[1, 'Purge'], [2, 'Quench'], [3, 'Fork']]) {
    heat.run.overload = id;
    assert.equal(resourceFact(heat, true, true), `${name} empties HEAT`);
  }
  heat.level.remaining = 0; heat.econ.embersCaught = 12; heat.econ.embersAutoBanked = 7;
  assert.equal(resourceFact(heat), '19 embers');
  heat.econ.embersCaught = 1; heat.econ.embersAutoBanked = 0;
  assert.equal(resourceFact(heat), '1 ember');
  heat.econ.embersCaught = 0;
  assert.equal(resourceFact(heat), '0 embers');
});

test('the per-frame resource fact allocates no new string while its value holds', () => {
  const heat = createWorld({ level: getLevel(22), systems: makeSystems() });
  heat.econ.heat = 40; heat.run.overload = 2;
  assert.ok(Object.is(resourceFact(heat, false, true), resourceFact(heat, false, true)));
  heat.level.remaining = 0; heat.econ.embersCaught = 5;
  const a = resourceFact(heat), b = resourceFact(heat);
  assert.equal(a, '5 embers');
  assert.ok(Object.is(a, b), 'the level-end count is built once, not every frame');
  heat.econ.embersCaught = 6;
  assert.equal(resourceFact(heat), '6 embers');
});

test('HUD: the Pull tip shows until the first Pull, which is saved once, then the HEAT fact', () => {
  const dom = installTreeDom();
  try {
    let saved = false, calls = 0;
    const hud = createHud(dom.root, { pulled: () => saved, onPulled: () => { saved = true; calls++; } });
    const w = createWorld({ level: getLevel(8), systems: makeSystems() });
    const key = name => hud.el.querySelectorAll('[data-k]').find(n => n.dataset.k === name);
    w.econ.heat = 40;
    hud.update(w, 0);
    assert.match(key('bossFact').textContent, /Hold.*Pull/);
    w.paddle.pulling = true; hud.update(w, 100);
    assert.equal(calls, 1); assert.equal(saved, true);
    w.paddle.pulling = false; hud.update(w, 200);
    assert.equal(key('bossFact').textContent, `Shield costs ${SHIELD.COST} HEAT`);
    w.paddle.pulling = true; hud.update(w, 300); w.paddle.pulling = false; hud.update(w, 400);
    assert.equal(calls, 1, 'the first Pull is saved once');
    hud.reset(); hud.update(w, 500);
    assert.equal(key('bossFact').textContent, `Shield costs ${SHIELD.COST} HEAT`, 'a new world reads the saved flag');
  } finally { dom.restore(); }
});

test('HUD keeps the resource fact until an opening power explanation occupies its reserved row', () => {
  const dom = installTreeDom();
  try {
    const hud = createHud(dom.root), w = createWorld({ level: getLevel(7), systems: makeSystems() });
    const key = name => hud.el.querySelectorAll('[data-k]').find(n => n.dataset.k === name);
    hud.update(w, 0);
    assert.equal(key('bossFact').hidden, false);
    assert.match(key('bossFact').textContent, /Catch embers.*HEAT/);
    hud.openingDrop(DROP.WIDE, false, 0, 10); hud.update(w, 10);
    assert.equal(key('bossFact').hidden, true);
    assert.equal(key('dropFact').hidden, false);
    hud.update(w, 3000);
    assert.equal(key('bossFact').hidden, false);
    assert.equal(key('dropFact').hidden, true);
    w.level.remaining = 0; w.econ.embersAutoBanked = 21; hud.update(w, 4000);
    assert.equal(key('bossFact').textContent, '21 embers');
    // levels before HEAT have no text under the meter, but the row keeps its place, so the
    // level-end count appears without moving the power labels below it
    const plain = createWorld({ level: getLevel(1), systems: makeSystems() });
    hud.reset(); hud.update(plain, 5000);
    assert.equal(key('bossFact').textContent, '');
    assert.equal(key('bossFact').hidden, false, 'an empty row is kept, not collapsed');
    assert.ok(hud.el.querySelector('.hud-heat').classList.contains('context-on'));
    plain.level.remaining = 0; plain.econ.embersCaught = 9; hud.update(plain, 6000);
    assert.equal(key('bossFact').textContent, '9 embers');
    assert.equal(key('bossFact').hidden, false, 'the level-end count still shows');
    assert.ok(hud.el.querySelector('.hud-heat').classList.contains('context-on'));
  } finally { dom.restore(); }
});

test('HUD: the power labels stay put when the fact under HEAT empties and fills (Pull after a bought Shield)', () => {
  const dom = installTreeDom();
  try {
    const hud = createHud(dom.root, { pulled: () => true });
    const w = createWorld({ level: getLevel(7), systems: makeSystems() });
    const key = name => hud.el.querySelectorAll('[data-k]').find(n => n.dataset.k === name);
    const heat = hud.el.querySelector('.hud-heat');
    // what places the fx row: the fact row's hidden flag and the block's classes (the CSS test
    // in tests/d-css checks that an empty fact keeps one line of height)
    const place = () => [key('bossFact').hidden, heat.classList.contains('context-on'), heat.classList.contains('drop-fact-on')].join();
    w.econ.heat = 40;
    hud.update(w, 0);
    assert.equal(key('bossFact').textContent, `Shield costs ${SHIELD.COST} HEAT`);
    const at = place();
    w.econ.shieldCost = 0; hud.update(w, 100); // the level's one Shield is bought
    assert.equal(key('bossFact').textContent, '');
    assert.equal(place(), at, 'empty fact: same place');
    for (let i = 0; i < 3; i++) {
      w.paddle.pulling = true; hud.update(w, 200 + i * 100);
      assert.equal(key('bossFact').textContent, 'Pull active · uses HEAT');
      assert.equal(place(), at, 'Pull held: same place');
      w.paddle.pulling = false; hud.update(w, 250 + i * 100);
      assert.equal(key('bossFact').textContent, '');
      assert.equal(place(), at, 'Pull released: same place');
    }
    w.econ.heat = 0; hud.update(w, 900);
    assert.match(key('bossFact').textContent, /Catch embers/);
    assert.equal(place(), at, 'empty HEAT: same place');
  } finally { dom.restore(); }
});

test('HUD confirms Pull is active without replacing the boss route, then restores the HEAT label', () => {
  const dom = installTreeDom();
  try {
    const hud = createHud(dom.root), w = createWorld({ level: getLevel(10), systems: makeSystems() });
    const key = name => hud.el.querySelectorAll('[data-k]').find(n => n.dataset.k === name);
    hud.update(w, 0);
    const route = key('bossFact').textContent;
    assert.equal(key('heatLabel').textContent, 'Heat');
    w.paddle.pulling = true; hud.update(w, 100);
    assert.equal(key('heatLabel').textContent, 'Pull');
    assert.match(key('heatRow').getAttribute('aria-label'), /Pull active.*HEAT/);
    assert.equal(key('bossFact').textContent, route, 'the boss objective remains visible while Pull is used');
    w.paddle.pulling = false; hud.update(w, 200);
    assert.equal(key('heatLabel').textContent, 'Heat');
  } finally { dom.restore(); }
});

test('Forge progress uses saved wallet/current next ranks and handles an affordable or completed Forge', () => {
  const model = { embers: 40, items: [{ name: 'Maxed', rank: 3, max: 3, price: 0 },
    { name: 'Paddle', rank: 0, max: 3, price: 180 }, { name: 'Lives', rank: 1, max: 3, price: 300 }] };
  let p = forgeProgress(model);
  assert.equal(p.nextPrice, 180);
  assert.equal(p.nextName, undefined, 'the fact never names an upgrade, so progress does not carry one');
  assert.equal(forgeProgressFact(p), '140 more embers for an upgrade');
  model.embers = 200; p = forgeProgress(model);
  assert.equal(forgeProgressFact(p), 'Enough for an upgrade', 'under Forge wallet, one name for the thing');
  assert.equal(forgeProgressFact(forgeProgress({ ...model, embers: 179 })), '1 more ember for an upgrade');
  assert.equal(forgeProgressFact(forgeProgress({ embers: 600, items: [] })), 'All Forge upgrades complete');
  for (const it of model.items) assert.ok(!forgeProgressFact(p).includes(it.name), 'a wallet fact, not a buying nudge');
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
    assert.match(copy.textContent, /second finger/); assert.match(copy.textContent, /on screen when you clear a level are caught for you/);
    assert.match(copy.textContent, /just as the ball meets the paddle/, 'a perfect hit is taught where it is named');
    for (const [title, fact] of GUIDE) {
      assert.ok(!/;/.test(fact), `${title}: full stops or ' · ', no semicolon fragments`);
      assert.ok(!/currency|cooldown|emitter|automatically|banked|final reward/i.test(fact), `${title}: player words only`);
      assert.ok(!/^Catch\b/.test(fact), `${title}: a fact, not an instruction (and Catch is a power's name)`);
    }
    assert.ok(GUIDE.some(([t]) => t === 'Action button'), 'the heading matches the setting it explains');
    api.onBack(); assert.equal(back, 1);
  } finally { dom.restore(); }
});

test('results show ember totals, converted Forge gain and wallet without a collection breakdown', () => {
  for (const kind of ['cleared', 'wave', 'campaign', 'over']) {
    const dom = installTreeDom();
    try {
      const api = results({ kind, n: 10, wave: 1, score: 10000, runScore: 10000, embers: 14,
        rewards: { caught: 5, auto: 9, forgeGain: 21, wallet: 121, nextPrice: 180 }, onNext() {} },
      { el: dom.root, nav: { count: 0, add() { this.count++; } }, reduceMotion: () => true });
      const summary = dom.root.querySelector('.resource-summary').textContent;
      assert.doesNotMatch(summary, /caught|auto-banked/);
      assert.match(dom.root.textContent, /14/);
      assert.match(summary, /Forge wallet 121 · \+21/);
      assert.match(summary, /59 more embers for an upgrade/);
      api.dispose();
    } finally { dom.restore(); }
  }
});
