// Kiln: D's run flow rules (src/app/flow.js). No DOM.

import { test, assert } from './lib.mjs';
import { PICKS } from '../src/core/constants.js';
import {
  worldOf, kindOf, pickFor, preLevelPicks, gateAfter, afterWorld, continueLevel, overburnOpen,
  recordClear, mapModel, canPause, restartRun, migrateLite, liteNow, autoLiteTripped, playerSetsLite,
} from '../src/app/flow.js';
import { readFileSync } from 'node:fs';
import { defaultSave, createSave, memoryStorage } from '../src/economy/save.js';
import { STORAGE_KEY } from '../src/core/constants.js';
import { LEVEL_NAMES } from '../src/levels/index.js';

const run = (o = {}) => ({ overload: 0, mods: [], ...o });
const def = (n, o = {}) => ({ n, kind: kindOf(n), ...o });

test('worlds and kinds by level number', () => {
  assert.deepEqual([1, 10, 11, 20, 21, 30, 31].map(worldOf), ['ember', 'ember', 'blaze', 'blaze', 'whiteheat', 'whiteheat', 'overburn']);
  assert.deepEqual([5, 15, 25].map(kindOf), ['bonus', 'bonus', 'bonus']);
  assert.deepEqual([10, 20, 30].map(kindOf), ['boss', 'boss', 'boss']);
  assert.equal(kindOf(13), 'normal');
});

test('Mod picks at 13, 16, 19, 23, 26, 29 and the Overload at 22', () => {
  assert.deepEqual(PICKS.MOD_LEVELS, [13, 16, 19, 23, 26, 29]);
  for (let n = 1; n <= 30; n++) {
    const want = PICKS.MOD_LEVELS.includes(n) ? 'mod' : n === 22 ? 'overload' : null;
    assert.equal(pickFor(def(n)), want, `level ${n}`);
  }
  assert.equal(pickFor(def(14, { pick: 'mod' })), 'mod', 'B data wins');
  assert.equal(pickFor(def(13, { pick: null })), null);
  assert.equal(pickFor(def(30, { stage: 2 })), null, 'no pick inside The Core');
});

test('a run in progress gets exactly the pick of its level', () => {
  assert.deepEqual(preLevelPicks(def(12), run({ mods: [1] })), []);
  assert.deepEqual(preLevelPicks(def(13), run()), ['mod']);
  assert.deepEqual(preLevelPicks(def(22), run({ mods: [1, 2] })), ['overload']);
  assert.deepEqual(preLevelPicks(def(23), run({ mods: [1], overload: 2 })), ['mod']);
  assert.deepEqual(preLevelPicks(def(24), run({ mods: [1], overload: 2 })), []);
});

test('a run started late is not left short of picks', () => {
  assert.deepEqual(preLevelPicks(def(1), run(), { first: true }), []);
  assert.deepEqual(preLevelPicks(def(13), run(), { first: true }), ['mod']);
  assert.deepEqual(preLevelPicks(def(14), run(), { first: true }), ['mod']);
  assert.deepEqual(preLevelPicks(def(22), run(), { first: true }), ['overload', 'mod']);
  assert.deepEqual(preLevelPicks(def(24), run(), { first: true }), ['overload', 'mod']);
  assert.deepEqual(preLevelPicks(def(26), run(), { first: true }), ['overload', 'mod']);
  assert.deepEqual(preLevelPicks(def(31), run(), { first: true }), ['overload', 'mod'], 'Overburn wave 1');
});

test('gates from 13, never before a bonus or boss level', () => {
  const next = (n) => def(n + 1);
  const gated = [];
  for (let n = 1; n < 30; n++) if (gateAfter(def(n), next(n))) gated.push(n);
  assert.deepEqual(gated, [13, 15, 16, 17, 18, 20, 21, 22, 23, 25, 26, 27, 28]);
  assert.equal(gateAfter(def(13), next(13)), true, 'after level 13 a gate appears');
  assert.equal(gateAfter(def(14), next(14)), false, '15 is a bonus level');
  assert.equal(gateAfter(def(19), next(19)), false, '20 is a boss level');
  assert.equal(gateAfter(def(13, { gate: false }), next(13)), false);
  assert.equal(gateAfter(def(30, { continues: 'core-2' }), def(30)), false);
  assert.equal(gateAfter(def(13), null), false);
});

