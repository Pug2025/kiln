// Event-driven HUD facts must survive the score changes happening in the same rendered frame.
import { test, assert } from './lib.mjs';
import { installTreeDom } from './fixtures/D/dom.mjs';
import { createHud } from '../src/ui/hud.js';
import { DROP, DROP_COUNT } from '../src/core/constants.js';

const world = () => ({
  run: { score: 0, lives: 3 },
  econ: { mult: 1, effectMs: new Float64Array(DROP_COUNT) },
  level: { n: 1, def: { name: 'Ignition' }, rules: { heat: false }, timeLeftMs: -1 },
  fx: {}, effects: {}, boss: {},
});

function build() {
  const dom = installTreeDom();
  const hud = createHud(dom.root);
  const key = (name) => hud.el.querySelectorAll('[data-k]').find((n) => n.dataset.k === name);
  const w = world();
  hud.update(w, 0);
  return { dom, hud, key, w };
}

test('HUD: a fact survives simultaneous scoring, expires, and resets with a new world', () => {
  const { dom, hud, key, w } = build();
  try {
    hud.note('Free miss', 100);
    w.run.score = 20;
    hud.update(w, 100);
    assert.equal(key('delta').textContent, 'Free miss', 'same-frame score cannot erase the fact');
    w.run.score = 40;
    hud.update(w, 1600);
    assert.equal(key('delta').textContent, 'Free miss');
    hud.update(w, 1701);
    assert.ok(!key('delta').classList.contains('show'), 'the fact has a bounded lifetime');
    w.run.score = 60;
    hud.update(w, 1800);
    assert.equal(key('delta').textContent, '+20', 'score feedback returns after the fact');
    hud.note('Free miss', 1900);
    hud.reset();
    hud.update(w, 1900);
    w.run.score = 70;
    hud.update(w, 1901);
    assert.equal(key('delta').textContent, '+10', 'a previous world cannot hold the note lock');
  } finally { dom.restore(); }
});

test('HUD: opening power cells have a name and effect; repeated spawns do not repeat the fact', () => {
  const { dom, hud, key, w } = build();
  try {
    hud.openingDrop(DROP.WIDE, false, 0, 100);
    assert.equal(key('dropName').textContent, 'Wide drop');
    assert.equal(key('dropEffect').textContent, 'Wider paddle');
    assert.equal(key('dropFact').hidden, false);
    assert.equal(key('dropFact').getAttribute('role'), 'status');
    assert.equal(key('dropFact').getAttribute('aria-atomic'), 'true');
    hud.update(w, 2701);
    assert.equal(key('dropFact').hidden, true);
    hud.openingDrop(DROP.WIDE, false, 0, 2800);
    assert.equal(key('dropFact').hidden, true, 'a repeated cell does not renew the introduction');
    hud.openingDrop(DROP.WIDE, true, 1, 2900);
    w.econ.effectMs[DROP.WIDE] = 10000;
    hud.update(w, 2900);
    assert.equal(key('dropName').textContent, 'Wide caught');
    hud.update(w, 5501);
    assert.equal(key('dropFact').hidden, true);
    assert.ok(!hud.el.querySelector('.hud-heat').classList.contains('drop-fact-on'));
    assert.equal(key('fxRow').children[DROP.WIDE].hidden, false, 'timed power remains visible after the fact');
    hud.reset();
    hud.openingDrop(DROP.WIDE, false, 0, 5600);
    assert.equal(key('dropFact').hidden, false, 'a fresh attempt gets its own introduction');
  } finally { dom.restore(); }
});

test('HUD: Multi catch reports the actual extra balls even though Multi has no timer', () => {
  const { dom, hud, key, w } = build();
  try {
    hud.openingDrop(DROP.MULTI, false, 0, 100);
    assert.equal(key('dropName').textContent, 'Multi drop');
    assert.equal(key('dropEffect').textContent, 'Extra balls');
    hud.openingDrop(DROP.MULTI, true, 2, 1000);
    hud.update(w, 1000);
    assert.equal(key('dropName').textContent, 'Multi caught');
    assert.equal(key('dropEffect').textContent, '2 extra balls');
    assert.equal(key('fxRow').children[DROP.MULTI].hidden, true, 'no invented timed effect');
    hud.openingDrop(DROP.MULTI, true, 0, 1100);
    assert.equal(key('dropEffect').textContent, 'No extra balls', 'never promises a split the sim could not make');
    hud.reset();
    hud.openingDrop(DROP.SHRINK, false, 0, 1200);
    assert.equal(key('dropFact').hidden, true, 'the opening fact does not introduce unrelated powers');
  } finally { dom.restore(); }
});
