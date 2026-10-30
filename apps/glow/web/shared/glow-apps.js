// Glow app switcher, shared by every app in the Glow ecosystem (Glow home, GlowLead, GlowChat, GlowRoom).
// Usage: add an element with the attribute data-glow-apps (it becomes the switcher button),
// or call window.GlowApps.mount(element). All apps share one origin, so they share the
// Glow account (Puter sign-in) stored by GlowChat under the "mufakat.v1" key.
(function () {
  "use strict";

  const STORE_KEY = "mufakat.v1";
  const scriptUrl = document.currentScript ? document.currentScript.src : location.href;
  const ROOT = new URL("../", scriptUrl); // .../glow/
  // The Glow family version. Bump it together with ../version.json for every release:
  // an older copy of this script then sees the newer version.json and offers "Update now".
  const GLOW_VERSION = "1.27.3";
  const LIVE_ROOT = "https://juw12.github.io/projects/glow/";
  const APK_URL = "https://github.com/juw12/projects/releases/download/glow-android/Glow-android.apk";
  const embedded = (function () {
    try {
      return window.top !== window && !!window.parent.document;
    } catch (error) {
      return false;
    }
  })();
  // Mobile builds on mobile pages, and on phones even from Glow home.
  const onMobilePage = /mobile\.html$/.test(location.pathname) || window.matchMedia("(max-width: 720px)").matches;

  // ♥ Support Glow: donation links shown in every Glow apps menu. Leave the list empty to hide the section.
  // Example: { icon: "☕", label: "Saweria", url: "https://saweria.co/yourname" }
  const DONATE_LINKS = [];

  const APPS = [
    { id: "home", name: "Glow", icon: "✦", desc: "Your Glow home: start anything", page: "" },
    { id: "lead", name: "GlowLead", icon: "👑", desc: "Your AI lead: plans, delegates to the apps, checks", page: "lead/" },
    { id: "chat", name: "GlowChat", icon: "💬", desc: "Chat, Council and Arena with any AI model", page: onMobilePage ? "chat/mobile.html" : "chat/" },
    { id: "room", name: "GlowRoom", icon: "🏢", desc: "An AI crew that researches, codes and reports back", page: onMobilePage ? "room/mobile.html" : "room/" },
  ];

  // Language & region come from glow-locale.js (loaded first); English when it is missing.
  function tr(key, fallback) {
    return window.GlowLocale ? window.GlowLocale.t(key) : fallback;
  }

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

  const AVATAR_COLORS = ["#d97757", "#e7b75d", "#7fb069", "#5fa8d3", "#a78bfa", "#ec6f9c"];

  // The shared Glow account: Puter sign-in plus the name and avatar colour you pick in
  // Profile & settings. Every Glow app reads it from the same browser store.
  function account() {
    try {
      const store = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      const settings = (store && store.settings) || {};
      // puterSession is written whenever a Glow app actually checks with Puter; false = the session expired.
      const expired = settings.account === "puter" && settings.puterSession === false;
      const signedIn = settings.account === "puter" && !expired;
      const guest = settings.account === "guest";
      const accountName = settings.account === "puter" ? settings.accountName || "Glow user" : "";
      const displayName = String(settings.displayName || "").trim();
      const name = displayName || accountName || (guest ? "Guest" : "");
      const avatarColor = AVATAR_COLORS.includes(settings.avatarColor) ? settings.avatarColor : AVATAR_COLORS[0];
      return { signedIn, expired, guest, temp: signedIn && !!settings.accountTemp, accountName, displayName, name, avatarColor };
    } catch (error) {
      return { signedIn: false, expired: false, guest: false, temp: false, accountName: "", displayName: "", name: "", avatarColor: AVATAR_COLORS[0] };
    }
  }

  function accountUrl(section) {
    return new URL("account/", ROOT).href + (section ? "#" + section : "");
  }

  function initials(name) {
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "";
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2);
    return letters.toUpperCase();
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
.glow-apps-version{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;padding:8px;border-radius:10px;background:rgba(255,255,255,.05);font-size:12.5px}
.glow-apps-version b{color:#f3efe8}
.glow-apps-version .ok{color:#7fd1a8}
.glow-apps-version button{margin-left:auto;border:0;border-radius:8px;padding:5px 10px;font:600 12px system-ui,sans-serif;cursor:pointer;background:rgba(255,255,255,.1);color:#f3efe8}
.glow-apps-version button.go{background:#d97757;color:#fff}
.glow-update-bar{position:fixed;left:0;right:0;margin:0 auto;width:max-content;bottom:18px;z-index:2147483001;display:flex;align-items:center;gap:10px;
  max-width:calc(100vw - 24px);box-sizing:border-box;padding:10px 10px 10px 16px;border-radius:14px;background:#1f1e1c;color:#f3efe8;border:1px solid rgba(255,255,255,.14);
  box-shadow:0 16px 44px rgba(0,0,0,.4);font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;animation:glowAppsIn .2s ease both}
.glow-update-bar[hidden]{display:none}
.glow-update-bar span{min-width:0}
.glow-update-bar small{display:block;opacity:.7;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46ch}
.glow-update-bar button{border:0;border-radius:10px;padding:8px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.glow-update-bar .go{background:#d97757;color:#fff}
.glow-update-bar .later{background:transparent;color:#f3efe8;opacity:.75;padding:8px}
.glow-room-panel{position:fixed;inset:0;z-index:2147482000;display:flex;flex-direction:column;background:#1f1e1d}
.glow-room-panel[hidden]{display:none}
.glow-room-bar{display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;background:#262624;color:#ece9e1;border-bottom:1px solid #3e3e3a;
  font:14px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding-top:max(8px,env(safe-area-inset-top))}
.glow-room-bar b{font-size:15px}
.glow-room-bar small{opacity:.65}
.glow-room-bar .grow{flex:1}
.glow-room-bar button{border:1px solid #3e3e3a;background:#30302e;color:#ece9e1;border-radius:10px;padding:7px 12px;font:600 13px system-ui,sans-serif;cursor:pointer}
.glow-room-bar button:hover{border-color:#d97757}
.glow-room-bar .close{background:#d97757;border-color:#d97757;color:#fff}
.glow-room-panel iframe{flex:1;width:100%;border:0;background:#1f1e1d}
html.glow-room-open,html.glow-room-open body{overflow:hidden}
.glow-apps-foot a.glow-apps-profile{display:flex;align-items:center;gap:8px;margin:0 -2px 8px;padding:8px 10px;border-radius:10px;color:#f3efe8;text-decoration:none;background:rgba(255,255,255,.05);font-weight:600;opacity:1}
.glow-apps-foot a.glow-apps-profile:hover{background:rgba(232,135,93,.18)}
.glow-avatar-btn{position:relative;display:inline-grid;place-items:center;width:34px;height:34px;min-width:34px;flex:0 0 34px;padding:0;border-radius:50%;
  border:2px solid rgba(255,255,255,.18);background:var(--glow-avatar,#d97757);color:#fff;cursor:pointer;
  font:700 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.02em;box-shadow:0 2px 8px rgba(0,0,0,.25);transition:transform .12s,border-color .12s}
.glow-avatar-btn:hover,.glow-avatar-btn:focus-visible,.glow-avatar-btn[aria-expanded="true"]{border-color:#f0a27f;transform:scale(1.05);outline:none}
.glow-avatar-btn.guest{background:#4a4642;color:#e9e3d9}
.glow-avatar-btn .glow-avatar-dot{position:absolute;width:9px;height:9px;border-radius:50%;background:#7fd1a8;border:2px solid #1f1e1c;right:-3px;bottom:-3px}
.glow-avatar-btn.temp .glow-avatar-dot{background:#e7b75d}
.glow-avatar-btn.expired{filter:grayscale(.65);opacity:.85}
.glow-profile-menu{position:fixed;z-index:2147483000;width:min(300px,calc(100vw - 16px));background:#1f1e1c;color:#f3efe8;
  border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.45);padding:10px;
  font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;animation:glowAppsIn .14s ease both}
.glow-profile-menu[hidden]{display:none}
.glow-profile-head{display:flex;align-items:center;gap:12px;padding:6px 6px 12px;border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:6px}
.glow-profile-head .glow-avatar-btn{width:44px;height:44px;min-width:44px;flex-basis:44px;font-size:16px;cursor:default;transform:none}
.glow-profile-head b{display:block;font-size:15px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.glow-profile-head small{display:block;font-size:12px;opacity:.7}
.glow-profile-head small.warn{color:#e7b75d;opacity:1}
.glow-profile-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;color:inherit;text-decoration:none}
.glow-profile-item:hover,.glow-profile-item:focus-visible{background:rgba(255,255,255,.07);outline:none}
.glow-profile-item span{width:22px;text-align:center}
.glow-profile-item.primary{background:#d97757;color:#fff;font-weight:650;margin-top:4px}
.glow-profile-item.primary:hover{background:#e0865f}
html.glow-embedded [data-glow-apps]{display:none!important}
.glow-donate{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}
.glow-donate a{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:999px;background:rgba(236,111,156,.14);color:inherit;text-decoration:none;font-size:12.5px;font-weight:600}
.glow-donate a:hover{background:rgba(236,111,156,.26)}
button.glow-apps-profile{width:100%;border:0;background:none;font:inherit;color:inherit;cursor:pointer;text-align:left}
.glow-widget-bubble{position:fixed;right:18px;bottom:96px;z-index:2147481000;width:54px;height:54px;border-radius:50%;border:0;cursor:pointer;font-size:25px;line-height:54px;text-align:center;color:#fff;background:linear-gradient(135deg,#d97757,#e7b75d);box-shadow:0 8px 24px rgba(0,0,0,.35);touch-action:none;user-select:none;-webkit-user-select:none}
.glow-widget-bubble:focus-visible{outline:3px solid #fff;outline-offset:2px}
.glow-widget-bubble .dot{position:absolute;top:3px;right:3px;width:11px;height:11px;border-radius:50%;background:#7fb069;border:2px solid #1f1e1d;display:none}
.glow-widget-bubble.busy .dot{display:block}
.glow-widget-panel{position:fixed;right:18px;bottom:160px;z-index:2147481001;width:min(400px,calc(100vw - 24px));height:min(620px,calc(100vh - 190px));display:flex;flex-direction:column;border-radius:16px;overflow:hidden;background:#1f1e1d;box-shadow:0 18px 50px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.12)}
.glow-widget-panel[hidden]{display:none}
.glow-widget-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#2a2826;color:#f5efe6;font:600 13px system-ui,sans-serif}
.glow-widget-bar .grow{flex:1}
.glow-widget-bar button{border:0;background:rgba(255,255,255,.08);color:inherit;border-radius:8px;padding:5px 9px;font:inherit;font-weight:500;cursor:pointer}
.glow-widget-panel iframe{flex:1;width:100%;border:0;background:#1f1e1d}
html.glow-room-open .glow-widget-bubble,html.glow-room-open .glow-widget-panel{display:none}
@media (max-width:720px){.glow-widget-bubble{right:12px;bottom:84px;width:50px;height:50px;line-height:50px}.glow-widget-panel{right:0;left:0;bottom:0;width:100%;height:82vh;border-radius:16px 16px 0 0}}
@media (max-width:560px){.glow-room-bar small,.glow-room-bar .full span{display:none}.glow-update-bar small{max-width:24ch}}
.glow-install-sheet{position:fixed;left:0;right:0;margin:0 auto;bottom:max(14px,env(safe-area-inset-bottom));z-index:2147483002;
  width:min(440px,calc(100vw - 20px));max-height:calc(100vh - 28px);max-height:calc(100dvh - 28px);overflow-y:auto;box-sizing:border-box;
  padding:16px 16px 14px;border-radius:18px;background:#1f1e1c;color:#f3efe8;border:1px solid rgba(255,255,255,.14);
  box-shadow:0 18px 50px rgba(0,0,0,.45);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;animation:glowAppsIn .2s ease both}
.glow-install-sheet[hidden]{display:none}
.glow-install-sheet h2{margin:0 0 4px;font-size:17px}
.glow-install-sheet p{margin:6px 0;opacity:.85}
.glow-install-sheet ol{margin:8px 0 8px 20px;padding:0}
.glow-install-sheet li{margin:4px 0}
.glow-install-sheet .row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
.glow-install-sheet button{border:0;border-radius:10px;padding:8px 14px;font:600 13px system-ui,sans-serif;cursor:pointer}
.glow-install-sheet .go{background:#d97757;color:#fff}
.glow-install-sheet .later{background:transparent;color:#f3efe8;opacity:.75}
.glow-install-sheet .share{display:inline-block;padding:0 6px;border-radius:6px;background:rgba(255,255,255,.12)}
.glow-install-sheet ul{margin:8px 0 8px 20px;padding:0}
.glow-version-chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:999px;border:1px solid rgba(127,127,127,.4);
  background:transparent;color:inherit;font:600 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:0!important;text-transform:none!important;
  cursor:pointer;white-space:nowrap;flex:0 0 auto;opacity:.85;min-width:0;box-shadow:none}
.glow-version-chip:hover,.glow-version-chip:focus-visible{opacity:1;border-color:#d97757;outline:none}
.glow-version-chip *{text-transform:none!important;letter-spacing:0!important}
.glow-version-chip.ok .icon{color:#3fae7a}
.glow-version-chip.busy{cursor:progress}
.glow-version-chip.ready,.glow-version-chip.ready *{color:#fff!important}
.glow-version-chip.ready{background:#d97757!important;border-color:#d97757!important;opacity:1;animation:glowChipPulse 2.4s ease-out infinite}
.glow-version-chip.ready:hover{background:#e0865f!important}
.glow-version-chip.glow-chip-compact{padding:0;width:30px;justify-content:center}
.glow-version-chip.glow-chip-compact .label{display:none}
.glow-version-chip.glow-chip-hidden{display:none!important}
.glow-apps-btn{position:relative}
.glow-apps-btn.glow-update-ready::after{content:"";position:absolute;top:-4px;right:-4px;width:11px;height:11px;border-radius:50%;background:#d97757;border:2px solid #fff;box-sizing:border-box}
@keyframes glowChipPulse{0%{box-shadow:0 0 0 0 rgba(217,119,87,.6)}70%{box-shadow:0 0 0 10px rgba(217,119,87,0)}100%{box-shadow:0 0 0 0 rgba(217,119,87,0)}}
@media (max-width:900px){.glow-version-chip:not(.ready){padding:0;width:30px;justify-content:center}.glow-version-chip:not(.ready) .label,.glow-version-chip .more{display:none}}
@media (max-width:560px){.glow-version-chip{display:none!important}}
@media (prefers-reduced-motion:reduce){.glow-version-chip.ready{animation:none}}
.glow-apps-version-links{flex-basis:100%;font-size:12px;opacity:.85}
.glow-apps-version-links a{color:#f0a27f;text-decoration:none}
.glow-apps-version-links a:hover{text-decoration:underline}
.glow-update-bar .whats{background:rgba(255,255,255,.1);color:#f3efe8}
.glow-toast{position:fixed;left:0;right:0;margin:0 auto;width:max-content;max-width:calc(100vw - 24px);box-sizing:border-box;bottom:max(18px,env(safe-area-inset-bottom));
  z-index:2147483003;display:flex;align-items:center;gap:12px;padding:10px 10px 10px 16px;border-radius:14px;background:#1f1e1c;color:#f3efe8;border:1px solid rgba(255,255,255,.14);
  box-shadow:0 16px 44px rgba(0,0,0,.4);font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;animation:glowAppsIn .2s ease both}
.glow-toast[hidden]{display:none}
.glow-toast button{border:0;border-radius:10px;padding:7px 12px;font:600 13px system-ui,sans-serif;cursor:pointer;background:#d97757;color:#fff;white-space:nowrap}
.glow-toast .close{background:transparent;color:#f3efe8;opacity:.7;padding:7px 8px}
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
        <span><span class="glow-apps-name">${app.name}</span><br><span class="glow-apps-desc">${escapeHtml(tr(`apps.${app.id}`, app.desc))}</span></span>
        ${app.id === here ? `<span class="glow-apps-here">${escapeHtml(tr("apps.here", "You're here"))}</span>` : ""}
      </a>`).join("");
    const profile = `<a class="glow-apps-profile" href="${accountUrl()}">👤 ${escapeHtml(tr("profile", "Profile & settings"))}<span style="margin-left:auto;opacity:.6">›</span></a>` + (window.GlowLocale ? `<a class="glow-apps-profile" href="#" data-glow-locale>🌐 ${escapeHtml(tr("menu.language", "Language & region"))}<span style="margin-left:auto;opacity:.6">${escapeHtml(localeLabel())}</span></a>` : "")
      + (here !== "lead" && !embedded
        ? `<button class="glow-apps-profile glow-widget-toggle" type="button" data-glow-widget-toggle>👑 Agent bubble on every page<span style="margin-left:auto;opacity:.7">${widgetEnabled() ? "On" : "Off"}</span></button>`
        : "")
      + (!embedded
        ? `<button class="glow-apps-profile" type="button" data-glow-resume-toggle title="When you open Glow again, it goes back to the app and chat you had open">↩ Reopen where I left off<span style="margin-left:auto;opacity:.7">${resumeEnabled() ? "On" : "Off"}</span></button>`
        : "")
      + donateHtml();
    const foot = profile + (who.signedIn
      ? `Signed in as <b>${escapeHtml(who.name)}</b> · one Glow account for every app`
      : "One Glow account for every app · sign in once in any of them");
    const element = document.createElement("div");
    element.className = "glow-apps-menu";
    element.id = "glow-apps-menu";
    element.setAttribute("role", "menu");
    element.hidden = true;
    element.innerHTML = `<div class="glow-apps-head"><b>✦</b> ${escapeHtml(tr("apps.title", "Glow apps"))}</div><div class="glow-apps-list">${items}</div><div class="glow-apps-foot">${foot}<div class="glow-apps-version" id="glow-apps-version"></div></div>`;
    bindLocaleLinks(element);
    document.body.appendChild(element);
    renderVersionLine(element.querySelector("#glow-apps-version"));
    return element;
  }

  // "🌐 Language & region" entries: show the current choice and open the picker.
  function localeLabel() {
    if (!window.GlowLocale) return "";
    const now = window.GlowLocale.get();
    return now.region + " · " + now.lang;
  }

  function bindLocaleLinks(element) {
    element.querySelectorAll("[data-glow-locale]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        close();
        closeProfile();
        if (window.GlowLocale) window.GlowLocale.openPicker();
      });
    });
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
    mountVersionChip(button);
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


  // ---------------------------------------------------------------------------------------------
  // Your profile: an avatar button at the top right of every Glow app. It opens a small menu
  // with Profile & settings, persona, usage and data, all on the shared ../account/ page.
  // Usage: add an element with the attribute data-glow-profile, or call GlowApps.mountProfile(el).
  // ---------------------------------------------------------------------------------------------
  const profileButtons = new Set();
  let profileMenu = null;
  let profileOpener = null;

  function renderProfileButton(button) {
    const who = account();
    const letters = initials(who.name);
    button.style.setProperty("--glow-avatar", who.avatarColor);
    button.classList.toggle("guest", !who.signedIn && !who.displayName);
    button.classList.toggle("temp", who.temp);
    button.classList.toggle("expired", who.expired);
    button.innerHTML = (letters ? escapeHtml(letters) : "👤") + (who.signedIn ? '<i class="glow-avatar-dot" aria-hidden="true"></i>' : "");
    const label = (who.name ? `${who.name} · Profile & settings` : "Profile & settings") + (who.expired ? " (signed out of Puter)" : "");
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  function refreshProfiles() {
    profileButtons.forEach((button) => {
      if (button.isConnected) renderProfileButton(button);
      else profileButtons.delete(button);
    });
    if (profileMenu && !profileMenu.hidden && profileOpener) openProfile(profileOpener);
  }

  function buildProfileMenu() {
    const who = account();
    const status = who.signedIn
      ? (who.temp ? '<small class="warn">Temporary Puter account · save it on puter.com</small>' : `<small>Signed in with Puter${who.displayName && who.accountName ? " as " + escapeHtml(who.accountName) : ""}</small>`)
      : who.expired
        ? `<small class="warn">Signed out of Puter${who.accountName ? " (" + escapeHtml(who.accountName) + ")" : ""} · sign in again</small>`
        : `<small>${who.guest ? "Guest · not signed in" : "Not signed in"}</small>`;
    const letters = initials(who.name);
    const item = (icon, text, section, extra) => `<a class="glow-profile-item${extra || ""}" role="menuitem" href="${accountUrl(section)}"><span aria-hidden="true">${icon}</span>${text}</a>`;
    const element = document.createElement("div");
    element.className = "glow-profile-menu";
    element.id = "glow-profile-menu";
    element.setAttribute("role", "menu");
    element.hidden = true;
    element.innerHTML = `<div class="glow-profile-head"><span class="glow-avatar-btn${!who.signedIn && !who.displayName ? " guest" : ""}" style="--glow-avatar:${who.avatarColor}" aria-hidden="true">${letters ? escapeHtml(letters) : "👤"}</span>
      <span><b>${escapeHtml(who.name || "Your Glow profile")}</b>${status}</span></div>
      ${item("👤", "Profile &amp; settings", "")}
      ${item("🎭", "My persona", "persona")}
      ${item("📊", "Usage &amp; allowance", "usage")}
      ${item("⚙", "Settings", "prefs")}
      ${item("🔒", "My data &amp; privacy", "data")}
      ${window.GlowLocale ? `<a class="glow-profile-item" role="menuitem" href="#" data-glow-locale><span aria-hidden="true">🌐</span>${escapeHtml(tr("menu.language", "Language & region"))}<span style="margin-left:auto;opacity:.6">${escapeHtml(localeLabel())}</span></a>` : ""}
      ${who.signedIn ? "" : item("✦", who.expired ? "Sign in again" : "Sign in with Puter", "account", " primary")}
      <div class="glow-apps-version" id="glow-profile-version"></div>`;
    bindLocaleLinks(element);
    document.body.appendChild(element);
    renderVersionLine(element.querySelector("#glow-profile-version"));
    return element;
  }

  function closeProfile() {
    if (!profileMenu || profileMenu.hidden) return;
    profileMenu.hidden = true;
    if (profileOpener) profileOpener.setAttribute("aria-expanded", "false");
  }

  function openProfile(button) {
    ensureStyles();
    close();
    if (profileMenu) profileMenu.remove();
    profileMenu = buildProfileMenu();
    profileMenu.hidden = false;
    profileOpener = button;
    button.setAttribute("aria-expanded", "true");
    const rect = button.getBoundingClientRect();
    const width = profileMenu.offsetWidth || 300;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const below = rect.bottom + 8;
    const top = below + profileMenu.offsetHeight > window.innerHeight - 8 ? Math.max(8, rect.top - profileMenu.offsetHeight - 8) : below;
    profileMenu.style.left = `${left}px`;
    profileMenu.style.top = `${top}px`;
    const first = profileMenu.querySelector(".glow-profile-item");
    if (first) first.focus({ preventScroll: true });
  }

  function mountProfile(button) {
    if (!button || button.dataset.glowProfileMounted) return;
    ensureStyles();
    button.dataset.glowProfileMounted = "1";
    button.classList.add("glow-avatar-btn");
    if (button.tagName === "BUTTON" && !button.getAttribute("type")) button.type = "button";
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    profileButtons.add(button);
    renderProfileButton(button);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (profileMenu && !profileMenu.hidden && profileOpener === button) closeProfile();
      else openProfile(button);
    });
  }

  document.addEventListener("click", (event) => {
    if (profileMenu && !profileMenu.hidden && !profileMenu.contains(event.target)) closeProfile();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && profileMenu && !profileMenu.hidden) {
      event.stopPropagation();
      closeProfile();
      if (profileOpener) profileOpener.focus();
    }
  }, true);
  window.addEventListener("resize", closeProfile);
  // Another tab or Glow app changed the account: update every avatar on this page.
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === STORE_KEY) refreshProfiles();
  });


  // ---------------------------------------------------------------------------------------------
  // Versions and in-app updates. Every Glow app shows its version in the Glow apps menu. When
  // ../version.json (never cached) lists a newer version, an "Update now" bar appears; it clears
  // the Glow caches, refreshes this page's files and reloads, so the app updates in place.
  // The Android app ships its own files, so there "Update" downloads the new APK instead.
  // ---------------------------------------------------------------------------------------------
  let latest = null;
  let updateState = "unknown"; // unknown | checking | current | available | error
  let lastCheck = 0;
  let updateBar = null;

  function isNativeApp() {
    return !!(window.GLOW_NATIVE_APP || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()));
  }

  // ---------------------------------------------------------------------------------------------
  // Glow on iPhone and iPad: a free Home Screen app. Apple only lets native apps in through the paid
  // App Store, but a Home Screen web app opens full screen, works offline, keeps its own storage
  // (safe from Safari's 7-day clean-up) and can show notifications. This guides people to add it.
  // ---------------------------------------------------------------------------------------------
  const IOS_INSTALL_KEY = "glow.ios.install.dismissed";
  const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const inAppBrowser = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|TikTok|BytedanceWebview|Twitter|LinkedInApp|Snapchat|GSA\//.test(navigator.userAgent);

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  let installSheet = null;
  function showInstallGuide(options = {}) {
    if (!isAppleMobile || isStandalone() || isNativeApp() || embedded) return false;
    if (!options.force) {
      const dismissed = Number(localStorage.getItem(IOS_INSTALL_KEY) || 0);
      if (dismissed && Date.now() - dismissed < 21 * 24 * 3600 * 1000) return false;
    }
    ensureStyles();
    if (!installSheet) {
      installSheet = document.createElement("div");
      installSheet.className = "glow-install-sheet";
      installSheet.setAttribute("role", "dialog");
      document.body.appendChild(installSheet);
    }
    const onPad = !/iPhone|iPod/.test(navigator.userAgent);
    const title = onPad ? "Get the Glow app on your iPad: free" : "Get the Glow app on your iPhone: free";
    const share = `<span class="share" aria-hidden="true">⬆︎</span>`;
    const stepShare = `<li>${escapeHtml("Tap the Share button (on iOS 26 it is in the ••• menu).")} ${share}</li>`;
    const stepAdd = `<li>${escapeHtml("Choose Add to Home Screen.")}</li>`;
    const steps = inAppBrowser
      ? `<ol><li>${escapeHtml("This page is open inside another app. Tap ••• and choose Open in Safari (or Open in browser).")}</li>${stepShare}${stepAdd}</ol>`
      : `<ol>${stepShare}${stepAdd}<li>${escapeHtml("Keep Open as Web App on, then tap Add.")}</li></ol>`;
    installSheet.setAttribute("aria-label", title);
    installSheet.innerHTML = `<h2>✦ ${escapeHtml(title)}</h2>
      <p>${escapeHtml("It opens full screen like any app, works offline and keeps your chats safe from Safari's 7-day clean-up.")}</p>
      ${steps}
      <p><small>${escapeHtml("Chats you had in Safari don't move by themselves: sign in to sync them, or use Profile & settings → Your data.")}</small></p>
      <div class="row"><button class="later" type="button" data-install-later>${escapeHtml("Not now")}</button><button class="go" type="button" data-install-ok>${escapeHtml("Got it")}</button></div>`;
    installSheet.hidden = false;
    const close = () => {
      installSheet.hidden = true;
      localStorage.setItem(IOS_INSTALL_KEY, String(Date.now()));
    };
    installSheet.querySelector("[data-install-later]").addEventListener("click", close);
    installSheet.querySelector("[data-install-ok]").addEventListener("click", close);
    return true;
  }

  // Keep every Glow app ready for no internet: each app's service worker caches its own files, so
  // GlowChat, GlowRoom and GlowLead open offline even if you have only visited Glow home so far.
  // An installed app also asks the browser to keep its storage (chats, offline models) for good.
  function prepareOffline() {
    if (embedded || isNativeApp() || !("serviceWorker" in navigator) || !window.isSecureContext || !/^https?:$/.test(location.protocol)) return;
    const workers = [["sw.js", ""], ["chat/sw.js", "chat/"], ["room/sw.js", "room/"], ["lead/sw.js", "lead/"]];
    const register = () => {
      for (const [script, scope] of workers) {
        navigator.serviceWorker.register(new URL(script, ROOT).href, { scope: new URL(scope, ROOT).href }).catch(() => {});
      }
    };
    if (document.readyState === "complete") setTimeout(register, 4000);
    else window.addEventListener("load", () => setTimeout(register, 4000), { once: true });
    if (isStandalone() && navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then((kept) => kept || navigator.storage.persist()).catch(() => {});
    }
  }

  function versionUrl() {
    const local = /^https?:$/.test(location.protocol) && !isNativeApp();
    return (local ? new URL("version.json", ROOT).href : LIVE_ROOT + "version.json") + "?t=" + Date.now();
  }

  function compareVersions(a, b) {
    const left = String(a || "0").split(/[.-]/).map((part) => parseInt(part, 10) || 0);
    const right = String(b || "0").split(/[.-]/).map((part) => parseInt(part, 10) || 0);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const diff = (left[i] || 0) - (right[i] || 0);
      if (diff) return diff > 0 ? 1 : -1;
    }
    return 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Updates you can see and that install by themselves.
  // - A version button sits in the header of every Glow app: "✓ v1.27.3" when up to date (click to
  //   check), a bright "⬆ Update to …" when a new version is ready (click to update). It never pushes
  //   the header off screen: on narrower windows it shows just its icon (an update still says
  //   "⬆ Update"), and when even that doesn't fit it steps aside for the orange dot on the Glow apps button.
  // - "Install updates by itself" (on by default): a ready update installs when Glow opens or as soon
  //   as you switch away from it, never while a reply streams or unsaved text is typed. GlowChat keeps
  //   the open chat and the unsent message, so you come back to the same place.
  // - After an update: "✓ Glow updated to …" with What's new, once.
  // ---------------------------------------------------------------------------------------------
  const AUTO_KEY = "glow.update.auto";       // "off" = ask first
  const ATTEMPT_KEY = "glow.update.attempt"; // { version, at } of the last update started
  const FROM_KEY = "glow.update.from";       // the version that ran before an update
  const busyChecks = [];
  let snoozed = false;     // "Later" was chosen: no automatic update on this page
  let applying = false;
  let interacted = false;  // once you start using a page, updates wait until you switch away
  let toastBox = null;
  let toastTimer = null;

  function storedText(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch (error) {
      return "";
    }
  }
  function storeValue(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch (error) {
      // Storage full or blocked: the choice lasts for this page only.
    }
  }
  function autoUpdateEnabled() {
    return storedText(AUTO_KEY) !== "off";
  }
  function setAutoUpdate(on) {
    storeValue(AUTO_KEY, on ? "on" : "off");
    refreshVersionViews();
    if (on) maybeAutoUpdate();
  }
  // Apps say when an update must wait, e.g. GlowChat while a reply is streaming.
  function registerBusyCheck(check) {
    if (typeof check === "function") busyChecks.push(check);
  }
  // Text typed into a box that doesn't save itself would be lost by a reload.
  function unsavedTyping() {
    return [...document.querySelectorAll("textarea, input[type=text], input:not([type])")]
      .some((field) => !field.disabled && !field.dataset.glowDraft && field.value.trim() && field.offsetParent !== null);
  }
  function appBusy() {
    const busy = busyChecks.some((check) => {
      try {
        return !!check();
      } catch (error) {
        return true;
      }
    });
    return busy || unsavedTyping();
  }
  // Glow home and its settings pages may reload by themselves, and apps that report when they're busy.
  function autoUpdateAllowedHere() {
    return currentApp() === "home" || busyChecks.length > 0;
  }
  // The same update was started less than 10 minutes ago and the old files still run (a stubborn
  // cache): don't loop, keep the Update button instead.
  function triedRecently(version) {
    let attempt = null;
    try {
      attempt = JSON.parse(storedText(ATTEMPT_KEY) || "null");
    } catch (error) {
      attempt = null;
    }
    return !!attempt && attempt.version === version && Date.now() - Number(attempt.at || 0) < 10 * 60 * 1000;
  }
  function canAutoUpdate() {
    const quietMoment = document.visibilityState === "hidden" || !interacted;
    return updateState === "available" && !!latest && quietMoment && !embedded && !isNativeApp() && !snoozed && !applying
      && autoUpdateEnabled() && autoUpdateAllowedHere() && !triedRecently(latest.version) && !appBusy();
  }
  function maybeAutoUpdate() {
    if (!canAutoUpdate()) return false;
    applyUpdate({ auto: true });
    return true;
  }

  function toast(message, actionLabel, action) {
    if (embedded || !document.body) return;
    ensureStyles();
    if (!toastBox) {
      toastBox = document.createElement("div");
      toastBox.className = "glow-toast";
      toastBox.setAttribute("role", "status");
      document.body.appendChild(toastBox);
    }
    toastBox.innerHTML = `<span>${escapeHtml(message)}</span>${actionLabel ? `<button type="button" data-toast-action>${escapeHtml(actionLabel)}</button>` : ""}<button class="close" type="button" aria-label="Close">✕</button>`;
    toastBox.hidden = false;
    const hide = () => {
      toastBox.hidden = true;
      clearTimeout(toastTimer);
    };
    const actionButton = toastBox.querySelector("[data-toast-action]");
    if (actionButton) {
      actionButton.addEventListener("click", () => {
        hide();
        action();
      });
    }
    toastBox.querySelector(".close").addEventListener("click", hide);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hide, actionLabel ? 9000 : 4500);
  }

  async function showWhatsNew() {
    if (!latest && !applying) await checkForUpdate(true);
    ensureStyles();
    let sheet = document.getElementById("glow-whatsnew");
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.id = "glow-whatsnew";
      sheet.className = "glow-install-sheet";
      sheet.setAttribute("role", "dialog");
      document.body.appendChild(sheet);
    }
    const version = latest ? latest.version : GLOW_VERSION;
    const notes = (latest && Array.isArray(latest.notes) ? latest.notes : []).slice(0, 8);
    const canUpdate = updateState === "available" && !isNativeApp();
    sheet.setAttribute("aria-label", `What's new in Glow ${version}`);
    sheet.innerHTML = `<h2>✦ What's new in Glow ${escapeHtml(version)}</h2>`
      + (notes.length ? `<ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : "<p>Fixes and improvements.</p>")
      + `<p><small>You have Glow ${escapeHtml(GLOW_VERSION)}.</small></p>`
      + `<div class="row">${canUpdate ? '<button class="go" type="button" data-whatsnew-update>Update now</button>' : ""}`
      + '<button class="later" type="button" data-whatsnew-close>Close</button></div>';
    sheet.hidden = false;
    const updateButton = sheet.querySelector("[data-whatsnew-update]");
    if (updateButton) {
      updateButton.addEventListener("click", () => {
        sheet.hidden = true;
        applyUpdate();
      });
    }
    sheet.querySelector("[data-whatsnew-close]").addEventListener("click", () => {
      sheet.hidden = true;
    });
  }

  // The version button in the header of every Glow app.
  function chipView() {
    const version = escapeHtml(GLOW_VERSION);
    if (applying) return { cls: "busy", html: '<span class="icon">⟳</span><span class="label">Updating…</span>', title: "Updating Glow…" };
    if (updateState === "available" && latest) {
      return {
        cls: "ready",
        html: `<span class="icon">⬆</span><span class="label">Update<span class="more"> to ${escapeHtml(latest.version)}</span></span>`,
        title: `Glow ${latest.version} is ready (you have ${GLOW_VERSION}). Click to update: it takes a few seconds and you come back to the same place.`,
      };
    }
    if (updateState === "checking") return { cls: "busy", html: `<span class="icon">⟳</span><span class="label">v${version}</span>`, title: "Checking for updates…" };
    if (updateState === "current") return { cls: "ok", html: `<span class="icon">✓</span><span class="label">v${version}</span>`, title: `Glow ${GLOW_VERSION}: you have the latest version. Click to check again.` };
    const hint = updateState === "error" ? "Couldn't check for updates (offline?). Click to try again." : "Click to check for updates.";
    return { cls: "", html: `<span class="icon">✦</span><span class="label">v${version}</span>`, title: `Glow ${GLOW_VERSION}. ${hint}` };
  }
  function renderChip(chip) {
    const view = chipView();
    const fitted = ["glow-chip-compact", "glow-chip-hidden"].filter((name) => chip.classList.contains(name));
    chip.className = ["glow-version-chip", view.cls].concat(fitted).filter(Boolean).join(" ");
    chip.innerHTML = view.html;
    chip.title = view.title;
    chip.setAttribute("aria-label", view.title);
    fitVersionChip(chip);
  }

  // How tight the header is, in pixels. "hard": it sticks out past the window (or past a box it sits
  // in). "soft": the things next to the button get squeezed until they overlap (GlowRoom's status
  // pill), not counting text that is meant to end in "…" or strips that are meant to scroll.
  function chipCrowding(chip) {
    const root = document.documentElement;
    let hard = root.scrollWidth - root.clientWidth;
    for (let el = chip.parentElement; el && el !== document.body && el !== root; el = el.parentElement) {
      if (el.clientWidth) hard = Math.max(hard, el.scrollWidth - el.clientWidth);
    }
    let soft = 0;
    const row = chip.parentElement;
    for (const el of [chip, row]) {
      const box = el && el.parentElement;
      if (!box || box === document.body || box === root) continue;
      for (const neighbour of box.children) {
        if (neighbour === el || !neighbour.clientWidth) continue;
        const style = getComputedStyle(neighbour);
        if (style.textOverflow === "ellipsis" || /auto|scroll/.test(style.overflowX)) continue;
        soft = Math.max(soft, neighbour.scrollWidth - neighbour.clientWidth);
      }
    }
    return { hard: Math.max(0, hard), soft: Math.max(0, soft) };
  }
  // Narrow window, big or wide fonts, zoom, a long account name: if the button makes the header too
  // wide, show just its icon; if even that is too wide, hide it (the orange dot on the Glow apps button
  // and the version line in the menus still offer the update). When it only squeezes its neighbours,
  // a ready update stays as an orange icon. Never touches anything else.
  function fitVersionChip(chip) {
    if (!chip || !chip.isConnected) return;
    chip.classList.remove("glow-chip-compact", "glow-chip-hidden");
    const full = chipCrowding(chip);
    if (full.hard <= 1 && full.soft <= 4) return;
    chip.classList.add("glow-chip-hidden");
    const without = chipCrowding(chip);
    chip.classList.remove("glow-chip-hidden");
    const tighter = (now) => ({ hard: now.hard > without.hard + 1, soft: now.soft > without.soft + 4 });
    const fullTighter = tighter(full);
    if (!fullTighter.hard && !fullTighter.soft) return; // something else is too wide; the button isn't the cause
    chip.classList.add("glow-chip-compact");
    const compactTighter = tighter(chipCrowding(chip));
    if (!compactTighter.hard && (!compactTighter.soft || chip.classList.contains("ready"))) return;
    chip.classList.remove("glow-chip-compact");
    chip.classList.add("glow-chip-hidden");
  }
  function fitVersionChips() {
    document.querySelectorAll("[data-glow-version-chip]").forEach((chip) => {
      followAppsButton(chip);
      fitVersionChip(chip);
    });
  }
  // Some apps rebuild their header after Glow is ready (GlowRoom moves the Glow apps button into its
  // menu bar): the version button goes with it instead of staying behind in a hidden header.
  const chipButtons = new WeakMap();
  function followAppsButton(chip) {
    const button = chipButtons.get(chip);
    if (!button || !button.isConnected || button.previousElementSibling === chip) return;
    button.insertAdjacentElement("beforebegin", chip);
    watchChipRoom(chip);
  }
  let chipFitQueued = false;
  function queueChipFit() {
    if (chipFitQueued) return;
    chipFitQueued = true;
    const run = () => {
      chipFitQueued = false;
      fitVersionChips();
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    else setTimeout(run, 16);
  }
  let chipResizeBound = false;
  let chipObserver = null;
  function watchChipRoom(chip) {
    if (!chipResizeBound) {
      chipResizeBound = true;
      window.addEventListener("resize", fitVersionChips);
      window.addEventListener("load", queueChipFit);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueChipFit).catch(() => {});
    }
    // The header can also grow without the window changing (signing in shows a name, a button appears).
    const row = chip.parentElement;
    if (!row || !("ResizeObserver" in window)) return;
    chipObserver = chipObserver || new ResizeObserver(queueChipFit);
    chipObserver.observe(row);
    Array.from(row.children).forEach((child) => {
      if (child !== chip) chipObserver.observe(child);
    });
    if (row.parentElement && row.parentElement !== document.body) chipObserver.observe(row.parentElement);
  }
  function mountVersionChip(button) {
    if (embedded || !button || button.dataset.glowChip) return;
    button.dataset.glowChip = "1";
    const chip = document.createElement("button");
    chip.type = "button";
    chip.dataset.glowVersionChip = "";
    chip.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (applying) return;
      if (updateState === "available") {
        applyUpdate();
        return;
      }
      const state = await checkForUpdate(true);
      if (state === "current") toast(`✓ You have the latest Glow (${GLOW_VERSION})`, "What's new", showWhatsNew);
      else if (state === "error") toast("Couldn't check for updates right now. Are you online?");
    });
    // A page can choose the spot (GlowChat: its top bar); otherwise it sits just left of the Glow apps button.
    const slot = document.querySelector("[data-glow-version-slot]");
    if (slot) {
      slot.replaceWith(chip);
    } else {
      button.insertAdjacentElement("beforebegin", chip);
      chipButtons.set(chip, button);
    }
    renderChip(chip);
    watchChipRoom(chip);
    queueChipFit();
  }

  function renderVersionLine(box) {
    if (!box) return;
    let html;
    if (updateState === "available" && latest) {
      html = `<span>Version <b>${escapeHtml(GLOW_VERSION)}</b> · <b>${escapeHtml(latest.version)}</b> is ready</span><button class="go" type="button" data-glow-update>${isNativeApp() ? "Download update" : "Update now"}</button>`;
    } else if (applying) {
      html = `<span>Version <b>${escapeHtml(GLOW_VERSION)}</b> · updating…</span>`;
    } else if (updateState === "checking") {
      html = `<span>Version <b>${escapeHtml(GLOW_VERSION)}</b> · checking…</span>`;
    } else if (updateState === "current") {
      html = `<span>Version <b>${escapeHtml(GLOW_VERSION)}</b> · <span class="ok">✓ up to date</span></span><button type="button" data-glow-check>Check again</button>`;
    } else {
      html = `<span>Version <b>${escapeHtml(GLOW_VERSION)}</b></span><button type="button" data-glow-check>Check for updates</button>`;
    }
    const autoLink = isNativeApp() ? "" : ` · <a href="#" data-glow-autoupdate>Install updates by itself: <b>${autoUpdateEnabled() ? "On" : "Off"}</b></a>`;
    box.innerHTML = `${html}<span class="glow-apps-version-links"><a href="#" data-glow-whatsnew>What's new</a>${autoLink}</span>`;
    const updateButton = box.querySelector("[data-glow-update]");
    if (updateButton) updateButton.addEventListener("click", (event) => { event.stopPropagation(); applyUpdate(); });
    const checkButton = box.querySelector("[data-glow-check]");
    if (checkButton) checkButton.addEventListener("click", (event) => { event.stopPropagation(); checkForUpdate(true); });
    box.querySelector("[data-glow-whatsnew]").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      close();
      closeProfile();
      showWhatsNew();
    });
    const autoToggle = box.querySelector("[data-glow-autoupdate]");
    if (autoToggle) {
      autoToggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setAutoUpdate(!autoUpdateEnabled());
      });
    }
  }

  function refreshVersionViews() {
    renderVersionLine(document.getElementById("glow-apps-version"));
    renderVersionLine(document.getElementById("glow-profile-version"));
    document.querySelectorAll("[data-glow-version-chip]").forEach(renderChip);
    // On phones the header has no room for the button: an orange dot on the Glow apps button says the same.
    document.querySelectorAll(".glow-apps-btn").forEach((button) => button.classList.toggle("glow-update-ready", updateState === "available"));
    document.querySelectorAll("[data-glow-version]").forEach((el) => {
      const ready = updateState === "available" && latest;
      el.textContent = "Glow " + GLOW_VERSION + (ready ? " · ⬆ update ready" : "");
      el.title = ready ? "Glow " + latest.version + " is ready. Click to update." : "Glow version";
      el.style.cursor = ready ? "pointer" : "";
      if (!el.dataset.glowUpdateBound) {
        el.dataset.glowUpdateBound = "1";
        el.addEventListener("click", () => {
          if (updateState === "available") applyUpdate();
        });
      }
    });
  }

  function showUpdateBar() {
    if (embedded || !latest || snoozed) return;
    ensureStyles();
    if (!updateBar) {
      updateBar = document.createElement("div");
      updateBar.className = "glow-update-bar";
      updateBar.setAttribute("role", "status");
      document.body.appendChild(updateBar);
    }
    const note = Array.isArray(latest.notes) && latest.notes.length ? latest.notes[0] : "Fixes and improvements";
    updateBar.innerHTML = `<span>✦ <b>Glow ${escapeHtml(latest.version)} is ready</b><small>${escapeHtml(note)}</small></span>
      <button class="go" type="button">${isNativeApp() ? "Download update" : "Update now"}</button>
      <button class="whats" type="button">What's new</button>
      <button class="later" type="button" aria-label="Later">Later</button>`;
    updateBar.hidden = false;
    updateBar.querySelector(".go").addEventListener("click", () => applyUpdate());
    updateBar.querySelector(".whats").addEventListener("click", showWhatsNew);
    updateBar.querySelector(".later").addEventListener("click", () => {
      // Later: no automatic update on this page; the orange Update button stays in the header.
      snoozed = true;
      updateBar.hidden = true;
    });
  }

  async function checkForUpdate(force) {
    if (applying) return updateState;
    if (!force && Date.now() - lastCheck < 10 * 60 * 1000) return updateState;
    lastCheck = Date.now();
    updateState = "checking";
    refreshVersionViews();
    try {
      const response = await fetch(versionUrl(), { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      latest = await response.json();
      updateState = compareVersions(latest.version, GLOW_VERSION) > 0 ? "available" : "current";
    } catch (error) {
      updateState = "error";
    }
    refreshVersionViews();
    if (updateState === "available") {
      if (!maybeAutoUpdate()) showUpdateBar();
    } else if (updateBar) {
      updateBar.hidden = true;
    }
    window.dispatchEvent(new CustomEvent("glow-update", { detail: { state: updateState, current: GLOW_VERSION, latest } }));
    return updateState;
  }

  async function applyUpdate(options = {}) {
    if (isNativeApp()) {
      location.href = (latest && latest.android) || APK_URL;
      return;
    }
    if (applying) return;
    applying = true;
    storeValue(FROM_KEY, GLOW_VERSION);
    if (latest) storeValue(ATTEMPT_KEY, { version: latest.version, at: Date.now() });
    refreshVersionViews();
    if (!options.auto || document.visibilityState === "visible") {
      ensureStyles();
      if (!updateBar) {
        updateBar = document.createElement("div");
        updateBar.className = "glow-update-bar";
        updateBar.setAttribute("role", "status");
        document.body.appendChild(updateBar);
      }
      updateBar.hidden = false;
      updateBar.innerHTML = "<span>✦ <b>Updating Glow…</b><small>You'll be back in the same place in a few seconds.</small></span>";
    }
    try {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => /^(glow|crewroom)/.test(name)).map((name) => caches.delete(name)));
    } catch (error) {
      // No Cache Storage (private window): the reload below still fetches fresh files.
    }
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update().catch(() => {})));
    } catch (error) {
      // No service worker: nothing to refresh.
    }
    const files = [location.href.split("#")[0]];
    document.querySelectorAll("script[src], link[rel='stylesheet'][href], link[rel='manifest'][href]").forEach((el) => files.push(el.src || el.href));
    await Promise.all(files.filter((url) => url.startsWith(location.origin)).map((url) => fetch(url, { cache: "reload" }).catch(() => {})));
    location.reload();
  }

  // After an update: say so once, with What's new.
  function announceUpdate() {
    const from = storedText(FROM_KEY);
    if (!from || embedded) return;
    if (compareVersions(GLOW_VERSION, from) > 0) {
      storeValue(FROM_KEY, null);
      storeValue(ATTEMPT_KEY, null);
      setTimeout(() => toast(`✓ Glow updated to ${GLOW_VERSION}`, "What's new", showWhatsNew), 900);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // ↩ Reopen where you left off. Every Glow app page notes itself as "the last place"; when Glow home
  // is opened fresh (the app icon, a shortcut, a new window), shared/glow-resume.js goes straight back
  // there. GlowChat then reopens the chat that was open, with the message you hadn't sent.
  // ---------------------------------------------------------------------------------------------
  const PLACE_KEY = "glow.lastPlace";
  const RESUME_KEY = "glow.resume";
  const RESUME_HINTS_KEY = "glow.resume.hints";

  function resumeEnabled() {
    return storedText(RESUME_KEY) !== "off";
  }
  function setResumeEnabled(on) {
    storeValue(RESUME_KEY, on ? "on" : "off");
  }
  function recordPlace() {
    if (embedded) return;
    try {
      sessionStorage.setItem("glow.session", "1");
    } catch (error) {
      // No session storage: Glow home simply opens as usual.
    }
    if (!location.pathname.startsWith(ROOT.pathname)) return;
    const app = currentApp();
    const rest = location.pathname.slice(ROOT.pathname.length);
    // Profile & settings, downloads and setup aren't places to reopen; their app is.
    if (app === "home" && rest !== "" && rest !== "index.html") return;
    storeValue(PLACE_KEY, { app, path: location.pathname, at: Date.now() });
  }
  function showResumeHint() {
    let resumed = "";
    try {
      resumed = sessionStorage.getItem("glow.resumed") || "";
      sessionStorage.removeItem("glow.resumed");
    } catch (error) {
      resumed = "";
    }
    if (!resumed || embedded) return;
    const shown = Number(storedText(RESUME_HINTS_KEY) || 0);
    if (shown >= 3) return;
    storeValue(RESUME_HINTS_KEY, String(shown + 1));
    const app = APPS.find((a) => a.id === resumed);
    setTimeout(() => toast(`↩ Reopened ${app ? app.name : "Glow"} where you left off`, "Glow home", () => location.assign(appUrl("home"))), 700);
  }

  // ---------------------------------------------------------------------------------------------
  // Everything stays in the app: GlowRoom opens in a panel inside the current Glow app, and links
  // to the other Glow apps open in this window instead of a new browser tab or window.
  // ---------------------------------------------------------------------------------------------
  let roomPanel = null;

  function appOf(url) {
    if (url.origin !== location.origin || !url.pathname.startsWith(ROOT.pathname)) return null;
    const rest = url.pathname.slice(ROOT.pathname.length);
    if (/^room\//.test(rest)) return "room";
    if (/^chat\//.test(rest)) return "chat";
    if (/^lead\//.test(rest)) return "lead";
    if (/^setup\//.test(rest)) return "setup";
    if (/^account\//.test(rest)) return "account";
    if (rest === "" || rest === "index.html") return "home";
    return null;
  }

  function parentApps() {
    if (!embedded) return null;
    try {
      return window.parent.GlowApps || null;
    } catch (error) {
      return null;
    }
  }

  function closeRoomPanel() {
    if (!roomPanel || roomPanel.hidden) return;
    roomPanel.hidden = true;
    document.documentElement.classList.remove("glow-room-open");
  }

  function openRoomPanel(url) {
    ensureStyles();
    if (onMobilePage && /\/room\/(index\.html)?$/.test(url.pathname)) url.pathname = url.pathname.replace(/(index\.html)?$/, "mobile.html");
    if (!roomPanel) {
      roomPanel = document.createElement("div");
      roomPanel.className = "glow-room-panel";
      roomPanel.setAttribute("role", "dialog");
      roomPanel.setAttribute("aria-label", "GlowRoom");
      roomPanel.innerHTML = `<div class="glow-room-bar"><span aria-hidden="true">🏢</span><b>GlowRoom</b><small>your AI crew keeps working while this is closed</small><span class="grow"></span>
        <button class="full" type="button" title="Open GlowRoom on its own">⤢<span> Full screen</span></button>
        <button class="close" type="button">✕ Close</button></div><iframe title="GlowRoom" allow="clipboard-write; fullscreen"></iframe>`;
      document.body.appendChild(roomPanel);
      roomPanel.querySelector(".close").addEventListener("click", closeRoomPanel);
      roomPanel.querySelector(".full").addEventListener("click", () => {
        location.assign(roomPanel.querySelector("iframe").dataset.base || appUrl("room"));
      });
    }
    const frame = roomPanel.querySelector("iframe");
    const base = url.origin + url.pathname;
    const goal = url.searchParams.get("goal");
    if (frame.dataset.base !== base) {
      frame.dataset.base = base;
      frame.src = url.href;
    } else if (goal) {
      frame.contentWindow.postMessage({ type: "glow-room-goal", goal, go: url.searchParams.get("go") === "1" }, location.origin);
    }
    roomPanel.hidden = false;
    document.documentElement.classList.add("glow-room-open");
    close();
    roomPanel.querySelector(".close").focus({ preventScroll: true });
  }

  function openApp(target) {
    const url = new URL(target, location.href);
    const app = appOf(url);
    if (!app) return false;
    const parent = parentApps();
    if (parent && parent.openApp) return parent.openApp(url.href);
    if (app === "room" && currentApp() !== "room") {
      openRoomPanel(url);
      return true;
    }
    closeRoomPanel();
    const samePage = url.pathname === location.pathname && url.search === location.search;
    location.assign(url.href);
    if (samePage) location.reload();
    return true;
  }

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link || link.hasAttribute("download") || link.dataset.glowExternal) return;
    let url;
    try {
      url = new URL(link.href, location.href);
    } catch (error) {
      return;
    }
    const app = appOf(url);
    if (!app) return;
    const target = (link.getAttribute("target") || "").toLowerCase();
    const newWindow = target && target !== "_self";
    const roomInPanel = app === "room" && currentApp() !== "room" && currentApp() !== "home";
    if (newWindow || roomInPanel || (embedded && app !== "room")) {
      event.preventDefault();
      openApp(url.href);
    }
  });

  const nativeOpen = window.open ? window.open.bind(window) : null;
  window.open = function (url, name, features) {
    try {
      if (url && appOf(new URL(url, location.href)) && openApp(url)) return null;
    } catch (error) {
      // Not a Glow app URL: open it normally below.
    }
    return nativeOpen ? nativeOpen(url, name, features) : null;
  };

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && roomPanel && !roomPanel.hidden) closeRoomPanel();
    else if (event.key === "Escape" && widgetPanel && !widgetPanel.hidden) closeWidget();
  });
  if (embedded) document.documentElement.classList.add("glow-embedded");

  /* ===== ♥ Support Glow (donation links) ===== */
  function donateHtml() {
    const links = DONATE_LINKS.filter((link) => link && /^https:\/\//.test(link.url || ""));
    if (!links.length) return "";
    const buttons = links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" data-glow-external="1">${escapeHtml(link.icon || "♥")} ${escapeHtml(link.label || "Donate")}</a>`).join("");
    return `<div class="glow-donate-wrap"><div style="margin-top:8px;opacity:.8">♥ Glow is free. Support it:</div><div class="glow-donate">${buttons}</div></div>`;
  }

  /* ===== 👑 GlowLead agent bubble: a floating GlowLead you can open from any Glow page ===== */
  const WIDGET_KEY = "glow.widget";
  let widgetBubble = null;
  let widgetPanel = null;

  function widgetEnabled() {
    try {
      return localStorage.getItem(WIDGET_KEY) !== "off";
    } catch (error) {
      return true;
    }
  }

  function setWidgetEnabled(on) {
    try {
      localStorage.setItem(WIDGET_KEY, on ? "on" : "off");
    } catch (error) {
      // Private mode: the choice lasts for this page only.
    }
    if (on) mountWidget();
    else unmountWidget();
  }

  function widgetPosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(WIDGET_KEY + ".pos") || "null");
      if (saved && Number.isFinite(saved.right) && Number.isFinite(saved.bottom)) return saved;
    } catch (error) {
      // Ignore a damaged saved position.
    }
    return null;
  }

  function applyWidgetPosition() {
    const pos = widgetPosition();
    if (!pos || !widgetBubble) return;
    const right = Math.min(Math.max(4, pos.right), window.innerWidth - 60);
    const bottom = Math.min(Math.max(4, pos.bottom), window.innerHeight - 60);
    widgetBubble.style.right = `${right}px`;
    widgetBubble.style.bottom = `${bottom}px`;
  }

  function openWidget(goal) {
    if (!widgetPanel) {
      widgetPanel = document.createElement("div");
      widgetPanel.className = "glow-widget-panel";
      widgetPanel.setAttribute("role", "dialog");
      widgetPanel.setAttribute("aria-label", "GlowLead agent");
      widgetPanel.innerHTML = `<div class="glow-widget-bar"><span aria-hidden="true">👑</span><span>GlowLead</span><span class="grow"></span>
        <button type="button" data-widget-full title="Open GlowLead full screen">⤢</button>
        <button type="button" data-widget-close>✕</button></div><iframe title="GlowLead" allow="clipboard-write; microphone"></iframe>`;
      document.body.appendChild(widgetPanel);
      widgetPanel.querySelector("[data-widget-close]").addEventListener("click", closeWidget);
      widgetPanel.querySelector("[data-widget-full]").addEventListener("click", () => {
        closeWidget();
        location.assign(appUrl("lead"));
      });
    }
    const frame = widgetPanel.querySelector("iframe");
    const url = new URL(appUrl("lead"));
    url.searchParams.set("widget", "1");
    if (goal) url.searchParams.set("goal", goal);
    if (!frame.src || goal) frame.src = url.href;
    widgetPanel.hidden = false;
    if (widgetBubble) widgetBubble.setAttribute("aria-expanded", "true");
  }

  function closeWidget() {
    if (widgetPanel) widgetPanel.hidden = true;
    if (widgetBubble) widgetBubble.setAttribute("aria-expanded", "false");
  }

  function toggleWidget() {
    if (widgetPanel && !widgetPanel.hidden) closeWidget();
    else openWidget();
  }

  function mountWidget() {
    // The bubble lives on every Glow page except GlowLead itself and pages shown inside another Glow app.
    if (embedded || currentApp() === "lead" || !widgetEnabled() || widgetBubble || !document.body) return;
    ensureStyles();
    widgetBubble = document.createElement("button");
    widgetBubble.type = "button";
    widgetBubble.className = "glow-widget-bubble";
    widgetBubble.title = "GlowLead: your AI agent (drag to move)";
    widgetBubble.setAttribute("aria-label", "Open GlowLead agent");
    widgetBubble.setAttribute("aria-expanded", "false");
    widgetBubble.innerHTML = '👑<span class="dot" aria-hidden="true"></span>';
    document.body.appendChild(widgetBubble);
    applyWidgetPosition();
    let drag = null;
    widgetBubble.addEventListener("pointerdown", (event) => {
      const rect = widgetBubble.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom, moved: false };
      widgetBubble.setPointerCapture(event.pointerId);
    });
    widgetBubble.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      widgetBubble.style.right = `${Math.min(Math.max(4, drag.right - dx), window.innerWidth - 60)}px`;
      widgetBubble.style.bottom = `${Math.min(Math.max(4, drag.bottom - dy), window.innerHeight - 60)}px`;
    });
    widgetBubble.addEventListener("pointerup", () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (moved) {
        try {
          localStorage.setItem(WIDGET_KEY + ".pos", JSON.stringify({ right: parseFloat(widgetBubble.style.right), bottom: parseFloat(widgetBubble.style.bottom) }));
        } catch (error) {
          // Position simply isn't remembered.
        }
        return;
      }
      toggleWidget();
    });
    window.addEventListener("resize", applyWidgetPosition);
  }

  function unmountWidget() {
    closeWidget();
    if (widgetBubble) widgetBubble.remove();
    if (widgetPanel) widgetPanel.remove();
    widgetBubble = null;
    widgetPanel = null;
  }

  document.addEventListener("click", (event) => {
    const toggle = event.target && event.target.closest ? event.target.closest("[data-glow-widget-toggle]") : null;
    if (!toggle) return;
    event.preventDefault();
    setWidgetEnabled(!widgetEnabled());
    const state = toggle.querySelector("span");
    if (state) state.textContent = widgetEnabled() ? "On" : "Off";
  });
  document.addEventListener("click", (event) => {
    const toggle = event.target && event.target.closest ? event.target.closest("[data-glow-resume-toggle]") : null;
    if (!toggle) return;
    event.preventDefault();
    setResumeEnabled(!resumeEnabled());
    const state = toggle.querySelector("span");
    if (state) state.textContent = resumeEnabled() ? "On" : "Off";
  });
  // GlowLead inside the bubble reports when a mission is running, so the bubble shows a green dot.
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || !event.data || event.data.type !== "glow-lead-busy" || !widgetBubble) return;
    widgetBubble.classList.toggle("busy", !!event.data.busy);
  });

  /* ===== Quiet Puter: hide Puter's own "Low Balance" / usage-limit pop-up =====
     Glow handles a used-up allowance itself (it answers with a backup model), so Puter's upgrade
     dialog only interrupts. The dialog is added to <body> and opened in the same task; removing it
     in the MutationObserver callback (a microtask) happens before the page is drawn. */
  function hidePuterUsageDialogs(root) {
    const found = root.matches && root.matches("usage-limit-dialog") ? [root] : [...(root.querySelectorAll ? root.querySelectorAll("usage-limit-dialog") : [])];
    for (const dialog of found) {
      try {
        if (typeof dialog.close === "function") dialog.close();
      } catch (error) {
        // Already closed.
      }
      dialog.remove();
    }
  }
  function quietPuterDialogs() {
    if (!document.body || typeof MutationObserver === "undefined") return;
    hidePuterUsageDialogs(document.body);
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) hidePuterUsageDialogs(node);
        }
      }
    }).observe(document.body, { childList: true });
  }

  function startUpdateChecks() {
    refreshVersionViews();
    if (embedded) return;
    announceUpdate();
    // Once you start using the page, a ready update waits until you switch away (or click Update).
    const markUsed = () => {
      interacted = true;
    };
    window.addEventListener("pointerdown", markUsed, { capture: true, once: true });
    window.addEventListener("keydown", markUsed, { capture: true, once: true });
    setTimeout(() => checkForUpdate(true), 2500);
    setInterval(() => checkForUpdate(false), 30 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate(false);
      else maybeAutoUpdate();
    });
  }

  function autoMount() {
    recordPlace();
    document.querySelectorAll("[data-glow-apps]").forEach(mount);
    document.querySelectorAll("[data-glow-profile]").forEach(mountProfile);
    startUpdateChecks();
    prepareOffline();
    mountWidget();
    quietPuterDialogs();
    showResumeHint();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount);
  else autoMount();

  window.GlowApps = {
    mount, open, close, appUrl, currentApp, account, accountUrl, mountProfile, refreshProfiles, avatarColors: AVATAR_COLORS.slice(),
    apps: APPS.map((a) => ({ ...a })),
    version: GLOW_VERSION, checkForUpdate, applyUpdate, compareVersions, openApp, openRoomPanel, closeRoomPanel,
    registerBusyCheck, autoUpdateEnabled, setAutoUpdate, showWhatsNew, resumeEnabled, setResumeEnabled,
    showInstallGuide, isStandalone, isAppleMobile,
    openWidget, closeWidget, setWidgetEnabled, widgetEnabled, donateLinks: DONATE_LINKS.slice(),
    get updateState() { return updateState; },
    get latest() { return latest; },
  };
})();
