// G: deploy.sh publishes only on an exact, current approval (tools/qa/approval.mjs). The four
// loose cases a reviewer found in the old sed/grep read must all say "not approved".

import { test, assert } from './lib.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishApproval } from '../tools/qa/approval.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const doc = (approvals, after = '') => `# Kiln build status\n\n## Approvals (from the owner in chat)\n${approvals}\n\n## Phases\n- phase 2\n${after}`;
const REAL = doc(`- Downloads: YES (2026-10-21 18:25).
- Publish publicly (repo Pug2025/kiln + GitHub Pages): YES, on condition there is no danger
  (the owner: "use your judgment"). Before the first push, G must pass a pre-publish check.`);

const CASES = {
  'the real approval line': [REAL, true],
  'NO in Approvals, YES under a later heading that starts with A': [
    doc('- Publish publicly (repo + Pages): NO, not yet', '\n## Agents\n- Publish publicly: YES\n'), false],
  'YES? is a question, not an approval': [doc('- Publish publicly (repo + Pages): YES? not yet'), false],
  'a later revoke line wins': [doc('- Publish publicly (repo + Pages): YES, go ahead\n- Publish publicly: REVOKED (wait for the fix)'), false],
  'YES at the end of the line': [doc('- Publish publicly: YES'), true],
  'YES with a full stop': [doc('- Publish publicly: YES.'), true],
  'YESTERDAY is not YES': [doc('- Publish publicly: YESTERDAY we said no'), false],
  'lower-case yes is not the token': [doc('- Publish publicly: yes'), false],
  'YES ? with a space is still a question': [doc('- Publish publicly: YES ?'), false],
  'no Approvals section': ['# status\n\n## Phases\n- Publish publicly: YES\n', false],
  'no Publish line': [doc('- Downloads: YES'), false],
  'Approvals as the last section': ['# s\n## Approvals\n- Publish publicly: YES, fine\n', true],
};

test('publish approval: only the last Publish line of Approvals, only an exact YES', () => {
  for (const [name, [text, want]] of Object.entries(CASES)) {
    assert.equal(publishApproval(text).approved, want, name);
  }
});

test('publish approval CLI: exit 0 only when approved (the four reviewer files say no)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kiln-approval-'));
  try {
    const run = (text) => {
      const f = join(dir, 'BUILD-STATUS.md');
      writeFileSync(f, text);
      return spawnSync(process.execPath, ['tools/qa/approval.mjs', f], { cwd: ROOT, encoding: 'utf8' });
    };
    const four = ['NO in Approvals, YES under a later heading that starts with A', 'YES? is a question, not an approval', 'a later revoke line wins', 'lower-case yes is not the token'];
    for (const name of four) {
      const r = run(CASES[name][0]);
      assert.equal(r.status, 1, `${name}: ${r.stdout}`);
      assert.match(r.stdout, /^not approved/);
    }
    const ok = run(REAL);
    assert.equal(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, /^approved/);
    const missing = spawnSync(process.execPath, ['tools/qa/approval.mjs', join(dir, 'nope.md')], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(missing.status, 1, 'no status file, no publish');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deploy.sh decides publishing only through tools/qa/approval.mjs', () => {
  const sh = readFileSync(join(ROOT, 'deploy.sh'), 'utf8');
  assert.match(sh, /if node tools\/qa\/approval\.mjs "\$STATUS"; then APPROVED=1; fi/);
  const sets = sh.split('\n').filter((l) => /APPROVED=1/.test(l));
  assert.equal(sets.length, 1, `one place sets APPROVED=1: ${sets.join(' | ')}`);
  assert.doesNotMatch(sh, /grep -Eq '\^- \*Publish/, 'the old loose grep is gone');
});
