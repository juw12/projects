"use strict";
/* ==========================================================================
   Sortie · assistant — chat panel, a built-in offline helper that
   understands everyday requests, and an optional real AI (OpenAI-compatible
   or Anthropic). Both produce the same "plan" of actions, which is shown to
   the user and only runs moving / renaming / deleting after they confirm.
   ========================================================================== */

const chatState = { history: [], greeted: false, lastFilter: null };

const DEFAULT_SUGGESTIONS = [
  "Sort everything",
  "What's taking up space?",
  "Find duplicates",
  "Vacuum screenshots",
  "Put CAD files into Projects",
  "Always put invoices in Finance",
  "Add date to photo names",
];

/* ---------------- chat panel ---------------- */
function toggleChat(force) {
  const isOpen = panelState.open && panelState.tab === "assistant";
  const open = force ?? !isOpen;
  if (open) openPanel("assistant");
  else if (isOpen) closePanel();
}

function inlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
}

function renderMarkdown(text) {
  const lines = escapeHtml(text).split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    const item = line.match(/^\s*[-•*]\s+(.*)$/);
    if (item) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inlineMarkdown(item[1])}</li>`;
      continue;
    }
    if (inList) {
      html += "</ul>";
      inList = false;
    }
    if (line.trim()) html += `<p>${inlineMarkdown(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

function addBubble(role, html) {
  const bubble = document.createElement("div");
  bubble.className = `msg ${role}`;
  bubble.innerHTML = html;
  $("#chatLog").append(bubble);
  bubble.animate(
    [{ opacity: 0, transform: `translateY(10px) scale(.96)` }, { opacity: 1, transform: "none" }],
    { duration: 220, easing: "cubic-bezier(.2,.9,.3,1.2)" }
  );
  scrollChat();
  return bubble;
}

function scrollChat() {
  const log = $("#chatLog");
  log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
}

function setSuggestions(list) {
  const box = $("#chatSuggest");
  box.replaceChildren(...(list || []).map(text => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = text;
    button.onclick = () => sendChat(text);
    return button;
  }));
}

function updateProviderLabel() {
  const cfg = aiConfig();
  $("#chatProvider").textContent = cfg.id === "offline"
    ? "Built-in helper · offline"
    : `${cfg.label} · ${cfg.model || "no model set"}`;
}

function greet() {
  chatState.greeted = true;
  addBubble("bot", renderMarkdown(
    "Describe what you want done with your files. For example:\n" +
    "- “sort everything by month”\n- “vacuum duplicates”\n- “put all CAD files into Projects”\n- “what's taking up space?”\n" +
    "You'll see a plan before anything is moved, renamed or deleted."
  ));
  setSuggestions(DEFAULT_SUGGESTIONS);
}

function askAssistantAbout(files) {
  toggleChat(true);
  selectFiles(files, { scroll: false });
  const input = $("#chatInput");
  input.value = files.length === 1 ? `Tell me about "${files[0].name}"` : "What should I do with these selected files?";
  input.dispatchEvent(new Event("input"));
  input.focus();
}

async function sendChat(text) {
  text = String(text || "").trim();
  if (!text) return;
  toggleChat(true);
  $("#chatInput").value = "";
  $("#chatInput").dispatchEvent(new Event("input"));
  addBubble("user", escapeHtml(text));
  chatState.history.push({ role: "user", content: text });
  Snd.tick();
  const typing = addBubble("bot", `<span class="typing"><span></span><span></span><span></span></span>`);
  let result;
  try {
    if (settings.ai.provider === "offline") {
      await sleep(300 + Math.random() * 350);
      result = offlineAssistant(text);
    } else {
      result = await llmAssistant();
    }
  } catch (err) {
    console.error(err);
    result = offlineAssistant(text);
    result.reply = `**AI provider error:** ${err.message}\nAnswered with the built-in helper instead.\n\n${result.reply}`;
  }
  typing.remove();
  chatState.history.push({ role: "assistant", content: JSON.stringify({ reply: result.reply, actions: result.actions || [] }) });
  if (chatState.history.length > 24) chatState.history.splice(0, chatState.history.length - 24);
  showResult(result);
  Snd.ding();
}

function showResult(result) {
  const bubble = addBubble("bot", renderMarkdown(result.reply || "Done."));
  const actions = (result.actions || []).filter(a => a.type !== "stats");
  if ((result.actions || []).some(a => a.type === "stats")) bubble.append(renderStats());
  if (actions.length) showPlan(actions, bubble);
  setSuggestions(result.suggestions || contextualSuggestions());
  scrollChat();
}

function contextualSuggestions() {
  const list = [];
  if (state.history.length) list.push("Undo that");
  if (duplicateIds().size) list.push("Vacuum duplicates");
  if (state.files.some(f => f.size > 50 * MB)) list.push("Show big files");
  if (state.files.length) list.push("Sort everything");
  list.push("What's taking up space?");
  return list.slice(0, 5);
}

/* ---------------- filters (shared by offline helper and AI) ---------------- */
const asArray = value => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]);
const normType = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * filter: { all, selected, ids, types, exts, nameContains, nameRegex,
 *           minSizeMB, maxSizeMB, olderThanDays, newerThanDays, duplicates }
 * Fields combine with AND; arrays mean OR. An empty filter matches nothing.
 */
