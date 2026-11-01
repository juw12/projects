/*
 * Beacon service-worker add-on. Add ONE line to your app's existing sw.js:
 *
 *   importScripts('/beacon-sw.js');            // copy this file next to sw.js
 *   // or: importScripts('https://push.example.com/beacon-sw.js');
 *
 * It shows Beacon notifications, opens/focuses the right page on tap, and
 * reports "shown" / "clicked" back to Beacon for your stats. Notifications
 * that did not come from Beacon are left for your own handlers.
 */
(() => {
  "use strict";

  function isBeacon(data) {
    return data && typeof data === "object" && data.beacon && data.sig && data.id;
  }

  function track(data, event) {
    if (!isBeacon(data)) {
      return Promise.resolve();
    }
    return fetch(`${data.beacon}/v1/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: data.id, sig: data.sig, event }),
      keepalive: true,
    }).catch(() => undefined);
  }

  self.addEventListener("push", (event) => {
    let data = null;
    try {
      data = event.data ? event.data.json() : null;
    } catch (error) {
      data = null;
    }
    if (!isBeacon(data)) {
      return; // not ours — let the app's own push handler deal with it
    }
    event.stopImmediatePropagation();
    const options = {
      body: data.body || "",
      icon: data.icon || undefined,
      image: data.image || undefined,
      badge: data.badge || undefined,
      tag: data.tag || `beacon-${data.id}`,
      renotify: Boolean(data.tag),
      data,
    };
    event.waitUntil(
      Promise.all([
        self.registration.showNotification(data.title || "Notification", options),
        track(data, "shown"),
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
          clients.forEach((client) => client.postMessage({ type: "beacon-push", message: data }));
        }),
      ])
    );
  });

  self.addEventListener("notificationclick", (event) => {
    const data = event.notification.data;
    if (!isBeacon(data)) {
      return;
    }
    event.stopImmediatePropagation();
    event.notification.close();
    const target = new URL(data.url || "./", self.registration.scope).href;
    event.waitUntil(
      Promise.all([
        track(data, "clicked"),
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
          for (const client of clients) {
            if (client.url === target && "focus" in client) {
              return client.focus();
            }
          }
          for (const client of clients) {
            if ("navigate" in client && new URL(client.url).origin === new URL(target).origin) {
              return client.navigate(target).then((c) => (c ? c.focus() : undefined));
            }
          }
          return self.clients.openWindow(target);
        }),
      ])
    );
  });

  // Browsers occasionally rotate subscriptions; open pages re-sync via beacon.js.
  self.addEventListener("pushsubscriptionchange", (event) => {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "beacon-resubscribe" }));
      })
    );
  });
})();
