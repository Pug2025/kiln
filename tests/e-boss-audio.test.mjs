import { test, assert } from './lib.mjs';
import { createAudio } from '../src/audio/audio.js';
import { createSfx } from '../src/audio/sfx.js';
import { EV } from '../src/core/events.js';
import { emit } from '../src/core/bus.js';
import { getLevel } from '../src/levels/index.js';
import { contentWorld } from './fixtures/B/helpers.mjs';
import { BRICK } from '../src/core/constants.js';

// Fully silent Web Audio stand-in: real event handling/synthesis run, no browser or output device.
class SilentContext {
  constructor() {
    this.sampleRate = 800; this.currentTime = 1; this.state = 'running'; this.destination = {};
    this.pitches = [];
    SilentContext.latest = this;
  }
  param(log = false) {
    const c = this;
    return { value: 0, setValueAtTime(v) { this.value = v; if (log) c.pitches.push(v); },
      linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} };
  }
  node(extra = {}) { return { connect() {}, disconnect() {}, start() {}, stop() {}, ...extra }; }
  createGain() { return this.node({ gain: this.param() }); }
  createBiquadFilter() { return this.node({ frequency: this.param(), Q: this.param() }); }
  createOscillator() { return this.node({ frequency: this.param(true), detune: this.param() }); }
  createStereoPanner() { return this.node({ pan: this.param() }); }
  createBufferSource() { return this.node(); }
  createConvolver() { return this.node(); }
  createDynamicsCompressor() { return this.node(Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(k => [k, this.param()]))); }
  createBuffer(channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
  resume() { return Promise.resolve(); }
}

test('three boss contact sounds: counted core hit rings and climbs with damage, blocked is a low knock, armour a light tick', () => {
  const ctx = new SilentContext(), sfx = createSfx(ctx, ctx.createGain(), ctx.createGain());
  sfx.bossBlocked(1, 360);
  assert.deepEqual(ctx.pitches, [135], 'blocked contact has one low, dry oscillator');
  ctx.pitches.length = 0;
  sfx.coreHit(1, 360, 0);
  const fresh = [...ctx.pitches];
  assert.ok(fresh.some(p => p > 1000), 'counted hit retains the ringing metal harmonics');
  ctx.pitches.length = 0;
  sfx.coreHit(1, 360, 1);
  assert.ok(Math.max(...ctx.pitches) > Math.max(...fresh) * 1.3, 'the ring climbs as the core breaks');
  ctx.pitches.length = 0;
  sfx.armourTick(1, 360);
  assert.ok(ctx.pitches.length === 1 && ctx.pitches[0] > 1000, 'armour: one short high tick, unlike the low knock or the ringing hit');
});

test('boss audio reader only plays success for BOSS_HIT; blocked contact and readiness are separate', () => {
  const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = { AudioContext: SilentContext, addEventListener() {} };
  globalThis.document = { hidden: false, addEventListener() {} };
  globalThis.fetch = async () => ({ ok: false });
  try {
    const w = contentWorld(getLevel(10)).world;
    const a = createAudio({ forceMute: true });
    a.setWorld(w); a.music(null); a.unlock();
    const before = a.state.played;
    const core = [...Array(w.bricks.count).keys()].find(i => w.bricks.type[i] === BRICK.WEAK);
    emit(w.bus, EV.BRICK_HIT, core, 360, 495);
    a.frame(w, 0.016);
    assert.equal(a.state.played, before, 'raw contact never sounds like successful boss damage');
    emit(w.bus, EV.BOSS_HIT, 0, 360, 495, 4, 5);
    a.frame(w, 0.016);
    assert.equal(a.state.last, 'bigClank');
    emit(w.bus, EV.BOSS_BLOCKED, 0, 360, 495, 0);
    a.frame(w, 0.016);
    assert.equal(a.state.last, 'bossBlocked', 'cooldown has the dull knock');
    const played = a.state.played;
    emit(w.bus, EV.BOSS_GUARD, 0, 360, 495, 1);
    emit(w.bus, EV.BOSS_GUARD, 0, 360, 495, 0);
    a.frame(w, 0.016);
    assert.equal(a.state.played, played, 'guard state alone never replays a damage sound');
    SilentContext.latest.currentTime += 0.1;
    const head = [...Array(w.bricks.count).keys()].find(i => w.bricks.type[i] === BRICK.BOSS);
    emit(w.bus, EV.BRICK_HIT, head, 360, 450);
    a.frame(w, 0.016);
    assert.equal(a.state.last, 'armour', 'item 20: permanent armour has its own light metal tick, not the blocked knock');
    assert.equal(a.state.played, played + 1);
    assert.equal(a.state.silent, true);
  } finally {
    if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
    globalThis.fetch = saved.fetch;
  }
});
