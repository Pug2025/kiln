#!/usr/bin/env node
// Kiln: the service worker's file list (OWNER: D). Node only (never imported by the page).
//
//   node src/app/sw-files.mjs           print the shipped files
//   node src/app/sw-files.mjs --write   rewrite the FILES block in sw.js from git
//   node src/app/sw-files.mjs --check   exit 1 if sw.js's list differs from what git ships
//
// Shipped = what the game loads: index.html, the manifest, ARTKIT.md/READY (read by the renderer),
// css/**, src/**, textures/**, glyphs/**, models/**, img/**, icons/**, audio/**, minus other
// documentation (*.md). Planning files are gitignored, so they can never appear. G's deploy runs
// --write before stamping BUILD.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ARTKIT.md / ARTKIT.READY: the renderer reads them at run time to find F's finished kit files
export const SHIP_FILES = ['index.html', 'manifest.webmanifest', 'ARTKIT.md', 'ARTKIT.READY'];
export const SHIP_DIRS = ['css/', 'src/', 'vendor/', 'textures/', 'glyphs/', 'models/', 'img/', 'icons/', 'audio/'];
/** Paths D owns (FILEMAP): their entries are always checked strictly. */
export const D_PATHS = ['index.html', 'manifest.webmanifest', 'css/', 'vendor/', 'src/main.js', 'src/input/', 'src/ui/', 'src/app/'];
const BEGIN = '// FILES:BEGIN';
const END = '// FILES:END';
const PRELOAD_BEGIN = '<!-- STARTUP:BEGIN';
const PRELOAD_END = '<!-- STARTUP:END -->';

export const repoRoot = () => join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Tracked files plus new ones not ignored (so an uncommitted file counts in its own worktree). */
export function gitFiles(root = repoRoot()) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  return [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))];
}

export function isShipped(f) {
  if (SHIP_FILES.includes(f)) return true;
  if (f.endsWith('.md')) return false;
  return SHIP_DIRS.some((d) => f.startsWith(d));
}

export function isD(f) {
  return D_PATHS.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p));
}

export function shippedFiles(all) {
  return all.filter(isShipped).sort();
}

/** The FILES array as sw.js holds it. */
export function readList(swText) {
  const a = swText.indexOf(BEGIN);
  const b = swText.indexOf(END);
  if (a < 0 || b < a) throw new Error('sw.js has no FILES block');
  const block = swText.slice(a + BEGIN.length, b);
  const m = block.match(/\[([\s\S]*)\]/);
  if (!m) throw new Error('sw.js FILES block has no array');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

export function writeList(swText, files) {
  const a = swText.indexOf(BEGIN);
  const b = swText.indexOf(END);
  const body = files.map((f) => `  '${f}',`).join('\n');
  const block = `${BEGIN} (generated: node src/app/sw-files.mjs --write)\nconst FILES = [\n${body}\n];\n`;
  return swText.slice(0, a) + block + swText.slice(b);
}

/** Static dependencies only. Dynamic art/adapter imports keep their optional loading policy. */
export function staticImports(source) {
  const imports = [...source.matchAll(/^import\s+(?:(?:[^;]*?)\s+from\s+)?['"]([^'"]+)['"]\s*;/gm)].map((m) => m[1]);
  const exports = [...source.matchAll(/^export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]\s*;/gm)].map((m) => m[1]);
  return [...new Set([...imports, ...exports])];
}

