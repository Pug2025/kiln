// Kiln: save data (OWNER: E). localStorage key 'kiln.save.v1'. Pure apart from the storage
// adapter, so Node tests pass a memory storage.
//
// Shape: types.js SaveData, version SAVE_VERSION. Loading runs every migration from the stored
// version up to the current one (MIGRATIONS[v] turns version v into v + 1), then sanitises every
// field against the defaults: unknown keys are kept (a newer build's data survives an older build),
// bad numbers fall back to defaults, ranks and volumes are clamped. A corrupt save never stops the
// game: it loads as a fresh save, and the unreadable string is copied to BAD_KEY first so the
// progress in it is not lost for good. Every version bump adds a migration step and a test.
// A second slot (DEV_KEY, the ?dev=1 build) is the same save under another key. The first time it
// loads it starts from the real save; nothing in that slot is ever written back to the real one.

import { STORAGE_KEY } from '../core/constants.js';
import { FORGE_IDS, MAX_RANK } from './forge.js';

export const SAVE_VERSION = 1;
/** Where load() keeps a stored string it could not read (the next write replaces the main key). */
export const BAD_KEY = `${STORAGE_KEY}.bad`;
/** The ?dev=1 build's own slot, so dev play never changes the real progress. */
export const DEV_KEY = `${STORAGE_KEY}.dev`;

/** @returns {import('../core/types.js').SaveData} */
export function defaultSave() {
  return {
    v: SAVE_VERSION,
    campaign: { unlocked: 1, best: {}, cleared: {} },
    forge: { embers: 0, ranks: {} },
    overburn: { best: 0, bestWave: 0, lastSeed: 0 },
    stats: {},
    settings: {
      music: 0.8,
      sfx: 0.9,
      muted: false,
      lite: false,
      reduceMotion: false,
      reduceTransparency: false,
      leftHanded: false,
      thumbPad: false,
    },
  };
}

/**
 * Migrations: MIGRATIONS[v](data) returns the data at version v + 1.
 * v0 is any save written before versions existed (no `v`): the day-one flat shape kept embers,
 * unlocked level and settings at the top level.
 */
export const MIGRATIONS = Object.freeze({
  0(d) {
    const out = { ...d, v: 1 };
    const campaign = { ...(d.campaign || {}) };
    if (d.unlocked != null && campaign.unlocked == null) campaign.unlocked = d.unlocked;
    if (d.best && campaign.best == null) campaign.best = d.best;
    out.campaign = campaign;
    const forge = { ...(d.forge || {}) };
    if (d.embers != null && forge.embers == null) forge.embers = d.embers;
    if (d.ranks && forge.ranks == null) forge.ranks = d.ranks;
    out.forge = forge;
    delete out.unlocked;
    delete out.best;
    delete out.embers;
    delete out.ranks;
    return out;
  },
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, d, lo = -Infinity, hi = Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const int = (v, d, lo, hi) => Math.floor(num(v, d, lo, hi));
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

/** Numbers-only map (best scores, stats). */
function numMap(src) {
  const out = {};
  if (!isObj(src)) return out;
  for (const k of Object.keys(src)) {
    const n = Number(src[k]);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/**
 * Bring any parsed value up to the current version and shape.
 * @param {any} raw
 * @returns {import('../core/types.js').SaveData}
 */
export function migrate(raw) {
  const base = defaultSave();
  if (!isObj(raw)) return base;
  let d = raw;
  let v = Number.isInteger(d.v) && d.v >= 0 ? d.v : 0;
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    d = step ? step(d) : { ...d, v: v + 1 };
    v = d.v;
  }
  return sanitise(d, base);
}

function sanitise(d, base) {
  const out = { ...d, v: Math.max(SAVE_VERSION, d.v | 0) };
  const c = isObj(d.campaign) ? d.campaign : {};
  const cleared = {};
  if (isObj(c.cleared)) for (const k of Object.keys(c.cleared)) if (c.cleared[k] === true) cleared[k] = true;
  out.campaign = { ...c, unlocked: int(c.unlocked, 1, 1, 31), best: numMap(c.best), cleared };
  const f = isObj(d.forge) ? d.forge : {};
  const ranks = {};
  const fr = isObj(f.ranks) ? f.ranks : {};
  for (const id of FORGE_IDS) if (fr[id] != null) ranks[id] = int(fr[id], 0, 0, MAX_RANK);
  out.forge = { ...f, embers: int(f.embers, 0, 0, 1e9), ranks };
  const o = isObj(d.overburn) ? d.overburn : {};
  out.overburn = { ...o, best: int(o.best, 0, 0, 1e12), bestWave: int(o.bestWave, 0, 0, 1e6), lastSeed: int(o.lastSeed, 0, 0, 4294967295) };
  out.stats = numMap(d.stats);
  const s = isObj(d.settings) ? d.settings : {};
  const bs = base.settings;
  out.settings = {
    ...s,
    music: num(s.music, bs.music, 0, 1),
    sfx: num(s.sfx, bs.sfx, 0, 1),
    muted: bool(s.muted, bs.muted),
    lite: bool(s.lite, bs.lite),
    reduceMotion: bool(s.reduceMotion, bs.reduceMotion),
    reduceTransparency: bool(s.reduceTransparency, bs.reduceTransparency),
    leftHanded: bool(s.leftHanded, bs.leftHanded),
    thumbPad: bool(s.thumbPad, bs.thumbPad),
  };
  return out;
}

/** In-memory Storage stand-in (tests, private mode). */
export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

/**
 * @param {{getItem(k:string):string|null, setItem(k:string, v:string):void, removeItem(k:string):void}} [storage]
 * @param {{key?:string, seedFrom?:string}} [opts]  key: the slot (default the real save). seedFrom:
 *   an empty slot starts from this key's save, which is only ever read.
 * @returns {import('../core/types.js').Save}
 */
export function createSave(storage, { key = STORAGE_KEY, seedFrom = '' } = {}) {
  let store = storage;
  if (!store) {
    try {
      store = globalThis.localStorage;
      store.getItem(key);
    } catch {
      store = null;
    }
  }
  if (!store) store = memoryStorage();
  // An empty slot takes the seedFrom save and stores it at once, so this happens a single time.
  function seed() {
    let data = defaultSave();
    try {
      const parsed = JSON.parse(store.getItem(seedFrom) || 'null');
      if (isObj(parsed)) data = migrate(parsed);
    } catch {
      /* unreadable: the slot starts from a fresh save */
    }
    try {
      store.setItem(key, JSON.stringify(data));
    } catch {
      /* storage full or blocked: play on */
    }
    return data;
  }
  return {
    load() {
      let raw = null;
      try {
        raw = store.getItem(key);
        if (!raw) return seedFrom ? seed() : defaultSave();
        const parsed = JSON.parse(raw);
        if (isObj(parsed)) return migrate(parsed);
      } catch {
        /* unparseable: kept aside below */
      }
      // Not a save we can read: keep the original string aside before the next write replaces
      // it, so the progress can still be recovered by hand.
      if (raw) {
        try {
          store.setItem(`${key}.bad`, raw);
        } catch {
          /* storage full or blocked: play on */
        }
      }
      return defaultSave();
    },
    write(data) {
      try {
        store.setItem(key, JSON.stringify(migrate(data)));
      } catch {
        /* storage full or blocked: play on */
      }
    },
    reset() {
      try {
        store.removeItem(key);
      } catch {
        /* ignore */
      }
      return defaultSave();
    },
  };
}
