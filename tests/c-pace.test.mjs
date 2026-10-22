// C: the slow verdict and the quality ladder (src/render/pace.js), and the GPU timer
// (src/render/gputimer.js). Reviews 2026-10-22: judging by the frame interval alone switched a phone
// in iOS Low Power Mode (Safari paces frames at 30 Hz) to lite for good; judging by main-thread work
// never switched a phone whose GPU needs two vsyncs a frame (also a steady 33 ms).

import { test, assert, near } from './lib.mjs';
import {
  PACE, createPace, pacePush, pacePushGpu, paceReset, paceVerdict, paceMedianIv, paceMedianWork, paceMedianGpu,
  paceSteadiness, createLadder, ladderDecide, ladderReset,
} from '../src/render/pace.js';
import { createGpuTimer } from '../src/render/gputimer.js';

/** Fill a window from interval and work generators (frame index -> ms). */
function run(iv, work, frames = PACE.WIN * 2) {
  const p = createPace();
  for (let i = 0; i < frames; i++) pacePush(p, iv(i), work(i));
  return p;
}

const jitter = (i, amp) => amp * Math.sin(i * 12.9898) * 0.5;

test('pace: a steady 30 Hz cadence with light work and no GPU timer is ambiguous (cap)', () => {
  const p = run((i) => 33.3 + jitter(i, 1.5), () => 3.2);
  assert.equal(paceVerdict(p), 'cap', 'a cap or a GPU bottleneck: the ladder probes');
  assert.ok(paceSteadiness(p) > 0.95);
  near(paceMedianIv(p), 33, 1);
});

test('pace: with a GPU timer a steady 30 Hz cadence is a cap when the GPU is light, slow when it is not', () => {
  const light = run((i) => 33.3 + jitter(i, 1.5), () => 3.2);
  for (let i = 0; i < PACE.WIN; i++) pacePushGpu(light, 6 + jitter(i, 1));
  near(paceMedianGpu(light), 6, 0.6);
  assert.equal(paceVerdict(light), 'ok', 'iOS Low Power Mode keeps the full look');
  const heavy = run((i) => 33.3 + jitter(i, 1.5), () => 3.2);
  for (let i = 0; i < PACE.WIN; i++) pacePushGpu(heavy, 24 + jitter(i, 2));
  assert.equal(paceVerdict(heavy), 'gpu', 'a GPU-bound phone at 30 Hz is slow');
  const few = run(() => 33.3, () => 3.2);
  for (let i = 0; i < PACE.GPU_MIN - 1; i++) pacePushGpu(few, 30);
  assert.equal(paceMedianGpu(few), -1, 'too few GPU results do not count yet');
});

test('pace: 60 Hz with light work is fine', () => {
  assert.equal(paceVerdict(run((i) => 16.7 + jitter(i, 1), () => 4)), 'ok');
});

test('pace: frames on time are never slow, even with heavy work or a busy GPU (a 60 Hz Mac)', () => {
  const p = run((i) => 16.7 + jitter(i, 1), () => 12);
  for (let i = 0; i < PACE.WIN; i++) pacePushGpu(p, 15.5);
  assert.equal(paceVerdict(p), 'ok');
});

test('pace: missed vsyncs (16.7 and 33.3 mixed, median 33) are slow', () => {
  const p = run((i) => (i % 5 < 3 ? 33.3 : 16.7), () => 4);
  assert.equal(paceVerdict(p), 'jank');
});

test('pace: a steady 20 Hz cadence is slow, not a cap', () => {
  assert.equal(paceVerdict(run(() => 50, () => 4)), 'slow');
});

test('pace: a steady 40 Hz cadence on a 120 Hz screen is slow, not a cap', () => {
  assert.equal(paceVerdict(run(() => 25, () => 4)), 'slow');
});

test('pace: renderer work over budget is slow even at a 30 Hz cap', () => {
  const p = run(() => 33.3, () => 12);
  near(paceMedianWork(p), 12, 0.5);
  assert.equal(paceVerdict(p), 'work');
});

test('pace: a window that is not full yet never decides', () => {
  assert.equal(paceVerdict(run(() => 60, () => 20, PACE.WIN - 1)), 'ok');
});

test('pace: the window forgets old frames and reset clears it', () => {
  const p = run(() => 50, () => 4);
  for (let i = 0; i < PACE.WIN; i++) pacePush(p, 16.7, 3);
  assert.equal(paceVerdict(p), 'ok', 'only the last WIN frames count');
  for (let i = 0; i < PACE.WIN; i++) pacePushGpu(p, 20);
  paceReset(p);
  assert.equal(p.fill, 0);
  assert.equal(p.gpuFill, 0);
  assert.equal(paceVerdict(p), 'ok');
});

/**
 * A device simulated against the ladder: cadence(step, i) gives the frame interval at a quality
 * step, gpu(step) the GPU time (or -1 without a timer). Runs `seconds` and applies every decision
 * the way the renderer does (step changes reset the window). Returns the ladder and its log.
 */
function simulate(cadence, gpu, seconds, work = () => 3) {
  const p = createPace();
  const L = createLadder();
  const log = [];
  let t = 6; // after the renderer's 5 s warm-up
  for (let i = 0; t < 6 + seconds; i++) {
    const iv = cadence(L.step, i);
    t += iv / 1000;
    pacePush(p, iv, work(L.step));
    const g = gpu(L.step);
    if (g >= 0) pacePushGpu(p, g);
    const act = ladderDecide(L, p, t);
    if (act !== 'none') log.push(`${act}:${L.step}`);
    if (act !== 'none' && act !== 'keep') paceReset(p);
  }
  return { L, log };
}

