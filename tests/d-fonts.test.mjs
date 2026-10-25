import { test, assert } from './lib.mjs';
import { waitForFonts } from '../src/app/fonts.js';

test('font files wait for the optional stylesheet before the normal atlas font path', async () => {
  let cssDone;
  const css = new Promise((resolve) => { cssDone = resolve; });
  const calls = [];
  const loaded = waitForFonts({ load: async (font) => { calls.push(font); } }, css);
  await Promise.resolve();
  assert.equal(calls.length, 0);
  cssDone();
  await loaded;
  assert.deepEqual(calls, ['600 100px "Inter Tight"', '700 100px "Inter Tight"']);
});

test('stalled CSS or font files and rejected loads all reach the fallback without rejecting boot', async () => {
  const never = new Promise(() => {});
  let calls = 0;
  await waitForFonts({ load() { calls++; } }, never, 5);
  assert.equal(calls, 0, 'the stylesheet deadline itself is bounded');
  await waitForFonts({ load: () => never }, Promise.resolve(), 5);
  await waitForFonts({ load: async () => { throw new Error('Font denied'); } }, Promise.resolve(), 5);
  await waitForFonts({ load: () => { throw new Error('Font unavailable'); } }, Promise.resolve(), 5);
  await waitForFonts(null, never, 5);
});
