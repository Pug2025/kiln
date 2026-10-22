// Kiln: frame pacing, the slow verdict and the quality ladder (OWNER: C). Pure: no three.js, no DOM,
// no clock, so Node can test it (tests/c-pace.test.mjs).
//
// A rolling window of the last WIN frames keeps counting histograms: the interval between frames
// (1 ms buckets), the renderer's own main-thread work per frame (0.5 ms buckets) and, where the
// browser has a GPU timer (EXT_disjoint_timer_query_webgl2, src/render/gputimer.js), the GPU time of
// the draw (0.5 ms buckets; results arrive a frame or two late, so they keep their own ring).
// Medians come from the histograms: no sort, no allocation.
//
// Verdict (C call, review 2026-10-22). The frame INTERVAL alone cannot tell a struggling device from
// a browser that paces frames at 30 Hz on purpose (iOS Low Power Mode), and main-thread work cannot
// see the GPU: a phone whose GPU needs 17 to 33 ms runs at a steady 33.3 ms with light CPU work,
// exactly like a capped one. So, when the median interval is over SLOW_MS (never at 60 Hz):
//   work  the renderer's median main-thread work is over WORK_MS
//   gpu   the GPU timer's median is over GPU_MS (the draw does not fit a 60 Hz frame)
//   jank  the median interval is over SLOW_MS and irregular (missed vsyncs)
//   slow  a steady cadence slower than a 30 Hz cap, or between 60 and 30 Hz
//   cap   a steady ~30 Hz cadence with light work and no GPU timer: a cap OR a GPU bottleneck
//   ok    everything else (a steady ~30 Hz cadence with a light GPU time is a real cap)
//
// Ladder (C call; ART 15.3 C6 order, applied at once): instead of dropping to lite in one go the
// renderer steps down one quality step at a time: 1 composer MSAA off, 2 one haze plane, 3 pixel
// ratio 1.5, 4 pixel ratio 1, 5 lite (no bloom). work / gpu / jank / slow held for TRIP_S step down.
// cap held for TRIP_S PROBES: a trial jump to step 4; if the median interval then drops to
// PROBE_GAIN of what it was, the GPU was the bottleneck: the ladder keeps it and climbs back while
// the faster cadence holds. If not, it was a cap: back to where it was, and after PROBE_MAX_FAILS
// such trials the ladder stops probing (a capped phone keeps the full look).

export const PACE = Object.freeze({
  WIN: 180,         // frames in the window (3 s at 60 Hz)
  IV_BUCKETS: 100,  // 1 ms buckets, the last one catches everything slower
  WORK_BUCKET_MS: 0.5,
  WORK_BUCKETS: 80, // up to 40 ms
  WORK_MS: 10,      // median renderer work above this is slow (brief: render <= 8 ms on a mid phone)
  GPU_MS: 14,       // median GPU time above this does not fit a 60 Hz frame with room to spare
  GPU_MIN: 60,      // GPU samples needed before the GPU timer counts
  SLOW_MS: 20,      // median interval above this may be slow ...
  CAP_LO: 27,       // ... unless it is a steady cadence in CAP_LO..CAP_HI (a 30 Hz cap)
  CAP_HI: 38,
  STEADY_MS: 3,     // an interval within this of the median counts as on the cadence
  STEADY_SHARE: 0.8,
  // ladder
  MAX_STEP: 5,      // 5 = lite
  TRIP_S: 3,        // a slow verdict held this long steps down (or probes)
  PROBE_STEP: 4,    // a trial jumps here (everything but lite) so it crosses a vsync if it can
  PROBE_FRAMES: 60, // frames measured after a probe or climb step before judging it
  PROBE_GAIN: 0.85, // the probe stays when the median interval falls to this share or less
  PROBE_RETRY_S: 30,
  PROBE_MAX_FAILS: 2,
});

/** The ladder's steps, for the debug overlay and G's harness. */
export const STEP_NAMES = Object.freeze(['full', 'msaa off', 'one haze', 'pixels 1.5', 'pixels 1', 'lite']);

