// Completion ownership and lifecycle only. No renderer, WebGL, reflection or readiness claim.
import { test, assert } from './lib.mjs';
import { submitShaderPreparation } from '../src/render/shader-preparation.js';

/** The page's visibility (a document with only the Page Visibility API). */
class Page {
  listeners = new Set();
  constructor(state) { this.visibilityState = state; }
  addEventListener(name, fn) { assert.equal(name, 'visibilitychange'); this.listeners.add(fn); }
  removeEventListener(name, fn) { if (name === 'visibilitychange') this.listeners.delete(fn); }
  set(state) { this.visibilityState = state; for (const fn of [...this.listeners]) fn(); }
}
class Scheduler {
  time = 0; id = 0; jobs = new Map(); history = new Map(); maximumActive = 0; cleared = [];
  constructor(document = null) { this.document = document; }
  now() { return this.time; }
  setTimeout(callback, delay) {
    // A hidden page's timers are throttled to at most one a second, as in a browser's background tab.
    const wait = this.document?.visibilityState === 'hidden' ? Math.max(delay, 1000) : delay;
    const id = ++this.id, job = { callback, at: this.time + wait, delay };
    this.jobs.set(id, job); this.history.set(id, job); this.maximumActive = Math.max(this.maximumActive, this.jobs.size);
    return id;
  }
  clearTimeout(id) { this.cleared.push(id); this.jobs.delete(id); }
  first() { return [...this.jobs].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]; }
  next() {
    const row = this.first();
    assert.ok(row, 'one scheduled callback exists');
    // A callback that was due while script could not run (a frozen page) runs late, not back in time.
    const [id, job] = row; this.jobs.delete(id); this.time = Math.max(this.time, job.at); job.callback();
    return id;
  }
  /** A running page: `ms` pass and every timer that falls due runs, in order. */
  pass(ms) {
    const end = this.time + ms;
    for (let row = this.first(); row && row[1].at <= end; row = this.first()) this.next();
    this.time = end;
  }
  /** A frozen or suspended page: `ms` pass and no script runs. */
  suspend(ms) { this.time += ms; }
  stale(id) { this.history.get(id).callback(); }
}
function fixture({ khr = true, ready = [0, 0, 0], timeoutMs = 12000, visibility = 'visible' } = {}) {
  // visibility null: a browser without the Page Visibility API (no document for the deadline).
  const scheduler = new Scheduler(visibility === null ? null : new Page(visibility));
  const controller = new AbortController(), calls = [], pending = new Set(ready.map((_, i) => i));
  const state = { epoch: 7, lost: false, disposed: false, compileError: null, readinessError: null, extensionError: null, afterQuery: null, afterCompile: null };
  const programs = ready.map((at, id) => ({ id, program: { id },
    getUniforms() { throw Error('helper must not reflect uniforms'); },
    getAttributes() { throw Error('helper must not reflect attributes'); },
    isReady() { throw Error('owned completion queries only the captured native handle'); } }));
  const native = {
    isContextLost() { calls.push(['lost']); return state.lost; },
    getExtension(name) { calls.push(['extension', name]); if (state.extensionError) throw state.extensionError; return khr ? { COMPLETION_STATUS_KHR: 0x91b1 } : null; },
    getProgramParameter(handle, parameter) {
      calls.push(['query', handle.id, parameter]);
      assert.equal(parameter, 0x91b1, 'no pre-ready LINK_STATUS or other program query');
      if (state.readinessError) throw state.readinessError;
      const value = scheduler.time >= ready[handle.id];
      if (value) pending.delete(handle.id);
      state.afterQuery?.(handle.id);
      return value;
    },
    getProgramInfoLog() { throw Error('helper must not fetch driver logs'); },
    getShaderParameter() { throw Error('helper must not inspect compile status'); },
  };
  const a = { id: 10, uuid: 'material-a', name: 'shared', type: 'ShaderMaterial', version: 2 };
  const b = { id: 11, uuid: 'material-b', name: 'other', type: 'MeshBasicMaterial', version: 5 };
  const props = new Map([
    [a, { programs: new Map([['front', programs[0]], ['back', programs[1]], ['duplicate', programs[0]]]), currentProgram: programs[2] }],
    [b, { programs: new Map([['shared', programs[1]]]), currentProgram: programs[1] }],
  ]);
  const scene = {}, camera = {}, renderer = {
    getContext() { calls.push(['context']); return native; },
    compile(s, c) { calls.push(['compile']); assert.equal(s, scene); assert.equal(c, camera); if (state.compileError) throw state.compileError; state.afterCompile?.(); return new Set([a, b]); },
    properties: { get(material) { calls.push(['properties', material.id]); return props.get(material); } },
  };
  const options = { epoch: state.epoch, getEpoch: () => state.epoch, isDisposed: () => state.disposed, signal: controller.signal, scheduler, timeoutMs, pollMs: 10 };
  return { scheduler, controller, state, calls, programs, props, a, b, pending, ready, renderer, scene, camera, options,
    page: scheduler.document, submit: () => submitShaderPreparation(renderer, scene, camera, options) };
}
const queryCount = f => f.calls.filter(row => row[0] === 'query').length;
const compileCount = f => f.calls.filter(row => row[0] === 'compile').length;
const noDangling = f => {
  assert.equal(f.scheduler.jobs.size, 0); assert.ok(f.scheduler.maximumActive <= 1);
  assert.equal(f.page?.listeners.size ?? 0, 0, 'no visibility listener outlives the job');
};
const settledFlag = job => { const flag = { settled: false }; job.done.then(() => { flag.settled = true; }, () => { flag.settled = true; }); return flag; };
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

