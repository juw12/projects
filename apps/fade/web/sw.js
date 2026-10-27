/* Fade service worker: network-first for the app shell, offline fallback from cache.
 * API calls and uploaded media are never cached here. The on-device safety model (vendor/nsfw/)
 * is cached the first time someone uploads, so later checks work offline too. */
const CACHE = 'fade-v3.2.0';
const SHELL = [
  './',
  './index.html',
  './web.html',
  './mobile.html',
  './vendor/nostr.bundle.js?v=3.2.0',
  './vendor/qrcode.js?v=3.2.0',
  './config.js?v=3.2.0',
  './net.js?v=3.2.0',
  './transcode.js?v=3.2.0',
  './scan.js?v=3.2.0',
  './scan-worker.js',
  './netui.js?v=3.2.0',
  './app.js?v=3.2.0',
  './data.js?v=3.2.0',
  './styles.css?v=3.2.0',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('fade-v') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/') || url.pathname.includes('/media/') || url.pathname.includes('/ntfy') || url.pathname.includes('/blossom')) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match(request, { ignoreSearch: true })).then((hit) => hit || caches.match('./index.html')))
  );
});
