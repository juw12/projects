// GlowRoom service worker: installable + offline.
// Pages are network-first (so updates ship immediately); static assets are cache-first.
(function () {
  var CACHE_NAME = 'glowroom-v11';
  var SCOPE = self.registration.scope;

  function resolveUrl(path) {
    return new URL(path, SCOPE).href;
  }

  var ASSETS = [
    resolveUrl('./app.html'),
    resolveUrl('./index.html'),
    resolveUrl('./mobile.html'),
    resolveUrl('./enhance.js'),
    resolveUrl('./crew-engine.js'),
    resolveUrl('./cinema.js'),
    resolveUrl('./glow-room-ui.js'),
    resolveUrl('./cinema.css'),
    resolveUrl('./enhance.css'),
    resolveUrl('./glow-family.css'),
    resolveUrl('./manifest.webmanifest'),
    resolveUrl('./icons/app-icon.svg'),
    resolveUrl('./assets/logo.svg'),
    resolveUrl('./vendor/three.min.js'),
    resolveUrl('../shared/glow-apps.js')
  ];

  self.addEventListener('install', function (event) {
    event.waitUntil(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.addAll(ASSETS);
      }).then(function () {
        return self.skipWaiting();
      })
    );
  });

  self.addEventListener('activate', function (event) {
    event.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(
          keys.filter(function (key) {
            // Only this app's caches: every app on juw12.github.io shares one origin.
            var ours = key.indexOf('glowroom-') === 0 || key.indexOf('crewroom-') === 0;
            return ours && key !== CACHE_NAME;
          }).map(function (key) {
            return caches.delete(key);
          })
        );
      }).then(function () {
        return self.clients.claim();
      })
    );
  });

  function isPage(req, url) {
    return req.mode === 'navigate' || /\.html?$/.test(url.pathname) || url.pathname.endsWith('/');
  }

  self.addEventListener('fetch', function (event) {
    var req = event.request;
    if (req.method !== 'GET') return;
    var url = new URL(req.url);
    // Only handle same-origin static assets; never intercept the live bridge API.
    if (url.origin !== self.location.origin) return;
    if (url.pathname.split('/').indexOf('api') !== -1) return;

    if (isPage(req, url)) {
      event.respondWith(
        fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(req, copy);
          });
          return res;
        }).catch(function () {
          return caches.match(req);
        })
      );
      return;
    }

    event.respondWith(
      caches.match(req).then(function (cached) {
        return cached || fetch(req);
      })
    );
  });
})();
