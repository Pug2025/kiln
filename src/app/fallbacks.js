// Kiln: presentation fallbacks (OWNER: D). Used only while another agent's export is missing, so
// every screen can be built and walked before E (Mods, Overloads, The Forge, credits) and B
// (gate twists) deliver. They never change the sim: a fallback pick is shown and recorded nowhere.
// adapters.js prefers the real exports the moment they exist.

/** PLAN §4 Mods (12): short label facts. */
export const MODS = [
  { id: 'life', name: 'Spare', fact: '+1 life' },
  { id: 'embers', name: 'Big embers', fact: 'Embers +6 HEAT' },
  { id: 'shield', name: 'Shield', fact: 'Each level starts with a shield' },
  { id: 'slow', name: 'Slow start', fact: 'Ball starts one tier slower' },
  { id: 'drops', name: 'Double drops', fact: 'Drop rate ×2' },
  { id: 'pierce', name: 'Piercing', fact: 'First hit after a launch passes through' },
  { id: 'catch', name: 'Long catch', fact: 'Catch lasts longer' },
  { id: 'pull', name: 'Cheap Pull', fact: 'Pull costs less HEAT' },
  { id: 'burst', name: 'Bursting embers', fact: '1 in 10 embers bursts' },
  { id: 'magnet', name: 'Magnet', fact: 'Embers curve to the paddle' },
  { id: 'floor', name: 'Combo floor', fact: 'Combo never drops below ×2' },
  { id: 'lasers', name: 'More lasers', fact: 'Laser drops carry more shots' },
];

/** PLAN §4 Overloads. */
export const OVERLOADS = [
  { id: 1, name: 'Purge', fact: 'Clears the lowest 3 rows' },
  { id: 2, name: 'Quench', fact: 'Slows every ball for 3 s' },
  { id: 3, name: 'Fork', fact: 'Splits every ball' },
];

/** PLAN §4 The Forge: 6 items, 3 ranks. */
export const FORGE_ITEMS = [
  { id: 'lives', name: 'Start lives', fact: '+1 life at the start', max: 3 },
  { id: 'heat', name: 'HEAT size', fact: 'Bigger HEAT meter', max: 3 },
  { id: 'paddle', name: 'Paddle width', fact: 'Wider starting paddle', max: 3 },
  { id: 'ember', name: 'Ember value', fact: 'More HEAT per ember', max: 3 },
  { id: 'overload', name: 'Overload power', fact: 'Stronger Overloads', max: 3 },
  { id: 'ball', name: 'Ball types', fact: 'Heavy, Splitter, Sniper', max: 3 },
];
export const FORGE_PRICES = [60, 150, 320];

/** Gate doors (B's twistsFor replaces these). */
export const TWISTS = [
  { id: 'moving', name: 'Moving rows', fact: 'Two rows slide' },
  { id: 'armoured', name: 'Armour', fact: '1 in 3 bricks armoured' },
];

/** Door facts by twist id, read off B's applyTwist rules (B's doors carry a label only). */
export const TWIST_FACTS = {
  moving: 'Two rows slide',
  armoured: '1 in 3 bricks armoured',
  heavier: 'Every brick takes 1 more hit',
  hot: 'Ball one speed tier faster',
  sentry: 'One more sentry',
  explosive: '1 in 6 bricks explosive',
  rich: '1 in 5 bricks carries a drop',
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
