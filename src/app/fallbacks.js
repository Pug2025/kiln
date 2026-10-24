// Kiln: presentation fallbacks (OWNER: D). Economy catalogues use the shipped definitions,
// including their save IDs and per-item prices, so the adapter has no second catalogue to drift.
// The economy modules already ship as dependencies of economy.js and save.js.

export { MODS } from '../economy/mods.js';
export { OVERLOADS } from '../economy/overloads.js';
export { FORGE_ITEMS, forgePrice } from '../economy/forge.js';

/** Gate doors (B's twistsFor replaces these). */
export const TWISTS = [
  { id: 'moving', name: 'Moving rows', fact: 'Two rows slide' },
  { id: 'armoured', name: 'Armour', fact: '1 in 3 plain bricks gains armour' },
];

/** Door facts by twist id, read off B's applyTwist rules (B's doors carry a label only). */
export const TWIST_FACTS = {
  moving: 'Two rows slide',
  armoured: '1 in 3 plain bricks gains armour',
  heavier: 'Plain and numbered bricks need 1 more hit',
  hot: 'Ball starts one speed tier faster',
  sentry: 'One more sentry',
  explosive: 'Adds explosive bricks',
  rich: '1 in 8 plain bricks carries a drop',
};

/** PLAN §7 "Credits", exact lines (E's src/audio/credits.js replaces these). */
export const CREDIT_LINES = [
  "'Machina' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  "'Nightfall' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  "'Resonance' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  "'Red' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  "'Ambush' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  "'Legacy' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  'Drone: "Free Music ATMOS – Linear Atmospheres", FabienC@RustedMusicStudio, CC BY 4.0, https://rustedstudio.itch.io/free-music-atmos-linear-atmospheres',
  'Sounds: "Dark Sci-Fi Audio Pack" by SRG774, CC0, https://opengameart.org/content/dark-sci-fi-audio-pack',
  'Licence text: https://creativecommons.org/licenses/by/4.0/',
];
