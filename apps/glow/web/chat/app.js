// Glow: free, browser-only AI chat where models deliberate to consensus.
// Modes: Chat · Council (2–3 agents + Judge) · Arena (side-by-side model vote).
// No Glow backend: chats live in local storage. Optional sign-in uses Puter (puter.com), whose
// User-Pays model runs AI on each visitor's own free Puter allowance and can sync chats to their account.
// Prompts and credentials are sent only to the provider the visitor chooses.
"use strict";

const $ = (id) => document.getElementById(id);
const TEST_HASHES = ["#selftest", "#demo", "#demo-council", "#demo-arena"];
const TEST_MODE = TEST_HASHES.includes(location.hash);
// Demos and self-tests use their own sandbox so they never touch a visitor's saved chats or keys.
// Keep the original production storage key so the rename preserves chats, keys and votes.
// GitHub Pages paths share the same origin; no copying or deletion is necessary.
const STORE_KEY = TEST_MODE ? "glow.sandbox" : "mufakat.v1";
const MAX_CONTEXT_CHARS = 24000;
const MAX_RETRIES = 3;
const OPENROUTER_URL = "https://openrouter.ai/api/v1";
// Free AI for guests with no key or sign-up: Pollinations' anonymous tier (shared and rate-limited).
const FREE_AI_URL = "https://text.pollinations.ai/openai";
const FREE_MODEL = { value: "free::openai-fast", label: "Glow Free: GPT-OSS 20B (no sign-in needed)", short: "Glow Free", group: "Free: works right away" };
const SYSTEM_PROMPT = "You are a helpful, accurate and thoughtful assistant. Format answers with Markdown.";
const MAX_ATTACHMENT_CHARS = 100000;
const PERSONAS = {
  default: { icon: "✨", name: "Default", prompt: SYSTEM_PROMPT },
  planner: { icon: "🗺", name: "Planner", prompt: "You are a practical planner. Turn the user's idea or goal into a clear, doable plan. Start with a one-line **Goal**. Then list the steps as Markdown task lists using '- [ ]' checkboxes, grouped under short milestone headings; each task must be concrete and small, with a rough time estimate in brackets. Finish with '**Do this first:**' and the single next action. Use Markdown." },
  tutor: { icon: "🎓", name: "Tutor", prompt: "You are a patient tutor. Explain step by step in simple words with one concrete everyday example, then ask one short question to check understanding. Use Markdown." },
  coder: { icon: "💻", name: "Coder", prompt: "You are a senior software engineer. Give correct, complete, runnable code in fenced code blocks with language tags, then a short explanation of how it works and how to run it. Point out edge cases. Use Markdown." },
  writer: { icon: "✍", name: "Writer", prompt: "You are a skilled editor and writer. Improve clarity, flow and tone while keeping the author's meaning. When the user gives text, return the improved version first, then 2-3 bullet notes on what you changed. Use Markdown." },
  critic: { icon: "🔍", name: "Critic", prompt: "You are a constructive critic and risk analyst. Find the weaknesses, hidden assumptions, risks and counter-arguments in the user's idea, ranked by importance, and suggest a fix for each. Be direct but fair. Use Markdown." },
  translator: { icon: "🌐", name: "Translator", prompt: "You are a professional translator. Detect the language of the user's text. If it is Indonesian, translate it into natural English; otherwise translate it into natural Indonesian, unless the user names another target language. Keep the meaning, tone and formatting. Reply with the translation, then one short note about any tricky phrase." },
};
const FOLLOW_UP_INSTRUCTION = "\n\nAfter your answer, add a final section exactly in this form:\nFollow-ups:\n- <short question>\n- <short question>\nwith 2 or 3 natural next questions the user might ask. Write the follow-ups in exactly the same language as the user's last message (for example English if they wrote English, Indonesian if they wrote Indonesian). Keep the heading \"Follow-ups:\" in English.";
const FOLLOW_UPS = /\n+[*_]{0,2}Follow[- ]?ups?[*_]{0,2}:?[*_]{0,2}:?[ \t]*\n((?:[ \t]*(?:[-*•]|\d+[.)])[ \t]+.+(?:\n|$)){1,4})\s*$/i;
const IMPROVE_PROMPT = "You rewrite prompts so an AI assistant can answer them well. Keep the user's language, intent and every detail they gave. Make it specific: state the goal, the context worth including, the desired format and length, and any constraints. If key information is missing, add short [placeholders] for the user to fill in. Reply with the improved prompt only: no preamble, no quotes.";
const FUSE_PROMPT = "You are an expert editor. You receive several AI answers to the same question. Merge them into ONE answer that is better than each of them: keep the correct, useful and specific parts, fix mistakes, remove repetition, resolve disagreements by choosing what is best supported (briefly note any real disagreement), and keep a clear structure. Do not refer to 'Answer A/B' unless it genuinely helps. Use Markdown.";
const MAX_SHARE_CHARS = 60000;
const AGENT_COLORS = ["a", "b", "c"];
const PUTER_SDK_URL = "https://js.puter.com/v2/";
// Curated Glow AI models served through Puter, best general picks first. Retired ids are
// filtered out against Puter's live catalogue when it is reachable.
const PUTER_MODELS = [
  ["gpt-5-mini", "GPT-5 mini"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"],
  ["deepseek-flash", "DeepSeek V4.1 Flash"],
  ["gpt-5-nano", "GPT-5 nano (fastest, lightest)"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite (light)"],
  ["grok-4-1-fast-non-reasoning", "Grok 4.1 Fast"],
  ["gpt-4o-mini", "GPT-4o mini"],
  ["claude-sonnet-4-6", "Claude Sonnet 4.6 (premium, uses more allowance)"],
];
const CLOUD_PREFIX = "glow.sync.";
const CLOUD_CHUNK_CHARS = 120000; // ≤ 360 KB per value even for 3-byte UTF-8 text (Puter limit 400 KB)
const CLOUD_MAX_PARTS = 40;
const CLOUD_PUSH_DELAY_MS = 4000;

const state = loadState();
let models = [];
let current = null;
let pendingFiles = [];
const controllers = new Set();
let councilRunning = false;
let puterSignedIn = false;
let puterCatalogue = null;
let puterCatalogueList = null;
let puterPromise = null;
let cloudTimer = null;
let lastCloudPayload = "";
let cloudBusy = false;

/* ================= persistence ================= */
function loadState() {
  const defaults = {
    settings: {
      openrouterKey: "",
      showPaid: false,
      ollamaUrl: "http://localhost:11434",
      customUrl: "",
      customKey: "",
      lastModel: "demo::demo",
      theme: "system",
      account: "",
      accountName: "",
      cloudSync: true,
      tourDone: false,
      customInstructions: "",
      followUps: true,
      favoriteModels: [],
      allPuterModels: false,
    },
    conversations: [],
    arenaStats: {},
    deleted: {},
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved) {
      return {
        settings: { ...defaults.settings, ...saved.settings },
        conversations: saved.conversations || [],
        arenaStats: saved.arenaStats || {},
        deleted: saved.deleted || {},
      };
    }
  } catch (error) {
    console.warn("Could not read saved data", error);
  }
  return defaults;
}
function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Could not save", error);
  }
  scheduleCloudPush();
}

/* ================= markdown (escaped, safe) ================= */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function inlineMarkdown(text) {
  // Input is already HTML-escaped. Protect code spans and links before applying emphasis.
  const held = [];
  const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;
  let out = text.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${code}</code>`));
  out = out.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, label, url) =>
    hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  out = out.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+[^\s<).,;:!?'"])/g, (_, lead, url) =>
    lead + hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  out = out
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
}
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => inlineMarkdown(cell.trim()));
}
function renderList(lines) {
  const stack = [];
  let html = "";
  for (const raw of lines) {
    const match = raw.match(LIST_ITEM);
    if (!match) {
      html += "<br>" + inlineMarkdown(raw.trim());
      continue;
    }
    const indent = match[1].replace(/\t/g, "    ").length;
    const ordered = /\d/.test(match[2]);
    const task = match[3].match(/^\[( |x|X)\]\s+(.*)$/);
    const liOpen = task ? '<li class="task">' : "<li>";
    const body = task
      ? `<input type="checkbox" class="task-box" disabled${task[1].trim() ? " checked" : ""}> <span>${inlineMarkdown(task[2])}</span>`
      : inlineMarkdown(match[3]);
    const top = stack[stack.length - 1];
    if (!top || indent > top.indent + 1) {
      const start = ordered ? parseInt(match[2], 10) : 1;
      stack.push({ indent, ordered });
      html += (ordered ? `<ol${start > 1 ? ` start="${start}"` : ""}>` : "<ul>") + liOpen;
    } else {
      while (stack.length > 1 && indent < stack[stack.length - 1].indent - 1) {
        html += `</li></${stack.pop().ordered ? "ol" : "ul"}>`;
      }
      html += "</li>" + liOpen;
    }
    html += body;
  }
  while (stack.length) html += `</li></${stack.pop().ordered ? "ol" : "ul"}>`;
  return html;
}
function renderBlocks(text) {
  const lines = text.split("\n");
  let html = "";
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) html += `<p>${inlineMarkdown(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`;
    paragraph = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let match;
    if (!line.trim()) {
      flush();
      i++;
    } else if ((match = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      flush();
      const level = Math.min(match[1].length + 2, 6);
      html += `<h${level}>${inlineMarkdown(match[2])}</h${level}>`;
      i++;
    } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      html += "<hr>";
      i++;
    } else if (/^\s*&gt;\s?/.test(line)) {
      flush();
      const quote = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*&gt;\s?/, ""));
      html += `<blockquote>${renderBlocks(quote.join("\n"))}</blockquote>`;
    } else if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      flush();
      const head = tableCells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(tableCells(lines[i++]));
      html += `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>`
        + rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") + "</tbody></table></div>";
    } else if (LIST_ITEM.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && (LIST_ITEM.test(lines[i]) || (items.length && /^\s{2,}\S/.test(lines[i])))) items.push(lines[i++]);
      html += renderList(items);
    } else {
      paragraph.push(line);
      i++;
    }
  }
  flush();
  return html;
}
function renderMarkdown(source) {
  let html = "";
  String(source).split(/```/).forEach((part, index) => {
    if (index % 2 === 1) {
      const lang = (part.match(/^([\w+#.-]*)\n/) || [, ""])[1];
      const code = part.replace(/^[\w+#.-]*\n/, "");
      html += `<pre${lang ? ` data-lang="${escapeHtml(lang)}"` : ""}><button class="copy-btn" type="button">Copy</button><code>${escapeHtml(code)}</code></pre>`;
      return;
    }
    html += renderBlocks(escapeHtml(part));
  });
  return html;
}
function stripThinking(text) {
  return String(text).replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
}
function renderReply(text) {
  const match = text.match(/^<think>([\s\S]*?)(<\/think>|$)/);
  if (!match) return renderMarkdown(text);
  const finished = match[2] === "</think>";
  return `<details class="thinking" ${finished ? "" : "open"}><summary>${finished ? "Reasoning" : "Thinking…"}</summary>${escapeHtml(match[1].trim())}</details>`
    + renderMarkdown(text.slice(match[0].length));
}

/* ================= providers ================= */
function splitModel(value) {
  const index = (value || "").indexOf("::");
  return { provider: value.slice(0, index), model: value.slice(index + 2) };
}
function modelLabel(value) {
  const found = models.find((m) => m.value === value);
  if (found) return found.short;
  return splitModel(value).model.split("/").pop();
}
function providerConfig(provider) {
  const s = state.settings;
  if (provider === "openrouter") return { base: OPENROUTER_URL, key: s.openrouterKey };
  if (provider === "free") return { base: FREE_AI_URL, key: "" };
  if (provider === "ollama") return { base: s.ollamaUrl.replace(/\/$/, "") + "/v1", key: "" };
  if (provider === "custom") return { base: s.customUrl.replace(/\/$/, ""), key: s.customKey };
  return null;
}
async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

async function loadModels() {
  const s = state.settings;
  const list = [{ value: "demo::demo", label: "Demo agent (offline, canned replies)", short: "Demo", group: "Demo: no setup" }];
  if (puterSignedIn) list.push(...(await puterModelOptions()));
  if (TEST_MODE) {
    models = list;
    $("status").textContent = puterSignedIn ? "Glow AI (test double)" : "Demo mode — no provider connected";
    $("banner-text").textContent = "This is a sandboxed demo. Your own chats and keys are untouched.";
    $("banner-settings").textContent = "Open Glow";
    $("banner-signin").classList.add("hidden");
    $("setup-banner").classList.toggle("hidden", models.length > 1);
    upgradeFromDemo();
    refreshModelSelects();
    return;
  }
  list.push(FREE_MODEL);
  const status = puterSignedIn ? [`Glow AI · ${list.length - 2} models`] : ["Free AI ready"];
  const jobs = [];

  if (s.openrouterKey) {
    jobs.push(fetchJson(`${OPENROUTER_URL}/models`).then((data) => {
      const entries = data.data
        .map((m) => {
          const prompt = Number((m.pricing || {}).prompt || 0);
          const completion = Number((m.pricing || {}).completion || 0);
          return { id: m.id, name: m.name || m.id, free: m.id.endsWith(":free") || (prompt === 0 && completion === 0), price: completion * 1e6 };
        })
        .filter((m) => m.free || (s.showPaid && m.price >= 0))
        .sort((a, b) => (a.free === b.free ? a.name.localeCompare(b.name) : a.free ? -1 : 1));
      for (const m of entries) {
        list.push({
          value: `openrouter::${m.id}`,
          label: m.free ? m.name : `${m.name} ($${m.price.toFixed(2)}/M out)`,
          short: m.name.replace(/\s*\(free\)\s*/i, ""),
          group: m.free ? "OpenRouter: free models" : "OpenRouter: paid (uses your credit)",
        });
      }
      status.push(`${entries.filter((m) => m.free).length} free models`);
    }).catch(() => status.push("OpenRouter unreachable")));
  }

  jobs.push(fetchJson(`${s.ollamaUrl.replace(/\/$/, "")}/api/tags`).then((data) => {
    for (const m of data.models || []) {
      list.push({ value: `ollama::${m.name}`, label: `${m.name} (local)`, short: m.name, group: "Ollama on this computer" });
    }
    if ((data.models || []).length) status.push(`${data.models.length} local`);
  }).catch(() => {}));

  if (s.customUrl) {
    const config = providerConfig("custom");
    jobs.push(fetchJson(`${config.base}/models`, config.key ? { Authorization: `Bearer ${config.key}` } : {}).then((data) => {
      for (const m of data.data || []) {
        list.push({ value: `custom::${m.id}`, label: m.id, short: m.id, group: "Custom API" });
      }
    }).catch(() => status.push("Custom API unreachable")));
  }

  await Promise.all(jobs);
  models = list;
  $("status").textContent = status.length ? status.join(" · ") : "Demo mode";
  $("setup-banner").classList.toggle("hidden", models.length > 1);
  upgradeFromDemo();
  refreshModelSelects();
}
// When real models become available, stop defaulting new or empty chats to the demo bot.
function upgradeFromDemo() {
  if (models.length < 2) return;
  if (!models.some((m) => m.value === state.settings.lastModel) || state.settings.lastModel === "demo::demo") {
    state.settings.lastModel = defaultModel();
  }
  if (current && current.type === "chat" && !current.messages.length && !models.some((m) => m.value === current.model && m.value !== "demo::demo")) {
    current.model = state.settings.lastModel;
  }
}
const PREFERRED_MODEL_PATTERNS = [/llama-3\.3-70b/i, /deepseek-(chat|v3|r1)/i, /gemini/i, /qwen.*(72b|235b|32b)/i, /mistral-(small|medium|large)/i, /gpt-oss/i, /llama/i, /qwen/i];
function modelRank(value) {
  if (value.startsWith("puter::")) return -1 + PUTER_MODELS.findIndex(([id]) => `puter::${id}` === value) / 100;
  if (value.startsWith("ollama::")) return 0; // local models the user chose to install come first
  if (value.startsWith("free::")) return PREFERRED_MODEL_PATTERNS.length + 0.5; // after strong models from the user's own keys
  const index = PREFERRED_MODEL_PATTERNS.findIndex((pattern) => pattern.test(value));
  return index === -1 ? PREFERRED_MODEL_PATTERNS.length + 1 : index + 1;
}
function defaultModel(offset = 0) {
  const real = models.slice(1).slice().sort((a, b) => modelRank(a.value) - modelRank(b.value));
  if (!real.length) return models[0].value;
  return real[offset % real.length].value;
}
function fillSelect(select, selected) {
  select.innerHTML = "";
  const groups = {};
  for (const option of models) {
    if (!groups[option.group]) {
      groups[option.group] = document.createElement("optgroup");
      groups[option.group].label = option.group;
      select.appendChild(groups[option.group]);
    }
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    groups[option.group].appendChild(el);
  }
  select.value = models.some((m) => m.value === selected) ? selected : defaultModel();
  if (select.id === "chat-model") updatePickerLabel();
}
function refreshModelSelects() {
  fillSelect($("chat-model"), (current && current.model) || state.settings.lastModel);
  document.querySelectorAll("select[data-model-select]").forEach((select) => fillSelect(select, select.dataset.value));
}

/* ================= streaming ================= */
function trimHistory(messages, maxChars = MAX_CONTEXT_CHARS) {
  const kept = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    total += messages[i].content.length;
    if (total > maxChars && kept.length) break;
    kept.unshift(messages[i]);
  }
  return kept;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
async function fetchWithRetry(doFetch, signal, onWait = () => {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await doFetch();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) return response;
    const header = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(header) && header > 0 ? Math.min(header, 30) * 1000 : 2000 * 2 ** attempt;
    onWait(Math.round(waitMs / 1000), attempt + 1);
    await sleep(waitMs, signal);
  }
}
async function streamReply(modelValue, system, messages, onText) {
  const { provider, model } = splitModel(modelValue);
  const clean = trimHistory(messages.map((m) => ({ role: m.role, content: stripThinking(m.content) })));
  const controller = new AbortController();
  controllers.add(controller);
  try {
    if (provider === "demo") return await streamDemo(system, clean, onText, controller.signal);
    if (provider === "puter") return await streamPuter(model, system, clean, onText, controller.signal);
    const config = providerConfig(provider);
    const headers = { "Content-Type": "application/json" };
    if (config.key) headers.Authorization = `Bearer ${config.key}`;
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = location.origin;
      headers["X-Title"] = "Glow";
    }
    const body = JSON.stringify({ model, stream: true, messages: [{ role: "system", content: system }, ...mergeRoles(clean)] });
    let waiting = false;
    let response;
    try {
      response = await fetchWithRetry(
        () => fetch(`${config.base}/chat/completions`, { method: "POST", headers, signal: controller.signal, body }),
        controller.signal,
        (seconds, attempt) => {
          if (!waiting) {
            waiting = true;
            rateNotice.waiting += 1;
          }
          showRateWait(provider, seconds, attempt);
        },
      );
    } finally {
      if (waiting) rateNotice.waiting -= 1;
    }
    if (response.status === 429) {
      showRateLimited(provider);
    } else if (waiting) {
      settleRateNotice();
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(friendlyError(response.status, detail, provider));
    }
    try {
      return await readSse(response, onText);
    } catch (error) {
      if (error.name !== "AbortError" && RATE_LIMIT_TEXT.test(error.message || "")) {
        showRateLimited(provider);
        throw new Error(friendlyError(429, error.message, provider));
      }
      throw error;
    }
  } finally {
    controllers.delete(controller);
  }
}

/* ================= visible rate-limit notice ================= */
const RATE_LIMIT_TEXT = /rate.?limit|too many requests|queue (is )?full|throttl|slow down/i;
const rateNotice = { waiting: 0, timer: null, failed: false };
function rateLabel(provider) {
  return provider === "free" ? "Glow Free (shared free AI)" : "The AI provider";
}
function showRateWait(provider, seconds, attempt) {
  clearInterval(rateNotice.timer);
  rateNotice.failed = false;
  let remaining = Math.max(1, seconds);
  const paint = () => {
    $("rate-text").textContent = `${rateLabel(provider)} is busy right now, so your reply is waiting in line. Retrying in ${remaining}s (try ${attempt} of ${MAX_RETRIES})…`;
  };
  paint();
  openRateNotice(provider, "waiting");
  rateNotice.timer = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    paint();
  }, 1000);
  $("status").textContent = `Rate limited, retrying in ${seconds}s (${attempt}/${MAX_RETRIES})…`;
}
function showRateLimited(provider) {
  clearInterval(rateNotice.timer);
  rateNotice.failed = true;
  $("rate-text").textContent = provider === "free"
    ? "Glow Free is still too busy after several tries (it's shared by everyone and rate-limited). Wait about a minute, then press ↻ Regenerate or send again. Signing in gives you faster Glow AI models."
    : "The AI provider is still rate-limiting requests. Wait a moment and try again, or pick another model.";
  openRateNotice(provider, "failed");
  $("status").textContent = "Rate limited";
}
function openRateNotice(provider, mode) {
  const box = $("rate-notice");
  box.classList.remove("hidden");
  box.classList.toggle("failed", mode === "failed");
  $("rate-signin").classList.toggle("hidden", provider !== "free" || puterSignedIn || TEST_MODE);
}
function settleRateNotice() {
  if (rateNotice.waiting > 0 || rateNotice.failed) return; // another reply is still waiting, or a failure needs reading
  closeRateNotice();
}
function closeRateNotice() {
  clearInterval(rateNotice.timer);
  rateNotice.failed = false;
  $("rate-notice").classList.add("hidden");
  if (/^Rate limited/.test($("status").textContent)) $("status").textContent = "";
}
async function readSse(response, onText) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let thinking = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.error) throw new Error(event.error.message || "Model error");
      const delta = ((event.choices || [])[0] || {}).delta || {};
      const reasoning = delta.reasoning || delta.reasoning_content;
      if (reasoning) {
        if (!thinking) {
          full += "<think>";
          thinking = true;
        }
        full += reasoning;
      }
      if (delta.content) {
        if (thinking) {
          full += "</think>\n\n";
          thinking = false;
        }
        full += delta.content;
      }
      onText(full);
    }
  }
  if (thinking) full += "</think>";
  return full;
}
function mergeRoles(messages) {
  const merged = [];
  for (const m of messages) {
    if (merged.length && merged[merged.length - 1].role === m.role) {
      merged[merged.length - 1].content += "\n\n" + m.content;
    } else {
      merged.push({ ...m });
    }
  }
  if (merged.length && merged[0].role !== "user") merged.unshift({ role: "user", content: "(begin)" });
  return merged;
}
function withInstructions(prompt) {
  const extra = (state.settings.customInstructions || "").trim();
  return extra ? `${prompt}\n\nAbout the user and how to answer (follow unless the user asks otherwise):\n${extra.slice(0, 1500)}` : prompt;
}
function systemPromptFor(conv) {
  const personaKey = PERSONAS[conv.persona] ? conv.persona : "default";
  let prompt = withInstructions(PERSONAS[personaKey].prompt);
  if (conv.type === "chat" && state.settings.followUps && personaKey !== "translator") prompt += FOLLOW_UP_INSTRUCTION;
  return prompt;
}
function splitFollowUps(text) {
  const source = String(text || "");
  const match = source.match(FOLLOW_UPS);
  if (!match) return { body: source, questions: [] };
  const questions = match[1].split("\n")
    .map((line) => line.replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]+/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean)
    .slice(0, 3);
  return { body: source.slice(0, match.index).trimEnd(), questions };
}
function friendlyError(status, detail, provider = "") {
  if (provider === "free") {
    if (status === 429 || status >= 500) return "The free guest AI is busy right now. Wait a few seconds and press ↻ Regenerate, or sign in for faster Glow AI models.";
    return `The free guest AI couldn't answer (error ${status}). Try again, or sign in for Glow AI models.`;
  }
  if (status === 401) return "The API key was rejected. Check it in Settings.";
  if (status === 402) return "This model needs credit on your account. Pick a free model.";
  if (status === 429) return "Rate limited by the provider. Wait a moment or pick another free model.";
  return `Provider error ${status}. ${detail.slice(0, 160)}`;
}

