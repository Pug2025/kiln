// Kiln: level parser and level checks (OWNER: B). Pure: LevelDef in, ParsedLevel out.
// No DOM, no randomness, no clock.
//
// parseLevel(def) throws on anything the game cannot load (bad row length, unknown character,
// too many rows, a brick outside the ring, unpaired portals, boss cells outside a boss level,
// an open cavity). checkLevel(def) returns a list of design problems the tests reject (loop traps,
// portal twins in one lane, unreachable bricks, unsupported gravity bricks, names, labels).
// Full format: FORMAT.md.

import { GRID, BF, BRICK, DROP_NAMES, LAST_BRICKS, FIELD } from '../core/constants.js';
import { LEGEND, PORTAL_PAIRS } from './legend.js';
import { defaultRules } from '../core/world.js';

const CLOSERS = Object.freeze(Object.fromEntries(Object.entries(PORTAL_PAIRS).map(([o, c]) => [c, o])));
const SENTRY_KINDS = Object.freeze(['drifter', 'bomber']);
const BOSS_IDS = Object.freeze(['stoker', 'crucible', 'core']);
const LOADED_MATERIALS = Object.freeze(['2', '3', '4', 'A']);
const LOADED_POWERS = Object.freeze(['laser', 'multi', 'fire', 'wide', 'catch', 'slow', 'life']);

/**
 * Scrolling levels (The Flue): a row joins play once its top edge reaches this line; rows above it
 * wait hidden (A2's request: the visible stack starts with its top edge between y 150 and 210, so
 * the ceiling sits above it and no row is cut by the field top). content sets level.entryY to it.
 */
export const SCROLL_ENTRY_Y = 150;

/** Hidden rows of a scrolling bottom level: rows above the visible 20 start above the field. */
export function extraRows(def) {
  const mode = def.mode || 'bottom';
  if (mode !== 'bottom') return 0;
  return Math.max(0, def.rows.length - GRID.bottom.rows);
}

/** Centre of a cell in field units. */
export function cellCentre(grid, col, row, extra = 0) {
  return {
    x: grid.x0 + (col + 0.5) * grid.cw,
    y: grid.y0 + (row - extra + 0.5) * grid.ch,
  };
}

/**
 * Level rules with campaign defaults filled in by level number (only where the level is silent):
 * Pull from 7, aim line at 3 bricks from 4, Overloads from 22, Mega rescue from 23.
 * @param {import('../core/types.js').LevelDef} def
 * @returns {import('../core/types.js').LevelRules}
 */
export function rulesFor(def) {
  const n = def.n | 0;
  const given = def.rules || {};
  const base = {};
  if (n >= 7) base.pull = true;
  if (n >= 4) base.aimAt = LAST_BRICKS.AT;
  if (n >= 22) base.overloads = true;
  if (n >= 23) base.megaRescue = true;
  const rules = defaultRules({ ...base, ...given });
  if (rules.pull || rules.overloads) rules.heat = true;
  if (def.kind === 'bonus' && given.noFail === undefined) rules.noFail = true;
  return rules;
}

/** Formation anchoring (lead request 2026-10-21, the owner's playtest): the wall sits near the paddle. */
export const ANCHOR = Object.freeze({
  BOTTOM_MIN_Y: 600,   // bottom mode: the lowest brick's bottom edge at level start is at y >= 600
  LEFT_MAX_X: 440,     // left mode: the nearest brick column's paddle-side edge is at x <= 440
  ROW: 17,             // anchorLow's default: the formation's lowest row lands on grid row 17 (edge y 630)
});

const isBrickChar = (ch) => !!LEGEND[ch] && LEGEND[ch].type !== BRICK.EMPTY;

/**
 * Move a bottom-mode formation down so its lowest brick row lands on grid row `lowest`:
 * trailing empty rows are dropped and empty rows are added above, never below. Carrier keys and
 * motion rows move with it. Other modes (and scrolling levels) come back unchanged.
 * @param {import('../core/types.js').LevelDef} def
 * @param {number} [lowest] grid row 16-19 (edge y 600-690)
 * @returns {import('../core/types.js').LevelDef}
 */
