// C: pure camera-fit and field <-> world maths (src/render/fit.js). No three.js here.

import { test, assert, near } from './lib.mjs';
import { FIELD, PADDLE } from '../src/core/constants.js';
import {
  FIT, createPose, fitCamera, fieldToWorld, worldToField, fieldToScreen, screenToFieldPose, fieldBounds,
  screenToPlane, projectWorld,
} from '../src/render/fit.js';
import { LOOK } from '../src/render/look.js';

function fits(W, H, opts) {
  const pose = createPose();
  const out = fitCamera(W, H, pose, {}, opts);
  const b = fieldBounds(pose, W, H, {});
  const top = out.top;
  const avail = H - top - out.bottom;
  const topEdge = top + ((1 - out.marginY) * avail) / 2;
  // every corner on screen, the field inside its margins between the reserves (plus half a pixel
  // of rounding), the kiln mouth on screen (it may burn in the bottom reserve)
  assert.ok(b.x0 >= -0.5 && b.x1 <= W + 0.5, `x inside at ${W}x${H}: ${b.x0.toFixed(1)}..${b.x1.toFixed(1)}`);
  assert.ok(b.y0 >= topEdge - 0.5 && b.y1 <= H - out.bottom + 0.5, `y inside at ${W}x${H}: ${b.y0.toFixed(1)}..${b.y1.toFixed(1)}`);
  assert.ok(out.mouthY <= H + 0.5, `mouth on screen at ${W}x${H}: ${out.mouthY.toFixed(1)}`);
  const fw = (b.x1 - b.x0) / W, fh = (b.y1 - b.y0) / avail, fe = (Math.max(b.y1, out.mouthY) - b.y0) / (H - topEdge);
  // within the margins, and one of them tight: the width, the height, or field plus mouth
  assert.ok(fw <= out.marginX + 1e-3 && fh <= out.marginY + 1e-3 && fe <= 1 + 1e-3, `within margins ${fw} ${fh} ${fe}`);
  assert.ok(Math.abs(fw - out.marginX) < 0.01 || Math.abs(fh - out.marginY) < 0.01 || Math.abs(fe - 1) < 0.01, `fills one axis ${fw} ${fh} ${fe}`);
  // the field is centred between the reserves, unless the mouth needs it higher: then the mouth
  // sits on the screen's bottom edge
  const centre = top + avail / 2;
  const mid = (b.y0 + b.y1) / 2;
  const lifted = Math.abs(mid - centre) > 2;
  if (lifted) {
    assert.ok(mid < centre, 'the field only ever rises for the mouth');
    near(out.mouthY, H, 2, 'mouth on the screen bottom');
  }
  // the HUD rect sits on the top edge and spans it
  near(out.rect.y, b.y0, 0.75, 'rect top on the field top edge');
  assert.ok(out.rect.w > 0 && out.rect.h > 0 && out.rect.scale > 0);
  near(out.rect.scale, out.rect.w / FIELD.W, 1e-9);
  return { pose, out, b, lifted };
}

test('kiln mouth stays in view: desktop shows the fire under the field, phones stay centred', () => {
  const desk = fits(1440, 900);
  assert.ok(desk.out.mouthY <= 900 + 0.5, `mouth on screen at 1440x900: ${desk.out.mouthY.toFixed(1)}`);
  // the fire band (lip 1030 to the mouth) is at least 60 px tall on a 900 px desktop
  const s = { x: 0, y: 0, w: 0 };
  fieldToScreen(desk.pose, 360, 1030, 1440, 900, s);
  assert.ok(desk.out.mouthY - s.y > 50, `fire band ${(desk.out.mouthY - s.y).toFixed(1)} px`);
  const phone = fits(390, 844);
  assert.equal(phone.lifted, false, 'a phone has room: the field stays centred');
  // with no mouth the desktop field is centred and a little bigger
  const plain = fits(1440, 900, { below: 0 });
  assert.equal(plain.lifted, false);
  assert.ok(plain.out.rect.scale > desk.out.rect.scale);
});

