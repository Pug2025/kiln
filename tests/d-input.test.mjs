// Kiln: D's pure input helpers (src/input/gestures.js). No DOM.

import { test, assert, near } from './lib.mjs';
import { TOUCH, FIELD, PERFECT, SIM, SPEED } from '../src/core/constants.js';
import {
  createGrab, beginGrab, grabTarget, paddleLimits, classifyPress, isHold, withinTapSlop,
  inSteerArea, thumbPadCircle, overloadCircle, hitsPad, keyAxis, PAD_MARGIN_PX, OVERLOAD_BTN_PX,
  createPress, pressDown, pressPending, pressDecide, pressUp, pressPull, actionMattersNow, overloadClearY, overloadTrayNeed,
} from '../src/input/gestures.js';
import { createInput } from '../src/input/input.js';
import { stepWorld } from '../src/core/world.js';
import { clearEdges } from '../src/core/input-frame.js';
import { EV } from '../src/core/events.js';
import { physicsWorld, launchAt, recorder } from './fixtures/A/sim.mjs';
import { installDom, removeDom } from './fixtures/D/dom.mjs';

test('relative grab keeps the paddle offset', () => {
  const g = createGrab();
  const lim = paddleLimits('bottom', 120, {});
  const out = { tx: 0, ty: 0 };
  // finger lands 80 units right of and 200 units below the paddle centre
  beginGrab(g, 440, 1200, 360, 1000);
  grabTarget(g, 440, 1200, lim, out);
  assert.equal(out.tx, 360, 'no jump when the finger lands');
  // the finger slides 50 units left: the paddle follows 1:1 and keeps the offset
  grabTarget(g, 390, 1210, lim, out);
  assert.equal(out.tx, 310);
  assert.equal(out.ty, 1010);
  grabTarget(g, 500, 1200, lim, out);
  assert.equal(out.tx, 420);
});

test('relative grab slips at the wall so turning back answers at once', () => {
  const g = createGrab();
  const lim = paddleLimits('bottom', 120, {});
  const out = { tx: 0, ty: 0 };
  beginGrab(g, 300, 1100, 360, 1000); // paddle 60 right of the finger
  grabTarget(g, 700, 1100, lim, out); // finger far right: target past the wall
  assert.equal(out.tx, FIELD.W - 60, 'clamped to the wall');
  grabTarget(g, 690, 1100, lim, out); // finger turns back 10 units
  assert.equal(out.tx, FIELD.W - 70, 'moves immediately, no dead zone');
});

test('relative grab in horizontal mode slips on y; ring mode is unclamped', () => {
  const g = createGrab();
  const out = { tx: 0, ty: 0 };
  const left = paddleLimits('left', 120, {});
  assert.equal(left.axis, 'y');
  beginGrab(g, 200, 540, 40, 540);
  grabTarget(g, 200, -100, left, out);
  assert.equal(out.ty, 60);
  grabTarget(g, 200, -90, left, out);
  assert.equal(out.ty, 70);
  const ring = paddleLimits('ring', 120, {});
  assert.equal(ring.axis, null);
  beginGrab(g, 100, 100, 360, 860);
  grabTarget(g, 0, 0, ring, out);
  assert.deepEqual([out.tx, out.ty], [260, 760]);
});

test('tap under 180 ms is an action, longer is Pull', () => {
  assert.equal(TOUCH.TAP_MS, 180);
  assert.equal(classifyPress(0), 'tap');
  assert.equal(classifyPress(120), 'tap');
  assert.equal(classifyPress(180), 'tap');
  assert.equal(classifyPress(181), 'hold');
  assert.equal(classifyPress(900), 'hold');
  assert.equal(isHold(1000, 1150), false);
  assert.equal(isHold(1000, 1181), true);
});

test('one-finger tap must stay inside the slop', () => {
  assert.equal(withinTapSlop(3, 4), true);
  assert.equal(withinTapSlop(12, 0), true);
  assert.equal(withinTapSlop(10, 10), false);
});

test('steering area is the lower 70% of the screen', () => {
  assert.equal(TOUCH.STEER_AREA, 0.7);
  assert.equal(inSteerArea(800, 844), true);
  assert.equal(inSteerArea(844 * 0.3 + 1, 844), true);
  assert.equal(inSteerArea(844 * 0.3 - 1, 844), false);
  assert.equal(inSteerArea(10, 844), false);
});

