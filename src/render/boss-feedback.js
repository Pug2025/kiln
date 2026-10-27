// Presentation facts shared by boss hardware, bricks and event feedback. No three.js or DOM.
import { BRICK, BF } from '../core/constants.js';
import { CRUCIBLE_SPEC, CORE_SPECS } from '../content/bosses/orbit.js';

export const CORE_HIT_FLASH_MS = 120;
export const CORE_COOL_HEAT = 0.045;

export function isBossCore(world, i) {
  return !!(world?.boss?.id && i >= 0 && i < world.bricks.count &&
    world.bricks.type[i] === BRICK.WEAK && (world.bricks.flags[i] & BF.BOSS));
}

export function isBossDeflector(world, i) {
  return !!(world?.boss?.id && i >= 0 && i < world.bricks.count &&
    world.bricks.type[i] === BRICK.BOSS && (world.bricks.flags[i] & BF.BOSS));
}

/** Route decorative model hardware through the live aperture mask, never its heat source. */
export function bossTrimKind(bossId, partName, materialName) {
  if (/ember|core/i.test(materialName)) return '';
  if (bossId === 'stoker' && partName.startsWith('part-head')) return 'throat';
  if (partName.startsWith('part-outer-shell')) return 'outer';
  if (partName.startsWith('part-shell') || partName.startsWith('part-ring')) return 'inner';
  // The Crucible vessel's closed lip/body surrounds the W cells inside the collision ring.
  // It needs the same gate as that ring; the recessed matte bowl and ember floor stay intact.
  if (bossId === 'crucible' && partName.startsWith('part-core') && /titanium|metal/i.test(materialName)) return 'inner';
  return '';
}

/**
 * A cooled (guarded) core is visibly cold after its counted hit's flash. Item 20 (Oct 27): the short
 * cooldown between counted hits no longer dims the core. Dimming right after every counted hit
 * made a hit that counted end in the same cold look as one that did not.
 */
export function coreProtected(world) {
  const b = world?.boss, d = b?.data;
  if (!b?.active || !d || b.hp <= 0 || !d.guard) return false;
  return world.time - d.lastCoreMs >= CORE_HIT_FLASH_MS;
}

/**
 * What a contact on a boss brick shows (item 20 rule: no contact is ever silent). Raw contacts on
 * the core are resolved by their BOSS_HIT / BOSS_BLOCKED outcome; everything else is armour.
 * @returns {'core'|'shell'|'armour'|''} core: wait for the outcome event; shell: breakable boss
 *   armour (its own damage reads as progress); armour: permanent plates that only deflect
 */
export function bossContactKind(world, i) {
  if (isBossCore(world, i)) return 'core';
  if (!world?.boss?.id || i < 0 || i >= world.bricks.count || !(world.bricks.flags[i] & BF.BOSS)) return '';
  return world.bricks.type[i] === BRICK.BOSS ? 'armour' : 'shell';
}

/** Segments per core crack and the most cracks a core can show (one per counted hit). */
export const CRACK_SEGS = 3;
export const MAX_CRACKS = 24;

/** Small deterministic generator (no Math.random: the same core always cracks the same way). */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Fracture plan for a core of w x h field units that takes n counted hits (core-damage.js draws
 * it): n cracks of CRACK_SEGS jagged segments, in local field units around the core centre (y
 * down). Crack k is revealed by the (k + 1)th counted hit. The first starts near the middle; later
 * ones branch from earlier cracks or start elsewhere, so damage spreads over the core as it grows.
 * @returns {Float32Array} per segment: x0, y0, x1, y1, crack index
 */
export function crackPlan(w, h, n, seed) {
  n = Math.max(1, Math.min(MAX_CRACKS, n | 0));
  const r = rng(seed);
  const out = new Float32Array(n * CRACK_SEGS * 5);
  const inset = 3, hx = w / 2 - inset, hy = h / 2 - inset;
  const len = Math.max(8, 0.75 * Math.sqrt((w * h) / n));
  const nodes = [];
  let o = 0;
  for (let k = 0; k < n; k++) {
    let x = 0, y = 0;
    if (k === 0) { x = (r() - 0.5) * w * 0.2; y = (r() - 0.5) * h * 0.2; }
    else if (nodes.length && r() < 0.4) { const p = nodes[Math.floor(r() * nodes.length)]; x = p.x; y = p.y; }
    else {
      // a new crack starts where the face is still whole: the best of four tries, farthest from
      // every crack so far, so the damage spreads over the core instead of piling up in one place
      let best = -1;
      for (let tries = 0; tries < 4; tries++) {
        const cx = (r() * 2 - 1) * hx * 0.85, cy = (r() * 2 - 1) * hy * 0.85;
        let near = Infinity;
        for (const p of nodes) near = Math.min(near, (p.x - cx) ** 2 + (p.y - cy) ** 2);
        if (near > best) { best = near; x = cx; y = cy; }
      }
    }
    // head away from the middle more often than toward it, so cracks reach the edges
    let a = r() * Math.PI * 2;
    if (Math.abs(x) + Math.abs(y) > 1 && r() < 0.6) a = Math.atan2(y, x) + (r() - 0.5) * 1.6;
    for (let s = 0; s < CRACK_SEGS; s++) {
      const l = len * (0.55 + r() * 0.6);
      let x1 = 0, y1 = 0;
      for (let turn = 0; turn < 2; turn++) {
        // a crack that would leave the face turns back inward, so no segment is ever empty
        x1 = Math.max(-hx, Math.min(hx, x + Math.cos(a) * l));
        y1 = Math.max(-hy, Math.min(hy, y + Math.sin(a) * l));
        if (Math.hypot(x1 - x, y1 - y) >= 0.5 * l) break;
        a += Math.PI;
      }
      out[o++] = x; out[o++] = y; out[o++] = x1; out[o++] = y1; out[o++] = k;
      nodes.push({ x: x1, y: y1 });
      x = x1; y = y1;
      a += (r() - 0.5) * 1.2;
    }
  }
  return out;
}

