import { register } from 'node:module';
import { test, assert } from './lib.mjs';
import { BRICK, BF, SRC, DROP } from '../src/core/constants.js';
import { LOOK } from '../src/render/look.js';
import { createWorld, stepWorld, setPhase } from '../src/core/world.js';
import { createContent } from '../src/content/content.js';
import { createEconomy, createRun } from '../src/economy/economy.js';
import { createInputFrame } from '../src/core/input-frame.js';
import { emit } from '../src/core/bus.js';
import { EV } from '../src/core/events.js';
import { contentWorld, level } from './fixtures/B/helpers.mjs';
const STUB_URL = new URL('./fixtures/C/marks-three-stub.mjs', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three' || spec === 'three/addons/geometries/RoundedBoxGeometry.js') return { url: ${JSON.stringify(STUB_URL)}, shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const THREE = await import(STUB_URL);
THREE.installCanvas();
const { createMarks } = await import('../src/render/marks.js');
const { createBricks } = await import('../src/render/bricks.js');

function setup(symbol = '4', info = { small: true, scale: 0.35 }) {
  const t = contentWorld(level([`${symbol}...........`]));
  const root = new THREE.Group(), white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const marks = createMarks(root, { tex: { glow: {} }, white, white70: white, white50: white, darkMetal: white });
  const w = t.world, B = w.bricks;
  const i = [...Array(B.count).keys()].find(i => B.type[i] === BRICK.NUMBERED || B.type[i] === BRICK.ARMOURED || B.type[i] === BRICK.CAVITY);
  marks.setReadability(info); marks.setWorld(w, w.level.mode);
  const rebuild = () => marks.rebuild(w, w.level.mode, null, null, 1);
  const frame = time => marks.frame(w, 1, time);
  rebuild(); frame(0);
  return { ...t, marks, root, i, B, rebuild, frame, lines: root.getObjectByName('brick-hit-lines') };
}
const visible = lines => lines.colors.slice(0, lines.count).filter(c => c[0] > 0.1).length;
const snapshot = B => ['count', 'version', 'hp', 'hpMax', 'type', 'flags', 'alive', 'x', 'y', 'w', 'h'].map(key => [key, typeof B[key] === 'number' ? B[key] : [...B[key]]]);

test('glass, armour and cavity shells count live HP downward with no printed HP glyphs', () => {
  for (const symbol of ['2', '3', '4', 'A', 'C']) for (const small of [false, true]) {
    const r = setup(symbol, { small, scale: 0.35 }), max = r.B.hp[r.i];
    assert.equal(r.lines.count, max);
    assert.equal(visible(r.lines), max);
    assert.equal(r.root.getObjectByName('brick-hit-fallbacks').count, 0, 'no HP enters the letter mesh');
    const matrices = structuredClone(r.lines.matrices);
    for (let hp = max - 1; hp > 0; hp--) {
      r.hit(r.i); r.marks.hit(r.i, max - hp); r.frame(max - hp + LOOK.HIT_FLASH_S + 0.001);
      assert.equal(r.B.hp[r.i], hp);
      assert.equal(visible(r.lines), hp);
      assert.deepEqual(r.lines.matrices, matrices, 'channels do not recenter or migrate after damage');
    }
  }
});

test('removed hit lines flash once then become dark, including multiple HP removed in one real hit', () => {
  for (const heavy of [false, true]) {
    const r = setup('4');
    if (heavy) r.world.effects.ballKind = 1;
    r.hit(r.i); r.marks.hit(r.i, 1); r.frame(1);
    const remaining = heavy ? 2 : 3;
    assert.equal(r.B.hp[r.i], remaining);
    assert.equal(visible(r.lines), 4, 'just-lost channels briefly flash');
    r.rebuild(); r.frame(1.02);
    assert.equal(visible(r.lines), 4, 'structural rebuild preserves a current removal flash');
    r.frame(1 + LOOK.HIT_FLASH_S + 0.001);
    assert.equal(visible(r.lines), remaining);
    const settled = structuredClone(r.lines.colors);
    r.frame(4);
    assert.deepEqual(r.lines.colors, settled, 'flash clears and cannot leave a permanently hot extra line');
  }
});

test('line state follows HP without version changes, restores a reformed brick and never mutates simulation', () => {
  const r = setup('3'), version = r.B.version;
  r.B.hp[r.i] = 1;
  const before = snapshot(r.B);
  r.frame(1);
  assert.equal(r.B.version, version);
  assert.equal(visible(r.lines), 1);
  assert.deepEqual(snapshot(r.B), before, 'drawing cannot alter health, flags, geometry or version');
  r.B.hp[r.i] = 3; r.rebuild(); r.frame(2);
  assert.equal(visible(r.lines), 3, 'reforming the original channels restores their starting heat');
  r.marks.setWorld(r.world, r.world.level.mode); r.rebuild(); r.frame(0);
  assert.equal(visible(r.lines), 3, 'world reset cannot replay a stale hit flash');
});

test('laser and fire extinguish every armour line and hidden or broken cells draw none', () => {
  for (const source of [SRC.LASER, SRC.FIRE]) {
    const r = setup('A');
    r.hit(r.i, source); r.marks.hit(r.i, 1); r.rebuild(); r.frame(1.2);
    assert.equal(r.B.hp[r.i], 0);
    assert.equal(r.lines.count, 0, 'destroyed titanium has no live count');
  }
  const r = setup('4'); r.B.flags[r.i] |= BF.HIDDEN; r.rebuild(); r.frame(1);
  assert.equal(r.lines.count, 0);
});


test('HP5-9 fallback glyphs stay contained, update without wall versions and return to four lines', () => {
  for (let hp = 5; hp <= 9; hp++) {
    const r = setup(String(hp), { small: true, scale: 0.2901833621 });
    // A dense ring face has a 30x30 field-space cell, regardless of the synthetic level's mode.
    r.B.w[r.i] = 30; r.B.h[r.i] = 30; r.rebuild(); r.frame(1);
    const labels = r.root.getObjectByName('brick-hit-fallbacks');
    assert.equal(r.lines.count, 0);
    assert.equal(labels.count, 1);
    const cells = labels.geometry.attributes.aCell.array;
    assert.equal(cells[0], hp);
    const [,,,, sx, sy] = labels.matrices[0];
    assert.ok(sx * 20 <= 26 && sy * 18 <= 26, 'fallback ink stays within its own dense face');
    const version = r.B.version;
    r.B.hp[r.i] = 5; r.frame(2);
    assert.equal(cells[0], 5);
    assert.equal(r.B.version, version);
    r.B.hp[r.i] = 4; r.rebuild(); r.frame(3);
    assert.equal(labels.count, 0, 'four remaining hits always return to lines at the required phone size');
    assert.equal(r.lines.count, 4);
    assert.equal(visible(r.lines), 4);
  }
});

test('hit channels share the existing heat palette, stay below bloom and retain core gaps', () => {
  const r = setup('4');
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
  r.lines.material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('vLineUv = uv'));
  assert.ok(shader.fragmentShader.includes('mix(uLineHeatLo, uLineHeatHi'));
  assert.ok(shader.uniforms.uLineHeatLo.value instanceof Float32Array);
  assert.ok(r.lines.colors.slice(0, r.lines.count).every(c => Math.max(...c) < LOOK.BLOOM_THRESHOLD));
  const recesses = r.root.getObjectByName('brick-mark-backs');
  assert.equal(recesses.count, 4, 'one recess per line exposes the original core between them');
  const marks = recesses.matrices.slice(0, 4);
  for (let i = 1; i < marks.length; i++) assert.ok(marks[i][0] - marks[i - 1][0] > marks[i][4], 'adjacent recesses do not join into a plaque');
});