// These tests attach rejection handlers before advancing their fake scheduler.
test('submits public compile synchronously and waits for every deduplicated variant, including current-only programs', async () => {
  const f = fixture({ ready: [0, 30, 50] }), job = f.submit();
  let settled = false; const completion = job.done.then(result => { settled = true; return result; });
  assert.equal(compileCount(f), 1, 'submission has finished before the caller restores its transaction');
  assert.equal(queryCount(f), 0, 'no driver readiness query occurs inside submission');
  assert.equal(f.scheduler.jobs.size, 1); assert.equal(settled, false);
  f.a.version = 99;
  f.props.get(f.a).programs = new Map([['later', { id: 99, program: { id: 99 } }]]);
  f.props.get(f.a).currentProgram = f.props.get(f.a).programs.get('later');
  f.scheduler.next(); f.scheduler.next(); f.scheduler.next(); f.scheduler.next();
  await Promise.resolve(); assert.equal(settled, false, 'the final pending current-only variant still owns completion');
  f.scheduler.next(); const result = await completion;
  assert.deepEqual(result.programs, f.programs); assert.equal(result.programs.length, 3);
  assert.deepEqual(result.materials.map(m => [m.id, m.version, m.programIds]), [[10, 2, [0, 1, 2]], [11, 5, [1]]]);
  assert.equal(result.capability, 'parallel'); assert.equal(result.polls, 5); assert.equal(result.completionMs, 50);
  assert.equal(compileCount(f), 1); assert.ok(f.calls.filter(x => x[0] === 'query').every(x => x[1] < 3), 'later mutable program maps are never re-read');
  noDangling(f); const queries = queryCount(f); f.scheduler.stale(1); assert.equal(queryCount(f), queries); assert.equal(job.cancel(), false);
});

test('no-KHR branch yields exactly once, reports its blocking fallback, and performs no readiness or reflection query', async () => {
  const f = fixture({ khr: false, ready: [Infinity, Infinity, Infinity] }), job = f.submit();
  let completed = false; const done = job.done.then(result => { completed = true; return result; });
  await Promise.resolve(); assert.equal(completed, false); assert.equal(f.scheduler.jobs.size, 1);
  assert.equal([...f.scheduler.jobs.values()][0].delay, 0);
  f.scheduler.next(); const result = await done;
  assert.equal(result.capability, 'synchronous-fallback'); assert.equal(result.polls, 1); assert.equal(result.programs.length, 3);
  assert.equal(queryCount(f), 0); assert.equal(compileCount(f), 1); noDangling(f);
});

