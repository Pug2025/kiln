// Kiln: the interface (OWNER: D). The HUD on the world (hud.js, content layer, R18) and every
// screen on the glass layer (screens/*.js, R7–R12).
//
// Contract (src/core/types.js → UI):
//   createUI(root, ctx) → UI
//   show(name, data)  a glass screen ('title' 'map' 'forge' 'settings' 'pause' 'results' 'credits'
//                     'pick' 'gate'), the level card overlay ('card'), or null (live play: HUD only)
//   hud(world)        per frame; touches the DOM only when a shown value changed
//   layout(rect)      the field's screen rect from renderer.fieldRect(); the HUD is glued to it
//   toast(text)       short line, e.g. "Updated" after a new build (main keeps it out of live play)
// ctx (from main.js): { reduceMotion(): boolean, sound(name), onPause(), onMute() }
// Screens get `data` with plain values and callbacks; they never touch world state.
// In-game text is short: labels and facts, said once. Hints give information, never instructions.

import { createHud } from './hud.js';
import { hudLayout, hudReserve, cardCentre } from './layout.js';
import { createNav } from './nav.js';
import { readSafeArea } from '../app/safe-area.js';
import { SCREENS } from './screens/index.js';

const EXIT_MS = 120;
const ENTER_MS = 180;

/**
 * @param {HTMLElement} root
 * @param {{reduceMotion?:() => boolean}} [ctx]
 * @returns {import('../core/types.js').UI & {current:string|null, card(data:object|null):void, setHudVisible(on:boolean):void, refresh():void}}
 */
