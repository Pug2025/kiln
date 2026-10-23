import { test, assert, near } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { BF, BRICK } from '../src/core/constants.js';
import { getLevel, getStage } from '../src/levels/index.js';
import { CONTENT } from '../src/content/bricks.js';
import { CRUCIBLE_SPEC, CORE_SPECS } from '../src/content/bosses/orbit.js';
import { contentWorld } from './fixtures/B/helpers.mjs';
import { isBossCore, coreProtected, CORE_HIT_FLASH_MS, stokerThroat, orbitApertures, bossTrimKind } from '../src/render/boss-feedback.js';

const fights = () => [getLevel(10), getLevel(20), getLevel(30), getStage('core-2'), getStage('core-3')];
const coreOf = w => [...Array(w.bricks.count).keys()].find(i => isBossCore(w, i));

test('shipped Crucible vessel lip and body leave the real gate open while both bosses retain core heat', () => {
  function coreMaterials(id) {
    const glb = readFileSync(new URL(`../models/${id}.glb`, import.meta.url));
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
    const found = [];
    function walk(index, part = '') {
      const node = json.nodes[index];
      if (node.name?.startsWith('part-')) part = node.name;
      if (part.startsWith('part-core') && node.mesh !== undefined) {
        for (const p of json.meshes[node.mesh].primitives) found.push({ part, material: json.materials[p.material].name });
      }
      for (const child of node.children || []) walk(child, part);
    }
    for (const n of json.scenes[json.scene || 0].nodes) walk(n);
    return found;
  }
  const crucible = coreMaterials('crucible');
  assert.ok(crucible.some(m => /titanium/i.test(m.material)), 'regression includes the shipped closed titanium lip');
  assert.ok(crucible.some(m => /metal/i.test(m.material)), 'regression includes the vessel body');
  assert.ok(crucible.some(m => /ember/i.test(m.material)), 'regression includes the recessed heat pool');
  for (const m of crucible) assert.equal(bossTrimKind('crucible', m.part, m.material), /titanium|metal/i.test(m.material) ? 'inner' : '', m.material);
  const core = coreMaterials('core');
  assert.ok(core.length > 0 && core.every(m => /core/i.test(m.material)), 'The Core has a heated sphere without a separate closed metal lip');
  for (const m of core) assert.equal(bossTrimKind('core', m.part, m.material), '', 'heated sphere never aperture-cropped');
  assert.equal(bossTrimKind('core', 'part-shell', 'core'), '', 'heat remains protected if future model topology changes');
});

test('every boss: counted core hit flashes briefly, cooldown dims and expires without a brick rebuild', () => {
  for (const def of fights()) {
    const t = contentWorld(def), w = t.world, core = coreOf(w);
    assert.ok(core >= 0, `${def.id}: core identified`);
    assert.equal(coreProtected(w), false, 'fresh core is ready');
    t.hit(core);
    assert.equal(coreProtected(w), false, 'counted impact gets its brief flash');
    const at = w.boss.data.lastCoreMs;
    w.time = at + CORE_HIT_FLASH_MS;
    assert.equal(coreProtected(w), true, 'cooldown visibly cold after counted flash');
    t.hit(core);
    assert.equal(w.boss.data.lastCoreMs, at, 'ignored contact does not restart flash/readiness');
    assert.ok(t.events().some(e => e.name === 'BOSS_BLOCKED'));
    const version = w.bricks.version;
    w.time = at + CONTENT.CORE_COOLDOWN_MS;
    assert.equal(coreProtected(w), false, 'warms at exact cooldown expiry');
    assert.equal(w.bricks.version, version, 'expiry requires no structural update');
  }
});