export function anchorLow(def, lowest = ANCHOR.ROW) {
  if ((def.mode || 'bottom') !== 'bottom' || def.rows.length > GRID.bottom.rows) return def;
  let last = def.rows.length - 1;
  while (last >= 0 && ![...def.rows[last]].some(isBrickChar)) last--;
  const kept = def.rows.slice(0, last + 1);
  const pad = Math.max(0, Math.min(GRID.bottom.rows - kept.length, lowest - last));
  const empty = '.'.repeat(GRID.bottom.cols);
  const out = { ...def, rows: [...Array(pad).fill(empty), ...kept] };
  for (const field of ['carriers', 'loaded']) {
    if (!def[field]) continue;
    out[field] = {};
    for (const [key, value] of Object.entries(def[field])) {
      const [r, c] = key.split(',').map(Number);
      out[field][`${r + pad},${c}`] = value;
    }
  }
  if (def.motion) out.motion = def.motion.map((m) => ({ ...m, row: m.row + pad }));
  return out;
}

/** Carriers: about one breakable brick in CARRIER_EVERY carries a drop on levels with drops (PLAN §4). */
export const CARRIER_EVERY = 7;

/**
 * Turn plain bricks into random carriers ('?', kind rolled from the level's drop table) until
 * about one breakable brick in seven is a carrier. Picks are spread evenly over the plain bricks,
 * counted from the row nearest the paddle, so drops fall clear. Molten `c` bricks are the figure's
 * focal cluster (ART.md 15.7) and are picked only when a level has too few `a`/`b` bricks. Levels
 * without drops (no table and no rate), bonus levels and fixed layouts that already reach the share
 * come back unchanged.
 * @param {import('../core/types.js').LevelDef} def
 * @returns {import('../core/types.js').LevelDef}
 */
export function sprinkleCarriers(def, every = CARRIER_EVERY) {
  const drops = def.drops || {};
  const hasDrops = (drops.rate || 0) > 0 || Object.keys(drops.table || {}).length > 0;
  if (!hasDrops || def.kind === 'bonus') return def;
  const cells = [];
  const molten = [];
  let breakable = 0, carriers = 0;
  for (let r = def.rows.length - 1; r >= 0; r--) {
    for (let c = 0; c < def.rows[r].length; c++) {
      const ch = def.rows[r][c];
      const e = LEGEND[ch];
      if (!e || !(e.flags & BF.BREAKABLE) || (e.flags & BF.BOSS)) continue;
      breakable++;
      if (ch === '?') carriers++;
      if (ch === 'a' || ch === 'b') cells.push([r, c]);
      else if (ch === 'c') molten.push([r, c]);
    }
  }
  const want = Math.round(breakable / every) - carriers;
  if (cells.length < want) cells.push(...molten);
  const need = Math.min(cells.length, want);
  if (need <= 0) return def;
  const rows = def.rows.map((line) => line.split(''));
  const step = cells.length / need;
  for (let k = 0; k < need; k++) {
    const [r, c] = cells[Math.min(cells.length - 1, Math.floor(k * step + step / 2))];
    rows[r][c] = '?';
  }
  return { ...def, rows: rows.map((line) => line.join('')) };
}

/**
 * The anchoring rule, judged at the start position. Empty string when the level keeps it.
 * @param {import('../core/types.js').ParsedLevel} parsed
 */
export function anchorProblem(parsed) {
  const mode = parsed.def.mode || 'bottom';
  const visible = parsed.bricks.filter((b) => !(b.flags & BF.HIDDEN) && !(b.flags & (BF.PORTAL | BF.CAVITY_BALL)));
  if (!visible.length || mode === 'ring') return '';
  if (mode === 'bottom') {
    const lowest = Math.max(...visible.map((b) => b.y + b.h / 2));
    return lowest >= ANCHOR.BOTTOM_MIN_Y ? '' : `lowest brick edge at y ${lowest} (< ${ANCHOR.BOTTOM_MIN_Y}): anchor the formation low`;
  }
  const nearest = Math.min(...visible.map((b) => b.x - b.w / 2));
  return nearest <= ANCHOR.LEFT_MAX_X ? '' : `nearest brick edge at x ${nearest} (> ${ANCHOR.LEFT_MAX_X}): bring the formation toward the paddle`;
}

function fail(def, msg) {
  throw new Error(`level ${def.n}${def.id ? ` (${def.id})` : ''}: ${msg}`);
}

/**
 * @param {import('../core/types.js').LevelDef} def
 * @returns {import('../core/types.js').ParsedLevel}
 */