test('wall renderer automatically replaces dense HP5 fallback with four hit lines without a version bump', () => {
  const t = contentWorld(level(['5...........'])), w = t.world, B = w.bricks;
  B.w[0] = 30; B.h[0] = 30;
  const scene = new THREE.Group(), white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const materials = { tex: { glow: {} }, shell: white, cavityGlass: white, titanium: white, matte: white,
    core: white, white, white70: white, white50: white, darkMetal: white };
  const bricks = createBricks(scene, materials);
  bricks.setReadability({ small: true, scale: 0.2901833621 }); bricks.setWorld(w); bricks.frame(1, 0, () => {});
  assert.equal(scene.getObjectByName('brick-hit-fallbacks').count, 1);
  const version = B.version;
  B.hp[0] = 4; bricks.hit(0, 1); bricks.frame(1, 1, () => {});
  assert.equal(B.version, version);
  assert.equal(scene.getObjectByName('brick-hit-fallbacks').count, 0);
  assert.equal(visible(scene.getObjectByName('brick-hit-lines')), 4);
  B.type[0] = BRICK.CAVITY; B.hpMax[0] = 2; B.hp[0] = 2;
  const warm = bricks.heatAt(0, 2); B.hp[0] = 1;
  assert.ok(bricks.heatAt(0, 2) < warm, 'the two-hit cavity core dims one step along with its lines');
});


