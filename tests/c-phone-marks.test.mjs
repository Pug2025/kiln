import { test, assert, near } from './lib.mjs';
import { BF } from '../src/core/constants.js';
import { LEVELS, stagesOf } from '../src/levels/index.js';
import { parseLevel } from '../src/levels/parser.js';
import { phoneMarkLayout, hitLineLayout, hitLinePosition, loadedMarkLayout, glyphInkRect, PHONE_MARKS } from '../src/render/phone-marks.js';

test('phone portal letter layout retains readable cap height and contained symbols', () => {
  const plan = {};
  for (const scale of [0.50, 0.51, 0.55]) {
    assert.equal(phoneMarkLayout({ small: true, scale }, 60, 30, plan), plan);
    assert.ok(plan.digits);
    near(plan.glyphH * scale, PHONE_MARKS.CAP_PX);
    assert.ok(plan.glyphH * scale + PHONE_MARKS.ROW_GAP_PX <= 30 * scale);
  }
  for (const scale of [0.35, 0.36, 0.40, 0.42]) {
    assert.equal(phoneMarkLayout({ small: true, scale }, 30, 30, plan).digits, false, 'dense rows use counts without overlapping');
    assert.equal(phoneMarkLayout({ small: true, scale }, 30, 60, plan).digits, true, 'upright left-mode letters use the taller row');
  }
  assert.equal(phoneMarkLayout({ small: false, scale: 0.4 }, 30, 30, plan).small, false);
  assert.equal(plan.glyphH, 15, 'desktop keeps the original geometry');
});

test('phone hit channels keep a 3 CSS px floor, dark gaps and containment for every campaign hit count', () => {
  const plan = {}, point = {}, points = [];
  for (const [width, height] of [[60, 30], [30, 60], [30, 30]]) for (const scale of [0.2901833621, 0.30, 0.35, 0.42, 0.4606875, 0.50, 0.55]) {
    for (let count = 1; count <= 4; count++) {
      assert.equal(hitLineLayout({ small: true, scale }, width, height, count, plan), plan);
      assert.equal(plan.count, count);
      assert.equal(plan.fallback, false, 'all 1-4 counts stay lines at the required phone sizes');
      assert.equal(plan.floorMet, true);
      assert.ok(Math.min(plan.w, plan.h) * scale >= 3, 'information never shrinks below the phone floor');
      assert.ok(plan.gap * scale >= 0.79, 'a dark gap separates adjacent segments');
      points.length = 0;
      for (let k = 0; k < count; k++) {
        assert.equal(hitLinePosition(k, plan, point), point);
        assert.ok(Math.abs(point.x) + plan.w / 2 + plan.pad <= (width - 4) / 2 + 1e-6, `horizontal containment: ${width}/${scale}/${count}`);
        assert.ok(Math.abs(point.y) + plan.h / 2 + plan.pad <= (height - 4) / 2 + 1e-6, `vertical containment: ${height}/${scale}/${count}`);
        for (const prev of points) assert.ok(Math.abs(prev.x - point.x) > plan.w || Math.abs(prev.y - point.y) > plan.h, 'lit channels do not touch');
        points.push({ x: point.x, y: point.y });
      }
    }
  }
});

test('dense ring counts use a two-row bank while slabs retain the long filament language', () => {
  const dense = hitLineLayout({ small: true, scale: 0.30 }, 30, 30, 4, {});
  assert.equal(dense.compact, true);
  assert.deepEqual([dense.cols, dense.rows], [2, 2]);
  assert.ok(dense.w * 0.30 >= 3.05);
  near(dense.h * 0.30, 3.05);
  const slab = hitLineLayout({ small: true, scale: 0.35 }, 60, 30, 4, {});
  assert.equal(slab.compact, false);
  assert.ok(slab.h > slab.w, 'a normal slab keeps visibly long lines');
  const desktop = hitLineLayout({ small: false, scale: 0.5 }, 60, 30, 4, {});
  assert.equal(desktop.compact, false);
  assert.equal(desktop.h, 18);
});

