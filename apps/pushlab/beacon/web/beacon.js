/*
 * Beacon client SDK — drop into any of your web apps / PWAs.
 *
 *   <script src="https://push.example.com/beacon.js"></script>
 *   <script>
 *     Beacon.init({ server: "https://push.example.com", appKey: "pk_…" });
 *     button.onclick = () => Beacon.subscribe({ userId: "u42", tags: ["lang:id"] });
 *     Beacon.inApp();          // optional: show in-app messages as a banner
 *   </script>
 *
 * In a browser it uses Web Push (your sw.js must importScripts('beacon-sw.js')).
 * Inside a Capacitor app with @capacitor/push-notifications it registers the
 * native FCM token instead — same API, no code changes.
 */
(function (global) {
  "use strict";

  const STORE_KEY = "beacon.subscriber";
  let config = null;
  let serverInfo = null;

  function urlBase64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  async function call(path, body) {
    const response = await fetch(config.server + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({ ok: false, error: response.statusText }));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Beacon request failed (${response.status})`);
    }
    return data;
  }

  function saved() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY + "." + config.appKey)) || null;
    } catch (error) {
      return null;
    }
  }

  function save(value) {
    const key = STORE_KEY + "." + config.appKey;
    if (value) {
      localStorage.setItem(key, JSON.stringify(value));
    } else {
      localStorage.removeItem(key);
    }
  }

  function nativePush() {
    const cap = global.Capacitor;
    return cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.PushNotifications;
  }

  function requireInit() {
    if (!config) {
      throw new Error("Call Beacon.init({ server, appKey }) first");
    }
  }

  async function info() {
    requireInit();
    if (!serverInfo) {
      serverInfo = await call(`/v1/client/${encodeURIComponent(config.appKey)}`);
    }
    return serverInfo;
  }

  async function registration() {
    if (!("serviceWorker" in navigator)) {
      throw new Error("This browser has no service workers");
    }
    const existing = await navigator.serviceWorker.getRegistration(config.scope);
    if (existing) {
      return existing;
    }
    return navigator.serviceWorker.register(config.serviceWorker, { scope: config.scope });
  }

  const Beacon = {
    /** server: Beacon URL; appKey: pk_…; serviceWorker: your sw.js (default /sw.js). */
    init(options) {
      if (!options || !options.server || !options.appKey) {
        throw new Error("Beacon.init needs { server, appKey }");
      }
      config = {
        server: options.server.replace(/\/+$/, ""),
        appKey: options.appKey,
        serviceWorker: options.serviceWorker || "/sw.js",
        scope: options.scope || "/",
      };
      serverInfo = null;
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("message", (event) => {
          if (event.data && event.data.type === "beacon-resubscribe" && saved()) {
            const current = saved();
            Beacon.subscribe({ userId: current.userId, tags: current.tags }).catch(() => undefined);
          }
        });
      }
      return Beacon;
    },

    /** "unsupported" | "native" | "default" | "granted" | "denied" */
    permission() {
      if (nativePush()) {
        return "native";
      }
      if (!("Notification" in global) || !("PushManager" in global)) {
        return "unsupported";
      }
      return Notification.permission;
    },

    /** iOS only allows Web Push for home-screen (installed) web apps. */
    needsInstallOnIOS() {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = global.matchMedia && global.matchMedia("(display-mode: standalone)").matches;
      return ios && !standalone && !nativePush();
    },

    isSubscribed() {
      return Boolean(config && saved());
    },

    /** Ask permission and subscribe. Call from a user gesture (click). */
    async subscribe(options = {}) {
      requireInit();
      const meta = {
        user_id: options.userId || "",
        tags: options.tags || [],
        locale: (navigator.language || "").slice(0, 16),
      };
      const plugin = nativePush();
      if (plugin) {
        return Beacon._subscribeNative(plugin, meta, options);
      }
      if (Beacon.needsInstallOnIOS()) {
        throw new Error("On iPhone/iPad, add this app to the Home Screen first, then enable notifications.");
      }
      if (Beacon.permission() === "unsupported") {
        throw new Error("Push notifications are not supported in this browser");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notifications were not allowed");
      }
      const { vapid_public_key: vapidKey } = await info();
      const reg = await registration();
      await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        const currentKey = subscription.options && subscription.options.applicationServerKey;
        const wanted = urlBase64ToUint8Array(vapidKey);
        const same = currentKey && new Uint8Array(currentKey).every((b, i) => b === wanted[i]);
        if (!same) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }
      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }
      const result = await call("/v1/subscribe", {
        app_key: config.appKey,
        subscription: subscription.toJSON(),
        platform: "web",
        ...meta,
      });
      save({ id: result.id, token: result.token, userId: meta.user_id, tags: meta.tags, channel: "webpush" });
      return result;
    },

    async _subscribeNative(plugin, meta) {
      let status = await plugin.checkPermissions();
      if (status.receive === "prompt" || status.receive === "prompt-with-rationale") {
        status = await plugin.requestPermissions();
      }
      if (status.receive !== "granted") {
        throw new Error("Notifications were not allowed");
      }
      const token = await new Promise((resolve, reject) => {
        plugin.addListener("registration", (t) => resolve(t.value));
        plugin.addListener("registrationError", (e) => reject(new Error(e.error || "FCM registration failed")));
        plugin.register();
      });
      plugin.addListener("pushNotificationActionPerformed", (action) => {
        const raw = action.notification && action.notification.data && action.notification.data.beacon;
        try {
          const data = JSON.parse(raw);
          fetch(`${data.beacon}/v1/track`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: data.id, sig: data.sig, event: "clicked" }),
          });
          if (data.url) {
            global.location.href = data.url;
          }
        } catch (error) {
          /* not a Beacon notification */
        }
      });
      const platform = global.Capacitor.getPlatform ? global.Capacitor.getPlatform() : "android";
      const result = await call("/v1/register-device", { app_key: config.appKey, token, platform, ...meta });
      save({ id: result.id, token: result.token, userId: meta.user_id, tags: meta.tags, channel: "fcm" });
      return result;
    },

    /** Attach a user id / tags later, e.g. after login. */
    async identify({ userId, tags } = {}) {
      requireInit();
      const current = saved();
      if (!current) {
        throw new Error("Not subscribed yet");
      }
      const body = { app_key: config.appKey, token: current.token };
      if (userId !== undefined) {
        body.user_id = userId;
        current.userId = userId;
      }
      if (tags !== undefined) {
        body.tags = tags;
        current.tags = tags;
      }
      await call("/v1/update", body);
      save(current);
    },

    /**
     * Notification preferences for this device (its user's, when identified):
     * { all: {enabled, channels}, categories: [{ category, name, enabled, channels, critical }] }
     */
    async preferences() {
      requireInit();
      const current = saved();
      if (!current) {
        throw new Error("Not subscribed yet");
      }
      const params = new URLSearchParams({ app_key: config.appKey, token: current.token });
      return call(`/v1/me/preferences?${params}`);
    },

    /**
     * Switch a category on or off ("*" = every non-critical category) and/or limit it to some
     * channels, e.g. Beacon.setPreference("marketing", true, { channels: ["inapp"] }).
     * Pass enabled = null with { reset: true } to fall back to the default.
     */
    async setPreference(category, enabled, { channels, reset, scope } = {}) {
      requireInit();
      const current = saved();
      if (!current) {
        throw new Error("Not subscribed yet");
      }
      const body = { app_key: config.appKey, token: current.token, category: category || "*" };
      if (reset) {
        body.reset = true;
      }
      if (enabled !== undefined && enabled !== null) {
        body.enabled = Boolean(enabled);
      }
      if (channels !== undefined) {
        body.channels = channels;
      }
      if (scope) {
        body.scope = scope;  // "subscriber" = only this device
      }
      return call("/v1/me/preferences", body);
    },

    async unsubscribe() {
      requireInit();
      const current = saved();
      if (current) {
        await call("/v1/unsubscribe", { app_key: config.appKey, token: current.token }).catch(() => undefined);
      }
      if (!nativePush() && "serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration(config.scope);
        const subscription = reg && (await reg.pushManager.getSubscription());
        if (subscription) {
          await subscription.unsubscribe();
        }
      }
      save(null);
    },

    /** In-app messages (sent with channel "inapp"), newest first. */
    async inbox({ since = 0 } = {}) {
      requireInit();
      const current = saved();
      const params = new URLSearchParams({ app_key: config.appKey, since: String(since) });
      if (current) {
        params.set("token", current.token);
      }
      const data = await call(`/v1/inbox?${params}`);
      return data.messages;
    },

    /** Show unseen in-app messages as a small banner. Returns a stop() function. */
    inApp({ pollSeconds = 60, render } = {}) {
      requireInit();
      const seenKey = `beacon.seen.${config.appKey}`;
      let stopped = false;
      const show = render || defaultBanner;
      async function poll() {
        if (stopped) {
          return;
        }
        try {
          const seen = new Set(JSON.parse(localStorage.getItem(seenKey) || "[]"));
          const messages = await Beacon.inbox();
          const fresh = messages.filter((m) => !seen.has(m.id)).reverse();
          for (const message of fresh) {
            seen.add(message.id);
            show(message);
            fetch(`${message.beacon}/v1/track`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: message.id, sig: message.sig, event: "shown" }),
            }).catch(() => undefined);
          }
          localStorage.setItem(seenKey, JSON.stringify(Array.from(seen).slice(-300)));
        } catch (error) {
          /* offline — try again later */
        }
        setTimeout(poll, pollSeconds * 1000);
      }
      poll();
      return () => {
        stopped = true;
      };
    },
  };

  function defaultBanner(message) {
    const box = document.createElement("div");
    box.setAttribute("role", "status");
    box.style.cssText =
      "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;" +
      "max-width:min(92vw,420px);background:#111827;color:#f9fafb;border-radius:14px;" +
      "padding:14px 40px 14px 16px;box-shadow:0 12px 32px rgba(0,0,0,.35);" +
      "font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;cursor:pointer";
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.textContent = message.title;
    const body = document.createElement("div");
    body.style.opacity = ".85";
    body.textContent = message.body || "";
    const close = document.createElement("button");
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss");
    close.style.cssText =
      "position:absolute;top:6px;right:8px;background:none;border:0;color:inherit;font-size:20px;cursor:pointer";
    close.onclick = (event) => {
      event.stopPropagation();
      box.remove();
    };
    box.append(title, body, close);
    box.onclick = () => {
      fetch(`${message.beacon}/v1/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: message.id, sig: message.sig, event: "clicked" }),
        keepalive: true,
      }).catch(() => undefined);
      if (message.url) {
        global.location.href = message.url;
      }
      box.remove();
    };
    document.body.append(box);
    setTimeout(() => box.remove(), 12000);
  }

  global.Beacon = Beacon;
})(typeof window !== "undefined" ? window : self);
