#!/usr/bin/env node
// Kiln: the test gate. Nothing is merged to main unless `node tests-node.mjs` passes.
// OWNER after day one: G (anyone may add test files; see team/FILEMAP.md).
//
//   node tests-node.mjs                 every tests/*.test.mjs
//   node tests-node.mjs a-              only files whose name contains "a-" (old positional filter)
//   node tests-node.mjs --grep tunnel   only tests whose name contains "tunnel" (any case)
//   node tests-node.mjs --list          list files and test names, run nothing
//   node tests-node.mjs --bail          stop starting new files after the first failure
//   node tests-node.mjs --jobs 1        files one at a time (default: up to 4 files in parallel)
//   node tests-node.mjs --json out.json also write a machine-readable report
//
// Each test file runs in its own worker thread, tests inside a file run one at a time in file
// order (tests/lib.mjs). A test that hangs is failed after its timeout (default 120 s,
// KILN_TEST_TIMEOUT_MS or `{ timeout }` on the test). A test stuck in a synchronous loop cannot
// be interrupted from inside, so the worker is terminated and the file resumes at the next test.
// A file fails as a whole when it throws while loading, exits while loading (process.exit at the
// top level, or a crash), does not finish loading within the timeout, or registers no test.
// Exit code 1 if anything failed, no file matched, or --grep matched no test.

import { readdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const TIMEOUT_MS = Number(process.env.KILN_TEST_TIMEOUT_MS || 120000);
const LIB_URL = new URL('./tests/lib.mjs', import.meta.url).href; // one lib instance for every test dir
const HARD_GRACE_MS = Number(process.env.KILN_TEST_GRACE_MS || 5000); // after the soft timeout, the worker gets this long
const LOAD_TIMEOUT_MS = Number(process.env.KILN_TEST_LOAD_MS || TIMEOUT_MS); // importing a file (its top level)

if (isMainThread) await main();
else await runInWorker(workerData);

// ------------------------------------------------------------------------------------ main thread

function parseArgs(argv) {
  const o = { filter: '', grep: '', list: false, bail: false, json: '', jobs: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--grep') o.grep = argv[++i] || '';
    else if (a.startsWith('--grep=')) o.grep = a.slice(7);
    else if (a === '--list') o.list = true;
    else if (a === '--bail') o.bail = true;
    else if (a === '--serial') o.jobs = 1;
    else if (a === '--jobs') o.jobs = Number(argv[++i]) || 1;
    else if (a.startsWith('--jobs=')) o.jobs = Number(a.slice(7)) || 1;
    else if (a === '--json') o.json = argv[++i] || '';
    else if (a.startsWith('--json=')) o.json = a.slice(7);
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a} (try --help)`);
    else o.filter = a;
  }
  if (!o.jobs) o.jobs = Number(process.env.KILN_TEST_JOBS) || Math.max(1, Math.min(4, availableParallelism() - 1));
  return o;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err.message));
    process.exit(2);
  }
  if (opts.help) {
    const src = (await import('node:fs')).readFileSync(fileURLToPath(import.meta.url), 'utf8');
    console.log(src.split('\n').slice(1, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
  }
  const root = dirname(fileURLToPath(import.meta.url));
  // KILN_TEST_DIR points the runner at another folder (the runner's own self-test uses it).
  const dir = process.env.KILN_TEST_DIR ? resolve(root, process.env.KILN_TEST_DIR) : join(root, 'tests');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.test.mjs') && f.includes(opts.filter))
    .sort();
  const t0 = Date.now();

  /** @type {Array<{file:string, lines:string[], tests:any[], loadError:any, ms:number}>} */
  const results = new Array(files.length);
  let printed = 0;
  let stop = false;
  const flush = () => {
    while (printed < files.length && results[printed]) {
      process.stdout.write(results[printed].lines.join('\n') + '\n');
      printed++;
    }
  };

  let nextFile = 0;
  async function lane() {
    while (nextFile < files.length) {
      const i = nextFile++;
      if (stop) {
        results[i] = { file: files[i], lines: [`\n${files[i]} (not run: --bail)`], tests: [], loadError: null, ms: 0, notRun: true };
      } else {
        results[i] = await runFile(join(dir, files[i]), files[i], opts);
        if (opts.bail && (results[i].loadError || results[i].tests.some((t) => t.status === 'failed'))) stop = true;
      }
      flush();
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.jobs, files.length || 1) }, lane));
  flush();

  if (opts.list) {
    const n = results.reduce((s, r) => s + r.tests.length, 0);
    console.log(`\n${n} tests in ${files.length} files`);
    process.exit(files.length ? 0 : 1);
  }

  let passed = 0, failed = 0, skipped = 0, selected = 0;
  const failures = [];
  const timings = [];
  for (const r of results) {
    if (r.loadError) {
      failed++;
      failures.push({ name: `${r.file} (load)`, err: r.loadError });
    }
    for (const t of r.tests) {
      if (t.status === 'filtered') continue;
      selected++;
      if (t.status === 'passed') passed++;
      else if (t.status === 'skipped') skipped++;
      else if (t.status === 'failed') {
        failed++;
        failures.push({ name: `${r.file} › ${t.name}`, err: t.error });
      }
      if (t.ms) timings.push({ name: `${r.file} › ${t.name}`, ms: t.ms });
    }
  }

  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) {
      const text = f.err ? f.err.stack || `${f.err.name || 'Error'}: ${f.err.message}` : 'unknown error';
      console.log(`\n✗ ${f.name}\n  ${String(text).split('\n').join('\n  ')}`);
    }
  }
  timings.sort((a, b) => b.ms - a.ms);
  const slow = timings.filter((t) => t.ms >= 1000).slice(0, 5);
  if (slow.length) {
    console.log('\nSlowest:');
    for (const t of slow) console.log(`  ${(t.ms / 1000).toFixed(1)} s  ${t.name}`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${passed} passed, ${failed} failed, ${files.length} files, ${secs} s${skipped ? `, ${skipped} skipped` : ''}`);
  let code = failed || files.length === 0 ? 1 : 0;
  if (opts.grep && selected === 0) {
    console.log(`no test name contains "${opts.grep}"`);
    code = 1;
  }
  if (opts.json) {
    const report = {
      passed, failed, skipped, files: files.length, seconds: Number(secs), ok: code === 0,
      results: results.map((r) => ({
        file: r.file, ms: r.ms, loadError: r.loadError ? r.loadError.message : null,
        tests: r.tests.filter((t) => t.status !== 'filtered').map((t) => ({
          name: t.name, status: t.status, ms: t.ms || 0, error: t.error ? t.error.message : undefined, reason: t.reason,
        })),
      })),
    };
    writeFileSync(opts.json, JSON.stringify(report, null, 2));
  }
  process.exit(code);
}

/**
 * Run one test file in a worker. If a test hangs past its timeout, terminate the worker and
 * start a new one at the following test, so the rest of the file still runs.
 */
