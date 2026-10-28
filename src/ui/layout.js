// Kiln: HUD layout maths (OWNER: D). Pure, no DOM: tests/d-layout.test.mjs runs it in Node.
//
// The HUD is designed in field units (ART §4: 72-unit score, 32-unit level number, 24-unit edge
// inset) and scaled with the projected field, never larger than the field's own scale. Text has a
// legible floor on screen (TEXT below: the score numeral 44 px, the level numeral 22 px, kickers
// 12 px), so its field-unit size grows as the scale shrinks; every height here includes those
// floors, which is what keeps the HUD's pieces off each other and off the field.
// It never covers the field rect when there is room:
//   band    phones: one band above the field. Left: SCORE, the numeral with its suffix (×mult, the
//           delta), then the HEAT line (READY at its end) and the active drops. Right: the pause
//           and sound discs in the top corner, LEVEL, name and lives under them. The HEAT line
//           ends 16 px before the level block (ART 15.6 D3)
//   gutter  wide screens: left gutter holds score and HEAT (READY under the track's left end),
//           right gutter level, name, lives and, under them, the pause and sound discs
//   inset   last resort when neither fits readably (tablet portrait, near-square windows, short
//           phone viewports, notched phones in standalone mode): the band may run down into the
//           field's empty top margin (bricks start at y = 90). The renderer removes this case with
//           a top reserve (hudReserve, C's setReserve).
// Each block is positioned by its top-left corner in CSS px and scaled by `s` from that corner.

import { BALL, FIELD } from '../core/constants.js';

/** Block widths and gaps in field units (= CSS px at s = 1), and the button pair in CSS px. */
export const HUD = Object.freeze({
  SCORE_W: 320,  // SCORE kicker + 72-unit numeral and its suffix (a six-digit score and ×mult fit)
  RIGHT_W: 220,  // LEVEL kicker, 32-unit numeral, name, lives (or time)
  BAND_GAP: 14,  // score row to HEAT row in the band
  STACK_GAP: 28, // score to HEAT in the gutter
  FIELD_GAP: 10, // band bottom to the field's top edge ...
  FIELD_GAP_PX: 10, // ... and never under this many CSS px (the drop labels' lines clear the glass)
  INSET_TOP: 90, // the field's empty top margin (GRID.bottom.y0)
  GUTTER_PX: 24, // CSS px between a gutter block and the field / the screen edge
  TOP_PX: 8,     // CSS px between the band and the safe area
  MIN_READABLE: 0.45, // band or gutter at this share of the field scale (or S_READABLE) beats inset
  S_READABLE: 0.33,   // ... or at this scale
  S_INSET_MIN: 0.3,   // the inset never shrinks below this
  BTN: 44,       // CSS px: touch target of each HUD button (pause, sound)
  BTN_DRAWN: 32, // CSS px: the disc drawn inside it (ART 15.6 D3)
  BTN_GAP: 4,
  BTN_CLEAR: 8,  // CSS px between the buttons and any HUD text
  BTN_ROW: 40,   // CSS px: band, the disc row above LEVEL (32 px disc + 8 px)
  HEAT_END_PX: 16, // CSS px: band, the HEAT line stops this far left of the level block
  NAME_EM: 7.2,  // the longest level name ("Friend or foe") in ems of its font
  SCORE_EM: 3.6, // "515 580" in Inter Tight 700, tabular, -0.02em (a full campaign's run score)
  SUFFIX_EM: 4.3, // the widest suffix line in the band ("Free miss") in ems of the delta size
  MULT_EM: 1.3,  // the gutter's suffix: the multiplier alone (the delta stays in the SCORE kicker row)
  SUFFIX_GAP: 8, // units between the numeral and its suffix (ART 15.6 D5)
});

/**
 * HUD text: size in field units (ART §3/§4) and the smallest size it may show on screen (CSS px).
 * ART §3: kickers 12–13 px, level name 13–14 px; READY and drop labels 11 units, never under 12 px.
 * ART 15.6 D3 (the phone band and the inset): the score numeral never under 44 px, the level
 * numeral never under 22 px. The gutter keeps the 72-unit score and an 18 px level numeral floor.
 */
