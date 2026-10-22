// Kiln: D's offline cache contract (sw.js, src/app/pwa.js, manifest.webmanifest).
//
// Strict always: no planning file in the cache list, every entry is a shipped path, D's own files
// are all listed and exist, the BUILD line and the registration rules are in place.
// Every shipped file of every agent must be listed (and nothing stale) when KILN_RELEASE=1, which
// G's deploy sets after running `node src/app/sw-files.mjs --write`; between releases a missing or
// stale entry from another agent is printed, not failed, so no agent's merge waits on D (the
// worker also caches any shipped file on first use, and skips missing ones at install).

import { test, assert } from './lib.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitFiles, shippedFiles, readList, isShipped, isD, repoRoot } from '../src/app/sw-files.mjs';

const root = repoRoot();
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const list = readList(sw);
const shipped = shippedFiles(gitFiles(root));
const RELEASE = process.env.KILN_RELEASE === '1';
const PLANNING = /^(PLAN\.md|ART\.md|CHANGELOG\.md|HANDOFF|BUILD-STATUS\.md|research\/|look-tests\/|art\/|plan-site\/|team\/|status\/|assets\/generated\/|tests\/|tools\/|\.worktrees\/)/;

test('sw.js has a BUILD line the deploy script can stamp', () => {
  assert.match(sw, /^const BUILD = '[^']*';$/m);
  assert.equal(sw.match(/^const BUILD = /gm).length, 1, 'exactly one BUILD line');
});

test('no planning file is in the cache list', () => {
  for (const f of list) {
    assert.ok(!PLANNING.test(f), `${f} must never be cached or shipped`);
    assert.ok(isShipped(f), `${f} is not a shipped path`);
    assert.ok(!f.endsWith('.md') || f === 'ARTKIT.md', `${f}: documentation is not cached`);
  }
  assert.equal(new Set(list).size, list.length, 'no duplicates');
});

test('every shipped file of D is in the sw.js cache list, and exists', () => {
  for (const f of shipped.filter(isD)) assert.ok(list.includes(f), `${f} missing from sw.js (node src/app/sw-files.mjs --write)`);
  for (const f of list.filter(isD)) assert.ok(existsSync(join(root, f)), `${f} is listed but does not exist`);
  for (const f of ['index.html', 'manifest.webmanifest', 'src/main.js', 'css/app.css']) assert.ok(list.includes(f), f);
});

test('every shipped file (index.html, src, css, textures, glyphs, models, img, icons, audio) is in the cache list', () => {
  const missing = shipped.filter((f) => !list.includes(f));
  const stale = list.filter((f) => !shipped.includes(f) || !existsSync(join(root, f)));
  if (RELEASE) {
    assert.deepEqual(missing, [], 'shipped but not cached');
    assert.deepEqual(stale, [], 'cached but not shipped');
  } else if (missing.length || stale.length) {
    console.log(`    d-sw: list behind the tree (fixed at D's next commit and by deploy): missing ${missing.length}, stale ${stale.length}`);
  }
  for (const d of ['textures/', 'glyphs/', 'icons/', 'models/', 'img/']) {
    if (shipped.some((f) => f.startsWith(d))) assert.ok(list.some((f) => f.startsWith(d)), `${d} cached`);
  }
});

test('registration: updateViaCache none, never on localhost unless ?sw=1', () => {
  const pwa = readFileSync(join(root, 'src/app/pwa.js'), 'utf8');
  assert.match(pwa, /register\('sw\.js', \{ updateViaCache: 'none' \}\)/);
  assert.match(pwa, /localhost/);
  assert.match(pwa, /params\.get\('sw'\) === '1'/);
});

test('manifest: standalone, portrait, icons that exist', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.orientation, 'portrait');
  assert.equal(m.background_color, '#07080A');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) {
    assert.ok(existsSync(join(root, i.src)), `${i.src} exists`);
    assert.ok(list.includes(i.src), `${i.src} cached`);
  }
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="icons\/icon-180\.png"/);
});
