// Runner self-test fixture (G): plain passes, a skip and console output.
import { test, skip, assert } from '../../../lib.mjs';

test('passes', () => assert.equal(1 + 1, 2));
test('async passes', async () => { await new Promise((r) => setTimeout(r, 10)); });
test('prints', () => console.log('hello from a test'));
skip('waits for later', () => { throw new Error('must not run'); }, 'not yet');
