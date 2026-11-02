/*
  Industrial Connect: single-page app logic.
  Pages: home, products, product detail, compare, capabilities, investors,
         suppliers, RFQ (quote basket), contact, admin (leads + content editor).
*/
(function () {
  "use strict";

  const STORAGE = {
    audience: "ic_audience",
    basket: "ic_basket",
    leads: "ic_leads",
    views: "ic_views",
    dataOverride: "ic_data_override",
    adminOk: "ic_admin_ok"
  };

  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  const compareBar = document.getElementById("compareBar");

  let D = loadData();
  let activeViewer = null;
  const compareIds = new Set(JSON.parse(sessionStorage.getItem("ic_compare") || "[]"));
  const productFilter = { q: "", category: "All" };
  let adminTab = "leads";
  // Set by the bridge server (/c/<slug>/data.js). Absent when opened as a standalone file.
  const CONFIG = window.IC_CONFIG || null;

  // ---------------------------------------------------------------- utilities

  function loadData() {
    const override = localStorage.getItem(STORAGE.dataOverride);
    if (override) {
      try {
        return JSON.parse(override);
      } catch (error) {
        console.warn("Ignoring invalid content override", error);
      }
    }
    return window.COMPANY_DATA;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2600);
  }

  function productById(id) {
    return D.products.find(function (p) {
      return p.id === id;
    });
  }

  function getAudience() {
    return localStorage.getItem(STORAGE.audience) || "customer";
  }

  function trackView(key) {
    if (CONFIG && CONFIG.track) {
      fetch(CONFIG.track, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: CONFIG.slug, page: key.replace(/[^a-z0-9:-]/gi, "") || "home" }),
        keepalive: true
      }).catch(function () {});
      return;
    }
    const views = readJson(STORAGE.views, {});
    views[key] = (views[key] || 0) + 1;
    writeJson(STORAGE.views, views);
  }

  // ---------------------------------------------------------------- icons

  function gearPath(cx, cy, teeth, rRoot, rTip) {
    const step = (Math.PI * 2) / teeth;
    let d = "";
    for (let i = 0; i < teeth; i++) {
      const a = i * step;
      const pts = [
        [rRoot, a],
        [rTip, a + step * 0.28],
        [rTip, a + step * 0.52],
        [rRoot, a + step * 0.8],
        [rRoot, a + step]
      ];
      pts.forEach(function (p, index) {
        const x = (cx + p[0] * Math.cos(p[1])).toFixed(2);
        const y = (cy + p[0] * Math.sin(p[1])).toFixed(2);
        d += (i === 0 && index === 0 ? "M" : "L") + x + " " + y + " ";
      });
    }
    return d + "Z";
  }

  function boltCircle(cx, cy, radius, count, holeRadius, fill) {
    let out = "";
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.PI / count;
      out += '<circle cx="' + (cx + radius * Math.cos(a)).toFixed(1) + '" cy="' +
        (cy + radius * Math.sin(a)).toFixed(1) + '" r="' + holeRadius + '" fill="' + fill + '"/>';
    }
    return out;
  }

  // ---------------------------------------------------------------- line icons

  const ICONS = {
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    rotate: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    frame: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    camera: '<path d="M4 7h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    message: '<path d="M4 5h16v11H9l-5 4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    chat: '<path d="M20.5 11.6a8.4 8.4 0 0 1-12.4 7.4L3.5 20.5l1.5-4.4a8.4 8.4 0 1 1 15.5-4.5z"/><path d="M9 9.5c.3 2 2.1 4 4.4 4.6l1.2-1.2 1.9.8"/>'
  };

  function icon(name) {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
  }

  // 3D thumbnails rendered once per product by the viewer (falls back to the line drawing offline)
  const thumbCache = {};

  function hydrateThumbnails(root) {
    if (!window.IC_Viewer || !window.IC_Viewer.thumbnail) {
      return;
    }
    (root || document).querySelectorAll("[data-thumb]").forEach(function (el) {
      const product = productById(el.dataset.thumb);
      if (!product) {
        return;
      }
      const key = product.id + "|" + product.model + "|" + product.color;
      const apply = function (url) {
        if (!url || !el.isConnected || el.querySelector("img.pc-render")) {
          return;
        }
        const drawing = el.querySelector("svg");
        if (drawing) {
          drawing.remove();
        }
        const img = document.createElement("img");
        img.className = "pc-render";
        img.alt = "";
        img.src = url;
        el.insertBefore(img, el.firstChild);
      };
      if (thumbCache[key]) {
        apply(thumbCache[key]);
        return;
      }
      window.IC_Viewer.thumbnail(product).then(function (url) {
        thumbCache[key] = url;
        apply(url);
      }).catch(function () {});
    });
  }

  function productIcon(product) {
    // neutral technical line drawing (placeholder until the 3D render is ready)
    const c = "#eef2f6";
    const hole = "#ffffff";
    const defs = '<defs><linearGradient id="g-' + esc(product.id) + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/>' +
      '<stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient></defs>';
    const shade = 'fill="none" stroke="none"';
    let body = "";

    switch (product.model) {
      case "gear":
        body = '<path d="' + gearPath(60, 60, 24, 44, 54) + '" fill="' + c + '"/>' +
          '<path d="' + gearPath(60, 60, 24, 44, 54) + '" ' + shade + "/>" +
          '<circle cx="60" cy="60" r="22" fill="' + c + '" stroke="rgba(0,0,0,.15)" stroke-width="2"/>' +
          '<circle cx="60" cy="60" r="10" fill="' + hole + '"/>' + boltCircle(60, 60, 33, 6, 4, hole);
        break;
      case "flange":
        body = '<circle cx="60" cy="60" r="54" fill="' + c + '"/><circle cx="60" cy="60" r="54" ' + shade + "/>" +
          '<circle cx="60" cy="60" r="32" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="3"/>' +
          '<circle cx="60" cy="60" r="22" fill="' + hole + '"/>' + boltCircle(60, 60, 43, 8, 5, hole);
        break;
      case "pump":
        body = '<rect x="8" y="96" width="104" height="8" rx="2" fill="#3a4350"/>' +
          '<rect x="58" y="44" width="54" height="44" rx="8" fill="#5b6675"/>' +
          '<circle cx="36" cy="64" r="30" fill="' + c + '"/><circle cx="36" cy="64" r="30" ' + shade + "/>" +
          '<rect x="44" y="18" width="14" height="22" fill="' + c + '"/><rect x="40" y="14" width="22" height="6" rx="2" fill="#9aa3ad"/>' +
          '<circle cx="36" cy="64" r="10" fill="rgba(0,0,0,.18)"/>' +
          '<path d="M64 50v32M72 50v32M80 50v32M88 50v32M96 50v32M104 50v32" stroke="rgba(255,255,255,.18)" stroke-width="2"/>';
        break;
      case "valve":
        body = '<rect x="10" y="50" width="100" height="28" fill="' + c + '"/>' +
          '<rect x="6" y="40" width="12" height="48" rx="2" fill="' + c + '"/><rect x="102" y="40" width="12" height="48" rx="2" fill="' + c + '"/>' +
          '<circle cx="60" cy="64" r="28" fill="' + c + '"/><circle cx="60" cy="64" r="28" ' + shade + "/>" +
          '<rect x="56" y="22" width="8" height="16" fill="#b5bcc5"/>' +
          '<rect x="56" y="16" width="56" height="8" rx="3" fill="#b5bcc5"/><rect x="92" y="14" width="20" height="12" rx="3" fill="#1f2937"/>';
        break;
      case "shaft":
        body = '<g transform="rotate(-20 60 60)">' +
          '<rect x="6" y="52" width="20" height="16" rx="2" fill="' + c + '"/>' +
          '<rect x="24" y="48" width="26" height="24" fill="' + c + '"/>' +
          '<rect x="48" y="44" width="12" height="32" rx="1" fill="' + c + '"/>' +
          '<rect x="58" y="48" width="34" height="24" fill="' + c + '"/>' +
          '<rect x="90" y="52" width="24" height="16" rx="2" fill="' + c + '"/>' +
          '<rect x="6" y="44" width="108" height="32" ' + shade + "/>" +
          '<rect x="64" y="48" width="18" height="4" fill="rgba(0,0,0,.25)"/></g>';
        break;
      default:
        body = '<path d="M14 98h92v12H14zM14 20h14v80H14z" fill="' + c + '"/>' +
          '<path d="M28 98 L28 52 L66 98Z" fill="' + c + '" opacity=".85"/>' +
          '<rect x="14" y="20" width="92" height="90" ' + shade + "/>" +
          '<circle cx="21" cy="40" r="4" fill="' + hole + '"/><circle cx="80" cy="104" r="3" fill="' + hole + '"/>' +
          '<circle cx="98" cy="104" r="3" fill="' + hole + '"/>';
    }
    return '<svg viewBox="0 0 120 120" aria-hidden="true">' + defs +
      '<g stroke="#64748b" stroke-width="1.4" stroke-linejoin="round">' + body + "</g></svg>";
  }

  // ---------------------------------------------------------------- basket & compare

  function getBasket() {
    return readJson(STORAGE.basket, []);
  }

  function setBasket(items) {
    writeJson(STORAGE.basket, items);
    updateBasketCount();
  }

  function addToBasket(id) {
    const items = getBasket();
    const existing = items.find(function (item) {
      return item.id === id;
    });
    if (existing) {
      existing.qty += 1;
    } else {
      items.push({ id: id, qty: 1 });
    }
    setBasket(items);
    const product = productById(id);
    toast("Added to RFQ: " + (product ? product.name : id));
  }

  function updateBasketCount() {
    const count = getBasket().length;
    document.getElementById("basketCount").textContent = count;
  }

  function saveCompare() {
    sessionStorage.setItem("ic_compare", JSON.stringify(Array.from(compareIds)));
    renderCompareBar();
  }

  function renderCompareBar() {
    if (compareIds.size === 0 || location.hash.indexOf("#/compare") === 0) {
      compareBar.classList.add("hidden");
      return;
    }
    compareBar.classList.remove("hidden");
    compareBar.innerHTML =
      "<span><b>" + compareIds.size + "</b> selected for comparison</span>" +
      '<a class="btn btn-primary btn-sm" href="#/compare">Compare</a>' +
      '<button class="btn btn-sm btn-ghost" data-action="clear-compare">Clear</button>';
  }

  // ---------------------------------------------------------------- shared blocks

  function productCard(p) {
    const checked = compareIds.has(p.id) ? "checked" : "";
    return (
      '<article class="card product-card">' +
      '<a href="#/product/' + esc(p.id) + '" class="pc-visual" data-thumb="' + esc(p.id) + '" aria-label="' + esc(p.name) + '">' +
      productIcon(p) + '<span class="pc-3d">3D</span></a>' +
      '<div class="pc-body">' +
      '<div class="pc-cat">' + esc(p.category) + "</div>" +
      '<h3><a href="#/product/' + esc(p.id) + '">' + esc(p.name) + "</a></h3>" +
      "<p>" + esc(p.summary) + "</p>" +
      '<ul class="pc-meta"><li>MOQ <b>' + esc(p.moq) + "</b></li><li>Lead <b>" + esc(p.leadTime) + "</b></li></ul>" +
      '<div class="pc-actions">' +
      '<button class="btn btn-light btn-sm" data-action="add-quote" data-id="' + esc(p.id) + '">' + icon("plus") + "Add to RFQ</button>" +
      '<label class="cmp"><input type="checkbox" data-action="compare" data-id="' + esc(p.id) + '" ' + checked + "> Compare</label>" +
      "</div></div></article>"
    );
  }

  function caseCards(list) {
    return list.map(function (c) {
      return (
        '<article class="card case-card">' +
        '<div class="metric">' + esc(c.metric) + "</div>" +
        "<h3>" + esc(c.title) + "</h3>" +
        '<div class="muted">' + esc(c.client) + "</div>" +
        "<dl><dt>Challenge</dt><dd>" + esc(c.challenge) + "</dd>" +
        "<dt>Solution</dt><dd>" + esc(c.solution) + "</dd></dl></article>"
      );
    }).join("");
  }

  function certStrip() {
    return '<div class="cert-strip">' + D.company.certifications.map(function (c) {
      return '<div class="cert">' + esc(c) + "</div>";
    }).join("") + "</div>";
  }

  function pageHero(kicker, title, text) {
    return (
      '<section class="page-hero"><div class="wrap">' +
      '<div class="kicker">' + esc(kicker) + "</div>" +
      "<h1>" + esc(title) + "</h1>" +
      (text ? "<p>" + esc(text) + "</p>" : "") +
      "</div></section>"
    );
  }

  function heroArt() {
    // Engineering-drawing style illustration: weld-neck flange, front view + section, with dimensions
    const bolts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      bolts.push('<circle cx="' + (170 + 95 * Math.cos(a)).toFixed(1) + '" cy="' + (190 + 95 * Math.sin(a)).toFixed(1) + '" r="9"/>');
    }
    return (
      '<svg viewBox="0 0 480 380" aria-hidden="true" font-family="ui-monospace, Consolas, monospace" font-size="10">' +
      '<defs><marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0 0 10 5 0 10z" fill="#93c5fd"/></marker></defs>' +
      '<g fill="none" stroke="#93c5fd" stroke-width="1.3" opacity=".9">' +
      // centre lines
      '<path d="M30 190h290M170 50v280M340 190h110" stroke-dasharray="16 4 2 4" stroke-width=".8" opacity=".6"/>' +
      // front view
      '<circle cx="170" cy="190" r="120"/><circle cx="170" cy="190" r="70"/><circle cx="170" cy="190" r="44"/>' +
      '<circle cx="170" cy="190" r="95" stroke-dasharray="6 4" stroke-width=".8" opacity=".7"/>' + bolts.join("") +
      // section view
      '<path d="M352 70h22v240h-22z" fill="rgba(147,197,253,.08)"/>' +
      '<path d="M374 120l56 26v88l-56 26z" fill="rgba(147,197,253,.08)"/>' +
      '<path d="M352 146h78M352 234h78" stroke-dasharray="5 3" stroke-width=".8"/>' +
      // dimensions
      '<path d="M50 190V40M290 190V40" stroke-width=".6" opacity=".6"/>' +
      '<path d="M50 50h240" stroke-width=".8" marker-start="url(#arw)" marker-end="url(#arw)"/>' +
      '<path d="M352 310v28M430 234v104" stroke-width=".6" opacity=".6"/>' +
      '<path d="M352 330h78" stroke-width=".8" marker-start="url(#arw)" marker-end="url(#arw)"/>' +
      '<path d="M215 260l60 50h40" stroke-width=".8"/>' +
      // title block
      '<rect x="300" y="344" width="170" height="30" stroke-width=".8"/><path d="M380 344v30" stroke-width=".8"/>' +
      "</g>" +
      '<g fill="#93c5fd">' +
      '<text x="150" y="44">Ø 240</text><text x="380" y="324">80</text><text x="318" y="306">8× Ø18</text>' +
      '<text x="308" y="363" font-size="9">WN-150 · B16.5</text><text x="388" y="363" font-size="9">SCALE 1:4</text>' +
      "</g></svg>"
    );
  }

  // ---------------------------------------------------------------- trust & chat

  // Issued server-side by the bridge operator; never read from editable company data.
  function verification() {
    return CONFIG && CONFIG.verification ? CONFIG.verification : null;
  }

  function monthYear(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }

  function trustBadge() {
    const v = verification();
    if (!v || !v.verified) {
      return "";
    }
    return '<a class="trust-badge" href="#/contact" title="What was checked">' + icon("shield") +
      "Verified by " + esc(v.issuer || CONFIG.hubName) + '<span class="when">' + esc(monthYear(v.verified_at)) + "</span></a>";
  }

  function trustPanel() {
    const v = verification();
    if (!v || v.status === "none") {
      return "";
    }
    const heading = v.verified ? "Verified by " + esc(v.issuer || CONFIG.hubName)
      : v.status === "expired" ? "Verification expired" : "Partially verified";
    return '<div class="card trust-panel">' +
      '<div class="trust-head">' + icon("shield") + "<div><h3>" + heading + "</h3>" +
      '<p class="muted">Checked ' + esc(monthYear(v.verified_at)) + (v.expires_at ? " · valid until " + esc(monthYear(v.expires_at)) : "") + "</p></div></div>" +
      '<ul class="trust-checks">' + v.checks.map(function (c) {
        return '<li class="' + (c.ok ? "ok" : "no") + '">' + icon(c.ok ? "check" : "x") + esc(c.label) + "</li>";
      }).join("") + "</ul>" +
      (v.registration_no ? '<p class="muted small">Registration: ' + esc(v.registration_no) + "</p>" : "") +
      "</div>";
  }

  function track() {
    return CONFIG && CONFIG.track ? CONFIG.track : null;
  }

  function stars(rating) {
    const full = Math.round(rating);
    return '<span class="stars" aria-label="' + rating + ' out of 5">' + "★★★★★".slice(0, full) +
      '<span class="off">' + "★★★★★".slice(full) + "</span></span>";
  }

  function responseLabel(hours) {
    if (hours == null) {
      return "";
    }
    return hours < 1 ? "under 1 h" : hours < 48 ? Math.round(hours) + " h" : Math.round(hours / 24) + " days";
  }

  // Earned on the network: introductions answered, deals closed, verified reviews.
  function trackPanel() {
    const t = track();
    if (!t || !t.introductions) {
      return "";
    }
    const cells = [
      ["Introductions", t.introductions],
      ["Deals closed", t.deals_won],
      ["Answer rate", t.response_rate != null ? t.response_rate + "%" : "building"],
      ["Typical reply", t.median_response_hours != null ? responseLabel(t.median_response_hours) : "building"]
    ];
    const reviews = (CONFIG.reviews || []).map(function (r) {
      return '<li class="review">' + stars(r.rating) + "<p>" + esc(r.comment || "No comment") + "</p>" +
        '<span class="muted small">' + esc(r.reviewer) + " · " + esc(r.date) + "</span></li>";
    }).join("");
    return '<div class="card track-panel"><div class="trust-head">' + icon("trend") + "<div><h3>Track record on " +
      esc(CONFIG.hubName) + "</h3>" + '<p class="muted">Measured from real introductions, not self-reported.</p></div></div>' +
      '<div class="track-grid">' + cells.map(function (c) {
        return "<div><b>" + esc(c[1]) + "</b><span>" + esc(c[0]) + "</span></div>";
      }).join("") + "</div>" +
      (t.rating != null ? '<div class="track-rating">' + stars(t.rating) + " <b>" + t.rating + "</b> from " + t.reviews +
        " verified review" + (t.reviews === 1 ? "" : "s") + "</div>" : "") +
      (reviews ? '<ul class="reviews">' + reviews + "</ul>" : "") + "</div>";
  }

  function trustSummary() {
    const t = track();
    if (!t || t.rating == null) {
      return "";
    }
    return '<a class="rating-chip" href="#/contact">' + stars(t.rating) + " " + t.rating + " · " + t.reviews +
      " verified review" + (t.reviews === 1 ? "" : "s") + "</a>";
  }

  // Hosted portals use the number the bridge hands out (the operator for via-bridge routing).
  function whatsappNumber() {
    if (CONFIG) {
      return CONFIG.whatsapp || "";
    }
    return String(D.contact.whatsapp || "").replace(/\D/g, "");
  }

  function whatsappUrl(text) {
    const number = whatsappNumber();
    if (!number) {
      return "";
    }
    return "https://wa.me/" + number + (text ? "?text=" + encodeURIComponent(text) : "");
  }

  function renderWhatsappFab() {
    const existing = document.getElementById("waFab");
    const url = whatsappUrl("Hi, I'm looking at " + D.company.name + " (" + location.href.split("#")[0] + ")");
    if (!url) {
      if (existing) {
        existing.remove();
      }
      return;
    }
    const fab = existing || document.createElement("a");
    fab.id = "waFab";
    fab.className = "wa-fab no-print";
    fab.href = url;
    fab.target = "_blank";
    fab.rel = "noopener";
    fab.innerHTML = icon("chat") + "<span>Chat on WhatsApp</span>";
    if (!existing) {
      document.body.appendChild(fab);
    }
  }

  // ---------------------------------------------------------------- pages

  function renderHome() {
    const audience = getAudience();
    const hero = D.audiences[audience] || D.audiences.customer;
    const featured = D.products.filter(function (p) {
      return p.featured;
    });

    const paths = [
      {
        key: "customer",
        icon: icon("box"),
        title: "Buy from us",
        items: ["Browse the catalog & 3D models", "Compare specs side-by-side", "Send one RFQ for many parts"],
        link: "#/products",
        cta: "Explore products"
      },
      {
        key: "investor",
        icon: icon("trend"),
        title: "Invest with us",
        items: ["Financial highlights & growth", "Use of funds and roadmap", "Request the investor deck"],
        link: "#/investors",
        cta: "Investor brief"
      },
      {
        key: "supplier",
        icon: icon("truck"),
        title: "Supply to us",
        items: ["What we buy, and how much", "Supplier requirements", "Register in five minutes"],
        link: "#/suppliers",
        cta: "Supplier portal"
      }
    ];

    app.innerHTML =
      '<section class="hero"><div class="wrap">' +
      '<div class="hero-grid"><div>' +
      trustBadge() + trustSummary() +
      '<div class="kicker">' + esc(hero.kicker) + "</div>" +
      "<h1>" + esc(hero.title) + "</h1>" +
      '<p class="lead">' + esc(hero.text) + "</p>" +
      '<div class="btn-row">' +
      '<a class="btn btn-primary" href="' + esc(hero.primary.href) + '">' + esc(hero.primary.label) + "</a>" +
      '<a class="btn btn-ghost" href="' + esc(hero.secondary.href) + '">' + esc(hero.secondary.label) + "</a>" +
      "</div></div>" +
      '<div class="hero-art">' + heroArt() + "</div></div>" +
      '<div class="stats">' + D.company.stats.map(function (s) {
        return '<div class="stat"><b>' + esc(s.value) + "</b><span>" + esc(s.label) + "</span></div>";
      }).join("") + "</div>" +
      "</div></section>" +

      '<section class="section"><div class="wrap">' +
      '<div class="section-head"><div><div class="kicker">Work with us</div><h2>Three ways to partner with ' +
      esc(D.company.name) + "</h2></div><p>" + esc(D.company.about) + "</p></div>" +
      '<div class="grid grid-3">' + paths.map(function (p) {
        const current = p.key === audience;
        return (
          '<article class="card path-card' + (current ? " current" : "") + '">' +
          (current ? '<span class="tag">For you</span>' : "") +
          '<div class="path-icon">' + p.icon + "</div>" +
          "<h3>" + esc(p.title) + "</h3><ul>" +
          p.items.map(function (i) {
            return "<li>" + esc(i) + "</li>";
          }).join("") +
          '</ul><a class="link-arrow" href="' + p.link + '">' + esc(p.cta) + " " + icon("arrowRight") + "</a></article>"
        );
      }).join("") + "</div></div></section>" +

      '<section class="section alt"><div class="wrap">' +
      '<div class="section-head"><div><div class="kicker">Products</div><h2>Featured products</h2></div>' +
      '<a class="link-arrow" href="#/products">View full catalog ' + icon("arrowRight") + "</a></div>" +
      '<div class="grid grid-4">' + featured.map(productCard).join("") + "</div></div></section>" +

      '<section class="section"><div class="wrap">' +
      '<div class="section-head"><div><div class="kicker">Proven results</div><h2>Case studies</h2></div></div>' +
      '<div class="grid grid-3">' + caseCards(D.caseStudies) + "</div>" +
      '<div style="margin-top:28px">' + certStrip() + "</div></div></section>" +

      '<section class="section" style="padding-top:0"><div class="wrap"><div class="cta-band">' +
      "<div><h2>Have a drawing or a project in mind?</h2><p>Send it over. Our engineers reply within one business day.</p></div>" +
      '<div class="btn-row"><a class="btn btn-dark" href="#/quote">Request a quote</a>' +
      '<a class="btn btn-ghost" href="#/contact">Contact us</a></div></div></div></section>';
  }

  function renderProducts() {
    const categories = ["All"].concat(Array.from(new Set(D.products.map(function (p) {
      return p.category;
    }))));

    app.innerHTML =
      pageHero("Catalog", "Products & solutions", "Every product can be customized to your drawing. Open any item for a 3D model and full specifications.") +
      '<section class="section"><div class="wrap">' +
      '<div class="toolbar">' +
      '<input class="search" id="productSearch" type="search" placeholder="Search products, materials, standards…" value="' + esc(productFilter.q) + '">' +
      '<div class="chips" id="categoryChips">' + categories.map(function (c) {
        return '<button class="chip' + (c === productFilter.category ? " active" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + "</button>";
      }).join("") + "</div></div>" +
      '<div id="productGrid" class="grid grid-3"></div></div></section>';

    function drawGrid() {
      const q = productFilter.q.trim().toLowerCase();
      const list = D.products.filter(function (p) {
        const inCategory = productFilter.category === "All" || p.category === productFilter.category;
        const haystack = [p.name, p.category, p.summary, p.description]
          .concat(Object.keys(p.specs || {}))
          .concat(Object.values(p.specs || {}))
          .concat(p.applications || [])
          .join(" ")
          .toLowerCase();
        return inCategory && (!q || haystack.indexOf(q) !== -1);
      });
      const grid = document.getElementById("productGrid");
      setTimeout(function () {
        hydrateThumbnails(grid);
      }, 0);
      grid.innerHTML = list.length
        ? list.map(productCard).join("")
        : '<div class="empty card" style="grid-column:1/-1">No products match. <a href="#/quote">Send us a custom RFQ</a> instead.</div>';
    }

    document.getElementById("productSearch").addEventListener("input", function (event) {
      productFilter.q = event.target.value;
      drawGrid();
    });
    document.getElementById("categoryChips").addEventListener("click", function (event) {
      const chip = event.target.closest(".chip");
      if (!chip) {
        return;
      }
      productFilter.category = chip.dataset.cat;
      document.querySelectorAll("#categoryChips .chip").forEach(function (el) {
        el.classList.toggle("active", el === chip);
      });
      drawGrid();
    });
    drawGrid();
  }

  function renderProduct(id) {
    const p = productById(id);
    if (!p) {
      renderNotFound();
      return;
    }
    trackView("product:" + p.id);
    const related = D.products.filter(function (other) {
      return other.id !== p.id && other.category === p.category;
    }).concat(D.products.filter(function (other) {
      return other.id !== p.id && other.category !== p.category;
    })).slice(0, 3);

    app.innerHTML =
      '<section class="section"><div class="wrap">' +
      '<div class="breadcrumb no-print"><a href="#/products">Products</a> / ' + esc(p.category) + " / " + esc(p.name) + "</div>" +
      '<div class="print-only"><h2>' + esc(D.company.legalName || D.company.name) + " · Product datasheet</h2></div>" +
      '<div class="detail-grid">' +
      '<div class="card viewer-card"><div class="viewer" id="viewer"></div>' +
      '<div class="viewer-tools">' +
      '<button class="btn btn-light btn-sm" data-viewer="toggleRotate">' + icon("rotate") + 'Auto-rotate</button>' +
      '<button class="btn btn-light btn-sm" data-viewer="toggleWireframe">' + icon("grid") + 'Wireframe</button>' +
      '<button class="btn btn-light btn-sm" data-viewer="resetView">' + icon("frame") + 'Reset view</button>' +
      '<label class="btn btn-light btn-sm" title="Preview your own CAD export">' + icon("upload") + 'Load STL / GLB<input type="file" id="modelFile" accept=".stl,.glb,.gltf"></label>' +
      '<button class="btn btn-light btn-sm" data-viewer="snapshot">' + icon("camera") + 'Snapshot</button>' +
      "</div></div>" +

      "<div>" +
      '<div class="pc-cat">' + esc(p.category) + "</div>" +
      "<h1>" + esc(p.name) + "</h1>" +
      trustBadge() +
      '<p class="muted">' + esc(p.description) + "</p>" +
      '<div class="facts">' +
      '<div class="fact"><span>Minimum order</span><b>' + esc(p.moq) + "</b></div>" +
      '<div class="fact"><span>Lead time</span><b>' + esc(p.leadTime) + "</b></div></div>" +
      '<table class="spec-table"><tbody>' + Object.keys(p.specs || {}).map(function (key) {
        return "<tr><th>" + esc(key) + "</th><td>" + esc(p.specs[key]) + "</td></tr>";
      }).join("") + "</tbody></table>" +
      '<h4 style="margin-top:18px">Typical applications</h4>' +
      '<div class="pill-row">' + (p.applications || []).map(function (a) {
        return '<span class="pill">' + esc(a) + "</span>";
      }).join("") + "</div>" +
      '<div class="btn-row no-print">' +
      '<button class="btn btn-primary" data-action="add-quote" data-id="' + esc(p.id) + '">+ Add to RFQ</button>' +
      '<button class="btn btn-light" data-action="print">' + icon("download") + 'Datasheet (PDF)</button>' +
      '<a class="btn btn-light" href="#/contact">Ask an engineer</a></div>' +
      '<p class="print-only">Contact: ' + esc(D.contact.email) + " · " + esc(D.contact.phone) + "</p>" +
      "</div></div></div></section>" +

      '<section class="section alt no-print"><div class="wrap"><h2>Related products</h2>' +
      '<div class="grid grid-3">' + related.map(productCard).join("") + "</div></div></section>";

    const container = document.getElementById("viewer");
    if (window.IC_Viewer) {
      activeViewer = window.IC_Viewer.mount(container, p);
    } else {
      container.innerHTML = '<div class="viewer-msg">3D viewer script not loaded.</div>';
    }

    document.querySelector(".viewer-tools").addEventListener("click", function (event) {
      const button = event.target.closest("[data-viewer]");
      if (!button || !activeViewer) {
        return;
      }
      const method = button.dataset.viewer;
      const result = activeViewer.call(method);
      if (method === "snapshot" && result) {
        const link = document.createElement("a");
        link.href = result;
        link.download = p.id + "-render.png";
        link.click();
      } else if (method === "toggleRotate") {
        button.classList.toggle("btn-dark", !result);
      } else if (method === "toggleWireframe") {
        button.classList.toggle("btn-dark", !!result);
      }
    });

    document.getElementById("modelFile").addEventListener("change", function (event) {
      const file = event.target.files[0];
      if (!file || !activeViewer) {
        return;
      }
      const promise = activeViewer.call("loadFile", file);
      if (promise) {
        promise.then(function () {
          toast("Loaded " + file.name);
        }).catch(function (error) {
          toast(error.message || "Could not load file");
        });
      }
    });
  }

  function renderCompare() {
    const items = Array.from(compareIds).map(productById).filter(Boolean);
    if (items.length === 0) {
      app.innerHTML = pageHero("Compare", "Compare products", "") +
        '<section class="section"><div class="wrap"><div class="card empty">Nothing selected yet. Tick “Compare” on products in the <a href="#/products">catalog</a>.</div></div></section>';
      return;
    }
    const specKeys = [];
    items.forEach(function (p) {
      Object.keys(p.specs || {}).forEach(function (key) {
        if (specKeys.indexOf(key) === -1) {
          specKeys.push(key);
        }
      });
    });
    const rows = [["Category", "category"], ["MOQ", "moq"], ["Lead time", "leadTime"]];

    app.innerHTML = pageHero("Compare", "Side-by-side comparison", "") +
      '<section class="section"><div class="wrap" style="overflow-x:auto">' +
      '<table class="compare-table"><thead><tr><th></th>' + items.map(function (p) {
        return '<th><a style="color:#fff" href="#/product/' + esc(p.id) + '">' + esc(p.name) + "</a></th>";
      }).join("") + "</tr></thead><tbody>" +
      rows.map(function (row) {
        return "<tr><th>" + row[0] + "</th>" + items.map(function (p) {
          return "<td>" + esc(p[row[1]]) + "</td>";
        }).join("") + "</tr>";
      }).join("") +
      specKeys.map(function (key) {
        return "<tr><th>" + esc(key) + "</th>" + items.map(function (p) {
          return "<td>" + esc((p.specs || {})[key] || "—") + "</td>";
        }).join("") + "</tr>";
      }).join("") +
      "<tr><th></th>" + items.map(function (p) {
        return '<td><button class="btn btn-dark btn-sm" data-action="add-quote" data-id="' + esc(p.id) + '">+ Add to RFQ</button></td>';
      }).join("") + "</tr>" +
      "</tbody></table>" +
      '<div class="btn-row" style="margin-top:16px"><button class="btn btn-light" data-action="clear-compare">Clear comparison</button>' +
      '<a class="btn btn-light" href="#/products">Back to catalog</a></div></div></section>';
  }

  function renderCapabilities() {
    app.innerHTML =
      pageHero("Capabilities", "From raw material to tested product, under one roof", D.company.about) +
      '<section class="section"><div class="wrap"><div class="grid grid-3">' +
      D.capabilities.map(function (cap, index) {
        return '<article class="card cap-card"><div class="num">0' + (index + 1) + "</div><h3>" + esc(cap.title) + "</h3><p class=\"muted\">" + esc(cap.detail) + "</p></article>";
      }).join("") + "</div></div></section>" +
      '<section class="section alt"><div class="wrap"><div class="section-head"><div><div class="kicker">Quality</div><h2>Certifications & compliance</h2></div></div>' +
      certStrip() + "</div></section>" +
      '<section class="section"><div class="wrap"><div class="section-head"><div><div class="kicker">References</div><h2>Case studies</h2></div></div>' +
      '<div class="grid grid-3">' + caseCards(D.caseStudies) + "</div></div></section>";
  }

  // --- investor charts

  function revenueChart(financials, unit) {
    const width = 640;
    const height = 300;
    const pad = { l: 48, r: 48, t: 20, b: 36 };
    const maxRevenue = Math.max.apply(null, financials.map(function (f) {
      return f.revenue;
    })) * 1.15;
    const maxMargin = 30;
    const innerW = width - pad.l - pad.r;
    const innerH = height - pad.t - pad.b;
    const slot = innerW / financials.length;
    const barW = slot * 0.55;
    let svg = '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="Revenue and EBITDA margin">';

    for (let i = 0; i <= 4; i++) {
      const y = pad.t + innerH - (innerH * i) / 4;
      svg += '<line x1="' + pad.l + '" x2="' + (width - pad.r) + '" y1="' + y + '" y2="' + y + '" stroke="#e2e8f0"/>';
      svg += '<text x="' + (pad.l - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#64748b">' + ((maxRevenue * i) / 4).toFixed(0) + "</text>";
      svg += '<text x="' + (width - pad.r + 8) + '" y="' + (y + 4) + '" font-size="11" fill="#64748b">' + ((maxMargin * i) / 4).toFixed(0) + "%</text>";
    }

    const points = [];
    financials.forEach(function (f, index) {
      const x = pad.l + slot * index + (slot - barW) / 2;
      const barH = (f.revenue / maxRevenue) * innerH;
      const y = pad.t + innerH - barH;
      svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + barH.toFixed(1) + '" rx="3" fill="#1e293b"/>';
      svg += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#1d2533">' + f.revenue + "</text>";
      svg += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (height - 12) + '" text-anchor="middle" font-size="12" fill="#64748b">' + f.year + "</text>";
      points.push([x + barW / 2, pad.t + innerH - (f.ebitdaMargin / maxMargin) * innerH]);
    });

    svg += '<polyline fill="none" stroke="#2563eb" stroke-width="2.5" points="' + points.map(function (pt) {
      return pt[0].toFixed(1) + "," + pt[1].toFixed(1);
    }).join(" ") + '"/>';
    points.forEach(function (pt) {
      svg += '<circle cx="' + pt[0].toFixed(1) + '" cy="' + pt[1].toFixed(1) + '" r="4" fill="#fff" stroke="#2563eb" stroke-width="2.5"/>';
    });
    svg += "</svg>";
    return (
      '<div class="chart">' + svg + "</div>" +
      '<div class="legend"><span><i style="background:#1e293b"></i>Revenue (' + esc(unit) + ")</span>" +
      '<span><i style="background:#2563eb"></i>EBITDA margin (%)</span></div>'
    );
  }

  function donut(segments) {
    const colors = ["#0f172a", "#1d4ed8", "#60a5fa", "#cbd5e1", "#64748b", "#93c5fd"];
    const radius = 60;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    let svg = '<svg viewBox="0 0 160 160" width="200" height="200"><g transform="rotate(-90 80 80)">';
    segments.forEach(function (segment, index) {
      const length = (segment.pct / 100) * circumference;
      svg += '<circle cx="80" cy="80" r="' + radius + '" fill="none" stroke="' + colors[index % colors.length] +
        '" stroke-width="26" stroke-dasharray="' + length.toFixed(2) + " " + (circumference - length).toFixed(2) +
        '" stroke-dashoffset="' + (-offset).toFixed(2) + '"/>';
      offset += length;
    });
    svg += "</g></svg>";
    const list = "<ul>" + segments.map(function (segment, index) {
      return '<li><span><i style="display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:8px;background:' +
        colors[index % colors.length] + '"></i>' + esc(segment.label) + "</span><b>" + segment.pct + "%</b></li>";
    }).join("") + "</ul>";
    return '<div class="funds"><div>' + svg + "</div>" + list + "</div>";
  }

  function renderInvestors() {
    const inv = D.investors;
    const fin = inv.financials;
    const first = fin[0];
    const last = fin[fin.length - 1];
    const years = last.year - first.year;
    const cagr = years > 0 ? (Math.pow(last.revenue / first.revenue, 1 / years) - 1) * 100 : 0;
    const prev = fin.length > 1 ? fin[fin.length - 2] : last;
    const yoy = ((last.revenue / prev.revenue) - 1) * 100;

    app.innerHTML =
      pageHero("Investor relations", inv.headline, D.company.about) +
      '<section class="section"><div class="wrap">' +
      '<div class="grid grid-4">' +
      '<div class="kpi"><span>Revenue ' + last.year + "</span><b>" + last.revenue + " " + esc(inv.currencyUnit) + "</b><small>+" + yoy.toFixed(1) + "% YoY</small></div>" +
      '<div class="kpi"><span>Revenue CAGR ' + first.year + "–" + last.year + "</span><b>" + cagr.toFixed(1) + "%</b></div>" +
      '<div class="kpi"><span>EBITDA margin ' + last.year + "</span><b>" + last.ebitdaMargin + "%</b><small>+" + (last.ebitdaMargin - first.ebitdaMargin).toFixed(1) + " pts since " + first.year + "</small></div>" +
      (inv.extraKpis || []).slice(0, 1).map(function (k) {
        return '<div class="kpi"><span>' + esc(k.label) + "</span><b>" + esc(k.value) + "</b></div>";
      }).join("") +
      "</div>" +
      '<div class="grid grid-2" style="margin-top:20px">' +
      '<div class="card"><h3>Financial performance</h3>' + revenueChart(fin, inv.currencyUnit) + "</div>" +
      '<div class="card"><h3>Investment thesis</h3><ul class="thesis">' + inv.thesis.map(function (t) {
        return "<li>" + esc(t) + "</li>";
      }).join("") + "</ul>" +
      '<div class="grid grid-2" style="margin-top:12px">' + (inv.extraKpis || []).slice(1).map(function (k) {
        return '<div class="fact"><span>' + esc(k.label) + "</span><b>" + esc(k.value) + "</b></div>";
      }).join("") + "</div></div></div>" +
      '<p class="form-note" style="margin-top:10px">Figures shown are unaudited management figures for illustration. Not an offer to sell securities.</p>' +
      "</div></section>" +

      '<section class="section alt"><div class="wrap"><div class="grid grid-2">' +
      '<div><div class="kicker">The opportunity</div><h2>Raising ' + esc(inv.ask.amount) + "</h2>" +
      '<p class="muted">' + esc(inv.ask.round) + "</p>" + donut(inv.ask.useOfFunds) + "</div>" +
      '<div><div class="kicker">Leadership</div><h2>Management team</h2><div class="grid">' + (D.investors.team || []).map(function (m) {
        const initials = m.name.split(/\s+/).map(function (w) {
          return w[0];
        }).join("").slice(0, 2);
        return '<div class="card team-card" style="display:flex;gap:14px"><div class="avatar">' + esc(initials) + "</div><div><b>" + esc(m.name) + '</b> <span class="muted">· ' + esc(m.role) + '</span><div class="muted" style="font-size:.9rem">' + esc(m.bio) + "</div></div></div>";
      }).join("") + "</div></div></div></div></section>" +

      '<section class="section"><div class="wrap"><div class="kicker">Roadmap</div><h2>Growth plan</h2>' +
      '<div class="timeline" style="margin-top:24px">' + inv.roadmap.map(function (r) {
        return '<div class="tl-item"><b>' + esc(r.period) + "</b><h3>" + esc(r.title) + '</h3><p class="muted">' + esc(r.text) + "</p></div>";
      }).join("") + "</div></div></section>" +

      '<section class="section alt" id="investor-form"><div class="wrap"><div class="grid grid-2">' +
      '<div><div class="kicker">Next step</div><h2>Request the investor deck</h2>' +
      '<p class="muted">Tell us a little about you. Our CFO will send the full deck and data-room access after a short intro call.</p>' +
      '<p>Direct contact: <a href="mailto:' + esc(D.contact.investorEmail) + '">' + esc(D.contact.investorEmail) + "</a></p></div>" +
      '<div class="card" id="investorFormWrap"><form class="form" id="investorForm" novalidate>' +
      field("name", "Full name", "text", true) +
      field("firm", "Fund / company", "text", true) +
      field("email", "Work email", "email", true) +
      field("country", "Country", "text", false) +
      select("ticket", "Typical ticket size", ["< USD 1M", "USD 1–5M", "USD 5–15M", "> USD 15M"], true) +
      select("investorType", "Investor type", ["Venture / growth fund", "Private equity", "Family office", "Strategic / corporate", "Bank / debt", "Angel"], true) +
      '<label class="full">Message<textarea name="message" placeholder="Areas of interest, timing, questions…"></textarea></label>' +
      '<label class="full inline-check"><input type="checkbox" name="nda" value="yes"> I am willing to sign an NDA to access the data room</label>' +
      '<div class="full"><button class="btn btn-primary" type="submit">Request deck</button></div>' +
      "</form></div></div></div></section>";

    bindForm("investorForm", "investor");
  }

  function renderSuppliers() {
    const s = D.suppliers;
    app.innerHTML =
      pageHero("Supplier portal", "Become an approved supplier", s.intro) +
      '<section class="section"><div class="wrap">' +
      '<div class="section-head"><div><div class="kicker">What we buy</div><h2>Sourcing categories</h2></div></div>' +
      '<div class="card" style="padding:0;overflow-x:auto"><table class="data-table"><thead><tr><th>Category</th><th>Specification</th><th>Estimated volume</th></tr></thead><tbody>' +
      s.categories.map(function (c) {
        return "<tr><td><b>" + esc(c.name) + "</b></td><td>" + esc(c.detail) + "</td><td>" + esc(c.volume) + "</td></tr>";
      }).join("") + "</tbody></table></div></div></section>" +

      '<section class="section alt"><div class="wrap"><div class="grid grid-2">' +
      '<div><div class="kicker">Requirements</div><h2>What we expect</h2><ul class="check-list">' +
      s.requirements.map(function (r) {
        return "<li>" + esc(r) + "</li>";
      }).join("") + "</ul></div>" +
      '<div><div class="kicker">Process</div><h2>How qualification works</h2><div class="steps" style="grid-template-columns:repeat(2,1fr)">' +
      s.process.map(function (p) {
        return '<div class="step"><b>' + esc(p.step) + '</b><div class="muted">' + esc(p.text) + "</div></div>";
      }).join("") + "</div></div></div></div></section>" +

      '<section class="section"><div class="wrap"><div class="grid grid-2">' +
      '<div><div class="kicker">Register</div><h2>Supplier registration</h2>' +
      '<p class="muted">Takes about five minutes. Our procurement team reviews every registration within 5 working days.</p>' +
      '<p>Procurement: <a href="mailto:' + esc(D.contact.procurementEmail) + '">' + esc(D.contact.procurementEmail) + "</a></p></div>" +
      '<div class="card"><form class="form" id="supplierForm" novalidate>' +
      field("company", "Company name", "text", true) +
      field("name", "Contact person", "text", true) +
      field("email", "Email", "email", true) +
      field("country", "Country", "text", true) +
      field("website", "Website", "url", false) +
      field("capacity", "Annual capacity / turnover", "text", false) +
      '<fieldset class="full"><legend>Categories you supply <span class="req">*</span></legend><div class="checks">' +
      s.categories.map(function (c) {
        return '<label><input type="checkbox" name="categories" value="' + esc(c.name) + '"> ' + esc(c.name) + "</label>";
      }).join("") + "</div></fieldset>" +
      '<fieldset class="full"><legend>Certifications held</legend><div class="checks">' +
      ["ISO 9001", "ISO 14001", "ISO 45001", "IATF 16949", "AS9100", "Other"].map(function (c) {
        return '<label><input type="checkbox" name="certifications" value="' + c + '"> ' + c + "</label>";
      }).join("") + "</div></fieldset>" +
      '<label class="full">Capabilities & main customers<textarea name="message" placeholder="Key equipment, materials, industries served…"></textarea></label>' +
      '<label class="full">Company profile / certificates<input type="file" name="attachment" multiple></label>' +
      '<div class="full"><button class="btn btn-primary" type="submit">Submit registration</button></div>' +
      "</form></div></div></div></section>";

    bindForm("supplierForm", "supplier");
  }

  function renderQuote() {
    const items = getBasket();
    const basketHtml = items.length
      ? '<ul class="basket-list">' + items.map(function (item, index) {
        const p = productById(item.id);
        if (!p) {
          return "";
        }
        return (
          '<li><div class="basket-thumb" data-thumb="' + esc(p.id) + '">' + productIcon(p) + "</div>" +
          '<div class="grow"><b>' + esc(p.name) + '</b><div class="muted" style="font-size:.85rem">MOQ ' + esc(p.moq) + " · " + esc(p.leadTime) + "</div></div>" +
          '<input type="number" min="1" value="' + item.qty + '" data-basket-index="' + index + '" aria-label="Quantity">' +
          '<button class="btn btn-sm btn-danger" data-action="remove-basket" data-index="' + index + '" aria-label="Remove">' + icon("x") + "</button></li>"
        );
      }).join("") + "</ul>"
      : '<div class="empty">Your RFQ basket is empty. Add products from the <a href="#/products">catalog</a>, or just describe a custom part below.</div>';

    app.innerHTML =
      pageHero("Request for quotation", "Get a quote in one business day", "Combine several catalog items and custom parts in a single request. Attach drawings (PDF, STEP, DWG).") +
      '<section class="section"><div class="wrap"><div class="grid grid-2">' +
      '<div class="card"><h3>Your RFQ basket</h3>' + basketHtml + "</div>" +
      '<div class="card"><form class="form" id="quoteForm" novalidate>' +
      field("company", "Company", "text", true) +
      field("name", "Your name", "text", true) +
      field("email", "Work email", "email", true) +
      field("phone", "Phone / WhatsApp", "tel", false) +
      field("country", "Country", "text", false) +
      select("volume", "Expected annual volume", ["Prototype / one-off", "< 500 pcs/yr", "500 – 5,000 pcs/yr", "> 5,000 pcs/yr"], true) +
      select("timeline", "Needed by", ["Within 1 month", "1 – 3 months", "3 – 6 months", "Just budgeting"], true) +
      field("industry", "Industry", "text", false) +
      '<label class="full">Requirements<textarea name="message" placeholder="Material, quantities, tolerances, certifications, delivery terms…"></textarea></label>' +
      '<label class="full">Drawings / 3D files<input type="file" name="attachment" multiple accept=".pdf,.step,.stp,.dwg,.dxf,.igs,.stl,.png,.jpg"></label>' +
      '<div class="full"><button class="btn btn-primary" type="submit">Send RFQ</button> <span class="form-note">We reply within 1 business day.</span></div>' +
      "</form></div></div></div></section>";

    app.querySelectorAll("[data-basket-index]").forEach(function (input) {
      input.addEventListener("change", function () {
        const basket = getBasket();
        const index = Number(input.dataset.basketIndex);
        basket[index].qty = Math.max(1, parseInt(input.value, 10) || 1);
        setBasket(basket);
      });
    });

    bindForm("quoteForm", "customer", function () {
      return {
        items: getBasket().map(function (item) {
          const p = productById(item.id);
          return (p ? p.name : item.id) + " × " + item.qty;
        })
      };
    });
  }

  function renderContact() {
    const c = D.contact;
    app.innerHTML =
      pageHero("Contact", "Let's talk", "Sales, partnerships, investor relations or procurement. Reach the right team directly.") +
      '<section class="section"><div class="wrap"><div class="grid grid-2">' +
      '<div class="grid">' +
      '<div class="card"><h3>Sales & engineering</h3><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a></div>" +
      '<div class="card"><h3>Investor relations</h3><a href="mailto:' + esc(c.investorEmail) + '">' + esc(c.investorEmail) + "</a></div>" +
      '<div class="card"><h3>Procurement</h3><a href="mailto:' + esc(c.procurementEmail) + '">' + esc(c.procurementEmail) + "</a></div>" +
      '<div class="card"><h3>Head office & plant</h3><p class="muted" style="margin:0">' + esc(c.address) + "<br>" + esc(c.phone) + "</p>" +
      (whatsappUrl() ? '<a class="btn btn-light btn-sm" style="margin-top:10px" target="_blank" rel="noopener" href="' + esc(whatsappUrl("Hi, I'd like to talk to " + D.company.name)) + '">' + icon("chat") + "WhatsApp us</a>" : "") +
      "</div>" + trustPanel() + trackPanel() + "</div>" +
      '<div class="card"><form class="form" id="contactForm" novalidate>' +
      field("name", "Name", "text", true) +
      field("company", "Company", "text", false) +
      field("email", "Email", "email", true) +
      select("topic", "Topic", ["Product inquiry", "Partnership / distribution", "Investment", "Supplier", "Careers", "Other"], true) +
      '<label class="full"><span>Message <span class="req">*</span></span><textarea name="message" required></textarea></label>' +
      '<div class="full"><button class="btn btn-primary" type="submit">Send message</button></div>' +
      "</form></div></div></div></section>";

    bindForm("contactForm", "general");
  }

  // ---------------------------------------------------------------- forms & leads

  function field(name, label, type, required) {
    return (
      "<label><span>" + esc(label) + (required ? ' <span class="req">*</span>' : "") + "</span>" +
      '<input name="' + name + '" type="' + type + '"' + (required ? " required" : "") + "></label>"
    );
  }

  function select(name, label, options, required) {
    return (
      "<label><span>" + esc(label) + (required ? ' <span class="req">*</span>' : "") + "</span>" +
      '<select name="' + name + '"' + (required ? " required" : "") + '><option value="">Select…</option>' +
      options.map(function (o) {
        return "<option>" + esc(o) + "</option>";
      }).join("") + "</select></label>"
    );
  }

  function collectFields(form) {
    const fields = {};
    new FormData(form).forEach(function (value, key) {
      if (value instanceof File) {
        if (value.name) {
          fields[key] = fields[key] ? fields[key] + ", " + value.name : value.name;
        }
        return;
      }
      if (fields[key] !== undefined) {
        fields[key] = [].concat(fields[key], value);
      } else {
        fields[key] = value;
      }
    });
    return fields;
  }

  function validate(form, type, fields) {
    let firstInvalid = null;
    form.querySelectorAll("[required]").forEach(function (input) {
      const ok = input.value.trim() !== "" && (input.type !== "email" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value));
      input.style.borderColor = ok ? "" : "#dc2626";
      if (!ok && !firstInvalid) {
        firstInvalid = input;
      }
    });
    if (firstInvalid) {
      firstInvalid.focus();
      toast("Please complete the highlighted fields");
      return false;
    }
    if (type === "supplier" && !fields.categories) {
      toast("Please select at least one category you supply");
      return false;
    }
    return true;
  }

  function asList(value) {
    if (!value) {
      return [];
    }
    return [].concat(value);
  }

  // Simple, transparent lead scoring (0–100) so the team knows who to call first.
  function scoreLead(type, f) {
    let score = 0;
    if (type === "investor") {
      score += { "< USD 1M": 10, "USD 1–5M": 25, "USD 5–15M": 40, "> USD 15M": 35 }[f.ticket] || 0;
      score += { "Private equity": 20, "Strategic / corporate": 20, "Venture / growth fund": 15, "Family office": 15, "Bank / debt": 10, Angel: 5 }[f.investorType] || 0;
      score += f.nda ? 20 : 0;
      score += f.firm ? 10 : 0;
      score += (f.message || "").length > 40 ? 10 : 0;
    } else if (type === "customer") {
      score += Math.min(asList(f.items).length * 10, 30);
      score += { "Prototype / one-off": 5, "< 500 pcs/yr": 15, "500 – 5,000 pcs/yr": 25, "> 5,000 pcs/yr": 35 }[f.volume] || 0;
      score += { "Within 1 month": 20, "1 – 3 months": 15, "3 – 6 months": 8, "Just budgeting": 2 }[f.timeline] || 0;
      score += f.attachment ? 10 : 0;
      score += f.phone ? 5 : 0;
    } else if (type === "supplier") {
      score += Math.min(asList(f.categories).length * 10, 30);
      score += Math.min(asList(f.certifications).length * 15, 45);
      score += f.website ? 10 : 0;
      score += f.capacity ? 10 : 0;
      score += f.attachment ? 5 : 0;
    } else {
      score = 30 + ((f.message || "").length > 80 ? 20 : 0);
    }
    return Math.min(100, score);
  }

  function scoreLabel(score) {
    if (score >= 70) {
      return "hot";
    }
    if (score >= 40) {
      return "warm";
    }
    return "cold";
  }

  function bindForm(formId, type, extraFields) {
    const form = document.getElementById(formId);
    const trap = document.createElement("input");
    trap.type = "text";
    trap.name = "_hp";
    trap.tabIndex = -1;
    trap.autocomplete = "off";
    trap.setAttribute("aria-hidden", "true");
    trap.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0";
    form.appendChild(trap);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const fields = Object.assign(collectFields(form), extraFields ? extraFields() : {});
      const honeypot = fields._hp;
      delete fields._hp;
      if (!validate(form, type, fields)) {
        return;
      }
      if (CONFIG && CONFIG.api) {
        submitToBridge(form, type, fields, honeypot);
        return;
      }
      const lead = {
        ref: "IC-" + Date.now().toString(36).toUpperCase(),
        type: type,
        date: new Date().toISOString(),
        status: "new",
        audience: getAudience(),
        fields: fields
      };
      lead.score = scoreLead(type, fields);

      const leads = readJson(STORAGE.leads, []);
      leads.unshift(lead);
      writeJson(STORAGE.leads, leads);

      if (D.settings && D.settings.formEndpoint) {
        fetch(D.settings.formEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(lead)
        }).catch(function (error) {
          console.warn("Form endpoint failed; lead kept locally.", error);
        });
      }

      if (type === "customer") {
        setBasket([]);
      }
      showSuccess(form, lead);
    });
  }

  function submitToBridge(form, type, fields, honeypot) {
    const button = form.querySelector('button[type="submit"]');
    if (button) {
      button.disabled = true;
      button.textContent = "Sending…";
    }
    fetch(CONFIG.api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: CONFIG.slug, type: type, fields: fields, hp: honeypot || "" })
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) {
          throw new Error(body.error || "Could not send");
        }
        return body;
      });
    }).then(function (body) {
      if (type === "customer") {
        setBasket([]);
      }
      showSuccess(form, { ref: body.ref, type: type, fields: fields, hosted: true });
    }).catch(function (error) {
      toast(error.message);
      if (button) {
        button.disabled = false;
        button.textContent = "Try again";
      }
    });
  }

  function showSuccess(form, lead) {
    const recipients = {
      investor: D.contact.investorEmail,
      supplier: D.contact.procurementEmail,
      customer: D.contact.email,
      general: D.contact.email
    };
    const body = Object.keys(lead.fields).map(function (key) {
      return key + ": " + asList(lead.fields[key]).join(", ");
    }).join("\n");
    const mailto = "mailto:" + recipients[lead.type] + "?subject=" + encodeURIComponent(lead.ref + " · " + lead.type + " inquiry") +
      "&body=" + encodeURIComponent(body);

    const chat = whatsappUrl("Hi, I just sent request " + lead.ref + " (" + lead.type + ") on the " + D.company.name + " page.");
    const wrapper = form.parentElement;
    wrapper.innerHTML =
      '<div class="success"><div class="big">' + icon("check") + "</div>" + '<h3>Thank you, we received your request.</h3>' +
      '<p class="muted">Reference <code>' + esc(lead.ref) + "</code>. " +
      (lead.hosted ? "Your request is screened by " + esc(CONFIG.hubName) + " and passed to the right team." : "The right team will contact you shortly.") + "</p>" +
      '<div class="btn-row" style="justify-content:center">' +
      (chat ? '<a class="btn btn-primary" target="_blank" rel="noopener" href="' + esc(chat) + '">' + icon("chat") + "Continue on WhatsApp</a>" : "") +
      '<a class="btn btn-light" href="' + esc(mailto) + '">Also send by email</a>' +
      '<a class="btn btn-dark" href="#/">Back to home</a></div></div>';
    wrapper.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---------------------------------------------------------------- admin

  function renderAdmin() {
    if (CONFIG) {
      app.innerHTML = pageHero("Team", "Leads are managed in the dashboard", "") +
        '<section class="section"><div class="wrap" style="max-width:560px"><div class="card">' +
        "<p>Inquiries from this portal are screened by <b>" + esc(CONFIG.hubName) + "</b> and introduced to your team.</p>" +
        '<a class="btn btn-dark" href="' + esc(CONFIG.dashboard) + '">Open dashboard</a></div></div></section>';
      return;
    }
    if (sessionStorage.getItem(STORAGE.adminOk) !== "1") {
      app.innerHTML = pageHero("Admin", "Team dashboard", "") +
        '<section class="section"><div class="wrap" style="max-width:420px"><div class="card">' +
        '<form id="pinForm" class="form" style="grid-template-columns:1fr"><label>Admin PIN<input type="password" name="pin" autofocus></label>' +
        '<button class="btn btn-dark" type="submit">Open dashboard</button>' +
        '<p class="form-note">Demo PIN is set in data.js (settings.adminPin). For production, protect this page on the server.</p></form>' +
        "</div></div></section>";
      document.getElementById("pinForm").addEventListener("submit", function (event) {
        event.preventDefault();
        const pin = new FormData(event.target).get("pin");
        if (String(pin) === String((D.settings || {}).adminPin || "1234")) {
          sessionStorage.setItem(STORAGE.adminOk, "1");
          renderAdmin();
        } else {
          toast("Wrong PIN");
        }
      });
      return;
    }

    app.innerHTML = pageHero("Admin", "Team dashboard", "Leads from all three audiences, engagement analytics and the content editor.") +
      '<section class="section"><div class="wrap">' +
      '<div class="tabs">' +
      ["leads", "analytics", "content"].map(function (tab) {
        return '<button class="tab' + (tab === adminTab ? " active" : "") + '" data-tab="' + tab + '">' + tab.charAt(0).toUpperCase() + tab.slice(1) + "</button>";
      }).join("") +
      '<button class="tab" data-tab="logout" style="margin-left:auto">Lock</button></div>' +
      '<div id="adminBody"></div></div></section>';

    app.querySelector(".tabs").addEventListener("click", function (event) {
      const tab = event.target.closest("[data-tab]");
      if (!tab) {
        return;
      }
      if (tab.dataset.tab === "logout") {
        sessionStorage.removeItem(STORAGE.adminOk);
        renderAdmin();
        return;
      }
      adminTab = tab.dataset.tab;
      renderAdmin();
    });

    const body = document.getElementById("adminBody");
    if (adminTab === "leads") {
      renderLeads(body);
    } else if (adminTab === "analytics") {
      renderAnalytics(body);
    } else {
      renderContentEditor(body);
    }
  }

  function renderLeads(body) {
    const leads = readJson(STORAGE.leads, []);
    const counts = { investor: 0, customer: 0, supplier: 0, general: 0 };
    let hot = 0;
    leads.forEach(function (lead) {
      counts[lead.type] = (counts[lead.type] || 0) + 1;
      if (scoreLabel(lead.score) === "hot") {
        hot += 1;
      }
    });
    const filter = body.dataset.filter || "all";

    body.innerHTML =
      '<div class="grid grid-4" style="margin-bottom:20px">' +
      '<div class="kpi"><span>Total leads</span><b>' + leads.length + "</b></div>" +
      '<div class="kpi"><span>Hot leads</span><b style="color:#b91c1c">' + hot + "</b></div>" +
      '<div class="kpi"><span>Customer RFQs</span><b>' + counts.customer + "</b></div>" +
      '<div class="kpi"><span>Investors / Suppliers</span><b>' + counts.investor + " / " + counts.supplier + "</b></div></div>" +
      '<div class="toolbar"><div class="chips" id="leadFilter">' +
      ["all", "customer", "investor", "supplier", "general"].map(function (f) {
        return '<button class="chip' + (f === filter ? " active" : "") + '" data-filter="' + f + '">' + f + "</button>";
      }).join("") + "</div>" +
      '<div class="btn-row" style="margin-left:auto"><button class="btn btn-light btn-sm" id="exportCsv">' + icon("download") + 'Export CSV</button>' +
      '<button class="btn btn-light btn-sm" id="demoLeads">+ Add demo leads</button></div></div>' +
      '<div class="card" style="padding:0;overflow-x:auto"><table class="data-table"><thead><tr>' +
      "<th>Date</th><th>Ref</th><th>Type</th><th>Contact</th><th>Score</th><th>Status</th><th></th></tr></thead><tbody>" +
      (leads.length ? "" : '<tr><td colspan="7" class="empty">No leads yet. Submit a form on the site, or add demo leads.</td></tr>') +
      leads.map(function (lead, index) {
        if (filter !== "all" && lead.type !== filter) {
          return "";
        }
        const f = lead.fields || {};
        const label = scoreLabel(lead.score);
        return (
          "<tr><td>" + esc(new Date(lead.date).toLocaleString()) + "</td>" +
          "<td><code>" + esc(lead.ref) + "</code></td>" +
          '<td><span class="type-tag ' + esc(lead.type) + '">' + esc(lead.type) + "</span></td>" +
          "<td><b>" + esc(f.company || f.firm || f.name || "") + "</b><br><span class=\"muted\">" + esc(f.name || "") + " · " + esc(f.email || "") + "</span></td>" +
          '<td><span class="score ' + label + '">' + label.toUpperCase() + " " + lead.score + "</span></td>" +
          '<td><select data-status="' + index + '">' + ["new", "contacted", "qualified", "won", "lost"].map(function (s) {
            return "<option" + (s === lead.status ? " selected" : "") + ">" + s + "</option>";
          }).join("") + "</select></td>" +
          '<td style="white-space:nowrap"><button class="btn btn-light btn-sm" data-details="' + index + '">Details</button> ' +
          '<button class="btn btn-danger btn-sm" data-delete="' + index + '" aria-label="Delete">' + icon("x") + "</button></td></tr>" +
          '<tr class="lead-details hidden" id="details-' + index + '"><td colspan="7"><pre>' +
          esc(Object.keys(f).map(function (key) {
            return key + ": " + asList(f[key]).join(", ");
          }).join("\n")) + "</pre></td></tr>"
        );
      }).join("") +
      "</tbody></table></div>";

    body.querySelector("#leadFilter").addEventListener("click", function (event) {
      const chip = event.target.closest("[data-filter]");
      if (chip) {
        body.dataset.filter = chip.dataset.filter;
        renderLeads(body);
      }
    });
    body.querySelectorAll("[data-status]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        const all = readJson(STORAGE.leads, []);
        all[Number(sel.dataset.status)].status = sel.value;
        writeJson(STORAGE.leads, all);
        toast("Status updated");
      });
    });
    body.querySelectorAll("[data-details]").forEach(function (button) {
      button.addEventListener("click", function () {
        document.getElementById("details-" + button.dataset.details).classList.toggle("hidden");
      });
    });
    body.querySelectorAll("[data-delete]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (!confirm("Delete this lead?")) {
          return;
        }
        const all = readJson(STORAGE.leads, []);
        all.splice(Number(button.dataset.delete), 1);
        writeJson(STORAGE.leads, all);
        renderLeads(body);
      });
    });
    body.querySelector("#exportCsv").addEventListener("click", function () {
      exportLeadsCsv(readJson(STORAGE.leads, []));
    });
    body.querySelector("#demoLeads").addEventListener("click", function () {
      addDemoLeads();
      renderLeads(body);
    });
  }

  function exportLeadsCsv(leads) {
    const fieldKeys = [];
    leads.forEach(function (lead) {
      Object.keys(lead.fields || {}).forEach(function (key) {
        if (fieldKeys.indexOf(key) === -1) {
          fieldKeys.push(key);
        }
      });
    });
    const header = ["ref", "date", "type", "status", "score"].concat(fieldKeys);
    const quote = function (value) {
      return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
    };
    const lines = [header.map(quote).join(",")].concat(leads.map(function (lead) {
      return [lead.ref, lead.date, lead.type, lead.status, lead.score].concat(fieldKeys.map(function (key) {
        return asList((lead.fields || {})[key]).join("; ");
      })).map(quote).join(",");
    }));
    download("leads-" + new Date().toISOString().slice(0, 10) + ".csv", "\ufeff" + lines.join("\r\n"), "text/csv");
  }

  function addDemoLeads() {
    const samples = [
      ["customer", { company: "Nordic Mining Drives AB", name: "Erik Lund", email: "erik@example.com", phone: "+46 000", volume: "500 – 5,000 pcs/yr", timeline: "1 – 3 months", items: ["HG-200 Spur & Helical Gears × 400"], attachment: "gear-drawing.pdf" }],
      ["investor", { name: "Maya Chen", firm: "Harbor Growth Partners", email: "maya@example.com", ticket: "USD 5–15M", investorType: "Private equity", nda: "yes", message: "Interested in industrial near-shoring plays with automation upside." }],
      ["supplier", { company: "Steelworks Ltd", name: "Ravi Kumar", email: "ravi@example.com", country: "India", website: "https://example.com", categories: ["Steel bar & forgings", "Castings"], certifications: ["ISO 9001", "ISO 14001"] }],
      ["customer", { company: "AquaBuild EPC", name: "Lina Park", email: "lina@example.com", volume: "Prototype / one-off", timeline: "Just budgeting", items: ["CP-80 Centrifugal Pump × 2"] }]
    ];
    const leads = readJson(STORAGE.leads, []);
    samples.forEach(function (sample, index) {
      leads.unshift({
        ref: "IC-DEMO" + (index + 1),
        type: sample[0],
        date: new Date(Date.now() - index * 86400000).toISOString(),
        status: "new",
        fields: sample[1],
        score: scoreLead(sample[0], sample[1])
      });
    });
    writeJson(STORAGE.leads, leads);
  }

  function renderAnalytics(body) {
    const views = readJson(STORAGE.views, {});
    const pages = Object.keys(views).filter(function (k) {
      return k.indexOf("page:") === 0;
    });
    const products = Object.keys(views).filter(function (k) {
      return k.indexOf("product:") === 0;
    });
    const bars = function (keys, prefix) {
      if (!keys.length) {
        return '<p class="muted">No data yet. Browse the site to generate views.</p>';
      }
      const max = Math.max.apply(null, keys.map(function (k) {
        return views[k];
      }));
      return keys.sort(function (a, b) {
        return views[b] - views[a];
      }).map(function (key) {
        let label = key.replace(prefix, "") || "home";
        const product = productById(label);
        if (product) {
          label = product.name;
        }
        return '<div class="bar-row"><span>' + esc(label) + '</span><div class="bar-track"><div class="bar-fill" style="width:' +
          ((views[key] / max) * 100).toFixed(0) + '%"></div></div><b>' + views[key] + "</b></div>";
      }).join("");
    };
    body.innerHTML =
      '<div class="grid grid-2"><div class="card"><h3>Section views</h3>' + bars(pages, "page:") + "</div>" +
      '<div class="card"><h3>Product interest</h3>' + bars(products, "product:") + "</div></div>" +
      '<p class="form-note" style="margin-top:12px">Analytics are stored in this browser only. For a live site, connect Google Analytics, Plausible or your CRM.</p>' +
      '<button class="btn btn-light btn-sm" id="resetViews">Reset analytics</button>';
    body.querySelector("#resetViews").addEventListener("click", function () {
      localStorage.removeItem(STORAGE.views);
      renderAnalytics(body);
    });
  }

  function renderContentEditor(body) {
    body.innerHTML =
      '<p class="muted">Edit company info, products, investor figures and supplier categories as JSON. ' +
      "<b>Save</b> previews changes in this browser; <b>Download data.js</b> to publish them (replace the file next to index.html).</p>" +
      '<textarea class="json-editor" id="jsonEditor" spellcheck="false"></textarea>' +
      '<div class="btn-row" style="margin-top:12px">' +
      '<button class="btn btn-primary" id="saveContent">Save & preview</button>' +
      '<button class="btn btn-light" id="downloadContent">' + icon("download") + 'Download data.js</button>' +
      '<button class="btn btn-danger" id="resetContent">Reset to original</button></div>';
    const editor = body.querySelector("#jsonEditor");
    editor.value = JSON.stringify(D, null, 2);

    body.querySelector("#saveContent").addEventListener("click", function () {
      try {
        const parsed = JSON.parse(editor.value);
        if (!parsed.company || !Array.isArray(parsed.products)) {
          throw new Error("Content must include 'company' and a 'products' list");
        }
        localStorage.setItem(STORAGE.dataOverride, JSON.stringify(parsed));
        D = parsed;
        applyBranding();
        toast("Saved. Changes are live in this browser");
      } catch (error) {
        toast("Invalid JSON: " + error.message);
      }
    });
    body.querySelector("#downloadContent").addEventListener("click", function () {
      download("data.js", "window.COMPANY_DATA = " + editor.value + ";\n", "text/javascript");
    });
    body.querySelector("#resetContent").addEventListener("click", function () {
      if (!confirm("Discard browser edits and reload the original data.js?")) {
        return;
      }
      localStorage.removeItem(STORAGE.dataOverride);
      D = window.COMPANY_DATA;
      applyBranding();
      renderContentEditor(body);
    });
  }

  function download(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(function () {
      URL.revokeObjectURL(link.href);
    }, 1000);
  }

  function renderNotFound() {
    app.innerHTML = pageHero("404", "Page not found", "") +
      '<section class="section"><div class="wrap"><a class="btn btn-dark" href="#/">Go home</a></div></section>';
  }

  // ---------------------------------------------------------------- chrome

  function applyBranding() {
    document.getElementById("brandName").textContent = D.company.name;
    document.title = D.company.name + " · " + D.company.tagline;
    const year = new Date().getFullYear();
    document.getElementById("footer").innerHTML =
      '<div class="wrap"><div class="footer-grid">' +
      "<div><h4>" + esc(D.company.name) + "</h4><p>" + esc(D.company.tagline) + "</p><p>" + esc(D.contact.address) + "</p></div>" +
      '<div><h4>Customers</h4><a href="#/products">Products</a><a href="#/capabilities">Capabilities</a><a href="#/quote">Request a quote</a></div>' +
      '<div><h4>Partners</h4><a href="#/investors">Investor relations</a><a href="#/suppliers">Supplier portal</a><a href="#/contact">Contact</a></div>' +
      "<div><h4>Contact</h4><a href=\"mailto:" + esc(D.contact.email) + "\">" + esc(D.contact.email) + "</a><a href=\"tel:" + esc(D.contact.phone) + "\">" + esc(D.contact.phone) + "</a></div>" +
      '</div><div class="legal"><span>© ' + year + " " + esc(D.company.legalName || D.company.name) + "</span>" +
      (CONFIG ? '<span>Connected via <a href="' + esc(CONFIG.hubUrl) + '" style="display:inline">' + esc(CONFIG.hubName) + "</a> · " +
        '<a href="' + esc(CONFIG.dashboard) + '" style="display:inline">Team login</a></span>'
        : '<a href="#/admin" style="display:inline">Team login</a>') + "</div></div>";
    if (CONFIG && CONFIG.status === "draft" && !document.getElementById("draftBanner")) {
      const banner = document.createElement("div");
      banner.id = "draftBanner";
      banner.style.cssText = "background:#fef3c7;color:#92400e;text-align:center;padding:8px;font-size:.9rem;font-weight:600";
      banner.textContent = "Draft preview: only you and " + CONFIG.hubName + " can see this page until it is published.";
      document.body.insertBefore(banner, document.body.firstChild);
    }
    updateAudienceButtons();
    renderWhatsappFab();
  }

  function updateAudienceButtons() {
    const audience = getAudience();
    document.querySelectorAll("#audSwitch button").forEach(function (button) {
      button.classList.toggle("active", button.dataset.aud === audience);
    });
  }

  function disposeViewer() {
    if (activeViewer) {
      activeViewer.dispose();
      activeViewer = null;
    }
  }

  const routes = {
    "": renderHome,
    products: renderProducts,
    product: renderProduct,
    compare: renderCompare,
    capabilities: renderCapabilities,
    investors: renderInvestors,
    suppliers: renderSuppliers,
    quote: renderQuote,
    contact: renderContact,
    admin: renderAdmin
  };

  function router() {
    disposeViewer();
    const path = location.hash.replace(/^#\/?/, "");
    const parts = path.split("/");
    const page = parts[0];
    const param = parts[1] ? decodeURIComponent(parts[1]) : undefined;
    const render = routes[page] || renderNotFound;
    if (page !== "admin") {
      trackView("page:" + page);
    }
    render(param);
    hydrateThumbnails(app);
    document.querySelectorAll("#mainNav a").forEach(function (link) {
      link.classList.toggle("active", link.dataset.nav === page || (page === "product" && link.dataset.nav === "products"));
    });
    document.getElementById("mainNav").classList.remove("open");
    renderCompareBar();
    window.scrollTo(0, 0);
  }

  // Global click handling (delegated)
  document.addEventListener("click", function (event) {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }
    const action = target.dataset.action;
    if (action === "add-quote") {
      addToBasket(target.dataset.id);
    } else if (action === "set-audience") {
      localStorage.setItem(STORAGE.audience, target.dataset.aud);
      updateAudienceButtons();
      const landing = { customer: "#/", investor: "#/", supplier: "#/" };
      if (location.hash === "" || location.hash === "#/" || location.hash === landing[target.dataset.aud]) {
        router();
      }
      toast("Showing content for " + target.dataset.aud + "s");
    } else if (action === "remove-basket") {
      const basket = getBasket();
      basket.splice(Number(target.dataset.index), 1);
      setBasket(basket);
      renderQuote();
    } else if (action === "clear-compare") {
      compareIds.clear();
      saveCompare();
      document.querySelectorAll('input[data-action="compare"]').forEach(function (box) {
        box.checked = false;
      });
      if (location.hash.indexOf("#/compare") === 0) {
        renderCompare();
      }
    } else if (action === "print") {
      window.print();
    }
  });

  document.addEventListener("change", function (event) {
    const box = event.target;
    if (box.dataset && box.dataset.action === "compare") {
      if (box.checked) {
        if (compareIds.size >= 4) {
          box.checked = false;
          toast("Compare up to 4 products");
          return;
        }
        compareIds.add(box.dataset.id);
      } else {
        compareIds.delete(box.dataset.id);
      }
      saveCompare();
    }
  });

  document.getElementById("menuBtn").addEventListener("click", function () {
    document.getElementById("mainNav").classList.toggle("open");
  });

  window.addEventListener("hashchange", router);
  applyBranding();
  updateBasketCount();
  router();
})();
