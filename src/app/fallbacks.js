// Kiln: presentation fallbacks (OWNER: D). Used only while another agent's export is missing, so
// every screen can be built and walked before E (Mods, Overloads, The Forge, credits) and B
// (gate twists) deliver. They never change the sim: a fallback pick is shown and recorded nowhere.
// adapters.js prefers the real exports the moment they exist.

/** PLAN §4 Mods (12): short label facts. */
export const MODS = [
  { id: 'life', name: 'Spare', fact: '+1 life' },
  { id: 'embers', name: 'Big embers', fact: 'Each ember gives 6 HEAT' },
  { id: 'shield', name: 'Shield', fact: 'Starts each level with 1 shield' },
  { id: 'slow', name: 'Slow start', fact: 'Slower balls for 10 s after each launch' },
  { id: 'drops', name: 'Double drops', fact: 'Twice the chance of a power drop' },
  { id: 'pierce', name: 'Piercing', fact: 'Balls pass through 1 brick after launch' },
  { id: 'catch', name: 'Long catch', fact: 'Catch drops last 35 s' },
  { id: 'pull', name: 'Cheap Pull', fact: 'Pull uses 26 HEAT per second' },
  { id: 'burst', name: 'Bursting embers', fact: '1 in 10 bricks drops twice the embers' },
  { id: 'magnet', name: 'Magnet', fact: 'Nearby embers curve toward the paddle' },
  { id: 'floor', name: 'Combo floor', fact: 'Score multiplier stays at ×2 or higher' },
  { id: 'lasers', name: 'More lasers', fact: 'Each Laser drop gives 20 shots' },
];

/** PLAN §4 Overloads. */
export const OVERLOADS = [
  { id: 1, name: 'Purge', fact: 'Clears 3 rows nearest the paddle' },
  { id: 2, name: 'Quench', fact: 'All balls at half speed for 3 s' },
  { id: 3, name: 'Fork', fact: 'Splits each ball into two' },
];

/** PLAN §4 The Forge: 6 items, 3 ranks. */
export const FORGE_ITEMS = [
  { id: 'lives', name: 'Start lives', fact: 'More lives at the start of each run', max: 3 },
  { id: 'heat', name: 'HEAT size', fact: 'Store more HEAT', max: 3 },
  { id: 'paddle', name: 'Paddle width', fact: 'Wider starting paddle', max: 3 },
  { id: 'ember', name: 'Ember value', fact: 'More embers saved for The Forge', max: 3 },
  { id: 'overload', name: 'Overload power', fact: 'Stronger effects; shorter HEAT cooldown', max: 3 },
  { id: 'ball', name: 'Ball types', fact: 'Unlock a choice of starting ball', max: 3 },
];
export const FORGE_PRICES = [60, 150, 320];

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
