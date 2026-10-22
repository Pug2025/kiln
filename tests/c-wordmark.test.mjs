// C: the title flame (src/render/wordmark.js) keeps ONE WebGL renderer for the whole session.
// Review blocker 2026-10-22: a renderer per title mount used up the browser's WebGL slots until
// Chrome dropped the game's own context. Node cannot load three.js, so `three` resolves to a stub
// (tests/fixtures/C/three-stub.mjs) through a module hook registered in this test's worker.

import { register } from 'node:module';
import { test, assert } from './lib.mjs';

const STUB_URL = new URL('./fixtures/C/three-stub.mjs', import.meta.url).href;
const hooks = `export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(STUB_URL)}, shortCircuit: true };
  return next(spec, ctx);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const stub = await import(STUB_URL);
const { observers } = stub.installDom();
const { createWordmarkFlame, wordmarkFlameInfo } = await import('../src/render/wordmark.js');

function slot() {
  return stub.fakeElement('span', 30, 110);
}

test('title flame: 40 round trips to the title make one WebGL renderer', () => {
  const before = stub.STUB.renderers;
  for (let i = 0; i < 40; i++) {
    const host = slot();
    const f = createWordmarkFlame(host);
    f.frame(i * 0.016);
    f.dispose();
  }
  assert.equal(stub.STUB.renderers - before, before === 0 ? 1 : 0, 'one renderer for the session');
  assert.equal(wordmarkFlameInfo().renderers, 1);
  assert.equal(stub.STUB.disposed, 0, 'the shared renderer is never disposed');
});

test('title flame: the canvas moves into the newest slot; the old slot keeps a static flame', () => {
  const a = slot();
  const b = slot();
  const fa = createWordmarkFlame(a);
  assert.equal(a.children.length, 1, 'slot a holds the canvas');
  const canvas = a.children[0];
  const fb = createWordmarkFlame(b);
  assert.equal(a.children.length, 0, 'slot a gave the canvas up');
  assert.equal(b.children[0], canvas, 'slot b holds the same canvas');
  assert.match(a.style.background, /linear-gradient/, 'slot a is never a dark hole');
  assert.equal(b.style.background, '', 'the live slot draws the flame itself');
  // a stale handle neither draws nor takes the canvas back
  const r0 = stub.STUB.renders;
  fa.frame(1);
  assert.equal(stub.STUB.renders, r0, 'the old flame does not draw');
  fb.frame(1);
  assert.equal(stub.STUB.renders, r0 + 1, 'the live flame draws');
  fa.dispose();
  assert.equal(b.children[0], canvas, 'disposing the old flame leaves the new slot alone');
  fb.dispose();
  assert.equal(b.children.length, 0, 'dispose detaches the canvas');
  assert.match(b.style.background, /linear-gradient/, 'a disposed slot fades out with a static flame');
  assert.equal(wordmarkFlameInfo().mounted, false);
});

test('title flame: the resize observer follows the slot that holds the canvas', () => {
  const ro = observers[0];
  assert.ok(ro, 'one observer');
  const a = slot();
  const fa = createWordmarkFlame(a);
  assert.ok(ro.targets.has(a));
  const b = slot();
  createWordmarkFlame(b).dispose();
  assert.equal(ro.targets.size, 0, 'nothing observed after the last slot went');
  fa.dispose();
  assert.equal(observers.length, 1, 'one observer for the session');
});
