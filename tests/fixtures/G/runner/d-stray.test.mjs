// Runner self-test fixture (G): an error that escapes after the test returned.
import { test } from '../../../lib.mjs';

test('throws later', () => { setTimeout(() => { throw new Error('late'); }, 5); });
test('waits', () => new Promise((r) => setTimeout(r, 50)));
