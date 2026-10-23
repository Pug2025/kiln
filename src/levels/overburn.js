// Kiln: Overburn, endless procedural walls after level 30 (OWNER: B).
// Same LevelDef shape as the campaign (src/levels/FORMAT.md), seeded by the UTC day so every
// player gets the same walls on the same day. Each wave unlocks one new rule (RULES below) and
// mixes it with everything unlocked before; the wave whose rule is new always carries it (the
// wave card names it). Past the list the walls keep getting hotter (waveParams): more armour and
// black bricks, higher numbers, more moving rows and sentries, a faster march. Sideways and ring
// walls take the same numbers (sideways: sliding columns and drifters between paddle and wall;
// ring: 3 or 4 bands with their own gaps, drifters orbiting outside the bands).
// Every wave passes the same design checks as the campaign (checkLevel) and carries its new rule
// (rulePresent); a wave that fails is rebuilt from the next sub-seed, and a plain wall is the last
// resort, so a wave is always fair.

import { createRng } from '../core/rng.js';
import { RING } from '../core/constants.js';
import { checkLevel, anchorLow } from './parser.js';

/** One new rule per wave, in order (wave 1 = plain wall). Labels show on the wave card. */
export const RULES = Object.freeze([
  { id: 'plain', label: 'Plain wall' },
  { id: 'numbered', label: 'Numbered bricks' },
  { id: 'drops', label: 'Drop carriers' },
  { id: 'explosive', label: 'Explosives' },
  { id: 'armour', label: 'Armour' },
  { id: 'moving', label: 'Moving rows' },
  { id: 'indestructible', label: 'Black bricks' },
  { id: 'gravity', label: 'Gravity towers' },
  { id: 'sentries', label: 'Sentries' },
  { id: 'cavity', label: 'Sealed ball' },
  { id: 'portals', label: 'Portals' },
  { id: 'march', label: 'Marching wall' },
  { id: 'left', label: 'Horizontal field' },
  { id: 'ring', label: 'Ring field' },
  { id: 'dark', label: 'Lights out' },
  { id: 'ghosts', label: 'Ghost paddles' },
]);

const DROPS = Object.freeze({
  rate: 0.08,
  table: { wide: 3, multi: 3, slow: 2, fire: 2, laser: 2, catch: 1, thru: 1, life: 1, shrink: 1, fast: 1, fog: 1 },
});

const has = (wave, id) => RULES.findIndex((r) => r.id === id) < wave;

/** The rule this wave brings for the first time (null past the list). */
export function freshRule(wave) {
  return wave >= 1 && wave <= RULES.length ? RULES[wave - 1].id : null;
}

/**
 * The numbers that make a wave hotter. Every one only ever gets harder with the wave, and past
 * the rule list at least one of them rises every wave (b-overburn checks both).
 * @param {number} wave
 */
export function waveParams(wave) {
  const heat = Math.max(0, wave - RULES.length); // waves past the list
  return {
    tier: Math.min(5, 1 + Math.floor(wave / 4)),
    height: 5 + Math.min(7, wave >> 1),
    density: Math.min(0.9, 0.62 + wave * 0.015),
    digitMax: Math.min(6, 2 + (wave >> 3)),
    armour: Math.min(0.3, 0.07 + 0.01 * heat),
    black: Math.min(0.12, 0.05 + 0.004 * heat),
    movingRows: Math.min(3, 1 + Math.floor(heat / 5)),
    drifters: Math.min(3, 1 + Math.floor(heat / 6)),
    marchMs: Math.max(9000, 16000 - Math.max(0, wave - 12) * 400),
  };
}

