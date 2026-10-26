// Twin 1.6.0: own cache only; offline shell; live demo data network-first; API never cached.
// Market data (world snapshot, chart files, calendars) refreshes hourly: network first, cache as fallback.
const PREFIX = "twin:" + self.registration.scope + ":";
const SHELL = PREFIX + "1.6.0";
const FILES = [
  "./", "index.html", "./?v=1.6.0", "index.html?v=1.6.0",
  "demo.js?v=1.6.0", "pro.js?v=1.6.0", "pro-ui.js?v=1.6.0", "broker-ui.js?v=1.6.0", "academy.js?v=1.6.0", "global.js?v=1.6.0", "theme.js?v=1.6.0", "theme.css?v=1.6.0", "design.css?v=1.6.0", "icons.js?v=1.6.0", "manifest.webmanifest",
  "strategy-lab.js?v=1.6.0", "strategy-lab-ui.js?v=1.6.0", "twinagent.js?v=1.6.0", "twinagent-ui.js?v=1.6.0",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png",
  "demo/meta.json", "demo/market.json", "demo/monthly.json",
  "demo/news.json", "demo/copycat.json", "demo/trade.json", "demo/world.json", "demo/fundamentals.json", "demo/calendars.json",
];
const DATA = PREFIX + "data";
const LIVE = ["demo/world.json", "demo/calendars.json", "demo/world/"].map((p) => new URL(p, self.registration.scope).href);
const isLive = (url) => LIVE.some((prefix) => url.split("?")[0] === prefix || (prefix.endsWith("/") && url.startsWith(prefix)));
const assets = new Set(FILES.map((file) => new URL(file, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== SHELL && key !== DATA && (key.startsWith(PREFIX) || /^tt-shell-v\d+$/.test(key)))
      .map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  if (isLive(event.request.url)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { cache: "no-cache" });
        if (response.ok) {
          const cache = await caches.open(DATA);
          await cache.put(event.request.url.split("?")[0], response.clone());
        }
        return response;
      } catch (error) {
        const fallback = (await caches.open(DATA).then((c) => c.match(event.request.url.split("?")[0])))
          || (await caches.open(SHELL).then((c) => c.match(event.request.url.split("?")[0])));
        return fallback || new Response("offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }
  if (!assets.has(event.request.url)) {
    return;
  }
  // The app page itself is network-first so a new release shows on the very next open;
  // every script/style URL is versioned, so a fresh page never mixes with old cached code.
  if (event.request.mode === "navigate") {
    event.respondWith(freshPage(event.request));
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

async function freshPage(request) {
  const cache = await caches.open(SHELL);
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("slow network")), 4000));
    const response = await Promise.race([fetch(request.url, { cache: "no-cache", credentials: "same-origin" }), timeout]);
    if (response.ok) {
      await cache.put(request, response.clone());
      return response;
    }
    return (await cache.match(request)) || response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    return new Response("Twin is offline. Reconnect to finish installing the offline demo.", {
      status: 503, headers: { "Content-Type": "text/plain" },
    });
  }
}
