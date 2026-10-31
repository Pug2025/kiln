// Kiln: service worker (OWNER: D). Offline play and quiet updates.
//
// BUILD is stamped by G's deploy script on every release: a changed byte makes the browser
// install this worker again (the page registers it with updateViaCache 'none'), which caches the
// new build under a new name, takes over, and drops the old cache. The page reloads into it at
// the next title or level map and says "Updated" (src/app/pwa.js).
//
// Caches:
//   kiln-core-<BUILD>  every shipped file (FILES below), cache-first; music for other worlds is
//                      warmed in the background after install, on a good connection
//   kiln-runtime-v1    three.js from jsDelivr and Google Fonts (CSS and font files), cache-first
// Navigation always answers with the cached index.html (query strings such as ?level are ignored).

const BUILD = '2026-10-31T1413Z-0603600';
const CORE = `kiln-core-${BUILD}`;
const RUNTIME = 'kiln-runtime-v1';
const CDN = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;
const lazy = (f) => f.startsWith('audio/music/');

// FILES:BEGIN (generated: node src/app/sw-files.mjs --write)
const FILES = [
  'ARTKIT.READY',
  'ARTKIT.md',
  'audio/music/ambush.m4a',
  'audio/music/legacy.m4a',
  'audio/music/machina.m4a',
  'audio/music/nightfall-no-solo-strings.m4a',
  'audio/music/nightfall.m4a',
  'audio/music/red-no-vocals.m4a',
  'audio/music/red.m4a',
  'audio/music/resonance-no-melody-in-backend.m4a',
  'audio/music/resonance.m4a',
  'audio/music/transmission.m4a',
  'audio/sfx/hover.m4a',
  'audio/sfx/victory.m4a',
  'css/app.css',
  'css/hud.css',
  'css/screens.css',
  'css/tokens.css',
  'glyphs/catch.png',
  'glyphs/drops.png',
  'glyphs/fast.png',
  'glyphs/fire.png',
  'glyphs/fog.png',
  'glyphs/laser.png',
  'glyphs/life.png',
  'glyphs/mega.png',
  'glyphs/multi.png',
  'glyphs/shrink.png',
  'glyphs/slow.png',
  'glyphs/thru.png',
  'glyphs/wide.png',
  'icons/favicon.png',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'img/backdrop.webp',
  'img/headroom/blaze.webp',
  'img/headroom/blaze_glow.png',
  'img/headroom/core.webp',
  'img/headroom/core_glow.png',
  'img/headroom/core_mid.webp',
  'img/headroom/crucible.webp',
  'img/headroom/crucible_glow.png',
  'img/headroom/crucible_mid.webp',
  'img/headroom/ember.webp',
  'img/headroom/ember_glow.png',
  'img/headroom/stoker.webp',
  'img/headroom/stoker_glow.png',
  'img/headroom/whiteheat.webp',
  'img/headroom/whiteheat_glow.png',
  'img/hearth.webp',
  'img/levels/blaze.webp',
  'img/levels/ember.webp',
  'img/levels/overburn.webp',
  'img/levels/whiteheat.webp',
  'index.html',
  'manifest.webmanifest',
  'models/core.glb',
  'models/crucible.glb',
  'models/stoker.glb',
  'src/app/adapters.js',
  'src/app/fallbacks.js',
  'src/app/flow.js',
  'src/app/fonts.js',
  'src/app/present.js',
  'src/app/pwa.js',
  'src/app/safe-area.js',
  'src/app/sw-files.mjs',
  'src/audio/audio.js',
  'src/audio/credits.js',
  'src/audio/music.js',
  'src/audio/sfx.js',
  'src/content/bosses.js',
  'src/content/bosses/common.js',
  'src/content/bosses/orbit.js',
  'src/content/bosses/stoker.js',
  'src/content/bricks.js',
  'src/content/content.js',
  'src/content/gates.js',
  'src/content/sentries.js',
  'src/core/bus.js',
  'src/core/constants.js',
  'src/core/events.js',
  'src/core/headless.js',
  'src/core/input-frame.js',
  'src/core/readability.js',
  'src/core/rng.js',
  'src/core/types.js',
  'src/core/world.js',
  'src/debug/gallery.html',
  'src/debug/gallery.js',
  'src/debug/overlay.js',
  'src/debug/wordmark.html',
  'src/economy/drops.js',
  'src/economy/economy.js',
  'src/economy/forge.js',
  'src/economy/mods.js',
  'src/economy/overloads.js',
  'src/economy/save.js',
  'src/economy/score.js',
  'src/economy/tuning.js',
  'src/input/gestures.js',
  'src/input/input.js',
  'src/levels/data/blaze.js',
  'src/levels/data/ember.js',
  'src/levels/data/whiteheat.js',
  'src/levels/index.js',
  'src/levels/legend.js',
  'src/levels/overburn.js',
  'src/levels/parser.js',
  'src/main.js',
  'src/render/actors.js',
  'src/render/ball-bloom.js',
  'src/render/bloom.js',
  'src/render/boss-feedback.js',
  'src/render/boss.js',
  'src/render/bricks.js',
  'src/render/ceiling.js',
  'src/render/core-damage.js',
  'src/render/fire.js',
  'src/render/fit.js',
  'src/render/fx.js',
  'src/render/glcontext.js',
  'src/render/gputimer.js',
  'src/render/headroom.js',
  'src/render/kiln.js',
  'src/render/kit.js',
  'src/render/laser-mounts.js',
  'src/render/look.js',
  'src/render/marks.js',
  'src/render/materials.js',
  'src/render/overlays.js',
  'src/render/pace.js',
  'src/render/paddle-source.js',
  'src/render/palette-uniforms.js',
  'src/render/phone-marks.js',
  'src/render/pieces.js',
  'src/render/post.js',
  'src/render/renderer.js',
  'src/render/rig.js',
  'src/render/shader-preparation.js',
  'src/render/shaders.js',
  'src/render/trail.js',
  'src/render/wordmark.js',
  'src/sim/aim.js',
  'src/sim/ball.js',
  'src/sim/bodies.js',
  'src/sim/ceiling.js',
  'src/sim/collide.js',
  'src/sim/feel.js',
  'src/sim/field.js',
  'src/sim/paddle.js',
  'src/sim/physics.js',
  'src/sim/robot.js',
  'src/systems.js',
  'src/ui/dom.js',
  'src/ui/hud.js',
  'src/ui/icons.js',
  'src/ui/layout.js',
  'src/ui/nav.js',
  'src/ui/play-help.js',
  'src/ui/resources.js',
  'src/ui/screens/card.js',
  'src/ui/screens/credits.js',
  'src/ui/screens/forge.js',
  'src/ui/screens/guide.js',
  'src/ui/screens/index.js',
  'src/ui/screens/map.js',
  'src/ui/screens/parts.js',
  'src/ui/screens/pause.js',
  'src/ui/screens/pick.js',
  'src/ui/screens/results.js',
  'src/ui/screens/settings.js',
  'src/ui/screens/title.js',
  'src/ui/ui.js',
  'textures/crackle.png',
  'textures/crackle_mask.png',
  'textures/crackle_n.png',
  'textures/obsidian.png',
  'vendor/three/0.160.0/LICENSE',
  'vendor/three/0.160.0/PROVENANCE.json',
  'vendor/three/0.160.0/build/three.module.js',
  'vendor/three/0.160.0/examples/jsm/geometries/RoundedBoxGeometry.js',
  'vendor/three/0.160.0/examples/jsm/loaders/GLTFLoader.js',
  'vendor/three/0.160.0/examples/jsm/postprocessing/EffectComposer.js',
  'vendor/three/0.160.0/examples/jsm/postprocessing/MaskPass.js',
  'vendor/three/0.160.0/examples/jsm/postprocessing/OutputPass.js',
  'vendor/three/0.160.0/examples/jsm/postprocessing/Pass.js',
  'vendor/three/0.160.0/examples/jsm/postprocessing/RenderPass.js',
  'vendor/three/0.160.0/examples/jsm/postprocessing/ShaderPass.js',
  'vendor/three/0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js',
  'vendor/three/0.160.0/examples/jsm/shaders/CopyShader.js',
  'vendor/three/0.160.0/examples/jsm/shaders/LuminosityHighPassShader.js',
  'vendor/three/0.160.0/examples/jsm/shaders/OutputShader.js',
  'vendor/three/0.160.0/examples/jsm/utils/BufferGeometryUtils.js',
];
// FILES:END

