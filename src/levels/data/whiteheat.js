// Kiln: world 3, White Heat (levels 21-30). OWNER: B. Format: src/levels/FORMAT.md.
// Mastery: the ring field, Overloads, mazes, the scrolling Flue, portals, ghosts, the dark, and
// The Core in 3 chained stages (bottom → left → ring).
// Every bottom-mode formation sits low: its lowest brick row lands on grid row 17 (edge y 630)
// unless LOW_ROW says otherwise (lead request from the owner's playtest; parser.js anchorLow). The
// Flue (scrolling) already starts at the bottom; ring levels sit around the centre.

import { anchorLow, sprinkleCarriers } from '../parser.js';

const LOW_ROW = { 29: 16 };

/**
 * Ring-mode rows (16 × 16 cells of 30 × 30 around the ring centre). `pick` gets the cell's offset
 * from the centre (dx, dy), its distance d and bearing a (field coordinates, π/2 = the bottom) and
 * returns a legend character. Cells beyond radius 240 are always empty.
 */
function ringRows(pick) {
  const rows = [];
  for (let r = 0; r < 16; r++) {
    let line = '';
    for (let c = 0; c < 16; c++) {
      const dx = 30 * c - 225, dy = 30 * r - 225;
      const d = Math.hypot(dx, dy);
      line += d > 240 ? '.' : pick(dx, dy, d, Math.atan2(dy, dx));
    }
    rows.push(line);
  }
  return rows;
}

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

const near = (a, b, tol) => {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d < tol;
};

/** The Flue: 60 rows, read top to bottom; the bottom 20 (plus the 3-row band above) show first. */
const FLUE = [
  // cap: the top of the chimney
  '.cccccccccc.',
  '.c??cccc??c.',
  '.cccccccccc.',
  '.2222222222.',
  '.a.a.aa.a.a.',
  'AAAAAbbAAAAA',
  '3a3a3aa3a3a3',
  '.aaaaaaaaaa.',
  '.bEb....bEb.',
  '.bbbbbbbbbb.',
  // explosive galleries
  '...2....2...',
  '.E.2.EE.2.E.',
  '.b2bbbbbb2b.',
  'XXbbbbbbbbXX',
  '.aaaaEEaaaa.',
  '.a........a.',
  '.2aaaaaaaa2.',
  '.bbXXbbXXbb.',
  '.2b2b..b2b2.',
  '......?.....',
  // baffles: armour shelves from alternate sides with soft hatches
  '.2bbbbbbbb2.',
  'AAAAAAbbbbb.',
  '.a2aaaaaa2a.',
  '.bbbbbAAAAAA',
  '.aaa2aa2aaa.',
  'AAAAAAbbbbb.',
  '.c..c..c..c.',
  '.a2aaaaaa2a.',
  '.bbbbbAAAAAA',
  '.aaaaaaaaaa.',
  // carriers and molten pockets
  '.?........?.',
  '.ccbbbbbbcc.',
  '.c2c....c2c.',
  '.ccbbEEbbcc.',
  '.....bb.....',
  '.a.a.aa.a.a.',
  '.bb2bbbb2bb.',
  '..E......E..',
  '.2bbbbbbbb2.',
  '.2..2..2..2.',
  // the mouth: armour plates at the walls, numbered bricks in every band, wide gaps
  '.2bbbbbbbb2.',
  '.b..b..b..b.',
  '.a2aa22aa2a.',
  '...aa..aa...',
  '.bAbbbbbbAb.',
  '.?........?.',
  '.2aaaaaaaa2.',
  '.a.a.aa.a.a.',
  '.b2b2bb2b2b.',
  '..b.b..b.b..',
  '.aAaaaaaaAa.',
  '.....aa.....',
  '.a.aa..aa.a.',
  '.b2bbbbbb2b.',
  '..a.a..a.a..',
  '..a......a..',
  '...a2aa2a...',
  '.....bb.....',
  '....a..a....',
  '.a........a.',
];

