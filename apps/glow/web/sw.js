// Glow home service worker. It also replaces the old Glow chat worker that used to live at
// this path, so it removes only that worker's old 'glow-vN' caches. GlowChat (./chat/), GlowRoom
// (./room/) and GlowLead (./lead/) have their own workers; requests for them are left alone here.
// Pages are network-first with a short timeout, so a weak connection still opens Glow at once.
// version.json is never cached, so "Check for updates" always sees the real latest version.
const CACHE_NAME = 'glowhome-v13';
const NETWORK_TIMEOUT_MS = 4000;
const ASSETS = [
  './',
  './index.html',
  './home.css',
  './home.js',
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png',
  './download/',
  './download/download.css',
  './download/download.js',
  './setup/',
  './setup/setup.css',
  './setup/setup.js',
  './account/',
  './account/account.css',
  './account/account.js',
  './privacy.html',
  './terms.html',
  './shared/glow-locale.js',
  './shared/glow-apps.js',
  './shared/glow-resume.js',
  './shared/qrcode.js',
  './shared/i18n/ui.id.js',
  './shared/i18n/ui.zh-CN.js',
  './shared/i18n/ui.zh-TW.js'
];

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

function fromCache(request) {
  const navigation = request.mode === 'navigate';
  return caches.match(request, navigation ? { ignoreSearch: true } : undefined).then((hit) => {
    if (hit || !navigation) return hit;
    return caches.match(new URL('./index.html', self.registration.scope).href);
  });
}

function networkFirst(request) {
  const network = fetch(request).then((response) => {
    if (response.ok && response.status === 200 && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  });
  const slow = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS)).then(() => fromCache(request));
  return Promise.race([
    network.catch(() => fromCache(request).then((hit) => hit || Response.error())),
    slow.then((hit) => hit || network),
  ]);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = self.registration.scope;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(scope)) return;
  if (url.href.startsWith(scope + 'chat/') || url.href.startsWith(scope + 'room/') || url.href.startsWith(scope + 'lead/')) return;
  if (url.pathname === new URL('version.json', scope).pathname) return; // always straight from the network
  event.respondWith(networkFirst(event.request));
});
