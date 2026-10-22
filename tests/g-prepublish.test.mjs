// G: the pre-publish safety check (tools/qa/prepublish.mjs) catches what must never go public.
// Builds throwaway git repos with one planted problem each. The planted values are assembled at
// run time so this file itself never contains a key, an email or a home path.

import { test, assert } from './lib.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { runChecks, ownerNameFinder, OWNER_NAME_HASHES, PUBLISH_EMAIL } from '../tools/qa/prepublish.mjs';

const OK_ENV = { GIT_AUTHOR_NAME: 'Pug2025', GIT_AUTHOR_EMAIL: PUBLISH_EMAIL, GIT_COMMITTER_NAME: 'Pug2025', GIT_COMMITTER_EMAIL: PUBLISH_EMAIL };

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-prepublish-'));
  const git = (args, env = OK_ENV) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: dir, env: { ...process.env, ...env, GIT_CONFIG_GLOBAL: '/dev/null' }, encoding: 'utf8',
  });
  git(['init', '-q', '-b', 'main']);
  const put = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (msg, env) => {
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-m', msg], env);
  };
  return { dir, git, put, commit, done: () => rmSync(dir, { recursive: true, force: true }) };
}

function base(r) {
  r.put('index.html', '<!doctype html><title>Kiln</title>');
  r.put('ARTKIT.md', '| `icons/icon-192.png` | 192x192 | PNG |\n');
  r.put('icons/icon-192.png', 'png');
  r.commit('game');
}

const failing = (res) => res.results.filter((c) => !c.pass).map((c) => c.name).sort();

test('prepublish: a clean repo passes', () => {
  const r = repo();
  try {
    base(r);
    const res = runChecks({ root: r.dir });
    assert.deepEqual(failing(res), [], JSON.stringify(res.results, null, 1));
    assert.equal(res.pass, true);
  } finally { r.done(); }
});

test('prepublish: a key deleted later is still found in history', () => {
  const r = repo();
  try {
    base(r);
    r.put('src/config.js', `export const KEY = '${'sk-' + 'Ab3'.repeat(12)}';\n`);
    r.commit('add config');
    r.put('src/config.js', 'export const KEY = null;\n');
    r.commit('remove key');
    const res = runChecks({ root: r.dir });
    assert.deepEqual(failing(res), ['secrets']);
    assert.match(res.results.find((c) => c.name === 'secrets').findings[0], /src\/config\.js:1/);
  } finally { r.done(); }
});

test('prepublish: a commit by a personal address fails authors', () => {
  const r = repo();
  try {
    base(r);
    const mail = ['someone', 'icloud.com'].join('@');
    r.put('a.txt', 'x');
    r.commit('by hand', { ...OK_ENV, GIT_AUTHOR_EMAIL: mail, GIT_COMMITTER_EMAIL: mail });
    const res = runChecks({ root: r.dir });
    assert.deepEqual(failing(res), ['authors']);
  } finally { r.done(); }
});

test('prepublish: planning files, personal data, licences and size', () => {
  const r = repo();
  try {
    base(r);
    r.put('PLAN.md', 'plan');
    r.commit('oops');
    r.git(['rm', '-q', 'PLAN.md']);
    r.commit('remove plan'); // still in history
    r.put('tools/x.py', `ROOT = '${'/Users/' + 'someone' + '/Documents'}'\n# mail ${['someone', 'example.net'].join('@')}\n`);
    r.put('textures/stone.png', 'png');                       // in no manifest
    r.put('audio/music/SOURCES.md', '- machina.mp3: Machina by Scott Buckley, CC BY 4.0, https://www.scottbuckley.com.au/library/machina/\n- loop.mp3: CC BY-NC 4.0\n');
    r.put('audio/music/machina.mp3', 'mp3');
    r.put('audio/music/loop.mp3', 'mp3');
    r.put('big.bin', Buffer.alloc(26 * 1024 * 1024, 1));
    r.commit('content');
    const res = runChecks({ root: r.dir });
    assert.deepEqual(failing(res), ['licences', 'personal', 'planning', 'size']);
    const lic = res.results.find((c) => c.name === 'licences').findings.join('\n');
    assert.match(lic, /textures\/stone\.png is in neither/);
    assert.match(lic, /CREDITS\.md lacks "'Machina' by Scott Buckley - released under CC-BY 4\.0\. www\.scottbuckley\.com\.au"/);
    assert.match(lic, /loop\.mp3: licence forbids/);
    const personal = res.results.find((c) => c.name === 'personal').findings.join('\n');
    assert.match(personal, /home path/);
    assert.match(personal, /email someone@example\.net/);
    assert.match(res.results.find((c) => c.name === 'planning').findings.join('\n'), /in history: PLAN\.md/);
  } finally { r.done(); }
}, { timeout: 60000 });

