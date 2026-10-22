// Kiln: the game canvas's WebGL context, lost and restored (OWNER: C). No three.js import, so
// Node can test it with a fake canvas (tests/c-glcontext.test.mjs).
//
// A browser drops a WebGL context when the GPU resets, when the page sits in the background on a
// phone, or when too many contexts are open (review 2026-10-22: a title flame per visit used up the
// slots and the game's own canvas went white). three.js re-creates its GPU state on
// 'webglcontextrestored' as long as the page called preventDefault() on the loss; this module does
// that, tells the renderer to stop drawing, and shows a short line over the dark canvas. If the
// context has not come back after RESTORE_WAIT_MS it offers a reload (the run is saved at every level
// start, so a reload loses at most the level in play).

export const RESTORE_WAIT_MS = 2500;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   host?: HTMLElement,
 *   onLost?: () => void,
 *   onRestored?: () => void,
 *   setTimeout?: (fn: () => void, ms: number) => any,
 *   clearTimeout?: (id: any) => void,
 *   reload?: () => void,
 *   doc?: Document,
 * }} [o]
 */
export function watchContext(canvas, o = {}) {
  const st = { lost: false, losses: 0, restores: 0, offered: false };
  const later = o.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const cancel = o.clearTimeout || ((id) => clearTimeout(id));
  const doc = o.doc || (typeof document !== 'undefined' ? document : null);
  let timer = null;
  let note = null;

  function showNote(offer) {
    if (!o.host || !doc) return;
    if (!note) {
      note = doc.createElement('div');
      note.className = 'kiln-gl-note';
      Object.assign(note.style, {
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 18px',
        background: 'rgba(15, 13, 12, 0.85)', color: 'rgba(255, 255, 255, 0.86)',
        font: '500 16px "Inter Tight", system-ui, sans-serif', borderRadius: '10px',
        border: '1px solid rgba(255, 255, 255, 0.12)', zIndex: '5',
      });
      o.host.appendChild(note);
    }
    note.textContent = offer ? 'Graphics stopped' : 'Graphics restarting';
    if (offer) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = 'Reload';
      Object.assign(b.style, {
        minWidth: '88px', minHeight: '44px', font: 'inherit', color: 'inherit', cursor: 'pointer',
        background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '8px',
      });
      b.addEventListener('click', () => (o.reload ? o.reload() : location.reload()));
      note.appendChild(b);
    }
    note.style.display = 'flex';
  }

  function hideNote() {
    if (note) note.style.display = 'none';
  }

  function onLost(e) {
    // without this the browser never restores the context
    if (e && e.preventDefault) e.preventDefault();
    if (st.lost) return;
    st.lost = true;
    st.losses++;
    st.offered = false;
    if (o.onLost) o.onLost();
    showNote(false);
    if (timer !== null) cancel(timer);
    timer = later(() => {
      timer = null;
      if (!st.lost) return;
      st.offered = true;
      showNote(true);
    }, RESTORE_WAIT_MS);
  }

  function onRestored() {
    if (!st.lost) return;
    st.lost = false;
    st.restores++;
    if (timer !== null) { cancel(timer); timer = null; }
    hideNote();
    if (o.onRestored) o.onRestored();
  }

  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  return {
    st,
    get lost() {
      return st.lost;
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      if (timer !== null) { cancel(timer); timer = null; }
      if (note) { note.remove(); note = null; }
    },
  };
}
