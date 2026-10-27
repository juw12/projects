// GlowRoom in the Glow family look: one clean header instead of two stacked bars.
// Runs after enhance.js and cinema.js have added their buttons, then MOVES (never copies) the
// existing controls into the top bar, so every click handler and live counter keeps working.
(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);

  function whenReady(check, done, timeout = 8000) {
    const started = Date.now();
    (function tick() {
      if (check()) return done();
      if (Date.now() - started > timeout) return done();
      setTimeout(tick, 120);
    })();
  }

  function buildMoreMenu(items) {
    const wrap = document.createElement("div");
    wrap.className = "gr-more";
    wrap.innerHTML = '<button class="gr-btn gr-icon-btn" type="button" id="gr-more-btn" aria-haspopup="menu" aria-expanded="false" title="More">⋯</button><div class="gr-more-menu" id="gr-more-menu" role="menu" hidden></div>';
    const menu = $(".gr-more-menu", wrap);
    items.forEach((item) => {
      if (!item) return;
      item.classList.add("gr-more-item");
      item.setAttribute("role", "menuitem");
      menu.appendChild(item);
    });
    const button = $("#gr-more-btn", wrap);
    const setOpen = (open) => {
      menu.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    };
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(menu.hidden);
    });
    menu.addEventListener("click", () => setOpen(false));
    document.addEventListener("click", (event) => {
      if (!wrap.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });
    return wrap;
  }

  function link(text, href, title) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    if (title) a.title = title;
    return a;
  }

  function oneBar() {
    const menubar = $(".menubar");
    const header = $(".header");
    if (!menubar || !header || document.body.classList.contains("gr-one-bar")) return;
    const left = $(".menubar-left", menubar);
    const right = $(".menubar-right", menubar);
    const headerRight = $(".header-right", header);

    // Left: brand + a compact live status pill (LIVE dot, crew busy, load bar, results, events/min).
    const pill = document.createElement("div");
    pill.className = "gr-status";
    pill.title = "Crew status";
    const status = $(".status-indicator", header);
    const kpis = $(".cr-kpis", header);
    if (status) pill.appendChild(status);
    if (kpis) pill.appendChild(kpis);
    left.appendChild(pill);

    // Right: the main actions first, then the existing View / Theme / Language / Panels menus.
    const actions = document.createElement("div");
    actions.className = "gr-actions";
    const search = headerRight && [...headerRight.querySelectorAll(".cr-kbd-btn")].find((b) => /Search/.test(b.textContent));
    if (search) {
      const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
      search.innerHTML = `<span class="gr-ico" aria-hidden="true">⌕</span><span class="gr-txt">Search</span><kbd>${mod}</kbd><kbd>K</kbd>`;
      search.title = "Search and commands";
    }
    const results = $(".cr-results-btn", header);
    const ai = $("#cr-ai-btn");
    const play = $("#play-pause");
    [results, search, ai, play].forEach((el) => {
      if (el) actions.appendChild(el);
    });
    right.insertBefore(actions, right.firstChild);

    // Rarely used controls go into a tidy "⋯" menu.
    const owner = $("#cn-owner");
    if (owner) owner.textContent = "👑 GlowLead owns this crew";
    const focus = $("#cn-cinema-btn");
    if (focus) {
      focus.textContent = "⛶ Focus mode (hide side panels)";
      focus.title = "Hide or show the side panels";
    }
    const recorded = $("#recorded-toggle");
    if (recorded) recorded.textContent = "⏺ Recorded / live feed";
    const profileLink = link("👤 Profile & settings", "../account/", "Your Glow profile and settings");
    const mobileLink = link("📱 Phone view", "mobile.html", "Open the phone layout");
    right.appendChild(buildMoreMenu([focus, owner, recorded, mobileLink, profileLink]));

    // Glow apps switcher and your avatar sit at the far right, like every Glow app.
    const apps = $("#glow-apps-btn");
    if (apps) {
      // Already wired by enhance.js; only swap the label for the shared 3x3 apps icon.
      apps.innerHTML = '<span class="glow-apps-grid" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>';
      apps.setAttribute("aria-label", "Glow apps");
      apps.classList.add("gr-icon-btn");
      right.appendChild(apps);
      if (window.GlowApps && !apps.dataset.glowAppsMounted) window.GlowApps.mount(apps);
    }
    const avatar = document.createElement("button");
    avatar.id = "gr-profile-btn";
    avatar.type = "button";
    right.appendChild(avatar);
    if (window.GlowApps && window.GlowApps.mountProfile) window.GlowApps.mountProfile(avatar);

    document.body.classList.add("gr-one-bar");
    setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
  }

  whenReady(() => $("#cr-ai-btn") && $("#cn-owner") && $(".cr-kpis"), oneBar);
  window.GlowRoomUI = { oneBar };
})();
