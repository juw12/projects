(function () {
  'use strict';

  const CACHE_NAME = 'pips-v2.13.1';
  const ASSETS = [
    './',
    './index.html',
    './web.html',
    './mobile.html',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/pips-icon.svg',
    './icons/apple-touch-icon.png'
  ];

  self.addEventListener('install', function (event) {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then(function (cache) { return cache.addAll(ASSETS); })
        .then(function () { return self.skipWaiting(); })
    );
  });

  self.addEventListener('activate', function (event) {
    event.waitUntil(
      caches.keys()
        .then(function (names) {
          return Promise.all(names.filter(function (name) {
            // Never remove another project's caches on this shared origin.
            return name.indexOf('pips-') === 0 && name !== CACHE_NAME;
          }).map(function (name) { return caches.delete(name); }));
        })
        .then(function () { return self.clients.claim(); })
        .then(function () {
          // Older workers served a cached ZIP-download page. Refresh only the
          // native download landing page, never an in-use web/mobile app.
          return self.clients.matchAll({type: 'window'}).then(function (clients) {
            const scope = new URL(self.registration.scope);
            return Promise.all(clients.map(function (client) {
              const path = new URL(client.url).pathname;
              if (path === scope.pathname || path === scope.pathname + 'index.html') {
                return client.navigate(client.url).catch(function () {});
              }
              return Promise.resolve();
            }));
          });
        })
    );
  });

  self.addEventListener('fetch', function (event) {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    const scope = new URL(self.registration.scope);
    if (url.origin !== scope.origin || url.pathname.indexOf(scope.pathname) !== 0) return;

    // Installers, update archives, manifests and guides always come from the
    // server. A cached executable or latest.json can silently pin users to an
    // old version, and large installers should not fill the offline cache.
    if (url.pathname.indexOf(scope.pathname + 'download/') === 0) return;

    event.respondWith(
      fetch(event.request, {cache: 'no-cache'})
        .then(function (response) {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            return caches.open(CACHE_NAME).then(function (cache) {
              return cache.put(event.request, copy);
            }).catch(function () {}).then(function () { return response; });
          }
          return response;
        })
        .catch(function () {
          return caches.match(event.request).then(function (cached) {
            if (cached) return cached;
            if (event.request.mode === 'navigate') {
              return caches.match('./web.html').then(function (page) {
                return page || new Response('Offline', {status: 503});
              });
            }
            return new Response('Offline', {status: 503});
          });
        })
    );
  });
})();
