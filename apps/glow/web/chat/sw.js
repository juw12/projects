// GlowChat service worker: the whole app opens with no internet. Pages and scripts are network-first so
// updates ship at once, but a slow connection falls back to the saved copy after a few seconds.
// AI requests always go to the network (they are cross-origin, so this worker never sees them).
// Glow Offline models are stored by WebLLM itself in its own caches ("webllm/…"), never deleted here.
const CACHE_NAME = 'glowchat-v13';
const SHARED = new URL('../shared/', self.registration.scope).href;
const NETWORK_TIMEOUT_MS = 4000;
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.html',
  './mobile.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  '../shared/glow-locale.js',
  '../shared/i18n/ui.id.js',
  '../shared/i18n/ui.zh-CN.js',
  '../shared/i18n/ui.zh-TW.js',
  '../shared/glow-apps.js',
  '../shared/glow-offline-ai.js'
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

function fromCache(request) {
  const navigation = request.mode === 'navigate';
  return caches.match(request, navigation ? { ignoreSearch: true } : undefined).then((hit) => {
    if (hit || !navigation) return hit;
    return caches.match(new URL('./index.html', self.registration.scope).href);
  });
}

function networkFirst(request) {
  const network = fetch(request).then((response) => {
    if (response.ok && response.status === 200 && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  });
  const slow = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS)).then(() => fromCache(request));
  return Promise.race([
    network.catch(() => fromCache(request).then((hit) => hit || Response.error())),
    slow.then((hit) => hit || network),
  ]);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !(url.href.startsWith(self.registration.scope) || url.href.startsWith(SHARED))) {
    return; // AI provider calls are never cached
  }
  event.respondWith(networkFirst(event.request));
});
