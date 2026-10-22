// Kiln: The Stoker (level 10), OWNER: B.
//
// A furnace head of titanium plates ('B' cells) with a white-hot core ('W') inside its mouth and a
// chin row of armoured jaw plates ('A' cells). Break jaw plates to open the mouth, then hit the core.
//   phase 1 (core 5 → 4): the head is still; a slag blob every 3.5 s, aimed at the paddle.
//   phase 2 (core 4 → 0): the jaw slams shut (plates regrow once no ball is inside the head) and
//                         shuts again behind every ball that scores, never on a timer (an open
//                         jaw stays open until a ball uses it); the head sways side to side and
//                         spits a blob every 3 s, two at once for the last hit.
// The core is one fused brick and counts at most two hits per entry (common.js hitCore).
// Slag is a hazard; a paddle hit knocks HEAT out of the meter (content.js).

import { SIM, BF, BRICK, HAZARD } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { emit } from '../../core/bus.js';
import { resetBoss, hitCore, startCascade, stepCascade, indicesWhere, centreOf, aimAtPaddle, endEntry, fuseCells } from './common.js';

export const STOKER = Object.freeze({
  HP: 5,
  PHASE2_AT: 4,             // core hits left when phase 2 starts
  SLAG_MS: [3500, 3000],    // per phase
  TWIN_AT: 1,               // core hits left from which every spit is two blobs
  SLAG_SPEED: 200,
  SLAG_R: 14,
  SLAG_SPREAD: 0.18,        // radians between the two blobs of a twin spit
  SWAY: 60,                 // units each side
  SWAY_OMEGA: 0.9,          // rad/s
  DIE_MS: 500,
});

/** bricks.group values (F names mesh nodes `part-<name>`; C attaches them). */
export const STOKER_PARTS = Object.freeze({ HEAD: 0, JAW: 1, CORE: 2 });

