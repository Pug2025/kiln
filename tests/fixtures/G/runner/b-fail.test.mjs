// Runner self-test fixture (G): a failure, an async timeout, a synchronous hang, then a pass.
import { test, assert } from '../../../lib.mjs';

test('fails', () => assert.equal(1, 2));
test('async hang', () => new Promise(() => {}), { timeout: 200 });
test('sync hang', () => { for (;;) { /* blocks the thread */ } }, { timeout: 200 });
test('runs after the hang', () => assert.ok(true));
test('leaves a timer running', () => { setInterval(() => {}, 1000); });
test('calls process.exit', () => { process.exit(0); });
test('runs after the exit', () => assert.ok(true));
