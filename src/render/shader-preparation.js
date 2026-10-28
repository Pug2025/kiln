// Owned completion wait around pinned r160's public synchronous compile submission.
// Caller owns submission render-state restoration and all later reflection/post preparation.
const DEFAULT_SCHEDULER = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id),
  // Page visibility for the deadline; null where there is no document (the deadline then counts all time).
  document: typeof document === 'undefined' ? null : document,
};

function cancelled(reason) {
  const error = new Error('Shader preparation cancelled: ' + reason);
  error.name = 'AbortError';
  error.code = 'SHADER_PREPARATION_ABORTED';
  error.reason = reason;
  return error;
}

/**
 * Submit now, restore caller state now, then await job.done before reflecting/drawing.
 * Success transfers ownership of result.programs to the caller; no reflection occurs here.
 * Without KHR the result explicitly reports a synchronous fallback after one scheduled yield.
 * The caller must handle job.done rejection, including for background jobs.
 */
export function submitShaderPreparation(renderer, scene, camera, options = {}) {
  let { signal = null, epoch, getEpoch, isDisposed = () => false } = options;
  const { scheduler = DEFAULT_SCHEDULER, timeoutMs = 12000, pollMs = 10 } = options;
  if (epoch === undefined || typeof getEpoch !== 'function' || typeof isDisposed !== 'function') {
    throw new TypeError('Shader preparation requires an epoch and current-state callbacks');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs >= 20000 ||
      !Number.isFinite(pollMs) || pollMs <= 0) {
    throw new RangeError('Shader preparation needs a positive deadline below20s and positive poll interval');
  }
  const now = scheduler.now.bind(scheduler), later = scheduler.setTimeout.bind(scheduler), clear = scheduler.clearTimeout.bind(scheduler);
  const started = now(), deadline = started + timeoutMs;
  let native = null, timer = null, settled = false, programs = [], nativePrograms = [], programSet = new Set(), materials = [];
  let parallel = false, completionStatus = null, submissionMs = 0, polls = 0, resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // The deadline counts only time the page can be seen. A hidden page (a background tab, a phone
  // switched to another app) has its timers throttled, frozen or suspended, so a poll can run long
  // after the driver finished: that wait is not a stalled compile. Hiding holds the deadline and
  // showing resumes it, as the startup watchdog does. Without a document every moment counts.
  let page = scheduler.document ?? null, hiddenSince = page?.visibilityState === 'hidden' ? started : null, hiddenMs = 0;
  function visibilityChanged() {
    const time = now();
    if (page?.visibilityState === 'hidden') { if (hiddenSince === null) hiddenSince = time; }
    else if (hiddenSince !== null) { hiddenMs += time - hiddenSince; hiddenSince = null; }
  }
  function hiddenTotal(time) { return hiddenMs + (hiddenSince === null ? 0 : time - hiddenSince); }
  function visibleNow() { const time = now(); return time - hiddenTotal(time); }

  function finish(error, value) {
    if (settled) return false;
    settled = true;
    let cleanupError = null;
    if (timer !== null) {
      try { clear(timer); } catch (e) { cleanupError = e; }
      timer = null;
    }
    try { signal?.removeEventListener('abort', onAbort); } catch (e) { cleanupError ??= e; }
    try { page?.removeEventListener?.('visibilitychange', visibilityChanged); } catch (e) { cleanupError ??= e; }
    page = null;
    // Results transfer the successful program array; obsolete jobs retain no captured objects.
    programSet?.clear();
    programs = nativePrograms = programSet = materials = null;
    renderer = scene = camera = native = signal = getEpoch = isDisposed = null;
    if (error || cleanupError) rejectDone(error || cleanupError);
    else resolveDone(value);
    resolveDone = rejectDone = null;
    return true;
  }
  function onAbort() { finish(cancelled('signal')); }
  function current() {
    if (settled) return false;
    if (signal?.aborted) { finish(cancelled('signal')); return false; }
    if (isDisposed()) { finish(cancelled('disposed')); return false; }
    if (getEpoch() !== epoch) { finish(cancelled('epoch')); return false; }
    if (native?.isContextLost()) { finish(cancelled('context-lost')); return false; }
    return true;
  }
  function timedOut() {
    const error = new Error('Shader preparation completion deadline exceeded');
    error.name = 'TimeoutError'; error.code = 'SHADER_PREPARATION_TIMEOUT';
    finish(error);
  }
  function schedule(delay) {
    if (!current()) return;
    timer = later(poll, Math.min(delay, Math.max(0, deadline - visibleNow())));
  }
  function capturedCurrent(index) {
    if (!current()) return false;
    if (programs[index].program !== nativePrograms[index]) {
      finish(cancelled(programs[index].program == null ? 'program-disposed' : 'program-changed'));
      return false;
    }
    return true;
  }
  function poll() {
    timer = null;
    try {
      if (!current()) return;
      // Decided before asking the driver: a poll at or after the deadline (the deadline reached, or a
      // poll that ran late after a long task) still asks once, and times out only if a program is pending.
      const last = visibleNow() >= deadline;
      polls++;
      let allReady = true;
      for (let index = 0; index < programs.length; index++) {
        if (!capturedCurrent(index)) return;
        if (parallel && !native.getProgramParameter(nativePrograms[index], completionStatus)) allReady = false;
        if (!capturedCurrent(index)) return;
      }
      if (!allReady) { if (last) timedOut(); else schedule(pollMs); return; }
      // A later program query may have invalidated an earlier captured material/program.
      for (let index = 0; index < programs.length; index++) if (!capturedCurrent(index)) return;
      if (!current()) return;
      const time = now();
      finish(null, { programs, materials, capability: parallel ? 'parallel' : 'synchronous-fallback',
        submissionMs, completionMs: time - started, hiddenMs: hiddenTotal(time), polls });
    } catch (error) { finish(error); }
  }
  function capture(program) {
    if (program == null || program.program == null) throw new Error('Shader preparation captured an invalid native program');
    if (!programSet.has(program)) { programSet.add(program); programs.push(program); nativePrograms.push(program.program); }
  }
  const job = { done, cancel(reason = 'owner') { return finish(cancelled(reason)); } };
  try {
    if (!current()) return job;
    signal?.addEventListener('abort', onAbort, { once: true });
    page?.addEventListener?.('visibilitychange', visibilityChanged);
    if (!current()) return job;
    native = renderer.getContext();
    if (!current()) return job;
    const compiled = renderer.compile(scene, camera);
    submissionMs = now() - started;
    if (!current()) return job;
    for (const material of compiled) {
      if (!current()) return job;
      const properties = renderer.properties.get(material), variants = properties.programs;
      const materialPrograms = new Set();
      if (variants) for (const program of variants.values()) { capture(program); materialPrograms.add(program); }
      if (properties.currentProgram) { capture(properties.currentProgram); materialPrograms.add(properties.currentProgram); }
      if (!materialPrograms.size) throw new Error('Shader preparation material has no captured programs');
      materials.push({ id: material.id, uuid: material.uuid, name: material.name, type: material.type, version: material.version,
        programIds: [...materialPrograms].map(program => program.id ?? null) });
    }
    if (!current()) return job;
    const extension = native.getExtension('KHR_parallel_shader_compile');
    if (!current()) return job;
    parallel = extension !== null;
    if (parallel) completionStatus = extension.COMPLETION_STATUS_KHR;
    // Always yield after synchronous submission. Caller restores target/visibility before await.
    schedule(parallel ? pollMs : 0);
  } catch (error) { finish(error); }
  return job;
}