/* ================= demo agent (offline) ================= */
function demoText(system, messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const prompt = lastUser ? lastUser.content.replace(/^[^:\n]{1,40}:\s*/, "") : "";
  if (system.includes("impartial judge")) {
    return "## Verdict\n**Final answer:** Define the goal, score three options on cost, time and risk, build the winner, then test it against the goal.\n\n**Agreed:** the plan needs measurable criteria and a final check.\n\n**Still open:** none.\n\n**Confidence:** high (demo).";
  }
  if (system.includes("You rewrite prompts")) {
    return `Goal: ${prompt}\nContext: [who it is for, budget, deadline]\nFormat: a numbered step-by-step answer with a one-line summary first\nLength: under 300 words`;
  }
  if (system.includes("Merge them into ONE answer")) {
    return "## Fused answer (demo)\nThe strongest points from every answer, combined: lead with the **short direct answer**, add the **structured detail** where it helps, and finish with **one concrete example**.";
  }
  if (system.includes("practical planner")) {
    return `**Goal:** ${prompt.slice(0, 80)}\n\n### Get ready\n- [ ] Write down what “done” looks like (15 min)\n- [ ] List what you already have (15 min)\n\n### Do it\n- [ ] Pick the simplest first version (30 min)\n- [ ] Build it and test it with one person (2 h)\n\n**Do this first:** write the one-sentence goal.`;
  }
  if (system.includes("second-opinion reviewer")) {
    return "*(Second opinion, demo)* The answer is reasonable, but it skips **how to verify** the result. Add one concrete check before trusting it.";
  }
  const council = system.match(/You are "([^"]+)" in a (\d)-agent council/);
  if (council) {
    const name = council[1];
    const task = (system.match(/"""([\s\S]*?)"""/) || [, "the task"])[1].trim().slice(0, 120);
    const step = Math.max(0, messages.length - 1);
    const scripts = [
      `Here's a first draft for **${task}**:\n\n1. Define the goal in one sentence\n2. List three concrete options\n3. Pick the simplest one that works\n\nWhat would you change?`,
      `Good start. Two issues:\n- Step 2 needs criteria for comparing the options\n- There's no check that the result actually works`,
      `Agreed with both points. Revised plan:\n1. One-sentence goal\n2. Three options, scored on cost, time and risk\n3. Build the winner\n4. Test it against the goal`,
      `That covers it. The plan is clear, comparable and verifiable. CONSENSUS`,
    ];
    return `*(${name}, demo)* ` + scripts[Math.min(step, scripts.length - 1)];
  }
  if (system.includes("[arena:")) {
    const slot = system.match(/\[arena:(\d)\]/)[1];
    return `*(Demo answer ${"ABC"[slot]})* ${["Short and direct", "Detailed and structured", "Example-driven"][slot]} take on: *${prompt.slice(0, 120)}*`;
  }
  return `**Demo mode:** no AI model is connected, so this is a canned reply.\n\nYou wrote: *${prompt.slice(0, 200)}*\n\nFor real answers at no cost, pick **Glow Free** in the model menu at the top (works right away), or click **Sign in** in the sidebar for more Glow AI models.${system.includes("Follow-ups:") ? "\n\nFollow-ups:\n- How do I pick a real AI model?\n- What does the Council do?" : ""}`;
}
function streamDemo(system, messages, onText, signal) {
  const text = demoText(system, messages);
  return new Promise((resolve, reject) => {
    let index = 0;
    const tick = () => {
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      index = Math.min(text.length, index + 6);
      onText(text.slice(0, index));
      if (index >= text.length) resolve(text);
      else setTimeout(tick, 16);
    };
    tick();
  });
}

/* ================= conversations ================= */
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function persist(conv) {
  conv.updated = Date.now();
  if (!state.conversations.includes(conv)) state.conversations.unshift(conv);
  saveState();
  renderHistory();
}
const MODE_ICONS = { chat: "", council: "⚖ ", arena: "⚔ " };
function conversationText(conv) {
  const parts = [conv.title, conv.topic || ""];
  for (const m of conv.messages || []) parts.push(m.display || m.content);
  for (const r of Array.isArray(conv.rounds) ? conv.rounds : []) {
    parts.push(r.prompt);
    for (const reply of r.replies) parts.push(reply.content);
  }
  return parts.join(" ").toLowerCase();
}
function renderHistory() {
  const query = ($("search").value || "").trim().toLowerCase();
  const history = $("history");
  history.innerHTML = "";
  const ordered = [...state.conversations.filter((c) => c.pinned), ...state.conversations.filter((c) => !c.pinned)];
  for (const conv of ordered) {
    if (query && !conversationText(conv).includes(query)) continue;
    const item = document.createElement("div");
    item.className = "history-item" + (conv === current ? " active" : "") + (conv.pinned ? " pinned" : "");
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = (conv.pinned ? "📌 " : "") + (conv.source === "crewroom" ? "🏢 " : "") + (MODE_ICONS[conv.type] || "") + conv.title;
    title.title = "Double-click to rename";
    title.addEventListener("click", () => {
      stopAll();
      openConversation(conv);
      closeSidebar();
    });
    title.addEventListener("dblclick", () => {
      const name = prompt("Rename this chat", conv.title);
      if (name !== null) renameConversation(conv, name);
    });
    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.title = "Delete";
    del.textContent = "✕";
    del.addEventListener("click", () => {
      state.conversations = state.conversations.filter((c) => c !== conv);
      state.deleted[conv.id] = Date.now(); // so cloud sync doesn't bring it back
      saveState();
      if (current === conv) newChat();
      else renderHistory();
    });
    const pin = document.createElement("button");
    pin.className = "del pin";
    pin.type = "button";
    pin.title = conv.pinned ? "Unpin" : "Pin to top";
    pin.textContent = conv.pinned ? "📍" : "📌";
    pin.addEventListener("click", () => togglePin(conv));
    item.append(title, pin, del);
    history.appendChild(item);
  }
}
function togglePin(conv) {
  conv.pinned = !conv.pinned;
  saveState();
  renderHistory();
  toast(conv.pinned ? "Pinned to the top" : "Unpinned");
}
function openConversation(conv) {
  current = conv;
  const labels = { chat: "Chat", council: "Council", arena: "Arena" };
  $("mode-label").textContent = labels[conv.type];
  $("model-picker").classList.toggle("hidden", conv.type !== "chat");
  closeModelMenu();
  if (conv.type === "chat") fillSelect($("chat-model"), conv.model);
  $("input").placeholder = {
    chat: "Message Glow…",
    council: conv.started ? "Interject in the council (optional)…" : "Set up the council above…",
    arena: conv.started ? "Ask all models the same thing…" : "Pick models above, then ask…",
  }[conv.type];
  $("council-controls").classList.toggle("hidden", !(conv.type === "council" && conv.started));
  $("attach-btn").classList.toggle("hidden", conv.type === "council" && !conv.started);
  if (conv.type === "council" && !conv.started) renderCouncilSetup(conv);
  else if (conv.type === "arena" && !conv.started) renderArenaSetup(conv);
  else renderConversation(true);
  renderHistory();
  syncComposerTools();
}
function renderConversation(force = false) {
  if (current.type === "arena") renderArena();
  else renderMessages(force);
}

/* ================= message rendering ================= */
function messageElement(who, cssClass, meta) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${cssClass}`;
  const label = document.createElement("div");
  label.className = "who";
  label.textContent = who;
  if (meta) {
    const small = document.createElement("span");
    small.className = "meta";
    small.textContent = meta;
    label.appendChild(small);
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  wrap.append(label, bubble);
  $("messages").appendChild(wrap);
  return bubble;
}
function renderUserBubble(message) {
  const bubble = messageElement("You", "user");
  bubble.textContent = message.display || message.content;
  for (const name of message.files || []) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = "📄 " + name;
    bubble.appendChild(chip);
  }
  return bubble;
}
function agentDisplay(conv, message) {
  if (message.agent === "judge") return { name: "Judge", css: "judge", meta: modelLabel(conv.judge.model) };
  if (message.agent === "critic") return { name: "Second opinion", css: "critic", meta: modelLabel(message.model) };
  if (typeof message.agent === "number") {
    const agent = conv.agents[message.agent];
    return { name: agent.name, css: `agent-${AGENT_COLORS[message.agent]}`, meta: modelLabel(agent.model) };
  }
  if (message.source === "crewroom") return { name: "🏢 GlowRoom", css: "assistant crewroom", meta: "AI crew" };
  return { name: "Glow", css: "assistant", meta: message.model ? modelLabel(message.model) : "" };
}
function renderMessages(force = false) {
  const box = $("messages");
  const keepBottom = force || nearBottom();
  const previousTop = box.scrollTop;
  box.innerHTML = "";
  if (current.type === "chat" && current.messages.length === 0) {
    const starters = STARTERS.map((s, i) => `<button class="starter" type="button" data-starter="${i}">
        <span class="starter-icon">${s.icon}</span><b>${escapeHtml(s.title)}</b><span>${escapeHtml(s.prompt)}</span></button>`).join("");
    box.innerHTML = `<div class="welcome"><div class="welcome-glow" aria-hidden="true"></div>
      <h2>From a spark to <span class="accent-text">something real.</span></h2>
      <p>Explore an idea, shape a plan, and get another perspective. Chat with a model, gather a <b>Council</b>, or compare answers in the <b>Arena</b>.</p>
      <div class="starters">${starters}</div>
      <div class="welcome-actions"><button class="secondary" type="button" data-start="council">⚖ Start a council</button>
      <button class="secondary" type="button" data-start="arena">⚔ Open the arena</button></div></div>`;
    return;
  }
  current.messages.forEach((m, index) => {
    if (m.role === "user") {
      renderUserBubble(m);
    } else {
      const who = agentDisplay(current, m);
      const bubble = messageElement(who.name, who.css, who.meta);
      bubble.innerHTML = renderReply(m.content);
      bindTasks(bubble, m);
      const header = bubble.parentElement.querySelector(".who");
      if ("speechSynthesis" in window) {
        const listen = document.createElement("button");
        listen.type = "button";
        listen.className = "msg-copy";
        listen.title = "Read this reply aloud";
        listen.textContent = "🔊 Listen";
        listen.dataset.speakIndex = String(index);
        header.appendChild(listen);
      }
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "msg-copy";
      copy.title = "Copy this reply";
      copy.textContent = "⧉ Copy";
      copy.dataset.copyIndex = String(index);
      header.appendChild(copy);
    }
    if (current.type === "chat" && index === current.messages.length - 1) {
      addChatActions();
      if (m.role === "assistant" && (m.followUps || []).length) addFollowUps(m.followUps);
    }
  });
  if (keepBottom) scrollDown(true);
  else box.scrollTop = previousTop;
  updateJumpButton();
}
function addFollowUps(questions) {
  const row = document.createElement("div");
  row.className = "followups";
  for (const question of questions) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "followup";
    chip.textContent = question;
    chip.dataset.followup = question;
    row.appendChild(chip);
  }
  $("messages").lastElementChild.appendChild(row);
}
function bindTasks(bubble, message) {
  const boxes = [...bubble.querySelectorAll("input.task-box")];
  if (!boxes.length) return;
  message.checks = message.checks || {};
  const progress = document.createElement("div");
  progress.className = "task-progress";
  bubble.prepend(progress);
  boxes.forEach((box, i) => {
    box.disabled = false;
    if (i in message.checks) box.checked = !!message.checks[i];
    box.dataset.taskIndex = String(i);
    box.addEventListener("change", () => {
      message.checks[i] = box.checked;
      persist(current);
      updateTaskProgress(bubble, boxes);
      if (boxes.every((b) => b.checked)) toast("🎉 Plan complete!");
    });
  });
  updateTaskProgress(bubble, boxes);
}
function updateTaskProgress(bubble, boxes) {
  const done = boxes.filter((b) => b.checked).length;
  boxes.forEach((b) => b.closest("li").classList.toggle("done", b.checked));
  const percent = Math.round((done / boxes.length) * 100);
  const progress = bubble.querySelector(".task-progress");
  progress.classList.toggle("complete", done === boxes.length);
  progress.innerHTML = `<span>✅ ${done} of ${boxes.length} done</span><span class="track"><span class="fill" style="width:${percent}%"></span></span>`;
}
function applyChecks(content, checks) {
  if (!checks || !Object.keys(checks).length) return content;
  let counter = 0;
  return String(content).split(/```/).map((part, index) => {
    if (index % 2 === 1) return part;
    return part.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/gm, (whole, lead, mark) => {
      const i = counter++;
      if (!(i in checks)) return whole;
      return `${lead}[${checks[i] ? "x" : " "}]`;
    });
  }).join("```");
}
function addChatActions() {
  const last = current.messages[current.messages.length - 1];
  if (!last) return;
  const bar = document.createElement("div");
  bar.className = "msg-actions";
  const actions = last.role === "assistant"
    ? [["Copy", copyLast], ["↻ Regenerate", regenerate], ["Second opinion", secondOpinion], ["🏢 Ask GlowRoom", askCrew], ["✎ Edit question", editLast]]
    : [["✎ Edit", editLast]];
  for (const [label, handler] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link-btn";
    button.textContent = label;
    button.addEventListener("click", handler);
    bar.appendChild(button);
  }
  $("messages").lastElementChild.appendChild(bar);
}
function showNotice(message) {
  messageElement("Notice", "notice").textContent = message;
  scrollDown();
}
function nearBottom() {
  const box = $("messages");
  return box.scrollHeight - box.scrollTop - box.clientHeight < 140;
}
function scrollDown(force = false) {
  const box = $("messages");
  if (force || nearBottom()) box.scrollTop = box.scrollHeight;
  updateJumpButton();
}
function updateJumpButton() {
  const box = $("messages");
  $("jump-btn").classList.toggle("hidden", nearBottom() || box.scrollHeight <= box.clientHeight + 10);
}
function setBusy(busy) {
  $("send-btn").disabled = busy;
  $("stop-btn").classList.toggle("hidden", !busy);
}
function errorText(error) {
  if (error instanceof TypeError) return "Couldn't reach the AI service. Check your internet connection and try again.";
  return error.message || "Network error. Is the provider reachable?";
}

