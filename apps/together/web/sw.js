// Together service worker: offline app shell + payload-less push reminders.
// Reminder texts are written into IndexedDB by the page; pushes only say "something is due".
const CACHE = "together-v5";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("together-") && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    // Network first so updates arrive; fall back to the cached app when offline.
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    })),
  );
});

function idb(mode, work) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("together-sw", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("kv", mode);
      const result = work(tx.objectStore("kv"));
      tx.oncomplete = () => {
        db.close();
        resolve(result && "result" in result ? result.result : undefined);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}
const idbGet = key => idb("readonly", store => store.get(key));
const idbSet = (key, value) => idb("readwrite", store => store.put(value, key));

async function showDueReminders() {
  const reminders = (await idbGet("reminders").catch(() => null)) || [];
  const shown = (await idbGet("shown").catch(() => null)) || {};
  const now = Date.now();
  const due = reminders.filter(r => r.at <= now + 5 * 60e3 && r.at >= now - 12 * 3600e3 && !shown[`${r.tag}@${r.at}`]);
  if (!due.length) {
    await self.registration.showNotification("Together 💞", { body: "Open your plan to see what's next.", icon: "icons/icon-192.png", tag: "together" });
    return;
  }
  for (const reminder of due.slice(0, 3)) {
    shown[`${reminder.tag}@${reminder.at}`] = now;
    await self.registration.showNotification(reminder.title, { body: reminder.body, icon: "icons/icon-192.png", tag: reminder.tag });
  }
  for (const [key, time] of Object.entries(shown)) {
    if (now - time > 40 * 864e5) delete shown[key];
  }
  await idbSet("shown", shown).catch(() => {});
}

self.addEventListener("push", event => {
  event.waitUntil(showDueReminders());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
      for (const client of windows) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("./");
    }),
  );
});
