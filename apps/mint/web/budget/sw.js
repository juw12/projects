/* Mint Budget service worker: network-first app shell so updates land immediately, cache as offline fallback.
 * Scope is budget/ only; Mint Templates (../app.html) has its own worker at ../sw.js. */
const CACHE = 'mint-budget-v9';
// Caches this worker owns: its own generations, plus the ones versions before Mint 3.0 left behind.
// Never touch other caches: every app on this origin shares one CacheStorage.
const OWN_CACHE = /^(mint-budget-v|kitty-v)/;
const SHELL = ['index.html', '../js/locale.js', 'styles.css', 'js/core.js', 'js/i18n.js', 'js/lang/id.js', 'js/lang/zh.js', 'js/lang/es.js', 'js/sync.js', 'js/ui-kit.js', 'js/quiz.js', 'js/app.js', 'get.html', '../manifest.webmanifest', '../icons/app-icon.svg', '../icons/icon-192.png', '../icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => OWN_CACHE.test(k) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // The release manifest always comes straight from the network: it is how the app notices updates.
  if (url.pathname.endsWith('version.json')) return;
  // Revalidate with the server every time (cheap 304s), so a new release is picked up on the next load.
  const fresh = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' });
  event.respondWith(
    fresh
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
