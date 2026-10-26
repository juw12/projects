// Twin 1.5.2: own cache only; complete offline snapshot; API never cached.
const PREFIX = "twin:" + self.registration.scope + ":";
const SHELL = PREFIX + "1.5.2";
const FILES = [
  "./", "index.html", "./?v=1.5.2", "index.html?v=1.5.2",
  "demo.js?v=1.5.2", "pro.js?v=1.5.2", "pro-ui.js?v=1.5.2", "broker-ui.js?v=1.5.2", "academy.js?v=1.5.2", "global.js?v=1.5.2", "theme.js?v=1.5.2", "theme.css?v=1.5.2", "design.css?v=1.5.2", "icons.js?v=1.5.2", "manifest.webmanifest",
  "strategy-lab.js?v=1.5.2", "strategy-lab-ui.js?v=1.5.2", "twinagent.js?v=1.5.2", "twinagent-ui.js?v=1.5.2",
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
