// Kiln QA (G): event-stream hashing and bus-pressure tracking for headless runs.
// Pure: no DOM, no clock. Used by tests/lib.mjs (re-exported), tools/qa/lib/play.mjs and soak.mjs.

/**
 * Hash every event a sim bus carries, in order, so two runs can be compared exactly.
 * Call update() after every step (or at least every bus.cap events) and read `.lost`.
 *
 *   const h = eventStreamHasher(world.bus);
 *   runHeadless(world, robot, { onStep: () => h.update() });
 *   h.update(); h.lost === 0; h.hex()
 *
 * @param {{cap:number, head:number, type:ArrayLike<number>, id:ArrayLike<number>, x:ArrayLike<number>,
 *   y:ArrayLike<number>, a:ArrayLike<number>, b:ArrayLike<number>, c:ArrayLike<number>, at:ArrayLike<number>}} bus
 */
export function eventStreamHasher(bus) {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  let h = 0x811c9dc5 >>> 0;
  const mix = (v) => {
    h ^= v >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const mixF = (v) => {
    f32[0] = v;
    mix(u32[0]);
  };
  const self = {
    cur: 0,
    count: 0,
    lost: 0,
    /** Most events the bus received between two update() calls. */
    maxBurst: 0,
    update() {
      const head = bus.head;
      if (head - self.cur > bus.cap) {
        self.lost += head - bus.cap - self.cur;
        self.cur = head - bus.cap;
      }
      self.maxBurst = Math.max(self.maxBurst, head - self.cur);
      for (; self.cur < head; self.cur++) {
        const k = self.cur % bus.cap;
        mix(bus.type[k]);
        mix(bus.id[k]);
        mixF(bus.x[k]);
        mixF(bus.y[k]);
        mixF(bus.a[k]);
        mixF(bus.b[k]);
        mixF(bus.c[k]);
        mix(bus.at[k]);
        self.count++;
      }
      return self;
    },
    hex() {
      return h.toString(16).padStart(8, '0');
    },
  };
  return self;
}

/**
 * Track the most events emitted inside any window of `steps` consecutive steps. A presentation
 * reader (renderer, audio, HUD) reads once per frame and a frame runs up to
 * SIM.MAX_STEPS_PER_FRAME steps, so that window must stay below bus.cap or it loses events.
 * Call sample() once after every step.
 * @param {{head:number}} bus
 * @param {number} steps
 */
export function busWindow(bus, steps) {
  const heads = new Float64Array(steps + 1);
  let n = 0;
  const self = {
    max: 0,
    sample() {
      heads[n % (steps + 1)] = bus.head;
      const oldest = n >= steps ? heads[(n - steps) % (steps + 1)] : 0;
      self.max = Math.max(self.max, bus.head - oldest);
      n++;
      return self;
    },
  };
  return self;
}
