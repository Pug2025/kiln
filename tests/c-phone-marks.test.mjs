import { test, assert, near } from './lib.mjs';
import { phoneMarkLayout, phonePipLayout, phonePipPosition, glyphInkRect, PHONE_MARKS } from '../src/render/phone-marks.js';

test('phone hit digits reach readable cap height only where row spacing can contain them', () => {
  const plan = {};
  for (const scale of [0.50, 0.51, 0.55]) {
    assert.equal(phoneMarkLayout({ small: true, scale }, 60, 30, plan), plan);
    assert.ok(plan.digits);
    near(plan.glyphH * scale, PHONE_MARKS.CAP_PX);
    assert.ok(plan.glyphH * scale + PHONE_MARKS.ROW_GAP_PX <= 30 * scale);
  }
  for (const scale of [0.35, 0.36, 0.40, 0.42]) {
    assert.equal(phoneMarkLayout({ small: true, scale }, 30, 30, plan).digits, false, 'dense rows use counts without overlapping');
    assert.equal(phoneMarkLayout({ small: true, scale }, 30, 60, plan).digits, true, 'upright left-mode numbers use the taller row');
  }
  assert.equal(phoneMarkLayout({ small: false, scale: 0.4 }, 30, 30, plan).small, false);
  assert.equal(plan.glyphH, 15, 'desktop keeps the original geometry');
});

test('all remaining-hit counts fit bottom, left and ring cells at phone scales with separated pips', () => {
  const plan = {}, point = {}, points = [];
  for (const [w, h] of [[60, 30], [30, 60], [30, 30]]) for (const scale of [0.35, 0.42, 0.50, 0.55]) {
    for (let count = 1; count <= 9; count++) {
      assert.equal(phonePipLayout(count, w - 4, h - 4, scale, plan), plan);
      assert.equal(plan.count, count);
      points.length = 0;
      for (let k = 0; k < count; k++) {
        assert.equal(phonePipPosition(k, plan, point), point);
        assert.ok(Math.abs(point.x) + plan.size / 2 <= (w - 4) / 2);
        assert.ok(Math.abs(point.y) + plan.size / 2 <= (h - 4) / 2);
        for (const prev of points) assert.ok(Math.max(Math.abs(prev.x - point.x), Math.abs(prev.y - point.y)) > plan.size, 'pips cannot touch');
        points.push({ x: point.x, y: point.y });
      }
      assert.ok(plan.size * scale >= 1.9, 'dense count remains visible rather than becoming hairline texture');
    }
  }
});

test('phone glyph UVs fit actual atlas ink rather than the padded font cell', () => {
  const out = {};
  assert.equal(glyphInkRect(19, 33, 45, 101, 64, 128, out), out);
  near(out.w * 64, 28);
  near(out.h * 128, 70);
  near(out.aspect, 28 / 70);
  assert.ok(out.x >= 0 && out.y >= 0 && out.x + out.w <= 1 && out.y + out.h <= 1);
  const narrow = glyphInkRect(26, 33, 38, 101, 64, 128, {});
  assert.ok(narrow.aspect < out.aspect, 'a narrow 1 keeps its actual typeface proportions');
});

test('phone weak-point target corners stay inside real fused collision rectangles and leave the centre open', async () => {
  const { phoneTargetSegment } = await import('../src/render/phone-marks.js');
  const out = {};
  for (const [width, height] of [[30, 30], [120, 30], [120, 60], [60, 120]]) for (const scale of [0.35, 0.42, 0.51]) {
    for (let k = 0; k < 8; k++) {
      assert.equal(phoneTargetSegment(k, width, height, scale, out), out);
      assert.ok(Math.abs(out.x) + out.w / 2 < width / 2);
      assert.ok(Math.abs(out.y) + out.h / 2 < height / 2);
      assert.ok(Math.abs(out.x) > out.w / 2 || Math.abs(out.y) > out.h / 2, 'target centre remains visibly open');
    }
  }
});