/* ================= chat ================= */
function newChat(persona = "default") {
  current = { id: newId(), type: "chat", title: "New chat", messages: [], persona, model: $("chat-model").value || state.settings.lastModel };
  openConversation(current);
}
function takeAttachments(text) {
  if (!pendingFiles.length) return { content: text, display: text, files: [] };
  const blocks = pendingFiles.map((f) => `\n\n[Attached file: ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``).join("");
  const files = pendingFiles.map((f) => f.name);
  pendingFiles = [];
  renderPendingFiles();
  return { content: text + blocks, display: text, files };
}
async function streamAssistant(model, system, history, who, css, view = (text) => text) {
  const bubble = messageElement(who, css, modelLabel(model));
  bubble.classList.add("cursor");
  try {
    const reply = await streamReply(model, system, history, (full) => {
      bubble.innerHTML = renderReply(view(full));
      scrollDown();
    });
    bubble.classList.remove("cursor");
    return reply;
  } catch (error) {
    bubble.classList.remove("cursor");
    if (error.name === "AbortError") return bubble.textContent;
    bubble.parentElement.remove();
    showNotice(errorText(error));
    return "";
  }
}
async function sendChat(text) {
  current.model = $("chat-model").value;
  state.settings.lastModel = current.model;
  const message = { role: "user", ...takeAttachments(text) };
  if (current.messages.length === 0) current.title = text.slice(0, 40) || (message.files[0] || "Chat");
  current.messages.push(message);
  renderMessages(true);
  return replyToChat();
}
async function replyToChat() {
  setBusy(true);
  const reply = await streamAssistant(current.model, systemPromptFor(current), current.messages, "Glow", "assistant", (text) => splitFollowUps(text).body);
  if (reply) {
    const { body, questions } = splitFollowUps(reply);
    current.messages.push({ role: "assistant", content: body, model: current.model, followUps: questions });
  }
  persist(current);
  setBusy(false);
  if (reply) renderMessages(); // on failure keep the error notice on screen
  return reply;
}
function copyLast() {
  const last = current.messages[current.messages.length - 1];
  copyText(stripThinking(last.content));
}
function copyText(text, message = "Copied to clipboard") {
  const done = () => toast(message);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand("copy");
    done();
  } catch {
    toast("Couldn't copy. Select the text and copy it manually.");
  }
  area.remove();
}
let toastTimer = null;
function toast(message) {
  const box = $("toast");
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), 2200);
}
const STARTERS = [
  { icon: "💡", title: "Brainstorm", prompt: "Give me 10 fresh ideas for a weekend side project I could finish in two days." },
  { icon: "🗺", title: "Make a plan", prompt: "Turn this goal into a step-by-step plan with milestones: launch a small online shop in 30 days.", persona: "planner" },
  { icon: "🔍", title: "Get a review", prompt: "Act as a tough but fair reviewer. What are the biggest risks in starting a food delivery app in my city?" },
  { icon: "✍", title: "Explain simply", prompt: "Explain how large language models work, like I'm 12, with one everyday example." },
];
function useStarter(index) {
  const starter = STARTERS[index];
  if (!starter || !current || current.type !== "chat") return null;
  if (starter.persona) setPersona(starter.persona, false);
  $("input").value = starter.prompt;
  autoSize();
  return onSend();
}
function renameConversation(conv, name) {
  const title = String(name || "").trim().slice(0, 60);
  if (!title) return false;
  conv.title = title;
  persist(conv);
  toast("Chat renamed");
  return true;
}
function regenerate() {
  if ($("send-btn").disabled) return null;
  if (rateNotice.failed) closeRateNotice();
  while (current.messages.length && current.messages[current.messages.length - 1].role !== "user") current.messages.pop();
  current.model = $("chat-model").value;
  renderMessages();
  return replyToChat();
}
function editLast() {
  if ($("send-btn").disabled) return;
  let index = current.messages.length - 1;
  while (index >= 0 && current.messages[index].role !== "user") index--;
  if (index < 0) return;
  const message = current.messages[index];
  current.messages = current.messages.slice(0, index);
  $("input").value = message.display || message.content;
  autoSize();
  $("input").focus();
  persist(current);
  renderMessages();
}
async function secondOpinion() {
  if ($("send-btn").disabled) return "";
  const last = current.messages[current.messages.length - 1];
  const question = [...current.messages].reverse().find((m) => m.role === "user");
  const realModels = models.filter((m) => m.value !== "demo::demo");
  const reviewer = realModels.find((m) => m.value !== last.model)
    || realModels.find((m) => m.value === last.model)
    || models[0];
  const system = "You are a sharp, fair second-opinion reviewer. Check the answer below for errors, gaps and risks. Say what is right, what is wrong, and give a corrected or improved answer if needed. Be concise.";
  const history = [{ role: "user", content: `Question:\n${question ? question.content : ""}\n\nAnswer to review:\n${stripThinking(last.content)}` }];
  setBusy(true);
  const reply = await streamAssistant(reviewer.value, system, history, "Second opinion", "critic");
  if (reply) current.messages.push({ role: "assistant", agent: "critic", model: reviewer.value, content: reply });
  persist(current);
  setBusy(false);
  if (reply) renderMessages();
  return reply;
}

/* ================= council ================= */
const COUNCIL_PRESETS = {
  "Builder + Critic": [
    { name: "Builder", persona: "You are a creative, practical builder. Propose concrete solutions, write code or plans, and improve them based on feedback." },
    { name: "Critic", persona: "You are a sharp, constructive reviewer. Find flaws, edge cases and risks and suggest specific fixes. Approve when it is genuinely good." },
  ],
  "Expert panel (3)": [
    { name: "Engineer", persona: "You are a pragmatic engineer. Focus on how it works, feasibility, cost and failure modes." },
    { name: "Designer", persona: "You are a user-focused designer. Focus on clarity, usability and what the person actually needs." },
    { name: "Skeptic", persona: "You are a rigorous skeptic. Challenge assumptions, ask for evidence and flag anything that could be wrong." },
  ],
  "Debate": [
    { name: "Pro", persona: "You argue FOR the proposition with strong evidence and reasoning. Respond directly to the other side." },
    { name: "Con", persona: "You argue AGAINST the proposition with strong evidence and reasoning. Respond directly to the other side." },
  ],
  "Teacher + Student": [
    { name: "Teacher", persona: "You are a patient expert teacher. Explain step by step and check understanding." },
    { name: "Student", persona: "You are a curious student. Ask good follow-up questions and summarize what you learned." },
  ],
  "Brainstorm": [
    { name: "Visionary", persona: "You generate bold, unconventional ideas and push them further." },
    { name: "Realist", persona: "You ground ideas in feasibility, cost and execution, then pick and refine the best ones." },
  ],
};
function newCouncil(presetName = "Builder + Critic") {
  const preset = COUNCIL_PRESETS[presetName];
  current = {
    id: newId(),
    type: "council",
    title: "New council",
    started: false,
    preset: presetName,
    topic: "",
    roundCount: 2,
    stopOnConsensus: true,
    agents: preset.map((p, i) => ({ ...p, model: defaultModel(i) })),
    judge: { enabled: true, model: defaultModel(preset.length) },
    messages: [],
  };
  openConversation(current);
}
function modelSelectHtml(id, value) {
  return `<select id="${id}" data-model-select data-value="${escapeHtml(value)}"></select>`;
}
function renderCouncilSetup(conv) {
  const setup = document.createElement("div");
  setup.className = "setup";
  setup.innerHTML = `
    <h2>⚖ Council</h2>
    <p class="hint">Agents take turns until they reach <b>consensus</b> , then an impartial Judge writes the final answer. Give each agent a different model for real diversity of thought.</p>
    <div class="row"><label for="council-preset">Preset</label><select id="council-preset"></select></div>
    <div class="agents" id="council-agents"></div>
    <div class="row">
      <label class="check"><input type="checkbox" id="judge-enabled"> Judge writes a final verdict</label>
      ${modelSelectHtml("judge-model", conv.judge.model)}
    </div>
    <div class="field">
      <label for="council-topic">Task / question</label>
      <textarea id="council-topic" rows="3" placeholder="e.g. Should a 3-person startup build its app with React Native or Flutter?"></textarea>
    </div>
    <div class="row">
      <label for="council-rounds">Rounds</label>
      <input type="number" id="council-rounds" min="1" max="6">
      <label class="check"><input type="checkbox" id="council-stop"> Stop early on consensus</label>
      <span class="spacer"></span>
      <button class="primary" id="council-start" type="button">Convene ▶</button>
    </div>`;
  $("messages").innerHTML = "";
  $("messages").appendChild(setup);

  for (const name of Object.keys(COUNCIL_PRESETS)) {
    const option = document.createElement("option");
    option.textContent = name;
    $("council-preset").appendChild(option);
  }
  $("council-preset").value = conv.preset;
  const drawAgents = () => {
    const box = $("council-agents");
    box.innerHTML = "";
    box.style.gridTemplateColumns = `repeat(${conv.agents.length}, 1fr)`;
    conv.agents.forEach((agent, i) => {
      const card = document.createElement("div");
      card.className = `agent-card ${AGENT_COLORS[i]}`;
      card.innerHTML = `
        <label for="agent-${i}-name">Agent ${i + 1}</label><input type="text" id="agent-${i}-name" maxlength="40">
        <label for="agent-${i}-model">Model</label>${modelSelectHtml(`agent-${i}-model`, agent.model)}
        <label for="agent-${i}-persona">Role</label><textarea id="agent-${i}-persona" rows="3"></textarea>`;
      box.appendChild(card);
      $(`agent-${i}-name`).value = agent.name;
      $(`agent-${i}-persona`).value = agent.persona;
    });
    refreshModelSelects();
  };
  drawAgents();
  $("judge-enabled").checked = conv.judge.enabled;
  $("council-topic").value = conv.topic;
  $("council-rounds").value = conv.roundCount;
  $("council-stop").checked = conv.stopOnConsensus;
  $("council-preset").addEventListener("change", () => {
    conv.preset = $("council-preset").value;
    conv.agents = COUNCIL_PRESETS[conv.preset].map((p, i) => ({ ...p, model: defaultModel(i) }));
    drawAgents();
  });
  $("council-start").addEventListener("click", () => startCouncil(conv));
}
function startCouncil(conv) {
  conv.agents = conv.agents.map((agent, i) => ({
    name: $(`agent-${i}-name`).value.trim().slice(0, 40) || `Agent ${i + 1}`,
    model: $(`agent-${i}-model`).value,
    persona: $(`agent-${i}-persona`).value.slice(0, 2000),
  }));
  conv.judge = { enabled: $("judge-enabled").checked, model: $("judge-model").value };
  conv.topic = $("council-topic").value.trim();
  if (!conv.topic) {
    $("council-topic").focus();
    return null;
  }
  conv.roundCount = Math.min(6, Math.max(1, parseInt($("council-rounds").value, 10) || 2));
  conv.stopOnConsensus = $("council-stop").checked;
  conv.title = conv.topic.slice(0, 40);
  conv.started = true;
  conv.messages = [{ role: "user", content: conv.topic }];
  persist(conv);
  openConversation(conv);
  return runCouncil(conv, conv.roundCount);
}
function councilSystemPrompt(conv, index) {
  const self = conv.agents[index];
  const others = conv.agents.filter((_, i) => i !== index).map((a) => `"${a.name}"`).join(" and ");
  return withInstructions(`${self.persona}

You are "${self.name}" in a ${conv.agents.length}-agent council with ${others}. The human set this task:
"""${conv.topic}"""
Other agents' and the human's messages appear as user messages prefixed with the speaker's name.
Build on, refine, or challenge the latest points. Be concise and substantive; never repeat what was already said. Do not speak for other agents.
When the group has reached a correct, complete answer and you agree with it, end your message with: CONSENSUS`);
}
function signalsConsensus(reply) {
  return /\bCONSENSUS[\s.!*_)]*$/.test(stripThinking(reply));
}
function councilHistoryFor(conv, index) {
  return conv.messages
    .filter((m) => m.agent !== "judge")
    .map((m) => {
      if (m.agent === index) return { role: "assistant", content: m.content };
      const speaker = typeof m.agent === "number" ? conv.agents[m.agent].name : "Human";
      return { role: "user", content: `${speaker}: ${m.content}` };
    });
}
async function runCouncil(conv, rounds) {
  councilRunning = true;
  setBusy(true);
  $("council-controls").classList.remove("hidden");
  const agentTurns = conv.messages.filter((m) => typeof m.agent === "number");
  let index = agentTurns.length ? (agentTurns[agentTurns.length - 1].agent + 1) % conv.agents.length : 0;
  const total = rounds * conv.agents.length;
  let consensusStreak = 0;
  try {
    for (let turn = 0; turn < total && councilRunning && current === conv; turn++) {
      const agent = conv.agents[index];
      $("status").textContent = `${agent.name} is thinking… (${turn + 1}/${total})`;
      const reply = await streamAssistant(agent.model, councilSystemPrompt(conv, index), councilHistoryFor(conv, index), agent.name, `agent-${AGENT_COLORS[index]}`);
      if (!reply.trim()) break;
      conv.messages.push({ role: "assistant", agent: index, content: reply.trim() });
      persist(conv);
      consensusStreak = signalsConsensus(reply) ? consensusStreak + 1 : 0;
      if (conv.stopOnConsensus && consensusStreak >= Math.max(1, conv.agents.length - 1)) break;
      index = (index + 1) % conv.agents.length;
    }
    if (councilRunning && current === conv && conv.judge.enabled) await runJudge(conv);
  } finally {
    councilRunning = false;
    setBusy(false);
    $("status").textContent = "Council paused. Interject, continue, or ask the Judge.";
  }
}
async function runJudge(conv) {
  $("status").textContent = "Judge is writing the verdict…";
  const transcript = conv.messages
    .filter((m) => m.agent !== "judge")
    .map((m) => `${typeof m.agent === "number" ? conv.agents[m.agent].name : "Human"}: ${stripThinking(m.content)}`)
    .join("\n\n");
  const system = "You are an impartial judge reviewing a council of AI agents. Write the best final answer to the human's task using the strongest points, correcting any errors. Use this format:\n## Verdict\n**Final answer:** ...\n\n**Agreed:** ...\n\n**Still open:** ...\n\n**Confidence:** low / medium / high, with one reason.";
  const reply = await streamAssistant(conv.judge.model, system, [{ role: "user", content: `Task: ${conv.topic}\n\nCouncil transcript:\n${transcript}` }], "Judge", "judge");
  if (reply.trim()) {
    conv.messages.push({ role: "assistant", agent: "judge", content: reply.trim() });
    persist(conv);
  }
  return reply;
}

/* ================= arena ================= */
function newArena() {
  current = {
    id: newId(),
    type: "arena",
    title: "New arena",
    started: false,
    models: [defaultModel(0), defaultModel(1)],
    rounds: [],
  };
  openConversation(current);
}
function renderArenaSetup(conv) {
  const setup = document.createElement("div");
  setup.className = "setup";
  setup.innerHTML = `
    <h2>⚔ Arena</h2>
    <p class="hint">Ask once and watch 2–3 models answer side by side. Vote for the best answer to build your own leaderboard of which models actually work for <i>you</i>.</p>
    <div class="agents" id="arena-models" style="grid-template-columns:repeat(3,1fr)"></div>
    <div class="row">
      <label class="check"><input type="checkbox" id="arena-third"> Add a third model</label>
      <span class="spacer"></span>
      <button class="primary" id="arena-start" type="button">Enter the arena ▶</button>
    </div>
    <div id="leaderboard"></div>`;
  $("messages").innerHTML = "";
  $("messages").appendChild(setup);
  ["A", "B", "C"].forEach((letter, i) => {
    const card = document.createElement("div");
    card.className = `agent-card ${AGENT_COLORS[i]}`;
    card.id = `arena-card-${i}`;
    card.innerHTML = `<label for="arena-model-${i}">Model ${letter}</label>${modelSelectHtml(`arena-model-${i}`, conv.models[i] || defaultModel(i))}`;
    $("arena-models").appendChild(card);
  });
  refreshModelSelects();
  const syncThird = () => $("arena-card-2").classList.toggle("hidden", !$("arena-third").checked);
  $("arena-third").checked = conv.models.length > 2;
  syncThird();
  $("arena-third").addEventListener("change", syncThird);
  $("arena-start").addEventListener("click", () => {
    const count = $("arena-third").checked ? 3 : 2;
    conv.models = [0, 1, 2].slice(0, count).map((i) => $(`arena-model-${i}`).value);
    conv.started = true;
    conv.title = "Arena: " + conv.models.map(modelLabel).join(" vs ");
    persist(conv);
    openConversation(conv);
    $("input").focus();
  });
  renderLeaderboard($("leaderboard"));
}
function renderLeaderboard(container) {
  const rows = Object.entries(state.arenaStats)
    .map(([model, s]) => ({ model, ...s, rate: s.games ? s.wins / s.games : 0 }))
    .sort((a, b) => b.rate - a.rate || b.wins - a.wins);
  if (!rows.length) {
    container.innerHTML = `<p class="hint">Your leaderboard appears here after your first vote.</p>`;
    return;
  }
  container.innerHTML = `<h3>Your leaderboard</h3><table class="board"><tr><th>Model</th><th>Wins</th><th>Games</th><th>Win rate</th></tr>${rows
    .map((r) => `<tr><td>${escapeHtml(modelLabel(r.model))}</td><td>${r.wins}</td><td>${r.games}</td><td>${Math.round(r.rate * 100)}%</td></tr>`)
    .join("")}</table>`;
}
function renderArena() {
  const box = $("messages");
  box.innerHTML = "";
  if (!current.rounds.length) {
    box.innerHTML = `<div class="welcome"><h2>${escapeHtml(current.models.map(modelLabel).join(" vs "))}</h2><p>Type a prompt below. Every model answers at the same time.</p></div>`;
    return;
  }
  current.rounds.forEach((round, roundIndex) => renderArenaRound(round, roundIndex));
  scrollDown();
}
function renderArenaRound(round, roundIndex) {
  renderUserBubble({ display: round.prompt, files: round.files });
  const grid = document.createElement("div");
  grid.className = "arena-grid";
  grid.style.gridTemplateColumns = `repeat(${round.replies.length}, minmax(0, 1fr))`;
  const bubbles = round.replies.map((reply, i) => {
    const column = document.createElement("div");
    column.className = `arena-col ${AGENT_COLORS[i]}` + (round.winner === i ? " winner" : "");
    const head = document.createElement("div");
    head.className = "who";
    head.textContent = `${"ABC"[i]} · ${modelLabel(reply.model)}` + (round.winner === i ? "  🏆" : "");
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = renderReply(reply.content || "");
    column.append(head, bubble);
    grid.appendChild(column);
    return bubble;
  });
  const wrap = document.createElement("div");
  wrap.className = "msg arena-round";
  wrap.appendChild(grid);
  const votes = document.createElement("div");
  votes.className = "msg-actions votes";
  if (round.winner === undefined || round.winner === null) {
    round.replies.forEach((_, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = `${"ABC"[i]} is better`;
      button.addEventListener("click", () => vote(roundIndex, i));
      votes.appendChild(button);
    });
    const tie = document.createElement("button");
    tie.type = "button";
    tie.className = "secondary";
    tie.textContent = "Tie";
    tie.addEventListener("click", () => vote(roundIndex, -1));
    votes.appendChild(tie);
  } else {
    const verdict = document.createElement("span");
    verdict.textContent = round.winner === -1 ? "You called it a tie." : `You picked ${"ABC"[round.winner]}.`;
    votes.appendChild(verdict);
  }
  if (!round.fused) {
    const fuse = document.createElement("button");
    fuse.type = "button";
    fuse.className = "secondary fuse-btn";
    fuse.textContent = "✨ Fuse into one best answer";
    fuse.title = "Merge the best parts of every answer into one (like big-AGI's Beam)";
    fuse.addEventListener("click", () => fuseRound(roundIndex));
    votes.appendChild(fuse);
  }
  wrap.appendChild(votes);
  if (round.fused) {
    const fused = document.createElement("div");
    fused.className = "fused";
    fused.innerHTML = `<div class="who">✨ Fused answer <span class="meta">${escapeHtml(modelLabel(round.fused.model))}</span></div>`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.id = `fused-${roundIndex}`;
    bubble.innerHTML = renderReply(round.fused.content || "");
    fused.appendChild(bubble);
    wrap.appendChild(fused);
  }
  $("messages").appendChild(wrap);
  return { bubbles, votes };
}
async function fuseRound(roundIndex) {
  if ($("send-btn").disabled || !current || current.type !== "arena") return null;
  const round = current.rounds[roundIndex];
  if (!round || round.fused) return null;
  const model = round.replies.map((r) => r.model).find((value) => !value.startsWith("demo::")) || round.replies[0].model;
  const answers = round.replies
    .map((r, i) => `Answer ${"ABC"[i]} (${modelLabel(r.model)}):\n${stripThinking(r.content)}`)
    .join("\n\n---\n\n");
  const history = [{ role: "user", content: `Question:\n${round.prompt}\n\n${answers}` }];
  round.fused = { model, content: "" };
  renderArena();
  const bubble = $(`fused-${roundIndex}`);
  bubble.classList.add("cursor");
  bubble.scrollIntoView({ block: "nearest" });
  setBusy(true);
  try {
    round.fused.content = await streamReply(model, withInstructions(FUSE_PROMPT), history, (full) => {
      bubble.innerHTML = renderReply(full);
    });
  } catch (error) {
    round.fused.content = error.name === "AbortError" ? bubble.textContent : `⚠️ ${errorText(error)}`;
  }
  persist(current);
  setBusy(false);
  renderArena();
  return round.fused.content;
}
async function sendArena(text) {
  const message = takeAttachments(text);
  const round = { prompt: text, files: message.files, replies: current.models.map((model) => ({ model, content: "" })), winner: null };
  current.rounds.push(round);
  if (current.rounds.length === 1) $("messages").innerHTML = "";
  const { bubbles, votes } = renderArenaRound(round, current.rounds.length - 1);
  votes.classList.add("hidden");
  setBusy(true);
  const history = (slot) => [
    ...current.rounds.slice(0, -1).flatMap((r) => [
      { role: "user", content: r.prompt },
      { role: "assistant", content: r.replies[slot] ? r.replies[slot].content : "" },
    ]),
    { role: "user", content: message.content },
  ];
  await Promise.all(round.replies.map(async (reply, slot) => {
    bubbles[slot].classList.add("cursor");
    try {
      const isDemo = splitModel(reply.model).provider === "demo";
      const system = isDemo ? `${SYSTEM_PROMPT} [arena:${slot}]` : withInstructions(SYSTEM_PROMPT);
      reply.content = await streamReply(reply.model, system, history(slot), (full) => {
        bubbles[slot].innerHTML = renderReply(full);
      });
    } catch (error) {
      reply.content = error.name === "AbortError" ? bubbles[slot].textContent : `⚠️ ${errorText(error)}`;
      bubbles[slot].innerHTML = renderReply(reply.content);
    }
    bubbles[slot].classList.remove("cursor");
  }));
  persist(current);
  setBusy(false);
  renderArena();
  return round;
}
function vote(roundIndex, winner) {
  const round = current.rounds[roundIndex];
  if (round.winner !== null && round.winner !== undefined) return;
  round.winner = winner;
  round.replies.forEach((reply, i) => {
    const stats = state.arenaStats[reply.model] || { wins: 0, games: 0 };
    stats.games += 1;
    if (i === winner) stats.wins += 1;
    state.arenaStats[reply.model] = stats;
  });
  persist(current);
  renderArena();
}

/* ================= export ================= */
function conversationMarkdown(conv) {
  const lines = [`# ${conv.title}`, "", `*Exported from Glow · ${new Date().toISOString().slice(0, 10)}*`, ""];
  if (conv.type === "arena") {
    conv.rounds.forEach((round) => {
      lines.push(`## Prompt`, "", round.prompt, "");
      round.replies.forEach((reply, i) => {
        lines.push(`### ${"ABC"[i]} · ${modelLabel(reply.model)}${round.winner === i ? " 🏆" : ""}`, "", stripThinking(reply.content), "");
      });
      if (round.fused && round.fused.content) lines.push(`### ✨ Fused answer (${modelLabel(round.fused.model)})`, "", stripThinking(round.fused.content), "");
    });
  } else {
    for (const m of conv.messages) {
      const who = m.role === "user" ? { name: "You" } : agentDisplay(conv, m);
      lines.push(`## ${who.name}${who.meta ? ` (${who.meta})` : ""}`, "", applyChecks(stripThinking(m.display || m.content), m.checks), "");
    }
  }
  return lines.join("\n");
}
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
function exportCurrent() {
  const slug = current.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "chat";
  download(`glow-${slug}.md`, conversationMarkdown(current), "text/markdown");
}

/* ================= attachments ================= */
function addFiles(fileList) {
  for (const file of fileList) {
    if (file.size > 2_000_000) {
      showNotice(`${file.name} is too large (max 2 MB of text).`);
      continue;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      if (/\u0000/.test(text.slice(0, 2000))) {
        showNotice(`${file.name} doesn't look like a text file.`);
        return;
      }
      pendingFiles.push({ name: file.name, text: text.slice(0, MAX_ATTACHMENT_CHARS) });
      renderPendingFiles();
    };
    reader.readAsText(file);
  }
}
function renderPendingFiles() {
  const box = $("pending-files");
  box.innerHTML = "";
  pendingFiles.forEach((file, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = "📄 " + file.name + " ";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "✕";
    remove.addEventListener("click", () => {
      pendingFiles.splice(i, 1);
      renderPendingFiles();
    });
    chip.appendChild(remove);
    box.appendChild(chip);
  });
  box.classList.toggle("hidden", !pendingFiles.length);
}

/* ================= settings ================= */
function openSettings() {
  const s = state.settings;
  $("set-openrouter").value = s.openrouterKey;
  $("set-paid").checked = s.showPaid;
  $("set-ollama").value = s.ollamaUrl;
  $("set-custom-url").value = s.customUrl;
  $("set-custom-key").value = s.customKey;
  $("set-theme").value = s.theme;
  $("set-sync").checked = s.cloudSync;
  $("set-instructions").value = s.customInstructions || "";
  $("set-followups").checked = s.followUps !== false;
  renderAccount();
  $("settings-modal").classList.add("open");
}
async function saveSettings() {
  Object.assign(state.settings, {
    openrouterKey: $("set-openrouter").value.trim(),
    showPaid: $("set-paid").checked,
    ollamaUrl: $("set-ollama").value.trim() || "http://localhost:11434",
    customUrl: $("set-custom-url").value.trim(),
    customKey: $("set-custom-key").value.trim(),
    cloudSync: $("set-sync").checked,
    customInstructions: $("set-instructions").value.trim().slice(0, 1500),
    followUps: $("set-followups").checked,
  });
  saveState();
  $("settings-modal").classList.remove("open");
  await loadModels();
}
function exportAll() {
  download(`glow-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ conversations: state.conversations, arenaStats: state.arenaStats }, null, 2), "application/json");
}
function importAll(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const list = Array.isArray(data) ? data : data.conversations;
      if (!Array.isArray(list)) throw new Error("bad file");
      const known = new Set(state.conversations.map((c) => c.id));
      for (const conv of list) {
        if (conv && conv.id && conv.type && !known.has(conv.id)) state.conversations.push(conv);
      }
      saveState();
      renderHistory();
    } catch {
      alert("That file isn't a Glow backup.");
    }
  };
  reader.readAsText(file);
}
async function clearAll() {
  const synced = cloudReady();
  const question = synced
    ? "Delete all chats, votes and keys from this browser AND the synced copy in your account?"
    : "Delete all chats, votes and keys from this browser?";
  if (!confirm(question)) return;
  clearTimeout(cloudTimer);
  if (synced) await window.puter.kv.del(CLOUD_PREFIX + "meta").catch(() => {});
  localStorage.removeItem(STORE_KEY);
  location.reload();
}

/* ================= theme ================= */
const systemLight = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : { matches: false };
function effectiveTheme() {
  const choice = state.settings.theme;
  if (choice === "light" || choice === "dark") return choice;
  return systemLight.matches ? "light" : "dark";
}
function applyTheme() {
  const theme = effectiveTheme();
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "light" ? "#faf9f5" : "#262624";
  const next = theme === "dark" ? "light" : "dark";
  for (const id of ["theme-toggle", "welcome-theme"]) {
    $(id).textContent = theme === "dark" ? "☀" : "☾";
    $(id).title = `Switch to ${next} theme`;
  }
  $("theme-btn").textContent = theme === "dark" ? "☀ Light" : "☾ Dark";
  $("set-theme").value = state.settings.theme;
}
function setTheme(choice) {
  state.settings.theme = choice;
  saveState();
  applyTheme();
}
function toggleTheme() {
  setTheme(effectiveTheme() === "dark" ? "light" : "dark");
  toast(effectiveTheme() === "dark" ? "Dark theme on" : "Light theme on");
}


/* ================= Glow AI via Puter (sign-in) ================= */
function ensurePuter() {
  if (window.puter) return Promise.resolve(window.puter);
  if (TEST_MODE) return Promise.reject(new Error("Puter is disabled in sandboxed demos."));
  if (!puterPromise) {
    puterPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = PUTER_SDK_URL;
      script.async = true;
      script.onload = () => (window.puter ? resolve(window.puter) : reject(new Error("Puter did not start.")));
      script.onerror = () => {
        puterPromise = null;
        script.remove();
        reject(new Error("Couldn't reach Puter. Check your connection or ad-blocker, then try again."));
      };
      document.head.appendChild(script);
    });
  }
  return puterPromise;
}
function withTimeout(promise, ms, message) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}
function puterErrorText(error) {
  if (!error) return "Glow AI (Puter) error.";
  const inner = error.error && typeof error.error === "object" ? error.error : error;
  const message = String(inner.message || inner.msg || (typeof error.error === "string" ? error.error : "") || error.message || error.msg || "");
  const code = String(inner.code || error.code || "");
  const both = `${code} ${message}`;
  if (/insufficient|funds|quota|allowance|usage.?limit|credits|exceeded/i.test(both)) {
    return "Your free Puter AI allowance is used up for now. Try a lighter model (GPT-5 nano or Flash-Lite), wait a while, or add your own key in Settings.";
  }
  if (/auth|unauthori[sz]ed|401|token/i.test(both)) return "Your sign-in has expired. Sign in again from the sidebar.";
  if (/model.*(not|unavailable|unknown)|not.?found/i.test(both)) return "This Glow AI model isn't available right now. Pick another model.";
  return `Glow AI (Puter) error: ${(message || code || "unknown problem").slice(0, 200)}`;
}
async function puterModelOptions() {
  const sdk = window.puter;
  if (!puterCatalogue && sdk && sdk.ai && typeof sdk.ai.listModels === "function") {
    try {
      const list = await withTimeout(sdk.ai.listModels(), 5000, "catalogue timeout");
      puterCatalogueList = (Array.isArray(list) ? list : []).filter((m) => m && m.id
        && (!m.modalities || !m.modalities.output || m.modalities.output.includes("text"))
        && !/embed|tts|whisper|transcri|image|video|moderation|rerank|ocr|speech|audio/i.test(m.id));
      const ids = new Set();
      for (const m of Array.isArray(list) ? list : []) {
        if (m && m.id) ids.add(m.id);
        for (const alias of (m && m.aliases) || []) ids.add(alias);
      }
      if (ids.size) puterCatalogue = ids;
    } catch {
      // Catalogue unavailable: offer the curated list as-is.
    }
  }
  const available = PUTER_MODELS.filter(([id]) => !puterCatalogue || puterCatalogue.has(id));
  const curated = (available.length ? available : PUTER_MODELS).map(([id, name]) => ({
    value: `puter::${id}`,
    label: name,
    short: name.replace(/\s*\(.*\)$/, ""),
    group: "Glow AI: free with your account",
  }));
  if (!state.settings.allPuterModels || !puterCatalogueList) return curated;
  const seen = new Set(curated.map((m) => m.value));
  const everything = puterCatalogueList
    .filter((m) => !seen.has(`puter::${m.id}`))
    .map((m) => ({
      value: `puter::${m.id}`,
      label: m.name || m.id,
      short: (m.name || m.id).replace(/\s*\(.*\)$/, ""),
      group: `Glow AI: all models${m.provider ? ` · ${m.provider}` : ""}`,
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  return [...curated, ...everything];
}
async function streamPuter(model, system, messages, onText, signal) {
  let sdk;
  try {
    sdk = await ensurePuter();
  } catch (error) {
    throw new Error(error.message);
  }
  if (!sdk.auth.isSignedIn()) {
    puterSignedIn = false;
    renderAccount();
    throw new Error("Sign in to use Glow AI models: click “Sign in” in the sidebar, or pick another model.");
  }
  const aborted = new Promise((_, reject) => {
    if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  aborted.catch(() => {});
  let response;
  try {
    response = await Promise.race([
      sdk.ai.chat([{ role: "system", content: system }, ...mergeRoles(messages)], { model, stream: true, signal }),
      aborted,
    ]);
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    throw new Error(puterErrorText(error));
  }
  if (!response || typeof response[Symbol.asyncIterator] !== "function") {
    const text = String((response && response.message && response.message.content) || response || "");
    onText(text);
    return text;
  }
  const iterator = response[Symbol.asyncIterator]();
  let full = "";
  let thinking = false;
  try {
    while (true) {
      let step;
      try {
        step = await Promise.race([iterator.next(), aborted]);
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        throw new Error(puterErrorText(error));
      }
      if (step.done) break;
      const part = step.value || {};
      if (part.error) throw new Error(puterErrorText(part.error));
      const type = part.type || "text";
      const reasoning = typeof part.reasoning === "string" ? part.reasoning
        : /^reasoning/.test(type) && typeof part.text === "string" ? part.text : "";
      if (reasoning) {
        if (!thinking) {
          full += "<think>";
          thinking = true;
        }
        full += reasoning;
      } else if (type === "text" && typeof part.text === "string" && part.text) {
        if (thinking) {
          full += "</think>\n\n";
          thinking = false;
        }
        full += part.text;
      } else {
        continue;
      }
      onText(full);
    }
  } finally {
    if (signal.aborted && typeof iterator.return === "function") Promise.resolve(iterator.return()).catch(() => {});
  }
  if (thinking) full += "</think>";
  return full;
}

/* ================= account: sign in, guest, sign out ================= */
function renderAccount() {
  const s = state.settings;
  const box = $("account-box");
  box.classList.toggle("signed-in", puterSignedIn);
  let label;
  let action;
  let status;
  if (puterSignedIn) {
    label = s.accountName || "Signed in";
    action = "Sign out";
    status = `Signed in as ${s.accountName || "your Puter account"}. Glow AI models are ready.`;
  } else if (s.account === "puter") {
    label = "Signed out";
    action = "Sign in";
    status = "You're signed out. Sign in again to use Glow AI models and sync.";
  } else {
    label = "👤 Guest";
    action = "Sign in";
    status = "You're using Glow as a guest: demo replies or your own keys below.";
  }
  $("account-label").textContent = label;
  $("account-label").title = puterSignedIn ? `Signed in with Puter as ${label}` : label;
  $("account-btn").textContent = action;
  $("set-account-status").textContent = status;
  $("set-account-btn").textContent = action;
  $("set-sync").disabled = !puterSignedIn;
  $("banner-signin").classList.toggle("hidden", TEST_MODE || puterSignedIn);
}
function setSigninError(message) {
  $("signin-error").textContent = message;
  $("signin-error").classList.toggle("hidden", !message);
}
function signinFailureText(error) {
  const code = error && (error.error || error.code);
  if (code === "auth_window_closed") return "The sign-in window was closed. Try again, or continue as guest.";
  if (code === "unsupported_origin") return "Sign-in needs Glow to be opened from its website, not a local file.";
  return `Sign-in didn't finish: ${(error && (error.message || error.msg)) || "please try again"}.`;
}
async function signIn() {
  setSigninError("");
  $("signin-btn").disabled = true;
  try {
    const sdk = window.puter || (await ensurePuter());
    // Called straight from the click so the Puter sign-in popup isn't blocked.
    if (!sdk.auth.isSignedIn()) await sdk.auth.signIn();
    const user = await Promise.resolve(sdk.auth.getUser()).catch(() => null);
    puterSignedIn = true;
    Object.assign(state.settings, { account: "puter", accountName: (user && user.username) || "Puter user" });
    saveState();
  } catch (error) {
    setSigninError(signinFailureText(error));
    if (!$("welcome-screen").classList.contains("hidden")) $("signin-btn").focus();
    else showNoticeSafe(signinFailureText(error));
    return false;
  } finally {
    $("signin-btn").disabled = false;
  }
  hideWelcome();
  renderAccount();
  toast(`Signed in as ${state.settings.accountName}`);
  await loadModels();
  if (current && current.type === "chat") fillSelect($("chat-model"), current.model);
  if (pendingModel && current && current.type === "chat") selectChatModel(pendingModel);
  pendingModel = null;
  await pullCloud();
  maybeStartTour();
  return true;
}
function continueAsGuest() {
  Object.assign(state.settings, { account: "guest", accountName: "" });
  saveState();
  hideWelcome();
  renderAccount();
  maybeStartTour();
}
async function signOut() {
  clearTimeout(cloudTimer);
  if (cloudReady()) await pushCloud().catch(() => {});
  try {
    if (window.puter) await Promise.resolve(window.puter.auth.signOut());
  } catch (error) {
    console.warn("Puter sign-out failed", error);
  }
  puterSignedIn = false;
  Object.assign(state.settings, { account: "guest", accountName: "" });
  saveState();
  renderAccount();
  await loadModels();
  if (current && current.type === "chat") fillSelect($("chat-model"), current.model);
  showWelcome();
}
function onAccountButton() {
  closeSidebar();
  $("settings-modal").classList.remove("open");
  if (puterSignedIn) signOut();
  else showWelcome();
}
async function restorePuterSession() {
  try {
    const sdk = await withTimeout(ensurePuter(), 10000, "Puter is taking too long to load.");
    puterSignedIn = !!sdk.auth.isSignedIn();
    if (puterSignedIn) {
      const user = await Promise.resolve(sdk.auth.getUser()).catch(() => null);
      if (user && user.username) state.settings.accountName = user.username;
    }
  } catch (error) {
    puterSignedIn = false;
    console.warn(error);
  }
  renderAccount();
  return puterSignedIn;
}
function showNoticeSafe(message) {
  if (current && !(current.type !== "chat" && !current.started)) showNotice(message);
  else alert(message);
}

/* ================= cloud sync (Puter key-value storage) ================= */
function cloudReady() {
  return puterSignedIn && state.settings.cloudSync && !!(window.puter && window.puter.kv);
}
function scheduleCloudPush() {
  if (!cloudReady()) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => pushCloud().catch((error) => console.warn("Sync failed", error)), CLOUD_PUSH_DELAY_MS);
}
function cloudBody(conversations) {
  return JSON.stringify({ v: 1, conversations, arenaStats: state.arenaStats, deleted: state.deleted });
}
async function pushCloud() {
  if (!cloudReady() || cloudBusy) return false;
  let conversations = state.conversations.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  let body = cloudBody(conversations);
  while (Math.ceil(body.length / CLOUD_CHUNK_CHARS) > CLOUD_MAX_PARTS && conversations.length > 1) {
    conversations = conversations.slice(0, Math.floor(conversations.length * 0.8));
    body = cloudBody(conversations);
  }
  if (body === lastCloudPayload) return true;
  cloudBusy = true;
  try {
    const parts = [];
    for (let i = 0; i < body.length; i += CLOUD_CHUNK_CHARS) parts.push(body.slice(i, i + CLOUD_CHUNK_CHARS));
    for (let i = 0; i < parts.length; i++) await window.puter.kv.set(`${CLOUD_PREFIX}${i}`, parts[i]);
    await window.puter.kv.set(`${CLOUD_PREFIX}meta`, JSON.stringify({ parts: parts.length, updated: Date.now(), kept: conversations.length, total: state.conversations.length }));
    lastCloudPayload = body;
    $("status").textContent = conversations.length < state.conversations.length
      ? `Synced your ${conversations.length} most recent chats (account storage limit)`
      : "Chats synced to your account";
    return true;
  } finally {
    cloudBusy = false;
  }
}
async function pullCloud() {
  if (!cloudReady()) return false;
  try {
    const metaText = await window.puter.kv.get(`${CLOUD_PREFIX}meta`);
    if (metaText) {
      const meta = typeof metaText === "string" ? JSON.parse(metaText) : metaText;
      const parts = [];
      for (let i = 0; i < meta.parts; i++) parts.push(await window.puter.kv.get(`${CLOUD_PREFIX}${i}`));
      if (parts.every((p) => typeof p === "string")) mergeCloud(JSON.parse(parts.join("")));
    }
    await pushCloud();
    return true;
  } catch (error) {
    console.warn("Could not sync", error);
    $("status").textContent = "Couldn't sync chats right now; they're safe in this browser.";
    return false;
  }
}
function mergeCloud(data) {
  const deleted = { ...(data.deleted || {}), ...state.deleted };
  const byId = new Map();
  for (const conv of [...state.conversations, ...(data.conversations || [])]) {
    if (!conv || !conv.id || !conv.type || deleted[conv.id]) continue;
    const existing = byId.get(conv.id);
    if (!existing || (conv.updated || 0) > (existing.updated || 0)) byId.set(conv.id, conv);
  }
  const busy = councilRunning || $("send-btn").disabled;
  if (current && busy && byId.has(current.id)) byId.set(current.id, current); // never swap a conversation mid-reply
  state.conversations = [...byId.values()].sort((a, b) => (b.updated || 0) - (a.updated || 0));
  state.deleted = Object.fromEntries(Object.entries(deleted).sort((a, b) => b[1] - a[1]).slice(0, 500));
  for (const [model, stats] of Object.entries(data.arenaStats || {})) {
    const mine = state.arenaStats[model];
    if (!mine || (stats.games || 0) > (mine.games || 0)) state.arenaStats[model] = stats;
  }
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (current) {
    const fresh = state.conversations.find((c) => c.id === current.id);
    if (fresh && fresh !== current && !busy) openConversation(fresh);
  }
  renderHistory();
}

/* ================= welcome screen ================= */
function showWelcome() {
  endTour(false);
  setSigninError("");
  $("welcome-screen").classList.remove("hidden");
  ensurePuter().catch(() => {}); // preload so the sign-in popup opens instantly on click
  $("signin-btn").focus();
}
function hideWelcome() {
  $("welcome-screen").classList.add("hidden");
}

/* ================= guided tour ================= */
const TOUR_STEPS = [
  { title: "Welcome to GlowChat ✨", text: "A quick tour of the main controls. Use Next or the → key, Back or ←, and Esc to skip." },
  { target: "#model-picker-btn", title: "Pick a model", text: "Open this menu to search models, star your favorites and see what each is good at. Glow Free works right away; 🔒 models unlock with a free sign-in." },
  { target: "#composer", title: "Ask anything", text: "Type here and press Enter to send. Shift+Enter adds a new line; 📎 or paste attaches files, ✨ improves your prompt and 🎤 lets you speak." },
  { target: "#composer-tools", title: "Personas", text: "Switch how Glow answers: 🗺 Planner gives you a checklist you can tick off, plus 🎓 Tutor, 💻 Coder, ✍ Writer, 🔍 Critic and 🌐 Translator." },
  { target: "#new-council-btn", sidebar: true, title: "Council ⚖", text: "2–3 agents with different roles debate until they agree, then a Judge writes the final answer." },
  { target: "#new-arena-btn", sidebar: true, title: "Arena ⚔", text: "Ask several models the same question side by side, vote for the best and build your own leaderboard." },
  { target: "#crewroom-link", sidebar: true, title: "GlowRoom 🏢", text: "Hand bigger jobs to GlowRoom, the Glow app where an AI crew searches the web and runs code. What you type becomes their mission (or press 🏢 Ask GlowRoom under a reply), and their result comes back here as a chat." },
  { target: "#glow-apps-btn", sidebar: true, title: "Glow apps", text: "GlowChat is part of Glow. Use this button to jump to Glow home or GlowRoom; one Glow account works in every app." },
  { target: "#search", sidebar: true, title: "Your chats", text: "Every chat is saved and searchable here. When you're signed in they sync to your account too." },
  { target: "#share-btn", title: "Share", text: "Copy a link that opens a copy of this chat for anyone, with no account and no server in between." },
  { target: "#export-btn", title: "Export", text: "Download the current conversation as a Markdown file." },
  { target: "#theme-toggle", title: "Light or dark", text: "Switch the theme any time. Glow follows your device until you pick one." },
  { target: "#account-box", sidebar: true, title: "Your account", text: "See who's signed in, sign in to get free Glow AI, or sign out." },
  { target: "#settings-btn", sidebar: true, title: "Settings & models", text: "Add your own OpenRouter, Ollama or OpenAI-compatible keys, change the theme and back up your data." },
  { target: "#help-btn", title: "That's it!", text: "Press ? any time to replay this tour. Now go turn a spark into something real." },
];
const tour = { active: false, index: 0, steps: [] };
function tourTarget(step) {
  if (!step.target) return null;
  const element = document.querySelector(step.target);
  if (!element || element.classList.contains("hidden")) return null;
  return element;
}
function isMobileLayout() {
  return window.matchMedia ? window.matchMedia("(max-width: 760px)").matches : window.innerWidth <= 760;
}
function startTour() {
  closeSidebar();
  $("settings-modal").classList.remove("open");
  hideWelcome();
  tour.steps = TOUR_STEPS.filter((step) => {
    if (!step.target) return true;
    const element = tourTarget(step);
    if (!element) return false;
    if (step.sidebar && isMobileLayout()) return true; // shown by opening the sidebar
    return element.getClientRects().length > 0 && getComputedStyle(element).display !== "none";
  });
  tour.active = true;
  tour.index = 0;
  $("tour").classList.remove("hidden");
  renderTourStep();
}
function maybeStartTour() {
  if (!state.settings.tourDone) startTour();
}
function endTour(markDone = true) {
  if (!tour.active) return;
  tour.active = false;
  $("tour").classList.add("hidden");
  closeSidebar();
  if (markDone) {
    state.settings.tourDone = true;
    saveState();
  }
}
function moveTour(delta) {
  if (!tour.active) return;
  const next = tour.index + delta;
  if (next >= tour.steps.length) {
    endTour();
    return;
  }
  tour.index = Math.max(0, next);
  renderTourStep();
}
function renderTourStep() {
  const step = tour.steps[tour.index];
  $("tour-step").textContent = `Step ${tour.index + 1} of ${tour.steps.length}`;
  $("tour-title").textContent = step.title;
  $("tour-text").textContent = step.text;
  $("tour-back").disabled = tour.index === 0;
  $("tour-next").textContent = tour.index === tour.steps.length - 1 ? "Finish" : "Next";
  const needsSidebar = !!step.sidebar && isMobileLayout();
  document.body.classList.toggle("sidebar-open", needsSidebar);
  positionTour();
  if (needsSidebar) setTimeout(positionTour, 230); // after the sidebar slides in
  $("tour-next").focus();
}
function positionTour() {
  if (!tour.active) return;
  const step = tour.steps[tour.index];
  const spot = $("tour-spot");
  const card = $("tour-card");
  const target = tourTarget(step);
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  const cardW = Math.min(340, viewW - 24);
  const cardH = card.offsetHeight || 170;
  if (!target) {
    spot.classList.add("centered");
    Object.assign(spot.style, { left: `${viewW / 2}px`, top: `${viewH / 2}px`, width: "0px", height: "0px" });
    card.style.left = `${Math.max(12, (viewW - cardW) / 2)}px`;
    card.style.top = `${Math.max(12, (viewH - cardH) / 2)}px`;
    return;
  }
  spot.classList.remove("centered");
  const rect = target.getBoundingClientRect();
  const pad = 6;
  const gap = 14;
  Object.assign(spot.style, {
    left: `${rect.left - pad}px`,
    top: `${rect.top - pad}px`,
    width: `${rect.width + pad * 2}px`,
    height: `${rect.height + pad * 2}px`,
  });
  let left;
  let top;
  const fitsBeside = rect.right + pad + gap + cardW <= viewW - 12;
  if (step.sidebar && !isMobileLayout() && fitsBeside) {
    left = rect.right + pad + gap; // sidebar controls: card to the right
    top = rect.top + rect.height / 2 - cardH / 2;
  } else {
    left = rect.left + rect.width / 2 - cardW / 2;
    top = rect.bottom + pad + gap;
    if (top + cardH > viewH - 12) top = rect.top - pad - gap - cardH;
  }
  card.style.left = `${Math.min(viewW - cardW - 12, Math.max(12, left))}px`;
  card.style.top = `${Math.min(viewH - cardH - 12, Math.max(12, top))}px`;
}


/* ================= model picker (searchable, favorites, badges, locked upgrades) ================= */
let pendingModel = null;
let pickerActive = -1;
function modelBadges(option) {
  const value = option.value.toLowerCase();
  const badges = [];
  if (value.startsWith("demo::")) badges.push("Offline");
  if (value.startsWith("free::") || /:free$/.test(value)) badges.push("Free");
  if (value.startsWith("ollama::")) badges.push("Local");
  if (value.startsWith("puter::")) badges.push("Glow AI");
  if (/nano|mini|flash|lite|fast|haiku|\b[1-9]b\b/.test(value)) badges.push("Fast");
  if (/gpt-oss|deepseek-r1|reason|think|qwq|\bo[34]\b/.test(value)) badges.push("Reasoning");
  if (/sonnet|opus|-pro\b|large|70b|405b|gpt-4o$|gpt-5(\.\d)?$/.test(value)) badges.push("Smart");
  return badges.slice(0, 3);
}
function pickerEntries() {
  const entries = models.map((m) => ({ ...m, locked: false }));
  if (!puterSignedIn && !entries.some((e) => e.value.startsWith("puter::"))) {
    for (const [id, name] of PUTER_MODELS) {
      entries.push({ value: `puter::${id}`, label: name, short: name.replace(/\s*\(.*\)$/, ""), group: "🔒 Free with sign-in", locked: true });
    }
  }
  return entries;
}
function updatePickerLabel() {
  const value = $("chat-model").value;
  $("model-picker-label").textContent = value ? modelLabel(value) : "Choose a model";
}
function openModelMenu() {
  $("model-menu").classList.remove("hidden");
  $("model-picker-btn").setAttribute("aria-expanded", "true");
  $("model-search").value = "";
  renderModelMenu();
  $("model-search").focus();
}
function closeModelMenu() {
  $("model-menu").classList.add("hidden");
  $("model-picker-btn").setAttribute("aria-expanded", "false");
}
function modelMenuOpen() {
  return !$("model-menu").classList.contains("hidden");
}
function renderModelMenu() {
  const query = $("model-search").value.trim().toLowerCase();
  const selected = $("chat-model").value;
  const favorites = new Set(state.settings.favoriteModels || []);
  const list = $("model-list");
  list.innerHTML = "";
  const entries = pickerEntries().filter((e) => !query || `${e.label} ${e.value} ${e.group}`.toLowerCase().includes(query));
  const groups = new Map();
  const favoriteEntries = entries.filter((e) => favorites.has(e.value) && !e.locked);
  if (favoriteEntries.length) groups.set("★ Favorites", favoriteEntries);
  for (const entry of entries) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  let shown = 0;
  for (const [group, items] of groups) {
    if (shown >= 300) break;
    const head = document.createElement("div");
    head.className = "model-group";
    head.textContent = group;
    list.appendChild(head);
    for (const entry of items) {
      if (shown >= 300) break;
      shown += 1;
      const row = document.createElement("div");
      row.className = "model-row" + (entry.value === selected && !entry.locked ? " selected" : "") + (entry.locked ? " locked" : "");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(entry.value === selected && !entry.locked));
      row.dataset.value = entry.value;
      row.dataset.locked = entry.locked ? "1" : "";
      const name = document.createElement("span");
      name.className = "model-name";
      name.textContent = entry.label;
      const badges = document.createElement("span");
      badges.className = "model-badges";
      for (const badge of modelBadges(entry)) {
        const tag = document.createElement("span");
        tag.className = `badge badge-${badge.toLowerCase().replace(/\s+/g, "-")}`;
        tag.textContent = badge;
        badges.appendChild(tag);
      }
      row.append(name, badges);
      if (!entry.locked) {
        const star = document.createElement("button");
        star.type = "button";
        star.className = "model-star" + (favorites.has(entry.value) ? " on" : "");
        star.textContent = favorites.has(entry.value) ? "★" : "☆";
        star.title = favorites.has(entry.value) ? "Remove from favorites" : "Add to favorites";
        star.dataset.star = entry.value;
        row.appendChild(star);
      }
      list.appendChild(row);
    }
  }
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "model-empty";
    empty.textContent = `No models match “${query}”.`;
    list.appendChild(empty);
  } else if (shown >= 300) {
    const more = document.createElement("div");
    more.className = "model-empty";
    more.textContent = "Showing the first 300. Type to search the rest.";
    list.appendChild(more);
  }
  pickerActive = -1;
  const foot = $("model-menu-foot");
  foot.innerHTML = "";
  if (!puterSignedIn && !TEST_MODE) {
    const unlock = document.createElement("button");
    unlock.type = "button";
    unlock.className = "link-btn unlock";
    unlock.dataset.menuAction = "signin";
    unlock.textContent = "🔓 Sign in free to unlock GPT, Claude, Gemini, DeepSeek…";
    foot.appendChild(unlock);
  } else if (puterSignedIn) {
    const label = document.createElement("label");
    label.className = "note";
    label.innerHTML = `<input type="checkbox" data-menu-action="all-models"${state.settings.allPuterModels ? " checked" : ""}> Show every Glow AI model${puterCatalogueList ? ` (${puterCatalogueList.length})` : ""}`;
    foot.appendChild(label);
  }
  const keys = document.createElement("button");
  keys.type = "button";
  keys.className = "link-btn";
  keys.dataset.menuAction = "keys";
  keys.textContent = "🔑 Use my own keys";
  foot.appendChild(keys);
}
function selectChatModel(value, announce = true) {
  if (!models.some((m) => m.value === value)) return false;
  $("chat-model").value = value;
  $("chat-model").dispatchEvent(new Event("change"));
  updatePickerLabel();
  closeModelMenu();
  if (announce) toast(`Model: ${modelLabel(value)}`);
  return true;
}
function toggleFavorite(value) {
  const favorites = new Set(state.settings.favoriteModels || []);
  if (favorites.has(value)) favorites.delete(value);
  else favorites.add(value);
  state.settings.favoriteModels = [...favorites];
  saveState();
  renderModelMenu();
}
function onModelListClick(event) {
  const star = event.target.closest("[data-star]");
  if (star) {
    event.stopPropagation();
    toggleFavorite(star.dataset.star);
    return;
  }
  const row = event.target.closest(".model-row");
  if (!row) return;
  if (row.dataset.locked) {
    pendingModel = row.dataset.value;
    closeModelMenu();
    toast(`Sign in (free) to use ${row.querySelector(".model-name").textContent}`);
    showWelcome();
    return;
  }
  selectChatModel(row.dataset.value);
}
async function onModelFootClick(event) {
  const action = event.target.dataset.menuAction;
  if (action === "all-models" && event.type !== "change") return;
  if (action === "signin") {
    closeModelMenu();
    showWelcome();
  } else if (action === "keys") {
    closeModelMenu();
    openSettings();
  } else if (action === "all-models") {
    state.settings.allPuterModels = event.target.checked;
    saveState();
    await loadModels();
    renderModelMenu();
  }
}
function onModelSearchKey(event) {
  const rows = [...$("model-list").querySelectorAll(".model-row")];
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!rows.length) return;
    pickerActive = (pickerActive + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    rows.forEach((row, i) => row.classList.toggle("active", i === pickerActive));
    rows[pickerActive].scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter") {
    event.preventDefault();
    const row = rows[pickerActive >= 0 ? pickerActive : 0];
    if (row) row.click();
  }
}

