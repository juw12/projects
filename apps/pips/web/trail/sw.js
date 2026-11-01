/* Offline support for Pips Phone Trail.
 * Network first (so updates show up immediately), cache as offline fallback.
 * The cache name must NOT start with "pips-": the main Pips worker on this origin
 * deletes every other "pips-*" cache. Only our own "phonetrail-*" caches are cleaned here.
 */
const PREFIX = "phonetrail-";
const VERSION = PREFIX + "v2";
const FILES = [
  "./",
  "index.html",
  "app.js",
  "trail.js",
  "categories.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  const scope = new URL(self.registration.scope);
  const url = new URL(event.request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) {
    return;
  }
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((hit) => hit || caches.match("index.html"))
      )
  );
});
