// Boss facts exercise real content/economy state: progress is core damage, not armoured plates.
import { test, assert } from './lib.mjs';
import { installTreeDom } from './fixtures/D/dom.mjs';
import { contentWorld } from './fixtures/B/helpers.mjs';
import { createHud } from '../src/ui/hud.js';
import { getLevel, stagesOf } from '../src/levels/index.js';
import { BRICK, DROP, HAZARD, SRC } from '../src/core/constants.js';
import { createWorld, stepWorld } from '../src/core/world.js';
import { createInputFrame } from '../src/core/input-frame.js';
import { createReader, next } from '../src/core/bus.js';
import { EV } from '../src/core/events.js';
import { makeSystems } from '../src/systems.js';

function build(w) {
  const dom = installTreeDom();
  const hud = createHud(dom.root);
  const key = (name) => hud.el.querySelectorAll('[data-k]').find((n) => n.dataset.k === name);
  hud.update(w, 0);
  return { dom, hud, key };
}

test('boss HUD: persistent jaw route, permanent core progress, one repair, and guard all follow live state', () => {
  const t = contentWorld(getLevel(10));
  const w = t.world;
  const { dom, hud, key } = build(w);
  try {
    const B = w.bricks;
    const jaw = [];
    let core = -1;
    for (let i = 0; i < B.count; i++) {
      if (B.type[i] === BRICK.ARMOURED) jaw.push(i);
      if (B.alive[i] && B.type[i] === BRICK.WEAK) core = i;
    }
    assert.equal(key('levelLabel').textContent, 'Stoker');
    assert.equal(key('name').textContent, '5 core hits left');
    hud.update(w, 60000);
    assert.equal(key('bossFact').textContent, 'Break jaw → core', 'the objective survives the serving card timeout');
    t.hit(jaw[0], SRC.LASER);
    hud.update(w, 60001);
    assert.equal(key('bossFact').textContent, 'Break jaw → core', 'an outer plate opening is not a route below the core');
    t.hit(jaw[2], SRC.LASER);
    hud.update(w, 60002);
    assert.equal(key('bossFact').textContent, 'Jaw open → core');
    t.hit(core);
    hud.update(w, 60003);
    assert.equal(key('name').textContent, '4 core hits left');
    assert.equal(key('boss').getAttribute('aria-valuenow'), '4');
    assert.match(key('boss').getAttribute('aria-label'), /The Stoker/);
    assert.equal(key('bossFact').textContent, 'Break jaw → core', 'the one repair closes the route without restoring core health');
    t.hit(jaw[2], SRC.LASER);
    w.boss.data.guard = 1;
    hud.update(w, 60004);
    hud.update(w, 62503);
    assert.equal(key('bossFact').textContent, 'Core cooling briefly', 'guard fact remains for the entire real guard state');
    w.boss.data.guard = 0;
    hud.update(w, 62504);
    assert.equal(key('bossFact').textContent, 'Jaw open → core');
    assert.equal(key('name').textContent, '4 core hits left');
    w.boss.active = false;
    hud.update(w, 63000);
    assert.equal(key('bossFact').hidden, false);
    assert.match(key('bossFact').textContent, /HEAT →/);
    assert.equal(key('levelLabel').textContent, 'Level');
    assert.equal(key('name').textContent, 'The Stoker');
  } finally { dom.restore(); }
});

test('boss HUD: rotating armour is a gap objective, and each Core health bar identifies its stage', () => {
  const { dom, hud, key } = build(contentWorld(getLevel(20)).world);
  try {
    assert.equal(key('levelLabel').textContent, 'Crucible');
    assert.equal(key('name').textContent, '20 core hits left');
    assert.equal(key('bossFact').textContent, 'Gap → core');
    for (let stage = 1; stage <= 3; stage++) {
      const w = contentWorld(stagesOf(getLevel(30))[stage - 1]).world;
      // No reset: a new stage must replace its progress even when a caller reuses the HUD.
      hud.update(w, stage * 1000);
      assert.equal(key('levelLabel').textContent, `Core ${stage}/3`);
      assert.equal(key('name').textContent, `${w.boss.hp} core hits left`);
      assert.match(key('boss').getAttribute('aria-label'), new RegExp(`stage ${stage} of 3`));
      assert.equal(key('boss').getAttribute('aria-valuemax'), String(w.boss.hpMax));
      assert.equal(key('bossFact').textContent, `${stage === 3 ? 'Aligned gaps' : 'Gap'} → core`);
      w.boss.hp = 0;
      hud.update(w, stage * 1000 + 1);
      assert.equal(key('bossFact').textContent, stage === 3 ? 'Core broken' : 'Stage complete');
    }
  } finally { dom.restore(); }
});

test('boss HUD: a physically caught Laser names its real firing action/count and disappears when spent', () => {
  const w = createWorld({ level: getLevel(10), seed: 1, systems: makeSystems() });
  const { dom, hud, key } = build(w);
  try {
    const f = createInputFrame();
    w.api.spawnDrop(w.paddle.x, w.paddle.y - 1, DROP.LASER);
    stepWorld(w, f);
    hud.update(w, 10);
    const laser = key('fxRow').children[DROP.LASER];
    assert.equal(laser.hidden, false);
    assert.equal(key('laserLabel').textContent, 'Laser · launch first');
    assert.equal(laser.querySelector('b').textContent, String(w.effects.laserShots));
    let shots = w.effects.laserShots;
    f.action = true;
    stepWorld(w, f);
    hud.update(w, w.time);
    assert.equal(w.effects.laserShots, shots, 'the first action launches the held ball instead of firing');
    assert.equal(key('laserLabel').textContent, 'Space / click: Laser');
    while (shots > 0) {
      // Remove already-tested flying bolts so the fixed pool can accept every subsequent volley.
      for (const bolt of w.lasers) bolt.alive = false;
      f.action = true;
      stepWorld(w, f);
      hud.update(w, w.time);
      assert.ok(w.effects.laserShots < shots, 'an action fires a real volley');
      shots = w.effects.laserShots;
    }
    assert.equal(laser.hidden, true, 'no firing promise after the last shot');
    assert.equal(key('bossFact').hidden, false, 'spending a power never removes the boss objective');
  } finally { dom.restore(); }
});

test('boss HUD: real slag contacts report clamped HEAT loss and survive same-frame scoring', () => {
  const w = createWorld({ level: getLevel(10), seed: 1, systems: makeSystems() });
  const { dom, hud, key } = build(w);
  try {
    const f = createInputFrame();
    const rd = createReader(w.bus, 'hud-hazard', w.bus.head);
    for (const [start, lost] of [[80, 25], [10, 10], [0, 0]]) {
      w.econ.heat = start;
      w.api.spawnHazard(w.paddle.x, w.paddle.y - 1, 0, 100, HAZARD.SLAG, 14);
      stepWorld(w, f);
      let seen = false;
      while (next(rd)) {
        if (rd.type !== EV.HAZARD_HEAT_LOST) continue;
        seen = true;
        assert.equal(rd.a, HAZARD.SLAG);
        assert.equal(rd.b, lost);
        hud.hazardHit(rd.a, rd.b, w.time);
      }
      assert.ok(seen, 'the physical collision emits actual HEAT removed');
      w.run.score += 20;
      hud.update(w, w.time);
      assert.equal(key('delta').textContent, lost ? `Slag −${lost} HEAT` : 'Slag · HEAT empty');
      assert.equal(w.econ.heat, start - lost);
    }
  } finally { dom.restore(); }
});
