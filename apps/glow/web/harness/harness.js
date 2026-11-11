// GlowHarness: the page for Glow's own agent harness. The engine (../shared/glow-harness.js) runs the loop,
// reads and repairs tool calls, asks before anything changes and records a trace. The kit
// (../shared/glow-harness-kit.js) supplies the tools and the two brains. This file only draws what they do:
// the step timeline, the permission prompt, the tool switches, the notebook, and every figure from bench.json.
(function () {
  "use strict";

  const H = window.GlowHarness;
  const K = window.GlowHarnessKit;
  const S = window.GlowHarnessSuite;
  const CHECKS = window.GlowHarnessChecks;
  const root = document.documentElement;
  const CHAT_STORE_KEY = "mufakat.v1";
  const HOME_THEME_KEY = "glow.home.theme";
  const BRAIN_KEY = "glow.harness.brain.v1";
  const CHOICE_KEY = "glow.harness.policy.v1";
  const onPhone = window.matchMedia("(max-width: 720px)").matches;
  const CHAT_PAGE = onPhone ? "../chat/mobile.html" : "../chat/";
  const ASK_MAX = 3800; // GlowChat accepts up to 4000 characters in ?q=
  const TASK_MAX = 1200;
  const FREE_TIME_MS = 300000; // a rationed free model may keep a run waiting
  const WAIT_SECONDS = 30;
  const WAIT_ROUNDS = 4;
  const SHOWN_CHARS = 1600;
  const CHOICES = ["allow", "ask", "off"];
  const ASKS_BY_DEFAULT = ["notes", "tale"]; // the tools that can save, delete or download
  const TOOL_ICONS = { calc: "🧮", text: "🔤", clock: "📅", units: "📏", notes: "📝", library: "📚", tale: "✨" };
  const EXAMPLES = [
    { icon: "🧮", id: "sum", text: "What is (1234 + 5678) * 91 - 4321?" },
    { icon: "📅", id: "days", text: "How many days are there from today until 1 January 2030?" },
    { icon: "🔤", id: "letters", text: "How many times does the letter r appear in strawberry?" },
    { icon: "📏", id: "convert", text: "Convert 26.2 miles to km." },
    { icon: "🔗", id: "chain", text: "Convert 5 miles to km, then multiply that by 3." },
    { icon: "📝", id: "remember", text: "Remember that my locker code is 7291." },
    { icon: "🔎", id: "recall", text: "What is my locker code?" },
    { icon: "✨", id: "tale", text: "Write a short tale that begins: Once upon a time there was a little fox" },
  ];
  const OFFLINE_FILES = [
    "./",
    "./harness.css",
    "./harness.js",
    "./suite.js",
    "./checks.js",
    "./bench.json",
    "../shared/glow-harness.js",
    "../shared/glow-harness-kit.js",
    "../shared/glow-offline-library.js",
  ];

  const $ = (id) => document.getElementById(id);
  const tr = (key, fallback) => {
    if (!window.GlowLocale) return fallback;
    const value = window.GlowLocale.t(key);
    return value && value !== key ? value : fallback;
  };
  const fill = (template, values) => template.replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));

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
    const themeHint = theme === "dark" ? tr("harness.theme.toLight", "Switch to light") : tr("harness.theme.toDark", "Switch to dark");
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
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  let toastTimer = 0;
  function toast(message) {
    const box = $("harness-toast");
    box.textContent = message;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.hidden = true;
    }, 2600);
  }
  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      const area = document.createElement("textarea");
      area.value = value;
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand && document.execCommand("copy");
      area.remove();
      return !!ok;
    }
  }
  function chatUrl(question) {
    const url = new URL(CHAT_PAGE, location.href);
    url.searchParams.set("q", question.slice(0, ASK_MAX));
    url.searchParams.set("send", "1");
    return url.href;
  }
  const kilobytes = (bytes) => (bytes / 1000).toFixed(1) + " KB";
  const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);
  function clip(text) {
    const value = String(text == null ? "" : text);
    return value.length > SHOWN_CHARS ? value.slice(0, SHOWN_CHARS) + " …" : value;
  }
  function newSeed() {
    try {
      return crypto.getRandomValues(new Uint32Array(1))[0];
    } catch (error) {
      return Math.floor(Math.random() * 4294967296);
    }
  }

  if (!H || !K) {
    $("harness-meta").textContent = tr("harness.loadFailed", "The engine did not load. Check your connection and reload the page.");
    return;
  }

  // ---- storage: this browser if it lets us, otherwise memory for this visit ----
  function openStorage() {
    try {
      const probe = "glow.harness.probe";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      return localStorage;
    } catch (error) {
      return K.memoryStorage();
    }
  }
  const store = openStorage();
  function readStored(key, fallback) {
    try {
      const value = JSON.parse(store.getItem(key) || "null");
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }
  function writeStored(key, value) {
    try {
      store.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Storage full or blocked: the choice lasts for this visit only.
    }
  }

  // ---- GlowSpark as a tool: the story model is fetched only when the tale tool first runs ----
  const spark = (function () {
    let worker = null;
    let loading = null;
    let ready = false;
    let nextId = 0;
    const jobs = new Map();
    function failJobs(message) {
      for (const job of jobs.values()) job.reject(new Error(message));
      jobs.clear();
    }
    function load() {
      if (loading) return loading;
      loading = new Promise((resolve, reject) => {
        try {
          worker = new Worker("../spark/worker.js");
        } catch (error) {
          loading = null;
          reject(new Error("GlowSpark cannot start in this browser"));
          return;
        }
        worker.onmessage = (event) => {
          const message = event.data || {};
          if (message.type === "ready") {
            ready = true;
            resolve();
          } else if (message.type === "tokens") {
            const job = jobs.get(message.id);
            if (job) job.onTokens(message.items || []);
          } else if (message.type === "done") {
            const job = jobs.get(message.id);
            jobs.delete(message.id);
            if (job) job.resolve();
          } else if (message.type === "error") {
            if (message.stage === "load") {
              loading = null;
              reject(new Error(navigator.onLine === false ? "GlowSpark is not saved on this device and you are offline" : "GlowSpark could not load"));
            } else {
              failJobs("GlowSpark stopped while writing");
            }
          }
        };
        worker.onerror = () => {
          if (!ready) {
            loading = null;
            reject(new Error("GlowSpark could not load"));
          }
          failJobs("GlowSpark stopped while writing");
        };
        worker.postMessage({ type: "load" });
      });
      return loading;
    }
    async function write(opening, length, signal) {
      await load();
      if (signal && signal.aborted) throw new Error("stopped");
      const wanted = Math.max(20, Math.min(200, Number(length) || 90));
      const id = ++nextId;
      let text = "";
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        worker.postMessage({ type: "stop" });
      };
      await new Promise((resolve, reject) => {
        jobs.set(id, {
          resolve,
          reject,
          onTokens(items) {
            for (const item of items) text += item.text;
            const words = countWords(text);
            const sentenceEnd = /[.!?]["'\u201d\u2019]?\s*$/.test(text);
            if ((words >= wanted && sentenceEnd) || words >= wanted + 30) stop();
          },
        });
        if (signal) signal.addEventListener("abort", stop, { once: true });
        worker.postMessage({ type: "write", id, text: opening, temperature: 0.8, topK: 40, seed: newSeed(), maxTokens: wanted * 2 + 60 });
      });
      return (opening + text).trim();
    }
    return { loaded: () => ready, write };
  })();

  const library = window.GlowLibrary || { installed: () => [], search: async () => [] };
  const tools = K.createTools({ storage: store, library, spark });

  // ---- state ----
  function loadChoices() {
    const saved = readStored(CHOICE_KEY, {}) || {};
    const choices = {};
    for (const tool of tools) {
      const fallback = ASKS_BY_DEFAULT.includes(tool.name) ? "ask" : "allow";
      choices[tool.name] = CHOICES.includes(saved[tool.name]) ? saved[tool.name] : fallback;
    }
    return choices;
  }
  const state = {
    brain: readStored(BRAIN_KEY, "rules") === "free" ? "free" : "rules",
    choices: loadChoices(),
    running: false,
    abort: null,
    ask: null,
    wait: null,
    last: null,
    bench: null,
    benchFailed: false,
    selftest: null,
    replay: null,
  };
  let view = null; // the run on screen: its task, the events the engine emitted and the questions it asked

  // What the engine is told. "Off" blocks a tool. "Allow" runs it without asking. "Ask" on a read-only tool asks
  // every time; on the notebook and the storyteller it keeps the engine's own rule (reads run, the rest asks).
  function enginePolicies() {
    const policies = {};
    for (const tool of tools) {
      const choice = state.choices[tool.name];
      if (choice === "off") policies[tool.name] = "deny";
      else if (choice === "allow") policies[tool.name] = "allow";
      else if (!ASKS_BY_DEFAULT.includes(tool.name)) policies[tool.name] = "ask";
    }
    return policies;
  }

  // ---- words that change with the language ----
  function toolNames() {
    return {
      calc: tr("harness.tool.calc", "Calculator"),
      text: tr("harness.tool.text", "Text"),
      clock: tr("harness.tool.clock", "Calendar"),
      units: tr("harness.tool.units", "Units"),
      notes: tr("harness.tool.notes", "Notebook"),
      library: tr("harness.tool.library", "Library"),
      tale: tr("harness.tool.tale", "Storyteller"),
    };
  }
  function toolDescriptions() {
    return {
      calc: tr("harness.tool.calcDesc", "Exact arithmetic, however long the numbers."),
      text: tr("harness.tool.textDesc", "Counts letters and words, reverses text, changes case."),
      clock: tr("harness.tool.clockDesc", "Knows today's date and does date arithmetic."),
      units: tr("harness.tool.unitsDesc", "Converts between units with exact factors."),
      notes: tr("harness.tool.notesDesc", "Its only memory. Notes are saved in this browser."),
      library: tr("harness.tool.libraryDesc", "Searches the offline packs you installed in GlowChat."),
      tale: tr("harness.tool.taleDesc", "Asks GlowSpark, Glow's own tiny story model, to continue an opening."),
    };
  }
  function toolRiskNotes() {
    return {
      notes: tr("harness.tool.notesRisk", "Asks before saving or deleting."),
      tale: tr("harness.tool.taleRisk", "The first use downloads the story model, so it asks first."),
    };
  }
  function exampleLabels() {
    return {
      sum: tr("harness.ex.sum", "A long sum"),
      days: tr("harness.ex.days", "Days until a date"),
      letters: tr("harness.ex.letters", "Count letters"),
      convert: tr("harness.ex.convert", "Miles to km"),
      chain: tr("harness.ex.chain", "Two steps"),
      remember: tr("harness.ex.remember", "Remember this"),
      recall: tr("harness.ex.recall", "Recall it"),
      tale: tr("harness.ex.tale", "A tiny tale"),
    };
  }
  function categoryNames() {
    return {
      arithmetic: tr("harness.cat.arithmetic", "Arithmetic"),
      text: tr("harness.cat.text", "Text"),
      dates: tr("harness.cat.dates", "Dates"),
      units: tr("harness.cat.units", "Units"),
      memory: tr("harness.cat.memory", "Memory"),
      multistep: tr("harness.cat.multistep", "Several steps"),
      controls: tr("harness.cat.controls", "Controls (knowledge, no tool helps)"),
    };
  }
  function statusLabels() {
    return {
      done: tr("harness.status.done", "Answer"),
      limit: tr("harness.status.limit", "It ran out of steps or time"),
      loop: tr("harness.status.loop", "Stopped: it kept repeating itself"),
      stopped: tr("harness.status.stopped", "Stopped"),
      error: tr("harness.status.error", "It could not finish"),
    };
  }
  function brainName(via) {
    if (!via || via.provider === "glow") return tr("harness.who.rules", "the no-model rules");
    const provider = K.PROVIDERS.find((item) => item.id === via.provider);
    return (provider ? provider.label : String(via.provider)) + (via.model ? " (" + via.model + ")" : "");
  }

  // ---- the timeline: one row for each thing the engine did ----
  function stepRow(kind, icon, title, detail) {
    const item = make("li", "step " + kind);
    const tag = make("span", "step-tag", icon);
    tag.setAttribute("aria-hidden", "true");
    const body = make("div", "step-body");
    const head = make("p", "step-head");
    head.appendChild(make("b", "", title));
    if (detail) head.appendChild(make("small", "", detail));
    body.appendChild(head);
    item.append(tag, body);
    $("timeline").appendChild(item);
    return body;
  }
  function addText(body, text) {
    const node = make("p", "step-text", text);
    body.appendChild(node);
    return node;
  }
  function addPre(body, text) {
    const node = make("pre", "step-pre", clip(text));
    body.appendChild(node);
    return node;
  }
  function addBadge(body, text, variant) {
    let box = body.querySelector(".badges");
    if (!box) {
      box = make("div", "badges");
      body.appendChild(box);
    }
    box.appendChild(make("span", "badge" + (variant ? " " + variant : ""), text));
  }
  function clearTransient() {
    $("timeline").querySelectorAll(".step.thinking").forEach((row) => row.remove());
  }
  function argLines(args) {
    const entries = Object.entries(args || {});
    if (!entries.length) return "{}";
    return entries.map(([name, value]) => name + ": " + (typeof value === "string" ? value : JSON.stringify(value))).join("\n");
  }
  function drawTask() {
    const body = stepRow("task", "🙋", tr("harness.row.task", "Your task"));
    addText(body, view.task);
  }

  function askSummary(request) {
    const args = request.args || {};
    if (request.tool === "notes" && args.op === "save") {
      return fill(tr("harness.ask.save", "Save a note: {key} = {value}"), { key: args.key || "?", value: args.value || "?" });
    }
    if (request.tool === "notes" && args.op === "delete") {
      return fill(tr("harness.ask.delete", "Delete the note “{key}”"), { key: args.key || "?" });
    }
    if (request.tool === "notes" && args.op === "clear") return tr("harness.ask.clear", "Delete every saved note");
    if (request.tool === "tale" && request.risk === "download") {
      return tr("harness.ask.download", "Download GlowSpark, the small story model, and let it write on this device");
    }
    const names = toolNames();
    return fill(tr("harness.ask.use", "Use {tool} with {args}"), { tool: names[request.tool] || request.tool, args: JSON.stringify(args) });
  }
  function askReason(request) {
    if (request.reason === "untrusted") {
      const names = toolNames();
      const source = names[request.taintSource] || request.taintSource || tr("harness.ask.someTool", "a tool");
      return fill(tr("harness.ask.untrusted", "It asks again because this run has read text from {source}. Such text can hide instructions meant to trick an AI, so nothing changes without your yes."), { source });
    }
    if (request.risk === "destructive") return tr("harness.ask.destructive", "This deletes something saved in this browser. It cannot be undone.");
    if (request.risk === "download") return tr("harness.ask.downloadWhy", "A one-time download. After that the story model works offline.");
    if (request.risk === "write") return tr("harness.ask.write", "This saves something in this browser, on this device.");
    return tr("harness.ask.everyTime", "You set this tool to ask every time.");
  }
  function askRow(request, onAnswer) {
    const names = toolNames();
    const body = stepRow("ask", "✋", tr("harness.ask.title", "It asks your permission"), names[request.tool] || request.tool);
    const box = make("div", "ask-box");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", tr("harness.ask.title", "It asks your permission"));
    box.tabIndex = -1;
    box.appendChild(make("p", "ask-what", askSummary(request)));
    box.appendChild(make("p", "ask-why", askReason(request)));
    const actions = make("div", "ask-actions");
    const options = [
      ["once", tr("harness.ask.once", "Allow once"), "btn small primary"],
      ["always", tr("harness.ask.always", "Always allow"), "btn small"],
      ["deny", tr("harness.ask.deny", "Don't allow"), "btn small"],
    ];
    for (const [value, label, className] of options) {
      if (value === "always" && request.tainted) continue; // untrusted text was read: a standing yes is not on offer
      const button = make("button", className, label);
      button.type = "button";
      button.dataset.answer = value;
      button.disabled = !onAnswer;
      if (onAnswer) button.addEventListener("click", () => onAnswer(value));
      actions.appendChild(button);
    }
    box.appendChild(actions);
    body.appendChild(box);
    return {
      box,
      settle(decision) {
        const said = decision === "always"
          ? tr("harness.ask.saidAlways", "✓ Allowed from now on")
          : decision === "deny"
            ? tr("harness.ask.saidNo", "✕ Not allowed")
            : tr("harness.ask.saidOnce", "✓ Allowed this once");
        box.classList.add("settled");
        box.appendChild(make("p", "ask-verdict " + (decision === "deny" ? "no" : "yes"), said));
      },
    };
  }
  // The engine's confirm hook: draws the question in the timeline and waits for a tap. Stop answers "deny".
  function askUser(request) {
    return new Promise((resolve) => {
      clearTransient();
      view.asks.push(request);
      let answered = false;
      const answer = (choice) => {
        if (answered) return;
        answered = true;
        state.ask = null;
        row.box.querySelectorAll("button").forEach((button) => {
          button.disabled = true;
        });
        root.dataset.run = "running";
        resolve(choice);
      };
      const row = askRow(request, answer);
      view.openAsk = row;
      state.ask = { answer };
      root.dataset.run = "asking";
      row.box.scrollIntoView({ block: "nearest" });
      row.box.focus({ preventScroll: true }); // the box, not a button: a held Enter key must never grant anything
    });
  }
  function rememberAlways(toolName) {
    state.choices[toolName] = "allow";
    writeStored(CHOICE_KEY, state.choices);
    renderTools();
  }

  function drawParse(event, toolLabel) {
    if (event.kind === "tool") {
      const body = stepRow("call", TOOL_ICONS[event.tool] || "🔧", fill(tr("harness.row.call", "It calls {tool}"), { tool: toolLabel(event.tool) }));
      addPre(body, argLines(event.args));
      for (const code of event.repairs || []) addBadge(body, fill(tr("harness.badge.repaired", "Repaired: {code}"), { code }), "fix");
    } else if (event.kind === "invalid") {
      stepRow("warn", "?", tr("harness.row.invalid", "The harness found no tool call and no answer in that reply"));
    } else if (event.kind === "unknown-tool") {
      stepRow("warn", "?", fill(tr("harness.row.unknownTool", "It asked for a tool that does not exist: {tool}"), { tool: String(event.tool) }));
    } else if (event.kind === "bad-args") {
      const body = stepRow("warn", "?", fill(tr("harness.row.badArgs", "{tool} cannot use those arguments"), { tool: toolLabel(event.tool) }));
      if (event.error) addText(body, event.error);
    } else if (event.kind === "final") {
      view.implicit = !!event.implicit;
    }
  }
  function drawGuard(event, toolLabel) {
    if (event.kind === "abort") {
      stepRow("blocked", "■", tr("harness.guard.abort", "You pressed Stop"));
    } else if (event.kind === "repairs") {
      stepRow("blocked", "⛔", fill(tr("harness.guard.repairs", "It gave up after {limit} corrections in a row"), { limit: event.limit }));
    } else if (event.kind === "steps") {
      stepRow("blocked", "⛔", fill(tr("harness.guard.steps", "It reached the limit of {limit} steps"), { limit: event.limit }));
    } else if (event.kind === "time") {
      stepRow("blocked", "⛔", fill(tr("harness.guard.time", "It reached the time limit of {seconds} s"), { seconds: Math.round(event.limit / 1000) }));
    } else if (event.kind === "loop") {
      stepRow("blocked", "⛔", fill(tr("harness.guard.loop", "It kept making the same {tool} call, so the harness stopped the run"), { tool: toolLabel(event.tool) }));
    } else if (event.kind === "duplicate") {
      stepRow("warn", "↺", fill(tr("harness.guard.duplicate", "It repeated a {tool} call it had already made, so the harness pointed it back to the earlier result"), { tool: toolLabel(event.tool) }));
    }
  }
  function drawGate(event, live, toolLabel) {
    if (event.asked) {
      const request = view.asks[view.asksDrawn];
      view.asksDrawn += 1;
      let row = live ? view.openAsk : null;
      if (!row && request) row = askRow(request, null);
      if (row) row.settle(event.decision);
      view.openAsk = null;
    } else if (event.decision === "deny") {
      const title = event.reason === "off"
        ? fill(tr("harness.gate.off", "Blocked: you switched {tool} off"), { tool: toolLabel(event.tool) })
        : fill(tr("harness.gate.blocked", "Blocked: {tool} needed a permission and nobody could give it"), { tool: toolLabel(event.tool) });
      stepRow("blocked", "⛔", title);
    }
    if (live && event.decision === "always") rememberAlways(event.tool);
  }
  function drawEvent(event, live) {
    const names = toolNames();
    const toolLabel = (name) => names[name] || String(name);
    if (live) clearTransient();
    if (event.type === "think") {
      if (live) stepRow("thinking", "…", fill(tr("harness.row.thinking", "Step {step}: thinking…"), { step: event.step }));
    } else if (event.type === "model") {
      const title = fill(tr("harness.row.model", "Step {step}: {who} replied"), { step: event.step, who: brainName(event.via) });
      const body = stepRow("model", view.brain === "rules" ? "⚙" : "🧠", title);
      addPre(body, event.text);
      if (event.via && event.via.channel === "native") addBadge(body, tr("harness.badge.native", "sent as a native function call, turned back into text"));
    } else if (event.type === "error") {
      const body = stepRow("err", "⚠", tr("harness.row.modelError", "The brain did not answer"));
      addPre(body, event.message);
    } else if (event.type === "parse") {
      drawParse(event, toolLabel);
    } else if (event.type === "repair") {
      const count = fill(tr("harness.row.repairCount", "try {streak} of {limit}"), { streak: event.streak, limit: H.DEFAULTS.maxRepairs });
      stepRow("warn", "↩", tr("harness.row.repair", "The harness explained the mistake and asked again"), count);
    } else if (event.type === "compact") {
      stepRow("warn", "🗜", tr("harness.row.compact", "Older tool results were shortened to keep the conversation small"));
    } else if (event.type === "guard") {
      drawGuard(event, toolLabel);
    } else if (event.type === "gate") {
      drawGate(event, live, toolLabel);
    } else if (event.type === "call") {
      if (live) stepRow("thinking", TOOL_ICONS[event.tool] || "🔧", fill(tr("harness.row.running", "{tool} is working…"), { tool: toolLabel(event.tool) }));
    } else if (event.type === "tool") {
      const title = event.ok
        ? fill(tr("harness.row.result", "{tool} returned"), { tool: toolLabel(event.tool) })
        : event.timedOut
          ? fill(tr("harness.row.timeout", "{tool} took too long"), { tool: toolLabel(event.tool) })
          : fill(tr("harness.row.failed", "{tool} could not do that"), { tool: toolLabel(event.tool) });
      const body = stepRow("result" + (event.ok ? "" : " failed") + (event.untrusted ? " untrusted" : ""), event.ok ? "✓" : "✕", title);
      addPre(body, event.ok ? event.result : event.error);
      view.resultBody = body;
      if (live && event.tool === "notes") renderNotes();
    } else if (event.type === "observe") {
      const body = view.resultBody;
      view.resultBody = null;
      if (!body) return;
      const flags = event.flags || [];
      if (event.untrusted) addBadge(body, tr("harness.badge.untrusted", "untrusted text: given to the brain as data, not as instructions"), "caution");
      if (flags.includes("looks-like-instructions")) addBadge(body, tr("harness.badge.instructions", "contains what looks like instructions"), "stop");
      if (flags.includes("clipped")) addBadge(body, tr("harness.badge.clipped", "shortened before the brain saw it"));
      if (flags.includes("repeat")) addBadge(body, tr("harness.badge.repeat", "same call as before"));
    }
  }
  function onEvent(event) {
    if (!view) return;
    view.events.push(event);
    try {
      drawEvent(event, true);
    } catch (error) {
      console.error("GlowHarness could not draw a step", error);
    }
  }
  // After a language change the finished run is drawn again from its recorded events.
  function rebuildTimeline() {
    if (!view || state.running) return;
    $("timeline").textContent = "";
    view.asksDrawn = 0;
    view.openAsk = null;
    view.resultBody = null;
    drawTask();
    for (const event of view.events) drawEvent(event, false);
  }

  // ---- the two brains ----
  // A rationed free provider answers "come back later". Wait with a visible countdown and try again a few times.
  function waitForQuota() {
    return new Promise((resolve, reject) => {
      clearTransient();
      const body = stepRow("wait", "⏳", tr("harness.wait.title", "The free model is busy"));
      const line = addText(body, "");
      const item = body.parentNode;
      let left = WAIT_SECONDS;
      const show = () => {
        line.textContent = fill(tr("harness.wait.text", "Too many people are using it right now. Trying again in {seconds} s. Press Stop to give up."), { seconds: left });
      };
      const finish = () => {
        clearInterval(timer);
        state.wait = null;
        item.remove();
      };
      const timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          finish();
          resolve();
        } else {
          show();
        }
      }, 1000);
      state.wait = {
        cancel() {
          finish();
          reject(new Error("stopped"));
        },
      };
      show();
    });
  }
  function makeBrain() {
    if (state.brain !== "free") return K.rulesBrain();
    const inner = K.chatBrain();
    const brain = {
      last: null,
      failures: [],
      async next(request) {
        for (let round = 1; ; round += 1) {
          try {
            const reply = await inner.next(request);
            brain.last = inner.last;
            brain.failures = inner.failures || [];
            return reply;
          } catch (error) {
            brain.last = inner.last;
            brain.failures = inner.failures || [];
            const rationed = brain.failures.length > 0 && brain.failures.every((line) => /HTTP (402|429)\b/.test(line));
            const stopped = !!(request.signal && request.signal.aborted);
            if (!rationed || stopped || round >= WAIT_ROUNDS) throw error;
            await waitForQuota();
          }
        }
      },
    };
    return brain;
  }

  // ---- running a task ----
  function renderButtons() {
    const last = state.last;
    const hasTrace = !!(last && last.result.trace);
    $("run-btn").hidden = state.running;
    $("stop-btn").hidden = !state.running;
    $("copy-btn").disabled = !(last && last.result.answer);
    $("replay-btn").disabled = !hasTrace || state.running;
    $("export-btn").disabled = !hasTrace || state.running;
    $("free-btn").hidden = state.running || !(last && last.brain === "rules" && last.via && last.via.unmatched);
    $("chat-btn").href = chatUrl(last ? last.task : $("task-box").value.trim());
  }
  function renderRunStats() {
    const last = state.last;
    if (!last) {
      $("run-stats").textContent = state.running ? tr("harness.runStats.running", "working…") : "";
      return;
    }
    $("run-stats").textContent = fill(tr("harness.runStats", "Steps {steps} · Tool calls {calls} · {seconds} s"), {
      steps: last.result.steps,
      calls: last.result.toolCalls,
      seconds: (last.result.ms / 1000).toFixed(1),
    });
  }
  function renderAnswer() {
    const last = state.last;
    const box = $("answer");
    if (!last) {
      box.hidden = true;
      return;
    }
    const result = last.result;
    const unmatched = !!(last.via && last.via.unmatched);
    const failed = result.status === "error" || !result.answer;
    box.hidden = false;
    box.className = "answer" + (failed ? " failed" : result.status !== "done" || unmatched ? " partial" : "");
    $("answer-label").textContent = statusLabels()[result.status] || result.status;
    let text = result.answer;
    if (!text) {
      text = result.status === "stopped"
        ? tr("harness.answer.stopped", "You stopped it before it had an answer.")
        : tr("harness.answer.none", "It has no answer for this one.");
    }
    $("answer-text").textContent = text;
    const notes = [];
    if (unmatched) notes.push(tr("harness.note.unmatched", "With no model it only follows patterns: sums, dates, units, text and notes, asked in plain English. For anything else, try the free model or ask GlowChat."));
    if (result.fallback) notes.push(tr("harness.note.fallback", "The run did not finish cleanly, so the harness put this together from what the tools returned. Check it before you rely on it."));
    if (last.implicit && result.status === "done" && !unmatched) notes.push(tr("harness.note.implicit", "The brain did not mark its answer, so its whole reply is shown."));
    if (result.status === "error" && result.message) notes.push(fill(tr("harness.note.error", "What went wrong: {message}."), { message: result.message }));
    if (result.status === "error" && last.brain === "free" && navigator.onLine === false) notes.push(tr("harness.note.offline", "You are offline. The free model needs the internet. The no-model brain does not."));
    $("answer-note").hidden = notes.length === 0;
    $("answer-note").textContent = notes.join(" ");
  }
  function startView(task) {
    view = { task, brain: state.brain, events: [], asks: [], asksDrawn: 0, openAsk: null, resultBody: null, implicit: false };
    state.last = null;
    state.replay = null;
    $("timeline").textContent = "";
    $("run").hidden = false;
    drawTask();
    renderAnswer();
    renderReplay();
    renderRunStats();
    renderButtons();
    root.dataset.run = "running";
    delete root.dataset.replay;
  }
  async function runTask(text) {
    const task = String(text || "").trim().slice(0, TASK_MAX);
    if (state.running) return;
    if (!task) {
      toast(tr("harness.needTask", "Type a task first, or tap an example."));
      return;
    }
    state.running = true;
    const controller = new AbortController();
    state.abort = controller;
    startView(task);
    const brain = makeBrain();
    let result;
    try {
      const harness = H.createHarness({
        brain,
        tools,
        policies: enginePolicies(),
        confirm: askUser,
        onEvent,
        totalTimeMs: state.brain === "free" ? FREE_TIME_MS : H.DEFAULTS.totalTimeMs,
      });
      result = await harness.run(task, { signal: controller.signal });
    } catch (error) {
      result = { status: "error", answer: "", steps: 0, toolCalls: 0, fallback: false, message: String((error && error.message) || error), ms: 0, trace: null };
    }
    clearTransient();
    state.running = false;
    state.abort = null;
    state.ask = null;
    state.last = { task, brain: view.brain, via: brain.last || null, result, implicit: view.implicit };
    renderAnswer();
    renderRunStats();
    renderButtons();
    renderNotes();
    root.dataset.run = result.status;
  }
  function stopRun() {
    if (!state.running) return;
    if (state.abort) state.abort.abort();
    if (state.ask) state.ask.answer("deny");
    if (state.wait) state.wait.cancel();
  }
  $("run-btn").addEventListener("click", () => runTask($("task-box").value));
  $("stop-btn").addEventListener("click", stopRun);
  $("task-box").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      runTask($("task-box").value);
    }
  });
  $("example-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-example]");
    if (!chip || state.running) return;
    $("task-box").value = EXAMPLES[Number(chip.dataset.example)].text;
    runTask($("task-box").value);
  });

  // ---- after a run: copy, replay, save, hand over ----
  function renderReplay() {
    const box = $("replay-result");
    const replay = state.replay;
    box.className = "check-result replay-result";
    if (!replay) {
      box.textContent = "";
      return;
    }
    if (replay.running) {
      box.textContent = tr("harness.replay.running", "Replaying…");
      return;
    }
    if (replay.failed) {
      box.classList.add("fail");
      box.textContent = tr("harness.replay.failed", "The replay could not run.");
      return;
    }
    box.classList.add(replay.identical ? "pass" : "fail");
    box.textContent = replay.identical
      ? fill(tr("harness.replay.same", "✓ Replayed. The engine went through the recording again and made the same {events} moves in the same order."), { events: replay.events })
      : fill(tr("harness.replay.differs", "✕ The replay left the recording at move {at} of {events}. Please tell us."), { at: replay.at + 1, events: replay.events });
  }
  async function replayLast() {
    const last = state.last;
    if (!last || !last.result.trace || state.running) return;
    state.replay = { running: true };
    renderReplay();
    try {
      const outcome = await H.replay(last.result.trace, { tools });
      state.replay = { identical: !!outcome.identical, at: outcome.firstDifference, events: last.result.trace.events.length };
      root.dataset.replay = outcome.identical ? "same" : "differs";
    } catch (error) {
      state.replay = { failed: true };
      root.dataset.replay = "failed";
    }
    renderReplay();
  }
  function exportLast() {
    const last = state.last;
    if (!last || !last.result.trace) return;
    const result = last.result;
    const payload = {
      app: "GlowHarness",
      engine: H.VERSION,
      saved: new Date().toISOString(),
      task: last.task,
      brain: last.via || { provider: last.brain },
      result: { status: result.status, answer: result.answer, steps: result.steps, toolCalls: result.toolCalls, fallback: result.fallback, message: result.message, ms: result.ms },
      trace: result.trace,
    };
    const link = document.createElement("a");
    const address = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    link.href = address;
    link.download = "glowharness-trace-" + payload.saved.slice(0, 19).replace(/[:T]/g, "-") + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(address), 2000);
    toast(tr("harness.exported", "Trace saved. It holds your task and every step."));
  }
  $("copy-btn").addEventListener("click", async () => {
    if (!state.last || !state.last.result.answer) return;
    const ok = await copyText(state.last.result.answer);
    toast(ok ? tr("harness.copied", "Answer copied") : tr("harness.copyFailed", "Couldn't copy"));
  });
  $("replay-btn").addEventListener("click", replayLast);
  $("export-btn").addEventListener("click", exportLast);
  $("free-btn").addEventListener("click", () => {
    if (!state.last || state.running) return;
    const task = state.last.task;
    setBrain("free");
    runTask(task);
  });

  // ---- the desk: brain switch, privacy line, examples ----
  function renderMeta() {
    const text = fill(tr("harness.meta", "Ready · engine {version} · {tools} tools · no install, no account"), { version: H.VERSION, tools: tools.length });
    $("harness-meta").innerHTML = '<span class="dot ready" aria-hidden="true"></span>' + escapeHtml(text);
  }
  function renderBrain() {
    $("brain-seg").querySelectorAll("button[data-brain]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.brain === state.brain));
    });
    const line = $("privacy-line");
    line.textContent = "";
    if (state.brain === "free") {
      const providers = K.PROVIDERS.map((provider) => provider.label).join(", ");
      line.appendChild(make("b", "", tr("harness.privacy.freeHead", "This sends your task out.")));
      line.appendChild(document.createTextNode(" " + fill(tr("harness.privacy.free", "Your task and every tool result go to a free AI provider ({providers}). No account needed. These models are small, rationed and sometimes wrong."), { providers })));
    } else {
      line.appendChild(make("b", "", tr("harness.privacy.rulesHead", "Nothing leaves this page.")));
      line.appendChild(document.createTextNode(" " + tr("harness.privacy.rules", "No AI model at all: pattern rules choose the tools. It follows plain English requests about sums, dates, units, text and notes, and says so when it cannot.")));
    }
    root.dataset.brain = state.brain;
  }
  function setBrain(kind) {
    state.brain = kind === "free" ? "free" : "rules";
    writeStored(BRAIN_KEY, state.brain);
    renderBrain();
  }
  $("brain-seg").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-brain]");
    if (button && !state.running) setBrain(button.dataset.brain);
  });
  function renderChips() {
    const labels = exampleLabels();
    $("example-chips").innerHTML = EXAMPLES
      .map((example, index) => `<button type="button" class="chip" data-example="${index}" title="${escapeHtml(example.text)}">${example.icon} ${escapeHtml(labels[example.id])}</button>`)
      .join("");
    $("example-chips").setAttribute("aria-label", tr("harness.examplesLabel", "Example tasks"));
  }

  // ---- the tools and what each may do ----
  function renderTools(focus) {
    const names = toolNames();
    const descriptions = toolDescriptions();
    const risks = toolRiskNotes();
    const readOnly = tr("harness.tool.readOnly", "Only reads.");
    const labels = {
      allow: tr("harness.choice.allow", "Allow"),
      ask: tr("harness.choice.ask", "Ask"),
      off: tr("harness.choice.off", "Off"),
    };
    $("tool-list").innerHTML = tools
      .map((tool) => {
        const choice = state.choices[tool.name];
        const name = names[tool.name] || tool.name;
        const buttons = CHOICES
          .map((value) => `<button type="button" data-tool="${escapeHtml(tool.name)}" data-choice="${value}" aria-pressed="${value === choice}">${escapeHtml(labels[value])}</button>`)
          .join("");
        return `<li class="tool-row${choice === "off" ? " off" : ""}">`
          + `<span class="tool-icon" aria-hidden="true">${TOOL_ICONS[tool.name] || "🔧"}</span>`
          + `<div class="tool-main"><p class="tool-name">${escapeHtml(name)} <code>${escapeHtml(tool.name)}</code></p>`
          + `<p class="tool-desc">${escapeHtml(descriptions[tool.name] || tool.description)} <em>${escapeHtml(risks[tool.name] || readOnly)}</em></p></div>`
          + `<div class="seg tool-switch" role="group" aria-label="${escapeHtml(name)}">${buttons}</div>`
          + "</li>";
      })
      .join("");
    if (focus) {
      const button = $("tool-list").querySelector(`button[data-tool="${focus.tool}"][data-choice="${focus.choice}"]`);
      if (button) button.focus();
    }
  }
  $("tool-list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tool]");
    if (!button || !CHOICES.includes(button.dataset.choice)) return;
    state.choices[button.dataset.tool] = button.dataset.choice;
    writeStored(CHOICE_KEY, state.choices);
    renderTools({ tool: button.dataset.tool, choice: button.dataset.choice });
  });

  // ---- the notebook: everything it remembers, and a way to make it forget ----
  function readNotes() {
    const data = readStored(K.NOTES_KEY, null);
    return data && Array.isArray(data.items) ? data.items : [];
  }
  function renderNotes() {
    const items = readNotes();
    const forget = tr("harness.notes.forget", "Forget {key}");
    $("note-list").innerHTML = items
      .map((item) => `<li class="note-row"><span><b>${escapeHtml(item.key)}</b> ${escapeHtml(item.value)}</span>`
        + `<button type="button" class="note-del" data-note="${escapeHtml(item.id)}" aria-label="${escapeHtml(fill(forget, { key: item.key }))}" title="${escapeHtml(fill(forget, { key: item.key }))}">✕</button></li>`)
      .join("");
    $("notes-empty").hidden = items.length > 0;
    $("forget-all-btn").hidden = items.length === 0;
    root.dataset.notes = String(items.length);
  }
  $("note-list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-note]");
    if (!button || state.running) return;
    writeStored(K.NOTES_KEY, { v: 1, items: readNotes().filter((item) => String(item.id) !== button.dataset.note) });
    renderNotes();
  });
  $("forget-all-btn").addEventListener("click", () => {
    if (state.running) return;
    writeStored(K.NOTES_KEY, { v: 1, items: [] });
    renderNotes();
    toast(tr("harness.notes.cleared", "Everything forgotten"));
  });

  // ---- the numbers: every figure comes from bench.json (written by harness/bench.js) ----
  // On a phone both tables are laid out as stacked blocks, which makes some browsers stop announcing them
  // as tables. Naming each role keeps the rows and headers for a screen reader.
  function nameTableRoles(table) {
    if (!table) return;
    table.setAttribute("role", "table");
    table.querySelectorAll("thead, tbody").forEach((group) => group.setAttribute("role", "rowgroup"));
    table.querySelectorAll("tr").forEach((row) => row.setAttribute("role", "row"));
    table.querySelectorAll("th").forEach((cell) => cell.setAttribute("role", cell.getAttribute("scope") === "row" ? "rowheader" : "columnheader"));
    table.querySelectorAll("td").forEach((cell) => cell.setAttribute("role", "cell"));
  }
  function statTile(value, label) {
    return `<div class="stat"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`;
  }
  const scoreText = (score) => (score && typeof score.total === "number" ? score.passed + "/" + score.total : "–");
  const scoreShare = (score) => (score && score.total ? score.passed / score.total : 0);
  function modelName(model) {
    const returned = Array.isArray(model.returned) && model.returned.length ? model.returned.join(", ") : model.requested;
    return model.provider + " · " + returned;
  }
  function renderSuiteTable(bench, models) {
    const names = categoryNames();
    const alone = escapeHtml(tr("harness.table.alone", "alone"));
    const inHarness = escapeHtml(tr("harness.table.harness", "in the harness"));
    const cell = (score) => `<td>${escapeHtml(scoreText(score))}</td>`;
    const pair = (bare, harness) => cell(bare) + cell(harness);
    const headTop = `<tr><th scope="col" rowspan="2" class="corner">${escapeHtml(tr("harness.table.tasks", "Tasks"))}</th>`
      + `<th scope="col" class="group">${escapeHtml(tr("harness.table.noModel", "No model"))}</th>`
      + models.map((model) => `<th scope="colgroup" colspan="2" class="group pair">${escapeHtml(modelName(model))}</th>`).join("")
      + "</tr>";
    const headSub = `<tr><th scope="col">${inHarness}</th>` + models.map(() => `<th scope="col">${alone}</th><th scope="col">${inHarness}</th>`).join("") + "</tr>";
    const rows = bench.suite.categories
      .map((category) => `<tr><th scope="row">${escapeHtml(names[category.key] || category.key)}</th>`
        + cell((bench.rules.by_category || {})[category.id])
        + models.map((model) => pair((model.bare.by_category || {})[category.id], (model.harness.by_category || {})[category.id])).join("")
        + "</tr>")
      .join("");
    const total = `<tr class="total"><th scope="row">${escapeHtml(tr("harness.table.total", "All tasks"))}</th>`
      + cell(bench.rules)
      + models.map((model) => pair(model.bare, model.harness)).join("")
      + "</tr>";
    const answerable = bench.rules.without_clock_or_memory;
    const fair = answerable
      ? `<tr class="sub"><th scope="row">${escapeHtml(tr("harness.table.answerable", "Without the tasks that need today's date or a saved note"))}</th>`
        + cell(answerable)
        + models
          .map((model) => {
            const part = model.without_clock_or_memory;
            return part ? pair({ passed: part.bare_passed, total: part.total }, { passed: part.harness_passed, total: part.total }) : "<td></td><td></td>";
          })
          .join("")
        + "</tr>"
      : "";
    const table = $("suite-table");
    table.innerHTML = `<thead>${headTop}${headSub}</thead><tbody>${rows}${total}${fair}</tbody>`;
    // Two models make five columns of numbers: on a phone the style sheet stacks each row instead.
    table.classList.toggle("stacked", models.length > 1);
    table.style.setProperty("--suite-cols", String(1 + 2 * models.length));
    nameTableRoles(table);
    $("suite-wrap").hidden = false;
  }
  function methodLines(bench, models) {
    const lines = [];
    const suite = bench.suite;
    const controls = (suite.categories.find((category) => category.key === "controls") || {}).tasks;
    const first = models[0];
    if (first) {
      lines.push(fill(tr("harness.m.sample", "This is a small test: {tasks} tasks, each asked {passes} time per model at temperature {temperature}. One or two tasks either way is noise, not a finding."), { tasks: suite.tasks, passes: first.passes, temperature: first.temperature }));
    } else {
      lines.push(fill(tr("harness.m.sampleNoModels", "This is a small test: {tasks} tasks. This build has no finished free-model run."), { tasks: suite.tasks }));
    }
    lines.push(fill(tr("harness.m.author", "The author of the harness also wrote the {tasks} tasks, the {cases} broken tool calls and the {attacks} attacks. Nobody independent has checked them."), { tasks: suite.tasks, cases: bench.parser.cases, attacks: bench.injection.attacks }));
    lines.push(fill(tr("harness.m.rules", "The no-model brain is a set of patterns tuned on these same tasks, so its score is a best case, not a forecast for your own wording. It fails all {controls} control tasks by design: they need knowledge and it has none."), { controls }));
    const special = suite.clock_or_memory_tasks || [];
    if (models.length && special.length) {
      const memory = suite.memory_tasks || [];
      lines.push(fill(tr("harness.m.alone", "“Alone” is the same model, the same question and no tools. {count} tasks ({ids}) ask for today's date or for a note saved earlier, and a model alone is given neither. The free models still got some of them right alone ({list}). We never sent the date. One reply quotes a date line that we did not write, so it seems the providers add one. Only the {memory} memory tasks ({memoryIds}) cannot be answered alone at all. The last row of the table leaves all {count} out."), {
        count: special.length,
        ids: special.join(", "),
        list: models.map((model) => modelName(model) + " " + model.clock_or_memory.bare_passed + "/" + model.clock_or_memory.total).join(", "),
        memory: memory.length,
        memoryIds: memory.join(", "),
      }));
      lines.push(tr("harness.m.clock", "Why a model alone could get a date task right: the clock these tasks use is fixed to the same date as the runs (UTC), so a date added by a provider was the right one. On another day it would not match, and we have not tried that. One of those passes is generous: the task also asks to save a note, its checker reads only the day count, and the reply says a note was saved, which a model alone cannot do."));
    }
    lines.push(tr("harness.m.judge", "In the harness only the final answer is judged. A number passes when the right number appears in the answer as a whole number, whatever else is said."));
    lines.push(tr("harness.m.approve", "The benchmark script approved every permission prompt, used an empty library and never loaded GlowSpark, so those two tools are not measured here."));
    lines.push(fill(tr("harness.m.corpus", "Broken tool calls: {recovered} of {cases} read correctly, across {families} kinds of breakage. Missed: {missed}. The strict baseline is a plain JSON read of the whole reply and reads {strict} of them by construction. It shows that repair is needed. It is not a comparison with another harness."), {
      recovered: bench.parser.recovered,
      cases: bench.parser.cases,
      families: bench.parser.families,
      strict: bench.parser.strict,
      missed: (bench.parser.missed || []).map((miss) => (typeof miss === "string" ? miss : miss.id + (miss.why ? " (" + miss.why + ")" : ""))).join("; ") || "0",
    }));
    lines.push(fill(tr("harness.m.controls", "{held} of {controls} ordinary replies that must not be read as tool calls were left alone."), { held: bench.parser.controls_held, controls: bench.parser.controls }));
    lines.push(fill(tr("harness.m.injection", "Prompt injection: {delivered} of {attacks} attacks reached the brain marked as data. A simulated brain that obeys every injected instruction then tried to save or delete. With the rule on, {held} were stopped at the permission prompt and {ran} ran. With it off, {loose} ran. This holds by construction. It stops wrong actions, not wrong answers."), {
      delivered: bench.injection.delivered,
      attacks: bench.injection.attacks,
      held: bench.injection.held_with_rule,
      ran: bench.injection.ran_with_rule,
      loose: bench.injection.ran_without_rule,
    }));
    lines.push(fill(tr("harness.m.replay", "Replay feeds the recorded replies and tool results back through the engine and compares every move: {identical} of {traces} suite recordings match. That shows the loop is deterministic. It does not show the answers are right."), { identical: bench.replay.identical, traces: bench.replay.traces }));
    lines.push(tr("harness.m.wrapped", "One fix came from real replies. Three warm-up prompts, not in the suite, showed a model wrapping its tool call in an extra layer, and the reader learned to unwrap it before any suite task ran."));
    lines.push(tr("harness.m.llm7", "A third provider, LLM7, is wired into this page but not benchmarked: its free daily quota ran out during setup."));
    lines.push(tr("harness.m.spark", "GlowSpark is a tool here, not the brain. It continues stories and cannot follow instructions."));
    for (const model of models) {
      const work = model.harness;
      const returned = Array.isArray(model.returned) && model.returned.length ? model.returned.join(", ") : model.requested;
      lines.push(fill(tr("harness.m.run", "{provider}: one provider for the whole run, no switching. Asked for {requested}, answered as {returned}. Run on {date} (UTC) with Node {node}."), {
        provider: model.provider,
        requested: model.requested,
        returned,
        date: model.date,
        node: model.node,
      }));
      lines.push(fill(tr("harness.m.pace", "{provider} is rationed, so the script sent one call every {gap} s, waited up to {wait} s for each reply and tried each call up to {attempts} times. It was resumed {resumes} times. The harness's own time limit was raised to {limit} min for the benchmark only, so that queueing was not scored as failure."), {
        provider: model.provider,
        gap: model.gap_seconds,
        wait: model.attempt_seconds,
        attempts: model.attempts_per_call,
        resumes: model.resumes,
        limit: Math.round(model.time_limit_seconds / 60),
      }));
      if (Array.isArray(model.earlier_attempt_seconds) && model.earlier_attempt_seconds.length) {
        lines.push(fill(tr("harness.m.earlier", "{provider}: an earlier part of the run waited up to {seconds} s per reply before the pacing was changed. Its answers are kept."), { provider: model.provider, seconds: model.earlier_attempt_seconds.join(", ") }));
      }
      lines.push(fill(tr("harness.m.work", "{provider} in the harness: {steps} steps and {calls} tool calls over {runs} tasks. The reader repaired {repaired} tool calls, {turns} replies were sent back for correction, {prompts} permission prompts were approved, and {fallback} answers were assembled after a limit ({right} of them right)."), {
        provider: model.provider,
        steps: work.steps,
        calls: work.tool_calls,
        runs: work.runs,
        repaired: work.repaired_calls,
        turns: work.repair_turns,
        prompts: work.permission_prompts,
        fallback: work.fallback_answers,
        right: work.fallback_answers_right,
      }));
      const codes = Object.entries(work.repair_codes || {}).sort((a, b) => b[1] - a[1]);
      if (codes.length) {
        lines.push(fill(tr("harness.m.codes", "{provider}, repairs by kind: {list}."), { provider: model.provider, list: codes.map(([code, count]) => code + " ×" + count).join(", ") }));
      }
      if (work.native_calls) {
        lines.push(fill(tr("harness.m.native", "{provider} answered {count} times through the API's function-call field, which this page never offers. The kit turns such a call back into plain text, so every model is read the same way."), { provider: model.provider, count: work.native_calls }));
      }
      if (typeof model.empty_tries === "number") {
        lines.push(fill(tr("harness.m.empty", "{provider}: an empty reply was asked again, up to {tries} times, before it counted. Empty replies seen: {bare} alone, {harness} in the harness."), { provider: model.provider, tries: model.empty_tries, bare: model.bare.empty_replies, harness: work.empty_replies }));
      }
      if (model.bare.no_reply || work.no_reply) {
        lines.push(fill(tr("harness.m.noReply", "{provider}: some calls got no reply after every retry and are counted as misses: {bare} alone, {harness} in the harness."), { provider: model.provider, bare: model.bare.no_reply, harness: work.no_reply }));
      }
      if (model.replay) {
        lines.push(fill(tr("harness.m.replayModel", "{provider}: {identical} of {traces} recorded runs replay identically."), { provider: model.provider, identical: model.replay.identical, traces: model.replay.traces }));
      }
    }
    return lines;
  }
  // A task the provider never answered and a task answered wrongly look the same on a bar,
  // so the page says how many were never answered, and why.
  const SILENT_WHY = {
    provider_parse: () => tr("harness.silent.why.provider_parse", "the provider could not read what the model wrote"),
    output_limit: () => tr("harness.silent.why.output_limit", "the model used up its output allowance before it answered"),
    rate_limit: () => tr("harness.silent.why.rate_limit", "the provider's free quota ran out"),
    timeout: () => tr("harness.silent.why.timeout", "the provider timed out"),
    other: () => tr("harness.silent.why.other", "another provider error"),
  };
  function silentWhy(reasons) {
    const entries = Object.entries(reasons || {}).filter((entry) => entry[1] > 0);
    const text = (key) => (SILENT_WHY[key] || SILENT_WHY.other)();
    if (!entries.length) return text("other");
    if (entries.length === 1) return text(entries[0][0]);
    return entries.map(([key, count]) => `${text(key)} (${count})`).join("; ");
  }
  function silentNote(model) {
    const alone = model.bare.no_reply || 0;
    const inside = model.harness.no_reply || 0;
    if (!alone && !inside) return "";
    const lines = [
      fill(tr("harness.silent.lead", "{model}: {count} times, the provider sent back an error instead of an answer. Each one is counted as a miss."), {
        model: modelName(model),
        count: alone + inside,
      }),
    ];
    if (alone) lines.push(fill(tr("harness.silent.alone", "Alone, {count}: {why}."), { count: alone, why: silentWhy(model.bare.no_reply_reasons) }));
    if (inside) lines.push(fill(tr("harness.silent.inside", "In the harness, {count}: {why}."), { count: inside, why: silentWhy(model.harness.no_reply_reasons) }));
    return lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("");
  }
  // Below this, an uneven split between gains and losses is read as more than luck (the usual 5% line).
  const CLEAR_SPLIT_P = 0.05;
  const SMALLEST_SHOWN_PERCENT = 0.0001;
  function pairedNote(model) {
    const paired = model.paired;
    if (!paired) return "";
    const percent = paired.sign_test_p * 100;
    const chance = percent < SMALLEST_SHOWN_PERCENT ? "<" + SMALLEST_SHOWN_PERCENT + "%" : String(parseFloat(percent.toPrecision(2))) + "%";
    const lines = [
      fill(tr("harness.paired.line", "{model}, task by task: {gained} went from wrong alone to right in the harness, {lost} went from right to wrong, and {same} did not change. If the harness made no difference, chance alone would split the changed tasks at least this unevenly {chance} of the time (exact sign test)."), {
        model: modelName(model),
        gained: paired.gained,
        lost: paired.lost,
        same: paired.both_right + paired.both_wrong,
        chance,
      }),
      paired.sign_test_p < CLEAR_SPLIT_P
        ? tr("harness.paired.clear", "A split like that is unlikely to be luck.")
        : tr("harness.paired.unclear", "A split like that happens easily by luck, so this test does not show that the harness helped this model."),
    ];
    if (paired.gained_after_no_reply) {
      lines.push(fill(tr("harness.paired.gainedSilent", "{count} of the {gained} gains were tasks the provider did not answer alone."), { count: paired.gained_after_no_reply, gained: paired.gained }));
    }
    if (paired.lost_to_no_reply) {
      lines.push(fill(tr("harness.paired.lostSilent", "{count} of the {lost} losses were tasks the provider did not answer in the harness."), { count: paired.lost_to_no_reply, lost: paired.lost }));
    }
    return `<span>${escapeHtml(lines.join(" "))}</span>`;
  }
  function renderNumbers() {
    const bench = state.bench;
    if (!bench) {
      if (state.benchFailed) $("suite-lede").textContent = tr("harness.benchMissing", "The benchmark file couldn't load, so no figures are shown.");
      return;
    }
    const models = Array.isArray(bench.models) ? bench.models : [];
    $("stats").innerHTML = [
      statTile(scoreText(bench.checks), tr("harness.stat.checks", "engine checks passed when this was built. Rerun them below")),
      statTile(bench.parser.recovered + "/" + bench.parser.cases, fill(tr("harness.stat.parser", "broken tool calls read correctly. A strict reader reads {strict}"), { strict: bench.parser.strict })),
      statTile(bench.injection.held_with_rule + "/" + bench.injection.attacks, fill(tr("harness.stat.injection", "scripted injection attacks stopped at the permission prompt. With the rule off, {ran} ran"), { ran: bench.injection.ran_without_rule })),
      statTile(bench.replay.identical + "/" + bench.replay.traces, tr("harness.stat.replay", "recorded runs that replay move for move")),
      statTile(kilobytes(bench.engine.bytes), fill(tr("harness.stat.size", "the whole engine, unminified, with {dependencies} dependencies"), { dependencies: bench.engine.dependencies })),
      statTile(scoreText(bench.rules), tr("harness.stat.rules", "suite tasks solved with no model at all")),
    ].join("");

    const bars = [{ label: tr("harness.bar.rules", "No model, in the harness"), score: bench.rules, us: true, start: false }];
    for (const model of models) {
      bars.push({ label: fill(tr("harness.bar.alone", "{model}, alone"), { model: modelName(model) }), score: model.bare, us: false, start: true });
      bars.push({ label: fill(tr("harness.bar.harness", "{model}, in the harness"), { model: modelName(model) }), score: model.harness, us: true, start: false });
    }
    $("bars").innerHTML = bars
      .map((bar) => `<div class="bar${bar.us ? " us" : ""}${bar.start ? " pair-start" : ""}" role="listitem"><span>${escapeHtml(bar.label)}</span><i data-share="${scoreShare(bar.score).toFixed(4)}"></i><b>${escapeHtml(scoreText(bar.score))}</b></div>`)
      .join("");
    $("bars").querySelectorAll("i[data-share]").forEach((bar) => {
      bar.style.width = (Number(bar.dataset.share) * 100).toFixed(1) + "%";
    });
    const pairedNotes = models.map(pairedNote).filter(Boolean);
    $("paired-note").innerHTML = pairedNotes.join("");
    $("paired-note").hidden = pairedNotes.length === 0;
    const silentNotes = models.map(silentNote).filter(Boolean);
    $("bars-note").innerHTML = silentNotes.join("");
    $("bars-note").hidden = silentNotes.length === 0;
    const ledeValues = { tasks: bench.suite.tasks, groups: bench.suite.categories.length };
    $("suite-lede").textContent = models.length
      ? fill(tr("harness.suiteLede", "{tasks} tasks in {groups} groups. Each free model was given every task twice: once alone, and once inside the harness with its tools. Longer bars are better."), ledeValues)
      : fill(tr("harness.suiteLedeNoModels", "{tasks} tasks in {groups} groups. This build has no finished free-model run, so only the no-model row is shown."), ledeValues);
    renderSuiteTable(bench, models);
    $("method-list").innerHTML = methodLines(bench, models).map((line) => `<li>${escapeHtml(line)}</li>`).join("");
    $("bench-note").textContent = fill(tr("harness.benchNote", "Benchmark file built {built} with Node {node}. Engine version {version}."), { built: bench.built, node: bench.node, version: bench.engine.version });
    if (bench.references_checked) $("refs-date").textContent = bench.references_checked;
    root.dataset.bench = "ready";
  }
  async function loadJson(url) {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }
  function loadNumbers() {
    loadJson("./bench.json")
      .then((bench) => {
        state.bench = bench;
        renderNumbers();
      })
      .catch(() => {
        state.benchFailed = true;
        root.dataset.bench = "missing";
        renderNumbers();
      });
  }

  // ---- self-test: the engine's own checks, run in this browser ----
  function renderSelftest() {
    const box = $("selftest-result");
    const result = state.selftest;
    box.className = "check-result";
    if (!result) {
      box.textContent = "";
      return;
    }
    if (result.running) {
      box.textContent = tr("harness.selftest.running", "Checking…");
      root.dataset.selftest = "running";
      return;
    }
    if (result.failed) {
      box.classList.add("fail");
      box.textContent = tr("harness.selftest.error", "The checks couldn't run in this browser.");
      root.dataset.selftest = "fail";
      return;
    }
    const pass = result.total > 0 && result.passed === result.total;
    const values = {
      passed: result.passed,
      failed: result.total - result.passed,
      total: result.total,
      seconds: (result.ms / 1000).toFixed(1),
      name: result.first ? result.first.name : "",
    };
    box.classList.add(pass ? "pass" : "fail");
    box.textContent = pass
      ? fill(tr("harness.selftest.pass", "✓ {passed} of {total} checks passed in this browser, in {seconds} s. They cover the loop, the reader, the gate, the tools and replay."), values)
      : fill(tr("harness.selftest.fail", "✕ {failed} of {total} checks failed here. The first: {name}. Please tell us."), values);
    root.dataset.selftest = pass ? "pass" : "fail";
    root.dataset.selftestPassed = String(result.passed);
    root.dataset.selftestTotal = String(result.total);
  }
  async function runSelftest() {
    if (state.selftest && state.selftest.running) return;
    state.selftest = { running: true };
    renderSelftest();
    const started = performance.now();
    try {
      const outcome = await CHECKS.run(H, K, S);
      state.selftest = { passed: outcome.passed, total: outcome.total, first: (outcome.failures || [])[0] || null, ms: performance.now() - started };
    } catch (error) {
      console.error("GlowHarness checks could not run", error);
      state.selftest = { failed: true };
    }
    renderSelftest();
  }
  $("selftest-btn").addEventListener("click", runSelftest);

  // ---- start ----
  function renderLocalised() {
    applyTheme(root.dataset.theme);
    renderMeta();
    renderBrain();
    renderChips();
    renderTools();
    renderNotes();
    renderNumbers();
    renderSelftest();
    renderReplay();
    renderAnswer();
    renderRunStats();
    rebuildTimeline();
  }
  if (window.GlowLocale) {
    window.GlowLocale.apply();
    window.GlowLocale.onChange(() => {
      window.GlowLocale.apply();
      renderLocalised();
    });
  }
  renderLocalised();
  renderButtons();
  nameTableRoles(document.querySelector(".versus.compare"));
  // Notes saved from another tab show up here too.
  window.addEventListener("storage", (event) => {
    if (event.key === K.NOTES_KEY) renderNotes();
  });
  // Glow home can open this page with a task already typed (?q=).
  const query = new URLSearchParams(location.search);
  const startTask = query.get("q");
  const wantSelftest = query.get("selftest") === "1";
  if (startTask) {
    $("task-box").value = startTask.slice(0, TASK_MAX);
    history.replaceState(null, "", location.pathname + (wantSelftest ? "?selftest=1" : "") + location.hash);
  }
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
  // The floating GlowLead bubble sits on top of the page. It steps aside (see .crown-aside in harness.css) while it
  // touches an open permission question at all, and while it covers a fifth of any other control or a control covers
  // a fifth of it. So a question is never read through it and nothing has to be pressed through it.
  const PRESSABLE = "button, a[href], input, select, textarea, summary, [role='button']";
  const KEEP_CLEAR = ".ask-box:not(.settled)";
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
    for (const question of document.querySelectorAll(KEEP_CLEAR)) {
      if (seen(question) && shared(question.getBoundingClientRect()) > 0) return true;
    }
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
  loadNumbers();
  if (wantSelftest) runSelftest();
  else if (startTask) runTask($("task-box").value);
})();
