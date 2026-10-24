// Kiln: D's glass screens built in Node on a small node tree (tests/fixtures/D/dom.mjs).

import { test, assert } from './lib.mjs';
import { installTreeDom } from './fixtures/D/dom.mjs';
import { results, countValue, COUNT } from '../src/ui/screens/results.js';
import { title } from '../src/ui/screens/title.js';

function buildTitle(wide, extra = {}) {
  const dom = installTreeDom();
  const saved = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: wide, addEventListener() {} });
  const picked = [];
  const nav = { count: 0, items: [], add(el, fn) { this.items.push({ el, fn }); this.count++; } };
  const api = title({
    menu: [{ id: 'play', label: 'PLAY', detail: '07  Outposts' }, { id: 'levels', label: 'LEVELS' }, { id: 'settings', label: 'SETTINGS' }],
    stats: [{ label: 'Cleared', value: '6/30' }],
    primary: { id: 'play', label: 'Continue', detail: '07  Outposts' },
    wall: { art: 'img/levels/ember.webp', label: 'Ember' },
    onSelect: (id) => picked.push(id),
    ...extra,
  }, { el: dom.root, nav });
  return { dom, el: dom.root, nav, api, picked, done() { if (api.dispose) api.dispose(); dom.restore(); globalThis.matchMedia = saved; } };
}

test('title (ART 15.6 D2): desktop wall panel with one primary Continue; phones the wall with no panel', () => {
  const d = buildTitle(true);
  try {
    const side = d.el.querySelector('.title-side');
    assert.ok(side.querySelector('.panel'), 'desktop: the wall sits in a glass panel');
    assert.ok(side.querySelector('.wall').querySelector('.wall-art'), 'the level-card art until C\'s live wall mounts');
    const prim = side.querySelectorAll('.btn').filter((b) => b.classList.contains('primary'));
    assert.equal(prim.length, 1, 'one primary button');
    assert.equal(prim[0].textContent, 'Continue');
    assert.equal(d.el.querySelectorAll('.btn').filter((b) => b.classList.contains('primary')).length, 1, 'the only primary on the screen');
    const rows = d.el.querySelectorAll('.row').map((r) => r.textContent);
    assert.ok(!rows.some((t) => t.startsWith('PLAY')), 'the menu does not repeat it');
    assert.equal(d.api.initial, d.nav.count - 1, 'Continue is selected first');
    d.nav.items[d.api.initial].fn();
    assert.deepEqual(d.picked, ['play']);
    // C's wall mounts into the box and hides the art
    let host = null;
    d.api.mountWall((slot) => { host = slot; return { dispose() {} }; });
    assert.ok(host && host.classList.contains('live'));
  } finally { d.done(); }
  const p = buildTitle(false);
  try {
    const side = p.el.querySelector('.title-side');
    assert.ok(!side.querySelector('.panel'), 'phones: no glass on glass, the wall stands alone');
    assert.ok(side.classList.contains('plain'));
    assert.equal(p.el.querySelectorAll('.btn').filter((b) => b.classList.contains('primary')).length, 0, 'PLAY stays in the menu');
    assert.ok(p.el.querySelectorAll('.row').some((r) => r.textContent.startsWith('PLAY')));
    assert.equal(p.api.initial, 0);
  } finally { p.done(); }
});

test('title: an asynchronously sized wall keeps fallback art until its first draw', () => {
  let disposed = 0;
  const t = buildTitle(true, { mountWall: () => ({ ready: false, dispose() { disposed++; } }) });
  try {
    assert.equal(t.el.querySelector('.wall').classList.contains('live'), false);
    assert.ok(t.el.querySelector('.wall-art'));
  } finally { t.done(); }
  assert.equal(disposed, 1, 'leaving title disposes the wall');
});

const navStub = () => ({ count: 0, add() { this.count++; } });