test('hit layouts expose an explicit contained fallback for every supported HP count and tiny-view no-fit case', () => {
  for (const [width, height] of [[60, 30], [30, 60], [30, 30]]) for (const scale of [0.10, 0.2901833621, 0.4606875]) {
    for (let count = 1; count <= 9; count++) {
      const plan = hitLineLayout({ small: true, scale }, width, height, count, {});
      assert.equal(plan.count, count);
      if (plan.fallback) {
        assert.equal(plan.mode, 'glyph');
        assert.equal(plan.floorMet, false, 'a glyph fallback is never reported as passing the line floor');
        assert.ok(plan.glyphH + plan.pad * 2 <= Math.min(width, height) - 4 + 1e-6, 'fallback ink and backing cannot cover a neighbor');
      } else {
        assert.ok(plan.width + plan.pad * 2 <= width - 4 + 1e-6);
        assert.ok(plan.height + plan.pad * 2 <= height - 4 + 1e-6);
        assert.equal(plan.floorMet, true);
      }
      if (scale === 0.10) assert.equal(plan.fallback, true, 'a three-pixel cell cannot hold separated three-pixel channels');
    }
  }
  assert.equal(hitLineLayout({ small: true, scale: 0.2901833621 }, 30, 30, 5, {}).fallback, true, 'hardened dense HP5 needs the alternate');
  assert.equal(hitLineLayout({ small: true, scale: 0.2901833621 }, 60, 30, 6, {}).fallback, false, 'two rows retain all six Overburn lines where space permits');
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


test('all 41 shipped loaded faces contain separate power marks and hit lines above the required phone floor', () => {
  let total = 0;
  for (const def of LEVELS.flatMap(stagesOf)) for (const brick of parseLevel(def).bricks.filter(b => b.flags & BF.LOADED)) {
    total++;
    for (const info of [{ small: true, scale: 0.2901833621 }, { small: true, scale: 0.4606875 }, { small: false, scale: 0.6 }]) {
      const plan = loadedMarkLayout(info, brick.w, brick.h, {});
      const lines = hitLineLayout(info, plan.lineWidth, plan.lineHeight, brick.hp, {});
      assert.equal(lines.fallback, false, `${def.id}/${brick.row},${brick.col}: loaded HP remains lines`);
      assert.ok(lines.floorMet && plan.powerFloorMet, `${def.id}: both meanings meet the phone floor`);
      const rects = [{ x: plan.powerX, y: plan.powerY, w: plan.powerW, h: plan.powerH }];
      for (let k = 0; k < brick.hp; k++) {
        const point = hitLinePosition(k, lines, {});
        rects.push({ x: plan.lineX + point.x, y: plan.lineY + point.y, w: lines.w, h: lines.h });
      }
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        assert.ok(Math.abs(r.x) + r.w / 2 + plan.pad <= (brick.w - 4) / 2 + 1e-6, `${def.id}: mark backing stays on its own face horizontally`);
        assert.ok(Math.abs(r.y) + r.h / 2 + plan.pad <= (brick.h - 4) / 2 + 1e-6, `${def.id}: mark backing stays on its own face vertically`);
        for (const q of rects.slice(0, i)) assert.ok(Math.abs(q.x - r.x) > (q.w + r.w) / 2 + plan.pad * 2 || Math.abs(q.y - r.y) > (q.h + r.h) / 2 + plan.pad * 2, `${def.id}: power and hit recesses never overlap`);
      }
      if (def.mode === 'ring') {
        assert.ok(plan.stacked && plan.powerY < plan.lineY);
        assert.equal(brick.hp, 2, 'the dense shipped ring layout reserves only one row of two hit segments');
      }
    }
  }
  assert.equal(total, 41);
});
