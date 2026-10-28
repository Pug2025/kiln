// Kiln: D's HUD layout maths (src/ui/layout.js). No DOM. Field rects come from C's real camera
// fit (src/render/fit.js), so these are the rects the game uses.

import { test, assert } from './lib.mjs';
import { fitCamera, createPose } from '../src/render/fit.js';
import {
  hudLayout, hudText, hudHeights, hudReserve, bandPx, HUD, TEXT, BTNS_W, formatScore, formatClock,
  cardBands, cardCentre, scoreTextW, CARD_LANE,
} from '../src/ui/layout.js';

const fieldRect = (w, h) => fitCamera(w, h, createPose(), {}).rect;
const NO_SAFE = { top: 0, right: 0, bottom: 0, left: 0 };
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** Screen boxes (CSS px) of the HUD's text blocks and the button pair. */
function boxes(L) {
  const s = L.s;
  return {
    score: { x0: L.score.x, y0: L.score.y, x1: L.score.x + scoreTextW(s, L.mode !== 'gutter', L.delta === 'suffix') * s, y1: L.score.y + L.score.h * s },
    right: { x0: L.right.x, y0: L.right.y, x1: L.right.x + L.right.w * s, y1: L.right.y + L.right.h * s },
    heat: { x0: L.heat.x, y0: L.heat.y, x1: L.heat.x + L.heat.w * s, y1: L.heat.y + L.heat.h * s },
    btns: { x0: L.btns.x, y0: L.btns.y, x1: L.btns.x + BTNS_W, y1: L.btns.y + HUD.BTN },
  };
}
const field = (r) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });

// phones (portrait, landscape, short Safari viewports), tablets, near-square and desktop windows
const VIEWS = [
  [375, 812, 0], [375, 812, 44], [390, 844, 47], [412, 915, 0], [430, 932, 59], [390, 664, 0],
  [375, 667, 0], [375, 548, 0], [320, 568, 0], [844, 390, 0], [667, 375, 0], [768, 1024, 0],
  [820, 1180, 0], [1024, 1366, 0], [900, 900, 0], [700, 1000, 0], [1440, 900, 0], [1024, 768, 0],
  [800, 600, 0], [1280, 720, 0],
];

test('HUD text never shows under its floor: kickers 12 px, name 13, READY and drops 12, delta 13', () => {
  assert.ok(TEXT.K_PX >= 12 && TEXT.SMALL_PX >= 13 && TEXT.TINY_PX >= 12 && TEXT.NUM_PX >= 13, 'ART §3 sizes');
  for (let s = 0.15; s <= 1.4; s += 0.05) {
    const t = hudText(s);
    assert.ok(t.k * s >= TEXT.K_PX - 1e-9, `kicker at s ${s.toFixed(2)}`);
    assert.ok(t.small * s >= TEXT.SMALL_PX - 1e-9, `name at s ${s.toFixed(2)}`);
    assert.ok(t.tiny * s >= TEXT.TINY_PX - 1e-9, `READY / drop label at s ${s.toFixed(2)}`);
    assert.ok(t.num * s >= TEXT.NUM_PX - 1e-9, `delta at s ${s.toFixed(2)}`);
    assert.ok(t.k >= TEXT.K && t.small >= TEXT.SMALL, 'never below the designed size');
  }
  // the heights grow with the floors: a phone-scale score block is taller than 96 units
  assert.ok(hudHeights(0.38, true).score > 96);
});

test('HUD buttons never cover HUD text, and every block stays on screen (all views)', () => {
  for (const [w, h, st] of VIEWS) {
    const r = fieldRect(w, h);
    const L = hudLayout(w, h, r, { top: st, right: 0, bottom: 0, left: 0 });
    const b = boxes(L);
    const at = `${w}x${h} (${L.mode})`;
    assert.ok(!overlaps(b.btns, b.score), `${at}: buttons clear of the score`);
    assert.ok(!overlaps(b.btns, b.right), `${at}: buttons clear of level, name and lives`);
    assert.ok(!overlaps(b.btns, b.heat), `${at}: buttons clear of the HEAT line and drops`);
    assert.ok(!overlaps(b.score, b.right) && !overlaps(b.heat, b.right), `${at}: score/HEAT clear of the level block`);
    assert.ok(b.btns.x0 >= 0 && b.btns.x1 <= w && b.btns.y0 >= st && b.btns.y1 <= h, `${at}: buttons on screen, below the notch`);
    for (const k of ['score', 'right', 'heat']) {
      assert.ok(b[k].x0 >= -0.5 && b[k].x1 <= w + 0.5 && b[k].y0 >= st - 0.5, `${at}: ${k} on screen`);
    }
    assert.ok(L.s * 72 >= 21, `${at}: score readable (${(L.s * 72).toFixed(1)} px)`);
  }
});

