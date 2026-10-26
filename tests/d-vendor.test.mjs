// The local dependency must remain the exact reviewed version and include its real import closure.
import { test, assert } from './lib.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { repoRoot, startupModules, staticImports, readPreloads, shippedFiles, gitFiles } from '../src/app/sw-files.mjs';

const root = repoRoot(), base = 'vendor/three/0.160.0/';
const read = (path) => readFileSync(join(root, path), 'utf8');
const provenance = JSON.parse(read(base + 'PROVENANCE.json'));

test('local Three.js is the exact pinned MIT package with unchanged selected source bytes', () => {
  assert.equal(provenance.version, '0.160.0');
  assert.equal(provenance.archiveSha256, '1ee2f935c4f555814b388e87b5ef78a44856bd2e9d0feb88643a6e193fb42856');
  assert.equal(provenance.files['build/three.module.js'].sha256, '76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495');
  assert.equal(Object.keys(provenance.files).filter((path) => path.endsWith('.js')).length, 14);
  for (const [path, source] of Object.entries(provenance.files)) {
    const bytes = readFileSync(join(root, base, path));
    assert.equal(bytes.length, source.bytes, path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, path);
  }
  assert.match(read(base + 'LICENSE'), /Copyright © 2010-2023 three\.js authors/);
  assert.match(read(base + 'LICENSE'), /The above copyright notice and this permission notice shall be included/);
  assert.equal(provenance.license, 'MIT');
  assert.match(read('CREDITS.md'), /Three\.js 0\.160\.0 by the three\.js authors, MIT License/);
});

test('all mandatory entry dependencies are local, observed by preload and shipped for atomic offline install', () => {
  const modules = startupModules(root);
  assert.deepEqual(readPreloads(read('index.html')), modules);
  assert.equal(modules.filter((path) => path.startsWith(base)).length, 10);
  assert.ok(!modules.some((path) => /UnrealBloomPass|LuminosityHighPassShader/.test(path)), 'owned bloom no longer preloads the unused native chain');
  assert.ok(!modules.some((path) => /GLTFLoader|BufferGeometryUtils/.test(path)), 'optional model loading stays optional at startup');
  const shipped = new Set(shippedFiles(gitFiles(root)));
  for (const path of modules) assert.ok(shipped.has(path), `${path} ships`);
  for (const path of Object.keys(provenance.files)) assert.ok(shipped.has(base + path), `${path} is in the required offline build`);
  const walk = (dir) => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((item) => item.isDirectory() ? walk(`${dir}/${item.name}`) : [`${dir}/${item.name}`]);
  for (const path of walk(base.slice(0, -1)).filter((p) => p.endsWith('.js'))) {
    for (const spec of staticImports(read(path))) {
      if (spec === 'three') continue;
      assert.ok(spec.startsWith('.'), `${path} imports no new external package: ${spec}`);
      const resolved = fileURLToPath(new URL(spec, `file://${join(root, path)}`));
      assert.ok(Object.keys(provenance.files).some((p) => join(root, base, p) === resolved), `${path}: ${spec} is included`);
    }
  }
});