function resolveFilter(filter, pool = state.files) {
  if (!filter || typeof filter !== "object") return [];
  const now = Date.now();
  const ids = asArray(filter.ids).map(Number);
  const idSet = ids.length ? new Set(ids) : null;
  const selected = filter.selected ? new Set(selectedFiles()) : null;
  const types = asArray(filter.types).map(normType).filter(Boolean);
  const exts = asArray(filter.exts).map(e => String(e).toLowerCase().replace(/^\./, "")).filter(Boolean);
  const names = asArray(filter.nameContains).map(s => String(s).toLowerCase()).filter(Boolean);
  let regex = null;
  if (filter.nameRegex) {
    try {
      regex = new RegExp(filter.nameRegex, "i");
    } catch {
      regex = new RegExp(escapeRegex(filter.nameRegex), "i");
    }
  }
  const dupes = filter.duplicates ? duplicateIds(pool) : null;
  const num = value => (value === undefined || value === null || value === "" ? null : Number(value));
  const minMB = num(filter.minSizeMB);
  const maxMB = num(filter.maxSizeMB);
  const olderDays = num(filter.olderThanDays);
  const newerDays = num(filter.newerThanDays);
  const hasCriteria = idSet || selected || types.length || exts.length || names.length || regex || dupes ||
    minMB !== null || maxMB !== null || olderDays !== null || newerDays !== null;
  if (!hasCriteria) return filter.all ? [...pool] : [];
  return pool.filter(f => {
    const lower = f.name.toLowerCase();
    if (idSet && !idSet.has(f.id)) return false;
    if (selected && !selected.has(f)) return false;
    if (types.length) {
      const t = normType(typeOf(f.name).name);
      if (!types.some(want => t === want || t.includes(want) || want.includes(t))) return false;
    }
    if (exts.length && !exts.includes(extOf(f.name))) return false;
    if (names.length && !names.some(n => lower.includes(n))) return false;
    if (regex && !regex.test(f.name)) return false;
    if (dupes && !dupes.has(f.id)) return false;
    if (minMB !== null && f.size < minMB * MB) return false;
    if (maxMB !== null && f.size > maxMB * MB) return false;
    if (olderDays !== null && now - f.modified < olderDays * DAY_MS) return false;
    if (newerDays !== null && now - f.modified > newerDays * DAY_MS) return false;
    return true;
  });
}

function patternFromFilter(filter) {
  const parts = [];
  asArray(filter.nameContains).forEach(n => parts.push(escapeRegex(n)));
  const exts = new Set(asArray(filter.exts));
  asArray(filter.types).forEach(t => {
    const type = TYPES.find(x => normType(x.name) === normType(t));
    type?.extSet.forEach(e => exts.add(e));
  });
  if (exts.size) parts.push(`\\.(${[...exts].join("|")})$`);
  return parts.join("|");
}

/* ---------------- built-in offline helper ---------------- */
const TYPE_WORDS = [
  ["Images", /\b(images?|photos?|pictures?|pics?|wallpapers?|photographs?)\b/g],
  ["Documents", /\b(docs|documents?|paperwork|text files?)\b/g],
  ["Videos", /\b(videos?|movies?|clips?|recordings?|footage)\b/g],
  ["Audio", /\b(audio|music|songs?|podcasts?|voice memos?|sound files?|tracks?)\b/g],
  ["Archives", /\b(archives?|compressed files?)\b/g],
  ["Code", /\b(code|scripts?|source files?|source code)\b/g],
  ["3D & CAD", /\b(cad|3d|3-d|3d models?|models?|3d prints?|print files?|meshes?)\b/g],
  ["Apps", /\b(apps?|installers?|setup files?|programs?|executables?)\b/g],
];
const EXT_ALIASES = [
  [/\bword (?:files?|docs?|documents?)\b/g, ["doc", "docx"]],
  [/\b(?:excel|spreadsheets?)\b/g, ["xls", "xlsx", "csv"]],
  [/\b(?:powerpoints?|slides?|presentations?|decks?)\b/g, ["ppt", "pptx", "key"]],
  [/\bsolidworks\b/g, ["sldprt", "sldasm", "slddrw"]],
  [/\bfusion(?: files?)?\b/g, ["f3d"]],
  [/\bblender(?: files?)?\b/g, ["blend"]],
  [/\bphotoshop(?: files?)?\b/g, ["psd"]],
];
const AMBIGUOUS_EXT = new Set("c h go rs key pages numbers raw step obj tar sh rb ts iso deb pkg md gz xz css".split(" "));
const STOP_WORDS = new Set((
  "the a an all my me i you your our this that these those it them files file folder folders please can could would should will " +
  "just some any every everything stuff thing things and or of to into in on for from with without by than more less over under " +
  "bigger smaller larger older newer then also now new old big large huge small tiny last week weeks month months year years day days " +
  "ago called named name names containing contain contains word which what where who show find select move put send sort delete " +
  "remove vacuum trash clean organize organise tidy group rename help want like need make sure there here only except not get rid " +
  "throw away out up are is was were be been have has had do does did let lets let's ones one type types kind size date dates mode"
).split(" "));

