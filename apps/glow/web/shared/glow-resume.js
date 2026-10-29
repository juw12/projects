// ↩ Reopen where you left off. Loaded at the top of Glow home: when Glow is opened fresh (the app icon,
// a desktop shortcut, a new window) it goes straight back to the Glow app you were in last time
// (GlowChat, GlowRoom or GlowLead), which then reopens what you had open. It never redirects when you
// chose Glow home inside Glow, reloaded it, followed a link with a question or code in it, or turned
// "Reopen where I left off" off in the Glow apps menu. glow-apps.js records the last place.
(function () {
  "use strict";
  const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
  try {
    if (window.top !== window) return; // shown inside another Glow app
    const firstPageThisSession = !sessionStorage.getItem("glow.session");
    sessionStorage.setItem("glow.session", "1");
    if (!firstPageThisSession) return; // already inside Glow: Glow home was chosen on purpose
    if (localStorage.getItem("glow.resume") === "off") return;
    if (location.hash) return;
    for (const key of new URLSearchParams(location.search).keys()) {
      if (!/^(utm_[a-z]+|source|ref|fbclid|gclid)$/i.test(key)) return; // a link that asks for something
    }
    const navigation = performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : null;
    if (navigation && navigation.type && navigation.type !== "navigate") return; // reload or back/forward
    if (document.referrer && new URL(document.referrer).origin === location.origin) return; // clicked a link to Glow home
    const place = JSON.parse(localStorage.getItem("glow.lastPlace") || "null");
    if (!place || !/^(chat|room|lead)$/.test(place.app) || typeof place.path !== "string") return;
    if (!(Date.now() - Number(place.at || 0) < MAX_AGE_MS)) return;
    const root = location.pathname.replace(/[^/]*$/, "");
    if (!place.path.startsWith(root) || place.path === location.pathname || /[?#\\]|\.\./.test(place.path)) return;
    sessionStorage.setItem("glow.resumed", place.app);
    location.replace(place.path);
  } catch (error) {
    // Storage blocked or unreadable: Glow home opens as usual.
  }
})();
