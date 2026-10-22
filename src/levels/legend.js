// Kiln — the brick legend: one character per grid cell in a level's `rows`.
// Full format: src/levels/FORMAT.md. OWNER after day one: B (append new characters only; never
// change what an existing character means once a level uses it).

import { BRICK, BF } from '../core/constants.js';

const S = BF.SOLID, BR = BF.BREAKABLE, CL = BF.CLEARABLE;

/**
 * @typedef {object} LegendEntry
 * @property {number} type   BRICK.*
 * @property {number} flags  BF.*
 * @property {number} hp     hits to break (0 = cannot break)
 * @property {number} tier   plain look tier 1–3 (0 otherwise)
 * @property {string} what   one-line description (docs, level tests)
 */

/** @type {Readonly<Record<string, LegendEntry>>} */
export const LEGEND = Object.freeze({
  '.': { type: BRICK.EMPTY, flags: 0, hp: 0, tier: 0, what: 'empty cell' },
  ' ': { type: BRICK.EMPTY, flags: 0, hp: 0, tier: 0, what: 'empty cell' },
  a: { type: BRICK.PLAIN, flags: S | BR | CL, hp: 1, tier: 1, what: 'plain, cool core (1 hit)' },
  b: { type: BRICK.PLAIN, flags: S | BR | CL, hp: 1, tier: 2, what: 'plain, warm core (1 hit)' },
  c: { type: BRICK.PLAIN, flags: S | BR | CL, hp: 1, tier: 3, what: 'plain, molten core (1 hit)' },
  2: { type: BRICK.NUMBERED, flags: S | BR | CL, hp: 2, tier: 0, what: 'numbered, 2 hits' },
  3: { type: BRICK.NUMBERED, flags: S | BR | CL, hp: 3, tier: 0, what: 'numbered, 3 hits' },
  4: { type: BRICK.NUMBERED, flags: S | BR | CL, hp: 4, tier: 0, what: 'numbered, 4 hits' },
  5: { type: BRICK.NUMBERED, flags: S | BR | CL, hp: 5, tier: 0, what: 'numbered, 5 hits' },
  6: { type: BRICK.NUMBERED, flags: S | BR | CL, hp: 6, tier: 0, what: 'numbered, 6 hits' },
  7: { type: BRICK.NUMBERED, flags: S | BR | CL, hp: 7, tier: 0, what: 'numbered, 7 hits' },
  8: { type: BRICK.NUMBERED, flags: S | BR | CL, hp: 8, tier: 0, what: 'numbered, 8 hits' },
  9: { type: BRICK.NUMBERED, flags: S | BR | CL, hp: 9, tier: 0, what: 'numbered, 9 hits' },
  A: { type: BRICK.ARMOURED, flags: S | BR | CL | BF.ARMOURED, hp: 3, tier: 0, what: 'armoured: 3 ball hits, 1 laser/fire hit' },
  X: { type: BRICK.INDESTRUCTIBLE, flags: S, hp: 0, tier: 0, what: 'indestructible' },
  E: { type: BRICK.EXPLOSIVE, flags: S | BR | CL | BF.EXPLOSIVE, hp: 1, tier: 0, what: 'explosive: 3×3 blast, chains' },
  G: { type: BRICK.GRAVITY, flags: S | BR | CL, hp: 1, tier: 0, what: 'gravity: falls when the brick under it goes' },
  C: { type: BRICK.CAVITY, flags: S | BR | CL, hp: 2, tier: 0, what: 'cavity shell (2 hits) around a sealed ball' },
  '*': { type: BRICK.CAVITY, flags: BF.CAVITY_BALL, hp: 0, tier: 0, what: 'sealed ball inside a cavity (freed when its shell is open)' },
  '?': { type: BRICK.CARRIER, flags: S | BR | CL, hp: 1, tier: 0, what: 'carrier: always releases a drop' },
  '(': { type: BRICK.PORTAL, flags: BF.PORTAL, hp: 0, tier: 0, what: 'portal pair 1, end A' },
  ')': { type: BRICK.PORTAL, flags: BF.PORTAL, hp: 0, tier: 0, what: 'portal pair 1, end B' },
  '[': { type: BRICK.PORTAL, flags: BF.PORTAL, hp: 0, tier: 0, what: 'portal pair 2, end A' },
  ']': { type: BRICK.PORTAL, flags: BF.PORTAL, hp: 0, tier: 0, what: 'portal pair 2, end B' },
  '{': { type: BRICK.PORTAL, flags: BF.PORTAL, hp: 0, tier: 0, what: 'portal pair 3, end A' },
  '}': { type: BRICK.PORTAL, flags: BF.PORTAL, hp: 0, tier: 0, what: 'portal pair 3, end B' },
  B: { type: BRICK.BOSS, flags: S | BF.BOSS, hp: 0, tier: 0, what: 'boss body / armour (the boss script decides if it breaks)' },
  W: { type: BRICK.WEAK, flags: S | BR | BF.BOSS | BF.WEAK, hp: 1, tier: 0, what: 'boss weak point' },
  S: { type: BRICK.EMPTY, flags: 0, hp: 0, tier: 0, what: 'sentry spawn point (empty cell; a sentry starts here)' },
});

/** Portal pairs: opening character → closing character. */
export const PORTAL_PAIRS = Object.freeze({ '(': ')', '[': ']', '{': '}' });

/** True if the character is in the legend. */
export function isLegendChar(ch) {
  return Object.prototype.hasOwnProperty.call(LEGEND, ch);
}