test('thumb pad hit areas: 64 px, bottom-right, mirrored when left-handed, inside the safe area', () => {
  assert.equal(TOUCH.THUMB_PAD_PX, 64);
  const safe = { top: 47, right: 0, bottom: 34, left: 0 };
  const pad = thumbPadCircle(390, 844, false, safe, {});
  assert.equal(pad.r, 32);
  near(pad.x, 390 - PAD_MARGIN_PX - 32);
  near(pad.y, 844 - 34 - PAD_MARGIN_PX - 32);
  assert.ok(hitsPad(pad, pad.x, pad.y));
  assert.ok(hitsPad(pad, pad.x + 40, pad.y), 'slop around the edge still hits');
  assert.ok(!hitsPad(pad, pad.x - 60, pad.y));
  assert.ok(!hitsPad(pad, 40, pad.y), 'the other corner is not the pad');
  const lh = thumbPadCircle(390, 844, true, { left: 10, bottom: 0 }, {});
  near(lh.x, 10 + PAD_MARGIN_PX + 32);
  near(lh.y, 844 - PAD_MARGIN_PX - 32);
  assert.ok(hitsPad(lh, 40, 800));
  assert.ok(!hitsPad(lh, 350, 800));
});

test('touch Overload button sits in the corner opposite the thumb pad', () => {
  const safe = { right: 0, bottom: 34, left: 0 };
  const pad = thumbPadCircle(390, 844, false, safe, {});
  const ov = overloadCircle(390, 844, false, safe, {});
  assert.equal(ov.r, OVERLOAD_BTN_PX / 2);
  assert.ok(ov.x < 195 && pad.x > 195, 'right-handed: pad right, Overload left');
  near(ov.y + ov.r, pad.y + pad.r, 1e-9, 'same bottom line');
  const lh = overloadCircle(390, 844, true, safe, {});
  assert.ok(lh.x > 195, 'left-handed: Overload moves right');
  assert.ok(!hitsPad(pad, ov.x, ov.y), 'the two never overlap');
});

test('arrow keys steer along the track for each mode', () => {
  assert.equal(keyAxis('bottom', true, false, false, false), -1);
  assert.equal(keyAxis('bottom', false, true, true, false), 1);
  assert.equal(keyAxis('bottom', false, false, true, false), 0);
  assert.equal(keyAxis('left', false, false, true, false), -1);
  assert.equal(keyAxis('left', false, false, false, true), 1);
  assert.equal(keyAxis('left', true, false, false, false), -1, 'left/right still work sideways');
  assert.equal(keyAxis('ring', false, true, false, false), 1);
});

// ------------------------------------------------------------------ tap vs hold presses

test('press state: a tap fires on release, a hold never fires, a press that mattered fires once', () => {
  const p = createPress();
  pressDown(p, 2, 1000);
  assert.equal(pressPending(p), true);
  assert.equal(pressDecide(p, false), false, 'nothing to act on at the press');
  assert.equal(pressPending(p), false);
  assert.equal(pressUp(p, 1120), true, '120 ms: a tap, the action fires on release');
  pressDown(p, 2, 2000);
  pressDecide(p, false);
  assert.equal(pressPull(p, 2100), false);
  assert.equal(pressPull(p, 2181), true, 'past 180 ms: Pull');
  assert.equal(pressUp(p, 2500), false, 'a hold is a pure Pull');
  pressDown(p, 2, 3000);
  assert.equal(pressDecide(p, true), true, 'it matters now: fire at the press');
  assert.equal(pressDecide(p, true), false, 'decided once');
  assert.equal(pressUp(p, 3050), false, 'and not again on release');
});