/* ================= personas, character count ================= */
function fillPersonaSelect() {
  const select = $("persona-select");
  select.innerHTML = "";
  for (const [key, persona] of Object.entries(PERSONAS)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = `${persona.icon} ${persona.name}`;
    select.appendChild(option);
  }
}
function setPersona(key, announce = true) {
  if (!current || current.type !== "chat" || !PERSONAS[key]) return;
  current.persona = key;
  $("persona-select").value = key;
  if (current.messages.length) persist(current);
  if (announce) toast(`Persona: ${PERSONAS[key].icon} ${PERSONAS[key].name}`);
}
function syncComposerTools() {
  const isChat = current && current.type === "chat";
  $("persona-select").classList.toggle("hidden", !isChat);
  document.querySelector(".persona-label").classList.toggle("hidden", !isChat);
  if (isChat) $("persona-select").value = PERSONAS[current.persona] ? current.persona : "default";
  updateCharCount();
}
function updateCharCount() {
  const length = $("input").value.length;
  const counter = $("char-count");
  counter.textContent = length > 200 ? `${length.toLocaleString()} chars ≈ ${Math.ceil(length / 4).toLocaleString()} tokens` : "";
  counter.classList.toggle("warn", length > MAX_CONTEXT_CHARS / 2);
}

/* ================= ✨ improve my prompt ================= */
let improveUndo = null;
async function improvePrompt() {
  const text = $("input").value.trim();
  if (!text) {
    toast("Type a prompt first, then press ✨");
    $("input").focus();
    return null;
  }
  if ($("send-btn").disabled || $("improve-btn").disabled) return null;
  const model = current && current.type === "chat" ? $("chat-model").value : defaultModel();
  $("improve-btn").disabled = true;
  $("improve-btn").classList.add("working");
  try {
    const raw = await streamReply(model, IMPROVE_PROMPT, [{ role: "user", content: text }], () => {});
    const improved = stripThinking(raw).replace(/^["“'`]+|["”'`]+$/g, "").trim();
    if (!improved) throw new Error("No suggestion came back. Try again.");
    improveUndo = text;
    $("input").value = improved;
    autoSize();
    updateCharCount();
    $("improve-bar").classList.remove("hidden");
    $("input").focus();
    return improved;
  } catch (error) {
    if (error.name !== "AbortError") toast(errorText(error));
    return null;
  } finally {
    $("improve-btn").disabled = false;
    $("improve-btn").classList.remove("working");
  }
}
function undoImprove() {
  if (improveUndo !== null) $("input").value = improveUndo;
  improveUndo = null;
  $("improve-bar").classList.add("hidden");
  autoSize();
  updateCharCount();
  $("input").focus();
}

/* ================= 🎤 voice input and 🔊 read aloud ================= */
const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
function toggleDictation() {
  if (!SpeechRecognitionApi) return;
  if (recognition) {
    recognition.stop();
    return;
  }
  recognition = new SpeechRecognitionApi();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = true;
  const base = $("input").value ? $("input").value.replace(/\s*$/, " ") : "";
  recognition.onresult = (event) => {
    let heard = "";
    for (const result of event.results) heard += result[0].transcript;
    $("input").value = base + heard;
    autoSize();
    updateCharCount();
  };
  recognition.onerror = (event) => {
    toast(event.error === "not-allowed" ? "Microphone access was blocked. Allow it in the browser to use voice input." : `Voice input stopped (${event.error}).`);
  };
  recognition.onend = () => {
    recognition = null;
    $("mic-btn").classList.remove("listening");
  };
  $("mic-btn").classList.add("listening");
  recognition.start();
  toast("Listening… speak now");
}
function plainSpeech(text) {
  return stripThinking(text)
    .replace(/```[\s\S]*?```/g, " (code block) ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`|~]+/g, " ")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
function speechLanguage(text) {
  const indonesianWords = (text.match(/\b(yang|dan|tidak|ini|itu|dengan|untuk|adalah|kamu|saya|bisa)\b/gi) || []).length;
  return indonesianWords >= 3 ? "id-ID" : (navigator.language || "en-US");
}
function speakMessage(index) {
  if (!("speechSynthesis" in window) || !current) return false;
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    return false;
  }
  const message = current.messages[index];
  if (!message) return false;
  const text = plainSpeech(message.content);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = speechLanguage(text);
  speechSynthesis.speak(utterance);
  toast("🔊 Reading aloud. Press 🔊 again to stop.");
  return true;
}

/* ================= 🔗 share a chat by link (no server, no account) ================= */
function toBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(text) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
function sharePayload(conv) {
  const clean = (text) => stripThinking(String(text || "")).slice(0, 100000);
  const payload = { v: 1, type: conv.type, title: String(conv.title || "Shared chat").slice(0, 80) };
  if (conv.type === "arena") {
    payload.models = conv.models;
    payload.rounds = (conv.rounds || []).map((r) => ({
      prompt: clean(r.prompt),
      replies: r.replies.map((reply) => ({ model: reply.model, content: clean(reply.content) })),
      winner: r.winner,
      fused: r.fused ? { model: r.fused.model, content: clean(r.fused.content) } : undefined,
    }));
  } else {
    payload.persona = conv.persona;
    payload.messages = conv.messages.map((m) => ({
      role: m.role,
      content: m.role === "user" ? clean(m.display || m.content) : clean(m.content),
      agent: m.agent,
      model: m.model,
      checks: m.checks,
    }));
    if (conv.type === "council") {
      payload.topic = clean(conv.topic);
      payload.agents = conv.agents.map((a) => ({ name: a.name, model: a.model, persona: String(a.persona || "").slice(0, 2000) }));
      payload.judge = conv.judge;
    }
  }
  return payload;
}
async function encodeShare(conv) {
  const json = JSON.stringify(sharePayload(conv));
  if (window.CompressionStream) {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return "z." + toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return "j." + toBase64Url(new TextEncoder().encode(json));
}
async function decodeShare(token) {
  const [kind, data] = [token.slice(0, 2), token.slice(2)];
  const bytes = fromBase64Url(data);
  let json;
  if (kind === "z.") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    json = await new Response(stream).text();
  } else if (kind === "j.") {
    json = new TextDecoder().decode(bytes);
  } else {
    throw new Error("Unknown share format");
  }
  return JSON.parse(json);
}
function sanitizeShared(data) {
  const text = (value) => String(value == null ? "" : value).slice(0, 100000);
  const model = (value) => (typeof value === "string" && value.includes("::") ? value.slice(0, 200) : FREE_MODEL.value);
  if (!data || data.v !== 1 || !["chat", "council", "arena"].includes(data.type)) throw new Error("Not a Glow share link");
  const conv = { id: newId(), type: data.type, title: `🔗 ${text(data.title).slice(0, 60)}`, shared: true, started: true, updated: Date.now() };
  if (data.type === "arena") {
    conv.models = (Array.isArray(data.models) ? data.models : []).slice(0, 3).map(model);
    conv.rounds = (Array.isArray(data.rounds) ? data.rounds : []).slice(0, 50).map((r) => ({
      prompt: text(r.prompt),
      files: [],
      replies: (Array.isArray(r.replies) ? r.replies : []).slice(0, 3).map((reply) => ({ model: model(reply.model), content: text(reply.content) })),
      winner: Number.isInteger(r.winner) ? r.winner : null,
      fused: r.fused ? { model: model(r.fused.model), content: text(r.fused.content) } : undefined,
    }));
    if (conv.models.length < 2) throw new Error("Incomplete arena");
    return conv;
  }
  conv.persona = PERSONAS[data.persona] ? data.persona : "default";
  conv.model = state.settings.lastModel;
  conv.messages = (Array.isArray(data.messages) ? data.messages : []).slice(0, 400).map((m) => {
    const message = { role: m.role === "user" ? "user" : "assistant", content: text(m.content) };
    if (Number.isInteger(m.agent) || m.agent === "judge" || m.agent === "critic") message.agent = m.agent;
    if (m.model) message.model = model(m.model);
    if (m.checks && typeof m.checks === "object") message.checks = Object.fromEntries(Object.entries(m.checks).slice(0, 200).map(([k, v]) => [String(parseInt(k, 10)), !!v]));
    return message;
  });
  if (data.type === "council") {
    conv.topic = text(data.topic);
    conv.agents = (Array.isArray(data.agents) ? data.agents : []).slice(0, 3).map((a, i) => ({ name: text(a.name).slice(0, 40) || `Agent ${i + 1}`, model: model(a.model), persona: text(a.persona).slice(0, 2000) }));
    conv.judge = { enabled: !!(data.judge && data.judge.enabled), model: model(data.judge && data.judge.model) };
    conv.roundCount = 2;
    conv.stopOnConsensus = true;
    if (conv.agents.length < 2) throw new Error("Incomplete council");
  }
  return conv;
}
function hasShareableContent(conv) {
  return conv && ((conv.messages && conv.messages.length) || (conv.rounds && conv.rounds.length));
}
async function shareCurrent() {
  if (!hasShareableContent(current)) {
    toast("Nothing to share yet. Send a message first.");
    return null;
  }
  const token = await encodeShare(current);
  if (token.length > MAX_SHARE_CHARS) {
    toast("This chat is too long for a link. Use ⤓ Export instead.");
    return null;
  }
  const url = `${location.origin}${location.pathname}#share=${token}`;
  copyText(url, "🔗 Link copied. Anyone who opens it gets their own copy of this chat.");
  return url;
}
async function importSharedFromHash() {
  const match = location.hash.match(/^#share=([A-Za-z0-9_.-]+)$/);
  if (!match) return false;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    const conv = sanitizeShared(await decodeShare(match[1]));
    state.conversations.unshift(conv);
    saveState();
    openConversation(conv);
    toast("Shared chat opened. It's saved in your chats.");
    return true;
  } catch (error) {
    console.warn(error);
    toast("That share link is broken or incomplete.");
    return false;
  }
}

/* ================= wiring ================= */
function stopAll() {
  councilRunning = false;
  for (const controller of controllers) controller.abort();
}
function autoSize() {
  const input = $("input");
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 220) + "px";
}
function onSend() {
  if ($("send-btn").disabled) return null;
  if (rateNotice.failed) closeRateNotice();
  $("improve-bar").classList.add("hidden");
  improveUndo = null;
  setTimeout(updateCharCount, 0);
  const text = $("input").value.trim();
  if (!text && !pendingFiles.length) {
    if (current.type === "council" && current.started) return runCouncil(current, 1);
    return null;
  }
  if (current.type === "council") {
    if (!current.started) return null;
    const message = { role: "user", ...takeAttachments(text) };
    current.messages.push(message);
    renderUserBubble(message);
    $("input").value = "";
    autoSize();
    return runCouncil(current, 1);
  }
  if (current.type === "arena" && !current.started) return null;
  $("input").value = "";
  autoSize();
  return current.type === "arena" ? sendArena(text) : sendChat(text);
}
function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}

function wire() {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target.classList.contains("copy-btn")) {
      copyText(target.nextElementSibling.textContent, "Code copied");
      target.textContent = "Copied";
      setTimeout(() => (target.textContent = "Copy"), 1200);
    }
    if (target.dataset.copyIndex && current) {
      const message = current.messages[Number(target.dataset.copyIndex)];
      if (message) copyText(stripThinking(message.content));
    }
    const starter = target.closest && target.closest("[data-starter]");
    if (starter) useStarter(Number(starter.dataset.starter));
    if (target.dataset.speakIndex && current) speakMessage(Number(target.dataset.speakIndex));
    if (target.dataset.followup && !$("send-btn").disabled) {
      $("input").value = target.dataset.followup;
      onSend();
    }
    if (modelMenuOpen() && !(target.closest && target.closest("#model-picker"))) closeModelMenu();
    if (target.dataset.start === "council") newCouncil();
    if (target.dataset.start === "arena") newArena();
  });
  document.addEventListener("keydown", (e) => {
    if (tour.active) {
      if (e.key === "Escape") endTour();
      else if (e.key === "ArrowRight") moveTour(1);
      else if (e.key === "ArrowLeft") moveTour(-1);
      else return;
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && modelMenuOpen()) {
      e.preventDefault();
      closeModelMenu();
      $("model-picker-btn").focus();
      return;
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "");
    if (e.key === "?" && !typing && !e.metaKey && !e.ctrlKey && $("welcome-screen").classList.contains("hidden")) {
      e.preventDefault();
      startTour();
      return;
    }
    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && $("welcome-screen").classList.contains("hidden")) {
      e.preventDefault();
      $("input").focus();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      stopAll();
      newChat();
      $("input").focus();
    }
    if (e.key === "Escape") {
      stopAll();
      $("settings-modal").classList.remove("open");
    }
  });
  $("send-btn").addEventListener("click", onSend);
  $("stop-btn").addEventListener("click", stopAll);
  $("council-stop-btn").addEventListener("click", stopAll);
  $("council-continue-btn").addEventListener("click", () => {
    if (!councilRunning) runCouncil(current, 1);
  });
  $("council-judge-btn").addEventListener("click", async () => {
    if (councilRunning || $("send-btn").disabled) return;
    setBusy(true);
    await runJudge(current);
    setBusy(false);
  });
  $("input").addEventListener("input", autoSize);
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  });
  $("input").addEventListener("paste", (e) => {
    if (e.clipboardData && e.clipboardData.files.length) addFiles(e.clipboardData.files);
  });
  $("attach-btn").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  });
  $("new-chat-btn").addEventListener("click", () => {
    stopAll();
    newChat();
    closeSidebar();
  });
  $("new-council-btn").addEventListener("click", () => {
    stopAll();
    newCouncil();
    closeSidebar();
  });
  $("new-arena-btn").addEventListener("click", () => {
    stopAll();
    newArena();
    closeSidebar();
  });
  $("search").addEventListener("input", renderHistory);
  $("chat-model").addEventListener("change", () => {
    if (current && current.type === "chat") current.model = $("chat-model").value;
    state.settings.lastModel = $("chat-model").value;
    saveState();
  });
  $("export-btn").addEventListener("click", exportCurrent);
  $("menu-btn").addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  $("settings-btn").addEventListener("click", openSettings);
  $("banner-settings").addEventListener("click", () => {
    if (TEST_MODE) {
      const normalPage = new URL(location.href);
      normalPage.hash = "";
      location.replace(normalPage.href);
    } else {
      openSettings();
    }
  });
  $("settings-close").addEventListener("click", () => $("settings-modal").classList.remove("open"));
  $("settings-save").addEventListener("click", saveSettings);
  $("backup-btn").addEventListener("click", exportAll);
  $("import-input").addEventListener("change", (e) => {
    if (e.target.files[0]) importAll(e.target.files[0]);
  });
  $("clear-btn").addEventListener("click", clearAll);
  $("theme-btn").addEventListener("click", toggleTheme);
  $("theme-toggle").addEventListener("click", toggleTheme);
  $("welcome-theme").addEventListener("click", toggleTheme);
  $("set-theme").addEventListener("change", () => setTheme($("set-theme").value));
  if (systemLight.addEventListener) systemLight.addEventListener("change", applyTheme);
  $("help-btn").addEventListener("click", startTour);
  $("tour-replay-btn").addEventListener("click", startTour);
  $("tour-next").addEventListener("click", () => moveTour(1));
  $("tour-back").addEventListener("click", () => moveTour(-1));
  $("tour-skip").addEventListener("click", () => endTour());
  window.addEventListener("resize", positionTour);
  $("signin-btn").addEventListener("click", signIn);
  $("signin-btn").addEventListener("pointerenter", () => ensurePuter().catch(() => {}));
  $("guest-btn").addEventListener("click", continueAsGuest);
  $("account-btn").addEventListener("click", onAccountButton);
  $("set-account-btn").addEventListener("click", onAccountButton);
  $("banner-signin").addEventListener("click", showWelcome);
  $("rate-close").addEventListener("click", closeRateNotice);
  $("model-picker-btn").addEventListener("click", () => (modelMenuOpen() ? closeModelMenu() : openModelMenu()));
  $("model-search").addEventListener("input", renderModelMenu);
  $("model-search").addEventListener("keydown", onModelSearchKey);
  $("model-list").addEventListener("click", onModelListClick);
  $("model-menu-foot").addEventListener("click", onModelFootClick);
  $("model-menu-foot").addEventListener("change", onModelFootClick);
  $("persona-select").addEventListener("change", () => setPersona($("persona-select").value));
  $("improve-btn").addEventListener("click", improvePrompt);
  $("improve-undo").addEventListener("click", undoImprove);
  $("mic-btn").classList.toggle("hidden", !SpeechRecognitionApi);
  $("mic-btn").addEventListener("click", toggleDictation);
  $("share-btn").addEventListener("click", shareCurrent);
  $("jump-btn").addEventListener("click", () => scrollDown(true));
  $("messages").addEventListener("scroll", updateJumpButton, { passive: true });
  $("input").addEventListener("input", updateCharCount);
  $("rate-signin").addEventListener("click", () => {
    closeRateNotice();
    showWelcome();
  });
  $("set-sync").addEventListener("change", () => {
    state.settings.cloudSync = $("set-sync").checked;
    saveState();
    if (state.settings.cloudSync) pullCloud();
  });
}