export const TEXT = Object.freeze({
  K: 12, K_PX: 12,         // kickers: SCORE, HEAT, LEVEL, LIVES, TIME
  SMALL: 13, SMALL_PX: 13, // level name
  TINY: 11, TINY_PX: 12,   // READY and the active-drop labels
  NUM: 15, NUM_PX: 13,     // the score's suffix: ×mult and the delta / note
  LVL: 32, LVL_PX: 18,     // the level number and the timed-level clock (gutter) ...
  LVL_BAND_PX: 22,         // ... and in the band
  SCORE: 72, SCORE_BAND_PX: 44, // the score numeral; its floor in the band
});

/** Width of the HUD button pair (pause, sound) in CSS px. */
export const BTNS_W = HUD.BTN * 2 + HUD.BTN_GAP;

/**
 * Field-unit text sizes at block scale s: on screen each is max(size × s, floor). `band`: the phone
 * band and the inset (bigger numeral floors, ART 15.6 D3).
 * @returns {{k:number, small:number, tiny:number, num:number, lvl:number, score:number}}
 */
export function hudText(s, out = {}, band = false) {
  const q = s > 0 ? s : 1e-3;
  out.k = Math.max(TEXT.K, TEXT.K_PX / q);
  out.small = Math.max(TEXT.SMALL, TEXT.SMALL_PX / q);
  out.tiny = Math.max(TEXT.TINY, TEXT.TINY_PX / q);
  out.num = Math.max(TEXT.NUM, TEXT.NUM_PX / q);
  out.lvl = Math.max(TEXT.LVL, (band ? TEXT.LVL_BAND_PX : TEXT.LVL_PX) / q);
  out.score = band ? Math.max(TEXT.SCORE, TEXT.SCORE_BAND_PX / q) : TEXT.SCORE;
  return out;
}

const T = { k: 0, small: 0, tiny: 0, num: 0, lvl: 0, score: 0 };

/**
 * Width in field units of the score line at scale s: a six-digit run score, the gap, and the
 * widest suffix line. Band: the suffix is a column (×mult on the numeral's baseline, the delta
 * above it). Gutter: the multiplier alone; the delta sits in the SCORE kicker row there.
 */
export function scoreTextW(s, band = true, deltaInSuffix = band) {
  const t = hudText(s, T, band);
  return t.score * HUD.SCORE_EM + HUD.SUFFIX_GAP + t.num * (deltaInSuffix ? HUD.SUFFIX_EM : HUD.MULT_EM);
}

/**
 * Block heights in field units at scale s (the mirror of css/hud.css; line-height 1 throughout).
 *   score  SCORE kicker + 12 + the numeral (its suffix column is shorter than it)
 *   heat   HEAT row + 12 + one line of active-drop labels (label + 5 for its time line); in the
 *          gutter READY has its own line under the track (+ 8 + READY)
 *   right  LEVEL kicker + 10 + level numeral + 6 + name, then the tallest of: boss line (13) +
 *          lives, or the timed-level clock. `compact` (band, inset) drops the LIVES/TIME kickers.
 * @returns {{score:number, heat:number, right:number, scoreRow:number}}
 */
export function hudHeights(s, compact, out = {}) {
  const t = hudText(s, T, compact);
  out.scoreRow = t.k;
  out.score = t.k + 12 + t.score;
  out.heat = t.k + 12 + t.tiny + 5 + (compact ? 0 : 8 + t.tiny);
  const top = t.k + 10 + t.lvl + 6 + t.small;
  out.right = compact
    ? top + Math.max(13 + 12 + 2, 6 + t.lvl)
    : top + Math.max(13 + 18 + t.k + 12 + 2, 18 + t.k + 10 + t.lvl);
  return out;
}

const H = { score: 0, heat: 0, right: 0, scoreRow: 0 };

