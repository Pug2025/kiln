// Kiln: the camera rig (OWNER: C). Fit from fit.js (pure maths), then the motion that makes the
// arena feel alive (ART 6): intro dolly 1.07 -> 1 over 1.6 s, lean toward the ball (x * 0.22,
// look x = lean * 0.35, roll up to about 0.7 degrees, smoothing min(1, dt * 1.8)), slow drift,
// shake 4 px / 200 ms on a lost ball, the last-brick zoom (fx.zoom on fx.zoomX/zoomY).
// Reduce motion: no dolly, lean, roll, drift, shake or zoom.

import * as THREE from 'three';
import { FIELD } from '../core/constants.js';
import { LOOK } from './look.js';
import { createPose, fitCamera, clamp } from './fit.js';
import { ceilingLayout } from './ceiling.js';

const easeOut = (k) => 1 - Math.pow(1 - k, 3);

export function createRig(camera) {
  const rest = createPose();
  const fit = { dist: 1800, look: -30, rect: { x: 0, y: 0, w: 0, h: 0, scale: 1 } };
  const fitOpts = { top: 0, bottom: 0, frame: ceilingLayout('ring', null) }; // reserves in CSS px
  const st = {
    lean: 0, roll: 0, dx: 0, dy: 0,
    introT: -1, intro: 1,
    shakeT: -1e9, shakeX: 0, shakeY: 0, seed: 1,
    zoom: 1, zx: 0, zy: 0,
    reduceMotion: false,
    W: 1, H: 1,
  };
  const target = new THREE.Vector3();

  function rand() {
    st.seed = (st.seed * 16807) % 2147483647;
    return st.seed / 2147483647;
  }

  return {
    fit,
    st,
    fitOpts,

    setWorld(world) {
      ceilingLayout(world.level.mode, world.field, fitOpts.frame);
    },

    /** Refit for a viewport in CSS pixels (between fitOpts.top and fitOpts.bottom, D's reserves). */
    resize(W, H) {
      st.W = W;
      st.H = H;
      fitCamera(W, H, rest, fit, fitOpts);
      camera.fov = rest.fov;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    },

    intro(t) {
      if (!st.reduceMotion) st.introT = t;
    },

    shake(t) {
      if (!st.reduceMotion) st.shakeT = t;
    },

    /**
     * @param {number} t renderer seconds
     * @param {number} dt real seconds
     * @param {number} ballX field x of the lead ball (or the paddle), for the lean
     * @param {{zoom:number, zoomX:number, zoomY:number}} fx
     */
    update(t, dt, ballX, fx) {
      const rm = st.reduceMotion;
      // intro dolly
      if (st.introT >= 0) {
        const k = Math.min(1, (t - st.introT) / LOOK.INTRO_S);
        st.intro = 1 + (LOOK.INTRO_DOLLY - 1) * (1 - easeOut(k));
        if (k >= 1) st.introT = -1;
      } else st.intro = 1;
      if (rm) st.intro = 1;

      // lean and roll toward the ball
      const bx = clamp(ballX - FIELD.W / 2, -340, 340);
      const ks = Math.min(1, dt * LOOK.LEAN_RATE);
      const leanT = rm ? 0 : bx * LOOK.LEAN;
      const rollT = rm ? 0 : -(bx / 340) * LOOK.ROLL;
      st.lean += (leanT - st.lean) * ks;
      st.roll += (rollT - st.roll) * ks;

      // drift
      st.dx = rm ? 0 : Math.sin(t * 0.21) * LOOK.DRIFT + Math.sin(t * 0.07) * 6;
      st.dy = rm ? 0 : Math.cos(t * 0.17) * 8;

      // shake (pixels converted to field units at the field plane)
      const ksh = (t - st.shakeT) / (LOOK.SHAKE_MS / 1000);
      if (!rm && ksh >= 0 && ksh < 1) {
        const amp = (LOOK.SHAKE_PX / Math.max(0.05, fit.rect.scale)) * (1 - ksh);
        st.shakeX = (rand() * 2 - 1) * amp;
        st.shakeY = (rand() * 2 - 1) * amp;
      } else {
        st.shakeX = 0;
        st.shakeY = 0;
      }

      // last-brick zoom toward the ball
      // (a dolly toward the focus that keeps the focus where it is on screen: everything scales
      // around the ball)
      const zt = rm ? 1 : Math.max(1, fx.zoom || 1);
      st.zoom += (zt - st.zoom) * Math.min(1, dt * 8);
      if (zt > 1) {
        st.zx = fx.zoomX - FIELD.W / 2 - fit.centreX;
        st.zy = FIELD.H / 2 - fx.zoomY;
      }
      const zf = 1 - 1 / st.zoom;

      const d = (fit.dist * st.intro) / st.zoom;
      const sx = st.dx + st.shakeX + st.zx * zf;
      const sy = st.dy + st.shakeY + st.zy * zf;
      camera.position.set(fit.centreX + st.lean * LOOK.LEAN_POS + sx, rest.py + sy, d);
      target.set(
        fit.centreX + st.lean * LOOK.LEAN_LOOK + st.dx * 0.3 + st.shakeX + st.zx * zf,
        fit.look + st.dy * 0.3 + st.shakeY + st.zy * zf,
        0,
      );
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      camera.rotateZ(st.roll);
      camera.updateMatrixWorld();
    },
  };
}
