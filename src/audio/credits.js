// Kiln: audio credits as data (OWNER: E), for D's Credits screen and CREDITS.md. Every line is
// exactly as PLAN §7 "Credits"; tests/e-credits.test.mjs pins them and checks CREDITS.md.
// Pure: no DOM.

import { MUSIC_FILES } from './music.js';
import { SFX_FILES } from './sfx.js';

const SB = (title) => `'${title}' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au`;

/**
 * kind: 'music' | 'drone' | 'sounds' | 'licence'. `files` are the shipped file names the line
 * covers (MUSIC_FILES / SFX_FILES keys); `url` is the work's page.
 */
export const CREDITS = Object.freeze([
  { kind: 'music', title: 'Machina', line: SB('Machina'), url: 'https://www.scottbuckley.com.au/library/machina/', files: ['machina'] },
  { kind: 'music', title: 'Nightfall', line: SB('Nightfall'), url: 'https://www.scottbuckley.com.au/library/nightfall/', files: ['nightfall', 'nightfall-no-solo-strings'] },
  { kind: 'music', title: 'Resonance', line: SB('Resonance'), url: 'https://www.scottbuckley.com.au/library/resonance/', files: ['resonance', 'resonance-no-melody-in-backend'] },
  { kind: 'music', title: 'Red', line: SB('Red'), url: 'https://www.scottbuckley.com.au/library/red/', files: ['red', 'red-no-vocals'] },
  { kind: 'music', title: 'Ambush', line: SB('Ambush'), url: 'https://www.scottbuckley.com.au/library/ambush/', files: ['ambush'] },
  { kind: 'music', title: 'Legacy', line: SB('Legacy'), url: 'https://www.scottbuckley.com.au/library/legacy/', files: ['legacy'] },
  {
    kind: 'drone',
    title: 'Free Music ATMOS – Linear Atmospheres',
    line: 'Drone: "Free Music ATMOS – Linear Atmospheres", FabienC@RustedMusicStudio, CC BY 4.0, https://rustedstudio.itch.io/free-music-atmos-linear-atmospheres',
    url: 'https://rustedstudio.itch.io/free-music-atmos-linear-atmospheres',
    files: ['drone'],
  },
  {
    kind: 'sounds',
    title: 'Dark Sci-Fi Audio Pack',
    line: 'Sounds: "Dark Sci-Fi Audio Pack" by SRG774, CC0, https://opengameart.org/content/dark-sci-fi-audio-pack',
    url: 'https://opengameart.org/content/dark-sci-fi-audio-pack',
    files: ['hover', 'victory', 'transmission'],
  },
  { kind: 'licence', title: 'CC BY 4.0', line: 'Licence text: https://creativecommons.org/licenses/by/4.0/', url: 'https://creativecommons.org/licenses/by/4.0/', files: [] },
].map((c) => Object.freeze({ ...c, files: Object.freeze(c.files) })));

/** Every line, in order (PLAN §7). */
export const CREDIT_LINES = Object.freeze(CREDITS.map((c) => c.line));

/** True when every file a credit covers ships in this build (the licence line always does). */
export function isShipped(credit, music = MUSIC_FILES, sfx = SFX_FILES) {
  return credit.files.every((f) => !!music[f] || !!sfx[f]);
}

/**
 * Lines for the Credits screen: only works that ship in this build, so a placeholder (the
 * synthesised drone until its file is added) is never credited to someone else.
 */
export function creditLines() {
  return CREDITS.filter((c) => isShipped(c)).map((c) => c.line);
}
