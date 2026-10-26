// C: brightness budgets of the look (src/render/look.js), checked with the same tone mapping the
// game uses. Review 2026-10-22: hit sparks crossed the bloom threshold, and the headroom plates
// outshone the bricks behind the phone HUD.

import { test, assert } from './lib.mjs';
import { COLOR } from '../src/core/constants.js';
import { LOOK } from '../src/render/look.js';

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function hexLum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = lin(((n >> 16) & 255) / 255), g = lin(((n >> 8) & 255) / 255), b = lin((n & 255) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// three r160 ACESFilmicToneMapping on a grey input (its matrices keep grey grey)
function aces(x) {
  const v = (x * LOOK.EXPOSURE) / 0.6;
  const a = v * (v + 0.0245786) - 0.000090537;
  const b = v * (0.983729 * v + 0.432951) + 0.238081;
  return Math.min(1, Math.max(0, a / b));
}

test('sparks: decorative and hit sparks stay under the bloom threshold, the ball trail may cross it (ART 14)', () => {
  const hi = hexLum(COLOR.HEAT_HI);
  assert.ok(hi * LOOK.SPARK_GAIN < LOOK.BLOOM_THRESHOLD, `decorative sparks ${(hi * LOOK.SPARK_GAIN).toFixed(3)}`);
  assert.ok(hi * LOOK.BURST_GAIN <= 0.85, `hit sparks ${(hi * LOOK.BURST_GAIN).toFixed(3)} (ART 15.3 C22: <= .85)`);
  assert.ok(hi * LOOK.TRAIL_GAIN > LOOK.BLOOM_THRESHOLD, 'the ball trail root still blooms');
});

test('headroom plates: peak at most .6 and a quarter of the ball on screen (ART 15.2)', () => {
  const ball = aces(LOOK.BALL_GAIN); // maximum channel of the solid heat-high ball
  const plate = aces(LOOK.PLATE_CAP);
  assert.ok(plate <= 0.6, `plate peak ${plate.toFixed(3)}`);
  assert.ok(plate <= 0.25 * ball, `plate peak ${plate.toFixed(3)} vs ball ${ball.toFixed(3)}`);
  assert.ok(LOOK.PLATE_HUD_BODY <= 0.4, 'the plate steps back behind the HUD');
});
