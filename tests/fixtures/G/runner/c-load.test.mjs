// Runner self-test fixture (G): a file that throws while loading.
import { test } from '../../../lib.mjs';

test('never collected', () => {});
throw new Error('broken on load');
