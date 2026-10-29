// The camera and the visible edge use the same immutable, simulation-owned field limits.
import { test, assert, near } from './lib.mjs';
import { register } from 'node:module';
import { FIELD } from '../src/core/constants.js';
import { CEILING_ART, ceilingLayout, lintelPiece, ceilingContact, isCeilingHit } from '../src/render/ceiling.js';
import { createPose, fitCamera, fieldBounds, fieldToScreen, screenToFieldPose } from '../src/render/fit.js';

test('bottom lintel meets the actual bounce edge and leaves the painting band unchanged', () => {
  for (const ceilingY of [90, 300, 420, 600]) {
    const layout = ceilingLayout('bottom', { ceilingY, farX: FIELD.W });
    assert.ok(layout.active && !layout.vertical);
    near(layout.barY + CEILING_ART.BAR / 2, ceilingY, 0, 'inner edge matches physics');
    near(layout.wallY - layout.wallH / 2, ceilingY - 12, 0, 'outline ends inside the lintel');
    assert.equal(layout.y0, Math.max(0, ceilingY - CEILING_ART.BAND));
    assert.equal(layout.y1, FIELD.H);
    assert.ok(ceilingY - layout.y0 <= CEILING_ART.BAND, 'only a modest art band is framed');
    assert.ok(isCeilingHit(layout, 2));
    assert.ok(!isCeilingHit(layout, 1));
  }
});

test('left lintel meets the far bounce edge and ends the outline inside its cap', () => {
  for (const farX of [450, 570, 630, 720]) {
    const layout = ceilingLayout('left', { ceilingY: 0, farX });
    assert.ok(layout.active && layout.vertical);
    near(layout.barX - CEILING_ART.BAR / 2, farX, 0, 'inner edge matches physics');
    near(layout.wallX + layout.wallW / 2, farX + 12, 0, 'outline ends inside the lintel');
    assert.equal(layout.x1, Math.min(FIELD.W, farX + CEILING_ART.BAND));
    assert.equal(layout.y0, 0);
    assert.ok(isCeilingHit(layout, 1));
    assert.ok(!isCeilingHit(layout, 2));
  }
});

test('ring and worlds without field limits preserve the original framing and have no lintel contact light', () => {
  for (const [mode, field] of [['ring', { ceilingY: 420, farX: 450 }], ['bottom', undefined], ['left', undefined]]) {
    const f = ceilingLayout(mode, field);
    assert.equal(f.active, false);
    assert.deepEqual([f.x0, f.y0, f.x1, f.y1], [0, 0, FIELD.W, FIELD.H]);
    assert.ok(!isCeilingHit(f, 1) && !isCeilingHit(f, 2));
    const pose = createPose(), old = fitCamera(1440, 900, pose, {});
    const now = fitCamera(1440, 900, pose, {}, { frame: f });
    near(now.dist, old.dist, 1e-9);
    near(now.look, old.look, 1e-9);
  }
});

test('segmented lintel has a continuous collision rail, bounded joints and fixed one-draw capacity', () => {
  for (const mode of ['bottom', 'left']) {
    const layout = ceilingLayout(mode, { ceilingY: 450, farX: 570 });
    const rail = lintelPiece(layout, 0);
    near(rail.y - rail.h / 2, -CEILING_ART.BAR / 2, 0, 'rail is exactly on the inner edge');
    assert.equal(rail.w, layout.barLength);
    assert.ok(layout.segments + 1 <= 9);
    let previousRight = -layout.barLength / 2 - CEILING_ART.JOINT / 2;
    for (let i = 1; i <= layout.segments; i++) {
      const part = lintelPiece(layout, i);
      near(part.x - part.w / 2 - previousRight, CEILING_ART.JOINT, 1e-9);
      near(part.y - part.h / 2, rail.y + rail.h / 2, 0, 'cap sits against the rail');
      near(part.y + part.h / 2, CEILING_ART.BAR / 2, 0);
      previousRight = part.x + part.w / 2;
    }
    near(previousRight, layout.barLength / 2 - CEILING_ART.JOINT / 2, 1e-9);
  }
});

