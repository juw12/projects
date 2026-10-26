// Glow app switcher, shared by every app in the Glow ecosystem (Glow home, GlowLead, GlowChat, GlowRoom).
// Usage: add an element with the attribute data-glow-apps (it becomes the switcher button),
// or call window.GlowApps.mount(element). All apps share one origin, so they share the
// Glow account (Puter sign-in) stored by GlowChat under the "mufakat.v1" key.
(function () {
  "use strict";

  const STORE_KEY = "mufakat.v1";
  const scriptUrl = document.currentScript ? document.currentScript.src : location.href;
  const ROOT = new URL("../", scriptUrl); // .../glow/
  // Mobile builds on mobile pages, and on phones even from Glow home.
  const onMobilePage = /mobile\.html$/.test(location.pathname) || window.matchMedia("(max-width: 720px)").matches;

  const APPS = [
    { id: "home", name: "Glow", icon: "✦", desc: "Your Glow home: start anything", page: "" },
    { id: "lead", name: "GlowLead", icon: "👑", desc: "Your AI lead: plans, delegates to the apps, checks", page: "lead/" },
    { id: "chat", name: "GlowChat", icon: "💬", desc: "Chat, Council and Arena with any AI model", page: onMobilePage ? "chat/mobile.html" : "chat/" },
    { id: "room", name: "GlowRoom", icon: "🏢", desc: "An AI crew that researches, codes and reports back", page: onMobilePage ? "room/mobile.html" : "room/" },
  ];

  function appUrl(id) {
    const app = APPS.find((a) => a.id === id);
    return new URL(app ? app.page : "", ROOT).href;
  }

  function currentApp() {
    const path = location.pathname;
    if (/\/chat\//.test(path)) return "chat";
    if (/\/room\//.test(path)) return "room";
    if (/\/lead\//.test(path)) return "lead";
    return "home";
  }

  function account() {
    try {
      const store = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      const settings = (store && store.settings) || {};
      if (settings.account === "puter") return { signedIn: true, name: settings.accountName || "Glow user" };
      return { signedIn: false, name: settings.account === "guest" ? "Guest" : "" };
    } catch (error) {
      return { signedIn: false, name: "" };
    }
  }

  const CSS = `
.glow-apps-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer}
.glow-apps-btn .glow-apps-grid{display:inline-grid;grid-template-columns:repeat(3,4px);gap:2px}
.glow-apps-btn .glow-apps-grid i{width:4px;height:4px;border-radius:1px;background:currentColor;opacity:.85}
.glow-apps-menu{position:fixed;z-index:2147483000;width:min(320px,calc(100vw - 16px));background:#1f1e1c;color:#f3efe8;
  border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.45);padding:10px;
  font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;animation:glowAppsIn .14s ease both}
.glow-apps-menu[hidden]{display:none}
@keyframes glowAppsIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.glow-apps-head{display:flex;align-items:center;gap:8px;padding:4px 6px 10px;font-weight:700;letter-spacing:-.01em}
.glow-apps-head b{color:#e8875d;font-size:16px}
.glow-apps-list{display:flex;flex-direction:column;gap:4px}
.glow-apps-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:12px;color:inherit;text-decoration:none}
.glow-apps-item:hover,.glow-apps-item:focus-visible{background:rgba(255,255,255,.07);outline:none}
.glow-apps-item.current{background:rgba(232,135,93,.16)}
.glow-apps-icon{width:34px;height:34px;flex:0 0 34px;border-radius:10px;display:grid;place-items:center;font-size:18px;
  background:linear-gradient(135deg,rgba(232,135,93,.35),rgba(232,135,93,.08))}
.glow-apps-name{font-weight:650}
.glow-apps-desc{font-size:12px;opacity:.7}
.glow-apps-here{margin-left:auto;font-size:11px;opacity:.65}
.glow-apps-foot{margin-top:8px;padding:8px 8px 2px;border-top:1px solid rgba(255,255,255,.1);font-size:12px;opacity:.8}
`;

  let menu = null;
  let openerButton = null;

  function ensureStyles() {
    if (document.getElementById("glow-apps-style")) return;
    const style = document.createElement("style");
    style.id = "glow-apps-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function buildMenu() {
    const here = currentApp();
    const who = account();
    const items = APPS.map((app) => `
      <a class="glow-apps-item${app.id === here ? " current" : ""}" href="${appUrl(app.id)}" data-glow-app="${app.id}"${app.id === here ? ' aria-current="page"' : ""}>
        <span class="glow-apps-icon" aria-hidden="true">${app.icon}</span>
        <span><span class="glow-apps-name">${app.name}</span><br><span class="glow-apps-desc">${app.desc}</span></span>
        ${app.id === here ? '<span class="glow-apps-here">You\'re here</span>' : ""}
      </a>`).join("");
    const foot = who.signedIn
      ? `Signed in as <b>${escapeHtml(who.name)}</b> · one Glow account for every app`
      : "One Glow account for every app · sign in once in any of them";
    const element = document.createElement("div");
    element.className = "glow-apps-menu";
    element.id = "glow-apps-menu";
    element.setAttribute("role", "menu");
    element.hidden = true;
    element.innerHTML = `<div class="glow-apps-head"><b>✦</b> Glow apps</div><div class="glow-apps-list">${items}</div><div class="glow-apps-foot">${foot}</div>`;
    document.body.appendChild(element);
    return element;
  }

  function place(button) {
    const rect = button.getBoundingClientRect();
    const width = menu.offsetWidth || 320;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const below = rect.bottom + 8;
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.min(below, window.innerHeight - menu.offsetHeight - 8)}px`;
  }

  function close() {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    if (openerButton) openerButton.setAttribute("aria-expanded", "false");
  }

  function open(button) {
    ensureStyles();
    if (menu) menu.remove();
    menu = buildMenu();
    menu.hidden = false;
    openerButton = button;
    button.setAttribute("aria-expanded", "true");
    place(button);
    const first = menu.querySelector(".glow-apps-item:not(.current)") || menu.querySelector(".glow-apps-item");
    if (first) first.focus({ preventScroll: true });
  }

  function mount(button) {
    if (!button || button.dataset.glowAppsMounted) return;
    ensureStyles();
    button.dataset.glowAppsMounted = "1";
    button.classList.add("glow-apps-btn");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    if (!button.title) button.title = "Glow apps";
    if (!button.innerHTML.trim()) button.innerHTML = '<span class="glow-apps-grid" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>';
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (menu && !menu.hidden && openerButton === button) close();
      else open(button);
    });
  }

  document.addEventListener("click", (event) => {
    if (menu && !menu.hidden && !menu.contains(event.target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu && !menu.hidden) {
      event.stopPropagation();
      close();
      if (openerButton) openerButton.focus();
    }
  }, true);
  window.addEventListener("resize", close);

  function autoMount() {
    document.querySelectorAll("[data-glow-apps]").forEach(mount);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount);
  else autoMount();

  window.GlowApps = { mount, open, close, appUrl, currentApp, account, apps: APPS.map((a) => ({ ...a })) };
})();
