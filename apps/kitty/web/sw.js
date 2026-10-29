/* Kitty service worker: network-first app shell so updates land immediately, cache as offline fallback. */
const CACHE = 'kitty-v4';
const SHELL = ['index.html', 'styles.css', 'js/core.js', 'js/i18n.js', 'js/lang/id.js', 'js/lang/zh.js', 'js/lang/es.js', 'js/sync.js', 'js/ui-kit.js', 'js/quiz.js', 'js/app.js', 'icon.svg', 'icon-192.png', 'apple-touch-icon.png', 'manifest.webmanifest', 'get.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
