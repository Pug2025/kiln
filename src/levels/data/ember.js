// Kiln: world 1, Ember (levels 1-10). OWNER: B. Format: src/levels/FORMAT.md.
// Rhythm: new → combine → mode → bonus → combine or boss (PLAN §3). Ember teaches the hands.
// Every bottom-mode formation sits low: its lowest brick row lands on grid row 17 (edge y 630)
// unless LOW_ROW says otherwise (lead request from the owner's playtest; parser.js anchorLow).

import { anchorLow, sprinkleCarriers } from '../parser.js';

const LOW_ROW = { 4: 18, 8: 16 };

const LEVELS = [
  {
    // A short burner flame: the exposed Wide carrier is the first taste of a real drop.
    // Only this carrier releases a power; embers from the other bricks still teach combo.
    n: 1,
    id: 'ignition',
    name: 'Ignition',
    world: 'ember',
    kind: 'normal',
    mode: 'bottom',
    tier: 0,
    adds: 'Embers and Wide',
    hint: 'Embers build combo. Wide drops widen the paddle.',
    rows: [
      '...aaaaaa...',
      '....bbbb....',
      '....cccc....',
      '.....?c.....',
    ],
    carriers: { '3,5': 'wide' },
    drops: { rate: 0, table: {} },
    rules: {},
  },
  {
    // A small diamond keeps the numbered-brick lesson while Multi opens it up quickly.
    // The one-hit carrier hangs below the heart: no numbered brick blocks the new power.
    n: 2,
    id: 'grid',
    name: 'Grid',
    world: 'ember',
    kind: 'normal',
    mode: 'bottom',
    tier: 0,
    adds: 'Numbered bricks and Multi',
    hint: 'Numbers show hits left. Multi drops split the ball.',
    rows: [
      '.....22.....',
      '....acca....',
      '...a2cc2a...',
      '....acca....',
      '.....?a.....',
    ],
    carriers: { '4,5': 'multi' },
    drops: { rate: 0, table: {} },
    rules: {},
  },
  {
    // Stalactites: every carrier hangs at a tip with open air below it, so drops fall clear.
    n: 3,
    id: 'supply-drop',
    name: 'Supply drop',
    world: 'ember',
    kind: 'normal',
    mode: 'bottom',
    tier: 0,
    adds: 'Good drops',
    hint: 'Wide, Slow and Multi.',
    rows: [
      'cccccccccccc',
      'aaaaaaaaaaaa',
      '2a2a2aa2a2a2',
      'bb.bbbbbb.bb',
      'b..b.bb.b..b',
      'b..?.bb.?..b',
      '?....bb....?',
      '.....??.....',
    ],
    carriers: { '5,3': 'slow', '5,8': 'wide', '6,0': 'multi', '6,11': 'wide', '7,5': 'multi', '7,6': 'slow' },
    drops: { rate: 0.03, table: { wide: 3, slow: 2, multi: 3 } },
    rules: {},
  },
  {
    // A keyhole: black cheeks hold the molten head; the neck is a door of two 2-hit bricks above
    // a wide foot. The head opens at the top and the bottom (a closed black ring left its corner
    // bricks for last: 99 s on one seed), and the sides stay open for the ball to climb.
    n: 4,
    id: 'blast-door',
    name: 'Blast door',
    world: 'ember',
    kind: 'normal',
    mode: 'bottom',
    tier: 0,
    adds: 'Indestructible bricks',
    hint: 'Black bricks never break.',
    rows: [
      '....bccb....',
      '...XbccbX...',
      '...XbbbbX...',
      '....bbbb....',
      '.....22.....',
      '....b22b....',
      '...bbbbbb...',
      '..b2b..b2b..',
      '.bbb.bb.bbb.',
    ],
    drops: { rate: 0.03, table: { wide: 3, slow: 2, multi: 2 } },
    rules: {},
  },
  {
    // Bonus: the KILN wordmark, 30 seconds, the ball is never lost. Two Multi carriers start it.
    n: 5,
    id: 'burn-off',
    name: 'Burn-off',
    world: 'ember',
    kind: 'bonus',
    mode: 'bottom',
    tier: 1,
    adds: 'Bonus: 30 seconds',
    hint: 'No ball is lost here.',
    rows: [
      'c...c..ccccc',
      'c..c.....c..',
      'c.c......c..',
      'cc.......c..',
      'c.c......c..',
      'c..c.....c..',
      'c...c..cc?cc',
      '............',
      'b......b...b',
      'b......bb..b',
      'b......bb..b',
      'b......b.b.b',
      'b......b..bb',
      'b......b..bb',
      'bb?bb..b...b',
    ],
    carriers: { '6,9': 'multi', '14,2': 'multi' },
    drops: { rate: 0.03, table: { multi: 3, wide: 2, fire: 1 } },
    rules: { timerMs: 30000, noFail: true },
  },
  {
    // Two diamonds and a vent, each wired to explosives. Fire drops hang at the diamond tips.
    n: 6,
    id: 'vents',
    name: 'Vents',
    world: 'ember',
    kind: 'normal',
    mode: 'bottom',
    tier: 0,
    adds: 'Explosives and Fire',
    hint: 'A blast breaks the 3 x 3 around it.',
    rows: [
      'cccc....cccc',
      '2222.22.2222',
      '..b......b..',
      '.bbb....bbb.',
      'bbEbb..bbEbb',
      '.bbb.aa.bbb.',
      '..?.aEEa.?..',
      '....aEEa....',
      '.....aa.....',
    ],
    carriers: { '6,2': 'fire', '6,9': 'wide' },
    drops: { rate: 0.03, table: { fire: 2, wide: 2, multi: 2, slow: 1 } },
    rules: {},
  },
  {
    // Sparse islands in the corners and the middle: steering and Pull reach them. The islands
    // sit in 9 rows (top edge y 360), not 11: a trip over the top stayed near 2 s (A2's ceiling).
    n: 7,
    id: 'outposts',
    name: 'Outposts',
    world: 'ember',
    kind: 'normal',
    mode: 'bottom',
    tier: 0,
    adds: 'Pull and HEAT',
    hint: 'Pull draws the ball toward the paddle and spends HEAT.',
    rows: [
      'cc........cc',
      'c..........c',
      '....b..b....',
      '...bb..bb...',
      'aa........aa',
      'a..........a',
      '............',
      '.....33.....',
      '.....22.....',
    ],
    drops: { rate: 0.03, table: { wide: 2, slow: 2, multi: 2, fire: 1 } },
    rules: { pull: true },
  },
  {
    // A chevron pointing away from the paddle, its mouth open toward it. Carriers line the inside
    // of the mouth with open air under each, a good and a bad one at every height: catch or dodge.
    n: 8,
    id: 'friend-or-foe',
    name: 'Friend or foe',
    world: 'ember',
    kind: 'normal',
    mode: 'bottom',
    tier: 1,
    adds: 'Bad drops and Catch',
    hint: 'Red glyphs are bad drops.',
    rows: [
      '....cccc....',
      '...b.cc.b...',
      '..bb.bb.bb..',
      '.bbbb??bbbb.',
      'bb.b?..?b.bb',
      'aaa?....?aaa',
      'a?........?a',
    ],
    carriers: {
      '3,5': 'wide', '3,6': 'shrink', '4,4': 'fast', '4,7': 'catch',
      '5,3': 'catch', '5,8': 'fog', '6,1': 'shrink', '6,10': 'slow',
    },
    drops: { rate: 0.03, table: { wide: 2, catch: 2, multi: 1, slow: 1, shrink: 2, fast: 2, fog: 1 } },
    rules: {},
  },
  {
    // Level 2's diamond (the Alleyway twist: a layout you know, now moving), one row wider at the
    // waist; a row above the heart and a row below it loop around the field in opposite
    // directions, so the diamond shears apart and closes again every 12 s.
    n: 9,
    id: 'conveyor',
    name: 'Conveyor',
    world: 'ember',
    kind: 'normal',
    mode: 'bottom',
    tier: 1,
    adds: 'Moving rows',
    hint: 'Two rows loop around the field.',
    rows: [
      '.....22.....',
      '....aaaa....',
      '...a2cc2a...',
      '..aa2cc2aa..',
      '...a2cc2a...',
      '....aaaa....',
      '.....aa.....',
    ],
    motion: [
      { row: 1, speed: 60, dir: 1, style: 'wrap' },
      { row: 5, speed: 60, dir: -1, style: 'wrap' },
    ],
    drops: { rate: 0.03, table: { wide: 2, slow: 2, multi: 2, catch: 1, shrink: 1 } },
    rules: {},
  },
  {
    // BOSS: a furnace head. Break the armoured jaw, hit the white-hot core five times (after the
    // first the jaw shuts behind every ball that scores, never on a timer); slag blobs fall
    // toward the paddle. Two carriers in the lower corners: Laser (one plate a bolt), Wide. No
    // Fire here: its splash broke 3 jaw plates a hit and the fight was over in 20 s.
    n: 10,
    id: 'the-stoker',
    name: 'The Stoker',
    world: 'ember',
    kind: 'boss',
    boss: 'stoker',
    mode: 'bottom',
    tier: 1,
    adds: 'Boss: The Stoker',
    hint: 'The core sits behind the armoured jaw.',
    rows: [
      '............',
      '..BBBBBBBB..',
      '.BBBBBBBBBB.',
      '.BB.BBBB.BB.',
      '.BBBBBBBBBB.',
      '.BB..WW..BB.',
      '.BBAAAAAABB.',
      '............',
      'bb........bb',
      '?b........b?',
    ],
    carriers: { '9,0': 'laser', '9,11': 'wide' },
    drops: { rate: 0.2, table: { wide: 2, multi: 2, laser: 1, slow: 1 } },
    rules: {},
  },
];

export default LEVELS.map((d) => sprinkleCarriers(anchorLow(d, LOW_ROW[d.n])));
