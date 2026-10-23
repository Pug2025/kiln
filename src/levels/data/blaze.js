// Kiln: world 2, Blaze (levels 11-20). OWNER: B. Format: src/levels/FORMAT.md.
// The wall fights back: armour, sealed balls, march-down, gravity, the horizontal field, sentries.
// Every bottom-mode formation sits low: its lowest brick row lands on grid row 17 (edge y 630)
// unless LOW_ROW says otherwise (lead request from the owner's playtest; parser.js anchorLow).
// Sentries patrol the band between the wall and the paddle.

import { anchorLow, sprinkleCarriers } from '../parser.js';

const LOW_ROW = { 14: 17, 18: 16, 19: 16 };

/** Left-mode rows (24 columns × 18 rows; columns 0-3 stay empty for the paddle). */
function leftRows(pick) {
  const rows = [];
  for (let r = 0; r < 18; r++) {
    let line = '';
    for (let c = 0; c < 24; c++) line += c < 4 ? '.' : pick(r, c);
    rows.push(line);
  }
  return rows;
}

const LEVELS = [
  {
    // A hull in cross-section, keel toward the paddle: armour plates down both sides of the V and
    // at the keel, a soft seam between the keel plates, the molten engine room in the middle.
    // Laser carriers at the ends of the deck, open below.
    n: 11,
    id: 'hull-plating',
    name: 'Hull plating',
    world: 'blaze',
    kind: 'normal',
    mode: 'bottom',
    tier: 1,
    adds: 'Armour and Laser',
    hint: 'Armour takes 3 ball hits or 1 laser.',
    rows: [
      '?bbbbbbbbbb?',
      '.AbbbccbbbA.',
      '..AbbccbbA..',
      '...AbbbbA...',
      '....AaaA....',
    ],
    carriers: { '0,0': 'laser', '0,11': 'laser' },
    drops: { rate: 0.03, table: { laser: 3, wide: 2, multi: 2, slow: 1, fast: 1 } },
    rules: {},
  },
  {
    // A containment vessel: a tall diamond with two vaults at its waist, each holding a sealed
    // ball, and a molten core between them. Crack a shell next to a ball and it joins play.
    n: 12,
    id: 'containment',
    name: 'Containment',
    world: 'blaze',
    kind: 'normal',
    mode: 'bottom',
    tier: 1,
    adds: 'Sealed balls',
    hint: 'Opening a shell frees an extra ball and doubles the level score.',
    rows: [
      '.....bb.....',
      '....bbbb....',
      '...b2bb2b...',
      '..bCbccbCb..',
      '.bC*CccC*Cb.',
      '..bCbccbCb..',
      '...b2bb2b...',
      '....b22b....',
      '.....22.....',
    ],
    drops: { rate: 0.03, table: { wide: 2, multi: 1, laser: 2, slow: 1, shrink: 1, fast: 1 } },
    rules: {},
  },
  {
    // The first Mod pick. A stepped ziggurat of numbered racks: a molten crown on an armoured
    // plinth, 4-hit bricks in the upper rack (no explosives: their chain cut the racks to 26 s), a soft base with a carrier at each end and a lane up
    // each side.
    n: 13,
    id: 'loadout',
    name: 'Loadout',
    world: 'blaze',
    kind: 'normal',
    mode: 'bottom',
    tier: 1,
    pick: 'mod',
    gate: true,
    adds: 'Mod pick',
    hint: 'Choose 1 of 3 Mods. It lasts for this run.',
    rows: [
      '....cccc....',
      '....cAAc....',
      '..34444443..',
      '..33333333..',
      '..33333333..',
      '..22222222..',
      '.aaaaaaaaaa.',
      '.?bbbbbbbb?.',
    ],
    carriers: { '7,1': 'laser', '7,10': 'wide' },
    drops: { rate: 0.03, table: { wide: 2, multi: 2, laser: 2, fire: 1, catch: 1, shrink: 1, fast: 1 } },
    rules: {},
  },
  {
    // A short wall that grows: every 15 s it steps down a row and a new row enters on top.
    n: 14,
    id: 'compactor',
    doors: ['armoured+explosive', 'heavier+rich'],
    name: 'Compactor',
    world: 'blaze',
    kind: 'normal',
    mode: 'bottom',
    tier: 1,
    adds: 'Marching wall',
    hint: 'A new row pushes the wall down every 15 seconds.',
    rows: [
      '.aaaaaaaaaa.',
      '.bbb2bb2bbb.',
      '.bbbbbbbbbb.',
      '.aa2a22a2aa.',
    ],
    drops: { rate: 0.03, table: { wide: 2, slow: 3, multi: 2, laser: 1, fast: 1 } },
    rules: {
      marchMs: 15000,
      marchRows: ['bb.bbbbbb.bb', '.a2a.aa.a2a.', 'aaa.a??a.aaa', '.b.b.bb.b.b.'],
      marchFeed: 3,
    },
  },
  {
    // Bonus: multiball rain for 25 seconds into a funnel of numbered bricks with a molten spout.
    // Score only.
    n: 15,
    id: 'shrapnel',
    name: 'Shrapnel',
    world: 'blaze',
    kind: 'bonus',
    mode: 'bottom',
    tier: 1,
    gate: true,
    adds: 'Bonus: multiball rain',
    hint: 'A new ball falls every 1.5 seconds. Misses cost no lives.',
    rows: [
      '222222222222',
      '2a2a2a2a2a2a',
      '333333333333',
      '.a3a3333a3a.',
      '..33333333..',
      '...3a33a3...',
      '....2cc2....',
      '....2cc2....',
    ],
    drops: { rate: 0, table: {} },
    rules: { timerMs: 25000, noFail: true, rainMs: 1500 },
  },
  {
    // Towers of gravity bricks on narrow footings. Knock a footing out and the tower comes down.
    n: 16,
    id: 'stacks',
    doors: ['heavier+explosive', 'heavier+rich'],
    name: 'Stacks',
    world: 'blaze',
    kind: 'normal',
    mode: 'bottom',
    tier: 1,
    pick: 'mod',
    gate: true,
    adds: 'Gravity bricks',
    hint: 'Clamped bricks fall when their support breaks.',
    rows: [
      '............',
      'GG........GG',
      'GG..GGGG..GG',
      'GG..GGGG..GG',
      '33..G33G..33',
      '22..b22b..22',
      '............',
      '2a.a2..2a.a2',
      '2aa2a..a2aa2',
      'a.2.2..2.2.a',
      'aa.a2..2a.aa',
    ],
    drops: { rate: 0.03, table: { wide: 2, multi: 2, laser: 1, fire: 1, slow: 1, shrink: 1, fog: 1 } },
    rules: {},
  },
  {
    // The field turns: the paddle rides the left edge. 3 decks of bricks on the right.
    n: 17,
    id: 'broadside',
    doors: ['moving+explosive', 'armoured+rich'],
    name: 'Broadside',
    world: 'blaze',
    kind: 'normal',
    mode: 'left',
    tier: 1,
    gate: true,
    adds: 'Horizontal field',
    hint: 'The paddle moves up and down the left edge.',
    // (two columns nearer the paddle than at first: the far deck ends at x 630, leaving 90 units
    // between it and the far wall for A2's ceiling rule)
    rows: leftRows((r, c) => {
      if (c === 12) return r >= 3 && r <= 14 && r % 2 === 1 ? 'a' : '.';
      if (c === 15) return r >= 2 && r <= 15 ? (r === 5 || r === 12 ? '?' : 'b') : '.';
      if (c === 16) return r >= 2 && r <= 15 ? (r % 2 ? '2' : 'b') : '.';
      if (c === 19) return r >= 1 && r <= 16 ? 'b' : '.';
      if (c === 20) return r >= 1 && r <= 16 ? 'c' : '.';
      return '.';
    }),
    carriers: { '5,15': 'wide', '12,15': 'laser' },
    drops: { rate: 0.03, table: { wide: 2, multi: 2, laser: 2, slow: 1, fast: 1, shrink: 1 } },
    rules: {},
  },
  {
    // Sentries: two drifters and a bomber guard a gateway, an arch with a molten keystone.
    // Laser carriers at the feet of the arch.
    n: 18,
    id: 'sentries',
    doors: ['moving+explosive', 'armoured+rich'],
    name: 'Sentries',
    world: 'blaze',
    kind: 'normal',
    mode: 'bottom',
    tier: 2,
    gate: true,
    adds: 'Sentry drones',
    hint: 'Sentries take 2 hits; bombers 3. Lasers or perfect hits kill either.',
    rows: [
      '...bbccbb...',
      '..2bbccbb2..',
      '.2bb....bb2.',
      '.bb......bb.',
      '.bb......bb.',
      '?bb......bb?',
    ],
    sentries: [
      { kind: 'drifter', x: 150, y: 730 },
      { kind: 'drifter', x: 570, y: 730 },
      { kind: 'bomber', x: 360, y: 660, everyMs: 15000 },
    ],
    carriers: { '5,0': 'laser', '5,11': 'laser' },
    drops: { rate: 0.03, table: { laser: 3, wide: 2, multi: 1, slow: 1, shrink: 1, fast: 1 } },
    rules: {},
  },
  {
    // Smelter: two sliding rows of explosives, a fixed shelf between them, two drifters below.
    n: 19,
    id: 'smelter',
    doors: ['heavier+explosive', 'moving+rich'],
    name: 'Smelter',
    world: 'blaze',
    kind: 'normal',
    mode: 'bottom',
    tier: 2,
    pick: 'mod',
    adds: 'Moving explosives, sentries',
    hint: 'Explosions destroy sentries.',
    rows: [
      '.a2a2aa2a2a.',
      '3c3c3cc3c3c3',
      'b2b2b22b2b2b',
      '..bEbb.bEbb.',
      'aaaa....aaaa',
      '.E2E2..2E2E.',
      '3a3a....a3a3',
    ],
    motion: [
      { row: 3, speed: 55, dir: 1 },
      { row: 5, speed: 75, dir: -1 },
    ],
    sentries: [{ kind: 'drifter', x: 120, y: 730 }, { kind: 'drifter', x: 600, y: 730 }],
    drops: { rate: 0.03, table: { wide: 2, multi: 2, laser: 2, fire: 2, slow: 1, fast: 1, fog: 1 } },
    rules: {},
  },
  {
    // BOSS: a ring of titanium plates turns around a white-hot core. Get the ball through the
    // gap; at half health the ring reverses and speeds up, and slag spills out of the gap.
    n: 20,
    id: 'the-crucible',
    name: 'The Crucible',
    world: 'blaze',
    kind: 'boss',
    boss: 'crucible',
    mode: 'bottom',
    tier: 2,
    gate: true,
    adds: 'Boss: The Crucible',
    hint: 'The gap leads to the core. At half health, the ring reverses.',
    rows: [
      '............',
      'aa........aa',
      'bb..BBBB..bb',
      'bb.B....B.bb',
      'aa.B....B.aa',
      '..B......B..',
      '..B..WW..B..',
      '..B..WW..B..',
      '..B......B..',
      'aa.B....B.aa',
      'bb.B....B.bb',
      'bb..B..B..bb',
      'aa........aa',
      '?..........?',
    ],
    carriers: { '13,0': 'laser', '13,11': 'multi' },
    drops: { rate: 0.12, table: { wide: 2, multi: 2, laser: 1, slow: 2, catch: 1 } },
    rules: {},
  },
];

export default LEVELS.map((d) => sprinkleCarriers(anchorLow(d, LOW_ROW[d.n])));
