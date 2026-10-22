// E: music maths and track choice (pure; the Web Audio parts are checked in the browser).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, near } from './lib.mjs';
import { LEVELS, getStage } from '../src/levels/index.js';
import {
  TRACKS, TRACK_NAMES, SYNTH, CROSSFADE, MUSIC_FILES, smoothstep, fullMixTarget, slew, layerGains, trackFor, hasFiles,
  createMusic, bufferBytes, leanMusic, LEAN_RATE, SILENT_WAV,
} from '../src/audio/music.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
import { pentatonicHz, PENTATONIC, panFor } from '../src/audio/sfx.js';
import { createAudio, qaMuted } from '../src/audio/audio.js';

test('crossfade curve: full mix = smoothstep(0.35, 0.75, heat)', () => {
  assert.equal(CROSSFADE.EDGE0, 0.35);
  assert.equal(CROSSFADE.EDGE1, 0.75);
  assert.equal(fullMixTarget(0), 0);
  assert.equal(fullMixTarget(0.35), 0);
  near(fullMixTarget(0.55), 0.5, 1e-9);
  assert.equal(fullMixTarget(0.75), 1);
  assert.equal(fullMixTarget(1), 1);
  let prev = -1;
  for (let h = 0; h <= 1.0001; h += 0.01) {
    const v = fullMixTarget(h);
    assert.ok(v >= prev - 1e-12 && v >= 0 && v <= 1, 'monotonic in 0…1');
    prev = v;
  }
  near(smoothstep(0, 1, 0.25), 0.15625, 1e-12);
});

test('crossfade is smoothed over 2 s: a full swing takes exactly 2 s', () => {
  let x = 0;
  let t = 0;
  while (x < 1) {
    x = slew(x, 1, 1 / 60);
    t += 1 / 60;
    assert.ok(t < 3, 'converges');
  }
  near(t, 2, 1 / 30);
  assert.equal(slew(0.5, 0.5, 0.016), 0.5);
  near(slew(1, 0, 0.5), 0.75, 1e-12);
  // A clock that steps back (a QA advance racing a real frame gave dt = -12 s) moves nothing:
  // it once drove the share to -5, so the mix gains to 6 and -5.
  assert.equal(slew(0.98, 1, -12), 0.98);
  assert.equal(slew(0.4, 1, NaN), 0.4);
  const ctx = fakeContext(1);
  const m = createMusic(ctx, ctx.createGain(), { white: {}, brown: {} });
  m.update(1, 0.05);
  const before = m.state.full;
  m.update(1, -12);
  assert.equal(m.state.full, before);
  for (let i = 0; i < 100; i++) m.update(1, 0.1);
  assert.equal(m.state.full, 1);
});

test('mixes: stripped 1 − x and full x; single-mix tracks play whole', () => {
  assert.deepEqual(layerGains(0.25, true), { stripped: 0.75, full: 0.25 });
  assert.deepEqual(layerGains(0.25, false), { stripped: 0, full: 1 });
  for (const name of ['ember', 'blaze', 'whiteheat']) assert.ok(TRACKS[name].stripped, `${name} has a stripped mix`);
  for (const name of ['title', 'boss', 'overburn']) assert.equal(TRACKS[name].stripped, null);
});

test('track map: titles as PLAN §7 Music', () => {
  const titles = Object.fromEntries(TRACK_NAMES.map((n) => [n, TRACKS[n].title]));
  assert.deepEqual(titles, { title: 'Machina', ember: 'Nightfall', blaze: 'Resonance', whiteheat: 'Red', boss: 'Ambush', overburn: 'Legacy' });
  assert.equal(TRACKS.ember.strippedName, 'No Solo Strings');
  assert.equal(TRACKS.blaze.strippedName, 'No Melody in Backend');
  assert.equal(TRACKS.whiteheat.strippedName, 'No Vocals');
  for (const n of TRACK_NAMES) {
    assert.match(TRACKS[n].page, /^https:\/\/www\.scottbuckley\.com\.au\/library\/[a-z]+\/$/);
    assert.ok(SYNTH[n], `${n} has a placeholder`);
  }
});

