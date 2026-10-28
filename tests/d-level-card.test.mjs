// The level card's place on every real world (src/ui/layout.js cardBands and cardCentre): the 30
// levels, The Core's three stages and Overburn waves in all three field modes. The card sits in the
// chamber, never across the lintel, in the open band under the formation where the eye already
// is, and never over the paddle or the served ball. Card heights cover the three QA sizes
// (desktop about 140 to 230 field units, 390 px phones 210 to 470, 320 px phones up to about 690
// with every first-use control line on it).
import { test, assert } from './lib.mjs';
import { createWorld } from '../src/core/world.js';
import { makeSystems } from '../src/systems.js';
import { createRun } from '../src/economy/economy.js';
import { LEVELS, stagesOf } from '../src/levels/index.js';
import { generateOverburn } from '../src/levels/overburn.js';
import { ceilingLayout } from '../src/render/ceiling.js';
import { cardBands, cardCentre, CARD_LANE } from '../src/ui/layout.js';
import { BALL, FIELD } from '../src/core/constants.js';
import { readFileSync } from 'node:fs';

const LINTEL = 24; // field units the card keeps from the ceiling's face and the far wall
const EPS = 1e-6;

function worldFor(def, seed = 1) {
  return createWorld({ level: def, seed: seed + def.n * 31 + (def.stage | 0), run: createRun({ seed, levelN: def.n }), systems: makeSystems() });
}

/** Every campaign world (stages included) and Overburn waves 1 to 40 on two seeds. */
function worlds() {
  const out = [];
  for (const d of LEVELS) for (const s of stagesOf(d)) out.push({ name: `L${s.n}${s.stage ? '.' + s.stage : ''}`, w: worldFor(s) });
  for (const seed of [20261028, 7]) {
    for (let wave = 1; wave <= 40; wave++) out.push({ name: `Overburn ${seed} wave ${wave}`, w: worldFor(generateOverburn(seed, wave), wave) });
  }
  return out;
}
const ALL = worlds();

function extent(w) {
  const B = w.bricks;
  let top = Infinity, bottom = -Infinity;
  for (let i = 0; i < B.count; i++) {
    if (!B.alive[i]) continue;
    const y0 = B.y[i] - B.h[i] / 2, y1 = B.y[i] + B.h[i] / 2;
    if (y1 <= 0) continue;
    top = Math.min(top, y0); bottom = Math.max(bottom, y1);
  }
  return { top, bottom };
}

