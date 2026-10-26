import { test, assert, near } from './lib.mjs';
import * as THREE from '../vendor/three/0.160.0/build/three.module.js';
import { BALL, FIELD, PADDLE, RING } from '../src/core/constants.js';
import { BALL_BLOOM, writeBallBloom, paddleBloomRadius } from '../src/render/ball-bloom.js';

const ball = (x = 360, y = 450) => ({ alive: true, held: false, sealed: -1, r: BALL.R, x, y, px: x - 20, py: y + 30 });
const world = (balls = [ball()]) => ({ boss: { active: true, id: 'core', phase: 1 }, balls });
function camera(width, height, lean = 0) {
  const cam = new THREE.PerspectiveCamera(35, width / height, 10, 8000);
  cam.position.set(lean * 55, 150 + lean * 20, 2400);
  cam.lookAt(lean * -10, -30, 0);
  cam.rotateZ(lean * .08);
  cam.updateMatrixWorld(true);
  return cam;
}
function clip(cam) { return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements; }
function projected(cam, x, y, width, height) {
  const p = new THREE.Vector3(x - FIELD.W / 2, FIELD.H / 2 - y, 0).project(cam);
  return [(p.x + 1) * width / 2, (p.y + 1) * height / 2];
}

test('bloom circles follow the drawn interpolated centre through real perspective, lean, viewport and DPR', () => {
  for (const [w, h] of [[1440, 900], [390, 844], [320, 568]]) for (const dpr of [1, 2, 3]) for (const lean of [-1, 0, 1]) {
    const cam = camera(w, h, lean), m = clip(cam), W = w * dpr, H = h * dpr;
    for (const alpha of [0, .37, 1]) {
      const b = ball(391, 608), out = new Float32Array(BALL.MAX * 4);
      assert.equal(writeBallBloom(out, world([b]), alpha, m, W, H), 1);
      const x = b.px + (b.x - b.px) * alpha, y = b.py + (b.y - b.py) * alpha;
      const c = projected(cam, x, y, W, H), ex = projected(cam, x + b.r, y, W, H), ey = projected(cam, x, y + b.r, W, H);
      const r = Math.max(Math.hypot(ex[0] - c[0], ex[1] - c[1]), Math.hypot(ey[0] - c[0], ey[1] - c[1]));
      near(out[0], c[0], .00025); near(out[1], c[1], .00025);
      near(out[2], r * BALL_BLOOM.INNER + BALL_BLOOM.FILTER_PAD, .0001);
      near(out[3], Math.max(1, r * BALL_BLOOM.FEATHER), .0001);
    }
  }
});

test('held balls use their actual latest position and enlarged balls scale the soft protection', () => {
  const cam = camera(390, 844), b = ball(), out = new Float32Array(8);
  b.held = true;
  const w = world([b]);
  writeBallBloom(out, w, .25, clip(cam), 780, 1688);
  const p = projected(cam, b.x, b.y, 780, 1688), small = out[2];
  near(out[0], p[0], .0001); near(out[1], p[1], .0001);
  b.r *= 2;
  writeBallBloom(out, w, .75, clip(cam), 780, 1688);
  assert.ok(out[2] - BALL_BLOOM.FILTER_PAD > (small - BALL_BLOOM.FILTER_PAD) * 1.99);
  assert.ok(out[2] - BALL_BLOOM.FILTER_PAD < (small - BALL_BLOOM.FILTER_PAD) * 2.01);
});

test('tight ball guards contain the complete projected sphere and thin rim, including off-axis perspective', () => {
  for (const [W, H] of [[640, 1136], [780, 1688], [2560, 1600]]) for (const lean of [-1, 0, 1]) {
    const cam = camera(W, H, lean), m = clip(cam), out = new Float32Array(4);
    for (const [x, y] of [[45, 130], [360, 540], [680, 1000]]) for (const r of [BALL.R, BALL.R * 2]) {
      const b = { ...ball(x, y), held: true, r };
      writeBallBloom(out, world([b]), .5, m, W, H);
      for (let lat = 0; lat <= 16; lat++) for (let lon = 0; lon < 32; lon++) {
        const a = lat * Math.PI / 16, t = lon * Math.PI / 16;
        const rimR = r * 1.5;
        const point = new THREE.Vector3(x - FIELD.W / 2 + rimR * Math.sin(a) * Math.cos(t),
          FIELD.H / 2 - y + rimR * Math.cos(a), rimR * Math.sin(a) * Math.sin(t)).project(cam);
        const distance = Math.hypot((point.x + 1) * W / 2 - out[0], (point.y + 1) * H / 2 - out[1]);
        assert.ok(distance < out[2], 'sphere and maximum thin rim remain inside zero bloom');
      }
      assert.ok(out[3] < out[2], 'feather stays local instead of creating the old broad suppression valley');
    }
  }
});