const VACUUM_RE = /\b(delete|remove|vacuum|trash|erase|nuke|discard|get rid of|throw (?:away|out)|clean out|clear out|bin (?:them|it|those)|suck up|hoover)\b/;
const SORT_RE = /\b(sort|organi[sz]e|tidy|clean up|cleanup|arrange|declutter|categori[sz]e|fix (?:this|my|the) mess)\b/;
const MOVE_VERB_RE = /\b(move|put|send|stash|collect|gather|drop|place)\b/;
const RENAME_RE = /\b(rename|prefix|suffix|lower ?case|underscores?)\b|\badd (?:the )?dates?\b|\bdate ?stamp\b|\breplace\b.+\bwith\b/;
const SELECT_RE = /\b(find|show|select|which|list|search|where|highlight|look for|pick|filter|any)\b/;
const RULE_RE = /\b(always|from now on|in (?:the )?future|automatically|every time|whenever|by default)\b/;
const STATS_RE = /\b(space|storage|summary|overview|stats|statistics|how many|analy[sz]e|breakdown|insights?|what do i have|what'?s here|what is here)\b/;
const TRASH_RE = /^(the )?(trash|bin|recycle bin|garbage|rubbish|vacuum( bag)?)$/i;

function toMB(value, unit) {
  const n = parseFloat(value);
  const u = unit.toLowerCase()[0];
  return u === "k" ? n / 1024 : u === "g" ? n * 1024 : n;
}

function toDays(value, unit) {
  const n = parseFloat(value || 1);
  return n * ({ day: 1, week: 7, month: 30, year: 365 }[unit.toLowerCase()] || 1);
}

function extractFolder(raw) {
  const preps = [...raw.matchAll(/\b(?:into|to|inside|in)\b/gi)];
  for (let i = preps.length - 1; i >= 0; i--) {
    const rest = raw.slice(preps[i].index + preps[i][0].length);
    const m = rest.match(/^\s+(?:(?:a|an|the|my|new|separate|its own|their own)\s+)*(?:(?:folder|directory)\s+)?(?:(?:called|named)\s+)?["“'‘]?([^"”'’.!?,]+?)["”'’]?(?:\s+(?:folder|directory))?\s*(?:please)?\s*[.!?]*$/i);
    if (!m || !m[1].trim()) continue;
    const name = m[1].trim();
    if (/^(folders?|directories|groups?|categories|the right folders?|place|order)$/i.test(name) || /\bby\b/i.test(name)) return null;
    return { name: name.charAt(0).toUpperCase() + name.slice(1), index: preps[i].index };
  }
  return null;
}

function extractFilter(text) {
  const filter = {};
  const exts = new Set();
  const types = new Set();
  const names = new Set();
  let rest = ` ${text} `;
  const take = (re, fn) => {
    rest = rest.replace(re, (...m) => {
      fn(m);
      return " ";
    });
  };

  take(/["“‘]([^"”’]{2,})["”’]/g, m => names.add(m[1].toLowerCase()));
  take(/\bscreen ?shots?\b|\bscreen ?caps?\b/g, () => {
    names.add("screenshot");
    names.add("screen shot");
  });
  EXT_ALIASES.forEach(([re, list]) => take(re, () => list.forEach(e => exts.add(e))));
  rest = rest.replace(/(\.)?\b([a-z0-9]{1,8})\b(\s+files?)?/g, (m0, dot, word, filesWord) => {
    const candidates = word.endsWith("s") ? [word, word.slice(0, -1)] : [word];
    for (const c of candidates) {
      if (!ALL_EXTS.has(c)) continue;
      if (c === "doc" && word === "docs") continue;
      if (AMBIGUOUS_EXT.has(c) && !dot && !filesWord) continue;
      exts.add(c);
      return " ";
    }
    return m0;
  });
  TYPE_WORDS.forEach(([type, re]) => take(re, () => types.add(type)));
  take(/\b(duplicates?|dupes?|copies|doubles)\b/g, () => {
    filter.duplicates = true;
  });
  take(/\b(?:(?:bigger|larger|heavier)(?:\s+than)?|over|above|more than|greater than|>)\s*(\d+(?:\.\d+)?)\s*(kb|mb|gb|k|m|g)\b/g, m => {
    filter.minSizeMB = toMB(m[1], m[2]);
  });
  take(/\b(?:(?:smaller|lighter)(?:\s+than)?|under|below|less than|<)\s*(\d+(?:\.\d+)?)\s*(kb|mb|gb|k|m|g)\b/g, m => {
    filter.maxSizeMB = toMB(m[1], m[2]);
  });
  take(/\b(?:older than|more than|over)\s*(\d+)\s*(day|week|month|year)s?(?:\s+old)?\b/g, m => {
    filter.olderThanDays = toDays(m[1], m[2]);
  });
  take(/\b(\d+)\s*(day|week|month|year)s?\s+old\b/g, m => {
    filter.olderThanDays = toDays(m[1], m[2]);
  });
  take(/\b(?:newer than|less than|within|in the last|from the last|from last|last|past)\s*(\d+)?\s*(day|week|month|year)s?\b/g, m => {
    filter.newerThanDays = toDays(m[1], m[2]);
  });
  take(/\b(huge|giant|massive|enormous)\b/g, () => {
    filter.minSizeMB ??= 500;
  });
  take(/\b(big|large|heavy|biggest|largest|heaviest)\b/g, () => {
    filter.minSizeMB ??= 50;
  });
  take(/\b(tiny|small|smallest)\b/g, () => {
    filter.maxSizeMB ??= 1;
  });
  take(/\b(old|ancient|stale|dusty|outdated)\b/g, () => {
    filter.olderThanDays ??= 365;
  });
  take(/\b(recent|latest|today|this week)\b/g, m => {
    filter.newerThanDays ??= m[1] === "today" ? 1 : 7;
  });
  take(/\b(?:named|called|containing|contains|with the word|that (?:have|contain|include))\s+([a-z0-9_\-]+)/g, m => names.add(m[1]));
  take(/\bwith\s+([a-z0-9_\-]+)\s+in (?:the |their )?names?\b/g, m => names.add(m[1]));
  if (/\b(selected|selection)\b/.test(rest) && selectedFiles().length) filter.selected = true;

  // leftover words that actually appear in file names, e.g. "vacation", "invoice"
  const fileNames = state.files.map(f => f.name.toLowerCase());
  for (const word of rest.match(/[a-z0-9][a-z0-9_\-]{2,}/g) || []) {
    if (STOP_WORDS.has(word)) continue;
    const candidates = [word];
    if (word.endsWith("es")) candidates.push(word.slice(0, -2));
    if (word.endsWith("s")) candidates.push(word.slice(0, -1));
    const hit = candidates.find(c => c.length >= 3 && fileNames.some(n => n.includes(c)));
    if (hit) names.add(hit);
  }

  if (exts.size) filter.exts = [...exts];
  if (types.size) filter.types = [...types];
  if (names.size) filter.nameContains = [...names];
  if (!Object.keys(filter).length && /\b(all|every|everything|each|whole)\b/.test(text)) filter.all = true;
  return filter;
}

function detectMode(lower) {
  if (/\bby (date|month|months|year|time|day)\b|\bmonthly\b|\bchronolog/.test(lower)) return "date";
  if (/\bby size\b/.test(lower)) return "size";
  if (/\bby (type|kind|extension|format|category)\b/.test(lower)) return "type";
  if (/\bsmart\b|\bmy rules\b|\bwith rules\b/.test(lower)) return "smart";
  if (/\b(date|month|monthly|time) mode\b/.test(lower)) return "date";
  if (/\bsize mode\b/.test(lower)) return "size";
  if (/\b(type|kind) mode\b/.test(lower)) return "type";
  return null;
}

const describeFiles = list => `**${plural(list.length, "file")}** (${fmtSize(sumSize(list))})`;

function noMatchReply() {
  return {
    reply: "No files match that description. Try e.g. “PDFs”, “photos older than a year” or “files bigger than 100 MB”.",
    actions: [],
  };
}

function helpReply() {
  return {
    reply:
      "You can ask in plain language:\n" +
      "- **Sort**: “sort everything by month”, “tidy up my photos”\n" +
      "- **Move**: “put all STL files into 3D Prints”\n" +
      "- **Find**: “show PDFs bigger than 1 MB”, “find duplicates”\n" +
      "- **Vacuum**: “delete screenshots older than 30 days” (goes to the bag first)\n" +
      "- **Rename**: “add date to photo names”, “replace IMG with Photo”\n" +
      "- **Rules**: “always put invoices in Finance”\n" +
      "- **Info**: “what's taking up space?”, “what is a .step file?”\n" +
      "- “undo that” at any time",
    actions: [],
    suggestions: DEFAULT_SUGGESTIONS,
  };
}

function statsReply() {
  const total = sumSize(state.files);
  const biggest = [...state.files].sort((a, b) => b.size - a.size).slice(0, 3);
  const dupes = duplicateIds();
  const old = state.files.filter(f => Date.now() - f.modified > 365 * DAY_MS);
  const lines = [`You have **${plural(state.files.length, "loose file")}** using **${fmtSize(total)}**.`];
  if (biggest.length) lines.push(`Biggest: ${biggest.map(f => `${f.name} (${fmtSize(f.size)})`).join(", ")}.`);
  if (dupes.size) lines.push(`${plural(dupes.size, "duplicate")} found.`);
  if (old.length) lines.push(`${plural(old.length, "file")} older than a year.`);
  const suggestions = [];
  if (dupes.size) suggestions.push("Vacuum duplicates");
  suggestions.push("Show big files", "Sort everything");
  if (old.length) suggestions.push("Move files older than a year to Archive");
  return { reply: lines.join("\n"), actions: [{ type: "stats" }], suggestions };
}

function fileInfoReply(file) {
  const ext = extOf(file.name);
  const bucket = bucketOf(file);
  return {
    reply:
      `**${file.name}** — ${typeOf(file.name).name}, ${fmtSize(file.size)}, modified ${fmtDate(file.modified)}.\n` +
      (EXT_INFO[ext] ? `${EXT_INFO[ext]}\n` : "") +
      `When sorted it goes to **${bucket.icon} ${bucket.name}**.`,
    actions: [{ type: "select", filter: { ids: [file.id] } }],
    suggestions: [`Rename "${file.name}"`, "Vacuum it", "Sort it"],
  };
}

function renamePlan(raw, lower, filter) {
  const spec = {};
  let m;
  if (/\badd (?:the )?dates?\b|\bdate ?stamp\b|\bwith (?:the )?dates?\b/.test(lower)) spec.dateStamp = true;
  if ((m = raw.match(/\bprefix\s+(?:of\s+|with\s+)?["“']?([^"”'\s]+)["”']?/i))) spec.prefix = m[1];
  if ((m = raw.match(/\bsuffix\s+(?:of\s+|with\s+)?["“']?([^"”'\s]+)["”']?/i))) spec.suffix = m[1];
  if ((m = raw.match(/\breplace\s+["“']?(.+?)["”']?\s+with\s+["“']?(.*?)["”']?(?:\s+in\b.*)?$/i))) {
    spec.find = m[1];
    spec.replace = m[2];
  }
  if (/lower ?case/.test(lower)) spec.lowercase = true;
  if (/underscores?|no spaces|remove spaces/.test(lower)) spec.spaces = true;
  if ((m = raw.match(/\bnumber(?:ed)?\s+(?:them\s+)?as\s+["“']?([\w\- ]+?)["”']?\s*$/i))) spec.numbered = m[1];
  const single = raw.match(/\brename\s+["“']([^"”']+)["”']\s+(?:to|as)\s+["“']?([^"”']+?)["”']?\s*$/i);
  if (single) {
    const file = state.files.find(f => f.name.toLowerCase() === single[1].toLowerCase());
    if (!file) return noMatchReply();
    return {
      reply: `Rename **${file.name}** → **${sanitizeFileName(single[2])}**`,
      actions: [{ type: "rename", filter: { ids: [file.id] }, newName: sanitizeFileName(single[2]) }],
    };
  }
  if (!Object.keys(spec).length) {
    return {
      reply: "How should I rename them? For example:\n- “add date to photo names”\n- “add prefix 2025_ to PDFs”\n- “replace IMG with Photo”\n- “number the selected files as Trip”",
      actions: [],
    };
  }
  if (spec.find) {
    // "replace X with Y" only touches files whose names contain X
    const keepSelection = filter.selected;
    for (const key of Object.keys(filter)) delete filter[key];
    filter.nameContains = [spec.find.toLowerCase()];
    if (keepSelection) filter.selected = true;
  }
  if (!Object.keys(filter).length) {
    if (selectedFiles().length) filter.selected = true;
    else return { reply: "Which files should I rename? Select some, or say e.g. “add date to **photo** names”.", actions: [] };
  }
  const list = resolveFilter(filter);
  if (!list.length) return noMatchReply();
  const preview = list.slice(0, 3).map((f, i) => `- ${f.name} → **${renameName(f, spec, i)}**`).join("\n");
  return { reply: `I'll rename ${describeFiles(list)} like this:\n${preview}${list.length > 3 ? "\n- …" : ""}`, actions: [{ type: "rename", filter, ...spec }] };
}

function offlineAssistant(text) {
  const raw = text.trim();
  const lower = raw.toLowerCase().replace(/[’‘]/g, "'");
  const selection = selectedFiles();
  const wordCount = lower.split(/\s+/).length;

  if (/^(\?|help)$|what can you do|how does (?:this|it) work|\bcommands\b|what can i (?:say|ask|do)/.test(lower)) return helpReply();
  if (/^(hi|hello|hey|yo|hiya|sup|good (?:morning|afternoon|evening))\b/.test(lower) && wordCount <= 4) {
    return { reply: "Hello. What would you like to organize?", actions: [], suggestions: DEFAULT_SUGGESTIONS };
  }
  if (/\b(thanks|thank you|thx|cheers|ty)\b/.test(lower) && wordCount <= 5) {
    return { reply: "You're welcome.", actions: [] };
  }
  if (/\b(undo|revert|go back|take that back|oops)\b/.test(lower)) {
    return state.history.length
      ? { reply: "Undoing the last action.", actions: [{ type: "undo" }] }
      : { reply: "There's nothing to undo yet.", actions: [] };
  }
  if (!state.files.length && !/\b(rule|always|mode)\b/.test(lower)) {
    return { reply: "There are no loose files right now. Load the demo, open a folder or add files, then ask again.", actions: [], suggestions: [] };
  }

  const isRule = RULE_RE.test(lower);
  const hasMoveVerb = MOVE_VERB_RE.test(lower);
  const folder = hasMoveVerb || isRule ? extractFolder(raw) : null;
  const work = folder ? lower.slice(0, folder.index) : lower;
  const filter = extractFilter(work);
  const mode = detectMode(lower);

  // "them / those / it" → the selection or the last thing we talked about
  const onlyAll = Object.keys(filter).length === 1 && filter.all;
  if ((!Object.keys(filter).length || onlyAll) && /\b(them|those|these|it|that|this one)\b/.test(work)) {
    delete filter.all;
    if (selection.length) filter.selected = true;
    else if (chatState.lastFilter) Object.assign(filter, chatState.lastFilter);
  }
  const hasFilter = Object.keys(filter).length > 0;
  const actionVerb = VACUUM_RE.test(lower) || SORT_RE.test(lower) || hasMoveVerb || RENAME_RE.test(lower);

  // questions about a specific file or a file type
  if (/\b(what(?:'s| is| are)|tell me about|explain|info about|information)\b/.test(lower) && !actionVerb) {
    const named = state.files.find(f => lower.includes(f.name.toLowerCase()));
    if (named) return fileInfoReply(named);
    const ext = asArray(filter.exts)[0];
    if (ext && EXT_INFO[ext]) return { reply: `**.${ext}** — ${EXT_INFO[ext]}`, actions: [] };
  }

  if (/\b(biggest|largest|heaviest)\b/.test(lower) && !actionVerb) {
    const n = Math.min(20, parseInt(lower.match(/\b(\d+)\b/)?.[1] || "5", 10));
    const top = [...state.files].sort((a, b) => b.size - a.size).slice(0, n);
    chatState.lastFilter = { ids: top.map(f => f.id) };
    return {
      reply: `Your ${top.length} biggest files:\n${top.map(f => `- ${f.name} · **${fmtSize(f.size)}**`).join("\n")}`,
      actions: [{ type: "select", filter: { ids: top.map(f => f.id) } }],
      suggestions: ["Vacuum them", "Move them to Big stuff", "What's taking up space?"],
    };
  }

  if (STATS_RE.test(lower) && !actionVerb) return statsReply();

  if (RENAME_RE.test(lower)) return renamePlan(raw, lower, filter);

  const vacuumIntent = VACUUM_RE.test(lower) || (folder && TRASH_RE.test(folder.name));
  if (vacuumIntent) {
    if (!hasFilter) {
      if (selection.length) filter.selected = true;
      else return { reply: "Which files should be vacuumed? Try “vacuum duplicates”, “delete screenshots older than 30 days”, or select files first.", actions: [], suggestions: ["Vacuum duplicates", "Vacuum screenshots"] };
    }
    const list = resolveFilter(filter);
    if (!list.length) return noMatchReply();
    chatState.lastFilter = filter;
    return {
      reply: `Found ${describeFiles(list)} to vacuum.\nThey are moved to the Vacuum bag first and can be restored until it is emptied.`,
      actions: [{ type: "vacuum", filter }],
    };
  }

  if (!folder && hasMoveVerb && /\b(folder|directory)\b/.test(lower)) {
    const guess = asArray(filter.types)[0] || "My stuff";
    return {
      reply: "What should the folder be called?",
      actions: [],
      suggestions: [`${raw.replace(/\s*\b(in|into|to)\b.*$/i, "")} into ${guess}`, "Put them into Keep", "Put them into Archive"],
    };
  }

  if (folder && (hasMoveVerb || isRule)) {
    if (!hasFilter) {
      if (selection.length) filter.selected = true;
      else return { reply: `Which files should go into **${folder.name}**? e.g. “put all PDFs into ${folder.name}”, or select files first.`, actions: [] };
    }
    const list = resolveFilter(filter);
    const actions = [];
    if (isRule) {
      const pattern = patternFromFilter(filter);
      if (pattern) actions.push({ type: "add_rule", pattern, folder: folder.name });
    }
    if (list.length) actions.push({ type: "move", filter, folder: folder.name });
    if (!actions.length) return noMatchReply();
    chatState.lastFilter = filter;
    const reply = (isRule ? `Rule saved: matching files will go to **${folder.name}** when sorting with Smart rules.\n` : "") +
      (list.length ? `Move ${describeFiles(list)} into **${folder.name}**.` : "No files match right now, but the rule is saved.");
    return { reply, actions };
  }

  if (SORT_RE.test(lower) || (mode && /\b(sort|organi[sz]e|group)\b/.test(lower))) {
    if (/\bmode\b/.test(lower) && mode) {
      return { reply: `Switch sorting to **${MODES[mode].label}**.`, actions: [{ type: "set_mode", mode }] };
    }
    const scoped = hasFilter && !filter.all;
    const list = scoped ? resolveFilter(filter) : state.files;
    if (!list.length) return noMatchReply();
    const useMode = mode || settings.mode;
    return {
      reply: `Sort ${describeFiles(list)} ${MODES[useMode].phrase}.`,
      actions: [{ type: "sort", mode: mode || undefined, filter: scoped ? filter : undefined }],
    };
  }

  if (mode && /\b(switch|change|set|use)\b/.test(lower)) {
    return { reply: `Switch sorting to **${MODES[mode].label}**.`, actions: [{ type: "set_mode", mode }] };
  }

  if (SELECT_RE.test(lower) || hasFilter) {
    if (!hasFilter) return { reply: "What should I look for? e.g. “find PDFs bigger than 1 MB” or “show photos from last week”.", actions: [] };
    const list = resolveFilter(filter);
    if (!list.length) return noMatchReply();
    chatState.lastFilter = filter;
    const names = list.slice(0, 8).map(f => `- ${f.name} · ${fmtSize(f.size)}`).join("\n");
    return {
      reply: `Found ${describeFiles(list)}:\n${names}${list.length > 8 ? `\n- …and ${list.length - 8} more` : ""}`,
      actions: [{ type: "select", filter }],
      suggestions: ["Vacuum them", "Sort them", "Move them to a folder called Keep"],
    };
  }

  return {
    reply: "I didn't understand that request. I can **sort**, **move**, **find**, **rename** and **vacuum** files, and answer questions about them. Try one of the suggestions below, or connect an AI model in Assistant settings for free-form requests.",
    actions: [],
    suggestions: DEFAULT_SUGGESTIONS,
  };
}

/* ---------------- real AI providers ---------------- */
const PROVIDERS = {
  offline: { label: "Built-in helper (offline, free)", kind: "offline", needsKey: false },
  openai: { label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", needsKey: true },
  anthropic: { label: "Anthropic Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-haiku-latest", needsKey: true },
  gemini: { label: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash", needsKey: true },
  openrouter: { label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", needsKey: true },
  groq: { label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", needsKey: true },
  ollama: { label: "Ollama (local, free)", kind: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.2", needsKey: false, local: true },
  lmstudio: { label: "LM Studio (local, free)", kind: "openai", baseUrl: "http://localhost:1234/v1", model: "", needsKey: false, local: true },
  custom: { label: "Custom (OpenAI-compatible)", kind: "openai", baseUrl: "", model: "", needsKey: false },
};

function aiConfig() {
  const id = PROVIDERS[settings.ai.provider] ? settings.ai.provider : "offline";
  const preset = PROVIDERS[id];
  const saved = settings.ai.configs[id] || {};
  return {
    id,
    ...preset,
    baseUrl: (saved.baseUrl || preset.baseUrl || "").replace(/\/+$/, ""),
    model: saved.model || preset.model || "",
    apiKey: saved.apiKey || "",
  };
}

const SYSTEM_PROMPT = `You are the assistant inside "Sortie", a playful file-sorting app. The user sees loose files as cards and folders on the side. You help by chatting and by returning actions that the app performs with animations.

ALWAYS answer with exactly ONE JSON object and nothing else:
{"reply": "<short friendly message, simple markdown allowed>", "actions": [ ... ]}

Action types (use [] to just chat):
- {"type":"select","filter":F}  highlight matching files
- {"type":"sort","mode":"smart|type|date|size","filter":F}  sort into automatic folders (omit filter = all loose files; omit mode = current mode)
- {"type":"move","filter":F,"folder":"Folder Name"}  move files into a named folder (created if needed)
- {"type":"vacuum","filter":F}  delete files (they go to the recoverable Vacuum bag)
- {"type":"rename","filter":F,"prefix":"","suffix":"","find":"","replace":"","dateStamp":false,"lowercase":false,"spaces":false,"numbered":"","newName":""}  only include the fields you need; "newName" renames a single file exactly
- {"type":"add_rule","pattern":"regex on file name","folder":"Folder"}  remember a smart-sorting rule
- {"type":"set_mode","mode":"smart|type|date|size"}
- {"type":"search","query":"text"}  filter the visible cards by name
- {"type":"stats"}  show a storage breakdown chart
- {"type":"undo"}

Filter F (all fields optional; fields combine with AND, arrays mean OR):
{"ids":[file ids], "selected":true, "all":true, "types":["Images","Documents","Videos","Audio","Archives","Code","3D & CAD","Apps","Other"], "exts":["pdf"], "nameContains":["invoice"], "nameRegex":"...", "minSizeMB":10, "maxSizeMB":100, "olderThanDays":365, "newerThanDays":7, "duplicates":true}

Rules:
- Prefer exact "ids" from the file list when you can identify the files.
- Only use "vacuum" when the user clearly asks to delete / remove / clean out files. Never vacuum everything unless explicitly asked.
- If the request is ambiguous, ask one short question and return no actions.
- The app shows the user your plan and asks for confirmation before moving, renaming or deleting, so don't ask "are you sure" yourself.
- Keep "reply" under 70 words, clear and professional. Do not use emoji. You may also answer general questions about file types and organising.`;

function appContext() {
  const files = state.files.slice(0, 300).map(f => {
    const entry = {
      id: f.id,
      name: f.name,
      type: typeOf(f.name).name,
      sizeMB: Math.round((f.size / MB) * 100) / 100,
      modified: isoDate(f.modified),
    };
    if (f.el.classList.contains("sel")) entry.selected = true;
    return entry;
  });
  return JSON.stringify({
    today: isoDate(Date.now()),
    source: state.source,
    sortMode: settings.mode,
    smartRules: settings.rules,
    folders: [...state.folders.values()].map(e => ({ name: e.key, filesMovedIn: e.count })),
    vacuumBagCount: bagEntry.count,
    looseFileCount: state.files.length,
    files,
    filesTruncated: state.files.length > 300,
  });
}

async function readJson(res) {
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    let message = data?.error?.message || data?.error || data?.message || text.slice(0, 200) || res.statusText;
    if (typeof message !== "string") message = JSON.stringify(message);
    if (res.status === 401 || res.status === 403) message = `Key rejected (${res.status}). Check your API key in Settings → AI assistant. ${message}`;
    throw new Error(`${res.status}: ${message}`);
  }
  return data;
}

async function callLLM(messages, systemText) {
  const cfg = aiConfig();
  if (cfg.kind === "offline") throw new Error("The built-in helper doesn't need a connection.");
  if (cfg.needsKey && !cfg.apiKey) throw new Error(`Add your ${cfg.label} API key in Settings → AI assistant.`);
  if (!cfg.baseUrl) throw new Error("Set a Base URL in Settings → AI assistant.");
  if (!cfg.model) throw new Error("Set a model name in Settings → AI assistant.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    if (cfg.kind === "anthropic") {
      const firstUser = messages.findIndex(m => m.role === "user");
      const res = await fetch(`${cfg.baseUrl}/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({ model: cfg.model, max_tokens: 1024, system: systemText, messages: messages.slice(Math.max(0, firstUser)) }),
      });
      const data = await readJson(res);
      return (data.content || []).map(part => part.text || "").join("");
    }
    const headers = { "content-type": "application/json" };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    const body = { model: cfg.model, temperature: 0.2, messages: [{ role: "system", content: systemText }, ...messages] };
    if (settings.ai.jsonMode) body.response_format = { type: "json_object" };
    let res = await fetch(`${cfg.baseUrl}/chat/completions`, { method: "POST", signal: controller.signal, headers, body: JSON.stringify(body) });
    if (!res.ok && body.response_format && (res.status === 400 || res.status === 422)) {
      delete body.response_format;   // some models/servers don't support JSON mode — retry without it
      res = await fetch(`${cfg.baseUrl}/chat/completions`, { method: "POST", signal: controller.signal, headers, body: JSON.stringify(body) });
    }
    const data = await readJson(res);
    return data.choices?.[0]?.message?.content || "";
  } catch (err) {
    if (err.name === "AbortError") throw new Error("The AI took longer than 60 s to answer.");
    if (err instanceof TypeError) {
      throw new Error(`Couldn't reach ${cfg.baseUrl}. Check the URL and your internet${cfg.local ? ", and that the local server is running and allows browser requests (CORS — e.g. set OLLAMA_ORIGINS=*)" : ""}.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function loadModels() {
  const cfg = aiConfig();
  if (cfg.kind === "offline") return [];
  const headers = cfg.kind === "anthropic"
    ? { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
    : cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
  const res = await fetch(`${cfg.baseUrl}/models`, { headers });
  const data = await readJson(res);
  return (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean).sort();
}

const ACTION_TYPES = new Set(["select", "sort", "move", "vacuum", "rename", "add_rule", "set_mode", "search", "stats", "undo", "clear_filter"]);

function parseAssistantJson(raw) {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      return {
        reply: String(obj.reply ?? obj.message ?? ""),
        actions: Array.isArray(obj.actions) ? obj.actions.filter(a => a && ACTION_TYPES.has(a.type)) : [],
        suggestions: Array.isArray(obj.suggestions) ? obj.suggestions.slice(0, 5).map(String) : undefined,
      };
    } catch {
      /* fall through */
    }
  }
  return { reply: text || "(no answer)", actions: [] };
}

async function llmAssistant() {
  const system = `${SYSTEM_PROMPT}\n\nCurrent app state (JSON):\n${appContext()}`;
  const messages = chatState.history.slice(-12).map(m => ({ role: m.role, content: m.content }));
  const raw = await callLLM(messages, system);
  return parseAssistantJson(raw);
}

/* ---------------- plans: preview → confirm → run ---------------- */
const FILE_ACTIONS = new Set(["select", "sort", "move", "vacuum", "rename"]);

function actionFiles(action) {
  if (action.type === "sort" && (!action.filter || !Object.keys(action.filter).length)) return [...state.files];
  return resolveFilter(action.filter);
}

function describeAction(action) {
  const files = FILE_ACTIONS.has(action.type) ? actionFiles(action) : null;
  action._files = files;
  const n = files ? files.length : 0;
  const what = files ? `${plural(n, "file")} (${fmtSize(sumSize(files))})` : "";
  switch (action.type) {
    case "select": return { icon: "search", text: `Highlight ${what}`, files, destructive: false };
    case "sort": {
      const mode = action.mode && MODES[action.mode] ? action.mode : settings.mode;
      return { icon: "wand", text: `Sort ${what} ${MODES[mode].phrase}`, files, destructive: true };
    }
    case "move": return { icon: "folder", text: `Move ${what} into “${sanitizeFolderName(action.folder) || "New folder"}”`, files, destructive: true };
    case "vacuum": return { icon: "vacuum", text: `Vacuum ${what} into the bag`, files, destructive: true };
    case "rename": {
      const example = files[0] ? ` — e.g. ${files[0].name} → ${action.newName || renameName(files[0], action, 0)}` : "";
      return { icon: "edit", text: `Rename ${what}${example}`, files, destructive: true };
    }
    case "add_rule": return { icon: "tag", text: `Remember rule: names matching “${action.pattern}” → ${action.folder}`, destructive: false };
    case "set_mode": return { icon: "layers", text: `Switch sort mode to ${MODES[action.mode]?.label || action.mode}`, destructive: false };
    case "search": return { icon: "maximize", text: `Filter cards by “${action.query || ""}”`, destructive: false };
    case "clear_filter": return { icon: "x-circle", text: "Clear the filter", destructive: false };
    case "undo": return { icon: "undo", text: "Undo the last action", destructive: false };
    default: return { icon: "info", text: action.type, destructive: false };
  }
}

function highlightFiles(files, on) {
  $$(".card.ai-match").forEach(el => el.classList.remove("ai-match"));
  if (on) files.forEach(f => f.el.classList.add("ai-match"));
}

function showPlan(actions, bubble) {
  const steps = actions.map(describeAction);
  const plan = document.createElement("div");
  plan.className = "plan";
  for (const step of steps) {
    const row = document.createElement("div");
    row.className = "plan-step";
    row.innerHTML = `<span class="pic"></span><div><div class="tx"></div><div class="plan-files"></div></div>`;
    $(".pic", row).innerHTML = icon(step.icon);
    $(".tx", row).textContent = step.text;
    if (step.files?.length) {
      const chips = step.files.slice(0, 6).map(f => `<span>${escapeHtml(f.name)}</span>`);
      if (step.files.length > 6) chips.push(`<span>+${step.files.length - 6} more</span>`);
      $(".plan-files", row).innerHTML = chips.join("");
    }
    plan.append(row);
  }
  const status = document.createElement("div");
  status.className = "plan-status";
  const buttons = document.createElement("div");
  buttons.className = "plan-btns";
  plan.append(buttons, status);
  bubble.append(plan);

  const needsConfirm = steps.some(s => s.destructive && s.files?.length);
  const nothingToDo = steps.every(s => s.files && !s.files.length);
  if (nothingToDo) {
    plan.classList.add("done");
    status.textContent = "Nothing matched, so there's nothing to do.";
    return;
  }
  highlightFiles(steps.flatMap(s => s.files || []), true);
  if (!needsConfirm) {
    runPlan(actions, plan, status);
    return;
  }
  const go = document.createElement("button");
  go.type = "button";
  go.className = `btn small ${actions.some(a => a.type === "vacuum") ? "danger-solid" : "primary"}`;
  go.innerHTML = `${icon("play")}Run`;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn small";
  cancel.textContent = "Cancel";
  buttons.append(go, cancel);
  go.onclick = () => runPlan(actions, plan, status);
  cancel.onclick = () => {
    plan.classList.add("done");
    status.textContent = "Cancelled. Nothing was changed.";
    status.classList.add("cancelled");
    highlightFiles([], false);
  };
}

async function runPlan(actions, plan, status) {
  if (state.busy) {
    toast("Please wait for the current action to finish.");
    return;
  }
  plan.classList.add("running");
  status.textContent = "Running…";
  const visual = actions.some(a => ["sort", "move", "vacuum", "rename", "undo"].includes(a.type));
  if (visual) $("#panel").classList.add("peek");
  const historyBefore = state.history.length;
  let failed = null;
  for (const action of actions) {
    try {
      await runAction(action);
    } catch (err) {
      console.error(err);
      failed = err;
      break;
    }
  }
  $("#panel").classList.remove("peek");
  if (!actions.some(a => a.type === "select")) highlightFiles([], false);
  plan.classList.remove("running");
  plan.classList.add("done");
  if (failed) {
    status.textContent = `Stopped: ${failed.message}`;
    status.classList.add("error");
    return;
  }
  status.innerHTML = `${icon("check-circle")}<span>Done</span>`;
  if (state.history.length > historyBefore) {
    const undoButton = document.createElement("button");
    undoButton.type = "button";
    undoButton.className = "btn small";
    undoButton.textContent = "Undo";
    undoButton.onclick = async () => {
      undoButton.disabled = true;
      await undo();
      status.textContent = "Undone.";
    };
    status.append(undoButton);
  }
  scrollChat();
}

async function runAction(action) {
  const stillLoose = () => (action._files || actionFiles(action)).filter(f => state.files.includes(f));
  switch (action.type) {
    case "select":
      selectFiles(stillLoose());
      break;
    case "sort":
      if (action.mode && MODES[action.mode]) setMode(action.mode, { quiet: true });
      await sortFiles(stillLoose());
      break;
    case "move": {
      const entry = customFolderEntry(action.folder || "New folder");
      await sortFiles(stillLoose(), entry);
      break;
    }
    case "vacuum":
      await vacuumFiles(stillLoose(), { skipConfirm: true });
      break;
    case "rename": {
      const files = stillLoose();
      if (action.newName && files.length === 1) await renameFiles(files, () => sanitizeFileName(action.newName));
      else await renameFiles(files, action);
      break;
    }
    case "add_rule":
      addRule(String(action.pattern || ""), String(action.folder || ""));
      break;
    case "set_mode":
      setMode(action.mode);
      break;
    case "search":
      setFilterText(String(action.query || ""));
      break;
    case "clear_filter":
      clearFilter();
      break;
    case "undo":
      await undo();
      break;
    default:
      break;
  }
}

/* ---------------- storage chart ---------------- */
function renderStats() {
  const groups = new Map();
  for (const f of state.files) {
    const type = typeOf(f.name);
    const g = groups.get(type.name) || { type, size: 0, count: 0 };
    g.size += f.size;
    g.count++;
    groups.set(type.name, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.size - a.size);
  const max = Math.max(1, ...rows.map(r => r.size));
  const box = document.createElement("div");
  box.className = "stats";
  box.innerHTML = rows.map(r => `
    <div class="bar" title="${r.count} files">
      ${icon(r.type.icon)}<span>${escapeHtml(r.type.name)}</span>
      <div class="track"><div class="fill" style="--c:${r.type.color}" data-w="${(r.size / max) * 100}"></div></div>
      <span class="tot">${fmtSize(r.size)}</span>
    </div>`).join("");
  requestAnimationFrame(() => setTimeout(() => {
    $$(".fill", box).forEach(el => {
      el.style.width = `${Math.max(3, el.dataset.w)}%`;
    });
  }, 60));
  return box;
}
