// GlowChat service worker: offline app shell. AI requests always go to the network.
const CACHE_NAME = 'glowchat-v2';
const SHARED = new URL('../shared/', self.registration.scope).href;
const ASSETS_TO_CACHE = [
  './index.html',
  './app.html',
  './mobile.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  '../shared/glow-apps.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Only GlowChat's caches (including the old 'glow-vN' ones); other apps share this origin.
      .then((names) => Promise.all(names.filter((n) => (n.startsWith('glowchat-') || /^glow-v\d+$/.test(n)) && n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !(url.href.startsWith(self.registration.scope) || url.href.startsWith(SHARED))) {
    return; // AI provider calls are never cached
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
