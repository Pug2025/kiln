// Runner self-test fixture (G): a file that registers a failing test, then exits while loading.
import { test, assert } from '../../../lib.mjs';

test('this would fail', () => assert.equal(1, 2));
process.exit(0);
