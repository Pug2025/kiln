// Kiln: composition, the run flow and the frame loop (OWNER: D).
//
// The only file that calls stepWorld, renderer.frame, ui.hud and audio.frame.
// Loop: fixed 120 Hz sim steps from an accumulator scaled by world.timeScale (slow-mo), at most
// SIM.MAX_STEPS_PER_FRAME per frame, then one render with alpha = leftover / DT for interpolation.
// The paddle is drawn at its latest position (no interpolation) so it never lags the finger.
// One world per level attempt via makeSystems(); The Core's stages chain through def.continues.
// Flow (rules in src/app/flow.js): title → map → picks → level card + play → results → gate →
// picks → next; run over → results → map; save after every level.
// Behind every menu a live attract world plays itself (A's robot), blurred.
//
// QA hooks (keep them): ?level=N starts a run at N (skips the title) · ?seed=S fixes the seed ·
// ?bot=1 the robot plays (immune to auto-pause; picks and results advance by themselves) ·
// ?debug=1 C's overlay · ?autopause=0 hide/blur/pointercancel do not pause (a hidden preview pane
// reports the page hidden between tool calls) · ?sw=1 registers the service worker on localhost ·
// ?mute=1 silent tab (implied by bot, qa=1, level, fixture, autopause=0) ·
// ?fixture=<name> plays tests/fixtures/G/<name>.js's level (G's stress fixture) ·
// ?dev=1 the dev build: its own save slot (started from the real save), every level and Overburn
// open, a Dev tag on the menus; sound and title as normal (agents add &mute=1).
// window.__kiln exposes world, renderer, stats and the flow for G's harness.

import { SIM, STORAGE_KEY } from './core/constants.js';
import { forgeProgress, bankStageRewards } from './ui/resources.js';
import { controlHints } from './ui/play-help.js';
import { createWorld, stepWorld } from './core/world.js';
import { createInputFrame, clearEdges } from './core/input-frame.js';
import { dailySeed } from './core/rng.js';
import { makeSystems } from './systems.js';
import { getLevel, getStage, LEVELS, LEVEL_NAMES } from './levels/index.js';
import { generateOverburn } from './levels/overburn.js';
import { createRun } from './economy/economy.js';
import { createSave, DEV_KEY } from './economy/save.js';
import { createRenderer } from './render/renderer.js';
import { createInput } from './input/input.js';
import { createUI } from './ui/ui.js';
import { createAudio } from './audio/audio.js';
import { createRobot } from './sim/robot.js';
import { loadAdapters } from './app/adapters.js';
import {
  worldOf, kindOf, preLevelPicks, gateAfter, afterWorld, continueLevel, overburnOpen, recordClear, mapModel,
  canPause, restartRun, migrateLite, liteNow, autoLiteTripped, playerSetsLite,
} from './app/flow.js';
import { initPwa } from './app/pwa.js';
import { formatScore, cardBands } from './ui/layout.js';
import { overloadClearY, overloadTrayNeed } from './input/gestures.js';
import { readSafeArea } from './app/safe-area.js';
import { createReader, resetReader, next as nextEvent } from './core/bus.js';
import { EV } from './core/events.js';

const stage = document.getElementById('stage'); // takes every finger (input)
const view = document.getElementById('view') || stage; // holds the canvas (renderer), may be shortened
const uiRoot = document.getElementById('ui');
const params = new URLSearchParams(location.search);
const QA = {
  level: Number(params.get('level')) || 0,
  seed: Number(params.get('seed')) || 0,
  bot: params.get('bot') === '1',
  debug: params.get('debug') === '1',
  autopause: params.get('autopause') !== '0',
  fixture: /^[a-z0-9-]+$/.test(params.get('fixture') || '') ? params.get('fixture') : '',
  dev: params.get('dev') === '1',
};
// A tab an agent or a test drives never plays out loud (lead, 19:25): ?mute=1, and ?bot=1, ?qa=1,
// ?level=, ?fixture= or ?autopause=0 imply it; no override. Settings cannot unmute it (E's
// qaMuted applies the same rule inside the audio engine).
QA.mute = params.get('mute') === '1' || QA.bot || params.get('qa') === '1'
  || params.has('level') || !!QA.fixture || !QA.autopause;
const media = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} });
const mqMotion = media('(prefers-reduced-motion: reduce)');
const mqTransparency = media('(prefers-reduced-transparency: reduce)');
const coarse = media('(pointer: coarse)');
// The dev build keeps its own help and ball keys too, starting from the real ones, so dev play
// never changes what the real game shows or uses.
const REAL_SEEN_KEY = 'kiln.seen.v1';
const REAL_BALL_KEY = 'kiln.ball.v1';
const SEEN_KEY = QA.dev ? `${REAL_SEEN_KEY}.dev` : REAL_SEEN_KEY;
const BALL_KEY = QA.dev ? `${REAL_BALL_KEY}.dev` : REAL_BALL_KEY;
const INSTALL_KEY = 'kiln.install.v1'; // date of the last install offer (YYYY-MM-DD)
const END_DELAY_MS = 1500;   // real ms between the clear (after A's ceremony) and the results
const STAGE_DELAY_MS = 600;  // The Core: next stage starts after this
const CARD_MS = 2600;        // level card stays at most this long (or until the ball launches)
const PICK_ADDS = Object.freeze({ mod: 'Mod pick', overload: 'Overload pick' }); // map labels for pick levels
const ATTRACT = [1, 2, 3, 4, 6, 7, 8, 9]; // attract-mode levels behind the menus (when built)

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
const newSeed = () => (QA.seed || ((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0) || 1);

function readSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || localStorage.getItem(REAL_SEEN_KEY) || '{}') || {}; } catch { return {}; }
}
function writeSeen(seen) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* private mode: hints show again */ }
}

