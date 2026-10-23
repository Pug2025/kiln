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

const BUILD = '2026-10-23T1542Z-81a2161';
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
  'img/headroom/stoker_mid.webp',
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
  'src/render/boss-feedback.js',
  'src/render/boss.js',
  'src/render/bricks.js',
  'src/render/ceiling.js',
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
  'src/render/phone-marks.js',
  'src/render/pieces.js',
  'src/render/post.js',
  'src/render/renderer.js',
  'src/render/rig.js',
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
  'textures/carbon_detail.png',
  'textures/crackle.png',
  'textures/crackle_n.png',
  'textures/obsidian.png',
  'textures/obsidian_n.png',
];
// FILES:END

async function addAll(cache, list) {
  // one by one: a missing file must not stop the rest from going offline
  await Promise.allSettled(list.map(async (f) => {
    const res = await fetch(f, { cache: 'reload' });
    if (res.ok) await cache.put(f, res);
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE);
    await addAll(cache, ['./', ...FILES.filter((f) => !lazy(f))]);
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

async function fromCache(request) {
  return (await caches.match(request, { ignoreSearch: true })) || null;
}

async function runtime(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') {
    const cache = await caches.open(RUNTIME);
    cache.put(request, res.clone()).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith((async () => {
        const cached = (await caches.match('index.html', { ignoreSearch: true })) || (await caches.match('./', { ignoreSearch: true }));
        if (cached) return cached;
        return fetch(req);
      })());
      return;
    }
    if (req.headers.has('range')) {
      // media range requests want a 206 from the network; the cached whole file only when offline
      event.respondWith(fetch(req).catch(async () => (await fromCache(req)) || Response.error()));
      return;
    }
    event.respondWith((async () => {
      const hit = await fromCache(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && url.pathname.match(/\.(js|mjs|css|png|webp|jpg|glb|m4a|mp3|ogg|wav|json|webmanifest)$/)) {
        const cache = await caches.open(CORE);
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })());
    return;
  }
  if (CDN.test(req.url)) event.respondWith(runtime(req));
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'cache-urls' && Array.isArray(msg.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(RUNTIME);
      // the page lists what Resource Timing saw; Chrome leaves the font files out of it, so the
      // Google Fonts stylesheet adds its Latin faces here (G's pwacheck: offline text kept Inter)
      const list = msg.urls.slice();
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        if (!CDN.test(u)) continue;
        try {
          let res = await cache.match(u);
          if (!res) {
            res = await fetch(u, { mode: 'cors', credentials: 'omit' });
            if (!res.ok) continue;
            await cache.put(u, res.clone());
          }
          if (u.startsWith('https://fonts.googleapis.com/')) {
            for (const face of (await res.text()).split('@font-face').slice(1)) {
              if (!/unicode-range:\s*U\+0000-00FF/i.test(face)) continue; // Latin only (2 files)
              const m = /url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/.exec(face);
              if (m && !list.includes(m[1])) list.push(m[1]);
            }
          }
        } catch { /* offline: next visit */ }
      }
    })());
  } else if (msg.type === 'warm') {
    event.waitUntil((async () => {
      const cache = await caches.open(CORE);
      for (const f of FILES.filter(lazy)) {
        if (await cache.match(f)) continue;
        try {
          const res = await fetch(f);
          if (res.ok) await cache.put(f, res);
        } catch { return; }
      }
    })());
  }
});
