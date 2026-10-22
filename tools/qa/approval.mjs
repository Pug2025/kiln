#!/usr/bin/env node
// Kiln QA (G): is publishing approved? deploy.sh asks this before any push.
//
//   node tools/qa/approval.mjs BUILD-STATUS.md     exit 0 and "approved" when it is, exit 1 otherwise
//
// The rule (strict on purpose: a loose read publishes by accident):
//   - only the "## Approvals" section counts, from that heading to the next "## " heading;
//   - only the LAST line in it that starts "- Publish" counts (a later revoke line wins);
//   - that line must say ": YES" as a whole token, followed by a comma, a full stop, a semicolon,
//     a space or the end of the line ("YES?", "YESTERDAY" or "yes" are not approval).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @returns {{ approved: boolean, line: string, why: string }} */
export function publishApproval(text) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^## Approvals\b/.test(l));
  if (start < 0) return { approved: false, line: '', why: 'no "## Approvals" section' };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  const publish = lines.slice(start + 1, end).filter((l) => /^\s*-\s*Publish\b/.test(l));
  if (!publish.length) return { approved: false, line: '', why: 'no "- Publish ..." line in Approvals' };
  const last = publish[publish.length - 1];
  const approved = /^\s*-\s*Publish[^:]*:\s*YES(?=[,.;\s]|$)/.test(last) && !/^\s*-\s*Publish[^:]*:\s*YES\s*\?/.test(last);
  return { approved, line: last.trim(), why: approved ? 'the last Publish line says YES' : 'the last Publish line does not say YES' };
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/qa/approval.mjs <BUILD-STATUS.md>');
    return 2;
  }
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.log(`not approved: cannot read ${file}`);
    return 1;
  }
  const r = publishApproval(text);
  console.log(`${r.approved ? 'approved' : 'not approved'}: ${r.why}${r.line ? ` (${r.line.slice(0, 90)})` : ''}`);
  return r.approved ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