test('the room above the paddle: the served ball and air (a launch cuts the card at once)', () => {
  assert.ok(CARD_LANE >= 2 * BALL.R + 12, `${CARD_LANE} field units: the served ball and a margin`);
  const css = readFileSync(new URL('../css/screens.css', import.meta.url), 'utf8');
  assert.match(css, /\.card\.out\.cut\s*\{\s*transition:\s*none;/, 'a cut card does not fade');
});

test('the air round the card box is the same in both directions (ui.js height, screens.css room)', () => {
  const css = readFileSync(new URL('../css/screens.css', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../src/ui/ui.js', import.meta.url), 'utf8');
  const air = Number((ui.match(/const CARD_AIR = (\d+);/) || [])[1]);
  assert.ok(air > 0, 'ui.js CARD_AIR');
  assert.equal(Number((css.match(/--card-air:\s*(\d+)px/) || [])[1]), air, 'screens.css --card-air matches ui.js CARD_AIR');
  // the horizontal room (--card-ax to --card-bx: the paddle's track to the far wall) keeps it each side
  assert.match(css, /--card-l:[^;]*var\(--card-ax, 0\) \+ var\(--card-air\)/);
  assert.match(css, /--card-r:[^;]*var\(--card-bx, 1\) - var\(--card-air\)/);
});

test('the worlds cover all three field modes, with lintels inside the visible field', () => {
  const modes = new Set(ALL.map((x) => x.w.level.mode));
  assert.deepEqual([...modes].sort(), ['bottom', 'left', 'ring']);
  assert.ok(ALL.some((x) => x.w.level.mode === 'left' && x.w.field.farX < FIELD.W), 'an Overburn far wall inside the field');
  assert.ok(ALL.some((x) => x.w.level.mode === 'bottom' && x.w.field.ceilingY >= 390), 'a low ceiling (levels 1 and 14)');
});

test('bottom mode: the card stays under the lintel and above the paddle and ball at every height', () => {
  let n = 0;
  for (const { name, w } of ALL) {
    if (w.level.mode !== 'bottom') continue;
    const frame = ceilingLayout('bottom', w.field, {});
    const minY = frame.y0, maxY = frame.y1;
    const bands = cardBands(w);
    const ceil = w.field.ceilingY;
    const roof = Math.max(90, ceil > 0 ? ceil + LINTEL : 0);
    const floor = w.paddle.y - w.paddle.h / 2 - CARD_LANE;
    const { bottom } = extent(w);
    assert.equal(bands.length, 1, `${name}: one place, the open band under the formation`);
    assert.equal(bands.x0, 0); assert.equal(bands.x1, FIELD.W);
    for (let h = 120; h <= 700; h += 10) {
      const y = cardCentre(bands, h, minY, maxY);
      const top = y - h / 2, bot = y + h / 2;
      n++;
      assert.ok(top >= minY - EPS && bot <= maxY + EPS, `${name} h ${h}: inside the visible field`);
      if (h <= maxY - roof) assert.ok(top >= roof - EPS, `${name} h ${h}: card top ${top} under the lintel (face ${ceil}, clear from ${roof})`);
      if (h <= floor - roof) assert.ok(bot <= floor + EPS, `${name} h ${h}: card bottom ${bot} clear of the paddle and ball (${floor})`);
      if (h <= floor - (bottom + 12)) assert.ok(top >= bottom + 12 - EPS, `${name} h ${h}: fits under the formation, covers no brick`);
      else if (h <= floor - roof) assert.ok(Math.abs(bot - floor) < EPS, `${name} h ${h}: grows up from the paddle's room over the lowest bricks`);
    }
  }
  assert.ok(n > 1000);
});

test('horizontal mode: the card stays between the paddle track and the far wall, clear of the serve', () => {
  let walls = 0;
  for (const { name, w } of ALL) {
    if (w.level.mode !== 'left') continue;
    const b = cardBands(w);
    const p = w.paddle;
    assert.ok(b.x0 >= p.x + p.h / 2 + 2 * BALL.R - EPS, `${name}: right of the paddle and the ball on it`);
    if (w.field.farX < FIELD.W) {
      walls++;
      assert.ok(b.x1 <= w.field.farX - LINTEL + EPS, `${name}: left of the far wall (${w.field.farX})`);
    } else {
      // the far wall at the field's edge is this mode's lintel too: the intro dolly brings it in
      assert.equal(b.x1, FIELD.W - LINTEL, `${name}: clear of the far wall at the field's edge`);
    }
    const c0 = p.y - p.w / 2 - 30, c1 = p.y + p.w / 2 + 30;
    for (const band of b) assert.ok(band[1] <= c0 + EPS || band[0] >= c1 - EPS, `${name}: band ${band} clear of the paddle and its launch`);
    for (let h = 120; h <= 440; h += 20) {
      const y = cardCentre(b, h, 0, FIELD.H);
      const pick = b.find((band) => y - h / 2 >= band[2] - EPS && y + h / 2 <= band[3] + EPS);
      assert.ok(pick, `${name} h ${h}: inside one room, clear of the paddle (y ${y})`);
    }
  }
  assert.ok(walls > 0, 'Overburn far walls inside the field were checked');
});

test('ring mode keeps its places: the empty band above or under the ring, clear of the paddle', () => {
  for (const { name, w } of ALL) {
    if (w.level.mode !== 'ring') continue;
    const b = cardBands(w);
    const p = w.paddle;
    assert.equal(b.x0, 0); assert.equal(b.x1, FIELD.W);
    const c0 = p.y - p.h / 2 - 60, c1 = p.y + p.h / 2 + 60;
    for (const band of b) assert.ok(band[1] <= c0 + EPS || band[0] >= c1 - EPS, `${name}: band ${band} clear of the paddle`);
  }
});

// The ring-mode places as they were before the lintel work (main 9940896 cardBands / cardCentre):
// the empty bands from the field's top margin, the card centred in the first it fits, else in the
// tallest, held inside the visible field only. A phone card taller than the band over the ring
// rises toward the field's top; held to a room from the top margin instead, it was pushed down
// into the ring (review: 390 px L21, 12 bricks under the text; 320 px, 56).
function ringBefore(w, h, minY, maxY) {
  const B = w.bricks;
  let top = Infinity, bottom = -Infinity;
  for (let i = 0; i < B.count; i++) {
    if (!B.alive[i]) continue;
    const y0 = B.y[i] - B.h[i] / 2, y1 = B.y[i] + B.h[i] / 2;
    if (y1 <= 0) continue;
    top = Math.min(top, y0); bottom = Math.max(bottom, y1);
  }
  const y0 = 90;
  const bands = Number.isFinite(top) ? [[y0, Math.max(y0, top - 12)], [Math.min(1080, bottom + 12), 1080]] : [[y0, 1080]];
  const p = w.paddle;
  const c0 = p.y - (p.h / 2 + 60), c1 = p.y + (p.h / 2 + 60);
  const free = [];
  for (const [a, b] of bands) {
    if (c1 <= a || c0 >= b) { free.push([a, b]); continue; }
    if (c0 > a) free.push([a, c0]);
    if (c1 < b) free.push([c1, b]);
  }
  let pick = null;
  for (const [a0, b0] of free.filter(([a, b]) => b - a > 1)) {
    const a = Math.max(minY, a0), z = Math.min(maxY, b0);
    if (z <= a) continue;
    if (!pick || z - a > pick[1] - pick[0]) pick = [a, z];
    if (z - a >= h) { pick = [a, z]; break; }
  }
  if (!pick) return minY + (maxY - minY) * 0.42;
  const half = Math.min(h / 2, (maxY - minY) / 2);
  return Math.min(maxY - half, Math.max(minY + half, (pick[0] + pick[1]) / 2));
}

test('ring mode: every card height sits where it did before the lintel work (L21, Core stage 3, Overburn)', () => {
  let n = 0;
  for (const { name, w } of ALL) {
    if (w.level.mode !== 'ring') continue;
    const frame = ceilingLayout('ring', w.field, {});
    const bands = cardBands(w);
    for (const [minY, maxY] of [[frame.y0, frame.y1], [0, FIELD.H]]) {
      for (let h = 100; h <= 900; h += 10) {
        const want = ringBefore(w, h, minY, maxY);
        assert.ok(Math.abs(cardCentre(bands, h, minY, maxY) - want) < EPS, `${name} h ${h} (field ${minY} to ${maxY}): centre ${cardCentre(bands, h, minY, maxY)}, before ${want}`);
        n++;
      }
    }
  }
  assert.ok(n > 500, `${n} ring checks`);
  // the review's numbers on the 9940896 side (centre in field units)
  const at = (label, h) => {
    const { w } = ALL.find((x) => x.name === label);
    const frame = ceilingLayout('ring', w.field, {});
    return cardCentre(cardBands(w), h, frame.y0, frame.y1);
  };
  assert.equal(at('L21', 350), 204);
  assert.equal(at('L21', 470), 235);
  assert.equal(at('L21', 690), 345);
  assert.equal(at('L30.3', 230), 189);
});
