/* Sync service worker — app-scoped offline shell. Never touches other apps' caches.
 * Live rooms need the network; this only makes the app open instantly and installable.
 * A new version waits for the user to tap "Update" so a live session never mixes builds. */
const CACHE = 'sync-v1.0.0';
const SHELL = [
  './',
  'index.html',
  'web.html',
  'mobile.html',
  'styles.css',
  'config.js',
  'vendor/peerjs.min.js',
  'core.js',
  'catalog.js',
  'players.js',
  'room.js',
  'voice.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
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
      return key.startsWith('sync-v') && key !== CACHE;
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
    return; // YouTube, Spotify, iTunes, PeerJS: always live network
  }
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then(function (cached) {
    const network = fetch(event.request).then(function (response) {
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then(function (cache) {
          cache.put(event.request, copy);
        });
      }
      return response;
    }).catch(function () {
      return cached;
    });
    return cached || network;
  }));
});
