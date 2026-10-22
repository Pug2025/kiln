// Kiln — event bus.
//
// 1) The SIM BUS: a fixed-size ring of numeric records, one per world. Emitting writes into typed
//    arrays (no allocation). Every consumer — a sim system, the renderer, the audio, the HUD — owns
//    a READER with its own cursor and sees every event emitted since it last read, in order. So a
//    system that runs early in the step still sees what a later system emitted on the previous
//    step, and presentation (which reads once per frame) sees everything from the 1–2 steps that
//    frame ran. Nobody "clears" the bus. If a reader falls more than CAP events behind, it skips
//    ahead and counts the loss in reader.lost (G watches this in tests).
//
//      const rd = createReader(world.bus, 'economy', 0);
//      while (next(rd)) { switch (rd.type) { case EV.BRICK_BROKEN: … rd.id, rd.x, rd.y, rd.a … } }
//
// 2) The APP EMITTER: string-named, object payloads, for the cold path (screens, settings, save).

export const BUS_CAP = 4096;

/**
 * @returns {import('./types.js').SimBus}
 */
export function createBus(cap = BUS_CAP) {
  return {
    cap,
    head: 0,                       // total events ever emitted (monotonic)
    step: 0,                       // world step at the last emit (debug)
    type: new Uint16Array(cap),
    id: new Int32Array(cap),
    x: new Float32Array(cap),
    y: new Float32Array(cap),
    a: new Float32Array(cap),
    b: new Float32Array(cap),
    c: new Float32Array(cap),
    at: new Uint32Array(cap),      // world.step when emitted
  };
}

/**
 * Emit one sim event. All arguments after type are numbers; omitted ones are 0.
 * @param {import('./types.js').SimBus} bus
 * @param {number} type EV.* code
 */
export function emit(bus, type, id = 0, x = 0, y = 0, a = 0, b = 0, c = 0) {
  const k = bus.head % bus.cap;
  bus.type[k] = type;
  bus.id[k] = id;
  bus.x[k] = x;
  bus.y[k] = y;
  bus.a[k] = a;
  bus.b[k] = b;
  bus.c[k] = c;
  bus.at[k] = bus.step;
  bus.head++;
}

/**
 * A cursor over the bus. Create once (at init / setLevel), reuse forever.
 * @param {import('./types.js').SimBus} bus
 * @param {string} name for debugging
 * @param {number} [from] start position: 0 = everything this world ever emitted (default),
 *   or bus.head = only what comes next.
 * @returns {import('./types.js').BusReader}
 */
export function createReader(bus, name, from = 0) {
  return { bus, name, cur: from, lost: 0, type: 0, id: 0, x: 0, y: 0, a: 0, b: 0, c: 0, at: 0 };
}

/** Point an existing reader at another bus (new world) without allocating. */
export function resetReader(rd, bus, from = 0) {
  rd.bus = bus;
  rd.cur = from;
  rd.lost = 0;
  return rd;
}

/**
 * Advance the reader by one event, copying it into the reader's fields.
 * @returns {boolean} false when the reader is caught up
 */
export function next(rd) {
  const bus = rd.bus;
  if (rd.cur >= bus.head) return false;
  if (bus.head - rd.cur > bus.cap) {
    const skip = bus.head - bus.cap - rd.cur;
    rd.lost += skip;
    rd.cur += skip;
  }
  const k = rd.cur % bus.cap;
  rd.type = bus.type[k];
  rd.id = bus.id[k];
  rd.x = bus.x[k];
  rd.y = bus.y[k];
  rd.a = bus.a[k];
  rd.b = bus.b[k];
  rd.c = bus.c[k];
  rd.at = bus.at[k];
  rd.cur++;
  return true;
}

/** Skip everything pending (e.g. the renderer after a long pause). */
export function catchUp(rd) {
  rd.cur = rd.bus.head;
}

/** Count events of one type pending for a reader without consuming them (tests, HUD). */
export function pendingOfType(rd, type) {
  const bus = rd.bus;
  let n = 0;
  for (let i = Math.max(rd.cur, bus.head - bus.cap); i < bus.head; i++) {
    if (bus.type[i % bus.cap] === type) n++;
  }
  return n;
}

// ------------------------------------------------------------------ app emitter (cold path)

/**
 * Tiny string-keyed emitter for screens, settings, save and PWA events. Not for the hot loop.
 * @returns {{on(name:string, fn:Function):Function, off(name:string, fn:Function):void, emit(name:string, payload?:object):void}}
 */
export function createEmitter() {
  /** @type {Map<string, Set<Function>>} */
  const map = new Map();
  return {
    on(name, fn) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(fn);
      return () => map.get(name)?.delete(fn);
    },
    off(name, fn) {
      map.get(name)?.delete(fn);
    },
    emit(name, payload = {}) {
      const set = map.get(name);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[kiln] app event "${name}" handler failed`, err);
        }
      }
    },
  };
}