test('projected paddle bounds cover actual bar and bent arc vertices through cosmetic lean and depth', () => {
  for (const [W, H] of [[640, 1136], [780, 1688], [2560, 1600]]) for (const lean of [-1, 0, 1]) {
    const cam = camera(W, H, lean), m = clip(cam);
    for (const mode of ['bottom', 'left', 'ring']) for (const width of [80, 120, 180, 210]) {
      for (const angle of mode === 'ring' ? [0, Math.PI / 3, Math.PI / 2, Math.PI, Math.PI * 1.5] : [0]) {
        const p = { x: mode === 'ring' ? RING.CX + Math.cos(angle) * RING.R_PADDLE : mode === 'left' ? 40 : 360,
          y: mode === 'ring' ? RING.CY + Math.sin(angle) * RING.R_PADDLE : mode === 'left' ? 540 : 1000,
          h: PADDLE.H, w: width, angle, span: width / 120 * RING.SPAN_DEG * Math.PI / 180 };
        const rotation = (mode === 'left' ? -Math.PI / 2 : mode === 'ring' ? Math.PI / 2 - angle : 0) + lean * .04;
        const span = p.span, half = width / 2;
        const a = mode === 'ring' ? projected(cam, RING.CX + Math.cos(p.angle - span / 2) * RING.R_PADDLE,
          RING.CY + Math.sin(p.angle - span / 2) * RING.R_PADDLE, W, H)
          : projected(cam, p.x - (mode === 'left' ? 0 : half), p.y - (mode === 'left' ? half : 0), W, H);
        const b = mode === 'ring' ? projected(cam, RING.CX + Math.cos(p.angle + span / 2) * RING.R_PADDLE,
          RING.CY + Math.sin(p.angle + span / 2) * RING.R_PADDLE, W, H)
          : projected(cam, p.x + (mode === 'left' ? 0 : half), p.y + (mode === 'left' ? half : 0), W, H);
        const radius = paddleBloomRadius(p, mode, rotation, m, W, H, ...a, ...b);
        const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
        // Real actor boxes: arc x is a unit parameter bent by the shader; y/z are dimensions.
        for (let i = 0; i <= 64; i++) for (const y of [-PADDLE.H / 2, PADDLE.H / 2 + 1.9]) for (const z of [-11, 11.5]) {
          let x = (i / 64 - .5) * width, yy = y;
          if (mode === 'ring') { const th = (i / 64 - .5) * span; x = (RING.R_PADDLE - y) * Math.sin(th); yy = RING.R_PADDLE - (RING.R_PADDLE - y) * Math.cos(th); }
          const v = new THREE.Vector3(p.x - FIELD.W / 2 + x * Math.cos(rotation) - yy * Math.sin(rotation),
            FIELD.H / 2 - p.y + x * Math.sin(rotation) + yy * Math.cos(rotation), z).project(cam);
          const px = (v.x + 1) * W / 2, py = (v.y + 1) * H / 2;
          const k = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / length2));
          assert.ok(Math.hypot(px - a[0] - k * dx, py - a[1] - k * dy) < radius - 1,
            `${mode}: native mesh point lies within the zero-bloom capsule`);
        }
      }
    }
  }
});

test('all twelve visible ball slots compact safely and stale masks clear on death, sealing and reuse', () => {
  const cam = camera(390, 844), m = clip(cam), balls = Array.from({ length: BALL.MAX + 1 }, (_, i) => ball(40 + i * 50, 400));
  const w = world(balls), out = new Float32Array(BALL.MAX * 4);
  assert.equal(writeBallBloom(out, w, 1, m, 780, 1688), BALL.MAX);
  balls[0].alive = false; balls[1].sealed = 4; balls[2].r = 0;
  assert.equal(writeBallBloom(out, w, 1, m, 780, 1688), BALL.MAX - 2);
  const p = projected(cam, balls[3].x, balls[3].y, 780, 1688);
  near(out[0], p[0], .0001); near(out[1], p[1], .0001);
  assert.ok(Array.from(out.slice((BALL.MAX - 2) * 4)).every(v => v === 0));
  for (const b of balls) b.alive = false;
  assert.equal(writeBallBloom(out, w, .5, m, 780, 1688), 0);
  assert.ok(out.every(v => v === 0));
  balls[8] = ball(200, 200);
  assert.equal(writeBallBloom(out, w, .5, m, 780, 1688), 1);
});

test('ordinary worlds and every boss mode share geometry, while Lite and menus clear the fixed pool', () => {
  const cam = camera(320, 568), m = clip(cam), w = world(), out = new Float32Array(BALL.MAX * 4);
  writeBallBloom(out, w, .5, m, 640, 1136);
  const original = Array.from(out);
  for (const id of ['stoker', 'crucible', 'core']) for (const phase of [1, 2, 3]) for (const mode of ['bottom', 'left', 'ring']) {
    w.boss.id = id; w.boss.phase = phase; w.level = { mode };
    assert.equal(writeBallBloom(out, w, .5, m, 640, 1136), 1);
    assert.deepEqual(Array.from(out), original);
  }
  assert.equal(writeBallBloom(out, w, .5, m, 640, 1136, false), 0);
  assert.ok(out.every(v => v === 0));
  assert.equal(writeBallBloom(out, w, .5, m, 640, 1136, true), 1);
  w.boss.active = false;
  assert.equal(writeBallBloom(out, w, .5, m, 640, 1136), 1);
  assert.deepEqual(Array.from(out), original);
  delete w.boss;
  assert.equal(writeBallBloom(out, w, .5, m, 640, 1136), 1);
  assert.deepEqual(Array.from(out), original);
  assert.equal(writeBallBloom(out, w, .5, m, 640, 1136, false), 0);
  assert.ok(out.every(v => v === 0));
});

test('mask updates preserve simulation, heat and the supplied pool, and reject a camera behind the ball', () => {
  const cam = camera(390, 844), w = world(), out = new Float32Array(BALL.MAX * 4), identity = out;
  w.boss.heat = 1.28;
  const before = JSON.stringify(w);
  for (let i = 0; i < 12; i++) writeBallBloom(out, w, i / 12, clip(cam), 780, 1688);
  assert.equal(out, identity); assert.equal(JSON.stringify(w), before);
  cam.position.set(0, 0, -100); cam.lookAt(0, 0, -200); cam.updateMatrixWorld(true);
  assert.equal(writeBallBloom(out, w, .5, clip(cam), 780, 1688), 0);
  assert.ok(out.every(v => v === 0));
});