async function runFile(path, file, opts) {
  const start = Date.now();
  const out = { file, lines: [], tests: [], loadError: null, ms: 0 };
  let from = 0;
  let header = false;
  for (;;) {
    const r = await runWorker(path, from, opts);
    if (r.loadError) {
      out.loadError = r.loadError;
      out.lines.push(`\n✗ ${file} failed to load: ${r.loadError.message}`);
      if (r.output) out.lines.push(indent(r.output));
      break;
    }
    if (!header) {
      header = true;
      out.tests = r.names.map((name, i) => ({ name, status: 'pending', ms: 0, timeout: r.timeouts[i] }));
      const shown = out.tests.filter((t, i) => !r.filteredIdx.includes(i)).length;
      out.lines.push(`\n${file} (${opts.grep ? `${shown} of ${r.names.length}` : r.names.length})`);
      if (r.duplicates.length) out.lines.push(`  ! duplicate test names: ${r.duplicates.join(', ')}`);
    }
    for (const e of r.events) Object.assign(out.tests[e.i], e);
    // An error thrown outside any awaited code (a stray timer, an unhandled rejection) fails the
    // test that was running when it surfaced; it may have been started by an earlier test.
    for (const s of r.strays) {
      const t = out.tests[s.i] || out.tests[r.events.length ? r.events[r.events.length - 1].i : -1];
      if (!t) continue;
      t.status = 'failed';
      t.stray = true;
      t.error = t.error || { name: s.error.name, message: `uncaught: ${s.error.message}`, stack: s.error.stack };
    }
    for (const e of r.events) {
      const t = out.tests[e.i];
      if (opts.list) out.lines.push(`  · ${t.name}`);
      else if (t.status === 'passed') out.lines.push(`  ✓ ${t.name}${t.ms > 500 ? ` (${t.ms} ms)` : ''}`);
      else if (t.status === 'skipped') out.lines.push(`  - ${t.name} (skipped${t.reason ? `: ${t.reason}` : ''})`);
      else if (t.status === 'failed') out.lines.push(`  ✗ ${t.name}${t.stray ? ' (uncaught error while it ran; it may come from an earlier test)' : ''}`);
    }
    if (r.output) out.lines.push(indent(r.output));
    if (r.hung === -1 && r.crashed === -1) break;
    const at = r.hung !== -1 ? r.hung : r.crashed;
    const t = out.tests[at];
    t.status = 'failed';
    if (r.hung !== -1) {
      t.ms = (t.timeout || TIMEOUT_MS) + HARD_GRACE_MS;
      t.error = { name: 'Error', message: `hard timeout after ${t.ms} ms (the test blocked the thread): ${t.name}` };
      out.lines.push(`  ✗ ${t.name} (hard timeout, worker terminated)`);
    } else {
      t.error = { name: 'Error', message: `the worker stopped during this test (process.exit or a crash): ${t.name}` };
      out.lines.push(`  ✗ ${t.name} (worker stopped during the test)`);
    }
    from = at + 1;
    if (from >= out.tests.length) break;
  }
  for (const t of out.tests) if (t.status === 'pending') t.status = 'filtered';
  out.ms = Date.now() - start;
  return out;
}

function indent(s) {
  return s.replace(/\s+$/, '').split('\n').map((l) => `    | ${l}`).join('\n');
}

function runWorker(path, from, opts) {
  return new Promise((resolve) => {
    const w = new Worker(fileURLToPath(import.meta.url), {
      workerData: { path, from, grep: opts.grep, list: opts.list, timeout: TIMEOUT_MS, lib: LIB_URL },
      stdout: true,
      stderr: true,
    });
    const r = { names: [], timeouts: [], filteredIdx: [], duplicates: [], events: [], strays: [], hung: -1, crashed: -1, done: false, listed: false, loadError: null, output: '' };
    let chunks = [];
    w.stdout.on('data', (c) => chunks.push(c));
    w.stderr.on('data', (c) => chunks.push(c));
    let current = -1;
    let settled = false;
    // loading (the file's top level) has its own hard timeout: a top-level loop would hang the gate
    let hard = setTimeout(() => {
      r.loadError = { name: 'Error', message: `the file did not finish loading within ${LOAD_TIMEOUT_MS + HARD_GRACE_MS} ms (a loop or a wait at its top level)`, stack: '' };
      w.terminate();
    }, LOAD_TIMEOUT_MS + HARD_GRACE_MS);
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hard);
      r.output = Buffer.concat(chunks).toString('utf8');
      resolve(r);
    };
    w.on('message', (m) => {
      if (m.type === 'list') {
        clearTimeout(hard);
        Object.assign(r, { listed: true, names: m.names, timeouts: m.timeouts, filteredIdx: m.filteredIdx, duplicates: m.duplicates });
        // a file that registers nothing tests nothing: never a silent green
        if (!m.names.length) r.loadError = { name: 'Error', message: 'the file registered no tests', stack: '' };
      } else if (m.type === 'start') {
        current = m.i;
        clearTimeout(hard);
        hard = setTimeout(() => {
          r.hung = current;
          w.terminate();
        }, (m.timeout || TIMEOUT_MS) + HARD_GRACE_MS);
      } else if (m.type === 'end') {
        clearTimeout(hard);
        current = -1;
        r.events.push(m.result);
      } else if (m.type === 'stray') r.strays.push(m);
      else if (m.type === 'done') {
        r.done = true;
        setTimeout(() => w.terminate(), 50); // a test may leave a timer running
      }
      else if (m.type === 'loadError') r.loadError = m.error;
    });
    w.on('error', (err) => {
      // An exception that escaped every handler: count it against the running test or the load.
      const e = serialiseError(err);
      if (!r.listed) r.loadError = r.loadError || e;
      else r.strays.push({ i: current, error: e });
    });
    w.on('exit', () => {
      // Ended before the file finished loading: process.exit at its top level, or a crash. Its
      // tests never reached the gate, so the file fails (it used to pass with 0 tests).
      if (!r.listed && !r.loadError) {
        r.loadError = { name: 'Error', message: 'worker exited while loading the file (process.exit or crash)', stack: '' };
      }
      // Ended without finishing the file and without a hang: a test called process.exit or crashed.
      if (!r.done && !r.loadError && r.hung === -1 && r.names.length) {
        const lastEnded = r.events.length ? r.events[r.events.length - 1].i : from - 1;
        r.crashed = current !== -1 ? current : lastEnded + 1;
        if (r.crashed >= r.names.length) r.crashed = -1;
      }
      // stdout may still hold the last chunks; let them drain first.
      if (w.stdout.readableEnded) finish();
      else {
        w.stdout.once('end', finish);
        setTimeout(finish, 500);
      }
    });
  });
}

