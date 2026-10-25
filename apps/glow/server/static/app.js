"use strict";

const $ = (id) => document.getElementById(id);

let me = null;
let models = [];
let conversations = [];
let current = null;
let abortController = null;
let duetRunning = false;
let authMode = "signup";

const SYSTEM_PROMPT = "You are a helpful, accurate and thoughtful assistant. Format answers with Markdown.";

/* ---------------- API ---------------- */
async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : {},
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.upgrade = data.upgrade;
    throw error;
  }
  return data;
}

/* ---------------- Markdown ---------------- */
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
      html += `<pre><button class="copy-btn">Copy</button><code>${escapeHtml(code)}</code></pre>`;
      return;
    }
    for (const block of escapeHtml(part).split(/\n{2,}/)) {
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
document.addEventListener("click", (event) => {
  if (event.target.classList.contains("copy-btn")) {
    navigator.clipboard.writeText(event.target.nextElementSibling.textContent);
    event.target.textContent = "Copied";
    setTimeout(() => (event.target.textContent = "Copy"), 1200);
  }
});

/* ---------------- Auth ---------------- */
function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  $("auth-title").textContent = signup ? "Create your free account" : "Welcome back";
  $("auth-submit").textContent = signup ? "Sign up free" : "Log in";
  $("auth-password").autocomplete = signup ? "new-password" : "current-password";
  $("auth-switch-text").firstChild.textContent = signup ? "Already have an account? " : "New here? ";
  $("auth-switch").textContent = signup ? "Log in" : "Create an account";
  $("auth-error").textContent = "";
}
async function submitAuth() {
  $("auth-submit").disabled = true;
  $("auth-error").textContent = "";
  try {
    await api(authMode === "signup" ? "/api/signup" : "/api/login", {
      method: "POST",
      body: { email: $("auth-email").value, password: $("auth-password").value },
    });
    await boot();
  } catch (error) {
    $("auth-error").textContent = error.message;
  } finally {
    $("auth-submit").disabled = false;
  }
}

/* ---------------- Account / usage ---------------- */
async function refreshMe() {
  me = await api("/api/me");
  if (!me.user) return;
  const pro = me.user.plan === "pro";
  $("account-email").textContent = me.user.email;
  $("plan-badge").textContent = pro ? "PRO" : "FREE";
  $("plan-badge").className = "plan-badge" + (pro ? " pro" : "");
  const usage = me.usage;
  let fraction;
  if (pro && usage.monthlyBudgetUsd > 0) {
    fraction = usage.monthCostUsd / usage.monthlyBudgetUsd;
    $("usage-text").textContent = `Pro allowance used: ${Math.min(100, Math.round(fraction * 100))}% this month`;
  } else {
    fraction = usage.todayMessages / usage.dailyLimit;
    $("usage-text").textContent = `${usage.todayMessages} / ${usage.dailyLimit} messages today`;
  }
  $("usage-bar").style.width = `${Math.min(100, fraction * 100)}%`;
  $("upgrade-btn").classList.toggle("hidden", pro || !me.billingEnabled);
  $("billing-link").classList.toggle("hidden", !me.hasSubscription);
  $("pro-price").textContent = me.proPrice;
  $("free-daily").textContent = me.freeDaily;
}
async function startCheckout() {
  try {
    const { url } = await api("/api/billing/checkout", { method: "POST", body: {} });
    window.location.href = url;
  } catch (error) {
    alert(error.message);
  }
}
async function openBillingPortal() {
  try {
    const { url } = await api("/api/billing/portal", { method: "POST", body: {} });
    window.location.href = url;
  } catch (error) {
    alert(error.message);
  }
}
function showPricing() {
  if (me && me.billingEnabled) $("pricing-modal").classList.add("open");
}