/** Units between the band's lowest line and the field's top edge at scale s. */
function fieldGap(s) {
  return Math.max(HUD.FIELD_GAP, HUD.FIELD_GAP_PX / (s > 0 ? s : 1e-3));
}

/**
 * Band (and inset) height in field units at scale s, the field gap included. The discs sit in a
 * row above LEVEL (phones), or beside it on a wide band (`side`), which needs no row of its own.
 */
function bandUnits(s, side) {
  hudHeights(s, true, H);
  const left = H.score + HUD.BAND_GAP + H.heat;
  const right = H.right + (side ? 0 : HUD.BTN_ROW / (s > 0 ? s : 1e-3));
  return Math.max(left, right) + fieldGap(s);
}

/** Band height in CSS px at scale s (floors included); `side`: discs beside LEVEL. */
export function bandPx(s, side = false) {
  return bandUnits(s, side) * s;
}

/** CSS px from the field's left edge to the level block's left edge (a long name included). */
function rightLeftAt(rect, pad, s) {
  const nameW = HUD.NAME_EM * Math.max(TEXT.SMALL * s, TEXT.SMALL_PX);
  return rect.x + rect.w - pad - Math.max(HUD.RIGHT_W * s, nameW);
}

/** Room for the disc pair between the score line and the level block at scale s. */
function sideRoom(rect, pad, s) {
  const scoreEnd = rect.x + pad + scoreTextW(s) * s;
  return rightLeftAt(rect, pad, s) - scoreEnd - 2 * HUD.BTN_CLEAR >= BTNS_W;
}

/** The band's scale for `avail` CSS px: discs beside LEVEL when the band is wide enough, else above. */
function fitBandAt(avail, max, rect, pad) {
  const sSide = fitBand(avail, max, true);
  if (sSide > 0 && sideRoom(rect, pad, sSide)) return { s: sSide, side: true };
  return { s: fitBand(avail, max, false), side: false };
}

/** Largest s in [0, max] whose band fits in `avail` CSS px (bandPx grows with s). */
function fitBand(avail, max, side) {
  if (max <= 0 || bandPx(max, side) <= avail) return Math.max(0, max);
  let lo = 0, hi = max;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bandPx(mid, side) <= avail) lo = mid; else hi = mid;
  }
  return lo;
}

function block(o) {
  return o || { x: 0, y: 0, w: 0, h: 0 };
}

/**
 * @param {number} viewW  CSS px
 * @param {number} viewH
 * @param {{x:number, y:number, w:number, h:number, scale:number}} rect  renderer.fieldRect()
 * @param {{top:number, right:number, bottom:number, left:number}} safe  safe-area insets
 * @param {object} [out]
 * @returns {{mode:'band'|'gutter'|'inset', s:number, text:{k:number,small:number,tiny:number,num:number,lvl:number,score:number},
 *   score:{x:number,y:number,w:number,h:number}, heat:{x:number,y:number,w:number,h:number},
 *   right:{x:number,y:number,w:number,h:number}, btns:{x:number,y:number}}}
 *   x, y in CSS px; w, h in field units (multiply by s for CSS px); text sizes in field units
 */
