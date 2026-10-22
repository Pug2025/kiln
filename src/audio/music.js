// Kiln: adaptive music (OWNER: E).
//
// Track map (PLAN §7 "Music"): title Machina; Ember Nightfall; Blaze Resonance; White Heat Red;
// bosses Ambush; Overburn Legacy; the Rusted Studio drone always underneath. For tracks with a
// stripped mix, both mixes start together on one AudioContext clock (same `when`, loop on) and
// crossfade by gain: full = smoothstep(0.35, 0.75, heat), smoothed over 2 s; tracks without a
// stripped mix play whole over the drone.
//
// Memory (a 4-minute stereo track is 54-67 MB of float samples at 32 kHz): only the pairs, which
// need sample alignment, are decoded, one mix after the other, at 32 kHz through an
// OfflineAudioContext (22.05 kHz on phones, `lean`); only the current pair stays decoded. Tracks
// with one mix (Machina, Ambush, Legacy, Transmission) stream through one reused media element
// from a blob URL (the compressed file, 1-4 MB; a blob serves the element's range requests, which a
// service worker's cached response would not), routed into the same graph; if the page cannot
// stream (no element, or play() refused) they decode like the pairs. A track whose file is missing
// or fails to load falls back to a synthesised placeholder: a pad layer (the "stripped mix") and a
// pulse layer (the "full mix" extras) on a lookahead scheduler, crossfaded by the same curve. The
// drone is synthesised until its file is shipped (MUSIC_FILES.drone).
// After a run ends, 'over' plays SRG774's "Transmission" under the results.
//
// The pure helpers (trackFor, fullMixTarget, slew, layerGains, smoothstep) run in Node for tests.

export const TRACKS = Object.freeze({
  title: Object.freeze({ title: 'Machina', page: 'https://www.scottbuckley.com.au/library/machina/', full: 'machina', stripped: null, strippedName: null }),
  ember: Object.freeze({ title: 'Nightfall', page: 'https://www.scottbuckley.com.au/library/nightfall/', full: 'nightfall', stripped: 'nightfall-no-solo-strings', strippedName: 'No Solo Strings' }),
  blaze: Object.freeze({ title: 'Resonance', page: 'https://www.scottbuckley.com.au/library/resonance/', full: 'resonance', stripped: 'resonance-no-melody-in-backend', strippedName: 'No Melody in Backend' }),
  whiteheat: Object.freeze({ title: 'Red', page: 'https://www.scottbuckley.com.au/library/red/', full: 'red', stripped: 'red-no-vocals', strippedName: 'No Vocals' }),
  boss: Object.freeze({ title: 'Ambush', page: 'https://www.scottbuckley.com.au/library/ambush/', full: 'ambush', stripped: null, strippedName: null }),
  overburn: Object.freeze({ title: 'Legacy', page: 'https://www.scottbuckley.com.au/library/legacy/', full: 'legacy', stripped: null, strippedName: null }),
});
export const TRACK_NAMES = Object.freeze(Object.keys(TRACKS));

/** Themes outside the level map: 'over' plays after a run ends (results screen). */
export const THEMES = Object.freeze({
  over: Object.freeze({ title: 'Transmission', page: 'https://opengameart.org/content/dark-sci-fi-audio-pack', full: 'transmission', stripped: null, strippedName: null }),
});
const ALL = Object.freeze({ ...TRACKS, ...THEMES });

export const DRONE = Object.freeze({
  title: 'Free Music ATMOS – Linear Atmospheres',
  page: 'https://rustedstudio.itch.io/free-music-atmos-linear-atmospheres',
  file: 'drone',
});

/**
 * Shipped music files by name → path, relative to index.html. Every file listed here has a line in
 * audio/music/SOURCES.md (tests/e-credits.test.mjs checks both ways).
 * @type {Readonly<Record<string, string>>}
 */
export const MUSIC_FILES = Object.freeze({
  machina: 'audio/music/machina.m4a',
  nightfall: 'audio/music/nightfall.m4a',
  'nightfall-no-solo-strings': 'audio/music/nightfall-no-solo-strings.m4a',
  resonance: 'audio/music/resonance.m4a',
  'resonance-no-melody-in-backend': 'audio/music/resonance-no-melody-in-backend.m4a',
  red: 'audio/music/red.m4a',
  'red-no-vocals': 'audio/music/red-no-vocals.m4a',
  ambush: 'audio/music/ambush.m4a',
  legacy: 'audio/music/legacy.m4a',
  transmission: 'audio/music/transmission.m4a',
});

