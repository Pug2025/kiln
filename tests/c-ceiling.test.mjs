// The camera and the visible edge use the same immutable, simulation-owned field limits.
import { test, assert, near } from './lib.mjs';
import { FIELD } from '../src/core/constants.js';
import { CEILING_ART, ceilingLayout, isCeilingHit } from '../src/render/ceiling.js';
import { createPose, fitCamera, fieldBounds, fieldToScreen, screenToFieldPose } from '../src/render/fit.js';

test('bottom ceiling: titanium ends on the actual bounce edge, glass sits entirely above it', () => {
  for (const ceilingY of [90, 300, 420, 600]) {
    const layout = ceilingLayout('bottom', { ceilingY, farX: FIELD.W });
    assert.ok(layout.active && !layout.vertical);
    near(layout.barY + CEILING_ART.BAR / 2, ceilingY, 0, 'inner edge matches physics');
    near(layout.paneY + layout.paneH / 2, ceilingY, 0, 'glass ends on ceiling');
    assert.equal(layout.y0, Math.max(0, ceilingY - CEILING_ART.BAND));
    assert.equal(layout.y1, FIELD.H);
    assert.ok(ceilingY - layout.y0 <= CEILING_ART.BAND, 'only a modest art band is framed');
    assert.ok(isCeilingHit(layout, 2));
    assert.ok(!isCeilingHit(layout, 1));
  }
});

test('left far wall: titanium begins on the bounce edge and the pane is beyond it', () => {
  for (const farX of [450, 570, 630, 720]) {
    const layout = ceilingLayout('left', { ceilingY: 0, farX });
    assert.ok(layout.active && layout.vertical);
    near(layout.barX - CEILING_ART.BAR / 2, farX, 0, 'inner edge matches physics');
    near(layout.paneX - layout.paneW / 2, farX, 0, 'glass begins on far wall');
    assert.equal(layout.x1, Math.min(FIELD.W, farX + CEILING_ART.BAND));
    assert.equal(layout.y0, 0);
    assert.ok(isCeilingHit(layout, 1));
    assert.ok(!isCeilingHit(layout, 2));
  }
});

test('ring and worlds without field limits preserve the original framing and have no ceiling glint', () => {
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

test('reframed arena fits desktop and phone, reserves and mouth stay clear, original input coordinates round-trip', () => {
  for (const mode of ['bottom', 'left']) {
    const frame = ceilingLayout(mode, { ceilingY: 450, farX: 450 });
    for (const [W, H, top, bottom] of [[1440, 900, 0, 0], [390, 844, 100, 70], [768, 1024, 150, 70], [800, 557, 100, 0]]) {
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
