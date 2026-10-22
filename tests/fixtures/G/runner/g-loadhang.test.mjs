// Runner self-test fixture (G): a file that never finishes loading (a loop at its top level).
import { test } from '../../../lib.mjs';

test('never collected', () => {});
for (;;) { /* blocks the worker while it loads */ }
