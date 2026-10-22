#!/usr/bin/env node
// Kiln QA (G): the pre-publish safety check (BUILD-STATUS "Approvals": publish only when there is
// no danger). Everything that would become public by pushing a branch is checked: the files in
// its tip AND every file and commit in its history (a key deleted later is still public).
//
//   secrets   no API keys, tokens, private keys or passwords in files, history or commit messages
//   authors   every commit's author and committer email is the GitHub private address
//   planning  no planning file (PLAN.md, team/, status/ ...) in the tip or anywhere in history
//   personal  no email address (other than GitHub/Anthropic no-reply), no /Users/<name> path and no
//             owner name (OWNER_NAME_HASHES) in the tip; in older history the last two only warn
//   licences  every shipped asset is listed in ARTKIT.md or a SOURCES.md; no NC/ND/all-rights
//             licence; every CC BY source has its credit line in CREDITS.md and src/audio/credits.js
//   size      no tracked file over 25 MB (GitHub refuses 100 MB; Pages and phones want small)
//
//   node tools/qa/prepublish.mjs                 checks main in this checkout
//   node tools/qa/prepublish.mjs --ref agent/G   checks another branch
//   node tools/qa/prepublish.mjs --json report.json
//   node tools/qa/prepublish.mjs --hash-name <name>   the hash to add to OWNER_NAME_HASHES
// Exit 1 if any check fails. deploy.sh runs it before every push.

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const ALLOWED_EMAIL = /^[\w.+-]+@users\.noreply\.github\.com$|^noreply@anthropic\.com$/i;
export const PUBLISH_EMAIL = '239009854+Pug2025@users.noreply.github.com';

