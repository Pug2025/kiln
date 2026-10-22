// E: drops, their effects and the Mega rescue (CP2).

import { test, assert, near } from './lib.mjs';
import { EV } from '../src/core/events.js';
import { BRICK, SRC, DROP, DROP_COUNT, PADDLE, LIVES, SIM, MEGA_RESCUE } from '../src/core/constants.js';
import { setPhase } from '../src/core/world.js';
import { DROP_MS, DROP_FX, SCORE } from '../src/economy/tuning.js';
import { tableWeights, dropRate, isBad, cancels } from '../src/economy/drops.js';
import { rig, level } from './fixtures/E/rig.mjs';

const catchDrop = (r, kind) => {
  r.emit(EV.DROP_CAUGHT, 0, 360, 1000, kind);
  r.step();
};
const ms = (r, k) => r.world.econ.effectMs[k];

test('Wide and Shrink cancel', () => {
  const r = rig();
  catchDrop(r, DROP.SHRINK);
  assert.equal(r.world.effects.paddleW, PADDLE.W_SHRINK);
  catchDrop(r, DROP.WIDE);
  assert.equal(r.world.effects.paddleW, PADDLE.W, 'back to normal');
  assert.equal(ms(r, DROP.WIDE), 0);
  assert.equal(ms(r, DROP.SHRINK), 0);
  assert.ok(r.events(EV.EFFECT_OFF).some((e) => e.a === DROP.SHRINK));
  catchDrop(r, DROP.WIDE);
  assert.equal(r.world.effects.paddleW, PADDLE.W_WIDE);
  catchDrop(r, DROP.SHRINK);
  assert.equal(r.world.effects.paddleW, PADDLE.W);
  assert.equal(cancels(DROP.WIDE), DROP.SHRINK);
  assert.equal(cancels(DROP.MULTI), -1);
});

test('Slow and Fast cancel the same way; Slow and Fast scale ball speed', () => {
  const r = rig();
  catchDrop(r, DROP.SLOW);
  assert.equal(r.world.effects.ballSpeedScale, DROP_FX.SLOW_SCALE);
  catchDrop(r, DROP.FAST);
  assert.equal(r.world.effects.ballSpeedScale, 1);
  catchDrop(r, DROP.FAST);
  assert.equal(r.world.effects.ballSpeedScale, DROP_FX.FAST_SCALE);
});

test('one effect of each kind: catching it again refreshes it; timers run out', () => {
  const r = rig();
  setPhase(r.world, 'play');
  catchDrop(r, DROP.WIDE);
  r.step(SIM.HZ * 10);
  near(ms(r, DROP.WIDE), DROP_MS[DROP.WIDE] - 10000 - SIM.DT_MS * 0, 20);
  catchDrop(r, DROP.WIDE);
  near(ms(r, DROP.WIDE), DROP_MS[DROP.WIDE], SIM.DT_MS * 2);
  r.step(Math.ceil(DROP_MS[DROP.WIDE] / SIM.DT_MS) + 2);
  assert.equal(ms(r, DROP.WIDE), 0);
  assert.equal(r.world.effects.paddleW, PADDLE.W);
  assert.equal(r.events(EV.EFFECT_OFF).filter((e) => e.a === DROP.WIDE).length, 1);
});

test('Fire, Thru, Mega, Catch and Fog switch their effect flags; Fog fades out', () => {
  const r = rig();
  setPhase(r.world, 'play');
  for (const k of [DROP.FIRE, DROP.THRU, DROP.MEGA, DROP.CATCH, DROP.FOG]) catchDrop(r, k);
  const fx = r.world.effects;
  assert.ok(fx.fire && fx.thru && fx.mega && fx.catchOn);
  assert.equal(fx.fog, 1);
  r.step(Math.round((DROP_MS[DROP.FOG] - 500) / SIM.DT_MS));
  assert.ok(fx.fog > 0.4 && fx.fog < 0.6, `fog fading: ${fx.fog}`);
  r.step(SIM.HZ);
  assert.equal(fx.fog, 0);
});