/* ---------------- Models ---------------- */
async function loadModels() {
  const data = await api("/api/models");
  models = data.models;
  fillSelect($("chat-model"), current && current.model);
}
function defaultModel(offset = 0) {
  const usable = models.filter((m) => !m.locked);
  return (usable[offset] || usable[0] || {}).id || "";
}
function fillSelect(select, selected) {
  select.innerHTML = "";
  const groups = { free: "Free models", pro: me && me.user.plan === "pro" ? "Pro models" : "Pro models (upgrade to unlock)" };
  for (const tier of ["pro", "free"]) {
    const tierModels = models.filter((m) => m.tier === tier);
    if (!tierModels.length) continue;
    const group = document.createElement("optgroup");
    group.label = groups[tier];
    for (const model of tierModels) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = (model.locked ? "🔒 " : "") + model.name;
      group.appendChild(option);
    }
    select.appendChild(group);
  }
  select.value = selected && models.some((m) => m.id === selected) ? selected : defaultModel();
}
function guardLocked(select) {
  const model = models.find((m) => m.id === select.value);
  if (model && model.locked) {
    select.value = defaultModel();
    showPricing();
    return false;
  }
  return true;
}

/* ---------------- Streaming ---------------- */
async function streamReply(model, system, messages, onText) {
  abortController = new AbortController();
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    signal: abortController.signal,
    body: JSON.stringify({
      model,
      system,
      messages: messages.map((m) => ({ role: m.role, content: stripThinking(m.content) })),
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || `Error ${response.status}`);
    error.upgrade = data.upgrade;
    throw error;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    onText(full);
  }
  return full;
}
function showNotice(message, upgrade) {
  const bubble = messageElement("Notice", "notice");
  bubble.textContent = message + " ";
  if (upgrade && me.billingEnabled) {
    const button = document.createElement("button");
    button.className = "primary";
    button.textContent = "Upgrade to Pro";
    button.addEventListener("click", showPricing);
    bubble.appendChild(button);
  }
  scrollDown();
}

