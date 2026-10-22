// Kiln QA (G): the frame probe that runs inside the game page.
//
// installProbe() is serialised into the page (probeSource) so it must not use anything from this
// module's scope. It wraps window.requestAnimationFrame and, per displayed frame, records:
//   ts    the rAF timestamp (frame intervals: a missed vsync shows as ~33 ms at 60 Hz)
//   work  the main-thread time spent inside rAF callbacks (sim steps + renderer.frame + HUD +
//         audio): the part of a frame Kiln's code controls (with long tasks: the frame's cost)
//   flags 1 = a new world started this frame (level load), 2 = the probe restarted the target level
// Frames during warm-up (shader compiles) and just after a level load are excluded from the
// verdict and counted separately.
//
// The verdict (report().pass) fails when, after warm-up and loads:
//   - a frame's COST is over budget: its rAF work plus the main-thread long tasks (Chrome's
//     'longtask', over 50 ms) inside that frame's interval that are not its own rAF work (style,
//     layout, paint, GC, a promise callback, a model parse: all of it delays the next frame);
//   - any frame was DROPPED: an interval longer than the 60 fps target plus half a refresh period
//     (25 ms on a 60 Hz display, 20.8 ms at 120 Hz). The target is fixed, not the run's own median,
//     so a steady 30 fps counts every frame as dropped.
// report(16, { idleDrops: 'warn' }) turns drops on an idle main thread (no long task, rAF work in
// budget: the GPU, the compositor or another process on a shared machine) into warnings, as long
// as they stay at or under 1% of the frames (more is a steady GPU shortfall and still fails).
// Limit: tasks under 50 ms outside rAF are invisible to the long-task API; they show only as drops.
//
// In the page: __kilnQA.start(), __kilnQA.stop(), __kilnQA.report(16) → summary object.
// Built-in browser pass (the pane must be VISIBLE: a hidden pane runs as a background page and
// its frame times are meaningless), on a page opened with ?level=N&bot=1, javascript_tool:
//   const m = await import('/tools/qa/lib/probe.mjs'); m.installProbe({ target: N }); __kilnQA.start()
// then 60 s later: __kilnQA.stop(); __kilnQA.report(16)
// (or paste the output of `node tools/qa/frametime.mjs --print-probe` where modules cannot load).

