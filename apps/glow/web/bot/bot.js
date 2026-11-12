// GlowBot: the page for Glow's Telegram bot. The bot itself runs on a small Cloudflare Worker (apps/glow/bot).
// This page only shows what that server reports about itself: whether a bot is connected, the result of its own
// self-test, and which free services it can reach. For the owner, who arrives with a private setup link, it also
// hands the Telegram token to the server once. Nothing about the bot is kept in this browser: no token, no setup
// code and no results.
(function () {
  "use strict";

  const root = document.documentElement;
  const CHAT_STORE_KEY = "mufakat.v1";
  const HOME_THEME_KEY = "glow.home.theme";
  const API = "https://glow-bot.juw12.workers.dev";
  const STATUS_URL = `${API}/v1/status`;
  const SELFTEST_URL = `${API}/v1/selftest`;
  const PROBE_URL = `${API}/v1/probe`;
  const SETUP_URL = `${API}/setup`;
  const OFFLINE_FILES = ["./", "./bot.css", "./bot.js"];
  const TOKEN_SHAPE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;
  const USERNAME_SHAPE = /^[A-Za-z0-9_]{3,64}$/;
  const LINK_SHAPE = /^https:\/\/t\.me\/[A-Za-z0-9_]{3,64}(\?start=[A-Za-z0-9_-]{1,64})?$/;
  const SETUP_HASH = /^#k=([A-Za-z0-9_-]{16,128})$/;
  const READ_TIMEOUT_MS = 20000;
  const SETUP_TIMEOUT_MS = 60000;
  const PROBE_POLL_MS = 8000;
  const PROBE_POLL_LIMIT = 12;
  const SHOWN_CHARS = 220;
  const ROW_LIMIT = 40;

  // What the server answers to a refused setup, and the sentence shown for it.
  const SETUP_ERRORS = {
    empty: ["bot.setup.err.empty", "Paste the token first."],
    format: ["bot.setup.err.format", "That does not look like a bot token. It is a number, a colon, then a long run of letters and digits."],
    code: ["bot.setup.err.code", "This setup link is no longer valid. Ask for a new one."],
    rejected: ["bot.setup.err.rejected", "Telegram did not accept this token. Copy it again from @BotFather."],
    webhook: ["bot.setup.err.webhook", "Telegram took the token but would not connect it to the server. Try again in a minute."],
    origin: ["bot.setup.err.origin", "Setup is only allowed from the Glow website."],
    network: ["bot.setup.err.network", "Could not reach the bot server. Check your connection and try again."],
    other: ["bot.setup.err.other", "Setup did not finish: {detail}"],
  };
  const SERVER_ERRORS = {
    "setup-code": "code",
    "token-format": "format",
    "token-rejected": "rejected",
    "webhook-failed": "webhook",
    origin: "origin",
  };
  // The six rounds of the server's self-test, in plain words.
  const CHECK_TITLES = {
    mission: ["bot.test.check.mission", "A whole mission: plan, wait for Run, delegate, check, report"],
    room: ["bot.test.check.room", "A GlowRoom job, posted under the agent's own name"],
    chat: ["bot.test.check.chat", "Chat remembers the question before"],
    agent: ["bot.test.check.agent", "The agent asks before it saves"],
    stop: ["bot.test.check.stop", "/stop ends a running mission at once"],
    languages: ["bot.test.check.languages", "/help answers in all four languages"],
  };

  const $ = (id) => document.getElementById(id);
  const tr = (key, fallback) => {
    if (!window.GlowLocale) return fallback;
    const value = window.GlowLocale.t(key);
    return value && value !== key ? value : fallback;
  };
  const fill = (template, values) => template.replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));

  // ---- the owner's setup code ----
  // The owner opens this page with a link that ends in #k=<code>. The part of an address after # is never sent to
  // a web server, so GitHub does not see it. It is kept in this variable only and taken out of the address bar at
  // once. It leaves this page in one place: the body of the setup request to the bot server.
  let setupCode = "";
  const hashMatch = SETUP_HASH.exec(location.hash || "");
  if (hashMatch) {
    setupCode = hashMatch[1];
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (error) {
      location.hash = "";
    }
  }

  // ---- theme: same choice as Glow home ----
  function chatTheme() {
    try {
      return ((JSON.parse(localStorage.getItem(CHAT_STORE_KEY) || "null") || {}).settings || {}).theme;
    } catch (error) {
      return "";
    }
  }
  function preferredTheme() {
    let choice = "";
    try {
      choice = localStorage.getItem(HOME_THEME_KEY) || "";
    } catch (error) {
      choice = "";
    }
    choice = choice || chatTheme() || "system";
    if (choice === "light" || choice === "dark") return choice;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function applyTheme(theme) {
    root.dataset.theme = theme;
    const themeHint = theme === "dark" ? tr("bot.theme.toLight", "Switch to light") : tr("bot.theme.toDark", "Switch to dark");
    $("theme-btn").textContent = theme === "dark" ? "☀" : "☾";
    $("theme-btn").title = themeHint;
    $("theme-btn").setAttribute("aria-label", themeHint);
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#262624" : "#faf9f5";
  }
  applyTheme(preferredTheme());
  $("theme-btn").addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(HOME_THEME_KEY, next);
    } catch (error) {
      // Storage blocked: the choice lasts for this visit only.
    }
    applyTheme(next);
  });

  // ---- helpers ----
  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  // Everything the server sends is shown as plain text, and cut short.
  function clip(value, limit = SHOWN_CHARS) {
    const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  }
  function listOf(value) {
    return Array.isArray(value) ? value.filter((row) => row && typeof row === "object").slice(0, ROW_LIMIT) : [];
  }
  function ago(at) {
    const time = Number(at);
    if (!Number.isFinite(time) || time <= 0) return "";
    const seconds = Math.round((time - Date.now()) / 1000);
    const units = [
      ["day", 86400],
      ["hour", 3600],
      ["minute", 60],
      ["second", 1],
    ];
    try {
      const format = new Intl.RelativeTimeFormat(root.lang || "en", { numeric: "auto" });
      for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size || unit === "second") return format.format(Math.round(seconds / size), unit);
      }
    } catch (error) {
      // An old browser without Intl.RelativeTimeFormat: show the plain date instead.
    }
    return new Date(time).toLocaleString();
  }
  // "All 6 checks passed · 5 minutes ago", or without the tail when the server gave no time.
  function withWhen(template, values) {
    return fill(template, values).replace(/\s*·\s*$/, "");
  }
  function mark(ok) {
    const node = make("span", "mark", ok ? "✓" : "✕");
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", ok ? tr("bot.mark.ok", "Passed") : tr("bot.mark.bad", "Failed"));
    return node;
  }
  async function getJson(url, timeoutMs = READ_TIMEOUT_MS) {
    const stopper = new AbortController();
    const timer = setTimeout(() => stopper.abort(), timeoutMs);
    try {
      const response = await fetch(url, { cache: "no-store", signal: stopper.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  const state = {
    status: { phase: "loading", data: null },
    setup: { phase: setupCode ? "form" : "hidden", error: "", errorText: "", detail: "", result: null },
    selftest: { phase: "loading", result: null },
    probe: { phase: "loading", result: null, polls: 0 },
  };

  // ---- is a bot connected? ----
  function renderStatus() {
    const { phase, data } = state.status;
    root.dataset.botStatus = phase;
    const version = data && data.version ? clip(data.version, 24) : "";
    const name = data && data.bot && data.bot.username ? String(data.bot.username) : "";

    let dot = "dot";
    let metaText = tr("bot.meta.loading", "Checking the bot server…");
    let cardText = tr("bot.status.loading", "Checking the bot server…");
    if (phase === "ready") {
      dot = "dot ready";
      metaText = fill(tr("bot.meta.ready", "Live on Telegram as @{name} · version {version}"), { name, version });
      cardText = tr("bot.status.ready", "The bot is live. Open it, press Start, then type a goal.");
    } else if (phase === "unclaimed") {
      metaText = fill(tr("bot.meta.unclaimed", "Connected as @{name}, waiting for its owner · version {version}"), { name, version });
      cardText = tr("bot.status.unclaimed", "The bot is connected, but nobody owns it yet. The owner link from the setup step claims it. Run the setup again to get a fresh link.");
    } else if (phase === "unconfigured") {
      metaText = fill(tr("bot.meta.unconfigured", "Server is up (version {version}) · no Telegram bot connected yet"), { version });
      cardText = tr("bot.status.unconfigured", "The server is running, but no Telegram bot is connected to it yet. Its owner connects one with a private setup link.");
    } else if (phase === "offline") {
      dot = "dot failed";
      metaText = tr("bot.meta.offline", "Cannot reach the bot server right now");
      cardText = tr("bot.status.offline", "Cannot reach the bot server. Check your connection, then try again.");
    }
    const light = make("span", dot);
    light.setAttribute("aria-hidden", "true");
    const meta = $("bot-meta");
    meta.textContent = "";
    meta.append(light, document.createTextNode(metaText));
    $("status-text").textContent = cardText;

    const open = $("open-telegram");
    open.hidden = phase !== "ready";
    if (phase === "ready") {
      open.href = `https://t.me/${name}`;
      open.textContent = fill(tr("bot.status.open", "Open @{name} in Telegram"), { name });
    } else {
      open.removeAttribute("href");
      open.textContent = "";
    }
    $("status-retry").hidden = phase !== "offline";
    let access = "";
    if (phase === "ready") {
      access =
        data.access === "public"
          ? tr("bot.status.public", "Public: anyone can use it, with a daily limit per chat.")
          : tr("bot.status.private", "Private: only its owner, and the groups the owner adds it to, can use it.");
    }
    $("status-access").textContent = access;
  }
  let statusRun = 0;
  async function loadStatus() {
    const run = ++statusRun;
    state.status = { phase: "loading", data: null };
    renderStatus();
    let next = { phase: "offline", data: null };
    try {
      const data = await getJson(STATUS_URL);
      const name = data && data.bot && typeof data.bot.username === "string" ? data.bot.username : "";
      if (data && data.configured === true && USERNAME_SHAPE.test(name)) {
        next = { phase: data.claimed === true ? "ready" : "unclaimed", data };
      } else if (data && data.ok === true) {
        next = { phase: "unconfigured", data };
      }
    } catch (error) {
      next = { phase: "offline", data: null };
    }
    if (run !== statusRun) return;
    state.status = next;
    renderStatus();
  }

  // ---- the owner connects a bot ----
  function renderSetup() {
    const setup = state.setup;
    root.dataset.botSetup = setup.phase;
    $("setup-card").hidden = setup.phase === "hidden";
    if (setup.phase === "hidden") return;
    const sending = setup.phase === "sending";
    const done = setup.phase === "done";
    $("setup-entry").hidden = done;
    $("setup-done").hidden = !done;

    const button = $("setup-connect");
    button.disabled = sending;
    button.textContent = sending ? tr("bot.setup.sending", "Connecting…") : tr("bot.setup.connect", "Connect");
    $("setup-token").disabled = sending;
    const line = $("setup-result");
    const failed = setup.phase === "error" && SETUP_ERRORS[setup.error];
    line.className = failed ? "check-result fail" : "check-result";
    line.textContent = failed ? fill(tr(failed[0], failed[1]), { detail: setup.errorText }) : "";
    const detail = $("setup-detail");
    detail.hidden = !(failed && setup.detail);
    detail.textContent = failed ? setup.detail : "";
    if (!done) return;

    const result = setup.result;
    $("setup-done-text").textContent = fill(tr("bot.setup.done", "Connected as @{name}."), { name: result.name });
    const link = $("setup-link");
    link.href = result.link;
    link.textContent = result.claimed
      ? fill(tr("bot.status.open", "Open @{name} in Telegram"), { name: result.name })
      : tr("bot.setup.claim", "Open Telegram and press Start to become the owner");
    $("setup-done-note").textContent = result.claimed
      ? tr("bot.setup.claimed", "This bot already has its owner, and its chats were kept.")
      : tr("bot.setup.claimNote", "This link works once, and only in a private chat with the bot. Until someone uses it, the bot answers nobody.");
    $("setup-warnings").hidden = !result.warnings.length;
    const list = $("setup-warning-list");
    list.textContent = "";
    for (const warning of result.warnings) list.appendChild(make("li", "", warning));
  }
  function failSetup(error, errorText, detail) {
    state.setup = { phase: "error", error, errorText: errorText || "", detail: detail || "", result: null };
    renderSetup();
  }
  async function connect() {
    if (!setupCode || state.setup.phase === "sending" || state.setup.phase === "done") return;
    const input = $("setup-token");
    const token = input.value.trim();
    if (!token) {
      failSetup("empty");
      return;
    }
    if (!TOKEN_SHAPE.test(token)) {
      failSetup("format");
      return;
    }
    state.setup = { phase: "sending", error: "", errorText: "", detail: "", result: null };
    renderSetup();

    let answer = null;
    let httpStatus = 0;
    const stopper = new AbortController();
    const timer = setTimeout(() => stopper.abort(), SETUP_TIMEOUT_MS);
    try {
      const response = await fetch(SETUP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: setupCode, token }),
        cache: "no-store",
        signal: stopper.signal,
      });
      httpStatus = response.status;
      answer = await response.json().catch(() => null);
    } catch (error) {
      failSetup("network");
      return;
    } finally {
      clearTimeout(timer);
    }

    const name = answer && answer.bot && typeof answer.bot.username === "string" ? answer.bot.username : "";
    if (answer && answer.ok === true && USERNAME_SHAPE.test(name)) {
      const plainLink = `https://t.me/${name}`;
      input.value = "";
      setupCode = ""; // not needed again on this visit
      state.setup = {
        phase: "done",
        error: "",
        errorText: "",
        detail: "",
        result: {
          name,
          claimed: answer.claimed === true,
          link: typeof answer.link === "string" && LINK_SHAPE.test(answer.link) ? answer.link : plainLink,
          warnings: (Array.isArray(answer.warnings) ? answer.warnings : []).slice(0, 8).map((warning) => clip(warning)),
        },
      };
      renderSetup();
      loadStatus();
      return;
    }
    const reason = answer && typeof answer.error === "string" ? answer.error : "";
    const known = SERVER_ERRORS[reason];
    const detail = answer && typeof answer.detail === "string" ? clip(answer.detail) : "";
    if (known) failSetup(known, "", detail);
    else failSetup("other", clip(reason || `HTTP ${httpStatus}`), detail);
  }
  $("setup-connect").addEventListener("click", () => {
    connect();
  });
  $("setup-token").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    connect();
  });
  $("setup-token").addEventListener("input", () => {
    if (state.setup.phase !== "error") return;
    state.setup = { phase: "form", error: "", errorText: "", detail: "", result: null };
    renderSetup();
  });

  // ---- the server's own self-test ----
  function renderSelftest() {
    const { phase, result } = state.selftest;
    root.dataset.botSelftest = phase;
    $("test-again").disabled = phase === "loading";
    const line = $("test-result");
    line.className = phase === "pass" ? "check-result pass" : phase === "fail" ? "check-result fail" : "check-result";
    const list = $("test-list");
    list.textContent = "";
    if (phase === "loading") {
      line.textContent = tr("bot.test.loading", "Reading the result…");
      return;
    }
    if (phase === "offline") {
      line.textContent = tr("bot.test.offline", "Could not read the result.");
      return;
    }
    if (phase === "none") {
      line.textContent = tr("bot.test.none", "No result yet. Try again in a minute.");
      return;
    }
    const checks = listOf(result.checks);
    const failed = checks.filter((check) => check.ok !== true).length;
    const when = ago(result.at);
    if (result.error || !checks.length) {
      line.textContent = withWhen(tr("bot.test.broken", "The self-test could not run · {when}"), { when });
    } else if (phase === "pass") {
      line.textContent = withWhen(tr("bot.test.pass", "All {count} checks passed · {when}"), { count: checks.length, when });
    } else {
      line.textContent = withWhen(tr("bot.test.fail", "{failed} of {count} checks failed · {when}"), { failed, count: checks.length, when });
    }
    if (result.error) {
      const row = make("li", "fail");
      row.appendChild(mark(false));
      row.appendChild(make("b", "", clip(result.error)));
      list.appendChild(row);
    }
    for (const check of checks) {
      const passed = check.ok === true;
      const title = CHECK_TITLES[check.name];
      const row = make("li", passed ? "pass" : "fail");
      row.appendChild(mark(passed));
      row.appendChild(make("b", "", title ? tr(title[0], title[1]) : clip(check.name, 60)));
      if (check.detail) row.appendChild(make("small", "", clip(check.detail)));
      list.appendChild(row);
    }
  }
  let selftestRun = 0;
  async function loadSelftest() {
    const run = ++selftestRun;
    state.selftest = { phase: "loading", result: null };
    renderSelftest();
    let next = { phase: "offline", result: null };
    try {
      const data = await getJson(SELFTEST_URL);
      const result = data && data.result && typeof data.result === "object" ? data.result : null;
      if (!result) {
        next = { phase: "none", result: null };
      } else {
        const checks = listOf(result.checks);
        const allPassed = result.ok === true && !result.error && checks.length > 0 && checks.every((check) => check.ok === true);
        next = { phase: allPassed ? "pass" : "fail", result };
      }
    } catch (error) {
      next = { phase: "offline", result: null };
    }
    if (run !== selftestRun) return;
    state.selftest = next;
    renderSelftest();
  }

  // ---- what the server can reach ----
  function statTile(value, label, live) {
    const tile = make("div", live ? "stat live" : "stat");
    tile.appendChild(make("b", "", value));
    tile.appendChild(make("span", "", label));
    return tile;
  }
  function probeRow(ok, what, took, note) {
    const row = make("li", ok ? "ok" : "bad");
    row.appendChild(mark(ok));
    row.appendChild(make("span", "what", clip(what)));
    const time = Number(took);
    row.appendChild(make("span", "took", took != null && Number.isFinite(time) ? `${Math.round(time)} ms` : ""));
    if (note) row.appendChild(make("small", "", clip(note)));
    return row;
  }
  function probeGroup(title, rows) {
    const group = make("div", "probe-group");
    group.appendChild(make("h3", "", title));
    const list = make("ul", "probe-list");
    for (const row of rows) list.appendChild(row);
    group.appendChild(list);
    return group;
  }
  function modelRow(row) {
    const ok = row.ok === true;
    const what = row.model ? `${row.id} · ${row.model}` : String(row.id || "");
    return probeRow(ok, what, row.ms, ok ? "" : row.error || (row.status ? `HTTP ${row.status}` : ""));
  }
  function webRow(row) {
    const what = String(row.id || "").replace(/^(search|read):/, "");
    return probeRow(row.ok === true, what, row.ms, row.detail || "");
  }
  function pageRow(row) {
    const ok = row.ok === true;
    let what = String(row.url || "");
    try {
      const address = new URL(what);
      what = address.host + (address.pathname === "/" ? "" : address.pathname);
    } catch (error) {
      // Not a full address: show it as sent.
    }
    const size = Number(row.chars);
    const read = [Number.isFinite(size) && size > 0 ? `${size.toLocaleString("en")} characters` : "", row.via ? `via ${row.via}` : ""];
    return probeRow(ok, what, row.ms, ok ? read.filter(Boolean).join(" · ") : row.error || "");
  }
  function renderProbe() {
    const { phase, result } = state.probe;
    root.dataset.botProbe = phase;
    $("probe-again").disabled = phase === "loading";
    const line = $("probe-result");
    if (phase === "loading") line.textContent = tr("bot.probe.loading", "Reading the results…");
    else if (phase === "running") line.textContent = tr("bot.probe.running", "The server is testing its routes now. This takes a minute or two…");
    else if (phase === "offline") line.textContent = tr("bot.probe.offline", "Could not read the results.");
    else if (phase === "none") line.textContent = tr("bot.probe.none", "No results yet.");
    else line.textContent = withWhen(tr("bot.probe.checked", "Tested {when}"), { when: ago(result.at) });

    const stats = $("probe-stats");
    const rows = $("probe-rows");
    stats.textContent = "";
    rows.textContent = "";
    $("probe-details").hidden = !result;
    if (!result) return;

    const keyless = listOf(result.providers);
    const backup = listOf(result.ai);
    const web = listOf(result.web);
    const searches = web.filter((row) => String(row.id || "").startsWith("search:"));
    const readers = web.filter((row) => String(row.id || "").startsWith("read:"));
    const pages = listOf(result.pages);
    const news = result.news && typeof result.news === "object" ? result.news : null;
    const spark = result.spark && typeof result.spark === "object" ? result.spark : null;
    const stories = news ? Number(news.stories) : NaN;

    const tiles = [
      [keyless.concat(backup), tr("bot.probe.stat.models", "free AI models answering")],
      [searches, tr("bot.probe.stat.search", "web search routes working")],
      [pages, tr("bot.probe.stat.pages", "test pages read")],
    ];
    for (const [tested, label] of tiles) {
      if (!tested.length) continue;
      const good = tested.filter((row) => row.ok === true).length;
      stats.appendChild(statTile(`${good}/${tested.length}`, label, good > 0));
    }
    if (news && news.ok === true && Number.isFinite(stories)) {
      stats.appendChild(statTile(String(stories), tr("bot.probe.stat.news", "GlowNews stories today"), stories > 0));
    }

    const extras = [];
    if (news) extras.push(probeRow(news.ok === true, "GlowNews", null, news.ok === true && Number.isFinite(stories) ? `${stories} stories` : news.error || ""));
    if (spark) extras.push(probeRow(spark.ok === true, "GlowSpark", spark.loadMs, spark.ok === true ? spark.sample || "" : spark.error || ""));
    const groups = [
      [tr("bot.probe.group.keyless", "Free AI models, no key"), keyless.map(modelRow)],
      [tr("bot.probe.group.ai", "Cloudflare Workers AI, the backup"), backup.map(modelRow)],
      [tr("bot.probe.group.search", "Web search"), searches.map(webRow)],
      [tr("bot.probe.group.read", "Page readers"), readers.map(webRow)],
      [tr("bot.probe.group.pages", "Real pages it tried to read"), pages.map(pageRow)],
      [tr("bot.probe.group.extras", "GlowNews and GlowSpark"), extras],
    ];
    for (const [title, list] of groups) {
      if (list.length) rows.appendChild(probeGroup(title, list));
    }
    if (result.error) rows.appendChild(make("p", "fine", clip(result.error)));
  }
  let probeRun = 0;
  let probeTimer = 0;
  async function loadProbe(fromPoll) {
    const run = ++probeRun;
    clearTimeout(probeTimer);
    if (!fromPoll) {
      state.probe = { phase: "loading", result: state.probe.result, polls: 0 };
      renderProbe();
    }
    let data = null;
    let reached = true;
    try {
      data = await getJson(PROBE_URL);
    } catch (error) {
      reached = false;
    }
    if (run !== probeRun) return;
    const polls = state.probe.polls;
    if (!reached) {
      state.probe = { phase: "offline", result: state.probe.result, polls };
      renderProbe();
      return;
    }
    const result = data && data.result && typeof data.result === "object" ? data.result : null;
    if (data && data.running === true && polls < PROBE_POLL_LIMIT) {
      // The server is testing right now: show what it had before and look again shortly.
      state.probe = { phase: "running", result, polls: polls + 1 };
      probeTimer = setTimeout(() => {
        loadProbe(true);
      }, PROBE_POLL_MS);
    } else {
      state.probe = { phase: result ? "ready" : "none", result, polls };
    }
    renderProbe();
  }

  $("status-retry").addEventListener("click", () => {
    loadStatus();
    loadSelftest();
    loadProbe(false);
  });
  $("test-again").addEventListener("click", () => {
    loadSelftest();
  });
  $("probe-again").addEventListener("click", () => {
    loadProbe(false);
  });

  // ---- start ----
  function renderLocalised() {
    applyTheme(root.dataset.theme);
    renderStatus();
    renderSetup();
    renderSelftest();
    renderProbe();
  }
  if (window.GlowLocale) {
    window.GlowLocale.apply();
    window.GlowLocale.onChange(() => {
      window.GlowLocale.apply();
      renderLocalised();
    });
  }
  renderLocalised();
  loadStatus();
  loadSelftest();
  loadProbe(false);
  // Offline: Glow home's service worker caches what it sees. On a first visit straight to this page it
  // takes control only after everything has loaded, so fetch the files once more for it to keep.
  if (navigator.serviceWorker && !navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        OFFLINE_FILES.forEach((file) => {
          fetch(file).catch(() => {});
        });
      },
      { once: true }
    );
  }
  // The floating GlowLead bubble sits on top of the page. It steps aside (see .crown-aside in bot.css) while it
  // covers a fifth of any control or a control covers a fifth of it, so nothing has to be pressed through it.
  const PRESSABLE = "button, a[href], input, select, textarea, summary, [role='button']";
  const COVER_LIMIT = 0.2;
  const SHOWN = { checkVisibilityCSS: true, visibilityProperty: true };
  function crownCovers() {
    const bubble = document.querySelector(".glow-widget-bubble");
    if (!bubble) return false;
    const crown = bubble.getBoundingClientRect();
    const crownArea = crown.width * crown.height;
    if (!crownArea) return false;
    const shared = (box) => {
      const wide = Math.min(box.right, crown.right) - Math.max(box.left, crown.left);
      const high = Math.min(box.bottom, crown.bottom) - Math.max(box.top, crown.top);
      return wide > 0 && high > 0 ? wide * high : 0;
    };
    const seen = (element) => typeof element.checkVisibility !== "function" || element.checkVisibility(SHOWN);
    for (const control of document.querySelectorAll(PRESSABLE)) {
      if (control === bubble || control.closest(".glow-widget-panel")) continue;
      if (!seen(control)) continue;
      const box = control.getBoundingClientRect();
      const area = box.width * box.height;
      if (!area) continue;
      if (shared(box) / Math.min(area, crownArea) >= COVER_LIMIT) return true;
    }
    return false;
  }
  let crownCheckQueued = false;
  function keepCrownClear() {
    if (crownCheckQueued) return;
    crownCheckQueued = true;
    requestAnimationFrame(() => {
      crownCheckQueued = false;
      root.classList.toggle("crown-aside", crownCovers());
    });
  }
  window.addEventListener("scroll", keepCrownClear, { passive: true });
  window.addEventListener("resize", keepCrownClear);
  // The class goes on <html>, which this observer does not watch, so it cannot trigger itself.
  new MutationObserver(keepCrownClear).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  keepCrownClear();
})();
