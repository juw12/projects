/* Hazel Sped: versioned, app-scoped offline cache. Never deletes another app's caches
 * (other Hazel apps and the old pre-Hazel 'sped-v' cache at /projects/sped/ are left alone).
 * An update waits for explicit approval so a session cannot silently mix builds. */
const CACHE = 'hazel-sped-v1.5.0';
const SHELL = [
  './', 'index.html', 'web.html', 'mobile.html', 'styles.css', 'engine.js',
  'engine-client.js', 'demo.js', 'rights.js', 'recipes.js', 'shorts.js', 'video.js', 'app.js', 'worker.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'hazel-switch.css', 'hazel-switch.js',
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(SHELL);
  }));
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'ACTIVATE_UPDATE') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) {
      return key.startsWith('hazel-sped-v') && key !== CACHE;
    }).map(function (key) {
      return caches.delete(key);
    }));
  }).then(function () {
    return self.clients.claim();
  }));
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') {
    return;
  }
  const url = new URL(event.request.url);
  if (!url.href.startsWith(self.registration.scope)) {
    return;
  }
  event.respondWith(caches.open(CACHE).then(async function (cache) {
    const hit = await cache.match(event.request, { ignoreSearch: true });
    return hit || fetch(event.request);
  }));
});
