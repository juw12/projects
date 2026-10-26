// Twin 1.5.0: own cache only; complete offline snapshot; API never cached.
const PREFIX = "twin:" + self.registration.scope + ":";
const SHELL = PREFIX + "1.5.0";
const FILES = [
  "./", "index.html", "./?v=1.5.0", "index.html?v=1.5.0",
  "demo.js?v=1.5.0", "pro.js?v=1.5.0", "pro-ui.js?v=1.5.0", "broker-ui.js?v=1.5.0", "academy.js?v=1.5.0", "global.js?v=1.5.0", "theme.js?v=1.5.0", "theme.css?v=1.5.0", "manifest.webmanifest",
  "strategy-lab.js?v=1.5.0", "strategy-lab-ui.js?v=1.5.0", "twinagent.js?v=1.5.0", "twinagent-ui.js?v=1.5.0",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png",
  "demo/meta.json", "demo/market.json", "demo/monthly.json",
  "demo/news.json", "demo/copycat.json", "demo/trade.json", "demo/world.json", "demo/fundamentals.json",
];
const assets = new Set(FILES.map((file) => new URL(file, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== SHELL && (key.startsWith(PREFIX) || /^tt-shell-v\d+$/.test(key)))
      .map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !assets.has(event.request.url)) {
    return;
  }
  // Versioned offline snapshot stays internally consistent until the next worker install.
  event.respondWith(caches.open(SHELL).then(async (cache) => {
    const cached = await cache.match(event.request);
    if (cached) {
      return cached;
    }
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== "opaque") {
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      return new Response("Twin is offline. Reconnect to finish installing the offline demo.", {
        status: 503, headers: { "Content-Type": "text/plain" },
      });
    }
  }));
});
