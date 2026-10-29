/* Vitals — UI controller. Works in three modes:
 *   agent   : talking to the local Python agent (real metrics, scans, Undo Vault)
 *   browser : no agent; uses what the browser can measure + device playbooks
 *   demo    : simulated laptop so anyone can explore every feature safely
 */
(function () {
  "use strict";

  const B = window.VitalsBrain;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const fmt = B.fmtBytes;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem("vitals:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("vitals:" + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  // ------------------------------------------------------------------ state
  const S = {
    mode: "connecting",
    base: "",
    token: null,
    platform: B.detectPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints || 0),
    view: "home",
    simple: LS.get("simple", true),
    installStep: 0,
    settings: null,
    fix: null,
    vitals: null,
    processes: [],
    history: [],
    cpuTrail: [],
    memTrail: [],
    scan: null,
    scanState: null,
    vault: [],
    receipts: [],
    baseline: null,
    drain: null,
    forecast: null,
    startup: [],
    pairing: null,
    selected: new Set(),
    cleanMode: "vault",
    openCats: new Set(),
    chat: LS.get("chat", []),
    pendingAfterScan: null,
    browser: { battery: null, drainLog: LS.get("drainLog", []), storage: null },
    bench: LS.get("bench", []),
    guide: null,
    guideDone: LS.get("guideDone", {}),
    hostname: null,
  };
  S.guide = ["iphone", "android", "mac", "windows"].includes(S.platform) ? S.platform : "mac";

  // ------------------------------------------------------------------ icons
  const I = {
    overview: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
    tools: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    clean: '<path d="M4 20l7-7"/><path d="M14 4l6 6-7 7-6-6z"/><path d="M3 21h6"/>',
    performance: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9z"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
    battery: '<rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 11v2"/><path d="M6 10v4M10 10v4"/>',
    vault: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M12 9V7M12 17v-2M9 12H7M17 12h-2"/>',
    devices: '<rect x="2" y="4" width="14" height="11" rx="2"/><rect x="17" y="8" width="5" height="11" rx="1"/><path d="M6 19h6"/>',
    guides: '<path d="M4 4h11a3 3 0 013 3v13H7a3 3 0 01-3-3z"/><path d="M8 8h6M8 12h6"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    send: '<path d="M4 12l16-8-6 16-2-7z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    moon: '<path d="M20 14A8 8 0 1110 4a7 7 0 0010 10z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    broom: '<path d="M14 4l6 6-7 7-6-6z"/><path d="M4 20l7-7"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>',
    memory: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 7v10M11 7v10M15 7v10"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 10h4v4h-4z"/>',
    pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    restart: '<path d="M20 12a8 8 0 11-3-6.3"/><path d="M20 4v5h-5"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  };
  const icon = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (I[name] || I.pulse) + "</svg>";

  const SITE = "https://juw12.github.io/projects/vitals/";
  const INSTALL = {
    mac: {
      name: "Mac",
      cmd: "curl -fsSL " + SITE + "install.sh | sh",
      steps: [
        "Click <b>Copy</b>.",
        "Open <b>Terminal</b>: press <kbd>⌘</kbd> <kbd>Space</kbd>, type <i>Terminal</i>, press <kbd>Return</kbd>.",
        "Paste with <kbd>⌘</kbd> <kbd>V</kbd> and press <kbd>Return</kbd>. Vitals installs and opens by itself.",
      ],
    },
    windows: {
      name: "Windows",
      cmd: 'powershell -ExecutionPolicy Bypass -c "irm ' + SITE + 'install.ps1 | iex"',
      steps: [
        "Click <b>Copy</b>.",
        "Press <kbd>Win</kbd> + <kbd>R</kbd> to open the Run box.",
        "Paste with <kbd>Ctrl</kbd> <kbd>V</kbd> and press <kbd>Enter</kbd>. Vitals installs (and Python, if needed) and opens.",
      ],
    },
    linux: {
      name: "Linux",
      cmd: "curl -fsSL " + SITE + "install.sh | sh",
      steps: [
        "Click <b>Copy</b>.",
        "Open a terminal (usually <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>T</kbd>).",
        "Paste with <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>V</kbd> and press <kbd>Enter</kbd>.",
      ],
    },
  };

  // Downloadable apps: the "vitals" GitHub release, built by .github/workflows/vitals-apps.yml.
  const RELEASE = "https://github.com/juw12/projects/releases/download/vitals/";
  const RELEASE_PAGE = "https://github.com/juw12/projects/releases/tag/vitals";
  const ANDROID_APK = RELEASE + "Vitals-Android.apk";
  const IPHONE_WEB = SITE + "mobile.html";
  const IN_APP = /VitalsApp\//.test(navigator.userAgent); // running inside the Android/iPhone app
  const DOWNLOADS = {
    windows: {
      files: [["Download for Windows", "Vitals-Windows-Setup.exe"]],
      note: "Windows 10/11 · installs just for you, no admin. If Windows says it protected your PC, choose <b>More info → Run anyway</b> (the app isn't code-signed yet).",
    },
    mac: {
      files: [["Mac with Apple chip", "Vitals-macOS-AppleSilicon.dmg"], ["Mac with Intel chip", "Vitals-macOS-Intel.dmg"]],
      note: "Open it and drag Vitals to Applications. The first time, macOS asks you to allow it: <b>System Settings → Privacy &amp; Security → Open Anyway</b>.",
    },
    linux: {
      files: [["Ubuntu / Debian (.deb)", "Vitals-Linux-x64.deb"], ["Any Linux (.tar.gz)", "Vitals-Linux-x64.tar.gz"]],
      note: "Open the .deb with your software app, or run <code>sudo apt install ./Vitals-Linux-x64.deb</code>. For the .tar.gz: extract it and run <code>Vitals/vitals</code>.",
    },
  };

  const VIEWS = [
    { id: "home", label: "Home", icon: "home" },
    { id: "overview", label: "Overview", icon: "overview" },
    { id: "clean", label: "Clean", icon: "clean" },
    { id: "performance", label: "Performance", icon: "performance" },
    { id: "battery", label: "Battery", icon: "battery" },
    { id: "vault", label: "Undo Vault", icon: "vault" },
    { id: "devices", label: "Devices", icon: "devices" },
    { id: "guides", label: "Guides", icon: "guides" },
  ];

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (n) => (n == null ? "—" : Math.round(n) + "%");
  const short = (p) => {
    const s = B.shortPath(p);
    return s.length > 52 ? "…" + s.slice(-51) : s;
  };
  const ago = (ts) => {
    const s = Date.now() / 1000 - ts;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Math.floor(s / 86400) + " d ago";
  };

  // -------------------------------------------------------------------- api
  async function api(path, opts) {
    const o = opts || {};
    if (S.mode === "demo") return Demo.api(path, o);
    const res = await fetch(S.base + "/api/" + path, {
      method: o.method || (o.body ? "POST" : "GET"),
      headers: Object.assign({ "Content-Type": "application/json" }, S.token ? { "X-Vitals-Token": S.token } : {}),
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "Request failed (" + res.status + ")");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function tryAgent(base) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    try {
      const res = await fetch(base + "/api/health", { signal: ctl.signal });
      const data = await res.json();
      return data && data.app === "vitals" ? data : null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function connect() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has("demo")) return startDemo(true);
    const servedByAgent = location.protocol.startsWith("http") && !/github\.io$/.test(location.hostname);
    const candidates = [];
    if (servedByAgent) candidates.push("");
    const saved = LS.get("agentBase", null);
    if (saved != null && !candidates.includes(saved)) candidates.push(saved);
    if (!candidates.includes("http://127.0.0.1:8765")) candidates.push("http://127.0.0.1:8765");
    for (const base of candidates) {
      const health = await tryAgent(base);
      if (!health) continue;
      S.base = base;
      S.hostname = health.hostname;
      const tokens = LS.get("tokens", {});
      S.token = tokens[base || location.host] || null;
      if (S.token) {
        try {
          await api("vitals");
          return enterAgent();
        } catch (e) {
          S.token = null;
        }
      }
      try {
        const sess = await fetch(base + "/api/session").then((r) => (r.ok ? r.json() : null));
        if (sess && sess.token) {
          S.token = sess.token;
          tokens[base || location.host] = sess.token;
          LS.set("tokens", tokens);
          return enterAgent();
        }
      } catch (e) { /* not loopback */ }
      // Reachable but needs pairing (phone on the LAN). A scanned QR carries the code.
      const scannedCode = new URLSearchParams(location.hash.slice(1)).get("pair");
      if (scannedCode) {
        history.replaceState(null, "", location.pathname);
        try {
          await pairWith(base, scannedCode);
          toast("Connected to " + (S.hostname || "your computer") + " 🎉");
          return;
        } catch (e) {
          toast("That code was already used — scan the new code on your computer.");
        }
      }
      S.mode = "needs-pair";
      render();
      return;
    }
    if (LS.get("demo", false)) return startDemo(false);
    enterBrowser();
  }

  function enterAgent() {
    S.mode = "agent";
    if (!LS.get("welcomed", false)) {
      // First run after installing: give the computer a checkup right away.
      LS.set("welcomed", true);
      S.welcome = true;
      S.view = S.simple ? "home" : S.view;
      setTimeout(() => {
        if (!S.scan) startScan(null, true);
      }, 600);
    }
    LS.set("demo", false);
    if (S.base) LS.set("agentBase", S.base);
    render();
    clearInterval(S.poll);
    S.poll = setInterval(tick, 5000);
    return refreshAll();
  }

  function enterBrowser() {
    S.mode = "browser";
    render();
    readBrowserSignals();
  }

  function startDemo(fromHash) {
    S.mode = "demo";
    if (!fromHash) LS.set("demo", true);
    Demo.init();
    render();
    clearInterval(S.poll);
    S.poll = setInterval(tick, 3000);
    return refreshAll();
  }

  function exitDemo() {
    LS.set("demo", false);
    clearInterval(S.poll);
    S.scan = null;
    S.vault = [];
    S.receipts = [];
    if (location.hash.includes("demo")) history.replaceState(null, "", location.pathname);
    S.mode = "connecting";
    render();
    connect();
  }

  async function pairWith(base, code) {
    const res = await fetch(base + "/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim(), device: deviceName() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Pairing failed");
    const tokens = LS.get("tokens", {});
    tokens[base || location.host] = data.token;
    LS.set("tokens", tokens);
    S.base = base;
    S.token = data.token;
    S.hostname = data.hostname;
    enterAgent();
  }

  function deviceName() {
    return { iphone: "iPhone/iPad", android: "Android phone", mac: "Mac browser", windows: "Windows browser" }[S.platform] || "Browser";
  }

  // ---------------------------------------------------------------- refresh
  async function tick() {
    if (S.mode !== "agent" && S.mode !== "demo") return;
    try {
      S.vitals = await api("vitals");
      if (S.vitals.cpu) pushTrail(S.cpuTrail, S.vitals.cpu.percent);
      if (S.vitals.memory) pushTrail(S.memTrail, S.vitals.memory.percent);
      if (["overview", "performance"].includes(S.view)) S.processes = (await api("processes?limit=40")).processes;
      softRender();
    } catch (e) {
      if (e.status === 401) {
        S.token = null;
        S.mode = "needs-pair";
        render();
      }
    }
  }

  function pushTrail(arr, value) {
    if (value == null) return;
    arr.push(value);
    if (arr.length > 60) arr.shift();
  }

  async function refreshAll() {
    try {
      const [vitals, procs, hist, baseline, vault, receipts, scanState] = await Promise.all([
        api("vitals"), api("processes?limit=40"), api("history?hours=24"), api("baseline"),
        api("vault"), api("receipts"), api("scan?summary=1"),
      ]);
      S.vitals = vitals;
      S.processes = procs.processes;
      S.history = hist.series;
      S.cpuTrail = S.history.slice(-60).map((x) => x.cpu).filter((x) => x != null);
      S.memTrail = S.history.slice(-60).map((x) => x.mem).filter((x) => x != null);
      S.baseline = baseline;
      S.vault = vault.batches;
      S.vaultHours = vault.retention_hours;
      S.receipts = receipts.receipts;
      if (scanState.result && !S.scan) adoptScan(scanState.result);
      if (scanState.status === "running") pollScan();
      render();
      const [drain, forecast, startup, pairing, settings] = await Promise.all([
        api("drain?hours=24"), api("battery/forecast"), api("startup"), api("pairing"), api("settings").catch(() => null),
      ]);
      S.settings = settings;
      S.drain = drain;
      S.forecast = forecast;
      S.startup = startup.items;
      S.pairing = pairing;
      softRender();
    } catch (e) {
      toast("Could not reach the agent: " + e.message);
    }
  }

  // ------------------------------------------------------- browser signals
  async function readBrowserSignals() {
    const b = S.browser;
    b.cores = navigator.hardwareConcurrency || null;
    b.memoryGB = navigator.deviceMemory || null;
    b.connection = navigator.connection ? { type: navigator.connection.effectiveType, downlink: navigator.connection.downlink, saveData: navigator.connection.saveData } : null;
    try {
      if (navigator.storage && navigator.storage.estimate) b.storage = await navigator.storage.estimate();
    } catch (e) { /* ignore */ }
    if (navigator.getBattery) {
      try {
        const bat = await navigator.getBattery();
        const update = () => {
          b.battery = { percent: Math.round(bat.level * 100), charging: bat.charging, dischargingTime: bat.dischargingTime };
          if (!bat.charging) {
            b.drainLog.push({ t: Date.now(), p: bat.level * 100 });
            b.drainLog = b.drainLog.filter((x) => Date.now() - x.t < 6 * 3600e3).slice(-200);
            LS.set("drainLog", b.drainLog);
          }
          softRender();
        };
        bat.addEventListener("levelchange", update);
        bat.addEventListener("chargingchange", update);
        update();
      } catch (e) { /* not allowed */ }
    }
    softRender();
  }

  function browserDrainRate() {
    const log = S.browser.drainLog;
    if (log.length < 2) return null;
    const first = log[0];
    const last = log[log.length - 1];
    const hours = (last.t - first.t) / 3600e3;
    if (hours < 0.15 || first.p <= last.p) return null;
    return (first.p - last.p) / hours;
  }

  // ------------------------------------------------------------------- scan
  async function startScan(then, stay) {
    if (S.mode !== "agent" && S.mode !== "demo") {
      toast("Scanning needs the local agent.");
      go("devices");
      return;
    }
    if (then) S.pendingAfterScan = then;
    try {
      await api("scan", { body: { deep: true } });
      S.scanState = { status: "running", progress: 0, step: "Starting" };
      if (S.view !== "clean" && !then && !stay) go("clean");
      else softRender();
      pollScan();
    } catch (e) {
      toast(e.message);
    }
  }

  async function pollScan() {
    clearTimeout(S.scanTimer);
    try {
      const st = await api("scan");
      S.scanState = st;
      if (st.status === "done") {
        adoptScan(st.result);
        softRender();
        botSay("Scan finished in " + S.scan.seconds + " s: **" + fmt(S.scan.reclaimable) + "** reclaimable, " + fmt(S.scan.safe_reclaimable) + " of it fully safe." + (S.scan.duplicate_waste ? " Plus " + fmt(S.scan.duplicate_waste) + " in exact duplicates." : ""), [
          { label: "Clean safe items", action: "clean-safe", primary: true },
          { label: "Review", action: "view", view: "clean" },
        ]);
        if (S.fixAfterScan) {
          S.fixAfterScan = false;
          openFixSheet();
        }
        if (S.welcome) {
          S.welcome = false;
          softRender();
        }
        if (S.pendingAfterScan) {
          const text = S.pendingAfterScan;
          S.pendingAfterScan = null;
          answer(text, true);
        }
        return;
      }
      if (st.status === "error") {
        toast(st.step);
        softRender();
        return;
      }
      softRender();
      S.scanTimer = setTimeout(pollScan, 600);
    } catch (e) {
      S.scanTimer = setTimeout(pollScan, 1500);
    }
  }

  function adoptScan(result) {
    S.scan = result;
    S.selected = new Set();
    result.categories.filter((c) => c.safety === "safe").forEach((c) => c.items.forEach((i) => S.selected.add(i.id)));
  }

  function selectedBytes() {
    if (!S.scan) return 0;
    let total = 0;
    const seen = new Set();
    const addItem = (id, bytes) => {
      if (S.selected.has(id) && !seen.has(id)) {
        seen.add(id);
        total += bytes;
      }
    };
    S.scan.categories.forEach((c) => c.items.forEach((i) => addItem(i.id, i.bytes)));
    (S.scan.duplicates || []).forEach((g) => (g.copy_ids || []).forEach((id) => addItem(id, g.bytes_each)));
    (S.scan.large_files || []).forEach((f) => f.id && addItem(f.id, f.bytes));
    return total;
  }

  async function cleanTargets(payload, label) {
    const free = S.cleanMode === "free";
    const ok = await confirmDialog(
      free ? "Delete permanently?" : "Move to the Undo Vault?",
      free
        ? "These items will be deleted right away and cannot be restored. The space is freed immediately."
        : "Items move into the Undo Vault and can be restored with one click for " + (S.vaultHours || 72) + " hours. Space is released when the batch expires or you purge it.",
      free ? "Delete now" : "Move to vault",
      free
    );
    if (!ok) return;
    try {
      const res = await api("clean", { body: Object.assign({ mode: S.cleanMode, label: label || "Cleanup" }, payload) });
      const n = res.items.length;
      S.vault = (await api("vault")).batches;
      S.receipts = (await api("receipts")).receipts;
      // Remove cleaned items from the visible scan result.
      const gone = new Set(res.items.map((i) => i.original));
      if (S.scan) {
        S.scan.categories.forEach((c) => {
          c.items = c.items.filter((i) => !gone.has(i.path));
          c.bytes = c.items.reduce((s, i) => s + i.bytes, 0);
          c.count = c.items.length;
        });
        S.scan.duplicates = (S.scan.duplicates || []).map((g) => Object.assign({}, g, {
          copies: g.copies.filter((p) => !gone.has(p)),
        })).filter((g) => g.copies.length);
        S.scan.duplicate_waste = S.scan.duplicates.reduce((s, g) => s + g.bytes_each * g.copies.length, 0);
        S.scan.large_files = (S.scan.large_files || []).filter((f) => !gone.has(f.path));
        S.scan.reclaimable = S.scan.categories.reduce((s, c) => s + c.bytes, 0);
        S.scan.safe_reclaimable = S.scan.categories.filter((c) => c.safety === "safe").reduce((s, c) => s + c.bytes, 0);
      }
      S.selected = new Set();
      S.vitals = await api("vitals");
      render();
      const skipped = res.skipped.length ? " (" + res.skipped.length + " skipped — in use or protected)" : "";
      if (free) toast("Deleted " + n + " item(s), " + fmt(res.bytes) + skipped);
      else toast("Moved " + n + " item(s), " + fmt(res.bytes) + " to the Undo Vault" + skipped, { label: "Undo", run: () => restoreBatch(res.id) });
      botSay((free ? "Deleted " : "Moved ") + n + " item(s) — **" + fmt(res.bytes) + "**" + (free ? "." : " — to the Undo Vault. Say \"undo\" any time in the next " + (S.vaultHours || 72) + " h.") + (res.receipt.measured_freed != null && free ? " Measured disk change: " + fmt(res.receipt.measured_freed) + "." : ""));
    } catch (e) {
      toast(e.message);
    }
  }

  async function restoreBatch(id) {
    try {
      const r = await api("vault/restore", { body: { batch: id } });
      S.vault = (await api("vault")).batches;
      S.receipts = (await api("receipts")).receipts;
      toast("Restored " + r.restored + " item(s) to their original places");
      botSay("Restored **" + r.restored + "** item(s) exactly where they were." + (r.renamed.length ? " " + r.renamed.length + " were renamed \"(restored)\" because something new had taken their place." : ""));
      if (S.scan) S.scanState = null;
      render();
    } catch (e) {
      toast(e.message);
    }
  }

  async function purgeBatch(id) {
    const ok = await confirmDialog("Purge this batch?", "The files are deleted for good and the space is freed. This cannot be undone.", "Purge", true);
    if (!ok) return;
    try {
      const r = await api("vault/purge", { body: { batch: id } });
      S.vault = (await api("vault")).batches;
      S.receipts = (await api("receipts")).receipts;
      S.vitals = await api("vitals");
      toast("Purged — measured " + fmt(r.measured_freed || r.bytes) + " freed");
      render();
    } catch (e) {
      toast(e.message);
    }
  }

  async function quitProcess(pid, name) {
    const ok = await confirmDialog("Quit " + name + "?", "Vitals asks it to quit normally, so it can still prompt you to save unsaved work. System processes are never touched.", "Quit " + name, false);
    if (!ok) return;
    try {
      const r = await api("process/quit", { body: { pid } });
      toast(r.message);
      setTimeout(tick, 1200);
    } catch (e) {
      toast(e.message);
    }
  }

  async function openSettings(target) {
    if (S.mode === "demo") return toast("Demo: this would open your system's " + target + " settings.");
    if (S.mode !== "agent") return toast("Opening settings needs the agent on this computer.");
    try {
      const r = await api("settings/open", { body: { target } });
      toast(r.message);
    } catch (e) {
      toast(e.message);
    }
  }

  // --------------------------------------------------------------- actions
  async function runAction(a) {
    switch (a.action || a.type) {
      case "say": return answer(a.text);
      case "view": return go(a.view);
      case "scan": return startScan(a.then);
      case "clean-safe": {
        if (!S.scan) return startScan();
        const cats = S.scan.categories.filter((c) => c.safety === "safe" && c.bytes > 0).map((c) => c.id);
        if (!cats.length) return toast("No safe items left to clean.");
        return cleanTargets({ categories: cats }, "Safe junk");
      }
      case "clean-plan": {
        const p = a.plan;
        const cats = p.steps.filter((s) => s.kind === "category").map((s) => s.id);
        const targets = [].concat(...p.steps.filter((s) => s.kind === "targets").map((s) => s.targets));
        return cleanTargets({ categories: cats, targets }, "Goal: free " + fmt(p.goal));
      }
      case "clean-selected": return cleanTargets({ targets: Array.from(S.selected) }, "Selected items");
      case "quit": return quitProcess(a.pid, a.name);
      case "restore": return restoreBatch(a.batch);
      case "purge": return purgeBatch(a.batch);
      case "settings": return openSettings(a.target);
      case "demo": return startDemo(false);
      case "exit-demo": return exitDemo();
      case "benchmark": go("performance"); return runBenchmark();
      case "guide": S.guide = a.platform; return go("guides");
      case "fix-all": return fixAll();
      case "fix-reset": S.fix = null; return renderMain();
      case "fix-preview": return S.scan ? openFixSheet() : fixAll();
      case "free-batch": return purgeBatch(a.batch);
      case "auto-care": return toggleAutoCare();
      case "simple-on": return setSimple(true);
      case "simple-off": return setSimple(false);
      case "lan-on": return setLan(true);
      case "lan-off": return setLan(false);
      default: return null;
    }
  }

  // ---------------------------------------------------------------- render
  function go(view) {
    S.view = view;
    if (location.hash !== "#view=" + view && !location.hash.includes("demo")) history.replaceState(null, "", "#view=" + view);
    render();
    $(".main").scrollTop = 0;
    if (view === "performance" && (S.mode === "agent" || S.mode === "demo")) api("processes?limit=40").then((r) => { S.processes = r.processes; softRender(); }).catch(() => {});
    closeChatOnMobile();
  }

  let renderQueued = false;
  function softRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      // Don't clobber the page while the user is typing in an input inside main.
      const active = document.activeElement;
      if (active && $(".main") && $(".main").contains(active) && /INPUT|SELECT|TEXTAREA/.test(active.tagName)) return renderNavOnly();
      renderMain();
      renderNavOnly();
    });
  }

  function render() {
    document.body.classList.toggle("simple", !!S.simple);
    renderShell();
    renderMain();
    renderChat();
  }

  function renderShell() {
    const app = $("#app");
    if (app.dataset.built) return renderNavOnly();
    app.dataset.built = "1";
    app.innerHTML =
      '<div class="shell" id="shell">' +
      '<nav class="nav" aria-label="Sections">' +
      '<div class="brand"><svg class="brand-mark" viewBox="0 0 32 32"><defs><linearGradient id="bm" x1="0" x2="1"><stop offset="0" stop-color="#3ef0b5"/><stop offset="1" stop-color="#5cc8ff"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#bm)"/><path d="M5 17h5l2.5-6 4 11 3-8 1.5 3H27" fill="none" stroke="#04261b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><div>Vitals<small>Device health copilot</small></div></div>' +
      '<div id="navlist"></div><div class="nav-spacer"></div><div class="nav-foot" id="navfoot"></div></nav>' +
      '<main class="main" id="main" tabindex="-1"></main>' +
      '<aside class="chat" id="chat" aria-label="Ask Vitals"></aside>' +
      '<button class="chat-fab" id="chatfab" aria-label="Ask Vitals">' + icon("chat") + "</button>" +
      '<nav class="tabbar" id="tabbar" aria-label="Sections"></nav>' +
      "</div>";
    renderNavOnly();
  }

  function renderNavOnly() {
    const vaultCount = S.vault.length;
    const live = S.mode === "agent" || S.mode === "demo";
    const label = (v) => (v.id === "devices" ? (S.mode === "browser" ? (S.platform === "iphone" || S.platform === "android" ? "My computer" : "Install") : S.simple ? "Phone" : v.label) : v.label);
    const navButton = (v) =>
      '<button class="nav-btn" data-go="' + v.id + '"' + (S.view === v.id ? ' aria-current="page"' : "") + ">" + icon(v.id === "devices" && S.simple && live ? "phone" : v.icon) + "<span>" + label(v) + "</span>" +
      (v.id === "devices" && S.mode === "browser" ? '<span class="badge safe">1 step</span>' : "") +
      (v.id === "vault" && vaultCount ? '<span class="badge info">' + vaultCount + "</span>" : "") +
      (v.id === "clean" && S.scanState && S.scanState.status === "running" ? '<span class="badge info">' + (S.scanState.progress || 0) + "%</span>" : "") +
      "</button>";
    let items;
    if (S.simple) {
      items = ["home", "devices", "guides"].map((id) => navButton(VIEWS.find((v) => v.id === id))).join("") +
        '<button class="nav-btn" data-open-chat>' + icon("chat") + "<span>Ask Vitals</span></button>" +
        '<div class="nav-sep"></div><button class="nav-btn subtle" data-action="simple-off">' + icon("tools") + "<span>All tools</span></button>";
    } else {
      items = VIEWS.map(navButton).join("") +
        '<div class="nav-sep"></div><button class="nav-btn subtle" data-action="simple-on">' + icon("home") + "<span>Simple view</span></button>";
    }
    $("#navlist").innerHTML = items;
    const tabs = S.simple ? ["home", "devices", "chat", "guides", "tools"] : ["home", "clean", "battery", "guides", "more"];
    $("#tabbar").innerHTML = tabs.map((id) => {
      if (id === "chat") return '<button data-open-chat>' + icon("chat") + "<span>Ask</span></button>";
      if (id === "tools") return '<button data-action="simple-off">' + icon("tools") + "<span>All tools</span></button>";
      const v = VIEWS.find((x) => x.id === id) || { id: "more", label: "More", icon: "more" };
      const current = id === "more" ? ["performance", "vault", "devices", "overview"].includes(S.view) : S.view === id;
      return '<button data-go="' + id + '"' + (current ? ' aria-current="page"' : "") + ">" + icon(id === "devices" && S.simple && live ? "phone" : v.icon) + "<span>" + label(v) + "</span></button>";
    }).join("");
    $("#navfoot").innerHTML = "Local-only · no account · no telemetry<br>" +
      '<button data-theme-toggle>' + (document.documentElement.dataset.theme === "light" ? "Dark" : "Light") + " theme</button> · " +
      '<a href="https://github.com/juw12/projects/tree/main/apps/vitals" target="_blank" rel="noopener">Source</a>';
  }

  function setSimple(on) {
    S.simple = on;
    LS.set("simple", on);
    go(on ? "home" : "overview");
  }

  function modePill() {
    if (S.mode === "agent") return '<span class="mode-pill" title="Connected to the local agent"><span class="dot live"></span>Live · ' + esc(S.hostname || "this computer") + "</span>";
    if (S.mode === "demo") return '<button class="mode-pill" data-action="exit-demo" title="Leave demo"><span class="dot warn"></span>Demo data · exit</button>';
    if (S.mode === "browser") return '<button class="mode-pill" data-go="devices"><span class="dot"></span>Browser mode · get full version</button>';
    return '<span class="mode-pill"><span class="dot"></span>Connecting…</span>';
  }

  function topbar(title, sub, extra) {
    return '<div class="topbar"><div><h1>' + esc(title) + '</h1><div class="sub">' + sub + '</div></div><div class="grow"></div>' + (extra || "") + modePill() +
      '<button class="btn ghost icon-btn hide-mobile" data-theme-toggle aria-label="Toggle theme">' + icon(document.documentElement.dataset.theme === "light" ? "moon" : "sun") + "</button></div>";
  }

  function renderMain() {
    const main = $("#main");
    if (!main) return;
    if (S.mode === "connecting") {
      main.innerHTML = topbar("Vitals", "Looking for the local agent…") + '<div class="card empty">' + icon("pulse") + "<div>Checking this device…</div></div>";
      return;
    }
    if (S.mode === "needs-pair") {
      main.innerHTML = topbar("Pair this device", "The agent is running on your computer — confirm it's you.") + pairCard(true);
      return;
    }
    const views = { home: viewHome, overview: viewOverview, clean: viewClean, performance: viewPerformance, battery: viewBattery, vault: viewVault, devices: viewDevices, guides: viewGuides, more: viewMore };
    main.innerHTML = (views[S.view] || viewOverview)();
  }

  // --------------------------------------------------------------- charts
  function sparkline(values, color, max) {
    const vals = (values || []).filter((v) => v != null);
    if (vals.length < 2) return '<svg class="spark" viewBox="0 0 100 30"></svg>';
    const top = max || Math.max(100, ...vals);
    const step = 100 / (vals.length - 1);
    const pts = vals.map((v, i) => (i * step).toFixed(2) + "," + (28 - (v / top) * 26).toFixed(2));
    const id = "g" + Math.random().toString(36).slice(2, 7);
    return '<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><defs><linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".35"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<polygon points="0,30 ' + pts.join(" ") + ' 100,30" fill="url(#' + id + ')"/><polyline points="' + pts.join(" ") + '" fill="none" stroke="' + color + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>';
  }

  function lineChart(series, keys) {
    const W = 600;
    const H = 160;
    const pad = 24;
    if (!series || series.length < 2) return '<div class="empty small">Collecting history — the agent samples every 30 s. Come back in a few minutes.</div>';
    const t0 = series[0].ts;
    const t1 = series[series.length - 1].ts;
    const x = (t) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad - 6);
    const y = (v) => H - 18 - (v / 100) * (H - 30);
    let out = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none">';
    [0, 50, 100].forEach((g) => { out += '<line class="grid-line" x1="' + pad + '" x2="' + W + '" y1="' + y(g) + '" y2="' + y(g) + '"/><text class="axis" x="0" y="' + (y(g) + 3) + '">' + g + "%</text>"; });
    keys.forEach((k) => {
      const pts = series.filter((s) => s[k.key] != null).map((s) => x(s.ts).toFixed(1) + "," + y(s[k.key]).toFixed(1));
      out += '<polyline points="' + pts.join(" ") + '" fill="none" stroke="' + k.color + '" stroke-width="1.8" vector-effect="non-scaling-stroke"/>';
    });
    const h = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    out += '<text class="axis" x="' + pad + '" y="' + (H - 3) + '">' + h(t0) + '</text><text class="axis" x="' + (W - 40) + '" y="' + (H - 3) + '">' + h(t1) + "</text></svg>";
    return out;
  }

  function hourlyChart(info, hour) {
    if (!info) return "";
    const W = 600;
    const H = 120;
    const bw = W / 24;
    let out = '<svg class="chart" style="height:120px" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none">';
    info.hourly.forEach((v, i) => {
      const h = v == null ? 2 : Math.max(2, (v / 100) * (H - 22));
      out += '<rect x="' + (i * bw + 2) + '" y="' + (H - 16 - h) + '" width="' + (bw - 4) + '" height="' + h + '" rx="3" fill="' + (i === hour ? "var(--accent-2)" : "var(--line-strong)") + '"/>';
      if (i % 3 === 0) out += '<text class="axis" x="' + (i * bw + 2) + '" y="' + (H - 3) + '">' + String(i).padStart(2, "0") + "</text>";
    });
    if (info.current != null) {
      const cy = H - 16 - (info.current / 100) * (H - 22);
      out += '<line x1="' + (hour * bw) + '" x2="' + ((hour + 1) * bw) + '" y1="' + cy + '" y2="' + cy + '" stroke="var(--accent)" stroke-width="3"/>';
    }
    return out + "</svg>";
  }

  function orb(h, levels) {
    const rings = [
      { key: "storage", color: "#3ef0b5", r: 100 },
      { key: "memory", color: "#5cc8ff", r: 86 },
      { key: "cpu", color: "#b28cff", r: 72 },
      { key: "battery", color: "#ffb547", r: 58 },
    ];
    let out = '<svg class="orb" viewBox="0 0 240 240" role="img" aria-label="Health score ' + h.score + '">';
    rings.forEach((ring) => {
      const c = 2 * Math.PI * ring.r;
      const lv = levels[ring.key];
      out += '<circle class="track" cx="120" cy="120" r="' + ring.r + '" fill="none" stroke-width="9"/>';
      if (lv != null) {
        out += '<circle cx="120" cy="120" r="' + ring.r + '" fill="none" stroke="' + ring.color + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + (c * lv).toFixed(1) + " " + c.toFixed(1) + '" transform="rotate(-90 120 120)" style="transition:stroke-dasharray .8s"/>';
      }
    });
    out += '<text class="score" x="120" y="134" text-anchor="middle">' + (h.known ? h.score : "–") + "</text></svg>";
    out += '<div class="orb-band ' + (h.score >= 70 ? "ok" : h.score >= 50 ? "warn" : "bad") + '">' + esc(h.known ? h.band : "Partial view") + "</div>";
    out += '<div class="orb-legend">' + rings.map((r) => '<span><i style="background:' + r.color + '"></i>' + (r.key === "cpu" ? "CPU" : r.key[0].toUpperCase() + r.key.slice(1)) + (levels[r.key] == null ? " · n/a" : "") + "</span>").join("") + "</div>";
    return out;
  }

  // ---------------------------------------------------------------- views
  function viewOverview() {
    if (S.mode === "browser") return viewBrowserOverview();
    const v = S.vitals || {};
    const h = B.healthScore(v, S.scan);
    const fixes = B.recommendations({ vitals: v, scan: S.scan, processes: S.processes, anomalies: S.baseline ? S.baseline.anomalies : [], vaultBytes: v.vault_bytes });
    const disk = v.disk || {};
    const mem = v.memory || {};
    const bat = v.battery || {};
    const device = v.device || {};
    const sub = esc([device.model || device.os, device.os_version, device.cpus ? device.cpus + " cores" : ""].filter(Boolean).join(" · ")) + (v.uptime ? " · up " + B.fmtDuration(v.uptime) : "");
    let html = topbar("Overview", sub || "Your device at a glance");
    html += '<div class="hero">';
    html += '<div class="card orb-wrap">' + orb(h, B.systemLevels(v)) + "</div>";
    html += '<div class="card"><h2>Why this score <span class="hint">start at 100, every point explained</span></h2><p class="lede">No scare tactics: each penalty is measured, and fixing it raises the score by exactly that much.</p><ul class="why-list">' +
      h.factors.map((f) => '<li><span class="pts ' + (f.points < 0 ? "neg" : "zero") + '">' + (f.points < 0 ? f.points : "✓") + "</span><span><b>" + esc(f.label) + "</b> — <span class=\"muted\">" + esc(f.detail) + "</span></span></li>").join("") +
      "</ul></div></div>";

    html += '<div class="grid g-4" style="margin-top:16px">';
    html += statCard("CPU", pct(v.cpu && v.cpu.percent), v.cpu && v.cpu.load ? "load " + v.cpu.load.join(" · ") : "", sparkline(S.cpuTrail, "#b28cff"));
    html += statCard("Memory", pct(mem.percent), (mem.pressure ? "pressure " + mem.pressure : "") + (mem.swap_used ? " · swap " + fmt(mem.swap_used) : ""), sparkline(S.memTrail, "#5cc8ff"));
    html += statCard("Free space", fmt(disk.free), disk.total ? "of " + fmt(disk.total) + " · " + pct(100 - disk.percent) + " free" : "", '<div class="bar ' + (disk.percent > 95 ? "bad" : disk.percent > 85 ? "warn" : "") + '"><i style="width:' + (disk.percent || 0) + '%"></i></div>');
    html += statCard("Battery", bat.present ? bat.percent + "%" : "—", bat.present ? (bat.plugged ? (bat.charging ? "charging" : "plugged in") : bat.minutes_left ? B.fmtDuration(bat.minutes_left * 60) + " left" : "on battery") + (bat.health_percent ? " · health " + Math.round(bat.health_percent) + "%" : "") : "no battery", bat.present ? '<div class="bar ' + (bat.percent < 20 ? "bad" : "") + '"><i style="width:' + bat.percent + '%"></i></div>' : "");
    html += "</div>";

    html += '<div class="grid g-2" style="margin-top:16px"><div class="card"><h2>Top fixes <span class="hint">ranked by impact</span></h2><p class="lede">Each one is a single click, and cleanups are reversible.</p>' +
      (fixes.length ? fixes.map(fixRow).join("") : '<div class="empty">' + icon("shield") + "<div>Nothing needs fixing right now.</div></div>") + "</div>";
    html += '<div class="card"><h2>What makes Vitals different</h2><p class="lede">Built around the things people hate about cleaner apps.</p><ul class="why-list">' +
      [
        ["Undo Vault", "every cleanup can be restored for 72 h — nobody else lets you take it back"],
        ["Proof receipts", "disk space measured before and after each action, not a made-up number"],
        ["Your normal", "learns this device's usual load per hour and flags what's unusual for you"],
        ["Goal planner", "\"free 10 GB without touching downloads\" → lowest-risk plan"],
        ["Drain Detective", "finds apps that burn battery while you're away"],
        ["Honest", "no RAM boosting, no registry 'fixes', no account, no telemetry, open source"],
      ].map((x) => '<li><span class="pts zero">✓</span><span><b>' + x[0] + "</b> — <span class=\"muted\">" + x[1] + "</span></span></li>").join("") + "</ul></div></div>";
    return html;
  }

  function statCard(k, v, s, extra) {
    return '<div class="card stat"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + esc(s) + "</div>" + (extra || "") + "</div>";
  }

  function fixRow(f) {
    const a = f.action;
    let btn = "";
    if (a) {
      const attrs = Object.entries(Object.assign({ action: a.type }, a)).filter(([k]) => k !== "type" && k !== "label").map(([k, val]) => "data-" + k + '="' + esc(val) + '"').join(" ");
      btn = '<button class="btn sm ' + (f.level === "high" ? "primary" : "") + '" ' + attrs + ">" + esc(a.label) + "</button>";
    }
    return '<div class="fix ' + f.level + '"><div class="ico">' + icon(f.icon) + "</div><div><h3>" + esc(f.title) + "</h3><p>" + esc(f.body) + '</p></div><div class="act">' + btn + "</div></div>";
  }

  function viewBrowserOverview() {
    const b = S.browser;
    const pb = B.PLAYBOOKS[S.guide];
    const phone = S.platform === "iphone" || S.platform === "android";
    const rate = browserDrainRate();
    let html = topbar("Overview", esc(pb ? pb.name : "This device") + " · browser mode");
    html += '<div class="notice" style="margin-bottom:16px"><b>' + (phone ? "Phones don't let any app or website clean other apps' storage." : "A browser tab can't read your disk or processes.") + "</b> " +
      (phone ? "So Vitals gives you the exact built-in steps that work (Guides), measures what the browser can, and can show your computer's health here with one scan." : "Install the free Vitals app with one copy-paste for real scans, the Undo Vault and live vitals — or explore everything with demo data first.") +
      '<div class="row wrap" style="margin-top:10px">' + (phone ? '<button class="btn sm primary" data-action="guide" data-platform="' + S.guide + '">Open ' + esc(pb.name) + " guide</button>" : '<button class="btn sm primary" data-go="devices">Get the full version — 1 step</button>') +
      '<button class="btn sm" data-action="demo">Explore with demo data</button></div></div>';
    html += '<div class="grid g-4">';
    html += statCard("Battery", b.battery ? b.battery.percent + "%" : "—", b.battery ? (b.battery.charging ? "charging" : rate ? "draining " + rate.toFixed(1) + "%/h" : "on battery — measuring drain") : (S.platform === "iphone" ? "Safari hides battery level" : "not exposed by this browser"));
    html += statCard("CPU cores", b.cores || "—", "logical processors");
    html += statCard("Memory", b.memoryGB ? "≥ " + b.memoryGB + " GB" : "—", b.memoryGB ? "browser-reported (rounded)" : "not exposed by this browser");
    html += statCard("Network", b.connection ? (b.connection.type || "—").toUpperCase() : "—", b.connection ? (b.connection.downlink ? b.connection.downlink + " Mb/s est." : "") + (b.connection.saveData ? " · data saver on" : "") : "not exposed by this browser");
    html += "</div>";
    html += '<div class="grid g-2" style="margin-top:16px">';
    html += '<div class="card"><h2>Throttle check</h2><p class="lede">Runs the same workload six times in a row. A big drop between the first and last run means the device is heating up and slowing itself down — a sign of a hot environment, a worn battery or a background hog.</p>' + benchSummary() + '<button class="btn primary" data-action="benchmark">Run throttle check (≈10 s)</button></div>';
    html += '<div class="card"><h2>' + esc(pb.name) + ' quick wins</h2><p class="lede">' + esc(pb.intro) + "</p>" + checklist(S.guide, 0, 4) + '<button class="btn sm" data-action="guide" data-platform="' + S.guide + '">Full guide</button></div>';
    html += "</div>";
    return html;
  }

  function viewMore() {
    let html = topbar("More", "Everything else");
    html += '<div class="grid g-2">' + ["performance", "vault", "devices"].map((id) => {
      const v = VIEWS.find((x) => x.id === id);
      return '<button class="card row" style="text-align:left;cursor:pointer" data-go="' + id + '"><span style="width:28px;height:28px;color:var(--accent)">' + icon(v.icon) + "</span><b>" + v.label + "</b></button>";
    }).join("") + "</div>";
    return html;
  }

  function viewClean() {
    const live = S.mode === "agent" || S.mode === "demo";
    let html = topbar("Clean", "Safety-graded, explained, and reversible", live ? '<button class="btn primary" data-action="scan"' + (S.scanState && S.scanState.status === "running" ? " disabled" : "") + ">" + icon("search") + (S.scan ? "Rescan" : "Scan storage") + "</button>" : "");
    if (!live) return html + agentNeeded("Storage scanning reads your disk, which a browser tab cannot do.");
    const st = S.scanState;
    if (st && st.status === "running") {
      html += '<div class="card"><h2>Scanning… ' + (st.progress || 0) + '%</h2><p class="lede">' + esc(st.step || "") + ' — read-only, nothing changes.</p><div class="bar"><i style="width:' + (st.progress || 0) + '%"></i></div></div>';
    }
    if (!S.scan) {
      if (!st || st.status !== "running") html += '<div class="card empty">' + icon("search") + "<div><b>Find what's safe to remove.</b><br>The scan is read-only and takes under a minute.</div><br><button class=\"btn primary\" data-action=\"scan\">Scan storage</button></div>";
      return html;
    }
    const sc = S.scan;
    html += '<div class="grid g-3">';
    html += statCard("Reclaimable", fmt(sc.reclaimable), fmt(sc.safe_reclaimable) + " fully safe");
    html += statCard("Duplicates", fmt(sc.duplicate_waste), (sc.duplicates || []).length + " sets of identical files");
    html += statCard("Last scan", ago(sc.finished), "took " + sc.seconds + " s");
    html += "</div>";

    html += '<div class="card" style="margin-top:16px"><h2>Goal planner <span class="hint">tell it what you need, it picks the lowest-risk mix</span></h2><div class="goal" style="margin-top:8px"><span>Free</span><input type="number" id="goalN" min="0.1" step="0.5" value="' + (LS.get("goal", 5)) + '"><select id="goalU"><option value="GB">GB</option><option value="MB">MB</option></select><span>without touching</span><select id="goalEx"><option value="">nothing excluded</option><option value="downloads">Downloads</option><option value="backups">device backups</option><option value="dev">developer files</option><option value="duplicates">duplicates</option><option value="trash">Trash</option></select><button class="btn primary" data-plan>Plan it</button></div><div id="planOut"></div></div>';

    const groups = {};
    sc.categories.forEach((c) => { (groups[c.group] = groups[c.group] || []).push(c); });
    html += '<div class="grid g-2" style="margin-top:16px;align-items:start"><div>';
    Object.keys(groups).forEach((g) => {
      const cats = groups[g].filter((c) => c.bytes > 0).sort((a, b) => b.bytes - a.bytes);
      if (!cats.length) return;
      html += '<h2 style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin:6px 4px 8px">' + esc(g) + "</h2>";
      cats.forEach((c) => { html += catBlock(c); });
    });
    const empty = sc.categories.filter((c) => !c.bytes).map((c) => c.name);
    if (empty.length) html += '<p class="small faint" style="margin:10px 4px">Already clean: ' + esc(empty.join(", ")) + ".</p>";
    html += "</div><div>";
    html += growthCard(sc) + duplicatesCard(sc) + largeCard(sc);
    html += "</div></div>";

    const n = S.selected.size;
    html += '<div class="action-bar"><b>' + fmt(selectedBytes()) + '</b><span class="muted small">' + n + " item(s) selected</span>" +
      '<div class="seg" role="group" aria-label="Clean mode"><button data-cmode="vault" aria-pressed="' + (S.cleanMode === "vault") + '">Undo Vault (' + (S.vaultHours || 72) + ' h)</button><button data-cmode="free" aria-pressed="' + (S.cleanMode === "free") + '">Free now</button></div>' +
      '<div class="grow" style="flex:1"></div><button class="btn primary" data-action="clean-selected"' + (n ? "" : " disabled") + ">" + icon("broom") + (S.cleanMode === "free" ? "Delete selected" : "Clean selected") + "</button></div>";
    return html;
  }

  function catBlock(c) {
    const ids = c.items.map((i) => i.id);
    const sel = ids.filter((id) => S.selected.has(id)).length;
    const all = sel === ids.length && ids.length > 0;
    const open = S.openCats.has(c.id);
    let html = '<div class="cat' + (open ? " open" : "") + '"><div class="cat-head" data-toggle-cat="' + c.id + '">' +
      '<input type="checkbox" data-cat-check="' + c.id + '"' + (all ? " checked" : "") + ' aria-label="Select ' + esc(c.name) + '">' +
      '<div class="ellipsis"><div class="name">' + esc(c.name) + (c.complete ? "" : ' <span class="badge">partial</span>') + '</div><div class="why ellipsis">' + esc(c.why) + "</div></div>" +
      '<span class="badge ' + c.safety + '">' + (c.safety === "safe" ? "Safe" : "Review") + "</span>" +
      '<span class="size">' + fmt(c.bytes) + "</span></div>";
    html += '<div class="cat-body"><div class="after"><b>After cleaning:</b> ' + esc(c.after) + "</div>";
    c.items.slice(0, 60).forEach((i) => {
      html += '<label class="item"><input type="checkbox" data-item="' + i.id + '"' + (S.selected.has(i.id) ? " checked" : "") + '><span class="path" title="' + esc(i.path) + '">' + esc(short(i.path)) + '</span><span class="mono">' + fmt(i.bytes) + "</span></label>";
    });
    if (c.items.length > 60) html += '<div class="small faint">+ ' + (c.items.length - 60) + " more</div>";
    return html + "</div></div>";
  }

  function growthCard(sc) {
    const g = sc.growth || [];
    if (!g.length) return "";
    const movers = g.some((x) => x.delta != null);
    const max = Math.max(...g.map((x) => Math.abs(movers ? x.delta || 0 : x.bytes)), 1);
    return '<div class="card"><h2>Growth radar <span class="hint">' + (movers ? "what changed since the last scan" : "first snapshot — biggest folders") + "</span></h2>" +
      '<p class="lede">' + (movers ? "The folders eating your space lately." : "Scan again later and Vitals shows exactly what grew.") + "</p>" +
      g.slice(0, 8).map((x) => {
        const val = movers ? x.delta || 0 : x.bytes;
        return '<div style="margin:8px 0"><div class="row small"><span class="ellipsis mono" title="' + esc(x.path) + '">' + esc(short(x.path)) + '</span><span class="right mono nowrap" style="color:' + (movers && val > 0 ? "var(--warn)" : "var(--muted)") + '">' + (movers ? (val >= 0 ? "+" : "") + fmt(val) : fmt(val)) + '</span></div><div class="bar ' + (movers && val > 0 ? "warn" : "") + '"><i style="width:' + (100 * Math.abs(val) / max).toFixed(1) + '%"></i></div></div>';
      }).join("") + "</div>";
  }

  function duplicatesCard(sc) {
    const d = sc.duplicates || [];
    if (!d.length) return "";
    return '<div class="card" style="margin-top:16px"><h2>Exact duplicates <span class="hint">content-hashed, oldest copy kept</span></h2>' +
      d.slice(0, 8).map((g) => '<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="row small"><b class="ellipsis">' + esc(short(g.keep).split("/").pop()) + '</b><span class="right mono">' + fmt(g.wasted) + ' wasted</span></div><div class="small muted ellipsis">Keeping ' + esc(short(g.keep)) + "</div>" +
        g.copies.map((p, i) => '<label class="item"><input type="checkbox" data-item="' + esc(g.copy_ids[i]) + '"' + (S.selected.has(g.copy_ids[i]) ? " checked" : "") + '><span class="path">' + esc(short(p)) + '</span><span class="mono">' + fmt(g.bytes_each) + "</span></label>").join("") + "</div>").join("") + "</div>";
  }

  function largeCard(sc) {
    const l = sc.large_files || [];
    if (!l.length) return "";
    return '<div class="card" style="margin-top:16px"><h2>Large files <span class="hint">your own files — never auto-selected</span></h2>' +
      l.slice(0, 10).map((f) => '<label class="item"><input type="checkbox" data-item="' + esc(f.id) + '"' + (S.selected.has(f.id) ? " checked" : "") + '><span class="path" title="' + esc(f.path) + '">' + esc(short(f.path)) + '</span><span class="mono">' + fmt(f.bytes) + "</span></label>").join("") + "</div>";
  }

  function viewPerformance() {
    const live = S.mode === "agent" || S.mode === "demo";
    let html = topbar("Performance", "Live load, your personal baseline, and what's using it");
    if (!live) {
      html += '<div class="card"><h2>Throttle check</h2><p class="lede">Same workload, six times. A drop between runs means the device is slowing itself down to cool off.</p>' + benchSummary() + '<button class="btn primary" data-action="benchmark">Run throttle check</button></div>';
      return html + agentNeeded("Process lists and history need the local agent.");
    }
    const b = S.baseline;
    html += '<div class="grid g-2">';
    html += '<div class="card"><h2>Last 24 hours <span class="hint"><span style="color:#b28cff">CPU</span> · <span style="color:#5cc8ff">memory</span></span></h2>' + lineChart(S.history, [{ key: "cpu", color: "#b28cff" }, { key: "mem", color: "#5cc8ff" }]) + "</div>";
    html += '<div class="card"><h2>Your normal <span class="hint">CPU by hour of day · bar = typical · line = now</span></h2>';
    if (b && b.metrics && b.metrics.cpu) {
      const m = b.metrics.cpu;
      html += hourlyChart(m, b.hour) + '<p class="small muted" style="margin:6px 0 0">' + (m.learning ? "Learning your pattern — " + b.samples + " samples so far. Anomaly alerts start after about 20 samples per hour of day." : "Typical at " + String(b.hour).padStart(2, "0") + ":00 is " + m.mean + "% ±" + m.std + ". Now: " + m.current + "% (z = " + m.z + ").") + "</p>";
      (b.anomalies || []).forEach((a) => { html += '<div class="notice warn" style="margin-top:8px">' + esc(a.message) + "</div>"; });
    } else html += '<div class="empty small">Loading…</div>';
    html += "</div></div>";

    const procs = S.processes || [];
    html += '<div class="grid g-2" style="margin-top:16px;align-items:start"><div class="card"><h2>Apps using the most</h2><p class="lede">Quit asks the app politely, so it can still offer to save. System processes are locked.</p><table class="table"><thead><tr><th>App</th><th class="num">CPU</th><th class="num">Memory</th><th class="act"></th></tr></thead><tbody>' +
      procs.slice(0, 14).map((p) => '<tr><td class="namecell ellipsis" title="' + esc(p.name) + " · pid " + p.pid + '">' + esc(p.name) + (p.protected ? ' <span class="badge">system</span>' : "") + '</td><td class="num">' + (p.cpu == null ? "—" : p.cpu.toFixed(1) + "%") + '</td><td class="num">' + fmt(p.rss) + "</td><td>" + (p.owned && !p.protected ? '<button class="btn sm ghost" style="padding:4px 8px" data-action="quit" data-pid="' + p.pid + '" data-name="' + esc(p.name) + '">Quit</button>' : "") + "</td></tr>").join("") +
      "</tbody></table></div>";
    html += '<div class="stack"><div class="card"><h2>Throttle check</h2><p class="lede">Same workload six times; a drop means thermal throttling.</p>' + benchSummary() + '<button class="btn" data-action="benchmark">Run throttle check</button></div>';
    html += '<div class="card"><h2>Starts automatically <span class="hint">' + S.startup.length + ' items · read-only</span></h2><p class="lede">Fewer startup items = faster boot and more free memory. Disable them in system settings.</p>' +
      (S.startup.length ? '<table class="table"><tbody>' + S.startup.slice(0, 14).map((s) => '<tr><td class="ellipsis namecell" title="' + esc(s.path || "") + '">' + esc(s.name) + '</td><td><span class="badge">' + esc(s.kind) + '</span></td><td class="small muted">' + esc(s.scope) + "</td></tr>").join("") + "</tbody></table>" : '<div class="empty small">Nothing found.</div>') +
      '<button class="btn sm" style="margin-top:10px" data-action="settings" data-target="startup">Open login-item settings</button></div></div></div>';
    return html;
  }

  function viewBattery() {
    const live = S.mode === "agent" || S.mode === "demo";
    let html = topbar("Battery", "Health, wear forecast, and what drains it");
    if (!live) {
      const b = S.browser.battery;
      const rate = browserDrainRate();
      html += '<div class="grid g-2"><div class="card"><h2>Right now</h2>' + (b ? '<div class="stat"><div class="v">' + b.percent + "%</div><div class=\"s\">" + (b.charging ? "charging" : rate ? "draining " + rate.toFixed(1) + "%/h (measured while this page was open)" : "on battery — keep this tab open to measure drain") + "</div></div>" : '<p class="muted">This browser does not expose the battery level' + (S.platform === "iphone" ? " (Safari never does)" : "") + ".</p>") + "</div>";
      html += '<div class="card"><h2>Make it last</h2>' + checklist(S.guide, S.guide === "iphone" || S.guide === "android" ? 1 : 1, 5) + "</div></div>";
      return html;
    }
    const bat = (S.vitals && S.vitals.battery) || {};
    if (!bat.present) return html + '<div class="card empty">' + icon("battery") + "<div>No battery on this device — it's a desktop. 🔌</div></div>";
    const health = bat.health_percent;
    const cells = health != null ? Math.round(health / 10) : 0;
    const cls = health == null ? "" : health < 80 ? "bad" : health < 85 ? "warn" : "";
    const f = S.forecast || {};
    const d = S.drain || {};
    html += '<div class="grid g-2">';
    html += '<div class="card"><h2>Battery health</h2><div class="gauge-big" style="margin:10px 0 14px"><div><div class="stat"><div class="v">' + (health != null ? health.toFixed(0) + "%" : "—") + '<small>of design capacity</small></div><div class="s">' + (bat.full_capacity ? bat.full_capacity + " / " + bat.design_capacity + " " + (bat.source && bat.source.includes("mWh") ? "mWh" : "mAh") : "") + (bat.cycles ? " · " + bat.cycles + " cycles" : "") + '</div></div></div><div class="cells ' + cls + '">' + Array.from({ length: 10 }, (_, i) => "<i" + (i < cells ? ' class="on"' : "") + "></i>").join("") + "</div></div>" +
      '<span class="badge ' + (cls === "bad" ? "bad" : cls === "warn" ? "review" : "safe") + '">' + esc(bat.condition || "unknown") + "</span>" +
      (f.message ? '<p class="small" style="margin:12px 0 0">' + esc(f.message) + "</p>" : "") + "</div>";
    html += '<div class="card"><h2>Right now</h2><div class="stat"><div class="v">' + bat.percent + '%</div><div class="s">' + (bat.plugged ? (bat.charging ? "charging" : "plugged in, not charging") : bat.minutes_left ? B.fmtDuration(bat.minutes_left * 60) + " remaining" : "on battery") + "</div></div>" +
      '<div class="bar" style="margin:12px 0"><i style="width:' + bat.percent + '%"></i></div>' +
      (d.percent_per_hour ? '<p class="small">Measured drain on battery: <b>' + d.percent_per_hour + "%/hour</b>.</p>" : '<p class="small muted">Drain rate appears after Vitals has watched a stretch on battery.</p>') +
      (bat.plugged && bat.percent >= 95 ? '<div class="notice warn small">Sitting at ' + bat.percent + "% while plugged in ages the battery fastest. Turn on your charge limit or optimized charging.</div>" : "") +
      '<button class="btn sm" style="margin-top:10px" data-action="settings" data-target="battery">Open battery settings</button></div>';
    html += "</div>";

    html += '<div class="grid g-2" style="margin-top:16px;align-items:start"><div class="card"><h2>Drain Detective <span class="hint">last 24 h · CPU time by app</span></h2><p class="lede">Where the energy goes. Columns split what happened on battery and while you were away.</p>' +
      ((d.processes || []).length ? '<table class="table"><thead><tr><th>App</th><th class="num">Share</th><th class="num">Battery</th><th class="num">Idle</th></tr></thead><tbody>' + d.processes.slice(0, 10).map((p) => '<tr><td class="ellipsis namecell">' + esc(p.name) + '</td><td class="num">' + p.share + '%</td><td class="num">' + (p.battery_seconds ? p.battery_share + "%" : "—") + '</td><td class="num">' + (p.idle_seconds ? Math.round(p.idle_seconds) + " s" : "—") + "</td></tr>").join("") + "</tbody></table>" : '<div class="empty small">Collecting — leave the agent running for a while.</div>') + "</div>";
    html += '<div class="card"><h2>Idle drainers</h2><p class="lede">Apps that kept working while nobody was using the computer — the classic "why is my battery empty in the morning".</p>' +
      ((d.idle_drainers || []).length ? d.idle_drainers.map((p) => '<div class="fix med"><div class="ico">' + icon("battery") + "</div><div><h3>" + esc(p.name) + "</h3><p>" + Math.round(p.idle_seconds) + " CPU-seconds while idle</p></div></div>").join("") : '<div class="empty small">None caught yet. 👍</div>') +
      '<h2 style="margin-top:16px">Charge coach</h2><ul class="why-list small"><li><span class="pts zero">1</span><span>Keep it between ~20% and 80% when you can.</span></li><li><span class="pts zero">2</span><span>Use optimized charging / a charge limit if you\'re plugged in all day.</span></li><li><span class="pts zero">3</span><span>Heat is the enemy — keep vents clear, don\'t charge in the sun.</span></li><li><span class="pts zero">4</span><span>Full discharges don\'t "calibrate" modern batteries; they add wear.</span></li></ul></div></div>';
    return html;
  }

  function viewVault() {
    const live = S.mode === "agent" || S.mode === "demo";
    let html = topbar("Undo Vault", "Every cleanup is reversible — and every action has a receipt");
    if (!live) return html + agentNeeded("The Undo Vault lives on your computer, next to the agent.");
    html += '<div class="grid g-2" style="align-items:start"><div class="card"><h2>Held in the vault <span class="hint">auto-purged after ' + (S.vaultHours || 72) + " h</span></h2>";
    if (!S.vault.length) html += '<div class="empty">' + icon("vault") + "<div>Empty. Cleanups land here first so you can change your mind.</div></div>";
    S.vault.forEach((b) => {
      const left = b.expires ? Math.max(0, b.expires - Date.now() / 1000) : null;
      html += '<div class="fix low"><div class="ico">' + icon("vault") + "</div><div><h3>" + esc(b.label) + " · " + fmt(b.bytes) + "</h3><p>" + b.count + " item(s) · " + ago(b.created) + (left != null ? " · purges in " + B.fmtDuration(left) : "") + "</p>" +
        '<details class="small"><summary class="muted" style="cursor:pointer">What\'s inside</summary>' + b.items.slice(0, 12).map((i) => '<div class="mono ellipsis faint">' + esc(short(i.original)) + "</div>").join("") + (b.count > 12 ? '<div class="faint">+ ' + (b.count - 12) + " more</div>" : "") + "</details>" +
        '</div><div class="act"><button class="btn sm primary" data-action="restore" data-batch="' + esc(b.id) + '">Restore</button><button class="btn sm danger" data-action="purge" data-batch="' + esc(b.id) + '">Purge</button></div></div>';
    });
    html += "</div>";
    html += '<div class="card"><h2>Receipts <span class="hint">measured, not estimated</span></h2><p class="lede">Free space on disk is read before and after every action.</p>';
    if (!S.receipts.length) html += '<div class="empty small">No actions yet.</div>';
    else html += '<ul class="timeline">' + S.receipts.slice(0, 25).map((r) => {
      const delta = r.measured_freed;
      return '<li><span class="tl-dot ' + r.kind + '"></span><div><b>' + esc(r.kind === "clean" ? "Cleaned" : r.kind === "restore" ? "Restored" : "Purged") + "</b> · " + esc(r.label) + '<div class="small muted">' + r.items + " item(s), " + fmt(r.bytes) + (r.skipped ? " · " + r.skipped + " skipped" : "") + "</div>" + '<div class="small faint">' + esc(r.note) + "</div></div>" +
        '<div class="small right nowrap" style="text-align:right">' + ago(r.time) + (delta != null && Math.abs(delta) > 1024 * 1024 ? '<div class="mono" style="color:' + (delta > 0 ? "var(--good)" : "var(--muted)") + '">' + (delta > 0 ? "+" : "") + fmt(delta) + " free</div>" : "") + "</div></li>";
    }).join("") + "</ul>";
    html += "</div></div>";
    return html;
  }


  // ---------------------------------------------------------------- home
  // Simple mode: one status, plain words, one big safe button, undo nearby.
  function viewHome() {
    if (S.mode === "browser") return viewHomeBrowser();
    const v = S.vitals || {};
    const f = B.plainFindings({ vitals: v, processes: S.processes });
    const noun = f.noun;
    const st = S.scanState;
    const scanning = st && st.status === "running";
    const safeBytes = S.scan ? S.scan.categories.filter((c) => c.safety === "safe").reduce((s, c) => s + c.bytes, 0) : null;
    let html = topbar("Home", esc(v.device && v.device.model ? v.device.model : "This " + noun) + " · checked " + (S.vitals ? "just now" : "…"), simpleToggle());

    if (S.welcome || (scanning && !S.scan)) {
      html += '<div class="notice welcome"><b>Welcome to Vitals! 👋</b> I\'m giving your ' + noun + " a quick checkup — about a minute. Nothing is changed without your OK.</div>";
    }

    const attention = f.items.filter((i) => i.tone !== "good").length;
    html += '<div class="card home-hero tone-' + f.tone + '"><div class="hero-icon">' + icon(f.tone === "good" ? "check" : "pulse") + '</div><div class="hero-text"><h2>' + esc(f.headline) + "</h2>" +
      '<p class="muted">' + (attention ? attention + (attention === 1 ? " thing" : " things") + " worth a look" : "Nothing needs your attention right now") +
      (safeBytes ? " · " + fmt(safeBytes) + " of safe junk found" : "") + "</p></div>";

    // The one big button (or its progress / result).
    if (scanning) {
      html += '<div class="hero-action"><div class="bigbar"><i style="width:' + (st.progress || 0) + '%"></i></div><div class="small muted">Checking your ' + noun + "… " + (st.progress || 0) + "%</div></div>";
    } else if (S.fix && S.fix.done) {
      html += '<div class="hero-action"><div class="fix-done">' + icon("check") + "<div><b>Done — " + fmt(S.fix.bytes) + " cleaned.</b><br><span class=\"small muted\">" +
        (S.fix.mode === "free" ? "The space is free now." : "Kept as a backup for 3 days in case you need anything back.") + "</span></div></div>" +
        '<div class="row wrap" style="margin-top:10px">' +
        (S.fix.mode === "vault" && S.vault.some((b) => b.id === S.fix.batch) ? '<button class="btn primary" data-action="free-batch" data-batch="' + esc(S.fix.batch) + '">Free the space now</button><button class="btn" data-action="restore" data-batch="' + esc(S.fix.batch) + '">' + icon("undo") + "Undo</button>" : "") +
        '<button class="btn ghost" data-action="fix-reset">OK</button></div></div>';
    } else {
      html += '<div class="hero-action"><button class="btn primary huge" data-action="fix-all">' + icon("broom") + "Fix everything safely</button>" +
        '<div class="small muted" style="margin-top:8px">Clears junk that rebuilds itself · never touches your files · undo for 3 days · <button class="linklike" data-action="fix-preview">see what it does</button></div></div>';
    }
    html += "</div>";

    // Findings in plain words.
    html += '<div class="card"><h2>What I found</h2><ul class="findings">' + (f.items.length ? f.items.map((item) => {
      const a = item.action;
      let btn = "";
      if (a) {
        const attrs = Object.entries(a).filter(([k]) => k !== "label").map(([k, val]) => "data-" + k + '="' + esc(val) + '"').join(" ");
        btn = '<button class="btn sm" ' + attrs + ">" + esc(a.label) + "</button>";
      } else if (item.fix && !(S.fix && S.fix.done)) {
        btn = '<button class="btn sm" data-action="fix-all">Free up space</button>';
      }
      return '<li class="tone-' + item.tone + '"><span class="dot-tone"></span><div><b>' + esc(item.title) + '</b><div class="small muted">' + esc(item.text) + "</div></div>" + btn + "</li>";
    }).join("") : '<li class="tone-good"><span class="dot-tone"></span><div><b>Collecting readings…</b></div></li>') + "</ul></div>";

    html += '<div class="grid g-2" style="margin-top:16px;align-items:start"><div class="stack home-col">';
    // Auto-care switch.
    const auto = S.settings && S.settings.auto_care;
    html += '<div class="card"><div class="row"><div style="flex:1"><h2>Keep my ' + noun + ' healthy automatically</h2><p class="small muted" style="margin:4px 0 0">Once a week I clear safe junk (always undoable) and tell you if storage gets low. Nothing else changes.</p></div>' +
      '<button class="switch' + (auto ? " on" : "") + '" role="switch" aria-checked="' + !!auto + '" data-action="auto-care" aria-label="Automatic care"><i></i></button></div>' +
      (auto && S.settings.next_auto_care ? '<p class="small faint" style="margin:8px 0 0">Next automatic care: ' + new Date(S.settings.next_auto_care * 1000).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }) + "</p>" : "") + "</div>";
    if (S.vault.length) {
      const last = S.vault[0];
      html += '<div class="card"><h2>' + icon("undo") + " Changed your mind?</h2><p class=\"small muted\" style=\"margin:4px 0 10px\">Your last cleanup (" + esc(last.label) + ", " + fmt(last.bytes) + ") can still be put back exactly as it was.</p><button class=\"btn\" data-action=\"restore\" data-batch=\"" + esc(last.id) + "\">Undo it</button></div>";
    }
    html += '<div class="card"><h2>' + icon("phone") + ' See this on your phone</h2><p class="small muted" style="margin:4px 0 10px">Scan one QR code with your phone camera — no app, no typing.</p><button class="btn" data-go="devices">Connect my phone</button></div>';
    html += '</div><div class="stack home-col">';
    // Ask anything.
    html += '<div class="card"><h2>Something bothering you?</h2><p class="small muted" style="margin:4px 0 10px">Describe it in your own words — I\'ll check and suggest a fix.</p>' +
      '<form class="ask-inline" data-ask-form><input name="q" placeholder="e.g. my ' + noun + ' is slow / battery dies fast" autocomplete="off"><button class="btn primary" type="submit">Ask</button></form>' +
      '<div class="chips">' + ["It feels slow", "It gets hot", "Battery dies fast", "Free 10 GB"].map((s) => '<button class="chip" data-say="' + esc(s) + '">' + esc(s) + "</button>").join("") + "</div></div>";
    html += "</div></div>";
    html += '<p class="small faint" style="text-align:center;margin-top:18px"><button class="linklike" data-action="simple-off">See all details and tools →</button></p>';
    return html;
  }

  function simpleToggle() {
    return '<button class="btn sm ghost hide-mobile" data-action="' + (S.simple ? "simple-off" : "simple-on") + '">' + (S.simple ? "Detailed view" : "Simple view") + "</button>";
  }

  function viewHomeBrowser() {
    const phone = S.platform === "iphone" || S.platform === "android";
    if (phone) {
      const pb = B.PLAYBOOKS[S.guide];
      let html = topbar("Keep your phone healthy", "Simple steps that really work — no app needed");
      html += '<div class="card"><h2>Free up space in a few taps</h2>' + checklist(S.guide, 0, 3) + '<button class="btn sm" data-action="guide" data-platform="' + S.guide + '">More tips for ' + esc(pb.name) + "</button></div>";
      html += '<div class="grid g-2" style="margin-top:16px"><div class="card"><h2>Make the battery last</h2>' + checklist(S.guide, 1, 3) + "</div>" +
        '<div class="card"><h2>' + icon("devices") + ' Check your computer from here</h2><p class="small muted">Install Vitals on your computer, then scan its QR code with this phone.</p><button class="btn" data-go="devices">How it works</button></div></div>';
      return html;
    }
    let html = topbar("Welcome to Vitals", "Keep your computer fast, tidy and healthy — safely, for free");
    html += installCard(true);
    html += '<div class="grid g-3" style="margin-top:16px">' +
      '<div class="card"><h2>' + icon("broom") + ' One button</h2><p class="small muted">"Fix everything safely" clears junk that rebuilds itself. Your files are never touched.</p></div>' +
      '<div class="card"><h2>' + icon("undo") + ' Always undoable</h2><p class="small muted">Every cleanup is kept as a backup for 3 days. Changed your mind? One click puts it back.</p></div>' +
      '<div class="card"><h2>' + icon("shield") + ' Private</h2><p class="small muted">Runs only on your computer. No account, no ads, nothing uploaded. Open source.</p></div></div>';
    html += '<p style="text-align:center;margin-top:18px"><button class="btn" data-action="demo">Just looking? Try it with demo data</button></p>';
    return html;
  }

  // ------------------------------------------------------------- fix flow
  async function fixAll() {
    if (S.mode !== "agent" && S.mode !== "demo") return go(S.mode === "browser" ? "home" : "devices");
    if (!S.scan) {
      S.fixAfterScan = true;
      await startScan(null, true);
      softRender();
      return;
    }
    openFixSheet();
  }

  function openFixSheet() {
    const cats = S.scan.categories.filter((c) => c.safety === "safe" && c.bytes > 0);
    const total = cats.reduce((s, c) => s + c.bytes, 0);
    if (!total) {
      toast("Already tidy — nothing safe to clean right now 👍");
      return;
    }
    const v = S.vitals || {};
    const freePct = v.disk && v.disk.total ? (100 * v.disk.free) / v.disk.total : 50;
    const critical = freePct < 5;
    let dlg = $("#fixsheet");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "fixsheet";
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = "<h3>Fix everything safely</h3>" +
      '<p class="muted" style="margin-top:0">I\'ll clear <b>' + fmt(total) + "</b> of junk that apps rebuild by themselves:</p>" +
      '<ul class="sheet-list">' + cats.map((c) => "<li><span>" + esc(c.name) + '</span><span class="mono">' + fmt(c.bytes) + "</span></li>").join("") + "</ul>" +
      '<p class="small muted">Your documents, photos, downloads and apps are not touched.</p>' +
      '<div class="choice"><label><input type="radio" name="fixmode" value="vault"' + (critical ? "" : " checked") + "> <span><b>Keep a backup for 3 days</b> (recommended)<br><span class=\"small muted\">Undo with one click. The space is freed after 3 days.</span></span></label>" +
      '<label><input type="radio" name="fixmode" value="free"' + (critical ? " checked" : "") + "> <span><b>Free the space right away</b><br><span class=\"small muted\">" +
      (critical ? "Recommended now — your storage is almost full, so a backup would take the same space." : "No undo for this cleanup.") + "</span></span></label></div>" +
      '<div class="actions"><button class="btn" value="no">Cancel</button><button class="btn primary" value="yes">Fix it</button></div>';
    dlg.querySelectorAll(".actions button").forEach((b) => b.addEventListener("click", async () => {
      const mode = (dlg.querySelector('input[name="fixmode"]:checked') || {}).value || "vault";
      dlg.close();
      if (b.value !== "yes") return;
      try {
        const res = await api("clean", { body: { categories: cats.map((c) => c.id), mode, label: "Fix everything" } });
        S.fix = { done: true, bytes: res.bytes, mode, batch: res.id };
        S.vault = (await api("vault")).batches;
        S.receipts = (await api("receipts")).receipts;
        S.vitals = await api("vitals");
        const gone = new Set(res.items.map((i) => i.original));
        S.scan.categories.forEach((c) => {
          c.items = c.items.filter((i) => !gone.has(i.path));
          c.bytes = c.items.reduce((s, i) => s + i.bytes, 0);
        });
        S.scan.reclaimable = S.scan.categories.reduce((s, c) => s + c.bytes, 0);
        S.scan.safe_reclaimable = S.scan.categories.filter((c) => c.safety === "safe").reduce((s, c) => s + c.bytes, 0);
        render();
        toast("Cleaned " + fmt(res.bytes) + (mode === "vault" ? " — undo anytime in the next 3 days" : ""), mode === "vault" ? { label: "Undo", run: () => restoreBatch(res.id) } : null);
      } catch (e) {
        toast(e.message);
      }
    }));
    dlg.showModal();
  }

  async function toggleAutoCare() {
    const next = !(S.settings && S.settings.auto_care);
    try {
      S.settings = await api("settings", { body: { auto_care: next } });
      toast(next ? "Automatic care is on — I'll look after things weekly." : "Automatic care is off.");
      renderMain();
    } catch (e) {
      toast(e.message);
    }
  }

  // ------------------------------------------------------------- install
  function installCard(hero) {
    const os = installOs();
    const info = INSTALL[os];
    const step = S.installStep;
    const others = Object.keys(INSTALL).filter((k) => k !== os);
    const picture = os === "windows"
      ? '<div class="mock win"><div class="mock-title">Run</div><div class="mock-body"><span class="small">Open:</span><span class="mock-input">' + (step >= 1 ? "<span class=\"paste-hint\">Ctrl + V</span>" : "") + '<i class="caret"></i></span><span class="mock-ok">OK</span></div></div>'
      : '<div class="mock term"><div class="mock-title"><i></i><i></i><i></i> Terminal</div><div class="mock-body"><span class="prompt">~ %</span> ' + (step >= 1 ? '<span class="paste-hint">' + (os === "mac" ? "⌘ V" : "Ctrl Shift V") + "</span>" : "") + '<i class="caret"></i></div></div>';
    let html = '<div class="install card' + (hero ? " hero-install" : "") + '">' +
      '<div class="install-head"><div><h2 style="font-size:20px">Get Vitals for ' + info.name + '</h2><p class="small muted" style="margin:2px 0 0">Free · about 30 seconds · no account · removes cleanly</p></div>' +
      '<div class="track">' + ["Copy", "Paste", "Done"].map((t, i) => '<span class="tstep' + (i < step ? " done" : i === step ? " current" : "") + '"><b>' + (i < step ? "✓" : i + 1) + "</b>" + t + "</span>").join('<span class="tline"></span>') + "</div></div>" +
      '<div class="install-body"><div><ol class="steps big">' + info.steps.map((s, i) => '<li class="' + (i === 0 && step >= 1 ? "done-step" : "") + '">' + s + "</li>").join("") + "</ol>" +
      '<button class="btn primary huge" data-copy-install>' + (step >= 1 ? "Copied ✓ — copy again" : "Copy the install line") + "</button>" +
      '<div class="cmd-line mono small faint" id="installCmd">' + esc(info.cmd) + "</div></div>" +
      '<div class="install-pic">' + picture + '<div class="small muted" style="margin-top:8px">' + (os === "windows" ? "Press Win + R, paste here, press Enter." : "Paste here and press " + (os === "mac" ? "Return" : "Enter") + ".") + "</div></div></div>" +
      downloadRow(os) +
      '<div class="install-status" id="installStatus"><span class="typing"><i></i><i></i><i></i></span> Waiting for Vitals to start — this page will switch over by itself.</div>' +
      '<div class="small faint" style="margin-top:10px">Installing on a different computer? ' + others.map((k) => '<button class="linklike" data-install-os="' + k + '">' + INSTALL[k].name + "</button>").join(" · ") + "</div>" +
      "</div>";
    startInstallWatch();
    return html;
  }

  function downloadRow(os) {
    const info = DOWNLOADS[os] || DOWNLOADS.windows;
    const buttons = info.files.map(([label, file], i) =>
      '<a class="btn sm' + (i === 0 ? " primary" : "") + '" href="' + RELEASE + file + '" download>' + esc(label) + "</a>").join("");
    return '<div class="download-row"><div class="small muted">Prefer a regular download? Same Vitals, nothing else to install:</div>' +
      '<div class="download-buttons">' + buttons + '<a class="btn sm ghost" href="' + RELEASE_PAGE + '" target="_blank" rel="noopener">Other systems</a></div>' +
      '<p class="small faint" style="margin:6px 0 0">' + info.note + "</p></div>";
  }

  function phoneAppCard() {
    if (S.platform === "android") {
      return '<div class="card" style="margin-top:16px"><h2>Get the Android app</h2>' +
        '<p class="small muted">The same Vitals as an app on your home screen; it works offline.</p>' +
        '<a class="btn primary" href="' + ANDROID_APK + '" download>Download Vitals for Android</a>' +
        '<p class="small faint" style="margin:8px 0 0">Open the downloaded file and allow installing from your browser when Android asks.</p></div>';
    }
    return '<div class="card" style="margin-top:16px"><h2>Put Vitals on your home screen</h2><ol class="steps">' +
      "<li>Open this page in <b>Safari</b>.</li><li>Tap <b>Share</b>, then <b>Add to Home Screen</b>.</li>" +
      "<li>Open Vitals from its icon: it runs full screen and updates itself.</li></ol>" +
      '<p class="small faint">Advanced: an unsigned iPhone app for sideloading is on the <a href="' + RELEASE_PAGE + '" target="_blank" rel="noopener">download page</a>.</p></div>';
  }

  function pairCard(onPhone) {
    const saved = LS.get("agentBase", "") || (S.base || "");
    return '<div class="card"><h2>' + (onPhone ? "Type the code instead" : "Connect with a code") + '</h2><p class="lede">Camera not working? On your computer open Vitals → <b>Devices</b> → <b>Connect my phone</b> and type the 6-digit code shown under the QR.</p>' +
      '<form class="stack" data-pair-form style="max-width:420px">' +
      (S.mode === "needs-pair" && S.base === "" ? "" : '<label class="small muted">Computer address<input name="base" value="' + esc(saved || "http://192.168.1.x:8765") + '" style="width:100%;padding:9px 11px;border-radius:10px;border:1px solid var(--line-strong);background:var(--panel-solid);margin-top:4px"></label>') +
      '<label class="small muted">Code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--line-strong);background:var(--panel-solid);margin-top:4px;font:600 22px var(--mono);letter-spacing:.3em"></label>' +
      '<button class="btn primary" type="submit">Connect</button></form></div>';
  }

  function installOs() {
    if (S.installOs) return S.installOs;
    return S.platform === "windows" ? "windows" : S.platform === "linux" ? "linux" : "mac";
  }

  function viewDevices() {
    if (S.mode === "agent") return viewDevicesAgent();
    const phone = S.platform === "iphone" || S.platform === "android";
    let html = topbar(phone ? "Your computer, on your phone" : "Get the full Vitals", phone ? "Nothing to install on the phone" : "Free · no account · about 30 seconds · removes cleanly");
    if (phone) {
      html += '<div class="grid g-2" style="align-items:start"><div class="card"><h2>One scan, no typing</h2><ol class="steps">' +
        "<li>On your computer, install Vitals (open this page there and follow the one step).</li>" +
        "<li>In Vitals on the computer, go to <b>Devices → Connect my phone</b>.</li>" +
        "<li>Point this phone's <b>camera</b> at the code on screen and tap the link. Done — you'll see your computer's health here.</li></ol>" +
        '<p class="small muted">Both devices need to be on the same Wi-Fi. This phone\'s own tips are in <b>Guides</b>.</p></div>' + pairCard(true) + "</div>";
      if (!IN_APP) html += phoneAppCard();
      return html;
    }
    const os = installOs();
    html += installCard(false);
    html += '<div class="grid g-3" style="margin-top:16px">' +
      '<div class="card"><h2>What it does</h2><p class="small muted">Puts Vitals in your user folder (no admin password), adds a Vitals app icon, and starts it quietly when you log in so this page is always live.</p></div>' +
      '<div class="card"><h2>Safe by design</h2><p class="small muted">Runs only on this computer, never uploads anything, and every cleanup can be undone for 72 hours. The code is open source.</p></div>' +
      '<div class="card"><h2>Remove anytime</h2><p class="small muted">Run the same line with <code>' + (os === "windows" ? "$env:VITALS_UNINSTALL=1;" : "sh -s -- --uninstall") + '</code> ' + (os === "windows" ? "in front of irm" : "at the end") + '. Details on <a href="https://github.com/juw12/projects/tree/main/apps/vitals" target="_blank" rel="noopener">GitHub</a>.</p></div></div>';
    html += '<details class="card" style="margin-top:16px"><summary style="cursor:pointer;font-weight:650">Already installed, or a developer?</summary>' +
      '<p class="small muted" style="margin-top:10px">Open the <b>Vitals</b> app (Spotlight / Start menu), or run it from a checkout:</p><div class="code-block">python apps/vitals/server/server.py --open</div>' +
      '<p class="small muted">Then this page switches to live automatically. Using Safari? Vitals also opens in its own tab at <a href="http://127.0.0.1:8765/">127.0.0.1:8765</a>.</p>' +
      '<button class="btn sm" data-action="retry">Check again</button></details>';
    return html;
  }

  function startInstallWatch() {
    if (S.installWatch) return;
    S.installWatch = setInterval(async () => {
      if (S.mode !== "browser" || !["devices", "home"].includes(S.view)) {
        clearInterval(S.installWatch);
        S.installWatch = null;
        return;
      }
      const health = await tryAgent("http://127.0.0.1:8765");
      if (health) {
        clearInterval(S.installWatch);
        S.installWatch = null;
        const status = $("#installStatus");
        if (status) status.innerHTML = "✅ Vitals found — connecting…";
        await connect();
        if (S.mode === "agent") {
          toast("Vitals is installed and connected 🎉");
          botSay("You're all set! I can now see this computer for real. Want me to run a first check?", [
            { label: "Check my device", action: "say", text: "how is my device", primary: true },
            { label: "Scan storage", action: "scan" },
          ]);
          go("home");
        }
      }
    }, 2000);
  }

  function viewDevicesAgent() {
    const p = S.pairing || { lan: false, devices: [] };
    let html = topbar("Devices", "See this computer from your phone — one scan, no typing");
    html += '<div class="grid g-2" style="align-items:start"><div class="card"><h2>Connect my phone</h2>';
    if (!p.lan) {
      html += '<p class="lede">Lets a phone on the same Wi-Fi see this computer\'s health and run safe fixes. You can turn it off anytime.</p>' +
        '<button class="btn primary" data-action="lan-on">Connect my phone</button>';
    } else {
      const url = (p.pair_urls || [])[0];
      if (url && window.VitalsQR) {
        let svg = "";
        try {
          svg = VitalsQR.toSvg(VitalsQR.encode(url), { label: "Scan to connect your phone", border: 3 });
        } catch (e) {
          svg = "";
        }
        html += '<div class="qr-wrap"><div class="qr">' + svg + '</div><div><p style="margin:0 0 6px"><b>Point your phone\'s camera here</b> and tap the link that appears.</p>' +
          '<p class="small muted" style="margin:0 0 10px">Same Wi-Fi needed. Each code works once and refreshes after a phone connects.</p>' +
          '<div class="small muted">Or type this code on the phone:</div><div class="pair-code">' + esc(p.code || "") + "</div>" +
          '<div class="small faint mono" style="word-break:break-all;margin-top:6px">' + esc((p.urls || [])[0] || "") + "</div></div></div>";
      } else {
        html += '<p class="muted">Phone access is on, but this computer has no Wi-Fi/LAN address right now.</p>';
      }
      html += '<button class="btn sm ghost" style="margin-top:12px" data-action="lan-off">Stop phone access</button>';
    }
    html += '</div><div class="card"><h2>Connected devices</h2>' +
      (p.devices || []).map((d) => '<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>' + esc(d.device) + '</span><span class="right small muted">' + ago(d.created) + "</span></div>").join("") +
      '<p class="small muted" style="margin-top:12px">Vitals starts by itself when you log in, so this page is always live at <a href="http://127.0.0.1:8765/">127.0.0.1:8765</a>.</p>' +
      '<p class="small muted">Want Vitals as an app on the phone too? <a href="' + ANDROID_APK + '">Android app</a> · iPhone: open <b>' + esc(IPHONE_WEB.replace("https://", "")) + "</b> in Safari → Share → Add to Home Screen.</p></div></div>";
    startPairingWatch();
    return html;
  }

  function startPairingWatch() {
    if (S.pairWatch) return;
    S.pairWatch = setInterval(async () => {
      if (S.mode !== "agent" || S.view !== "devices") {
        clearInterval(S.pairWatch);
        S.pairWatch = null;
        return;
      }
      try {
        const before = S.pairing ? S.pairing.devices.length : 0;
        const next = await api("pairing");
        const changed = JSON.stringify(next) !== JSON.stringify(S.pairing);
        S.pairing = next;
        if (next.devices.length > before) toast("📱 Phone connected!");
        if (changed) softRender();
      } catch (e) { /* agent restarting */ }
    }, 3000);
  }

  async function setLan(enable) {
    if (S.mode === "demo") return toast("Demo: this would show a QR code for your phone.");
    try {
      S.pairing = await api("lan", { body: { enable } });
      render();
    } catch (e) {
      toast(e.message);
    }
  }

  function viewGuides() {
    let html = topbar("Guides", "The built-in steps that actually work — per device");
    html += '<div class="tabs" role="tablist">' + Object.keys(B.PLAYBOOKS).map((k) => '<button role="tab" data-guide="' + k + '" aria-selected="' + (S.guide === k) + '">' + esc(B.PLAYBOOKS[k].name) + "</button>").join("") + "</div>";
    const pb = B.PLAYBOOKS[S.guide];
    html += '<div class="notice" style="margin-bottom:16px">' + esc(pb.intro) + "</div>";
    html += '<div class="grid g-2" style="align-items:start">' + pb.sections.map((s, i) => '<div class="card"><h2>' + esc(s.title) + " " + progressBadge(S.guide, i) + "</h2>" + checklist(S.guide, i) + "</div>").join("") + "</div>";
    return html;
  }

  function progressBadge(pk, si) {
    const items = B.PLAYBOOKS[pk].sections[si].items;
    const done = items.filter((_, i) => S.guideDone[pk + ":" + si + ":" + i]).length;
    return '<span class="badge ' + (done === items.length ? "safe" : "") + '">' + done + "/" + items.length + "</span>";
  }

  function checklist(pk, si, limit) {
    const pb = B.PLAYBOOKS[pk];
    if (!pb || !pb.sections[si]) return "";
    const items = pb.sections[si].items.slice(0, limit || 99);
    return '<ul class="check-list">' + items.map((it, i) => {
      const key = pk + ":" + si + ":" + i;
      const done = !!S.guideDone[key];
      return '<li class="' + (done ? "done" : "") + '"><input type="checkbox" data-guide-item="' + key + '"' + (done ? " checked" : "") + ' aria-label="Mark done"><div><div class="t"><b>' + esc(it.t) + '</b> <span class="gain">' + esc(it.gain) + '</span></div><div class="path">' + esc(it.path) + '</div><div class="small muted">' + esc(it.why) + "</div></div></li>";
    }).join("") + "</ul>";
  }

  function agentNeeded(why) {
    return '<div class="card empty">' + icon("devices") + "<div><b>" + esc(why) + "</b><br>Install the free Vitals app in one step, or explore with demo data.</div><br>" +
      '<div class="row" style="justify-content:center"><button class="btn primary" data-go="devices">Install — 1 step</button><button class="btn" data-action="demo">Try demo data</button></div></div>';
  }

  // ----------------------------------------------------------- benchmark
  function benchSummary() {
    const last = S.bench[S.bench.length - 1];
    if (S.benchRunning) return '<p class="small"><span class="typing"><i></i><i></i><i></i></span> Running round ' + S.benchRunning + " of 6…</p>";
    if (!last) return '<p class="small muted">Not run yet on this device.</p>';
    const drop = Math.round(100 * (1 - last.rounds[last.rounds.length - 1] / Math.max(...last.rounds)));
    const prev = S.bench.length > 1 ? S.bench[S.bench.length - 2] : null;
    const vsPrev = prev ? Math.round(100 * (last.score / prev.score - 1)) : null;
    const max = Math.max(...last.rounds);
    return '<div class="row" style="align-items:flex-end;gap:4px;height:48px;margin:8px 0">' + last.rounds.map((r) => '<i style="flex:1;border-radius:4px;background:' + (r / max < 0.85 ? "var(--warn)" : "var(--accent)") + ";height:" + Math.max(8, (100 * r) / max) + '%"></i>').join("") + "</div>" +
      '<p class="small">Score <b>' + last.score + "</b> · sustained drop <b>" + drop + "%</b> — " + (drop > 20 ? "<span style=\"color:var(--warn)\">throttling: the device slowed down under load.</span>" : "steady, no throttling.") + (vsPrev != null ? " · " + (vsPrev >= 0 ? "+" : "") + vsPrev + "% vs your last run" : "") + ' <span class="faint">(' + ago(last.t / 1000) + ")</span></p>";
  }

  function runBenchmark() {
    if (S.benchRunning) return;
    const src = "onmessage=function(){var r=[];for(var k=0;k<6;k++){var t=performance.now(),n=0,x=0;while(performance.now()-t<1200){for(var i=0;i<20000;i++){x+=Math.sqrt(i*n+1)%7;}n++;}r.push(n);postMessage({round:k+1,n:n});}postMessage({done:r,x:x});};";
    let worker;
    try {
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    } catch (e) {
      toast("This browser blocked the benchmark worker.");
      return;
    }
    S.benchRunning = 1;
    softRender();
    worker.onmessage = (ev) => {
      if (ev.data.done) {
        const rounds = ev.data.done;
        const score = Math.round(rounds.reduce((a, b) => a + b, 0) / rounds.length);
        S.bench.push({ t: Date.now(), rounds, score });
        S.bench = S.bench.slice(-20);
        LS.set("bench", S.bench);
        S.benchRunning = 0;
        worker.terminate();
        softRender();
        const drop = Math.round(100 * (1 - rounds[rounds.length - 1] / Math.max(...rounds)));
        botSay("Throttle check done: score **" + score + "**, sustained drop **" + drop + "%**. " + (drop > 20 ? "That's thermal throttling — the device slows itself to cool down. Check for a busy background app, a hot room or blocked vents." : "Performance stayed steady under load. 👍"));
      } else {
        S.benchRunning = ev.data.round + 1 > 6 ? 6 : ev.data.round + 1;
        softRender();
      }
    };
  }

  // ------------------------------------------------------------------ chat
  function renderChat() {
    const chat = $("#chat");
    if (!chat) return;
    if (!chat.dataset.built) {
      chat.dataset.built = "1";
      chat.innerHTML = '<div class="chat-head"><span style="width:22px;height:22px;color:var(--accent)">' + icon("chat") + '</span><div><h2>Ask Vitals</h2><div class="sub">Say what\'s wrong — it checks, explains and fixes</div></div><button class="btn ghost icon-btn right" data-chat-close aria-label="Close chat">' + icon("close") + "</button></div>" +
        '<div class="chat-log" id="chatlog" aria-live="polite"></div><div class="chat-suggest" id="chatsuggest"></div>' +
        '<form class="chat-form" id="chatform"><label class="sr-only" for="chatinput">Message</label><textarea id="chatinput" rows="1" placeholder="Ask anything — e.g. free 10 GB"></textarea><button class="btn primary icon-btn" type="submit" aria-label="Send">' + icon("send") + "</button></form>";
      if (!S.chat.length) {
        S.chat.push({ role: "bot", text: "Hi! I'm **Vitals**. Tell me what's bothering you — *\"my laptop is slow\"*, *\"free 10 GB\"*, *\"battery dies overnight\"* — and I'll check, explain, and offer a fix you can undo.", chips: [] });
      }
    }
    const log = $("#chatlog");
    log.innerHTML = S.chat.map(msgHtml).join("");
    log.scrollTop = log.scrollHeight;
    const sugg = S.mode === "browser" && (S.platform === "iphone" || S.platform === "android")
      ? ["My phone storage is full", "Battery drains fast", "Is a RAM booster worth it?", "Protect my battery"]
      : ["Just fix it", "Why is it slow?", "Free 5 GB", "Battery health", "Undo last clean", "How do I install?"];
    $("#chatsuggest").innerHTML = sugg.map((s) => '<button class="chip" data-say="' + esc(s) + '">' + esc(s) + "</button>").join("");
  }

  function md(text) {
    const lines = esc(text).split("\n");
    let html = "";
    let inList = false;
    lines.forEach((line) => {
      const li = line.match(/^\s*-\s+(.*)/);
      if (li) {
        if (!inList) { html += "<ul>"; inList = true; }
        html += "<li>" + inline(li[1]) + "</li>";
      } else {
        if (inList) { html += "</ul>"; inList = false; }
        if (line.trim()) html += "<p>" + inline(line) + "</p>";
      }
    });
    if (inList) html += "</ul>";
    return html;
  }
  function inline(s) {
    return s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/`(.+?)`/g, "<code>$1</code>");
  }

  function msgHtml(m, idx) {
    if (m.typing) return '<div class="msg bot"><span class="typing"><i></i><i></i><i></i></span></div>';
    let html = '<div class="msg ' + m.role + '">' + (m.role === "user" ? "<p>" + esc(m.text) + "</p>" : md(m.text));
    if (m.plan) {
      html += '<div class="plan">' + m.plan.steps.map((s) => '<div class="plan-row"><span>' + esc(s.name) + ' <span class="badge ' + s.safety + '">' + s.safety + '</span></span><span class="mono">' + fmt(s.bytes) + "</span></div>").join("") +
        '<div class="plan-row plan-total"><span>Total' + (m.plan.reached ? "" : " (all available)") + '</span><span class="mono">' + fmt(m.plan.total) + "</span></div></div>";
    }
    if (m.chips && m.chips.length) html += '<div class="chips">' + m.chips.map((c, ci) => '<button class="chip' + (c.primary ? " primary" : "") + '" data-chip="' + idx + ":" + ci + '">' + esc(c.label) + "</button>").join("") + "</div>";
    if (m.src) html += '<div class="src">' + esc(m.src) + "</div>";
    return html + "</div>";
  }

  function botSay(text, chips) {
    S.chat.push({ role: "bot", text, chips: chips || [] });
    saveChat();
    renderChat();
  }

  function saveChat() {
    // Plans hold target ids from one scan only; don't persist them across reloads.
    LS.set("chat", S.chat.slice(-40).filter((m) => !m.typing).map((m) => Object.assign({}, m, {
      plan: null,
      text: m.plan ? m.text + "\n\n*(This plan was for an earlier scan — ask again for a fresh one.)*" : m.text,
      chips: (m.chips || []).filter((c) => !["clean-plan", "quit", "restore"].includes(c.action)),
    })));
  }

  function chatContext() {
    return {
      mode: S.mode, platform: S.platform, vitals: S.mode === "browser" ? { battery: S.browser.battery ? { present: true, percent: S.browser.battery.percent, charging: S.browser.battery.charging } : null } : S.vitals,
      scan: S.scan, processes: S.processes, anomalies: S.baseline ? S.baseline.anomalies : [], drain: S.drain, forecast: S.forecast,
      vault: S.vault, startup: S.startup,
    };
  }

  async function answer(text, silentUser) {
    if (!text || !text.trim()) return;
    if (!silentUser) S.chat.push({ role: "user", text: text.trim() });
    openChat();
    if ((S.mode === "agent" || S.mode === "demo") && !S.processes.length) {
      try { S.processes = (await api("processes?limit=40")).processes; } catch (e) { /* ignore */ }
    }
    const r = B.respond(text, chatContext());
    if (r.fallback && S.mode === "agent") {
      S.chat.push({ typing: true });
      renderChat();
      try {
        const ai = await api("ask", { body: { message: text } });
        S.chat.pop();
        if (ai && ai.answer) {
          S.chat.push({ role: "bot", text: ai.answer, chips: r.chips, src: "Answered by " + ai.model + " running locally on this computer" });
          saveChat();
          renderChat();
          return;
        }
      } catch (e) {
        S.chat.pop();
      }
    }
    S.chat.push({ role: "bot", text: r.text, chips: r.chips, plan: r.plan });
    saveChat();
    renderChat();
  }

  function openChat() {
    $("#shell").classList.add("chat-open");
  }
  function closeChatOnMobile() {
    if (window.matchMedia("(max-width: 1320px)").matches) $("#shell").classList.remove("chat-open");
  }

  // --------------------------------------------------------------- dialogs
  function confirmDialog(title, body, okLabel, danger) {
    return new Promise((resolve) => {
      let dlg = $("#confirm");
      if (!dlg) {
        dlg = document.createElement("dialog");
        dlg.id = "confirm";
        document.body.appendChild(dlg);
      }
      dlg.innerHTML = "<h3>" + esc(title) + '</h3><p class="muted">' + esc(body) + '</p><div class="actions"><button class="btn" value="no">Cancel</button><button class="btn ' + (danger ? "danger" : "primary") + '" value="yes">' + esc(okLabel) + "</button></div>";
      dlg.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { dlg.close(); resolve(b.value === "yes"); }));
      dlg.addEventListener("cancel", () => resolve(false), { once: true });
      dlg.showModal();
    });
  }

  function toast(text, action) {
    let wrap = $(".toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "toast-wrap";
      document.body.appendChild(wrap);
    }
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = "<span>" + esc(text) + "</span>" + (action ? "<button>" + esc(action.label) + "</button>" : "");
    if (action) t.querySelector("button").addEventListener("click", () => { action.run(); t.remove(); });
    wrap.appendChild(t);
    setTimeout(() => t.remove(), action ? 9000 : 4500);
  }

  // ---------------------------------------------------------------- events
  function dataset(el) {
    const d = Object.assign({}, el.dataset);
    if (d.pid) d.pid = parseInt(d.pid, 10);
    return d;
  }

  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-open-chat],[data-go],[data-action],[data-chip],[data-say],[data-toggle-cat],[data-cmode],[data-guide],[data-theme-toggle],[data-chat-close],[data-plan],[data-install-os],[data-copy-install],#chatfab");
    if (!el) return;
    if (el.id === "chatfab") return openChat();
    if (el.hasAttribute("data-open-chat")) {
      openChat();
      const input = $("#chatinput");
      if (input) input.focus();
      return;
    }
    if (el.dataset.installOs) {
      S.installOs = el.dataset.installOs;
      return renderMain();
    }
    if (el.hasAttribute("data-copy-install")) return copyInstall(el);
    if (el.hasAttribute("data-chat-close")) return $("#shell").classList.remove("chat-open");
    if (el.hasAttribute("data-theme-toggle")) return toggleTheme();
    if (el.dataset.go) return go(el.dataset.go === "more" ? "more" : el.dataset.go);
    if (el.dataset.say) return answer(el.dataset.say);
    if (el.dataset.chip) {
      const [mi, ci] = el.dataset.chip.split(":").map(Number);
      const chip = S.chat[mi] && S.chat[mi].chips[ci];
      if (chip) runAction(chip);
      return;
    }
    if (el.dataset.toggleCat) {
      if (ev.target.matches("input")) return;
      const id = el.dataset.toggleCat;
      if (S.openCats.has(id)) S.openCats.delete(id);
      else S.openCats.add(id);
      return renderMain();
    }
    if (el.dataset.cmode) {
      S.cleanMode = el.dataset.cmode;
      return renderMain();
    }
    if (el.dataset.guide) {
      S.guide = el.dataset.guide;
      return renderMain();
    }
    if (el.hasAttribute("data-plan")) return planFromForm();
    if (el.dataset.action === "retry") return connect();
    if (el.dataset.action) return runAction(dataset(el));
  });

  document.addEventListener("change", (ev) => {
    const el = ev.target;
    if (el.dataset.item) {
      if (el.checked) S.selected.add(el.dataset.item);
      else S.selected.delete(el.dataset.item);
      return renderMain();
    }
    if (el.dataset.catCheck) {
      const cat = S.scan.categories.find((c) => c.id === el.dataset.catCheck);
      cat.items.forEach((i) => (el.checked ? S.selected.add(i.id) : S.selected.delete(i.id)));
      return renderMain();
    }
    if (el.dataset.guideItem) {
      S.guideDone[el.dataset.guideItem] = el.checked;
      LS.set("guideDone", S.guideDone);
      return renderMain();
    }
  });

  document.addEventListener("submit", async (ev) => {
    if (ev.target.hasAttribute("data-ask-form")) {
      ev.preventDefault();
      const q = new FormData(ev.target).get("q");
      ev.target.reset();
      return answer(String(q || ""));
    }
    if (ev.target.id === "chatform") {
      ev.preventDefault();
      const input = $("#chatinput");
      const text = input.value;
      input.value = "";
      return answer(text);
    }
    if (ev.target.hasAttribute("data-pair-form")) {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const base = f.get("base") == null ? S.base : String(f.get("base")).trim().replace(/\/+$/, "");
      try {
        await pairWith(base, String(f.get("code") || ""));
        toast("Paired! You're now seeing " + (S.hostname || "your computer") + ".");
      } catch (e) {
        toast(e.message);
      }
    }
  });

  document.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
      ev.preventDefault();
      openChat();
      $("#chatinput").focus();
    }
    if (ev.target.id === "chatinput" && ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      $("#chatform").requestSubmit();
    }
  });

  async function copyInstall(button) {
    const text = INSTALL[installOs()].cmd;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      const range = document.createRange();
      const node = $("#installCmd");
      if (node) {
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        ok = document.execCommand && document.execCommand("copy");
      }
    }
    if (ok) {
      S.installStep = Math.max(S.installStep, 1);
      renderMain();
    } else {
      button.textContent = "Select the line below and copy it";
    }
  }

  function planFromForm() {
    const n = parseFloat($("#goalN").value || "0");
    const unit = $("#goalU").value;
    const ex = $("#goalEx").value;
    LS.set("goal", n);
    const goal = n * (unit === "GB" ? B.GB : B.MB);
    const plan = B.planGoal(S.scan, goal, { exclude: B.parseExclusions(ex ? "without " + ex : "") });
    S.lastPlan = plan;
    const out = $("#planOut");
    if (!plan.steps.length) {
      out.innerHTML = '<p class="small muted" style="margin-top:10px">Nothing left to clean with those settings.</p>';
      return;
    }
    out.innerHTML = '<div class="plan" style="margin-top:12px">' + plan.steps.map((s) => '<div class="plan-row"><span>' + esc(s.name) + ' <span class="badge ' + s.safety + '">' + s.safety + '</span></span><span class="mono">' + fmt(s.bytes) + "</span></div>").join("") +
      '<div class="plan-row plan-total"><span>' + (plan.reached ? "Reaches your goal" : "Everything available — short of the goal") + '</span><span class="mono">' + fmt(plan.total) + "</span></div></div>" +
      '<button class="btn primary" style="margin-top:10px" id="runPlan">Clean this plan</button>';
    $("#runPlan").addEventListener("click", () => runAction({ action: "clean-plan", plan }));
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    LS.set("theme", next);
    renderNavOnly();
    renderMain();
  }

  // ------------------------------------------------------------------ demo
  const Demo = {
    state: null,
    init() {
      const now = Date.now() / 1000;
      const mkItems = (base, n, total) => Array.from({ length: n }, (_, i) => ({ id: "d-" + base + i, path: "/Users/you/" + base + "/item-" + (i + 1), bytes: Math.round((total / n) * (0.6 + ((i * 37) % 10) / 12)), files: 10 + i, mtime: now - i * 86400 }));
      const cats = [
        ["app-caches", "App caches", "System junk", "safe", 3.4, 14, "Temporary data apps keep to load faster. Every app recreates it on demand.", "Apps may open a little slower the first time."],
        ["logs", "Logs & crash reports", "System junk", "safe", 0.6, 6, "Diagnostic text files written by apps and the OS.", "Nothing visible changes."],
        ["xcode-derived", "Xcode build data", "Developer", "safe", 7.8, 9, "Intermediate build products. Xcode rebuilds them on the next build.", "The next build takes longer once."],
        ["package-caches", "Package manager caches", "Developer", "safe", 4.1, 4, "Downloaded copies of npm, pip and Homebrew packages.", "The next install downloads again."],
        ["stale-node-modules", "node_modules in idle projects", "Developer", "review", 5.2, 7, "Dependency folders of projects untouched for 60+ days.", "Run npm install to get them back."],
        ["iphone-backups", "iPhone / iPad backups", "Backups", "review", 18.6, 2, "Local device backups made by Finder.", "That backup is gone — make sure the device is backed up elsewhere."],
        ["old-installers", "Installers & archives in Downloads", "Downloads", "review", 2.9, 11, "Disk images and installers you already used.", "Re-download if you need them."],
        ["trash", "Trash", "System junk", "review", 1.3, 22, "Files you deleted but that still use space.", "They move into the Undo Vault first."],
      ];
      const categories = cats.map(([id, name, group, safety, gb, n, why, after]) => ({ id, name, group, safety, why, after, rebuilds: true, complete: true, bytes: 0, count: n, items: mkItems(id, n, gb * B.GB) }));
      categories.forEach((c) => { c.bytes = c.items.reduce((s, i) => s + i.bytes, 0); });
      const dupes = [
        { hash: "a", bytes_each: 1.4 * B.GB, keep: "/Users/you/Movies/trip-2024.mov", copies: ["/Users/you/Downloads/trip-2024 (1).mov"], copy_ids: ["d-dup0"], wasted: 1.4 * B.GB },
        { hash: "b", bytes_each: 320 * B.MB, keep: "/Users/you/Documents/thesis-final.pdf", copies: ["/Users/you/Desktop/thesis-final copy.pdf", "/Users/you/Downloads/thesis-final.pdf"], copy_ids: ["d-dup1", "d-dup2"], wasted: 640 * B.MB },
      ];
      this.state = {
        cpu: 38, mem: 81,
        vitals: {
          device: { hostname: "demo-macbook", os: "Darwin", os_version: "15.1", model: "MacBookPro18,1", cpus: 10 },
          cpu: { percent: 38, load: [3.1, 2.8, 2.4], cores: 10 },
          memory: { total: 16 * B.GB, used: 13 * B.GB, percent: 81, swap_used: 2.1 * B.GB, swap_total: 3 * B.GB, pressure: "elevated" },
          disk: { total: 494 * B.GB, used: 461 * B.GB, free: 33 * B.GB, percent: 93.3 },
          battery: { present: true, percent: 64, plugged: false, charging: false, minutes_left: 312, cycles: 486, design_capacity: 6075, full_capacity: 5225, health_percent: 86.0, condition: "good", source: "pmset + ioreg (mAh)" },
          uptime: 19 * 86400 + 3600 * 5, idle_seconds: 4, vault_bytes: 0,
        },
        procs: [
          ["Google Chrome Helper (Renderer)", 46.2, 2.3], ["Docker Desktop", 12.4, 3.1], ["Slack", 4.1, 0.9], ["Xcode", 2.2, 1.6], ["Spotify", 1.8, 0.4],
          ["WindowServer", 6.5, 0.6], ["Dropbox", 9.8, 0.5], ["Finder", 0.4, 0.2], ["Zoom", 0.8, 0.7], ["Notion", 1.1, 0.8],
        ].map(([name, cpu, gb], i) => ({ pid: 400 + i * 17, name, cpu, rss: gb * B.GB, cpu_seconds: 1000 - i * 50, user: name === "WindowServer" ? "_windowserver" : "you", owned: name !== "WindowServer", protected: name === "WindowServer" || name === "Finder" })),
        scan: {
          id: "demo", finished: now - 30, seconds: 23.4, categories, duplicates: dupes, duplicate_waste: dupes.reduce((s, g) => s + g.wasted, 0),
          large_files: [
            { id: "d-l0", path: "/Users/you/Movies/trip-2024.mov", bytes: 1.4 * B.GB, mtime: now - 90 * 86400 },
            { id: "d-l1", path: "/Users/you/Downloads/ubuntu-24.04-desktop.iso", bytes: 5.7 * B.GB, mtime: now - 200 * 86400 },
            { id: "d-l2", path: "/Users/you/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw", bytes: 24 * B.GB, mtime: now - 3600 },
          ],
          growth: [
            { path: "/Users/you/Library/Containers/com.docker.docker", bytes: 24.3 * B.GB, delta: 6.1 * B.GB, since: now - 6 * 86400 },
            { path: "/Users/you/Library/Developer", bytes: 31 * B.GB, delta: 3.4 * B.GB, since: now - 6 * 86400 },
            { path: "/Users/you/Downloads", bytes: 14 * B.GB, delta: 1.9 * B.GB, since: now - 6 * 86400 },
            { path: "/Users/you/Library/Caches", bytes: 6.2 * B.GB, delta: 0.8 * B.GB, since: now - 6 * 86400 },
            { path: "/Users/you/Documents", bytes: 22 * B.GB, delta: -0.4 * B.GB, since: now - 6 * 86400 },
          ],
        },
        vault: [],
        receipts: [],
        history: Array.from({ length: 240 }, (_, i) => {
          const t = now - (240 - i) * 360;
          const hr = new Date(t * 1000).getHours();
          const work = hr >= 9 && hr <= 18 ? 1 : 0.35;
          return { ts: t, cpu: Math.max(3, Math.min(95, 22 * work + 14 * Math.sin(i / 7) * work + ((i * 13) % 9))), mem: 62 + 14 * work + ((i * 7) % 5), battery: null };
        }),
      };
      const scanState = this.state.scan;
      scanState.reclaimable = scanState.categories.reduce((s, c) => s + c.bytes, 0);
      scanState.safe_reclaimable = scanState.categories.filter((c) => c.safety === "safe").reduce((s, c) => s + c.bytes, 0);
      S.vaultHours = 72;
    },
    async api(path, o) {
      const st = this.state;
      await new Promise((r) => setTimeout(r, 120));
      const p = path.split("?")[0];
      const jitter = (v, a, lo, hi) => Math.max(lo, Math.min(hi, v + (Math.random() - 0.5) * a));
      if (p === "vitals") {
        st.cpu = jitter(st.cpu, 10, 18, 72);
        st.mem = jitter(st.mem, 2, 76, 86);
        st.vitals.cpu.percent = Math.round(st.cpu * 10) / 10;
        st.vitals.memory.percent = Math.round(st.mem * 10) / 10;
        st.vitals.vault_bytes = st.vault.reduce((s, b) => s + b.bytes, 0);
        return JSON.parse(JSON.stringify(st.vitals));
      }
      if (p === "processes") {
        st.procs.forEach((x) => { x.cpu = Math.round(jitter(x.cpu, x.cpu * 0.3, 0.1, 90) * 10) / 10; });
        return { processes: st.procs.slice().sort((a, b) => b.cpu - a.cpu) };
      }
      if (p === "history") return { series: st.history };
      if (p === "baseline") {
        const hourly = Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 18 ? 28 + (h % 4) * 3 : 9 + (h % 3)));
        const hour = new Date().getHours();
        return { hour, samples: 2210, metrics: { cpu: { hourly, current: st.vitals.cpu.percent, learning: false, mean: hourly[hour], std: 6.2, z: Math.round(((st.vitals.cpu.percent - hourly[hour]) / 6.2) * 100) / 100 }, mem: { hourly: hourly.map((x) => x + 50), current: st.mem, learning: false } },
          anomalies: [{ metric: "cpu", z: 3.1, current: 46, normal: 21, message: "Dropbox is syncing at an unusual hour: CPU 46% — your normal now is about 21%." }] };
      }
      if (p === "drain") return { hours: 24, battery_samples: 420, percent_per_hour: 11.8, processes: [
        { name: "Google Chrome Helper (Renderer)", cpu_seconds: 5120, share: 34.1, battery_seconds: 2300, battery_share: 38.2, idle_seconds: 12 },
        { name: "Docker Desktop", cpu_seconds: 2950, share: 19.6, battery_seconds: 1400, battery_share: 23.3, idle_seconds: 1900 },
        { name: "Dropbox", cpu_seconds: 1500, share: 10.0, battery_seconds: 700, battery_share: 11.6, idle_seconds: 640 },
        { name: "Slack", cpu_seconds: 900, share: 6.0, battery_seconds: 400, battery_share: 6.6, idle_seconds: 90 },
        { name: "WindowServer", cpu_seconds: 880, share: 5.9, battery_seconds: 380, battery_share: 6.3, idle_seconds: 0 },
      ], idle_drainers: [{ name: "Docker Desktop", idle_seconds: 1900 }, { name: "Dropbox", idle_seconds: 640 }] };
      if (p === "battery/forecast") return { health: 86, cycles: 486, method: "trend", message: "At your measured wear rate (0.42% per month) you reach 80% around " + new Date(Date.now() + 430 * 86400e3).toISOString().slice(0, 10) + "." };
      if (p === "startup") return { items: [
        { name: "com.docker.helper", kind: "background agent", scope: "you" }, { name: "Dropbox", kind: "login item", scope: "you" },
        { name: "Spotify", kind: "login item", scope: "you" }, { name: "com.google.keystone.agent", kind: "background agent", scope: "you" },
        { name: "com.adobe.ccxprocess", kind: "background agent", scope: "all users" },
      ] };
      if (p === "pairing") return { lan: false, code: null, urls: [], devices: [{ device: "this computer", created: Date.now() / 1000 - 3600 }] };
      if (p === "vault") return { batches: st.vault, retention_hours: 72 };
      if (p === "receipts") return { receipts: st.receipts };
      if (p === "scan" && o.body) { st.scanStarted = Date.now(); return { id: "demo" }; }
      if (p === "scan") {
        if (st.scanStarted) {
          const prog = Math.min(100, Math.round((Date.now() - st.scanStarted) / 40));
          if (prog < 100) return { status: "running", progress: prog, step: ["Checking App caches", "Checking Xcode build data", "Looking for duplicates", "Measuring folder growth"][Math.floor(prog / 26)] };
          st.scanStarted = null;
          return { status: "done", progress: 100, result: JSON.parse(JSON.stringify(st.scan)) };
        }
        return { status: "done", progress: 100, result: JSON.parse(JSON.stringify(st.scan)) };
      }
      if (p === "clean") {
        const want = new Set(o.body.targets || []);
        (o.body.categories || []).forEach((cid) => { const c = st.scan.categories.find((x) => x.id === cid); if (c) c.items.forEach((i) => want.add(i.id)); });
        const items = [];
        st.scan.categories.forEach((c) => { c.items = c.items.filter((i) => { if (want.has(i.id)) { items.push({ original: i.path, bytes: i.bytes }); return false; } return true; }); c.bytes = c.items.reduce((s, i) => s + i.bytes, 0); });
        st.scan.duplicates.forEach((g) => g.copy_ids.forEach((id, k) => { if (want.has(id)) items.push({ original: g.copies[k], bytes: g.bytes_each }); }));
        st.scan.large_files.forEach((f) => { if (want.has(f.id)) items.push({ original: f.path, bytes: f.bytes }); });
        const bytes = items.reduce((s, i) => s + i.bytes, 0);
        const id = "demo-" + Date.now();
        const free = o.body.mode === "free";
        if (free) { st.vitals.disk.free += bytes; st.vitals.disk.used -= bytes; st.vitals.disk.percent = Math.round((1000 * st.vitals.disk.used) / st.vitals.disk.total) / 10; }
        const receipt = { id: "r" + Date.now(), time: Date.now() / 1000, kind: "clean", label: o.body.label, items: items.length, bytes, skipped: 0, disk_free_before: 1, disk_free_after: free ? 1 + bytes : 1, measured_freed: free ? bytes : 0, note: free ? "Deleted immediately (no undo)." : "Held in the Undo Vault for 72 h." };
        st.receipts.unshift(receipt);
        if (!free) st.vault.unshift({ id, label: o.body.label, mode: "vault", created: Date.now() / 1000, expires: Date.now() / 1000 + 72 * 3600, items, count: items.length, bytes, status: "held" });
        return { id, items, skipped: [], bytes, receipt };
      }
      if (p === "vault/restore") {
        const b = st.vault.find((x) => x.id === o.body.batch);
        st.vault = st.vault.filter((x) => x.id !== o.body.batch);
        st.receipts.unshift({ id: "r" + Date.now(), time: Date.now() / 1000, kind: "restore", label: b.label, items: b.count, bytes: b.bytes, note: "Restored " + b.count + " item(s) to where they were." });
        return { restored: b.count, renamed: [] };
      }
      if (p === "vault/purge") {
        const b = st.vault.find((x) => x.id === o.body.batch);
        st.vault = st.vault.filter((x) => x.id !== o.body.batch);
        st.vitals.disk.free += b.bytes;
        st.vitals.disk.used -= b.bytes;
        st.vitals.disk.percent = Math.round((1000 * st.vitals.disk.used) / st.vitals.disk.total) / 10;
        const r = { id: "r" + Date.now(), time: Date.now() / 1000, kind: "purge", label: b.label, items: b.count, bytes: b.bytes, measured_freed: b.bytes, note: "Vault batch deleted for good; the space is now free." };
        st.receipts.unshift(r);
        return r;
      }
      if (p === "process/quit") {
        const pr = st.procs.find((x) => x.pid === o.body.pid);
        st.procs = st.procs.filter((x) => x.pid !== o.body.pid);
        return { ok: true, message: "Demo: asked " + (pr ? pr.name : "it") + " to quit." };
      }
      if (p === "ask") return { answer: null };
      if (p === "settings") {
        if (o.body) {
          st.settings = Object.assign(st.settings || {}, o.body);
        }
        const s = st.settings || {};
        return { auto_care: !!s.auto_care, notify: true, last_auto_care: null, next_auto_care: s.auto_care ? Date.now() / 1000 + 3600 : null };
      }
      throw new Error("Not available in demo");
    },
  };

  // ------------------------------------------------------------------ boot
  function boot() {
    document.documentElement.dataset.theme = LS.get("theme", window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const params = new URLSearchParams(location.hash.slice(1));
    S.view = params.get("view") || (S.simple ? "home" : "overview");
    const mq = window.matchMedia("(max-width: 820px)");
    const applyLayout = () => document.body.classList.toggle("m", document.body.dataset.layout === "mobile" || mq.matches);
    mq.addEventListener ? mq.addEventListener("change", applyLayout) : mq.addListener(applyLayout);
    applyLayout();
    render();
    connect().then(() => {
      if (params.get("say")) answer(params.get("say"));
      if (params.get("scan") && (S.mode === "agent" || S.mode === "demo")) startScan();
      if (params.has("fix") && (S.mode === "agent" || S.mode === "demo")) fixAll();
    });
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  window.VitalsApp = { state: S, answer, go, startScan };
  boot();
})();