test('every boss: guard stays dim after cooldown and warms when content ends the entry', () => {
  for (const def of fights()) {
    const t = contentWorld(def), w = t.world, core = coreOf(w);
    w.api.spawnBall(w.bricks.x[core], w.bricks.y[core], 0, 0);
    t.hit(core);
    w.time += CONTENT.CORE_COOLDOWN_MS;
    t.hit(core);
    assert.equal(w.boss.data.guard, 1);
    w.time += CONTENT.CORE_COOLDOWN_MS;
    assert.equal(coreProtected(w), true, `${def.id}: guard outlasts short cooldown`);
    w.balls[0].alive = false;
    t.step();
    assert.equal(w.boss.data.guard, 0);
    assert.equal(coreProtected(w), false, 'exit restores visibly hot core');
  }
});

test('Stoker throat crop follows the actual jaw span through breakage and sway, never crops permanent cheeks', () => {
  const t = contentWorld(getLevel(10)), w = t.world, B = w.bricks, out = new Float32Array(3);
  const jaw = [...Array(B.count).keys()].filter(i => B.type[i] === BRICK.ARMOURED && B.flags[i] & BF.BOSS);
  const core = coreOf(w);
  stokerThroat(w, out);
  near(out[0], -182, 1e-4);
  near(out[1], 182, 1e-4);
  near(out[2], w.boss.y - B.y[core] + B.h[core] / 2 + 2, 1e-4);
  t.hit(jaw[2]); t.hit(jaw[2]);
  assert.equal(B.alive[jaw[2]], 0);
  const before = Array.from(out);
  stokerThroat(w, out);
  assert.deepEqual(Array.from(out), before, 'per-cell destruction exposes the already carved void');
  t.hit(core); t.step(70);
  assert.notEqual(w.boss.x, w.boss.px, 'test includes the moving phase');
  stokerThroat(w, out);
  near(out[0], before[0], 1e-4);
  near(out[1], before[1], 1e-4);
  assert.ok(out[1] < 240, 'wide permanent cheek columns remain intact');
});

function bearingInGap(out, bearing) {
  const x = Math.cos(bearing), y = Math.sin(bearing);
  for (let k = 0; k < 2; k++) if (out[k * 4 + 3] && x * out[k * 4] + y * out[k * 4 + 1] > out[k * 4 + 2]) return true;
  return false;
}

test('orbit model cuts follow the real clear square-plate sectors in every stage, rotation and direction', () => {
  const out = new Float32Array(8), tau = Math.PI * 2;
  for (const def of fights().slice(1)) {
    const t = contentWorld(def), w = t.world, B = w.bricks;
    const rings = w.boss.id === 'crucible' ? CRUCIBLE_SPEC.rings : CORE_SPECS[w.boss.phase].rings;
    for (let step = 0; step < 20; step++) {
      t.step(35);
      for (let r = 0; r < rings.length; r++) {
        const spec = rings[r], angle = r ? w.boss.data.angle2 : w.boss.angle;
        orbitApertures(w, 1, r, out);
        assert.ok(out.every(Number.isFinite));
        for (const g of spec.gaps) {
          // The central missing-slot ray is clear except possibly at a boundary gap slot;
          // test all actual square corners, rather than assuming plates rotate with the model.
          const bearing = g * tau / spec.slots + angle;
          let clear = true;
          for (let i = 0; i < B.count; i++) {
            if (!B.alive[i] || B.type[i] !== BRICK.BOSS || B.group[i] !== spec.group) continue;
            const x = Math.cos(bearing) * spec.r + w.boss.x, y = Math.sin(bearing) * spec.r + w.boss.y;
            if (Math.abs(x - B.x[i]) <= 15 && Math.abs(y - B.y[i]) <= 15) clear = false;
          }
          if (clear) assert.ok(bearingInGap(out, bearing), `${def.id} ring ${r}: true opening is cut in hardware`);
        }
        // Gaps must not become a full-circle deletion of the art.
        assert.ok(out[2] > 0.5 && out[2] < 1);
        const plate = [...Array(B.count).keys()].find(i => B.alive[i] && B.type[i] === BRICK.BOSS && B.group[i] === spec.group);
        assert.equal(bearingInGap(out, Math.atan2(B.y[plate] - w.boss.y, B.x[plate] - w.boss.x)), false);
      }
    }
  }
});
