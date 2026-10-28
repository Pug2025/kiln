// E: The Forge, ball kinds and banking (CP2).

import { test, assert } from './lib.mjs';
import { EV } from '../src/core/events.js';
import { LIVES, HEAT, PADDLE, PERFECT } from '../src/core/constants.js';
import { setPhase } from '../src/core/world.js';
import {
  FORGE_ITEMS, FORGE_IDS, MAX_RANK, BALL_KIND, forgePrice, nextPrice, buyRank, ballKindsUnlocked, bankRun, ranksOf,
  recordClear,
} from '../src/economy/forge.js';
import { createRun } from '../src/economy/economy.js';
import { defaultSave } from '../src/economy/save.js';
import { FORGE_FX } from '../src/economy/tuning.js';
import { rig, level } from './fixtures/E/rig.mjs';

const saveWith = (ranks, embers = 0) => {
  const s = defaultSave();
  s.forge.ranks = { ...ranks };
  s.forge.embers = embers;
  return s;
};

test('six items, three ranks each, prices rise', () => {
  assert.deepEqual(FORGE_IDS, ['lives', 'heat', 'paddle', 'embers', 'overload', 'ball']);
  for (const it of FORGE_ITEMS) {
    assert.equal(it.ranks.length, MAX_RANK);
    assert.equal(it.max, MAX_RANK);
    assert.ok(it.fact && it.fact.length <= 40, `${it.id} has a short fact`);
    assert.equal(it.prices.length, MAX_RANK);
    assert.ok(it.prices[0] < it.prices[1] && it.prices[1] < it.prices[2], it.id);
    assert.equal(forgePrice(it.id, 1), it.prices[0]);
  }
  assert.equal(forgePrice('lives', 0), -1);
  assert.equal(forgePrice('lives', 4), -1);
  assert.equal(forgePrice('nope', 1), -1);
});

test('Forge rank facts use player units and the game\'s separator', () => {
  const paddle = FORGE_ITEMS.find((it) => it.id === 'paddle');
  paddle.ranks.forEach((fact, i) => {
    assert.equal(fact, `Paddle ${Math.round((FORGE_FX.PADDLE_ADD[i + 1] / PADDLE.W) * 100)}% wider`);
  });
  for (const it of FORGE_ITEMS) for (const fact of [it.fact, ...it.ranks]) {
    assert.ok(!/;|→/.test(fact), `${it.id}: "${fact}" has no semicolon fragments or field units`);
  }
  // a rank fact in parts never splits a number from its word or unit, never starts a line with '·',
  // and has no unbreakable run longer than 'HEAT pause −2 s ·' (16 characters), the longest that fit
  // a 320 px Forge row in the captures (a longer one pushed the Buy button out of the panel)
  for (const it of FORGE_ITEMS) for (const fact of it.ranks) {
    if (!fact.includes('·')) continue;
    assert.ok(!/ [+\u2212]?\d|\d /.test(fact), `${it.id}: "${fact}" can split a number from its word or unit`);
    assert.ok(!/ \u00b7/.test(fact) && !/\u00b7\u00a0/.test(fact), `${it.id}: "${fact}" keeps '·' with the part before it`);
    for (const run of fact.split(' ')) assert.ok(run.length <= 16, `${it.id}: "${run}" cannot wrap on a 320 px row`);
  }
});

test('buyRank spends banked embers, one rank at a time, up to three', () => {
  const s = saveWith({}, 1000);
  assert.equal(nextPrice(s, 'heat'), 150);
  assert.deepEqual(buyRank(s, 'heat'), { ok: true, rank: 1, price: 150 });
  assert.equal(s.forge.embers, 850);
  assert.equal(buyRank(s, 'heat').rank, 2);
  assert.equal(s.forge.embers, 450);
  const fail = buyRank(s, 'heat');
  assert.equal(fail.ok, false);
  assert.equal(fail.reason, 'embers');
  assert.equal(s.forge.embers, 450, 'nothing spent on a failed buy');
  s.forge.embers = 5000;
  buyRank(s, 'heat');
  assert.equal(buyRank(s, 'heat').reason, 'max');
  assert.equal(nextPrice(s, 'heat'), -1);
  assert.equal(ranksOf(s).heat, 3);
  assert.equal(buyRank(s, 'bogus').ok, false);
});

test('createRun applies The Forge: lives, free miss, HEAT size, paddle width', () => {
  assert.equal(createRun({ save: saveWith({ lives: 1 }) }).lives, 4);
  assert.equal(createRun({ save: saveWith({ lives: 2 }) }).lives, LIVES.MAX);
  const top = createRun({ save: saveWith({ lives: 3, heat: 2, paddle: 3 }) });
  assert.equal(top.lives, LIVES.MAX, 'max lives stays 5');
  assert.equal(top.freeMiss, 1);
  const r = rig({ run: top });
  assert.equal(r.world.econ.heatMax, 140);
  assert.equal(r.world.effects.paddleW, PADDLE.W + 30);
  // Wide and Shrink work from the Forge width.
  r.emit(EV.DROP_CAUGHT, 0, 360, 1000, 0 /* WIDE */);
  r.step();
  assert.equal(r.world.effects.paddleW, PADDLE.W + 30 + (PADDLE.W_WIDE - PADDLE.W));
  assert.equal(rig().world.econ.heatMax, HEAT.MAX);
});

