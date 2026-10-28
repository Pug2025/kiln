// Real pick/card rendering: gate metadata never becomes a second visible description.
import { test, assert } from './lib.mjs';
import { register } from 'node:module';
import { installTreeDom } from './fixtures/D/dom.mjs';
import { LEVELS, twistsFor } from '../src/levels/index.js';
import { MODS } from '../src/economy/mods.js';
import { pick } from '../src/ui/screens/pick.js';
import { card } from '../src/ui/screens/card.js';

// Node exercises the actual adapter and DOM; only the unrelated WebGL endpoints are absent.
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === '../render/renderer.js' || spec === '../render/wordmark.js')
    return { url: 'data:text/javascript,export const pickCopyTest = true;', shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const { loadAdapters } = await import('../src/app/adapters.js');

test('gate picks render one complete trade per card and keep selection IDs', async () => {
  const ext = await loadAdapters();
  const dom = installTreeDom();
  try {
    let seen = 0;
    for (const def of LEVELS) {
      if (!twistsFor(def.n).length) continue;
      const options = ext.twistsFor(def.n);
      const el = document.createElement('div');
      const actions = [];
      let chosen = null;
      pick({ options, kicker: 'Choose the next wall', onPick: (id) => { chosen = id; } },
        { el, nav: { add: (node, action) => actions.push(action) } });
      const buttons = el.querySelectorAll('.pick');
      assert.equal(buttons.length, 2);
      assert.equal(el.querySelectorAll('.fact').length, 0, `${def.id}: no repeated trade or counts`);
      buttons.forEach((button, i) => {
        assert.equal(button.textContent, options[i].name, `${def.id}: the full trade is the button's accessible text`);
        assert.ok(!/[\d+]|\b(twist|cost|payoff)\b/i.test(button.textContent));
      });
      actions[1]('key');
      assert.equal(chosen, options[1].id);
      actions[0]('key');
      assert.equal(chosen, options[1].id, 'only one choice is accepted');
      seen += buttons.length;
    }
    assert.equal(seen, 26);
  } finally { dom.restore(); }
});

test('Mod pick and selected wall card use the shared player copy', () => {
  const dom = installTreeDom();
  try {
    const el = document.createElement('div');
    pick({ options: MODS, onPick() {} }, { el, nav: { add() {} } });
    assert.deepEqual(el.querySelectorAll('.name').map((node) => node.textContent), MODS.map((mod) => mod.name));
    assert.deepEqual(el.querySelectorAll('.fact').map((node) => node.textContent), MODS.map((mod) => mod.fact));
    const trade = twistsFor(14)[0].label;
    const selected = card({ n: 14, door: trade });
    assert.equal(selected.querySelector('.adds').textContent, trade, 'the door text alone, no label before it');
    // first-use controls: one line each in the same fact line
    const help = card({ n: 7, name: 'Outposts', hint: ['Line one.', 'Line two.'], controls: true });
    const sub = help.querySelector('.sub');
    assert.equal(sub.querySelectorAll('br').length, 1);
    assert.equal(sub.textContent, 'Line one.Line two.');
    assert.equal(card({ n: 2, hint: 'One fact.' }).querySelector('.sub').textContent, 'One fact.');
    assert.equal(card({ n: 13, hint: '' }).querySelector('.sub'), null, 'an empty hint draws no line');
  } finally { dom.restore(); }
});
