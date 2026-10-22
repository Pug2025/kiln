// Kiln QA (G): real input through the DevTools protocol (Input.dispatch*), so a check exercises the
// same path a player's finger, mouse or key takes: browser hit testing, Pointer Events, the game's
// listeners. Used by inputcheck.mjs and pwacheck.mjs. `page` is a lib/cdp.mjs page.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// key → [key, code, keyCode, text]
const KEYS = {
  Space: [' ', 'Space', 32, ' '],
  Enter: ['Enter', 'Enter', 13, '\r'],
  Escape: ['Escape', 'Escape', 27, ''],
  ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37, ''],
  ArrowUp: ['ArrowUp', 'ArrowUp', 38, ''],
  ArrowRight: ['ArrowRight', 'ArrowRight', 39, ''],
  ArrowDown: ['ArrowDown', 'ArrowDown', 40, ''],
  Shift: ['Shift', 'ShiftLeft', 16, ''],
  Tab: ['Tab', 'Tab', 9, ''],
};
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') KEYS[`Key${c}`] = [c.toLowerCase(), `Key${c}`, c.charCodeAt(0), c.toLowerCase()];

let shiftHeld = false;

/** Press (down) or let go (up) of one key, by its DOM `code` name ('Space', 'ArrowLeft', 'KeyP'). */
export async function keyEvent(page, name, down) {
  const k = KEYS[name];
  if (!k) throw new Error(`no key ${name}`);
  const [key, code, keyCode, text] = k;
  if (name === 'Shift') shiftHeld = down;
  const p = {
    type: down ? (text ? 'keyDown' : 'rawKeyDown') : 'keyUp',
    key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
    modifiers: shiftHeld ? 8 : 0,
  };
  if (down && text) p.text = text;
  await page.send('Input.dispatchKeyEvent', p);
}

/** A key press: down, hold `ms`, up. */
export async function key(page, name, ms = 30) {
  await keyEvent(page, name, true);
  if (ms) await sleep(ms);
  await keyEvent(page, name, false);
}

/** Mouse: move to x, y (CSS px of the viewport). */
export async function mouseMove(page, x, y, buttons = 0) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons });
}

/** Mouse button down or up at x, y. button 'left' | 'right'. */
export async function mouseButton(page, x, y, button, down) {
  const bit = button === 'right' ? 2 : 1;
  await page.send('Input.dispatchMouseEvent', {
    type: down ? 'mousePressed' : 'mouseReleased', x, y, button, buttons: down ? bit : 0, clickCount: 1,
  });
}

export async function click(page, x, y, button = 'left', holdMs = 40) {
  await mouseMove(page, x, y);
  await mouseButton(page, x, y, button, true);
  if (holdMs) await sleep(holdMs);
  await mouseButton(page, x, y, button, false);
}

const tp = (p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 });

/**
 * Touch: the full set of fingers on the glass after this change, as {id, x, y}. Fingers missing
 * from the last set lift (CDP: touchEnd listing exactly those; a touchMove without them would
 * leave them down), new ones land (touchStart with the whole set lands only the new ids), the
 * rest move. An empty list lifts every finger.
 */
export async function touches(page, points) {
  const prev = page.__touch || new Map();
  const next = new Map(points.map((p) => [p.id, p]));
  const lifted = [...prev.values()].filter((p) => !next.has(p.id));
  if (lifted.length) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: next.size ? lifted.map(tp) : [] });
  }
  const added = points.some((p) => !prev.has(p.id));
  const moved = points.some((p) => prev.has(p.id) && (prev.get(p.id).x !== p.x || prev.get(p.id).y !== p.y));
  if (next.size && (added || moved)) {
    await page.send('Input.dispatchTouchEvent', { type: added ? 'touchStart' : 'touchMove', touchPoints: points.map(tp) });
  }
  page.__touch = next;
}

/** Lift every finger (also what a fresh check starts from). */
export async function liftAll(page) {
  if (page.__touch && page.__touch.size) await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  page.__touch = new Map();
}

/** Forget the fingers without lifting them (after a touchCancel sent by hand). */
export function forgetTouches(page) {
  page.__touch = new Map();
}

/** One-finger tap. */
export async function tap(page, x, y, holdMs = 60) {
  await liftAll(page);
  await touches(page, [{ id: 1, x, y }]);
  if (holdMs) await sleep(holdMs);
  await liftAll(page);
}

/**
 * Centre of the first visible element under #ui (or `root`) whose own text matches `re`
 * (a RegExp source string), as [x, y], or null.
 */
export async function centerOfText(page, re, root = '#ui') {
  return page.eval(`(() => {
    const re = new RegExp(${JSON.stringify(re)});
    const root = document.querySelector(${JSON.stringify(root)}) || document.body;
    for (const el of root.querySelectorAll('button, a, [role=button], .btn, .row, li, div, span')) {
      const t = (el.textContent || '').trim();
      if (!re.test(t) || t.length > 60) continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) continue;
      return [Math.round(x), Math.round(y)];
    }
    return null;
  })()`);
}