export function createStoker() {
  let ctx;
  let all = new Int16Array(0);
  let baseX = new Float32Array(0);
  let jaw = new Int16Array(0);
  let core = new Int16Array(0);
  let cx = 360, cy = 200, mouthX = 360, chinY = 300;
  let boxTop = 0, boxBottom = 0, boxHalfW = 0;
  let regrow = false;
  let swaying = false;
  const v = { x: 0, y: 0 };

  function openFraction(world) {
    let broken = 0;
    for (let k = 0; k < jaw.length; k++) if (!world.bricks.alive[jaw[k]]) broken++;
    return jaw.length ? broken / jaw.length : 1;
  }

  function tryRegrow(world) {
    const B = world.bricks;
    regrow = false;
    // never shut the jaw on a ball: wait until no ball is inside the head
    const off = world.boss.x - cx;
    if (ctx.ballNear(cx + off, (boxTop + boxBottom) / 2, boxHalfW, (boxBottom - boxTop) / 2)) {
      regrow = true;
      return;
    }
    for (let k = 0; k < jaw.length; k++) {
      const i = jaw[k];
      if (B.alive[i]) continue;
      if (ctx.ballNear(B.x[i], B.y[i], B.w[i] / 2, B.h[i] / 2)) { regrow = true; continue; }
      ctx.spawnBrick(i, 'A', B.x[i], B.y[i], B.w[i], B.h[i], B.col[i], B.row[i]);
      B.flags[i] |= BF.BOSS | (swaying ? BF.MOVING : 0);
      B.group[i] = STOKER_PARTS.JAW;
    }
  }

  function spit(world) {
    const boss = world.boss;
    const x = mouthX + (boss.x - cx);
    const y = chinY + STOKER.SLAG_R + 4;
    const n = boss.hp <= STOKER.TWIN_AT ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const spread = n === 1 ? 0 : (k === 0 ? -STOKER.SLAG_SPREAD : STOKER.SLAG_SPREAD);
      aimAtPaddle(world, x, y, STOKER.SLAG_SPEED, spread, v);
      if (v.y < 40) v.y = 40; // always falls toward the paddle side
      world.api.spawnHazard(x, y, v.x, v.y, HAZARD.SLAG, STOKER.SLAG_R);
    }
    emit(world.bus, EV.BOSS_ATTACK, 0, x, y, HAZARD.SLAG);
  }

  return {
    id: 'stoker',

    init(world, c) {
      ctx = c;
      const B = world.bricks;
      const head = indicesWhere(world, (i) => B.type[i] === BRICK.BOSS);
      const jawList = indicesWhere(world, (i) => B.type[i] === BRICK.ARMOURED);
      const coreList = fuseCells(world, indicesWhere(world, (i) => B.type[i] === BRICK.WEAK));
      for (const i of head) B.group[i] = STOKER_PARTS.HEAD;
      for (const i of jawList) {
        B.group[i] = STOKER_PARTS.JAW;
        B.flags[i] |= BF.BOSS;
      }
      for (const i of coreList) B.group[i] = STOKER_PARTS.CORE;
      jaw = Int16Array.from(jawList);
      core = Int16Array.from(coreList);
      all = Int16Array.from([...head, ...jawList, ...coreList]);
      baseX = Float32Array.from(all, (i) => B.x[i]);
      const hc = centreOf(world, head);
      cx = hc.x;
      cy = hc.y;
      mouthX = centreOf(world, coreList).x;
      chinY = jawList.length ? Math.max(...jawList.map((i) => B.y[i] + B.h[i] / 2)) : cy + 60;
      boxTop = Math.min(...[...all].map((i) => B.y[i] - B.h[i] / 2));
      boxBottom = chinY;
      boxHalfW = Math.max(...[...all].map((i) => Math.abs(B.x[i] - cx) + B.w[i] / 2));
      regrow = false;
      swaying = false;
      resetBoss(world, 'stoker', STOKER.HP, cx, cy);
      ctx.setRemaining(STOKER.HP);
    },

    move(world) {
      const boss = world.boss;
      const d = boss.data;
      boss.px = boss.x;
      boss.py = boss.y;
      boss.pangle = boss.angle;
      if (d.dying || !boss.active) {
        stepCascade(world, ctx);
        return;
      }
      boss.t += SIM.DT_MS;
      if (regrow) tryRegrow(world);
      if (swaying) {
        const B = world.bricks;
        const off = STOKER.SWAY * Math.sin((STOKER.SWAY_OMEGA * (world.time - d.phaseAt)) / 1000);
        for (let k = 0; k < all.length; k++) {
          const i = all[k];
          if (B.alive[i]) {
            B.px[i] = B.x[i];
            B.py[i] = B.y[i];
          }
          B.x[i] = baseX[k] + off;
        }
        boss.x = cx + off;
      }
      boss.open = openFraction(world);
      // an entry lasts until no ball is inside the head (the core takes two hits per entry)
      endEntry(world, ctx.ballNear(boss.x, (boxTop + boxBottom) / 2, boxHalfW, (boxBottom - boxTop) / 2));
      if (world.phase === 'play') {
        d.attackAcc += SIM.DT_MS;
        if (d.attackAcc >= STOKER.SLAG_MS[boss.phase - 1]) {
          d.attackAcc = 0;
          spit(world);
        }
      }
    },

    onHit(world, i, src, ball, pierced) {
      const B = world.bricks;
      const boss = world.boss;
      if (!boss.active || boss.data.dying) return;
      const g = B.group[i];
      if (g === STOKER_PARTS.JAW) {
        ctx.dealDamage(i, ctx.hitDamage(i, src, pierced), src, ball);
        return;
      }
      if (g !== STOKER_PARTS.CORE) return; // the head plates just deflect
      if (!hitCore(world, ctx, i)) return;
      if (boss.hp === 0) {
        startCascade(world, ctx, STOKER.DIE_MS, true, 1);
        return;
      }
      if (boss.phase === 1 && boss.hp <= STOKER.PHASE2_AT) {
        boss.phase = 2;
        boss.state = 1;
        boss.data.phaseAt = world.time;
        boss.data.attackAcc = 0;
        emit(world.bus, EV.BOSS_PHASE, 0, boss.x, boss.y, 2);
        swaying = true;
        for (let k = 0; k < all.length; k++) B.flags[all[k]] |= BF.MOVING;
        B.version++;
        tryRegrow(world);
      } else if (boss.phase === 2) {
        regrow = true; // phase 2: the jaw shuts again behind every ball that scores (once it is out)
      }
    },
  };
}
