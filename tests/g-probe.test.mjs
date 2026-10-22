// G: the frame probe's arithmetic (tools/qa/lib/probe.mjs) on a fake page with a fake clock:
// warm-up and level loads are excluded, the target level is restarted, work and dropped frames
// are measured from what the page's rAF callbacks really cost.

import { test, assert } from './lib.mjs';
import { installProbe, probeSource, allocSummary } from '../tools/qa/lib/probe.mjs';

function fakePage() {
  let now = 0;
  let lastTs = 0;
  const queue = [];
  Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
  const world = (n) => ({
    level: { n, mode: 'bottom', def: { id: `l${n}` } },
    phase: 'play',
    balls: [{ alive: true }],
    bricks: { alive: new Uint8Array([1, 1, 0]), count: 3, x: new Float32Array(3), y: new Float32Array(3) },
    embers: { alive: new Uint8Array(4) },
    fx: { dark: 0 },
    stats: { apiMissing: {} },
    api: {},
  });
  const kiln = { world: world(5), stats: { maxFrameMs: 0 }, startLevel(n) { kiln.world = world(n); kiln.started.push(n); }, started: [] };
  globalThis.window = { requestAnimationFrame: (cb) => queue.push(cb), __kiln: kiln };
  return {
    kiln,
    world,
    advance(ms) { now += ms; },
    /** One displayed frame `intervalMs` after the previous one: run every queued callback. */
    frame(intervalMs) {
      lastTs += intervalMs;
      now = Math.max(now, lastTs);
      const ts = lastTs;
      const cbs = queue.splice(0);
      for (const cb of cbs) cb(ts);
    },
    queue,
  };
}

test('probe: work per frame, warm-up and level loads excluded, restarts the target', () => {
  const page = fakePage();
  const Q = installProbe({ target: 5, warmup: 3, loadSkip: 2 });
  assert.equal(globalThis.window.__kilnQA, Q);
  // the game's loop: each frame asks for the next one and costs `cost` ms
  let cost = 2;
  const tick = () => { page.advance(cost); globalThis.window.requestAnimationFrame(tick); };
  globalThis.window.requestAnimationFrame(tick);
  Q.start();
  for (let i = 0; i < 20; i++) {
    cost = i === 1 ? 40 : i === 12 ? 9 : 2;      // frame 1: warm-up spike; frame 12: a slow frame
    if (i === 8) page.kiln.world = page.world(1); // the game moved on: probe must restart level 5
    page.frame(16.7);
  }
  Q.stop();
  const r = Q.report(16);
  assert.equal(r.frames, 20);
  assert.deepEqual(page.kiln.started, [5], 'the probe sent the game back to the target level');
  assert.equal(r.restarts, 1);
  assert.equal(r.excluded.warmupFrames, 3);
  assert.equal(r.excluded.warmupMaxWork, 40);
  assert.equal(r.excluded.loadFrames, 1);
  assert.equal(r.counted, 20 - 3 - 2, 'warm-up (3) and the load frame plus one after it (2) are out');
  assert.equal(r.work.max, 9);
  assert.equal(r.work.overBudget, 0);
  assert.equal(r.pass, true);
  assert.equal(r.worst[0].frame, 12);
});

test('probe: a frame over budget fails; a long interval counts as dropped', () => {
  const page = fakePage();
  const Q = installProbe({ target: 0, warmup: 0 });
  let cost = 1;
  const tick = () => { page.advance(cost); globalThis.window.requestAnimationFrame(tick); };
  globalThis.window.requestAnimationFrame(tick);
  Q.start();
  for (let i = 0; i < 30; i++) {
    cost = i === 20 ? 17 : 1;
    page.frame(i === 21 ? 33.4 : 16.7);
  }
  Q.stop();
  const r = Q.report(16);
  assert.equal(r.work.max, 17);
  assert.equal(r.work.overBudget, 1);
  assert.equal(r.pass, false);
  assert.equal(r.interval.dropped, 1);
});

test('probe: the longest gaps are listed and split into long tasks vs an idle main thread', () => {
  const page = fakePage();
  // a fake Chrome long-task observer (Node's own PerformanceObserver has no 'longtask')
  const observers = [];
  class FakePO {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe(opts) { this.type = opts.type; }
  }
  FakePO.supportedEntryTypes = ['longtask'];
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'PerformanceObserver');
  Object.defineProperty(globalThis, 'PerformanceObserver', { value: FakePO, configurable: true, writable: true });
  try {
    const Q = installProbe({ target: 0, warmup: 0 });
    assert.equal(observers.length, 1);
    assert.equal(observers[0].type, 'longtask');
    const tick = () => { page.advance(2); globalThis.window.requestAnimationFrame(tick); };
    globalThis.window.requestAnimationFrame(tick);
    Q.start();
    const ts = [];
    for (let i = 0; i < 40; i++) {
      // frame 10 comes 150 ms late (a long task fills the gap), frame 30 comes 100 ms late (none)
      page.frame(i === 10 ? 150 : i === 30 ? 100 : 16.7);
      ts.push(Number(Q.ts[Q.n - 1]));
    }
    const entry = (startTime, duration) => ({ startTime, duration });
    observers[0].cb({ getEntries: () => [entry(ts[9] + 5, 130), entry(ts[0] - 500, 80)] }); // 2nd: before start
    Q.stop();
    const r = Q.report(16);
    assert.equal(r.interval.dropped, 2);
    assert.equal(r.gaps.length, 2);
    assert.deepEqual(r.gaps.map((g) => g.frame), [10, 30], 'longest gap first');
    assert.equal(r.gaps[0].gap, 150);
    assert.equal(r.gaps[0].longTaskMs, 130, 'the long task inside the 150 ms gap');
    assert.equal(r.gaps[1].longTaskMs, 0, 'nothing on the main thread during the 100 ms gap');
    assert.equal(r.gaps[0].phase, 'play');
    assert.deepEqual(r.longTasks, { count: 1, maxMs: 130, totalMs: 130 }, 'the task from before start() is left out');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'PerformanceObserver', saved);
    else delete globalThis.PerformanceObserver;
  }
});