/** The real entry's static closure, resolved through the page's import map. */
export function startupModules(root = repoRoot(), entry = 'src/main.js') {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const mapText = /<script\b[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!mapText) throw new Error('index.html has no import map');
  const imports = JSON.parse(mapText).imports;
  const prefixes = Object.keys(imports).filter((p) => p.endsWith('/')).sort((a, b) => b.length - a.length);
  const seen = new Set();
  function visit(path) {
    if (seen.has(path)) return;
    if (/^[a-z]+:/i.test(path) || path.startsWith('../')) throw new Error(`Startup dependency must be local: ${path}`);
    seen.add(path);
    for (const spec of staticImports(readFileSync(join(root, path), 'utf8'))) {
      let next;
      if (spec.startsWith('.')) next = join(dirname(path), spec);
      else {
        const prefix = prefixes.find((p) => spec.startsWith(p));
        const mapped = imports[spec] ?? (prefix ? imports[prefix] + spec.slice(prefix.length) : null);
        if (!mapped || !mapped.startsWith('./')) throw new Error(`Unresolved local startup import: ${spec} in ${path}`);
        next = mapped.slice(2);
      }
      visit(next);
    }
  }
  visit(entry);
  return [...seen].sort();
}

export function readPreloads(html) {
  const begin = html.indexOf(PRELOAD_BEGIN), end = html.indexOf(PRELOAD_END);
  if (begin < 0 || end < begin) return [];
  return [...html.slice(begin, end).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

export function writePreloads(html, modules) {
  const block = `${PRELOAD_BEGIN} (generated: node src/app/sw-files.mjs --write) -->\n`
    + modules.map((path) => `<link rel="modulepreload" href="${path}" data-kiln-module>`).join('\n')
    + `\n${PRELOAD_END}`;
  const begin = html.indexOf(PRELOAD_BEGIN), end = html.indexOf(PRELOAD_END);
  if (begin < 0 || end < begin) return html.replace('</head>', `${block}\n</head>`);
  return html.slice(0, begin) + block + html.slice(end + PRELOAD_END.length);
}

/**
 * Optional modules other agents add (src/app/adapters.js HOME). The page imports only those that
 * exist, from the generated src/app/present.js, so it never probes a missing file (no 404s).
 */
export const OPTIONAL = [
  'economy/mods.js', 'economy/overloads.js', 'economy/forge.js', 'audio/credits.js', 'audio/music.js',
  'render/wordmark.js', 'levels/twists.js',
];

export function presentModule(files) {
  const have = OPTIONAL.filter((p) => files.includes(`src/${p}`));
  return '// Kiln: which optional modules exist (OWNER: D). GENERATED by `node src/app/sw-files.mjs --write`;\n'
    + '// src/app/adapters.js imports only these, so the page never asks for a file that is not there.\n'
    + `export const PRESENT = ${JSON.stringify(have)};\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = repoRoot();
  const swPath = join(root, 'sw.js');
  const files = shippedFiles(gitFiles(root));
  const arg = process.argv[2] || '';
  if (arg === '--write') {
    writeFileSync(join(root, 'src/app/present.js'), presentModule(files));
    const withPresent = files.includes('src/app/present.js') ? files : [...files, 'src/app/present.js'].sort();
    writeFileSync(swPath, writeList(readFileSync(swPath, 'utf8'), withPresent));
    const modules = startupModules(root);
    const index = join(root, 'index.html');
    writeFileSync(index, writePreloads(readFileSync(index, 'utf8'), modules));
    console.log(`sw.js: ${withPresent.length} files; startup: ${modules.length} local modules; present: ${OPTIONAL.filter((p) => files.includes(`src/${p}`)).join(' ') || 'none'}`);
  } else if (arg === '--check') {
    const have = readList(readFileSync(swPath, 'utf8'));
    const missing = files.filter((f) => !have.includes(f));
    const stale = have.filter((f) => !files.includes(f));
    const modules = startupModules(root);
    const preloads = readPreloads(readFileSync(join(root, 'index.html'), 'utf8'));
    const preloadMismatch = JSON.stringify(modules) !== JSON.stringify(preloads);
    if (missing.length || stale.length || preloadMismatch) {
      console.log(`missing: ${missing.join(' ') || '-'}\nstale: ${stale.join(' ') || '-'}`);
      if (preloadMismatch) console.log('startup preload manifest differs from the static entry graph');
      process.exit(1);
    }
    console.log(`sw.js list current (${files.length} files); startup manifest current (${modules.length} modules)`);
  } else console.log(files.join('\n'));
}