test('mixed phone walls share one opaque backing pool with distinct slots for lines and every symbol', () => {
  const t = contentWorld(level(['4?E()Xa.....'])), w = t.world;
  const weak = [...Array(w.bricks.count).keys()].find(i => w.bricks.col[i] === 6);
  w.bricks.type[weak] = BRICK.WEAK; w.bricks.flags[weak] |= BF.BOSS | BF.WEAK;
  const root = new THREE.Group(), white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const marks = createMarks(root, { tex: { glow: {} }, white, white70: white, white50: white, darkMetal: white });
  marks.setReadability({ small: true, scale: 0.35 }); marks.setWorld(w, w.level.mode);
  marks.rebuild(w, w.level.mode, null, null, 1); marks.frame(w, 1, 0);
  const backs = root.getObjectByName('brick-mark-backs');
  assert.equal(backs.count, 17, 'four hit channels, carrier, explosion, two portals, lock and eight target segments');
  assert.equal(new Set(backs.matrices.slice(0, backs.count).map(m => JSON.stringify(m))).size, 17, 'one counter allocates distinct backing slots');
  assert.equal(backs.material.fog, false);
  assert.equal(backs.renderOrder, 6);
  assert.deepEqual(backs.geometry.args, [1, 1]);
  assert.equal(root.getObjectByName('brick-phone-backs'), undefined);
  assert.equal(root.getObjectByName('brick-hit-recesses'), undefined);
  assert.equal(root.getObjectByName('brick-hit-lines').count, 4);
  assert.equal(root.getObjectByName('brick-phone-symbols').count, 3);
  assert.equal(root.getObjectByName('brick-hit-fallbacks').count, 2, 'portal letters keep their distinct atlas cells');
});


test('loaded glass and armour retain the marked good drop while renderer lines follow real hits and breakage', () => {
  for (const material of ['2', '3', '4', 'A']) for (const dense of [false, true]) {
    if (dense && material !== '2') continue;
    const w = createWorld({ level: level(['?..........a'], { loaded: { '0,0': material }, carriers: { '0,0': 'laser' }, drops: { rate: 0, table: { fog: 1 } } }), run: createRun(), seed: 1,
      systems: { content: createContent(), economy: createEconomy() } });
    setPhase(w, 'play');
    const B = w.bricks, startHp = B.hp[0], frame = createInputFrame(), drops = [];
    w.api.spawnDrop = (x, y, kind) => { drops.push(kind); return drops.length - 1; };
    if (dense) { B.w[0] = 30; B.h[0] = 30; }
    const root = new THREE.Group(), white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const marks = createMarks(root, { tex: { glow: {} }, white, white70: white, white50: white, darkMetal: white });
    marks.setReadability({ small: true, scale: 0.2901833621 }); marks.setWorld(w, w.level.mode);
    const draw = time => { marks.rebuild(w, w.level.mode, null, null, 1); marks.frame(w, 1, time); };
    draw(0);
    const icons = root.getObjectByName('brick-phone-symbols'), lines = root.getObjectByName('brick-hit-lines');
    assert.equal(icons.count, 1);
    assert.equal(icons.geometry.attributes.aCell.array[0], 5, 'loaded power uses the existing icon draw with its own glyph cell');
    assert.equal(visible(lines), startHp);
    assert.equal(root.getObjectByName('brick-hit-fallbacks').count, 0, 'the mark never trades readable lines for a numeral');
    const initialPowerMatrix = structuredClone(icons.matrices[0]);
    for (let hit = 1; hit <= startHp; hit++) {
      emit(w.bus, EV.BRICK_HIT, 0, B.x[0], B.y[0], 0, SRC.BALL, 0); stepWorld(w, frame);
      marks.hit(0, hit);
      const before = snapshot(B); draw(hit + 0.2);
      assert.deepEqual(snapshot(B), before, 'loaded presentation does not alter damage, material or collision state');
      assert.equal(B.hp[0], startHp - hit);
      if (hit < startHp) {
        assert.deepEqual(drops, []);
        assert.equal(B.drop[0], DROP.LASER);
        assert.equal(visible(lines), startHp - hit);
        assert.equal(icons.count, 1);
        assert.deepEqual(icons.matrices[0], initialPowerMatrix, 'the power cue remains fixed through damage');
      } else {
        assert.deepEqual(drops, [DROP.LASER], 'only the break releases its fixed good power');
        assert.equal(icons.count, 0);
        assert.equal(lines.count, 0);
      }
    }
    emit(w.bus, EV.BRICK_HIT, 0, B.x[0], B.y[0], 0, SRC.BALL, 0); stepWorld(w, frame); draw(10);
    assert.deepEqual(drops, [DROP.LASER], 'later contacts do not duplicate the reward');
  }
});

