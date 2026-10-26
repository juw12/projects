/* ME R&D Toolkit – File Vault (needs vault_server.py) and the in-app user guide. */
(function () {
  "use strict";
  const APP = window.APP;
  const { $, esc, clean, highlight, fmt, icon } = APP;
  const V = APP.VIEWS;

  function size(bytes) {
    if (bytes > 1 << 30) {
      return fmt(bytes / (1 << 30), 1) + " GB";
    }
    if (bytes > 1 << 20) {
      return fmt(bytes / (1 << 20), 1) + " MB";
    }
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  }

  function date(seconds) {
    return seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : "";
  }

  async function api(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(response.status);
    }
    return response.json();
  }

  function fileUrl(f, download) {
    return "file?r=" + encodeURIComponent(f.r) + "&p=" + encodeURIComponent(f.p) + (download ? "&dl=1" : "");
  }

  function vaultHref(params) {
    const parts = Object.entries(params).filter(([, v]) => v).map(([k, v]) => k + "=" + encodeURIComponent(v));
    return "#vault" + (parts.length ? "?" + parts.join("&") : "");
  }

  function fileRow(f, query, showPath) {
    const ext = (f.n.match(/\.([a-z0-9]{2,5})$/i) || [, ""])[1].toLowerCase();
    const shareLink = location.origin + location.pathname.replace(/index\.html$/, "") + fileUrl(f);
    return "<tr><td><span class=\"doc-link\"><span class=\"ext " + ext + "\">" + (ext || "file") + "</span>" +
      '<a href="' + fileUrl(f) + '" target="_blank"><span class="nm">' + highlight(clean(f.n), query) + "</span></a></span>" +
      (showPath ? '<div class="small muted">' + esc(f.c) + " › " + esc(clean(f.t.split("/").slice(0, -1).join(" › "))) + "</div>" : "") + "</td>" +
      '<td class="hide-mobile">' + size(f.s) + '</td><td class="hide-mobile">' + date(f.m) + "</td>" +
      '<td style="white-space:nowrap"><a class="btn small" href="' + fileUrl(f, true) + '" title="Download">⬇</a> ' +
      '<button class="btn small" data-copy="' + esc(shareLink) + '" title="Copy share link">🔗</button></td></tr>';
  }

  function fileTable(files, query, showPath) {
    if (!files.length) {
      return '<div class="card muted">No files.</div>';
    }
    return '<div class="table-wrap"><table><thead><tr><th>File</th><th class="hide-mobile">Size</th><th class="hide-mobile">Modified</th><th></th></tr></thead><tbody>' +
      files.map((f) => fileRow(f, query, showPath)).join("") + "</tbody></table></div>";
  }

  V.vault = async function (r) {
    const view = $("#view");
    if (!APP.serverMode) {
      view.innerHTML = "<h1>File Vault</h1>" +
        '<div class="card" style="margin-top:14px"><p>The vault gives the whole team one place to browse, search, open and share every R&amp;D file by category, on PC and phone.</p>' +
        "<p>It runs when this app is opened from the team <b>vault server</b> (an address like <code>http://&lt;pc-name&gt;:8780</code>). Ask the vault owner for the link and password, or see the guide to host it yourself.</p>" +
        '<a class="btn primary" href="#guide?s=vault">How the vault works</a></div>';
      return;
    }
    const cat = r.params.cat || "";
    const dir = r.params.dir || "";
    const query = (r.params.q || "").trim();
    view.innerHTML = '<h1>File Vault</h1><div class="toolbar"><input id="vault-search" type="search" placeholder="Search all shared files…" value="' + esc(query) + '" style="flex:1;max-width:420px">' +
      '<a class="btn small" href="#vault">Categories</a><a class="btn small" href="#vault?recent=1">Recently changed</a></div><div id="vault-body" class="muted">Loading…</div>';
    const search = $("#vault-search");
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        location.hash = vaultHref({ q: search.value.trim(), cat: cat });
      }
    });
    const body = $("#vault-body");
    try {
      if (r.params.abs) {
        const where = await api("api/vault/locate?abs=" + encodeURIComponent(r.params.abs));
        location.replace(vaultHref({ cat: where.cat, dir: where.dir }));
        return;
      }
      if (query) {
        const data = await api("api/vault/search?q=" + encodeURIComponent(query) + (cat ? "&cat=" + encodeURIComponent(cat) : ""));
        body.innerHTML = '<div class="muted small" style="margin-bottom:8px">' + data.files.length + (data.files.length >= 300 ? "+" : "") + " results" + (cat ? " in " + esc(cat) : "") + "</div>" + fileTable(data.files, query, true);
        return;
      }
      if (r.params.recent) {
        const data = await api("api/vault/recent");
        body.innerHTML = "<h2>Recently changed</h2>" + fileTable(data.files, "", true);
        return;
      }
      if (!cat) {
        const data = await api("api/vault/categories");
        body.innerHTML = (data.building ? '<div class="card banner">Indexing files… counts will grow. Refresh in a minute.</div>' : "") +
          '<div class="muted small" style="margin-bottom:10px">' + data.categories.reduce((a, c) => a + c.count, 0).toLocaleString() + " files · indexed " + esc(data.built || "now") + "</div>" +
          '<div class="grid cols-3">' + data.categories.map((c) => '<div class="card tile" data-go="' + vaultHref({ cat: c.name }) + '"><div class="ti">' + icon(c.icon) + "</div><div>" +
            '<h3 style="margin:0">' + esc(c.name) + '</h3><div class="small muted">' + esc(c.desc || "") + '</div><div class="small" style="margin-top:6px">' +
            c.count.toLocaleString() + " files · " + size(c.size) + " · updated " + date(c.latest) + "</div></div></div>").join("") + "</div>";
        return;
      }
      const data = await api("api/vault/list?cat=" + encodeURIComponent(cat) + "&dir=" + encodeURIComponent(dir));
      const crumbs = dir ? dir.split("/") : [];
      let html = '<div class="chips" style="margin-bottom:10px"><a class="chip" href="#vault">Vault</a><a class="chip' + (crumbs.length ? "" : " active") + '" href="' + vaultHref({ cat: cat }) + '">' + esc(cat) + "</a>" +
        crumbs.map((c, i) => '<a class="chip' + (i === crumbs.length - 1 ? " active" : "") + '" href="' + vaultHref({ cat: cat, dir: crumbs.slice(0, i + 1).join("/") }) + '">' + esc(clean(c)) + "</a>").join("") + "</div>" +
        '<div class="toolbar" style="margin-top:0"><input id="vault-cat-search" type="search" placeholder="Search in ' + esc(cat) + '…" style="flex:1;max-width:360px"></div>';
      if (data.dirs.length) {
        html += '<div class="grid cols-4" style="margin-bottom:14px">' + data.dirs.map((d) => '<div class="card tile" data-go="' + vaultHref({ cat: cat, dir: (dir ? dir + "/" : "") + d.name }) + '">' +
          '<div class="ti">' + icon("folder") + '</div><div><b style="overflow-wrap:anywhere">' + esc(clean(d.name)) + '</b><div class="small muted">' + d.count + " files · " + date(d.latest) + "</div></div></div>").join("") + "</div>";
      }
      html += data.files.length || !data.dirs.length ? fileTable(data.files, "", false) : "";
      body.innerHTML = html;
      const inner = $("#vault-cat-search");
      inner.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          location.hash = vaultHref({ q: inner.value.trim(), cat: cat });
        }
      });
    } catch (error) {
      body.innerHTML = '<div class="card banner">Could not reach the vault server (' + esc(error.message) + ").</div>";
    }
  };

  // ------------------------------------------------------------------ guide
  const GUIDE = [
    {
      id: "start", title: "Getting started", body: [
        "<b>Three ways to open the toolkit:</b>",
        "<ol class=\"steps\"><li><b>Team vault (recommended).</b> Open the vault link from the owner (e.g. <code>http://pc-name:8780</code>) and log in with the shared user/password. All data and files are ready on PC and phone.</li>" +
        "<li><b>Desktop file.</b> Double-click <code>index.html</code> in the toolkit folder. If the private data pack sits in <code>private/</code>, it loads automatically.</li>" +
        "<li><b>Hosted / phone.</b> Open the web address, go to <a href=\"#data\">Data &amp; Backup</a> → <i>Import data pack</i> and pick the <code>.json</code> pack.</li></ol>",
        "Then press <b>+ New</b> (top bar) to create a tracked project. Everything you mark is saved in your browser for that project."
      ]
    },
    {
      id: "project", title: "Track a project", body: [
        "<ol class=\"steps\"><li><b>+ New</b> → enter model name, customer, product line and current phase. Optionally add the project folder and a <b>target date for each phase</b>.</li>" +
        "<li>Or open <a href=\"#projects\">Project Folders</a>, find the model and press <b>Track</b> to prefill it.</li>" +
        "<li>Switch the active project from the selector in the top bar. The dashboard shows completion %, NG items, FAIL tasks, open issues and overdue milestones.</li></ol>"
      ]
    },
    {
      id: "flow", title: "NPI development flow", body: [
        "Every ME task from RFQ to MP, grouped by phase and stage. Click a phase card in the timeline to focus on it.",
        "<ul><li>Set each task to <b>PASS / On going / FAIL / NA</b>. Click again to clear.</li><li>Write the PIC and a remark (date, report name, reason for NA).</li>" +
        "<li>Phases with a target date turn red in the timeline when they're late and unfinished.</li><li><b>Export CSV</b> for weekly reports, <b>Print</b> for sign-off.</li></ul>"
      ]
    },
    {
      id: "checklists", title: "Checklists", body: [
        "Tabs at the top switch between the checklists in your data pack (for example design review or DFM).",
        "<ul><li>Mark each item <b>OK / NG / NA</b> and type the measured value or comment.</li><li>Use the category chips, the filter box and <i>Open / NG</i> filters to work through long lists.</li>" +
        "<li>☆ bookmarks an item; it then appears in <a href=\"#starred\">Bookmarks</a>.</li><li>Long items are collapsed. Tap <i>Show more</i>.</li><li><b>CSV</b> exports results with dates; <b>Print</b> gives a paper copy for the leader signature.</li></ul>"
      ]
    },
    {
      id: "issues", title: "Issue log & report", body: [
        "<a href=\"#issues\">Issue Log</a>: add a problem with owner, due date, severity and phase, write the root cause / action, then <b>Close</b> it when verified. Overdue issues show in red.",
        "<a href=\"#report\">Project Report</a>: one page with checklist progress, every NG item, FAIL / on-going flow tasks and open issues. Use <b>Print / PDF</b> for meetings or <b>Export CSV</b>."
      ]
    },
    {
      id: "calc", title: "Calculators", body: [
        "Results update as you type. Limits (pass criteria, safety factors) are editable fields; defaults come from the data pack.",
        "<ul><li><b>Cpk / gap-step</b>: paste 12 (or 32) measurements, enter nominal and tolerances.</li><li><b>Button gap</b>: x̄ − 3σ of the button-to-switch gap.</li>" +
        "<li><b>Torque</b>: min failure torque and max seating torque, or paste raw samples.</li><li><b>Tolerance stack</b>: add one row per dimension with ± tolerance and direction.</li>" +
        "<li><b>Snap-fit, thermal pad, wall/rib/boss, cable bend, enclosure opening, ΔE, test severity, units.</b></li></ul>",
        "Calculators are hand-calculation aids. Confirm critical designs with CAE, tests and the responsible teams."
      ]
    },
    {
      id: "reference", title: "Rules, lessons, SOPs, library", body: [
        "<ul><li><a href=\"#rules\">Design Rules</a>: quick English reference; search for e.g. <i>boss</i>, <i>snap</i>, <i>RJ45</i>.</li><li><a href=\"#lessons\">Lessons Learned</a>: issue, root cause and the rule to carry forward.</li>" +
        "<li><a href=\"#sops\">SOPs</a>: step-by-step admin and tooling procedures.</li><li><a href=\"#library\">Library</a>: training, templates and guides.</li>" +
        "<li>The search box at the top (shortcut <b>/</b>) searches everything at once.</li></ul>"
      ]
    },
    {
      id: "vault", title: "File Vault: all files by category", body: [
        "When the app is opened from the vault server, <a href=\"#vault\">File Vault</a> shows every shared file grouped by category (checklists, design guides, projects, training, approval, vendors, SOPs…).",
        "<ul><li>Open a category, then drill into folders using the breadcrumb chips.</li><li>Search all files or only the current category.</li><li>Click a file name to open it in the browser (PDF, images, video) or download it (Office, CAD).</li>" +
        "<li>🔗 copies a direct link you can send to a colleague; they need the vault password.</li><li>Links in checklists, rules and the library open through the vault too, also on phones.</li></ul>",
        "<b>Hosting the vault (owner):</b> run <code>start_vault.bat</code> in the toolkit's <code>server</code> folder. The window prints the network address and password. Share both with the team. Keep the window open while people use it. Allow Python through Windows Firewall for <i>private/domain</i> networks only, never port-forward it to the internet, and follow your company's IT rules for hosting files. Every access is logged in <code>private/vault_access.log</code>."
      ]
    },
    {
      id: "mobile", title: "Phone", body: [
        "<ul><li>Connect the phone to the company network or Wi-Fi and open the vault link, or the hosted app plus an imported data pack.</li><li>Use the bottom bar for Home, Checklists, Vault and Calculators; <b>More</b> opens the full menu.</li>" +
        "<li>Browser menu → <b>Add to Home screen</b> installs it like an app.</li><li>Moon/sun icon switches dark mode.</li></ul>"
      ]
    },
    {
      id: "data", title: "Saving, backup & privacy", body: [
        "<ul><li>Project status is saved automatically in <i>this browser</i>. Different browsers and devices have separate data.</li>" +
        "<li><a href=\"#data\">Data &amp; Backup</a> → <b>Export backup</b> creates a JSON file; <b>Import backup</b> on another device merges it, which is how to share status with teammates.</li>" +
        "<li>Company content lives only in the private data pack or on the vault server. It's never part of the public app code.</li><li>Don't post data packs, backups or vault links outside the company.</li></ul>"
      ]
    },
    {
      id: "faq", title: "FAQ", body: [
        "<b>Buttons are greyed out.</b> Create or select a project first; status is saved per project.",
        "<b>File links don't open.</b> Desktop links work when <code>index.html</code> is opened from the PC; on phones and other PCs open the app from the vault server.",
        "<b>I see “Demo data”.</b> No data pack is loaded. Import the pack or use the vault link.",
        "<b>New files are missing in the vault.</b> The vault indexes at start-up. Restart <code>start_vault.bat</code>, or open <code>api/vault/reindex</code>.",
        "<b>The data pack is out of date.</b> The owner re-runs <code>private/build_pack.py</code>."
      ]
    }
  ];

  V.guide = function (r) {
    const focus = r.params.s;
    $("#view").innerHTML = "<h1>How to use</h1><div class=\"muted\">A quick guide for new users. Tap a topic.</div>" +
      '<div class="chips" style="margin:14px 0">' + GUIDE.map((g) => '<a class="chip" href="#guide" data-scroll="g-' + g.id + '">' + esc(g.title) + "</a>").join("") + "</div>" +
      GUIDE.map((g, i) => '<div class="card" id="g-' + g.id + '" style="margin-bottom:12px;scroll-margin-top:80px"><h3><span class="pill blue">' + (i + 1) + "</span> " + esc(g.title) + "</h3>" +
        g.body.map((p) => (p.startsWith("<ol") || p.startsWith("<ul") ? p : "<p>" + p + "</p>")).join("") + "</div>").join("");
    if (focus) {
      const target = document.getElementById("g-" + focus);
      if (target) {
        target.scrollIntoView();
        target.style.outline = "2px solid var(--accent)";
      }
    }
  };
})();
