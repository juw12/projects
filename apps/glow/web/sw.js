// Glow home service worker. It also replaces the old Glow chat worker that used to live at
// this path, so it removes only that worker's old 'glow-vN' caches. GlowChat (./chat/) and
// GlowRoom (./room/) have their own workers; requests for them are left alone here.
const CACHE_NAME = 'glowhome-v5';
const ASSETS = ['./', './index.html', './home.css', './home.js', './manifest.webmanifest', './icons/app-icon.svg', './icons/icon-192.png', './shared/glow-locale.js', './shared/glow-apps.js', './shared/i18n/ui.id.js', './shared/i18n/ui.zh-CN.js', './shared/i18n/ui.zh-TW.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => (name.startsWith('glowhome-') && name !== CACHE_NAME) || /^glow-v\d+$/.test(name))
        .map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = self.registration.scope;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(scope)) return;
  if (url.href.startsWith(scope + 'chat/') || url.href.startsWith(scope + 'room/') || url.href.startsWith(scope + 'lead/')) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
