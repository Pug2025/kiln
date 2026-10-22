// Kiln: the economy system (OWNER: E): embers and drops to spawn, HEAT, combo, score, lives,
// drop effects, Overloads, Mods, The Forge's in-run effects.
//
// Pipeline slot 5 (src/core/world.js): step(world, input) runs after physics.move and
// content.resolve and reads every event since its last read through its own bus reader:
//   BRICK_BROKEN   → score, 2–4 embers (world.api.spawnEmbers; none for an Overload's own
//                    bricks or the blasts they set off), maybe a drop (spawnDrop)
//   EMBER_CAUGHT   → +4 HEAT (×2 at ≤3 bricks), +1 combo, points
//   DROP_CAUGHT    → the drop's effect (world.effects), points
//   PERFECT_HIT    → points (the Splitter ball splits in physics)
//   LASER_FIRED / SHIELD_USED → spend a laser shot / a shield
//   OUT_OF_BALLS   → effects end, combo halves, a life (or a free miss) goes, then serve or 'over'
//   PHASE→cleared  → clear bonus, cavity doubling, LEVEL_CLEARED
// then: the overload input (Overload, or before 22 one shield per level), effect timers, the Mega rescue,
// HEAT drain while paddle.pulling, world.effects and fx.heatLevel / fx.lastLife.
// world.api installed here: addScore, addHeat, applyDrop.
//
// Single writer of world.econ, world.run, world.effects, fx.lastLife, fx.heatLevel.
// Deterministic: randomness only from world.rng.economy, time only from world.time.

import {
  SIM, HEAT, EMBERS, LIVES, PULL, PADDLE, DROP, DROP_COUNT, MEGA_RESCUE, OVERLOAD, LAST_BRICKS,
  BF, FIELD, BRICK, SRC, POOL,
} from '../core/constants.js';
import { EV, PHASE_CODE } from '../core/events.js';
import { emit, createReader, next } from '../core/bus.js';
import { setPhase } from '../core/world.js';
import { SCORE, DROP_MS, DROP_FX, QUENCH_SCALE, SHIELD, MOD_FX, FORGE_FX } from './tuning.js';
import { multFor, halveCombo, brickPoints, clearBonus, heatPerEmber, intensity, paceOf, paceDecay } from './score.js';
import { isBad, cancels, tableWeights, dropRate } from './drops.js';
import { MOD, hasMod } from './mods.js';
import { overloadCost, overloadPower } from './overloads.js';
import { ranksOf, runRanks, BALL_KIND } from './forge.js';

export { multFor } from './score.js';

/** The catch sum behind the music's pace term loses this share every step. */
const PACE_DECAY = paceDecay(SIM.DT_MS);

/**
 * A new run (campaign or Overburn) with The Forge's ranks applied from the save.
 * @param {{seed?:number, levelN?:number, save?:import('../core/types.js').SaveData,
 *   ballKind?:number, overburnWave?:number}} [opts]
 * @returns {import('../core/types.js').RunState}
 */
export function createRun(opts = {}) {
  const forge = ranksOf(opts.save);
  const kind = Math.max(0, Math.min(forge.ball, opts.ballKind | 0));
  return {
    seed: opts.seed ?? 1,
    levelN: opts.levelN ?? 1,
    lives: FORGE_FX.START_LIVES[forge.lives],
    score: 0,
    mods: [],
    overload: OVERLOAD.NONE,
    ballKind: kind,
    twist: null,
    overburnWave: opts.overburnWave | 0,
    embersBanked: 0,
    forge,
    freeMiss: FORGE_FX.FREE_MISS[forge.lives],
    banked: 0,
    carryHeat: -1,
    carryCombo: -1,
  };
}

/**
 * @returns {import('../core/types.js').System}
 */