export function hudLayout(viewW, viewH, rect, safe, out = {}) {
  out.score = block(out.score);
  out.heat = block(out.heat);
  out.right = block(out.right);
  out.btns = out.btns || { x: 0, y: 0 };
  out.text = out.text || { k: 0, small: 0, tiny: 0, num: 0, lvl: 0, score: 0 };
  const fs = rect.scale > 0 ? rect.scale : 1;
  const st = safe.top || 0;

  // band above the field
  const bandAvail = rect.y - st - HUD.TOP_PX;
  const band = fitBandAt(bandAvail, fs, rect, 0);
  const sBand = band.s;
  // side gutters
  const gl = rect.x - (safe.left || 0) - 2 * HUD.GUTTER_PX;
  const gr = viewW - (safe.right || 0) - (rect.x + rect.w) - 2 * HUD.GUTTER_PX;
  const sGutter = Math.max(0, Math.min(fs, gl / HUD.SCORE_W, gr / HUD.RIGHT_W));

  const best = Math.max(sBand, sGutter);
  if (best < Math.min(fs * HUD.MIN_READABLE, HUD.S_READABLE)) {
    // inset: the band may use the field's empty top margin as well as the space above the field;
    // on the shortest viewports it stays readable and runs a little further down
    const pad = 12 * fs;
    const fit = fitBandAt(bandAvail + (HUD.INSET_TOP - 8) * fs, fs, rect, pad);
    const s = Math.max(fit.s, Math.min(fs, HUD.S_INSET_MIN));
    const side = sideRoom(rect, pad, s);
    const top = Math.max(st + HUD.TOP_PX, rect.y + HUD.INSET_TOP * fs - bandPx(s, side));
    out.mode = 'inset';
    placeBand(out, s, side, rect, top, pad, viewW, safe);
    return out;
  }
  if (sBand >= sGutter) {
    out.mode = 'band';
    placeBand(out, sBand, band.side, rect, rect.y - bandPx(sBand, band.side), 0, viewW, safe);
    return out;
  }
  const s = sGutter;
  out.mode = 'gutter';
  out.s = s;
  out.delta = 'kicker';
  hudHeights(s, false, H);
  hudText(s, out.text, false);
  setBlock(out.score, rect.x - HUD.GUTTER_PX - HUD.SCORE_W * s, rect.y, HUD.SCORE_W, H.score);
  setBlock(out.heat, out.score.x, rect.y + (H.score + HUD.STACK_GAP) * s, HUD.SCORE_W, H.heat);
  setBlock(out.right, rect.x + rect.w + HUD.GUTTER_PX, rect.y, HUD.RIGHT_W, H.right);
  // buttons right-aligned under the level/lives block (its height includes the text floors); the
  // drawn discs line up with the block's right edge
  const inset = (HUD.BTN - HUD.BTN_DRAWN) / 2;
  out.btns.x = Math.min(viewW - (safe.right || 0) - 4 - BTNS_W, out.right.x + HUD.RIGHT_W * s - BTNS_W + inset);
  out.btns.y = out.right.y + H.right * s + HUD.BTN_CLEAR;
  return out;
}

/**
 * Band or inset: score left with HEAT under it; on the right the pause and sound discs in the top
 * corner with the level block under them (`side`: a wide band puts the discs left of LEVEL). The
 * HEAT line stops 16 px before the level block.
 */
function placeBand(out, s, side, rect, top, pad, viewW, safe) {
  out.s = s;
  out.side = side;
  hudHeights(s, true, H);
  hudText(s, out.text, true);
  const inset = (HUD.BTN - HUD.BTN_DRAWN) / 2;
  const fieldR = rect.x + rect.w - pad;
  const rightLeft = rightLeftAt(rect, pad, s);
  setBlock(out.score, rect.x + pad, top, HUD.SCORE_W, H.score);
  setBlock(out.right, fieldR - HUD.RIGHT_W * s, top + (side ? 0 : HUD.BTN_ROW), HUD.RIGHT_W, H.right);
  // the discs' drawn top on the band's top line; their drawn right edge on the level block's
  // right edge (phones), or 8 px left of the level block (wide bands)
  out.btns.x = side
    ? rightLeft - HUD.BTN_CLEAR - BTNS_W + inset
    : Math.min(viewW - (safe.right || 0) - BTNS_W, fieldR - BTNS_W + inset);
  out.btns.y = Math.max(safe.top || 0, top - inset);
  const heatY = top + (H.score + HUD.BAND_GAP) * s;
  setBlock(out.heat, rect.x + pad, heatY, (rightLeft - HUD.HEAT_END_PX - rect.x - pad) / s, H.heat);
  // the SCORE kicker's hairline stops short of the discs
  out.score.w = Math.min(HUD.SCORE_W, (out.btns.x + inset - HUD.BTN_CLEAR - out.score.x) / s);
  // the delta rides the suffix column unless that would run into the discs or the level block
  // (narrow phones): then it sits in the SCORE kicker row as in the gutter
  const limit = Math.min(side ? out.btns.x + inset : out.btns.x, rightLeft) - HUD.BTN_CLEAR;
  out.delta = out.score.x + scoreTextW(s, true, true) * s <= limit ? 'suffix' : 'kicker';
}