test('synchronous compile errors reject once without starting a timer or trying another submission', async () => {
  const f = fixture(), error = new Error('compile submission failed'); f.state.compileError = error;
  const job = f.submit(); await assert.rejects(job.done, got => got === error);
  assert.equal(compileCount(f), 1); assert.equal(queryCount(f), 0); assert.equal(job.cancel(), false); noDangling(f);
});

test('readiness and extension exceptions reject through the owned promise with no uncaught callback or retry', async () => {
  for (const stage of ['readinessError', 'extensionError']) {
    const f = fixture(), error = new Error(stage); f.state[stage] = error;
    const job = f.submit(), rejected = assert.rejects(job.done, got => got === error);
    if (stage === 'readinessError') f.scheduler.next();
    await rejected; assert.equal(compileCount(f), 1); noDangling(f);
    if (f.scheduler.history.size) assert.doesNotThrow(() => f.scheduler.stale(1));
  }
});

test('the poll at the deadline asks the driver once more, then times out with programs pending and leaves no callback', async () => {
  for (const visibility of ['visible', null]) {
    const f = fixture({ ready: [Infinity, Infinity, Infinity], timeoutMs: 25, visibility }), job = f.submit();
    const rejected = assert.rejects(job.done, error => error.name === 'TimeoutError' && error.code === 'SHADER_PREPARATION_TIMEOUT');
    f.scheduler.next(); f.scheduler.next();
    assert.equal([...f.scheduler.jobs.values()][0].at, 25, 'last wait is capped to the remaining deadline');
    const queries = queryCount(f); f.scheduler.next(); await rejected;
    assert.equal(queryCount(f), queries + 3, 'the poll at the deadline makes one last completion check of each program');
    noDangling(f); for (const id of f.scheduler.history.keys()) assert.doesNotThrow(() => f.scheduler.stale(id));
    assert.equal(queryCount(f), queries + 3, 'no query after the timeout');
  }
});

test('a poll that runs late after script was held past the deadline asks once and resolves when every program is done', async () => {
  for (const ready of [[1500, 1500, 1500], [1500, 14000, 1500]]) {
    const f = fixture({ ready }), job = f.submit();
    f.scheduler.next(); assert.equal(queryCount(f), 3, 'pending at the first poll');
    f.scheduler.suspend(13000); // a long task or paused script while the page stays visible: no poll can run
    f.scheduler.next(); assert.equal(f.scheduler.time, 13010);
    assert.equal(queryCount(f), 6, 'the late poll asks the driver once for each program');
    if (ready[1] === 1500) {
      const result = await job.done;
      assert.equal(result.polls, 2); assert.equal(result.completionMs, 13010); assert.equal(result.hiddenMs, 0);
    } else await assert.rejects(job.done, error => error.code === 'SHADER_PREPARATION_TIMEOUT', 'still pending: times out');
    noDangling(f);
  }
});

test('a long hold inside a completion query cannot time out programs that are done', async () => {
  const f = fixture({ ready: [0, 0, 0] }); let held = false;
  f.state.afterQuery = () => { if (!held) { held = true; f.scheduler.time += 15000; } };
  const job = f.submit(); f.scheduler.next(); const result = await job.done;
  assert.equal(queryCount(f), 3); assert.equal(result.completionMs, 15010); assert.equal(result.programs.length, 3); noDangling(f);
});