test('Multi splits each ball into three; Life adds one up to five, then pays', () => {
  const r = rig();
  catchDrop(r, DROP.MULTI);
  assert.deepEqual(r.calls.split, [DROP_FX.MULTI_EXTRA]);
  for (let i = 0; i < 4; i++) catchDrop(r, DROP.LIFE);
  assert.equal(r.world.run.lives, LIVES.MAX);
  assert.equal(r.events(EV.LIFE_GAINED).length, 2);
  const before = r.world.run.score;
  catchDrop(r, DROP.LIFE);
  assert.equal(r.world.run.score - before, SCORE.LIFE_AT_MAX + SCORE.DROP_GOOD);
});

test('Laser: shots until spent, LASER_FIRED spends one, the last one ends it', () => {
  const r = rig();
  catchDrop(r, DROP.LASER);
  assert.equal(r.world.effects.laserShots, DROP_FX.LASER_SHOTS);
  assert.equal(ms(r, DROP.LASER), Infinity);
  for (let i = 0; i < DROP_FX.LASER_SHOTS - 1; i++) r.emit(EV.LASER_FIRED, i, 360, 990);
  r.step();
  assert.equal(r.world.effects.laserShots, 1);
  r.emit(EV.LASER_FIRED, 0, 360, 990);
  r.step();
  assert.equal(r.world.effects.laserShots, 0);
  assert.equal(ms(r, DROP.LASER), 0);
  assert.ok(r.events(EV.EFFECT_OFF).some((e) => e.a === DROP.LASER));
});

test('the last ball lost ends every timed effect; the shield count stays', () => {
  const r = rig({ run: undefined });
  for (const k of [DROP.WIDE, DROP.SLOW, DROP.FIRE, DROP.LASER, DROP.CATCH, DROP.FOG]) catchDrop(r, k);
  r.emit(EV.OUT_OF_BALLS);
  r.step();
  for (let k = 0; k < DROP_COUNT; k++) assert.equal(ms(r, k), 0, `kind ${k} off`);
  const fx = r.world.effects;
  assert.equal(fx.paddleW, PADDLE.W);
  assert.equal(fx.ballSpeedScale, 1);
  assert.equal(fx.laserShots, 0);
  assert.equal(fx.fog, 0);
});

test('drops pay points: good 50, red 150, times the multiplier', () => {
  assert.ok(isBad(DROP.SHRINK) && isBad(DROP.FAST) && isBad(DROP.FOG));
  assert.ok(!isBad(DROP.SLOW) && !isBad(DROP.MEGA));
  const r = rig();
  catchDrop(r, DROP.SLOW);
  assert.equal(r.world.run.score, SCORE.DROP_GOOD);
  catchDrop(r, DROP.FOG);
  assert.equal(r.world.run.score, SCORE.DROP_GOOD + SCORE.DROP_BAD);
  assert.equal(r.world.econ.dropsCaught, 2);
});

test('carriers always release a drop: their fixed kind, or one from the table', () => {
  const r = rig({ level: level({ drops: { rate: 0, table: { laser: 1 } } }) });
  r.world.bricks.drop[3] = DROP.CATCH;
  r.world.bricks.drop[4] = -1;
  r.emit(EV.BRICK_BROKEN, 3, 100, 200, BRICK.CARRIER, SRC.BALL, 0);
  r.emit(EV.BRICK_BROKEN, 4, 100, 200, BRICK.CARRIER, SRC.BALL, 0);
  r.emit(EV.BRICK_BROKEN, 5, 100, 200, BRICK.PLAIN, SRC.BALL, 0);
  r.step();
  assert.deepEqual(r.calls.drops, [DROP.CATCH, DROP.LASER]);
  assert.equal(r.events(EV.DROP_SPAWNED).length, 2);
  // A fixed Mega carrier is not a rescue: it rolls the table instead.
  r.world.bricks.drop[6] = DROP.MEGA;
  r.emit(EV.BRICK_BROKEN, 6, 100, 200, BRICK.CARRIER, SRC.BALL, 0);
  r.step();
  assert.equal(r.calls.drops[2], DROP.LASER);
});

