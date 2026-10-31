// Headroom owns only its current GPU bundle. One next bundle may decode on CPU, never in a
// material. Common kit maps/models and offline storage have separate owners.
export const HEADROOM_KEYS = ['ember', 'blaze', 'whiteheat', 'stoker', 'crucible', 'core'];

export function headroomKey(def, wave = 0) {
  let key = def?.boss || def?.world || 'ember';
  if (key === 'overburn') key = HEADROOM_KEYS[Math.max(0, (wave | 0) - 1) % 3];
  return HEADROOM_KEYS.includes(key) ? key : 'ember';
}

/** Hooks borrow textures only: select(key, readyBundle) replaces old samplers before release, bind(key,
 * bundle) installs the current bundle atomically, detach() clears all borrowed samplers. */
export function createHeadroomAssets(h) {
  let activeKey = '', nextKey = '', active = null, next = null;
  let ready = null, load = null, disposed = false, lost = false;
  const freed = new WeakSet(), closed = new WeakSet();

  function discard(texture) {
    if (!texture || freed.has(texture)) return;
    freed.add(texture);
    texture.dispose();
    const image = texture.image;
    if (image?.close && !closed.has(image)) { closed.add(image); image.close(); }
  }

  function release(record) {
    if (!record) return;
    record.retired = true;
    for (const channel of ['far', 'mid', 'mask']) discard(record[channel]);
  }

  function retained(record) { return !disposed && !record.retired && (record === active || record === next); }

  function install(record) {
    if (!record || record !== active || !retained(record) || !record.far || lost) return;
    for (const channel of ['far', 'mid', 'mask']) {
      const texture = record[channel];
      if (texture && !record.uploaded.has(texture)) {
        // A failed eager upload can still use Three's normal first-draw path.
        try { h.upload(texture); } catch { /* normal draw retries */ }
        record.uploaded.add(texture);
      }
    }
    h.bind(record.key, record);
  }

  function request(record, channel, path) {
    Promise.resolve().then(() => retained(record) ? load(path, channel !== 'mask') : null)
      .catch(() => null).then((texture) => {
        if (!retained(record) || record.failed) { discard(texture); return; }
        record[channel] = texture;
        if (channel === 'far' && !texture) {
          record.failed = true;
          discard(record.mid); discard(record.mask);
          record.mid = record.mask = null;
          return;
        }
        install(record);
      });
  }

  function make(key) {
    if (!ready || !key) return null;
    const record = { key, far: null, mid: null, mask: null, failed: false, retired: false, uploaded: new WeakSet() };
    const prefix = `img/headroom/${key}`;
    // READY normally contains WebP far/mid and PNG glow. Respect the shipped extension rather
    // than probing missing files, and prefer the glow contract over the legacy mask alias.
    const find = stem => ['webp', 'png', 'jpg'].map(ext => `${stem}.${ext}`).find(path => ready.has(path));
    const far = find(prefix);
    if (!far) { record.failed = true; return record; }
    request(record, 'far', far);
    const mid = find(`${prefix}_mid`), mask = find(`${prefix}_glow`) || find(`${prefix}_mask`);
    if (mid) request(record, 'mid', mid);
    if (mask) request(record, 'mask', mask);
    return record;
  }

  return {
    // Called by startKit after a real frame, before unrelated common/model downloads finish.
    configure(manifest, decode) {
      if (disposed || ready) return;
      ready = manifest; load = decode;
      active = make(activeKey);
      next = make(nextKey);
    },

    activate(key) {
      if (disposed || key === activeKey) return;
      const promoted = nextKey === key;
      const target = promoted ? next : make(key);
      // A ready final replaces old samplers directly; only missing/unready art needs a
      // procedural fallback. Promotion must not paint a canvas on the Next transition.
      h.select(key, target?.far ? target : null);
      const previous = active;
      activeKey = key;
      active = target;
      if (promoted) { next = null; nextKey = ''; }
      release(previous);
      install(active);
    },

    prefetch(key) {
      if (disposed || key === activeKey || key === nextKey) return;
      release(next);
      nextKey = key;
      next = make(key);
    },

    contextLost() {
      if (disposed) return;
      lost = true;
      if (active) active.uploaded = new WeakSet();
    },

    contextRestored() {
      if (disposed) return;
      lost = false;
      install(active); // Prefetch stays CPU-only, including during hidden-scene warm-up.
    },

    // Explicit QA query only; no snapshots, arrays or counters are made during a frame.
    inspect() {
      const bundle = record => record ? { key: record.key, far: record.far, mid: record.mid, mask: record.mask } : null;
      return { activeKey, prefetchedKey: nextKey, active: bundle(active), prefetched: bundle(next) };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      h.detach();
      release(active); release(next);
      active = next = null;
    },
  };
}
