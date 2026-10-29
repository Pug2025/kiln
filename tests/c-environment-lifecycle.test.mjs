// Exercise the real procedural environment's resource ownership without creating a GL context.
import { register } from 'node:module';
import { test, assert } from './lib.mjs';

const stubURL = new URL('./fixtures/C/three-stub.mjs', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec,ctx,next){
  if(spec==='three'||spec==='three/addons/geometries/RoundedBoxGeometry.js')return{url:${JSON.stringify(stubURL)},shortCircuit:true};
  return next(spec,ctx);
}`)}`);
const stub = await import(stubURL);
const { makeEnvironment } = await import('../src/render/kiln.js');

function observeTemporaries(operation) {
  const counts = new Map();
  const prototypes = [stub.PlaneGeometry.prototype, stub.ShaderMaterial.prototype];
  const previous = prototypes.map(prototype => prototype.dispose);
  for (const prototype of prototypes) prototype.dispose = function () { counts.set(this, (counts.get(this) || 0) + 1); };
  try { return operation(counts); }
  finally { prototypes.forEach((prototype, index) => { prototype.dispose = previous[index]; }); }
}

function assertTemporariesReleased(generator, counts) {
  for (const mesh of generator.scene.children) {
    assert.equal(counts.get(mesh.geometry), 1, 'procedural geometry released exactly once');
    assert.equal(counts.get(mesh.material), 1, 'procedural material released exactly once');
  }
  assert.equal(generator.disposals, 1, 'generator scratch resources released');
}

test('environment: output survives generator cleanup and retiring its texture releases its whole target once', () => {
  observeTemporaries(counts => {
    const gl = {}, texture = makeEnvironment(gl), generator = stub.STUB.pmrem.at(-1);
    assert.equal(generator.gl, gl);
    assert.equal(texture, generator.target.texture, 'the public API remains the generated texture');
    assertTemporariesReleased(generator, counts);
    assert.equal(generator.target.disposals, 0, 'scratch cleanup retains the sampled output');
    texture.dispose();
    texture.dispose();
    assert.equal(generator.target.disposals, 1, 'texture retirement also releases framebuffer and depth ownership');
  });
});

test('environment: replacing a map retires only that map and the final replacement can be disposed', () => {
  const first = makeEnvironment({}), firstTarget = stub.STUB.pmrem.at(-1).target;
  const second = makeEnvironment({}), secondTarget = stub.STUB.pmrem.at(-1).target;
  assert.notEqual(first, second);
  first.dispose();
  assert.equal(firstTarget.disposals, 1);
  assert.equal(secondTarget.disposals, 0, 'the replacement remains live');
  second.dispose();
  assert.equal(secondTarget.disposals, 1);
});

test('environment: a generation failure still releases procedural geometry, materials and generator scratch', () => {
  observeTemporaries(counts => {
    stub.STUB.failPmrem = true;
    try { assert.throws(() => makeEnvironment({}), /PMREM unavailable/); }
    finally { stub.STUB.failPmrem = false; }
    assertTemporariesReleased(stub.STUB.pmrem.at(-1), counts);
  });
});
