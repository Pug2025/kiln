// E: The Forge's "Overload power" ranks each count for Quench (see tests/fixtures/E/ranks.mjs).

import { test } from './lib.mjs';
import { OVERLOAD } from '../src/core/constants.js';
import { assertEveryRankCounts } from './fixtures/E/ranks.mjs';

test('every Overload power rank shortens the vent and Quench fires more over the ranks (levels 22 to 29)', () => {
  assertEveryRankCounts(OVERLOAD.QUENCH);
});