function setBlock(b, x, y, w, h) {
  b.x = x;
  b.y = y;
  b.w = w;
  b.h = h;
}

/**
 * CSS px the renderer should keep clear above the field so the HUD band fits there at a readable
 * scale (tablet portrait, near-square windows, short phone viewports). 0 when band or gutter
 * already fits. `fs` is the field scale without a reserve.
 */
export function hudReserve(viewW, viewH, rect, safe) {
  const L = hudLayout(viewW, viewH, rect, safe, {});
  if (L.mode !== 'inset') return 0;
  const fs = rect.scale > 0 ? rect.scale : 1;
  return Math.ceil((safe.top || 0) + HUD.TOP_PX + bandPx(fs * 0.55));
}

// ---------------------------------------------------------------- level card placement
// The level card names the level over the serving world for a moment. Where it goes:
// - Inside the chamber, never across the lintel. The lintel frames play off from the painted
//   headroom; a card it runs through reads as cut in two. The card keeps CARD_LINTEL clear of
//   the ceiling's face (bottom mode) and of the far wall (horizontal mode).
// - Where the eye already is: in the open space between the formation and the paddle, which the
//   player looks across at the serve. The same place on every level, so the eye learns it.
// - Never over the paddle's track, the served ball or its launch: the card keeps CARD_LANE above
//   the paddle's face (the ball on it and a margin), and a launch takes it away at once (main.js
//   frameStep, ui.js card(null, true)), so the ball never flies under it.
// - Too little open space (phones, deep formations): the card grows up over the lowest bricks,
//   which wait for the serve; never down onto the ball and never up across the lintel.
// Ring mode has no lintel: the empty band above or under the ring, clear of the paddle, in the
// same places as before the lintel work (d-level-card holds them to those).

const CARD_MARGIN = 12;   // field units between the card and the bricks
const CARD_LINTEL = 24;   // field units between the card and the ceiling's face or the far wall
const CARD_PADDLE = 60;   // ring and horizontal mode: field units kept clear round the paddle
/** Bottom mode: field units kept clear above the paddle's face, the served ball and a margin. */
export const CARD_LANE = 2 * BALL.R + CARD_MARGIN;

/**
 * Where the level card may go, in field units. Each entry is an empty band [y0, y1] and the room
 * [r0, r1] around it the card must stay inside whatever its height (the chamber under the lintel,
 * clear of the paddle and the launch lane), best first. `x0`, `x1`: the card's horizontal room
 * (horizontal mode: between the paddle's track and the far wall; else the whole field).
 * @param {import('../core/types.js').World} world
 * @returns {Array<[number, number, number, number]> & {x0:number, x1:number}}
 */