test('the reviewer\'s cases: 844x390 gutter and 768x1024 inset keep buttons off the text', () => {
  const g = hudLayout(844, 390, fieldRect(844, 390), NO_SAFE);
  assert.equal(g.mode, 'gutter');
  const gb = boxes(g);
  assert.ok(gb.btns.y0 >= gb.right.y1, 'gutter: buttons start under the level/lives block (floors included)');
  const t = hudLayout(768, 1024, fieldRect(768, 1024), NO_SAFE);
  assert.equal(t.mode, 'inset');
  const tb = boxes(t);
  assert.ok(tb.btns.x1 <= tb.right.x0 || tb.btns.y1 <= tb.right.y0, 'inset: buttons beside or above the LEVEL block, never on it');
});

test('phone portrait: one band above the field, below the notch, never over the field', () => {
  for (const [w, h, st] of [[390, 844, 0], [375, 812, 0], [412, 915, 0], [430, 932, 0], [393, 852, 0]]) {
    const r = fieldRect(w, h);
    const L = hudLayout(w, h, r, { top: st, right: 0, bottom: 34, left: 0 });
    assert.equal(L.mode, 'band', `${w}x${h}`);
    assert.ok(L.s > 0 && L.s <= r.scale + 1e-9);
    const b = boxes(L);
    for (const k of ['score', 'right', 'heat', 'btns']) {
      assert.ok(!overlaps(b[k], field(r)), `${k} stays off the field at ${w}x${h}`);
    }
    assert.ok(L.score.y >= st, 'below the safe area');
    assert.ok(b.heat.y0 >= b.score.y1 - 1e-6, 'the HEAT line runs under the score');
    assert.ok(!overlaps(b.heat, b.right), 'the HEAT line stops short of the level block');
    assert.ok(b.heat.x1 - b.heat.x0 >= 0.55 * r.w, `the HEAT line is long enough to read (${(b.heat.x1 - b.heat.x0).toFixed(0)} px)`);
    assert.ok(L.text.score * L.s >= 44 - 1e-9, `score numeral ${(L.text.score * L.s).toFixed(1)} px (ART 15.6 D3: 44)`);
  }
});

test('phone band (ART 15.6 D3): 44 px score, 22 px level, discs top-right over LEVEL, HEAT stops short, drops clear the glass', () => {
  for (const [w, h] of [[390, 844], [375, 812], [412, 915], [430, 932]]) {
    const r = fieldRect(w, h);
    const L = hudLayout(w, h, r, NO_SAFE);
    const at = `${w}x${h}`;
    assert.equal(L.mode, 'band', at);
    const s = L.s;
    assert.ok(L.text.score * s >= TEXT.SCORE_BAND_PX - 1e-9, `${at}: score ${(L.text.score * s).toFixed(1)} px`);
    assert.ok(L.text.lvl * s >= TEXT.LVL_BAND_PX - 1e-9, `${at}: level ${(L.text.lvl * s).toFixed(1)} px`);
    const inset = (HUD.BTN - HUD.BTN_DRAWN) / 2;
    const disc = { x0: L.btns.x + inset, y0: L.btns.y + inset, x1: L.btns.x + BTNS_W - inset, y1: L.btns.y + HUD.BTN - inset };
    assert.ok(disc.y1 <= L.right.y, `${at}: the discs sit above LEVEL`);
    assert.ok(Math.abs(disc.x1 - (r.x + r.w)) < 1, `${at}: the discs end on the field's right edge`);
    assert.ok(L.btns.y + HUD.BTN <= L.right.y, `${at}: their 44 px targets stop above LEVEL`);
    const b = boxes(L);
    assert.equal(L.delta, 'suffix', `${at}: the delta rides the score's suffix`);
    assert.ok(b.score.x1 + HUD.BTN_CLEAR <= L.right.x, `${at}: a six-digit score and its suffix stay clear of the level block`);
    const nameW = HUD.NAME_EM * Math.max(TEXT.SMALL * s, TEXT.SMALL_PX);
    const rightLeft = r.x + r.w - Math.max(HUD.RIGHT_W * s, nameW);
    assert.ok(b.heat.x1 <= rightLeft - HUD.HEAT_END_PX + 1e-6, `${at}: HEAT ends 16 px before the level block`);
    assert.ok(r.y - b.heat.y1 >= HUD.FIELD_GAP_PX - 1e-6, `${at}: the drops' lines end ${(r.y - b.heat.y1).toFixed(1)} px above the field`);
    assert.ok(r.y - b.right.y1 >= HUD.FIELD_GAP_PX - 1e-6, `${at}: lives end above the field`);
  }
});