test('setReserve: the field fits below a top reserve and the canvas pose stays exact', () => {
  for (const [W, H, top] of [[768, 1024, 150], [390, 664, 120], [700, 1000, 140]]) {
    const { out, b, pose } = fits(W, H, { top });
    assert.equal(out.top, top);
    assert.ok(b.y0 >= top + ((1 - out.marginY) * (H - top)) / 2 - 1, `${W}x${H}: field top ${b.y0.toFixed(1)} below the reserve ${top}`);
    const f = { x: 0, y: 0 }, s = { x: 0, y: 0, w: 0 };
    fieldToScreen(pose, 360, 1000, W, H, s);
    assert.ok(screenToFieldPose(pose, s.x, s.y, W, H, f));
    near(f.y, 1000, 1e-6, 'screen -> field stays exact with a reserve');
  }
  // a reserve never takes more than its share of the screen
  assert.equal(fitCamera(390, 844, createPose(), {}, { top: 800 }).top, 844 * FIT.MAX_RESERVE);
});

test('setReserve bottom: the field ends above the touch Overload room, the fire may burn in it', () => {
  // D's loop: grow the bottom reserve until the field's bottom edge clears H - bottom
  for (const [W, H, top, bottom] of [[390, 844, 0, 90], [390, 664, 120, 80], [412, 915, 0, 60], [768, 1024, 150, 70]]) {
    const { out, b } = fits(W, H, { top, bottom });
    assert.equal(out.bottom, bottom);
    const fieldBottom = out.rect.y + out.rect.h;
    assert.ok(fieldBottom <= H - bottom + 0.5, `${W}x${H}: field bottom ${fieldBottom.toFixed(1)} above ${H - bottom}`);
    near(fieldBottom, b.y1, 1e-6, 'fieldRect bottom is the projected field bottom');
    const plain = fits(W, H, { top });
    assert.ok(out.rect.scale <= plain.out.rect.scale + 1e-9, 'a bottom reserve never grows the field');
  }
  // both reserves together never take more than half the screen
  const o = fitCamera(390, 844, createPose(), {}, { top: 300, bottom: 300 });
  assert.ok(o.top + o.bottom <= 844 * FIT.MAX_RESERVE_SUM + 1e-9);
});

test('field fits at 390×844', () => {
  const { out } = fits(390, 844);
  assert.equal(out.marginX, FIT.MARGIN_X_NARROW, 'narrow screens use the wider margin');
});

test('field fits at 412×915', () => { fits(412, 915); });

test('field fits at 1440×900', () => {
  const { out } = fits(1440, 900);
  assert.equal(out.marginX, FIT.MARGIN_X);
});

test('field fits at 1024×768', () => { fits(1024, 768); });

test('field fits at extreme shapes (tall phone, ultrawide, tiny)', () => {
  fits(320, 1000);
  fits(2560, 1080);
  fits(200, 150);
});

test('field ↔ world round trip', () => {
  const w = { x: 0, y: 0 }, f = { x: 0, y: 0 };
  for (const [x, y] of [[0, 0], [720, 1080], [360, 540], [12.5, 999.25], [700, 40]]) {
    fieldToWorld(x, y, w);
    worldToField(w.x, w.y, f);
    near(f.x, x, 1e-9);
    near(f.y, y, 1e-9);
  }
  fieldToWorld(360, 1000, w);
  near(w.x, 0, 0);
  near(w.y, -460, 0, 'paddle line at scene y -460 (ART section 7)');
});

