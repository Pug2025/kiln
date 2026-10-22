// G: a QA tool killed from outside leaves nothing running. tools/qa/lib/cdp.mjs guards every
// headless Chrome it starts (guardChild); here a stand-in child (`sleep 60`) is started by a
// helper Node process that is then killed with SIGKILL (no handler runs: the watchdog must reap)
// or SIGTERM (the handler reaps at once). The child and its profile folder must be gone.

import { test, assert } from './lib.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CDP = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'qa', 'lib', 'cdp.mjs')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Start a helper that guards `sleep 60` with `dir` as its cleanup folder; resolves its pids. */
async function startHelper(dir) {
  const src = `
    import { spawn } from 'node:child_process';
    import { guardChild } from ${JSON.stringify(CDP)};
    const child = spawn('sleep', ['60'], { stdio: 'ignore' });
    guardChild(child, { cleanup: ${JSON.stringify(dir)}, pollSeconds: 0.2 });
    console.log('child ' + child.pid);
    setInterval(() => {}, 1000);
  `;
  const helper = spawn(process.execPath, ['--input-type=module', '-e', src], { stdio: ['ignore', 'pipe', 'inherit'] });
  const childPid = await new Promise((res, rej) => {
    let out = '';
    helper.stdout.on('data', (c) => {
      out += c;
      const m = /child (\d+)/.exec(out);
      if (m) res(Number(m[1]));
    });
    helper.once('exit', (code) => rej(new Error(`helper exited early (${code})`)));
    setTimeout(() => rej(new Error('helper did not start')), 10000);
  });
  return { helper, childPid };
}

async function waitGone(pid, ms) {
  const until = Date.now() + ms;
  while (alive(pid) && Date.now() < until) await sleep(50);
  return !alive(pid);
}

for (const [signal, within] of [['SIGKILL', 5000], ['SIGTERM', 3000]]) {
  test(`guard: a QA process ended by ${signal} leaves no child and no profile behind`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kiln-guard-'));
    let childPid = 0;
    try {
      const h = await startHelper(dir);
      childPid = h.childPid;
      assert.ok(alive(childPid), 'the guarded child runs');
      h.helper.kill(signal);
      assert.ok(await waitGone(childPid, within), `child ${childPid} still running ${within} ms after the helper got ${signal}`);
      const until = Date.now() + 2000;
      while (existsSync(dir) && Date.now() < until) await sleep(50);
      assert.ok(!existsSync(dir), 'the profile folder was removed');
    } finally {
      if (childPid && alive(childPid)) process.kill(childPid, 'SIGKILL');
      rmSync(dir, { recursive: true, force: true });
    }
  }, { timeout: 20000 });
}

// A failed spawn keeps a handle with no pid; kill() on it signals pid 0, the caller's whole
// process group. Run in a helper with its own process group so a regression kills only it.
test('guard: a Chrome that cannot start fails fast and signals nobody', async () => {
  const src = `
    import { spawn } from 'node:child_process';
    import { existsSync } from 'node:fs';
    import { safeKill, guardChild, launchChrome } from ${JSON.stringify(CDP)};
    const dud = spawn('/nonexistent/kiln-no-such-binary', [], { stdio: 'ignore' });
    dud.on('error', () => {});
    guardChild(dud)();
    const killed = safeKill(dud, 'SIGKILL');
    const t0 = Date.now();
    let msg = '';
    let profileLeft = null;
    try { await launchChrome({ chrome: '/nonexistent/kiln-no-such-chrome' }); } catch (err) {
      msg = err.message;
      profileLeft = err.profile ? existsSync(err.profile) : 'unknown';
    }
    console.log(JSON.stringify({ killed, msg, ms: Date.now() - t0, profileLeft }));
  `;
  const helper = spawn(process.execPath, ['--input-type=module', '-e', src], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  helper.stdout.on('data', (c) => { out += c; });
  helper.stderr.on('data', (c) => { err += c; });
  const [code, signal] = await new Promise((res) => helper.once('exit', (c, s) => res([c, s])));
  assert.equal(signal, null, `the helper was killed by ${signal} (a kill reached its own process group)`);
  assert.equal(code, 0, err);
  const r = JSON.parse(out.trim().split('\n').pop());
  assert.equal(r.killed, false, 'safeKill refuses a process that never started');
  assert.match(r.msg, /could not be started/);
  assert.ok(r.ms < 3000, `a missing Chrome fails fast (${r.ms} ms)`);
  assert.equal(r.profileLeft, false, 'its profile folder is removed');
}, { timeout: 20000 });

test('guard: release() after a normal close stops the watchdog from touching anything', async () => {
  const { guardChild } = await import(CDP);
  const dir = mkdtempSync(join(tmpdir(), 'kiln-guard-'));
  const child = spawn('sleep', ['60'], { stdio: 'ignore' });
  try {
    const release = guardChild(child, { cleanup: dir, pollSeconds: 0.2 });
    release();
    await sleep(500);
    assert.ok(alive(child.pid), 'release() alone does not stop the child');
    assert.ok(existsSync(dir), 'release() alone does not remove the folder');
  } finally {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});
