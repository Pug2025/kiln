// Test levels for A's mode tests (not campaign levels; B owns those).
// Left mode: 24 columns x 18 rows of 30 x 60 cells; the paddle side is column 0, keep columns 0-3 empty.
// Ring mode: 16 x 16 cells of 30 x 30 around (360, 540); only cells within radius 240 hold bricks.

const leftRows = [];
for (let r = 0; r < 18; r++) {
  let s = '';
  for (let c = 0; c < 24; c++) s += c >= 13 && c <= 18 && r >= 2 && r <= 15 ? (c % 2 ? 'a' : 'b') : '.';
  leftRows.push(s);
}

const ringRows = [];
for (let r = 0; r < 16; r++) {
  let s = '';
  for (let c = 0; c < 16; c++) {
    const x = 120 + (c + 0.5) * 30, y = 300 + (r + 0.5) * 30;
    const d = Math.hypot(x - 360, y - 540);
    s += d <= 150 && d >= 60 ? (d < 100 ? 'c' : 'a') : '.';
  }
  ringRows.push(s);
}

export const LEFT_TEST = {
  n: 97, id: 'test-left', name: 'Test left', world: 'blaze', kind: 'normal', mode: 'left', tier: 0,
  rows: leftRows, drops: { rate: 0, table: {} }, rules: {},
};

export const RING_TEST = {
  n: 98, id: 'test-ring', name: 'Test ring', world: 'whiteheat', kind: 'normal', mode: 'ring', tier: 0,
  rows: ringRows, drops: { rate: 0, table: {} }, rules: {},
};

/** A bottom level with an indestructible frame and a window: needs aiming. */
export const FRAME_TEST = {
  n: 96, id: 'test-frame', name: 'Test frame', world: 'ember', kind: 'normal', mode: 'bottom', tier: 0,
  rows: [
    '............',
    '............',
    '............',
    '............',
    '............',
    '............',
    '............',
    '............',
    '..XXXXXXXX..',
    '..XaaaaaaX..',
    '..XabbbbaX..',
    '..XaaaaaaX..',
    '..XXX..XXX..',
  ],
  drops: { rate: 0, table: {} },
  rules: { aimAt: 3 },
};
