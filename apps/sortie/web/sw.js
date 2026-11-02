// Minimal offline cache so Sortie can be installed as an app (PWA) when hosted over https.
const CACHE = "sortie-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./css/app.css",
  "./js/icons.js",
  "./js/core.js",
  "./js/effects.js",
  "./js/ui.js",
  "./js/layout.js",
  "./js/ops.js",
  "./js/assistant.js",
  "./js/main.js",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
});

self.addEventListener("fetch", event => {
  // never cache AI API calls
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then(hit => hit || fetch(event.request))
  );
});