test('screen -> field ray hits the point that was projected (tilt, lean and roll)', () => {
  const W = 390, H = 844;
  const { pose } = fits(W, H);
  const s = { x: 0, y: 0, w: 0 }, f = { x: 0, y: 0 };
  for (const roll of [0, 0.012, -0.012]) {
    pose.roll = roll;
    pose.px = roll * 3000; // a lean
    pose.tx = pose.px * 0.35;
    for (const [x, y] of [[0, 0], [720, 1080], [360, 1000], [123, 456], [700, 90]]) {
      fieldToScreen(pose, x, y, W, H, s);
      assert.ok(screenToFieldPose(pose, s.x, s.y, W, H, f));
      near(f.x, x, 1e-6, `x at roll ${roll}`);
      near(f.y, y, 1e-6, `y at roll ${roll}`);
    }
  }
});

test('screen -> plane at depth agrees with screen -> field at z = 0', () => {
  const W = 1440, H = 900;
  const { pose } = fits(W, H);
  const f = { x: 0, y: 0 }, p = { x: 0, y: 0 }, w = { x: 0, y: 0 };
  for (const [sx, sy] of [[0, 0], [720, 450], [1440, 900], [100, 800]]) {
    assert.ok(screenToFieldPose(pose, sx, sy, W, H, f));
    assert.ok(screenToPlane(pose, sx, sy, W, H, 0, p));
    fieldToWorld(f.x, f.y, w);
    near(p.x, w.x, 1e-6);
    near(p.y, w.y, 1e-6);
  }
  // a plane farther back shows a bigger slice of the world
  const top0 = { x: 0, y: 0 }, topBack = { x: 0, y: 0 };
  screenToPlane(pose, W / 2, 0, W, H, 0, top0);
  screenToPlane(pose, W / 2, 0, W, H, -240, topBack);
  assert.ok(topBack.y > top0.y);
});

test('the grate: seven bars along x, none inside the paddle ring at any fit (ART 15.3 C8)', () => {
  const [bw, bh, bd] = LOOK.GRATE_BAR;
  assert.equal(LOOK.GRATE_Z.length, 7, 'seven cast bars');
  assert.ok(bw <= FIELD.W + 80, 'bars stay under the field, out of the gutters');
  const s = { x: 0, y: 0, w: 0 };
  for (const [W, H] of [[390, 844], [375, 667], [390, 664], [412, 915], [768, 1024], [800, 557], [1024, 768], [1280, 800], [1440, 900], [2560, 1080]]) {
    const { pose } = fits(W, H);
    // the paddle's 40-unit ring at the bottom-mode paddle line, on screen
    fieldToScreen(pose, FIELD.W / 2, PADDLE.Y + PADDLE.H / 2 + 40, W, H, s);
    const ringBottom = s.y;
    for (const z of LOOK.GRATE_Z) {
      // the highest point of a bar on screen is its top back edge
      projectWorld(pose, 0, LOOK.GRATE_Y + bh / 2, z - bd / 2, s);
      const y = ((1 - s.y) / 2) * H;
      assert.ok(y > ringBottom + 1, `${W}x${H}: bar at z ${z} shows at ${y.toFixed(1)}, ring ends at ${ringBottom.toFixed(1)}`);
    }
    // the bearers sit under the bars and end with the last bar
    const zBack = LOOK.GRATE_Z[LOOK.GRATE_Z.length - 1] - bd / 2;
    projectWorld(pose, LOOK.GRATE_BEARER[0], LOOK.GRATE_Y - bh / 2, zBack, s);
    const yb = ((1 - s.y) / 2) * H;
    assert.ok(yb > ringBottom + 1, `${W}x${H}: bearer shows at ${yb.toFixed(1)}, ring ends at ${ringBottom.toFixed(1)}`);
  }
});

test('the camera looks slightly down from above the centre', () => {
  const { pose } = fits(1440, 900);
  assert.equal(pose.py, FIT.LIFT);
  assert.ok(pose.ty < pose.py, 'look target below the camera');
  assert.ok(pose.pz > 1000 && pose.pz < 6000, `sane distance ${pose.pz}`);
});