test('free miss: the first lost ball of the run costs no life', () => {
  const run = createRun({ save: saveWith({ lives: 3 }) });
  const r = rig({ run });
  r.emit(EV.OUT_OF_BALLS);
  r.step();
  assert.equal(run.lives, 5);
  assert.equal(run.freeMiss, 0);
  assert.equal(r.events(EV.FREE_MISS).length, 1);
  assert.equal(r.calls.serve, 1);
  r.emit(EV.OUT_OF_BALLS);
  r.step();
  assert.equal(run.lives, 4);
});

test('ball kinds: unlocked by rank; Heavy is slower, Sniper always aims, Splitter is told to physics', () => {
  assert.deepEqual(ballKindsUnlocked(saveWith({})), [0]);
  assert.deepEqual(ballKindsUnlocked(saveWith({ ball: 3 })), [0, 1, 2, 3]);
  assert.equal(createRun({ save: saveWith({ ball: 1 }), ballKind: BALL_KIND.SNIPER }).ballKind, BALL_KIND.HEAVY, 'clamped to unlocked');
  const heavy = rig({ run: createRun({ save: saveWith({ ball: 1 }), ballKind: BALL_KIND.HEAVY }) });
  assert.equal(heavy.world.effects.ballKind, BALL_KIND.HEAVY);
  assert.equal(heavy.world.effects.ballSpeedScale, FORGE_FX.HEAVY_SPEED);
  const sniper = rig({ run: createRun({ save: saveWith({ ball: 3 }), ballKind: BALL_KIND.SNIPER }) });
  assert.equal(sniper.world.effects.aimLine, true);
  // Physics (A) splits the Splitter ball at the perfect contact; the economy must not split it
  // again (a second split turned one ball into four).
  const split = rig({ run: createRun({ save: saveWith({ ball: 2 }), ballKind: BALL_KIND.SPLITTER }) });
  assert.equal(split.world.effects.ballKind, BALL_KIND.SPLITTER);
  split.emit(EV.PERFECT_HIT, 0, 360, 1000);
  split.step();
  assert.equal(split.calls.split.length, 0, 'no second split from the economy');
  const std = rig();
  std.emit(EV.PERFECT_HIT, 0, 360, 1000);
  std.step();
  assert.equal(std.calls.split.length, 0);
  assert.ok(PERFECT.WINDOW_MS > 0);
});

test('bankRun: banks only new embers, at the ember value; records progress', () => {
  const save = defaultSave();
  const run = createRun({ save: saveWith({ embers: 3 }) });
  run.embersBanked = 120;
  run.levelN = 3;
  const a = bankRun(save, run, { cleared: true, n: 3, levelScore: 2400 });
  assert.equal(a.gain, 240, 'ember value ×2 at rank 3');
  assert.equal(save.forge.embers, 240);
  assert.equal(save.campaign.unlocked, 4);
  assert.equal(save.campaign.cleared['3'], true);
  assert.equal(save.campaign.best['3'], 2400);
  const again = bankRun(save, run, {});
  assert.equal(again.gain, 0, 'the same embers are never banked twice');
  run.embersBanked = 150;
  const b = bankRun(save, run, { over: true });
  assert.equal(b.gain, 60);
  assert.equal(save.forge.embers, 300);
  assert.equal(save.stats.runs, 1);
  bankRun(save, run, { cleared: true, n: 3, levelScore: 900 });
  assert.equal(save.campaign.best['3'], 2400, 'best stays best');
  bankRun(save, run, { cleared: true, n: 30 });
  assert.equal(save.campaign.unlocked, 31, 'Overburn unlocks after 30');
  const s2 = defaultSave();
  recordClear(s2, 5, 700);
  recordClear(s2, 5, 650);
  assert.deepEqual([s2.campaign.unlocked, s2.campaign.cleared['5'], s2.campaign.best['5']], [6, true, 700]);
  bankRun(s2, createRun(), { cleared: true, levelN: 6 });
  assert.equal(s2.campaign.unlocked, 7, 'levelN works as well as n');
  const ob = createRun({ overburnWave: 4 });
  ob.score = 12345;
  bankRun(save, ob, { over: true });
  assert.deepEqual([save.overburn.best, save.overburn.bestWave], [12345, 4]);
  bankRun(save, ob, { over: true, wave: 7 });
  assert.equal(save.overburn.bestWave, 7, 'the wave can come with the result');
});

test('a run created without a save has no Forge ranks (all zero)', () => {
  const run = createRun();
  for (const id of FORGE_IDS) assert.equal(run.forge[id], 0);
  const r = rig({ run, level: level() });
  setPhase(r.world, 'play');
  assert.equal(r.world.effects.paddleW, PADDLE.W);
});