export function parseLevel(def) {
  const mode = def.mode || 'bottom';
  const grid = GRID[mode];
  if (!grid) fail(def, `unknown mode "${mode}"`);
  if (!Array.isArray(def.rows) || def.rows.length === 0) fail(def, 'rows missing');
  if (def.rows.length > grid.maxRows) fail(def, `${def.rows.length} rows > ${grid.maxRows}`);
  if (mode !== 'bottom' && def.rows.length !== grid.rows) fail(def, `${mode} mode needs exactly ${grid.rows} rows, got ${def.rows.length}`);
  const kind = def.kind || 'normal';
  const isBoss = kind === 'boss';
  if (isBoss && !BOSS_IDS.includes(def.boss)) fail(def, `boss level needs boss: ${BOSS_IDS.join('|')}`);
  for (const [key, material] of Object.entries(def.loaded || {})) {
    const cell = /^(0|[1-9]\d*),(0|[1-9]\d*)$/.exec(key);
    if (!cell || def.rows[Number(cell[1])]?.[Number(cell[2])] !== '?') fail(def, `loaded["${key}"] is not a "?" cell`);
    if (!LOADED_MATERIALS.includes(material)) fail(def, `loaded["${key}"]: material must be ${LOADED_MATERIALS.join('|')}`);
    if (!LOADED_POWERS.includes(def.carriers?.[key])) fail(def, `loaded["${key}"] needs a fixed good drop (${LOADED_POWERS.join('|')})`);
  }

  const rules = rulesFor(def);
  if (rules.marchMs > 0 && mode !== 'bottom') fail(def, 'march-down is bottom mode only');
  if (rules.scrollSpeed > 0 && mode !== 'bottom') fail(def, 'scrolling is bottom mode only');
  if (rules.marchMs > 0) {
    if (!Array.isArray(rules.marchRows) || rules.marchRows.length === 0) fail(def, 'marchMs needs marchRows');
    for (const line of rules.marchRows) {
      if (typeof line !== 'string' || line.length !== grid.cols) fail(def, `march row "${line}" must be ${grid.cols} characters`);
      for (const ch of line) {
        const e = LEGEND[ch];
        if (!e) fail(def, `march row: unknown character "${ch}"`);
        if (ch === '*' || ch === 'C' || ch === 'S' || ch === 'B' || ch === 'W' || ch === 'G' || ch in PORTAL_PAIRS || ch in CLOSERS) {
          fail(def, `march row: "${ch}" cannot march in`);
        }
      }
    }
  }

  /** @type {import('../core/types.js').ParsedBrick[]} */
  const bricks = [];
  const sCells = [];
  const warnings = [];
  const portalOpen = {};
  const portalClose = {};
  const extra = extraRows(def);
  const R2 = grid.rMax ? grid.rMax * grid.rMax : 0;

  for (let row = 0; row < def.rows.length; row++) {
    const line = def.rows[row];
    if (typeof line !== 'string') fail(def, `row ${row} is not a string`);
    if (line.length !== grid.cols) fail(def, `row ${row}: length ${line.length}, expected ${grid.cols}`);
    for (let col = 0; col < grid.cols; col++) {
      const ch = line[col];
      const e = LEGEND[ch];
      if (!e) fail(def, `row ${row} col ${col}: unknown character "${ch}"`);
      const { x, y } = cellCentre(grid, col, row, extra);
      if (ch === 'S') {
        sCells.push({ x, y, col, row });
        continue;
      }
      if (e.type === BRICK.EMPTY) continue;
      if ((ch === 'B' || ch === 'W') && !isBoss) fail(def, `row ${row} col ${col}: "${ch}" only in boss levels`);
      if (ch === 'G' && mode === 'ring') fail(def, `row ${row} col ${col}: gravity bricks need a floor (not ring mode)`);
      if (mode === 'ring') {
        const dx = x - 360, dy = y - 540;
        if (dx * dx + dy * dy > R2) fail(def, `row ${row} col ${col}: brick outside ring radius ${grid.rMax}`);
      }
      const key = `${row},${col}`;
      const loaded = def.loaded?.[key];
      const material = loaded ? LEGEND[loaded] : e;
      let flags = material.flags | (loaded ? BF.LOADED : 0);
      // scrolling levels: a row stays hidden until its top edge reaches the entry line
      if (rules.scrollSpeed > 0 ? y - grid.ch / 2 < SCROLL_ENTRY_Y - 1e-6 : y + grid.ch / 2 <= 0) flags |= BF.HIDDEN;
      if (isBoss) flags &= ~BF.CLEARABLE;           // boss levels count weak-point hits instead
      if (isBoss && ch === 'W') flags |= BF.CLEARABLE; // the target the aim line and robot look for
      let drop = -1;
      if (def.carriers && key in def.carriers) {
        if (ch !== '?') fail(def, `carriers["${key}"] is not a "?" cell`);
        drop = DROP_NAMES.indexOf(def.carriers[key]);
        if (drop < 0) fail(def, `carriers["${key}"]: unknown drop "${def.carriers[key]}"`);
      }
      bricks.push({
        type: material.type, flags, hp: material.hp, tier: material.tier, col, row, x, y, w: grid.cw, h: grid.ch,
        link: -1, drop, group: -1,
      });
      const idx = bricks.length - 1;
      if (ch in PORTAL_PAIRS) {
        if (ch in portalOpen) fail(def, `portal "${ch}" appears twice`);
        portalOpen[ch] = idx;
      } else if (ch in CLOSERS) {
        if (ch in portalClose) fail(def, `portal "${ch}" appears twice`);
        portalClose[ch] = idx;
      }
    }
  }
  for (const [o, c] of Object.entries(PORTAL_PAIRS)) {
    const i = portalOpen[o], j = portalClose[c];
    if ((i === undefined) !== (j === undefined)) fail(def, `portal "${o}${c}" is not paired`);
    if (i !== undefined) {
      bricks[i].link = j;
      bricks[j].link = i;
    }
  }

  // Cavities: each 4-connected region of '*' must be fully enclosed by 'C'. The region and the
  // shell cells around it share a group id (0, 1, 2 ...), which the content system uses to free it.
  const index = new Map();
  for (let i = 0; i < bricks.length; i++) index.set(`${bricks[i].row},${bricks[i].col}`, i);
  const charAt = (r, c) => (r >= 0 && r < def.rows.length && c >= 0 && c < grid.cols ? def.rows[r][c] : null);
  let cavity = 0;
  for (const b of bricks) {
    if (!(b.flags & BF.CAVITY_BALL) || b.group >= 0) continue;
    const stack = [b];
    b.group = cavity;
    while (stack.length) {
      const s = stack.pop();
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const r = s.row + dr, c = s.col + dc;
        const ch = charAt(r, c);
        if (ch === '*') {
          const n = bricks[index.get(`${r},${c}`)];
          if (n.group < 0) { n.group = cavity; stack.push(n); }
        } else if (ch === 'C') {
          const n = bricks[index.get(`${r},${c}`)];
          if (n.group < 0) n.group = cavity;
        } else {
          fail(def, `sealed ball at row ${s.row} col ${s.col} is not enclosed by C (row ${r} col ${c} is "${ch ?? 'edge'}")`);
        }
      }
    }
    cavity++;
  }

  // Sentries: entries in def.sentries without x/y take the 'S' cells in reading order.
  const sentrySpawns = [];
  let s = 0;
  for (const entry of def.sentries || []) {
    if (!SENTRY_KINDS.includes(entry.kind)) fail(def, `unknown sentry kind "${entry.kind}"`);
    let x = entry.x, y = entry.y;
    if (x === undefined || y === undefined) {
      if (s >= sCells.length) fail(def, 'more sentries without x/y than S cells');
      x = sCells[s].x;
      y = sCells[s].y;
      s++;
    }
    sentrySpawns.push({ ...entry, x, y, kind: entry.kind, atMs: entry.atMs | 0, everyMs: entry.everyMs | 0 });
  }
  for (; s < sCells.length; s++) sentrySpawns.push({ x: sCells[s].x, y: sCells[s].y, kind: 'drifter', atMs: 0, everyMs: 0 });

  // Moving rows (bottom: a row slides along x) or columns (left: a column slides along y).
  for (const m of def.motion || []) {
    if (mode === 'ring') fail(def, 'motion is not available in ring mode');
    if (mode === 'bottom' && !(m.row >= 0 && m.row < def.rows.length)) fail(def, `motion row ${m.row} out of range`);
    if (mode === 'left' && !(m.col >= 0 && m.col < grid.cols)) fail(def, `motion col ${m.col} out of range`);
    if (!(m.speed > 0)) fail(def, 'motion speed must be > 0');
  }

  const clearable = bricks.reduce((n, b) => n + (b.flags & BF.CLEARABLE ? 1 : 0), 0);
  if (clearable === 0 && !isBoss && !rules.timerMs) warnings.push('no clearable bricks');
  return { def, grid, rules, bricks, sentrySpawns, clearable, warnings };
}