test('warm contact expands briefly, stays inside the lintel and expires without a hot residual', () => {
  const out = {};
  for (const mode of ['bottom', 'left', 'ring']) {
    const layout = ceilingLayout(mode, { ceilingY: 450, farX: 570 });
    const extent = mode === 'left' ? FIELD.H : FIELD.W;
    for (const at of [-100, 0, extent / 2, extent, extent + 100]) {
      let alpha = 1;
      for (const age of [0, .25, .5, .99, 1, 5]) {
        assert.equal(ceilingContact(layout, at, age, out), out, 'reuses the supplied object');
        assert.ok(out.at - out.length / 2 >= -extent / 2 - 1e-9);
        assert.ok(out.at + out.length / 2 <= extent / 2 + 1e-9);
        assert.ok(out.alpha <= alpha);
        if (mode === 'ring' || age >= 1) assert.equal(out.alpha, 0);
        alpha = out.alpha;
      }
    }
  }
});

const STUB_URL = new URL('./fixtures/C/kiln-three-stub.mjs', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three' || spec === 'three/addons/geometries/RoundedBoxGeometry.js') return { url: ${JSON.stringify(STUB_URL)}, shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const THREE = await import(STUB_URL);
const { createKiln } = await import('../src/render/kiln.js');

test('real kiln mode changes reuse the lintel, clip the outline and clear contact state before ring play', () => {
  const scene = new THREE.Group(), plain = {};
  const kiln = createKiln(scene, { wallGlass: plain, titaniumP: plain, ribs: plain, pillars: plain, grate: {}, tex: { glow: {} } });
  const pool = kiln.ceilingBar, glow = kiln.ceilingGlow, geometry = pool.geometry, material = pool.material;
  const walls = kiln.frame.children.slice(0, 4);
  assert.equal(new Set(walls.map(wall => wall.geometry)).size, 4, 'opposite walls own their translated geometry');
  assert.deepEqual(walls.map(wall => wall.geometry.translation), [
    [-(FIELD.W / 2 + 6), 0, 0], [FIELD.W / 2 + 6, 0, 0],
    [0, FIELD.H / 2 + 6, 0], [0, -(FIELD.H / 2 + 6), 0],
  ]);
  const sill = scene.children.find((mesh) => mesh !== pool && mesh.material?.metalness === .7);
  assert.ok(sill, 'existing forged sill remains');
  assert.notEqual(material, sill.material, 'plain and instanced meshes keep separate program state');
  for (const key of ['color', 'roughness', 'metalness', 'envMapIntensity']) {
    assert.equal(material[key], sill.material[key], 'lintel retains the sill finish');
  }
  for (const mode of ['bottom', 'left', 'bottom', 'ring', 'left', 'ring']) {
    kiln.setMode(mode, { ceilingY: 450, farX: 570 });
    assert.equal(kiln.ceilingBar, pool); assert.equal(pool.geometry, geometry); assert.equal(pool.material, material);
    assert.equal(pool.visible, mode !== 'ring'); assert.equal(glow.visible, mode !== 'ring');
    assert.equal(pool.count > 0, mode !== 'ring', 'renderer draws only nonempty instance pools');
    assert.deepEqual([pool.position.x, pool.position.y, pool.position.z, pool.rotation.z], [0, 0, 0, 0],
      'the lintel object stays at identity while its instances follow the field edge');
    assert.equal(glow.rotation.z, mode === 'left' ? -Math.PI / 2 : 0, 'the glow follows the field orientation independently');
    if (pool.count) {
      const [x, y, , angle, , sy] = pool.matrices[0];
      assert.equal(angle, mode === 'left' ? -Math.PI / 2 : 0);
      if (mode === 'left') near(x - sy * CEILING_ART.BAR / 2, 570 - FIELD.W / 2, 1e-9, 'vertical rail still meets the collision edge');
      else near(y - sy * CEILING_ART.BAR / 2, FIELD.H / 2 - 450, 1e-9, 'horizontal rail still meets the collision edge');
    }
    const [left, right, top, bottom] = walls;
    assert.equal(left.position.x, right.position.x); assert.equal(top.position.y, bottom.position.y);
    if (mode === 'bottom') {
      assert.equal(left.scale.y * (FIELD.H + 24), FIELD.H - 450 + 24);
      assert.equal(left.position.y, FIELD.H / 2 - (450 + FIELD.H) / 2);
      assert.equal(top.visible, false); assert.equal(right.visible, true);
    } else if (mode === 'left') {
      assert.equal(top.scale.x * (FIELD.W + 24), 570 + 24);
      assert.equal(top.position.x, 570 / 2 - FIELD.W / 2);
      assert.equal(right.visible, false); assert.equal(left.visible, false);
    } else {
      for (const wall of walls) { assert.equal(wall.scale.x, 1); assert.equal(wall.scale.y, 1); assert.equal(wall.visible, true); }
      assert.equal(left.position.y, 0); assert.equal(top.position.x, 0);
      assert.equal(kiln.wallHit(2, 360, 450, 1), false);
    }
    assert.equal(glow.material.uniforms.uHit.value.z, 0, 'mode change clears old contact');
    const wall = mode === 'left' ? 1 : 2;
    if (mode !== 'ring') {
      assert.equal(kiln.wallHit(wall, 360, 450, 1), true);
      assert.equal(glow.material.uniforms.uHit.value.z, .8);
      kiln.update(1 + CEILING_ART.HIT_S + .01, 0, 1, 0);
      assert.equal(glow.material.uniforms.uHit.value.z, 0, 'contact expires on the actual renderer');
    }
  }
  assert.ok(!('ceilingPane' in kiln), 'no full-band pane remains');
  assert.equal(scene.children.filter(v => v.material === material).length, 0, 'no plain mesh shares the instanced material');
});

test('reframed arena fits desktop and phone, reserves and mouth stay clear, original input coordinates round-trip', () => {
  for (const mode of ['bottom', 'left']) {
    const frame = ceilingLayout(mode, { ceilingY: 450, farX: 450 });
    for (const [W, H, top, bottom] of [[1440, 900, 0, 0], [390, 844, 100, 70], [320, 568, 100, 70], [768, 1024, 150, 70], [800, 557, 100, 0]]) {
      const pose = createPose();
      const out = fitCamera(W, H, pose, {}, { top, bottom, frame });
      const b = fieldBounds(pose, W, H, {}, frame);
      assert.ok(b.x0 >= -0.5 && b.x1 <= W + 0.5, `${mode} ${W}: fits width`);
      assert.ok(b.y0 >= top - 0.5 && b.y1 <= H - bottom + 0.5, `${mode} ${W}: fits reserves`);
      assert.ok(out.mouthY <= H + 0.5, `${mode} ${W}: mouth stays visible`);
      assert.equal(out.rect.fieldY, frame.y0);
      assert.equal(out.rect.fieldH, frame.y1 - frame.y0);
      assert.equal(out.rect.fieldW, frame.x1 - frame.x0);
      near(out.rect.scale, out.rect.w / out.rect.fieldW, 1e-9);
      const s = {}, f = {};
      for (const [x, y] of [[120, 1000], [360, 900], [400, 540]]) {
        fieldToScreen(pose, x, y, W, H, s);
        assert.ok(screenToFieldPose(pose, s.x, s.y, W, H, f));
        near(f.x, x, 1e-6);
        near(f.y, y, 1e-6);
      }
    }
  }
});

test('removing dead headroom makes the desktop playing field larger', () => {
  const pose = createPose();
  const old = fitCamera(1440, 900, pose, {});
  const frame = ceilingLayout('bottom', { ceilingY: 450, farX: FIELD.W });
  const now = fitCamera(1440, 900, pose, {}, { frame });
  assert.ok(now.rect.scale > old.rect.scale * 1.2, 'at least twenty percent larger at the opening ceiling');
});