/* ================= self-test (open with #selftest) ================= */
async function selfTest() {
  const results = [];
  const expect = (name, ok) => results.push(`${ok ? "PASS" : "FAIL"} ${name}`);
  models = models.slice(0, 1); // hermetic: demo model only

  newChat();
  fillSelect($("chat-model"), "demo::demo");
  const reply = await sendChat("hello");
  expect("chat: demo replies", reply.includes("Demo mode"));
  expect("chat: saved", state.conversations.length >= 1 && current.messages.length === 2);
  const again = await regenerate();
  expect("chat: regenerate replaces reply", again && current.messages.length === 2);
  const second = await secondOpinion();
  expect("chat: second opinion added", second.includes("Second opinion") && current.messages[2].agent === "critic");
  expect("chat: action bar shown", document.querySelectorAll(".msg-actions .link-btn").length >= 3);
  expect("security: markdown escapes html", !renderMarkdown("<img src=x onerror=alert(1)>").includes("<img"));
  expect("markdown: heading followed by text", /<h4>Verdict<\/h4><p><strong>Final/.test(renderMarkdown("## Verdict\n**Final** answer")));

  newCouncil("Expert panel (3)");
  for (let i = 0; i < 3; i++) $(`agent-${i}-model`).value = "demo::demo";
  $("judge-model").value = "demo::demo";
  $("council-topic").value = "Plan a picnic";
  $("council-rounds").value = "2";
  await startCouncil(current);
  const turns = current.messages.filter((m) => typeof m.agent === "number");
  expect("council: three agents rotate", turns.length >= 3 && turns[0].agent === 0 && turns[1].agent === 1 && turns[2].agent === 2);
  expect("council: builder drafts, next agent critiques", turns[0].content.includes("first draft") && turns[1].content.includes("issues"));
  expect("council: stops on consensus", turns.length < 6 && turns.some((m) => m.content.includes("CONSENSUS")));
  const verdict = current.messages[current.messages.length - 1];
  expect("council: judge verdict last", verdict.agent === "judge" && verdict.content.includes("Final answer"));
  expect("council: 3 colours rendered", document.querySelectorAll(".msg.agent-c").length > 0 && document.querySelectorAll(".msg.judge").length === 1);

  newArena();
  $("arena-model-0").value = "demo::demo";
  $("arena-model-1").value = "demo::demo";
  $("arena-start").click();
  const round = await sendArena("Explain gravity");
  expect("arena: both models answered in parallel", round.replies.length === 2 && round.replies.every((r) => r.content.length > 10) && round.replies[0].content !== round.replies[1].content);
  vote(0, 1);
  expect("arena: vote recorded on leaderboard", state.arenaStats["demo::demo"] && state.arenaStats["demo::demo"].games === 2 && state.arenaStats["demo::demo"].wins === 1);
  const fusedText = await fuseRound(current.rounds.length - 1);
  expect("arena: ✨ fuse merges the answers into one", (fusedText || "").includes("Fused answer") && document.querySelector(".fused .bubble").textContent.includes("strongest points"));
  expect("persona: selector hidden outside chat", $("persona-select").classList.contains("hidden"));

  expect("fix: self-test uses a sandbox, never the visitor's data", STORE_KEY === "glow.sandbox");
  expect("fix: consensus only counts as a sign-off", signalsConsensus("Looks right. CONSENSUS") && signalsConsensus("Agreed.\n\n**CONSENSUS**") && !signalsConsensus("We have no CONSENSUS yet, keep going.") && !signalsConsensus("no consensus"));
  const long = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(1000) + i }));
  const trimmed = trimHistory(long);
  expect("fix: long history trimmed to recent context", trimmed.length < long.length && trimmed[trimmed.length - 1] === long[long.length - 1]);
  let calls = 0;
  const waits = [];
  const fakeResponse = (status) => ({ status, headers: { get: () => "0.01" } });
  const retried = await fetchWithRetry(async () => fakeResponse(++calls < 3 ? 429 : 200), new AbortController().signal, (s) => waits.push(s));
  expect("fix: rate limits retried with backoff", retried.status === 200 && calls === 3 && waits.length === 2);
  const savedModels = models;
  models = [models[0], { value: "openrouter::z/odd-model:free", label: "odd" }, { value: "openrouter::meta-llama/llama-3.3-70b-instruct:free", label: "llama" }];
  expect("fix: defaults prefer strong chat models", defaultModel(0) === "openrouter::meta-llama/llama-3.3-70b-instruct:free");
  models = savedModels;

  const md = conversationMarkdown(state.conversations.find((c) => c.type === "council"));
  expect("export: markdown has judge + agents", md.includes("## Judge") && md.includes("## Engineer"));
  $("search").value = "picnic";
  renderHistory();
  expect("search: filters history", document.querySelectorAll("#history .history-item").length === 1);
  $("search").value = "";
  renderHistory();

  const realFetch = window.fetch;
  let freeRequest = null;
  window.fetch = async (url, options) => {
    freeRequest = { url, options };
    const sse = 'data: {"choices":[{"delta":{"reasoning":"hmm"}}]}\n\ndata: {"choices":[{"delta":{"content":"Free hello"}}]}\n\ndata: [DONE]\n\n';
    return new Response(new Blob([sse]).stream(), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  let freeText = "";
  try {
    freeText = await streamReply(FREE_MODEL.value, "Be brief.", [{ role: "user", content: "hi" }], () => {});
  } finally {
    window.fetch = realFetch;
  }
  const freeBody = JSON.parse(freeRequest.options.body);
  expect("guest: free AI answers with no key or sign-in", freeText.endsWith("Free hello") && freeRequest.url === `${FREE_AI_URL}/chat/completions`
    && !freeRequest.options.headers.Authorization && freeBody.model === "openai-fast" && freeBody.stream === true);
  const sseOk = 'data: {"choices":[{"delta":{"content":"After the wait"}}]}\n\ndata: [DONE]\n\n';
  let noticeDuringWait = null;
  let throttleCalls = 0;
  window.fetch = async () => {
    throttleCalls += 1;
    if (throttleCalls === 1) return new Response("Too Many Requests", { status: 429, headers: { "retry-after": "0.3" } });
    noticeDuringWait = { shown: !$("rate-notice").classList.contains("hidden"), text: $("rate-text").textContent };
    return new Response(new Blob([sseOk]).stream(), { status: 200 });
  };
  let recovered = "";
  try {
    recovered = await streamReply(FREE_MODEL.value, "Be brief.", [{ role: "user", content: "hi" }], () => {});
  } finally {
    window.fetch = realFetch;
  }
  expect("rate limit: visible notice with countdown while a guest reply waits", !!noticeDuringWait && noticeDuringWait.shown
    && /busy/.test(noticeDuringWait.text) && /Retrying in \d+s \(try 1 of 3\)/.test(noticeDuringWait.text));
  expect("rate limit: notice clears once the reply arrives", recovered === "After the wait" && $("rate-notice").classList.contains("hidden"));

  window.fetch = async () => new Response("Too Many Requests", { status: 429, headers: { "retry-after": "0.01" } });
  let finalError = "";
  try {
    await streamReply(FREE_MODEL.value, "Be brief.", [{ role: "user", content: "hi" }], () => {});
  } catch (error) {
    finalError = error.message;
  } finally {
    window.fetch = realFetch;
  }
  const noticeBox = $("rate-notice");
  const noticeRect = noticeBox.getBoundingClientRect();
  expect("rate limit: stays visible after retries run out", !noticeBox.classList.contains("hidden") && noticeBox.classList.contains("failed")
    && /still too busy/.test($("rate-text").textContent) && finalError.includes("busy") && noticeRect.height > 0 && noticeRect.bottom <= innerHeight);
  $("rate-close").click();
  expect("rate limit: notice can be dismissed", noticeBox.classList.contains("hidden"));

  window.fetch = async () => new Response(new Blob(['data: {"error":{"message":"Rate limit exceeded: queue full for anonymous tier"}}\n\n']).stream(), { status: 200 });
  let streamError = "";
  try {
    await streamReply(FREE_MODEL.value, "Be brief.", [{ role: "user", content: "hi" }], () => {});
  } catch (error) {
    streamError = error.message;
  } finally {
    window.fetch = realFetch;
  }
  expect("rate limit: throttling reported inside the stream is shown too", !noticeBox.classList.contains("hidden") && streamError.includes("busy"));
  closeRateNotice();

  const modelsBeforeRank = models;
  models = [modelsBeforeRank[0], FREE_MODEL];
  const guestDefault = defaultModel();
  models = [modelsBeforeRank[0], FREE_MODEL, { value: "openrouter::meta-llama/llama-3.3-70b-instruct:free", label: "llama" }];
  const keyDefault = defaultModel();
  models = modelsBeforeRank;
  expect("guest: new chats default to free AI, own strong keys win", guestDefault === FREE_MODEL.value && keyDefault.startsWith("openrouter::"));
  expect("guest: busy free AI explained in plain words", friendlyError(429, "", "free").includes("busy"));

  newChat();
  expect("ui: starter prompts on the empty chat", document.querySelectorAll(".starter").length === STARTERS.length);
  await useStarter(0);
  expect("ui: starter prompt sends a real chat", current.messages.length === 2 && current.messages[0].content === STARTERS[0].prompt);
  expect("ui: every reply has its own Copy button", document.querySelectorAll("[data-copy-index]").length === current.messages.filter((m) => m.role === "assistant").length);
  expect("ui: rename a chat", renameConversation(current, "  My renamed chat  ") && current.title === "My renamed chat" && !renameConversation(current, "   "));
  toast("Hello");
  expect("ui: toast feedback appears", $("toast").classList.contains("show") && $("toast").textContent === "Hello");

  // ---- v0.5: model picker, personas, checklists, follow-ups, improve, share, scroll, pin, voice, markdown ----
  const waitUntil = async (check, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  };
  const mdRender = renderMarkdown;
  expect("markdown: tables render as real tables", /<table>.*<th>Plan<\/th>.*<td>Free<\/td>/s.test(mdRender("| Plan | Price |\n|---|---|\n| Free | $0 |")));
  expect("markdown: links are clickable and open in a new tab", mdRender("See [docs](https://example.com/a?b=1&c=2).").includes('<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs</a>')
    && mdRender("Visit https://glow.app/x.").includes('href="https://glow.app/x"'));
  expect("markdown: unsafe links are never linked", !mdRender("[x](javascript:alert(1))").includes("<a ") && !mdRender('[x](https://a.com/" onmouseover="alert(1))').includes('" onmouseover'));
  expect("markdown: numbered lists keep counting across gaps", mdRender("1. one\n\n2. two").includes('<ol start="2">'));
  expect("markdown: nested lists", mdRender("- a\n  - b").includes("<ul><li>a<ul><li>b</li></ul></li></ul>"));
  expect("markdown: quotes, rules and code language labels", mdRender("> note\n\n---").includes("<blockquote><p>note</p></blockquote><hr>") && mdRender("```python\nprint(1)\n```").includes('data-lang="python"'));
  expect("markdown: a list right after a sentence", mdRender("Tips:\n- a\n- b") === "<p>Tips:</p><ul><li>a</li><li>b</li></ul>");

  newChat();
  current.messages = [{ role: "user", content: "plan" }, { role: "assistant", content: "Plan:\n- [ ] one\n- [x] two\n- [ ] three", model: "demo::demo" }];
  persist(current);
  renderMessages(true);
  const taskBoxes = [...document.querySelectorAll(".msg.assistant input.task-box")];
  expect("checklist: tasks become checkboxes with a progress bar", taskBoxes.length === 3 && !taskBoxes[0].disabled && taskBoxes[1].checked
    && /1 of 3 done/.test(document.querySelector(".task-progress").textContent));
  taskBoxes[0].click();
  expect("checklist: ticking a task is saved", current.messages[1].checks[0] === true && /2 of 3 done/.test(document.querySelector(".task-progress").textContent));
  renderMessages(true);
  expect("checklist: ticks survive reloads and appear in exports", document.querySelectorAll(".msg.assistant input.task-box:checked").length === 2 && conversationMarkdown(current).includes("- [x] one"));

  newChat();
  state.settings.customInstructions = "Answer like a pirate.";
  setPersona("planner", false);
  let capturedSystem = "";
  window.fetch = async (url, options) => {
    capturedSystem = JSON.parse(options.body).messages[0].content;
    const sse = 'data: {"choices":[{"delta":{"content":"Plan ready\\n\\nFollow-ups:\\n- What is step one?\\n- How long will it take?"}}]}\n\ndata: [DONE]\n\n';
    return new Response(new Blob([sse]).stream(), { status: 200 });
  };
  const modelsBeforePersona = models;
  models = [modelsBeforePersona[0], FREE_MODEL];
  fillSelect($("chat-model"), FREE_MODEL.value);
  try {
    await sendChat("Open a cafe");
  } finally {
    window.fetch = realFetch;
    models = modelsBeforePersona;
  }
  state.settings.customInstructions = "";
  expect("persona: planner prompt and custom instructions are sent", capturedSystem.includes("practical planner") && capturedSystem.includes("Answer like a pirate.") && capturedSystem.includes("Follow-ups:"));
  const plannedReply = current.messages[current.messages.length - 1];
  expect("follow-ups: suggestions are split off and shown as chips", plannedReply.content === "Plan ready" && plannedReply.followUps.length === 2 && document.querySelectorAll(".followup").length === 2);
  fillSelect($("chat-model"), "demo::demo");
  document.querySelector(".followup").click();
  const followSent = await waitUntil(() => current.messages.some((m) => m.role === "user" && m.content === "What is step one?") && !$("send-btn").disabled);
  expect("follow-ups: tapping a chip asks it", followSent && current.messages[current.messages.length - 1].content.includes("- [ ]"));

  newChat();
  $("model-picker-btn").click();
  const pickerRows = [...document.querySelectorAll("#model-list .model-row")];
  expect("picker: menu lists models, badges and locked upgrades", !$("model-menu").classList.contains("hidden") && pickerRows.some((r) => r.dataset.value === "demo::demo")
    && pickerRows.some((r) => r.dataset.locked && r.dataset.value === "puter::gpt-5-mini") && !!document.querySelector("#model-list .badge"));
  $("model-search").value = "claude";
  $("model-search").dispatchEvent(new Event("input"));
  const filteredRows = [...document.querySelectorAll("#model-list .model-row")];
  expect("picker: search filters the list", filteredRows.length >= 1 && filteredRows.every((r) => /claude/i.test(r.textContent + r.dataset.value)));
  $("model-search").value = "";
  $("model-search").dispatchEvent(new Event("input"));
  document.querySelector('#model-list [data-star="demo::demo"]').click();
  expect("picker: starred models pin to the top", state.settings.favoriteModels.includes("demo::demo") && document.querySelector("#model-list .model-group").textContent.includes("Favorites")
    && !$("model-menu").classList.contains("hidden"));
  document.querySelector('#model-list .model-row[data-value="demo::demo"]').click();
  expect("picker: choosing updates the chat and closes the menu", $("chat-model").value === "demo::demo" && current.model === "demo::demo"
    && $("model-menu").classList.contains("hidden") && $("model-picker-label").textContent === "Demo");
  $("model-picker-btn").click();
  document.querySelector('#model-list .model-row[data-locked="1"]').click();
  expect("picker: locked models lead to the free sign-in", !$("welcome-screen").classList.contains("hidden") && !!pendingModel && pendingModel.startsWith("puter::"));
  hideWelcome();
  pendingModel = null;
  $("model-picker-btn").click();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect("picker: Esc closes the menu without stopping replies", $("model-menu").classList.contains("hidden"));
  state.settings.favoriteModels = [];
  expect("persona: selector shown in chat", !$("persona-select").classList.contains("hidden"));

  $("input").value = "plan a trip to Bali";
  const improvedPrompt = await improvePrompt();
  expect("improve: ✨ rewrites the prompt in place", !!improvedPrompt && improvedPrompt.startsWith("Goal: plan a trip to Bali") && $("input").value === improvedPrompt && !$("improve-bar").classList.contains("hidden"));
  $("improve-undo").click();
  expect("improve: Undo restores the original", $("input").value === "plan a trip to Bali" && $("improve-bar").classList.contains("hidden"));
  $("input").value = "";

  newChat();
  current.messages = [{ role: "user", content: "Share me" }, { role: "assistant", content: "<think>secret</think>Shared answer\n- [ ] task", model: "demo::demo", checks: { 0: true } }];
  current.title = "Share test";
  persist(current);
  const shareUrl = await shareCurrent();
  const shareToken = (shareUrl || "").split("#share=")[1] || "";
  const decodedShare = sanitizeShared(await decodeShare(shareToken));
  expect("share: link round-trips the chat without hidden reasoning", shareUrl.startsWith(location.origin) && decodedShare.messages.length === 2
    && decodedShare.messages[1].content === "Shared answer\n- [ ] task" && decodedShare.messages[1].checks["0"] === true && decodedShare.title.includes("Share test"));
  const conversationsBefore = state.conversations.length;
  history.replaceState(null, "", `${location.pathname}#share=${shareToken}`);
  await importSharedFromHash();
  expect("share: opening a link imports a copy", state.conversations.length === conversationsBefore + 1 && current.shared === true && location.hash === "");
  history.replaceState(null, "", `${location.pathname}#selftest`);
  let rejectsBadVersion = false;
  try {
    sanitizeShared({ v: 2 });
  } catch {
    rejectsBadVersion = true;
  }
  expect("share: bad links are rejected and roles are sanitized", rejectsBadVersion && sanitizeShared({ v: 1, type: "chat", messages: [{ role: "system", content: "x" }] }).messages[0].role === "assistant");

  newChat();
  current.messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `Line ${i}\n\n${"text ".repeat(40)}` }));
  renderMessages(true);
  const scrollBox = $("messages");
  scrollBox.scrollTop = 0;
  scrollDown();
  expect("scroll: reading older messages is not interrupted", scrollBox.scrollTop === 0 && !$("jump-btn").classList.contains("hidden"));
  $("jump-btn").click();
  expect("scroll: ↓ Latest jumps to the newest message", nearBottom() && $("jump-btn").classList.contains("hidden"));

  const oldestChat = state.conversations[state.conversations.length - 1];
  togglePin(oldestChat);
  expect("history: pinned chats stay on top", oldestChat.pinned === true && document.querySelector("#history .history-item .title").textContent.startsWith("📌"));
  togglePin(oldestChat);

  const realSpeech = window.speechSynthesis;
  let spoken = null;
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speaking: false, speak: (utterance) => { spoken = utterance; }, cancel() {} } });
  newChat();
  current.messages = [{ role: "user", content: "hi" }, { role: "assistant", content: "**Halo**, apa kabar? Ini adalah jawaban yang bisa kamu dengar.", model: "demo::demo" }];
  renderMessages(true);
  const listenButton = document.querySelector("[data-speak-index]");
  if (listenButton) listenButton.click();
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: realSpeech });
  expect("voice: 🔊 reads replies aloud in the right language", !!spoken && spoken.text.includes("Halo") && !spoken.text.includes("**") && spoken.lang === "id-ID");

  // ---- v0.4: theme, welcome, guest, guided tour, Glow AI sign-in (Puter test double), sync ----
  const themeBefore = state.settings.theme;
  setTheme("dark");
  toggleTheme();
  const savedTheme = JSON.parse(localStorage.getItem(STORE_KEY)).settings.theme;
  expect("theme: toggle switches to light and is saved", document.documentElement.dataset.theme === "light" && savedTheme === "light" && $("theme-toggle").textContent === "☾");
  setTheme("system");
  expect("theme: 'match my device' follows the system setting", document.documentElement.dataset.theme === (systemLight.matches ? "light" : "dark"));
  setTheme(themeBefore);

  Object.assign(state.settings, { account: "", tourDone: false });
  newChat();
  showWelcome();
  expect("welcome: sign-in and guest choices shown", !$("welcome-screen").classList.contains("hidden") && $("signin-btn").offsetParent !== null && $("guest-btn").offsetParent !== null);
  $("guest-btn").click();
  expect("guest: continue hides welcome and is remembered", $("welcome-screen").classList.contains("hidden") && state.settings.account === "guest" && $("account-label").textContent.includes("Guest"));
  expect("tour: starts after the first choice", tour.active && !$("tour").classList.contains("hidden") && $("tour-title").textContent.includes("Welcome"));
  moveTour(1);
  const spotStyle = $("tour-spot").style;
  const pickerRect = $("model-picker-btn").getBoundingClientRect();
  const spotLeft = parseFloat(spotStyle.left);
  const spotTop = parseFloat(spotStyle.top);
  expect("tour: spotlight frames the model picker", $("tour-title").textContent === "Pick a model"
    && spotLeft <= pickerRect.left && spotLeft + parseFloat(spotStyle.width) >= pickerRect.right
    && spotTop <= pickerRect.top && spotTop + parseFloat(spotStyle.height) >= pickerRect.bottom);
  const tourCard = $("tour-card");
  const cardLeft = parseFloat(tourCard.style.left);
  const cardTop = parseFloat(tourCard.style.top);
  expect("tour: card stays inside the window", cardLeft >= 0 && cardLeft + tourCard.offsetWidth <= innerWidth && cardTop >= 0 && cardTop + tourCard.offsetHeight <= innerHeight);
  moveTour(-1);
  expect("tour: Back returns to the previous step", tour.index === 0);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  expect("tour: arrow keys navigate", tour.index === 1);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect("tour: Esc skips and is remembered", !tour.active && $("tour").classList.contains("hidden") && state.settings.tourDone === true);
  $("help-btn").click();
  const replayed = tour.active;
  for (let i = 0; i < 20 && tour.active; i++) $("tour-next").click();
  expect("tour: ? replays it and Finish closes it", replayed && !tour.active);

  const kvStore = new Map();
  const chatCalls = [];
  let chatMode = "ok";
  window.puter = {
    auth: {
      signedIn: false,
      isSignedIn() {
        return this.signedIn;
      },
      async signIn() {
        this.signedIn = true;
        return {};
      },
      async getUser() {
        return { username: "glow_tester" };
      },
      async signOut() {
        this.signedIn = false;
      },
    },
    ai: {
      async listModels() {
        return [{ id: "gpt-5-mini" }, { id: "gemini-2.5-flash" }, { id: "claude-haiku-4-5-20251001", aliases: ["claude-haiku-4-5"] }, { id: "deepseek-flash" }];
      },
      async chat(messages, options) {
        chatCalls.push({ messages, options });
        if (chatMode === "quota") throw { success: false, error: { code: "insufficient_funds", message: "Insufficient funds" } };
        const slow = chatMode === "slow";
        return (async function* stream() {
          yield { type: "reasoning", reasoning: "Thinking briefly" };
          yield { type: "text", text: "Hello " };
          if (slow) await new Promise((resolve) => setTimeout(resolve, 5000));
          yield { type: "text", text: "from Glow AI" };
        })();
      },
    },
    kv: {
      async set(key, value) {
        kvStore.set(key, value);
        return true;
      },
      async get(key) {
        return kvStore.has(key) ? kvStore.get(key) : null;
      },
      async del(key) {
        kvStore.delete(key);
        return true;
      },
    },
  };
  const phoneChat = { id: "cloud1", type: "chat", title: "From my phone", messages: [{ role: "user", content: "hi from phone" }], updated: 1 };
  kvStore.set(`${CLOUD_PREFIX}0`, JSON.stringify({ v: 1, conversations: [phoneChat], arenaStats: {}, deleted: {} }));
  kvStore.set(`${CLOUD_PREFIX}meta`, JSON.stringify({ parts: 1 }));
  showWelcome();
  const signedIn = await signIn();
  expect("sign in: account connects and shows the username", signedIn && puterSignedIn && $("account-label").textContent === "glow_tester" && $("welcome-screen").classList.contains("hidden"));
  expect("sign in: Glow AI models listed, filtered by the live catalogue", models.some((m) => m.value === "puter::gpt-5-mini") && models.some((m) => m.value === "puter::claude-haiku-4-5") && !models.some((m) => m.value === "puter::gpt-4o-mini"));
  expect("sync: chats from another device are merged in", state.conversations.some((c) => c.id === "cloud1"));
  expect("sync: local chats are uploaded to the account", JSON.parse(kvStore.get(`${CLOUD_PREFIX}meta`)).parts >= 1 && kvStore.get(`${CLOUD_PREFIX}0`).includes("Plan a picnic"));

  state.settings.allPuterModels = true;
  await loadModels();
  const showsEverything = models.some((m) => m.group.startsWith("Glow AI: all models"));
  state.settings.allPuterModels = false;
  await loadModels();
  expect("picker: signed-in users can browse every Glow AI model", showsEverything && !models.some((m) => m.group.startsWith("Glow AI: all models")));
  newChat();
  expect("sign in: new chats default to a Glow AI model", $("chat-model").value === "puter::gpt-5-mini");
  const aiReply = await sendChat("Say hello");
  const lastCall = chatCalls[chatCalls.length - 1];
  expect("glow ai: streams a reply through puter.ai.chat", aiReply.includes("Hello from Glow AI") && lastCall.options.stream === true && lastCall.options.model === "gpt-5-mini" && lastCall.messages[0].role === "system");
  expect("glow ai: reasoning kept separate from the answer", aiReply.startsWith("<think>Thinking briefly</think>") && document.querySelector(".msg.assistant details.thinking") !== null);
  chatMode = "quota";
  await sendChat("Again please");
  const notices = [...document.querySelectorAll(".msg.notice")];
  expect("glow ai: used-up allowance explained in plain words", notices.length > 0 && notices[notices.length - 1].textContent.includes("allowance"));
  chatMode = "slow";
  const slowReply = sendChat("Take your time");
  await new Promise((resolve) => setTimeout(resolve, 150));
  const stopStarted = Date.now();
  stopAll();
  await slowReply;
  expect("glow ai: Stop ends a streaming reply at once", Date.now() - stopStarted < 1000 && !$("send-btn").disabled);
  chatMode = "ok";

  clearTimeout(cloudTimer);
  const bigChat = { id: "big1", type: "chat", title: "Big", messages: [{ role: "user", content: "é".repeat(300000) }], updated: Date.now() };
  state.conversations.push(bigChat);
  await pushCloud();
  const bigMeta = JSON.parse(kvStore.get(`${CLOUD_PREFIX}meta`));
  const encoder = new TextEncoder();
  const partsSmall = [...kvStore.values()].every((value) => encoder.encode(value).length <= 400000);
  expect("sync: large data split into parts under Puter's 400 KB limit", bigMeta.parts >= 3 && partsSmall);
  state.conversations = state.conversations.filter((c) => c !== bigChat);
  state.deleted.cloud1 = Date.now();
  mergeCloud({ conversations: [{ ...phoneChat, updated: 5 }] });
  expect("sync: deleted chats stay deleted", !state.conversations.some((c) => c.id === "cloud1"));

  await signOut();
  expect("sign out: back to guest, Glow AI removed, welcome shown", !puterSignedIn && state.settings.account === "guest" && !models.some((m) => m.value.startsWith("puter::")) && !$("welcome-screen").classList.contains("hidden"));
  hideWelcome();
  clearTimeout(cloudTimer);
  delete window.puter;
  puterCatalogue = null;

  // GlowRoom link: GlowChat → GlowRoom missions and GlowRoom → GlowChat results
  expect("glowroom: sidebar link points to GlowRoom", /\/room\/(mobile\.html)?$/.test($("crewroom-link").href));
  const longGoal = crewroomGoal("Plan a bakery launch", "A".repeat(5000) + "\n\nFollow-ups:\n- What next?");
  const goalUrl = new URL(crewroomUrl("Compare 3 laptops"));
  expect("glowroom: missions carry the question and Glow's answer within 2,000 characters",
    longGoal.length <= CREWROOM_GOAL_MAX && longGoal.startsWith("Plan a bakery launch") && longGoal.includes("AAAA") && !longGoal.includes("Follow-ups")
    && goalUrl.searchParams.get("goal") === "Compare 3 laptops" && crewroomGoal("Just a question") === "Just a question");
  newChat();
  current.messages = [{ role: "user", content: "Best budget 3D printer?" }, { role: "assistant", content: "Try the Bambu A1 mini.", model: "demo::demo" }];
  renderMessages(true);
  const crewButton = [...document.querySelectorAll(".msg-actions button")].find((b) => b.textContent.includes("Ask GlowRoom"));
  const realOpen = window.open;
  let openedUrl = "";
  window.open = (url) => {
    openedUrl = String(url);
    return null;
  };
  if (crewButton) crewButton.click();
  window.open = realOpen;
  const openedGoal = openedUrl ? new URL(openedUrl).searchParams.get("goal") || "" : "";
  expect("glowroom: 🏢 Ask GlowRoom hands the question and answer to GlowRoom", !!crewButton && openedGoal.startsWith("Best budget 3D printer?") && openedGoal.includes("Bambu A1 mini"));
  const crewCountBefore = state.conversations.length;
  const handed = mergeCrewroomItems([
    { id: "crew-selftest", title: "Printer research", messages: [{ role: "user", content: "Best budget 3D printer?" }, { role: "assistant", content: "**Bambu A1 mini** — sources below." }, { role: "system", content: "ignore me" }] },
    { id: 42, messages: [] },
  ]);
  mergeCrewroomItems([{ id: "crew-selftest", title: "Printer research v2", messages: [{ role: "user", content: "q" }, { role: "assistant", content: "a" }] }]);
  if (handed) openConversation(handed);
  expect("glowroom: results arrive as one tagged chat (no duplicates, no system text)",
    !!handed && handed.source === "crewroom" && handed.messages.length === 2 && handed.title === "Printer research v2"
    && state.conversations.length === crewCountBefore + 1 && [...document.querySelectorAll("#history .history-item .title")].some((t) => t.textContent.startsWith("🏢")));
  expect("glowroom: replies from the crew are labelled GlowRoom", document.querySelector("#messages").textContent.includes("🏢 GlowRoom"));
  state.conversations = state.conversations.filter((c) => c.id !== "crew-selftest");
  renderHistory();

  const failed = results.filter((r) => r.startsWith("FAIL"));
  document.body.dataset.selftest = failed.length ? "fail" : "pass";
  if (location.hash === "#demo") return;
  const out = document.createElement("pre");
  out.id = "selftest-results";
  out.textContent = results.join("\n");
  document.body.appendChild(out);
}
async function demoCouncil() {
  newCouncil("Expert panel (3)");
  for (let i = 0; i < 3; i++) $(`agent-${i}-model`).value = "demo::demo";
  $("judge-model").value = "demo::demo";
  $("council-topic").value = "Plan a weekend product launch";
  await startCouncil(current);
}
async function demoArena() {
  newArena();
  $("arena-third").checked = true;
  $("arena-third").dispatchEvent(new Event("change"));
  for (let i = 0; i < 3; i++) $(`arena-model-${i}`).value = "demo::demo";
  $("arena-start").click();
  await sendArena("Explain how vaccines work to a 10-year-old");
  vote(0, 1);
}


