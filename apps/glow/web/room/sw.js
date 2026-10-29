// GlowRoom service worker: installable + offline.
// Pages, scripts and styles are network-first (so updates ship immediately, including the shared
// glow-apps.js that shows and installs Glow updates) with a short timeout that falls back to the saved
// copy on a weak connection; only the big vendor library and images are cache-first.
(function () {
  var CACHE_NAME = 'glowroom-v18';
  var NETWORK_TIMEOUT_MS = 4000;
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
    resolveUrl('../shared/glow-locale.js'),
    resolveUrl('../shared/i18n/ui.id.js'),
    resolveUrl('../shared/i18n/ui.zh-CN.js'),
    resolveUrl('../shared/i18n/ui.zh-TW.js'),
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

  // Code changes with every Glow release. When it was cache-first, GlowRoom kept running an old
  // glow-apps.js (and its hidden update button) until this file changed.
  function isCode(url) {
    return /\.(?:js|css|json|webmanifest)$/.test(url.pathname) && url.pathname.indexOf('/vendor/') === -1;
  }

  self.addEventListener('fetch', function (event) {
    var req = event.request;
    if (req.method !== 'GET') return;
    var url = new URL(req.url);
    // Only handle same-origin static assets; never intercept the live bridge API.
    if (url.origin !== self.location.origin) return;
    if (url.pathname.split('/').indexOf('api') !== -1) return;

    if (isPage(req, url) || isCode(url)) {
      var fromCache = function () {
        return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
          return hit || (req.mode === 'navigate' ? caches.match(resolveUrl('./index.html')) : hit);
        });
      };
      var network = fetch(req).then(function (res) {
        if (res.ok && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            return cache.put(req, copy);
          }).catch(function () {});
        }
        return res;
      });
      var slow = new Promise(function (resolve) {
        setTimeout(resolve, NETWORK_TIMEOUT_MS);
      }).then(fromCache);
      event.respondWith(Promise.race([
        network.catch(function () {
          return fromCache().then(function (hit) {
            return hit || Response.error();
          });
        }),
        slow.then(function (hit) {
          return hit || network;
        })
      ]));
      return;
    }

    event.respondWith(
      caches.match(req).then(function (cached) {
        return cached || fetch(req);
      })
    );
  });
})();
