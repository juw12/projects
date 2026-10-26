/* Mint service worker — app shell cache. API calls (api/...) always go to the network. */
var CACHE = "mint-v2.2.1";
var SHELL = [
  "./", "index.html", "app.html", "web.html", "mobile.html", "privacy.html", "terms.html", "delete-account.html", "app.css",
  "js/core.js", "js/xlsx.js", "js/guides.js", "js/store.js", "js/app.js",
  "data/seed.json", "manifest.webmanifest", "icons/app-icon.svg", "icons/icon-192.png",
  "icons/icon-512.png", "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(SHELL);
  }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k.indexOf("mint-") === 0 && k !== CACHE;
    }).map(function (k) {
      return caches.delete(k);
    }));
  }).then(function () {
    return self.clients.claim();
  }));
});

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.indexOf("/api/") !== -1) {
    return;
  }
  event.respondWith(fetch(event.request).then(function (response) {
    if (response && response.ok) {
      var copy = response.clone();
      caches.open(CACHE).then(function (cache) {
        cache.put(event.request, copy);
      });
    }
    return response;
  }).catch(function () {
    return caches.match(event.request, { ignoreSearch: true });
  }));
});

// Web Push: orders, payments and commissions (sent by the Mint API with VAPID).
self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: "Mint", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(self.registration.showNotification(data.title || "Mint", {
    body: data.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "./app.html" }
  }));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "./app.html";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].url.indexOf("/mint/") !== -1 && "focus" in list[i]) {
        if ("navigate" in list[i]) {
          list[i].navigate(url).catch(function () {});
        }
        return list[i].focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
