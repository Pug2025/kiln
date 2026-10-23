import { test, assert, near } from './lib.mjs';
import { DROP, PADDLE } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { setPhase } from '../src/core/world.js';
import { fireLasers, LASER_SPEED } from '../src/sim/bodies.js';
import { modeCode, ringSpanFor, setTrack, paddleTrack, halfReach, toLocal } from '../src/sim/field.js';
import { LASER_MOUNT, laserMountPose, laserMountsActive, laserMuzzleFlash } from '../src/render/laser-mounts.js';
import { physicsWorld } from './fixtures/A/sim.mjs';
import { rig, level } from './fixtures/E/rig.mjs';

test('mounted Laser tips and directions coincide with actual emitted bolts for all modes and paddle sizes', () => {
  const pose = {}, loc = {};
  for (const mode of ['bottom', 'left', 'ring']) {
    for (const width of [PADDLE.W_SHRINK, PADDLE.W, PADDLE.W_WIDE]) {
      for (const angle of mode === 'ring' ? [-Math.PI, -2.1, -0.7, 0, 0.8, Math.PI / 2, 2.7] : [360]) {
        const { world: w, ctx } = physicsWorld({ mode });
        const p = w.paddle;
        p.w = width; p.span = ringSpanFor(width);
        setTrack(w, angle);
        const collider = [p.x, p.y, p.w, p.h, p.span];
        fireLasers(ctx);
        for (let k = 0; k < 2; k++) {
          const side = k === 0 ? -1 : 1, bolt = w.lasers[k];
          assert.ok(bolt.alive);
          assert.equal(laserMountPose(mode, p, side, pose), pose, 'writes the supplied scratch record');
          near(pose.x, bolt.x, 1e-9);
          near(pose.y, bolt.y, 1e-9);
          near(pose.nx, bolt.vx / LASER_SPEED, 1e-9);
          near(pose.ny, bolt.vy / LASER_SPEED, 1e-9);
          // A mount's local +Y points into the field after the scene's Y inversion.
          near(-Math.sin(pose.rotation), pose.nx, 1e-9);
          near(-Math.cos(pose.rotation), pose.ny, 1e-9);
          // The complete 14x22 housing stays within the existing paddle's tangential span.
          const c = Math.cos(pose.rotation), s = Math.sin(pose.rotation);
          for (const x of [-LASER_MOUNT.WIDTH / 2, LASER_MOUNT.WIDTH / 2]) {
            for (const y of [-LASER_MOUNT.LENGTH, 0]) {
              const fx = pose.x + c * x - s * y, fy = pose.y - s * x - c * y;
              toLocal(modeCode(mode), paddleTrack(modeCode(mode), p), fx, fy, loc);
              assert.ok(Math.abs(loc.u) < halfReach(modeCode(mode), p), `${mode}/${width}: housing stays inside paddle reach`);
            }
          }
        }
        assert.deepEqual([p.x, p.y, p.w, p.h, p.span], collider, 'presentation never changes paddle collision geometry');
      }
    }
  }
});

test('Laser hardware readiness follows real economy pickup, final shot, life loss and new-level state', () => {
  for (const mode of ['bottom', 'left', 'ring']) {
    const r = rig({ level: level({ mode }) }), w = r.world;
    assert.equal(laserMountsActive(w), false);
    r.emit(EV.DROP_CAUGHT, 0, w.paddle.x, w.paddle.y, DROP.LASER); r.step();
    assert.ok(w.effects.laserShots > 0 && laserMountsActive(w), 'pickup visibly arms in serve');
    setPhase(w, 'play');
    w.balls[0].alive = true; w.balls[0].held = true;
    assert.equal(laserMountsActive(w), true, 'held ball does not hide the ready equipment');
    while (w.effects.laserShots > 1) { r.emit(EV.LASER_FIRED); r.step(); }
    assert.equal(laserMountsActive(w), true, 'last remaining volley is still visibly armed');
    r.emit(EV.LASER_FIRED); r.step();
    assert.equal(laserMountsActive(w), false, 'no ready indicator remains after the last volley');
    r.emit(EV.DROP_CAUGHT, 0, w.paddle.x, w.paddle.y, DROP.LASER); r.step();
    assert.equal(laserMountsActive(w), true);
    r.emit(EV.OUT_OF_BALLS); r.step();
    assert.equal(laserMountsActive(w), false, 'life loss retracts hardware with the effect');
    const next = rig({ level: level({ n: 2, mode }), run: w.run });
    assert.equal(laserMountsActive(next.world), false, 'next level starts without stale equipment');
  }
});

test('muzzle flash is brief and event-timed, independent from the ready indicator', () => {
  assert.equal(laserMuzzleFlash(10, -1e9), 0, 'there is no startup flash');
  assert.equal(laserMuzzleFlash(10, 10), 1);
  near(laserMuzzleFlash(10.04, 10), 0.5, 1e-9);
  near(laserMuzzleFlash(10.08, 10), 0, 1e-9);
  assert.equal(laserMuzzleFlash(20, 10), 0);
  assert.equal(laserMuzzleFlash(9, 10), 0, 'a reset time does not replay an old flash');
});