test('notched phones (standalone): the band once the field gives it the reserve main.js asks for', () => {
  // with the 44 px score and the disc row a notched phone's band no longer fits above the field
  // as it stands: main.js shortens the view (or C's setReserve fits the field lower) by hudReserve
  for (const [w, h, st] of [[390, 844, 47], [375, 812, 44], [430, 932, 59], [393, 852, 59], [360, 780, 30], [414, 896, 44]]) {
    const safe = { top: st, right: 0, bottom: 34, left: 0 };
    let r = fieldRect(w, h);
    let L = hudLayout(w, h, r, safe);
    if (L.mode !== 'band') {
      const top = hudReserve(w, h, r, safe);
      assert.ok(top > 0, `${w}x${h}: asks for a reserve`);
      const below = fieldRect(w, h - top);
      r = { ...below, y: below.y + top };
      L = hudLayout(w, h, r, safe);
    }
    assert.equal(L.mode, 'band', `${w}x${h} notch ${st}`);
    const fieldTop = r.y;
    const firstRow = r.y + HUD.INSET_TOP * r.scale;
    assert.ok(L.heat.y + L.heat.h * L.s <= fieldTop + 1e-6, `${w}x${h}: HEAT row ends above the field`);
    assert.ok(L.right.y + L.right.h * L.s <= fieldTop + 1e-6, `${w}x${h}: level block ends above the field`);
    assert.ok(firstRow > fieldTop, 'sanity');
    // the floors hold at the band's scale
    assert.ok(L.text.k * L.s >= 12 - 1e-9 && L.text.small * L.s >= 13 - 1e-9 && L.text.tiny * L.s >= 12 - 1e-9);
  }
});

test('desktop: score and HEAT in the left gutter, level and lives in the right', () => {
  const r = fieldRect(1440, 900);
  const L = hudLayout(1440, 900, r, NO_SAFE);
  assert.equal(L.mode, 'gutter');
  assert.ok(L.score.x + HUD.SCORE_W * L.s <= r.x, 'score left of the field');
  assert.ok(L.heat.x + HUD.SCORE_W * L.s <= r.x, 'HEAT left of the field');
  assert.ok(L.heat.y >= L.score.y + L.score.h * L.s, 'HEAT under the score');
  assert.ok(L.right.x >= r.x + r.w, 'level/lives right of the field');
  assert.ok(L.score.x >= 0 && L.right.x + HUD.RIGHT_W * L.s <= 1440);
  assert.ok(Math.abs(L.s - r.scale) < 1e-9, 'full field scale when the gutter is wide');
  // ART 15.6 D6: 1440x900, 1280x800 and 800x557 among them; every gutter block clears the field
  for (const [w, h] of [[1440, 900], [1280, 800], [800, 557], [800, 600], [1024, 768], [900, 900]]) {
    const M = hudLayout(w, h, fieldRect(w, h), NO_SAFE);
    assert.equal(M.mode, 'gutter', `${w}x${h}`);
    const mb = boxes(M);
    const f = field(fieldRect(w, h));
    for (const k of ['btns', 'score', 'heat', 'right']) assert.ok(!overlaps(mb[k], f), `${w}x${h} ${k} off the field`);
  }
});

test('landscape phone uses the gutters, clear of the side safe areas', () => {
  const r = fieldRect(844, 390);
  const L = hudLayout(844, 390, r, { top: 0, right: 47, bottom: 21, left: 47 });
  assert.equal(L.mode, 'gutter');
  assert.ok(L.score.x >= 47, 'clear of the left safe area');
  assert.ok(L.btns.x + BTNS_W <= 844 - 47, 'clear of the right safe area');
});

test('inset (no band, no gutters): inside the field\'s empty top margin when it fits', () => {
  for (const [w, h] of [[768, 1024], [700, 1000], [820, 1180]]) {
    const r = fieldRect(w, h);
    const L = hudLayout(w, h, r, NO_SAFE);
    assert.equal(L.mode, 'inset', `${w}x${h}`);
    assert.ok(L.side, `${w}x${h}: a wide band puts the discs beside LEVEL`);
    const b = boxes(L);
    const bottom = Math.max(b.heat.y1, b.right.y1, b.score.y1);
    assert.ok(bottom <= r.y + HUD.INSET_TOP * r.scale + 1e-6, `${w}x${h}: above the first brick row (${bottom.toFixed(0)} vs ${(r.y + HUD.INSET_TOP * r.scale).toFixed(0)})`);
  }
});

