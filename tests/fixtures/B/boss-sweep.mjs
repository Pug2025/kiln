// Deterministic encounter measurements, not a model of human play or discoverability.
// node tests/fixtures/B/boss-sweep.mjs --root /path/to/checkout --seeds 6 --out /tmp/bosses.json
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hereRoot = fileURLToPath(new URL('../../../', import.meta.url));

export async function measureBossRuns(root = hereRoot, seeds = 6) {
  root = resolve(root);
  const load = (p) => import(pathToFileURL(resolve(root, p)).href);
  const [{ createWorld }, { runHeadless }, { makeSystems }, { createRun }, { createSloppyRobot }, { getLevel, stagesOf }, { EV }, { createReader, next }, { BF }] = await Promise.all([
    load('src/core/world.js'), load('src/core/headless.js'), load('src/systems.js'), load('src/economy/economy.js'),
    load('tests/fixtures/B/sloppy.mjs'), load('src/levels/index.js'), load('src/core/events.js'), load('src/core/bus.js'), load('src/core/constants.js'),
  ]);
  const records = [];
  for (const n of [10, 20, 30]) for (let seed = 1; seed <= seeds; seed++) {
    const run = createRun({ seed, levelN: n });
    for (const def of stagesOf(getLevel(n))) {
      const w = createWorld({ level: def, seed: seed * 1000 + 31 * def.n + (def.stage | 0), run, systems: makeSystems() });
      const rd = createReader(w.bus, 'boss-sweep', 0);
      const m = { id: def.id, seed, firstCoreMs: null, coreHits: 0, jawContacts: 0, jawRepairs: 0, repairWaves: 0, blockedCooldown: 0, blockedGuard: 0, guards: 0, phaseAtMs: [], hazardHits: 0 };
      let lastRepairMs = -1;
      const result = runHeadless(w, createSloppyRobot(seed * 7 + def.n, { errUnits: 12 }), {
        maxSimMs: 8 * 60 * 1000,
        onStep(world) {
          while (next(rd)) {
            if (rd.type === EV.BOSS_HIT) { m.coreHits++; if (m.firstCoreMs === null) m.firstCoreMs = world.time; }
            if (rd.type === EV.BRICK_HIT && n === 10 && (world.bricks.flags[rd.id] & BF.BOSS) && world.bricks.group[rd.id] === 1) m.jawContacts++;
            if (rd.type === EV.BRICK_SPAWNED && n === 10 && (world.bricks.flags[rd.id] & BF.BOSS) && world.bricks.group[rd.id] === 1) {
              m.jawRepairs++;
              if (lastRepairMs !== world.time) { m.repairWaves++; lastRepairMs = world.time; }
            }
            if (rd.type === EV.BOSS_BLOCKED) m[rd.a ? 'blockedGuard' : 'blockedCooldown']++;
            if (rd.type === EV.BOSS_GUARD && rd.a) m.guards++;
            if (rd.type === EV.BOSS_PHASE) m.phaseAtMs.push(world.time);
            if (rd.type === EV.HAZARD_HIT) m.hazardHits++;
          }
        },
      });
      records.push({ ...m, ...result });
      if (!result.cleared) break;
    }
  }
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
  return { root, revision, dirty, seeds, controller: 'createSloppyRobot, perfect:false, aim error ±12, default minimal lag; predictive controller, not human ability', records };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
  const result = await measureBossRuns(arg('--root', hereRoot), Number(arg('--seeds', 6)));
  const out = arg('--out', '');
  if (out) writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  for (const id of [...new Set(result.records.map((r) => r.id))]) {
    const rr = result.records.filter((r) => r.id === id), times = rr.filter((r) => r.cleared).map((r) => r.simMs / 1000).sort((a, b) => a - b);
    const mid = times.length >> 1;
    const median = times.length ? (times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2).toFixed(3) : 'n/a';
    console.log(`${id}: ${times.length}/${rr.length} clear; cleared-run median ${median} s; jaw contacts ${rr.map((r) => r.jawContacts).join(',')}; repaired ${rr.map((r) => r.jawRepairs).join(',')}`);
  }
}