test('switched away mid-wait and frozen past the deadline, preparation still finishes once the driver is done', async () => {
  const f = fixture({ ready: [Infinity, Infinity, Infinity] }), job = f.submit(), flag = settledFlag(job);
  f.scheduler.pass(1000); // visible, programs pending
  f.page.set('hidden'); f.scheduler.pass(2000); // another app or tab in front: throttled polls
  f.scheduler.suspend(15000); // the page is frozen: no script runs for 15 s
  f.scheduler.pass(1000); await flush(); // unfrozen while still hidden: the overdue poll runs, still pending
  assert.equal(flag.settled, false, 'hidden and frozen time did not count toward the 12 s deadline');
  f.ready.fill(f.scheduler.time); // the driver finishes
  f.scheduler.pass(1000); const result = await job.done;
  assert.equal(result.completionMs, 20000); assert.equal(result.hiddenMs, 19000);
  assert.equal(result.programs.length, 3); noDangling(f);
});

test('visible time adds up across hidden spans, so a really stuck preparation still times out at 12 s seen', async () => {
  const f = fixture({ ready: [Infinity, Infinity, Infinity] }), job = f.submit(), flag = settledFlag(job);
  const rejected = assert.rejects(job.done, error => error.code === 'SHADER_PREPARATION_TIMEOUT');
  f.scheduler.pass(5000); // 5 s seen
  f.page.set('hidden'); f.scheduler.pass(600000); // 10 min hidden, polled once a second
  f.page.set('visible'); f.scheduler.pass(6999); await flush();
  assert.equal(flag.settled, false, 'not at 11 999 ms seen');
  f.scheduler.pass(1); await rejected; // 12 000 ms seen
  assert.equal(f.scheduler.time, 612000); noDangling(f);
});

test('a preparation that starts hidden does not start its deadline until the page is shown', async () => {
  const f = fixture({ ready: [Infinity, Infinity, Infinity], visibility: 'hidden' }), job = f.submit(), flag = settledFlag(job);
  const rejected = assert.rejects(job.done, error => error.code === 'SHADER_PREPARATION_TIMEOUT');
  f.scheduler.pass(60000); await flush();
  assert.equal(flag.settled, false, '60 s hidden did not count');
  f.page.set('visible'); f.scheduler.pass(11999); await flush();
  assert.equal(flag.settled, false, 'not at 11 999 ms seen');
  f.scheduler.pass(1); await rejected; noDangling(f);
  f.page.set('hidden'); assert.equal(f.page.listeners.size, 0, 'a settled job no longer listens');
});

test('owner cancel and AbortSignal stop and clear an in-flight wait exactly once', async () => {
  for (const trigger of ['owner', 'signal']) {
    const f = fixture({ ready: [Infinity, Infinity, Infinity] }), job = f.submit();
    const rejected = assert.rejects(job.done, error => error.name === 'AbortError' && error.reason === trigger);
    if (trigger === 'owner') assert.equal(job.cancel(), true); else f.controller.abort();
    await rejected; assert.equal(job.cancel(), false); noDangling(f);
    const calls = f.calls.length; assert.doesNotThrow(() => f.scheduler.stale(1)); assert.equal(f.calls.length, calls);
  }
});

test('already cancelled, disposed, lost and stale-epoch jobs never submit compile', async () => {
  for (const reason of ['signal', 'disposed', 'context-lost', 'epoch']) {
    const f = fixture();
    if (reason === 'signal') f.controller.abort();
    if (reason === 'disposed') f.state.disposed = true;
    if (reason === 'context-lost') f.state.lost = true;
    if (reason === 'epoch') f.state.epoch++;
    const job = f.submit(); await assert.rejects(job.done, error => error.name === 'AbortError' && error.reason === reason);
    assert.equal(compileCount(f), 0); assert.equal(queryCount(f), 0); noDangling(f);
  }
});

test('disposal, context loss and restored-epoch changes during a wait reject before querying any stale native handle', async () => {
  for (const reason of ['disposed', 'context-lost', 'epoch']) {
    const f = fixture({ ready: [Infinity, Infinity, Infinity] }), job = f.submit();
    const rejected = assert.rejects(job.done, error => error.name === 'AbortError' && error.reason === reason);
    if (reason === 'disposed') f.state.disposed = true;
    if (reason === 'context-lost') f.state.lost = true;
    if (reason === 'epoch') f.state.epoch++;
    f.scheduler.next(); await rejected; assert.equal(queryCount(f), 0); noDangling(f);
    const calls = f.calls.length; assert.doesNotThrow(() => f.scheduler.stale(1)); assert.equal(f.calls.length, calls);
  }
});

