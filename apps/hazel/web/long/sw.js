/* Hazel Long offline worker (scope: hazel/long/).
 * - Caches only Hazel Long's own files under a versioned name.
 * - On activate it deletes only older Hazel Long caches. (The pre-Hazel worker deleted every
 *   cache on the site, including other apps' offline data; that is fixed here.)
 * - Network-first for pages so updates show up; cache-first for static assets. */
const CACHE_PREFIX = 'hazel-long-v';
const CACHE_NAME = CACHE_PREFIX + '2';
const CACHE_URLS = [
  './app.html',
  './index.html',
  './mobile.html',
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './hazel-switch.css',
  './hazel-switch.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // registration.scope is a full URL, so compare it with the full request URL.
  if (!request.url.startsWith(self.registration.scope)) return;

  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request, { ignoreSearch: true }))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
    )
  );
});
