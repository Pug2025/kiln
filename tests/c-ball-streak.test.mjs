import { register } from 'node:module';
import { test, assert, near } from './lib.mjs';
import * as THREE from '../vendor/three/0.160.0/build/three.module.js';
import { BALL, FIELD, SPEED } from '../src/core/constants.js';

// Exercise real pooled Three objects without a canvas or WebGL context.
const threeURL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const { BALL_STREAK, ballStreakPose, createBallStreaks } = await import('../src/render/trail.js');
const ball = (props = {}) => ({ alive: true, held: false, sealed: -1, r: BALL.R,
  px: 300, py: 400, x: 320, y: 420, vx: 300, vy: 400, boostMs: 0, ...props });

test('speed streak follows the interpolated rear edge in every travel direction, including larger balls', () => {
  const pose = {};
  for (const [vx, vy] of [[460, 0], [-460, 0], [0, 460], [0, -460], [300, 400], [-300, -400]]) {
    for (const alpha of [0, .37, 1]) for (const r of [BALL.R, 16]) {
      const b = ball({ vx, vy, r }), speed = Math.hypot(vx, vy);
      assert.equal(ballStreakPose(b, alpha, pose), true);
      const headX = pose.x + Math.cos(pose.rotation) * pose.length / 2;
      const headY = pose.y + Math.sin(pose.rotation) * pose.length / 2;
      near(headX, b.px + (b.x - b.px) * alpha - FIELD.W / 2 - vx / speed * r);
      near(headY, FIELD.H / 2 - b.py - (b.y - b.py) * alpha + vy / speed * r);
    }
  }
});

test('speed streak length reflects real speed and a temporary boost without changing simulation', () => {
  const pose = {};
  for (const speed of SPEED.TIERS) {
    const b = ball({ vx: speed, vy: 0 }), before = JSON.stringify(b);
    ballStreakPose(b, .5, pose);
    near(pose.length, 30 + .04 * speed);
    assert.ok(pose.length >= 48 && pose.length <= 61, `${speed}: ordinary speed range`);
    assert.equal(JSON.stringify(b), before);
    b.boostMs = 1;
    ballStreakPose(b, .5, pose);
    near(pose.length, Math.min(64, (30 + .04 * speed) * 1.15));
    b.boostMs = 0;
    ballStreakPose(b, .5, pose);
    near(pose.length, 30 + .04 * speed);
  }
});

test('streak pose rejects dead, held, sealed and stationary balls and turns without a stale path', () => {
  const pose = {};
  for (const props of [{ alive: false }, { held: true }, { sealed: 0 }, { vx: 0, vy: 0 }, { vx: NaN }, { x: Infinity }, { py: NaN }, { r: 0 }, { r: Infinity }]) {
    assert.equal(ballStreakPose(ball(props), .5, pose), false);
  }
  assert.equal(ballStreakPose(undefined, .5, pose), false);
  assert.equal(ballStreakPose(ball(), NaN, pose), false);
  assert.equal(ballStreakPose(ball(), Infinity, pose), false);
  const b = ball();
  ballStreakPose(b, .5, pose);
  const old = pose.rotation;
  b.vx = -b.vx; b.vy = -b.vy;
  b.px = b.x = 650; b.py = b.y = 900;
  ballStreakPose(b, 1, pose);
  near(Math.abs(pose.rotation - old), Math.PI);
  assert.ok(pose.x > b.x - FIELD.W / 2, 'teleport draws only behind the new velocity');
});

test('real streak pool caps twelve balls, compacts removals and clears on Fire, reset and empty worlds', () => {
  const scene = new THREE.Scene(), streaks = createBallStreaks(scene);
  const mesh = scene.getObjectByName('ball-speed-streaks');
  const world = { effects: { fire: false }, balls: Array.from({ length: BALL.MAX + 2 }, () => ball()) };
  const matrix = new THREE.Matrix4(), pos = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  const backing = mesh.instanceMatrix.array, before = JSON.stringify(world);
  streaks.frame(world, .37);
  assert.equal(mesh.count, BALL.MAX);
  mesh.getMatrixAt(0, matrix); matrix.decompose(pos, rotation, scale);
  near(scale.x, 50, .00001); near(scale.y, 6, .00001); near(pos.z, -1);
  assert.equal(mesh.material.blending, THREE.NormalBlending, 'normal blending avoids an additive glow layer');
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(mesh.material.uniforms.uOpacity.value, BALL_STREAK.OPACITY);
  assert.equal(JSON.stringify(world), before);
  world.balls[0].held = true; world.balls[1].alive = false; world.balls[2].sealed = 4;
  streaks.frame(world, .5);
  assert.equal(mesh.count, BALL.MAX - 1);
  world.effects.fire = true; streaks.frame(world, .5);
  assert.equal(mesh.count, 0, 'the existing Fire ribbon owns Fire balls');
  world.effects.fire = false; streaks.frame(world, .5);
  assert.equal(mesh.count, BALL.MAX - 1);
  streaks.reset(); assert.equal(mesh.count, 0);
  world.balls.length = 0; streaks.frame(world, 1); assert.equal(mesh.count, 0);
  assert.equal(mesh.instanceMatrix.array, backing, 'all updates reuse the fixed backing buffer');
});


test('ordinary streak stays bounded at Slow and boost extremes and prepares every existing compiled variant', () => {
  const pose = {}, b = ball({ vx: 1e8, vy: 0, boostMs: 1 });
  ballStreakPose(b, 1, pose); near(pose.length, 64);
  b.vx = SPEED.TIERS[0] * .5; b.boostMs = 0;
  ballStreakPose(b, 1, pose); near(pose.length, 30 + .04 * b.vx);
  const scene = new THREE.Scene(), streaks = createBallStreaks(scene);
  const material = scene.getObjectByName('ball-speed-streaks').material;
  let active, calls = [];
  const gl = { properties: { get(m) { assert.equal(m, material); return { programs: active }; } } };
  const program = name => ({ getUniforms() { calls.push(name + ':uniforms'); }, getAttributes() { calls.push(name + ':attributes'); } });
  streaks.warmPrograms(gl); assert.deepEqual(calls, [], 'missing maps need no readiness flag');
  active = new Map([['canvas', program('canvas')], ['linear', program('linear')]]);
  streaks.warmPrograms(gl);
  assert.deepEqual(calls, ['canvas:uniforms', 'canvas:attributes', 'linear:uniforms', 'linear:attributes']);
  calls.length = 0; active = new Map([['restored', program('restored')]]);
  streaks.warmPrograms(gl);
  assert.deepEqual(calls, ['restored:uniforms', 'restored:attributes'], 'context-replacement map is prepared');
  assert.equal(scene.getObjectByName('ball-speed-streaks').count, 0, 'warm-up does not draw or launch a ball');
});