// ------------------------------------------------------------------ design checks

const isSolidChar = (ch) => !!LEGEND[ch] && (LEGEND[ch].flags & BF.SOLID) !== 0;
const isWallChar = (ch) => !!LEGEND[ch] && (LEGEND[ch].flags & BF.SOLID) !== 0 && (LEGEND[ch].flags & BF.BREAKABLE) === 0;

/**
 * Facing indestructible pairs: two X cells in one row or column with only non-solid cells between
 * them (a lane the ball can rattle in with nothing to break). Adjacent X cells are a solid wall.
 * @returns {string[]}
 */
export function loopTraps(def) {
  const out = [];
  const rows = def.rows;
  const cols = rows[0].length;
  const scan = (get, len, label) => {
    let last = -1;
    for (let k = 0; k < len; k++) {
      const ch = get(k);
      if (ch === 'X') {
        if (last >= 0 && k - last > 1) out.push(`${label} ${last}-${k}: facing X cells with nothing between`);
        last = k;
      } else if (isSolidChar(ch)) last = -1;
    }
  };
  for (let r = 0; r < rows.length; r++) scan((k) => rows[r][k], cols, `row ${r} cols`);
  for (let c = 0; c < cols; c++) scan((k) => rows[k][c], rows.length, `col ${c} rows`);
  return out;
}