test('probe: without long-task timing the gaps are still listed', () => {
  const page = fakePage();
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'PerformanceObserver');
  Object.defineProperty(globalThis, 'PerformanceObserver', { value: undefined, configurable: true, writable: true });
  try {
    const Q = installProbe({ target: 0, warmup: 0 });
    const tick = () => { page.advance(1); globalThis.window.requestAnimationFrame(tick); };
    globalThis.window.requestAnimationFrame(tick);
    Q.start();
    for (let i = 0; i < 20; i++) page.frame(i === 5 ? 50 : 16.7);
    Q.stop();
    const r = Q.report(16);
    assert.equal(r.gaps.length, 1);
    assert.equal(r.gaps[0].longTaskMs, null);
    assert.equal(r.longTasks, null);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'PerformanceObserver', saved);
    else delete globalThis.PerformanceObserver;
  }
});

/** Run fn with a fake Chrome long-task observer installed; fn gets emit([[startTime, duration], ...]). */
function withLongTasks(fn) {
  const observers = [];
  class FakePO {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe(opts) { this.type = opts.type; }
  }
  FakePO.supportedEntryTypes = ['longtask'];
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'PerformanceObserver');
  Object.defineProperty(globalThis, 'PerformanceObserver', { value: FakePO, configurable: true, writable: true });
  try {
    const emit = (entries) => observers[0].cb({ getEntries: () => entries.map(([startTime, duration]) => ({ startTime, duration })) });
    return fn(emit);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'PerformanceObserver', saved);
    else delete globalThis.PerformanceObserver;
  }
}

/** A game loop whose frame i costs cost(i) ms, shown at interval(i) ms; returns the probe and frame times. */
function playFrames(page, Q, count, cost, interval) {
  let i = 0;
  const tick = () => { page.advance(cost(i)); globalThis.window.requestAnimationFrame(tick); };
  globalThis.window.requestAnimationFrame(tick);
  Q.start();
  const ts = [];
  for (i = 0; i < count; i++) {
    page.frame(interval(i));
    ts.push(Number(Q.ts[Q.n - 1]));
  }
  return ts;
}

test('probe: a steady 30 fps run fails, even with idle drops as warnings', () => {
  withLongTasks(() => {
    const page = fakePage();
    const Q = installProbe({ target: 0, warmup: 0 });
    playFrames(page, Q, 120, () => 2, () => 1000 / 30);
    Q.stop();
    const r = Q.report(16);
    assert.equal(r.cost.max, 2, 'every frame is cheap on the main thread');
    assert.equal(r.interval.refreshMs, 16.67, 'the refresh period is capped at the 60 fps target, never the run median');
    assert.equal(r.interval.dropLimit, 25);
    assert.equal(r.interval.dropped, 119, 'every 33 ms interval is a dropped frame');
    assert.ok(r.fps < 31);
    assert.equal(r.pass, false);
    const warn = Q.report(16, { idleDrops: 'warn' });
    assert.equal(warn.interval.idleDropped, 119, 'no long task: the main thread was idle');
    assert.equal(warn.pass, false, 'a steady GPU shortfall still fails with --idle-drops warn');
    assert.match(warn.fails.join(' '), /steady GPU shortfall/);
  });
});

test('probe: a 110 ms long task between two short rAF frames fails the frame', () => {
  withLongTasks((emit) => {
    const page = fakePage();
    const Q = installProbe({ target: 0, warmup: 0 });
    // frame 9 costs 2 ms of rAF work, then the main thread is busy 110 ms (a promise callback, a
    // parse, GC); frame 10 comes 8 vsyncs later
    const ts = playFrames(page, Q, 40, () => 2, (i) => (i === 10 ? 8 * 16.67 : 16.67));
    emit([[ts[9] + 3, 110]]);
    Q.stop();
    const r = Q.report(16);
    assert.equal(r.work.max, 2, 'the rAF work alone is in budget (the old verdict passed this)');
    assert.equal(r.cost.max, 112, 'the frame costs its rAF work plus the long task in its interval');
    assert.equal(r.worst[0].frame, 9);
    assert.equal(r.worst[0].outsideMs, 110);
    assert.equal(r.cost.overBudget, 1);
    assert.equal(r.interval.dropped, 1);
    assert.equal(r.interval.busyDropped, 1);
    assert.equal(r.gaps[0].idle, false);
    assert.equal(r.pass, false);
    assert.match(r.fails[0], /1 frame\(s\) over 16 ms/);
    assert.equal(Q.report(16, { idleDrops: 'warn' }).pass, false, 'a busy main thread is never excused');
  });
});