/* ---------------- Conversations ---------------- */
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
async function saveConversation(conv) {
  if (!conversations.includes(conv)) conversations.unshift(conv);
  renderHistory();
  try {
    await api(`/api/conversations/${conv.id}`, { method: "PUT", body: conv });
  } catch (error) {
    console.warn("save failed", error);
  }
}
async function deleteConversation(conv) {
  conversations = conversations.filter((c) => c !== conv);
  if (current === conv) newChat();
  renderHistory();
  await fetch(`/api/conversations/${conv.id}`, { method: "DELETE", credentials: "same-origin" });
}
function renderHistory() {
  const history = $("history");
  history.innerHTML = "";
  for (const conv of conversations) {
    const item = document.createElement("div");
    item.className = "history-item" + (conv === current ? " active" : "");
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = (conv.type === "duet" ? "⚖ " : "") + conv.title;
    title.addEventListener("click", () => {
      stopAll();
      openConversation(conv);
    });
    const del = document.createElement("button");
    del.className = "del";
    del.title = "Delete";
    del.textContent = "✕";
    del.addEventListener("click", () => deleteConversation(conv));
    item.append(title, del);
    history.appendChild(item);
  }
}
function newChat() {
  current = { id: newId(), type: "chat", title: "New chat", messages: [], model: $("chat-model").value || defaultModel() };
  openConversation(current);
}
function openConversation(conv) {
  current = conv;
  const isDuet = conv.type === "duet";
  $("mode-label").textContent = isDuet ? "Council" : "Chat";
  $("chat-model").classList.toggle("hidden", isDuet);
  if (!isDuet) fillSelect($("chat-model"), conv.model);
  $("input").placeholder = isDuet ? "Interject in the council (optional)…" : "Message…";
  $("duet-controls").classList.toggle("hidden", !(isDuet && conv.started));
  $("status").textContent = "";
  if (isDuet && !conv.started) renderDuetSetup(conv);
  else renderMessages();
  renderHistory();
}
function messageElement(who, cssClass) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${cssClass}`;
  const label = document.createElement("div");
  label.className = "who";
  label.textContent = who;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  wrap.append(label, bubble);
  $("messages").appendChild(wrap);
  return bubble;
}
function renderMessages() {
  $("messages").innerHTML = "";
  if (current.type === "chat" && current.messages.length === 0) {
    $("messages").innerHTML = `<div class="welcome"><h2>What can I help you with?</h2>
      <p>Pick a model above, or start a <b>Council</b> from the sidebar to have AIs deliberate on it together.</p></div>`;
    return;
  }
  for (const m of current.messages) {
    if (m.role === "user") {
      messageElement("You", "user").textContent = m.content;
    } else {
      const agent = m.agent ? current.agents[m.agent] : null;
      messageElement(agent ? agent.name : "Assistant", m.agent ? `agent-${m.agent}` : "assistant").innerHTML = renderReply(m.content);
    }
  }
  scrollDown();
}
function scrollDown() {
  $("messages").scrollTop = $("messages").scrollHeight;
}
function setBusy(busy) {
  $("send-btn").disabled = busy;
  $("stop-btn").classList.toggle("hidden", !busy);
}

/* ---------------- Chat ---------------- */
async function sendChat(text) {
  if (!guardLocked($("chat-model"))) return;
  current.model = $("chat-model").value;
  if (current.messages.length === 0) {
    current.title = text.slice(0, 40);
    $("messages").innerHTML = "";
  }
  current.messages.push({ role: "user", content: text });
  messageElement("You", "user").textContent = text;
  const bubble = messageElement("Assistant", "assistant");
  bubble.classList.add("cursor");
  setBusy(true);
  let reply = "";
  try {
    reply = await streamReply(current.model, SYSTEM_PROMPT, current.messages, (full) => {
      bubble.innerHTML = renderReply(full);
      scrollDown();
    });
  } catch (error) {
    if (error.name === "AbortError") {
      reply = bubble.textContent;
    } else {
      bubble.parentElement.remove();
      current.messages.pop();
      showNotice(error.message, error.upgrade);
    }
  }
  bubble.classList.remove("cursor");
  if (reply) {
    current.messages.push({ role: "assistant", content: reply });
    saveConversation(current);
  }
  setBusy(false);
  refreshMe();
}

/* ---------------- Agent duet ---------------- */
const DUET_PRESETS = {
  "Builder + Critic": [
    { name: "Builder", persona: "You are a creative, practical builder. Propose concrete solutions, write code or plans, and improve them based on feedback." },
    { name: "Critic", persona: "You are a sharp, constructive reviewer. Find flaws, edge cases and risks in the other agent's work and suggest specific fixes. Approve when it is genuinely good." },
  ],
  "Debate": [
    { name: "Pro", persona: "You argue FOR the proposition with strong evidence and reasoning. Respond directly to your opponent's points." },
    { name: "Con", persona: "You argue AGAINST the proposition with strong evidence and reasoning. Respond directly to your opponent's points." },
  ],
  "Teacher + Student": [
    { name: "Teacher", persona: "You are a patient expert teacher. Explain step by step and check understanding." },
    { name: "Student", persona: "You are a curious student. Ask good follow-up questions and summarize what you learned in your own words." },
  ],
  "Brainstorm": [
    { name: "Visionary", persona: "You generate bold, unconventional ideas and push them further." },
    { name: "Realist", persona: "You ground ideas in feasibility, cost and execution, then pick and refine the best ones." },
  ],
};

function newDuet() {
  const preset = DUET_PRESETS["Builder + Critic"];
  current = {
    id: newId(),
    type: "duet",
    title: "New council",
    started: false,
    topic: "",
    turns: 3,
    stopOnComplete: true,
    agents: {
      A: { ...preset[0], model: defaultModel(0) },
      B: { ...preset[1], model: defaultModel(1) },
    },
    messages: [],
  };
  openConversation(current);
}

function renderDuetSetup(conv) {
  const setup = document.createElement("div");
  setup.id = "duet-setup";
  setup.innerHTML = `
    <h2>⚖ Council</h2>
    <div class="hint">Two AI agents take turns on your task. Mix different models, and interject any time. Each agent turn counts as one message.</div>
    <div class="row" style="margin-top:0"><label class="label">Preset</label><select id="duet-preset"></select></div>
    <div class="agents" style="margin-top:12px"></div>
    <div class="field">
      <label>Task / question</label>
      <textarea id="duet-topic" rows="3" placeholder="e.g. Write a landing page headline for a vegan bakery. Builder drafts, Critic improves."></textarea>
    </div>
    <div class="row">
      <label class="label">Turns per agent</label>
      <input type="number" id="duet-turns" min="1" max="10" style="width:80px">
      <label class="label"><input type="checkbox" id="duet-stop"> Stop when agents agree ("DUET COMPLETE")</label>
      <span style="flex:1"></span>
      <button class="primary" id="duet-start">Start duet ▶</button>
    </div>`;
  $("messages").innerHTML = "";
  $("messages").appendChild(setup);

  const presetSelect = $("duet-preset");
  for (const name of Object.keys(DUET_PRESETS)) {
    const option = document.createElement("option");
    option.textContent = name;
    presetSelect.appendChild(option);
  }
  const agentsBox = setup.querySelector(".agents");
  for (const key of ["A", "B"]) {
    const card = document.createElement("div");
    card.className = `agent-card ${key}`;
    card.innerHTML = `
      <label>Agent ${key} name</label><input type="text" id="agent-${key}-name">
      <label>Model</label><select id="agent-${key}-model"></select>
      <label>Persona / role</label><textarea id="agent-${key}-persona"></textarea>`;
    agentsBox.appendChild(card);
    $(`agent-${key}-name`).value = conv.agents[key].name;
    $(`agent-${key}-persona`).value = conv.agents[key].persona;
    fillSelect($(`agent-${key}-model`), conv.agents[key].model);
    $(`agent-${key}-model`).addEventListener("change", (event) => guardLocked(event.target));
  }
  $("duet-topic").value = conv.topic;
  $("duet-turns").value = conv.turns;
  $("duet-stop").checked = conv.stopOnComplete;

  presetSelect.addEventListener("change", () => {
    const preset = DUET_PRESETS[presetSelect.value];
    ["A", "B"].forEach((key, i) => {
      $(`agent-${key}-name`).value = preset[i].name;
      $(`agent-${key}-persona`).value = preset[i].persona;
    });
  });
  $("duet-start").addEventListener("click", () => {
    for (const key of ["A", "B"]) {
      if (!guardLocked($(`agent-${key}-model`))) return;
      conv.agents[key] = {
        name: $(`agent-${key}-name`).value.trim().slice(0, 40) || `Agent ${key}`,
        model: $(`agent-${key}-model`).value,
        persona: $(`agent-${key}-persona`).value.slice(0, 2000),
      };
    }
    conv.topic = $("duet-topic").value.trim();
    if (!conv.topic) {
      $("duet-topic").focus();
      return;
    }
    conv.turns = Math.min(10, Math.max(1, parseInt($("duet-turns").value, 10) || 3));
    conv.stopOnComplete = $("duet-stop").checked;
    conv.title = conv.topic.slice(0, 40);
    conv.started = true;
    conv.messages = [{ role: "user", content: conv.topic }];
    saveConversation(conv);
    openConversation(conv);
    runDuet(conv, conv.turns);
  });
}

function duetSystemPrompt(conv, key) {
  const me_ = conv.agents[key];
  const other = conv.agents[key === "A" ? "B" : "A"];
  return `${me_.persona}

