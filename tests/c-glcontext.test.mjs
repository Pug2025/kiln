// C: the game canvas survives a lost WebGL context (src/render/glcontext.js). Review blocker
// 2026-10-22: after the browser dropped the game's context the page showed a dead white field.

import { test, assert } from './lib.mjs';
import { watchContext, RESTORE_WAIT_MS } from '../src/render/glcontext.js';

function fakeDoc() {
  const make = (tag) => {
    const el = {
      tag, style: {}, children: [], textContent: '', listeners: {}, parent: null,
      appendChild(c) { c.parent = el; el.children.push(c); return c; },
      remove() { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null; },
      addEventListener(type, fn) { el.listeners[type] = fn; },
    };
    Object.defineProperty(el, 'textContent', {
      get() { return el._text || ''; },
      set(v) { el._text = v; el.children.length = 0; },
    });
    return el;
  };
  return { createElement: make, host: make('div') };
}

function setup() {
  const canvas = new EventTarget();
  const doc = fakeDoc();
  const timers = [];
  const calls = { lost: 0, restored: 0, reload: 0 };
  const w = watchContext(canvas, {
    host: doc.host,
    doc,
    onLost: () => calls.lost++,
    onRestored: () => calls.restored++,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = () => {}; },
    reload: () => calls.reload++,
  });
  const fire = (type) => {
    const e = new Event(type, { cancelable: true });
    canvas.dispatchEvent(e);
    return e;
  };
  return { canvas, doc, timers, calls, w, fire };
}

test('context lost: the loss is cancelled (so the browser may restore it) and drawing stops', () => {
  const { w, fire, calls, doc } = setup();
  assert.equal(w.lost, false);
  const e = fire('webglcontextlost');
  assert.equal(e.defaultPrevented, true, 'preventDefault lets the browser restore the context');
  assert.equal(w.lost, true);
  assert.equal(calls.lost, 1);
  const note = doc.host.children[0];
  assert.ok(note, 'a note shows over the canvas');
  assert.equal(note.textContent, 'Graphics restarting');
  assert.equal(note.style.display, 'flex');
});

test('context restored: drawing resumes, the note hides, the renderer rebuilds once', () => {
  const { w, fire, calls, doc, timers } = setup();
  fire('webglcontextlost');
  fire('webglcontextlost'); // a repeat loss event counts once
  assert.equal(calls.lost, 1);
  fire('webglcontextrestored');
  assert.equal(w.lost, false);
  assert.equal(calls.restored, 1);
  assert.equal(doc.host.children[0].style.display, 'none');
  // the reload offer never appears after a restore
  for (const t of timers) t.fn();
  assert.equal(w.st.offered, false);
  fire('webglcontextrestored'); // a stray restore does nothing
  assert.equal(calls.restored, 1);
});

test('context gone for good: after the wait a Reload button is offered', () => {
  const { w, fire, calls, doc, timers } = setup();
  fire('webglcontextlost');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, RESTORE_WAIT_MS);
  timers[0].fn();
  assert.equal(w.st.offered, true);
  const note = doc.host.children[0];
  assert.equal(note.textContent, 'Graphics stopped');
  const button = note.children[0];
  assert.equal(button.textContent, 'Reload');
  assert.ok(parseInt(button.style.minHeight, 10) >= 44, 'a 44 px touch target');
  button.listeners.click();
  assert.equal(calls.reload, 1);
  w.dispose();
  assert.equal(doc.host.children.length, 0, 'dispose removes the note');
  fire('webglcontextlost');
  assert.equal(calls.lost, 1, 'no listener after dispose');
});
