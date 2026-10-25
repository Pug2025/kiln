import { test, assert } from './lib.mjs';
import { register } from 'node:module';

register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === '../render/renderer.js') return { url: 'data:text/javascript,export const startupTest = true;', shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const adapterUrl = new URL('../src/app/adapters.js', import.meta.url);
const { loadAdapters } = await import(adapterUrl);

test('an optional module stall reaches existing fallbacks and late completion cannot mutate the returned API', async () => {
  let late;
  const warnings = [];
  const api = await loadAdapters({ timeoutMs: 5, diagnostic: (record) => warnings.push(record), importModule(path) {
    if (path === '../render/wordmark.js') return new Promise((resolve) => { late = resolve; });
    return import(new URL(path, adapterUrl));
  } });
  assert.equal(api.createWordmarkFlame, null);
  assert.equal(api.real.wordmark, false);
  assert.ok(warnings.some((record) => record.url === new URL('../src/render/wordmark.js', import.meta.url).href && /timed out/.test(record.message)));
  late({ createWordmarkFlame() {}, createTitleWall() {} });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(api.createWordmarkFlame, null);
  assert.equal(api.createTitleWall, null);
  assert.ok(api.modChoices({ seed: 1, mods: [] }, 13).length > 0, 'fallback pick data remains usable');
});
