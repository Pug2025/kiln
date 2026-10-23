// Presentation facts shared by boss hardware, bricks and event feedback. No three.js or DOM.
import { BRICK, BF } from '../core/constants.js';
import { CONTENT } from '../content/bricks.js';
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

/** A counted hit gets one brief flash; the remaining cooldown/guard is visibly cold. */
export function coreProtected(world) {
  const b = world?.boss, d = b?.data;
  if (!b?.active || !d || b.hp <= 0) return false;
  const since = world.time - d.lastCoreMs;
  return since >= CORE_HIT_FLASH_MS && (!!d.guard || since < CONTENT.CORE_COOLDOWN_MS);
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