/* ================= GlowRoom link (same origin: shared account + hand-offs) ================= */
// GlowRoom (../room/) uses Glow AI as its default model and hands finished results
// to Glow through this inbox, so the user can keep talking about them here. Glow sends work the
// other way with ?goal=, which GlowRoom puts in its mission box.
const CREWROOM_INBOX_KEY = "glow.inbox";
const CREWROOM_GOAL_MAX = 2000;
function crewroomUrl(goal = "") {
  const url = new URL($("crewroom-link").href);
  const text = String(goal || "").trim();
  if (text) url.searchParams.set("goal", text.slice(0, CREWROOM_GOAL_MAX));
  return url.toString();
}
// Build a mission from a question and (optionally) Glow's answer, within GlowRoom's 2,000-character limit.
function crewroomGoal(question, answer = "") {
  const ask = String(question || "").trim();
  const found = splitFollowUps(stripReasoning(String(answer || ""))).body.trim();
  if (!found) return ask.slice(0, CREWROOM_GOAL_MAX);
  const head = `${ask.slice(0, 600)}\n\nGlow's first answer (check it, research further and improve it):\n`;
  const room = CREWROOM_GOAL_MAX - head.length;
  const excerpt = found.length > room ? found.slice(0, Math.max(0, room - 1)).trimEnd() + "…" : found;
  return head + excerpt;
}
function stripReasoning(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
// Merge hand-offs from GlowRoom into the chat list. Only plain user/assistant text is kept.
function mergeCrewroomItems(items) {
  if (!Array.isArray(items) || !items.length) return null;
  let latest = null;
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !Array.isArray(item.messages)) continue;
    const messages = item.messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => (m.role === "assistant"
        ? { role: "assistant", content: m.content.slice(0, 200000), source: "crewroom" }
        : { role: "user", content: m.content.slice(0, 200000) }));
    if (!messages.length) continue;
    const id = item.id.slice(0, 120);
    const existing = state.conversations.find((c) => c.id === id);
    const conv = existing || { id, type: "chat" };
    Object.assign(conv, {
      type: "chat",
      title: String(item.title || "From GlowRoom").slice(0, 80),
      messages,
      source: "crewroom",
      model: conv.model || state.settings.lastModel,
      updated: Date.now(),
    });
    if (!existing) state.conversations.unshift(conv);
    latest = conv;
  }
  return latest;
}
function importCrewroomInbox() {
  if (TEST_MODE) return null;
  let items = [];
  try {
    items = JSON.parse(localStorage.getItem(CREWROOM_INBOX_KEY) || "[]");
  } catch {
    items = [];
  }
  localStorage.removeItem(CREWROOM_INBOX_KEY);
  const latest = mergeCrewroomItems(items);
  if (latest) {
    saveState();
    renderHistory();
  }
  return latest;
}
function openCrewroom(event) {
  // Hand whatever is typed in the box to the crew as their mission.
  const text = ($("input").value || "").trim();
  if (!text) return;
  event.preventDefault();
  window.open(crewroomUrl(text), "crewroom");
}
// "🏢 Ask the crew" under a reply: the question plus Glow's answer become the crew's mission.
function askCrew() {
  if (!current || current.type !== "chat") return;
  const messages = current.messages;
  let answerIndex = messages.length - 1;
  while (answerIndex >= 0 && messages[answerIndex].role !== "assistant") answerIndex--;
  if (answerIndex < 0) return;
  let questionIndex = answerIndex - 1;
  while (questionIndex >= 0 && messages[questionIndex].role !== "user") questionIndex--;
  const question = questionIndex >= 0 ? messages[questionIndex].content : current.title;
  window.open(crewroomUrl(crewroomGoal(question, messages[answerIndex].content)), "crewroom");
  toast("Opened GlowRoom with this as the crew's mission");
}

