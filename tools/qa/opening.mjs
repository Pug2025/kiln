#!/usr/bin/env node
// Reproduce opening pacing with the real content, physics and economy systems.
// node tools/qa/opening.mjs --root /path/to/checkout --seeds 12 --out tools/qa/out/opening.json
// Add --levels-root /path/to/baseline to isolate simulation changes with the old formations.
// Both robot modes aim and collect pickups; perfect:false omits the timed speed boost.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Full-system robot samples. Times use simulation seconds, including serve and clear ceremony. */
export async function measureOpening({ root = HERE, levelsRoot = root, seeds = [1, 2, 3], levels = [1, 2], perfectModes = [false, true] } = {}) {
  const moduleAt = (path) => import(pathToFileURL(resolve(root, path)).href);
  const [{ createWorld }, { runHeadless }, { makeSystems }, { createRobot }, { createReader, next }, { EV }, { BRICK, DROP_NAMES, SIM }] = await Promise.all([
    'src/core/world.js', 'src/core/headless.js', 'src/systems.js', 'src/sim/robot.js',
    'src/core/bus.js', 'src/core/events.js', 'src/core/constants.js',
  ].map(moduleAt));
  const { getLevel } = await import(pathToFileURL(resolve(levelsRoot, 'src/levels/index.js')).href);
  const samples = [];
  for (const n of levels) for (const perfect of perfectModes) for (const seed of seeds) {
    const world = createWorld({ level: getLevel(n), seed, systems: makeSystems() });
    const rd = createReader(world.bus, 'opening', 0);
    const drops = [];
    const catches = [];
    const carriers = [];
    const effects = [];
    let maxBalls = 0, maxPaddleWidth = world.paddle.w;
    let formationTop = Infinity;
    for (let i = 0; i < world.bricks.count; i++) if (world.bricks.alive[i]) {
      formationTop = Math.min(formationTop, world.bricks.y[i] - world.bricks.h[i] / 2);
    }
    const idleAboveMs = new Float64Array(world.balls.length);
    const hitThisStep = new Uint8Array(world.balls.length);
    let overtopMs = 0, maxUnproductiveOvertopMs = 0;
    const result = runHeadless(world, createRobot({ perfect }), {
      maxSimMs: 180000,
      onStep(w) {
        maxBalls = Math.max(maxBalls, w.balls.filter((b) => b.alive).length);
        maxPaddleWidth = Math.max(maxPaddleWidth, w.paddle.w);
        hitThisStep.fill(0);
        while (next(rd)) {
          const seconds = Number((w.time / 1000).toFixed(3));
          if (rd.type === EV.DROP_SPAWNED) drops.push({ seconds, kind: DROP_NAMES[rd.a] });
          if (rd.type === EV.DROP_CAUGHT) catches.push({ seconds, kind: DROP_NAMES[rd.a] });
          if (rd.type === EV.EFFECT_ON) effects.push({ seconds, kind: DROP_NAMES[rd.a], count: rd.c });
          if (rd.type === EV.BRICK_BROKEN && rd.a === BRICK.CARRIER) carriers.push(seconds);
          if (rd.type === EV.BRICK_HIT && rd.a >= 0) hitThisStep[rd.a] = 1;
        }
        let anyAbove = false;
        for (let i = 0; i < w.balls.length; i++) {
          const ball = w.balls[i];
          const above = ball.alive && !ball.held && ball.y + ball.r < formationTop;
          anyAbove ||= above;
          if (above && !hitThisStep[i]) {
            idleAboveMs[i] += SIM.DT_MS;
            maxUnproductiveOvertopMs = Math.max(maxUnproductiveOvertopMs, idleAboveMs[i]);
          } else idleAboveMs[i] = 0;
        }
        if (anyAbove) overtopMs += SIM.DT_MS;
      },
    });
    samples.push({ n, perfect, seed, clearSeconds: Number((result.simMs / 1000).toFixed(3)), cleared: result.cleared,
      livesLost: result.livesLost, nudges: result.nudges, maxBalls, maxPaddleWidth, formationTop,
      overtopSeconds: Number((overtopMs / 1000).toFixed(3)),
      maxUnproductiveOvertopSeconds: Number((maxUnproductiveOvertopMs / 1000).toFixed(3)), carriers, drops, catches, effects });
  }
  return samples;
}

export function summarizeOpening(samples) {
  const summary = [];
  for (const n of [...new Set(samples.map((s) => s.n))]) for (const perfect of [false, true]) {
    const group = samples.filter((s) => s.n === n && s.perfect === perfect);
    if (!group.length) continue;
    const times = group.map((s) => s.clearSeconds).sort((a, b) => a - b);
    const median = (values) => {
      const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    const firstDrop = group.flatMap((s) => s.drops.length ? [s.drops[0].seconds] : []);
    const firstCatch = group.flatMap((s) => s.catches.length ? [s.catches[0].seconds] : []);
    summary.push({ n, perfect, samples: group.length, cleared: group.filter((s) => s.cleared).length,
      minSeconds: times[0], medianSeconds: Number(median(times).toFixed(3)), maxSeconds: times.at(-1),
      releases: firstDrop.length, latestFirstReleaseSeconds: firstDrop.length ? Math.max(...firstDrop) : null,
      catches: firstCatch.length, medianFirstCatchSeconds: firstCatch.length ? Number(median(firstCatch).toFixed(3)) : null,
      latestFirstCatchSeconds: firstCatch.length ? Math.max(...firstCatch) : null,
      medianOvertopSeconds: Number(median(group.map((s) => s.overtopSeconds)).toFixed(3)),
      longestUnproductiveOvertopSeconds: Math.max(...group.map((s) => s.maxUnproductiveOvertopSeconds)) });
  }
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
  const root = resolve(value('--root', HERE));
  const levelsRoot = resolve(value('--levels-root', root));
  const count = Number(value('--seeds', 12));
  if (!Number.isInteger(count) || count < 1) throw new Error('--seeds must be a positive integer');
  const samples = await measureOpening({ root, levelsRoot, seeds: Array.from({ length: count }, (_, i) => i + 1) });
  const report = { label: value('--label', ''), revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
    levelsRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: levelsRoot, encoding: 'utf8' }).trim(),
    levelsWorkingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: levelsRoot, encoding: 'utf8' }).trim()),
    method: 'Fresh full-system worlds, seeds 1..N, robot perfect:false and true, pickups enabled; simulation seconds include serve and last-brick ceremony. These are repeatable controller comparisons, not human playtime estimates.',
    travelMethod: 'Above means the entire live ball is above the highest starting brick edge. Overtop time counts simulation steps with any ball above that edge; longest unproductive span is per ball, reset on brick contact or return below that edge.',
    summary: summarizeOpening(samples), samples };
  const out = value('--out', '');
  if (out) { const path = resolve(out); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(out ? { out: resolve(out), ...report, samples: undefined } : report, null, 2));
}