export async function boot(startup = null) {
  startup?.stage('save-ui');
  const save = createSave(undefined, QA.dev ? { key: DEV_KEY, seedFrom: STORAGE_KEY } : undefined);
  const data = save.load();
  if (QA.dev) document.title = 'Kiln dev';
  const settings = data.settings;
  // ART 15.6 D1: the old auto-lite saved lite for good; lite without liteSet was never chosen
  if (migrateLite(settings)) save.write(data);
  const reduceMotion = () => !!settings.reduceMotion || mqMotion.matches;
  const reduceTransparency = () => !!settings.reduceTransparency || mqTransparency.matches;
  document.documentElement.classList.toggle('rm', reduceMotion());
  document.documentElement.classList.toggle('rt', reduceTransparency());

  // First paint: the title is DOM, shown on the hearth plate at once; three.js and the kiln load
  // behind it and fade in (PLAN §7). Menu choices made meanwhile run when the world is ready.
  const ui = createUI(uiRoot, {
    reduceMotion,
    sound: (name) => { if (audio && audio.ui) audio.ui(name); },
    onPause: () => pause('user'),
    onMute: () => toggleMute(),
    // the Pull tip under HEAT shows until the player first pulls (saved with the other help)
    pulled: () => !!seen.pulled,
    onPulled: () => { if (!seen.pulled) { seen.pulled = true; writeSeen(seen); } },
  });
  ui.setMuted(!!settings.muted);
  let renderer = null;
  let ext = null;
  let audio = null;
  let input = null;
  let ready = false;
  const waiting = [];
  const whenReady = (fn) => (...args) => { if (ready) fn(...args); else waiting.push(() => fn(...args)); };
  const seen = readSeen();

  const frame = createInputFrame();
  const idle = createInputFrame();
  const rect = { x: 0, y: 0, w: 0, h: 0, scale: 1 };
  const playerRobot = QA.bot ? createRobot() : null;
  const attractRobot = createRobot();

  /** Everything the flow knows. */
  const app = {
    mode: 'menu',        // 'menu' (attract world behind glass) | 'play' | 'ended' (world done, screens up)
    world: null,
    attract: false,      // the current world is the attract world
    attractIdx: 0,
    run: null,
    stageRun: null,      // run snapshot at the start of the current world (Restart)
    wave: 0,             // Overburn wave, 0 in the campaign
    picked: '',          // name of the last card taken on a pick screen
    door: '',            // the gate door in front of the current level (its card says it)
    paused: false,
    acc: 0,
    last: performance.now(),
    endAt: 0,
    cardUntil: 0,
    flame: null,
    ovState: -1,
    ovFor: -1,
    ovLabel: '',
    installShown: false,
    tray: false,         // the field leaves room for the touch Overload button (layout)
    layoutMode: '',      // the field mode the last layout() was made for
    autoLite: false,     // the renderer went lite this session (never saved: ART 15.6 D1)
    liteNote: false,     // "Lite mode on" waits for the next pause, menu or lost ball
  };

  // ------------------------------------------------------------------ settings

  function applySettings() {
    if (!ready) return;
    document.documentElement.classList.toggle('rm', reduceMotion());
    document.documentElement.classList.toggle('rt', reduceTransparency());
    renderer.setQuality({ lite: liteNow(settings, app), reduceMotion: reduceMotion(), reduceTransparency: reduceTransparency() });
    audio.setVolume(volume());
    input.configure({ leftHanded: !!settings.leftHanded, thumbPad: !!settings.thumbPad });
    layout();
  }

  /**
   * Room the field gives up: `top` CSS px for the HUD band, `bottom` for the touch Overload button.
   * C's renderer.setReserve keeps the canvas full screen and fits the field below `top`; until it
   * exists the view element itself is shortened (the stage still takes every finger).
   */
  function setReserve(top, bottom) {
    const own = !renderer.setReserve;
    if (!own) renderer.setReserve({ top, bottom });
    view.style.setProperty('--view-top', `${own ? top : 0}px`);
    view.style.setProperty('--view-bottom', `${own ? bottom : 0}px`);
    renderer.resize();
    fieldBox(rect);
  }

  /**
   * The field's box as play shows it. renderer.fieldRect reads it off the canvas, which eases a 6%
   * scale under a blurred menu (renderer applyMenu, 120 ms back): measured from #view, which holds
   * the canvas unscaled, so a box read under a menu is the one play settles on. Read under the
   * scale, it put a level card opened from a screen (results Next, a gate door, a Mod pick) 21 to
   * 33 px off, and the next check (checkFieldRect) moved it twice while it showed.
   */
  function fieldBox(out) {
    renderer.fieldRect(out);
    // also while the scale eases back (the style is already cleared): the offset is 0 at rest
    const c = view.querySelector('.kiln-canvas');
    if (!c) return out;
    const cr = c.getBoundingClientRect(), vr = view.getBoundingClientRect();
    out.x += vr.left - cr.left;
    out.y += vr.top - cr.top;
    return out;
  }

  /** The touch Overload button shows in this world (coarse pointer, a HEAT level, the player's). */
  function trayWanted() {
    const w = app.world;
    return !!(coarse.matches && w && !app.attract && w.level.rules.heat);
  }

  const safeNow = { top: 0, right: 0, bottom: 0, left: 0 };
  function layout() {
    if (!renderer) return;
    // Tablet portrait, near-square windows and short phone viewports (Safari with its toolbars)
    // have neither a band above the field nor gutters: the field gives the HUD band room at the
    // top. On HEAT levels on touch screens it also leaves room under the paddle for the Overload
    // button (ART §4: nothing near the paddle but the paddle; the HUD never covers the field).
    setReserve(0, 0);
    const top = ui.hudReserve(rect);
    if (top > 0) setReserve(top, 0);
    app.tray = trayWanted();
    app.layoutMode = app.world ? app.world.level.mode : '';
    if (app.tray) {
      readSafeArea(safeNow);
      let bottom = 0;
      for (let i = 0; i < 4; i++) {
        const need = overloadTrayNeed(window.innerHeight, safeNow.bottom, overloadClearY(rect));
        if (need < 0.5) break;
        bottom += Math.ceil(need);
        setReserve(top, bottom);
      }
    }
    if (app.world && renderer.detailInfo) renderer.detailInfo(app.world.readability);
    ui.layout(rect);
    if (app.flame && app.flame.resize) app.flame.resize();
  }

  /**
   * The renderer refit the field since the last layout: its box moved, or it frames another range
   * of the field (a level with another ceiling: the HUD and the level card map field units by it).
   */
  const probe = { x: 0, y: 0, w: 0, h: 0, scale: 1 };
  function boxMoved() {
    fieldBox(probe);
    return Math.abs(probe.x - rect.x) > 0.5 || Math.abs(probe.y - rect.y) > 0.5 || Math.abs(probe.w - rect.w) > 0.5
      || Math.abs(probe.h - rect.h) > 0.5 || probe.fieldY !== rect.fieldY || probe.fieldH !== rect.fieldH;
  }
  /** The renderer may refit after a load or a mode change: re-glue the HUD when the rect moves. */
  function checkFieldRect() {
    if (!renderer) return;
    // a refit can change what the HUD band and the Overload button need: the whole layout again
    if (boxMoved()) layout();
  }
  setInterval(checkFieldRect, 500);

  function changeSetting(key, value) {
    if (key === 'fullscreen') { setFullscreen(!!value); return; }
    if (key === 'lite') playerSetsLite(settings, app, value); // the only way lite reaches the save
    else settings[key] = value;
    save.write(data);
    applySettings();
    if (key === 'muted') ui.setMuted(!!settings.muted); // the HUD button and any open toggle agree
  }

  /** Auto-lite says so once, out of live play: at the next pause, menu or lost ball. */
  function liteToast() {
    if (!app.liteNote) return;
    app.liteNote = false;
    ui.toast('Lite graphics on');
  }

  function command(name) {
    if (name === 'mute') toggleMute();
    else if (name === 'fullscreen' && ready) setFullscreen(!isFullscreen());
  }

  /** Music and sound together, from the HUD button, the pause panel, the title or M. Saved. */
  function toggleMute() {
    settings.muted = !settings.muted;
    save.write(data);
    if (audio) audio.setVolume(volume());
    ui.setMuted(settings.muted);
    if (app.mode !== 'play' || app.paused) ui.toast(settings.muted ? 'Sound off' : 'Sound on');
  }

  /** What the audio engine gets: the player's levels; a QA tab stays silent whatever they say. */
  function volume() {
    return { music: settings.music, sfx: settings.sfx, muted: !!settings.muted || QA.mute };
  }

  const fsSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function setFullscreen(on) {
    const d = document;
    try {
      if (!on && isFullscreen()) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else if (on && !isFullscreen()) {
        const el = d.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) {
          Promise.resolve(req.call(el, { navigationUI: 'hide' }))
            .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('portrait').catch(() => {}))
            .catch(() => {});
        }
      }
    } catch { /* not supported here */ }
  }
  /** Phones play fullscreen where the browser allows it (Android); asked inside the tap. */
  function phoneFullscreen() {
    const standalone = media('(display-mode: standalone)').matches || navigator.standalone;
    if (coarse.matches && fsSupported() && !standalone && !isFullscreen()) setFullscreen(true);
  }

  // ------------------------------------------------------------------ worlds

  /** A level def by number; a stand-in from level 1 while B has not built it yet. */
  function levelDef(n) {
    const d = getLevel(n);
    if (d) return d;
    const base = getLevel(1) || LEVELS[0];
    return { ...base, n, id: `pending-${n}`, name: LEVEL_NAMES[n] || `Level ${n}`, world: worldOf(n), kind: 'normal', pick: undefined, adds: '', hint: '', placeholder: true };
  }

  // The HUD's few event-driven facts (a free miss leaves the lives as they were).
  const uiEvents = createReader({ head: 0, cap: 1 }, 'ui', 0);
  function readUiEvents() {
    while (nextEvent(uiEvents)) {
      if (uiEvents.type === EV.FREE_MISS && !app.attract) ui.hudNote('Free miss');
      else if (uiEvents.type === EV.BALL_LOST && !app.attract) liteToast();
      else if (uiEvents.type === EV.HAZARD_HEAT_LOST && !app.attract) ui.hudHazardHit(uiEvents.a, uiEvents.b);
      else if (!app.attract && app.world.level.n <= 2) {
        if (uiEvents.type === EV.DROP_SPAWNED) ui.hudOpeningDrop(uiEvents.a);
        else if (uiEvents.type === EV.EFFECT_ON) ui.hudOpeningDrop(uiEvents.a, true, uiEvents.c | 0);
      }
    }
  }

  function setWorld(world, attract) {
    app.world = world;
    app.attract = attract;
    app.acc = 0;
    app.endAt = 0;
    app.ovState = -1; // the HUD forgets its ready mark: write it again on the next frame
    renderer.setWorld(world);
    if (!attract) audio.setWorld(world); // menus: no game sounds from the attract world
    // the renderer refits for the world's field mode, and the Overload button's room comes and goes
    // with HEAT: lay out again (with the reserves) when either changes, not for every attract world.
    // A player's world with another ceiling is framed afresh in the same mode: lay out when the
    // box moved, so the HUD and its level card start on it (renderer.setWorld has just resized,
    // so the read costs no layout of its own), not on the last level's until checkFieldRect.
    if (trayWanted() !== !!app.tray || world.level.mode !== app.layoutMode || (!attract && boxMoved())) layout();
    else if (renderer.detailInfo) renderer.detailInfo(world.readability);
    resetReader(uiEvents, world.bus, world.bus.head);
    ui.resetHud();
    window.__kiln.world = world;
  }

  function startAttract() {
    const avail = ATTRACT.filter((n) => getLevel(n));
    const n = avail.length ? avail[app.attractIdx++ % avail.length] : 1;
    const def = getLevel(n) || LEVELS[0];
    const run = createRun({ seed: newSeed(), levelN: def.n, save: data });
    setWorld(createWorld({ level: def, seed: run.seed + def.n * 31, run, systems: makeSystems() }), true);
  }

  /** Menus always sit over the attract world (a quit or finished player world is replaced). */
  function ensureAttract() {
    if (!app.world || !app.attract) startAttract();
  }

  /** Start a world for the player with the current run. */
  function playWorld(def) {
    if (!(def.stage > 1)) app.rewardChain = null;
    app.run.levelN = def.n;
    app.stageRun = clone(app.run);
    setWorld(createWorld({ level: def, seed: app.run.seed + def.n * 31 + (def.stage | 0) + app.wave * 977, run: app.run, systems: makeSystems() }), false);
    app.mode = 'play';
    leavePause();
    ui.show(null);
    renderer.setMenu(false);
    input.setEnabled(true);
    ui.setHudVisible(true);
    audio.music(ext.trackFor(def));
    showCard(def);
  }

  function showCard(def) {
    const touch = coarse.matches;
    const rules = app.world?.level.rules || def.rules || {};
    const controls = controlHints(rules, seen, touch);
    if (controls.length) writeSeen(seen);
    // the pick screen came just before: a card that only names that pick ('Mod pick') says nothing
    // new, so it is left off here (the level map still shows it); real adds on pick levels stay
    const namesPick = !!def.pick && def.adds === PICK_ADDS[def.pick];
    ui.card({
      n: def.n > 30 ? app.wave : def.n,
      kicker: def.world === 'overburn' ? 'Overburn' : def.stage > 1 ? `Level ${String(def.n).padStart(2, '0')}  ·  Stage ${def.stage}` : '',
      name: def.world === 'overburn' ? `Wave ${app.wave}` : def.name,
      kind: def.kind || kindOf(def.n),
      adds: controls.length || namesPick ? '' : def.adds || '',
      door: def.twist ? app.door || '' : '',
      // one control per line, so a first HEAT card reads as two short lines
      hint: controls.length ? controls : def.hint,
      controls: controls.length > 0,
      bands: app.world ? cardBands(app.world) : null,
    });
    // New controls can be read at the player's pace; launching still clears the card immediately.
    app.cardUntil = controls.length ? Infinity : performance.now() + CARD_MS;
  }

  // ------------------------------------------------------------------ menus

  function toMenu() {
    app.mode = 'menu';
    leavePause();
    ui.setHudVisible(false);
    ui.card(null);
    if (!ready) return;
    input.setEnabled(false);
    renderer.setMenu(true);
    ensureAttract();
    audio.music('title');
    liteToast();
  }

  /** The live flame in the wordmark's I (C), mounted into the title's slot once three.js is up. */
  function mountFlame(slot) {
    if (!ext || !ext.createWordmarkFlame) return null;
    try {
      const f = ext.createWordmarkFlame(slot, { reduceMotion: reduceMotion() });
      app.flame = f;
      return { dispose() { if (app.flame === f) app.flame = null; if (f && f.dispose) f.dispose(); } };
    } catch (e) {
      console.warn('[kiln] wordmark flame', e);
      return null;
    }
  }

  /** C's live title wall (ART 15.6 C16) in the title's wall box, when C exports one. */
  function mountWall(slot) {
    if (!ext || !ext.createTitleWall) return null;
    try {
      return ext.createTitleWall(slot, {
        reduceMotion,
        onActive: (active) => renderer.setMenuDrawStride(active ? 6 : 3),
      });
    } catch (e) {
      console.warn('[kiln] title wall', e);
      return null;
    }
  }

  function showTitle() {
    toMenu();
    const c = data.campaign;
    const n = continueLevel(c);
    const menu = [
      { id: 'play', label: 'PLAY', detail: `${String(n).padStart(2, '0')}  ${levelDef(n).name}` },
      { id: 'levels', label: 'LEVELS' },
      QA.dev || overburnOpen(c) ? { id: 'overburn', label: 'OVERBURN' } : null,
      { id: 'forge', label: 'THE FORGE' },
      { id: 'settings', label: 'SETTINGS' },
      { id: 'guide', label: 'HOW TO PLAY' },
    ].filter(Boolean);
    const cleared = Object.keys(c.cleared).filter((k) => c.cleared[k] && Number(k) <= 30).length;
    const forged = Object.values(data.forge.ranks || {}).reduce((a, v) => a + (v | 0), 0);
    const stats = [];
    if (cleared) stats.push({ label: 'Cleared', value: `${cleared}/30` });
    if (data.forge.embers) stats.push({ label: 'Forge wallet', value: formatScore(data.forge.embers) });
    if (forged) stats.push({ label: 'Upgrades', value: String(forged) });
    if (data.overburn.bestWave) stats.push({ label: 'Overburn', value: `Wave ${data.overburn.bestWave}` });
    const world = worldOf(n);
    ui.show('title', {
      menu,
      stats,
      dev: QA.dev,
      // desktop: the run's next step as the one primary button beside the wall (ART 15.6 D2)
      primary: { id: 'play', label: cleared ? 'Continue' : 'Play', detail: `${String(n).padStart(2, '0')}  ${levelDef(n).name}` },
      wall: { art: `img/levels/${world}.webp`, label: world === 'whiteheat' ? 'Inferno' : world === 'blaze' ? 'Blaze' : 'Ember' },
      mountWall,
      muted: !!settings.muted,
      onMute: toggleMute,
      onSelect(id) {
        if (id === 'guide') { showGuide(showTitle); return; }
        if (id === 'play' || id === 'overburn') phoneFullscreen(); // inside the tap, before any wait
        whenReady(() => {
          if (id === 'play') startRun(n);
          else if (id === 'levels') showMap();
          else if (id === 'overburn') startOverburn();
          else if (id === 'forge') showForge(showTitle);
          else if (id === 'settings') showSettings(showTitle);
        })();
      },
      mountFlame,
    });
  }

  function showMap(selected) {
    toMenu();
    ui.show('map', {
      model: mapModel(data, (n) => getLevel(n), LEVEL_NAMES, { allOpen: QA.dev }),
      dev: QA.dev,
      selected,
      onPlay(n) { phoneFullscreen(); startRun(n); },
      onOverburn() { phoneFullscreen(); startOverburn(); },
      onBack: showTitle,
    });
  }

  function showForge(back) {
    toMenu();
    ui.show('forge', {
      model: ext.forgeModel(data),
      onBuy(id) {
        if (ext.buyRank(data, id)) save.write(data);
        return ext.forgeModel(data);
      },
      ball: { kinds: ext.ballKinds(data), current: ballKind(), onChange: setBallKind },
      onBack: back,
    });
  }

  function showGuide(back = showTitle) {
    if (app.mode !== 'play') toMenu();
    ui.show('guide', { onBack: back });
  }

  function showSettings(back) {
    if (app.mode !== 'play') toMenu();
    ui.show('settings', {
      settings: { ...settings, lite: liteNow(settings, app) }, // the switch shows what runs now
      fullscreen: { supported: fsSupported(), on: isFullscreen() },
      onChange: changeSetting,
      onCredits: () => showCredits(() => showSettings(back)),
      onBack: back,
    });
  }

  function showCredits(back) {
    ui.show('credits', {
      lines: ext.creditLines(),
      extra: ['Type: Inter and Inter Tight by Rasmus Andersson, SIL Open Font License.'],
      onBack: back,
    });
  }

  /** The pick screen's words and options for a Mod, Overload or gate pick before level `def`. */
  function pickData(kind, def, run) {
    if (kind === 'mod') return { kind, options: ext.modChoices(run, def.n), kicker: 'Choose a Mod', sub: 'Applies for the rest of this run.', confirm: 'Choose' };
    if (kind === 'overload') return { kind, options: ext.overloadChoices(run).map((o) => ({ ...o,
      tag: o.raw?.cost > 0 ? `Ready at ${o.raw.cost} HEAT` : '',
    })), kicker: 'Choose an Overload', sub: 'Replaces the Shield button. Firing empties HEAT.', confirm: 'Choose' };
    return {
      kind, options: ext.twistsFor(def.n), kicker: 'Choose the next wall',
      sub: `Level ${String(def.n).padStart(2, '0')} · ${def.name}`, confirm: 'Enter',
    };
  }

  /** Ask a pick (Mod, Overload or gate door); resolves with the chosen id. */
  function ask(kind, def) {
    return new Promise((resolve) => {
      const { options, kicker, sub, confirm } = pickData(kind, def, app.run);
      app.mode = app.mode === 'play' ? 'ended' : app.mode;
      if (!app.world) startAttract(); // a run started by ?level: something live behind the glass
      input.setEnabled(false);
      renderer.setMenu(true);
      ui.setHudVisible(false);
      ui.card(null);
      ui.show('pick', { kind, kicker, sub, options, confirm, onPick: (id, o) => { app.picked = (o && o.name) || ''; resolve(id); } });
      if (QA.bot) setTimeout(() => { app.picked = (options[0] && options[0].name) || ''; resolve(options[0] && options[0].id); }, 600);
    });
  }

  // ------------------------------------------------------------------ the run

  async function startRun(n) {
    app.run = createRun({ seed: newSeed(), levelN: n, save: data, ballKind: ballKind() });
    app.wave = 0;
    await enterLevel(levelDef(n), true);
  }

  async function startOverburn() {
    app.run = createRun({ seed: newSeed(), levelN: 31, save: data, ballKind: ballKind(), overburnWave: 1 });
    app.wave = 1;
    await enterLevel(generateOverburn(dailySeed(), 1), true);
  }

  /** The ball type chosen in The Forge (D's preference; E clamps it to what is unlocked). */
  function ballKind() {
    try { return Number(localStorage.getItem(BALL_KEY) || localStorage.getItem(REAL_BALL_KEY)) || 0; } catch { return 0; }
  }
  function setBallKind(id) {
    try { localStorage.setItem(BALL_KEY, String(id)); } catch { /* the default ball */ }
  }

  async function enterLevel(def, first) {
    for (const kind of preLevelPicks(def, app.run, { first })) {
      const id = await ask(kind, def);
      if (kind === 'mod') ext.applyMod(app.run, id);
      else ext.chooseOverload(app.run, id);
    }
    playWorld(def);
  }

  /** The run is over (lost, quit or the campaign done): bank what is left, save. */
  function endRun(reason) {
    const r = app.run;
    if (!r) return;
    ext.bankRun(data, r, { over: reason === 'over', reason, n: r.levelN, wave: app.wave });
    save.write(data);
    app.run = null;
  }

  /** A world was cleared: bank its embers and record progress (E), then save. */
  function bankClear(def, levelScore) {
    const campaign = !def.placeholder && def.n <= 30 && def.world !== 'overburn';
    const best = campaign ? data.campaign.best[def.n] | 0 : 0;
    const recorded = ext.bankRun(data, app.run, { cleared: campaign, n: def.n, levelScore: campaign ? levelScore : undefined, wave: app.wave });
    if (campaign && !recorded) recordClear(data, def.n, levelScore);
    save.write(data);
    return campaign ? { best: Math.max(best, levelScore), newBest: levelScore > best && best > 0 } : { best: 0, newBest: false };
  }

  function onWorldEnd() {
    const w = app.world;
    const def = w.level.def;
    const step = afterWorld(def, w.phase, { hasStage: (id) => !!getStage(id), wave: app.wave });
    if (step.type === 'stage') {
      app.rewardChain = bankStageRewards(w, data, (d, r) => ext.bankRun(d, r), app.rewardChain);
      save.write(data);
      playWorld(getStage(step.id)); return;
    }
    app.mode = 'ended';
    input.setEnabled(false);
    const levelScore = w.econ.levelScore | 0;
    const caught = (app.rewardChain?.caught || 0) + (w.econ.embersCaught | 0);
    const auto = (app.rewardChain?.auto || 0) + (w.econ.embersAutoBanked | 0);
    const embers = caught + auto;
    const walletBefore = data.forge.embers | 0;
    const rewards = () => ({ caught, auto, forgeGain: (app.rewardChain?.forgeGain || 0) +
      Math.max(0, (data.forge.embers | 0) - walletBefore), ...forgeProgress(ext.forgeModel(data)) });
    const rewardScope = app.rewardChain ? 'This encounter' : 'This level';
    if (step.type === 'over') {
      const reached = def.world === 'overburn' ? `Wave ${app.wave}` : `${String(def.n).padStart(2, '0')} ${def.name}`;
      const runScore = app.run.score | 0;
      const banked = app.run.embersBanked | 0;
      endRun('over');
      results({ kind: 'over', n: def.n, runScore, embers: banked, rewards: rewards(), rewardScope, reached, nextLabel: 'Levels', onNext: () => showMap(def.n <= 30 ? def.n : undefined) });
      return;
    }
    // cleared: bank and save after every level
    app.lastBest = bankClear(def, levelScore);
    if (step.type === 'wave') {
      results({ kind: 'wave', wave: app.wave, score: levelScore, runScore: app.run.score, embers, rewards: rewards(), rewardScope, nextLabel: 'Next wave',
        onNext: () => {
          app.wave = step.wave;
          app.run.overburnWave = step.wave; // D call: E's run field has no setter; E reads it for bests
          enterLevel(generateOverburn(dailySeed(), step.wave), false);
        },
        onMap: () => { endRun('quit'); showMap(31); } });
      return;
    }
    if (step.type === 'campaign') {
      const runScore = app.run.score | 0;
      const banked = app.run.embersBanked | 0;
      endRun('campaign');
      results({ kind: 'campaign', name: 'Overburn is open.', runScore, embers: banked, rewards: rewards(), rewardScope, nextLabel: 'Title', onNext: showTitle });
      return;
    }
    const next = levelDef(step.n);
    results({
      kind: 'cleared', n: def.n, name: def.name, score: levelScore, runScore: app.run.score, embers,
      rewards: rewards(), rewardScope,
      bonus: (w.econ.clearBonus | 0) + (w.econ.cavityBonus | 0), flawless: !!w.econ.flawless,
      best: app.lastBest.best, newBest: app.lastBest.newBest,
      nextLabel: `Next  ·  ${String(next.n).padStart(2, '0')}`,
      install: installOffer(),
      onNext: async () => {
        let nd = next;
        if (gateAfter(def, next)) {
          const id = await ask('gate', next);
          nd = ext.applyTwist(next, id);
          app.door = app.picked;
        }
        enterLevel(nd, false);
      },
      onMap: () => { endRun('quit'); showMap(step.n); },
    });
  }

  function results(d) {
    renderer.setMenu(true);
    ui.setHudVisible(false);
    ui.card(null);
    // the clear frame already ran the last step, the bank and the save (C's frame-time runs saw
    // 21 to 27 ms there): the results DOM is built in the next task, unless a screen came first
    setTimeout(() => { if (!ui.current) ui.show('results', d); }, 0);
    if (QA.bot) setTimeout(() => { if (ui.current === 'results') d.onNext(); }, 1200);
  }

  // QA openers (G's devicecheck --screens): results, pick and gate with sample data. They change
  // no run and write no save; every choice goes back to the title.
  function qaResults(kind = 'cleared') {
    toMenu();
    ui.show(null);
    if (kind === 'over') {
      results({ kind: 'over', n: 7, runScore: 48210, embers: 36, reached: `07 ${levelDef(7).name}`, nextLabel: 'Levels', onNext: showTitle });
      return;
    }
    results({
      kind: 'cleared', n: 3, name: levelDef(3).name, score: 12400, runScore: 31850, embers: 18, bonus: 2500,
      rewards: { caught: 11, auto: 7, forgeGain: 18, ...forgeProgress(ext.forgeModel(data)) },
      flawless: true, best: 12400, newBest: true, nextLabel: 'Next  ·  04', onNext: showTitle, onMap: showTitle,
    });
  }
  function qaPick(kind = 'mod', n = kind === 'gate' ? 14 : 13) {
    toMenu();
    const run = createRun({ seed: 1, levelN: n, save: data, ballKind: 0 });
    ui.show('pick', { ...pickData(kind, levelDef(n), run), onPick: () => showTitle() });
  }

  // ------------------------------------------------------------------ pause

  function pause(reason) {
    // live play only: once the world is cleared or over its results come in a moment, and a
    // Restart from here would hand a lost run its lives back (flow.js canPause)
    if (!app.world || !canPause(app, app.world.phase)) return;
    app.paused = true;
    input.setEnabled(false);
    renderer.setMenu(true);
    audio.suspend(); // E: music ducks and muffles under the pause menu
    showPause(reason);
    liteToast();
  }

  function showPause(reason) {
    const def = app.world.level.def;
    const live = app.world.phase !== 'cleared' && app.world.phase !== 'over';
    const canRestart = live && !!app.stageRun && (app.run ? app.run.lives | 0 : 0) > 0;
    ui.show('pause', {
      reason,
      n: def.n > 30 ? 0 : def.n,
      name: def.name,
      onResume: resume,
      muted: !!settings.muted,
      onMute: toggleMute,
      // the level starts again from its own start; lives lost (or a free miss used) stay lost
      onRestart: canRestart ? () => {
        const run = restartRun(clone(app.stageRun), app.run);
        if (!run) return;
        app.run = run;
        playWorld(def);
      } : null,
      onSettings: () => showSettings(() => showPause(reason)),
      onGuide: () => showGuide(() => showPause(reason)),
      onQuit: () => { endRun('quit'); showMap(def.n <= 30 ? def.n : 31); },
    });
  }

  /**
   * Every way out of the pause menu (Resume, Restart level, Levels) comes through here: the
   * music E ducked and muffled under the menu comes back up.
   */
  function leavePause() {
    if (!app.paused) return;
    app.paused = false;
    if (audio) audio.resume();
  }

  function resume() {
    if (!app.paused) return;
    leavePause();
    ui.show(null);
    renderer.setMenu(false);
    input.setEnabled(true);
    ui.setHudVisible(true);
    app.last = performance.now();
  }

  // ------------------------------------------------------------------ PWA

  const pwa = initPwa({
    canReload: () => ui.current === 'title' || ui.current === 'map',
    canToast: () => app.mode !== 'play' || app.paused,
    toast: (t) => ui.toast(t),
    diagnostic: (info) => startup?.note(info),
  });
  function installOffer() {
    if (QA.dev || app.installShown || !pwa.installable()) return null; // never install the dev build
    app.installShown = true;
    // once a day at most: an offer every session would nag
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem(INSTALL_KEY) === today) return null;
      localStorage.setItem(INSTALL_KEY, today);
    } catch { /* no storage: once per session */ }
    return {
      label: pwa.canPrompt() ? 'Install Kiln' : 'Add to Home Screen',
      fact: pwa.canPrompt() ? 'Add Kiln to your Home Screen for offline play.' : 'In Safari, open Share and choose Add to Home Screen.',
      onInstall: () => pwa.prompt(),
    };
  }

  // ------------------------------------------------------------------ events

  // audio can only start inside a user gesture: unlock synchronously in the first one
  const unlock = () => {
    if (!audio) return; // still loading: the next gesture unlocks
    audio.unlock();
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
  mqMotion.addEventListener?.('change', applySettings);
  mqTransparency.addEventListener?.('change', applySettings);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && app.mode !== 'play') app.last = performance.now(); });

  // ------------------------------------------------------------------ start

  const early = !QA.level && !QA.bot && !QA.fixture;
  if (early) showTitle();
  startup?.stage('renderer-adapters');
  const task = (name, operation) => startup ? startup.task(name, operation) : Promise.resolve().then(operation);
  [renderer, ext] = await Promise.all([
    task('renderer', () => createRenderer(view, {
      lite: liteNow(settings, app),
      reduceMotion: reduceMotion(),
      reduceTransparency: reduceTransparency(),
      debug: QA.debug,
      fontStyleReady: startup?.fontStyleReady,
      // this session only: never written to the save (ART 15.6 D1)
      onAutoLite() {
        autoLiteTripped(app);
        if (app.mode !== 'play' || app.paused) liteToast();
      },
    })),
    task('adapters', () => loadAdapters({ diagnostic: (info) => startup?.note(info) })),
  ]);
  startup?.stage('world');
  audio = createAudio({ settings: { ...settings, ...volume() }, forceMute: QA.mute });
  input = createInput(stage, renderer, { onCommand: command });
  input.onPause((reason) => {
    if (QA.bot) return; // the robot keeps playing when the window loses focus (QA runs)
    if (reason !== 'user' && !QA.autopause) return;
    pause(reason);
  });
  window.__kiln = {
    world: null, renderer, input, ui, audio, save, data, app, ext, qa: QA,
    pause, resume, startRun, startLevel: startRun, startOverburn, showTitle, showMap,
    showForge: () => showForge(showTitle), showSettings: () => showSettings(showTitle),
    showGuide: () => showGuide(app.paused ? () => showPause('user') : showTitle),
    showCredits: () => { toMenu(); showCredits(showTitle); }, toggleMute,
    hudCheck: () => ui.hudCheck(),
    showResults: qaResults, showPick: qaPick, showGate: (n = 14) => qaPick('gate', n),
    stats: { frames: 0, steps: 0, maxFrameMs: 0 },
  };
  ready = true;
  applySettings();
  if (early) {
    startAttract();
    if (app.mode === 'menu') {
      renderer.setMenu(true);
      input.setEnabled(false);
      audio.music('title');
      const scr = ui.screenApi();
      if (ui.current === 'title' && scr && scr.mountFlame) scr.mountFlame(mountFlame);
      if (ui.current === 'title' && scr && scr.mountWall) scr.mountWall(mountWall);
    }
  } else if (QA.fixture) {
    // G's stress fixtures: ?fixture=<name> plays tests/fixtures/G/<name>.js's `level`
    import(`../tests/fixtures/G/${QA.fixture}.js`)
      .then((fx) => {
        app.run = createRun({ seed: newSeed(), levelN: fx.level.n, save: data, ballKind: ballKind() });
        app.wave = 0;
        return enterLevel(fx.level, true);
      })
      .catch((e) => { console.warn('[kiln] fixture', e); startRun(QA.level || 1); });
  } else startRun(QA.level || 1);
  document.body.classList.add('ready');
  waiting.splice(0).forEach((fn) => fn());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

  // ------------------------------------------------------------------ the loop

  function controllerFill(w) {
    if (app.attract) attractRobot.fill(frame, w);
    else if (app.mode === 'play') {
      if (playerRobot) playerRobot.fill(frame, w);
      else input.sample(frame, w);
    } else return idle;
    return frame;
  }

  /**
   * The overload input fires the equipped Overload, or before one is equipped buys a shield for
   * HEAT (E, from the first HEAT level). The touch button and the HUD's ready label follow it.
   */

  function updateOverloadButton(w) {
    const r = w.run;
    const e = w.econ;
    let state = 0;
    if (app.mode === 'play' && !app.paused && w.level.rules.heat) {
      if (r.overload) state = e.heat >= e.overloadCost ? 2 : 1;
      else if (e.shieldCost > 0) state = w.effects.shield < 1 && e.heat >= e.shieldCost ? 2 : 1;
    }
    const key = r.overload | 0;
    if (state && app.ovFor !== key) { // the name only when the equipped Overload changes
      app.ovFor = key;
      app.ovLabel = key ? (ext.overloadChoices(r).find((o) => o.id === key) || {}).name || 'Overload' : 'Shield';
      ui.setReadyLabel(app.ovLabel);
      app.ovState = -1;
    }
    if (state !== app.ovState) {
      app.ovState = state;
      input.setOverload(state, state ? app.ovLabel : '');
      ui.setReady(state === 2);
    }
  }

  /** One frame of the loop at time `now` (ms). */
  function frameStep(now) {
    let rendered = false;
    let drawn = false;
    const st = window.__kiln.stats;
    const realDt = Math.min(0.1, (now - app.last) / 1000);
    app.last = now;
    const w = app.world;
    if (!app.paused && w) {
      app.acc += realDt * w.timeScale;
      let steps = 0;
      while (app.acc >= SIM.DT && steps < SIM.MAX_STEPS_PER_FRAME) {
        const f = controllerFill(w);
        stepWorld(w, f);
        clearEdges(f);
        app.acc -= SIM.DT;
        steps++;
      }
      if (steps === SIM.MAX_STEPS_PER_FRAME) app.acc = 0;
      st.steps += steps;
      const done = w.phase === 'cleared' || w.phase === 'over';
      if (done && !app.endAt) app.endAt = now + (w.level.def.continues && w.phase === 'cleared' ? STAGE_DELAY_MS : END_DELAY_MS);
      if (app.endAt && now >= app.endAt) {
        app.endAt = Infinity;
        // A world that hands over to the next one (The Core's next stage, a new attract world)
        // has its last frame drawn first, while the renderer still holds it; the next world is
        // drawn from the next frame on. Drawn after the handover, the old world made the renderer
        // switch back to it here and forward again next frame: two extra setWorld rebuilds in the
        // frame that ends Core stage 1 (item 23).
        if (app.attract || (app.mode === 'play' && w.phase === 'cleared' && w.level.def.continues)) {
          rendered = renderer.frame(w, app.acc / SIM.DT, realDt) === true;
          drawn = true;
        }
        if (app.attract) startAttract();
        else if (app.mode === 'play') onWorldEnd();
      }
      // the card belongs to the world that is current now: after a handover above (The Core's
      // next stage) `w` is the cleared stage, and reading it here closed the new stage's card
      // in the frame that opened it, so stage 2 and 3 never showed theirs
      if (app.mode === 'play' && app.cardUntil && (app.world.phase !== 'serve' || now > app.cardUntil)) {
        app.cardUntil = 0;
        // a launch takes the card away at once (no fade), so the ball never flies under it
        ui.card(null, app.world.phase !== 'serve');
      }
    }
    // the HUD, sounds and the Overload button follow the world that is current now
    const cw = app.world;
    if (cw) {
      if (!drawn) rendered = renderer.frame(cw, app.acc / SIM.DT, realDt) === true;
      readUiEvents();
      ui.hud(cw);
      audio.frame(cw, realDt);
      updateOverloadButton(cw);
    }
    if (app.flame && app.flame.frame) app.flame.frame(now / 1000);
    st.frames++;
    if (st.frames > 30) st.maxFrameMs = Math.max(st.maxFrameMs, renderer.stats.frameMs); // skip shader warm-up
    return rendered;
  }

  function tick(now) {
    frameStep(now);
    requestAnimationFrame(tick);
  }
  function firstTick(now) {
    if (frameStep(now)) {
      startup?.ready();
      requestAnimationFrame(tick);
    } else requestAnimationFrame(firstTick);
  }
  /** QA: run n frames of dtMs by hand (a hidden preview pane gets no animation frames). */
  window.__kiln.advance = (n = 1, dtMs = 1000 / 60) => {
    let rendered = false;
    for (let i = 0; i < n; i++) rendered = frameStep(app.last + dtMs) || rendered;
    if (rendered) startup?.ready();
  };
  startup?.stage('first-frame');
  requestAnimationFrame(firstTick);
}