// Glow home can open GlowChat with a question ready (?q=) or jump back into a chat (?open=<id>).
function applyLaunchParams() {
  const params = new URLSearchParams(location.search);
  const openId = params.get("open");
  const question = params.get("q");
  if (!openId && !question) return;
  if (openId) {
    const conv = state.conversations.find((c) => c.id === openId);
    if (conv) openConversation(conv);
  }
  if (question) {
    if (!current || current.messages.length) newChat();
    $("input").value = question.slice(0, 4000);
    $("input").dispatchEvent(new Event("input", { bubbles: true }));
    $("input").focus();
  }
  history.replaceState(null, "", location.pathname + location.hash);
}

async function boot() {
  applyTheme();
  fillPersonaSelect();
  wire();
  renderAccount();
  await loadModels();
  newChat();
  const handedOff = importCrewroomInbox();
  if (handedOff) {
    openConversation(handedOff);
    if (location.hash === "#from-crewroom") history.replaceState(null, "", location.pathname);
    toast("Result from GlowRoom added to your chats");
  }
  window.addEventListener("storage", (event) => {
    if (event.key !== CREWROOM_INBOX_KEY || !event.newValue) return;
    const conv = importCrewroomInbox();
    if (conv) toast("New result from GlowRoom is in your chats");
  });
  $("crewroom-link").addEventListener("click", openCrewroom);
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  const hash = location.hash;
  if (!TEST_MODE) {
    await importSharedFromHash();
    if (!state.settings.account) showWelcome();
    if (state.settings.account === "puter" && (await restorePuterSession())) {
      await loadModels();
      if (current && current.type === "chat") fillSelect($("chat-model"), current.model);
      await pullCloud();
    }
    applyLaunchParams();
  }
  if (TEST_MODE) {
    localStorage.removeItem(STORE_KEY); // sandbox key only
    state.conversations = [];
    state.arenaStats = {};
    models = models.slice(0, 1);
    try {
      if (hash === "#demo-council") await demoCouncil();
      else if (hash === "#demo-arena") await demoArena();
      else await selfTest();
    } catch (error) {
      document.body.dataset.selftest = "error";
      const out = document.createElement("pre");
      out.id = "selftest-results";
      out.textContent = `ERROR ${error.message}\n${error.stack}`;
      document.body.appendChild(out);
    }
  }
}
boot();
