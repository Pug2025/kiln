// G: the gate checks itself. Runs tests-node.mjs on tests/fixtures/G/runner (passes, a skip, a
// failure, an async hang, a synchronous hang, process.exit, a load error, a stray error, a file
// that exits while loading, a file with no test, a file that never finishes loading) and checks
// that every case is reported, that the rest of a file still runs after a hang, and that the exit
// code is 1.

import { test, assert } from './lib.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function runGate(args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-gate-'));
  const json = join(dir, 'report.json');
  try {
    const r = spawnSync(process.execPath, ['tests-node.mjs', '--json', json, ...args], {
      cwd: ROOT,
      env: { ...process.env, KILN_TEST_DIR: 'tests/fixtures/G/runner', KILN_TEST_GRACE_MS: '300', KILN_TEST_LOAD_MS: '1000', KILN_TEST_JOBS: '2' },
      encoding: 'utf8',
      timeout: 60000,
    });
    return { code: r.status, out: r.stdout, report: JSON.parse(readFileSync(json, 'utf8')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const statuses = (report) => Object.fromEntries(report.results.map((f) => [f.file, f.tests.map((t) => t.status).join(',')]));

test('the gate reports every kind of failure and keeps going after a hang', () => {
  const { code, report, out } = runGate();
  assert.equal(code, 1, 'a failing suite exits 1');
  assert.deepEqual(statuses(report), {
    'a-pass.test.mjs': 'passed,passed,passed,skipped',
    'b-fail.test.mjs': 'failed,failed,failed,passed,passed,failed,passed',
    'c-load.test.mjs': '',
    'd-stray.test.mjs': 'passed,failed',
    'e-exitload.test.mjs': '',
    'f-empty.test.mjs': '',
    'g-loadhang.test.mjs': '',
  });
  const loadError = (file) => report.results.find((f) => f.file === file).loadError;
  assert.equal(loadError('c-load.test.mjs'), 'broken on load');
  assert.match(loadError('e-exitload.test.mjs'), /worker exited while loading the file/, 'process.exit at the top level is not a green file');
  assert.match(loadError('f-empty.test.mjs'), /registered no tests/);
  assert.match(loadError('g-loadhang.test.mjs'), /did not finish loading within 1300 ms/);
  assert.equal(report.passed, 7);
  assert.equal(report.failed, 9, '5 failed tests + 4 files that failed to load');
  assert.equal(report.skipped, 1);
  assert.match(out, /hard timeout, worker terminated/);
  assert.match(out, /\| hello from a test/, 'console output from a test is shown under its file');
  assert.ok(out.indexOf('a-pass.test.mjs') < out.indexOf('b-fail.test.mjs'), 'files print in name order');
}, { timeout: 60000 });

test('the gate filters by file and by test name', () => {
  const byFile = runGate(['a-']);
  assert.equal(byFile.code, 0, 'only the passing file runs');
  assert.equal(byFile.report.files, 1);
  const byName = runGate(['--grep', 'RUNS AFTER']);
  assert.equal(byName.report.passed, 2);
  assert.equal(byName.report.failed, 4, 'only the four files that fail to load remain');
  const none = runGate(['--grep', 'no test is called this']);
  assert.equal(none.code, 1, 'a grep that matches nothing is not a green run');
}, { timeout: 60000 });