function build(data, opts = {}) {
  const dom = installTreeDom();
  const el = dom.root;
  const t0 = performance.now();
  const api = results(data, { el, nav: navStub(), reduceMotion: () => !!opts.reduceMotion });
  const hero = () => el.querySelector('.hero').querySelector('b').textContent;
  const labels = () => el.querySelectorAll('.stat').map((s) => s.querySelector('span').textContent);
  return { dom, el, api, t0, hero, labels, done() { api.dispose(); dom.restore(); } };
}

const cleared = (o = {}) => ({
  kind: 'cleared', n: 3, name: 'Kindling', score: 12400, runScore: 31850, embers: 18, bonus: 2500,
  best: 12400, newBest: true, nextLabel: 'Next  ·  04', onNext() {}, onMap() {}, ...o,
});

test('results: a new best is a tag on the hero, the number is said once', () => {
  const r = build(cleared(), { reduceMotion: true });
  try {
    assert.equal(r.hero(), '12 400');
    const text = r.el.textContent;
    assert.equal(text.split('12 400').length - 1, 1, 'the level score shows once');
    assert.equal(text.split('New best').length - 1, 1, 'one New best tag');
    assert.ok(r.el.querySelector('.hero').querySelector('.tag'), 'the tag sits on the hero label');
    assert.ok(!r.labels().some((l) => /^(New best|Best)$/.test(l)), 'no Best stat repeating the score');
  } finally { r.done(); }
  // an older best that differs from this score is a fact worth a stat
  const o = build(cleared({ score: 9000, best: 12400, newBest: false }), { reduceMotion: true });
  try {
    assert.ok(o.labels().includes('Best'), 'Best shown when it differs');
    assert.ok(!o.el.querySelector('.tag'), 'no tag');
  } finally { o.done(); }
  // a tie is not news and not a second copy of the number either
  const tie = build(cleared({ score: 12400, best: 12400, newBest: false }), { reduceMotion: true });
  try {
    assert.ok(!tie.labels().includes('Best'));
  } finally { tie.done(); }
});

test('results: the level score counts up from the score before the clear bonus (D7)', () => {
  assert.equal(countValue(9900, 12400, 0), 9900, 'still before the delay');
  assert.equal(countValue(9900, 12400, COUNT.DELAY_MS), 9900);
  assert.equal(countValue(9900, 12400, COUNT.DELAY_MS + COUNT.MS), 12400, 'settled');
  let prev = 9900;
  for (let t = 0; t <= 800; t += 16) {
    const v = countValue(9900, 12400, t);
    assert.ok(v >= prev, 'never counts down');
    prev = v;
  }
  const mid = countValue(9900, 12400, COUNT.DELAY_MS + COUNT.MS / 2);
  assert.ok(mid > 9900 + 2500 / 2, 'ease-out: past half way at half time');

  const r = build(cleared());
  try {
    assert.equal(r.hero(), '9 900', 'the 0 ms capture shows the score before the bonus');
    const late = r.el.querySelectorAll('.stat').find((s) => s.classList.contains('late'));
    assert.ok(late && /\+2 500/.test(late.textContent), 'the bonus stat lands late');
    r.dom.frame(r.t0 + COUNT.DELAY_MS + COUNT.MS / 2);
    assert.notEqual(r.hero(), '9 900', 'counting');
    r.dom.frame(r.t0 + COUNT.DELAY_MS + COUNT.MS + 20);
    assert.equal(r.hero(), '12 400', 'settled on the final score');
  } finally { r.done(); }
});

test('results: reduce motion shows the final score at once; run over never counts', () => {
  const rm = build(cleared(), { reduceMotion: true });
  try {
    assert.equal(rm.hero(), '12 400');
    assert.ok(!rm.el.querySelectorAll('.stat').some((s) => s.classList.contains('late')), 'no late bonus');
  } finally { rm.done(); }
  const over = build({ kind: 'over', n: 7, runScore: 48210, embers: 36, reached: '07 Ember', nextLabel: 'Levels', onNext() {} });
  try {
    assert.equal(over.hero(), '48 210');
    assert.ok(!over.el.querySelector('.tag'));
  } finally { over.done(); }
});
