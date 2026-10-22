// Kiln: input (OWNER: D). Pointer Events, touch, keyboard and the thumb pad, sampled into one
// InputFrame per sim step. The maths lives in gestures.js (pure, tested in Node).
//
// Contract (src/core/types.js → Input):
//   createInput(target, mapper, opts) → Input
//     target: the element that receives pointers (the stage)
//     mapper: { screenToField(clientX, clientY, out) → boolean } (the renderer)
//     opts:   { onCommand(name) } for 'fullscreen' (F) and 'mute' (M), which work everywhere
//   sample(frame, world)  fill the frame for the NEXT sim step. Edges (action, overload) are
//                         delivered once; steering targets are field units with the relative grab.
//   setEnabled(on), onPause(fn(reason)), configure({leftHanded, thumbPad}), dispose()
//
// Controls (PLAN §5):
//   mouse   1:1 absolute; left click = action; hold left past 180 ms or hold right = Pull
//   keys    Space action · Shift Pull (with an arrow held, Shift = fast arrows instead) ·
//           arrows 900 u/s, Shift 1500 · Q/E Overload · P/Esc pause · F fullscreen · M mute
//   touch   one finger on the lower 70% steers with a relative grab; a quick one-finger tap
//           (≤180 ms, barely moved) = action. Second finger (or one finger on the top 30%):
//           tap (≤180 ms) = action, hold = Pull.
//           Thumb pad (64 px, bottom-right, left-handed mirrors it): same as the second finger.
//   A tap/hold press (second finger, top, pad, mouse left) fires its action on press only when the
//   action matters then (a ball on the paddle, or one inside the perfect-hit window: gestures.js
//   actionMattersNow); otherwise on release if it was a tap. A hold is a pure Pull: it never spends
//   a Laser shot or releases a caught ball.
//           Overload: a 56 px button in the other bottom corner, shown from the Overload level
//           on touch screens (setOverload), lit when HEAT allows (D call: PLAN §5 has no touch
//           gesture for Overloads).
// Auto-pause on hide, window blur and pointercancel of one of our pointers (iOS system gestures).

import {
  createGrab, beginGrab, endGrab, grabTarget, paddleLimits, classifyPress,
  withinTapSlop, inSteerArea, thumbPadCircle, overloadCircle, hitsPad, keyAxis,
  createPress, pressDown, pressPending, pressDecide, pressUp, pressPull, pressCancel, actionMattersNow,
} from './gestures.js';
import { readSafeArea } from '../app/safe-area.js';

/**
 * @param {HTMLElement} target
 * @param {{screenToField(x:number, y:number, out:{x:number,y:number}):boolean}} mapper
 * @param {{onCommand?:(name:string)=>void, now?:()=>number}} [opts]
 * @returns {import('../core/types.js').Input}
 */