function serialiseError(err) {
  if (err && typeof err === 'object') {
    return { name: String(err.name || 'Error'), message: String(err.message ?? err), stack: String(err.stack || '') };
  }
  return { name: 'Error', message: String(err), stack: '' };
}

// ------------------------------------------------------------------------------------ worker

async function runInWorker({ path, from, grep, list, timeout, lib: libUrl }) {
  let current = -1;
  process.on('unhandledRejection', (err) => parentPort.postMessage({ type: 'stray', i: current, error: serialiseError(err) }));
  process.on('uncaughtException', (err) => parentPort.postMessage({ type: 'stray', i: current, error: serialiseError(err) }));

  const lib = await import(libUrl);
  lib.resetCollected();
  try {
    await import(pathToFileURL(path).href);
  } catch (err) {
    parentPort.postMessage({ type: 'loadError', error: serialiseError(err) });
    return;
  }
  const tests = lib.collected();
  const names = tests.map((t) => t.name);
  const g = grep.toLowerCase();
  const filteredIdx = [];
  names.forEach((n, i) => { if (g && !n.toLowerCase().includes(g)) filteredIdx.push(i); });
  const seen = new Set();
  const duplicates = [];
  for (const n of names) { if (seen.has(n)) duplicates.push(n); seen.add(n); }
  parentPort.postMessage({ type: 'list', names, timeouts: tests.map((t) => t.timeout || timeout), filteredIdx, duplicates });

  for (let i = from; i < tests.length; i++) {
    if (filteredIdx.includes(i)) continue;
    const t = tests[i];
    if (list) {
      parentPort.postMessage({ type: 'end', result: { i, status: 'listed', ms: 0 } });
      continue;
    }
    if (t.skip) {
      parentPort.postMessage({ type: 'end', result: { i, status: 'skipped', ms: 0, reason: t.skip } });
      continue;
    }
    const ms = t.timeout || timeout;
    current = i;
    parentPort.postMessage({ type: 'start', i, timeout: ms });
    const start = Date.now();
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(t.fn),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms: ${t.name}`)), ms); }),
      ]);
      parentPort.postMessage({ type: 'end', result: { i, status: 'passed', ms: Date.now() - start } });
    } catch (err) {
      parentPort.postMessage({ type: 'end', result: { i, status: 'failed', ms: Date.now() - start, error: serialiseError(err) } });
    } finally {
      clearTimeout(timer);
    }
  }
  current = -1;
  parentPort.postMessage({ type: 'done' });
}
