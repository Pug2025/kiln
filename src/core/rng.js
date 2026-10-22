// Kiln — seeded random numbers. Game logic never calls Math.random().
//
// mulberry32 streams. Each system forks its own stream by NAME, so adding a new consumer never
// shifts the numbers another system sees (determinism survives parallel development).
//   const rng = createRng(seed);  const fx = rng.fork('economy');  fx.int(2, 4)

/** 32-bit string hash (FNV-1a). */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix two 32-bit values into one (used to fork streams). */
export function mix32(a, b) {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * @param {number} seed any integer
 * @returns {import('./types.js').Rng}
 */
export function createRng(seed) {
  const r = {
    seed: seed >>> 0,
    s: seed >>> 0,
    /** float in [0, 1) */
    next() {
      let t = (r.s = (r.s + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** integer in [lo, hi] inclusive */
    int(lo, hi) {
      return lo + Math.floor(r.next() * (hi - lo + 1));
    },
    /** float in [lo, hi) */
    range(lo, hi) {
      return lo + r.next() * (hi - lo);
    },
    /** true with probability p */
    chance(p) {
      return r.next() < p;
    },
    /** −1 or +1 */
    sign() {
      return r.next() < 0.5 ? -1 : 1;
    },
    /** one element of an array */
    pick(arr) {
      return arr[Math.floor(r.next() * arr.length)];
    },
    /**
     * Index chosen by weights (array of non-negative numbers). Returns −1 if all are 0.
     * @param {ArrayLike<number>} weights
     */
    weighted(weights) {
      let total = 0;
      for (let i = 0; i < weights.length; i++) total += weights[i];
      if (total <= 0) return -1;
      let x = r.next() * total;
      for (let i = 0; i < weights.length; i++) {
        x -= weights[i];
        if (x < 0) return i;
      }
      return weights.length - 1;
    },
    /** independent child stream keyed by name */
    fork(name) {
      return createRng(mix32(r.seed, hashString(name)));
    },
    /** snapshot / restore for tests and replays */
    get state() {
      return r.s;
    },
    set state(v) {
      r.s = v >>> 0;
    },
  };
  return r;
}

/**
 * Overburn's daily seed: the UTC date, so everyone gets the same walls on the same day.
 * @param {Date} [date]
 */
export function dailySeed(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return hashString(`kiln-overburn-${y}-${m}-${d}`);
}