test('track for each level and stage', () => {
  assert.equal(trackFor(null), 'title');
  for (let n = 1; n <= 30; n++) {
    const def = { n, world: n <= 10 ? 'ember' : n <= 20 ? 'blaze' : 'whiteheat', kind: n % 10 === 0 ? 'boss' : 'normal' };
    const want = n % 10 === 0 ? 'boss' : def.world;
    assert.equal(trackFor(def), want, `level ${n}`);
  }
  assert.equal(trackFor({ n: 31, world: 'overburn', kind: 'normal' }), 'overburn');
  assert.equal(trackFor({ n: 34 }), 'overburn');
  assert.equal(trackFor({ n: 12 }), 'blaze', 'world falls back to the level number');
  // Whatever B has registered so far resolves to a real track; The Core's stages stay on the boss track.
  for (const def of LEVELS) assert.ok(TRACKS[trackFor(def)], `${def.id} → ${trackFor(def)}`);
  for (const id of ['core-2', 'core-3']) {
    const st = getStage(id);
    if (st) assert.equal(trackFor(st), 'boss');
  }
});

test('every soundtrack ships its files; a track plays from files only with both mixes', () => {
  for (const n of TRACK_NAMES) assert.equal(hasFiles(n), true, `${n} has its files`);
  assert.equal(hasFiles('over'), true, 'run-over theme');
  assert.equal(hasFiles('ember', { nightfall: 'a.m4a', 'nightfall-no-solo-strings': 'b.m4a' }), true);
  assert.equal(hasFiles('ember', { nightfall: 'a.m4a' }), false, 'both mixes or neither');
  assert.equal(hasFiles('nope'), false);
});

test('each stripped mix is the same length as its full mix (sample-aligned crossfade)', () => {
  // AAC in .m4a: the mvhd/mdhd duration is in the file header; equal lengths keep the loops in step.
  const dur = (p) => {
    const buf = readFileSync(join(root, p));
    const i = buf.indexOf('mdhd');
    const v = buf[i + 4];
    const scale = v === 1 ? buf.readUInt32BE(i + 24) : buf.readUInt32BE(i + 16);
    const len = v === 1 ? Number(buf.readBigUInt64BE(i + 28)) : buf.readUInt32BE(i + 20);
    return len / scale;
  };
  for (const n of ['ember', 'blaze', 'whiteheat']) {
    const t = TRACKS[n];
    const a = dur(MUSIC_FILES[t.full]);
    const b = dur(MUSIC_FILES[t.stripped]);
    assert.ok(a > 60, `${n}: ${a} s`);
    assert.equal(a, b, `${n}: full ${a} s, stripped ${b} s`);
  }
});

/** A Web Audio stand-in for Node: every node accepts the calls music.js makes; decodes take `ms`. */
function fakeContext(ms, frames = 0) {
  const param = () => ({
    value: 0,
    setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
    cancelScheduledValues() {}, setTargetAtTime() {},
  });
  // Music sources (buffers with a duration, not the noise) count as live from start() until
  // they are disconnected; decodes count while in flight.
  let decodes = 0, inFlight = 0, live = 0;
  const node = (extra) => ({ connect() {}, disconnect() {}, start() {}, stop() {}, ...extra });
  const source = () => {
    let counted = false;
    return node({
      buffer: null, loop: false,
      start() { if (this.buffer && this.buffer.duration) { counted = true; live++; } },
      disconnect() { if (counted) { counted = false; live--; } },
    });
  };
  let maxInFlight = 0, routed = 0;
  return {
    currentTime: 0,
    get decodes() { return decodes; },
    get inFlight() { return inFlight; },
    get maxInFlight() { return maxInFlight; },
    get live() { return live; },
    get routed() { return routed; }, // media element source connections
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ type: '', frequency: param(), Q: param() }),
    createOscillator: () => node({ type: '', frequency: param(), detune: param() }),
    createBufferSource: source,
    createMediaElementSource: () => node({ connect() { routed++; }, disconnect() { routed = 0; } }),
    decodeAudioData: () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((res) => setTimeout(() => {
        decodes++;
        inFlight--;
        res({ duration: 60, length: frames, numberOfChannels: frames ? 2 : 0 });
      }, ms));
    },
  };
}
/** A media element stand-in: play() resolves (or is refused with `refuse`, an error name). */
function fakeElement(refuse = '') {
  const el = {
    src: '', loop: false, preload: '', paused: true, plays: [],
    play() {
      el.plays.push(el.src);
      if (refuse) return Promise.reject(Object.assign(new Error(refuse), { name: refuse }));
      el.paused = false;
      return Promise.resolve();
    },
    pause() { el.paused = true; },
  };
  return el;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Fake fetch; `log` gets the file name and what was held at that moment. */
function fakeFetch(ctx, log) {
  return async (url) => {
    log.push({ file: String(url).split('/').pop(), inFlight: ctx.inFlight, live: ctx.live });
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4), blob: async () => new Blob([new Uint8Array(4)]) };
  };
}

