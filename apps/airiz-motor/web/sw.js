/* AIRIZ Control Center — versioned, scope-isolated offline shell. */
const CACHE_PREFIX = 'airiz-control-' + encodeURIComponent(self.registration.scope) + '-';
const CACHE_NAME = CACHE_PREFIX + 'v2.34-1.8.0-ptz';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './console-ui.css',
  './app.js',
  './console-ui.js',
  './desktop-integration.js',
  './ble-protocol.js',
  './remote-ui.js',
  './camera-relay.js',
  './camera-frame-relay.js',
  './remote-control.js',
  './quick-connect.js',
  './ziris-team.js',
  './ziris-team.css',
  './i18n.js',
  './i18n-strings.js',
  './i18n.css',
  './device-label.js',
  './watch.html',
  './watch.js',
  './vendor/peerjs.min.js',
  './iphone.html',
  './iphone.js',
  './data/bridge-files.js',
  './data/commands.js',
  './data/macros.js',
  './data/sounds.js',
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin
      || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request, { cache: 'no-cache' });
      if (response.ok && url.search === '') cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(event.request, { ignoreSearch: event.request.mode === 'navigate' });
      if (cached) return cached;
      if (event.request.mode === 'navigate') return cache.match('./index.html');
      return new Response('Offline asset unavailable', { status: 503 });
    }
  })());
});
