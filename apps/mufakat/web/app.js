// Mufakat: free, browser-only AI chat where models deliberate to consensus.
// Modes: Chat · Council (2–3 agents + Judge) · Arena (side-by-side model vote).
// No backend: keys and chats stay in this browser (localStorage).
"use strict";

const $ = (id) => document.getElementById(id);
const TEST_HASHES = ["#selftest", "#demo", "#demo-council", "#demo-arena"];
const TEST_MODE = TEST_HASHES.includes(location.hash);
// Demos and self-tests use their own sandbox so they never touch a visitor's saved chats or keys.
const STORE_KEY = TEST_MODE ? "mufakat.sandbox" : "mufakat.v1";
const MAX_CONTEXT_CHARS = 24000;
const MAX_RETRIES = 3;
const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const SYSTEM_PROMPT = "You are a helpful, accurate and thoughtful assistant. Format answers with Markdown.";
const MAX_ATTACHMENT_CHARS = 100000;
const AGENT_COLORS = ["a", "b", "c"];

const state = loadState();
let models = [];
let current = null;
let pendingFiles = [];
const controllers = new Set();
let councilRunning = false;

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
      theme: "dark",
    },
    conversations: [],
    arenaStats: {},
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved) {
      return {
        settings: { ...defaults.settings, ...saved.settings },
        conversations: saved.conversations || [],
        arenaStats: saved.arenaStats || {},
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
}

/* ================= markdown (escaped, safe) ================= */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function inlineMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}
function renderMarkdown(source) {
  let html = "";
  source.split(/```/).forEach((part, index) => {
    if (index % 2 === 1) {
      const code = part.replace(/^[\w+-]*\n/, "");
      html += `<pre><button class="copy-btn" type="button">Copy</button><code>${escapeHtml(code)}</code></pre>`;
      return;
    }
    const spaced = part.replace(/^(#{1,6} .*)$/gm, "$1\n");
    for (const block of escapeHtml(spaced).split(/\n{2,}/)) {
      if (!block.trim()) continue;
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
        const ordered = /^\s*\d+\./.test(lines[0]);
        const items = lines.map((l) => `<li>${inlineMarkdown(l.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`).join("");
        html += ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
      } else if (/^#{1,6}\s/.test(block)) {
        const level = Math.min(block.match(/^#+/)[0].length + 2, 6);
        html += `<h${level}>${inlineMarkdown(block.replace(/^#+\s/, ""))}</h${level}>`;
      } else {
        html += `<p>${inlineMarkdown(block).replace(/\n/g, "<br>")}</p>`;
      }
    }
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
  const status = [];
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
  refreshModelSelects();
}
const PREFERRED_MODEL_PATTERNS = [/llama-3\.3-70b/i, /deepseek-(chat|v3|r1)/i, /gemini/i, /qwen.*(72b|235b|32b)/i, /mistral-(small|medium|large)/i, /gpt-oss/i, /llama/i, /qwen/i];
function modelRank(value) {
  if (value.startsWith("ollama::")) return 0; // local models the user chose to install come first
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
    const config = providerConfig(provider);
    const headers = { "Content-Type": "application/json" };
    if (config.key) headers.Authorization = `Bearer ${config.key}`;
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = location.origin;
      headers["X-Title"] = "Mufakat";
    }
    const body = JSON.stringify({ model, stream: true, messages: [{ role: "system", content: system }, ...mergeRoles(clean)] });
    const previousStatus = $("status").textContent;
    const response = await fetchWithRetry(
      () => fetch(`${config.base}/chat/completions`, { method: "POST", headers, signal: controller.signal, body }),
      controller.signal,
      (seconds, attempt) => {
        $("status").textContent = `Rate limited by the provider, retrying in ${seconds}s (${attempt}/${MAX_RETRIES})…`;
      },
    );
    $("status").textContent = previousStatus;
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(friendlyError(response.status, detail));
    }
    return await readSse(response, onText);
  } finally {
    controllers.delete(controller);
  }
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
function friendlyError(status, detail) {
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
  return `**Demo mode:** no AI model is connected, so this is a canned reply.\n\nYou wrote: *${prompt.slice(0, 200)}*\n\nFor real answers at no cost:\n1. Create a free key at openrouter.ai/keys\n2. Open **Settings** and paste it\n3. Pick any model marked *free*`;
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
  for (const conv of state.conversations) {
    if (query && !conversationText(conv).includes(query)) continue;
    const item = document.createElement("div");
    item.className = "history-item" + (conv === current ? " active" : "");
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = (MODE_ICONS[conv.type] || "") + conv.title;
    title.addEventListener("click", () => {
      stopAll();
      openConversation(conv);
      closeSidebar();
    });
    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.title = "Delete";
    del.textContent = "✕";
    del.addEventListener("click", () => {
      state.conversations = state.conversations.filter((c) => c !== conv);
      saveState();
      if (current === conv) newChat();
      else renderHistory();
    });
    item.append(title, del);
    history.appendChild(item);
  }
}
function openConversation(conv) {
  current = conv;
  const labels = { chat: "Chat", council: "Council", arena: "Arena" };
  $("mode-label").textContent = labels[conv.type];
  $("chat-model").classList.toggle("hidden", conv.type !== "chat");
  if (conv.type === "chat") fillSelect($("chat-model"), conv.model);
  $("input").placeholder = {
    chat: "Message Mufakat…",
    council: conv.started ? "Interject in the council (optional)…" : "Set up the council above…",
    arena: conv.started ? "Ask all models the same thing…" : "Pick models above, then ask…",
  }[conv.type];
  $("council-controls").classList.toggle("hidden", !(conv.type === "council" && conv.started));
  $("attach-btn").classList.toggle("hidden", conv.type === "council" && !conv.started);
  if (conv.type === "council" && !conv.started) renderCouncilSetup(conv);
  else if (conv.type === "arena" && !conv.started) renderArenaSetup(conv);
  else renderConversation();
  renderHistory();
}
function renderConversation() {
  if (current.type === "arena") renderArena();
  else renderMessages();
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
  return { name: "Mufakat", css: "assistant", meta: message.model ? modelLabel(message.model) : "" };
}
function renderMessages() {
  const box = $("messages");
  box.innerHTML = "";
  if (current.type === "chat" && current.messages.length === 0) {
    box.innerHTML = `<div class="welcome"><h2>Many minds. One answer.</h2>
      <p>Chat with any model, convene a <b>Council</b> that deliberates to consensus, or pit models against each other in the <b>Arena</b>.</p>
      <div class="welcome-actions"><button class="secondary" type="button" data-start="council">⚖ Start a council</button>
      <button class="secondary" type="button" data-start="arena">⚔ Open the arena</button></div></div>`;
    return;
  }
  current.messages.forEach((m, index) => {
    if (m.role === "user") {
      renderUserBubble(m);
    } else {
      const who = agentDisplay(current, m);
      messageElement(who.name, who.css, who.meta).innerHTML = renderReply(m.content);
    }
    if (current.type === "chat" && index === current.messages.length - 1) addChatActions();
  });
  scrollDown();
}
function addChatActions() {
  const last = current.messages[current.messages.length - 1];
  if (!last) return;
  const bar = document.createElement("div");
  bar.className = "msg-actions";
  const actions = last.role === "assistant"
    ? [["Copy", copyLast], ["↻ Regenerate", regenerate], ["Second opinion", secondOpinion], ["✎ Edit question", editLast]]
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
function scrollDown() {
  $("messages").scrollTop = $("messages").scrollHeight;
}
function setBusy(busy) {
  $("send-btn").disabled = busy;
  $("stop-btn").classList.toggle("hidden", !busy);
}
function errorText(error) {
  return error.message || "Network error. Is the provider reachable?";
}

/* ================= chat ================= */
function newChat() {
  current = { id: newId(), type: "chat", title: "New chat", messages: [], model: $("chat-model").value || state.settings.lastModel };
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
async function streamAssistant(model, system, history, who, css) {
  const bubble = messageElement(who, css, modelLabel(model));
  bubble.classList.add("cursor");
  try {
    const reply = await streamReply(model, system, history, (full) => {
      bubble.innerHTML = renderReply(full);
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
  renderMessages();
  return replyToChat();
}
async function replyToChat() {
  setBusy(true);
  const reply = await streamAssistant(current.model, SYSTEM_PROMPT, current.messages, "Mufakat", "assistant");
  if (reply) current.messages.push({ role: "assistant", content: reply, model: current.model });
  persist(current);
  setBusy(false);
  renderMessages();
  return reply;
}
function copyLast() {
  const last = current.messages[current.messages.length - 1];
  navigator.clipboard.writeText(stripThinking(last.content));
}
function regenerate() {
  if ($("send-btn").disabled) return null;
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
  renderMessages();
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
    <p class="hint">Agents take turns until they reach <b>consensus</b> (mufakat), then an impartial Judge writes the final answer. Give each agent a different model for real diversity of thought.</p>
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
  return `${self.persona}

You are "${self.name}" in a ${conv.agents.length}-agent council with ${others}. The human set this task:
"""${conv.topic}"""
Other agents' and the human's messages appear as user messages prefixed with the speaker's name.
Build on, refine, or challenge the latest points. Be concise and substantive; never repeat what was already said. Do not speak for other agents.
When the group has reached a correct, complete answer and you agree with it, end your message with: CONSENSUS`;
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
    votes.textContent = round.winner === -1 ? "You called it a tie." : `You picked ${"ABC"[round.winner]}.`;
  }
  wrap.appendChild(votes);
  $("messages").appendChild(wrap);
  return { bubbles, votes };
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
      const system = isDemo ? `${SYSTEM_PROMPT} [arena:${slot}]` : SYSTEM_PROMPT;
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
  const lines = [`# ${conv.title}`, "", `*Exported from Mufakat · ${new Date().toISOString().slice(0, 10)}*`, ""];
  if (conv.type === "arena") {
    conv.rounds.forEach((round) => {
      lines.push(`## Prompt`, "", round.prompt, "");
      round.replies.forEach((reply, i) => {
        lines.push(`### ${"ABC"[i]} · ${modelLabel(reply.model)}${round.winner === i ? " 🏆" : ""}`, "", stripThinking(reply.content), "");
      });
    });
  } else {
    for (const m of conv.messages) {
      const who = m.role === "user" ? { name: "You" } : agentDisplay(conv, m);
      lines.push(`## ${who.name}${who.meta ? ` (${who.meta})` : ""}`, "", stripThinking(m.display || m.content), "");
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
  download(`mufakat-${slug}.md`, conversationMarkdown(current), "text/markdown");
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
  $("settings-modal").classList.add("open");
}
async function saveSettings() {
  Object.assign(state.settings, {
    openrouterKey: $("set-openrouter").value.trim(),
    showPaid: $("set-paid").checked,
    ollamaUrl: $("set-ollama").value.trim() || "http://localhost:11434",
    customUrl: $("set-custom-url").value.trim(),
    customKey: $("set-custom-key").value.trim(),
  });
  saveState();
  $("settings-modal").classList.remove("open");
  await loadModels();
}
function exportAll() {
  download(`mufakat-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ conversations: state.conversations, arenaStats: state.arenaStats }, null, 2), "application/json");
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
      alert("That file isn't a Mufakat backup.");
    }
  };
  reader.readAsText(file);
}
function clearAll() {
  if (!confirm("Delete all chats, votes and keys from this browser?")) return;
  localStorage.removeItem(STORE_KEY);
  location.reload();
}
function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
  $("theme-btn").textContent = state.settings.theme === "dark" ? "☀ Light" : "☾ Dark";
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
      navigator.clipboard.writeText(target.nextElementSibling.textContent);
      target.textContent = "Copied";
      setTimeout(() => (target.textContent = "Copy"), 1200);
    }
    if (target.dataset.start === "council") newCouncil();
    if (target.dataset.start === "arena") newArena();
  });
  document.addEventListener("keydown", (e) => {
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
  for (const id of ["settings-btn", "banner-settings"]) $(id).addEventListener("click", openSettings);
  $("settings-close").addEventListener("click", () => $("settings-modal").classList.remove("open"));
  $("settings-save").addEventListener("click", saveSettings);
  $("backup-btn").addEventListener("click", exportAll);
  $("import-input").addEventListener("change", (e) => {
    if (e.target.files[0]) importAll(e.target.files[0]);
  });
  $("clear-btn").addEventListener("click", clearAll);
  $("theme-btn").addEventListener("click", () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    saveState();
    applyTheme();
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

  expect("fix: self-test uses a sandbox, never the visitor's data", STORE_KEY === "mufakat.sandbox");
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

async function boot() {
  applyTheme();
  wire();
  await loadModels();
  newChat();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  const hash = location.hash;
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