export function createUI(root, ctx = {}) {
  const reduceMotion = ctx.reduceMotion || (() => false);
  /** Menu sounds (E's audio.ui): 'pick' on a move, 'click' / 'confirm' / 'back' / 'deny' on a choice. */
  const sound = (name) => { try { if (ctx.sound) ctx.sound(name); } catch { /* sound is optional */ } };
  const hud = createHud(root, {
    onPause: () => ctx.onPause && ctx.onPause(),
    onMute: () => ctx.onMute && ctx.onMute(),
  });
  const layer = document.createElement('div');
  layer.className = 'screens';
  root.appendChild(layer);
  const cardLayer = document.createElement('div');
  cardLayer.className = 'cards';
  root.appendChild(cardLayer);
  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.setAttribute('role', 'status');
  root.appendChild(toastEl);

  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const L = {};
  const fieldRect = { x: 0, y: 0, w: 0, h: 0, scale: 1 };
  /** @type {{name:string, el:HTMLElement, nav:any, onBack?:Function, dispose?:Function, keys?:Function}|null} */
  let cur = null;
  let card = null;
  let toastTimer = 0;
  let hudWanted = false;

  function updateHudVisibility() {
    hud.setVisible(hudWanted && !cur);
  }

  function closeCurrent() {
    if (!cur) return;
    const old = cur;
    cur = null;
    old.el.classList.remove('in');
    old.el.classList.add('out');
    old.el.inert = true;
    old.nav.dispose();
    if (old.dispose) old.dispose();
    setTimeout(() => old.el.remove(), EXIT_MS);
  }

  function mount(name, data) {
    const build = SCREENS[name];
    if (!build) throw new Error(`ui.show: unknown screen "${name}"`);
    const el = document.createElement('div');
    el.className = `screen screen-${name}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', name);
    const nav = createNav(el, { reduceMotion, sound });
    const scr = build(data || {}, { el, nav, safe, fieldRect, reduceMotion, sound }) || {};
    layer.appendChild(el);
    cur = { name, el, nav, onBack: scr.onBack, dispose: scr.dispose, keys: scr.keys, api: scr };
    if (nav.count) nav.select(Math.min(nav.count - 1, scr.initial || 0), 'init');
    requestAnimationFrame(() => {
      el.classList.add('in');
      setTimeout(() => { if (cur && cur.el === el) nav.refresh(); }, ENTER_MS + 20);
    });
  }

  function onKey(e) {
    if (!cur || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (cur.keys && cur.keys(e)) { e.preventDefault(); return; }
    switch (e.code) {
      case 'ArrowUp': cur.nav.move(0, -1); break;
      case 'ArrowDown': cur.nav.move(0, 1); break;
      case 'ArrowLeft': cur.nav.move(-1, 0); break;
      case 'ArrowRight': cur.nav.move(1, 0); break;
      case 'Enter': case 'NumpadEnter': case 'Space':
        if (!e.repeat) cur.nav.activate();
        break;
      case 'Escape': case 'Backspace':
        if (!e.repeat && cur.onBack) { sound('back'); cur.onBack(); }
        break;
      default: return;
    }
    e.preventDefault();
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => { if (cur) cur.nav.refresh(); });
  layer.addEventListener('scroll', () => { if (cur) cur.nav.refresh(); }, true);

  const api = {
    get current() { return cur ? cur.name : null; },

    /** What the current screen's builder returned (e.g. the title's late flame mount). */
    screenApi() { return cur ? cur.api : null; },

    show(name, data) {
      if (name === 'card') { api.card(data); return; }
      closeCurrent();
      if (name) {
        api.card(null);
        mount(name, data);
      }
      updateHudVisibility();
    },

    /** The level card: a glass overlay over the live world that never takes input. */
    card(data) {
      if (card) {
        const old = card;
        card = null;
        old.classList.remove('in');
        old.classList.add('out');
        setTimeout(() => old.remove(), EXIT_MS);
      }
      if (!data) return;
      const el = SCREENS.card(data, { fieldRect });
      cardLayer.appendChild(el);
      card = el;
      // place it in an empty band of the field (above or under the formation): one layout read
      // when the card appears, never per frame
      if (data.bands && fieldRect.h > 0) {
        const fieldY = fieldRect.fieldY || 0;
        const fieldH = fieldRect.fieldH || 1080;
        const units = (el.offsetHeight * fieldH) / fieldRect.h;
        el.style.setProperty('--card-fy', String((cardCentre(data.bands, units, fieldY, fieldY + fieldH) - fieldY) / fieldH));
      }
      requestAnimationFrame(() => el.classList.add('in'));
    },

    /** Live play wants the HUD; any glass screen hides it. */
    setHudVisible(on) {
      hudWanted = !!on;
      updateHudVisibility();
    },

    hud(world) {
      if (hudWanted) hud.update(world, performance.now());
    },

    /** New world: the HUD writes every value once. */
    resetHud() {
      hud.reset();
    },
    setReady(on) { hud.setReady(on); },
    /** Sound state everywhere it shows: the HUD button and any open screen's toggle. */
    setMuted(on) {
      hud.setMuted(on);
      if (cur && cur.api && cur.api.setMuted) cur.api.setMuted(on);
    },
    setReadyLabel(text) { hud.setReadyLabel(text); },
    /** A short fact under the score for a moment (e.g. "Free miss"). */
    hudNote(text) { hud.note(text, performance.now()); },
    /** Name the opening's first real power cell; Multi has no timed label of its own. */
    hudOpeningDrop(kind, caught = false, count = 0) { hud.openingDrop(kind, caught, count, performance.now()); },

    /** CSS px the renderer should keep clear above the field for the HUD band (0: none needed). */
    hudReserve(rect) {
      readSafeArea(safe);
      return hudReserve(window.innerWidth, window.innerHeight, rect, safe);
    },
    /** QA: smallest HUD text on screen and any button over HUD text (window.__kiln.hudCheck). */
    hudCheck() { return hud.check(); },

    layout(rect) {
      Object.assign(fieldRect, rect);
      readSafeArea(safe);
      hudLayout(window.innerWidth, window.innerHeight, rect, safe, L);
      hud.layout(L);
      root.style.setProperty('--field-x', `${rect.x}px`);
      root.style.setProperty('--field-y', `${rect.y}px`);
      root.style.setProperty('--field-w', `${rect.w}px`);
      root.style.setProperty('--field-h', `${rect.h}px`);
      if (cur) cur.nav.refresh();
    },

    toast(text) {
      toastEl.textContent = text;
      toastEl.classList.add('in');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('in'), 2400);
    },

    /** Rebuild nothing; just re-place the selection ring (after a settings change). */
    refresh() {
      if (cur) cur.nav.refresh();
    },
  };
  return api;
}
