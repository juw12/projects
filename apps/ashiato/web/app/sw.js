// Offline support for the web/PWA build: the app shell is cached on install, scenes, fonts and
// sample images are cached the first time they're shown. Weather, map tiles and OCR stay online-only.
const VERSION = "ashiato-0.2.0";
const SHELL = [
  "./",
  "index.html",
  "app.css",
  "manifest.webmanifest",
  "clip_lexicon.json",
  "vendor/leaflet.js",
  "vendor/leaflet.css",
  "js/app.js",
  "js/i18n.js",
  "js/store.js",
  "js/scene.js",
  "js/classifier.js",
  "js/doodle.js",
  "js/demo.js",
  "js/walk.js",
  "icons/icon-192.png",
  "scenes/clear__dusk__spring.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  const isCode = /\.(js|css|html|json|webmanifest)$/.test(url.pathname) || url.pathname.endsWith("/");
  if (isCode) {
    // Network first for code so updates arrive; fall back to cache offline.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Cache first for images and fonts.
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((response) => {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(event.request, copy));
            return response;
          })
      )
    );
  }
});