test('an action matters now only with a ball on the paddle or inside the perfect-hit window', () => {
  const paddle = { x: 360, y: 1000, w: 120, h: 16, angle: 0 };
  const ball = (o) => ({ alive: true, held: false, x: 360, y: 500, vx: 0, vy: 0, r: 9, lastPaddleMs: -1e9, ...o });
  const world = (balls, mode = 'bottom', time = 5000) => ({ paddle, balls, time, level: { mode } });
  assert.equal(actionMattersNow(world([ball({ held: true, y: 983 })])), true, 'held: launch or release');
  assert.equal(actionMattersNow(world([ball({ y: 500, vy: 600 })])), false, 'far away');
  const speed = 600;
  const within = ((PERFECT.WINDOW_MS - 10) / 1000) * speed; // units it covers in 50 ms
  assert.equal(actionMattersNow(world([ball({ y: 1000 - 8 - 9 - within, vy: speed })])), true, 'reaches the paddle inside the window');
  assert.equal(actionMattersNow(world([ball({ y: 1000 - 8 - 9 - within, vy: -speed })])), false, 'near but leaving');
  assert.equal(actionMattersNow(world([ball({ y: 1000 - 8 - 9 - 0.2 * speed, vy: speed })])), false, '200 ms away');
  assert.equal(actionMattersNow(world([ball({ y: 960, vy: -speed, lastPaddleMs: 4970 })])), true, 'just hit it: late perfect');
  assert.equal(actionMattersNow(world([ball({ x: 415, y: 975, vy: speed })])), true, 'the paddle end counts too');
  assert.equal(actionMattersNow(world([ball({ x: 480, y: 975, vy: speed })])), false, 'beside the paddle: a miss');
  assert.equal(actionMattersNow(world([ball({ alive: false, held: true })])), false, 'dead balls never');
  const side = { ...paddle, x: 40, y: 540 };
  const sideBall = ball({ x: 40 + 8 + 9 + within, y: 540, vx: -speed });
  assert.equal(actionMattersNow({ paddle: side, balls: [sideBall], time: 5000, level: { mode: 'left' } }), true, 'horizontal mode');
});

// The reviewer's case, through the real input.js and A's physics: lasers are up, a steering finger
// holds the paddle and a second finger holds for 500 ms (a Pull). No Laser shot may be spent.
function rig(o = {}) {
  const dom = installDom(400, 800);
  let clock = 1000;
  const input = createInput(dom.stage, dom.mapper, { now: () => clock });
  const { world, frame } = physicsWorld({ rules: { pull: true } });
  world.level.rules.pull = true;
  world.econ.heat = 60;
  world.effects.laserShots = 12;
  if (o.launch !== false) launchAt(world, 360, 300, 0, -SPEED.TIERS[0]);
  const rec = recorder(world);
  let fired = 0;
  const run = (ms) => {
    let pulled = false;
    for (let i = 0, n = Math.round(ms / SIM.DT_MS); i < n; i++) {
      clock += SIM.DT_MS;
      input.sample(frame, world);
      stepWorld(world, frame);
      clearEdges(frame);
      if (world.paddle.pulling) pulled = true;
    }
    fired += rec().filter((e) => e.type === EV.LASER_FIRED).length;
    return pulled;
  };
  return { ...dom, input, world, frame, run, shots: () => fired, done() { input.dispose(); removeDom(); } };
}

test('a second-finger hold is a pure Pull: lasers up, a 500 ms hold spends no shot', () => {
  const r = rig();
  try {
    r.fire('pointerdown', { pointerId: 1, clientX: 200, clientY: 700 }); // steering finger
    r.run(50);
    r.fire('pointerdown', { pointerId: 2, clientX: 300, clientY: 620 }); // second finger
    const pulled = r.run(500);
    r.fire('pointerup', { pointerId: 2, clientX: 300, clientY: 620 });
    r.run(100);
    assert.ok(pulled, 'the hold pulled');
    assert.equal(r.shots(), 0, 'no Laser shot spent');
    // a quick second-finger tap still fires one volley
    r.fire('pointerdown', { pointerId: 3, clientX: 300, clientY: 620 });
    r.run(100);
    r.fire('pointerup', { pointerId: 3, clientX: 300, clientY: 620 });
    r.run(50);
    assert.equal(r.shots(), 1, 'a tap is an action');
  } finally { r.done(); }
});