/** A pacing window (allocate once). */
export function createPace() {
  return {
    iv: new Float32Array(PACE.WIN),
    work: new Float32Array(PACE.WIN),
    gpu: new Float32Array(PACE.WIN),
    ivHist: new Uint16Array(PACE.IV_BUCKETS),
    workHist: new Uint16Array(PACE.WORK_BUCKETS),
    gpuHist: new Uint16Array(PACE.WORK_BUCKETS),
    head: 0,
    fill: 0,
    gpuHead: 0,
    gpuFill: 0,
  };
}

function ivBucket(ms) {
  return Math.max(0, Math.min(PACE.IV_BUCKETS - 1, ms | 0));
}

function workBucket(ms) {
  return Math.max(0, Math.min(PACE.WORK_BUCKETS - 1, (ms / PACE.WORK_BUCKET_MS) | 0));
}

/** Add one frame: its interval since the last frame and the renderer's work on it (ms). */
export function pacePush(p, ivMs, workMs) {
  if (p.fill === PACE.WIN) {
    p.ivHist[ivBucket(p.iv[p.head])]--;
    p.workHist[workBucket(p.work[p.head])]--;
  } else p.fill++;
  p.iv[p.head] = ivMs;
  p.work[p.head] = workMs;
  p.ivHist[ivBucket(ivMs)]++;
  p.workHist[workBucket(workMs)]++;
  p.head = (p.head + 1) % PACE.WIN;
}

/** Add one GPU timer result (ms) when it arrives. */
export function pacePushGpu(p, gpuMs) {
  if (p.gpuFill === PACE.WIN) p.gpuHist[workBucket(p.gpu[p.gpuHead])]--;
  else p.gpuFill++;
  p.gpu[p.gpuHead] = gpuMs;
  p.gpuHist[workBucket(gpuMs)]++;
  p.gpuHead = (p.gpuHead + 1) % PACE.WIN;
}

/** Forget the window (a new level, a tab coming back, quality changed). */
export function paceReset(p) {
  p.ivHist.fill(0);
  p.workHist.fill(0);
  p.gpuHist.fill(0);
  p.head = 0;
  p.fill = 0;
  p.gpuHead = 0;
  p.gpuFill = 0;
}

/** The bucket index holding the q-quantile of a histogram over n samples (-1 when empty). */
export function histQuantile(hist, n, q) {
  if (n <= 0) return -1;
  let acc = 0;
  const want = n * q;
  for (let k = 0; k < hist.length; k++) {
    acc += hist[k];
    if (acc >= want) return k;
  }
  return hist.length - 1;
}

/** Median interval in ms (bucket floor). */
export function paceMedianIv(p) {
  return histQuantile(p.ivHist, p.fill, 0.5);
}

/** Median renderer work in ms (bucket floor). */
export function paceMedianWork(p) {
  return histQuantile(p.workHist, p.fill, 0.5) * PACE.WORK_BUCKET_MS;
}

/** Median GPU time in ms (bucket floor), or -1 without enough GPU timer results. */
export function paceMedianGpu(p) {
  if (p.gpuFill < PACE.GPU_MIN) return -1;
  return histQuantile(p.gpuHist, p.gpuFill, 0.5) * PACE.WORK_BUCKET_MS;
}

/** Share of intervals within STEADY_MS of the median (1 = a perfectly steady cadence). */
export function paceSteadiness(p) {
  if (p.fill <= 0) return 1;
  const m = paceMedianIv(p);
  let on = 0;
  for (let k = Math.max(0, m - PACE.STEADY_MS); k <= Math.min(PACE.IV_BUCKETS - 1, m + PACE.STEADY_MS); k++) on += p.ivHist[k];
  return on / p.fill;
}

/**
 * Is this window too slow for the current quality? Only meaningful on a full window.
 * @returns {'ok'|'work'|'gpu'|'jank'|'slow'|'cap'}
 */