test('a pair decodes one mix after the other; decodedBytes counts the samples held', async () => {
  const oldFetch = globalThis.fetch;
  const ctx = fakeContext(30, 1000);
  const log = [];
  globalThis.fetch = fakeFetch(ctx, log);
  try {
    const m = createMusic(ctx, ctx.createGain(), { white: {}, brown: {} }, { fileFadeS: 0.02 });
    m.play('ember');
    await wait(150);
    assert.equal(m.state.source, 'file');
    assert.equal(ctx.maxInFlight, 1, 'never two decodes at once');
    assert.equal(log.find((e) => e.file === 'nightfall-no-solo-strings.m4a').inFlight, 0, 'the second file is fetched after the first decode');
    assert.equal(m.state.decoded, 2);
    assert.equal(m.state.decodedBytes, 2 * 1000 * 2 * 4, 'two mixes x 1000 frames x 2 channels x 4 bytes');
    m.play(null);
    assert.equal(m.state.decodedBytes, 0);
    assert.equal(bufferBytes({ length: 8368960, numberOfChannels: 2 }), 66951680, 'Nightfall at 32 kHz: 67 MB');
    assert.equal(bufferBytes(null), 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('one-mix tracks stream through one media element: nothing decoded, the element is released for a pair', async () => {
  const oldFetch = globalThis.fetch;
  const ctx = fakeContext(30, 1000);
  const el = fakeElement();
  globalThis.fetch = fakeFetch(ctx, []);
  try {
    const m = createMusic(ctx, ctx.createGain(), { white: {}, brown: {} }, { fileFadeS: 0.02, stream: true, makeElement: () => el });
    m.unlock();
    assert.deepEqual(el.plays, [SILENT_WAV], 'the first gesture plays a moment of silence (iOS)');
    m.unlock();
    assert.equal(el.plays.length, 1, 'once');
    m.play('title');
    await wait(60);
    assert.equal(m.state.source, 'stream');
    assert.equal(m.state.streaming, true);
    assert.equal(m.state.decoded, 0, 'Machina is not decoded');
    assert.equal(ctx.decodes, 0);
    assert.ok(el.src.startsWith('blob:'), `plays from a blob URL: ${el.src}`);
    assert.equal(el.loop, true);
    assert.equal(ctx.routed, 1);
    m.play('ember'); // a pair: the element stops, the pair decodes
    await wait(200);
    assert.equal(el.paused, true);
    assert.equal(ctx.routed, 0, 'unrouted');
    assert.equal(m.state.source, 'file');
    assert.equal(m.state.decoded, 2);
    m.play('boss'); // Ambush streams; the pair is released
    await wait(100);
    assert.equal(m.state.source, 'stream');
    assert.equal(m.state.decoded, 0);
    assert.equal(el.paused, false);
    m.play('over');
    await wait(100);
    assert.equal(m.state.track, 'over');
    assert.equal(m.state.source, 'stream');
    assert.equal(ctx.decodes, 2, 'only the Nightfall pair was ever decoded');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('a refused stream (no gesture permission) decodes instead, and the page stops trying to stream', async () => {
  const oldFetch = globalThis.fetch;
  const ctx = fakeContext(20, 1000);
  const el = fakeElement('NotAllowedError');
  globalThis.fetch = fakeFetch(ctx, []);
  try {
    const m = createMusic(ctx, ctx.createGain(), { white: {}, brown: {} }, { fileFadeS: 0.02, stream: true, makeElement: () => el });
    m.play('boss');
    await wait(120);
    assert.equal(m.state.track, 'boss');
    assert.equal(m.state.source, 'file', 'Ambush decoded after the refusal');
    assert.equal(m.state.decoded, 1);
    m.play('title');
    await wait(120);
    assert.equal(m.state.source, 'file', 'no second try');
    assert.equal(el.plays.length, 1);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('phones decode at 22.05 kHz: lean by device, ?music= forces either way', () => {
  assert.equal(LEAN_RATE, 22050);
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', maxTouchPoints: 5, platform: 'iPhone' };
  const ipad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', maxTouchPoints: 5, platform: 'MacIntel' };
  const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/155', maxTouchPoints: 0, platform: 'MacIntel', deviceMemory: 8 };
  assert.equal(leanMusic('', iphone), true);
  assert.equal(leanMusic('', ipad), true, 'iPadOS reports a Mac with touch');
  assert.equal(leanMusic('', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)' }), true);
  assert.equal(leanMusic('', { ...mac, deviceMemory: 4 }), true, '4 GB or less');
  assert.equal(leanMusic('', mac), false);
  assert.equal(leanMusic('', mac, true), true, 'a coarse pointer');
  assert.equal(leanMusic('?music=lean', mac), true);
  assert.equal(leanMusic('?bot=1&music=full', iphone), false);
});

test('a track switched away while it is still decoding is not kept decoded', async () => {
  const oldFetch = globalThis.fetch;
  const ctx = fakeContext(20);
  globalThis.fetch = fakeFetch(ctx, []);
  try {
    const m = createMusic(ctx, ctx.createGain(), { white: {}, brown: {} }, { fileFadeS: 0.02 });
    // PLAY on the title while Machina is still decoding (the usual first gesture).
    m.play('title');
    await wait(5);
    m.play('ember');
    await wait(150);
    assert.equal(ctx.decodes, 3, 'Machina finished decoding (thrown away), then the Nightfall pair');
    assert.equal(m.state.track, 'ember');
    assert.equal(m.state.source, 'file');
    assert.equal(m.state.decoded, 2, 'only the Nightfall pair stays decoded');
    // Two worlds in quick succession: only the second pair is kept.
    m.play('blaze');
    m.play('whiteheat');
    await wait(150);
    assert.equal(m.state.decoded, 2, 'only the Red pair');
    // Away and straight back: the pair plays and stays.
    m.play('ember');
    m.play('title');
    m.play('ember');
    await wait(150);
    assert.equal(m.state.source, 'file');
    assert.equal(m.state.decoded, 2);
    // A finished track is released on the switch; drone only releases everything.
    m.play('boss');
    await wait(150);
    assert.equal(m.state.decoded, 1, 'Ambush only');
    m.play(null);
    assert.equal(m.state.decoded, 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('a track switch never holds two tracks: old sources are dropped and stray decodes end before the next fetch', async () => {
  const oldFetch = globalThis.fetch;
  const ctx = fakeContext(60);
  const log = [];
  globalThis.fetch = fakeFetch(ctx, log);
  try {
    const m = createMusic(ctx, ctx.createGain(), { white: {}, brown: {} }, { fileFadeS: 0.02 });
    m.play('ember');
    await wait(150);
    assert.equal(ctx.live, 2, 'the Nightfall pair plays');
    m.play('boss'); // world 1 to The Stoker: the old pair must go before Ambush decodes
    await wait(200);
    assert.equal(ctx.live, 1, 'Ambush plays alone');
    m.play('blaze');
    await wait(110); // Resonance is decoding now
    m.play('whiteheat'); // switched away mid-decode
    await wait(300);
    assert.equal(m.state.decoded, 2);
    assert.equal(ctx.live, 2, 'the Red pair plays');
    const at = (f) => log.find((e) => e.file === f + '.m4a');
    for (const f of ['ambush', 'red', 'red-no-vocals']) {
      const e = at(f);
      assert.ok(e, `${f} fetched`);
      assert.equal(e.live, 0, `${f}: no old source still holds its samples`);
      assert.equal(e.inFlight, 0, `${f}: no decode in flight`);
    }
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('brick notes climb a C minor pentatonic; pan stays inside the field', () => {
  assert.deepEqual(PENTATONIC, [0, 3, 5, 7, 10]);
  near(pentatonicHz(0), 261.63, 1e-6);
  near(pentatonicHz(5), 523.26, 1e-6);
  for (let i = 1; i < 20; i++) assert.ok(pentatonicHz(i) > pentatonicHz(i - 1));
  assert.equal(panFor(360), 0);
  assert.ok(panFor(0) >= -0.6 && panFor(720) <= 0.6);
});

test('agent and test URLs are always silent', () => {
  for (const s of ['?mute=1', '?bot=1', '?qa=1', '?level=7', '?level=3&seed=2', '?bot=1&sound=1', '?seed=4&mute=1']) {
    assert.equal(qaMuted(s), true, s);
  }
  for (const s of ['', '?', '?seed=3', '?debug=1', '?mute=0', '?bot=0']) assert.equal(qaMuted(s), false, s);
});

test('createAudio is safe in Node: no context until a gesture, frame is a no-op', () => {
  const a = createAudio({ settings: { music: 0.3, sfx: 2, muted: true } });
  a.frame(null, 0.016);
  a.music('ember');
  a.setVolume({ music: 0.5 });
  a.ui('click');
  a.suspend();
  a.resume();
  const s = a.state;
  assert.equal(s.context, 'none');
  assert.equal(s.track, 'ember');
  assert.deepEqual(s.volume, { music: 0.5, sfx: 1, muted: true });
});

test('forceMute (main.js, QA tabs) keeps the page silent: setVolume cannot unmute it', () => {
  const a = createAudio({ settings: { muted: false }, forceMute: true });
  a.setVolume({ muted: false, music: 1, sfx: 1 });
  assert.equal(a.state.silent, true);
  const b = createAudio({ settings: { muted: false } });
  assert.equal(b.state.silent, false);
});
