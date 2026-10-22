// Kiln: the renderer gallery (OWNER: C, debug only; never linked from the game).
// Every brick type in each field mode, with buttons that fake the sim's presentation inputs
// (events, fx hints, effects) so each look can be checked without waiting for A/B/E.
//   src/debug/gallery.html?mode=bottom|left|ring&bot=1&debug=1
// It writes world state on purpose (it stands in for the systems); the game never does this.

import { SIM, RING, GRID, DROP_COUNT } from '../core/constants.js';
import { EV, PHASE_CODE } from '../core/events.js';
import { emit } from '../core/bus.js';
import { createWorld, stepWorld } from '../core/world.js';
import { createInputFrame, clearEdges } from '../core/input-frame.js';
import { makeSystems } from '../systems.js';
import { createRobot } from '../sim/robot.js';
import { createRenderer } from '../render/renderer.js';

const params = new URLSearchParams(location.search);

const LEVELS = {
  bottom: {
    n: 99, id: 'gallery-bottom', name: 'Gallery', world: 'ember', kind: 'normal', mode: 'bottom',
    rows: [
      '............', '............', '............', '............', '............',
      '............', '............', '............', '............',
      'XAAAAAAAAAAX',
      'cccccccccccc',
      '234567892345',
      'bbEbbbbbEbbb',
      'aaGGGaa??aaa',
      'a(aCCCa)aaaa',
      'aaaC*Caaaaaa',
      'aaaCCCaa[aa]',
      '............',
    ],
    motion: [{ row: 13, speed: 60 }],
    drops: { rate: 0.5 },
  },
  left: {
    n: 98, id: 'gallery-left', name: 'Gallery', world: 'blaze', kind: 'normal', mode: 'left',
    rows: Array.from({ length: 18 }, (_, r) => {
      const fill = r === 4 ? '............cbaa(aaaa)XA' : ['............cbaaGG?2345E', '............cbaaaaaaaaXA', '............cbaaCCCaaaAA'][r % 3];
      return r < 2 || r > 15 ? '........................' : fill;
    }),
  },
  ring: {
    n: 97, id: 'gallery-ring', name: 'Gallery', world: 'whiteheat', kind: 'normal', mode: 'ring',
    rows: Array.from({ length: 16 }, (_, r) => {
      let s = '';
      for (let c = 0; c < 16; c++) {
        const g = GRID.ring;
        const x = g.x0 + (c + 0.5) * g.cw, y = g.y0 + (r + 0.5) * g.ch;
        const d = Math.hypot(x - RING.CX, y - RING.CY);
        s += d > g.rMax ? '.' : d < 50 ? 'c' : d < 90 ? 'A' : d < 140 ? 'c' : d < 190 ? 'b' : (c + r) % 5 === 0 ? '3' : 'a';
      }
      return s;
    }),
  },
};

