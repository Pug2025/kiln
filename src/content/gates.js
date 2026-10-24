// Kiln: gate twists (OWNER: B). From level 13 a cleared level with `gate: true` shows two doors; each
// door previews a twist on the next level's layout. Every door is a trade: one cost (the wall gets
// harder: moving rows, armour, heavier bricks) and one payoff (explosives or more drops), so neither
// door is simply better and the choice depends on the run (lives left, the Mod in hand, how the
// player likes to play). A door's id is "cost+payoff", e.g. "armoured+rich".
// The level designer picks each level's two doors (`doors` in the level data), measured with the
// robot so the two play within about 1.25x of each other and neither plays clearly faster than the
// level without a door (the cost is real; tests/b-gates checks it); a level without `doors` gets a
// pair by rule.
// Not doors: a hot start (the robot plays a faster ball faster, so its cost cannot be measured) and
// an extra sentry (it made every level faster for the robot: a drone that knocks the ball back
// into the wall is no cost).
// Pure functions on LevelDefs: no DOM, no clock, no randomness. The public API is twistsFor(n) and
// applyTwist(def, id) in src/levels/index.js.

import { LEGEND } from '../levels/legend.js';

/** @typedef {{id:string, label:string, fact:string}} Twist */

const PLAIN = 'abc';
const LANE_OK = new Set(['.', ' ', 'a', 'b', 'c', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'E', '?']);

/**
 * Every twist part: a cost or a payoff. `label` names it on the door ("Armour + more drops"); the
 * door's fact line counts what it does to the wall (door()).
 */
export const TWISTS = Object.freeze({
  moving: { kind: 'cost', label: 'Moving rows' },     // the first and last row that can slide
  armoured: { kind: 'cost', label: 'Armour' },        // 1 plain brick in 3
  heavier: { kind: 'cost', label: 'Heavier bricks' }, // plain and numbered bricks: 1 more hit
  explosive: { kind: 'pay', label: 'explosives' },    // 1 plain or low-numbered brick in 16
  rich: { kind: 'pay', label: 'more drops' },         // 1 plain brick in 8 carries a drop
});

/** How often a payoff turns a brick (1 in N of the bricks it may take). */
const EXPLOSIVE_EVERY = 16;
const RICH_EVERY = 8;

const COSTS = ['moving', 'armoured', 'heavier'];
const PAYS = ['explosive', 'rich'];

function mode(def) {
  return def.mode || 'bottom';
}

/** Rows (bottom) or columns (left) that can slide: only lane-safe bricks and room to move. */
function laneCandidates(def) {
  const rows = def.rows;
  const out = [];
  if (mode(def) === 'bottom') {
    const taken = new Set((def.motion || []).map((m) => m.row));
    for (let r = 0; r < rows.length; r++) {
      if (taken.has(r)) continue;
      const line = rows[r];
      const bricks = line.replace(/[. ]/g, '').length;
      if (bricks < 2 || line.length - bricks < 2) continue;
      if ([...line].some((ch) => !LANE_OK.has(ch))) continue;
      if (r > 0 && rows[r - 1].includes('G')) continue; // gravity bricks would lose their footing
      if (r + 1 < rows.length && rows[r + 1].includes('G')) continue;
      out.push(r);
    }
  } else if (mode(def) === 'left') {
    const taken = new Set((def.motion || []).map((m) => m.col));
    const cols = rows[0].length;
    for (let c = 4; c < cols; c++) {
      if (taken.has(c)) continue;
      const col = rows.map((line) => line[c]).join('');
      const bricks = col.replace(/[. ]/g, '').length;
      if (bricks < 2 || col.length - bricks < 2) continue;
      if ([...col].some((ch) => !LANE_OK.has(ch))) continue;
      if (rows.some((line) => line[c - 1] === 'G' || line[c + 1] === 'G')) continue;
      out.push(c);
    }
  }
  return out;
}

function countChars(def, set) {
  let n = 0;
  for (const line of def.rows) for (const ch of line) if (set.includes(ch)) n++;
  return n;
}

/** True if one twist part can apply to this level. */
function partApplies(def, id) {
  switch (id) {
    case 'moving': return !(def.rules && (def.rules.marchMs || def.rules.scrollSpeed)) && laneCandidates(def).length >= 2;
    case 'armoured': return countChars(def, PLAIN) >= 9;
    case 'heavier': return countChars(def, PLAIN + '2345678') >= 9;
    case 'explosive': return countChars(def, PLAIN + '2345') >= EXPLOSIVE_EVERY;
    case 'rich': return countChars(def, PLAIN) >= RICH_EVERY && Object.keys((def.drops && def.drops.table) || {}).length > 0;
    default: return false;
  }
}

/** The parts of a door id: [cost, payoff] for "cost+payoff", or [part] for a single twist. */
export function twistParts(id) {
  const parts = String(id || '').split('+');
  if (parts.length > 2 || parts.some((p) => !TWISTS[p])) return null;
  if (parts.length === 2 && !(TWISTS[parts[0]].kind === 'cost' && TWISTS[parts[1]].kind === 'pay')) return null;
  return parts;
}

