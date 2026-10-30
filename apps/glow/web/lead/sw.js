// GlowLead service worker: network first, cached copy when offline or when the network is slow.
// Removes only its own old caches.
const CACHE_NAME = 'glowlead-v29';
const NETWORK_TIMEOUT_MS = 4000;
const ASSETS = ['./', './index.html', './lead.css', './lead.js', './manifest.webmanifest', './icons/lead-icon.svg', '../room/crew-engine.js', '../shared/glow-locale.js', '../shared/i18n/ui.id.js', '../shared/i18n/ui.zh-CN.js', '../shared/i18n/ui.zh-TW.js', '../shared/glow-apps.js', '../shared/glow-plans.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => name.startsWith('glowlead-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const isOwnAsset = ASSETS.some((asset) => new URL(asset, self.location.href).href === url.href.split('?')[0]);
  if (!url.href.startsWith(self.registration.scope) && !isOwnAsset) return;
  const request = event.request;
  const fromCache = () => caches.match(request, request.mode === 'navigate' ? { ignoreSearch: true } : undefined)
    .then((hit) => hit || (request.mode === 'navigate' ? caches.match(new URL('./index.html', self.registration.scope).href) : hit));
  const network = fetch(request).then((response) => {
    if (response.ok && response.status === 200 && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  });
  const slow = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS)).then(fromCache);
  event.respondWith(Promise.race([
    network.catch(() => fromCache().then((hit) => hit || Response.error())),
    slow.then((hit) => hit || network),
  ]));
});