You are "${me_.name}" in a two-agent collaboration with "${other.name}". The human set this task:
"""${conv.topic}"""
Messages from ${other.name} and from the human are shown to you as user messages, prefixed with the speaker's name.
Build on, refine, or challenge the latest message. Be concise and substantive; never repeat what was already said.
Do not write lines for ${other.name}. When the task is fully and correctly finished and you both agree, end your message with: DUET COMPLETE`;
}
function duetHistoryFor(conv, key) {
  return conv.messages.map((m) => {
    if (m.agent === key) return { role: "assistant", content: m.content };
    const speaker = m.agent ? conv.agents[m.agent].name : "Human";
    return { role: "user", content: `${speaker}: ${m.content}` };
  });
}
async function runDuet(conv, turnsPerAgent) {
  duetRunning = true;
  setBusy(true);
  $("duet-controls").classList.remove("hidden");
  const lastAgent = [...conv.messages].reverse().find((m) => m.agent);
  let key = lastAgent && lastAgent.agent === "A" ? "B" : "A";
  try {
    for (let turn = 0; turn < turnsPerAgent * 2 && duetRunning && current === conv; turn++) {
      const agent = conv.agents[key];
      $("status").textContent = `${agent.name} is thinking… (turn ${turn + 1}/${turnsPerAgent * 2})`;
      const bubble = messageElement(agent.name, `agent-${key}`);
      bubble.classList.add("cursor");
      let reply = "";
      try {
        reply = await streamReply(agent.model, duetSystemPrompt(conv, key), duetHistoryFor(conv, key), (full) => {
          bubble.innerHTML = renderReply(full);
          scrollDown();
        });
      } catch (error) {
        bubble.classList.remove("cursor");
        if (error.name === "AbortError") {
          reply = bubble.textContent;
          duetRunning = false;
        } else {
          bubble.parentElement.remove();
          showNotice(error.message, error.upgrade);
          break;
        }
      }
      bubble.classList.remove("cursor");
      if (reply.trim()) {
        conv.messages.push({ role: "assistant", agent: key, content: reply.trim() });
        saveConversation(conv);
      }
      refreshMe();
      if (conv.stopOnComplete && stripThinking(reply).includes("DUET COMPLETE")) break;
      key = key === "A" ? "B" : "A";
    }
  } finally {
    duetRunning = false;
    setBusy(false);
    $("status").textContent = "Council paused. Interject or press Another round.";
  }
}

/* ---------------- Wiring ---------------- */
function stopAll() {
  duetRunning = false;
  if (abortController) abortController.abort();
}
function autoSize() {
  const input = $("input");
  input.style.height = "auto";
  input.style.height = input.scrollHeight + "px";
}
function onSend() {
  if ($("send-btn").disabled) return;
  const text = $("input").value.trim();
  if (current.type === "duet") {
    if (!current.started) return;
    if (text) {
      current.messages.push({ role: "user", content: text });
      $("input").value = "";
      autoSize();
      messageElement("You", "user").textContent = text;
    }
    runDuet(current, 1);
    return;
  }
  if (!text) return;
  $("input").value = "";
  autoSize();
  sendChat(text);
}

function wireEvents() {
  $("auth-submit").addEventListener("click", submitAuth);
  $("auth-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAuth();
  });
  $("auth-switch").addEventListener("click", () => setAuthMode(authMode === "signup" ? "login" : "signup"));

  $("send-btn").addEventListener("click", onSend);
  $("stop-btn").addEventListener("click", stopAll);
  $("duet-stop-btn").addEventListener("click", stopAll);
  $("duet-continue-btn").addEventListener("click", () => {
    if (!duetRunning) runDuet(current, current.turns);
  });
  $("input").addEventListener("input", autoSize);
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  });
  $("new-chat-btn").addEventListener("click", () => {
    stopAll();
    newChat();
  });
  $("new-duet-btn").addEventListener("click", () => {
    stopAll();
    newDuet();
  });
  $("chat-model").addEventListener("change", () => {
    if (guardLocked($("chat-model")) && current && current.type === "chat") current.model = $("chat-model").value;
  });
  $("upgrade-btn").addEventListener("click", showPricing);
  $("pricing-close").addEventListener("click", () => $("pricing-modal").classList.remove("open"));
  $("checkout-btn").addEventListener("click", startCheckout);
  $("billing-link").addEventListener("click", openBillingPortal);
  $("logout-link").addEventListener("click", async () => {
    stopAll();
    await api("/api/logout", { method: "POST", body: {} });
    window.location.reload();
  });
}

async function boot() {
  await refreshMe();
  if (!me.user) {
    $("app-view").classList.add("hidden");
    $("auth-view").classList.remove("hidden");
    setAuthMode("signup");
    return;
  }
  $("auth-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");
  await loadModels();
  const data = await api("/api/conversations");
  conversations = data.conversations;
  newChat();
  if (new URLSearchParams(location.search).get("upgraded")) {
    history.replaceState(null, "", "/");
    showNotice("Welcome to Pro! Premium models are unlocked. (If they still show as locked, refresh in a few seconds.)");
  }
}

wireEvents();
boot().catch((error) => {
  document.body.innerHTML = `<p style="padding:40px">Could not load the app: ${escapeHtml(error.message)}</p>`;
});