/** True if a twist (a door id, or one part) can apply to this level. */
export function twistApplies(def, id) {
  if (!def || def.kind === 'boss' || def.kind === 'bonus') return false;
  const parts = twistParts(id);
  return !!parts && parts.every((p) => partApplies(def, p));
}

/** Replace every k-th character from `set` (reading order, starting at `from`) with `to(ch)`. */
function everyKth(rows, set, k, from, to) {
  let n = 0;
  return rows.map((line) => [...line].map((ch) => {
    if (!set.includes(ch)) return ch;
    const hit = n % k === from;
    n++;
    return hit ? to(ch) : ch;
  }).join(''));
}

/** How many more of `ch` the twisted wall has. */
function added(def, out, ch) {
  const count = (d) => d.rows.reduce((n, line) => n + line.split(ch).length - 1, 0);
  return count(out) - count(def);
}

/**
 * The door a cost and a payoff make: {id, label, fact}. The fact counts what the door does to
 * this wall ("12 bricks armoured, 7 explode"), so it is always true and needs no reading of odds.
 */
export function door(def, cost, pay) {
  const id = `${cost}+${pay}`;
  const c = TWISTS[cost], p = TWISTS[pay];
  const out = applyTwistDef(def, id);
  const a = added(def, out, 'A'), e = added(def, out, 'E'), r = added(def, out, '?');
  const h = def.rows.reduce((n, line, row) => n + [...line].filter((ch, col) =>
    LEGEND[out.rows[row][col]].hp === LEGEND[ch].hp + 1).length, 0);
  const what = {
    moving: mode(def) === 'left' ? '2 columns slide' : '2 rows slide',
    armoured: a === 1 ? '1 brick armoured' : `${a} bricks armoured`,
    heavier: `${h} take 1 more hit`,
    explosive: e === 1 ? '1 explodes' : `${e} explode`,
    rich: r === 1 ? '1 carries a drop' : `${r} carry a drop`,
  };
  return { id, label: `${c.label} + ${p.label}`, fact: `${what[cost]}, ${what[pay]}` };
}

/** The pair the rule picks for a level without `doors`: two costs, one payoff each, by level number. */
function rulePair(def) {
  const n = def.n | 0;
  const costs = COSTS.filter((id) => partApplies(def, id));
  const pays = PAYS.filter((id) => partApplies(def, id));
  if (!costs.length || !pays.length) return [];
  const a = costs[n % costs.length];
  const b = costs.length > 1 ? costs[(n + 1) % costs.length] : a;
  const pa = pays[n % pays.length];
  const pb = pays.length > 1 ? pays[(n + 1) % pays.length] : pa;
  if (a === b && pa === pb) return [[a, pa]];
  return [[a, pa], [b, pb]];
}

/** Two doors for a level: its designed `doors` (each "cost+payoff"), else the rule's pair. */
export function twistPair(def) {
  const designed = (def.doors || []).map((id) => twistParts(id)).filter((p) => p && p.length === 2 && p.every((x) => partApplies(def, x)));
  const pairs = designed.length === 2 ? designed : rulePair(def);
  return pairs.map(([cost, pay]) => door(def, cost, pay));
}

/** One twist part on a def (no checks). */
function applyPart(def, id) {
  const out = { ...def };
  switch (id) {
    case 'moving': {
      const lanes = laneCandidates(def);
      const pick = [lanes[0], lanes[lanes.length - 1]];
      const motion = [...(def.motion || [])];
      pick.forEach((k, j) => {
        const m = { speed: 70, dir: j === 0 ? 1 : -1 };
        if (mode(def) === 'bottom') m.row = k; else m.col = k;
        motion.push(m);
      });
      out.motion = motion;
      break;
    }
    case 'armoured':
      out.rows = everyKth(def.rows, PLAIN, 3, 1, () => 'A');
      break;
    case 'heavier':
      out.rows = def.rows.map((line) => [...line].map((ch) => {
        if (PLAIN.includes(ch)) return '2';
        if (ch >= '2' && ch <= '8') return String(Number(ch) + 1);
        return ch;
      }).join(''));
      break;
    case 'explosive':
      out.rows = everyKth(def.rows, PLAIN + '2345', EXPLOSIVE_EVERY, EXPLOSIVE_EVERY >> 1, () => 'E');
      break;
    case 'rich':
      // new carriers roll their drop from the level's table; fixed carriers stay where they were
      out.rows = everyKth(def.rows, PLAIN, RICH_EVERY, RICH_EVERY >> 1, () => '?');
      break;
    default:
      break;
  }
  return out;
}

/**
 * A new LevelDef with the twist applied (the original is untouched). `twist` names it. A door's
 * payoff goes on first, then its cost (so "heavier+rich" turns plain bricks into carriers before
 * the rest get one more hit, and the door's numbers are both true).
 * @param {import('../core/types.js').LevelDef} def
 * @param {string} id  "cost+payoff" or a single twist id
 */
export function applyTwistDef(def, id) {
  if (!twistApplies(def, id)) return def;
  const parts = twistParts(id);
  let out = { ...def, rules: { ...(def.rules || {}) } };
  for (const p of [...parts].reverse()) out = applyPart(out, p);
  out.twist = id;
  return out;
}
