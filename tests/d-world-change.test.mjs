// Item 23: the frame that ends one world and starts the next (The Core's stage changes, a new
// attract world) does each piece of work once.
// - The level card is placed with one layout read in the frame after it is added (when the page is
//   already laid out), never by forcing a layout in the middle of the world change, and a card
//   closed before then is never measured. It lands where it did before.
// - The field box the card is placed by is set on the card layer, so a new box restyles the card
//   and not the whole interface.
// - main.js draws an ending world's last frame before the next world takes over, so the renderer
//   no longer swaps back to the old world in that frame and forward again in the next.
import { test, assert } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { installTreeDom } from './fixtures/D/dom.mjs';
import { createUI } from '../src/ui/ui.js';
import { cardCentre } from '../src/ui/layout.js';

const RECT = { x: 11.33, y: 168.99, w: 389.34, h: 577, scale: 0.54, fieldX: 0, fieldY: 0, fieldW: 720, fieldH: 1080 };
const BANDS = [[90, 380], [700, 940]];
const CARD = { n: 30, kicker: 'Level 30  ·  Stage 2', name: 'The Core', kind: 'boss', adds: '', door: '', hint: 'The paddle moves on the left.', controls: false, bands: BANDS };

function setup() {
  const dom = installTreeDom();
  const saved = { window: globalThis.window, gcs: globalThis.getComputedStyle };
  globalThis.window = { innerWidth: 412, innerHeight: 915, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  globalThis.document.body = globalThis.document.createElement('body');
  globalThis.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' });
  const ui = createUI(dom.root, {});
  ui.layout({ ...RECT });
  const layer = dom.root.querySelector('.cards');
  let reads = 0;
  /** The next card's height: counts every layout read of it. */
  const watch = (h) => {
    const all = layer.querySelectorAll('.card'); // closed cards stay 120 ms for their fade
    const el = all[all.length - 1];
    Object.defineProperty(el, 'offsetHeight', { configurable: true, get() { reads++; return h; } });
    return el;
  };
  return {
    dom, ui, layer, watch, reads: () => reads,
    done() {
      dom.restore();
      if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
      if (saved.gcs === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = saved.gcs;
    },
  };
}

test('a level card is measured once, in the frame after it is added, and placed as before', () => {
  const t = setup();
  try {
    t.ui.card(CARD);
    const el = t.watch(180);
    assert.equal(t.reads(), 0, 'no layout read while the world changes');
    assert.equal(el.style.getPropertyValue('--card-fy'), '', 'not placed yet (it shows at opacity 0 until "in")');
    t.dom.frame(16);
    assert.equal(t.reads(), 1, 'one layout read as it fades in');
    assert.ok(el.classList.contains('in'), 'fades in');
    const units = (180 * RECT.fieldH) / RECT.h;
    const want = String((cardCentre(BANDS, units, 0, 1080) - 0) / 1080);
    assert.equal(el.style.getPropertyValue('--card-fy'), want, 'the same placement the old code computed');
    t.dom.frame(32);
    assert.equal(t.reads(), 1, 'never per frame');
  } finally { t.done(); }
});

test('a card closed or replaced before its first frame is never measured', () => {
  const t = setup();
  try {
    t.ui.card(CARD);
    const first = t.watch(180);
    t.ui.card(null); // The Core's stage card today: closed in the frame it opens
    t.dom.frame(16);
    assert.equal(t.reads(), 0, 'a closed card costs no layout read');
    assert.ok(!first.classList.contains('in') && first.classList.contains('out'), 'it stays hidden');
    t.ui.card(CARD);
    const second = t.watch(200);
    t.ui.card({ ...CARD, kicker: 'Level 30  ·  Stage 3' });
    const third = t.watch(210);
    assert.notEqual(second, third);
    t.dom.frame(32);
    assert.equal(t.reads(), 1, 'only the card that is still up is measured');
    assert.ok(third.classList.contains('in') && !second.classList.contains('in'));
  } finally { t.done(); }
});

test('the field box is set on the card layer, not on the interface root', () => {
  const t = setup();
  try {
    for (const k of ['--field-x', '--field-y', '--field-w', '--field-h']) {
      assert.equal(t.dom.root.style.getPropertyValue(k), '', `${k} is not on the root (it would restyle the whole interface)`);
      assert.equal(t.layer.style.getPropertyValue(k), `${RECT[k.slice(-1)]}px`, `${k} is on the card layer`);
    }
    const css = ['app', 'hud', 'screens', 'tokens'].map((f) => readFileSync(new URL(`../css/${f}.css`, import.meta.url), 'utf8'))
      .join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const users = css.split('}').filter((rule) => /var\(--field-[xywh]/.test(rule)).map((rule) => rule.split('{')[0].trim());
    assert.deepEqual(users, ['.card'], 'only the level card (inside the card layer) reads the field box');
  } finally { t.done(); }
});

test('main.js draws an ending world before it hands over, and each frame draws once', () => {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const at = src.indexOf('function frameStep(');
  assert.ok(at > 0);
  const body = src.slice(at, src.indexOf('\n  function tick(', at));
  const draws = [...body.matchAll(/renderer\.frame\((\w+),/g)];
  assert.equal(draws.length, 2, 'two draw sites: the handover and the ordinary frame');
  // the handover: the old world (w) is drawn before startAttract / onWorldEnd replace it
  const end = body.indexOf('onWorldEnd()'), attract = body.indexOf('startAttract()');
  assert.equal(draws[0][1], 'w');
  assert.ok(draws[0].index < attract && draws[0].index < end, 'the ending world is drawn before the next one takes over');
  const guard = body.slice(body.lastIndexOf('if (', draws[0].index), draws[0].index);
  assert.match(guard, /app\.attract/, 'for a new attract world');
  assert.match(guard, /cleared/, 'and for a cleared Core stage');
  assert.match(guard, /continues/, '(a stage that continues)');
  assert.match(body.slice(draws[0].index, end), /drawn = true/);
  // the ordinary draw: the current world, unless the handover drew this frame already
  const rest = body.slice(end);
  const cur = /const (\w+) = app\.world;/.exec(rest);
  assert.ok(cur, 'the world is read again after the world end');
  assert.equal(draws[1][1], cur[1], 'the ordinary frame draws the current world');
  assert.match(rest, new RegExp(`if \\(!drawn\\) rendered = renderer\\.frame\\(${cur[1]},`), 'at most one draw a frame');
  for (const call of ['ui.hud(', 'audio.frame(', 'updateOverloadButton(']) {
    assert.match(rest, new RegExp(`${call.replace('(', '\\(')}${cur[1]}\\b`), `${call} follows the current world`);
  }
});