/**
 * Portal twins in one straight lane toward the paddle (one column in bottom mode, one row in left
 * mode, one bearing from the centre in ring mode) with nothing indestructible between them. Once
 * the bricks around them break, a ball can run paddle, ring, twin, wall, twin, ring, paddle for
 * ever, and every paddle contact looks like progress to the anti-loop.
 * @returns {string[]}
 */
export function portalLanes(def) {
  const mode = def.mode || 'bottom';
  const rows = def.rows;
  const at = {};
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const ch = rows[r][c];
      if (ch in PORTAL_PAIRS || ch in CLOSERS) at[ch] = { r, c };
    }
  }
  const out = [];
  for (const [o, cl] of Object.entries(PORTAL_PAIRS)) {
    const a = at[o], b = at[cl];
    if (!a || !b) continue;
    const between = [];
    let lane = '';
    if (mode === 'bottom' && a.c === b.c) {
      lane = `column ${a.c}`;
      for (let r = Math.min(a.r, b.r) + 1; r < Math.max(a.r, b.r); r++) between.push(rows[r][a.c]);
    } else if (mode === 'left' && a.r === b.r) {
      lane = `row ${a.r}`;
      for (let c = Math.min(a.c, b.c) + 1; c < Math.max(a.c, b.c); c++) between.push(rows[a.r][c]);
    } else if (mode === 'ring') {
      const mid = (rows.length - 1) / 2;
      const ang = (p) => Math.atan2(p.r - mid, p.c - mid);
      let d = Math.abs(ang(a) - ang(b)) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < 0.15) lane = 'one bearing';
    }
    if (lane && !between.some(isWallChar)) out.push(`portals ${o}${cl} share ${lane} with nothing indestructible between: a lane loops through both`);
  }
  return out;
}

/**
 * Flood fill from the paddle side through every cell a ball can pass or break (indestructible
 * and boss body cells block). Returns the cells of clearable or weak bricks never reached.
 * @returns {string[]}
 */
export function unreachable(def) {
  const mode = def.mode || 'bottom';
  const grid = GRID[mode];
  const rows = def.rows;
  const R = rows.length, C = grid.cols;
  // Padded grid: one ring of open cells around the layout. Bottom mode: the band above row 0
  // (y 0-90) and the space above the paddle are open; the sides are the field walls. Left mode:
  // the paddle side (column -1) is open; ring mode: everything outside the layout is open.
  const pad = 1;
  const W = C + 2 * pad, H = R + 2 * pad;
  const open = new Uint8Array(W * H);
  const seen = new Uint8Array(W * H);
  const at = (r, c) => (r + pad) * W + (c + pad);
  for (let r = -pad; r < R + pad; r++) {
    for (let c = -pad; c < C + pad; c++) {
      let ok;
      if (r >= 0 && r < R && c >= 0 && c < C) ok = !isWallChar(rows[r][c]);
      else if (mode === 'bottom') ok = c >= 0 && c < C; // above and below the wall, not beyond the side walls
      else if (mode === 'left') ok = c < 0 && r >= 0 && r < R; // the paddle side
      else ok = true;
      open[at(r, c)] = ok ? 1 : 0;
    }
  }
  // portal twins: reaching one end reaches the other
  const twin = new Map();
  const ends = {};
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const ch = rows[r][c];
      if (ch in PORTAL_PAIRS || ch in CLOSERS) ends[ch] = at(r, c);
    }
  }
  for (const [o, cl] of Object.entries(PORTAL_PAIRS)) {
    if (ends[o] !== undefined && ends[cl] !== undefined) {
      twin.set(ends[o], ends[cl]);
      twin.set(ends[cl], ends[o]);
    }
  }
  const queue = [];
  const startRow = mode === 'bottom' ? R : -1;
  if (mode === 'bottom') for (let c = 0; c < C; c++) queue.push(at(startRow, c));
  else if (mode === 'left') for (let r = 0; r < R; r++) queue.push(at(r, -1));
  else for (let c = -1; c <= C; c++) queue.push(at(-1, c));
  for (const q of queue) seen[q] = 1;
  while (queue.length) {
    const q = queue.pop();
    const r = Math.floor(q / W), c = q % W;
    const t = twin.get(q);
    if (t !== undefined && !seen[t]) {
      seen[t] = 1;
      queue.push(t);
    }
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= H || cc < 0 || cc >= W) continue;
      const k = rr * W + cc;
      if (seen[k] || !open[k]) continue;
      seen[k] = 1;
      queue.push(k);
    }
  }
  const out = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const e = LEGEND[rows[r][c]];
      if (!e || !(e.flags & (BF.CLEARABLE | BF.WEAK))) continue;
      if (!seen[at(r, c)]) out.push(`row ${r} col ${c} "${rows[r][c]}" is unreachable`);
    }
  }
  return out;
}

