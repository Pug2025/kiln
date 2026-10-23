// Kiln: synthesised game sounds (OWNER: E). Web Audio only, no files, so every hit is shaped by
// code: glass-and-ceramic bricks pinging up a pentatonic scale, a titanium paddle, the perfect-hit
// bass thump, the fire's roar and the level-clear pressure-release blast.
//
// createSfx(ctx, dry, wet) → voices. `dry` is the sfx bus, `wet` the reverb send. Each voice
// schedules a few short-lived nodes at ctx.currentTime; noise comes from buffers made once.
// Presentation only: never imported by the sim.

/**
 * Sound files (audio/sfx/, sources in audio/sfx/SOURCES.md): SRG774's menu selection and level
 * cleared sounds. Every other sound is synthesised below. `gain` evens out their loudness.
 */
export const SFX_FILES = Object.freeze({
  hover: Object.freeze({ path: 'audio/sfx/hover.m4a', gain: 0.45 }),
  victory: Object.freeze({ path: 'audio/sfx/victory.m4a', gain: 2.6 }),
});

/** C minor pentatonic (C Eb F G Bb), semitones above the root. */
export const PENTATONIC = Object.freeze([0, 3, 5, 7, 10]);
export const NOTE_ROOT_HZ = 261.63; // C4

/** Frequency of pentatonic step i (0 = C4; 5 = C5 …). Pure, tested. */
export function pentatonicHz(i, root = NOTE_ROOT_HZ) {
  const k = Math.max(0, Math.floor(i));
  const oct = Math.floor(k / PENTATONIC.length);
  const semi = 12 * oct + PENTATONIC[k % PENTATONIC.length];
  return root * Math.pow(2, semi / 12);
}

/** Stereo position −1…1 from a field x (720 wide), kept narrow so nothing sits hard left/right. */
export function panFor(x) {
  const p = (x / 720 - 0.5) * 1.2;
  return p < -0.6 ? -0.6 : p > 0.6 ? 0.6 : p;
}

const EPS = 0.0001;

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} dry  sfx bus input
 * @param {AudioNode} wet  reverb send input
 */