test('thumb pad and mouse follow the same rule: hold = Pull only, tap = action', () => {
  const r = rig();
  try {
    r.input.configure({ thumbPad: true });
    // the pad sits bottom-right: 400 - 20 - 32, 800 - 20 - 32
    r.fire('pointerdown', { pointerId: 5, clientX: 348, clientY: 748 });
    assert.ok(r.run(400), 'pad hold pulls');
    r.fire('pointerup', { pointerId: 5, clientX: 348, clientY: 748 });
    r.run(50);
    assert.equal(r.shots(), 0, 'pad hold spends nothing');
    r.fire('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 9, clientX: 200, clientY: 700 });
    assert.ok(r.run(400), 'left-button hold pulls');
    r.fire('pointerup', { pointerType: 'mouse', button: 0, pointerId: 9, clientX: 200, clientY: 700 });
    r.run(50);
    assert.equal(r.shots(), 0, 'left-button hold spends nothing');
    r.fire('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 9, clientX: 200, clientY: 700 });
    r.run(80);
    r.fire('pointerup', { pointerType: 'mouse', button: 0, pointerId: 9, clientX: 200, clientY: 700 });
    r.run(30);
    assert.equal(r.shots(), 1, 'a click fires');
  } finally { r.done(); }
});

test('touch Overload button stays clear of the paddle: the view gives up room under it when the tray is short', () => {
  // the reviewer's 390x664 (Safari with toolbars) on level 14: field y 61, scale 0.51, paddle lower edge y 577
  const rect = { x: 11, y: 61, w: 368, h: 551, scale: 0.51 };
  const clear = overloadClearY(rect);
  assert.equal(clear, 61 + 551 + 4, 'under the field (the kiln mouth under the paddle) by 4 px');
  const need = overloadTrayNeed(664, 0, clear);
  assert.ok(need > 0, 'the 56 px button does not fit under the field there');
  const c = overloadCircle(390, 664, false, { top: 0, right: 0, bottom: 0, left: 0 }, {});
  assert.ok(c.y - c.r < clear, 'as placed before, it sat in the field beside the paddle track');
  assert.equal(need, clear - (664 - PAD_MARGIN_PX - OVERLOAD_BTN_PX), 'the view gives up what the button needs');
  // a tall phone already has the room
  const tall = { x: 11, y: 149, w: 368, h: 546, scale: 0.51 };
  assert.equal(overloadTrayNeed(844, 0, overloadClearY(tall)), 0);
});

test('a key the menu consumed never reaches play: the Space that picks Resume does not launch', () => {
  const r = rig({ launch: false });
  try {
    const key = (type, code, prevented) => {
      const e = { code, repeat: false, defaultPrevented: !!prevented, preventDefault() { this.defaultPrevented = true; } };
      for (const fn of window.listeners[type] || []) fn(e);
      return e;
    };
    // the menu's listener runs first: it activates Resume (which enables input at once) and
    // prevents the key; input.js then sees the same keydown
    r.input.setEnabled(false);
    r.input.setEnabled(true);
    key('keydown', 'Space', true);
    r.input.sample(r.frame, r.world);
    assert.equal(r.frame.action, false, 'no action edge from a consumed Space');
    stepWorld(r.world, r.frame);
    clearEdges(r.frame);
    assert.equal(r.world.balls[0].held, true, 'the served ball stays on the paddle');
    key('keyup', 'Space', false);
    // an arrow the menu used to move its ring is not held afterwards either
    key('keydown', 'ArrowLeft', true);
    r.input.sample(r.frame, r.world);
    assert.equal(r.frame.axis, 0, 'consumed arrow does not steer');
    // a fresh Space in play is an action
    const e = key('keydown', 'Space', false);
    assert.equal(e.defaultPrevented, true, 'input keeps the page from scrolling');
    r.input.sample(r.frame, r.world);
    assert.equal(r.frame.action, true, 'a Space in play launches');
  } finally { r.done(); }
});

test('a press fires at once when it matters: the served ball launches before the finger lifts', () => {
  const r = rig({ launch: false });
  try {
    assert.ok(r.world.balls[0].held, 'serving');
    r.fire('pointerdown', { pointerId: 2, clientX: 200, clientY: 100 }); // one finger on the top 30%
    r.input.sample(r.frame, r.world);
    assert.equal(r.frame.action, true, 'action on the first step after the press');
    stepWorld(r.world, r.frame);
    clearEdges(r.frame);
    assert.equal(r.world.balls[0].held, false, 'launched while the finger is still down');
    r.fire('pointerup', { pointerId: 2, clientX: 200, clientY: 100 });
    r.input.sample(r.frame, r.world);
    assert.equal(r.frame.action, false, 'no second action on release');
  } finally { r.done(); }
});
