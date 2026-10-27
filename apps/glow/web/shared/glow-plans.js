// Glow plans, shared by the Glow apps: Glow Free (everything that works today) and Glow Pro (bigger limits).
// Pro is a Lemon Squeezy subscription; the license key is checked by the Glow cloud service, which asks
// Lemon Squeezy's License API. The key and the last check stay in this browser only.
(function () {
  "use strict";
  const STORAGE_KEY = "glow.plan.v1";
  const RECHECK_MS = 24 * 60 * 60 * 1000;      // check the subscription again once a day
  const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // keep Pro for a week if the check can't be reached
  const LIMITS = {
    free: { steps: 4, browserActions: 15, automations: 10, skills: 12 },
    pro: { steps: 8, browserActions: 40, automations: 50, skills: 60 },
  };
  let plansCache = null;

  function serviceUrl() {
    return String(window.GLOW_CLOUD_SERVICE_URL || "https://glow-cloud.juw12.workers.dev").replace(/\/+$/, "");
  }

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!value || typeof value !== "object") return { plan: "free" };
      return {
        plan: value.plan === "pro" ? "pro" : "free",
        licenseKey: typeof value.licenseKey === "string" ? value.licenseKey.slice(0, 120) : "",
        instanceId: typeof value.instanceId === "string" ? value.instanceId.slice(0, 100) : "",
        checkedAt: Number(value.checkedAt) || 0,
        customer: typeof value.customer === "string" ? value.customer.slice(0, 60) : "",
        note: typeof value.note === "string" ? value.note.slice(0, 200) : "",
      };
    } catch (error) {
      return { plan: "free" };
    }
  }

  function write(value) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (error) {
      // Storage full or blocked: the plan simply isn't remembered.
    }
  }

  function isPro(now = Date.now()) {
    const state = read();
    return state.plan === "pro" && !!state.licenseKey && now - state.checkedAt < OFFLINE_GRACE_MS;
  }

  function limits() {
    return { ...LIMITS[isPro() ? "pro" : "free"] };
  }

  function deviceName() {
    const agent = navigator.userAgent || "";
    const system = /Android/i.test(agent) ? "Android" : /iPhone|iPad/i.test(agent) ? "iPhone" : /Windows/i.test(agent) ? "Windows"
      : /Mac OS/i.test(agent) ? "Mac" : /Linux/i.test(agent) ? "Linux" : "a browser";
    return "Glow on " + system;
  }

  async function post(body) {
    let response;
    try {
      response = await fetch(serviceUrl() + "/v1/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      return { status: 0, error: "Can't reach Glow right now. Check your internet connection." };
    }
    const data = await response.json().catch(() => ({}));
    return { ...data, status: response.status };
  }

  async function plans() {
    if (plansCache) return plansCache;
    try {
      const response = await fetch(serviceUrl() + "/v1/plans");
      const data = await response.json();
      if (response.ok && data.ok) plansCache = data;
    } catch (error) {
      // Offline: show the plans without a buy button.
    }
    return plansCache || { onSale: false, checkoutUrl: "", priceLabel: "", manageUrl: "https://app.lemonsqueezy.com/my-orders" };
  }

  async function activate(licenseKey) {
    const key = String(licenseKey || "").trim();
    if (!key) return { ok: false, error: "Paste the license key from your Glow Pro purchase email." };
    const result = await post({ action: "activate", licenseKey: key, device: deviceName() });
    if (result.status === 200 && result.pro) {
      write({ plan: "pro", licenseKey: key, instanceId: result.instanceId || "", checkedAt: Date.now(), customer: result.customer || "" });
      return { ok: true };
    }
    return { ok: false, error: result.error || "That key couldn't be activated." };
  }

  // Re-checks the subscription about once a day. A cancelled or ended subscription returns to Glow Free;
  // if the check can't be reached, Pro keeps working for up to a week.
  async function refresh(force = false) {
    const state = read();
    if (state.plan !== "pro" || !state.licenseKey) return { plan: "free" };
    if (!force && Date.now() - state.checkedAt < RECHECK_MS) return { plan: "pro" };
    const result = await post({ action: "validate", licenseKey: state.licenseKey, instanceId: state.instanceId });
    if (result.status === 200 && result.pro) {
      write({ ...state, checkedAt: Date.now() });
      return { plan: "pro" };
    }
    if (result.status === 200) {
      write({ plan: "free", note: result.error || "Your Glow Pro subscription has ended." });
      return { plan: "free", note: result.error };
    }
    return { plan: isPro() ? "pro" : "free", offline: true };
  }

  async function deactivate() {
    const state = read();
    if (state.licenseKey && state.instanceId) await post({ action: "deactivate", licenseKey: state.licenseKey, instanceId: state.instanceId });
    write({ plan: "free" });
  }

  function status() {
    const state = read();
    return { plan: isPro() ? "pro" : "free", customer: state.customer || "", note: state.note || "", checkedAt: state.checkedAt || 0 };
  }

  window.GlowPlans = { LIMITS, isPro, limits, plans, activate, refresh, deactivate, status, deviceName, STORAGE_KEY };
})();