/**
 * Every design rule the level tests enforce. Empty array = the level is good.
 * @param {import('../core/types.js').LevelDef} def
 * @param {{names?:readonly string[]}} [opts] names: LEVEL_NAMES to check campaign names against
 * @returns {string[]}
 */
export function checkLevel(def, opts = {}) {
  const problems = [];
  let parsed;
  try {
    parsed = parseLevel(def);
  } catch (err) {
    return [String(err.message || err)];
  }
  const mode = parsed.def.mode || 'bottom';
  const kind = def.kind || 'normal';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(def.id || '')) problems.push(`id "${def.id}" is not kebab-case`);
  if (!['ember', 'blaze', 'whiteheat', 'overburn'].includes(def.world)) problems.push(`world "${def.world}"`);
  if (opts.names && def.n >= 1 && def.n < opts.names.length && def.name !== opts.names[def.n]) {
    problems.push(`name "${def.name}" should be "${opts.names[def.n]}"`);
  }
  if ((!def.stage || def.stage === 1) && def.world !== 'overburn') {
    const words = String(def.adds || '').trim().split(/\s+/).filter(Boolean).length;
    if (words < 2 || words > 4) problems.push(`adds "${def.adds}" should be 2-4 words`);
  }
  if (def.hint && /[!]/.test(def.hint)) problems.push('hint must be a fact, not an exclamation');
  for (const w of parsed.warnings) problems.push(w);
  problems.push(...loopTraps(def));
  problems.push(...portalLanes(def));
  problems.push(...unreachable(def));
  if (mode === 'left') {
    for (let r = 0; r < def.rows.length; r++) {
      if (/[^. ]/.test(def.rows[r].slice(0, 4))) problems.push(`row ${r}: left mode keeps columns 0-3 empty for the paddle`);
    }
  }
  // Gravity bricks start supported: a solid brick directly toward the paddle.
  for (const b of parsed.bricks) {
    if (b.type !== BRICK.GRAVITY) continue;
    const r = mode === 'bottom' ? b.row + 1 : b.row;
    const c = mode === 'left' ? b.col - 1 : b.col;
    const ch = r < def.rows.length && c >= 0 ? def.rows[r][c] : '.';
    if (!isSolidChar(ch)) problems.push(`gravity brick at row ${b.row} col ${b.col} has nothing under it`);
  }
  if (kind === 'boss') {
    if (!parsed.bricks.some((b) => b.flags & BF.WEAK)) problems.push('boss level has no W weak point');
  }
  if (kind === 'bonus' && !(parsed.rules.timerMs > 0)) problems.push('bonus level needs rules.timerMs');
  if (parsed.bricks.length > 768) problems.push(`${parsed.bricks.length} bricks > pool 768`);
  const anchor = anchorProblem(parsed);
  if (anchor) problems.push(anchor);
  // Bricks inside the field (scrolling levels may start above it).
  for (const b of parsed.bricks) {
    if (b.x < 0 || b.x > FIELD.W || b.y > FIELD.H) problems.push(`brick at row ${b.row} col ${b.col} outside the field`);
  }
  return problems;
}