export const PLANNING = [/^PLAN\.md$/, /^ART\.md$/, /^CHANGELOG\.md$/, /^HANDOFF[^/]*$/, /^BUILD-STATUS\.md$/,
  /^team\//, /^status\//, /^research\//, /^look-tests\//, /^art\//, /^plan-site\//, /^\.worktrees\//, /^\.merge-lock/,
  /^assets\/generated\//, /(^|\/)\.env(\.|$)/, /\.pem$/, /\.p12$/, /(^|\/)id_(rsa|ed25519)/, /(^|\/)\.DS_Store$/, /(^|\/)node_modules\//];

export const SECRETS = [
  [/\bsk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_-]{20,}/, 'OpenAI/Anthropic-style secret key (sk-...)'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/, 'GitHub fine-grained token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY/, 'private key'],
  [/\b(?:api[_-]?key|secret|token|passw(?:or)?d)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i, 'hard-coded credential'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{24,}/, 'bearer token'],
];

// The owner's first name is personal data too (BUILD-STATUS: "no personal data"). This list holds
// SHA-256 hashes of the lower-case names, so this public file never carries a name itself. Add one
// with --hash-name; KILN_OWNER_NAMES="a,b" adds plain names for one run.
export const OWNER_NAME_HASHES = ['e7a4477ec945697c1003e467ec7b8fc2c485d90453882a203c08956d377d8cbd'];
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * A finder for owner names: every word (camelCase split, any case) whose lower-case SHA-256 is
 * listed. Returns (text) => [{ word, index }]. Each distinct word is hashed once.
 */
export function ownerNameFinder(hashes = OWNER_NAME_HASHES, plain = process.env.KILN_OWNER_NAMES || '') {
  const want = new Set(hashes);
  for (const n of String(plain).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) want.add(sha256(n));
  const seen = new Map();
  const WORD = /[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g;
  return (text) => {
    const hits = [];
    if (!want.size) return hits;
    for (const m of text.matchAll(WORD)) {
      const w = m[0].toLowerCase();
      let hit = seen.get(w);
      if (hit === undefined) {
        hit = want.has(sha256(w));
        seen.set(w, hit);
      }
      if (hit) hits.push({ word: m[0], index: m.index });
    }
    return hits;
  };
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const HOME_PATH = /\/Users\/[A-Za-z0-9._-]+\//g;
const BAD_LICENCE = /\b(CC[- ]BY[- ]?(?:\d\.\d[- ])?(?:NC|ND)|non-?commercial|no ?deriv|all rights reserved|youtube audio library)\b/i;
const ASSET_DIRS = ['textures', 'glyphs', 'models', 'img', 'icons', 'audio'];
const MAX_FILE = 25 * 1024 * 1024;

// Credit rules for the sources the handoff approved (PLAN §7 "Credits"). A CC BY source not
// covered here fails until a rule is added, so no new CC BY file ships without its credit.
const BUCKLEY_TITLES = ['Machina', 'Nightfall', 'Resonance', 'Red', 'Ambush', 'Legacy'];
const CREDIT_RULES = [
  {
    name: 'Scott Buckley',
    match: /scottbuckley|scott buckley/i,
    need(line) {
      const titles = BUCKLEY_TITLES.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(line));
      return titles.length
        ? titles.map((t) => `'${t}' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au`)
        : ['by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au'];
    },
  },
  { name: 'Rusted Studio', match: /rustedstudio|rustedmusicstudio|linear atmospheres/i, need: () => ['FabienC@RustedMusicStudio'] },
  { name: 'SRG774', match: /srg774|dark-sci-fi-audio-pack/i, need: () => ['SRG774'] },
  { name: 'CC0 libraries', match: /polyhaven|ambientcg|\bCC0\b|public domain/i, need: () => [] },
];
const CC_BY = /\bCC[- ]?BY\b(?![- ]?(?:NC|ND|SA))/i;

function git(root, args, opts = {}) {
  return execFileSync('git', args, { cwd: root, encoding: opts.buffer ? undefined : 'utf8', maxBuffer: 1 << 30 });
}

/** Read many blobs in one `git cat-file --batch` call. Returns Map sha → Buffer. */
function readBlobs(root, shas) {
  const out = new Map();
  if (!shas.length) return out;
  const r = spawnSync('git', ['cat-file', '--batch'], { cwd: root, input: shas.join('\n') + '\n', maxBuffer: 2147483647 });
  const buf = r.stdout;
  let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf(10, i);
    const [sha, type, size] = buf.slice(i, nl).toString('utf8').split(' ');
    const n = Number(size);
    if (type === 'blob') out.set(sha, buf.subarray(nl + 1, nl + 1 + n));
    i = nl + 1 + (Number.isFinite(n) ? n : 0) + 1;
  }
  return out;
}

const isBinary = (b) => b.subarray(0, 8000).includes(0);

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * The lines the in-game Credits screen shows, by running src/audio/credits.js (E builds its lines
 * in code, so a text search would miss them). Only when the file on disk is the one in the ref
 * being checked; otherwise null and the caller falls back to searching the source text.
 */
function creditsScreenLines(root, tree) {
  const e = tree.find((x) => x.path === 'src/audio/credits.js');
  const file = resolve(root, 'src/audio/credits.js');
  if (!e || !existsSync(file)) return null;
  let disk = '';
  try { disk = git(root, ['hash-object', 'src/audio/credits.js']).trim(); } catch { return null; }
  if (disk !== e.sha) return null;
  const code = `const m = await import(process.env.KILN_CREDITS_URL);
const lines = typeof m.creditLines === 'function' ? m.creditLines() : m.CREDIT_LINES || (m.CREDITS || []).map((c) => c.line || String(c));
console.log(JSON.stringify(lines));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root, encoding: 'utf8', env: { ...process.env, KILN_CREDITS_URL: pathToFileURL(file).href },
  });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return null; }
}

export function runChecks({ root, ref = 'main', owners = {} }) {
  const tip = git(root, ['rev-parse', '--short', ref]).trim();
  const commits = git(root, ['log', '--format=%H%x09%an%x09%ae%x09%cn%x09%ce', ref]).trim().split('\n').filter(Boolean)
    .map((l) => { const [sha, an, ae, cn, ce] = l.split('\t'); return { sha, an, ae, cn, ce }; });
  const tree = git(root, ['ls-tree', '-r', '-l', ref]).trim().split('\n').filter(Boolean).map((l) => {
    const [meta, path] = l.split('\t');
    const [, type, sha, size] = meta.split(/\s+/);
    return { type, sha, size: Number(size), path };
  }).filter((e) => e.type === 'blob');
  const objects = git(root, ['rev-list', '--objects', ref]).trim().split('\n').filter(Boolean).map((l) => {
    const s = l.indexOf(' ');
    return s < 0 ? { sha: l, path: '' } : { sha: l.slice(0, s), path: l.slice(s + 1) };
  });
  const check = spawnSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    cwd: root, input: objects.map((o) => o.sha).join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 30,
  }).stdout.trim().split('\n');
  const blobInfo = new Map();
  for (const l of check) {
    const [sha, type, size] = l.split(' ');
    if (type === 'blob') blobInfo.set(sha, Number(size));
  }
  const pathsBySha = new Map();
  for (const o of objects) if (blobInfo.has(o.sha)) pathsBySha.set(o.sha, o.path);
  const textShas = [...blobInfo.entries()].filter(([, size]) => size <= 5 * 1024 * 1024).map(([sha]) => sha);
  const blobs = readBlobs(root, textShas);
  const messages = git(root, ['log', '--format=%H%x00%B%x00', ref]).split('\0\n').filter(Boolean);
  const historyPaths = new Set(git(root, ['log', '--format=', '--name-only', ref]).split('\n').filter(Boolean));

  const results = [];
  const add = (name, findings, okText, warnings = []) => results.push({ name, pass: findings.length === 0, findings, warnings, okText });
  const tipShas = new Set(tree.map((e) => e.sha));

  // secrets (tip + history + commit messages)
  const secretHits = [];
  for (const [sha, buf] of blobs) {
    if (isBinary(buf)) continue;
    const text = buf.toString('utf8');
    for (const [re, what] of SECRETS) {
      const m = re.exec(text);
      if (m) secretHits.push(`${what} in ${pathsBySha.get(sha) || sha.slice(0, 8)}:${lineOf(text, m.index)} (blob ${sha.slice(0, 8)})`);
    }
  }
  for (const msg of messages) {
    const [sha, body] = msg.split('\0');
    for (const [re, what] of SECRETS) if (re.test(body || '')) secretHits.push(`${what} in the message of commit ${sha.slice(0, 8)}`);
  }
  add('secrets', secretHits, `no keys or tokens in ${tree.length} tracked files, ${blobs.size} blobs in history or ${commits.length} commit messages`);

  // authors
  const badAuthors = new Map();
  for (const c of commits) {
    for (const e of [c.ae, c.ce]) {
      if (!ALLOWED_EMAIL.test(e)) {
        if (!badAuthors.has(e)) badAuthors.set(e, []);
        badAuthors.get(e).push(c.sha.slice(0, 7));
      }
    }
  }
  add('authors', [...badAuthors].map(([e, shas]) => `${[...new Set(shas)].length} commit(s) use ${e} (${[...new Set(shas)].slice(0, 6).join(', ')}): never push this history; deploy.sh publishes a snapshot commit instead`),
    `all ${commits.length} commits authored and committed as a GitHub no-reply address`);

  // planning and machinery files, in the tip or ever in history
  const planTip = tree.filter((e) => PLANNING.some((re) => re.test(e.path))).map((e) => `tracked now: ${e.path}`);
  const planHist = [...historyPaths].filter((p) => PLANNING.some((re) => re.test(p)) && !tree.some((e) => e.path === p)).map((p) => `in history: ${p}`);
  add('planning', [...planTip, ...planHist], 'no planning, secret-file or machinery path in the tip or in history');

  // personal data
  const personal = [];
  const personalWarn = []; // a home path or a first name only in old history: no contact data
  const ownerNames = ownerNameFinder(owners.hashes, owners.plain);
  const tipCommit = git(root, ['rev-parse', ref]).trim();
  for (const [sha, buf] of blobs) {
    if (isBinary(buf)) continue;
    const text = buf.toString('utf8');
    const where = pathsBySha.get(sha) || sha.slice(0, 8);
    const inTip = tipShas.has(sha);
    for (const m of text.matchAll(EMAIL)) {
      if (ALLOWED_EMAIL.test(m[0]) || /@(?:example\.(?:com|org)|RustedMusicStudio)$/i.test(m[0])) continue;
      personal.push(`email ${m[0]} in ${where}:${lineOf(text, m.index)}`);
    }
    for (const m of text.matchAll(HOME_PATH)) {
      (inTip ? personal : personalWarn).push(`home path ${m[0]} in ${where}:${lineOf(text, m.index)}${inTip ? '' : ' (old version, history only)'}`);
    }
    for (const h of ownerNames(text)) {
      (inTip ? personal : personalWarn).push(`owner name "${h.word}" in ${where}:${lineOf(text, h.index)}${inTip ? '' : ' (old version, history only)'}`);
    }
  }
  for (const msg of messages) {
    const [sha, body] = msg.split('\0');
    const isTip = sha.trim() === tipCommit;
    for (const m of (body || '').matchAll(EMAIL)) if (!ALLOWED_EMAIL.test(m[0])) personal.push(`email ${m[0]} in the message of commit ${sha.slice(0, 8)}`);
    for (const m of (body || '').matchAll(HOME_PATH)) personal.push(`home path ${m[0]} in the message of commit ${sha.slice(0, 8)}`);
    for (const h of ownerNames(body || '')) (isTip ? personal : personalWarn).push(`owner name "${h.word}" in the message of commit ${sha.slice(0, 8)}${isTip ? '' : ' (history only)'}`);
  }
  add('personal', [...new Set(personal)], 'no personal email address in files, history or commit messages; no home-folder path or owner name in the tip', [...new Set(personalWarn)]);

  // licences and credits (tip)
  const lic = [];
  const tipText = (path) => {
    const e = tree.find((x) => x.path === path);
    if (!e) return null;
    const b = blobs.get(e.sha) || readBlobs(root, [e.sha]).get(e.sha);
    return b ? b.toString('utf8') : null;
  };
  const artkit = tipText('ARTKIT.md') || '';
  const sources = tree.filter((e) => /(^|\/)SOURCES\.md$/.test(e.path)).map((e) => ({ dir: e.path.replace(/SOURCES\.md$/, ''), text: tipText(e.path) || '' }));
  const credits = tipText('CREDITS.md');
  const creditsJs = tipText('src/audio/credits.js');
  const screenLines = creditsScreenLines(root, tree);
  const assets = tree.filter((e) => ASSET_DIRS.some((d) => e.path.startsWith(`${d}/`)) && !/(^|\/)(SOURCES|README)\.md$/.test(e.path));
  for (const a of assets) {
    const base = a.path.split('/').pop();
    const inKit = artkit.includes(a.path) || artkit.includes(`\`${base}\``);
    const src = sources.filter((s) => a.path.startsWith(s.dir) && s.text.includes(base));
    if (!inKit && !src.length) lic.push(`${a.path} is in neither ARTKIT.md nor a SOURCES.md (where did it come from?)`);
    for (const s of src) {
      for (const line of s.text.split('\n').filter((l) => l.includes(base))) {
        if (BAD_LICENCE.test(line)) lic.push(`${a.path}: licence forbids public redistribution: ${line.trim().slice(0, 120)}`);
        if (CC_BY.test(line)) {
          const rule = CREDIT_RULES.find((r) => r.match.test(line));
          if (!rule) {
            lic.push(`${a.path}: CC BY source without a credit rule in prepublish.mjs: ${line.trim().slice(0, 120)}`);
            continue;
          }
          for (const need of rule.need(line)) {
            if (!credits || !credits.includes(need)) lic.push(`${a.path}: CREDITS.md lacks "${need}"`);
            const onScreen = screenLines ? screenLines.some((l) => l.includes(need)) : !!creditsJs && creditsJs.includes(need);
            if (!onScreen) lic.push(`${a.path}: the Credits screen (src/audio/credits.js) lacks "${need}"`);
          }
          if (credits && !credits.includes('https://creativecommons.org/licenses/by/4.0/')) lic.push('CREDITS.md lacks the CC BY 4.0 licence link');
        }
      }
    }
  }
  for (const s of sources) {
    for (const line of s.text.split('\n')) if (BAD_LICENCE.test(line)) lic.push(`${s.dir}SOURCES.md: ${line.trim().slice(0, 120)}`);
  }
  add('licences', [...new Set(lic)], `${assets.length} shipped asset files all traced to ARTKIT.md or a SOURCES.md, licences allow publishing, CC BY credits present`);

  // size
  add('size', tree.filter((e) => e.size > MAX_FILE).map((e) => `${e.path} is ${(e.size / 1048576).toFixed(1)} MB`),
    `largest tracked file ${(Math.max(0, ...tree.map((e) => e.size)) / 1048576).toFixed(1)} MB`);

  return { ref, tip, commits: commits.length, files: tree.length, blobs: blobs.size, results, pass: results.every((r) => r.pass) };
}