/* eslint-disable no-undef */
export function installProbe(cfg) {
  const prev = window.__kilnQA;
  if (prev && prev.installed) {
    Object.assign(prev.cfg, cfg || {});
    return prev;
  }
  const CAP = 1 << 16;
  const Q = {
    installed: true,
    // targetMs: the frame interval to hold (60 fps); refreshMs: the display's refresh period
    // (0 = the 5th percentile of every interval, capped at targetMs); idleDrops: 'fail' or 'warn'
    cfg: Object.assign({ target: 0, warmup: 30, loadSkip: 10, fixture: null, restartGapMs: 5000,
      targetMs: 1000 / 60, refreshMs: 0, idleDrops: 'fail', idleDropShare: 0.01 }, cfg || {}),
    nextRestart: 0,
    n: 0,
    ts: new Float64Array(CAP),
    work: new Float64Array(CAP),
    workFrom: new Float64Array(CAP), // performance.now() when the frame's first rAF callback began
    workTo: new Float64Array(CAP),   // ... and when its last one ended
    flags: new Uint8Array(CAP),
    phase: new Uint8Array(CAP), // what the world was doing: index into PHASES
    remaining: new Int16Array(CAP),
    screen: new Array(CAP),     // glass screen shown, if any (sparse: only when one is up)
    collecting: false,
    worlds: 0,
    restarts: 0,
    sustainCalls: { splitBalls: 0, spawnBall: 0, spawnEmbers: 0, directBalls: 0, directEmbers: 0, dark: 0, heatHeld: 0 },
    load: { bricks: 0, balls: 0, embers: 0, dark: 0, samples: 0 },
    started: 0,
    stopped: 0,
  };
  const PHASES = ['?', 'serve', 'play', 'clearing', 'cleared', 'over'];
  // Long tasks (main-thread tasks over 50 ms, Chrome's PerformanceObserver 'longtask'): a gap
  // between frames that overlaps one was main-thread work outside rAF (a promise callback, a model
  // parse, GC); a gap with none was the GPU or compositor. Recorded always, filtered by time.
  const LT_CAP = 2048;
  Q.lt = { start: new Float64Array(LT_CAP), dur: new Float64Array(LT_CAP), n: 0, supported: false };
  try {
    const PO = typeof PerformanceObserver === 'function' ? PerformanceObserver : null;
    if (PO && Array.isArray(PO.supportedEntryTypes) && PO.supportedEntryTypes.indexOf('longtask') >= 0) {
      new PO(function (list) {
        const es = list.getEntries();
        for (let i = 0; i < es.length && Q.lt.n < LT_CAP; i++) {
          Q.lt.start[Q.lt.n] = es[i].startTime;
          Q.lt.dur[Q.lt.n] = es[i].duration;
          Q.lt.n++;
        }
      }).observe({ type: 'longtask' });
      Q.lt.supported = true;
    }
  } catch (e) { /* no long-task timing in this browser: gaps are reported without it */ }
  const raf = window.requestAnimationFrame.bind(window);
  let lastTs = -1;
  let lastWorld = null;

  function aliveCount(arr) {
    let n = 0;
    for (let i = 0; i < arr.length; i++) n += arr[i] ? 1 : 0;
    return n;
  }

  function liveBalls(w) {
    let n = 0;
    for (let i = 0; i < w.balls.length; i++) if (w.balls[i].alive) n++;
    return n;
  }

  // Keep a stress fixture at its load: N balls in flight, M embers falling, Blackout on.
  // Uses the owners' world.api first; writes the pools directly only while that api is a stub.
  function sustain(w, fx) {
    if (w.phase !== 'play') return;
    const want = fx.balls | 0;
    let live = liveBalls(w);
    if (want && live > 0 && live < want) {
      let src = null;
      for (let i = 0; i < w.balls.length; i++) if (w.balls[i].alive && !w.balls[i].held) { src = w.balls[i]; break; }
      // 1) the Multi/Fork seam, 2) A's spawnBall, 3) only if both are still stubs: write the pool
      if (src && typeof w.api.splitBalls === 'function') {
        w.api.splitBalls(want - live);
        Q.sustainCalls.splitBalls++;
        live = liveBalls(w);
      }
      for (let k = 0; src && live < want && k < want && typeof w.api.spawnBall === 'function'; k++) {
        const ang = 0.35 * (live % 2 ? 1 : -1);
        const c = Math.cos(ang), s = Math.sin(ang);
        w.api.spawnBall(src.x, src.y, src.vx * c - src.vy * s, src.vx * s + src.vy * c);
        Q.sustainCalls.spawnBall++;
        const now = liveBalls(w);
        if (now === live) break;
        live = now;
      }
      for (let i = 0; src && i < w.balls.length && live < want; i++) {
        const b = w.balls[i];
        if (b.alive) continue;
        const ang = 0.35 * (live % 2 ? 1 : -1);
        const c = Math.cos(ang), s = Math.sin(ang);
        Object.assign(b, src, { vx: src.vx * c - src.vy * s, vy: src.vx * s + src.vy * c, held: false });
        live++;
        Q.sustainCalls.directBalls++;
      }
    }
    const E = w.embers;
    let embers = aliveCount(E.alive);
    const wantE = fx.embers | 0;
    if (wantE && embers < wantE) {
      const B = w.bricks;
      let tries = 0;
      while (embers < wantE && tries++ < 40) {
        // a pseudo-random live brick (deterministic sequence; this is presentation load, not sim)
        const k = (Q.n * 7919 + tries * 104729) % Math.max(1, B.count || B.alive.length);
        if (!B.alive[k]) continue;
        const n = Math.min(4, wantE - embers);
        if (typeof w.api.spawnEmbers === 'function') {
          const before = embers;
          w.api.spawnEmbers(B.x[k], B.y[k], n);
          Q.sustainCalls.spawnEmbers++;
          embers = aliveCount(E.alive);
          if (embers > before) continue;
        }
        const left = w.level.mode === 'left';
        for (let i = 0, put = 0; i < E.alive.length && put < n; i++) {
          if (E.alive[i]) continue;
          E.alive[i] = 1;
          E.x[i] = E.px[i] = B.x[k] + ((put * 13) % 20) - 10;
          E.y[i] = E.py[i] = B.y[k];
          E.vx[i] = left ? -220 : 0;
          E.vy[i] = left ? 0 : 220;
          E.bornMs[i] = w.time;
          if (typeof E.count === 'number') E.count++;
          put++;
          embers++;
          Q.sustainCalls.directEmbers++;
        }
      }
    }
    if (fx.dark && !w.fx.dark) {
      w.fx.dark = 1;
      Q.sustainCalls.dark++;
    }
    // HEAT held at a ceiling (0 for the stress wall): the caught embers would otherwise fill it and
    // the robot's Overload would break 50 bricks a time, emptying the 300-brick wall in seconds
    if (typeof fx.heat === 'number' && w.econ && w.econ.heat > fx.heat) {
      w.econ.heat = fx.heat;
      Q.sustainCalls.heatHeld++;
    }
  }

  function frameStart(ts) {
    const k = window.__kiln;
    let w = k && k.world;
    let flag = 0;
    if (w && w !== lastWorld) {
      if (lastWorld) flag |= 1;
      lastWorld = w;
      Q.worlds++;
    }
    // Back to the target level when the game moved on (cleared, run over). Only while measuring,
    // and at most once per restartGapMs: starting a run can pass through pick screens first.
    const now = performance.now();
    if (Q.collecting && w && Q.cfg.target && w.level && w.level.n !== Q.cfg.target &&
        typeof k.startLevel === 'function' && now >= Q.nextRestart) {
      Q.nextRestart = now + Q.cfg.restartGapMs;
      k.startLevel(Q.cfg.target);
      Q.restarts++;
      flag |= 2;
      w = lastWorld = k.world;
    }
    if (w && Q.cfg.fixture) sustain(w, Q.cfg.fixture);
    if (!Q.collecting || Q.n >= CAP) return;
    if (Q.n === Q.cfg.warmup) {
      // C's renderer.stats.worst then leaves out the warm-up frames, as the probe does
      const rs = k && k.renderer && k.renderer.stats;
      if (rs && typeof rs.resetHist === 'function') rs.resetHist();
    }
    Q.ts[Q.n] = ts;
    Q.work[Q.n] = 0;
    Q.workFrom[Q.n] = -1;
    Q.workTo[Q.n] = -1;
    Q.flags[Q.n] = flag;
    Q.phase[Q.n] = w ? Math.max(0, PHASES.indexOf(w.phase)) : 0;
    Q.remaining[Q.n] = w ? w.level.remaining : -1;
    Q.screen[Q.n] = k && k.ui && k.ui.current ? k.ui.current : undefined;
    if (w && Q.n % 30 === 0) {
      Q.load.bricks += aliveCount(w.bricks.alive);
      Q.load.balls += liveBalls(w);
      Q.load.embers += aliveCount(w.embers.alive);
      Q.load.dark += w.fx.dark ? 1 : 0;
      Q.load.samples++;
    }
    Q.n++;
  }

  // hold: the page's rAF callbacks wait (the game loop stops) until release()
  const held = [];
  Q.hold = false;
  Q.release = function () {
    Q.hold = false;
    const cbs = held.splice(0);
    for (let i = 0; i < cbs.length; i++) window.requestAnimationFrame(cbs[i]);
    return cbs.length;
  };

  window.requestAnimationFrame = function kilnProbeRaf(cb) {
    return raf(function (ts) {
      if (Q.hold) {
        held.push(cb);
        return;
      }
      if (ts !== lastTs) {
        lastTs = ts;
        frameStart(ts);
      }
      const t0 = performance.now();
      try {
        cb(ts);
      } finally {
        if (Q.collecting && Q.n > 0) {
          const t1 = performance.now();
          const f = Q.n - 1;
          Q.work[f] += t1 - t0;
          if (Q.workFrom[f] < 0) Q.workFrom[f] = t0;
          Q.workTo[f] = t1;
        }
      }
    });
  };

  Q.start = function () {
    Q.n = 0;
    Q.worlds = 0;
    Q.restarts = 0;
    Q.load = { bricks: 0, balls: 0, embers: 0, dark: 0, samples: 0 };
    Q.lt.n = 0;
    Q.collecting = true;
    Q.started = performance.now();
    Q.stopped = 0;
    return true;
  };
  Q.stop = function () {
    Q.collecting = false;
    Q.stopped = performance.now();
    return Q.n;
  };

  // Draw n frames by hand (renderer.frame at 1/60 s, alpha 1) for the allocation check: the caller
  // holds rAF, takes a full GC and the heap size over DevTools, calls this, reads the heap again
  // (frametime.mjs; performance.memory does not move inside one task, even with
  // --enable-precise-memory-info). Returns the frames drawn, 0 when there is no renderer or world.
  Q.drawFrames = function (n) {
    const k = window.__kiln;
    if (!k || !k.renderer || typeof k.renderer.frame !== 'function' || !k.world) return 0;
    for (let i = 0; i < n; i++) k.renderer.frame(k.world, 1, 1 / 60);
    return n;
  };

  Q.report = function (budget, opts) {
    budget = budget || 16;
    const o = Object.assign({ idleDrops: Q.cfg.idleDrops, idleDropShare: Q.cfg.idleDropShare }, opts || {});
    const n = Q.n;
    const counted = new Uint8Array(n);
    let skipUntil = Q.cfg.warmup;
    let loadFrames = 0;
    let loadMax = 0;
    let warmMax = 0;
    for (let i = 0; i < n; i++) {
      if (Q.flags[i]) {
        skipUntil = Math.max(skipUntil, i + Q.cfg.loadSkip);
        loadFrames++;
      }
      if (i < skipUntil) {
        if (i < Q.cfg.warmup) warmMax = Math.max(warmMax, Q.work[i]);
        else loadMax = Math.max(loadMax, Q.work[i]);
        continue;
      }
      counted[i] = 1;
    }
    const sorted = (a) => a.slice().sort((x, y) => x - y);
    const pct = (s, p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
    const r2 = (v) => Math.round(v * 100) / 100;
    const t0 = Q.started;
    const t1 = Q.stopped || performance.now();
    // main-thread long-task time inside [a, b]
    const ltOverlap = (a, b) => {
      let s = 0;
      for (let j = 0; j < Q.lt.n; j++) {
        const lo = Math.max(a, Q.lt.start[j]);
        const hi = Math.min(b, Q.lt.start[j] + Q.lt.dur[j]);
        if (hi > lo) s += hi - lo;
      }
      return s;
    };
    let ltCount = 0, ltMax = 0, ltTotal = 0;
    for (let j = 0; j < Q.lt.n; j++) {
      if (Q.lt.start[j] + Q.lt.dur[j] < t0 || Q.lt.start[j] > t1) continue;
      ltCount++;
      ltTotal += Q.lt.dur[j];
      if (Q.lt.dur[j] > ltMax) ltMax = Q.lt.dur[j];
    }
    // per counted frame: long-task time in its interval [ts[i], ts[i+1]) that is not its own rAF
    // work (a long task that holds the rAF callbacks is counted once, as work)
    const outside = new Float64Array(n);
    if (Q.lt.supported) {
      for (let i = 0; i < n; i++) {
        if (!counted[i]) continue;
        const a = Q.ts[i];
        const b = i + 1 < n ? Q.ts[i + 1] : t1;
        let x = ltOverlap(a, b);
        if (x > 0 && Q.workFrom[i] >= 0) x -= ltOverlap(Math.max(a, Q.workFrom[i]), Math.min(b, Q.workTo[i]));
        outside[i] = Math.max(0, x);
      }
    }
    const work = [];
    const cost = [];
    const intervals = [];
    for (let i = 0; i < n; i++) {
      if (!counted[i]) continue;
      work.push(Q.work[i]);
      cost.push(Q.work[i] + outside[i]);
      if (i > 0 && counted[i - 1]) intervals.push(Q.ts[i] - Q.ts[i - 1]);
    }
    // dropped frames, against the 60 fps target (never the run's own median): the display's
    // refresh period is the 5th percentile of every interval (warm-up too), capped at the target
    const all = [];
    for (let i = 1; i < n; i++) all.push(Q.ts[i] - Q.ts[i - 1]);
    const targetMs = Q.cfg.targetMs || 1000 / 60;
    let refreshMs = Q.cfg.refreshMs || (all.length >= 10 ? pct(sorted(all), 0.05) : targetMs);
    refreshMs = Math.min(targetMs, Math.max(1000 / 240, refreshMs));
    const dropLimit = targetMs + refreshMs / 2;
    const ws = sorted(work);
    const cs = sorted(cost);
    const is = sorted(intervals);
    // the dropped intervals and what was going on; idle = no long task and rAF work in budget
    const gaps = [];
    let idleDropped = 0;
    for (let i = 1; i < n; i++) {
      if (!counted[i] || !counted[i - 1]) continue;
      const iv = Q.ts[i] - Q.ts[i - 1];
      if (iv <= dropLimit) continue;
      const idle = Q.lt.supported && outside[i - 1] === 0 && Q.work[i - 1] <= budget;
      if (idle) idleDropped++;
      gaps.push([i, iv, idle]);
    }
    gaps.sort((a, b) => b[1] - a[1]);
    const dropped = gaps.length;
    const busyDropped = dropped - idleDropped;
    const idleAllowed = Math.floor(o.idleDropShare * intervals.length);
    const worst = [];
    for (let i = 0; i < n; i++) if (counted[i]) worst.push([i, Q.work[i] + outside[i]]);
    worst.sort((a, b) => b[1] - a[1]);
    const costMax = cs[cs.length - 1] || 0;
    const fps = n / Math.max(0.001, (t1 - t0) / 1000);
    const fails = [];
    const warnings = [];
    if (!work.length) fails.push('no frame was counted');
    if (costMax > budget) {
      fails.push(`${cost.filter((v) => v > budget).length} frame(s) over ${budget} ms (worst ${r2(costMax)} ms: rAF work plus long tasks outside rAF)`);
    }
    if (dropped) {
      const what = `${dropped} dropped frame(s) (interval over ${r2(dropLimit)} ms; ${r2(fps)} fps)`;
      if (o.idleDrops !== 'warn') fails.push(what);
      else if (busyDropped) fails.push(`${what}, ${busyDropped} with the main thread busy or not measurable`);
      else if (idleDropped > idleAllowed) fails.push(`${what}, all on an idle main thread but over ${Math.round(o.idleDropShare * 100)}% of frames (${idleAllowed} allowed): a steady GPU shortfall`);
      else warnings.push(`${what}, all on an idle main thread (GPU, compositor or another process): a warning only`);
    }
    const L = Q.load;
    const k = window.__kiln || {};
    return {
      budgetMs: budget,
      seconds: r2((t1 - t0) / 1000),
      frames: n,
      counted: work.length,
      fps: r2(fps),
      // the verdict: rAF work plus long tasks outside rAF in the frame's interval
      cost: {
        max: r2(costMax), p99: r2(pct(cs, 0.99)), p95: r2(pct(cs, 0.95)), p50: r2(pct(cs, 0.5)),
        overBudget: cost.filter((v) => v > budget).length,
      },
      // rAF work alone (sim steps + renderer.frame + HUD + audio)
      work: {
        max: r2(ws[ws.length - 1] || 0), p99: r2(pct(ws, 0.99)), p95: r2(pct(ws, 0.95)), p50: r2(pct(ws, 0.5)),
        mean: r2(work.reduce((s, v) => s + v, 0) / Math.max(1, work.length)),
        overBudget: work.filter((v) => v > budget).length,
      },
      interval: {
        p50: r2(pct(is, 0.5)), p99: r2(pct(is, 0.99)), max: r2(is[is.length - 1] || 0),
        dropped, idleDropped, busyDropped, dropLimit: r2(dropLimit), refreshMs: r2(refreshMs), targetMs: r2(targetMs),
      },
      excluded: { warmupFrames: Math.min(n, Q.cfg.warmup), warmupMaxWork: r2(warmMax), loadFrames, loadMaxWork: r2(loadMax) },
      worst: worst.slice(0, 5).map(([i, c]) => ({
        frame: i, cost: r2(c), work: r2(Q.work[i]), outsideMs: r2(outside[i]),
        interval: r2(i + 1 < n ? Q.ts[i + 1] - Q.ts[i] : 0), atS: r2((Q.ts[i] - Q.ts[0]) / 1000),
        phase: PHASES[Q.phase[i]], remaining: Q.remaining[i], screen: Q.screen[i] || null,
      })),
      // gap = time from frame i-1 to frame i; workBefore = frame i-1's own rAF work;
      // longTaskMs = long tasks in the gap outside that rAF work (null when the browser cannot
      // tell); idle = no long task and rAF work in budget
      gaps: gaps.slice(0, 5).map(([i, iv, idle]) => ({
        frame: i, gap: r2(iv), atS: r2((Q.ts[i - 1] - Q.ts[0]) / 1000), workBefore: r2(Q.work[i - 1]),
        longTaskMs: Q.lt.supported ? r2(outside[i - 1]) : null, idle,
        phase: PHASES[Q.phase[i]], remaining: Q.remaining[i], screen: Q.screen[i] || null,
      })),
      longTasks: Q.lt.supported ? { count: ltCount, maxMs: r2(ltMax), totalMs: r2(ltTotal) } : null,
      worlds: Q.worlds,
      restarts: Q.restarts,
      load: L.samples ? { bricks: Math.round(L.bricks / L.samples), balls: r2(L.balls / L.samples), embers: Math.round(L.embers / L.samples), darkShare: r2(L.dark / L.samples) } : null,
      sustain: Q.cfg.fixture ? Object.assign({}, Q.sustainCalls) : null,
      game: {
        level: k.world ? k.world.level.n : null,
        levelId: k.world ? k.world.level.def.id : null,
        mainMaxFrameMs: k.stats ? r2(k.stats.maxFrameMs || 0) : null,
        rendererFrameMs: k.renderer && k.renderer.stats ? r2(k.renderer.stats.frameMs || 0) : null,
        // C's renderer.stats.worst: the renderer's worst frame after warm-up, split update / draw
        rendererWorst: k.renderer && k.renderer.stats && k.renderer.stats.worst
          ? { ms: r2(k.renderer.stats.worst.ms || 0), updateMs: r2(k.renderer.stats.worst.updateMs || 0), renderMs: r2(k.renderer.stats.worst.renderMs || 0), programs: k.renderer.stats.worst.programs ?? null }
          : null,
        drawCalls: k.renderer && k.renderer.stats ? k.renderer.stats.calls : null,
        triangles: k.renderer && k.renderer.stats ? k.renderer.stats.triangles : null,
      },
      idleDrops: o.idleDrops,
      fails,
      warnings,
      pass: fails.length === 0,
    };
  };

  window.__kilnQA = Q;
  return Q;
}

/**
 * The allocation verdict from per-trial heap deltas (bytes after minus before, over `frames`
 * frames each): the median bytes a frame, so a scavenge inside one trial only moves that trial.
 */
export function allocSummary(deltas, frames) {
  const per = deltas.map((d) => d / frames);
  const s = per.slice().sort((x, y) => x - y);
  return { bytesPerFrame: s.length ? Math.round(s[Math.floor(s.length / 2)]) : 0, trials: per.map(Math.round), frames };
}

/** JavaScript source that installs the probe with this config (Page.addScriptToEvaluateOnNewDocument or a paste). */
export function probeSource(cfg = {}) {
  return `(${installProbe.toString()})(${JSON.stringify(cfg)});`;
}
