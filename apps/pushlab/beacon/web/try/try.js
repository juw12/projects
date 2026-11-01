/* Beacon "try" page: subscribe any phone or browser to an app in one tap.
 * /try/?app=pk_…&tags=qa:device,lang:id&user=u42
 * Tether opens this on a test phone (via adb) and taps through it automatically. */
(() => {
  "use strict";
  const params = new URLSearchParams(location.search);
  const appKey = params.get("app") || "";
  const tags = (params.get("tags") || "").split(",").map((t) => t.trim()).filter(Boolean);
  const userId = params.get("user") || undefined;
  const button = document.getElementById("enable");
  const state = document.getElementById("state");

  function show(message, kind) {
    state.textContent = message;
    state.className = "state " + (kind || "");
  }

  if (!appKey) {
    button.disabled = true;
    show("Missing ?app=pk_… in the link.", "err");
    return;
  }

  Beacon.init({ server: location.origin, appKey, serviceWorker: "/try-sw.js", scope: "/try/" });
  if (tags.length) {
    document.getElementById("tags").innerHTML = "Tags: " + tags.map((t) => `<code>${t.replace(/[<>&]/g, "")}</code>`).join(" ");
  }

  fetch(`/v1/client/${encodeURIComponent(appKey)}`)
    .then((r) => r.json())
    .then((info) => {
      if (info.ok) {
        document.getElementById("appName").textContent = info.name;
        document.title = `${info.name} — notifications`;
      }
    })
    .catch(() => undefined);

  if (Beacon.isSubscribed() && Beacon.permission() === "granted") {
    show("You're subscribed ✓", "ok");
    button.textContent = "Subscribe again";
  }
  if (Beacon.needsInstallOnIOS()) {
    show("On iPhone: tap Share → Add to Home Screen, open it from there, then enable.", "err");
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    show("Waiting for permission…");
    try {
      await Beacon.subscribe({ tags, userId });
      show("You're subscribed ✓", "ok");
      button.textContent = "Subscribe again";
    } catch (error) {
      show(error.message, "err");
    } finally {
      button.disabled = false;
    }
  });
})();