export function createInput(target, mapper, opts = {}) {
  const onCommand = opts.onCommand || (() => {});
  const now = opts.now || (() => performance.now());
  const pt = { x: 0, y: 0 };
  const grab = createGrab();
  const limits = { axis: 'x', min: 0, max: 0 };
  const tgt = { tx: 0, ty: 0 };
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const pad = { x: 0, y: 0, r: 32 };
  const cfg = { leftHanded: false, thumbPad: false };

  let enabled = true;
  let pauseFn = () => {};
  const steer = { id: -1, has: false, fx: 0, fy: 0, downAt: 0, downX: 0, downY: 0, moved: false };
  const second = createPress();   // second finger, or one finger on the top 30%
  const padPress = createPress(); // thumb pad
  const mouseLeft = createPress();
  const presses = [second, padPress, mouseLeft];
  const mouse = { seen: false, mx: 0, my: 0, right: false };
  const keys = { left: false, right: false, up: false, down: false, shift: false };
  const edge = { action: false, overload: false };

  const padEl = document.createElement('div');
  padEl.className = 'thumbpad';
  padEl.setAttribute('aria-hidden', 'true');
  padEl.hidden = true;
  document.body.appendChild(padEl);
  // touch Overload button: shown from the Overload level on coarse pointers; lit when HEAT allows
  const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
  const ov = { x: 0, y: 0, r: 28, state: 0, label: '' };
  const ovEl = document.createElement('div');
  ovEl.className = 'overload-btn';
  ovEl.setAttribute('aria-hidden', 'true');
  ovEl.hidden = true;
  const ovLabel = document.createElement('span');
  ovEl.appendChild(ovLabel);
  document.body.appendChild(ovEl);

  function ovShown() {
    return ov.state > 0 && enabled && coarse.matches;
  }

  function placePad() {
    readSafeArea(safe);
    thumbPadCircle(window.innerWidth, window.innerHeight, cfg.leftHanded, safe, pad);
    padEl.style.transform = `translate(${pad.x - pad.r}px, ${pad.y - pad.r}px)`;
    padEl.hidden = !(cfg.thumbPad && enabled);
    overloadCircle(window.innerWidth, window.innerHeight, cfg.leftHanded, safe, ov);
    ovEl.style.transform = `translate(${ov.x - ov.r}px, ${ov.y - ov.r}px)`;
    ovEl.hidden = !ovShown();
  }

  function releaseAll() {
    steer.id = -1;
    steer.has = false;
    for (const p of presses) pressCancel(p);
    padEl.classList.remove('down');
    mouse.right = false;
    keys.left = keys.right = keys.up = keys.down = keys.shift = false;
    edge.action = false;
    edge.overload = false;
    endGrab(grab);
  }

  function onDown(e) {
    if (!enabled) return;
    const t = now();
    if (e.pointerType === 'mouse') {
      e.preventDefault();
      if (mapper.screenToField(e.clientX, e.clientY, pt)) { mouse.mx = pt.x; mouse.my = pt.y; mouse.seen = true; }
      if (e.button === 0) pressDown(mouseLeft, 1, t);
      else if (e.button === 2) mouse.right = true;
      return;
    }
    e.preventDefault();
    mouse.seen = false; // a touch takes over from any earlier mouse position
    try { target.setPointerCapture(e.pointerId); } catch { /* not capturable: window listeners still see it */ }
    if (ovShown() && hitsPad(ov, e.clientX, e.clientY, 8)) {
      edge.overload = true;
      return;
    }
    if (cfg.thumbPad && padPress.id === -1 && hitsPad(pad, e.clientX, e.clientY)) {
      pressDown(padPress, e.pointerId, t);
      padEl.classList.add('down');
      return;
    }
    if (steer.id === -1 && inSteerArea(e.clientY, window.innerHeight)) {
      steer.id = e.pointerId;
      steer.downAt = t;
      steer.downX = e.clientX;
      steer.downY = e.clientY;
      steer.moved = false;
      steer.has = mapper.screenToField(e.clientX, e.clientY, pt);
      steer.fx = pt.x;
      steer.fy = pt.y;
      endGrab(grab); // the offset is taken against the paddle at the next sample
      return;
    }
    if (second.id === -1) pressDown(second, e.pointerId, t);
  }

  function onMove(e) {
    if (e.pointerType === 'mouse') {
      if (mapper.screenToField(e.clientX, e.clientY, pt)) {
        mouse.mx = pt.x;
        mouse.my = pt.y;
        if (enabled) mouse.seen = true;
      }
      return;
    }
    if (e.pointerId !== steer.id) return;
    if (mapper.screenToField(e.clientX, e.clientY, pt)) {
      steer.fx = pt.x;
      steer.fy = pt.y;
      steer.has = true;
    }
    if (!steer.moved && !withinTapSlop(e.clientX - steer.downX, e.clientY - steer.downY)) steer.moved = true;
  }

  function onUp(e) {
    const t = now();
    if (e.pointerType === 'mouse') {
      if (e.button === 0) { if (pressUp(mouseLeft, t) && enabled) edge.action = true; }
      else if (e.button === 2) mouse.right = false;
      return;
    }
    if (e.pointerId === steer.id) {
      if (enabled && !steer.moved && second.id === -1 && classifyPress(t - steer.downAt) === 'tap') edge.action = true;
      steer.id = -1;
      steer.has = false;
      endGrab(grab);
    } else if (e.pointerId === second.id) {
      if (pressUp(second, t) && enabled) edge.action = true;
    } else if (e.pointerId === padPress.id) {
      if (pressUp(padPress, t) && enabled) edge.action = true;
      padEl.classList.remove('down');
    }
  }

  function onCancel(e) {
    const ours = e.pointerId === steer.id || e.pointerId === second.id || e.pointerId === padPress.id;
    if (!ours) return;
    releaseAll();
    if (enabled) pauseFn('pointercancel'); // iOS system gestures: a pause, not a lost finger
  }

  function setHeld(code, v) {
    switch (code) {
      case 'ArrowLeft': keys.left = v; return true;
      case 'ArrowRight': keys.right = v; return true;
      case 'ArrowUp': keys.up = v; return true;
      case 'ArrowDown': keys.down = v; return true;
      case 'ShiftLeft': case 'ShiftRight': keys.shift = v; return true;
      default: return false;
    }
  }

  function onKey(e, down) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // A key the menus already used (ui.js prevents every key it handles) is theirs: the Space that
    // picks Resume or Next enables input on the same event and must not also launch the ball.
    // Key-ups always pass, so a held key is never left stuck.
    if (down && e.defaultPrevented) return;
    const c = e.code;
    if (c === 'KeyF' || c === 'KeyM') {
      if (down && !e.repeat) onCommand(c === 'KeyF' ? 'fullscreen' : 'mute');
      return;
    }
    // held keys: while disabled (menus) they can only be let go, never pressed
    if (setHeld(c, down && enabled)) {
      if (enabled) e.preventDefault();
      return;
    }
    if (!enabled) return; // menus handle their own keys
    switch (c) {
      case 'Space': if (down && !e.repeat) edge.action = true; break;
      case 'KeyQ': case 'KeyE': if (down && !e.repeat) edge.overload = true; break;
      case 'KeyP': case 'Escape': if (down && !e.repeat) pauseFn('user'); break;
      default: return;
    }
    e.preventDefault();
  }

  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  const noMenu = (e) => e.preventDefault();
  // Gesture suppression: no scroll, pinch, double-tap zoom, pull-to-refresh or callouts.
  // Elements marked .scroll (long lists in small panels) keep their own scrolling.
  const noTouchMove = (e) => { if (!(e.target instanceof Element && e.target.closest('.scroll'))) e.preventDefault(); };
  const noGesture = (e) => e.preventDefault();
  const onVis = () => { if (document.hidden) { releaseAll(); if (enabled) pauseFn('hidden'); } };
  const onBlur = () => { releaseAll(); if (enabled) pauseFn('blur'); };
  const onResize = () => placePad();

  target.addEventListener('pointerdown', onDown, { passive: false });
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  target.addEventListener('contextmenu', noMenu);
  target.addEventListener('touchstart', noGesture, { passive: false });
  document.addEventListener('touchmove', noTouchMove, { passive: false });
  document.addEventListener('gesturestart', noGesture, { passive: false });
  document.addEventListener('dblclick', noGesture, { passive: false });
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', onResize);
  placePad();

  return {
    sample(frame, world) {
      const t = now();
      const p = world.paddle;
      const mode = world.level.mode;
      if (!enabled) {
        frame.steer = false;
        frame.axis = 0;
        frame.fast = false;
        frame.pull = false;
        return;
      }
      if (steer.id !== -1 && steer.has) {
        if (!grab.active) beginGrab(grab, steer.fx, steer.fy, p.x, p.y);
        paddleLimits(mode, p.w, limits);
        grabTarget(grab, steer.fx, steer.fy, limits, tgt);
        frame.steer = true;
        frame.tx = tgt.tx;
        frame.ty = tgt.ty;
      } else if (mouse.seen) {
        frame.steer = true;
        frame.tx = mouse.mx;
        frame.ty = mouse.my;
      } else frame.steer = false;
      const ax = keyAxis(mode, keys.left, keys.right, keys.up, keys.down);
      frame.axis = ax;
      if (ax !== 0) { frame.steer = false; mouse.seen = false; } // keys take over until the mouse moves
      frame.fast = keys.shift && ax !== 0;
      // a new tap/hold press: fire now only if the action matters at this moment
      if (pressPending(second) || pressPending(padPress) || pressPending(mouseLeft)) {
        const matters = actionMattersNow(world);
        for (let i = 0; i < presses.length; i++) if (pressDecide(presses[i], matters)) edge.action = true;
      }
      const held = pressPull(second, t) || pressPull(padPress, t) || pressPull(mouseLeft, t);
      frame.pull = held || mouse.right || (keys.shift && ax === 0);
      frame.action = frame.action || edge.action;
      frame.overload = frame.overload || edge.overload;
      edge.action = false;
      edge.overload = false;
    },
    setEnabled(on) {
      const was = enabled;
      enabled = !!on;
      if (was !== enabled) releaseAll();
      padEl.hidden = !(cfg.thumbPad && enabled);
      ovEl.hidden = !ovShown();
    },
    /**
     * Touch Overload button: 0 hidden, 1 shown (not enough HEAT), 2 ready. Call on change only.
     * @param {number} state
     * @param {string} [label]  the equipped Overload's name
     */
    setOverload(state, label = '') {
      ov.state = state | 0;
      if (label !== ov.label) { ov.label = label; ovLabel.textContent = label; }
      ovEl.classList.toggle('ready', ov.state === 2);
      ovEl.hidden = !ovShown();
    },
    onPause(fn) {
      pauseFn = fn;
    },
    configure(o = {}) {
      if (o.leftHanded !== undefined) cfg.leftHanded = !!o.leftHanded;
      if (o.thumbPad !== undefined) cfg.thumbPad = !!o.thumbPad;
      placePad();
    },
    dispose() {
      target.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      target.removeEventListener('contextmenu', noMenu);
      target.removeEventListener('touchstart', noGesture);
      document.removeEventListener('touchmove', noTouchMove);
      document.removeEventListener('gesturestart', noGesture);
      document.removeEventListener('dblclick', noGesture);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      padEl.remove();
      ovEl.remove();
    },
  };
}
