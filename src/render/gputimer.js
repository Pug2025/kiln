// Kiln: GPU time of the draw, where the browser exposes a GPU timer (OWNER: C). No three.js import:
// it talks to the WebGL2 context only, so Node can test it with a fake (tests/c-pace.test.mjs).
//
// EXT_disjoint_timer_query_webgl2 (desktop Chrome and Firefox; not Safari) times the GPU work between
// begin() and end(). Results arrive a frame or more later, so a small ring of queries is reused
// (created once: no allocation per frame); a disjoint event (the GPU clock jumped) drops the result.
// Main-thread time (stats.frameMs) cannot see the GPU: this is what tells a GPU-bound phone from one
// whose browser caps frames at 30 Hz (review 2026-10-22). Without the extension available is false
// and every call is a no-op; the quality ladder then probes instead (pace.js).

const RING = 4;

/** @param {WebGL2RenderingContext | null} ctx */
export function createGpuTimer(ctx) {
  let ext = null;
  /** @type {any[]} */
  let qs = [];
  const busy = new Uint8Array(RING);
  let head = 0, tail = 0, open = false;

  function build() {
    ext = ctx && ctx.getExtension && typeof ctx.createQuery === 'function' ? ctx.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    qs = [];
    if (ext) for (let i = 0; i < RING; i++) qs.push(ctx.createQuery());
    busy.fill(0);
    head = 0;
    tail = 0;
    open = false;
  }
  build();

  return {
    get available() {
      return !!ext;
    },
    /** Start timing (skipped while every query in the ring still waits for its result). */
    begin() {
      if (!ext || open || busy[head]) return;
      ctx.beginQuery(ext.TIME_ELAPSED_EXT, qs[head]);
      open = true;
    },
    end() {
      if (!open) return;
      ctx.endQuery(ext.TIME_ELAPSED_EXT);
      busy[head] = 1;
      head = (head + 1) % RING;
      open = false;
    },
    /** The newest finished measurement in ms, or -1 when none finished since the last poll. */
    poll() {
      if (!ext) return -1;
      let ms = -1;
      while (busy[tail]) {
        const q = qs[tail];
        if (!ctx.getQueryParameter(q, ctx.QUERY_RESULT_AVAILABLE)) break;
        const disjoint = ctx.getParameter(ext.GPU_DISJOINT_EXT);
        const ns = ctx.getQueryParameter(q, ctx.QUERY_RESULT);
        busy[tail] = 0;
        tail = (tail + 1) % RING;
        if (!disjoint) ms = ns / 1e6;
      }
      return ms;
    },
    /** After a lost and restored context the old queries are gone: make new ones. */
    rebuild: build,
  };
}
