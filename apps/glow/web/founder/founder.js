// GlowFounder: test a business idea on a panel of simulated buyers before launch. The studio (3D market square,
// buyers, pricing and unit economics) is its own page in ./studio/ and runs fully in this browser, with the
// numbers worked out by Python (Pyodide). This page hosts it, follows what it reports (project loaded, panel
// started, panel finished), turns each result into one next step, and keeps the last few results in this browser.
(function () {
  "use strict";

  const root = document.documentElement;
  const CHAT_STORE_KEY = "mufakat.v1";
  const HOME_THEME_KEY = "glow.home.theme";
  const HISTORY_KEY = "glow.founder.results.v1";
  const HISTORY_LIMIT = 6;
  const OFFLINE_FILES = ["./", "./founder.css", "./founder.js"];
  const SECTIONS = ["productSection", "buyersSection", "pitchSection"];
  const IDEA_CHARS = 200;
  const NAME_CHARS = 32;
  const PITCH_CHARS = 700;
  const PROMPT_CHARS = 2000;
  const onPhone = window.matchMedia("(max-width: 720px)").matches;

  // Why a simulated buyer passes, as the studio reports it, and the word shown for it.
  const REASONS = {
    price: ["founder.reason.price", "price"],
    habit: ["founder.reason.habit", "habit"],
    need: ["founder.reason.need", "need"],
    trust: ["founder.reason.trust", "trust"],
    quality: ["founder.reason.quality", "quality"],
    convenience: ["founder.reason.convenience", "convenience"],
    timing: ["founder.reason.timing", "timing"],
    values: ["founder.reason.values", "values"],
  };
  // One concrete next move for each of those reasons.
  const NEXT_STEPS = {
    price: ["founder.next.price", "Try a lower price or say what the price buys, then run again."],
    habit: ["founder.next.habit", "Make switching easy (a first visit, a trial), then run again."],
    need: ["founder.next.need", "Name the problem it solves in the first line of the pitch, then run again."],
    trust: ["founder.next.trust", "Add proof (reviews, a guarantee, who is behind it), then run again."],
    quality: ["founder.next.quality", "Say what makes it better than what they use now, then run again."],
    convenience: ["founder.next.convenience", "Say where and how fast they get it, then run again."],
    timing: ["founder.next.timing", "Give a reason to try it now, then run again."],
    values: ["founder.next.values", "Speak to what they care about (sourcing, impact), then run again."],
  };

  const $ = (id) => document.getElementById(id);
  const tr = (key, fallback) => {
    if (!window.GlowLocale) return fallback;
    const value = window.GlowLocale.t(key);
    return value && value !== key ? value : fallback;
  };
  const fill = (template, values) => template.replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));

  // ---- theme: same choice as Glow home; the studio follows this page (see studio/js/embed.js) ----
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
    const themeHint = theme === "dark" ? tr("founder.theme.toLight", "Switch to light") : tr("founder.theme.toDark", "Switch to dark");
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
  // Everything the studio sends is shown as plain text, and cut short.
  function clip(value, limit) {
    const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  }
  function shortName(name) {
    return clip(String(name || "").split(/[(\-\u2013\u2014,]/)[0], NAME_CHARS);
  }
  const share = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
  function reasonWord(code) {
    const known = Object.prototype.hasOwnProperty.call(REASONS, code) ? REASONS[code] : null;
    return known ? tr(known[0], known[1]) : clip(code, NAME_CHARS);
  }
  function dayOf(at) {
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return "";
    const lang = window.GlowLocale ? window.GlowLocale.get().lang : undefined;
    try {
      return new Intl.DateTimeFormat(lang, { month: "short", day: "numeric" }).format(date);
    } catch (error) {
      return date.toISOString().slice(5, 10);
    }
  }

  // ---- what the studio has told this page ----
  const frame = $("founder-frame");
  let business = "";
  let running = false;
  let latest = null;
  // An idea typed on Glow home arrives as ?q= and becomes a project once the studio is ready.
  let pendingIdea = clip(new URLSearchParams(location.search).get("q"), IDEA_CHARS);
  root.dataset.founderStudio = "loading";
  root.dataset.founderRun = "idle";

  // A result is kept only in the shape this page shows: numbers as numbers, words cut short.
  function tidyResult(data) {
    if (!data || typeof data !== "object") return null;
    const buys = Number(data.buys);
    const n = Number(data.n);
    const rate = Number(data.rate);
    const target = Number(data.target);
    if (![buys, n, rate, target].every(Number.isFinite) || n <= 0) return null;
    return {
      at: typeof data.at === "string" ? data.at.slice(0, 30) : new Date().toISOString(),
      project: clip(data.project, 60),
      business: clip(data.business || data.project, 120),
      heading: clip(data.heading, 60),
      buys,
      n,
      rate,
      target,
      topReason: clip(data.topReason, NAME_CHARS),
    };
  }

  // ---- the last few panels, kept in this browser ----
  function loadPanels() {
    try {
      const rows = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(rows) ? rows.map(tidyResult).filter(Boolean).slice(0, HISTORY_LIMIT) : [];
    } catch (error) {
      return [];
    }
  }
  let panels = loadPanels();
  function savePanels() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(panels));
    } catch (error) {
      // Storage blocked or full: the list lasts for this visit only.
    }
  }

  function toStudio(type, detail) {
    if (!frame.contentWindow) return;
    frame.contentWindow.postMessage({ type, ...detail }, location.origin);
  }
  // Opens one of the studio's three setup steps, so the example can be swapped for your own idea.
  function editIdea(section) {
    toStudio("founder-studio:edit", { section: SECTIONS.includes(section) ? section : SECTIONS[0] });
    frame.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    const data = event.data;
    const type = data && typeof data === "object" ? data.type : "";
    if (type === "founder-studio:project") {
      business = clip(data.business || data.project, 120);
      root.dataset.founderStudio = "ready";
      $("founder-loading").hidden = true;
      if (pendingIdea) {
        toStudio("founder-studio:new", { business: pendingIdea });
        pendingIdea = "";
        try {
          history.replaceState(null, "", location.pathname);
        } catch (error) {
          // The address keeps its ?q=; a reload opens the same project again, which is harmless.
        }
      }
    } else if (type === "founder-studio:run-start") {
      running = true;
      root.dataset.founderRun = "running";
    } else if (type === "founder-studio:run-stopped") {
      running = false;
      root.dataset.founderRun = latest ? "done" : "idle";
    } else if (type === "founder-studio:result") {
      const result = tidyResult({ ...data, at: new Date().toISOString() });
      if (!result) return;
      latest = { ...result, pitch: clip(data.pitch, PITCH_CHARS), price: clip(data.price, 40) };
      running = false;
      panels = [result, ...panels].slice(0, HISTORY_LIMIT);
      savePanels();
      root.dataset.founderRun = "done";
    } else {
      return;
    }
    paint();
  });

  // ---- three steps that follow the studio: idea loaded, panel run, next move ----
  function stepItem(number, status, title, detail) {
    const item = make("li", `founder-step ${status}`);
    if (status === "current") item.setAttribute("aria-current", "step");
    item.append(make("span", "founder-step-mark", status === "done" ? "✓" : String(number)));
    const text = make("span", "founder-step-text");
    text.append(make("b", "", title));
    const line = make("span");
    line.append(...[].concat(detail));
    text.append(line);
    item.append(text);
    return item;
  }
  function linkButton(label, onClick) {
    const button = make("button", "founder-link", label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }
  function steps() {
    const list = make("ol", "founder-steps");
    list.setAttribute("aria-label", tr("founder.steps.label", "GlowFounder steps"));
    const idea = business
      ? [`${shortName(business)} · `, linkButton(tr("founder.step1.own", "write your own"), () => editIdea("productSection"))]
      : [tr("founder.step1.loading", "Loading the example idea")];
    let runStatus = business ? "current" : "todo";
    let runDetail = tr("founder.step2.todo", "Simulated buyers walk to the stall and decide");
    if (running) {
      runStatus = "current";
      runDetail = tr("founder.step2.running", "Buyers are deciding now");
    } else if (latest) {
      runStatus = "done";
      runDetail = fill(tr("founder.result.figure", "{buys} of {n} would buy"), latest);
    }
    let nextStatus = "todo";
    let nextDetail = tr("founder.step3.todo", "Get one concrete move from the result");
    if (latest && !running) {
      nextStatus = "current";
      nextDetail = latest.rate >= latest.target
        ? tr("founder.step3.met", "It meets your target: plan a real launch test")
        : tr("founder.step3.missed", "Sharpen the pitch and run again");
    }
    list.append(
      stepItem(1, business ? "done" : "current", tr("founder.step1.title", "Describe the idea"), idea),
      stepItem(2, runStatus, tr("founder.step2.title", "Run the panel"), runDetail),
      stepItem(3, nextStatus, tr("founder.step3.title", "Take the next step"), nextDetail)
    );
    return list;
  }

  function nextStep(result) {
    if (result.rate >= result.target) {
      return tr("founder.next.met", "It meets your target. Next: a real launch test (pre-orders or a landing page), since simulated buyers are only a first filter.");
    }
    const known = Object.prototype.hasOwnProperty.call(NEXT_STEPS, result.topReason) ? NEXT_STEPS[result.topReason] : null;
    return known ? tr(known[0], known[1]) : tr("founder.next.other", "Read why buyers passed in the studio, then sharpen the pitch and run again.");
  }

  // ---- hand the result to the rest of Glow: GlowChat rewrites the pitch, GlowLead plans the real test ----
  function promptValues(result) {
    return {
      business: result.business,
      buys: result.buys,
      n: result.n,
      rate: share(result.rate),
      target: share(result.target),
      reason: result.topReason ? reasonWord(result.topReason) : "-",
      price: result.price || "-",
      pitch: result.pitch || "-",
    };
  }
  function chatLink(result) {
    const prompt = fill(
      tr("founder.ask.chatPrompt", "I tested a business idea on a panel of simulated buyers. Business: {business}. Price: {price}. Result: {buys} of {n} would buy ({rate}, my target is {target}). Their top reason to pass: {reason}. The pitch they read: \"{pitch}\". Rewrite the pitch so it answers that reason. Keep it short and honest, and tell me what you changed."),
      promptValues(result)
    );
    const url = new URL(onPhone ? "../chat/mobile.html" : "../chat/", location.href);
    url.searchParams.set("q", prompt.slice(0, PROMPT_CHARS));
    url.searchParams.set("send", "1");
    return url.toString();
  }
  function leadLink(result) {
    const goal = fill(
      tr("founder.ask.leadPrompt", "Plan a small real launch test for this business: {business}. Price: {price}. A panel of simulated buyers gave {buys} of {n} ({rate}, my target is {target}); their top reason to pass was: {reason}. Simulated buyers are only a first filter, so plan a test with real people (pre-orders or a landing page): what to build, where to find the first 50 people, a budget, a pass mark and a date to decide."),
      promptValues(result)
    );
    const url = new URL("../lead/", location.href);
    url.searchParams.set("goal", goal.slice(0, PROMPT_CHARS));
    url.searchParams.set("go", "1");
    return url.toString();
  }

  function strip(result) {
    const good = result.rate >= result.target;
    const box = make("div", `founder-strip ${good ? "good" : "bad"}`);
    const figure = make("div", "founder-figure");
    figure.append(
      make("b", "", fill(tr("founder.result.figure", "{buys} of {n} would buy"), result)),
      " ",
      make("span", "founder-muted", fill(tr("founder.result.vs", "({rate} vs {target} target)"), { rate: share(result.rate), target: share(result.target) }))
    );
    const meta = make("div", "founder-meta");
    const facts = [result.business, result.heading].filter(Boolean);
    if (result.topReason) facts.push(fill(tr("founder.result.top", "top reason to pass: {reason}"), { reason: reasonWord(result.topReason) }));
    meta.textContent = facts.join(" · ");
    const next = make("div", "founder-next");
    next.append(
      make("b", "", tr("founder.next.label", "Next:")),
      ` ${nextStep(result)} `,
      linkButton(tr("founder.edit.pitch", "Edit pitch"), () => editIdea("pitchSection"))
    );
    const actions = make("div", "founder-actions");
    const chat = make("a", `btn small${good ? "" : " primary"}`, tr("founder.ask.chat", "Improve the pitch with GlowChat"));
    chat.id = "founder-ask-chat";
    chat.href = chatLink(result);
    const lead = make("a", `btn small${good ? " primary" : ""}`, tr("founder.ask.lead", "Plan a launch test with GlowLead"));
    lead.id = "founder-ask-lead";
    lead.href = leadLink(result);
    actions.append(...(good ? [lead, chat] : [chat, lead]));
    box.append(figure, meta, next, actions);
    return box;
  }

  function savedList() {
    const box = $("founder-saved");
    box.replaceChildren();
    const head = make("span", "founder-saved-head", tr("founder.saved.title", "Your last panels"));
    head.id = "founder-saved-head";
    box.append(head);
    if (!panels.length) {
      box.append(make("span", "founder-saved-empty", tr("founder.saved.empty", "None yet. Each finished panel is kept here, in this browser, so you can compare runs as the pitch improves.")));
      return;
    }
    const list = make("ul", "founder-saved-list");
    for (const row of panels) {
      const item = make("li", "founder-saved-item");
      const facts = [row.heading].filter(Boolean);
      if (row.topReason) facts.push(fill(tr("founder.result.top", "top reason to pass: {reason}"), { reason: reasonWord(row.topReason) }));
      item.title = `${row.business} · ${facts.join(" · ")}`;
      const rate = make("span", `founder-saved-rate ${row.rate >= row.target ? "good" : "bad"}`, `${share(row.rate)} `);
      rate.append(make("span", "founder-muted", fill(tr("founder.saved.vs", "vs {target}"), { target: share(row.target) })));
      item.append(make("span", "founder-saved-date", dayOf(row.at)), make("span", "founder-saved-name", shortName(row.business)), rate);
      list.append(item);
    }
    const clear = linkButton(tr("founder.saved.clear", "Clear"), () => {
      panels = [];
      savePanels();
      paint();
    });
    clear.id = "founder-saved-clear";
    box.append(list, clear);
  }

  function paint() {
    const box = $("founder-result");
    box.replaceChildren(steps());
    if (latest) box.append(strip(latest));
    savedList();
  }

  function renderLocalised() {
    applyTheme(root.dataset.theme);
    paint();
  }
  if (window.GlowLocale) {
    window.GlowLocale.apply();
    window.GlowLocale.onChange(() => {
      window.GlowLocale.apply();
      renderLocalised();
    });
  }
  renderLocalised();

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
})();