export function createEconomy() {
  /** @type {import('../core/types.js').BusReader} */
  let rd;
  // Private per-world state (preallocated in init; nothing allocates in step).
  const weights = new Float64Array(DROP_COUNT);
  // Explosive bricks an Overload broke: their blast is the Overload's work too (no embers).
  const overloadBlast = new Uint8Array(POOL.BRICKS);
  const st = {
    blastByOverload: false, // the current blast (last EXPLOSION read) was set off by an Overload
    laserShots: 0,
    shield: 0,
    shieldsBought: 0,    // shields bought with HEAT this level (SHIELD.PER_LEVEL)
    quenchMs: 0,
    slowStartMs: 0,
    lowSinceMs: -1,      // Mega rescue: sim time since ≤5 bricks remain, −1 when not
    pace: 0,             // music pace: embers caught, each fading over INTENSITY.PACE_TAU_MS
    awarded: false,      // clear bonus given
    cleared: false,      // LEVEL_CLEARED emitted
    // run-derived, fixed for the world
    baseW: PADDLE.W,
    emberHeat: HEAT.PER_EMBER,
    pullScale: 1,
    rate: 0,
    burst: false,
    comboFloor: 0,
    catchMs: DROP_MS[DROP.CATCH],
    laserShotsPerDrop: DROP_FX.LASER_SHOTS,
    slowStart: false,
    heavy: false,
  };

  function setCombo(world, combo) {
    const e = world.econ;
    const old = e.mult;
    e.combo = combo;
    e.mult = multFor(combo);
    if (e.mult > old) emit(world.bus, EV.COMBO_STEP, 0, 0, 0, e.mult, combo);
  }

  /** Points × the multiplier now. */
  function addScore(world, points, x, y) {
    const e = world.econ;
    const pts = Math.round(points * e.mult);
    if (!pts) return;
    e.levelScore += pts;
    world.run.score += pts;
    emit(world.bus, EV.SCORE, 0, x, y, pts, e.mult);
  }

  /** Flat points (bonuses), no multiplier. */
  function addFlat(world, pts, x, y) {
    if (!pts) return;
    world.econ.levelScore += pts;
    world.run.score += pts;
    emit(world.bus, EV.SCORE, 0, x, y, pts, 1);
  }

  function addHeat(world, n) {
    const e = world.econ;
    if (n > 0 && e.ventMs > 0) return; // the kiln is venting after an Overload
    const was = e.heat;
    e.heat = Math.max(0, Math.min(e.heatMax, e.heat + n));
    if (was < e.heatMax && e.heat >= e.heatMax) emit(world.bus, EV.HEAT_FULL);
  }

  function effectOff(world, kind) {
    const ms = world.econ.effectMs;
    if (ms[kind] === 0) return;
    ms[kind] = 0;
    if (kind === DROP.LASER) st.laserShots = 0;
    emit(world.bus, EV.EFFECT_OFF, 0, 0, 0, kind);
  }

  /** Apply a drop's effect (caught, or via world.api.applyDrop). */
  function applyDropEffect(world, kind) {
    const e = world.econ;
    const ms = e.effectMs;
    const other = cancels(kind);
    if (other >= 0 && ms[other] > 0) {
      // Wide/Shrink and Slow/Fast cancel: both end, back to normal.
      effectOff(world, other);
      return;
    }
    switch (kind) {
      case DROP.MULTI: {
        const made = world.api.splitBalls(DROP_FX.MULTI_EXTRA);
        emit(world.bus, EV.EFFECT_ON, 0, 0, 0, kind, 0, made | 0);
        return;
      }
      case DROP.LIFE: {
        if (world.run.lives < LIVES.MAX) {
          world.run.lives++;
          world.fx.lastLife = world.run.lives === 1;
          emit(world.bus, EV.LIFE_GAINED, 0, 0, 0, world.run.lives);
        }
        emit(world.bus, EV.EFFECT_ON, 0, 0, 0, kind, 0, world.run.lives);
        return;
      }
      case DROP.LASER: {
        st.laserShots = Math.max(st.laserShots, st.laserShotsPerDrop);
        ms[kind] = Infinity;
        emit(world.bus, EV.EFFECT_ON, 0, 0, 0, kind, 0, st.laserShots);
        return;
      }
      default: {
        const dur = kind === DROP.CATCH ? st.catchMs : DROP_MS[kind];
        ms[kind] = dur;
        emit(world.bus, EV.EFFECT_ON, 0, 0, 0, kind, dur, 1);
      }
    }
  }

  function onDropCaught(world, kind, x, y) {
    if (kind < 0 || kind >= DROP_COUNT) return;
    world.econ.dropsCaught++;
    if (kind === DROP.LIFE && world.run.lives >= LIVES.MAX) addScore(world, SCORE.LIFE_AT_MAX, x, y);
    addScore(world, isBad(kind) ? SCORE.DROP_BAD : SCORE.DROP_GOOD, x, y);
    applyDropEffect(world, kind);
  }

  function spawnDrop(world, x, y, kind) {
    const slot = world.api.spawnDrop(x, y, kind);
    if (slot >= 0) emit(world.bus, EV.DROP_SPAWNED, slot, x, y, kind);
    return slot;
  }

  /**
   * Was this break the work of an Overload? Purge's own bricks carry SRC.OVERLOAD; a blast from
   * an explosive brick a Purge broke (and the chain after it) counts as the Purge's too. B emits
   * EXPLOSION(id) right before the BRICK_BROKEN events of that blast, so the reader tracks it.
   */
  function byOverload(i, type, src) {
    const own = src === SRC.OVERLOAD || (src === SRC.EXPLOSION && st.blastByOverload);
    if (own && type === BRICK.EXPLOSIVE && i >= 0 && i < overloadBlast.length) overloadBlast[i] = 1;
    return own;
  }

  function onBrickBroken(world, i, x, y, type, src) {
    const e = world.econ;
    const rng = world.rng.economy;
    e.bricksBroken++;
    const hpMax = i >= 0 && i < world.bricks.hpMax.length ? world.bricks.hpMax[i] : 1;
    addScore(world, brickPoints(type, hpMax), x, y);
    // Embers: 2–4 per broken brick (Burst Mod: 1 in 10 bricks doubles them). None for an
    // Overload's own bricks: the HEAT it spent must not come straight back.
    if (!byOverload(i, type, src)) {
      let n = rng.int(EMBERS.MIN, EMBERS.MAX);
      if (st.burst && rng.chance(MOD_FX.BURST_CHANCE)) n *= 2;
      const made = world.api.spawnEmbers(x, y, n);
      if (made) emit(world.bus, EV.EMBERS_BURST, 0, x, y, made);
    }
    // Drops: carriers always release one (fixed kind or the table); other bricks by the rate.
    // None once the level is won (a boss's defeat shower, chain breaks after the last brick):
    // a drop that lands after the win can never be used.
    if (st.awarded || (world.level.total > 0 && world.level.remaining <= 0)) return;
    const B = world.bricks;
    const isCarrier = i >= 0 && i < B.drop.length && type === BRICK.CARRIER;
    if (isCarrier) {
      let kind = B.drop[i];
      if (kind < 0 || kind === DROP.MEGA) kind = rng.weighted(weights);
      if (kind >= 0) spawnDrop(world, x, y, kind);
    } else if (st.rate > 0 && rng.chance(st.rate)) {
      const kind = rng.weighted(weights);
      if (kind >= 0) spawnDrop(world, x, y, kind);
    }
  }

  function onOutOfBalls(world) {
    const ph = world.phase;
    if (ph === 'clearing' || ph === 'cleared' || ph === 'over' || st.cleared) return;
    const lvl = world.level;
    if (lvl.total > 0 && lvl.remaining <= 0) return; // the level is done; physics finishes it
    const e = world.econ;
    // Every timed effect ends with the last ball (shield and Mods stay).
    for (let k = 0; k < DROP_COUNT; k++) if (e.effectMs[k] > 0) effectOff(world, k);
    st.quenchMs = 0;
    st.slowStartMs = 0;
    st.pace = 0; // the music cools with the lost ball (HEAT is kept, so it does not fall all the way)
    if (lvl.rules.noFail) {
      world.api.serve();
      return;
    }
    const combo = halveCombo(e.combo, st.comboFloor);
    e.combo = combo;
    e.mult = multFor(combo);
    emit(world.bus, EV.COMBO_HALVED, 0, 0, 0, combo, e.mult);
    const run = world.run;
    if (run.freeMiss > 0) {
      run.freeMiss--;
      emit(world.bus, EV.FREE_MISS, 0, 0, 0, run.freeMiss);
      world.api.serve();
      return;
    }
    run.lives--;
    e.livesLost++;
    world.fx.lastLife = run.lives === 1;
    emit(world.bus, EV.LIFE_LOST, 0, 0, 0, run.lives);
    if (run.lives <= 0) {
      setPhase(world, 'over');
      emit(world.bus, EV.RUN_OVER, 0, 0, 0, run.score);
    } else world.api.serve();
  }

  /**
   * The clear bonus, once, as soon as the level is won: the last clearable brick (or boss weak
   * point, or the bonus timer) took level.remaining to 0. That is before physics runs the
   * ceremony and turns the phase to 'cleared', so the score is final when anyone reads it.
   */
  function awardClear(world) {
    if (st.awarded) return;
    st.awarded = true;
    const e = world.econ;
    e.flawless = e.livesLost === 0;
    e.clearBonus = clearBonus(world.level.n, e.flawless);
    addFlat(world, e.clearBonus, FIELD.W / 2, FIELD.H / 2);
    if (e.cavityFreed) {
      e.cavityBonus = e.levelScore * (SCORE.CAVITY_FACTOR - 1);
      addFlat(world, e.cavityBonus, FIELD.W / 2, FIELD.H / 2);
    }
    carry(world);
  }

  /** The Core's chained stages keep HEAT and combo. */
  function carry(world) {
    if (!world.level.def.continues) return;
    world.run.carryHeat = world.econ.heat;
    world.run.carryCombo = world.econ.combo;
  }

  /** Phase turned 'cleared' (after the ceremony): announce it once. */
  function onCleared(world) {
    if (st.cleared) return;
    st.cleared = true;
    awardClear(world);
    carry(world);
    const e = world.econ;
    emit(world.bus, EV.LEVEL_CLEARED, 0, 0, 0, world.level.n, e.levelScore, world.run.score);
  }

  /** The overload input: fire the equipped Overload, or before one is equipped buy a shield. */
  function onOverloadInput(world) {
    const e = world.econ;
    const run = world.run;
    if (world.phase !== 'play' && world.phase !== 'serve') return;
    if (run.overload) {
      // Ready at its cost; firing spends the whole meter and the kiln vents (no HEAT for
      // pw.ventMs of play: 12 s, shorter with The Forge), so the meter reads empty until the
      // next one can build.
      if (e.ventMs > 0 || e.heat < e.overloadCost) return;
      const spent = e.heat;
      e.heat = 0;
      const pw = overloadPower(run);
      if (run.overload === OVERLOAD.PURGE) world.api.purgeRows(pw.purgeRows);
      else if (run.overload === OVERLOAD.QUENCH) st.quenchMs = pw.quenchMs;
      else if (run.overload === OVERLOAD.FORK) world.api.splitBalls(pw.forkExtra);
      e.ventMs = pw.ventMs;
      st.pace = 0; // spending HEAT is heard: the music falls back with the meter
      emit(world.bus, EV.OVERLOAD_FIRED, 0, world.paddle.x, world.paddle.y, run.overload, spent);
    } else if (world.level.rules.heat && st.shield < SHIELD.MAX && e.shieldCost > 0 && e.heat >= e.shieldCost) {
      const cost = e.shieldCost;
      e.heat -= cost;
      st.shield++;
      st.shieldsBought++;
      e.shieldMs = SHIELD.HOLD_MS;
      if (st.shieldsBought >= SHIELD.PER_LEVEL) e.shieldCost = 0; // none left to buy this level
      st.pace = 0;
      emit(world.bus, EV.SHIELD_BOUGHT, 0, world.paddle.x, world.paddle.y, cost, st.shield);
    }
  }

  /**
   * Mega rescue: ≤5 clearable bricks for 20 s on a megaRescue level → one Mega drop. Never in a
   * boss fight: there `remaining` counts weak-point hits, not bricks, and a Mega ball would end
   * the fight instead of rescuing a last-brick hunt.
   */
  function megaRescue(world) {
    const lvl = world.level;
    const rem = lvl.remaining;
    if (!lvl.rules.megaRescue || lvl.kind === 'boss' || world.boss.active ||
      rem <= 0 || rem > MEGA_RESCUE.BRICKS || world.phase !== 'play') {
      if (rem > MEGA_RESCUE.BRICKS || rem <= 0) st.lowSinceMs = -1;
      return;
    }
    if (st.lowSinceMs < 0) {
      st.lowSinceMs = world.time;
      return;
    }
    if (world.time - st.lowSinceMs < MEGA_RESCUE.AFTER_MS) return;
    st.lowSinceMs = world.time; // re-arm: another 20 s before the next one
    if (world.econ.effectMs[DROP.MEGA] > 0) return;
    for (let d = 0; d < world.drops.length; d++) if (world.drops[d].alive && world.drops[d].kind === DROP.MEGA) return;
    // Release it from a remaining brick (the first live clearable one), or the top centre.
    const B = world.bricks;
    let x = FIELD.W / 2, y = 120;
    for (let i = 0; i < B.count; i++) {
      if (B.alive[i] && (B.flags[i] & BF.CLEARABLE) && !(B.flags[i] & BF.HIDDEN)) {
        x = B.x[i];
        y = B.y[i];
        break;
      }
    }
    spawnDrop(world, x, y, DROP.MEGA);
  }

  /** world.effects from the econ state, Mods and Forge (the only place effects are written). */
  function writeEffects(world) {
    const ms = world.econ.effectMs;
    const fx = world.effects;
    let w = st.baseW;
    if (ms[DROP.WIDE] > 0) w += DROP_FX.WIDE_ADD;
    else if (ms[DROP.SHRINK] > 0) w -= DROP_FX.SHRINK_SUB;
    fx.paddleW = w;
    let s = 1;
    if (ms[DROP.SLOW] > 0) s *= DROP_FX.SLOW_SCALE;
    if (ms[DROP.FAST] > 0) s *= DROP_FX.FAST_SCALE;
    if (st.quenchMs > 0) s *= QUENCH_SCALE;
    if (st.slowStartMs > 0) s *= MOD_FX.SLOW_START_SCALE;
    if (st.heavy) s *= FORGE_FX.HEAVY_SPEED;
    fx.ballSpeedScale = s;
    fx.catchOn = ms[DROP.CATCH] > 0;
    fx.laserShots = st.laserShots;
    fx.shield = st.shield;
    fx.fire = ms[DROP.FIRE] > 0;
    fx.thru = ms[DROP.THRU] > 0;
    fx.mega = ms[DROP.MEGA] > 0;
    const fog = ms[DROP.FOG];
    fx.fog = fog > 0 ? Math.min(1, fog / DROP_FX.FOG_FADE_MS) : 0;
  }

  function writeFx(world) {
    const e = world.econ;
    const lvl = world.level;
    world.fx.lastLife = world.run.lives === 1;
    world.fx.heatLevel = intensity(
      e.heat,
      world.run.overload && e.overloadCost > 0 ? e.overloadCost : e.heatMax,
      paceOf(st.pace),
      !!(lvl.rules.heat || lvl.rules.pull || lvl.rules.overloads),
      world.fx.lastLife,
      lvl.remaining > 0 && lvl.remaining <= LAST_BRICKS.AT && lvl.kind !== 'boss',
      !!world.boss.active,
    );
  }

  return {
    name: 'economy',

    init(world) {
      rd = createReader(world.bus, 'economy', 0);
      const run = world.run;
      const ranks = runRanks(run);
      const e = world.econ;
      const def = world.level.def;
      // Run-derived constants for this world.
      st.baseW = PADDLE.W + FORGE_FX.PADDLE_ADD[ranks.paddle];
      st.emberHeat = hasMod(run, MOD.BIG_EMBERS) ? MOD_FX.BIG_EMBER_HEAT : HEAT.PER_EMBER;
      st.pullScale = hasMod(run, MOD.CHEAP_PULL) ? MOD_FX.CHEAP_PULL : 1;
      st.rate = dropRate(def.drops, hasMod(run, MOD.DOUBLE_DROPS) ? MOD_FX.DOUBLE_DROP_RATE : 1);
      st.burst = hasMod(run, MOD.BURST);
      st.comboFloor = hasMod(run, MOD.COMBO_FLOOR) ? MOD_FX.COMBO_FLOOR : 0;
      st.catchMs = hasMod(run, MOD.LONG_CATCH) ? MOD_FX.LONG_CATCH_MS : DROP_MS[DROP.CATCH];
      st.laserShotsPerDrop = DROP_FX.LASER_SHOTS + (hasMod(run, MOD.MORE_LASERS) ? MOD_FX.MORE_LASER_SHOTS : 0);
      st.slowStart = hasMod(run, MOD.SLOW_START);
      st.heavy = run.ballKind === BALL_KIND.HEAVY;
      st.laserShots = 0;
      st.shield = hasMod(run, MOD.SHIELD) ? MOD_FX.SHIELD_AT_START : 0;
      st.shieldsBought = 0;
      e.shieldMs = 0;
      st.quenchMs = 0;
      st.slowStartMs = 0;
      st.lowSinceMs = -1;
      st.pace = 0;
      st.awarded = false;
      st.cleared = false;
      st.blastByOverload = false;
      overloadBlast.fill(0);
      tableWeights(def.drops, weights);
      // Level state.
      e.heatMax = FORGE_FX.HEAT_MAX[ranks.heat] ?? HEAT.MAX;
      e.heat = run.carryHeat >= 0 ? Math.min(e.heatMax, run.carryHeat) : 0;
      const combo = Math.max(st.comboFloor, run.carryCombo >= 0 ? run.carryCombo : 0);
      e.combo = combo;
      e.mult = multFor(combo);
      run.carryHeat = -1;
      run.carryCombo = -1;
      e.overloadCost = overloadCost(run);
      e.shieldCost = SHIELD.COST;
      e.ventMs = 0;
      e.livesLost = 0;
      e.cavityFreed = false;
      e.clearBonus = 0;
      e.cavityBonus = 0;
      e.flawless = false;
      e.effectMs.fill(0);
      // Fixed effects from the run.
      const fx = world.effects;
      fx.pierceFirst = hasMod(run, MOD.PIERCE) ? MOD_FX.PIERCE_FIRST : 0;
      fx.magnet = hasMod(run, MOD.MAGNET) ? MOD_FX.MAGNET_R : 0;
      fx.ballKind = run.ballKind | 0;
      fx.aimLine = run.ballKind === BALL_KIND.SNIPER;
      writeEffects(world);
      writeFx(world);

      world.api.addScore = (p, x = 0, y = 0) => addScore(world, p, x, y);
      world.api.addHeat = (n) => addHeat(world, n);
      world.api.applyDrop = (kind) => {
        if (kind >= 0 && kind < DROP_COUNT) applyDropEffect(world, kind);
      };
    },

    step(world, input) {
      const e = world.econ;
      st.pace *= PACE_DECAY;
      while (next(rd)) {
        switch (rd.type) {
          case EV.BRICK_BROKEN:
            onBrickBroken(world, rd.id, rd.x, rd.y, rd.a | 0, rd.b | 0);
            break;
          case EV.BRICK_SPAWNED:
            if (rd.id >= 0 && rd.id < overloadBlast.length) overloadBlast[rd.id] = 0; // a reused slot
            break;
          case EV.EXPLOSION: {
            // The breaks that follow belong to this blast: an Overload's if it broke this brick.
            const i = rd.id;
            st.blastByOverload = i >= 0 && i < overloadBlast.length && overloadBlast[i] === 1;
            if (st.blastByOverload) overloadBlast[i] = 0;
            break;
          }
          case EV.EMBER_CAUGHT:
            e.embersCaught++;
            world.run.embersBanked++;
            st.pace += 1;
            addHeat(world, heatPerEmber(st.emberHeat, world.level.remaining));
            setCombo(world, e.combo + EMBERS.COMBO_PER);
            addScore(world, SCORE.EMBER, rd.x, rd.y);
            break;
          case EV.DROP_CAUGHT:
            onDropCaught(world, rd.a | 0, rd.x, rd.y);
            break;
          case EV.PERFECT_HIT:
            // The Splitter ball's split happens in physics at the contact (A, perfect()).
            addScore(world, SCORE.PERFECT, rd.x, rd.y);
            break;
          case EV.LAUNCH:
            if (st.slowStart) st.slowStartMs = MOD_FX.SLOW_START_MS;
            break;
          case EV.LASER_FIRED:
            if (st.laserShots > 0) st.laserShots--;
            if (st.laserShots === 0 && e.effectMs[DROP.LASER] > 0) effectOff(world, DROP.LASER);
            break;
          case EV.SHIELD_USED:
            if (st.shield > 0) st.shield--;
            e.shieldMs = 0;
            break;
          case EV.OUT_OF_BALLS:
            onOutOfBalls(world);
            break;
          case EV.CAVITY_OPENED:
            e.cavityFreed = true;
            break;
          case EV.SENTRY_KILLED:
            addScore(world, SCORE.SENTRY, rd.x, rd.y);
            break;
          case EV.BOSS_HIT:
            addScore(world, SCORE.BOSS_HIT, rd.x, rd.y);
            break;
          case EV.BOSS_DEFEATED:
            addFlat(world, SCORE.BOSS_DEFEATED, rd.x, rd.y);
            break;
          case EV.PHASE:
            if (rd.a === PHASE_CODE.cleared) onCleared(world);
            break;
          default:
            break;
        }
      }

      const lvl = world.level;
      if (!st.awarded && lvl.total > 0 && lvl.remaining <= 0 && world.phase !== 'over') awardClear(world);

      const live = world.phase === 'play' || world.phase === 'serve' || world.phase === 'clearing';
      if (input && input.overload) onOverloadInput(world);

      if (live) {
        // Effect timers (sim ms). Infinity (Laser) never counts down.
        const ms = e.effectMs;
        for (let k = 0; k < DROP_COUNT; k++) {
          const v = ms[k];
          if (v > 0 && v !== Infinity) {
            const left = v - SIM.DT_MS;
            if (left <= 0) effectOff(world, k);
            else ms[k] = left;
          }
        }
        if (e.ventMs > 0 && world.phase === 'play') e.ventMs = Math.max(0, e.ventMs - SIM.DT_MS);
        // A bought shield holds HOLD_MS of play (not while a ball waits on the paddle).
        if (e.shieldMs > 0 && world.phase === 'play') {
          e.shieldMs -= SIM.DT_MS;
          if (e.shieldMs <= 0) {
            e.shieldMs = 0;
            if (st.shield > 0) st.shield--;
            emit(world.bus, EV.SHIELD_GONE, 0, world.paddle.x, world.paddle.y, st.shield);
          }
        }
        if (st.quenchMs > 0) st.quenchMs = Math.max(0, st.quenchMs - SIM.DT_MS);
        if (st.slowStartMs > 0) st.slowStartMs = Math.max(0, st.slowStartMs - SIM.DT_MS);
        megaRescue(world);
      }

      // Pull drains HEAT (40/s of 100; Cheap Pull Mod lowers it).
      if (world.paddle.pulling && e.heat > 0) {
        e.heat = Math.max(0, e.heat - PULL.HEAT_PER_S * st.pullScale * SIM.DT);
      }

      writeEffects(world);
      writeFx(world);
    },
  };
}
