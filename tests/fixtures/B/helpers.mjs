// B's test helpers: build a world that runs only the content system (no physics, no economy) so a
// test can emit hits by hand and watch exactly what content does with them.

import { createWorld, stepWorld, setPhase } from '../../../src/core/world.js';
import { createInputFrame } from '../../../src/core/input-frame.js';
import { emit, createReader, next } from '../../../src/core/bus.js';
import { EV, EV_NAME } from '../../../src/core/events.js';
import { SRC } from '../../../src/core/constants.js';
import { createContent } from '../../../src/content/content.js';

/** A bottom-mode level from rows (12 characters each). */
export function level(rows, extra = {}) {
  return { n: 99, id: 'test', name: 'Test', world: 'overburn', kind: 'normal', mode: 'bottom', rows, drops: { rate: 0, table: {} }, rules: {}, ...extra };
}

/**
 * A content-only world. `balls` and `hazards` are faked through world.api so content can spawn.
 * @returns {{world:any, frame:any, step:(n?:number)=>void, hit:(i:number, src?:number, ball?:number, pierced?:boolean)=>void, events:()=>{name:string,id:number,x:number,y:number,a:number,b:number,c:number}[], drain:()=>void, spawned:any[], hazards:any[], drops:number[], heat:number[]}}
 */
export function contentWorld(def, opts = {}) {
  const world = createWorld({ level: def, seed: opts.seed ?? 1, systems: { content: createContent() } });
  const spawned = [];
  const hazards = [];
  const drops = [];
  world.api.spawnBall = (x, y, vx, vy) => {
    for (let i = 0; i < world.balls.length; i++) {
      const b = world.balls[i];
      if (b.alive) continue;
      Object.assign(b, { alive: true, held: false, x, y, px: x, py: y, vx, vy });
      spawned.push({ i, x, y, vx, vy });
      return i;
    }
    return -1;
  };
  world.api.spawnHazard = (x, y, vx, vy, kind, r) => {
    hazards.push({ x, y, vx, vy, kind, r });
    return hazards.length - 1;
  };
  world.api.applyDrop = (kind) => drops.push(kind);
  const heat = [];
  world.api.addHeat = (n) => heat.push(n);
  if (opts.play !== false) setPhase(world, 'play');
  const frame = createInputFrame();
  const rd = createReader(world.bus, 'test', 0);
  const seen = [];
  const drain = () => {
    while (next(rd)) seen.push({ name: EV_NAME[rd.type], id: rd.id, x: rd.x, y: rd.y, a: rd.a, b: rd.b, c: rd.c, step: world.step });
  };
  return {
    world,
    frame,
    spawned,
    hazards,
    drops,
    heat,
    step(n = 1) {
      for (let k = 0; k < n; k++) stepWorld(world, frame);
      drain();
    },
    hit(i, src = SRC.BALL, ball = 0, pierced = false) {
      emit(world.bus, EV.BRICK_HIT, i, world.bricks.x[i], world.bricks.y[i], ball, src, pierced ? 1 : 0);
      world.systems.content.resolve(world, frame);
      drain();
    },
    events() {
      drain();
      return seen;
    },
    drain,
  };
}

/** Index of the brick at a grid cell (row, col as written in the def), or −1. */
export function brickAt(world, row, col) {
  const B = world.bricks;
  for (let i = 0; i < B.count; i++) if (B.row[i] === row && B.col[i] === col) return i;
  return -1;
}

/** Names of events of some types, in order. */
export function names(list, types) {
  return list.filter((e) => types.includes(e.name)).map((e) => `${e.name}:${e.id}`);
}