/** Sample rate music is decoded at (memory: 4 min stereo ≈ 61 MB at 32 kHz, 92 MB at 48 kHz). */
export const DECODE_RATE = 32000;
/** Phones (`lean`): a pair at 22.05 kHz holds 69% of the 32 kHz samples (Nightfall 92 MB, not 134). */
export const LEAN_RATE = 22050;

/** Bytes of samples a decoded AudioBuffer holds (float32 per channel). */
export function bufferBytes(b) {
  return b && b.length > 0 && b.numberOfChannels > 0 ? b.length * b.numberOfChannels * 4 : 0;
}

/** A track with one mix needs no sample alignment, so it can stream instead of being decoded. */
export function streamable(name) {
  const t = ALL[name];
  return !!t && !t.stripped;
}

/**
 * Phones and small-memory devices decode at LEAN_RATE. `?music=lean` / `?music=full` force it.
 * @param {string} [search] location.search
 * @param {{deviceMemory?:number, userAgent?:string, maxTouchPoints?:number, platform?:string}} [nav]
 * @param {boolean} [coarse] matchMedia('(pointer: coarse)').matches
 */
export function leanMusic(search = '', nav = {}, coarse = false) {
  const q = new URLSearchParams(search || '').get('music');
  if (q === 'lean') return true;
  if (q === 'full') return false;
  if (nav.deviceMemory > 0 && nav.deviceMemory <= 4) return true;
  if (/iPhone|iPad|iPod|Android/i.test(nav.userAgent || '')) return true;
  if (nav.maxTouchPoints > 1 && /Mac/.test(nav.platform || '')) return true; // iPadOS reports a Mac
  return !!coarse;
}

// A tenth of a second of silence (8 kHz mono 16-bit WAV): played inside the first gesture so the
// media element may play later without one (iOS Safari keeps that permission per element).
export const SILENT_WAV = 'data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAG' + 'A'.repeat(2136);

/**
 * Track switches. A playing file track fades out over FILE_S and its sources stop and are dropped
 * before the next track's files are fetched and decoded, and a decode still in flight for a track
 * no longer wanted is let finish (and thrown away) first: two decoded pairs are never held at once
 * (a pair is 110-134 MB of samples; Ambush alone 107 MB). The drone carries the gap. A synthesised
 * track holds no samples and keeps its long fade.
 */
export const SWITCH_FADE = Object.freeze({ FILE_S: 0.3, SYNTH_S: 1.4 });

export const CROSSFADE = Object.freeze({ EDGE0: 0.35, EDGE1: 0.75, SMOOTH_S: 2 });

/** Hermite smoothstep. */
export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Full-mix share 0…1 for a heat level 0…1 (fx.heatLevel). */
export function fullMixTarget(heatLevel) {
  return smoothstep(CROSSFADE.EDGE0, CROSSFADE.EDGE1, heatLevel);
}

/**
 * Move `cur` toward `target` at most dt / seconds per call: a full swing takes `seconds`. A dt that
 * is not a positive number (a clock that stepped back) moves nothing.
 */
export function slew(cur, target, dt, seconds = CROSSFADE.SMOOTH_S) {
  if (!(dt > 0)) return cur;
  const step = dt / seconds;
  const d = target - cur;
  if (d > step) return cur + step;
  if (d < -step) return cur - step;
  return target;
}

/**
 * Gains for the two mixes. Real files: stripped 1 − x, full x (same music, so equal-gain).
 * Tracks without a stripped mix: the one file at 1.
 */
export function layerGains(x, hasStripped, out = { stripped: 0, full: 0 }) {
  if (hasStripped) {
    out.stripped = 1 - x;
    out.full = x;
  } else {
    out.stripped = 0;
    out.full = 1;
  }
  return out;
}

/**
 * The track for a level: bosses → 'boss', Overburn → 'overburn', else the world's track.
 * @param {import('../core/types.js').LevelDef|null|undefined} def
 */
