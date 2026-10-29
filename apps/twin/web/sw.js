// Twin 1.14.0: own cache only; offline shell; live demo data network-first; API never cached.
// Updates wait for you: a new version downloads in the background, then the page (update.js) shows
// "Update ready" and posts TWIN_SKIP_WAITING when you tap Update. Nothing takes over by surprise.
// Twin Indonesia (id/) shares this worker and cache: its files are listed below with the same version.
// Market data (world snapshot, chart files, calendars) and Twin Indonesia's snapshot (hourly headlines)
// refresh hourly: network first, cache as fallback.
const VERSION = "1.14.0";
// Pages before this version cannot show the update notice; they reload by themselves when a new worker takes over.
const PROMPT_SINCE = "1.14.0";
const PREFIX = "twin:" + self.registration.scope + ":";
const SHELL = PREFIX + VERSION;
const FILES = [
  "./", "index.html", "./?v=1.14.0", "index.html?v=1.14.0",
  "demo.js?v=1.14.0", "pro.js?v=1.14.0", "pro-ui.js?v=1.14.0", "broker-ui.js?v=1.14.0", "academy.js?v=1.14.0", "global.js?v=1.14.0", "theme.js?v=1.14.0", "theme.css?v=1.14.0", "design.css?v=1.14.0", "neo.css?v=1.14.0", "premium.css?v=1.14.0", "motion.js?v=1.14.0", "icons.js?v=1.14.0", "update.js?v=1.14.0", "manifest.webmanifest",
  "strategy-lab.js?v=1.14.0", "strategy-lab-ui.js?v=1.14.0", "twinagent.js?v=1.14.0", "twinagent-ui.js?v=1.14.0",
  "id/", "id/index.html", "id/styles.css?v=1.14.0", "id/engine.js?v=1.14.0", "id/snapshot.js", "id/ideas.js?v=1.14.0", "id/content.js?v=1.14.0", "id/feeds.js?v=1.14.0", "id/app.js?v=1.14.0",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png",
  "demo/meta.json", "demo/market.json", "demo/monthly.json",
  "demo/news.json", "demo/copycat.json", "demo/trade.json", "demo/world.json", "demo/fundamentals.json", "demo/calendars.json",
];
const DATA = PREFIX + "data";
const LIVE = ["demo/world.json", "demo/calendars.json", "demo/world/", "id/snapshot.js"].map((p) => new URL(p, self.registration.scope).href);
const isLive = (url) => LIVE.some((prefix) => url.split("?")[0] === prefix || (prefix.endsWith("/") && url.startsWith(prefix)));
const assets = new Set(FILES.map((file) => new URL(file, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(FILES.map((file) => new Request(file, { cache: "reload" })));
    if (await shouldTakeOverNow()) {
      await self.skipWaiting();
    }
  })());
});

// Wait for the page's Update tap, except when nobody could be asked or the open pages predate the notice.
async function shouldTakeOverNow() {
  if (!self.registration.active) {
    return true;
  }
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (!windows.length) {
    return true;
  }
  const shells = (await caches.keys())
    .filter((key) => key.startsWith(PREFIX) && key !== SHELL)
    .map((key) => key.slice(PREFIX.length))
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version));
  return shells.some((version) => isOlder(version, PROMPT_SINCE));
}

function isOlder(version, than) {
  const a = version.split(".").map(Number);
  const b = than.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] < b[index];
    }
  }
  return false;
}

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "TWIN_SKIP_WAITING") {
    self.skipWaiting();
  } else if (type === "TWIN_VERSION" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
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
