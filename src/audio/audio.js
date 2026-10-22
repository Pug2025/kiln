// Kiln: audio engine (OWNER: E). Synthesised game sounds, menu sounds, the adaptive soundtrack over
// the drone, iOS unlock. Presentation side: the sim never imports it.
//
//   const audio = createAudio({ settings });   // main.js (D)
//   audio.setWorld(world);  audio.frame(world, realDt);  audio.music('title');  audio.ui('click');
//
// Reads world events through its own bus reader once per frame and world.econ / world.fx for
// pitch and music intensity. setWorld picks the level's track (trackFor) on its own; D only calls
// music('title') / music(null) for screens outside a level.
//
// iOS plumbing (rebuilt for Kiln): the AudioContext is created and resumed inside the first
// pointerdown / touchend / keydown (createAudio listens for them itself, so it works however main.js
// wires it); navigator.audioSession.type = 'playback' so the silent switch does not mute the game;
// the context is suspended while the page is hidden and resumed when it shows; an 'interrupted'
// context (a phone call) is resumed when it ends or on the next touch.
//
// suspend()/resume() are the game's pause: music ducks and muffles under the pause menu, menu
// sounds still play. Volumes: setVolume({music, sfx, muted}) 0…1.

import { DROP_FAMILY } from '../core/constants.js';
import { EV } from '../core/events.js';
import { createReader, resetReader, next } from '../core/bus.js';
import { createSfx, SFX_FILES } from './sfx.js';
import { createMusic, trackFor, leanMusic } from './music.js';

/** Phones and small-memory devices hold the music at a lower rate (music.js LEAN_RATE). */
function lean() {
  try {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return leanMusic(typeof location !== 'undefined' ? location.search : '', typeof navigator !== 'undefined' ? navigator : {}, coarse);
  } catch {
    return false;
  }
}

/** Minimum seconds between two plays of the same sound (and its rough length for voice counting). */
const COOLDOWN = Object.freeze({
  brick: 0.026, hit: 0.03, paddle: 0.04, perfect: 0.05, wall: 0.045, ember: 0.022, combo: 0.1,
  comboDown: 0.2, dropSpawn: 0.05, drop: 0.05, effectOff: 0.1, launch: 0.08, lost: 0.15,
  ballLost: 0.3, lifeLost: 0.3, lifeGained: 0.2, roar: 1.5, blast: 1.0, explosion: 0.06, laser: 0.05,
  overload: 0.2, shield: 0.1, clank: 0.05, bigClank: 0.08, hazard: 0.1, bossPhase: 0.5,
  portal: 0.08, land: 0.06, heatFull: 0.5, tick: 0.3, nearMiss: 0.2, cavity: 0.3, ui: 0.03,
  victory: 2,
});
const LENGTH = Object.freeze({
  brick: 0.45, hit: 0.15, paddle: 0.12, perfect: 0.26, wall: 0.04, ember: 0.08, combo: 0.6,
  ballLost: 0.9, roar: 3.2, blast: 2.4, explosion: 0.34,
});
/** Sounds dropped first when many voices are already playing. */
const LOW = new Set(['ember', 'wall', 'hit', 'dropSpawn', 'land', 'portal', 'laser']);
const MAX_VOICES = 36;
const RING = 64;

/** True when a page URL's query means an agent or a test is driving it (always silent). */
export function qaMuted(search) {
  if (!search) return false;
  const q = new URLSearchParams(search);
  return q.get('mute') === '1' || q.get('bot') === '1' || q.get('qa') === '1' || q.has('level');
}

/**
 * @param {{settings?:{music?:number, sfx?:number, muted?:boolean}, forceMute?:boolean}} [opts]
 *   forceMute: silent for the page life, like ?mute=1 (QA and agent tabs)
 * @returns {import('../core/types.js').Audio & {ui(name:string):void, readonly state:object}}
 */