export function trackFor(def) {
  if (!def) return 'title';
  if (def.kind === 'boss' || def.boss || def.n === 10 || def.n === 20 || def.n === 30) return 'boss';
  if (def.world === 'overburn' || def.n > 30) return 'overburn';
  if (def.world === 'ember' || def.world === 'blaze' || def.world === 'whiteheat') return def.world;
  const n = def.n | 0;
  return n <= 10 ? 'ember' : n <= 20 ? 'blaze' : 'whiteheat';
}

/** True when both files of a track (or its single file) are shipped. */
export function hasFiles(name, files = MUSIC_FILES) {
  const t = ALL[name];
  if (!t) return false;
  return !!files[t.full] && (!t.stripped || !!files[t.stripped]);
}

// ------------------------------------------------------------------ placeholder synth score
// Chords as semitones from C3; each lasts two bars. C minor family so everything sits on the
// drone's C and the bricks' C minor pentatonic.
const CM = [0, 3, 7], AB = [-4, 0, 3], EB = [3, 7, 10], BB = [-2, 2, 5], FM = [5, 8, 12],
  G = [7, 11, 14], DB = [1, 5, 8];
export const SYNTH = Object.freeze({
  title: { bpm: 72, chords: [CM, AB, FM, G], extraFixed: 0.3, cutoff: 900 },
  ember: { bpm: 90, chords: [CM, AB, EB, BB], extraFixed: -1, cutoff: 1000 },
  blaze: { bpm: 108, chords: [CM, BB, AB, G], extraFixed: -1, cutoff: 1200 },
  whiteheat: { bpm: 126, chords: [CM, DB, AB, G], extraFixed: -1, cutoff: 1400 },
  boss: { bpm: 138, chords: [CM, CM, DB, G], extraFixed: 1, cutoff: 1500 },
  overburn: { bpm: 118, chords: [CM, AB, EB, G], extraFixed: 1, cutoff: 1300 },
  over: { bpm: 60, chords: [CM, AB, FM, CM], extraFixed: 0, cutoff: 700 },
});
const C3 = 130.81;
const hz = (semi) => C3 * Math.pow(2, semi / 12);
const PENT = [0, 3, 5, 7, 10];
const LOOKAHEAD_S = 0.3;
const EPS = 0.0001;

/**
 * The music engine. Presentation only.
 * @param {AudioContext} ctx
 * @param {AudioNode} out  music bus
 * @param {{white:AudioBuffer, brown:AudioBuffer}} noise
 * @param {{fileFadeS?:number, lean?:boolean, stream?:boolean, makeElement?:()=>HTMLAudioElement}} [opts]
 *   fileFadeS: tests shorten the file fade; lean: decode at LEAN_RATE (phones); stream: single-mix
 *   tracks through a media element (default: when the page has Audio and createMediaElementSource);
 *   makeElement: tests pass a stand-in element
 */