export function cardBands(world) {
  const B = world.bricks;
  let top = Infinity, bottom = -Infinity;
  for (let i = 0; i < B.count; i++) {
    if (!B.alive[i]) continue;
    const y0 = B.y[i] - B.h[i] / 2, y1 = B.y[i] + B.h[i] / 2;
    if (y1 <= 0) continue; // rows waiting above the field (scrolling levels)
    if (y0 < top) top = y0;
    if (y1 > bottom) bottom = y1;
  }
  const bricks = Number.isFinite(top);
  const p = world.paddle;
  const mode = world.level.mode;
  const F = world.field || {};
  let out;
  if (mode !== 'left' && mode !== 'ring') {
    // the chamber: under the ceiling (or the field's top margin, where an inset HUD may sit) and
    // above the launch lane. The card always takes the open band under the formation; the gap
    // between the ceiling and the bricks (CEILING.GAP at most) is never tall enough for it.
    const roof = Math.max(HUD.INSET_TOP, F.ceilingY > 0 ? F.ceilingY + CARD_LINTEL : 0);
    const floor = p.y - (p.h || 16) / 2 - CARD_LANE;
    const open = bricks ? Math.min(floor - 1, Math.max(roof, bottom + CARD_MARGIN)) : roof;
    out = [[open, floor, roof, floor]];
  } else {
    // the bands above and under the formation, either side of the paddle (and a served ball):
    // its track is a column in horizontal mode, here at its serving place along it. The bands
    // start under the field's top margin (where an inset HUD may sit); the rooms start at the
    // field's top, so a card taller than its band rises toward the top as it always has, rather
    // than down into the ring (phones: L21, The Core's stage 3 and the Overburn ring waves)
    const y0 = HUD.INSET_TOP;
    const half = mode === 'left' ? p.w / 2 + CARD_PADDLE / 2 : (p.h || 16) / 2 + CARD_PADDLE;
    const c0 = p.y - half, c1 = p.y + half;
    const rooms = c1 <= 0 || c0 >= FIELD.H ? [[0, FIELD.H]] : [[0, c0], [c1, FIELD.H]];
    const free = bricks ? [[y0, top - CARD_MARGIN], [bottom + CARD_MARGIN, FIELD.H]] : [[y0, FIELD.H]];
    out = [];
    for (const [a, b] of free) {
      for (const [r0, r1] of rooms) {
        const s = Math.max(a, r0), e = Math.min(b, r1);
        if (e - s > 1) out.push([s, e, r0, r1]);
      }
    }
    // a formation from edge to edge (sliding Overburn columns): over the bricks, still off the paddle
    if (!out.length) for (const [r0, r1] of rooms) if (r1 - Math.max(r0, y0) > 1) out.push([Math.max(r0, y0), r1, r0, r1]);
  }
  out.x0 = 0;
  out.x1 = FIELD.W;
  if (mode === 'left') {
    // right of the paddle's track and the ball on it, left of the far wall (the lintel of this
    // mode) also where it stands at the field's edge: the camera's intro dolly brings it about
    // 3% of the field's width in, past a card held only by the field box's 16 px inset
    out.x0 = p.x + (p.h || 16) / 2 + 2 * BALL.R + CARD_MARGIN;
    out.x1 = (F.farX > 0 && F.farX < FIELD.W ? F.farX : FIELD.W) - CARD_LINTEL;
  }
  return out;
}

/**
 * Centre (field y) for a card `h` field units tall: the middle of the first band it fits, else
 * of the tallest band, grown inside that band's room (bottom mode: up over the lowest bricks,
 * from the launch lane). A card taller than its room keeps the room's top clear (the lintel
 * side), as far as the visible field allows. Bands without a room ([y0, y1]) may use the whole
 * visible field.
 * @param {Array<number[]>} bands  from cardBands, best first
 * @param {number} h
 * @param {number} [minY] visible field top after ceiling framing
 * @param {number} [maxY] visible field bottom
 */
export function cardCentre(bands, h, minY = 0, maxY = 1080) {
  let pick = null;
  for (const b of bands) {
    const a = Math.max(minY, b[0]), z = Math.min(maxY, b[1]);
    if (z <= a) continue;
    const c = [a, z, Math.max(minY, b.length > 2 ? b[2] : minY), Math.min(maxY, b.length > 2 ? b[3] : maxY)];
    if (!pick || z - a > pick[1] - pick[0]) pick = c;
    if (z - a >= h) { pick = c; break; }
  }
  if (!pick) return minY + (maxY - minY) * 0.42;
  const half = h / 2;
  const y = Math.max(pick[2] + half, Math.min(pick[3] - half, (pick[0] + pick[1]) / 2));
  return Math.max(minY + Math.min(half, (maxY - minY) / 2), Math.min(maxY - half, y));
}

/**
 * Score text with thin grouping (128 400), tabular in the font.
 * @param {number} n
 */
export function formatScore(n) {
  const s = String(Math.max(0, Math.floor(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ' ';
    out += s[i];
  }
  return out;
}

/** Seconds as m:ss for the timed bonus levels. */
export function formatClock(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
