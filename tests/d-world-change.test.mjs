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
import { runInNewContext } from 'node:vm';
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
    dom, ui, layer, watch, reads: () => reads, count: () => { reads++; },
    done() {
      dom.restore();
      if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
      if (saved.gcs === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = saved.gcs;
    },
  };
}

test('a level card is measured once, in the frame after it is added, and placed by that height', () => {
  const t = setup();
  try {
    t.ui.card(CARD);
    const el = t.watch(180);
    assert.equal(t.reads(), 0, 'no layout read while the world changes');
    assert.equal(el.style.getPropertyValue('--card-fy'), '', 'not placed yet (it shows at opacity 0 until "in")');
    t.dom.frame(16);
    assert.equal(t.reads(), 1, 'one layout read as it fades in');
    assert.ok(el.classList.contains('in'), 'fades in');
    const units = ((180 + 2 * 8) * RECT.fieldH) / RECT.h; // the box and 8 px of air round it
    const want = String((cardCentre(BANDS, units, 0, 1080) - 0) / 1080);
    assert.equal(el.style.getPropertyValue('--card-fy'), want, 'placed by its measured height and air');
    t.dom.frame(32);
    assert.equal(t.reads(), 1, 'never per frame');
  } finally { t.done(); }
});

test('a card closed or replaced before its first frame is never measured', () => {
  const t = setup();
  try {
    t.ui.card(CARD);
    const first = t.watch(180);
    t.ui.card(null); // a card closed in the frame it opens (The Core's stage cards before the level-cards fix)
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

/**
 * Production frameStep in a sandbox (as d-first-frame does): a cleared Core stage hands over to
 * the next in onWorldEnd, which opens that stage's card the way playWorld and showCard do.
 */
function stageLoop() {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const body = main.slice(main.indexOf('  function frameStep(now)'), main.indexOf('\n  function tick(', main.indexOf('  function frameStep(now)')));
  const cards = [];
  const world = (stage, phase) => ({ phase, timeScale: 1, level: { def: { stage, continues: stage < 3 ? `core-${stage + 1}` : '' } } });
  const sandbox = {
    window: { __kiln: { stats: { frames: 0, steps: 0, maxFrameMs: 0 } } },
    SIM: { DT: 1 / 120, MAX_STEPS_PER_FRAME: 8 }, STAGE_DELAY_MS: 600, END_DELAY_MS: 1500, CARD_MS: 2600,
    renderer: { stats: { frameMs: 0 }, frame: () => true },
    ui: { hud() {}, card: (d, cut) => cards.push(d ? d.kicker : cut ? 'cut' : null) },
    audio: { frame() {} }, readUiEvents() {}, updateOverloadButton() {}, controllerFill: () => ({}), clearEdges() {},
    stepWorld() {}, startAttract() {}, Math, Infinity,
  };
  sandbox.app = { world: world(1, 'cleared'), paused: false, last: 0, acc: 0, endAt: 0, attract: false, mode: 'play', cardUntil: 0 };
  sandbox.onWorldEnd = () => {
    const next = (sandbox.app.world.level.def.stage | 0) + 1;
    sandbox.app.world = world(next, 'serve');
    sandbox.app.endAt = 0;
    sandbox.ui.card({ kicker: `Level 30  ·  Stage ${next}` });
    sandbox.app.cardUntil = sandbox.now + sandbox.CARD_MS;
  };
  runInNewContext(`${body}\nthis.step = (now) => { this.now = now; return frameStep(now); };`, sandbox);
  return { sandbox, cards };
}

test("The Core's next stage keeps the card it opens: the card check reads the current world", () => {
  const { sandbox, cards } = stageLoop();
  const { app } = sandbox;
  sandbox.step(16); // stage 1 cleared: the handover is 600 ms away
  assert.equal(app.world.level.def.stage, 1);
  sandbox.step(700); // the handover frame: stage 2 starts and opens its card
  assert.equal(app.world.level.def.stage, 2);
  assert.deepEqual(cards, ['Level 30  ·  Stage 2'], 'opened and not closed in the same frame');
  assert.equal(app.cardUntil, 700 + 2600, 'its timer still runs');
  sandbox.step(2000); // still serving: the card stays
  assert.deepEqual(cards, ['Level 30  ·  Stage 2']);
  sandbox.step(3400); // CARD_MS later it fades out
  assert.deepEqual(cards, ['Level 30  ·  Stage 2', null]);
  assert.equal(app.cardUntil, 0);
  // stage 2 cleared: stage 3 shows its card the same way
  app.world.phase = 'cleared';
  sandbox.step(3500);
  sandbox.step(4200);
  assert.equal(app.world.level.def.stage, 3);
  assert.deepEqual(cards.slice(2), ['Level 30  ·  Stage 3']);
  // a launch closes it at once, cut rather than faded, so the ball never flies under it
  app.world.phase = 'play';
  sandbox.step(4216);
  assert.deepEqual(cards.slice(2), ['Level 30  ·  Stage 3', 'cut']);
});

test('a new field box under an open card places it again, two frames on, with one read', () => {
  const t = setup();
  try {
    const bands = Object.assign([[642, 932, 414, 932]], { x0: 0, x1: 720 });
    t.ui.card({ ...CARD, bands });
    const el = t.watch(200);
    t.dom.frame(16);
    assert.equal(t.reads(), 1);
    const before = el.style.getPropertyValue('--card-fy');
    // the field refits (the touch Overload button's room arrives): a smaller box, a taller card
    const rect = { ...RECT, y: 150, h: 520, w: 360 };
    t.ui.layout(rect);
    Object.defineProperty(el, 'offsetHeight', { configurable: true, get() { t.count(); return 230; } });
    assert.equal(t.reads(), 1, 'no read while the box is written');
    t.dom.frame(32);
    assert.equal(t.reads(), 1, 'nor in the next frame, which lays the new box out');
    t.dom.frame(48);
    assert.equal(t.reads(), 2, 'one read once it is laid out');
    const units = ((230 + 16) * rect.fieldH) / rect.h;
    const want = String(cardCentre(bands, units, 0, 1080) / 1080);
    assert.equal(el.style.getPropertyValue('--card-fy'), want);
    assert.notEqual(want, before);
    t.dom.frame(64);
    assert.equal(t.reads(), 2, 'never per frame');
  } finally { t.done(); }
});

test('a cut card leaves at once; a timed-out card fades', () => {
  const t = setup();
  try {
    t.ui.card(CARD);
    const a = t.watch(180);
    t.dom.frame(16);
    t.ui.card(null, true);
    assert.ok(a.classList.contains('out') && a.classList.contains('cut'), 'launch: cut');
    t.ui.card(CARD);
    const b = t.watch(180);
    t.dom.frame(32);
    t.ui.card(null);
    assert.ok(b.classList.contains('out') && !b.classList.contains('cut'), 'time out: the usual fade');
  } finally { t.done(); }
});

test('a card in horizontal mode gets its room as style writes before its one read', () => {
  const t = setup();
  try {
    const bands = Object.assign([[1032, 1080, 630, 1080]], { x0: 78, x1: 636 });
    t.ui.card({ ...CARD, bands });
    const el = t.watch(300);
    assert.equal(t.reads(), 0);
    assert.equal(el.style.getPropertyValue('--card-ax'), String(78 / 720), 'right of the paddle track');
    assert.equal(el.style.getPropertyValue('--card-bx'), String(636 / 720), 'left of the far wall');
    t.dom.frame(16);
    assert.equal(t.reads(), 1, 'still one layout read');
    const units = ((300 + 2 * 8) * RECT.fieldH) / RECT.h;
    assert.equal(el.style.getPropertyValue('--card-fy'), String(cardCentre(bands, units, 0, 1080) / 1080));
  } finally { t.done(); }
});

/**
 * main.js fieldBox, boxMoved and setWorld in a sandbox: the field box the HUD and the level card
 * are laid out on. Under a menu the canvas eases a 6% scale (renderer applyMenu); a box read off
 * it put a card opened from a screen 21 to 33 px off, and checkFieldRect then moved it while it
 * showed. A level with another ceiling frames another range of the field in the same mode.
 */
function boxLoop() {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const pick = (start, end) => {
    const a = main.indexOf(start);
    assert.ok(a > 0, `main.js has ${start.trim()}`);
    return main.slice(a, main.indexOf(end, a));
  };
  const src = [
    pick('  function fieldBox(out)', '\n  /** The touch Overload button'),
    pick('  const probe = ', '\n  /** The renderer may refit'),
    pick('  function setWorld(world, attract)', '\n  function startAttract('),
  ].join('\n');
  // the canvas's own box: the view's, scaled about its centre under a menu
  const VIEW = { left: 0, top: 0, width: 390, height: 844 };
  let scale = 1;
  const canvasBox = () => ({
    left: VIEW.left + (VIEW.width * (1 - scale)) / 2, top: VIEW.top + (VIEW.height * (1 - scale)) / 2,
  });
  const frames = { a: { x: 23, y: 211, w: 344, h: 610, fieldY: 270, fieldH: 810 } };
  let fit = frames.a;
  const sb = {
    Math,
    canvas: { getBoundingClientRect: canvasBox },
    renderer: {
      // as the renderer reads it: the canvas's (possibly scaled) box plus the fit's offsets
      fieldRect(out) {
        const r = canvasBox();
        return Object.assign(out, { x: r.left + fit.x, y: r.top + fit.y, w: fit.w, h: fit.h, fieldY: fit.fieldY, fieldH: fit.fieldH });
      },
      setWorld(w) { fit = frames[w.frame]; },
      detailInfo() {},
    },
    rect: { x: 0, y: 0, w: 0, h: 0, scale: 1 },
    layouts: 0,
    app: { tray: false, layoutMode: 'bottom' },
    trayWanted: () => false,
    audio: { setWorld() {} }, resetReader() {}, uiEvents: {}, ui: { resetHud() {} }, window: { __kiln: {} },
  };
  sb.view = { querySelector: (q) => (q === '.kiln-canvas' ? sb.canvas : null), getBoundingClientRect: () => ({ ...VIEW }) };
  runInNewContext(`${src}
    function layout() { layouts++; fieldBox(rect); app.layoutMode = app.world.level.mode; }
    this.fieldBox = fieldBox; this.setWorld = setWorld; this.layout = layout;
    this.count = () => layouts;`, sb);
  return { sb, frames, setScale: (s) => { scale = s; } };
}

test('main.js lays a level out on the box play shows: unscaled under a menu, refit for its ceiling', () => {
  const { sb, frames, setScale } = boxLoop();
  const world = (frame, mode = 'bottom') => ({ frame, level: { mode }, bus: { head: 0 } });
  sb.app.world = world('a');
  sb.layout();
  assert.deepEqual([sb.rect.x, sb.rect.y], [23, 211], 'at rest: the renderer box');
  // a results screen is up: the canvas is scaled 6%, the box play settles on is unchanged
  setScale(1.06);
  const under = sb.fieldBox({});
  assert.deepEqual([under.x, under.y, under.fieldY], [23, 211, 270], 'read under the menu scale: the rest box');
  const raw = sb.renderer.fieldRect({});
  assert.ok(Math.abs(raw.y - 211) > 20, `the canvas read alone is ${(raw.y - 211).toFixed(1)} px off`);
  // the same level again (a restart) under the menu: nothing to lay out
  const n0 = sb.count();
  sb.setWorld(world('a'), false);
  assert.equal(sb.count(), n0, 'same box and frame, the menu scale ignored: no layout');
  // the next level frames another range of the field (another ceiling) on the same screen box
  frames.b = { ...frames.a, fieldY: 240, fieldH: 840 };
  sb.setWorld(world('b'), false);
  assert.equal(sb.count(), n0 + 1, 'a player world framed afresh: laid out at once');
  assert.equal(sb.rect.fieldY, 240, 'the HUD and the level card map field units by the new frame');
  // attract worlds under the menus are not laid out for (item 23)
  frames.c = { ...frames.a, fieldY: 300, fieldH: 780 };
  sb.setWorld(world('c'), true);
  assert.equal(sb.count(), n0 + 1, 'an attract world: no layout');
});