const FETCH_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 200;
const DIAGNOSTIC_TIMEOUT_MS = 1000;
const transient = (status) => status === 408 || status === 429 || status >= 500;
const critical = (url) => /\.(html|js|mjs|css)$/.test(url.pathname);
const absolute = (request) => request ? new URL(typeof request === 'string' ? request : request.url, self.registration.scope).href : null;

/** A resulting navigation client can wait for respondWith before its lookup resolves. Never
 * make response/error delivery depend on diagnostics, including an eventual lookup rejection.
 */
function report(context, stage, request, { status = null, error = null, attempt = 0 } = {}) {
  const delivery = (async () => {
    try {
      const message = { type: 'kiln-startup-diagnostic', build: BUILD, stage, url: absolute(request),
        status, error: error ? String(error.message || error) : null, attempt, severity: 'warning' };
      if (context.clientId) {
        const client = await self.clients.get(context.clientId);
        if (client) client.postMessage(message);
      } else if (context.broadcast) {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) client.postMessage(message);
      }
    } catch { /* client lookup, client closure and postMessage are all best effort */ }
  })();
  let timer;
  const lifetime = Promise.race([delivery, new Promise((resolve) => {
    timer = setTimeout(resolve, DIAGNOSTIC_TIMEOUT_MS);
  })]).finally(() => clearTimeout(timer));
  // Keep normal messages alive without pinning an install/fetch/warm event to a missing client.
  // A late lookup may still settle, but its caught promise cannot reject the event or the page.
  keepAlive(context, lifetime);
}

