// GlowSpark: a tiny language model built from scratch for Glow. This page talks to worker.js (which
// runs engine.js off the main thread), shows the tale word by word, lets you tap any word to see what
// else the model considered and send the tale down that path, and renders every figure from bench.json.
(function () {
  "use strict";

  const CHAT_STORE_KEY = "mufakat.v1";
  const HOME_THEME_KEY = "glow.home.theme";
  const onPhone = window.matchMedia("(max-width: 720px)").matches;
  const CHAT_PAGE = onPhone ? "../chat/mobile.html" : "../chat/";
  const ASK_MAX = 3800; // GlowChat accepts up to 4000 characters in ?q=
  const TOP_K = 40;
  const UNSURE_BELOW = 0.02;
  const MIN_BRANCH_TOKENS = 40;
  const STARTERS = [
    { icon: "🦊", label: "A little fox", text: "Once upon a time there was a little fox" },
    { icon: "👑", label: "Three daughters", text: "The old king had three daughters, and" },
    { icon: "🌲", label: "The dark forest", text: "In the middle of the dark forest stood" },
    { icon: "🌊", label: "The fisherman", text: "The moon rose over the sea, and the fisherman" },
    { icon: "🐇", label: "The rabbit", text: "\"Where are you going?\" asked the rabbit." },
    { icon: "🪓", label: "A poor woodcutter", text: "There was once a poor woodcutter who" },
  ];
  const BAR_ORDER = [
    ["spark_shipped_int8", "spark.bar.shipped", "GlowSpark, as you download it", true],
    ["spark_float32", "spark.bar.float", "GlowSpark, before shrinking to 8-bit", true],
    ["spark_v0_baseline", "spark.bar.baseline", "Our first quick try ({minutes} min of training)", false],
    ["xz_9e_primed_with_training_corpus", "spark.bar.xzPrimed", "xz, handed every training book", false],
    ["xz_9e", "spark.bar.xz", "xz", false],
    ["bzip2_9", "spark.bar.bzip2", "bzip2", false],
    ["gzip_9", "spark.bar.gzip", "gzip", false],
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
    document.documentElement.dataset.theme = theme;
    $("theme-btn").textContent = theme === "dark" ? "☀" : "☾";
    $("theme-btn").title = theme === "dark" ? "Switch to light" : "Switch to dark";
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#262624" : "#faf9f5";
  }
  applyTheme(preferredTheme());
  $("theme-btn").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
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
  let toastTimer = 0;
  function toast(message) {
    const box = $("spark-toast");
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
  const megabytes = (bytes) => (bytes / 1e6).toFixed(1) + " MB";
  const seconds = (ms) => (ms / 1000).toFixed(1);
  const percent = (p) => (p < 0.01 ? "<1%" : Math.round(p * 100) + "%");
  const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);
  function newSeed() {
    try {
      return crypto.getRandomValues(new Uint32Array(1))[0];
    } catch (error) {
      return (Math.random() * 4294967296) >>> 0;
    }
  }

  // ---- state ----
  const state = {
    phase: "loading", // loading | ready | failed
    writing: false,
    job: 0,
    expectPrimed: false,
    items: [], // { token, text, given, hidden, p, alternatives, chosen }
    readyMs: 0,
    wordsPerSecond: 0,
    bench: null,
    books: null,
    openIndex: -1,
    pendingPrompt: "",
    wantSelftest: false,
    selftest: null, // last result, so it can be re-rendered in another language
  };
  const root = document.documentElement;
  let worker = null;

  // ---- status line ----
  function renderStatus(progressText) {
    const meta = $("spark-meta");
    root.dataset.sparkState = state.writing ? "writing" : state.phase;
    if (state.phase === "ready") {
      const size = state.bench && state.bench.download ? megabytes(state.bench.download.total_bytes) : "";
      const text = fill(tr("spark.status.ready", "Ready in {seconds} s"), { seconds: seconds(state.readyMs) })
        + (size ? " · " + size : "")
        + " · " + tr("spark.status.local", "running on this device, nothing is sent anywhere");
      meta.innerHTML = '<span class="dot ready" aria-hidden="true"></span>' + escapeHtml(text);
    } else if (state.phase === "failed") {
      const reason = navigator.onLine === false
        ? tr("spark.status.offline", "You're offline and the model isn't saved on this device yet.")
        : tr("spark.status.failed", "The model couldn't load.");
      meta.innerHTML = '<span class="dot failed" aria-hidden="true"></span>' + escapeHtml(reason)
        + ' <button type="button" id="retry-btn">' + escapeHtml(tr("spark.retry", "Try again")) + "</button>";
    } else {
      meta.innerHTML = '<span class="dot" aria-hidden="true"></span>'
        + escapeHtml(progressText || tr("spark.status.waking", "Waking the model…"));
    }
  }
  $("spark-meta").addEventListener("click", (event) => {
    if (event.target.id === "retry-btn") startWorker();
  });

  function renderButtons() {
    const ready = state.phase === "ready";
    const hasTale = state.items.some((item) => !item.given);
    $("write-btn").disabled = !ready;
    $("write-btn").hidden = state.writing;
    $("stop-btn").hidden = !state.writing;
    $("again-btn").disabled = !ready || state.writing || !state.items.length;
    $("more-btn").disabled = !ready || state.writing || !hasTale;
    $("selftest-btn").disabled = !ready;
    root.dataset.sparkState = state.writing ? "writing" : state.phase;
  }

  // ---- the worker ----
  function startWorker() {
    if (worker) worker.terminate();
    state.phase = "loading";
    state.writing = false;
    $("load-bar").classList.remove("done");
    $("load-fill").style.width = "0";
    renderStatus();
    renderButtons();
    try {
      worker = new Worker("./worker.js");
    } catch (error) {
      state.phase = "failed";
      renderStatus();
      return;
    }
    worker.onmessage = (event) => onWorkerMessage(event.data || {});
    worker.onerror = () => {
      state.phase = "failed";
      state.writing = false;
      renderStatus();
      renderButtons();
    };
    worker.postMessage({ type: "load" });
  }

  function onWorkerMessage(message) {
    if (message.type === "progress") {
      const share = message.total ? Math.min(1, message.received / message.total) : 0;
      $("load-fill").style.width = Math.round(share * 100) + "%";
      renderStatus(fill(tr("spark.status.loading", "Downloading the model… {percent}%"), { percent: Math.round(share * 100) }));
    } else if (message.type === "ready") {
      state.phase = "ready";
      state.readyMs = Math.round(performance.now());
      root.dataset.sparkReadyMs = String(state.readyMs);
      $("load-fill").style.width = "100%";
      $("load-bar").classList.add("done");
      renderStatus();
      renderButtons();
      renderLiveStats();
      if (state.pendingPrompt) {
        const text = state.pendingPrompt;
        state.pendingPrompt = "";
        writeFromText(text);
      }
      if (state.wantSelftest) {
        state.wantSelftest = false;
        runSelftest();
      }
    } else if (message.type === "primed") {
      if (message.id !== state.job || !state.expectPrimed) return;
      state.expectPrimed = false;
      state.items = message.items.map((item, index) => ({
        token: item.token,
        text: item.text,
        given: true,
        hidden: index === 0 && item.text === "\n", // the line break every tale is primed with
      }));
      renderTale();
    } else if (message.type === "tokens") {
      if (message.id !== state.job) return;
      for (const item of message.items) {
        state.items.push({ token: item.token, text: item.text, given: false, p: item.p, alternatives: item.alternatives });
        appendWord(state.items.length - 1);
      }
      showSpeed(message.tokensPerSecond, message.written);
    } else if (message.type === "done") {
      if (message.id !== state.job) return;
      state.writing = false;
      showSpeed(message.tokensPerSecond, message.written);
      root.dataset.sparkTokensPerSecond = message.tokensPerSecond.toFixed(1);
      root.dataset.sparkPrimeMs = String(message.primeMs);
      removeCaret();
      renderButtons();
      renderLiveStats();
    } else if (message.type === "selftest") {
      state.selftest = message;
      renderSelftest();
    } else if (message.type === "error") {
      if (message.stage === "load") {
        state.phase = "failed";
        renderStatus();
      } else if (message.stage === "selftest") {
        state.selftest = { failed: true };
        renderSelftest();
      } else {
        toast(tr("spark.writeFailed", "Something went wrong while writing. Try again."));
      }
      state.writing = false;
      removeCaret();
      renderButtons();
    }
  }

  // ---- writing ----
  function settings() {
    const pressed = $("length-seg").querySelector('[aria-pressed="true"]');
    return {
      temperature: Number($("creativity").value) / 10,
      maxTokens: Number(pressed ? pressed.dataset.length : 160),
    };
  }

  function send(request) {
    if (state.phase !== "ready") return;
    closeAlternatives();
    stopSpeaking();
    const chosen = settings();
    state.job += 1;
    state.writing = true;
    worker.postMessage(Object.assign({
      type: "write",
      id: state.job,
      temperature: chosen.temperature,
      topK: TOP_K,
      seed: newSeed(),
      maxTokens: chosen.maxTokens,
    }, request));
    $("tale").hidden = false;
    renderButtons();
  }

  function writeFromText(text) {
    let prompt = String(text || "").replace(/\s+$/, "").slice(0, 400);
    if (!prompt) {
      const pick = STARTERS[Math.floor(Math.random() * STARTERS.length)];
      prompt = pick.text;
      $("prompt-box").value = prompt;
      markStarter();
    }
    state.items = [];
    state.expectPrimed = true;
    renderTale();
    send({ text: prompt });
    $("tale").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function writeFromItems(maxTokens) {
    state.expectPrimed = false;
    renderTale();
    send(Object.assign({ tokens: state.items.map((item) => item.token) }, maxTokens ? { maxTokens: maxTokens } : {}));
  }

  function showSpeed(tokensPerSecond, written) {
    const generated = state.items.filter((item) => !item.given).slice(-written);
    const words = countWords(generated.map((item) => item.text).join(""));
    const elapsed = written / Math.max(0.001, tokensPerSecond);
    state.wordsPerSecond = words / Math.max(0.001, elapsed);
    root.dataset.sparkWordsPerSecond = state.wordsPerSecond.toFixed(1);
    $("tale-speed").textContent = fill(tr("spark.speed", "{n} words a second on this device"), { n: Math.round(state.wordsPerSecond) });
  }

  // ---- the tale ----
  function wordNode(index) {
    const item = state.items[index];
    const span = document.createElement("span");
    span.textContent = item.text;
    if (item.given) {
      span.className = "given";
      span.hidden = !!item.hidden;
      return span;
    }
    span.className = "w" + (item.chosen ? " chosen" : "") + (item.p < UNSURE_BELOW ? " unsure" : "");
    span.dataset.index = String(index);
    if (item.p < UNSURE_BELOW || item.chosen) {
      span.tabIndex = 0;
      span.setAttribute("role", "button");
    }
    return span;
  }
  function caretNode() {
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.setAttribute("aria-hidden", "true");
    return caret;
  }
  function removeCaret() {
    const caret = $("tale-text").querySelector(".caret");
    if (caret) caret.remove();
  }
  function renderTale() {
    const box = $("tale-text");
    box.textContent = "";
    state.items.forEach((item, index) => box.appendChild(wordNode(index)));
    box.appendChild(caretNode());
  }
  function appendWord(index) {
    const box = $("tale-text");
    const caret = box.querySelector(".caret");
    box.insertBefore(wordNode(index), caret);
  }
  function taleText() {
    return state.items.filter((item) => !item.hidden).map((item) => item.text).join("").trim();
  }

  // ---- alternatives: what else the model considered for a word ----
  const pop = $("alt-pop");
  document.body.appendChild(pop); // positioned in page coordinates
  function shownWord(text) {
    const trimmed = text.replace(/^[ \t]+/, "");
    return trimmed.replace(/\n/g, "↵") || "␣";
  }
  function closeAlternatives() {
    if (state.openIndex < 0) return;
    const open = $("tale-text").querySelector(".w.open");
    if (open) open.classList.remove("open");
    state.openIndex = -1;
    pop.hidden = true;
  }
  function openAlternatives(span) {
    const index = Number(span.dataset.index);
    const item = state.items[index];
    if (!item) return;
    closeAlternatives();
    state.openIndex = index;
    span.classList.add("open");
    const list = $("alt-list");
    list.textContent = "";
    const row = (text, p, altIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "alt" + (altIndex < 0 ? " was" : "");
      const bar = document.createElement("i");
      bar.style.width = Math.max(1, Math.round(p * 100)) + "%";
      const word = document.createElement("span");
      word.textContent = shownWord(text);
      const odds = document.createElement("small");
      odds.textContent = percent(p) + (altIndex < 0 ? " · " + tr("spark.alt.written", "written") : "");
      button.append(bar, word, odds);
      if (altIndex < 0) button.disabled = true;
      else button.dataset.alt = String(altIndex);
      return button;
    };
    list.appendChild(row(item.text, item.p, -1));
    const alternatives = item.alternatives || [];
    alternatives.forEach((alternative, altIndex) => list.appendChild(row(alternative.text, alternative.p, altIndex)));
    if (!alternatives.length) {
      const none = document.createElement("p");
      none.className = "alt-none";
      none.textContent = tr("spark.alt.none", "The model saw no other word here.");
      list.appendChild(none);
    }
    pop.hidden = false;
    const box = span.getBoundingClientRect();
    const width = pop.offsetWidth;
    const left = Math.min(Math.max(12, box.left + box.width / 2 - width / 2), root.clientWidth - width - 12);
    let top = box.bottom + 8;
    if (top + pop.offsetHeight > window.innerHeight - 8 && box.top - pop.offsetHeight - 8 > 0) {
      top = box.top - pop.offsetHeight - 8;
    }
    pop.style.left = Math.round(left + window.scrollX) + "px";
    pop.style.top = Math.round(top + window.scrollY) + "px";
    const first = list.querySelector("[data-alt]");
    if (first) first.focus({ preventScroll: true });
  }
  function branch(altIndex) {
    const index = state.openIndex;
    const item = state.items[index];
    const pick = item && (item.alternatives || [])[altIndex];
    if (!pick) return;
    const others = [{ token: item.token, text: item.text, p: item.p }]
      .concat(item.alternatives.filter((alternative, position) => position !== altIndex))
      .sort((a, b) => b.p - a.p);
    const writtenBefore = state.items.slice(0, index).filter((entry) => !entry.given).length;
    state.items = state.items.slice(0, index);
    state.items.push({ token: pick.token, text: pick.text, given: false, p: pick.p, alternatives: others, chosen: true });
    if (state.writing) worker.postMessage({ type: "stop" });
    writeFromItems(Math.max(MIN_BRANCH_TOKENS, settings().maxTokens - writtenBefore - 1));
  }
  $("tale-text").addEventListener("click", (event) => {
    const span = event.target.closest(".w");
    if (!span) return;
    if (Number(span.dataset.index) === state.openIndex) closeAlternatives();
    else openAlternatives(span);
  });
  $("tale-text").addEventListener("keydown", (event) => {
    const span = event.target.closest(".w");
    if (!span || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    openAlternatives(span);
  });
  $("alt-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-alt]");
    if (button) branch(Number(button.dataset.alt));
  });
  document.addEventListener("click", (event) => {
    if (state.openIndex >= 0 && !event.target.closest("#alt-pop") && !event.target.closest(".w")) closeAlternatives();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || state.openIndex < 0) return;
    const span = $("tale-text").querySelector('.w[data-index="' + state.openIndex + '"]');
    closeAlternatives();
    if (span && span.tabIndex === 0) span.focus();
  });
  window.addEventListener("resize", closeAlternatives);

  // ---- controls ----
  function markStarter() {
    const value = $("prompt-box").value;
    $("starter-chips").querySelectorAll(".chip").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(STARTERS[Number(chip.dataset.starter)].text === value));
    });
  }
  function renderStarters() {
    $("starter-chips").innerHTML = STARTERS
      .map((starter, index) => `<button type="button" class="chip" data-starter="${index}" aria-pressed="false">${starter.icon} ${escapeHtml(tr("spark.starter." + index, starter.label))}</button>`)
      .join("");
    markStarter();
  }
  $("starter-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-starter]");
    if (!chip) return;
    $("prompt-box").value = STARTERS[Number(chip.dataset.starter)].text;
    markStarter();
    if (state.phase === "ready") writeFromText($("prompt-box").value);
  });
  $("prompt-box").addEventListener("input", markStarter);
  $("prompt-box").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (state.phase === "ready") writeFromText($("prompt-box").value);
    }
  });
  function renderCreativity() {
    const value = Number($("creativity").value);
    const mood = value === 0
      ? tr("spark.mood.safest", "Safest")
      : value <= 5
        ? tr("spark.mood.calm", "Calm")
        : value <= 9
          ? tr("spark.mood.balanced", "Balanced")
          : tr("spark.mood.wild", "Wild");
    $("creativity-value").textContent = mood;
  }
  $("creativity").addEventListener("input", renderCreativity);
  $("length-seg").addEventListener("click", (event) => {
    const button = event.target.closest("[data-length]");
    if (!button) return;
    $("length-seg").querySelectorAll("[data-length]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
  });
  $("write-btn").addEventListener("click", () => writeFromText($("prompt-box").value));
  $("stop-btn").addEventListener("click", () => {
    if (worker && state.writing) worker.postMessage({ type: "stop" });
  });
  $("again-btn").addEventListener("click", () => {
    state.items = state.items.filter((item) => item.given);
    if (!state.items.length) {
      writeFromText($("prompt-box").value);
      return;
    }
    writeFromItems(0);
  });
  $("more-btn").addEventListener("click", () => writeFromItems(0));

  // ---- tale actions ----
  $("copy-btn").addEventListener("click", async () => {
    const text = taleText();
    if (!text) return;
    toast((await copyText(text)) ? tr("spark.copied", "Tale copied") : tr("spark.copyFailed", "Couldn't copy the tale"));
  });
  const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  function stopSpeaking() {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    $("speak-btn").setAttribute("aria-pressed", "false");
  }
  if (!canSpeak) $("speak-btn").hidden = true;
  $("speak-btn").addEventListener("click", () => {
    if ($("speak-btn").getAttribute("aria-pressed") === "true") {
      stopSpeaking();
      return;
    }
    const text = taleText();
    if (!text) return;
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = "en-GB";
    speech.rate = 0.95;
    speech.onend = speech.onerror = () => $("speak-btn").setAttribute("aria-pressed", "false");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(speech);
    $("speak-btn").setAttribute("aria-pressed", "true");
  });
  window.addEventListener("pagehide", stopSpeaking);
  $("chat-btn").addEventListener("click", () => {
    const text = taleText();
    if (!text) return;
    const question = "Here is the start of a fairy tale written by GlowSpark, Glow's tiny on-device model. "
      + "Continue it in the same old-fashioned storybook voice, keep the characters consistent, and bring it to a satisfying ending in about 300 words.\n\n"
      + text;
    location.href = chatUrl(question);
  });

  // ---- the numbers: every figure comes from bench.json (written by the benchmark scripts) ----
  function statTile(value, label, live) {
    return `<div class="stat${live ? " live" : ""}"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`;
  }
  function liveTiles() {
    const ready = state.readyMs ? seconds(state.readyMs) + " s" : "…";
    const speed = state.wordsPerSecond ? String(Math.round(state.wordsPerSecond)) : "…";
    return statTile(ready, tr("spark.stat.ready", "from opening this page to ready, on this device"), true)
      + statTile(speed, tr("spark.stat.speed", "words a second, on this device"), true);
  }
  function renderLiveStats() {
    $("stats").querySelectorAll(".stat.live").forEach((tile) => tile.remove());
    $("stats").insertAdjacentHTML("beforeend", liveTiles());
  }
  function renderNumbers() {
    const bench = state.bench;
    if (!bench) {
      $("stats").innerHTML = liveTiles();
      return;
    }
    const tiles = [];
    if (bench.download) {
      tiles.push(statTile(megabytes(bench.download.total_bytes), tr("spark.stat.download", "to download: model, tokenizer and engine together")));
    }
    tiles.push(statTile((bench.parameters / 1e6).toFixed(1) + "M", tr("spark.stat.parameters", "parameters, all trained from random numbers")));
    tiles.push(statTile(String(bench.train.books), fill(tr("spark.stat.books", "public-domain books read ({size} of text)"), { size: megabytes(bench.train.bytes) })));
    if (bench.training && bench.training.minutes) {
      tiles.push(statTile(Math.round(bench.training.minutes) + " min", tr("spark.stat.training", "of training, on one laptop processor")));
    }
    tiles.push(statTile(bench.held_out.perplexity_per_token.toFixed(1), tr("spark.stat.perplexity", "perplexity on unseen books (lower is better)")));
    $("stats").innerHTML = tiles.join("") + liveTiles();

    const bits = bench.bits_per_byte || {};
    const rows = BAR_ORDER.filter((row) => typeof bits[row[0]] === "number");
    const highest = Math.max.apply(null, rows.map((row) => bits[row[0]]));
    const lowest = Math.min.apply(null, rows.map((row) => bits[row[0]]));
    $("bars").innerHTML = rows
      .map((row) => {
        const value = bits[row[0]];
        const classes = "bar" + (row[3] ? " us" : "") + (value === lowest ? " best" : "");
        const minutes = bench.baseline_training_minutes;
        const label = fill(tr(row[1], row[2]), typeof minutes === "number" ? { minutes: Math.round(minutes) } : {});
        return `<div class="${classes}" role="listitem"><span>${escapeHtml(label)}</span><i data-share="${(value / highest).toFixed(4)}"></i><b>${value.toFixed(3)}</b></div>`;
      })
      .join("");
    $("bars").querySelectorAll("i[data-share]").forEach((bar) => {
      bar.style.width = (Number(bar.dataset.share) * 100).toFixed(1) + "%";
    });
    $("bars-lede").textContent = fill(
      tr("spark.barsLede", "Bits needed per character to store {books} books ({size}) the model never read. Lower is better: the better you predict the next word, the fewer bits you need. The other rows are file compressors on the same text."),
      { books: bench.held_out.books, size: megabytes(bench.held_out.bytes) },
    );
    const browser = bench.browser;
    $("bench-note").textContent = browser
      ? fill(
        tr("spark.benchNote", "On the laptop that built it ({hardware}), with the files served from that same laptop so download time isn't counted: ready {cold} s after opening the page, then {speed} words a second. {note}"),
        { hardware: browser.hardware, cold: seconds(browser.cold_start_ms), speed: Math.round(browser.words_per_second), note: browser.note || "" },
      ).trim()
      : "";
    if (bench.download) {
      $("versus-download").textContent = fill(tr("spark.versusDownload", "One {size} download"), { size: megabytes(bench.download.total_bytes) });
    }
    if (bench.built) $("refs-date").textContent = bench.built;
    renderStatus();
  }
  function renderBooks() {
    const books = state.books;
    if (!books) return;
    const held = books.filter((book) => book.split === "val").length;
    $("books-count").textContent = fill(tr("spark.booksCount", "{read} read · {held} held out"), { read: books.length - held, held: held });
    const badge = escapeHtml(tr("spark.heldOut", "held out"));
    $("book-list").innerHTML = books
      .map((book) => {
        const authors = Array.isArray(book.authors) ? book.authors.join("; ") : String(book.authors || "");
        return `<li><a href="https://www.gutenberg.org/ebooks/${encodeURIComponent(book.id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(book.title)}</a>`
          + (authors ? ` <small>${escapeHtml(authors)}</small>` : "")
          + (book.split === "val" ? `<em>${badge}</em>` : "")
          + "</li>";
      })
      .join("");
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
        $("bars-lede").textContent = tr("spark.benchMissing", "The benchmark file couldn't load, so no figures are shown.");
      });
    loadJson("./books.json")
      .then((books) => {
        state.books = Array.isArray(books) ? books : [];
        renderBooks();
      })
      .catch(() => {
        $("books-count").textContent = "";
      });
  }

  // ---- self-test: this engine against the PyTorch reference ----
  function runSelftest() {
    if (state.phase !== "ready") return;
    if (state.writing) {
      state.writing = false;
      state.job += 1;
      removeCaret();
      renderButtons();
    }
    state.selftest = { running: true };
    renderSelftest();
    worker.postMessage({ type: "selftest" });
  }
  function renderSelftest() {
    const box = $("selftest-result");
    const result = state.selftest;
    box.className = "check-result";
    if (!result) {
      box.textContent = "";
      return;
    }
    if (result.running) {
      box.textContent = tr("spark.selftest.running", "Checking…");
      root.dataset.selftest = "running";
      return;
    }
    if (result.failed) {
      box.classList.add("fail");
      box.textContent = tr("spark.selftest.error", "The check couldn't run. Try again when you're online.");
      root.dataset.selftest = "fail";
      return;
    }
    const same = result.cases.filter((item) => item.tokensMatch && item.greedyMatch).length;
    const values = { same: same, total: result.cases.length, diff: result.maxAbsDiff.toExponential(1), tolerance: result.tolerance };
    box.classList.add(result.pass ? "pass" : "fail");
    box.textContent = result.pass
      ? fill(tr("spark.selftest.pass", "✓ Match. On {same} of {total} test openings this engine picks the same words as the PyTorch reference, and its scores differ by at most {diff} (limit {tolerance})."), values)
      : fill(tr("spark.selftest.fail", "✕ Mismatch: {same} of {total} test openings agree, largest score difference {diff} (limit {tolerance}). Please tell us."), values);
    root.dataset.selftest = result.pass ? "pass" : "fail";
    root.dataset.selftestDiff = String(result.maxAbsDiff);
  }
  $("selftest-btn").addEventListener("click", runSelftest);

  // ---- start ----
  function renderLocalised() {
    renderStarters();
    renderCreativity();
    renderStatus();
    renderNumbers();
    renderBooks();
    renderSelftest();
  }
  if (window.GlowLocale) {
    window.GlowLocale.apply();
    window.GlowLocale.onChange(() => {
      window.GlowLocale.apply();
      renderLocalised();
    });
  }
  renderLocalised();
  // Glow home's "Tiny AI" choice opens GlowSpark with what you typed as the first words (?q=).
  const query = new URLSearchParams(location.search);
  const startPrompt = query.get("q");
  if (startPrompt) {
    state.pendingPrompt = startPrompt.slice(0, 400);
    $("prompt-box").value = state.pendingPrompt;
    markStarter();
  }
  state.wantSelftest = query.get("selftest") === "1";
  if (startPrompt) history.replaceState(null, "", location.pathname + (state.wantSelftest ? "?selftest=1" : "") + location.hash);
  // Offline: Glow home's service worker caches what it sees. On a first visit straight to this page it
  // takes control only after everything has loaded, so fetch the files once more for it to keep.
  const OFFLINE_FILES = ["./", "./spark.css", "./spark.js", "./engine.js", "./worker.js", "./spark.json", "./spark.bin", "./bench.json", "./books.json", "./parity.json"];
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
  startWorker();
  loadNumbers();
})();