test('probe: a long task that holds the rAF work is counted once', () => {
  withLongTasks((emit) => {
    const page = fakePage();
    const Q = installProbe({ target: 0, warmup: 0 });
    // frame 20: 60 ms of rAF work inside one 70 ms task (starts 1 ms before the callbacks)
    const ts = playFrames(page, Q, 40, (i) => (i === 20 ? 60 : 2), (i) => (i === 21 ? 5 * 16.67 : 16.67));
    emit([[ts[20] - 1, 70]]);
    Q.stop();
    const r = Q.report(16);
    assert.equal(r.worst[0].frame, 20);
    assert.equal(r.worst[0].work, 60);
    assert.equal(r.worst[0].outsideMs, 9, 'only the 9 ms after the callbacks inside the frame interval');
    assert.equal(r.cost.max, 69);
  });
});

test('probe: a few drops on an idle main thread are warnings with idleDrops warn, failures by default', () => {
  withLongTasks(() => {
    const page = fakePage();
    const Q = installProbe({ target: 0, warmup: 0 });
    playFrames(page, Q, 400, () => 2, (i) => (i === 100 || i === 300 ? 33.33 : 16.67));
    Q.stop();
    const strict = Q.report(16);
    assert.equal(strict.interval.dropped, 2);
    assert.equal(strict.pass, false, 'drops fail by default');
    const warn = Q.report(16, { idleDrops: 'warn' });
    assert.equal(warn.interval.idleDropped, 2);
    assert.equal(warn.pass, true);
    assert.equal(warn.warnings.length, 1);
    assert.match(warn.warnings[0], /2 dropped frame\(s\).*idle main thread/);
  });
});

test('probe: at 120 Hz two vsyncs are on target and three are a drop', () => {
  withLongTasks(() => {
    const page = fakePage();
    const Q = installProbe({ target: 0, warmup: 0 });
    playFrames(page, Q, 200, () => 2, (i) => (i < 60 ? 8.33 : i === 150 ? 25 : 16.67));
    Q.stop();
    const r = Q.report(16);
    assert.equal(r.interval.refreshMs, 8.33);
    assert.equal(r.interval.dropLimit, 20.83);
    assert.equal(r.interval.dropped, 1, 'only the 25 ms interval');
  });
});

test('probe: hold stops the game loop until release', () => {
  const page = fakePage();
  const Q = installProbe({ target: 0, warmup: 0 });
  let ticks = 0;
  const tick = () => { ticks++; globalThis.window.requestAnimationFrame(tick); };
  globalThis.window.requestAnimationFrame(tick);
  page.frame(16.7);
  assert.equal(ticks, 1);
  Q.hold = true;
  page.frame(16.7);
  page.frame(16.7);
  assert.equal(ticks, 1, 'held: the callback waits');
  assert.equal(Q.release(), 1, 'one callback was waiting');
  page.frame(16.7);
  assert.equal(ticks, 2, 'released: the loop runs again');
});

test('probe: frames drawn by hand for the allocation check, median bytes a frame', () => {
  const page = fakePage();
  const calls = [];
  page.kiln.renderer = { frame(w, alpha, dt) { calls.push([w, alpha, dt]); } };
  const Q = installProbe({ target: 0 });
  assert.equal(Q.drawFrames(60), 60);
  assert.equal(calls.length, 60);
  assert.deepEqual(calls[0], [page.kiln.world, 1, 1 / 60], 'the live world, alpha 1, one 60 Hz frame in seconds');
  page.kiln.world = null;
  assert.equal(Q.drawFrames(60), 0, 'no world: nothing drawn, the check reports it could not run');
  // 24 KB a frame in 8 trials; one trial had a scavenge mid-way (its delta is meaningless)
  const deltas = [24, 24, 24, 24, -30, 24, 24.5, 23.5, 24].map((kb) => kb * 1024 * 60);
  const s = allocSummary(deltas, 60);
  assert.equal(s.bytesPerFrame, 24 * 1024, 'the median ignores the scavenge trial');
  assert.equal(s.trials.length, 9);
  assert.equal(s.frames, 60);
});

test('probe source is self-contained (no outer references)', () => {
  const src = probeSource({ target: 7 });
  assert.match(src, /^\(function installProbe\(cfg\)/);
  assert.match(src, /\(\{"target":7\}\);$/);
  // evaluating it in a fresh function scope must not throw for a missing outer binding
  fakePage();
  new Function(src)();
  assert.equal(globalThis.window.__kilnQA.cfg.target, 7);
});