function wallFor(t) {
  const scene = new THREE.Group(), white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const materials = { tex: { glow: {} }, shell: white, cavityGlass: white, titanium: white, matte: white,
    core: white, white, white70: white, white50: white, darkMetal: white };
  const wall = createBricks(scene, materials), ended = [];
  const draw = time => wall.frame(1, time, rupture => ended.push({ ...rupture }));
  const heats = () => { const values = []; scene.traverse(o => {
    const a = o.geometry?.attributes?.aHeat;
    if (a) for (let i = 0; i < o.count; i++) values.push(a.array[i]);
  }); return values; };
  wall.setWorld(t.world); draw(0);
  return { wall, draw, heats, ended, scene };
}

test('rupture heat markers expire once and never leak into live, reformed or reset core slots', () => {
  const t = contentWorld(level(['c..........a'])), B = t.world.bricks, r = wallFor(t);
  const original = snapshot(B), baseHeat = r.wall.heatAt(0, 0);
  assert.ok(r.heats().every(h => h >= 0));
  t.hit(0);
  const before = snapshot(B);
  const rupture = r.wall.broken(0, B.x[0], B.y[0], B.type[0], 1);
  r.draw(1.08);
  const values = r.heats();
  assert.equal(values.length, 2, 'one compacted live core and one rupture remain');
  assert.ok(values[0] >= 0 && values[1] < -1, 'only the reserved rupture slot carries a negative marker');
  assert.ok(Math.abs((-values[1] - 1) - (baseHeat + LOOK.RUPTURE_FLASH)) < 1e-5, 'marker decodes the original full heat before the shader bounds its emission');
  assert.equal(rupture.heat, baseHeat, 'fragment source heat stays positive and unchanged');
  assert.deepEqual(snapshot(B), before, 'encoding is renderer-only state');
  r.draw(1 + LOOK.RUPTURE_S + 0.001); r.draw(2);
  assert.equal(r.ended.length, 1);
  assert.equal(r.ended[0].heat, baseHeat);
  assert.ok(r.heats().every(h => h >= 0), 'expired rupture slots leave the active draw count');
  B.alive[0] = 1; B.hp[0] = B.hpMax[0]; B.version++;
  r.wall.spawned(0, 3); r.draw(3.05);
  assert.ok(r.heats().every(h => h >= 0), 'a reused live slot rewrites positive heat, including reformation heat above one');
  assert.equal(r.heats().length, 2);
  r.wall.setWorld(t.world); r.draw(0);
  assert.ok(r.heats().every(h => h >= 0));
  assert.equal(r.wall.heatAt(0, 0), baseHeat);
  assert.equal(original[0][1], B.count, 'pool cardinality and collision records remain unchanged');
});

test('burn-off, hidden and sealed cavity slots keep their original heat while world shape changes reset ruptures', () => {
  const t = contentWorld(level(['c..........a'])), B = t.world.bricks, r = wallFor(t);
  t.hit(0); r.wall.broken(0, B.x[0], B.y[0], B.type[0], 1, true); r.draw(1.1);
  assert.ok(r.heats().every(h => h >= 0), 'the warm burn-off shrink path never uses rupture attenuation');
  r.wall.setWorld(t.world); r.draw(0);
  B.type[0] = BRICK.CAVITY; B.flags[0] |= BF.CAVITY_BALL; B.alive[0] = 1; B.version++;
  r.draw(1);
  assert.equal(r.wall.heatAt(0, 1), 0);
  B.alive[0] = 0; B.version++;
  r.wall.broken(0, B.x[0], B.y[0], B.type[0], 2); r.draw(2);
  assert.ok(r.heats().includes(-1), 'zero heat is encoded as -1 rather than ambiguous negative zero');
  t.world.level.mode = 'ring'; r.wall.setWorld(t.world); r.draw(0);
  assert.ok(r.heats().every(h => h >= 0), 'switching to square shapes clears old slab ruptures');
  B.flags[1] |= BF.HIDDEN; B.version++; r.draw(1);
  assert.equal(r.heats().length, 0, 'hidden and cleared cavity cells leave no active heat slot');
  t.world.level.mode = 'bottom'; r.wall.setWorld(t.world); r.draw(0);
  assert.equal(r.heats().length, 0, 'returning to slab shapes cannot resurrect a reserved rupture');
});