export function paceVerdict(p) {
  if (p.fill < PACE.WIN) return 'ok';
  // frames arriving on time are never slow, whatever the work or GPU time (a 60 Hz Mac with a busy
  // GPU keeps the full look: ART 15.3 C6)
  const m = paceMedianIv(p);
  if (m + 1 <= PACE.SLOW_MS) return 'ok';
  if (paceMedianWork(p) > PACE.WORK_MS) return 'work';
  const gpu = paceMedianGpu(p);
  if (gpu > PACE.GPU_MS) return 'gpu';
  const steady = paceSteadiness(p) >= PACE.STEADY_SHARE;
  if (!steady) return 'jank';
  if (m + 1 < PACE.CAP_LO || m > PACE.CAP_HI) return 'slow';
  // a steady ~30 Hz cadence with light main-thread work: with a GPU timer that says the GPU has
  // room, it is the browser's cap; without one it may be either, and the ladder probes
  return gpu >= 0 ? 'ok' : 'cap';
}

/** The quality ladder's state (allocate once). */
export function createLadder() {
  return {
    step: 0, probing: false, probeFrom: 0, probeBase: 0, climbing: false, climbIv: 0,
    fails: 0, nextProbeT: 0, slowSince: -1, why: '',
  };
}

/** Back to full quality (the player chose a quality); what probes learned about a cap stays. */
export function ladderReset(L) {
  L.step = 0;
  L.probing = false;
  L.climbing = false;
  L.slowSince = -1;
  L.why = '';
}

/**
 * One decision per frame, t in seconds. On anything but 'none' and 'keep' L.step has changed and
 * the caller applies it and resets the pace window.
 *
 * A probe has to cross a vsync: on a GPU-bound phone one step (28 to 24 ms of GPU) changes nothing
 * at 33.3 ms, so the trial jumps to PROBE_STEP (everything but lite). If the cadence improves the
 * GPU was the bottleneck: the ladder keeps it and climbs back one step at a time while the faster
 * cadence holds, settling one step under the first that loses it. If it does not improve, it was
 * a cap: back to where it was.
 * @returns {'none'|'down'|'probe'|'keep'|'revert'|'up'}  down = a real slowdown, one step lower;
 *   probe = a trial jump to PROBE_STEP; keep = the trial helped (no change yet); revert = it did
 *   not, back to the step before; up = climbing back one step; settle (as down) = that step lost
 *   the cadence, one step lower again and done
 */
export function ladderDecide(L, p, t) {
  if (L.probing || L.climbing) {
    if (p.fill < PACE.PROBE_FRAMES) return 'none';
    const m = paceMedianIv(p);
    L.slowSince = -1;
    if (L.probing) {
      L.probing = false;
      if (m <= L.probeFrom * PACE.PROBE_GAIN) {
        L.climbing = L.step > L.probeBase + 1;
        L.climbIv = m;
        return 'keep';
      }
      L.step = L.probeBase;
      L.fails++;
      L.nextProbeT = t + PACE.PROBE_RETRY_S;
      return 'revert';
    }
    // climbing: did the step just taken back up hold the faster cadence?
    if (m > L.climbIv / PACE.PROBE_GAIN) {
      L.climbing = false;
      L.step++;
      return 'down';
    }
    if (L.step - 1 <= L.probeBase) {
      L.climbing = false;
      return 'none';
    }
    L.step--;
    return 'up';
  }
  if (L.step >= PACE.MAX_STEP) return 'none';
  const v = paceVerdict(p);
  if (v === 'ok' || (v === 'cap' && (L.fails >= PACE.PROBE_MAX_FAILS || t < L.nextProbeT || L.step >= PACE.PROBE_STEP))) {
    L.slowSince = -1;
    return 'none';
  }
  if (L.slowSince < 0) {
    L.slowSince = t;
    return 'none';
  }
  if (t - L.slowSince < PACE.TRIP_S) return 'none';
  L.slowSince = -1;
  L.why = v;
  if (v === 'cap') {
    L.probing = true;
    L.probeFrom = paceMedianIv(p);
    L.probeBase = L.step;
    L.step = PACE.PROBE_STEP;
    return 'probe';
  }
  L.step++;
  return 'down';
}