function main() {
  const argv = process.argv.slice(2);
  let ref = 'main';
  let json = '';
  let root = resolve(HERE, '..', '..');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ref') ref = argv[++i];
    else if (argv[i] === '--json') json = argv[++i];
    else if (argv[i] === '--root') root = resolve(argv[++i]);
    else if (argv[i] === '--hash-name') { console.log(sha256(String(argv[++i] || '').trim().toLowerCase())); return 0; }
    else if (argv[i] === '--help' || argv[i] === '-h') { console.log('see the header of tools/qa/prepublish.mjs'); return 0; }
    else { console.error(`unknown option ${argv[i]}`); return 2; }
  }
  const r = runChecks({ root, ref });
  console.log(`Kiln pre-publish check: ${r.ref} @ ${r.tip}, ${r.commits} commits, ${r.files} files, ${r.blobs} blobs in history`);
  for (const c of r.results) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.pass ? c.okText : `${c.findings.length} finding(s)`}`);
    for (const f of c.findings.slice(0, 20)) console.log(`     - ${f}`);
    for (const w of (c.warnings || []).slice(0, 10)) console.log(`     ~ warning: ${w}`);
    if (c.findings.length > 20) console.log(`     ... and ${c.findings.length - 20} more`);
  }
  console.log(`\nRESULT: ${r.pass ? 'PASS, safe to publish' : 'FAIL, do not publish'}`);
  if (json) writeFileSync(json, JSON.stringify(r, null, 2));
  return r.pass ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
