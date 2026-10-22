// Test rig for E's tests: a world with the real economy system and fake physics/content that
// record every world.api call, so economy rules are tested apart from A's and B's progress.
// Feed it sim events with rig.emit(...) and advance with rig.step(n).

import { createWorld, stepWorld } from '../../../src/core/world.js';
import { createInputFrame, clearEdges } from '../../../src/core/input-frame.js';
import { emit, createReader, next } from '../../../src/core/bus.js';
import { createEconomy } from '../../../src/economy/economy.js';

/** A minimal level def; override anything. */
export function level(over = {}) {
  return {
    n: 1, id: 'test', name: 'Test', world: 'ember', kind: 'normal', mode: 'bottom', tier: 0,
    rows: ['aaaaaaaaaaaa'], drops: { rate: 0, table: {} }, rules: {}, ...over,
  };
}

/**
 * @param {{level?:object, seed?:number, run?:object, remaining?:number}} [opts]
 */
export function rig(opts = {}) {
  const calls = { embers: [], drops: [], serve: 0, split: [], purge: [] };
  const remaining = opts.remaining ?? 50;
  const physics = {
    name: 'physics',
    init(w) {
      w.api.spawnEmbers = (x, y, n) => { calls.embers.push(n); return n; };
      w.api.spawnDrop = (x, y, k) => { calls.drops.push(k); return calls.drops.length - 1; };
      w.api.serve = () => { calls.serve++; };
      w.api.splitBalls = (k) => { calls.split.push(k); return k; };
    },
  };
  const content = {
    name: 'content',
    init(w) {
      w.api.purgeRows = (r) => { calls.purge.push(r); return r * 12; };
      w.level.remaining = remaining;
      w.level.total = remaining;
    },
  };
  const world = createWorld({
    level: opts.level || level(),
    seed: opts.seed ?? 1,
    run: opts.run,
    systems: { physics, content, economy: createEconomy() },
  });
  const frame = createInputFrame();
  const seen = createReader(world.bus, 'rig', 0);
  const log = [];
  return {
    world,
    calls,
    frame,
    log,
    emit(type, id = 0, x = 0, y = 0, a = 0, b = 0, c = 0) {
      emit(world.bus, type, id, x, y, a, b, c);
    },
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        stepWorld(world, frame);
        clearEdges(frame);
      }
      while (next(seen)) log.push({ type: seen.type, id: seen.id, x: seen.x, y: seen.y, a: seen.a, b: seen.b, c: seen.c });
      return this;
    },
    /** Events of one type seen so far. */
    events(type) {
      return log.filter((e) => e.type === type);
    },
  };
}
