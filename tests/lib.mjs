// Kiln: the tiny test API used by every tests/*.test.mjs (run by tests-node.mjs). OWNER: G.
//
//   import { test, skip, assert } from './lib.mjs';
//   test('ball never tunnels at 20x speed', () => { assert.ok(...); });
//   test('robot clears level 7', async () => { ... }, { timeout: 60000 });
//   skip('full campaign', () => { ... }, 'turns on at CP2');   // shown as skipped, never fails
//
// assert is node:assert/strict. Tests run in file order, one at a time (each file in its own
// worker thread, so a file cannot leak state into another).

import assert from 'node:assert/strict';

let list = [];

/**
 * @param {string} name
 * @param {() => (void|Promise<void>)} fn
 * @param {{timeout?:number, skip?:string|boolean}} [opts]
 */
export function test(name, fn, opts = {}) {
  const skipReason = opts.skip === true ? 'skipped' : opts.skip || '';
  list.push({ name, fn, timeout: opts.timeout, skip: skipReason });
}

/**
 * A test that is written but not run yet; reported as skipped with the reason.
 * @param {string} name
 * @param {() => (void|Promise<void>)} fn
 * @param {string} reason
 */
export function skip(name, fn, reason = 'skipped') {
  list.push({ name, fn, timeout: undefined, skip: reason || 'skipped' });
}

export function collected() {
  return list;
}

export function resetCollected() {
  list = [];
}

/** Float comparison with a tolerance. */
export function near(actual, expected, eps = 1e-6, msg = '') {
  if (Math.abs(actual - expected) > eps) {
    throw new assert.AssertionError({ message: `${msg} expected ${expected} ± ${eps}, got ${actual}`, actual, expected });
  }
}

// Event-stream hashing and bus-pressure tracking (see tools/qa/lib/stream.mjs):
//   const h = eventStreamHasher(world.bus); ... h.update() after each step; h.lost, h.hex()
export { eventStreamHasher, busWindow } from '../tools/qa/lib/stream.mjs';

export { assert };