test('ladder: a 60 Hz desktop with light work never steps down', () => {
  const { L, log } = simulate((s, i) => 16.7 + jitter(i, 1), () => 4, 120);
  assert.equal(L.step, 0);
  assert.deepEqual(log, []);
});

test('ladder: a 30 Hz-capped phone without a GPU timer probes twice, keeps the full look', () => {
  // iOS Low Power Mode: 33.3 ms whatever the quality
  const { L, log } = simulate((s, i) => 33.3 + jitter(i, 1), () => -1, 240);
  assert.equal(L.step, 0, 'back at full quality');
  assert.deepEqual(log, [`probe:${PACE.PROBE_STEP}`, 'revert:0', `probe:${PACE.PROBE_STEP}`, 'revert:0'], 'two trials, then it stops trying');
  assert.equal(L.fails, PACE.PROBE_MAX_FAILS);
});

test('ladder: a GPU-bound phone without a timer (steady 33 ms) steps down until it runs at 60 Hz', () => {
  // GPU cost per step: 28, 24, 21, 16, 12 ms; a frame takes the next vsync after the GPU finishes
  const cost = [28, 24, 21, 16, 12, 8];
  const cadence = (s, i) => (cost[s] <= 15 ? 16.7 : 33.3) + jitter(i, 1);
  const { L, log } = simulate(cadence, () => -1, 300);
  assert.equal(L.step, 4, `settled at pixel ratio 1 (${log.join(' ')})`);
  assert.deepEqual(log, ['probe:4', 'keep:4', 'up:3', 'down:4'], 'trial, kept, one step back up lost 60 Hz, back down');
  // a phone that holds 60 Hz from step 2 climbs back to step 2
  const lighter = [24, 20, 15, 12, 10, 8];
  const r2 = simulate((s, i) => (lighter[s] <= 15 ? 16.7 : 33.3) + jitter(i, 1), () => -1, 300);
  assert.equal(r2.L.step, 2, r2.log.join(' '));
});

test('ladder: with a GPU timer a GPU-bound phone steps down without probing; a light GPU keeps full', () => {
  const cost = [26, 22, 19, 15, 11, 8];
  const heavy = simulate((s, i) => (cost[s] <= 15 ? 16.7 : 33.3) + jitter(i, 1), (s) => cost[s], 300);
  assert.ok(heavy.log.every((x) => x.startsWith('down')), heavy.log.join(' '));
  assert.equal(heavy.L.step, 3, 'down one step at a time until frames arrive on time (15 ms of GPU at pixel ratio 1.5)');
  const capped = simulate((s, i) => 33.3 + jitter(i, 1), () => 7, 120);
  assert.equal(capped.L.step, 0, 'a capped phone with a light GPU never steps');
});

test('ladder: a phone that stays slow reaches lite one step at a time; a player choice resets it', () => {
  const { L, log } = simulate((s, i) => (i % 3 ? 33.3 : 50) + jitter(i, 4), () => -1, 400);
  assert.equal(L.step, PACE.MAX_STEP, log.join(' '));
  assert.deepEqual(log.map((x) => x.split(':')[1]), ['1', '2', '3', '4', '5']);
  ladderReset(L);
  assert.equal(L.step, 0);
});

// ---------------------------------------------------------------- the GPU timer, on a fake WebGL2

function fakeGL({ ext = true, latency = 2, ns = 12e6 } = {}) {
  const calls = { begin: 0, end: 0 };
  let frame = 0, active = null;
  const done = new Map();
  const gl = {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
    disjoint: false,
    getExtension: (name) => (ext && name === 'EXT_disjoint_timer_query_webgl2' ? { TIME_ELAPSED_EXT: 9, GPU_DISJOINT_EXT: 10 } : null),
    createQuery: () => ({}),
    beginQuery: (kind, q) => { assert.equal(active, null, 'one query at a time'); active = q; calls.begin++; },
    endQuery: () => { done.set(active, frame + latency); active = null; calls.end++; },
    getQueryParameter: (q, what) => (what === 1 ? frame >= done.get(q) : ns),
    getParameter: (what) => (what === 10 ? gl.disjoint : null),
    tick() { frame++; },
    calls,
  };
  return gl;
}

test('gpu timer: results arrive late, the ring of four never blocks, a disjoint result is dropped', () => {
  const gl = fakeGL({ latency: 2 });
  const tm = createGpuTimer(gl);
  assert.equal(tm.available, true);
  const got = [];
  for (let f = 0; f < 10; f++) {
    tm.begin();
    tm.end();
    gl.tick();
    got.push(tm.poll());
  }
  assert.equal(got[0], -1, 'nothing on the first frame');
  assert.ok(got.slice(2).every((v) => v === 12), `12 ms from frame 3 on: ${got}`);
  gl.disjoint = true;
  tm.begin(); tm.end(); gl.tick(); gl.tick();
  assert.equal(tm.poll(), -1, 'a disjoint GPU clock drops the result');
  const slow = fakeGL({ latency: 100 });
  const ts = createGpuTimer(slow);
  for (let f = 0; f < 10; f++) { ts.begin(); ts.end(); slow.tick(); ts.poll(); }
  assert.equal(slow.calls.begin, 4, 'with every query waiting no new one starts');
  const none = createGpuTimer(fakeGL({ ext: false }));
  assert.equal(none.available, false);
  none.begin(); none.end();
  assert.equal(none.poll(), -1);
  assert.equal(createGpuTimer(null).available, false);
});