test('after a world: stage chain, next level, campaign end, Overburn waves, run over', () => {
  assert.deepEqual(afterWorld(def(4), 'cleared'), { type: 'next', n: 5 });
  assert.deepEqual(afterWorld(def(4), 'over'), { type: 'over' });
  assert.deepEqual(afterWorld(def(30, { continues: 'core-2' }), 'cleared', { hasStage: () => true }), { type: 'stage', id: 'core-2' });
  assert.deepEqual(afterWorld(def(30, { continues: 'core-2' }), 'over'), { type: 'over' }, 'losing inside The Core ends the run');
  assert.deepEqual(afterWorld(def(30, { stage: 3 }), 'cleared'), { type: 'campaign' });
  assert.deepEqual(afterWorld(def(33, { world: 'overburn' }), 'cleared', { wave: 3 }), { type: 'wave', wave: 4 });
});

test('progress: clearing unlocks the next level and keeps the best score', () => {
  const s = defaultSave();
  assert.equal(continueLevel(s.campaign), 1);
  recordClear(s, 1, 900);
  assert.equal(s.campaign.unlocked, 2);
  assert.equal(continueLevel(s.campaign), 2);
  recordClear(s, 1, 400);
  assert.equal(s.campaign.best[1], 900, 'a worse replay keeps the best');
  recordClear(s, 1, 1200);
  assert.equal(s.campaign.best[1], 1200);
  assert.equal(s.campaign.unlocked, 2, 'replaying level 1 does not unlock more');
  assert.equal(overburnOpen(s.campaign), false);
  recordClear(s, 30, 5000);
  assert.equal(overburnOpen(s.campaign), true);
  assert.equal(continueLevel(s.campaign), 30);
});

test('map model: three worlds of ten, locked / open / cleared, Overburn locked until 30', () => {
  const s = defaultSave();
  recordClear(s, 1, 700);
  recordClear(s, 2, 800);
  const m = mapModel(s, () => null, LEVEL_NAMES);
  assert.equal(m.worlds.length, 3);
  assert.deepEqual(m.worlds.map((w) => w.levels.length), [10, 10, 10]);
  const ember = m.worlds[0].levels;
  assert.deepEqual(ember.slice(0, 4).map((l) => l.state), ['cleared', 'cleared', 'open', 'locked']);
  assert.equal(ember[0].name, 'Ignition');
  assert.equal(ember[0].best, 700);
  assert.equal(m.worlds[2].levels[9].name, 'The Core');
  assert.equal(m.worlds[1].open, false);
  assert.equal(m.overburn.open, false);
  assert.equal(m.current, 3);
});

test('pause opens only in live play, never once the world is cleared or over', () => {
  const play = { mode: 'play', paused: false };
  assert.equal(canPause(play, 'serve'), true);
  assert.equal(canPause(play, 'play'), true);
  assert.equal(canPause(play, 'over'), false, 'run over: the results come, no Restart can cancel them');
  assert.equal(canPause(play, 'cleared'), false, 'cleared: the results (or next stage) come');
  assert.equal(canPause({ mode: 'play', paused: true }, 'play'), false, 'already paused');
  assert.equal(canPause({ mode: 'menu', paused: false }, 'play'), false, 'menus over the attract world');
  assert.equal(canPause({ mode: 'ended', paused: false }, 'cleared'), false);
});

test('restart level keeps the lives the player has now (a restart never refunds a life)', () => {
  const start = () => ({ lives: 3, freeMiss: 1, score: 5000, mods: [2] });
  // lost two lives this attempt: restart with one, the score and Mods as the world began
  let r = restartRun(start(), { lives: 1, freeMiss: 1, score: 9000, mods: [2] });
  assert.equal(r.lives, 1);
  assert.equal(r.score, 5000, 'the level score of the abandoned attempt goes');
  assert.deepEqual(r.mods, [2]);
  // a free miss used this attempt stays used
  r = restartRun(start(), { lives: 3, freeMiss: 0, score: 6000, mods: [2] });
  assert.equal(r.freeMiss, 0);
  assert.equal(r.lives, 3);
  // a Life drop caught this attempt is not kept: the level (and its drop) is played again
  r = restartRun(start(), { lives: 4, freeMiss: 1, score: 6000, mods: [2] });
  assert.equal(r.lives, 3);
  // no life left: nothing to restart (the run is over)
  assert.equal(restartRun(start(), { lives: 0, freeMiss: 0, score: 0, mods: [2] }), null);
});

