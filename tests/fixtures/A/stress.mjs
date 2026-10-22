// A heavy field that never clears, for the performance test: an armour shell around 9-hit
// numbered bricks and explosives, a moving row, and one numbered brick sealed in an
// indestructible box at the top so `remaining` never reaches 0. The test keeps multiball topped
// up and plays it with the real systems for as long as it asks.

const rows = [
  'XXXXXXXXXXXX',
  'X9999X9X999X', // the 9 in column 6 is sealed: X above, left, right and below
  'X9E99XXX99EX',
];
for (let r = 3; r < 20; r++) {
  if (r === 19) rows.push('............');
  else if (r % 4 === 2) rows.push('X9E99999E99X');
  else if (r % 4 === 0) rows.push('X99X9999X99X');
  else rows.push('X9999999999X');
}

export const STRESS = {
  n: 95, id: 'stress', name: 'Stress', world: 'ember', kind: 'normal', mode: 'bottom', tier: 3,
  rows,
  motion: [{ row: 18, speed: 60, dir: 1 }],
  drops: { rate: 0.2, table: { multi: 4, wide: 1, laser: 1 } },
  rules: { pull: true },
};

/** Count the bricks a level parses into (to pick the heaviest real level). */
export function brickCount(parseLevel, def) {
  try {
    return parseLevel(def).bricks.length;
  } catch {
    return 0;
  }
}
