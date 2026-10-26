/* Mint service worker — app shell cache. API calls (api/...) always go to the network. */
var CACHE = "mint-v2.0.0";
var SHELL = [
  "./", "index.html", "app.html", "web.html", "mobile.html", "app.css",
  "js/core.js", "js/xlsx.js", "js/guides.js", "js/store.js", "js/app.js",
  "data/seed.json", "manifest.webmanifest", "icons/app-icon.svg", "icons/icon-192.png",
  "icons/icon-512.png", "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(SHELL);
  }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k.indexOf("mint-") === 0 && k !== CACHE;
    }).map(function (k) {
      return caches.delete(k);
    }));
  }).then(function () {
    return self.clients.claim();
  }));
});

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.indexOf("/api/") !== -1) {
    return;
  }
  event.respondWith(fetch(event.request).then(function (response) {
    if (response && response.ok) {
      var copy = response.clone();
      caches.open(CACHE).then(function (cache) {
        cache.put(event.request, copy);
      });
    }
    return response;
  }).catch(function () {
    return caches.match(event.request, { ignoreSearch: true });
  }));
});