export function createSfx(ctx, dry, wet) {
  const sr = ctx.sampleRate;

  // ---------------------------------------------------------------- noise buffers (made once)
  function noiseBuffer(seconds, brown) {
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
  const white = noiseBuffer(2, false);
  const brown = noiseBuffer(4, true);

  // ---------------------------------------------------------------- building blocks
  /** A gain node with an attack/decay envelope, routed to dry (+ wet send). */
  function voiceOut(t, peak, attack, decay, pan = 0, send = 0) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(EPS, t + attack + decay);
    let tail = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      tail = p;
    }
    tail.connect(dry);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      tail.connect(s);
      s.connect(wet);
    }
    return g;
  }

  /** Oscillator into `out` from t for dur seconds, optional glide to f1. */
  function osc(type, f0, f1, t, dur, out, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    if (detune) o.detune.value = detune;
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  /** Filtered noise into `out`, filter frequency optionally sweeping f0 → f1. */
  function noise(buf, type, f0, f1, q, t, dur, out) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = buf.duration < dur + 0.1;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.Q.value = q;
    s.connect(f);
    f.connect(out);
    s.start(t, Math.random() * Math.max(0, buf.duration - dur - 0.05));
    s.stop(t + dur + 0.05);
    return s;
  }

  // ---------------------------------------------------------------- voices
  const v = {
    /** A brick breaks: glass ping on pentatonic step `note`, shatter, ceramic knock. */
    brickBreak(t, note, x, strength = 1) {
      const f = pentatonicHz(note);
      const pan = panFor(x);
      osc('sine', f, f, t, 0.5, voiceOut(t, 0.26 * strength, 0.003, 0.42, pan, 0.3));
      osc('sine', f * 2.756, f * 2.74, t, 0.25, voiceOut(t, 0.09 * strength, 0.002, 0.2, pan, 0.35));
      osc('triangle', f * 2, f * 2, t, 0.1, voiceOut(t, 0.07 * strength, 0.001, 0.07, pan, 0.2));
      noise(white, 'bandpass', 5200, 3200, 0.9, t, 0.09, voiceOut(t, 0.16 * strength, 0.001, 0.08, pan, 0.25));
      osc('sine', 150, 70, t, 0.09, voiceOut(t, 0.22 * strength, 0.002, 0.08, pan, 0));
    },

    /** A hit that does not break: heat knocked out of the brick (dull tap, sparks). */
    brickHit(t, note, x) {
      const f = pentatonicHz(note) * 0.5;
      const pan = panFor(x);
      osc('sine', f, f * 0.98, t, 0.16, voiceOut(t, 0.14, 0.002, 0.13, pan, 0.15));
      noise(white, 'bandpass', 2600, 1800, 1.2, t, 0.03, voiceOut(t, 0.12, 0.001, 0.025, pan, 0.1));
      osc('sine', 130, 75, t, 0.07, voiceOut(t, 0.18, 0.002, 0.06, pan, 0));
    },

    /** Titanium paddle contact; `off` −1…1 nudges the pitch. */
    paddle(t, off, x) {
      const k = 1 + off * 0.06;
      const pan = panFor(x);
      osc('sine', 185 * k, 92 * k, t, 0.09, voiceOut(t, 0.32, 0.002, 0.085, pan, 0.05));
      noise(white, 'lowpass', 1600, 900, 0.7, t, 0.03, voiceOut(t, 0.12, 0.001, 0.028, pan, 0));
      noise(white, 'bandpass', 2300 * k, 2300 * k, 14, t, 0.14, voiceOut(t, 0.05, 0.001, 0.13, pan, 0.2));
    },

    /** Perfect hit: bass thump under a bright flare. */
    perfect(t, x) {
      const pan = panFor(x) * 0.5;
      osc('sine', 125, 36, t, 0.26, voiceOut(t, 0.7, 0.003, 0.24, 0, 0.05));
      osc('triangle', 62, 40, t, 0.16, voiceOut(t, 0.25, 0.002, 0.15, 0, 0));
      noise(white, 'highpass', 5200, 9000, 0.7, t, 0.1, voiceOut(t, 0.16, 0.001, 0.09, pan, 0.3));
      osc('sine', 2600, 3500, t, 0.14, voiceOut(t, 0.06, 0.002, 0.13, pan, 0.4));
    },

    /** Ball off a wall: a dry tick. side 2 = top. */
    wall(t, side, x) {
      const f = side === 2 ? 1500 : 1150;
      const pan = panFor(x);
      osc('triangle', f, f * 0.9, t, 0.03, voiceOut(t, 0.05, 0.001, 0.028, pan, 0.08));
      noise(white, 'bandpass', 3200, 3200, 2, t, 0.02, voiceOut(t, 0.04, 0.001, 0.018, pan, 0));
    },

    /** Ember caught: a small crystalline blip that climbs with the combo. */
    ember(t, note, x) {
      const f = pentatonicHz(note + 10);
      const pan = panFor(x);
      osc('sine', f, f * 1.03, t, 0.08, voiceOut(t, 0.06, 0.002, 0.07, pan, 0.25));
      noise(white, 'highpass', 8000, 8000, 0.7, t, 0.02, voiceOut(t, 0.02, 0.001, 0.018, pan, 0));
    },

    /** Multiplier step: a quick rising arpeggio; ×5 adds a fourth note and a shimmer. */
    comboStep(t, mult, note) {
      const n = mult >= 5 ? 4 : 3;
      const steps = [0, 2, 5, 7];
      for (let i = 0; i < n; i++) {
        const ti = t + i * 0.045;
        const f = pentatonicHz(note + 5 + steps[i]);
        osc('triangle', f, f, ti, 0.45, voiceOut(ti, 0.16, 0.004, 0.4, 0, 0.45));
      }
      if (mult >= 5) noise(white, 'highpass', 6000, 11000, 0.5, t, 0.5, voiceOut(t, 0.05, 0.05, 0.45, 0, 0.6));
    },

    /** Combo halved: two muted falling notes. */
    comboDown(t) {
      osc('triangle', 392, 370, t, 0.12, voiceOut(t, 0.07, 0.003, 0.11, 0, 0.2));
      osc('triangle', 294, 277, t + 0.09, 0.18, voiceOut(t + 0.09, 0.07, 0.003, 0.16, 0, 0.2));
    },

    /** A drop leaves its brick. */
    dropSpawn(t, x) {
      const pan = panFor(x);
      noise(white, 'bandpass', 1300, 1300, 3, t, 0.03, voiceOut(t, 0.06, 0.001, 0.028, pan, 0));
      osc('sine', 620, 920, t, 0.07, voiceOut(t, 0.04, 0.002, 0.065, pan, 0.2));
    },

    /** Drop caught: family 'heat' (good), 'cold', 'warn' (bad) or 'rare' (Mega). */
    dropCatch(t, family, x) {
      const pan = panFor(x);
      if (family === 'warn') {
        const out = voiceOut(t, 0.14, 0.004, 0.3, pan, 0.1);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        lp.connect(out);
        osc('sawtooth', 110, 92, t, 0.32, lp);
        osc('sawtooth', 113.5, 95, t, 0.32, lp);
      } else if (family === 'cold') {
        osc('sine', 2400, 1600, t, 0.24, voiceOut(t, 0.1, 0.002, 0.22, pan, 0.5));
        osc('sine', 3200, 2150, t, 0.24, voiceOut(t, 0.07, 0.002, 0.22, pan, 0.5));
        osc('sine', 1200, 1180, t, 0.3, voiceOut(t, 0.09, 0.004, 0.28, pan, 0.4));
      } else if (family === 'rare') {
        noise(white, 'bandpass', 300, 3000, 0.8, t, 0.5, voiceOut(t, 0.2, 0.2, 0.3, pan, 0.4));
        osc('sine', 70, 140, t, 0.5, voiceOut(t, 0.4, 0.05, 0.45, 0, 0.1));
        osc('triangle', pentatonicHz(10), pentatonicHz(15), t + 0.25, 0.4, voiceOut(t + 0.25, 0.1, 0.01, 0.35, pan, 0.5));
      } else {
        osc('triangle', pentatonicHz(10), pentatonicHz(10), t, 0.18, voiceOut(t, 0.17, 0.003, 0.16, pan, 0.35));
        osc('triangle', pentatonicHz(13), pentatonicHz(13), t + 0.07, 0.25, voiceOut(t + 0.07, 0.17, 0.003, 0.22, pan, 0.35));
      }
    },

    /** A timed effect ran out: a small downward blip. */
    effectOff(t) {
      osc('sine', 880, 520, t, 0.1, voiceOut(t, 0.04, 0.003, 0.09, 0, 0.2));
    },

    /** Launch from the paddle: a soft whomp. */
    launch(t, x) {
      const pan = panFor(x);
      osc('sine', 210, 330, t, 0.1, voiceOut(t, 0.12, 0.004, 0.09, pan, 0.05));
      noise(white, 'lowpass', 900, 400, 0.7, t, 0.08, voiceOut(t, 0.06, 0.004, 0.07, pan, 0));
    },

    /** Ball lost: a falling whoosh and the fire flaring as the ball drops into it. */
    ballLost(t, x) {
      const pan = panFor(x);
      noise(white, 'bandpass', 1600, 180, 1.1, t, 0.5, voiceOut(t, 0.2, 0.01, 0.48, pan, 0.2));
      osc('sawtooth', 300, 70, t, 0.45, (() => {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 700;
        lp.connect(voiceOut(t, 0.1, 0.01, 0.42, pan, 0.1));
        return lp;
      })());
      noise(brown, 'lowpass', 600, 300, 0.6, t + 0.15, 0.7, voiceOut(t + 0.15, 0.32, 0.06, 0.6, pan, 0.3));
    },

    /** A life is gone: a low, dark tone. */
    lifeLost(t) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(200, t + 0.8);
      lp.connect(voiceOut(t, 0.2, 0.02, 0.8, 0, 0.3));
      osc('sawtooth', 98, 65, t, 0.85, lp);
      osc('sine', 49, 42, t, 0.85, voiceOut(t, 0.25, 0.02, 0.8, 0, 0));
    },

    /** A life gained: a warm rising triad. */
    lifeGained(t) {
      const f = [pentatonicHz(5), pentatonicHz(7), pentatonicHz(10)];
      for (let i = 0; i < 3; i++) osc('triangle', f[i], f[i], t + i * 0.06, 0.5, voiceOut(t + i * 0.06, 0.09, 0.005, 0.45, 0, 0.4));
    },

    /** The fire roars (last brick): a swelling roar with crackle, about 3 s. */
    fireRoar(t) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(EPS, t);
      g.gain.exponentialRampToValueAtTime(0.55, t + 0.6);
      g.gain.setValueAtTime(0.55, t + 1.8);
      g.gain.exponentialRampToValueAtTime(EPS, t + 3.2);
      g.connect(dry);
      const s = ctx.createGain();
      s.gain.value = 0.3;
      g.connect(s);
      s.connect(wet);
      noise(brown, 'bandpass', 220, 520, 0.6, t, 3.2, g);
      noise(white, 'lowpass', 1400, 700, 0.5, t, 3.2, (() => {
        const q = ctx.createGain();
        q.gain.value = 0.18;
        q.connect(g);
        return q;
      })());
      for (let i = 0; i < 28; i++) {
        const ti = t + 0.2 + Math.random() * 2.6;
        noise(white, 'bandpass', 2000 + Math.random() * 3000, 0, 1.5, ti, 0.012, voiceOut(ti, 0.05 + Math.random() * 0.07, 0.001, 0.01, (Math.random() - 0.5) * 0.8, 0.2));
      }
    },

    /** Level clear: a deep pressure-release blast (sub boom, swept blast, steam hiss). */
    clearBlast(t) {
      osc('sine', 72, 27, t, 1.9, voiceOut(t, 0.48, 0.004, 1.85, 0, 0.15));
      osc('triangle', 54, 30, t, 0.6, voiceOut(t, 0.18, 0.004, 0.55, 0, 0));
      noise(white, 'lowpass', 4500, 110, 0.8, t, 1.6, voiceOut(t, 0.34, 0.003, 1.55, 0, 0.5));
      noise(brown, 'lowpass', 900, 120, 0.7, t, 1.8, voiceOut(t, 0.3, 0.005, 1.7, 0, 0.3));
      noise(white, 'highpass', 3600, 5200, 0.6, t + 0.08, 2.3, voiceOut(t + 0.08, 0.12, 0.06, 2.2, 0, 0.45));
    },

    /** An explosive brick goes off. */
    explosion(t, x) {
      const pan = panFor(x);
      noise(white, 'lowpass', 2000, 260, 0.7, t, 0.34, voiceOut(t, 0.42, 0.002, 0.32, pan, 0.35));
      osc('sine', 95, 38, t, 0.28, voiceOut(t, 0.5, 0.003, 0.26, pan, 0.05));
    },

    /** Laser shot. */
    laser(t, x) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      lp.connect(voiceOut(t, 0.06, 0.001, 0.08, panFor(x), 0.15));
      osc('square', 1500, 480, t, 0.09, lp);
    },

    /** Overloads: Purge (rising rush into a blast), Quench (cold descending cluster), Fork (split zaps). */
    overload(t, kind) {
      if (kind === 1) {
        noise(white, 'bandpass', 280, 3200, 0.9, t, 0.42, voiceOut(t, 0.25, 0.35, 0.08, 0, 0.3));
        v.explosion(t + 0.42, 360);
        osc('sine', 60, 30, t + 0.42, 0.8, voiceOut(t + 0.42, 0.38, 0.004, 0.75, 0, 0.2));
      } else if (kind === 2) {
        const fs = [2800, 2100, 1650, 1240];
        for (let i = 0; i < fs.length; i++) {
          const ti = t + i * 0.05;
          osc('sine', fs[i], fs[i] * 0.6, ti, 0.9, voiceOut(ti, 0.06, 0.004, 0.85, (i % 2 ? 0.3 : -0.3), 0.6));
        }
        noise(white, 'highpass', 7000, 2000, 0.5, t, 0.9, voiceOut(t, 0.05, 0.05, 0.8, 0, 0.6));
      } else {
        osc('sawtooth', 600, 1800, t, 0.18, voiceOut(t, 0.05, 0.002, 0.17, -0.4, 0.3));
        osc('sawtooth', 600, 1350, t, 0.18, voiceOut(t, 0.05, 0.002, 0.17, 0.4, 0.3));
        osc('sine', 110, 55, t, 0.2, voiceOut(t, 0.3, 0.003, 0.18, 0, 0));
      }
    },

    /** Shield: cold glassy block (used) or a rising cold chime (bought). */
    shield(t, bought) {
      if (bought) {
        osc('sine', 1200, 1800, t, 0.3, voiceOut(t, 0.11, 0.01, 0.28, 0, 0.5));
        osc('sine', 1800, 2700, t + 0.05, 0.3, voiceOut(t + 0.05, 0.05, 0.01, 0.28, 0, 0.5));
      } else {
        osc('sine', 1850, 1800, t, 0.3, voiceOut(t, 0.09, 0.002, 0.28, 0, 0.5));
        osc('sine', 2780, 2700, t, 0.25, voiceOut(t, 0.06, 0.002, 0.22, 0, 0.5));
        noise(white, 'bandpass', 4000, 4000, 2, t, 0.05, voiceOut(t, 0.08, 0.001, 0.045, 0, 0.2));
        osc('sine', 160, 90, t, 0.12, voiceOut(t, 0.3, 0.002, 0.11, 0, 0));
      }
    },

    /** Metal: a sentry (small) or the boss (heavy) takes a hit. */
    clank(t, heavy, x) {
      const pan = panFor(x);
      const fs = heavy ? [180, 471, 1023] : [520, 1342, 2207];
      const g = heavy ? 0.14 : 0.08;
      for (let i = 0; i < 3; i++) osc('sine', fs[i], fs[i] * 0.985, t, heavy ? 0.5 : 0.22, voiceOut(t, g, 0.001, heavy ? 0.45 : 0.2, pan, 0.25));
      noise(white, 'bandpass', heavy ? 1200 : 3000, 0, 1.2, t, 0.03, voiceOut(t, 0.12, 0.001, 0.028, pan, 0.1));
      if (heavy) osc('sine', 90, 45, t, 0.2, voiceOut(t, 0.5, 0.003, 0.18, 0, 0));
    },

    /** A protected core deflects: short, low and dry, without the counted hit's ringing tail. */
    bossBlocked(t, x) {
      const pan = panFor(x);
      osc('sine', 135, 90, t, 0.075, voiceOut(t, 0.18, 0.001, 0.07, pan));
      noise(brown, 'lowpass', 480, 0, 0.7, t, 0.045, voiceOut(t, 0.1, 0.001, 0.04, pan));
    },

    /** The paddle is hit by slag or a bomb. */
    hazard(t, x) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      lp.connect(voiceOut(t, 0.16, 0.002, 0.25, panFor(x), 0.15));
      osc('sawtooth', 140, 70, t, 0.26, lp);
      osc('square', 147, 72, t, 0.26, lp);
    },

    /** A boss phase change: a low swell. */
    bossPhase(t) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(200, t);
      lp.frequency.exponentialRampToValueAtTime(1200, t + 0.9);
      lp.connect(voiceOut(t, 0.22, 0.5, 0.7, 0, 0.5));
      osc('sawtooth', 55, 55, t, 1.2, lp);
      osc('sawtooth', 82.4, 82.4, t, 1.2, lp, 6);
    },

    /** Portal pass: a short warp. */
    portal(t, x) {
      osc('sine', 300, 1300, t, 0.13, voiceOut(t, 0.06, 0.003, 0.12, panFor(x), 0.4));
    },

    /** A falling gravity brick lands. */
    land(t, x) {
      osc('sine', 110, 55, t, 0.12, voiceOut(t, 0.25, 0.002, 0.11, panFor(x), 0.05));
      noise(white, 'lowpass', 1200, 500, 0.7, t, 0.06, voiceOut(t, 0.1, 0.001, 0.05, panFor(x), 0));
    },

    /** HEAT full: a soft rising shimmer. */
    heatFull(t) {
      for (let i = 0; i < 3; i++) {
        const f = 1150 + i * 330;
        osc('sine', f, f * 1.5, t + i * 0.04, 0.32, voiceOut(t + i * 0.04, 0.06, 0.01, 0.3, (i - 1) * 0.3, 0.5));
      }
    },

    /** The last seconds of a timed level. */
    tick(t, last) {
      osc('sine', last ? 1320 : 990, last ? 1320 : 990, t, 0.06, voiceOut(t, 0.06, 0.002, 0.05, 0, 0.1));
    },

    /** Near miss on the last brick: a fast whoosh past. */
    nearMiss(t, x) {
      noise(white, 'bandpass', 900, 3500, 1.4, t, 0.22, voiceOut(t, 0.12, 0.08, 0.13, panFor(x), 0.3));
    },

    /** A cavity ball is freed: glass cracks open, a release chime. */
    cavity(t, x) {
      noise(white, 'bandpass', 4200, 2600, 1, t, 0.12, voiceOut(t, 0.2, 0.001, 0.11, panFor(x), 0.3));
      v.lifeGained(t + 0.06);
    },

    /** Menu sounds (placeholders until the SRG774 pack is approved). */
    ui(t, name) {
      switch (name) {
        case 'open':
          osc('sine', 520, 780, t, 0.12, voiceOut(t, 0.05, 0.01, 0.1, 0, 0.3));
          break;
        case 'back':
          osc('sine', 700, 470, t, 0.1, voiceOut(t, 0.05, 0.004, 0.09, 0, 0.2));
          break;
        case 'confirm':
        case 'buy':
          osc('triangle', pentatonicHz(10), pentatonicHz(10), t, 0.16, voiceOut(t, 0.07, 0.003, 0.14, 0, 0.3));
          osc('triangle', pentatonicHz(12), pentatonicHz(12), t + 0.06, 0.22, voiceOut(t + 0.06, 0.07, 0.003, 0.2, 0, 0.3));
          break;
        case 'deny':
          osc('square', 160, 150, t, 0.12, voiceOut(t, 0.04, 0.002, 0.11, 0, 0));
          break;
        default: // 'click', 'pick'
          noise(white, 'bandpass', 2400, 2400, 3, t, 0.02, voiceOut(t, 0.07, 0.001, 0.018, 0, 0));
          osc('sine', 1800, 1700, t, 0.03, voiceOut(t, 0.03, 0.001, 0.028, 0, 0));
      }
    },
  };
  return v;
}
