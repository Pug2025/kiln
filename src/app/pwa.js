// Kiln: installable and offline (OWNER: D).
//
//   service worker  sw.js, registered with updateViaCache 'none' so every visit checks for a new
//                   BUILD. Not registered on localhost unless ?sw=1 (otherwise every agent would
//                   test stale cached code).
//   updates         a new build takes over in the background; the page reloads into it at the next
//                   safe point (title or level map, never live play) and says "Updated" once.
//   offline extras  after load, the page hands the SW the CDN modules and font files it actually
//                   used (three.js, Google Fonts), so a later offline launch has them too; music for
//                   the other worlds is warmed in the background on a good connection.
//   install         beforeinstallprompt is kept for the install offer (results after the first
//                   cleared level); iOS gets the Share-menu fact instead.

const UPDATED_KEY = 'kiln.updated';

/**
 * @param {{canReload:() => boolean, canToast:() => boolean, toast:(t:string) => void}} opts
 */
export function initPwa(opts) {
  const params = new URLSearchParams(location.search);
  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
  const sw = 'serviceWorker' in navigator && (!local || params.get('sw') === '1');
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferred = null;
  let pendingReload = false;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
  });
  window.addEventListener('appinstalled', () => { deferred = null; });

  // "Updated" once, after reloading into a new build
  try {
    if (sessionStorage.getItem(UPDATED_KEY)) {
      sessionStorage.removeItem(UPDATED_KEY);
      setTimeout(() => opts.toast('Kiln updated'), 900);
    }
  } catch { /* storage blocked */ }

  function maybeReload() {
    if (!pendingReload || !opts.canReload()) return;
    pendingReload = false;
    try { sessionStorage.setItem(UPDATED_KEY, '1'); } catch { /* the toast is skipped */ }
    location.reload();
  }

  if (!sw && local && 'serviceWorker' in navigator) {
    // a worker left by an earlier ?sw=1 test would keep serving old files: remove it and its caches
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    if (window.caches) caches.keys().then((ks) => ks.filter((k) => k.startsWith('kiln-')).forEach((k) => caches.delete(k))).catch(() => {});
  }

  if (sw) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) { pendingReload = true; maybeReload(); }
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch((e) => console.warn('[kiln] service worker', e));
    window.addEventListener('load', () => {
      setTimeout(() => {
        navigator.serviceWorker.ready.then((reg) => {
          if (!reg.active) return;
          const urls = performance.getEntriesByType('resource').map((e) => e.name)
            .filter((u) => /^https:\/\/(cdn\.jsdelivr\.net\/npm\/three@|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/.test(u));
          reg.active.postMessage({ type: 'cache-urls', urls });
          const c = navigator.connection;
          const good = !c || (!c.saveData && !/2g/.test(c.effectiveType || ''));
          if (good) reg.active.postMessage({ type: 'warm' });
        }).catch(() => {});
      }, 4000);
    });
    setInterval(maybeReload, 1500);
  }

  return {
    /** Worth offering: not installed yet, and either Chrome's prompt or iOS's Share menu. */
    installable() {
      return !standalone && (deferred !== null || ios);
    },
    canPrompt() {
      return deferred !== null;
    },
    prompt() {
      if (!deferred) { opts.toast('Open Share, then choose Add to Home Screen.'); return; }
      const e = deferred;
      deferred = null;
      e.prompt();
      Promise.resolve(e.userChoice).catch(() => {});
    },
    /** main.js calls this when it reaches a safe point (title or map). */
    safePoint: maybeReload,
  };
}