export function createMusic(ctx, out, noise, opts = {}) {
  const fileFadeS = opts.fileFadeS ?? SWITCH_FADE.FILE_S;
  const rate = opts.lean ? LEAN_RATE : DECODE_RATE;
  const makeElement = opts.makeElement || (() => new Audio());
  let canStream = opts.stream ?? (typeof Audio !== 'undefined' && typeof ctx.createMediaElementSource === 'function');
  let freed = Promise.resolve(); // resolves once the last stopped file track's sources are gone
  let current = null;        // playing track instance
  let x = 0;                 // smoothed full-mix share
  let target = 0;
  const gains = { stripped: 0, full: 0 };
  const buffers = new Map(); // name → AudioBuffer (current world's mixes and the drone only)
  let needed = [];           // file names the current track plays (the drone is always kept)
  const keeps = (name) => name === DRONE.file || needed.includes(name);

  // ---------------------------------------------------------------- drone (always on)
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0;
  droneGain.connect(out);
  let droneStarted = false;
  function startDrone() {
    if (droneStarted) return;
    droneStarted = true;
    const t = ctx.currentTime;
    droneGain.gain.setValueAtTime(EPS, t);
    droneGain.gain.exponentialRampToValueAtTime(0.5, t + 3);
    if (MUSIC_FILES[DRONE.file]) {
      loadBuffer(DRONE.file).then((buf) => {
        if (!buf) return synthDrone();
        const s = ctx.createBufferSource();
        s.buffer = buf;
        s.loop = true;
        s.connect(droneGain);
        s.start();
      });
    } else synthDrone();
  }
  function synthDrone() {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    lp.Q.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 90;
    lfo.connect(lfoAmt);
    lfoAmt.connect(lp.frequency);
    lfo.start();
    const mix = ctx.createGain();
    mix.gain.value = 0.32;
    lp.connect(mix);
    mix.connect(droneGain);
    for (const [type, f, det, g] of [['sawtooth', 32.7, -6, 0.5], ['sawtooth', 65.41, 5, 0.35], ['sine', 32.7, 0, 0.8], ['triangle', 98.0, 3, 0.12]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og);
      og.connect(lp);
      o.start();
    }
    // Kiln air: very quiet low noise.
    const s = ctx.createBufferSource();
    s.buffer = noise.brown;
    s.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 380;
    const ng = ctx.createGain();
    ng.gain.value = 0.25;
    s.connect(nf);
    nf.connect(ng);
    ng.connect(droneGain);
    s.start();
  }

  // ---------------------------------------------------------------- files
  const pending = new Map(); // name → Promise<AudioBuffer|null> while loading

  /** Decode at DECODE_RATE (LEAN_RATE on phones) through an OfflineAudioContext; else the live context. */
  function decode(ab) {
    const OAC = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext
      : typeof webkitOfflineAudioContext !== 'undefined' ? webkitOfflineAudioContext : null; // eslint-disable-line no-undef
    if (OAC) {
      try {
        const off = new OAC(2, rate, rate);
        return off.decodeAudioData(ab.slice(0)).catch(() => ctx.decodeAudioData(ab));
      } catch {
        /* this browser will not make a 32 kHz offline context */
      }
    }
    return ctx.decodeAudioData(ab);
  }

  function loadBuffer(name) {
    if (buffers.has(name)) return Promise.resolve(buffers.get(name));
    if (pending.has(name)) return pending.get(name);
    const url = MUSIC_FILES[name];
    if (!url || typeof fetch === 'undefined') return Promise.resolve(null);
    const p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((ab) => (ab ? decode(ab) : null))
      .then((buf) => {
        pending.delete(name);
        // A decode that finishes after its track was switched away is not kept: only the names
        // the current track plays stay decoded (a 4-minute pair is about 130 MB of samples).
        if (buf && keeps(name)) buffers.set(name, buf);
        return buf || null;
      })
      .catch(() => {
        pending.delete(name);
        return null;
      });
    pending.set(name, p);
    return p;
  }

  /**
   * Fetch and decode a track's files one after the other: a decode briefly holds about twice its
   * result (the decoder's output, then the AudioBuffer), so two at once doubled the peak at a switch.
   * Stops early (null) if the track is switched away between files.
   */
  async function loadInTurn(names, inst) {
    const bufs = [];
    for (const name of names) {
      if (inst.dead) return null;
      const b = await loadBuffer(name);
      bufs.push(b);
      if (!b) break; // missing or undecodable: the caller falls back, no need for the rest
    }
    return bufs;
  }

  /** The current track plays these names: keep them (and the drone) decoded, release the rest. */
  function release(keep) {
    needed = keep;
    for (const k of [...buffers.keys()]) if (!keeps(k)) buffers.delete(k);
  }

  function fileTrack(name) {
    const meta = ALL[name];
    const inst = makeInstance(name, !!meta.stripped);
    inst.kind = 'loading';
    const names = meta.stripped ? [meta.full, meta.stripped] : [meta.full];
    release(names);
    // Wait for the old track's sources to stop and for any decode this track does not want.
    const busy = [freed];
    for (const [k, p] of pending) if (!names.includes(k)) busy.push(p);
    Promise.all(busy).then(() => (inst.dead ? null : loadInTurn(names, inst))).then((bufs) => {
      if (!bufs || inst.dead) return;
      if (bufs.some((b) => !b)) {
        // Missing or undecodable: the placeholder keeps the level scored.
        if (current === inst) {
          stopInstance(inst);
          current = synthTrack(name);
        }
        return;
      }
      inst.kind = 'file';
      const when = ctx.currentTime + 0.12; // one clock, one `when`: sample-aligned
      const g = inst.master.gain;
      g.cancelScheduledValues(0);
      g.setValueAtTime(EPS, when);
      g.exponentialRampToValueAtTime(1, when + 1.2);
      const srcs = bufs.map((b, i) => {
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.loop = true;
        s.connect(i === 0 ? inst.full : inst.stripped);
        s.start(when);
        return s;
      });
      inst.stop = (t) => srcs.forEach((s) => { try { s.stop(t); } catch { /* already stopped */ } });
      inst.drop = () => {
        for (const s of srcs) { try { s.disconnect(); } catch { /* gone */ } }
        srcs.length = 0; // nothing here holds the samples any more
        inst.stop = null;
      };
    });
    return inst;
  }

  // ---------------------------------------------------------------- streamed tracks (one mix)
  // One media element for the page life (iOS lets an element play without a gesture once it has
  // played inside one), routed through a MediaElementAudioSourceNode into the playing instance.
  const streamer = { el: null, node: null, url: '', owner: null, blessed: false };

  function element() {
    if (streamer.el || !canStream) return streamer.el;
    try {
      const el = makeElement();
      el.loop = true;
      el.preload = 'auto';
      streamer.node = ctx.createMediaElementSource(el);
      streamer.el = el;
    } catch {
      canStream = false; // decode instead
    }
    return streamer.el;
  }

  /** Release the element from `inst` (if it still has it): pause, unroute. */
  function unstream(inst) {
    if (streamer.owner !== inst) return;
    streamer.owner = null;
    try { streamer.el.pause(); } catch { /* gone */ }
    try { streamer.node.disconnect(); } catch { /* not connected */ }
  }

  /** The compressed file as a blob URL (the element seeks inside it; no network range requests). */
  function blobUrl(name) {
    const url = MUSIC_FILES[name];
    if (!url || typeof fetch === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return Promise.resolve(null);
    return fetch(url)
      .then((r) => (r.ok ? r.blob() : null))
      // Safari will not play a blob with no type; a server that sends none gets AAC's.
      .then((b) => (b ? URL.createObjectURL(b.type ? b : new Blob([b], { type: 'audio/mp4' })) : null))
      .catch(() => null);
  }

  function streamTrack(name) {
    const meta = ALL[name];
    const inst = makeInstance(name, false);
    inst.kind = 'loading';
    release([]); // nothing decoded for this track
    const busy = [freed, ...pending.values()];
    Promise.all(busy).then(() => (inst.dead ? null : blobUrl(meta.full))).then((url) => {
      if (inst.dead || !url) {
        if (url) URL.revokeObjectURL(url);
        if (!inst.dead && current === inst) fallback(inst, name);
        return null;
      }
      const el = element();
      if (!el) {
        URL.revokeObjectURL(url);
        if (current === inst) fallback(inst, name);
        return null;
      }
      if (streamer.owner) unstream(streamer.owner);
      if (streamer.url) URL.revokeObjectURL(streamer.url);
      streamer.url = url;
      streamer.owner = inst;
      el.src = url;
      el.loop = true;
      streamer.node.connect(inst.full);
      inst.drop = () => unstream(inst);
      return Promise.resolve(el.play()).then(() => {
        if (inst.dead) return unstream(inst);
        inst.kind = 'stream';
        const t = ctx.currentTime;
        const g = inst.master.gain;
        g.cancelScheduledValues(0);
        g.setValueAtTime(EPS, t);
        g.exponentialRampToValueAtTime(1, t + 1.2);
        return null;
      }, (err) => {
        unstream(inst);
        // Refused (no gesture permission, or the format): decode from here on. An AbortError only
        // means a newer track took the element.
        if (err && err.name === 'AbortError') return null;
        canStream = false;
        if (!inst.dead && current === inst) fallback(inst, name);
        return null;
      });
    });
    return inst;
  }

  /** The stream could not start: decode the file instead (or the placeholder if that fails). */
  function fallback(inst, name) {
    inst.dead = true;
    try { inst.master.disconnect(); } catch { /* gone */ }
    current = fileTrack(name);
  }

  /**
   * Call inside the first user gesture: the media element plays a moment of silence so it may play
   * later without one (iOS). Harmless elsewhere; repeated calls do nothing once it worked.
   */
  function unlockStream() {
    if (streamer.blessed) return;
    const el = element();
    if (!el) return;
    streamer.blessed = true;
    try {
      if (!streamer.owner) el.src = SILENT_WAV;
      Promise.resolve(el.play()).then(() => {
        if (!streamer.owner) el.pause();
      }, () => {
        if (!streamer.owner) streamer.blessed = false; // try again on the next gesture
      });
    } catch {
      streamer.blessed = false;
    }
  }

  // A hidden page suspends the context (audio.js); the element pauses with it and picks up after.
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      const el = streamer.el;
      if (!el || !streamer.owner) return;
      if (document.hidden) el.pause();
      else Promise.resolve(el.play()).catch(() => {});
    });
  }

  // ---------------------------------------------------------------- track instances
  function makeInstance(name, hasStripped) {
    const master = ctx.createGain();
    const t = ctx.currentTime;
    master.gain.setValueAtTime(EPS, t);
    master.gain.exponentialRampToValueAtTime(1, t + 1.5);
    master.connect(out);
    const stripped = ctx.createGain();
    const full = ctx.createGain();
    stripped.gain.value = hasStripped ? 1 : 0;
    full.gain.value = hasStripped ? 0 : 1;
    stripped.connect(master);
    full.connect(master);
    return { name, hasStripped, master, stripped, full, kind: 'synth', dead: false, stop: null, drop: null };
  }

  function synthTrack(name) {
    const inst = makeInstance(name, true);
    const p = SYNTH[name];
    inst.p = p;
    inst.beat = 0;
    inst.next = ctx.currentTime + 0.1;
    inst.spb = 60 / p.bpm;
    // Shared pad filter with a slow sweep.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.cutoff;
    lp.Q.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const amt = ctx.createGain();
    amt.gain.value = p.cutoff * 0.35;
    lfo.connect(amt);
    amt.connect(lp.frequency);
    lfo.start();
    lp.connect(inst.stripped);
    inst.padIn = lp;
    inst.lfo = lfo;
    const bassLp = ctx.createBiquadFilter();
    bassLp.type = 'lowpass';
    bassLp.frequency.value = 420;
    bassLp.Q.value = 2;
    bassLp.connect(inst.full);
    inst.bassIn = bassLp;
    inst.stop = (when) => { try { lfo.stop(when); } catch { /* stopped */ } };
    // In the placeholder the pad is always there and the pulse layer adds on top, so the
    // "stripped" bus stays at 1 and the "full" bus carries the extras.
    inst.extrasOnly = true;
    return inst;
  }

  function note(type, f, t, dur, peak, attack, release, dest, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    if (detune) o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function hit(buf, type, f, t, dur, peak, dest) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    s.connect(fl);
    fl.connect(g);
    g.connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.02);
  }

  function scheduleBeat(inst, b, t) {
    const p = inst.p;
    const spb = inst.spb;
    const chord = p.chords[Math.floor(b / 8) % p.chords.length];
    // Pad layer: a new chord every two bars.
    if (b % 8 === 0) {
      const dur = spb * 8 + 1.2;
      for (let i = 0; i < chord.length; i++) {
        const f = hz(chord[i]);
        note('sawtooth', f, t, dur, 0.05, 1.2, 1.4, inst.padIn, -7);
        note('sawtooth', f, t, dur, 0.05, 1.2, 1.4, inst.padIn, 7);
      }
      note('sine', hz(chord[0] - 12), t, dur, 0.12, 1.5, 1.4, inst.padIn);
    }
    // A soft bell on each bar: the chord's top note an octave up.
    if (b % 4 === 0) note('triangle', hz(chord[2] + 12), t, spb * 3, 0.035, 0.01, spb * 2.5, inst.stripped);
    // Pulse layer (only scheduled while it can be heard).
    const extra = p.extraFixed >= 0 ? p.extraFixed : Math.max(x, target);
    if (extra < 0.02) return;
    const root = hz(chord[0] - 12);
    for (let e = 0; e < 2; e++) {
      const te = t + e * spb * 0.5;
      note('sawtooth', root, te, spb * 0.45, 0.16, 0.005, spb * 0.35, inst.bassIn);
      if (e === 1) hit(noise.white, 'highpass', 7500, te, 0.035, 0.05, inst.full);
      const step = (b * 2 + e) % 8;
      const deg = [0, 2, 4, 2, 3, 1, 4, 2][step];
      const semi = chord[0] + 24 + PENT[deg];
      note('triangle', hz(semi), te, spb * 0.4, 0.04, 0.004, spb * 0.3, inst.full);
    }
    const inBar = b % 4;
    if (inBar === 0 || inBar === 2) {
      const k = ctx.createOscillator();
      k.frequency.setValueAtTime(130, t);
      k.frequency.exponentialRampToValueAtTime(42, t + 0.16);
      const kg = ctx.createGain();
      kg.gain.setValueAtTime(0.55, t);
      kg.gain.exponentialRampToValueAtTime(EPS, t + 0.22);
      k.connect(kg);
      kg.connect(inst.full);
      k.start(t);
      k.stop(t + 0.25);
    }
    if (inBar === 1 || inBar === 3) hit(noise.white, 'bandpass', 1800, t, 0.12, 0.09, inst.full);
  }

  function stopInstance(inst) {
    if (!inst) return;
    inst.dead = true;
    const file = inst.kind !== 'synth';
    const fade = file ? fileFadeS : SWITCH_FADE.SYNTH_S;
    const t = ctx.currentTime;
    inst.master.gain.cancelScheduledValues(t);
    inst.master.gain.setValueAtTime(Math.max(EPS, inst.master.gain.value), t);
    inst.master.gain.exponentialRampToValueAtTime(EPS, t + fade);
    if (inst.stop) inst.stop(t + fade + 0.02);
    const gone = new Promise((res) => setTimeout(() => {
      try { inst.master.disconnect(); } catch { /* gone */ }
      if (inst.drop) inst.drop();
      res();
    }, (fade + 0.05) * 1000));
    if (inst.kind === 'file' || inst.kind === 'stream' || streamer.owner === inst) freed = gone;
  }

  return {
    /** Start a track by name ('title', 'ember', …) or null for drone only. Same track: no restart. */
    play(name) {
      startDrone();
      if (current && current.name === name) return;
      stopInstance(current);
      current = null;
      if (!name || !ALL[name] || !hasFiles(name)) release([]); // drone only or a synth track
      if (!name || !ALL[name]) return;
      if (!hasFiles(name)) current = synthTrack(name);
      else current = canStream && streamable(name) ? streamTrack(name) : fileTrack(name);
    },

    /** Inside the first user gesture (audio.js unlock): lets the streamed tracks play later. */
    unlock() {
      if (canStream) unlockStream();
    },

    /** Per frame: steer the crossfade from the heat level and keep the synth scheduled. */
    update(heatLevel, dt) {
      target = fullMixTarget(heatLevel);
      x = Math.min(1, Math.max(0, slew(x, target, Math.min(0.1, dt)))); // gains stay 0…1 whatever the clock does
      const inst = current;
      if (!inst) return;
      const t = ctx.currentTime;
      if (inst.kind === 'synth') {
        const fixed = inst.p.extraFixed;
        inst.full.gain.setTargetAtTime(fixed >= 0 ? fixed : x, t, 0.05);
        inst.stripped.gain.setTargetAtTime(1, t, 0.05);
        while (inst.next < t + LOOKAHEAD_S) {
          if (inst.next < t - 0.2) inst.next = t + 0.02; // fell behind (tab asleep): skip ahead
          scheduleBeat(inst, inst.beat, inst.next);
          inst.next += inst.spb;
          inst.beat++;
        }
      } else {
        layerGains(x, inst.hasStripped, gains);
        inst.full.gain.setTargetAtTime(gains.full, t, 0.05);
        inst.stripped.gain.setTargetAtTime(gains.stripped, t, 0.05);
      }
    },

    get state() {
      return {
        track: current ? current.name : null,
        source: current ? current.kind : null,
        full: x,
        target,
        drone: droneStarted,
        decoded: buffers.size,
        decodedBytes: [...buffers.values()].reduce((n, b) => n + bufferBytes(b), 0),
        streaming: !!(streamer.owner && current === streamer.owner && current.kind === 'stream'),
        lean: !!opts.lean,
      };
    },
  };
}