/** How many cracks a boss shows: one per counted hit taken (hpMax - hp), capped. */
export function cracksShown(boss) {
  if (!boss || !boss.hpMax) return 0;
  return Math.max(0, Math.min(MAX_CRACKS, boss.hpMax - Math.max(0, boss.hp)));
}

/** A cooldown block this soon (sim ms) after a counted hit is that hit's own rattle. */
export const SAME_HIT_MS = 250;

/**
 * Does a core contact that did not count (BOSS_BLOCKED; guard: the core is cooled) dull the core
 * (its heat dips, its cracks go ash)? Not for a cooldown block within SAME_HIT_MS of a counted
 * hit: the core is still glowing from that hit, and dulling it there showed "no damage" on a core
 * that looked ready (review Oct 27). Such a contact keeps its grey puff and dull knock.
 */
export function blockDullsCore(world, guard) {
  const d = world?.boss?.data;
  return !!guard || !d || world.time - d.lastCoreMs >= SAME_HIT_MS;
}

/** Damage done, 0..1 (counted hits over the core's full health). */
export function coreDamageFraction(world) {
  const b = world?.boss;
  return b?.hpMax > 0 ? Math.max(0, Math.min(1, 1 - b.hp / b.hpMax)) : 0;
}

/** Crop only the false solid throat behind Stoker's real jaw cells; outputs local x0,x1,top. */
export function stokerThroat(world, out) {
  const B = world.bricks, boss = world.boss;
  let x0 = Infinity, x1 = -Infinity, top = -Infinity;
  for (let i = 0; i < B.count; i++) {
    if (!(B.flags[i] & BF.BOSS)) continue;
    if (B.type[i] === BRICK.ARMOURED) {
      x0 = Math.min(x0, B.x[i] - B.w[i] / 2);
      x1 = Math.max(x1, B.x[i] + B.w[i] / 2);
    } else if (B.type[i] === BRICK.WEAK) top = boss.y - B.y[i] + B.h[i] / 2;
  }
  out[0] = x0 - boss.x - 2;
  out[1] = x1 - boss.x + 2;
  out[2] = top + 2;
  return out;
}

const TAU = Math.PI * 2;
const runs = (s) => {
  const out = [];
  for (const k of s.gaps) {
    if (s.gaps.includes((k - 1 + s.slots) % s.slots)) continue;
    let end = k;
    while (s.gaps.includes((end + 1) % s.slots)) end++;
    out.push({ before: (k - 1 + s.slots) % s.slots, after: (end + 1) % s.slots,
      middle: ((k + end) / 2) * TAU / s.slots });
  }
  return out;
};
const ORBIT = { crucible: [null, CRUCIBLE_SPEC.rings, CRUCIBLE_SPEC.rings], core: CORE_SPECS.map(s => s?.rings) };
const RUNS = new Map();
for (const stages of Object.values(ORBIT)) for (const rings of stages) if (rings)
  for (const s of rings) if (!RUNS.has(s)) RUNS.set(s, runs(s));

/** The angular silhouette of a live, axis-aligned square plate around a gap's middle ray. */
function edgeAngle(spec, slot, turn, middle, maximum) {
  const a = slot * TAU / spec.slots + turn;
  const x = Math.cos(a) * spec.r, y = Math.sin(a) * spec.r;
  let edge = maximum ? -Infinity : Infinity;
  for (let dx = -15; dx <= 15; dx += 30) for (let dy = -15; dy <= 15; dy += 30) {
    const q = Math.atan2(y + dy, x + dx) - middle;
    const delta = Math.atan2(Math.sin(q), Math.cos(q));
    edge = maximum ? Math.max(edge, delta) : Math.min(edge, delta);
  }
  return middle + edge;
}

/** Two possible clear sectors, each [cos(bearing),sin(bearing),cos(half-width),enabled].
 * The bounds follow the actual unrotated square collision plates, including interpolated sway.
 * Model petals are cut through these sectors, so decorative hardware never seals a real gate.
 */
export function orbitApertures(world, alpha, ringIndex, out) {
  out.fill(0);
  const b = world.boss, spec = ORBIT[b.id]?.[b.phase]?.[ringIndex];
  if (!spec) return out;
  const turn = ringIndex ? b.data.angle2 || 0 : b.pangle + (b.angle - b.pangle) * alpha;
  const gaps = RUNS.get(spec);
  for (let k = 0; k < gaps.length && k < 2; k++) {
    const g = gaps[k], middle = g.middle + turn;
    const lo = edgeAngle(spec, g.before, turn, middle, true);
    const hi = edgeAngle(spec, g.after, turn, middle, false);
    const centre = (lo + hi) / 2, h = Math.max(0, (hi - lo) / 2);
    out[k * 4] = Math.cos(centre);
    out[k * 4 + 1] = Math.sin(centre);
    out[k * 4 + 2] = Math.cos(h);
    out[k * 4 + 3] = h > 0 ? 1 : 0;
  }
  return out;
}
