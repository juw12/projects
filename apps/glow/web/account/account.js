// Glow · Profile & settings. One page for the account every Glow app shares: name, avatar,
// Puter sign-in, persona, usage and allowance, settings and your data. It reads and writes the
// same browser store GlowChat uses ("mufakat.v1"), so changes show up in every Glow app.
(function () {
  "use strict";

  const STORE_KEY = "mufakat.v1";
  const COLORS = (window.GlowApps && window.GlowApps.avatarColors) || ["#d97757", "#e7b75d", "#7fb069", "#5fa8d3", "#a78bfa", "#ec6f9c"];
  const AI_TYPE_NAMES = { professor: "Professor", builder: "Builder", detective: "Detective", guardian: "Guardian", allrounder: "All-rounder" };
  const $ = (id) => document.getElementById(id);

  function readStore() {
    try {
      const store = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      return store && typeof store === "object" ? store : {};
    } catch (error) {
      return {};
    }
  }

  function settings() {
    return readStore().settings || {};
  }

  // Merge into the shared store instead of replacing it, so chats and other settings stay intact.
  function saveSettings(patch) {
    const store = readStore();
    store.settings = { ...(store.settings || {}), ...patch };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (error) {
      toast("Couldn't save: this browser's storage is full or blocked");
      return;
    }
    if (window.GlowApps && window.GlowApps.refreshProfiles) window.GlowApps.refreshProfiles();
    render();
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function formatTokens(value) {
    const n = Number(value) || 0;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
    return String(Math.round(n));
  }

  let toastTimer = null;
  function toast(message) {
    const box = $("toast");
    box.textContent = message;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 2600);
  }

  function dayKey(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // ---------------------------------------------------------------- profile + account
  function renderProfile() {
    const s = settings();
    const name = String(s.displayName || "").trim();
    const color = COLORS.includes(s.avatarColor) ? s.avatarColor : COLORS[0];
    const signedIn = s.account === "puter";
    const shown = name || (signedIn ? s.accountName : "");
    const avatar = $("avatar-xl");
    const words = String(shown || "").trim().split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || "").slice(0, 2);
    avatar.textContent = letters ? letters.toUpperCase() : "👤";
    avatar.style.background = shown ? color : "";
    if (document.activeElement !== $("display-name")) $("display-name").value = name;
    $("swatches").innerHTML = COLORS.map((c) => `<button class="swatch" type="button" role="radio" aria-label="Colour ${c}" aria-checked="${c === color}" data-color="${c}" style="background:${c}"></button>`).join("");

    if (signedIn) {
      $("account-title").textContent = `Signed in as ${s.accountName || "Puter user"}`;
      $("account-sub").textContent = s.accountTemp
        ? "Temporary Puter account: save it on puter.com so you don't lose it."
        : "Glow AI models and chat sync use this free Puter account in every Glow app.";
    } else if (s.account === "guest") {
      $("account-title").textContent = "Guest";
      $("account-sub").textContent = "You're using Glow without an account. Sign in to use Glow AI models and sync your chats.";
    } else {
      $("account-title").textContent = "Not signed in";
      $("account-sub").textContent = "Sign in with a free Puter account (Google, Microsoft, Apple or email) to use Glow AI models and sync your chats.";
    }
    $("signin-btn").hidden = signedIn;
    $("switch-btn").hidden = !signedIn;
    $("signout-btn").hidden = !signedIn;
    $("temp-box").hidden = !(signedIn && s.accountTemp);

    const store = readStore();
    const conversations = store.conversations || [];
    const personas = s.customPersonas || [];
    const days = (store.usage && store.usage.days) || {};
    const monthPrefix = dayKey(new Date()).slice(0, 7);
    let monthTokens = 0;
    Object.entries(days).forEach(([key, day]) => {
      if (key.startsWith(monthPrefix)) monthTokens += (day.in || 0) + (day.out || 0);
    });
    let plan = "Glow Free";
    try {
      const saved = JSON.parse(localStorage.getItem("glow.plan.v1") || "null");
      if (saved && saved.plan === "pro") plan = "Glow Pro";
    } catch (error) {
      // No plan saved: Glow Free.
    }
    $("stats").innerHTML = [
      [conversations.length, "chats on this device"],
      [personas.length, personas.length === 1 ? "persona" : "personas"],
      [formatTokens(monthTokens), "tokens this month"],
      [plan, "your plan"],
    ].map(([value, label]) => `<div class="stat"><b>${escapeHtml(value)}</b><span>${label}</span></div>`).join("");
  }

  function sdk() {
    return window.puter && window.puter.auth ? window.puter : null;
  }

  function waitForSdk(timeout = 8000) {
    return new Promise((resolve) => {
      const started = Date.now();
      (function check() {
        if (sdk()) return resolve(sdk());
        if (Date.now() - started > timeout) return resolve(null);
        setTimeout(check, 150);
      })();
    });
  }

  async function syncFromPuter() {
    const puter = await waitForSdk();
    if (!puter) return;
    let signedIn = false;
    try {
      signedIn = puter.auth.isSignedIn();
    } catch (error) {
      signedIn = false;
    }
    const s = settings();
    if (!signedIn) {
      if (s.account === "puter") saveSettings({ account: "guest", accountName: "", accountTemp: false });
      return;
    }
    try {
      const user = await puter.auth.getUser();
      saveSettings({ account: "puter", accountName: (user && user.username) || s.accountName || "Puter user", accountTemp: !!(user && user.is_temp) });
    } catch (error) {
      // Offline or Puter is slow: keep what we know.
    }
    refreshAllowance();
  }

  async function signIn() {
    const button = $("signin-btn");
    button.disabled = true;
    button.textContent = "Opening Puter…";
    try {
      const puter = await waitForSdk();
      if (!puter) throw new Error("Puter didn't load. Check your connection and try again.");
      await puter.auth.signIn();
      await syncFromPuter();
      toast("✦ Signed in. Every Glow app now uses this account.");
    } catch (error) {
      const text = String((error && (error.message || error.error)) || error || "");
      toast(/cancel|closed/i.test(text) ? "Sign-in was cancelled" : `Couldn't sign in${text ? `: ${text}` : ""}`);
    } finally {
      button.disabled = false;
      button.textContent = "Sign in with Puter";
    }
  }

  async function signOut(silent = false) {
    const puter = sdk();
    try {
      if (puter) await Promise.resolve(puter.auth.signOut());
    } catch (error) {
      // Signed out locally either way.
    }
    saveSettings({ account: "guest", accountName: "", accountTemp: false });
    allowance = null;
    renderUsage();
    if (!silent) toast("Signed out. Your chats stay on this device.");
  }

  // ---------------------------------------------------------------- persona
  function renderPersona() {
    const s = settings();
    const personas = s.customPersonas || [];
    const current = s.defaultPersona || "default";
    const options = [["default", "✦ Glow default"], ...personas.map((p) => [p.id, `${p.icon || "🎭"} ${p.name}`])];
    if (!options.some(([id]) => id === current) && current !== "default") options.push([current, `Built-in: ${current}`]);
    $("persona-default").innerHTML = options.map(([id, label]) => `<option value="${escapeHtml(id)}"${id === current ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
    $("persona-list").innerHTML = personas.length
      ? personas.map((p) => {
        const typeId = (p.profile && p.profile.aiType) || p.aiType || "";
        const type = typeId ? AI_TYPE_NAMES[typeId] || typeId : "";
        return `<div class="persona-item"><span class="ico">${escapeHtml(p.icon || "🎭")}</span><span><b>${escapeHtml(p.name)}</b><small>${type ? `AI type: ${escapeHtml(type)}` : "Custom persona"}</small></span>${p.id === current ? '<span class="badge">Default</span>' : ""}</div>`;
      }).join("")
      : '<div class="empty">No persona yet. Take the quiz and GlowChat will talk the way you like.</div>';
  }

  // ---------------------------------------------------------------- usage
  let allowance = null;

  async function refreshAllowance() {
    const puter = sdk();
    if (!puter || settings().account !== "puter" || typeof puter.auth.getMonthlyUsage !== "function") return;
    try {
      const data = await puter.auth.getMonthlyUsage();
      const info = (data && (data.allowanceInfo || data.allowance_info)) || {};
      const total = Number(info.monthUsageAllowance);
      const remaining = Number(info.remaining);
      if (Number.isFinite(total) && total > 0 && Number.isFinite(remaining)) allowance = { total, remaining: Math.max(0, remaining) };
    } catch (error) {
      allowance = null;
    }
    renderUsage();
  }

  function renderUsage() {
    const store = readStore();
    const days = (store.usage && store.usage.days) || {};
    const today = new Date();
    const keys = [];
    for (let i = 13; i >= 0; i -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      keys.push(dayKey(date));
    }
    const totals = keys.map((key) => {
      const day = days[key] || {};
      return (day.in || 0) + (day.out || 0);
    });
    const sum = (list) => list.reduce((a, b) => a + b, 0);
    let replies = 0;
    let images = 0;
    Object.values(days).forEach((day) => {
      replies += day.replies || 0;
      images += day.images || 0;
    });
    $("usage-grid").innerHTML = [
      [formatTokens(totals[totals.length - 1]), "tokens today"],
      [formatTokens(sum(totals.slice(-7))), "tokens · last 7 days"],
      [formatTokens(replies), "AI replies · 90 days"],
      [formatTokens(images), "pictures made"],
    ].map(([value, label]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`).join("");
    const peak = Math.max(1, ...totals);
    $("usage-days").innerHTML = totals.map((value, i) => `<i class="${value ? "" : "zero"}" style="height:${Math.max(3, Math.round((value / peak) * 100))}%" title="${keys[i]}: ${formatTokens(value)} tokens"></i>`).join("");

    const bar = $("allowance-bar");
    const meter = bar.parentElement;
    if (settings().account !== "puter") {
      $("allowance-text").textContent = "Sign in to see it";
      bar.style.width = "0";
      meter.classList.remove("low");
    } else if (!allowance) {
      $("allowance-text").textContent = "Checking with Puter…";
    } else {
      const left = allowance.remaining / allowance.total;
      $("allowance-text").textContent = `${Math.round(left * 100)}% left`;
      bar.style.width = `${Math.max(2, Math.round(left * 100))}%`;
      meter.classList.toggle("low", left < 0.15);
    }
  }

  // ---------------------------------------------------------------- settings + data
  function renderPrefs() {
    const s = settings();
    $("theme").value = ["system", "dark", "light"].includes(s.theme) ? s.theme : "system";
    $("followups").checked = s.followUps !== false;
    $("cloudsync").checked = s.cloudSync !== false;
    $("retention").value = String(Number(s.retentionDays) || 0);
  }

  function renderData() {
    const store = readStore();
    const conversations = store.conversations || [];
    const raw = localStorage.getItem(STORE_KEY) || "";
    const pinned = conversations.filter((c) => c.pinned).length;
    const oldest = conversations.reduce((min, c) => Math.min(min, c.created || c.updated || Date.now()), Date.now());
    $("data-grid").innerHTML = [
      [conversations.length, "chats"],
      [pinned, "pinned"],
      [`${Math.max(1, Math.round(raw.length / 1024))} KB`, "stored on this device"],
      [conversations.length ? new Date(oldest).toLocaleDateString() : "–", "oldest chat"],
    ].map(([value, label]) => `<div class="stat"><b>${escapeHtml(value)}</b><span>${label}</span></div>`).join("");
  }

  function exportAll() {
    const store = readStore();
    const copy = JSON.parse(JSON.stringify(store));
    if (copy.settings) {
      // Never put API keys in an export file someone might share.
      ["openrouterKey", "customKey"].forEach((key) => { if (copy.settings[key]) copy.settings[key] = "(removed)"; });
    }
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), app: "Glow", data: copy }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `glow-export-${dayKey(new Date())}.json`;
    link.dataset.glowExternal = "1";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 1000);
    toast("⤓ Export saved (API keys are left out)");
  }

  async function wipeAll() {
    const store = readStore();
    const count = (store.conversations || []).length;
    if (!window.confirm(`Delete all GlowChat data on this device?\n\n${count} chats, your personas, usage and settings will be removed. This can't be undone.`)) return;
    if (!window.confirm("Really delete everything? Export first if you might want it back.")) return;
    if (settings().account === "puter") await signOut(true);
    localStorage.removeItem(STORE_KEY);
    if (window.GlowApps && window.GlowApps.refreshProfiles) window.GlowApps.refreshProfiles();
    render();
    toast("All GlowChat data on this device was deleted");
  }

  // ---------------------------------------------------------------- about
  function renderAbout() {
    const apps = window.GlowApps;
    $("version-text").textContent = apps ? `Glow ${apps.version}` : "Glow";
  }

  async function checkUpdates() {
    const apps = window.GlowApps;
    if (!apps || !apps.checkForUpdate) return;
    const button = $("update-btn");
    button.disabled = true;
    button.textContent = "Checking…";
    try {
      await apps.checkForUpdate(true);
      const latest = apps.latest;
      if (latest && apps.compareVersions(latest.version, apps.version) > 0) {
        button.textContent = `Update to ${latest.version}`;
        button.disabled = false;
        button.onclick = () => apps.applyUpdate();
        return;
      }
      toast(`✓ You're on the latest Glow (${apps.version})`);
    } catch (error) {
      toast("Couldn't check for updates right now");
    }
    button.disabled = false;
    button.textContent = "Check for updates";
  }

  // ---------------------------------------------------------------- page
  function render() {
    renderProfile();
    renderPersona();
    renderUsage();
    renderPrefs();
    renderData();
    renderAbout();
  }

  function highlightTab() {
    const sections = [...document.querySelectorAll("main section[id]")];
    let active = sections[0] ? sections[0].id : "";
    sections.forEach((section) => {
      if (section.getBoundingClientRect().top < 160) active = section.id;
    });
    document.querySelectorAll("#tabs a").forEach((link) => link.classList.toggle("active", link.dataset.tab === active));
  }

  function bind() {
    let nameTimer = null;
    $("display-name").addEventListener("input", (event) => {
      clearTimeout(nameTimer);
      const value = event.target.value.replace(/\s+/g, " ").slice(0, 40);
      nameTimer = setTimeout(() => saveSettings({ displayName: value.trim() }), 300);
    });
    $("display-name").addEventListener("change", (event) => saveSettings({ displayName: event.target.value.trim().slice(0, 40) }));
    $("swatches").addEventListener("click", (event) => {
      const swatch = event.target.closest("[data-color]");
      if (swatch) saveSettings({ avatarColor: swatch.dataset.color });
    });
    $("signin-btn").addEventListener("click", signIn);
    $("signout-btn").addEventListener("click", () => signOut());
    $("switch-btn").addEventListener("click", async () => {
      await signOut(true);
      signIn();
    });
    $("persona-default").addEventListener("change", (event) => {
      saveSettings({ defaultPersona: event.target.value });
      toast("Default persona saved for new chats");
    });
    $("theme").addEventListener("change", (event) => saveSettings({ theme: event.target.value }));
    $("followups").addEventListener("change", (event) => saveSettings({ followUps: event.target.checked }));
    $("cloudsync").addEventListener("change", (event) => saveSettings({ cloudSync: event.target.checked }));
    $("retention").addEventListener("change", (event) => {
      saveSettings({ retentionDays: Number(event.target.value) || 0 });
      toast(Number(event.target.value) ? "Older chats will be removed next time GlowChat opens (pinned chats stay)" : "Chats are kept until you delete them");
    });
    $("export-btn").addEventListener("click", exportAll);
    $("wipe-btn").addEventListener("click", wipeAll);
    $("update-btn").addEventListener("click", checkUpdates);
    window.addEventListener("scroll", highlightTab, { passive: true });
    window.addEventListener("storage", (event) => {
      if (event.key === STORE_KEY) render();
    });
  }

  bind();
  render();
  highlightTab();
  syncFromPuter();
  window.GlowAccount = { render, saveSettings, settings, signIn, signOut, exportAll };
})();
