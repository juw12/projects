/* Orbis service worker.
 * Strategy:
 *   - Navigations and HTML: network-first (fresh content, cache as fallback).
 *   - Static assets: cache-first (fast, offline-capable).
 *
 * Paths are resolved against the service worker's scope so the app works both
 * at a domain root and under a subpath (e.g. GitHub Pages /projects/orbis/).
 */

const CACHE = 'orbis-cache-v3';

const SCOPE = self.registration.scope; // absolute URL, always ends with "/"
const apiPrefix = new URL('api/', SCOPE).pathname; // subpath-safe API prefix
const offlineFallback = new URL('app.html', SCOPE).href;

const PRECACHE = [
  './',
  './index.html',
  './app.html',
  './orbis-plus.css',
  './orbis-plus.js',
  './chat.html',
  './manifest.webmanifest',
  './chat.webmanifest',
  './icons/orbit.svg',
  './icons/icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isHtmlRequest(request) {
  if (request.mode === 'navigate') {
    return true;
  }
  const accept = request.headers.get('accept') || '';
  return accept.indexOf('text/html') !== -1;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  // Never intercept the API or other origins (e.g. a chat server used from
  // GitHub Pages): always go straight to the network.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith(apiPrefix)) {
    return;
  }

  // Chat server settings must always be fresh.
  if (url.pathname.endsWith('chat-config.js')) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  if (isHtmlRequest(request)) {
    // Network-first for navigations and HTML documents.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((cached) => {
          return cached || caches.match(offlineFallback);
        }))
    );
    return;
  }

  // Cache-first for everything else (static assets).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request).then((response) => {
        if (response && response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
        }
        return response;
      });
    })
  );
});

// Tapping a chat notification focuses Orbis (or opens it) on that conversation.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const conversationId = event.notification.data && event.notification.data.conversationId;
  const target = new URL('chat.html' + (conversationId ? '#c=' + conversationId : ''), SCOPE).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.indexOf('chat.html') !== -1 && 'focus' in client) {
          client.postMessage({ type: 'open-conversation', conversationId });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