async function boot() {
  const stage = document.getElementById('stage');
  const renderer = await createRenderer(stage, { debug: params.get('debug') !== '0' });
  let mode = params.get('mode') || 'bottom';
  let world = null;
  const robot = createRobot();
  const frame = createInputFrame();
  let acc = 0;
  let last = performance.now();
  let paused = params.get('still') === '1';
  const rect = { x: 0, y: 0, w: 0, h: 0, scale: 1 };
  const rectEl = document.getElementById('rect');

  function start(m) {
    mode = m;
    world = createWorld({ level: LEVELS[m], seed: 7, systems: makeSystems() });
    renderer.setWorld(world);
    window.__gallery.world = world;
    layout();
  }
  function layout() {
    renderer.fieldRect(rect);
    Object.assign(rectEl.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px` });
  }

  const btn = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', fn);
    document.getElementById('bar').appendChild(b);
  };
  const live = () => {
    const B = world.bricks;
    for (let k = 0; k < 64; k++) {
      const i = Math.floor(Math.random() * B.count);
      if (B.alive[i] && (B.flags[i] & 2)) return i;
    }
    return -1;
  };
  btn('Bottom', () => start('bottom'));
  btn('Left', () => start('left'));
  btn('Ring', () => start('ring'));
  btn('Hit', () => { const i = live(); if (i >= 0) world.api.damageBrick(i, 0, 0, -1); emit(world.bus, EV.BRICK_DAMAGED, i, world.bricks.x[i], world.bricks.y[i], 1, 0); });
  btn('Break', () => { const i = live(); if (i >= 0) world.api.breakBrick(i, 0, -1); });
  btn('Burn row', () => {
    // the lowest row burns off at the danger line (BRICK_BURNT: no fragments, no embers)
    const B = world.bricks;
    let low = -1;
    for (let i = 0; i < B.count; i++) if (B.alive[i] && B.y[i] > low) low = B.y[i];
    for (let i = 0; i < B.count; i++) {
      if (!B.alive[i] || Math.abs(B.y[i] - low) > 1) continue;
      B.alive[i] = 0;
      emit(world.bus, EV.BRICK_BURNT, i, B.x[i], B.y[i], B.type[i]);
    }
    B.version++;
  });
  btn('Paddle', () => emit(world.bus, EV.PADDLE_HIT, 0, world.paddle.x, world.paddle.y - 10, 0, 0, 0));
  btn('Perfect', () => { emit(world.bus, EV.PADDLE_HIT, 0, world.paddle.x, world.paddle.y - 10, 0, 1, 0); emit(world.bus, EV.PERFECT_HIT, 0, world.paddle.x, world.paddle.y - 10); });
  btn('Lose', () => emit(world.bus, EV.BALL_LOST, 0, world.paddle.x, 1080));
  btn('Combo', () => { world.econ.mult = world.econ.mult >= 5 ? 1 : world.econ.mult >= 3 ? 5 : world.econ.mult + 1; });
  btn('Last life', () => { world.fx.lastLife = !world.fx.lastLife; });
  btn('Clear', () => emit(world.bus, EV.PHASE, 0, 0, 0, PHASE_CODE.cleared, PHASE_CODE.play));
  btn('Fire', () => { world.effects.fire = !world.effects.fire; });
  btn('Fog', () => { world.effects.fog = world.effects.fog > 0 ? 0 : 1; });
  btn('Dark', () => { world.fx.dark = world.fx.dark > 0 ? 0 : 1; });
  btn('Ghosts', () => { world.level.rules.ghosts = !world.level.rules.ghosts; });
  btn('Drops', () => { for (let k = 0; k < DROP_COUNT; k++) world.api.spawnDrop(60 + (k % 6) * 120, 500 + Math.floor(k / 6) * 60, k); });
  btn('Embers', () => world.api.spawnEmbers(360, 600, 12));
  for (const id of ['stoker', 'crucible', 'core']) {
    btn(id[0].toUpperCase() + id.slice(1), () => {
      const b = world.boss;
      const on = !(b.active && b.id === id);
      Object.assign(b, { active: on, id, x: 360, y: 330, px: 360, py: 330, angle: 0, pangle: 0, open: 0, phase: 1 });
    });
  }
  btn('Spin', () => { const b = world.boss; b.pangle = b.angle; b.angle += 0.3; b.open = b.open > 0.5 ? 0 : 1; });
  btn('Hazards', () => { for (let k = 0; k < 4; k++) world.api.spawnHazard(150 + k * 140, 500, 0, 120, k % 2, 10); });
  btn('Lasers', () => { for (let k = 0; k < 4; k++) world.api.spawnBall && world.lasers[k] && Object.assign(world.lasers[k], { alive: true, x: 200 + k * 100, y: 800, px: 200 + k * 100, py: 800, vx: 0, vy: -900 }); });
  btn('Sentries', () => { for (let k = 0; k < 3; k++) Object.assign(world.sentries[k], { alive: !world.sentries[k].alive, kind: 0, x: 200 + k * 160, y: 560, px: 200 + k * 160, py: 560, r: 16, hp: 2, eye: Math.PI / 2 }); });
  btn('Menu', () => { paused = !paused; renderer.setMenu(paused); });
  btn('Pause sim', () => { paused = !paused; });

  // step(n, ms): drive frames by hand (a background tab gets no requestAnimationFrame)
  window.__gallery = { renderer, world: null, start, step(n = 1, ms = 16.7) { for (let k = 0; k < n; k++) advance(ms / 1000); } };
  window.addEventListener('resize', () => { renderer.resize(); layout(); });
  start(mode);

  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    advance(dt);
    requestAnimationFrame(tick);
  }
  function advance(dt) {
    if (!paused) {
      acc += dt * world.timeScale;
      let n = 0;
      while (acc >= SIM.DT && n < SIM.MAX_STEPS_PER_FRAME) {
        robot.fill(frame, world);
        stepWorld(world, frame);
        clearEdges(frame);
        acc -= SIM.DT;
        n++;
      }
      if (world.phase === 'over' || world.phase === 'cleared') start(mode);
    }
    renderer.frame(world, acc / SIM.DT, dt);
  }
  requestAnimationFrame(tick);
}

boot().catch((e) => console.error('[gallery]', e));