test('hudReserve: a top reserve gives the band room above the field (the renderer fits below it)', () => {
  for (const [w, h] of [[768, 1024], [900, 900], [390, 664], [375, 548], [700, 1000]]) {
    const r = fieldRect(w, h);
    const top = hudReserve(w, h, r, NO_SAFE);
    if (hudLayout(w, h, r, NO_SAFE).mode !== 'inset') { assert.equal(top, 0); continue; }
    assert.ok(top > 0, `${w}x${h} asks for a reserve`);
    // what the renderer would do: fit the field into the viewport under the reserve
    const below = fieldRect(w, h - top);
    const rr = { ...below, y: below.y + top };
    const L = hudLayout(w, h, rr, NO_SAFE);
    assert.equal(L.mode, 'band', `${w}x${h} with a ${top} px reserve`);
    assert.ok(!overlaps(boxes(L).heat, field(rr)), 'HUD off the field');
  }
  for (const [w, h] of [[375, 812], [1440, 900], [844, 390]]) assert.equal(hudReserve(w, h, fieldRect(w, h), NO_SAFE), 0);
});

test('level card: under the formation, under the lintel, never over the paddle or the served ball', () => {
  const bricks = (rows) => {
    const B = { count: 0, alive: [], y: [], h: [] };
    for (const y of rows) { B.alive.push(1); B.y.push(y); B.h.push(30); B.count++; }
    return B;
  };
  const world = (rows, mode = 'bottom', paddle = { x: 360, y: 1000, w: 120, h: 16 }, field = { ceilingY: 0, farX: 720 }) =>
    ({ bricks: bricks(rows), paddle, level: { mode }, field });
  const floor = 1000 - 8 - CARD_LANE; // the served ball and a margin (a launch cuts the card at once)
  // a low formation under a low ceiling (level 1: face at 390, rows 510 to 630): the gap above the
  // bricks holds the lintel, so the card takes the open band under the formation, where the eye is
  const low = cardBands(world([525, 555, 585, 615], 'bottom', undefined, { ceilingY: 390, farX: 720 }));
  assert.deepEqual(low.slice(), [[642, floor, 390 + 24, floor]]);
  const y = cardCentre(low, 200, 240, 1080);
  assert.ok(y - 100 >= 642 && y + 100 <= floor, `card under the formation (${y})`);
  // taller than the open band: it grows up over the lowest bricks, never onto the ball or the lintel
  const yg = cardCentre(low, 400, 240, 1080);
  assert.ok(Math.abs(yg + 200 - floor) < 1e-9 && yg - 200 >= 414, `grown card (${yg})`);
  const yx = cardCentre(low, 600, 240, 1080);
  assert.ok(Math.abs(yx - 300 - 414) < 1e-9, `taller than the chamber: the lintel side stays clear (${yx})`);
  // a tall formation: the card goes under it, above the paddle and the served ball
  const tall = cardBands(world([105, 165, 225, 285, 345, 405, 465, 525, 555, 585]));
  const yt = cardCentre(tall, 260);
  assert.ok(yt - 130 >= 600 + 12 - 1e-9 && yt + 130 <= floor + 1e-9, `card under the formation (${yt})`);
  // too little room under the formation: grown up from the paddle's room, still inside the field
  const full = cardBands(world([105, 195, 285, 375, 465, 555, 645, 735, 825]));
  const yf = cardCentre(full, 400);
  assert.ok(yf - 200 >= 90 && Math.abs(yf + 200 - floor) < 1e-9, `grown (${yf})`);
  // horizontal mode: the band around the paddle's track centre is kept clear
  const side = cardBands(world([105, 975], 'left', { x: 40, y: 540, w: 120, h: 16 }));
  for (const [a, b] of side) assert.ok(b <= 540 - 90 || a >= 540 + 90, 'clear of the side paddle');
  assert.ok(side.x0 >= 40 + 8 + 18, 'right of the paddle track and the ball on it');
  // scrolling rows waiting above the field do not count
  assert.deepEqual(cardBands(world([-200, 615]))[0], [642, floor, 90, floor]);
});

test('level card: cropped ceiling framing uses only visible empty bands', () => {
  const bands = [[90, 438], [642, 932]];
  const fieldY = 300, fieldH = 780;
  const y = cardCentre(bands, 260, fieldY, fieldY + fieldH);
  assert.equal(y, 787, 'the clipped headroom is too short; use the empty band under the formation');
  const fraction = (y - fieldY) / fieldH;
  assert.ok(fraction > 0 && fraction < 1, 'the position normalizes over the framed field');
  assert.equal(fieldY + fraction * fieldH, y, 'screen placement maps back to original field y');
  const fallback = cardCentre([[0, 150]], 260, fieldY, fieldY + fieldH);
  assert.ok(fallback >= fieldY && fallback <= fieldY + fieldH, 'offscreen-only bands cannot pull the card out of frame');
});

test('score and clock formatting', () => {
  assert.equal(formatScore(0), '0');
  assert.equal(formatScore(950), '950');
  assert.equal(formatScore(12400), '12 400');
  assert.equal(formatScore(1284000), '1 284 000');
  assert.equal(formatClock(30000), '0:30');
  assert.equal(formatClock(24001), '0:25');
  assert.equal(formatClock(65000), '1:05');
  assert.equal(formatClock(-5), '0:00');
});