export function createAudio(opts = {}) {
  const vol = { music: 0.8, sfx: 0.9, muted: false };
  if (opts.settings) Object.assign(vol, pick(opts.settings));
  // Agent and test tabs never play out loud: ?mute=1, and ?bot=1, ?qa=1 or ?level= (test URLs)
  // imply it. It holds for the whole page life on top of the player's settings: setVolume cannot
  // undo it, the context may run but the master gain stays 0.
  // main.js also passes forceMute (its own reading of the same URL); either one is enough.
  const qaMute = !!opts.forceMute || qaMuted(typeof location !== 'undefined' ? location.search : '');
  const silent = () => vol.muted || qaMute;

  /** @type {AudioContext|null} */
  let ctx = null;
  let master, comp, slowLp, sfxBus, musicBus, musicLp, wetIn, sfx, music, humGain, humOsc;
  let rd = null;
  let wanted = null;          // track to play once the context runs
  let paused = false;         // game pause (duck), not the context state
  let roared = false;
  let rally = 0;
  let lastBrickAt = -1e9;
  let lastCombo = 0;
  let duckUntil = 0;
  let retry = 0;
  let overAt = 0;             // when to switch to the run-over theme (ctx time), 0 = no
  const samples = Object.create(null); // SFX_FILES name → AudioBuffer once loaded
  const lastPlay = Object.create(null);
  const ends = new Float64Array(RING);
  let endsI = 0;
  const stats = { played: 0, skipped: 0, last: '', unlocked: false, events: 0 };

  function pick(s) {
    const o = {};
    if (Number.isFinite(s.music)) o.music = Math.min(1, Math.max(0, s.music));
    if (Number.isFinite(s.sfx)) o.sfx = Math.min(1, Math.max(0, s.sfx));
    if (typeof s.muted === 'boolean') o.muted = s.muted;
    return o;
  }

  // ---------------------------------------------------------------- the graph
  function build() {
    const t = ctx.currentTime;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 8;
    comp.ratio.value = 10;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.setValueAtTime(silent() ? 0 : 1, t);
    slowLp = ctx.createBiquadFilter();
    slowLp.type = 'lowpass';
    slowLp.frequency.value = 20000;
    slowLp.Q.value = 0.5;
    master.connect(slowLp);
    slowLp.connect(comp);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = vol.sfx;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = vol.music * 0.7;
    musicLp = ctx.createBiquadFilter();
    musicLp.type = 'lowpass';
    musicLp.frequency.value = 20000;
    musicBus.connect(musicLp);
    musicLp.connect(master);
    // A small dark room for the sfx (generated impulse, 2 s).
    const rev = ctx.createConvolver();
    rev.buffer = impulse(2.0, 3.2);
    wetIn = ctx.createGain();
    wetIn.gain.value = 1;
    const wetOut = ctx.createGain();
    wetOut.gain.value = 0.32;
    wetIn.connect(rev);
    rev.connect(wetOut);
    wetOut.connect(sfxBus);
    sfx = createSfx(ctx, sfxBus, wetIn);
    loadSamples();
    music = createMusic(ctx, musicBus, { white: noiseBuf(2, false), brown: noiseBuf(4, true) }, { lean: lean() });
    // Pull hum: always running, heard only while pulling.
    humGain = ctx.createGain();
    humGain.gain.value = 0;
    const hlp = ctx.createBiquadFilter();
    hlp.type = 'lowpass';
    hlp.frequency.value = 320;
    humGain.connect(sfxBus);
    hlp.connect(humGain);
    humOsc = ctx.createOscillator();
    humOsc.type = 'sawtooth';
    humOsc.frequency.value = 55;
    humOsc.connect(hlp);
    humOsc.start();
    const sub = ctx.createOscillator();
    sub.frequency.value = 110;
    const sg = ctx.createGain();
    sg.gain.value = 0.5;
    sub.connect(sg);
    sg.connect(hlp);
    sub.start();
  }

  /** Linear 150 ms fade from wherever the param is now. */
  function fadeTo(param, value, now) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + 0.15);
  }

  /** The few sound files (small): fetched and decoded once. */
  function loadSamples() {
    if (typeof fetch === 'undefined') return;
    for (const name of Object.keys(SFX_FILES)) {
      fetch(SFX_FILES[name].path)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((ab) => (ab ? ctx.decodeAudioData(ab) : null))
        .then((buf) => {
          if (buf) samples[name] = buf;
        })
        .catch(() => {});
    }
  }

  /** Play a loaded sound file; false if it is not loaded (the caller synthesises instead). */
  function sample(name, t, dest = sfxBus) {
    const buf = samples[name];
    if (!buf) return false;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = SFX_FILES[name].gain;
    s.connect(g);
    g.connect(dest);
    s.start(t);
    return true;
  }

  function impulse(seconds, decay) {
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  function noiseBuf(seconds, brown) {
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  // ---------------------------------------------------------------- unlock and lifecycle
  function unlock() {
    if (typeof window === 'undefined') return;
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch { /* not supported */ }
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      build();
      ctx.onstatechange = onState;
      music.unlock(); // inside the gesture: the streamed tracks may play later without one (iOS)
      if (wanted !== undefined) music.play(wanted);
    } else music.unlock(); // nothing once it has worked
    if (ctx.state !== 'running' && !document.hidden) ctx.resume().catch(() => {});
    if (!stats.unlocked) {
      // iOS: a silent buffer played inside the gesture opens the output.
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
      stats.unlocked = true;
    }
  }

  function onState() {
    if (!ctx) return;
    if ((ctx.state === 'interrupted' || ctx.state === 'suspended') && !document.hidden) scheduleRetry();
  }

  function scheduleRetry() {
    if (retry) return;
    retry = setTimeout(() => {
      retry = 0;
      if (!ctx || ctx.state === 'running' || document.hidden) return;
      ctx.resume().catch(() => {});
      scheduleRetry();
    }, 1000);
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const gesture = () => unlock();
    for (const type of ['pointerdown', 'touchend', 'keydown', 'mousedown']) {
      window.addEventListener(type, gesture, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend().catch(() => {});
      else ctx.resume().catch(() => {});
    });
  }

  // ---------------------------------------------------------------- playing sounds
  /** Cooldown and voice budget; records the voice. */
  function allow(name, now) {
    const gap = COOLDOWN[name] ?? 0.03;
    const prev = lastPlay[name];
    if (prev !== undefined && now - prev < gap) {
      stats.skipped++;
      return false;
    }
    if (LOW.has(name)) {
      let busy = 0;
      for (let i = 0; i < RING; i++) if (ends[i] > now) busy++;
      if (busy >= MAX_VOICES) {
        stats.skipped++;
        return false;
      }
    }
    lastPlay[name] = now;
    ends[endsI] = now + (LENGTH[name] ?? 0.2);
    endsI = (endsI + 1) % RING;
    stats.played++;
    stats.last = name;
    return true;
  }

  function comboNote(world) {
    const c = world ? world.econ.combo : 0;
    return Math.floor(Math.min(c, 50) / 5);
  }

  function handle(world, t) {
    const now = ctx.currentTime;
    switch (rd.type) {
      case EV.BRICK_BROKEN: {
        if (now - lastBrickAt < 1.5) rally = Math.min(9, rally + 1);
        else rally = 0;
        lastBrickAt = now;
        if (allow('brick', now)) sfx.brickBreak(t, Math.min(19, comboNote(world) + rally), rd.x);
        break;
      }
      case EV.BRICK_DAMAGED:
        if (allow('hit', now)) sfx.brickHit(t, comboNote(world) + rally, rd.x);
        break;
      case EV.PADDLE_HIT:
        rally = 0;
        if (rd.b !== 1 && allow('paddle', now)) sfx.paddle(t, rd.a, rd.x);
        break;
      case EV.PERFECT_HIT:
        if (allow('perfect', now)) sfx.perfect(t, rd.x);
        break;
      case EV.WALL_HIT:
        if (allow('wall', now)) sfx.wall(t, rd.a | 0, rd.x);
        break;
      case EV.EMBER_CAUGHT:
        if (allow('ember', now)) sfx.ember(t, comboNote(world), rd.x);
        break;
      case EV.LAUNCH:
      case EV.RELEASE:
        rally = 0;
        if (allow('launch', now)) sfx.launch(t, rd.x);
        break;
      case EV.BALL_LOST:
        if (allow('lost', now)) sfx.nearMiss(t, rd.x);
        break;
      case EV.OUT_OF_BALLS:
        if (allow('ballLost', now)) sfx.ballLost(t, world ? world.paddle.x : 360);
        break;
      case EV.LIFE_LOST:
        if (allow('lifeLost', now)) sfx.lifeLost(t + 0.25);
        break;
      case EV.LIFE_GAINED:
        if (allow('lifeGained', now)) sfx.lifeGained(t);
        break;
      case EV.COMBO_STEP:
        if (allow('combo', now)) sfx.comboStep(t, rd.a, comboNote(world));
        break;
      case EV.COMBO_HALVED:
        if (lastCombo > 0 && allow('comboDown', now)) sfx.comboDown(t + 0.1);
        break;
      case EV.DROP_SPAWNED:
        if (allow('dropSpawn', now)) sfx.dropSpawn(t, rd.x);
        break;
      case EV.DROP_CAUGHT:
        if (allow('drop', now)) sfx.dropCatch(t, DROP_FAMILY[rd.a | 0] || 'heat', rd.x);
        break;
      case EV.EFFECT_OFF:
        if (allow('effectOff', now)) sfx.effectOff(t);
        break;
      case EV.HEAT_FULL:
        if (allow('heatFull', now)) sfx.heatFull(t);
        break;
      case EV.EXPLOSION:
        if (allow('explosion', now)) sfx.explosion(t, rd.x);
        break;
      case EV.LASER_FIRED:
        if (allow('laser', now)) sfx.laser(t, rd.x);
        break;
      case EV.OVERLOAD_FIRED:
        if (allow('overload', now)) sfx.overload(t, rd.a | 0);
        break;
      case EV.SHIELD_USED:
      case EV.FREE_MISS:
        if (allow('shield', now)) sfx.shield(t, false);
        break;
      case EV.SHIELD_BOUGHT:
        if (allow('shield', now)) sfx.shield(t, true);
        break;
      case EV.SHIELD_GONE:
        if (allow('effectOff', now)) sfx.effectOff(t);
        break;
      case EV.SENTRY_HIT:
        if (allow('clank', now)) sfx.clank(t, false, rd.x);
        break;
      case EV.SENTRY_KILLED:
        if (allow('clank', now)) sfx.clank(t, false, rd.x);
        if (allow('explosion', now)) sfx.explosion(t + 0.02, rd.x);
        break;
      case EV.BOSS_HIT:
        if (allow('bigClank', now)) sfx.clank(t, true, rd.x);
        break;
      case EV.BOSS_PHASE:
        if (allow('bossPhase', now)) sfx.bossPhase(t);
        break;
      case EV.BOSS_DEFEATED:
        if (allow('roar', now)) sfx.fireRoar(t);
        if (allow('blast', now)) sfx.clearBlast(t + 0.2);
        duckUntil = now + 1.4;
        break;
      case EV.HAZARD_HIT:
        if (allow('hazard', now)) sfx.hazard(t, rd.x);
        break;
      case EV.PORTAL:
        if (allow('portal', now)) sfx.portal(t, rd.x);
        break;
      case EV.GRAVITY_LAND:
        if (allow('land', now)) sfx.land(t, rd.x);
        break;
      case EV.TIMER:
        if (rd.a > 0 && rd.a <= 5 && allow('tick', now)) sfx.tick(t, rd.a <= 1);
        break;
      case EV.NEAR_MISS:
        if (allow('nearMiss', now)) sfx.nearMiss(t, rd.x);
        break;
      case EV.CAVITY_OPENED:
        if (allow('cavity', now)) sfx.cavity(t, rd.x);
        break;
      case EV.LAST_BRICK:
        if (!roared && allow('roar', now)) sfx.fireRoar(t);
        roared = true;
        break;
      case EV.LEVEL_CLEARED:
        if (!roared && allow('roar', now)) sfx.fireRoar(t);
        roared = true;
        if (allow('blast', now)) sfx.clearBlast(t + 0.05);
        if (allow('victory', now)) sample('victory', t + 1.1);
        duckUntil = now + 2.6;
        break;
      case EV.RUN_OVER:
        overAt = now + 1.6; // after the life-lost tone, the run-over theme
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- the Audio interface
  const api = {
    unlock,

    setWorld(world) {
      rd = rd ? resetReader(rd, world.bus, world.bus.head) : createReader(world.bus, 'audio', world.bus.head);
      roared = false;
      rally = 0;
      overAt = 0;
      lastCombo = world.econ ? world.econ.combo : 0;
      api.music(trackFor(world.level && world.level.def));
    },

    frame(world, realDt) {
      if (!ctx || ctx.state !== 'running') {
        // Nothing can sound: drop the events so they do not burst out on unlock.
        if (rd) rd.cur = rd.bus.head;
        return;
      }
      const now = ctx.currentTime;
      let ref = -1;
      while (rd && next(rd)) {
        stats.events++;
        if (ref < 0) ref = rd.at;
        // Spread the events of the steps this frame ran over their own sim time.
        const t = now + 0.006 + Math.min(0.07, (rd.at - ref) / 120);
        handle(world, t);
        if (rd.type === EV.COMBO_HALVED || rd.type === EV.COMBO_STEP) lastCombo = world ? world.econ.combo : 0;
      }
      if (world) lastCombo = world.econ.combo;
      // Pull hum follows the paddle; slow-mo muffles everything; the clear blast ducks the music.
      const pulling = world && world.paddle.pulling;
      humGain.gain.setTargetAtTime(pulling ? 0.13 : 0, now, pulling ? 0.04 : 0.09);
      if (world) humOsc.frequency.setTargetAtTime(48 + 22 * (world.econ.heat / Math.max(1, world.econ.heatMax)), now, 0.1);
      const slow = world && world.timeScale < 0.99;
      slowLp.frequency.setTargetAtTime(slow ? 2200 : 20000, now, slow ? 0.05 : 0.15);
      if (overAt && now >= overAt) {
        overAt = 0;
        api.music('over');
      }
      const duck = now < duckUntil ? 0.45 : 1;
      const pauseDuck = paused ? 0.35 : 1;
      // Dips and volume changes are quick; the swell back after a duck is slow.
      const swell = duck === 1 && !paused && now < duckUntil + 1.5;
      musicBus.gain.setTargetAtTime(vol.music * 0.7 * duck * pauseDuck, now, swell ? 0.4 : 0.05);
      musicLp.frequency.setTargetAtTime(paused ? 700 : 20000, now, 0.12);
      music.update(world ? world.fx.heatLevel : 0, realDt || 0);
    },

    music(track) {
      wanted = track;
      if (music) music.play(track);
    },

    /** Volumes 0…1 and mute; changes fade over 150 ms (never a click). */
    setVolume(v = {}) {
      Object.assign(vol, pick(v));
      if (!ctx) return;
      const now = ctx.currentTime;
      fadeTo(master.gain, silent() ? 0 : 1, now);
      fadeTo(sfxBus.gain, vol.sfx, now);
      // The music bus is steered every frame (ducks); frame() follows vol.music from here on.
    },

    /** Game paused: duck and muffle the music; menu sounds still play. */
    suspend() {
      paused = true;
    },

    resume() {
      paused = false;
      if (ctx && ctx.state !== 'running' && !document.hidden) ctx.resume().catch(() => {});
    },

    /** Menu sound for D's screens: 'click' 'open' 'back' 'confirm' 'buy' 'deny' 'pick'. */
    ui(name = 'click') {
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (!allow('ui', now)) return;
      if ((name === 'hover' || name === 'pick') && sample('hover', now + 0.003)) return;
      sfx.ui(now + 0.003, name);
    },

    /** QA readout (window.__kiln.audio.state). */
    get state() {
      const m = music ? music.state : { track: null, full: 0, target: 0 };
      return {
        context: ctx ? ctx.state : 'none',
        unlocked: stats.unlocked,
        paused,
        volume: { ...vol },
        qaMute,
        silent: silent(),
        track: m.track || wanted || null,
        source: m.source || null,
        full: Math.round(m.full * 1000) / 1000,
        target: Math.round(m.target * 1000) / 1000,
        decoded: m.decoded || 0, // music files held decoded (the current pair's mixes, the drone)
        decodedBytes: m.decodedBytes || 0, // their samples: length x channels x 4 bytes
        streaming: !!m.streaming, // a one-mix track playing from the media element (not decoded)
        lean: !!m.lean, // decoded at 22.05 kHz (phones)
        played: stats.played,
        skipped: stats.skipped,
        events: stats.events,
        last: stats.last,
      };
    },
  };
  return api;
}
