// Glow home: start anything, jump back into GlowChat chats and GlowRoom missions,
// and see the one Glow account shared by every app (same origin, same browser storage).
(function () {
  "use strict";

  const CHAT_STORE_KEY = "mufakat.v1";   // GlowChat's storage key (kept from its original name)
  const ROOM_RUNS_KEY = "crew-runs-v1";  // GlowRoom's mission history
  const HOME_THEME_KEY = "glow.home.theme";
  const onPhone = window.matchMedia("(max-width: 720px)").matches;
  const $ = (id) => document.getElementById(id);

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function chatStore() {
    return readJson(CHAT_STORE_KEY, {}) || {};
  }

  // ---- theme: follow GlowChat's choice, or this page's own toggle, or the device ----
  function preferredTheme() {
    const own = localStorage.getItem(HOME_THEME_KEY);
    const chatChoice = (chatStore().settings || {}).theme;
    const choice = own || chatChoice || "system";
    if (choice === "light" || choice === "dark") return choice;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("theme-btn").textContent = theme === "dark" ? "☀" : "☾";
    $("theme-btn").title = theme === "dark" ? "Switch to light" : "Switch to dark";
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#262624" : "#faf9f5";
  }
  applyTheme(preferredTheme());
  $("theme-btn").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(HOME_THEME_KEY, next);
    applyTheme(next);
  });

  // ---- app links: phones open the mobile builds ----
  const chatPage = onPhone ? "./chat/mobile.html" : "./chat/";
  const roomPage = onPhone ? "./room/mobile.html" : "./room/";
  const leadPage = "./lead/";
  $("open-chat").href = chatPage;
  $("open-room").href = roomPage;

  // ---- the one Glow account ----
  function renderAccount() {
    const settings = chatStore().settings || {};
    const chip = $("account-chip");
    const text = $("account-text");
    const action = $("account-action");
    if (settings.account === "puter") {
      const name = settings.accountName || "Glow user";
      chip.textContent = "✦ " + name;
      chip.classList.add("signed-in");
      text.textContent = `Signed in as ${name}. GlowChat and GlowRoom both use this account and its Glow AI models.`;
      action.textContent = "Manage in GlowChat";
    } else {
      chip.textContent = "👤 Guest";
      chip.classList.remove("signed-in");
      text.textContent = "You're using Glow as a guest with Glow Free. Sign in once with a free Puter account, in GlowChat or GlowRoom, for stronger models; it works in every Glow app.";
      action.textContent = "Sign in in GlowChat";
    }
    action.href = chatPage;
  }

  // ---- quick start: hand the request to the right app ----
  const ROOM_HINT = /\b(research|find|search|latest|news|compare|price|prices|sources?|code|script|calculate|compute|convert|csv|json|scrape|build|analy[sz]e|report|logo|svg|graphic)\b/i;
  function suggest() {
    const text = $("start-input").value.trim();
    const roomFirst = text.length > 0 && ROOM_HINT.test(text);
    $("start-room").classList.toggle("suggested", roomFirst);
    $("start-chat").classList.toggle("suggested", text.length > 0 && !roomFirst);
    $("start-hint").textContent = !text
      ? "Quick questions → GlowChat · research, code and multi-step jobs → GlowRoom"
      : roomFirst
        ? "Sounds like a job for the crew: GlowRoom can search the web and run code."
        : "GlowChat can answer this right away.";
  }
  function launch(target) {
    const text = $("start-input").value.trim();
    const page = target === "room" ? roomPage : target === "lead" ? leadPage : chatPage;
    const url = new URL(page, location.href);
    if (text) {
      url.searchParams.set(target === "chat" ? "q" : "goal", text.slice(0, 2000));
      url.searchParams.set(target === "chat" ? "send" : "go", "1");
    }
    location.href = url.toString();
  }
  $("start-input").addEventListener("input", suggest);
  $("start-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      launch($("start-room").classList.contains("suggested") ? "room" : "chat");
    }
  });
  $("start-form").addEventListener("submit", (event) => {
    event.preventDefault();
    launch("chat");
  });
  $("start-room").addEventListener("click", () => launch("room"));
  $("start-lead").addEventListener("click", () => launch("lead"));

  // ---- jump back in ----
  function timeAgo(timestamp) {
    const seconds = Math.max(1, Math.round((Date.now() - Number(timestamp || 0)) / 1000));
    if (!timestamp || !Number.isFinite(seconds)) return "";
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return days < 30 ? `${days} d ago` : new Date(Number(timestamp)).toLocaleDateString();
  }
  function listItem(href, title, when) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = href;
    const name = document.createElement("span");
    name.className = "title";
    name.textContent = title;
    const time = document.createElement("span");
    time.className = "when";
    time.textContent = when;
    a.append(name, time);
    li.appendChild(a);
    return li;
  }
  function emptyItem(text) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = text;
    return li;
  }
  const MODE_ICONS = { council: "⚖ ", arena: "⚔ " };
  function renderRecent() {
    const conversations = (chatStore().conversations || [])
      .filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages) && c.messages.length)
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
      .slice(0, 4);
    const runs = (readJson(ROOM_RUNS_KEY, []) || [])
      .filter((r) => r && typeof r.goal === "string")
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 4);

    const chatList = $("recent-chats");
    chatList.replaceChildren();
    for (const conv of conversations) {
      const url = new URL(chatPage, location.href);
      url.searchParams.set("open", conv.id);
      const icon = conv.source === "crewroom" ? "🏢 " : (MODE_ICONS[conv.type] || "");
      chatList.appendChild(listItem(url.toString(), icon + (conv.title || "Untitled chat"), timeAgo(conv.updated)));
    }
    if (!conversations.length) chatList.appendChild(emptyItem("No chats yet. Ask GlowChat anything above."));

    const missionList = $("recent-missions");
    missionList.replaceChildren();
    for (const run of runs) {
      const status = run.status === "done" ? "✓ " : run.status === "running" ? "⏳ " : "";
      missionList.appendChild(listItem(new URL(roomPage, location.href).toString(), status + (run.goal.split("\n").find((line) => line.trim()) || "").replace(/\*\*/g, "").trim().slice(0, 90), timeAgo(run.createdAt)));
    }
    if (!runs.length) missionList.appendChild(emptyItem("No missions yet. Give GlowRoom a goal above."));

    $("recent").hidden = !conversations.length && !runs.length;
  }

  renderAccount();
  renderRecent();
  // Stay in sync when another Glow tab signs in, chats or finishes a mission.
  window.addEventListener("storage", (event) => {
    if (event.key === CHAT_STORE_KEY || event.key === ROOM_RUNS_KEY) {
      renderAccount();
      renderRecent();
    }
  });
  window.addEventListener("pageshow", () => {
    renderAccount();
    renderRecent();
  });

  // ---- install Glow home as an app ----
  let installEvent = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installEvent = event;
    $("install-btn").hidden = false;
  });
  $("install-btn").addEventListener("click", async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => null);
    installEvent = null;
    $("install-btn").hidden = true;
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  window.GlowHome = { renderRecent, renderAccount, suggest, launch };
})();