/** True if a wave's wall actually carries rule `id` (the wave card names it). */
export function rulePresent(def, id) {
  const s = def.rows.join('');
  switch (id) {
    case 'plain': return /[abc]/.test(s);
    case 'numbered': return /[2-9]/.test(s);
    case 'drops': return /\?/.test(s) && def.drops.rate > 0;
    case 'explosive': return /E/.test(s);
    case 'armour': return /A/.test(s);
    case 'moving': return !!(def.motion && def.motion.length);
    case 'indestructible': return /X/.test(s);
    case 'gravity': return /G/.test(s);
    case 'sentries': return !!(def.sentries && def.sentries.length);
    case 'cavity': return /\*/.test(s);
    case 'portals': return /[([{]/.test(s);
    case 'march': return def.rules.marchMs > 0 && !!(def.rules.marchRows && def.rules.marchRows.length);
    case 'left': return def.mode === 'left';
    case 'ring': return def.mode === 'ring';
    case 'dark': return !!def.rules.dark;
    case 'ghosts': return !!def.rules.ghosts;
    default: return true;
  }
}

/** Mirror a bottom-mode half row (6 cells) into a full 12-cell row. */
function mirrorRow(half) {
  const swap = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{' };
  let right = '';
  for (let c = half.length - 1; c >= 0; c--) right += swap[half[c]] || half[c];
  return half + right;
}

/** Cells of a half grid holding a plain or numbered brick (r >= minRow), in reading order. */
function plainCells(grid, minRow = 0) {
  const out = [];
  for (let r = minRow; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) if (/[abc2-9]/.test(grid[r][c])) out.push([r, c]);
  return out;
}

/** A symmetric bottom-mode wall. */
function bottomWall(rng, wave) {
  const P = waveParams(wave);
  const fresh = freshRule(wave);
  const { height, density, digitMax } = P;
  const grid = [];
  // pick an outline: solid band, columns, diamond or stripes
  const outline = rng.int(0, 3);
  for (let r = 0; r < height; r++) {
    const half = [];
    for (let c = 0; c < 6; c++) {
      let on = rng.chance(density);
      if (outline === 1) on = on && (c % 3 !== 2 || r === 0);
      if (outline === 2) on = on && Math.abs(c - 5.5) <= 1.5 + Math.min(r, height - 1 - r) * 1.5;
      if (outline === 3) on = on && (r % 3 !== 2);
      let ch = '.';
      if (on) {
        ch = 'abc'[Math.min(2, Math.floor((r / height) * 3))];
        if (has(wave, 'numbered') && rng.chance(0.25)) ch = String(rng.int(2, digitMax));
        if (has(wave, 'armour') && rng.chance(P.armour)) ch = 'A';
        if (has(wave, 'explosive') && rng.chance(0.06)) ch = 'E';
        if (has(wave, 'drops') && rng.chance(1 / 7)) ch = '?';
        if (has(wave, 'indestructible') && rng.chance(P.black) && r > 0) ch = 'X';
      }
      half.push(ch);
    }
    grid.push(half);
  }
  // the wave whose brick is new always shows it (one cell at least, mirrored to two)
  const NEW_BRICK = { numbered: /[2-9]/, drops: /\?/, explosive: /E/, armour: /A/, indestructible: /X/ };
  if (NEW_BRICK[fresh] && !grid.some((h) => NEW_BRICK[fresh].test(h.join('')))) {
    const cells = plainCells(grid, fresh === 'indestructible' ? 1 : 0);
    if (cells.length) {
      const [r, c] = cells[rng.int(0, cells.length - 1)];
      const ch = { numbered: String(rng.int(2, digitMax)), drops: '?', explosive: 'E', armour: 'A', indestructible: 'X' };
      grid[r][c] = ch[fresh];
    }
  }
  // gravity towers: G stacked on solid cells, built bottom-up (every column tried on the wave
  // that brings them)
  if (has(wave, 'gravity')) {
    const first = rng.int(0, 4);
    const tries = fresh === 'gravity' ? 5 : 1;
    for (let k = 0; k < tries; k++) {
      const col = (first + k) % 5;
      let placed = 0;
      for (let r = height - 2; r >= 0; r--) {
        if (grid[r + 1][col] !== '.' && grid[r + 1][col] !== 'X' && (fresh === 'gravity' || rng.chance(0.75))) {
          grid[r][col] = 'G';
          placed++;
        } else if (grid[r][col] === 'G') break;
      }
      if (placed) break;
    }
  }
  // a sealed ball in the middle: C C C C / C * * C / C C C C over columns 4-7
  if (has(wave, 'cavity') && height >= 5 && (fresh === 'cavity' || rng.chance(0.7))) {
    const r0 = rng.int(1, height - 4);
    for (let r = r0; r < r0 + 3; r++) for (let c = 4; c < 6; c++) grid[r][c] = 'C';
    grid[r0 + 1][5] = '*';
  }
  // a portal pair, one on each side (mirroring puts the twin in the same row: never one lane)
  if (has(wave, 'portals') && (fresh === 'portals' || rng.chance(0.8))) {
    const r = rng.int(1, height - 2);
    grid[r][rng.int(0, 2)] = '(';
  }
  let rows = grid.map((h) => mirrorRow(h.join('')));
  // gravity bricks need a floor; drop any that lost it (a mirrored X or an empty cell)
  rows = fixGravity(rows);
  return rows;
}

function fixGravity(rows) {
  const out = rows.map((r) => r.split(''));
  for (let r = out.length - 1; r >= 0; r--) {
    for (let c = 0; c < out[r].length; c++) {
      if (out[r][c] !== 'G') continue;
      const below = r + 1 < out.length ? out[r + 1][c] : '.';
      if (below === '.' || below === '(' || below === ')' || below === '*') out[r][c] = 'a';
    }
  }
  return out.map((r) => r.join(''));
}

/** Break facing indestructible pairs and seal leaks: X that would face another X becomes armour. */
function fixTraps(rows) {
  const out = rows.map((r) => r.split(''));
  const solid = (ch) => ch !== '.' && ch !== '(' && ch !== ')' && ch !== '*' && ch !== 'S';
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 0; r < out.length; r++) {
      let last = -1;
      for (let c = 0; c < out[r].length; c++) {
        if (out[r][c] === 'X') {
          if (last >= 0 && c - last > 1) out[r][c] = 'A';
          else last = c;
        } else if (solid(out[r][c])) last = -1;
      }
    }
    for (let c = 0; c < out[0].length; c++) {
      let last = -1;
      for (let r = 0; r < out.length; r++) {
        if (out[r][c] === 'X') {
          if (last >= 0 && r - last > 1) out[r][c] = 'A';
          else last = r;
        } else if (solid(out[r][c])) last = -1;
      }
    }
  }
  return out.map((r) => r.join(''));
}

/** A cell's brick for the sideways and ring walls: the same mix and the same ramp as bottomBrick. */
function mixBrick(rng, wave, P, base, blackOk) {
  let ch = base;
  if (rng.chance(0.25)) ch = String(rng.int(2, P.digitMax));
  if (has(wave, 'armour') && rng.chance(P.armour)) ch = 'A';
  if (has(wave, 'explosive') && rng.chance(0.05)) ch = 'E';
  if (has(wave, 'drops') && rng.chance(1 / 7)) ch = '?';
  if (blackOk && has(wave, 'indestructible') && rng.chance(P.black)) ch = 'X';
  return ch;
}

/**
 * Left mode: a formation in columns 12-21 (nearest edge x 360, far edge at most x 660, so the far
 * wall keeps 60 clear), mirrored top to bottom. Outline: a solid band, ribs, or a wedge pointing
 * at the paddle. Bricks take waveParams like the bottom walls (numbers, armour, black bricks).
 */
function leftWall(rng, wave) {
  const P = waveParams(wave);
  const width = Math.max(3, 4 + Math.min(6, wave >> 2) - rng.int(0, 1));
  const outline = rng.int(0, 2);
  const half = [];
  for (let r = 0; r < 9; r++) {
    let line = '';
    for (let c = 0; c < 24; c++) {
      const k = c - 12;
      let ch = '.';
      let on = k >= 0 && k < width && rng.chance(P.density);
      if (outline === 1) on = on && (k % 3 !== 2 || r === 8);
      if (outline === 2) on = on && k >= Math.floor((8 - r) / 3);
      if (on) ch = mixBrick(rng, wave, P, 'abc'[Math.min(2, Math.floor((k / width) * 3))], k > 0 && k < width - 1);
      line += ch;
    }
    half.push(line);
  }
  const rows = [...half, ...half.slice().reverse()];
  // the nearest column must reach x <= 440: make sure column 12 holds something
  if (!rows.some((l) => l[12] !== '.')) rows[8] = rows[8].slice(0, 12) + 'b' + rows[8].slice(13);
  return fixTraps(rows);
}

/** Columns of a left-mode wall that can slide along y (bricks and room, nothing fixed). */
function laneCols(rows) {
  const out = [];
  for (let c = 12; c < rows[0].length; c++) {
    const col = rows.map((l) => l[c]).join('');
    const bricks = col.replace(/\./g, '').length;
    if (bricks >= 2 && col.length - bricks >= 2 && /^[.abc2-9AE?]+$/.test(col)) out.push(c);
  }
  return out;
}

/** Ring band layouts (cell-centre distance ranges); the last keeps r 220+ free for sentries. */
const RING_BANDS = Object.freeze([
  [[50, 80], [105, 135], [160, 190], [205, 235]],
  [[50, 80], [120, 150], [190, 225]],
  [[50, 80], [105, 135], [160, 190]],
]);
/** Ring sentries orbit here (their patrol kept narrow so they never touch a band or the paddle). */
const RING_SENTRY = Object.freeze({ r: 252, across: 12 });

/**
 * Ring mode: 3 or 4 bands round an explosive (or 3-hit) heart, each band with one or two gaps of
 * its own width. Bricks take waveParams like the bottom walls. `roomForSentries` keeps the
 * outer ring free.
 */
function ringWall(rng, wave, roomForSentries) {
  const P = waveParams(wave);
  const bands = roomForSentries ? RING_BANDS[2] : RING_BANDS[rng.int(0, 1)];
  const chars = bands.map(() => 'abc'[rng.int(0, 2)]);
  const gaps = bands.map(() => {
    const a = rng.range(0, Math.PI * 2);
    const w = rng.range(0.3, 0.45);
    return rng.chance(0.4) ? [[a, w], [a + Math.PI + rng.range(-0.5, 0.5), w]] : [[a, w]];
  });
  const heart = rng.chance(0.7) ? 'E' : '3';
  const rows = [];
  for (let r = 0; r < 16; r++) {
    let line = '';
    for (let c = 0; c < 16; c++) {
      const dx = 30 * c - 225, dy = 30 * r - 225;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      let ch = '.';
      if (d < 30) ch = heart;
      else if (d <= 240) {
        for (let k = 0; k < bands.length; k++) {
          if (d < bands[k][0] || d >= bands[k][1]) continue;
          let gap = false;
          for (const [g, w] of gaps[k]) {
            let off = Math.abs(a - g) % (Math.PI * 2);
            if (off > Math.PI) off = Math.PI * 2 - off;
            if (off < w) gap = true;
          }
          if (!gap) ch = mixBrick(rng, wave, P, chars[k], k > 0 && k < bands.length - 1);
          break;
        }
      }
      line += ch;
    }
    rows.push(line);
  }
  return rows;
}

function laneRows(rows) {
  const out = [];
  rows.forEach((line, r) => {
    const bricks = line.replace(/\./g, '').length;
    if (bricks >= 2 && line.length - bricks >= 2 && /^[.abc2-9AE?]+$/.test(line)) {
      if (!(r > 0 && rows[r - 1].includes('G')) && !(r + 1 < rows.length && rows[r + 1].includes('G'))) out.push(r);
    }
  });
  return out;
}

/** The drop table for a mode: ring fields carry no Multi (balls leave on every side). */
function dropTable(mode) {
  const t = { ...DROPS.table };
  if (mode === 'ring') delete t.multi;
  return t;
}

/** One attempt at a wave; may fail the checks (the caller retries). */
function buildWave(rng, wave) {
  const P = waveParams(wave);
  const n = 30 + wave;
  const fresh = freshRule(wave);
  let mode = 'bottom';
  if (wave === 13 || (has(wave, 'left') && wave > 13 && rng.chance(0.15))) mode = 'left';
  if (wave === 14 || (has(wave, 'ring') && wave > 14 && rng.chance(0.15))) mode = 'ring';
  // sentries come to the sideways and ring walls too (the bottom walls decide below)
  const sentries = mode !== 'bottom' && has(wave, 'sentries') && rng.chance(0.4);
  const def = {
    n,
    id: `overburn-${wave}`,
    name: `Overburn ${wave}`,
    world: 'overburn',
    kind: 'normal',
    mode,
    tier: P.tier,
    adds: fresh ? RULES[wave - 1].label : 'Harder wall',
    rows: mode === 'left' ? leftWall(rng, wave) : mode === 'ring' ? ringWall(rng, wave, sentries) : fixTraps(bottomWall(rng, wave)),
    drops: { rate: has(wave, 'drops') ? DROPS.rate : 0, table: dropTable(mode) },
    rules: { pull: true, overloads: true },
  };
  if (mode === 'bottom') {
    if (has(wave, 'moving') && fresh !== 'march' && rng.chance(fresh === 'moving' ? 1 : 0.5)) {
      const lanes = laneRows(def.rows);
      const motion = [];
      for (let k = 0; k < P.movingRows && lanes.length; k++) {
        const r = lanes.splice(rng.int(0, lanes.length - 1), 1)[0];
        motion.push({ row: r, speed: rng.range(55, 90), dir: rng.sign(), style: rng.chance(0.3) ? 'wrap' : 'bounce' });
      }
      if (motion.length) def.motion = motion.sort((p, q) => p.row - q.row);
    }
    if (has(wave, 'march') && !def.motion && rng.chance(fresh === 'march' ? 1 : 0.4)) {
      let feed = def.rows.filter((l) => /^[.abc2-9]+$/.test(l) && /[^.]/.test(l));
      // no clean row to repeat: feed plain copies of the wall's own rows
      if (!feed.length) feed = def.rows.map((l) => l.replace(/[^.abc2-9]/g, 'b')).filter((l) => /[^.]/.test(l));
      if (feed.length) {
        def.rules.marchMs = P.marchMs;
        def.rules.marchRows = feed.slice(0, 3);
        def.rules.marchFeed = 4 + Math.min(6, wave >> 2);
      }
    }
    if (has(wave, 'sentries') && rng.chance(fresh === 'sentries' ? 1 : 0.4)) {
      def.sentries = [];
      for (let k = 0; k < P.drifters; k++) def.sentries.push({ kind: 'drifter', x: rng.range(120, 600), y: 730 });
      if (wave >= 12 && rng.chance(0.5)) def.sentries.push({ kind: 'bomber', x: 360, y: 670, everyMs: 15000 });
    }
  }
  if (mode === 'left') {
    // columns slide along the paddle's track, as many as a bottom wave's moving rows
    if (has(wave, 'moving') && rng.chance(0.5)) {
      const lanes = laneCols(def.rows);
      const motion = [];
      for (let k = 0; k < P.movingRows && lanes.length; k++) {
        const c = lanes.splice(rng.int(0, lanes.length - 1), 1)[0];
        motion.push({ col: c, speed: rng.range(55, 90), dir: rng.sign(), style: rng.chance(0.3) ? 'wrap' : 'bounce' });
      }
      if (motion.length) def.motion = motion.sort((p, q) => p.col - q.col);
    }
    if (sentries) {
      // between the paddle and the wall (the nearest column starts at x 360)
      def.sentries = [];
      for (let k = 0; k < P.drifters; k++) def.sentries.push({ kind: 'drifter', x: rng.range(230, 290), y: rng.range(160, 920) });
      if (wave >= 20 && rng.chance(0.4)) def.sentries.push({ kind: 'bomber', x: 300, y: 540, everyMs: 15000 });
    }
  }
  if (mode === 'ring' && sentries) {
    def.sentries = [];
    const a0 = rng.range(0, Math.PI * 2);
    for (let k = 0; k < P.drifters; k++) {
      const a = a0 + (k * 2 * Math.PI) / P.drifters;
      def.sentries.push({ kind: 'drifter', x: RING.CX + Math.cos(a) * RING_SENTRY.r, y: RING.CY + Math.sin(a) * RING_SENTRY.r, across: RING_SENTRY.across });
    }
  }
  if (has(wave, 'dark') && (fresh === 'dark' || rng.chance(0.2))) def.rules.dark = true;
  if (has(wave, 'ghosts') && (fresh === 'ghosts' || rng.chance(0.2))) def.rules.ghosts = true;
  return anchorLow(def);
}

/** The fallback that always passes: a plain mirrored wall. */
function plainWave(wave) {
  return anchorLow({
    n: 30 + wave,
    id: `overburn-${wave}`,
    name: `Overburn ${wave}`,
    world: 'overburn',
    kind: 'normal',
    mode: 'bottom',
    tier: waveParams(wave).tier,
    adds: 'Plain wall',
    rows: ['aaaaaaaaaaaa', 'b2b2b2b2b2b2', 'bbbbbbbbbbbb', 'c?cccccccc?c', 'aaaaaaaaaaaa'],
    drops: { rate: DROPS.rate, table: { ...DROPS.table } },
    rules: { pull: true, overloads: true },
  });
}

/**
 * Build Overburn wave `wave` (1-based) for a seed. Same seed and wave, same wall. The seed is
 * required (the caller passes dailySeed()): level logic never reads the clock.
 * @param {number} seed   usually dailySeed() from the app
 * @param {number} wave   1, 2, 3 …
 * @returns {import('../core/types.js').LevelDef}
 */
export function generateOverburn(seed, wave = 1) {
  if (!Number.isFinite(seed)) throw new Error('generateOverburn: pass the seed (dailySeed() in the app)');
  const w = Math.max(1, wave | 0);
  const fresh = freshRule(w);
  const root = createRng(seed).fork(`wave-${w}`);
  for (let attempt = 0; attempt < 32; attempt++) {
    const def = buildWave(root.fork(`try-${attempt}`), w);
    if ((!fresh || rulePresent(def, fresh)) && checkLevel(def).length === 0) return def;
  }
  return plainWave(w);
}
