// Exercise production frameStep, firstTick and advance without constructing a GPU renderer.
import { test, assert } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { SIM } from '../src/core/constants.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const loop = main.slice(main.indexOf('  function frameStep(now)'), main.lastIndexOf('\n}'));
function page() {
  let ready = false, draws = false;
  const queue = [];
  const app = { world: null, paused: true, last: 0, acc: 0 };
  const stats = { frames: 0, steps: 0, maxFrameMs: 0 };
  const win = { __kiln: { stats } };
  const sandbox = {
    window: win, app, SIM,
    renderer: { stats: { calls: 100, frameMs: 0 }, frame: () => draws },
    ui: { hud() {} }, audio: { frame() {} }, readUiEvents() {}, updateOverloadButton() {},
    startup: { ready() { ready = true; }, stage() {} },
    requestAnimationFrame: (fn) => queue.push(fn),
  };
  runInNewContext(loop, sandbox);
  return { app, win, queue,
    get ready() { return ready; }, set draws(value) { draws = value; },
    frame(now = 10) { queue.shift()(now); },
  };
}

test('pending fixture/null-world frames keep QA advance available without claiming a successful frame', () => {
  const p = page();
  assert.equal(typeof p.win.__kiln.advance, 'function');
  p.frame();
  p.win.__kiln.advance(3);
  assert.equal(p.ready, false);
  assert.equal(p.queue.length, 1, 'one first-frame loop remains scheduled');
  p.app.world = {};
  p.win.__kiln.advance(1);
  assert.equal(p.ready, false, 'a skipped draw cannot use stale renderer stats as readiness');
  p.draws = true;
  p.win.__kiln.advance(1);
  assert.equal(p.ready, true, 'a held-rAF harness can supply the first actual draw');
});

test('the first native actual draw marks ready and hands over to exactly one ordinary frame loop', () => {
  const p = page();
  p.app.world = {};
  p.frame();
  assert.equal(p.ready, false);
  p.draws = true;
  p.frame(20);
  assert.equal(p.ready, true);
  assert.equal(p.queue.length, 1);
  assert.equal(p.queue[0].name, 'tick');
});