test('cancellation triggered during compile or between readiness queries prevents every subsequent GL call', async () => {
  for (const stage of ['compile', 'query']) {
    const f = fixture({ ready: [0, 0, 0] });
    if (stage === 'compile') f.state.afterCompile = () => f.controller.abort();
    else f.state.afterQuery = () => f.controller.abort();
    const job = f.submit(), rejected = assert.rejects(job.done, error => error.name === 'AbortError');
    if (stage === 'query') f.scheduler.next();
    await rejected; assert.equal(queryCount(f), stage === 'compile' ? 0 : 1); noDangling(f);
  }
});

test('post-success cancellation cannot alter transferred programs, repeat settlement, or revive a timer', async () => {
  const f = fixture(), job = f.submit(); f.scheduler.next(); const result = await job.done;
  const count = result.programs.length; f.controller.abort(); assert.equal(job.cancel(), false);
  f.scheduler.stale(1); assert.equal(result.programs.length, count); assert.deepEqual(result.programs, f.programs); noDangling(f);
});

test('a compile that exhausts the deadline gets one completion check: done programs resolve, pending ones time out', async () => {
  for (const ready of [[0, 0, 0], [0, Infinity, 0]]) {
    const f = fixture({ timeoutMs: 20, ready }); f.state.afterCompile = () => { f.scheduler.time = 20; };
    const job = f.submit();
    assert.equal(queryCount(f), 0, 'no completion query inside submission');
    assert.equal(f.scheduler.jobs.size, 1); assert.equal([...f.scheduler.jobs.values()][0].at, 20, 'the last check is not delayed');
    f.scheduler.next();
    if (ready[1] === 0) { const result = await job.done; assert.equal(result.polls, 1); assert.equal(result.programs.length, 3); }
    else await assert.rejects(job.done, error => error.name === 'TimeoutError');
    assert.equal(compileCount(f), 1); assert.equal(queryCount(f), 3); noDangling(f);
  }
});

test('invalid configuration fails before submission rather than allowing an unbounded or watchdog-length wait', () => {
  const f = fixture();
  for (const change of [{ timeoutMs: 0 }, { timeoutMs: 20000 }, { timeoutMs: Infinity }, { pollMs: 0 }, { getEpoch: null }, { epoch: undefined }]) {
    assert.throws(() => submitShaderPreparation(f.renderer, f.scene, f.camera, { ...f.options, ...change }), /Shader preparation/);
  }
  assert.equal(compileCount(f), 0); noDangling(f);
});


test('individual program disposal or replacement cancels before querying its obsolete native handle', async () => {
  for (const khr of [true, false]) for (const reason of ['program-disposed', 'program-changed']) {
    const f = fixture({ khr, ready: [Infinity, Infinity, Infinity] }), job = f.submit();
    const rejected = assert.rejects(job.done, error => error.name === 'AbortError' && error.reason === reason);
    f.programs[0].program = reason === 'program-disposed' ? undefined : { id: 99 };
    f.scheduler.next(); await rejected;
    assert.equal(queryCount(f), 0, 'no GL query may use a captured handle after its wrapper is invalidated');
    noDangling(f); assert.doesNotThrow(() => f.scheduler.stale(1));
  }
});

test('program disposal during a later query cannot resolve an invalid earlier program as completed', async () => {
  const f = fixture(), job = f.submit();
  const rejected = assert.rejects(job.done, error => error.name === 'AbortError' && error.reason === 'program-disposed');
  f.state.afterQuery = id => { if (id === 2) f.programs[0].program = undefined; };
  f.scheduler.next(); await rejected; assert.equal(queryCount(f), 3); noDangling(f);
});
