// Item 20 rule: no boss contact is ever silent, and progress is always visible. Real play (the full
// sim with a human-like player and the imprecise robot) on every boss and Core stage; every contact
// on a boss brick is checked against what the renderer's actual event code draws and what the real
// core-damage overlay shows. Recording collaborators replace the draw calls; no WebGL claim.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { EV, PHASE_CODE } from '../src/core/events.js';
import { createReader, next } from '../src/core/bus.js';
import { BF, FIELD } from '../src/core/constants.js';
import { LOOK } from '../src/render/look.js';
import { getLevel, stagesOf } from '../src/levels/index.js';
import { createWorld } from '../src/core/world.js';
import { runHeadless } from '../src/core/headless.js';
import { makeSystems } from '../src/systems.js';
import { createRun } from '../src/economy/economy.js';
import { bossContactKind, coreProtected, blockDullsCore, CORE_HIT_FLASH_MS, CRACK_SEGS } from '../src/render/boss-feedback.js';
import { createHumanish } from './fixtures/B/human.mjs';
import { createSloppyRobot } from './fixtures/B/sloppy.mjs';

const threeURL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
const addonURL = new URL('../vendor/three/0.160.0/examples/jsm/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ${JSON.stringify(addonURL)} + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const THREE = await import(threeURL);
const { createCoreDamage, SMALL_CORE_PX } = await import('../src/render/core-damage.js');

// The renderer's own event code, unchanged, with recording collaborators.
const source = readFileSync(new URL('../src/render/renderer.js', import.meta.url), 'utf8');
const from = source.indexOf('  function drain() {'), to = source.indexOf('  function fireWall() {', from);
assert.ok(from > 0 && to > from, 'renderer drain() located');
const makeDrain = new Function('env', `with (env) {\n${source.slice(from, to)}\nreturn drain;\n}`);

function recorder(calls, label, returns = {}) {
  return new Proxy({}, { get: (_, k) => (k in returns ? returns[k] : (...args) => { calls.push({ label, k, args }); }) });
}

function playAndCheck(def, controller, seconds, totals) {
  const run = createRun({ seed: 3, levelN: def.n });
  const world = createWorld({ level: def, seed: 3000 + 31 * def.n + (def.stage | 0), run, systems: makeSystems() });
  const calls = [];
  const env = {
    world, reader: createReader(world.bus, 'drawn', 0), t: 0, breakBoost: 0, EV, PHASE_CODE, LOOK, next,
    HW: FIELD.W / 2, HH: FIELD.H / 2, bossContactKind, fireWall: () => calls.push({ label: 'fireWall' }),
    fx: recorder(calls, 'fx'), bricks: recorder(calls, 'bricks'), fire: recorder(calls, 'fire'),
    kiln: recorder(calls, 'kiln', { wallHit: () => true }), actors: recorder(calls, 'actors'), pieces: recorder(calls, 'pieces'),
    headroom: recorder(calls, 'headroom'), rig: recorder(calls, 'rig'),
  };
  const drain = makeDrain(env);
  const damage = createCoreDamage(new THREE.Group());
  damage.setWorld(world);
  const mine = createReader(world.bus, 'outcomes', 0);
  let beaten = false, drawnCracks = 0;
  const where = (msg) => `${def.id}: ${msg}`;
  runHeadless(world, controller, {
    maxSimMs: seconds * 1000,
    onStep(w) {
      calls.length = 0;
      env.t = w.time / 1000;
      drain();
      const ev = [];
      while (next(mine)) ev.push({ type: mine.type, id: mine.id, a: mine.a });
      let core = 0, outcomes = 0;
      for (const e of ev) {
        if (e.type === EV.BOSS_DEFEATED || e.type === EV.STAGE_CLEARED) beaten = true;
        if (e.type === EV.BRICK_HIT && (w.bricks.flags[e.id] & BF.BOSS)) {
          const kind = bossContactKind(w, e.id);
          totals[kind] = (totals[kind] || 0) + 1;
          if (kind === 'core') core++;
          else if (kind === 'armour') {
            assert.ok(calls.some((c) => c.label === 'fx' && c.k === 'armour'), where('an armour contact ticks'));
            // warm is the colour of damage: a permanent plate never warms (review Oct 27)
            assert.ok(!calls.some((c) => c.label === 'bricks' && c.k === 'hit' && c.args[0] === e.id), where('and never warms its plate'));
          } else if (beaten) {
            totals.beatenContacts = (totals.beatenContacts || 0) + 1; // the defeat break-up is the outcome
          } else {
            assert.equal(kind, 'shell', where('every boss brick is core, armour or shell'));
            assert.ok(ev.some((d) => (d.type === EV.BRICK_DAMAGED || d.type === EV.BRICK_BROKEN) && d.id === e.id),
              where(`a shell contact damages the shell (${JSON.stringify({ e, alive: w.bricks.alive[e.id], hp: w.bricks.hp[e.id], ev: ev.filter((d) => d.id === e.id) })})`));
            assert.ok(calls.some((c) => c.label === 'bricks' && (c.k === 'hit' || c.k === 'broken') && c.args[0] === e.id), where('and the damage is drawn'));
          }
        }
        if (e.type === EV.BOSS_HIT) {
          outcomes++;
          totals.counted = (totals.counted || 0) + 1;
          assert.ok(calls.some((c) => c.label === 'fx' && c.k === 'burst'), where('a counted hit bursts'));
          assert.ok(calls.some((c) => c.label === 'bricks' && c.k === 'hit' && c.args[0] === e.id), where('and flashes the core'));
        }
        if (e.type === EV.BOSS_BLOCKED) {
          outcomes++;
          totals[e.a ? 'guard' : 'cooldown'] = (totals[e.a ? 'guard' : 'cooldown'] || 0) + 1;
          assert.ok(calls.some((c) => c.label === 'fx' && c.k === 'blocked'), where('a blocked contact puffs'));
          assert.ok(calls.some((c) => c.label === 'bricks' && c.k === 'coreBlocked' && c.args[1] === !!e.a), where('and dulls the core, told why'));
          if (blockDullsCore(w, !!e.a)) totals.dulled = (totals.dulled || 0) + 1;
          else totals.sameHit = (totals.sameHit || 0) + 1;
          if (e.a) {
            // the reason is visible: the core is cooled (after its last counted hit's flash)
            assert.equal(w.boss.data.guard, 1, where('guard-blocked means the core is cooled'));
            assert.ok(coreProtected(w) || w.time - w.boss.data.lastCoreMs < CORE_HIT_FLASH_MS, where('a cooled core looks cold'));
          }
        }
      }
      // every core contact resolved to exactly one outcome, except contacts on a beaten core,
      // whose break-up (BOSS_DEFEATED / STAGE_CLEARED cascade) is the outcome
      if (!beaten) assert.equal(outcomes, core, where(`${core} core contacts, ${outcomes} outcomes at ${w.time.toFixed(0)} ms`));
      else totals.beatenContacts = (totals.beatenContacts || 0) + core - outcomes;
      // lasting damage: the drawn cracks grow by one crack per counted hit and never shrink
      damage.frame(w, 1, env.t, coreProtected(w));
      const drawn = damage.group.getObjectByName('boss-core-cracks').count;
      if (w.boss.active && w.boss.hp > 0) {
        assert.equal(drawn, (w.boss.hpMax - w.boss.hp) * CRACK_SEGS, where(`one drawn crack per counted hit (hp ${w.boss.hp}/${w.boss.hpMax}, shown ${damage.shown}, t ${w.time.toFixed(0)})`));
        assert.ok(drawn >= drawnCracks, where('cracks never heal'));
        drawnCracks = drawn;
      }
    },
  });
}

test('every boss contact has a player-visible outcome, and every counted hit leaves a lasting crack (real play, every boss and stage)', () => {
  const fights = [getLevel(10), getLevel(20), ...stagesOf(getLevel(30))];
  const all = {};
  for (const def of fights) {
    const totals = {};
    playAndCheck(def, createHumanish(11 + def.n, { lagMs: 160, errUnits: 18 }), 70, totals);
    playAndCheck(def, createSloppyRobot(5 + def.n, { errUnits: 12 }), 40, totals);
    assert.ok(totals.counted > 0, `${def.id}: real play scored core hits (${JSON.stringify(totals)})`);
    assert.ok(totals.armour > 0, `${def.id}: real play met permanent armour`);
    if (def.boss === 'stoker') assert.ok(totals.shell > 0, 'The Stoker: real play damaged its jaw shell');
    for (const [k, v] of Object.entries(totals)) all[k] = (all[k] || 0) + v;
  }
  assert.ok(all.guard > 0 && all.cooldown > 0, `both blocked reasons occurred in real play (${JSON.stringify(all)})`);
  assert.ok(all.dulled > 0 && all.sameHit > 0, `blocked contacts both dulled the core and, as a counted hit's rattle, did not (${JSON.stringify(all)})`);
}, { timeout: 120000 });

test('a blocked contact dulls the core unless it is a counted hit\'s rattle; the cracks go ash, no box', () => {
  const world = { time: 10000, boss: { active: true, hp: 3, hpMax: 6, data: { lastCoreMs: 9900, guard: 0 } } };
  assert.equal(blockDullsCore(world, false), false, 'a cooldown block 100 ms after a counted hit is that hit');
  assert.equal(blockDullsCore(world, true), true, 'a cooled core always dulls');
  world.time = 10300;
  assert.equal(blockDullsCore(world, false), true, '300 ms after: its own contact');
  // the real overlay: the cracks turn ash grey for a moment, then return to their ember
  const def = stagesOf(getLevel(30))[0];
  const w = createWorld({ level: def, seed: 5, run: createRun({ seed: 5, levelN: 30 }), systems: makeSystems() });
  w.boss.hp = w.boss.hpMax - 2;
  const damage = createCoreDamage(new THREE.Group());
  damage.setWorld(w);
  const heat = () => damage.group.getObjectByName('boss-core-cracks');
  const colour = () => { const c = new THREE.Color(); heat().getColorAt(0, c); return c; };
  damage.frame(w, 1, 5, false);
  const ember = colour();
  damage.blocked(5.5);
  damage.frame(w, 1, 5.5, false);
  const ash = colour();
  assert.ok(Math.abs(ash.r - ash.b) < Math.abs(ember.r - ember.b) * 0.5, `ash is grey (${ash.getHexString()} vs ember ${ember.getHexString()})`);
  assert.ok(ash.r < ember.r, 'and duller than the ember');
  damage.frame(w, 1, 5.8, false);
  assert.equal(colour().getHexString(), ember.getHexString(), 'then the ember again');
  assert.equal(damage.group.children.filter((m) => m.isMesh && !m.isInstancedMesh).length, 0, 'no flat box laid over the core');
});

test('a core small on screen keeps its cracks at least 1.5 CSS px wide on any screen', () => {
  const def = stagesOf(getLevel(30))[2];
  const w = createWorld({ level: def, seed: 5, run: createRun({ seed: 5, levelN: 30 }), systems: makeSystems() });
  w.boss.hp = w.boss.hpMax - 3;
  /** Width in field units of the first drawn crack's heat line at `scale` CSS px per field unit. */
  const width = (scale) => {
    const damage = createCoreDamage(new THREE.Group());
    damage.setWorld(w);
    damage.setReadability({ small: false, scale });
    damage.frame(w, 1, 9, false);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    damage.group.getObjectByName('boss-core-cracks').getMatrixAt(0, m);
    m.decompose(p, q, s);
    return s.y;
  };
  const B = w.bricks;
  let core = 0;
  for (let i = 0; i < B.count; i++) if (B.alive[i] && (B.flags[i] & BF.WEAK) && (B.flags[i] & BF.BOSS)) core = B.w[i];
  const desk = 0.45; // CSS px per field unit: a desktop window where the ring field is about 490 px tall
  assert.ok(core > 0 && core * desk < SMALL_CORE_PX, `the stage 3 core is small on screen (${(core * desk).toFixed(0)} px)`);
  assert.ok(width(desk) * desk >= 1.5 - 1e-6, `crack ${(width(desk) * desk).toFixed(2)} CSS px wide`);
  assert.ok(Math.abs(width(3) - 1.7) < 1e-6, `a large core keeps its field-unit width (${width(3).toFixed(2)})`);
});