test('random drops follow the level rate and table, deterministically; Mega is never random', () => {
  const w = new Float64Array(DROP_COUNT);
  tableWeights({ table: { wide: 2, mega: 50, fog: 1 } }, w);
  assert.equal(w[DROP.MEGA], 0);
  assert.equal(w[DROP.WIDE], 2);
  tableWeights({ table: {} }, w);
  assert.ok(w[DROP.WIDE] > 0 && w[DROP.MEGA] === 0, 'empty table falls back to the default');
  assert.equal(dropRate({ rate: 0.3 }), 0.3);
  assert.equal(dropRate({ rate: 0.7 }, 2), 1);
  assert.equal(dropRate(undefined), 0);
  const play = (seed) => {
    const r = rig({ seed, remaining: 1000, level: level({ drops: { rate: 0.25, table: { wide: 1, slow: 1, fog: 1 } } }) });
    for (let i = 0; i < 400; i++) r.emit(EV.BRICK_BROKEN, i, 100, 200, BRICK.PLAIN, SRC.BALL, 0);
    r.step();
    return r.calls.drops;
  };
  const a = play(4), b = play(4);
  assert.deepEqual(a, b);
  assert.ok(a.length > 70 && a.length < 130, `about 1 in 4: ${a.length}`);
  assert.ok(a.every((k) => k === DROP.WIDE || k === DROP.SLOW || k === DROP.FOG));
  const none = rig({ remaining: 1000 });
  for (let i = 0; i < 200; i++) none.emit(EV.BRICK_BROKEN, i, 100, 200, BRICK.PLAIN, SRC.BALL, 0);
  none.step();
  assert.equal(none.calls.drops.length, 0, 'rate 0: only carriers drop');
});

test('Mega only after 20 s at ≤5 bricks', () => {
  const mega = (r) => r.calls.drops.filter((k) => k === DROP.MEGA).length;
  const r = rig({ remaining: 5, level: level({ rules: { megaRescue: true } }) });
  setPhase(r.world, 'play');
  r.step(Math.floor(MEGA_RESCUE.AFTER_MS / SIM.DT_MS) - 2);
  assert.equal(mega(r), 0, 'not before 20 s');
  r.step(4);
  assert.equal(mega(r), 1, 'one Mega at 20 s');
  r.step(SIM.HZ * 5);
  assert.equal(mega(r), 1, 'only one per 20 s');
  // Six bricks: never.
  const six = rig({ remaining: 6, level: level({ rules: { megaRescue: true } }) });
  setPhase(six.world, 'play');
  six.step(SIM.HZ * 30);
  assert.equal(mega(six), 0);
  // No megaRescue rule: never.
  const off = rig({ remaining: 2 });
  setPhase(off.world, 'play');
  off.step(SIM.HZ * 30);
  assert.equal(mega(off), 0);
  // Back above 5 resets the clock.
  const back = rig({ remaining: 5, level: level({ rules: { megaRescue: true } }) });
  setPhase(back.world, 'play');
  back.step(SIM.HZ * 15);
  back.world.level.remaining = 8;
  back.step(2);
  back.world.level.remaining = 4;
  back.step(SIM.HZ * 15);
  assert.equal(mega(back), 0, 'the 20 s start again');
});

test('no Mega rescue in a boss fight (remaining counts weak-point hits there)', () => {
  const mega = (r) => r.calls.drops.filter((k) => k === DROP.MEGA).length;
  const r = rig({ remaining: 3, level: level({ kind: 'boss', rules: { megaRescue: true } }) });
  setPhase(r.world, 'play');
  r.step(SIM.HZ * 45);
  assert.equal(mega(r), 0);
});

test('no drops once the level is won (a boss defeat shower, chain breaks after the last brick)', () => {
  const r = rig({ remaining: 1, level: level({ drops: { rate: 1, table: { wide: 1 } } }) });
  r.world.bricks.drop[2] = DROP.LASER;
  r.emit(EV.BRICK_BROKEN, 1, 100, 200, BRICK.PLAIN, SRC.BALL, 0);
  r.step();
  assert.deepEqual(r.calls.drops, [DROP.WIDE], 'rate 1: a drop while the level is live');
  r.world.level.remaining = 0;
  r.emit(EV.BRICK_BROKEN, 2, 100, 200, BRICK.CARRIER, SRC.BOSS, -1);
  r.emit(EV.BRICK_BROKEN, 3, 100, 200, BRICK.PLAIN, SRC.EXPLOSION, -1);
  r.step(3);
  assert.deepEqual(r.calls.drops, [DROP.WIDE], 'nothing after the win');
  assert.equal(r.calls.embers.length, 3, 'embers still burst: the win pays');
});