test('prepublish: credits in CREDITS.md and on the Credits screen satisfy a CC BY track', () => {
  const r = repo();
  try {
    base(r);
    const line = "'Machina' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au";
    r.put('audio/music/SOURCES.md', '- machina.mp3: Machina by Scott Buckley, CC BY 4.0, https://www.scottbuckley.com.au/library/machina/\n');
    r.put('audio/music/machina.mp3', 'mp3');
    r.put('CREDITS.md', `${line}\nLicence: https://creativecommons.org/licenses/by/4.0/\n`);
    r.put('src/audio/credits.js', `export const CREDITS = [${JSON.stringify(line)}];\n`);
    r.commit('music');
    const res = runChecks({ root: r.dir });
    assert.deepEqual(failing(res), [], JSON.stringify(res.results.filter((c) => !c.pass)));
  } finally { r.done(); }
});

test('prepublish: an owner name fails in the tip and only warns in older history', () => {
  const r = repo();
  try {
    base(r);
    r.put('src/old.js', "// tuned after Quillon's playtest\n");
    r.commit('tuning from Quillon'); // an older commit message: history only
    r.put('src/old.js', '// tuned after a playtest\n');
    r.put('src/now.js', 'const x = 1; // QUILLON asked for this\nconst quillonMode = 2;\n');
    r.commit('content for Quillon'); // the tip's own message
    const res = runChecks({ root: r.dir, owners: { hashes: [], plain: 'Quillon' } });
    assert.deepEqual(failing(res), ['personal']);
    const p = res.results.find((c) => c.name === 'personal');
    const found = p.findings.join('\n');
    assert.match(found, /owner name "QUILLON" in src\/now\.js:1/);
    assert.match(found, /owner name "quillon" in src\/now\.js:2/, 'camelCase words are split');
    assert.match(found, /owner name "Quillon" in the message of commit/);
    assert.equal(p.findings.length, 3, found);
    const warned = p.warnings.join('\n');
    assert.match(warned, /owner name "Quillon" in src\/old\.js:1 \(old version, history only\)/);
    assert.match(warned, /in the message of commit [0-9a-f]{8} \(history only\)/);
    // the same through a hash, the way OWNER_NAME_HASHES holds names
    const hash = createHash('sha256').update('quillon').digest('hex');
    assert.deepEqual(failing(runChecks({ root: r.dir, owners: { hashes: [hash], plain: '' } })), ['personal']);
    assert.deepEqual(failing(runChecks({ root: r.dir, owners: { hashes: [], plain: '' } })), [], 'no owner names: nothing to find');
  } finally { r.done(); }
});

test('prepublish: the owner-name list holds hashes, never a name', () => {
  assert.ok(OWNER_NAME_HASHES.length >= 1);
  for (const h of OWNER_NAME_HASHES) assert.match(h, /^[0-9a-f]{64}$/);
  const find = ownerNameFinder([createHash('sha256').update('quillon').digest('hex')], '');
  assert.deepEqual(find('Quillons quill on QuillonX').map((h) => h.word), ['Quillon'], 'whole words only (camelCase split)');
});