function keepAlive(context, work) {
  // Some browsers reject a late lifetime extension. Cache work remains best effort even then;
  // an InvalidStateError here must never replace the successful network response.
  try { if (context.waitUntil) context.waitUntil(work); }
  catch { /* a closed event cannot prevent online play */ }
  return work;
}

/** Required installs keep one deadline through headers and body, before any cache write starts. */
async function boundedFetch(request, init, completeBody = false) {
  const controller = new AbortController();
  let timer, response, receivingBody = false;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS} ms`);
      error.name = 'TimeoutError';
      reject(error);
      controller.abort();
    }, FETCH_TIMEOUT_MS);
  });
  const transfer = (async () => {
    response = await fetch(request, { ...init, signal: controller.signal });
    if (completeBody && response.ok) {
      receivingBody = true;
      // Reading a clone keeps the original status, headers, URL and bytes intact. Only required
      // installation fetches buffer a body; normal runtime responses continue to stream.
      await response.clone().arrayBuffer();
    }
    return response;
  })();
  try { return await Promise.race([transfer, timeout]); }
  catch (error) {
    controller.abort();
    if (!receivingBody) throw error;
    const failure = new Error(`Response body failed: ${error.message || error}`);
    failure.name = error.name || 'Error';
    failure.phase = 'body';
    failure.status = response.status;
    throw failure;
  }
  finally { clearTimeout(timer); }
}

/** Exactly two attempts total. A real 404 is returned once; only transient failures retry. */
async function fetchCritical(request, init, context, stage, completeBody = false) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response;
    try { response = await boundedFetch(request, init, completeBody); }
    catch (error) {
      report(context, error.phase === 'body' ? `${stage}-body` : stage, request,
        { error, attempt, status: Number.isFinite(error.status) ? error.status : null });
      if (attempt === 2) throw error;
    }
    if (response) {
      if (response.ok) return response;
      report(context, stage, request, { status: response.status, attempt });
      if (attempt === 2 || !transient(response.status)) return response;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}

async function addAll(cache, list, context) {
  // Every write settles before cleanup, including late successes after another required file
  // fails. A partial update never takes over or removes the previous complete offline build.
  const writes = await Promise.allSettled(list.map(async (file) => {
    const response = await fetchCritical(file, { cache: 'reload' }, context, 'install-fetch', true);
    if (!response.ok) throw new Error(`Cannot cache ${file}: ${response.status}`);
    try { await cache.put(file, response); }
    catch (error) {
      report(context, 'install-cache-write', file, { status: response.status, error });
      throw error;
    }
  }));
  const failed = writes.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}

self.addEventListener('install', (event) => {
  const context = { broadcast: true, waitUntil: (work) => event.waitUntil(work) };
  event.waitUntil((async () => {
    let existed, cache;
    try {
      existed = await caches.has(CORE);
      cache = await caches.open(CORE);
    } catch (error) {
      report(context, 'install-cache-open', null, { error });
      throw error;
    }
    try { await addAll(cache, ['./', ...FILES.filter((file) => !lazy(file))], context); }
    catch (error) {
      // Reused BUILD stamps can already have a complete cache. Never delete that cache, even
      // when a local development install fails. Cache API denial is an install warning only.
      if (!existed) {
        try { await caches.delete(CORE); }
        catch (cleanupError) { report(context, 'install-cache-delete', null, { error: cleanupError }); }
      }
      throw error;
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('kiln-core-') && n !== CORE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function fromCache(name, request, context, ignoreSearch = false) {
  // Read only this worker's build, or the explicit external-resource cache. Global match could
  // accidentally serve a module from another worker's incomplete or older build.
  try {
    const cache = await caches.open(name);
    const hit = await cache.match(request, { ignoreSearch });
    if (hit && !hit.ok && hit.type !== 'opaque') {
      report(context, 'cache-response', request, { status: hit.status });
      return null;
    }
    return hit || null;
  } catch (error) {
    report(context, 'cache-read', request, { error });
    return null;
  }
}

async function remember(name, request, response, context) {
  let cache;
  try { cache = await caches.open(name); }
  catch (error) { report(context, 'cache-open', request, { status: response.status, error }); return; }
  try { await cache.put(request, response); }
  catch (error) { report(context, 'cache-write', request, { status: response.status, error }); }
}

async function runtime(request, context) {
  const hit = await fromCache(RUNTIME, request, context);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') keepAlive(context, remember(RUNTIME, request, response.clone(), context));
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const context = { clientId: event.clientId || event.resultingClientId, waitUntil: (work) => event.waitUntil(work) };
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith((async () => {
        const cached = (await fromCache(CORE, 'index.html', context, true)) || (await fromCache(CORE, './', context, true));
        return cached || fetchCritical(request, undefined, context, 'navigate-fetch');
      })());
      return;
    }
    if (request.headers.has('range')) {
      // Keep media's network 206 response; use the cached whole file only when offline.
      event.respondWith(fetch(request).catch(async () => (await fromCache(CORE, request, context, true)) || Response.error()));
      return;
    }
    event.respondWith((async () => {
      const hit = await fromCache(CORE, request, context, true);
      if (hit) return hit;
      const response = critical(url) ? await fetchCritical(request, undefined, context, 'fetch') : await fetch(request);
      if (response.ok && url.pathname.match(/\.(js|mjs|css|png|webp|jpg|glb|m4a|mp3|ogg|wav|json|webmanifest)$/))
        keepAlive(context, remember(CORE, request, response.clone(), context));
      return response;
    })());
    return;
  }
  if (CDN.test(request.url)) event.respondWith(runtime(request, context));
});

self.addEventListener('message', (event) => {
  const message = event.data || {};
  const context = { clientId: event.source && event.source.id, waitUntil: (work) => event.waitUntil(work) };
  if (message.type === 'cache-urls' && Array.isArray(message.urls)) {
    event.waitUntil((async () => {
      // Resource Timing misses some font files; include the stylesheet's Latin faces as before.
      const list = message.urls.slice();
      for (let i = 0; i < list.length; i++) {
        const url = list[i];
        if (!CDN.test(url)) continue;
        try {
          let response = await fromCache(RUNTIME, url, context);
          if (!response) {
            response = await fetch(url, { mode: 'cors', credentials: 'omit' });
            if (!response.ok) continue;
            await remember(RUNTIME, url, response.clone(), context);
          }
          if (url.startsWith('https://fonts.googleapis.com/')) {
            for (const face of (await response.text()).split('@font-face').slice(1)) {
              if (!/unicode-range:\s*U\+0000-00FF/i.test(face)) continue;
              const match = /url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/.exec(face);
              if (match && !list.includes(match[1])) list.push(match[1]);
            }
          }
        } catch { /* optional font warm-up can wait for the next visit */ }
      }
    })());
  } else if (message.type === 'warm') {
    event.waitUntil((async () => {
      for (const file of FILES.filter(lazy)) {
        if (await fromCache(CORE, file, context)) continue;
        try {
          const response = await fetch(file);
          if (response.ok) await remember(CORE, file, response, context);
        } catch { return; }
      }
    })());
  }
});
