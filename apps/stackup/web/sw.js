/* Stackup service worker — cache-first app shell so the calculator works offline. */
var CACHE = "stackup-v1.0.0";
var SHELL = [
  "./",
  "index.html",
  "app.html",
  "web.html",
  "mobile.html",
  "app.css",
  "app.js",
  "stackup-core.js",
  "manifest.webmanifest",
  "icons/app-icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "downloads/Stackup-Lite.xlsx"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key.indexOf("stackup-") === 0 && key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function (hit) {
      var network = fetch(event.request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(event.request, copy);
          });
        }
        return response;
      }).catch(function () {
        return hit;
      });
      return hit || network;
    })
  );
});
