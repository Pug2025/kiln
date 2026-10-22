// Kiln: selection on the glass layer (OWNER: D). One 1 px heat ring per screen that MOVES to the
// selected item in 120 ms ease-out (R12: selection moves, panels don't). Arrow keys pick the
// nearest item in that direction (works for lists, grids and mixed layouts alike); the mouse
// selects on hover; a click or tap activates; Enter/Space activate the selected item.
// Reduce motion: the ring cross-fades to the new item instead of moving.

/** CSS px the ring sits outside a primary button: a 2 px gap, then the 1 px ring. */
const RING_OUT = 3;

/**
 * @param {HTMLElement} screenEl  the screen root (position: fixed, inset 0)
 * @param {{reduceMotion?:() => boolean}} [opts]
 */
export function createNav(screenEl, opts = {}) {
  const ring = document.createElement('i');
  ring.className = 'ring';
  ring.setAttribute('aria-hidden', 'true');
  screenEl.appendChild(ring);
  /** @type {{el:HTMLElement, act:(how:string)=>void}[]} */
  const items = [];
  let cur = -1;
  let placed = false;
  // A panel that changes size (a map tab with no grid, an image arriving) moves every item in it:
  // the ring follows at once instead of staying where the item was.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (placed) place(true); }) : null;
  let watching = false;

  function place(instant) {
    if (cur < 0 || !items[cur]) { ring.classList.remove('on'); return; }
    if (ro && !watching && screenEl.isConnected) {
      watching = true;
      screenEl.querySelectorAll('.panel').forEach((p) => ro.observe(p));
    }
    const el = items[cur].el;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const reduce = opts.reduceMotion && opts.reduceMotion();
    const jump = instant || !placed;
    if (jump) ring.classList.add('jump');
    // the primary button's heat fill would hide an inset heat ring: ring it 2 px outside instead
    const o = el.classList.contains('primary') ? RING_OUT : 0;
    ring.classList.toggle('outer', o > 0);
    ring.style.transform = `translate(${r.left - o}px, ${r.top - o}px)`;
    ring.style.width = `${r.width + 2 * o}px`;
    ring.style.height = `${r.height + 2 * o}px`;
    ring.classList.add('on');
    if (jump) {
      void ring.offsetWidth; // apply without a transition, then restore it
      ring.classList.remove('jump');
    } else if (reduce && ring.animate) {
      ring.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
    }
    placed = true;
  }

  const sound = opts.sound || (() => {});

  function select(i, how = 'key') {
    if (i < 0 || i >= items.length) return;
    const changed = i !== cur;
    if (cur >= 0 && items[cur]) items[cur].el.classList.remove('sel');
    if (changed && cur >= 0 && (how === 'key' || how === 'hover')) sound('pick');
    cur = i;
    const el = items[i].el;
    el.classList.add('sel');
    if (how === 'key' || how === 'init') {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
    }
    if (changed || !placed) place(false);
  }

  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }

  return {
    ring,
    /** Register an item. act(how) runs on click/tap ('pointer') or Enter/Space ('key'). */
    add(el, act) {
      const i = items.length;
      const run = (how) => {
        sound(el.classList.contains('off') ? 'deny' : el.dataset.sound || 'click');
        act(how);
      };
      items.push({ el, act: run });
      el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') select(i, 'hover'); });
      el.addEventListener('focus', () => { if (cur !== i) select(i, 'focus'); });
      el.addEventListener('click', () => { select(i, 'pointer'); run('pointer'); });
      return i;
    },
    select,
    get index() { return cur; },
    get count() { return items.length; },
    /** Move the selection toward (dx, dy): −1, 0 or 1 on each axis. */
    move(dx, dy) {
      if (!items.length) return;
      if (cur < 0) { select(0); return; }
      const a = center(items[cur].el);
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < items.length; i++) {
        if (i === cur || items[i].el.hidden) continue;
        const b = center(items[i].el);
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const along = vx * dx + vy * dy;
        if (along <= 2) continue;
        const perp = Math.abs(vx * dy - vy * dx);
        const score = along + perp * 2.5;
        if (score < bestScore) { bestScore = score; best = i; }
      }
      if (best >= 0) select(best);
    },
    activate() {
      if (cur >= 0 && items[cur]) items[cur].act('key');
    },
    /** Re-place the ring after a resize, a scroll or the panel's enter transition. */
    refresh() { place(true); },
    /** Stop watching the panels (the screen is closing). */
    dispose() { if (ro) ro.disconnect(); },
  };
}