test('main.js: pause goes through canPause, Restart through restartRun, every exit unducks the music', () => {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const fn = (name) => {
    const at = src.indexOf(`function ${name}(`);
    assert.ok(at >= 0, `main.js has ${name}()`);
    const end = src.indexOf('\n  }\n', at);
    return src.slice(at, end);
  };
  assert.match(fn('pause'), /canPause\(/, 'pause() asks canPause (no pause after the world ends)');
  assert.match(fn('showPause'), /restartRun\(/, 'Restart level asks restartRun (lives are not refunded)');
  assert.doesNotMatch(fn('showPause'), /app\.run = clone\(app\.stageRun\)/, 'no bare stage snapshot');
  // E's audio.suspend() under the pause menu must be undone by Resume, Restart level and Levels
  const writes = src.match(/app\.paused = false/g) || [];
  assert.equal(writes.length, 1, 'app.paused is cleared in one place only');
  assert.match(fn('leavePause'), /app\.paused = false[\s\S]*audio\.resume\(\)/, 'leavePause resumes the audio');
  for (const name of ['resume', 'playWorld', 'toMenu']) assert.match(fn(name), /leavePause\(\)/, `${name}() leaves the pause through leavePause`);
});

test('adapters: the Overload pick shows the facts at the run\'s Forge rank (E\'s overloadChoices) and sw.js caches the font files', () => {
  const src = readFileSync(new URL('../src/app/adapters.js', import.meta.url), 'utf8');
  assert.match(src, /overloadChoices:\s*'\.\.\/economy\/overloads\.js'/, 'looked up in overloads.js');
  const at = src.indexOf('    overloadChoices(run) {');
  assert.ok(at > 0);
  assert.match(src.slice(at, at + 400), /f\.overloadChoices\(run\)/, 'E\'s cards first, the pool only as a fallback');
  // G's pwacheck: Chrome's Resource Timing omits the Google Fonts files, so the worker reads the
  // stylesheet and caches its Latin faces itself
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /unicode-range:\\s\*U\\\+0000-00FF/, 'Latin faces from the stylesheet');
  assert.match(sw, /fonts\\\.gstatic\\\.com/, 'their gstatic files join the list');
});

test('lite: a save the old auto-lite wrote loads with lite off; the player\'s own switch is kept', () => {
  const store = memoryStorage();
  const old = defaultSave();
  old.settings.lite = true; // written by the old onAutoLite, no liteSet
  store.setItem(STORAGE_KEY, JSON.stringify(old));
  const save = createSave(store);
  const data = save.load();
  assert.equal(migrateLite(data.settings), true, 'repaired');
  save.write(data);
  assert.equal(JSON.parse(store.getItem(STORAGE_KEY)).settings.lite, false, 'a reload gives lite false');
  assert.equal(migrateLite(data.settings), false, 'nothing to repair a second time');
  // the Settings switch is the player's choice: it survives a reload
  const session = { autoLite: false };
  playerSetsLite(data.settings, session, true);
  save.write(data);
  const again = createSave(store).load();
  assert.equal(again.settings.liteSet, true, 'save.js keeps liteSet');
  assert.equal(migrateLite(again.settings), false, 'a chosen lite is never reset');
  assert.equal(again.settings.lite, true);
});

test('lite: auto-lite lasts the session and never reaches the save, however long the bot plays', () => {
  const store = memoryStorage();
  const save = createSave(store);
  const data = save.load();
  const app = { autoLite: false, liteNote: false };
  // ten minutes of bot play: auto-lite trips again and again, the game saves after every level
  for (let level = 0; level < 600; level++) {
    autoLiteTripped(app);
    save.write(data);
  }
  assert.equal(liteNow(data.settings, app), true, 'the session runs lite');
  assert.equal(app.liteNote, true, 'it says so once, out of play');
  const stored = JSON.parse(store.getItem(STORAGE_KEY)).settings;
  assert.equal(stored.lite, false, 'lite never written');
  assert.equal(stored.liteSet, undefined, 'liteSet only from the switch');
  // a new session starts full
  assert.equal(liteNow(createSave(store).load().settings, { autoLite: false }), false);
  // the switch turned off wins over this session's auto-lite
  playerSetsLite(data.settings, app, false);
  assert.equal(liteNow(data.settings, app), false);
  // main.js: onAutoLite touches neither settings.lite nor the save
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const at = src.indexOf('onAutoLite()');
  assert.ok(at >= 0, 'main.js passes onAutoLite');
  const body = src.slice(at, src.indexOf('},', at));
  assert.doesNotMatch(body, /settings\.lite|save\.write/, 'onAutoLite writes nothing');
  assert.equal((src.match(/settings\.lite\s*=(?!=)/g) || []).length, 0, 'main.js never assigns settings.lite directly');
});