const LEVELS = [
  {
    // The ring field: the paddle rides an arc around the centre. 3 rings round an explosive
    // reactor core (4-hit inside, 3 and plain in the middle, 2 and plain outside); the rings have
    // gaps. A new field starts a tier down (as Broadside did), so the ball is slower while the
    // paddle's new track is learned.
    n: 21,
    id: 'reactor',
    doors: ['heavier+explosive', 'armoured+rich'],
    name: 'Reactor',
    world: 'whiteheat',
    kind: 'normal',
    mode: 'ring',
    tier: 1,
    gate: true,
    adds: 'Ring field',
    hint: 'The paddle rides a ring around the core.',
    rows: ringRows((dx, dy, d, a) => {
      if (d < 30) return 'E';
      if (d >= 50 && d < 80) return '4';
      if (d >= 105 && d < 140) {
        if (near(a, 0, 0.25) || near(a, Math.PI, 0.25)) return '.';
        return Math.round((a + Math.PI) / 0.3) % 2 === 0 ? '3' : 'b';
      }
      if (d >= 170 && d < 205) {
        for (let k = 0; k < 4; k++) if (near(a, Math.PI / 4 + (k * Math.PI) / 2, 0.2)) return '.';
        if (near(a, Math.PI / 2, 0.08) || near(a, -Math.PI / 2, 0.08)) return '?';
        return Math.round((a + Math.PI) / 0.3) % 2 === 0 ? '2' : 'a';
      }
      return '.';
    }),
    drops: { rate: 0.03, table: { wide: 3, laser: 2, slow: 2, catch: 2, fire: 1, shrink: 1, fast: 1 } },
    rules: {},
  },
  {
    // The Overload pick. A tall wall in bands: a Purge clears the 3 rows nearest the paddle.
    n: 22,
    id: 'overload',
    doors: ['heavier+explosive', 'armoured+rich'],
    name: 'Overload',
    world: 'whiteheat',
    kind: 'normal',
    mode: 'bottom',
    tier: 2,
    pick: 'overload',
    gate: true,
    adds: 'Overload pick',
    hint: 'HEAT fires the Overload. It empties the meter.',
    rows: [
      '............',
      'cccccccccccc',
      'c3c3c3c3c3c3',
      'bbbbbbbbbbbb',
      'b2b2?bb?b2b2',
      'aaaaaaaaaaaa',
      'a2a2a2a2a2a2',
      'b2bbbbbbbb2b',
      'b?bbEbbEbb?b',
      'aaaaaaaaaaaa',
      '2a2a2a2a2a2a',
    ],
    drops: { rate: 0.03, table: { wide: 2, multi: 2, laser: 2, slow: 2, shrink: 1, fast: 1, fog: 1 } },
    rules: { overloads: true },
  },
  {
    // An indestructible maze: bulkheads with brick hatches. Thru carriers at the bottom.
    n: 23,
    id: 'bulkheads',
    doors: ['armoured+explosive', 'armoured+rich'],
    name: 'Bulkheads',
    world: 'whiteheat',
    kind: 'normal',
    mode: 'bottom',
    tier: 2,
    pick: 'mod',
    gate: true,
    adds: 'Thru and Mega',
    hint: 'Thru passes through bricks. Mega comes when five bricks hold out.',
    rows: [
      '............',
      '...aaaaaa...',
      'AXAAbbbbAAXA',
      'b2b2b2b2b2b2',
      'cccccccccccc',
      'bbbAAXXAAbbb',
      '.2a2a2a2a2a.',
      'a.?.a..a.?.a',
    ],
    carriers: { '7,2': 'thru', '7,9': 'thru' },
    drops: { rate: 0.03, table: { thru: 2, wide: 2, multi: 2, laser: 1, slow: 1, fast: 1, fog: 1 } },
    rules: {},
  },
  {
    // A chimney 60 rows tall. As the wall below is cleared the flue slides down and the next
    // section enters from above; anything that reaches the danger line burns off.
    n: 24,
    id: 'the-flue',
    doors: ['heavier+explosive', 'armoured+explosive'],
    name: 'The Flue',
    world: 'whiteheat',
    kind: 'normal',
    mode: 'bottom',
    tier: 2,
    adds: 'Scrolling flue',
    hint: 'The flue is 60 rows deep.',
    rows: FLUE,
    drops: { rate: 0.03, table: { wide: 2, multi: 2, laser: 2, thru: 1, slow: 1, fast: 1 } },
    rules: { scrollSpeed: 70 },
  },
  {
    // Bonus: Fever. Every brick hit splits the ball. 20 seconds, nothing to lose.
    n: 25,
    id: 'meltdown',
    name: 'Meltdown',
    world: 'whiteheat',
    kind: 'bonus',
    mode: 'bottom',
    tier: 2,
    gate: true,
    adds: 'Bonus: Fever',
    hint: 'Every hit splits the ball.',
    rows: [
      '............',
      'cccccccccccc',
      'c2c2c2c2c2c2',
      'bbbbbbbbbbbb',
      '2b2b2b2b2b2b',
      'cccccccccccc',
      'b3bb3bb3bb3b',
      '333333333333',
      '4a4a4a4a4a4a',
      '333333333333',
      'aaaaaaaaaaaa',
    ],
    drops: { rate: 0, table: {} },
    rules: { timerMs: 20000, noFail: true, fever: true },
  },
  {
    // Two vaults with a wormhole into each: the ball enters a ring in the open and leaves inside.
    // The outer rings sit at the side walls, under the vaults' black walls: never in line with
    // their twins and never between the paddle and a brick, so no straight lane loops through a
    // pair (paddle, ring, twin, roof, twin, ring, paddle).
    n: 26,
    id: 'wormholes',
    doors: ['heavier+explosive', 'armoured+explosive'],
    name: 'Wormholes',
    world: 'whiteheat',
    kind: 'normal',
    mode: 'bottom',
    tier: 2,
    pick: 'mod',
    gate: true,
    adds: 'Portal pairs',
    hint: 'A ball entering a ring leaves from its twin.',
    rows: [
      '............',
      'b2AA2bb2AA2b',
      'XcbcXbbXcbcX',
      'Xc)cXbbXc]cX',
      'XcbcXbbXcbcX',
      'XAAAXbbXAAAX',
      '....(..[....',
      '............',
      '............',
      'aa...aa...aa',
    ],
    drops: { rate: 0.03, table: { wide: 2, multi: 2, laser: 2, fire: 1, slow: 1, shrink: 1, fast: 1 } },
    rules: {},
  },
  {
    // A wide open field at a fast start, and two afterimages trailing the paddle.
    n: 27,
    id: 'afterimage',
    doors: ['moving+explosive', 'armoured+rich'],
    name: 'Afterimage',
    world: 'whiteheat',
    kind: 'normal',
    mode: 'bottom',
    tier: 3,
    gate: true,
    adds: 'Ghost paddles',
    hint: 'Two ghosts trail the paddle.',
    rows: [
      'c.c.c..c.c.c',
      '.3.3.33.3.3.',
      '............',
      '.2.b.bb.b.2.',
      '3.2.2..2.2.3',
      'a.2.?..?.2.a',
      '............',
      '..3..22..3..',
    ],
    carriers: { '5,4': 'wide', '5,7': 'catch' },
    drops: { rate: 0.03, table: { wide: 2, multi: 2, catch: 2, slow: 2, shrink: 1, fast: 1 } },
    rules: { ghosts: true },
  },
  {
    // The lights go out: only a lantern around the ball and the paddle. Explosives and armour hide
    // in the dark.
    n: 28,
    id: 'blackout',
    doors: ['heavier+explosive', 'armoured+rich'],
    name: 'Blackout',
    world: 'whiteheat',
    kind: 'normal',
    mode: 'bottom',
    tier: 2,
    gate: true,
    adds: 'Lights out',
    hint: 'Light reaches only the ball and the paddle.',
    rows: [
      '3b3b3bb3b3b3',
      'b2b2b2b2b2b2',
      '2b2b2bb2b2b2',
      '3b3b3bb3b3b3',
      '333333333333',
      'a3a3a3a3a3a3',
      'a3b3EbbE3b3a',
      '2Abbb??bbbA2',
      'a3b2bccb2b3a',
      '3a2a2aa2a2a3',
      'a2aa?aa?aa2a',
    ],
    carriers: { '7,5': 'laser', '7,6': 'multi', '10,4': 'wide', '10,7': 'catch' },
    drops: { rate: 0.03, table: { wide: 2, multi: 2, laser: 2, slow: 1, fog: 1, fast: 1 } },
    rules: { dark: true },
  },
  {
    // Everything at once: towers on a marching wall, a wormhole between the towers, sentries.
    n: 29,
    id: 'full-burn',
    doors: ['heavier+explosive', 'armoured+rich'],
    name: 'Full burn',
    world: 'whiteheat',
    kind: 'normal',
    mode: 'bottom',
    tier: 3,
    pick: 'mod',
    adds: 'Everything at once',
    hint: 'A new row every 12 seconds.',
    rows: [
      '............',
      '.GG......GG.',
      '.GG.(..).GG.',
      '.bb.2222.bb.',
      'bbbbEbbEbbbb',
      '2a2a2aa2a2a2',
      'a2a.a..a.a2a',
    ],
    sentries: [{ kind: 'drifter', x: 210, y: 730 }, { kind: 'bomber', x: 510, y: 670, everyMs: 20000 }],
    drops: { rate: 0.03, table: { wide: 2, multi: 1, laser: 2, slow: 2, catch: 1, shrink: 1, fast: 1, fog: 1 } },
    rules: { marchMs: 12000, marchRows: ['a2aa?aa?aa2a', '2b2b2bb2b2b2', '.c.c.cc.c.c.'], marchFeed: 3 },
  },
  {
    // FINAL BOSS, stage 1 of 3 (bottom field): the core behind a ring of armour with two gaps,
    // two drifters on guard. Then the field turns (stage 2) and closes into a ring (stage 3).
    n: 30,
    id: 'core-1',
    name: 'The Core',
    world: 'whiteheat',
    kind: 'boss',
    boss: 'core',
    mode: 'bottom',
    tier: 2,
    adds: 'Final boss: The Core',
    hint: '3 fields, 1 core.',
    continues: 'core-2',
    rows: [
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      'aa........aa',
      '....BBBB....',
      'a..B....B..a',
      'a.B......B.a',
      'b.B..WW..B.b',
      'b.B..WW..B.b',
      'a.B......B.a',
      'a..B....B..a',
      '....B..B....',
      '............',
      '?..........?',
    ],
    sentries: [{ kind: 'drifter', x: 150, y: 720 }, { kind: 'drifter', x: 570, y: 720, everyMs: 14000 }],
    carriers: { '17,0': 'laser', '17,11': 'fire' },
    drops: { rate: 0.12, table: { wide: 2, multi: 2, laser: 2, fire: 1, slow: 1 } },
    rules: {},
  },
  {
    // The Core, stage 2 (horizontal field): the core on the far side behind a turning ring;
    // bombers patrol behind it and bolts leave the gap when it faces the paddle.
    n: 30,
    id: 'core-2',
    name: 'The Core',
    world: 'whiteheat',
    kind: 'boss',
    boss: 'core',
    mode: 'left',
    tier: 2,
    stage: 2,
    continues: 'core-3',
    hint: 'The field turns.',
    // (kept at x 510: two columns nearer the paddle gave the far wall its full 120, but the
    // perfect robot then won the stage in one stay; the far wall stands 64 past the ring, inside
    // A2's horizontal rule)
    rows: leftRows((r, c) => {
      if ((c === 16 || c === 17) && (r === 8 || r === 9)) return 'W';
      const dx = 30 * c + 15 - 510, dy = 60 * r + 30 - 540;
      const d = Math.hypot(dx, dy);
      if (d > 100 && d < 150 && !(dx < -90 && Math.abs(dy) < 60)) return 'B';
      if (c === 9 && r >= 2 && r <= 15 && r !== 8 && r !== 9) return r % 3 === 0 ? '2' : 'a';
      if (c === 23 && (r === 2 || r === 15)) return 'S';
      if (c === 6 && (r === 1 || r === 16)) return '?';
      return '.';
    }),
    sentries: [{ kind: 'bomber', everyMs: 16000 }, { kind: 'bomber', everyMs: 16000 }],
    carriers: { '1,6': 'laser', '16,6': 'multi' },
    drops: { rate: 0.12, table: { wide: 2, multi: 2, laser: 2, slow: 1 } },
    rules: {},
  },
  {
    // The Core, stage 3 (ring field): two counter-rotating rings; their gaps line up every few
    // seconds. The heart fires bolts at the paddle. Every space between core, rings and wall is
    // wider than the ball (a ball wedged in a narrow annulus rattles there forever).
    n: 30,
    id: 'core-3',
    name: 'The Core',
    world: 'whiteheat',
    kind: 'boss',
    boss: 'core',
    mode: 'ring',
    tier: 2,
    stage: 3,
    hint: 'Two rings turn against each other.',
    rows: ringRows((dx, dy, d, a) => {
      if (d < 30) return 'W';
      const bottom = near(a, Math.PI / 2, 0.45);
      if (d >= 80 && d < 110) return bottom ? '.' : 'B';
      if (d >= 150 && d < 180) return bottom ? '.' : 'B';
      if (d >= 210 && d <= 240) return Math.round((a + Math.PI) / 0.35) % 2 === 0 ? 'a' : '.';
      return '.';
    }),
    drops: { rate: 0.12, table: { wide: 3, laser: 2, slow: 2, catch: 2, fire: 1 } },
    rules: {},
  },
];

export default LEVELS.map((d) => sprinkleCarriers(anchorLow(d, LOW_ROW[d.n])));
