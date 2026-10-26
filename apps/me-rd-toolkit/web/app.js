/* ME R&D Toolkit – core: state, data pack, navigation, workspace views, events.
   Company content is never part of this code: it comes from a data pack (private/pack.js or an imported .json). */
(function () {
  "use strict";

  const STORE_KEY = "meRd.v2";
  const LEGACY_KEY = "meRdToolkit.v1";
  const APP = (window.APP = { VIEWS: {}, CALCS: [] });
  const isLocalFile = location.protocol === "file:";
  let serverMode = false;

  // ------------------------------------------------------------------ state
  function loadState() {
    let state = null;
    try {
      state = JSON.parse(localStorage.getItem(STORE_KEY));
    } catch (error) {
      state = null;
    }
    if (!state) {
      state = { projects: {}, activeId: null, stars: {}, recent: [], theme: null };
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
        if (legacy && legacy.projects) {
          state.projects = legacy.projects;
          state.activeId = legacy.activeId;
        }
      } catch (error) {
        console.warn(error);
      }
    }
    state.stars = state.stars || {};
    state.recent = state.recent || [];
    Object.values(state.projects).forEach((p) => {
      p.flow = p.flow || {};
      p.cl = p.cl || {};
      p.issues = p.issues || [];
      p.milestones = p.milestones || {};
    });
    return state;
  }

  let state = loadState();

  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function activeProject() {
    return state.activeId ? state.projects[state.activeId] || null : null;
  }

  // ------------------------------------------------------------------ IndexedDB (imported data pack)
  function idb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("me-rd-toolkit", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("kv");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbGet(key) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const request = db.transaction("kv").objectStore("kv").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbSet(key, value) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      if (value === undefined) {
        tx.objectStore("kv").delete(key);
      } else {
        tx.objectStore("kv").put(value, key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ------------------------------------------------------------------ data pack
  let P = null;
  let packSource = "demo";

  function normalizePack(pack) {
    const p = Object.assign({}, pack);
    ["checklists", "flow", "rules", "lessons", "sops", "projects", "library"].forEach((k) => {
      p[k] = Array.isArray(p[k]) ? p[k] : [];
    });
    p.meta = p.meta || {};
    p.calc = p.calc || {};
    return p;
  }

  async function loadPack() {
    if (window.ME_PACK && !(window.ME_PACK.meta && window.ME_PACK.meta.demo)) {
      P = normalizePack(window.ME_PACK);
      packSource = "local";
      return;
    }
    try {
      const stored = await Promise.race([
        idbGet("pack"),
        new Promise((resolve) => setTimeout(() => resolve(null), 1500))
      ]);
      if (stored) {
        P = normalizePack(stored);
        packSource = "imported";
        return;
      }
    } catch (error) {
      console.warn("IndexedDB unavailable", error);
    }
    P = normalizePack(window.ME_DEMO_PACK);
    packSource = "demo";
  }

  // ------------------------------------------------------------------ helpers
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function highlight(text, query) {
    const safe = esc(text);
    if (!query) {
      return safe;
    }
    const pattern = new RegExp("(" + esc(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
    return safe.replace(pattern, "<mark>$1</mark>");
  }

  const pathAliases = window.ME_PATH_ALIASES || {};
  let hideTerms = (window.ME_HIDE_TERMS || []).slice();

  // Display-only: removes configured private terms from names and paths shown on screen.
  function clean(value) {
    let result = String(value == null ? "" : value);
    hideTerms.forEach((term) => {
      const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      result = result.replace(pattern, "");
    });
    return hideTerms.length ? result.replace(/([_\- ])[_\- ]+/g, "$1").replace(/\(\s*\)/g, "") : result;
  }

  // Expands "[Alias]\rest" to the real location when a local alias map is present.
  function expandPath(path) {
    const match = /^(\[[^\]]+\])(.*)$/.exec(path || "");
    return match && pathAliases[match[1]] ? pathAliases[match[1]] + match[2] : path;
  }

  function fileUrl(path) {
    path = expandPath(path);
    if (path.startsWith("\\\\")) {
      return "file://" + path.slice(2).split("\\").map(encodeURIComponent).join("/");
    }
    const parts = path.split("\\");
    return "file:///" + parts[0] + "/" + parts.slice(1).map(encodeURIComponent).join("/");
  }

  function extOf(name) {
    const match = /\.([a-z0-9]{2,5})$/i.exec(name || "");
    return match ? match[1].toLowerCase() : "";
  }

  function baseName(path) {
    return String(path || "").split("\\").pop();
  }

  function docLink(name, path, query) {
    if (!path) {
      return esc(name);
    }
    const ext = extOf(name) || extOf(path) || "dir";
    const label = '<span class="nm">' + highlight(clean(name), query) + "</span>";
    const href = serverMode ? "file?abs=" + encodeURIComponent(path) : (isLocalFile ? fileUrl(path) : "");
    const link = href
      ? '<a href="' + href + '" target="_blank" title="' + esc(clean(path)) + '">' + label + "</a>"
      : '<span title="' + esc(clean(path)) + '">' + label + "</span>";
    return '<span class="doc-link"><span class="ext ' + ext + '">' + ext + "</span>" + link +
      '<button class="copy" data-copy="' + esc(expandPath(path)) + '" title="Copy full path">⧉</button></span>';
  }

  function folderLink(path, label) {
    if (!path) {
      return "";
    }
    const text = esc(label || "Folder");
    if (serverMode) {
      return '<a href="#vault?abs=' + encodeURIComponent(path) + '">' + text + "</a>" + '<button class="copy" data-copy="' + esc(expandPath(path)) + '" title="Copy path">⧉</button>';
    }
    return (isLocalFile ? '<a href="' + fileUrl(path) + '" target="_blank" title="' + esc(clean(path)) + '">' + text + "</a>" : "") +
      '<button class="copy" data-copy="' + esc(expandPath(path)) + '" title="Copy path">⧉</button>';
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
      return;
    } catch (error) {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      toast("Copied");
    }
  }

  let toastTimer = null;
  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.add("hidden"), 2200);
  }

  function openModal(html) {
    $("#modal-card").innerHTML = html;
    $("#modal").classList.remove("hidden");
  }

  function closeModal() {
    $("#modal").classList.add("hidden");
  }

  function num(id) {
    const element = document.getElementById(id);
    return element ? parseFloat(element.value) : NaN;
  }

  function fmt(value, digits) {
    return isFinite(value) ? Number(value).toFixed(digits == null ? 3 : digits) : "—";
  }

  function parseNumbers(text) {
    return String(text || "").split(/[\s,;]+/).map(parseFloat).filter((v) => isFinite(v));
  }

  function mean(values) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function stdev(values) {
    if (values.length < 2) {
      return NaN;
    }
    const m = mean(values);
    return Math.sqrt(values.reduce((a, v) => a + (v - m) * (v - m), 0) / (values.length - 1));
  }

  function erf(x) {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
    return sign * y;
  }

  function normCdf(x, mu, sigma) {
    return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
  }

  function verdict(ok, okText, ngText, warn) {
    const cls = warn ? "warn" : (ok ? "ok" : "ng");
    return '<span class="verdict ' + cls + '">' + esc(ok ? okText : ngText) + "</span>";
  }

  function cleanPhase(name) {
    return String(name || "").replace(/\s*\n\s*/g, " ");
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  const ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    flow: '<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="18" cy="6" r="2"/><circle cx="15" cy="18" r="2"/>',
    check: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 9l2 2 4-4M8 15h8"/>',
    report: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 13h6M9 17h6M9 9h3"/>',
    issue: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
    rules: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M16 12v5M8 16h2M12 16h2"/>',
    material: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    test: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3"/>',
    lesson: '<path d="M12 3a6 6 0 00-3.5 10.9V17h7v-3.1A6 6 0 0012 3z"/><path d="M9.5 21h5"/>',
    sop: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    approval: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    library: '<path d="M5 4h3v16H5zM10 4h3v16h-3z"/><path d="M15.5 4.5l2.9-.8 3.6 15.4-2.9.7z"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    data: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 3.5M12 17h.01"/>',
    vault: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5V7M15.5 12H17M7 20v1M17 20v1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
  };

  function icon(name) {
    return '<svg class="i" viewBox="0 0 24 24">' + (ICONS[name] || "") + "</svg>";
  }

  // ------------------------------------------------------------------ pack accessors
  function checklists() {
    return P.checklists;
  }

  function checklistByKey(key) {
    return P.checklists.find((c) => c.key === key) || P.checklists[0];
  }

  function checklistStats(project, key) {
    const list = checklistByKey(key);
    const stats = { total: list ? list.items.length : 0, OK: 0, NG: 0, NA: 0 };
    const results = (project && project.cl[key]) || {};
    (list ? list.items : []).forEach((item) => {
      const r = results[item.id] && results[item.id].r;
      if (r && stats[r] != null) {
        stats[r] += 1;
      }
    });
    stats.done = stats.OK + stats.NG + stats.NA;
    return stats;
  }

  const FLOW_STATUS = [
    { v: "PASS", label: "PASS", cls: "OK" },
    { v: "ON", label: "On going", cls: "ON" },
    { v: "FAIL", label: "FAIL", cls: "NG" },
    { v: "NA", label: "NA", cls: "NA" }
  ];

  let phaseCache = null;
  function flowPhases() {
    if (phaseCache) {
      return phaseCache;
    }
    const phases = [];
    P.flow.forEach((step, index) => {
      const name = cleanPhase(step.phase);
      let phase = phases.find((p) => p.name === name);
      if (!phase) {
        phase = { name: name, steps: [] };
        phases.push(phase);
      }
      phase.steps.push(Object.assign({ index: index }, step));
    });
    phaseCache = phases;
    return phases;
  }

  function flowStats(project, steps) {
    const flow = (project && project.flow) || {};
    const stats = { total: steps.length, PASS: 0, ON: 0, FAIL: 0, NA: 0 };
    steps.forEach((s) => {
      const status = flow[s.index] && flow[s.index].s;
      if (status && stats[status] != null) {
        stats[status] += 1;
      }
    });
    return stats;
  }

  function progressBar(ok, ng, na, on, total) {
    const pct = (v) => (total ? (100 * v / total).toFixed(1) : 0) + "%";
    return '<div class="progress" title="' + ok + " ok · " + ng + " ng · " + (on || 0) + " on going · " + na + " na / " + total + '">' +
      '<span class="p-ok" style="width:' + pct(ok) + '"></span><span class="p-on" style="width:' + pct(on || 0) + '"></span>' +
      '<span class="p-ng" style="width:' + pct(ng) + '"></span><span class="p-na" style="width:' + pct(na) + '"></span></div>';
  }

  function projectSummary(p) {
    const allSteps = flowPhases().reduce((a, ph) => a.concat(ph.steps), []);
    const fs = flowStats(p, allSteps);
    let clDone = 0;
    let clTotal = 0;
    let ng = 0;
    P.checklists.forEach((c) => {
      const s = checklistStats(p, c.key);
      clDone += s.done;
      clTotal += s.total;
      ng += s.NG;
    });
    const openIssues = p.issues.filter((i) => i.status !== "closed").length;
    const overdue = Object.entries(p.milestones).filter(([phase, date]) => {
      if (!date || date >= today()) {
        return false;
      }
      const ph = flowPhases().find((x) => x.name === phase);
      if (!ph) {
        return false;
      }
      const s = flowStats(p, ph.steps);
      return s.PASS + s.NA < s.total;
    }).length;
    const total = allSteps.length + clTotal;
    const done = fs.PASS + fs.NA + clDone;
    return { fs: fs, clDone: clDone, clTotal: clTotal, ng: ng, openIssues: openIssues, overdue: overdue, pct: total ? Math.round(100 * done / total) : 0 };
  }

  function isStarred(id) {
    return !!state.stars[id];
  }

  function starButton(id, label, href) {
    return '<button class="star' + (isStarred(id) ? " on" : "") + '" data-action="star" data-id="' + esc(id) + '" data-label="' + esc(label) +
      '" data-href="' + esc(href) + '" title="Bookmark">' + (isStarred(id) ? "★" : "☆") + "</button>";
  }

  // ------------------------------------------------------------------ navigation
  const NAV = [
    { group: "Workspace" },
    { id: "home", label: "Dashboard", icon: "home" },
    { id: "guide", label: "How to use", icon: "help" },
    { id: "flow", label: "NPI Dev Flow", icon: "flow", count: () => P.flow.length },
    { id: "checklists", label: "Checklists", icon: "check", count: () => P.checklists.reduce((a, c) => a + c.items.length, 0) },
    { id: "issues", label: "Issue Log", icon: "issue", count: () => { const p = activeProject(); return p ? p.issues.filter((i) => i.status !== "closed").length : 0; } },
    { id: "report", label: "Project Report", icon: "report" },
    { id: "starred", label: "Bookmarks", icon: "star", count: () => Object.keys(state.stars).length },
    { group: "Engineering" },
    { id: "rules", label: "Design Rules", icon: "rules", count: () => P.rules.length },
    { id: "calc", label: "Calculators", icon: "calc", count: () => APP.CALCS.length },
    { id: "materials", label: "Materials", icon: "material", need: () => P.ulMaterials },
    { id: "tests", label: "Tests & Reliability", icon: "test", need: () => P.tests },
    { id: "lessons", label: "Lessons Learned", icon: "lesson", count: () => P.lessons.length, need: () => P.lessons.length },
    { group: "Procedures" },
    { id: "sops", label: "SOPs", icon: "sop", count: () => P.sops.length, need: () => P.sops.length },
    { id: "approval", label: "Part Approval", icon: "approval", need: () => P.approval },
    { group: "Files" },
    { id: "vault", label: "File Vault", icon: "vault" },
    { id: "projects", label: "Project Folders", icon: "folder", count: () => P.projects.length, need: () => P.projects.length },
    { id: "library", label: "Library", icon: "library", count: () => P.library.length, need: () => P.library.length },
    { group: "Settings" },
    { id: "data", label: "Data & Backup", icon: "data" }
  ];

  const BOTTOM = [
    { id: "home", label: "Home", icon: "home" },
    { id: "checklists", label: "Checklists", icon: "check" },
    { id: "calc", label: "Calc", icon: "calc" },
    { id: "vault", label: "Vault", icon: "vault" },
    { id: "menu", label: "More", icon: "menu" }
  ];

  function renderChrome(current) {
    const items = NAV.filter((n) => !n.need || n.need());
    let html = "";
    items.forEach((n, i) => {
      if (n.group) {
        const next = items[i + 1];
        if (next && !next.group) {
          html += '<div class="nav-group">' + n.group + "</div>";
        }
        return;
      }
      const count = n.count ? n.count() : 0;
      html += '<a href="#' + n.id + '" class="' + (n.id === current ? "active" : "") + '">' + icon(n.icon) + '<span class="lbl">' + n.label + "</span>" +
        (count ? '<span class="count">' + count + "</span>" : "") + "</a>";
    });
    $("#nav").innerHTML = html;
    $("#bottombar").innerHTML = BOTTOM.map((b) => b.id === "menu"
      ? '<a href="#" data-action="drawer">' + icon(b.icon) + b.label + "</a>"
      : '<a href="#' + b.id + '" class="' + (b.id === current ? "active" : "") + '">' + icon(b.icon) + b.label + "</a>").join("");
    $("#pack-label").textContent = packSource === "demo" ? "Demo data – load your pack" : (P.meta.name || "Data pack") + (P.meta.generated ? " · " + P.meta.generated : "");
    const select = $("#active-select");
    const ids = Object.keys(state.projects);
    select.innerHTML = '<option value="">' + (ids.length ? "— select project —" : "No project yet") + "</option>" + ids.map((id) => {
      const p = state.projects[id];
      return '<option value="' + id + '"' + (id === state.activeId ? " selected" : "") + ">" + esc(p.name) + (p.customer ? " · " + esc(p.customer) : "") + "</option>";
    }).join("");
    $("#theme-btn").innerHTML = icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon");
    $("#menu-btn").innerHTML = icon("menu");
  }

  function parseHash() {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    const [pathPart, queryPart] = hash.split("?");
    const segments = (pathPart || "home").split("/");
    const params = {};
    (queryPart || "").split("&").forEach((pair) => {
      if (pair) {
        const index = pair.indexOf("=");
        params[index < 0 ? pair : pair.slice(0, index)] = index < 0 ? "" : pair.slice(index + 1);
      }
    });
    return { view: segments[0] || "home", sub: segments[1], params: params };
  }

  function setHashQuiet(hash) {
    history.replaceState(null, "", hash);
  }

  function route() {
    const r = parseHash();
    const view = APP.VIEWS[r.view] ? r.view : "home";
    document.body.classList.remove("drawer-open");
    renderChrome(view);
    $("#view").innerHTML = "";
    APP.VIEWS[view](r);
    if (!r.params.keep) {
      window.scrollTo(0, 0);
    }
  }

  function rerenderKeepingFocus(selector) {
    const input = selector ? $(selector) : null;
    const pos = input ? input.selectionStart : 0;
    const scroll = window.scrollY;
    APP.VIEWS[parseHash().view](parseHash());
    renderChrome(parseHash().view);
    window.scrollTo(0, scroll);
    const again = selector ? $(selector) : null;
    if (again) {
      again.focus();
      again.setSelectionRange(pos, pos);
    }
  }

  function bindFilter(selector, build) {
    const input = $(selector);
    if (!input) {
      return;
    }
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setHashQuiet(build());
        rerenderKeepingFocus(selector);
      }, 220);
    });
  }

  function needProjectBanner(what) {
    return '<div class="card banner" style="margin:12px 0"><b>No active project.</b> Create or select a tracked project to save ' + what +
      ' status. <button class="btn small primary" data-action="new-project">+ New project</button></div>';
  }

  function demoBanner() {
    if (packSource !== "demo") {
      return "";
    }
    return '<div class="card banner" style="margin:14px 0"><b>Demo data.</b> This public build ships without company content. ' +
      'Open the app from your team vault link, or load your private data pack (.json) under <a href="#data">Data &amp; Backup</a>. New here? Read <a href="#guide">How to use</a>.</div>';
  }

  // ------------------------------------------------------------------ Dashboard
  APP.VIEWS.home = function () {
    const project = activeProject();
    const ids = Object.keys(state.projects);
    let html = demoBanner();
    if (project) {
      const s = projectSummary(project);
      const nextMilestone = Object.entries(project.milestones).filter(([, d]) => d && d >= today()).sort((a, b) => a[1].localeCompare(b[1]))[0];
      html += '<div class="card hero" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">' +
        '<div class="ring" style="--p:' + s.pct + '"><b>' + s.pct + "%</b></div>" +
        '<div style="flex:1;min-width:200px"><div class="muted small">Active project</div><h1 style="margin:2px 0">' + esc(project.name) + "</h1>" +
        '<div class="muted">' + esc(project.customer || "") + (project.phase ? " · phase <b>" + esc(project.phase) + "</b>" : "") +
        (nextMilestone ? " · next: " + esc(nextMilestone[0]) + " " + esc(nextMilestone[1]) : "") + "</div></div>" +
        '<div class="toolbar" style="margin:0"><a class="btn small" href="#checklists">Checklists</a><a class="btn small" href="#flow">Flow</a><a class="btn small" href="#report">Report</a></div></div>';
      html += '<div class="grid cols-4" style="margin-top:14px">' +
        kpi(s.ng, "NG checklist items", s.ng ? "ng" : "ok", "#report") +
        kpi(s.fs.FAIL, "Flow tasks FAIL", s.fs.FAIL ? "ng" : "ok", "#flow") +
        kpi(s.openIssues, "Open issues", s.openIssues ? "warn" : "ok", "#issues") +
        kpi(s.overdue, "Overdue milestones", s.overdue ? "ng" : "ok", "#flow") + "</div>";
    } else {
      html += "<h1>ME R&amp;D Toolkit</h1><div class=\"muted\">NPI flow, checklists, design rules, calculators, lessons learned, SOPs and project files in one place.</div>";
    }

    html += '<h2>Tracked projects <button class="btn small primary" data-action="new-project">+ New</button></h2>';
    html += ids.length
      ? '<div class="grid cols-3">' + ids.map((id) => projectCard(state.projects[id])).join("") + "</div>"
      : '<div class="card muted">No tracked projects yet. Click <b>+ New</b>' + (P.projects.length ? ', or open <a href="#projects">Project Folders</a> and press <b>Track</b>' : "") + ".</div>";

    const tiles = [
      ["#flow", "flow", "NPI Dev Flow", P.flow.length + " tasks"],
      ["#checklists", "check", "Checklists", P.checklists.length + " lists"],
      ["#calc", "calc", "Calculators", "Cpk · TA · torque · snap-fit"],
      ["#rules", "rules", "Design Rules", P.rules.length + " topics"],
      ["#lessons", "lesson", "Lessons Learned", P.lessons.length + " cases"],
      ["#sops", "sop", "SOPs", P.sops.length + " procedures"],
      ["#library", "library", "Library", P.library.length + " documents"],
      ["#issues", "issue", "Issue Log", "Track open problems"]
    ];
    html += '<h2>Quick access</h2><div class="grid cols-4">' + tiles.map((t) =>
      '<div class="card tile" data-go="' + t[0] + '"><div class="ti">' + icon(t[1]) + '</div><div><h3 style="margin:0">' + t[2] + '</h3><div class="muted small">' + t[3] + "</div></div></div>").join("") + "</div>";

    if (state.recent.length) {
      html += '<h2>Recently viewed</h2><div class="chips">' + state.recent.map((r) => '<a class="chip" href="' + esc(r.href) + '">' + esc(r.label) + "</a>").join("") + "</div>";
    }
    if (P.projects.length) {
      const recent = P.projects.slice().sort((a, b) => (b.latest || "").localeCompare(a.latest || "")).slice(0, 6);
      html += '<h2>Recently active folders</h2><div class="table-wrap"><table><thead><tr><th>Customer</th><th>Model</th><th class="hide-mobile">Files</th><th>Last change</th><th></th></tr></thead><tbody>' +
        recent.map((p) => "<tr><td>" + esc(p.customer) + "</td><td><b>" + esc(p.model) + '</b></td><td class="hide-mobile">' + p.files + "</td><td>" + esc(p.latest) + "</td><td>" + folderLink(p.path) + "</td></tr>").join("") +
        "</tbody></table></div>";
    }
    $("#view").innerHTML = html;
  };

  function kpi(value, label, cls, href) {
    return '<div class="card kpi tile ' + cls + '" data-go="' + href + '" style="display:flex"><span class="v">' + value + '</span><span class="l">' + label + "</span></div>";
  }

  function projectCard(p) {
    const s = projectSummary(p);
    const rows = P.checklists.slice(0, 5).map((c) => {
      const cs = checklistStats(p, c.key);
      return '<div class="small" style="margin-top:7px">' + esc(c.name) + ' <span class="muted">' + cs.done + "/" + cs.total +
        (cs.NG ? ' · <span style="color:var(--ng)">' + cs.NG + " NG</span>" : "") + "</span>" + progressBar(cs.OK, cs.NG, cs.NA, 0, cs.total) + "</div>";
    }).join("");
    return '<div class="card"><h3 style="display:flex;justify-content:space-between;gap:8px">' + esc(p.name) + '<span class="pill blue">' + esc(p.phase || "—") + "</span></h3>" +
      '<div class="muted small">' + esc(p.customer || "") + (p.line ? " · " + esc(p.line) : "") + " · " + s.pct + "% done" + (s.openIssues ? " · " + s.openIssues + " open issues" : "") + "</div>" +
      '<div class="small" style="margin-top:10px">NPI flow <span class="muted">' + (s.fs.PASS + s.fs.NA) + "/" + s.fs.total + "</span>" + progressBar(s.fs.PASS, s.fs.FAIL, s.fs.NA, s.fs.ON, s.fs.total) + "</div>" + rows +
      '<div class="toolbar"><button class="btn small primary" data-action="activate" data-id="' + p.id + '">Open</button>' + folderLink(p.folder, "Folder") +
      '<span class="spacer"></span><button class="btn small" data-action="edit-project" data-id="' + p.id + '">Edit</button></div></div>';
  }

  // ------------------------------------------------------------------ project form
  const LINES = ["Broadband / Router / Switch", "IP Cam", "IP Phone", "Wearable", "VR", "Packing", "Automation", "Other"];

  function projectForm(project, preset) {
    const p = project || preset || {};
    const phases = flowPhases().map((ph) => ph.name);
    const milestones = p.milestones || {};
    openModal("<h3>" + (project ? "Edit project" : "New tracked project") + "</h3>" +
      '<div class="form-row"><label>Model / project name *</label><input id="pf-name" value="' + esc(p.name || "") + '"></div>' +
      '<div class="form-grid"><div class="form-row"><label>Customer</label><input id="pf-customer" value="' + esc(p.customer || "") + '"></div>' +
      '<div class="form-row"><label>Product line</label><select id="pf-line">' + LINES.map((l) => "<option" + (l === p.line ? " selected" : "") + ">" + l + "</option>").join("") + "</select></div>" +
      '<div class="form-row"><label>Current phase</label><select id="pf-phase">' + phases.map((ph) => "<option" + (ph === p.phase ? " selected" : "") + ">" + esc(ph) + "</option>").join("") + "</select></div></div>" +
      '<div class="form-row"><label>Project folder (optional)</label><input id="pf-folder" value="' + esc(p.folder || "") + '"></div>' +
      '<div class="form-row"><label>Phase target dates (milestones)</label><div class="form-grid">' + phases.map((ph, i) =>
        '<div><div class="small muted">' + esc(ph) + '</div><input type="date" data-ms="' + i + '" value="' + esc(milestones[ph] || "") + '" style="width:100%"></div>').join("") + "</div></div>" +
      '<div class="toolbar">' + (project ? '<button class="btn danger" data-action="delete-project" data-id="' + project.id + '">Delete</button>' : "") +
      '<span class="spacer"></span><button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" data-action="save-project" data-id="' + (project ? project.id : "") + '">Save</button></div>');
    $("#pf-name").focus();
  }

  function saveProjectFromForm(id) {
    const name = $("#pf-name").value.trim();
    if (!name) {
      toast("Name is required");
      return;
    }
    const project = (id && state.projects[id]) || { id: "p" + Date.now().toString(36), created: new Date().toISOString(), flow: {}, cl: {}, issues: [], milestones: {} };
    project.name = name;
    project.customer = $("#pf-customer").value.trim();
    project.line = $("#pf-line").value;
    project.phase = $("#pf-phase").value;
    project.folder = $("#pf-folder").value.trim();
    const phases = flowPhases().map((ph) => ph.name);
    project.milestones = {};
    $$("[data-ms]").forEach((input) => {
      if (input.value) {
        project.milestones[phases[+input.dataset.ms]] = input.value;
      }
    });
    state.projects[project.id] = project;
    state.activeId = project.id;
    saveState();
    closeModal();
    toast("Saved " + name);
    route();
  }

  // ------------------------------------------------------------------ NPI flow
  APP.VIEWS.flow = function (r) {
    const project = activeProject();
    const phases = flowPhases();
    const showOnly = r.params.phase;
    const disabled = project ? "" : " disabled";
    let html = "<h1>NPI Development Flow</h1><div class=\"muted\">" + P.flow.length + " ME tasks" + (P.flowSrc ? " · source " + docLink(baseName(P.flowSrc), P.flowSrc) : "") + "</div>";
    if (!project) {
      html += needProjectBanner("flow");
    }
    html += '<div class="timeline">' + phases.map((ph) => {
      const s = flowStats(project, ph.steps);
      const date = project && project.milestones[ph.name];
      const late = date && date < today() && s.PASS + s.NA < s.total;
      return '<div class="tl' + (project && project.phase === ph.name ? " current" : "") + '" data-go="#flow?phase=' + encodeURIComponent(ph.name) + '"><b>' + esc(ph.name) + "</b>" +
        progressBar(s.PASS, s.FAIL, s.NA, s.ON, s.total) + '<div class="d' + (late ? " late" : "") + '">' + (s.PASS + s.NA) + "/" + s.total + (date ? " · " + esc(date) : "") + "</div></div>";
    }).join("") + "</div>";
    html += '<div class="toolbar no-print">' + (showOnly ? '<a class="btn small" href="#flow">Show all phases</a>' : "") +
      '<span class="spacer"></span>' + (project ? '<button class="btn small" data-action="export-flow">Export CSV</button>' : "") + '<button class="btn small" onclick="window.print()">Print</button></div>';

    phases.forEach((ph) => {
      if (showOnly && showOnly !== ph.name) {
        return;
      }
      const s = flowStats(project, ph.steps);
      const open = showOnly || (project ? project.phase === ph.name : ph === phases[0]);
      html += '<details class="card phase"' + (open ? " open" : "") + "><summary><h3>" + esc(ph.name) + "</h3>" + progressBar(s.PASS, s.FAIL, s.NA, s.ON, s.total) +
        '<span class="muted small">' + s.PASS + " pass · " + s.ON + " on going · " + s.FAIL + " fail · " + s.NA + " NA / " + s.total + "</span></summary>";
      let lastStage = null;
      ph.steps.forEach((step) => {
        if (step.stage !== lastStage) {
          html += '<div class="stage">' + esc(step.stage) + "</div>";
          lastStage = step.stage;
        }
        const entry = (project && project.flow[step.index]) || {};
        html += '<div class="flow-row"><div><div class="task">' + esc(step.task) + "</div>" + (step.note ? '<div class="fnote">' + esc(step.note) + "</div>" : "") + "</div>" +
          '<div><div class="seg">' + FLOW_STATUS.map((st) => '<button data-action="flow-status" data-idx="' + step.index + '" data-v="' + st.v + '" class="' +
            (entry.s === st.v ? "on-" + st.cls : "") + '"' + disabled + ">" + st.label + "</button>").join("") + "</div></div>" +
          '<div><input placeholder="PIC" data-flow-field="pic" data-idx="' + step.index + '" value="' + esc(entry.pic || "") + '" style="width:100%"' + disabled + "></div>" +
          '<div><textarea rows="1" placeholder="Remark / date / report" data-flow-field="note" data-idx="' + step.index + '"' + disabled + ">" + esc(entry.note || "") + "</textarea></div></div>";
      });
      html += "</details>";
    });
    $("#view").innerHTML = html;
  };

  // ------------------------------------------------------------------ checklists
  APP.VIEWS.checklists = function (r) {
    if (!P.checklists.length) {
      $("#view").innerHTML = "<h1>Checklists</h1>" + demoBanner();
      return;
    }
    const list = checklistByKey(r.sub);
    const project = activeProject();
    const query = (r.params.q || "").trim();
    const filter = r.params.f || "all";
    const cat = r.params.cat || "";
    const results = (project && project.cl[list.key]) || {};
    const disabled = project ? "" : " disabled";
    remember("Checklist · " + list.name, "#checklists/" + list.key);

    let html = "<h1>Checklists</h1>" + demoBanner();
    html += '<div class="tabs">' + P.checklists.map((c) => {
      const s = checklistStats(project, c.key);
      return '<button data-go="#checklists/' + c.key + '" class="' + (c.key === list.key ? "active" : "") + '">' + esc(c.name) +
        ' <span class="muted small">' + (project ? s.done + "/" : "") + s.total + "</span></button>";
    }).join("") + "</div>";
    const s = checklistStats(project, list.key);
    html += '<div class="muted small">Stage <b>' + esc(list.stage || "—") + "</b>" + (list.src ? " · source " + docLink(baseName(list.src), list.src) : "") + "</div>";
    if (!project) {
      html += needProjectBanner("checklist");
    }

    const categories = [];
    list.items.forEach((i) => {
      if (!categories.includes(i.catEn)) {
        categories.push(i.catEn);
      }
    });
    html += '<div class="sticky-head no-print">' +
      (project ? '<div style="max-width:560px">' + progressBar(s.OK, s.NG, s.NA, 0, s.total) + '<div class="small muted" style="margin:4px 0 8px">' + s.OK + " OK · " + s.NG + " NG · " + s.NA + " NA · " + (s.total - s.done) + " open — <b>" + esc(project.name) + "</b></div></div>" : "") +
      '<div class="toolbar" style="margin:0 0 8px"><input id="cl-search" type="search" placeholder="Filter items…" value="' + esc(query) + '" style="flex:1;min-width:160px;max-width:320px">' +
      '<select id="cl-filter">' + [["all", "All"], ["open", "Open"], ["NG", "NG"], ["OK", "OK"], ["NA", "NA"]].map((o) => '<option value="' + o[0] + '"' + (o[0] === filter ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select>" +
      '<span class="spacer"></span>' + (project ? '<button class="btn small" data-action="export-cl" data-key="' + list.key + '">CSV</button><button class="btn small" data-action="reset-cl" data-key="' + list.key + '">Reset</button>' : "") +
      '<button class="btn small" onclick="window.print()">Print</button></div>' +
      '<div class="chips"><button class="chip' + (cat ? "" : " active") + '" data-cat="">All</button>' + categories.map((c) => '<button class="chip' + (c === cat ? " active" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + "</button>").join("") + "</div></div>";

    const q = query.toLowerCase();
    let lastCat = null;
    let shown = 0;
    list.items.forEach((item) => {
      const res = results[item.id] || {};
      if (cat && item.catEn !== cat) {
        return;
      }
      if (filter === "open" && res.r) {
        return;
      }
      if (["NG", "OK", "NA"].includes(filter) && res.r !== filter) {
        return;
      }
      if (q && ![item.title, item.cat, item.catEn].concat(item.spec, item.fill, item.note).join(" ").toLowerCase().includes(q)) {
        return;
      }
      if (item.catEn !== lastCat) {
        html += '<div class="cat-head"><h3>' + esc(item.catEn) + "</h3>" + (item.cat && item.cat !== item.catEn ? '<span class="muted small">' + esc(item.cat.replace(/\n/g, " ")) + "</span>" : "") + "</div>";
        lastCat = item.catEn;
      }
      shown += 1;
      const bodyLength = item.spec.join("").length + item.fill.join("").length + item.note.join("").length;
      const clamp = bodyLength > 380 && !q;
      html += '<div class="cl-item r-' + (res.r || "") + '" id="' + item.id + '"><div>' +
        '<div class="cl-head"><span class="cl-no">' + esc(item.no) + '</span><span class="cl-title">' + highlight(item.title, query) + "</span>" +
        starButton("cl:" + item.id, list.name + " #" + item.no + " " + item.title, "#checklists/" + list.key + "?item=" + item.id) + "</div>" +
        '<div class="cl-body' + (clamp ? " clamp" : "") + '">' +
        (item.spec.length ? '<ul class="cl-spec">' + item.spec.map((line) => "<li>" + highlight(line, query) + "</li>").join("") + "</ul>" : "") +
        (item.fill.length ? '<div class="cl-fill">✎ ' + item.fill.map(esc).join("\n✎ ") + "</div>" : "") +
        (item.note.length ? '<div class="cl-note">ⓘ ' + item.note.map(esc).join("\nⓘ ") + "</div>" : "") + "</div>" +
        (clamp ? '<button class="more-btn" data-action="more">Show more ▾</button>' : "") +
        "</div><div>" +
        '<div class="seg">' + ["OK", "NG", "NA"].map((v) => '<button data-action="cl-result" data-key="' + list.key + '" data-item="' + item.id + '" data-v="' + v + '" class="' +
          (res.r === v ? "on-" + v : "") + '"' + disabled + ">" + v + "</button>").join("") + "</div>" +
        '<textarea rows="2" style="margin-top:7px" placeholder="Result / measured value" data-cl-note="' + item.id + '" data-key="' + list.key + '"' + disabled + ">" + esc(res.note || "") + "</textarea>" +
        "</div></div>";
    });
    if (!shown) {
      html += '<div class="card muted">No items match.</div>';
    }
    $("#view").innerHTML = html;

    const build = () => {
      const params = [];
      const qv = $("#cl-search").value.trim();
      if (qv) {
        params.push("q=" + encodeURIComponent(qv));
      }
      if (cat) {
        params.push("cat=" + encodeURIComponent(cat));
      }
      if ($("#cl-filter").value !== "all") {
        params.push("f=" + $("#cl-filter").value);
      }
      return "#checklists/" + list.key + (params.length ? "?" + params.join("&") : "");
    };
    bindFilter("#cl-search", build);
    $("#cl-filter").addEventListener("change", () => {
      setHashQuiet(build());
      rerenderKeepingFocus(null);
    });
    $$(".chip[data-cat]").forEach((chip) => chip.addEventListener("click", () => {
      const params = (build().split("?")[1] || "").split("&").filter((p) => p && !p.startsWith("cat="));
      if (chip.dataset.cat) {
        params.push("cat=" + encodeURIComponent(chip.dataset.cat));
      }
      location.hash = "#checklists/" + list.key + (params.length ? "?" + params.join("&") : "");
    }));
    if (r.params.item) {
      const target = document.getElementById(r.params.item);
      if (target) {
        target.scrollIntoView({ block: "center" });
        target.style.outline = "2px solid var(--accent)";
      }
    }
  };

  // ------------------------------------------------------------------ report
  APP.VIEWS.report = function () {
    const project = activeProject();
    if (!project) {
      $("#view").innerHTML = "<h1>Project Report</h1>" + needProjectBanner("report");
      return;
    }
    const s = projectSummary(project);
    let html = '<h1>Project Report – ' + esc(project.name) + "</h1>" +
      '<div class="muted">' + esc(project.customer || "") + " · phase " + esc(project.phase || "—") + " · generated " + today() + "</div>" +
      '<div class="toolbar no-print"><button class="btn small primary" onclick="window.print()">Print / PDF</button><button class="btn small" data-action="export-report">Export CSV</button></div>' +
      '<div class="grid cols-4">' + kpi(s.pct + "%", "Overall completion", "ok", "#home") + kpi(s.ng, "NG items", s.ng ? "ng" : "ok", "#report") +
      kpi(s.fs.FAIL, "Flow FAIL", s.fs.FAIL ? "ng" : "ok", "#flow") + kpi(s.openIssues, "Open issues", s.openIssues ? "warn" : "ok", "#issues") + "</div>";

    html += "<h2>Checklist status</h2><div class=\"table-wrap\"><table><thead><tr><th>Checklist</th><th>OK</th><th>NG</th><th>NA</th><th>Open</th><th style=\"width:30%\">Progress</th></tr></thead><tbody>" +
      P.checklists.map((c) => {
        const cs = checklistStats(project, c.key);
        return '<tr><td><a href="#checklists/' + c.key + '">' + esc(c.name) + "</a></td><td>" + cs.OK + "</td><td>" + cs.NG + "</td><td>" + cs.NA + "</td><td>" + (cs.total - cs.done) + "</td><td>" + progressBar(cs.OK, cs.NG, cs.NA, 0, cs.total) + "</td></tr>";
      }).join("") + "</tbody></table></div>";

    const ngRows = [];
    P.checklists.forEach((c) => c.items.forEach((item) => {
      const res = (project.cl[c.key] || {})[item.id];
      if (res && res.r === "NG") {
        ngRows.push("<tr><td>" + esc(c.name) + '</td><td><a href="#checklists/' + c.key + "?item=" + item.id + '">#' + esc(item.no) + " " + esc(item.title) + "</a></td><td>" + esc(res.note || "") + "</td></tr>");
      }
    }));
    html += "<h2>NG items (" + ngRows.length + ")</h2>" + (ngRows.length ? '<div class="table-wrap"><table><thead><tr><th>Checklist</th><th>Item</th><th>Remark</th></tr></thead><tbody>' + ngRows.join("") + "</tbody></table></div>" : '<div class="card muted">None.</div>');

    const failRows = P.flow.map((step, i) => ({ step: step, e: project.flow[i] || {} })).filter((x) => x.e.s === "FAIL" || x.e.s === "ON").map((x) =>
      "<tr><td>" + esc(cleanPhase(x.step.phase)) + "</td><td>" + esc(x.step.task.slice(0, 140)) + '</td><td><span class="pill ' + (x.e.s === "FAIL" ? "ng" : "warn") + '">' + x.e.s + "</span></td><td>" + esc(x.e.pic || "") + "</td><td>" + esc(x.e.note || "") + "</td></tr>");
    html += "<h2>Flow tasks FAIL / on going (" + failRows.length + ")</h2>" + (failRows.length ? '<div class="table-wrap"><table><thead><tr><th>Phase</th><th>Task</th><th>Status</th><th>PIC</th><th>Remark</th></tr></thead><tbody>' + failRows.join("") + "</tbody></table></div>" : '<div class="card muted">None.</div>');

    const issues = project.issues.filter((i) => i.status !== "closed");
    html += "<h2>Open issues (" + issues.length + ")</h2>" + (issues.length ? '<div class="table-wrap"><table><thead><tr><th>Issue</th><th>Sev</th><th>Owner</th><th>Due</th></tr></thead><tbody>' +
      issues.map((i) => "<tr><td>" + esc(i.title) + '</td><td class="sev-' + i.sev + '">' + esc(i.sev) + "</td><td>" + esc(i.owner || "") + "</td><td" + (i.due && i.due < today() ? ' style="color:var(--ng)"' : "") + ">" + esc(i.due || "") + "</td></tr>").join("") +
      "</tbody></table></div>" : '<div class="card muted">None.</div>');
    $("#view").innerHTML = html;
  };

  // ------------------------------------------------------------------ issue log
  APP.VIEWS.issues = function (r) {
    const project = activeProject();
    if (!project) {
      $("#view").innerHTML = "<h1>Issue Log</h1>" + needProjectBanner("issue");
      return;
    }
    const showAll = r.params.all === "1";
    const issues = project.issues.slice().sort((a, b) => (a.status === "closed") - (b.status === "closed") || (a.due || "9").localeCompare(b.due || "9"));
    let html = "<h1>Issue Log – " + esc(project.name) + "</h1><div class=\"muted\">Track mechanical bugs, DFM findings, supplier and test issues until closure.</div>" +
      '<div class="card" style="margin-top:14px"><div class="form-grid">' +
      '<div class="form-row" style="grid-column:1/-1"><label>New issue</label><input id="is-title" placeholder="e.g. T1 boss crack at screw #3"></div>' +
      '<div class="form-row"><label>Owner</label><input id="is-owner"></div>' +
      '<div class="form-row"><label>Due</label><input id="is-due" type="date"></div>' +
      '<div class="form-row"><label>Severity</label><select id="is-sev"><option value="H">High</option><option value="M" selected>Medium</option><option value="L">Low</option></select></div>' +
      '<div class="form-row"><label>Phase</label><select id="is-phase">' + flowPhases().map((ph) => "<option" + (ph.name === project.phase ? " selected" : "") + ">" + esc(ph.name) + "</option>").join("") + "</select></div>" +
      '</div><div class="toolbar" style="margin-bottom:0"><button class="btn primary" data-action="issue-add">Add issue</button><span class="spacer"></span>' +
      '<a class="btn small" href="#issues' + (showAll ? "" : "?all=1") + '">' + (showAll ? "Hide closed" : "Show closed") + "</a></div></div>";
    const visible = issues.filter((i) => showAll || i.status !== "closed");
    html += visible.length ? visible.map((i) => '<div class="card issue' + (i.status === "closed" ? " closed" : "") + '" style="margin-top:10px"><div>' +
      '<b class="sev-' + i.sev + '">[' + i.sev + "]</b> <b>" + esc(i.title) + "</b>" +
      '<div class="small muted">' + esc(i.phase || "") + (i.owner ? " · " + esc(i.owner) : "") + (i.due ? ' · due <span style="' + (i.due < today() && i.status !== "closed" ? "color:var(--ng);font-weight:600" : "") + '">' + esc(i.due) + "</span>" : "") + " · opened " + esc(i.created) + "</div>" +
      '<textarea rows="2" style="margin-top:8px" placeholder="Root cause / action / result" data-issue-note="' + i.id + '">' + esc(i.note || "") + "</textarea></div>" +
      '<div style="display:flex;flex-direction:column;gap:6px"><button class="btn small' + (i.status === "closed" ? "" : " primary") + '" data-action="issue-toggle" data-id="' + i.id + '">' + (i.status === "closed" ? "Reopen" : "Close") + "</button>" +
      '<button class="btn small danger" data-action="issue-del" data-id="' + i.id + '">Delete</button></div></div>').join("") : '<div class="card muted" style="margin-top:10px">No issues.</div>';
    $("#view").innerHTML = html;
  };

  // ------------------------------------------------------------------ bookmarks
  APP.VIEWS.starred = function () {
    const entries = Object.entries(state.stars);
    $("#view").innerHTML = "<h1>Bookmarks</h1><div class=\"muted\">Tap ☆ on checklist items or rules to pin them here.</div>" +
      (entries.length ? '<div class="card" style="margin-top:14px">' + entries.map(([id, s]) => '<div style="display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line)">' +
        '<a href="' + esc(s.href) + '" style="flex:1">' + esc(s.label) + '</a><button class="star on" data-action="star" data-id="' + esc(id) + '">★</button></div>').join("") + "</div>"
        : '<div class="card muted" style="margin-top:14px">Nothing bookmarked yet.</div>');
  };

  function remember(label, href) {
    state.recent = [{ label: label, href: href }].concat(state.recent.filter((r) => r.href !== href)).slice(0, 8);
    saveState();
  }

  // ------------------------------------------------------------------ project folders
  APP.VIEWS.projects = function (r) {
    const query = (r.params.q || "").toLowerCase();
    const owner = r.params.o || "";
    const customer = r.params.c || "";
    const customers = Array.from(new Set(P.projects.map((p) => p.customer))).sort();
    const owners = Array.from(new Set(P.projects.map((p) => p.owner))).sort();
    let html = "<h1>Project Folders</h1><div class=\"muted\">" + P.projects.length + " model folders indexed" + (P.meta.generated ? " · " + esc(P.meta.generated) : "") +
      (isLocalFile ? "" : " · file links open on the desktop build only (use ⧉ to copy the path)") + "</div>" +
      '<div class="toolbar"><input id="pj-search" type="search" placeholder="Search model / customer / document…" value="' + esc(r.params.q || "") + '" style="flex:1;max-width:320px">' +
      '<select id="pj-owner"><option value="">All owners</option>' + owners.map((o) => "<option" + (o === owner ? " selected" : "") + ">" + esc(o) + "</option>").join("") + "</select>" +
      '<select id="pj-cust"><option value="">All customers</option>' + customers.map((c) => "<option" + (c === customer ? " selected" : "") + ">" + esc(c) + "</option>").join("") + "</select></div>";
    const rows = P.projects.filter((p) => (!owner || p.owner === owner) && (!customer || p.customer === customer) &&
      (!query || (p.model + " " + p.customer + " " + p.docs.map((d) => d.name).join(" ")).toLowerCase().includes(query)));
    html += '<div class="table-wrap"><table><thead><tr><th class="hide-mobile">Owner</th><th>Customer</th><th>Model</th><th class="hide-mobile">Files</th><th class="hide-mobile">Last change</th><th></th></tr></thead><tbody>' +
      rows.map((p) => {
        const i = P.projects.indexOf(p);
        return '<tr><td class="hide-mobile"><span class="pill' + (p.owner === "Team" ? "" : " blue") + '">' + esc(p.owner) + "</span></td><td>" + esc(p.customer) + "</td><td><b>" + highlight(p.model, r.params.q) + "</b>" +
          '<div class="small muted">' + p.docs.length + " key docs</div></td><td class=\"hide-mobile\">" + p.files + '</td><td class="hide-mobile">' + esc(p.latest) + '</td><td style="white-space:nowrap">' +
          '<button class="btn small" data-action="pj-detail" data-i="' + i + '">Details</button> <button class="btn small primary" data-action="pj-track" data-i="' + i + '">Track</button></td></tr>';
      }).join("") + "</tbody></table></div>";
    $("#view").innerHTML = html;
    const build = () => {
      const params = [];
      if ($("#pj-search").value.trim()) {
        params.push("q=" + encodeURIComponent($("#pj-search").value.trim()));
      }
      if ($("#pj-owner").value) {
        params.push("o=" + encodeURIComponent($("#pj-owner").value));
      }
      if ($("#pj-cust").value) {
        params.push("c=" + encodeURIComponent($("#pj-cust").value));
      }
      return "#projects" + (params.length ? "?" + params.join("&") : "");
    };
    bindFilter("#pj-search", build);
    ["#pj-owner", "#pj-cust"].forEach((sel) => $(sel).addEventListener("change", () => {
      setHashQuiet(build());
      rerenderKeepingFocus(null);
    }));
  };

  function projectDetail(p) {
    const tagged = {};
    p.docs.forEach((d) => d.tags.forEach((t) => {
      (tagged[t] = tagged[t] || []).push(d);
    }));
    openModal("<h3>" + esc(p.customer) + " · " + esc(p.model) + "</h3>" +
      '<div class="small muted">' + p.files + " files · last change " + esc(p.latest) + " · " + Object.entries(p.ext).map((e) => (e[0] || "none") + " " + e[1]).join(", ") + "</div>" +
      '<div style="margin:8px 0"><code>' + esc(clean(p.path)) + "</code> " + folderLink(p.path, "Open") + "</div>" +
      (p.subdirs.length ? '<div class="small"><b>Sub-folders:</b> ' + p.subdirs.map((s) => esc(clean(s))).join(" · ") + "</div>" : "") +
      Object.keys(tagged).map((t) => '<h4 style="margin:14px 0 4px">' + esc(t) + " (" + tagged[t].length + ")</h4>" + tagged[t].slice(0, 15).map((d) => '<div style="margin:3px 0">' + docLink(d.name, d.path) + "</div>").join("")).join("") +
      '<div class="toolbar"><span class="spacer"></span><button class="btn" data-action="close-modal">Close</button></div>');
  }

  // ------------------------------------------------------------------ library
  APP.VIEWS.library = function (r) {
    const query = (r.params.q || "").trim();
    const group = r.params.g || "";
    const groups = Array.from(new Set(P.library.map((d) => d.group)));
    let html = "<h1>Library</h1><div class=\"muted\">Reference documents from your data pack, grouped by topic.</div>" +
      '<div class="toolbar"><input id="lib-search" type="search" placeholder="Search documents…" value="' + esc(query) + '" style="flex:1;max-width:320px"></div>' +
      '<div class="chips"><a class="chip' + (group ? "" : " active") + '" href="#library">All</a>' + groups.map((g) => '<a class="chip' + (g === group ? " active" : "") + '" href="#library?g=' + encodeURIComponent(g) + '">' + esc(g) + " " + P.library.filter((d) => d.group === g).length + "</a>").join("") + "</div>";
    const q = query.toLowerCase();
    const docs = P.library.filter((d) => (!group || d.group === group) && (!q || (d.name + " " + d.topic).toLowerCase().includes(q)));
    const byTopic = {};
    docs.forEach((d) => {
      const key = d.group + (d.topic ? " › " + d.topic : "");
      (byTopic[key] = byTopic[key] || []).push(d);
    });
    html += '<div style="margin-top:12px">' + Object.keys(byTopic).map((k) => '<div class="card" style="margin-bottom:10px"><h3>' + esc(k) + ' <span class="muted small">' + byTopic[k].length + "</span></h3>" +
      byTopic[k].map((d) => '<div style="margin:4px 0">' + docLink(d.name, d.path, query) + ' <span class="muted small">' + (d.sizeKB > 1024 ? fmt(d.sizeKB / 1024, 1) + " MB" : d.sizeKB + " KB") + "</span></div>").join("") + "</div>").join("") + "</div>";
    if (!docs.length) {
      html += '<div class="card muted">No documents' + (packSource === "demo" ? " in the demo pack." : " match.") + "</div>";
    }
    $("#view").innerHTML = html;
    bindFilter("#lib-search", () => "#library?" + (group ? "g=" + encodeURIComponent(group) + "&" : "") + "q=" + encodeURIComponent($("#lib-search").value.trim()));
  };

  // ------------------------------------------------------------------ global search
  APP.VIEWS.search = function (r) {
    const query = (r.params.q || "").trim();
    const q = query.toLowerCase();
    $("#global-search").value = query;
    let html = "<h1>Search: “" + esc(query) + "”</h1>";
    if (!q) {
      $("#view").innerHTML = html + '<div class="card muted">Type in the search box.</div>';
      return;
    }
    const sections = [];
    const rules = [];
    P.rules.forEach((rule, ri) => {
      (rule.items || []).forEach((it) => {
        if ((it.k + " " + it.v + " " + rule.title).toLowerCase().includes(q)) {
          rules.push('<div class="sr"><a href="#rules?r=' + ri + '">' + esc(rule.title) + "</a> — <b>" + highlight(it.k, query) + "</b>: " + highlight(it.v, query) + "</div>");
        }
      });
      ((rule.table && rule.table.rows) || []).forEach((row) => {
        if (row.join(" ").toLowerCase().includes(q)) {
          rules.push('<div class="sr"><a href="#rules?r=' + ri + '">' + esc(rule.title) + "</a> — " + highlight(row.join(" · "), query) + "</div>");
        }
      });
    });
    sections.push(["Design rules", rules]);
    const cl = [];
    P.checklists.forEach((list) => list.items.forEach((item) => {
      const hay = [item.title].concat(item.spec, item.fill, item.note).join(" ");
      if (hay.toLowerCase().includes(q)) {
        const hit = item.spec.find((s) => s.toLowerCase().includes(q));
        cl.push('<div class="sr"><span class="pill">' + esc(list.name) + '</span> <a href="#checklists/' + list.key + "?item=" + item.id + '">#' + esc(item.no) + " " + esc(item.title) + "</a>" +
          (hit ? ' <span class="muted small">— ' + highlight(hit.slice(0, 160), query) + "</span>" : "") + "</div>");
      }
    }));
    sections.push(["Checklist items", cl]);
    sections.push(["NPI flow tasks", P.flow.filter((f) => (f.task + " " + f.note).toLowerCase().includes(q)).map((f) =>
      '<div class="sr"><span class="pill">' + esc(cleanPhase(f.phase)) + '</span> <a href="#flow?phase=' + encodeURIComponent(cleanPhase(f.phase)) + '">' + highlight(f.task.slice(0, 160), query) + "</a></div>")]);
    sections.push(["Lessons learned", P.lessons.filter((l) => JSON.stringify(l).toLowerCase().includes(q)).map((l) => '<div class="sr"><a href="#lessons">' + esc(l.title) + "</a></div>")]);
    sections.push(["SOPs", P.sops.filter((s) => JSON.stringify(s).toLowerCase().includes(q)).map((s, i) => '<div class="sr"><a href="#sops">' + esc(s.title) + "</a></div>")]);
    sections.push(["Project folders", P.projects.filter((p) => (p.model + " " + p.customer).toLowerCase().includes(q)).map((p) =>
      '<div class="sr"><b>' + highlight(p.customer + " · " + p.model, query) + "</b> " + folderLink(p.path) + "</div>")]);
    const pjDocs = [];
    P.projects.forEach((p) => p.docs.forEach((d) => {
      if (d.name.toLowerCase().includes(q)) {
        pjDocs.push('<div class="sr">' + docLink(d.name, d.path, query) + ' <span class="muted small">' + esc(p.model) + "</span></div>");
      }
    }));
    sections.push(["Project documents", pjDocs]);
    sections.push(["Library", P.library.filter((d) => (d.name + " " + d.topic).toLowerCase().includes(q)).map((d) => '<div class="sr">' + docLink(d.name, d.path, query) + ' <span class="muted small">' + esc(d.group) + "</span></div>")]);
    const total = sections.reduce((a, s) => a + s[1].length, 0);
    html += '<div class="muted">' + total + " results</div>";
    sections.forEach((s) => {
      if (s[1].length) {
        html += '<div class="card" style="margin-top:12px"><h3>' + s[0] + ' <span class="muted small">' + s[1].length + "</span></h3>" + s[1].slice(0, 60).join("") +
          (s[1].length > 60 ? '<div class="muted small">… ' + (s[1].length - 60) + " more</div>" : "") + "</div>";
      }
    });
    $("#view").innerHTML = html.replace(/class="sr"/g, 'style="margin:5px 0"');
  };

  // ------------------------------------------------------------------ data & backup
  APP.VIEWS.data = function () {
    const count = Object.keys(state.projects).length;
    const sourceText = { local: "Private pack file next to the app (desktop)", imported: "Imported pack stored on this device", demo: "Built-in demo (no company data)" }[packSource];
    $("#view").innerHTML = "<h1>Data & Backup</h1>" +
      '<div class="grid cols-2" style="margin-top:14px">' +
      '<div class="card"><h3>Data pack</h3><div class="kv"><div class="k">Source</div><div>' + esc(sourceText) + '</div><div class="k">Name</div><div>' + esc(P.meta.name || "—") +
      '</div><div class="k">Generated</div><div>' + esc(P.meta.generated || "—") + '</div><div class="k">Content</div><div>' + P.checklists.length + " checklists · " + P.flow.length + " flow tasks · " +
      P.rules.length + " rule topics · " + P.lessons.length + " lessons · " + P.sops.length + " SOPs · " + P.library.length + " docs</div></div>" +
      '<div class="toolbar"><label class="btn primary">Import data pack (.json)<input type="file" id="pack-file" accept=".json,application/json" class="hidden"></label>' +
      (packSource === "imported" ? '<button class="btn danger" data-action="pack-remove">Remove imported pack</button>' : "") +
      (packSource !== "demo" ? '<button class="btn" data-action="pack-export">Export pack for phone</button>' : "") + "</div>" +
      '<p class="small muted">The pack holds company content. It is stored only in this browser (IndexedDB) and is never uploaded. To use on a phone: export it here, send it to the phone through a company-approved channel, open the app and import it.</p></div>' +
      '<div class="card"><h3>Project status backup</h3><p>' + count + " tracked project(s) in this browser.</p>" +
      '<div class="toolbar"><button class="btn primary" data-action="export-json">Export backup</button><label class="btn">Import backup<input type="file" id="import-file" accept=".json" class="hidden"></label>' +
      '<button class="btn danger" data-action="clear-all">Clear all</button></div><p class="small muted">Import merges projects by ID – use it to move status between PC and phone or to share with teammates.</p></div>' +
      '<div class="card"><h3>Appearance</h3><div class="toolbar"><button class="btn" data-action="theme" data-v="light">Light</button><button class="btn" data-action="theme" data-v="dark">Dark</button><button class="btn" data-action="theme" data-v="">System</button></div>' +
      '<p class="small muted">On a phone, use the browser menu → “Add to Home screen” to install it as an app (works offline).</p></div></div>';

    $("#pack-file").addEventListener("change", (event) => readJsonFile(event.target.files[0], async (data) => {
      if (!data || !Array.isArray(data.checklists)) {
        toast("Not a data pack");
        return;
      }
      await idbSet("pack", data);
      toast("Data pack imported");
      await loadPack();
      phaseCache = null;
      route();
    }));
    $("#import-file").addEventListener("change", (event) => readJsonFile(event.target.files[0], (data) => {
      Object.assign(state.projects, (data && data.projects) || {});
      Object.assign(state.stars, (data && data.stars) || {});
      if (!state.activeId && data && data.activeId) {
        state.activeId = data.activeId;
      }
      state = (saveState(), loadState());
      toast("Backup imported");
      route();
    }));
  };

  function readJsonFile(file, callback) {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        callback(JSON.parse(reader.result));
      } catch (error) {
        toast("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 500);
  }

  function csv(rows) {
    return "\ufeff" + rows.map((r) => r.map((v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  }

  // ------------------------------------------------------------------ events
  document.addEventListener("click", async (event) => {
    const copy = event.target.closest("[data-copy]");
    if (copy) {
      event.preventDefault();
      copyText(copy.dataset.copy);
      return;
    }
    const go = event.target.closest("[data-go]");
    if (go) {
      location.hash = go.dataset.go;
      return;
    }
    const scroll = event.target.closest("[data-scroll]");
    if (scroll) {
      event.preventDefault();
      document.getElementById(scroll.dataset.scroll).scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (event.target.id === "modal") {
      closeModal();
      return;
    }
    if (event.target.id === "drawer-backdrop") {
      document.body.classList.remove("drawer-open");
      return;
    }
    const el = event.target.closest("[data-action]");
    if (!el) {
      return;
    }
    const action = el.dataset.action;
    const project = activeProject();
    switch (action) {
      case "drawer":
        event.preventDefault();
        document.body.classList.toggle("drawer-open");
        break;
      case "new-project":
        projectForm(null);
        break;
      case "edit-project":
        projectForm(state.projects[el.dataset.id]);
        break;
      case "save-project":
        saveProjectFromForm(el.dataset.id);
        break;
      case "delete-project":
        if (confirm("Delete this tracked project and all its status?")) {
          delete state.projects[el.dataset.id];
          if (state.activeId === el.dataset.id) {
            state.activeId = Object.keys(state.projects)[0] || null;
          }
          saveState();
          closeModal();
          route();
        }
        break;
      case "close-modal":
        closeModal();
        break;
      case "activate":
        state.activeId = el.dataset.id;
        saveState();
        location.hash = "#checklists";
        route();
        break;
      case "flow-status": {
        if (!project) {
          return;
        }
        const idx = el.dataset.idx;
        const entry = project.flow[idx] || (project.flow[idx] = {});
        entry.s = entry.s === el.dataset.v ? "" : el.dataset.v;
        entry.date = today();
        saveState();
        const status = FLOW_STATUS.find((s) => s.v === entry.s);
        $$('[data-action="flow-status"][data-idx="' + idx + '"]').forEach((b) => {
          b.className = status && b.dataset.v === entry.s ? "on-" + status.cls : "";
        });
        break;
      }
      case "cl-result": {
        if (!project) {
          return;
        }
        const results = project.cl[el.dataset.key] || (project.cl[el.dataset.key] = {});
        const res = results[el.dataset.item] || (results[el.dataset.item] = {});
        res.r = res.r === el.dataset.v ? "" : el.dataset.v;
        res.date = today();
        saveState();
        const card = document.getElementById(el.dataset.item);
        card.className = "cl-item r-" + (res.r || "");
        $$(".seg button", card).forEach((b) => {
          b.className = b.dataset.v === res.r ? "on-" + res.r : "";
        });
        break;
      }
      case "more": {
        const body = el.previousElementSibling;
        body.classList.toggle("clamp");
        el.textContent = body.classList.contains("clamp") ? "Show more ▾" : "Show less ▴";
        break;
      }
      case "star": {
        const id = el.dataset.id;
        if (state.stars[id]) {
          delete state.stars[id];
        } else {
          state.stars[id] = { label: el.dataset.label, href: el.dataset.href };
        }
        saveState();
        if (parseHash().view === "starred") {
          route();
        } else {
          el.classList.toggle("on", !!state.stars[id]);
          el.textContent = state.stars[id] ? "★" : "☆";
          renderChrome(parseHash().view);
        }
        break;
      }
      case "export-cl": {
        const list = checklistByKey(el.dataset.key);
        const results = project.cl[list.key] || {};
        download(project.name + "_" + list.key + ".csv", csv([["Project", "Checklist", "Category", "No", "Item", "Spec", "Result", "Remark", "Date"]].concat(
          list.items.map((item) => {
            const res = results[item.id] || {};
            return [project.name, list.name, item.catEn, item.no, item.title, item.spec.join(" / "), res.r || "", res.note || "", res.date || ""];
          }))), "text/csv");
        break;
      }
      case "reset-cl":
        if (confirm("Clear all results of this checklist for " + project.name + "?")) {
          delete project.cl[el.dataset.key];
          saveState();
          route();
        }
        break;
      case "export-flow":
        download(project.name + "_flow.csv", csv([["Project", "Phase", "Stage", "Task", "Status", "PIC", "Remark", "Updated"]].concat(
          P.flow.map((step, i) => {
            const e = project.flow[i] || {};
            return [project.name, cleanPhase(step.phase), step.stage, step.task, e.s || "", e.pic || "", e.note || "", e.date || ""];
          }))), "text/csv");
        break;
      case "export-report": {
        const rows = [["Type", "Source", "Item", "Status", "Remark"]];
        P.checklists.forEach((c) => c.items.forEach((item) => {
          const res = (project.cl[c.key] || {})[item.id];
          if (res && res.r === "NG") {
            rows.push(["Checklist NG", c.name, "#" + item.no + " " + item.title, "NG", res.note || ""]);
          }
        }));
        P.flow.forEach((step, i) => {
          const e = project.flow[i] || {};
          if (e.s === "FAIL" || e.s === "ON") {
            rows.push(["Flow", cleanPhase(step.phase), step.task, e.s, e.note || ""]);
          }
        });
        project.issues.forEach((i) => rows.push(["Issue", i.phase || "", i.title, i.status || "open", i.note || ""]));
        download(project.name + "_report.csv", csv(rows), "text/csv");
        break;
      }
      case "issue-add": {
        const title = $("#is-title").value.trim();
        if (!title) {
          toast("Enter an issue title");
          return;
        }
        project.issues.push({ id: "i" + Date.now().toString(36), title: title, owner: $("#is-owner").value.trim(), due: $("#is-due").value, sev: $("#is-sev").value, phase: $("#is-phase").value, status: "open", created: today(), note: "" });
        saveState();
        route();
        break;
      }
      case "issue-toggle": {
        const issue = project.issues.find((i) => i.id === el.dataset.id);
        issue.status = issue.status === "closed" ? "open" : "closed";
        issue.closed = issue.status === "closed" ? today() : "";
        saveState();
        route();
        break;
      }
      case "issue-del":
        if (confirm("Delete this issue?")) {
          project.issues = project.issues.filter((i) => i.id !== el.dataset.id);
          saveState();
          route();
        }
        break;
      case "ta-add":
        APP.addTaRow();
        APP.runCalc("ta");
        break;
      case "ta-del":
        el.closest(".stack-row").remove();
        APP.runCalc("ta");
        break;
      case "pj-detail":
        projectDetail(P.projects[+el.dataset.i]);
        break;
      case "pj-track": {
        const p = P.projects[+el.dataset.i];
        projectForm(null, { name: p.model, customer: p.customer, folder: p.path });
        break;
      }
      case "export-json":
        download("me-toolkit-backup-" + today() + ".json", JSON.stringify({ projects: state.projects, stars: state.stars, activeId: state.activeId }, null, 1), "application/json");
        break;
      case "clear-all":
        if (confirm("Delete ALL tracked projects stored in this browser?")) {
          state.projects = {};
          state.activeId = null;
          saveState();
          route();
        }
        break;
      case "pack-remove":
        if (confirm("Remove the imported data pack from this device?")) {
          await idbSet("pack", undefined);
          await loadPack();
          phaseCache = null;
          route();
        }
        break;
      case "pack-export":
        download("me-data-pack.json", JSON.stringify(P), "application/json");
        break;
      case "theme":
        setTheme(el.dataset.v);
        break;
      default:
        break;
    }
  });

  document.addEventListener("input", (event) => {
    const project = activeProject();
    const t = event.target;
    if (!project) {
      return;
    }
    if (t.dataset.flowField) {
      const entry = project.flow[t.dataset.idx] || (project.flow[t.dataset.idx] = {});
      entry[t.dataset.flowField] = t.value;
      saveState();
    } else if (t.dataset.clNote) {
      const results = project.cl[t.dataset.key] || (project.cl[t.dataset.key] = {});
      const res = results[t.dataset.clNote] || (results[t.dataset.clNote] = {});
      res.note = t.value;
      saveState();
    } else if (t.dataset.issueNote) {
      const issue = project.issues.find((i) => i.id === t.dataset.issueNote);
      issue.note = t.value;
      saveState();
    }
  });

  function setTheme(value) {
    state.theme = value || null;
    saveState();
    const dark = value ? value === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    renderChrome(parseHash().view);
  }

  // ------------------------------------------------------------------ export to views.js
  Object.defineProperty(APP, "P", { get: () => P });
  Object.defineProperty(APP, "packSource", { get: () => packSource });
  Object.defineProperty(APP, "serverMode", { get: () => serverMode });
  Object.assign(APP, {
    $, $$, esc, clean, expandPath, highlight, docLink, folderLink, baseName, num, fmt, parseNumbers, mean, stdev, normCdf, verdict, icon,
    starButton, demoBanner, remember, setHashQuiet, rerenderKeepingFocus, bindFilter, parseHash, isLocalFile
  });

  // ------------------------------------------------------------------ boot
  async function detectServer() {
    if (!/^https?:$/.test(location.protocol)) {
      return false;
    }
    try {
      const response = await Promise.race([
        fetch("api/status", { cache: "no-store" }),
        new Promise((resolve) => setTimeout(() => resolve(null), 1500))
      ]);
      if (!(response && response.ok)) {
        return false;
      }
      const status = await response.json();
      (status.hideTerms || []).forEach((term) => {
        if (!hideTerms.includes(term)) {
          hideTerms.push(term);
        }
      });
      return !!status.server;
    } catch (error) {
      return false;
    }
  }

  async function boot() {
    serverMode = await detectServer();
    await loadPack();
    $("#active-select").addEventListener("change", (event) => {
      state.activeId = event.target.value || null;
      saveState();
      route();
    });
    $("#new-project-btn").addEventListener("click", () => projectForm(null));
    $("#menu-btn").addEventListener("click", () => document.body.classList.toggle("drawer-open"));
    $("#theme-btn").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
    $("#global-search").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        location.hash = "#search?q=" + encodeURIComponent(event.target.value.trim());
        event.target.blur();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeModal();
        document.body.classList.remove("drawer-open");
      }
      if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) {
        event.preventDefault();
        $("#global-search").focus();
      }
    });
    window.addEventListener("hashchange", route);
    route();
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    setTimeout(boot, 0);
  }
})();
