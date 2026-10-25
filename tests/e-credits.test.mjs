// E: credit lines and audio file sources.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './lib.mjs';
import { CREDITS, CREDIT_LINES, creditLines, isShipped } from '../src/audio/credits.js';
import { MUSIC_FILES, TRACKS } from '../src/audio/music.js';
import { SFX_FILES } from '../src/audio/sfx.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// PLAN §7 "Credits", copied exactly.
const PLAN_LINES = [
  "'Machina' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  "'Nightfall' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  "'Resonance' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  "'Red' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  "'Ambush' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  "'Legacy' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
  'Drone: "Free Music ATMOS – Linear Atmospheres", FabienC@RustedMusicStudio, CC BY 4.0, https://rustedstudio.itch.io/free-music-atmos-linear-atmospheres',
  'Sounds: "Dark Sci-Fi Audio Pack" by SRG774, CC0, https://opengameart.org/content/dark-sci-fi-audio-pack',
  'Licence text: https://creativecommons.org/licenses/by/4.0/',
  'Three.js 0.160.0 by the three.js authors, MIT License, https://threejs.org/',
];

test('credit lines match the exact format', () => {
  assert.deepEqual([...CREDIT_LINES], PLAN_LINES);
  const sb = /^'([A-Za-z ]+)' by Scott Buckley - released under CC-BY 4\.0\. www\.scottbuckley\.com\.au$/;
  const titles = CREDITS.filter((c) => c.kind === 'music').map((c) => {
    const m = sb.exec(c.line);
    assert.ok(m, `format: ${c.line}`);
    assert.equal(m[1], c.title);
    return c.title;
  });
  const trackTitles = Object.values(TRACKS).map((t) => t.title);
  assert.deepEqual(titles.sort(), trackTitles.sort(), 'one credit per soundtrack title');
  const EM_DASH = String.fromCharCode(0x2014);
  for (const line of CREDIT_LINES) assert.ok(!line.includes(EM_DASH), 'no em dash');
});

test('CREDITS.md carries every credit line verbatim', () => {
  const md = readFileSync(join(root, 'CREDITS.md'), 'utf8');
  for (const line of PLAN_LINES) assert.ok(md.includes(line), `CREDITS.md has: ${line}`);
});

test('the Credits screen lists every shipped work and nothing that does not ship', () => {
  const lines = creditLines();
  for (const c of CREDITS) assert.equal(lines.includes(c.line), isShipped(c), c.title);
  assert.ok(lines.includes(PLAN_LINES[8]), 'licence text always shown');
  // Every shipped file is covered by a credit.
  const covered = new Set(CREDITS.flatMap((c) => c.files));
  for (const name of [...Object.keys(MUSIC_FILES), ...Object.keys(SFX_FILES)]) assert.ok(covered.has(name), `${name} is credited`);
});

function audioFiles(sub) {
  const dir = join(root, 'audio', sub);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => !f.startsWith('.') && f !== 'SOURCES.md');
}

test('every file in audio/ has a SOURCES entry with its source URL, and is used', () => {
  let bytes = 0;
  for (const sub of ['music', 'sfx']) {
    const files = audioFiles(sub);
    if (!files.length) continue;
    const srcPath = join(root, 'audio', sub, 'SOURCES.md');
    assert.ok(existsSync(srcPath), `audio/${sub}/SOURCES.md exists`);
    const rows = readFileSync(srcPath, 'utf8').split('\n').filter((l) => l.startsWith('| `'));
    for (const f of files) {
      assert.ok(!/\.ogg$/i.test(f), `${f}: no .ogg (Safari)`);
      assert.ok(/\.(m4a|mp3)$/i.test(f), `${f}: AAC .m4a or .mp3`);
      const row = rows.find((r) => r.startsWith(`| \`${f}\``));
      assert.ok(row, `audio/${sub}/${f} has a SOURCES row`);
      assert.match(row, /\| https:\/\/\S+\.mp3 \|/, `${f}: source URL beside it`);
      assert.match(row, /\| (CC BY 4\.0|CC0) \|$/, `${f}: licence`);
      bytes += statSync(join(root, 'audio', sub, f)).size;
    }
    for (const r of rows) {
      const name = /^\| `([^`]+)`/.exec(r)[1];
      assert.ok(files.includes(name), `SOURCES row ${name} has its file`);
    }
  }
  const shipped = [
    ...Object.values(MUSIC_FILES),
    ...Object.values(SFX_FILES).map((s) => s.path),
  ];
  for (const p of shipped) assert.ok(existsSync(join(root, p)), `${p} exists`);
  const listed = new Set(shipped.map((p) => p.split('/').pop()));
  for (const sub of ['music', 'sfx']) for (const f of audioFiles(sub)) assert.ok(listed.has(f), `${f} is in a manifest`);
  assert.ok(bytes < 30 * 1024 * 1024, `audio total ${(bytes / 1048576).toFixed(1)} MB under 30 MB`);
});
