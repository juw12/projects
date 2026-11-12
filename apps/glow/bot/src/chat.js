// GlowBot: one chat's brain.
//
// Every Telegram chat gets one ChatLogic, inside its own Durable Object. It has three entry points:
//
//   handleUpdate  answers a message or a button tap. Whatever needs no AI model is answered at
//                 once. Whatever needs one becomes a job, and an alarm is set for "now".
//   tick          runs on the alarm. One tick does one bounded unit of the job (one plan, one
//                 agent's step, one review), saves, posts the result and sets the next alarm.
//   simulate      feeds a pretend update through the same code with a Telegram stand-in that only
//                 writes the calls down. The self-test and the owner's simulator use it.
//
// Everything from outside is handed in (storage, clock, Telegram, models, web), so the tests run
// this class without Cloudflare. The whole chat lives in one stored value, "chat".

import { runAgent } from "./agent.js";
import {
  AGENTS,
  ASK_ALIASES,
  askStep,
  boardButtons,
  boardText,
  createJob,
  failJob,
  failUnit,
  planMessage,
  prepareUnit,
  runUnit,
} from "./missions.js";
import { whoAndWhere } from "./registry.js";
import { LANGS, LANG_NAMES, isLang, pickLang, t, tPlain } from "./strings.js";
import { createTelegram, escapeHtml, htmlToPlain, recordingTransport } from "./telegram.js";
import { StoppedError, clip, errorText } from "./util.js";

// ------------------------------------------------------------------ limits
const STATE_KEY = "chat";
const RECORD_PREFIX = "rec:";

export const DAILY_JOB_LIMIT = 20; // jobs per chat per day, for everyone except the owner
export const MAX_CALLS = 24; // AI calls one job may make
export const MAX_TICKS = 120; // alarm runs one job may take
export const BUSY_TRIES = 3; // waits for busy models before a step is given up
export const OUTBOX_TRIES = 3; // sends of one post before it is dropped

const BUSY_WAIT_CAP_MS = 60 * 1000;
const OUTBOX_RETRY_MS = 20 * 1000;
const FLOOD_WAITS = 10; // times one post may wait out Telegram's "too many requests"
const FLOOD_WAIT_MIN_S = 20;
const FLOOD_WAIT_MAX_S = 300;
const WATCHDOG_MS = 5 * 60 * 1000;
const HISTORY_KEEP = 16;
const HISTORY_CLIP = 2000;
const STEER_KEEP = 12;
const STEER_CLIP = 500;
const CHANGE_CLIP = 1000;
const MAX_TEXT = 4000;
const PRIVATE_NOTICE_MS = 60 * 60 * 1000;
const NEWS_CACHE_MS = 5 * 60 * 1000;
const NEWS_STORIES = 5;
const RECORD_CAP = 200;
const SIM_WIPE_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = 7 * 60 * 60 * 1000; // the owner's clock: UTC+7
const TYPING_PINGS = 6;
const TYPING_EVERY_MS = 4500;
const DAILY_TRIES = 3;
const DAILY_RETRY_MS = 10 * 60 * 1000;
const REPORT_KEEP = 6000;
const REPORT_IDS_KEEP = 12;

const COMMAND = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/;
const MODES = ["lead", "room", "chat", "agent"];
const MODE_ICONS = { lead: "👑", room: "🏢", chat: "💬", agent: "🧰" };
// The "working on it" message a job starts with. Quick jobs (chat, ask, spark) have none.
const PLACEHOLDERS = { lead: "lead.planning", room: "room.planning", agent: "harness.working" };
const JOB_ACTIONS = ["run", "chg", "can", "pau", "res", "stp", "ok", "no"];

// The Glow web apps, for /apps: the same list, in the same order, as the Glow apps menu
// (web/shared/glow-apps.js; tests/test_glow_bot.py compares the two). Telegram's own window is
// phone sized, so chat and room use their phone pages.
export const APP_LINKS = [
  { icon: "✦", name: "Glow", page: "" },
  { icon: "👑", name: "GlowLead", page: "lead/" },
  { icon: "💬", name: "GlowChat", page: "chat/mobile.html" },
  { icon: "🏢", name: "GlowRoom", page: "room/mobile.html" },
  { icon: "📰", name: "GlowNews", page: "news/" },
  { icon: "✨", name: "GlowSpark", page: "spark/" },
  { icon: "🧰", name: "GlowHarness", page: "harness/" },
  { icon: "⚡", name: "GlowCode", page: "code/" },
  { icon: "🤖", name: "GlowBot", page: "bot/" },
];

// What a simulated chat talks to instead of the real Registry, so "/access public" typed into the
// simulator can never open up the real bot.
const SIM_REGISTRY = {
  setPublic: async () => ({ ok: true, access: "private" }),
  status: async () => ({ configured: true, bot: null, access: "private", claimed: true, chats: 0 }),
  forget: async () => ({ ok: true }),
};

function freshState() {
  return {
    v: 1,
    chatId: null,
    chatType: "private",
    lang: null,
    mode: "lead",
    config: null, // { token, botUsername, botId, origin, public }: never shown to anyone
    history: [], // GlowChat's memory: { role, content }
    last: null, // the last GlowLead report: { jobId, goal, report, messageIds }
    job: null,
    done: null, // a short record of the last job that ended
    jobSeq: 0,
    outbox: [], // posts waiting to be sent, in order
    outboxAt: 0,
    notes: "", // GlowHarness's notebook for this chat (the kit's own JSON)
    daily: null, // { hour, minute, lastSent, tries, retryAt, retryDay }
    quota: { day: "", jobs: 0 },
    models: { preferred: null, cooldown: {} },
    sparkLast: null, // { id, opening } for the Again button
    record: false,
    recSeq: 0,
    msgSeq: 0,
    wipeAt: 0,
    privateNoticeAt: 0,
  };
}

// ------------------------------------------------------------------ small helpers
// The calendar day on the owner's clock, as "2026-11-12".
export function dayOf(now) {
  return new Date(now + OFFSET_MS).toISOString().slice(0, 10);
}

function minuteOfDay(now) {
  return Math.floor((((now + OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / 60000);
}

function clockText(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// When the next daily news push is due. A time in the past means "now".
export function dailyDueAt(daily, now) {
  if (daily.retryAt) return daily.retryAt;
  const dayStart = Math.floor((now + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;
  const target = dayStart + (daily.hour * 60 + daily.minute) * 60000;
  return daily.lastSent === dayOf(now) ? target + DAY_MS : target;
}

function retryAfterSeconds(description) {
  const match = /retry after (\d+)/i.exec(String(description || ""));
  return match ? Number(match[1]) : 0;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A web address that is safe inside href="...", or "" when it is not a plain http(s) link.
function safeLink(url) {
  const value = String(url || "").trim();
  if (!/^https?:\/\//i.test(value) || value.length > 400 || /\s/.test(value)) return "";
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function inRows(buttons, perRow) {
  const rows = [];
  for (let index = 0; index < buttons.length; index += perRow) rows.push(buttons.slice(index, index + perRow));
  return rows;
}

function stopButton(lang, jobId) {
  return { text: tPlain(lang, "btn.stop"), data: `stp:${jobId}` };
}

function modeButtons() {
  return inRows(
    MODES.map((mode) => ({ text: `${MODE_ICONS[mode]} ${tPlain("en", `mode.${mode}`)}`, data: `mode:${mode}` })),
    2,
  );
}

function langButtons() {
  return inRows(
    LANGS.map((code) => ({ text: LANG_NAMES[code], data: `lang:${code}` })),
    2,
  );
}

function doneRecord(job, at, status = job.status) {
  return {
    id: job.id,
    kind: job.kind,
    status,
    error: job.error || "",
    calls: job.calls || 0,
    models: (job.models || []).slice(0, 12),
    finishedAt: at,
  };
}

// How /status names a job: by the app it belongs to.
function kindName(lang, kind) {
  if (MODES.includes(kind)) return tPlain(lang, `mode.${kind}`);
  if (kind === "spark") return "GlowSpark";
  return `/${kind}`;
}

function stateName(lang, job) {
  if (["awaiting", "paused", "stopped", "done", "error"].includes(job.status)) return tPlain(lang, `board.state.${job.status}`);
  return tPlain(lang, `board.phase.${job.phase}`);
}

// ------------------------------------------------------------------ GlowNews in a message
// edition is GlowNews's news.json. Returns { html, buttons, topic } for /news, a topic button, or
// the daily push. The stories are already in display order, best first.
export function newsBody(edition, topic, lang, pages, titleKey = "news.title") {
  const topics = edition && edition.topics && typeof edition.topics === "object" ? edition.topics : {};
  const wanted = String(topic || "").trim().toLowerCase();
  const current = Object.hasOwn(topics, wanted) ? wanted : "all";
  const stories = (Array.isArray(edition && edition.stories) ? edition.stories : [])
    .filter((story) => story && story.title && (current === "all" || story.topic === current))
    .slice(0, NEWS_STORIES);

  const lines = [t(lang, titleKey)];
  if (current !== "all") lines[0] += ` · ${escapeHtml(String(topics[current]))}`;

  const briefing = edition && edition.briefing && typeof edition.briefing === "object" ? edition.briefing : null;
  const points = briefing && Array.isArray(briefing.points) ? briefing.points : [];
  if (current === "all" && briefing && (briefing.headline || points.length)) {
    lines.push("", t(lang, "news.briefing"));
    if (briefing.headline) lines.push(escapeHtml(clip(String(briefing.headline), 240)));
    for (const point of points.slice(0, 5)) {
      const words = typeof point === "string" ? point : point && point.text;
      if (words) lines.push(`• ${escapeHtml(clip(String(words), 220))}`);
    }
  }

  lines.push("");
  if (!stories.length) lines.push(t(lang, "news.empty"));
  stories.forEach((story, index) => {
    const title = escapeHtml(clip(String(story.title), 140));
    const link = safeLink(story.url);
    const source = story.source ? ` — ${escapeHtml(clip(String(story.source), 40))}` : "";
    lines.push(`${index + 1}. ${link ? `<a href="${link}">${title}</a>` : title}${source}`);
    const summary = String(story.summary || "").trim();
    if (summary) lines.push(escapeHtml(clip(summary, 180)));
  });

  const mark = (id, label) => ({ text: `${id === current ? "✓ " : ""}${label}`, data: `news:${id}` });
  const topicButtons = [mark("all", tPlain(lang, "news.topic.all"))];
  for (const [id, label] of Object.entries(topics)) topicButtons.push(mark(id, clip(String(label), 30)));
  const buttons = inRows(topicButtons, 3);
  const root = String(pages || "").replace(/\/+$/, "");
  if (root) buttons.push([{ text: tPlain(lang, "btn.more"), url: `${root}/news/` }]);
  return { html: lines.join("\n").trim(), buttons, topic: current };
}

// ------------------------------------------------------------------ the chat
export class ChatLogic {
  // deps = { storage, now, telegramFor(config), modelsFor(modelState), web, spark, registry, info, every, onError }
  //   registry  { setPublic(flag), status(), forget(chatId) }
  //   info      { pages, version, build }
  //   every     (fn, ms) => cancel: a repeating timer (the typing ping). Tests pass none.
  //   onError   (where, error): told about an error inside a tick that nothing foresaw.
  constructor(deps) {
    this.storage = deps.storage;
    this.now = deps.now || (() => Date.now());
    this.telegramFor = deps.telegramFor;
    this.modelsFor = deps.modelsFor;
    this.web = deps.web;
    this.spark = deps.spark || null;
    this.registry = deps.registry || SIM_REGISTRY;
    this.info = { pages: "", version: "", build: "", ...(deps.info || {}) };
    this.every = deps.every || (() => () => {});
    this.onError = deps.onError || (() => {});
    this.ticking = false;
    this.forget();
  }

  // Drops everything that is kept only in memory. A wipe ends with this, so the object then
  // behaves like a brand new chat.
  forget() {
    this.state = null;
    this.loading = null;
    this.flushing = false;
    this.flight = null; // { job, controller }: the unit that is running right now
    this.client = null; // { token, tg }
    this.recorder = null; // { state, tg }
    this.chain = null; // { state, models }
    this.boardShown = null; // { id, key }: the last board text sent, to skip identical edits
    this.newsCache = null; // { at, edition }
    this.simIds = [];
  }

  // One state object per chat, loaded once and shared by every handler, so a button tap that
  // arrives while a tick is waiting for a model changes the very object the tick is holding.
  load() {
    if (!this.loading) {
      this.loading = (async () => {
        const saved = await this.storage.get(STATE_KEY);
        this.state = { ...freshState(), ...(saved && typeof saved === "object" ? saved : {}) };
        return this.state;
      })();
    }
    return this.loading;
  }

  async save() {
    if (this.state) await this.storage.put(STATE_KEY, this.state);
  }

  // ---------------------------------------------------------------- Telegram
  telegram() {
    const state = this.state;
    if (state.record) {
      if (!this.recorder || this.recorder.state !== state) {
        const transport = recordingTransport({
          record: (entry) => this.record(state, entry),
          nextMessageId: () => this.simIds.shift() || 0,
        });
        this.recorder = { state, tg: createTelegram({ transport, sleep: async () => {} }) };
      }
      return this.recorder.tg;
    }
    const token = state.config ? state.config.token : "";
    if (!this.client || this.client.token !== token) this.client = { token, tg: this.telegramFor(state.config) };
    return this.client.tg;
  }

  // Record mode: every Telegram call is written down instead of sent.
  async record(state, entry) {
    if (this.state !== state) return;
    state.recSeq += 1;
    const row = { n: state.recSeq, at: this.now(), method: entry.method, payload: entry.payload };
    if (entry.method === "sendMessage") {
      state.msgSeq += 1;
      row.messageId = state.msgSeq;
      this.simIds.push(state.msgSeq);
    }
    await this.storage.put(recordKey(row.n), row);
    if (row.n > RECORD_CAP) await this.storage.delete(recordKey(row.n - RECORD_CAP));
  }

  registryNow() {
    return this.state.record ? SIM_REGISTRY : this.registry;
  }

  // A reply to a command or a tap. In a group it is threaded under the message it answers.
  reply(message, html, options = {}) {
    const state = this.state;
    const threaded = message && state.chatType !== "private" ? message.message_id : null;
    return this.telegram().send(state.chatId, html, { ...options, replyTo: options.replyTo || threaded });
  }

  // ---------------------------------------------------------------- updates
  // update is Telegram's. config and access come from the Registry's gate.
  async handleUpdate({ update, config, access = {}, record = false }) {
    const state = await this.load();
    const where = whoAndWhere(update);
    if (!where.chat) return { ok: true, ignored: true };
    if (config) state.config = config;
    state.chatId = where.chat.id;
    state.chatType = where.chat.type || "private";
    if (record) {
      state.record = true;
      state.wipeAt = this.now() + SIM_WIPE_MS;
    }
    if (!state.lang) state.lang = pickLang(where.from && where.from.language_code);
    try {
      if (where.kind === "member") await this.onMember(update.my_chat_member, access);
      else if (!access.allowed) await this.refuse(where, update, access);
      else if (where.kind === "callback") await this.onCallback(update.callback_query, access);
      else if (where.kind === "message") await this.onMessage(where.message, access);
    } finally {
      if (this.state === state) {
        await this.save();
        await this.reschedule();
      }
    }
    return { ok: true };
  }

  // The bot was added to, or removed from, this chat (or a person blocked or unblocked it).
  async onMember(change, access) {
    const state = this.state;
    const status = change && change.new_chat_member ? change.new_chat_member.status : "";
    const before = change && change.old_chat_member ? change.old_chat_member.status : "";
    if (access.gone || status === "left" || status === "kicked") {
      this.halt();
      return;
    }
    if (state.chatType === "private") return;
    const joined = (status === "member" || status === "administrator") && (!before || before === "left" || before === "kicked");
    if (!joined) return;
    if (access.allowed) {
      await this.telegram().send(state.chatId, t(state.lang, "group.hello"));
      return;
    }
    await this.leaveGroup();
  }

  // Nobody is listening any more: stop the work and send nothing further.
  halt() {
    const state = this.state;
    if (this.flight) this.flight.controller.abort();
    if (state.job) {
      state.job.halted = true;
      state.job.status = "stopped";
      state.done = doneRecord(state.job, this.now());
      state.job = null;
    }
    state.outbox = [];
    state.outboxAt = 0;
    state.daily = null;
  }

  async leaveGroup() {
    const state = this.state;
    const tg = this.telegram();
    await tg.send(state.chatId, t(state.lang, "private.leaving"));
    await tg.leave(state.chatId);
    try {
      await this.registryNow().forget(state.chatId);
    } catch (error) {
      // The list entry is only housekeeping; leaving the group is what matters.
    }
    this.halt();
  }

  // Somebody the owner has not let in.
  async refuse(where, update, access) {
    const state = this.state;
    const tg = this.telegram();
    if (where.kind === "callback") {
      await tg.answer(update.callback_query.id, tPlain(state.lang, "toast.private"), true);
      return;
    }
    if (where.kind !== "message") return;
    if (state.chatType !== "private") {
      await this.leaveGroup();
      return;
    }
    const now = this.now();
    if (state.privateNoticeAt && now - state.privateNoticeAt < PRIVATE_NOTICE_MS) return;
    state.privateNoticeAt = now;
    await tg.send(state.chatId, t(state.lang, access.ownerKnown ? "private.notice" : "start.unclaimed"));
  }

  async onMessage(message, access) {
    const state = this.state;
    const from = message.from || {};
    if (from.is_bot) return;
    let text = String(message.text || message.caption || "").trim();
    if (!text) return; // a photo, a sticker, "X joined the group"
    text = clip(text, MAX_TEXT);

    const group = state.chatType !== "private";
    const username = String((state.config && state.config.botUsername) || "");
    const command = COMMAND.exec(text);
    if (command) {
      const addressedTo = command[2] || "";
      if (addressedTo && addressedTo.toLowerCase() !== username.toLowerCase()) return; // another bot's command
      await this.onCommand(command[1].toLowerCase(), (command[3] || "").trim(), message, access, !!addressedTo);
      return;
    }

    if (group) {
      // Telegram's privacy mode only delivers commands and replies to the bot. Mentions arrive
      // when the owner turns privacy mode off in BotFather, so they are handled too.
      const repliedTo = message.reply_to_message;
      const toBot = !!(repliedTo && repliedTo.from && state.config && repliedTo.from.id === state.config.botId);
      const mention = username ? new RegExp(`@${escapeRegExp(username)}(?![A-Za-z0-9_])`, "i") : null;
      const mentioned = !!(mention && mention.test(text));
      if (!toBot && !mentioned) return;
      if (mentioned) text = text.replace(new RegExp(mention.source, "ig"), "").trim();
      if (!text) return;
    }
    await this.onText(text, message, access);
  }

  // ---------------------------------------------------------------- commands
  async onCommand(name, arg, message, access, addressed) {
    const state = this.state;
    const lang = state.lang;
    switch (name) {
      case "start":
        return this.cmdStart(message, access);
      case "help": {
        // /access is not in the public command list, so only the owner's own chat shows it.
        const forOwner = access.role === "owner" && state.chatType === "private";
        const help = t(lang, "help");
        return this.reply(message, forOwner ? `${help}\n\n${t(lang, "help.owner")}` : help);
      }
      case "agents":
        return this.cmdAgents(message);
      case "apps":
        return this.cmdApps(message);
      case "status":
        return this.cmdStatus(message, access);
      case "stop":
        return this.cmdStop(message, access);
      case "lang":
        return this.cmdLang(arg, message);
      case "daily":
        return this.cmdDaily(arg, message);
      case "access":
        return this.cmdAccess(arg, message, access);
      case "news":
        return this.cmdNews(arg, message);
      case "lead":
      case "room":
      case "chat":
      case "agent":
      case "harness": {
        const kind = name === "harness" ? "agent" : name;
        if (arg) return this.startJob(kind, arg, message, access);
        state.mode = kind;
        return this.reply(message, t(lang, "mode.set", { mode: tPlain(lang, `mode.${kind}`) }));
      }
      case "ask":
        return this.cmdAsk(arg, message, access);
      case "spark":
        if (!arg) return this.reply(message, t(lang, "spark.usage"));
        return this.startJob("spark", arg, message, access);
      default:
        // In a group "/something" may be meant for another bot, so only answer when named.
        if (state.chatType !== "private" && !addressed) return null;
        return this.reply(message, t(lang, "unknown.command"));
    }
  }

  async cmdStart(message, access) {
    const state = this.state;
    const lang = state.lang;
    if (state.chatType !== "private") {
      await this.reply(message, t(lang, "group.hello"));
      return;
    }
    if (access.claimed) await this.reply(message, t(lang, "start.owner"));
    await this.reply(message, t(lang, "start.hello"), { buttons: modeButtons() });
  }

  async cmdAgents(message) {
    const lang = this.state.lang;
    const lines = [t(lang, "agents.title")];
    for (const agent of Object.values(AGENTS)) {
      lines.push(`${agent.icon} <b>${escapeHtml(agent.name)}</b>: ${t(lang, `agent.role.${agent.key}`)}`);
    }
    lines.push("", t(lang, "agents.how"));
    await this.reply(message, lines.join("\n"));
  }

  // Buttons to the Glow web apps. In a private chat they open inside Telegram; a group only
  // allows plain links, and plain links are also the fallback when Telegram refuses the first kind.
  async cmdApps(message) {
    const state = this.state;
    const root = String(this.info.pages || "").replace(/\/+$/, "");
    const rows = (inside) =>
      inRows(
        APP_LINKS.map((app) => {
          const text = `${app.icon} ${app.name}`;
          const url = `${root}/${app.page}`;
          return inside ? { text, webApp: url } : { text, url };
        }),
        2,
      );
    const title = t(state.lang, "apps.title");
    if (state.chatType === "private") {
      const sent = await this.reply(message, title, { buttons: rows(true) });
      if (sent.ok) return;
    }
    await this.reply(message, title, { buttons: rows(false) });
  }

  async cmdStatus(message, access = {}) {
    const state = this.state;
    const lang = state.lang;
    const job = state.job;
    const jobsToday = state.quota.day === dayOf(this.now()) ? state.quota.jobs : 0;
    const isPublic = !!(state.config && state.config.public);
    // The daily limit does not apply to the owner, so their line does not show one.
    const today = access.role === "owner"
      ? t(lang, "status.today.owner", { n: jobsToday })
      : t(lang, "status.today", { n: jobsToday, limit: DAILY_JOB_LIMIT });
    const lines = [
      t(lang, "status.title", { version: this.info.version }),
      t(lang, "status.mode", { mode: tPlain(lang, `mode.${state.mode}`) }),
      t(lang, "status.lang", { lang: LANG_NAMES[lang] || lang }),
      t(lang, "status.access", { access: tPlain(lang, isPublic ? "access.name.public" : "access.name.private") }),
      job ? t(lang, "status.job", { kind: kindName(lang, job.kind), state: stateName(lang, job) }) : t(lang, "status.nojob"),
      today,
      state.daily ? t(lang, "status.daily", { time: clockText(state.daily.hour, state.daily.minute) }) : t(lang, "status.daily.off"),
    ];
    await this.reply(message, lines.join("\n"));
  }

  async cmdStop(message, access) {
    const state = this.state;
    const lang = state.lang;
    const job = state.job;
    if (!job) {
      await this.reply(message, t(lang, "nothing.running"));
      return;
    }
    if (!this.mayControl(job, message.from, access)) {
      await this.reply(message, t(lang, "toast.owner"));
      return;
    }
    await this.stopJob(job);
    await this.reply(message, t(lang, "stopped"));
  }

  async cmdLang(arg, message) {
    const state = this.state;
    const code = LANGS.find((item) => item.toLowerCase() === arg.toLowerCase());
    if (code) {
      state.lang = code;
      await this.reply(message, t(code, "lang.set"));
      return;
    }
    await this.reply(message, t(state.lang, "lang.pick"), { buttons: langButtons() });
  }

  // /daily 07:30 or /daily off. The time is on the owner's clock (UTC+7).
  async cmdDaily(arg, message) {
    const state = this.state;
    const lang = state.lang;
    const value = arg.toLowerCase();
    if (value === "off") {
      state.daily = null;
      await this.reply(message, t(lang, "daily.off"));
      return;
    }
    const match = /^(\d{1,2})[:.](\d{2})$/.exec(value);
    const hour = match ? Number(match[1]) : 99;
    const minute = match ? Number(match[2]) : 99;
    if (hour > 23 || minute > 59) {
      await this.reply(message, t(lang, "daily.usage"));
      return;
    }
    // Set after today's time has passed: the first push is tomorrow, not at once.
    const now = this.now();
    const passed = minuteOfDay(now) >= hour * 60 + minute;
    state.daily = { hour, minute, lastSent: passed ? dayOf(now) : "", tries: 0, retryAt: 0, retryDay: "" };
    await this.reply(message, t(lang, "daily.set", { time: clockText(hour, minute) }));
  }

  async cmdAccess(arg, message, access) {
    const state = this.state;
    const lang = state.lang;
    if (access.role !== "owner") {
      await this.reply(message, t(lang, "access.owner.only"));
      return;
    }
    const value = arg.toLowerCase();
    if (value === "public" || value === "private") {
      const open = value === "public";
      await this.registryNow().setPublic(open);
      if (state.config) state.config.public = open;
      await this.reply(message, t(lang, open ? "access.public" : "access.private"));
      return;
    }
    const status = await this.registryNow().status();
    const mode = tPlain(lang, status.access === "public" ? "access.name.public" : "access.name.private");
    await this.reply(message, t(lang, "access.view", { mode, n: status.chats || 0 }));
  }

  async cmdAsk(arg, message, access) {
    const lang = this.state.lang;
    if (!arg) {
      await this.reply(message, t(lang, "ask.usage"));
      return;
    }
    const typed = arg.split(/\s+/)[0];
    const name = typed.toLowerCase().replace(/^@/, "");
    const botId = Object.hasOwn(ASK_ALIASES, name) ? ASK_ALIASES[name] : null;
    if (!botId) {
      await this.reply(message, t(lang, "ask.unknown", { name: clip(typed, 40) }));
      return;
    }
    const task = arg.slice(typed.length).trim();
    if (!task) {
      await this.reply(message, t(lang, "need.text", { example: `/ask ${name} …` }));
      return;
    }
    await this.startJob("ask", task, message, access, { steps: [askStep(botId, task)] });
  }

  async edition() {
    const now = this.now();
    if (this.newsCache && now - this.newsCache.at < NEWS_CACHE_MS) return this.newsCache.edition;
    const edition = await this.web.news();
    this.newsCache = { at: now, edition };
    return edition;
  }

  async cmdNews(arg, message) {
    const state = this.state;
    let edition;
    try {
      edition = await this.edition();
    } catch (error) {
      await this.reply(message, t(state.lang, "news.error"));
      return;
    }
    const view = newsBody(edition, arg, state.lang, this.info.pages, "news.title");
    await this.reply(message, view.html, { buttons: view.buttons });
  }

  // ---------------------------------------------------------------- plain text
  // In a private chat everything that is not a command lands here. What it means depends on
  // what is going on: a change to a waiting plan, a note to a working team, or a new job.
  async onText(text, message, access) {
    const state = this.state;
    const lang = state.lang;
    const job = state.job;
    if (!job) {
      await this.startJob(state.mode, text, message, access);
      return;
    }
    const mine = this.mayControl(job, message.from, access);
    const team = job.kind === "lead" || job.kind === "room";
    if (mine && job.kind === "lead" && job.status === "awaiting") {
      await this.replan(job, text, message);
      return;
    }
    if (mine && team && (job.status === "active" || job.status === "paused")) {
      job.steer.push(clip(text, STEER_CLIP));
      if (job.steer.length > STEER_KEEP) job.steer.splice(0, job.steer.length - STEER_KEEP);
      await this.reply(message, t(lang, "steer.noted"));
      return;
    }
    await this.reply(message, t(lang, "busy"), { buttons: [[stopButton(lang, job.id)]] });
  }

  // In a group, only the person who started a job, or the owner, may steer or stop it.
  mayControl(job, from, access) {
    return access.role === "owner" || !!(from && from.id === job.by);
  }

  async replan(job, text, message) {
    const state = this.state;
    const lang = state.lang;
    const tg = this.telegram();
    const oldPlan = job.planId;
    const leftover = job.statusId; // the "planning…" line of a plan that could not be sent
    job.change = clip(text, CHANGE_CLIP);
    job.phase = "plan";
    job.status = "active";
    job.planId = null;
    job.statusId = null;
    // A plan that was still waiting to be sent is dropped, and so is its "planning…" line.
    const unsent = state.outbox.filter((item) => item.jobId === job.id && item.tag === "plan");
    state.outbox = state.outbox.filter((item) => !unsent.includes(item));
    if (oldPlan) await tg.removeButtons(state.chatId, oldPlan);
    for (const item of unsent) if (item.dropId) await this.dropMessage(item.dropId);
    if (leftover) await this.dropMessage(leftover);
    const sent = await this.reply(message, t(lang, "lead.replanning"), { buttons: [[stopButton(lang, job.id)]], silent: true });
    if (sent.ok && state.job === job) job.statusId = sent.messageId;
  }

  // ---------------------------------------------------------------- jobs
  // Starts a job. The work itself happens on the alarm, one unit at a time.
  async startJob(kind, text, message, access, options = {}) {
    const state = this.state;
    const lang = state.lang;
    const now = this.now();
    const tg = this.telegram();
    const from = (message && message.from) || options.from || {};
    const current = state.job;
    if (current && (current.status === "active" || current.status === "paused" || !this.mayControl(current, from, access))) {
      await this.reply(message, t(lang, "busy"), { buttons: [[stopButton(lang, current.id)]] });
      return;
    }
    const today = dayOf(now);
    if (state.quota.day !== today) state.quota = { day: today, jobs: 0 };
    if (access.role !== "owner" && state.quota.jobs >= DAILY_JOB_LIMIT) {
      await this.reply(message, t(lang, "quota", { n: DAILY_JOB_LIMIT }));
      return;
    }
    state.quota.jobs += 1;

    // A goal sent as a reply to the last report is a follow-up: the team gets that report as background.
    let context = "";
    const repliedTo = message && message.reply_to_message ? message.reply_to_message.message_id : null;
    if (kind === "lead" && repliedTo && state.last && state.last.messageIds.includes(repliedTo)) {
      context = `Goal: ${state.last.goal}\n\nResult:\n${clip(state.last.report, 3000)}`;
    }

    state.jobSeq += 1;
    const job = createJob({
      id: String(state.jobSeq),
      kind,
      goal: text,
      by: from.id || 0,
      at: now,
      replyTo: message ? message.message_id : options.replyTo || null,
      context,
      steps: options.steps || [],
    });
    job.ticks = 0;
    job.retryId = null;
    state.job = job; // before the first await, so a tap that arrives meanwhile sees this job

    if (current) {
      // A plan or a question that was still waiting for an answer gives way to the new job.
      current.halted = true;
      current.status = "stopped";
      state.done = doneRecord(current, now, "cancelled");
      const orphans = state.outbox.filter((item) => item.jobId === current.id && item.dropId).map((item) => item.dropId);
      state.outbox = state.outbox.filter((item) => item.jobId !== current.id);
      if (current.planId) await tg.removeButtons(state.chatId, current.planId);
      if (current.askId) await tg.removeButtons(state.chatId, current.askId);
      if (current.statusId) await this.dropMessage(current.statusId);
      if (current.retryId) await this.dropMessage(current.retryId);
      for (const id of orphans) await this.dropMessage(id);
    }

    const placeholder = PLACEHOLDERS[kind];
    if (!placeholder) return;
    const sent = await tg.send(state.chatId, t(lang, placeholder), {
      buttons: [[stopButton(lang, job.id)]],
      silent: true,
      replyTo: state.chatType !== "private" ? job.replyTo : null,
    });
    if (!sent.ok) return;
    if (state.job === job) job.statusId = sent.messageId;
    else await tg.edit(state.chatId, sent.messageId, t(lang, "stopped"), { buttons: [] });
  }

  // ---------------------------------------------------------------- button taps
  async onCallback(query, access) {
    const state = this.state;
    const lang = state.lang;
    const tg = this.telegram();
    const [action, first = "", second = ""] = String(query.data || "").split(":");
    const messageId = query.message ? query.message.message_id : null;
    const from = query.from || {};
    const toast = (key, alert = false) => tg.answer(query.id, tPlain(lang, key), alert);
    const stale = async () => {
      await toast("toast.stale");
      if (messageId) await tg.removeButtons(state.chatId, messageId);
    };

    if (action === "lang") {
      if (!isLang(first)) return toast("toast.stale");
      state.lang = first;
      await tg.answer(query.id, tPlain(first, "toast.ok"));
      if (messageId) await tg.edit(state.chatId, messageId, t(first, "lang.set"), { buttons: [] });
      return null;
    }
    if (action === "mode") {
      if (!MODES.includes(first)) return toast("toast.stale");
      state.mode = first;
      await toast("toast.ok");
      await tg.send(state.chatId, t(lang, "mode.set", { mode: tPlain(lang, `mode.${first}`) }));
      return null;
    }
    if (action === "news") {
      let edition;
      try {
        edition = await this.edition();
      } catch (error) {
        return tg.answer(query.id, htmlToPlain(t(lang, "news.error")), true);
      }
      await toast("toast.ok");
      const view = newsBody(edition, first, lang, this.info.pages, "news.title");
      if (messageId) await tg.edit(state.chatId, messageId, view.html, { buttons: view.buttons });
      return null;
    }
    if (action === "agn") {
      const last = state.sparkLast;
      if (!last || last.id !== first) return stale();
      await toast("toast.ok");
      return this.startJob("spark", last.opening, null, access, { from, replyTo: messageId });
    }

    if (!JOB_ACTIONS.includes(action)) return stale();
    const job = state.job;
    if (!job || job.id !== first) return stale();
    if (!this.mayControl(job, from, access)) return toast("toast.owner", true);
    // A plan's buttons count only on the plan that is waiting now: after a re-plan the old plan's are stale.
    const planWaiting = job.kind === "lead" && job.status === "awaiting" && (!messageId || messageId === job.planId);

    if (action === "run") {
      if (!planWaiting) return stale();
      const planId = messageId || job.planId;
      job.status = "active"; // before any await, so a second tap is stale
      job.planId = null; // its buttons go right here, so a later Stop need not take them off again
      await toast("toast.ok");
      if (planId) await tg.removeButtons(state.chatId, planId);
      if (state.job !== job) return null; // stopped meanwhile
      const view = this.boardView(job);
      const sent = await tg.send(state.chatId, view.html, { buttons: view.buttons, silent: true });
      if (!sent.ok) return null;
      if (state.job === job) {
        job.boardId = sent.messageId;
        this.boardShown = { id: job.id, key: view.key };
      } else {
        await tg.edit(state.chatId, sent.messageId, boardText(job, lang), { buttons: [] });
      }
      return null;
    }
    if (action === "chg") {
      if (!planWaiting) return stale();
      await toast("toast.ok");
      await tg.send(state.chatId, t(lang, "lead.change.how"), { replyTo: messageId || job.planId });
      return null;
    }
    if (action === "can") {
      if (!planWaiting) return stale();
      job.halted = true;
      job.status = "stopped";
      state.done = doneRecord(job, this.now(), "cancelled");
      state.job = null;
      state.outbox = state.outbox.filter((item) => item.jobId !== job.id);
      await toast("toast.ok");
      const planId = messageId || job.planId;
      if (planId) await tg.removeButtons(state.chatId, planId);
      await tg.send(state.chatId, t(lang, "lead.cancelled"));
      return null;
    }
    if (action === "pau") {
      if (job.status !== "active") return toast("toast.stale");
      job.status = "paused";
      await tg.answer(query.id, htmlToPlain(t(lang, "paused")));
      await this.showBoard(job);
      return null;
    }
    if (action === "res") {
      if (job.status !== "paused") return toast("toast.stale");
      job.status = "active";
      job.retryAt = 0;
      await tg.answer(query.id, htmlToPlain(t(lang, "resumed")));
      await this.showBoard(job);
      return null;
    }
    if (action === "stp") {
      this.markStopped(job);
      await tg.answer(query.id, htmlToPlain(t(lang, "stopped")));
      await this.tidyStopped(job);
      if (messageId && messageId !== job.boardId && messageId !== job.statusId) await tg.removeButtons(state.chatId, messageId);
      return null;
    }

    // ok / no: the answer to GlowHarness's "may I do this?"
    const number = Number(second);
    const waiting = job.kind === "agent" && job.status === "awaiting" && job.pending && job.journal;
    if (!waiting || job.pending.n !== number || job.journal.decisions.length !== number) return stale();
    const prompt = this.approvalPrompt(job).html;
    const approved = action === "ok";
    job.journal.decisions.push(approved ? "once" : "deny");
    job.pending = null;
    job.status = "active";
    await toast("toast.ok");
    const askId = messageId || job.askId;
    job.askId = null;
    if (askId) await tg.edit(state.chatId, askId, `${prompt}\n\n${t(lang, approved ? "harness.approved" : "harness.declined")}`, { buttons: [] });
    return null;
  }

  approvalPrompt(job) {
    const lang = this.state.lang;
    const pending = job.pending;
    let html = t(lang, "harness.confirm", { what: pending.summary });
    if (pending.tainted) html += `\n\n${t(lang, "harness.tainted")}`;
    const buttons = [[
      { text: tPlain(lang, "btn.approve"), data: `ok:${job.id}:${pending.n}` },
      { text: tPlain(lang, "btn.decline"), data: `no:${job.id}:${pending.n}` },
    ]];
    return { html, buttons };
  }

  // ---------------------------------------------------------------- stopping
  async stopJob(job) {
    this.markStopped(job);
    await this.tidyStopped(job);
  }

  // The part of Stop that happens at once, with no await: nothing of this job runs or is sent after it.
  markStopped(job) {
    const state = this.state;
    if (this.flight && this.flight.job === job) this.flight.controller.abort();
    job.halted = true;
    job.status = "stopped";
    for (const item of state.outbox) {
      // A plan that was never sent still has its "planning…" line in the chat: tidy it like a placeholder.
      if (item.jobId === job.id && item.dropId && !job.statusId) job.statusId = item.dropId;
    }
    state.outbox = state.outbox.filter((item) => item.jobId !== job.id);
    if (state.job === job) {
      state.done = doneRecord(job, this.now());
      state.job = null;
    }
  }

  async tidyStopped(job) {
    const state = this.state;
    const lang = state.lang;
    const tg = this.telegram();
    if (job.boardId) await tg.edit(state.chatId, job.boardId, boardText(job, lang), { buttons: [] });
    if (job.statusId && job.statusId !== job.boardId) await tg.edit(state.chatId, job.statusId, t(lang, "stopped"), { buttons: [] });
    if (job.planId) await tg.removeButtons(state.chatId, job.planId);
    if (job.askId) await tg.removeButtons(state.chatId, job.askId);
    if (job.retryId) await this.dropMessage(job.retryId);
  }

  // Deletes one of the bot's own messages. If Telegram refuses (too old), at least its buttons go.
  async dropMessage(messageId) {
    const state = this.state;
    const tg = this.telegram();
    const gone = await tg.call("deleteMessage", { chat_id: state.chatId, message_id: messageId });
    if (!gone.ok) await tg.removeButtons(state.chatId, messageId);
  }

  // ---------------------------------------------------------------- the live board
  boardView(job) {
    const lang = this.state.lang;
    const html = boardText(job, lang);
    const buttons = boardButtons(job, lang);
    return { html, buttons, key: `${html}\n${JSON.stringify(buttons)}` };
  }

  // Brings the board up to date. Identical text is skipped, so Telegram is not asked twice.
  async showBoard(job) {
    if (!job.boardId) return;
    const state = this.state;
    const view = this.boardView(job);
    if (this.boardShown && this.boardShown.id === job.id && this.boardShown.key === view.key) return;
    this.boardShown = { id: job.id, key: view.key };
    await this.telegram().edit(state.chatId, job.boardId, view.html, { buttons: view.buttons });
  }

  // ---------------------------------------------------------------- the alarm
  // One tick: send what is waiting, push the daily news if it is due, do one unit of the job.
  async tick() {
    const state = await this.load();
    if (this.ticking || state.chatId === null) return;
    this.ticking = true;
    let wiped = false;
    try {
      // If this run dies half way, the next alarm picks the work up again.
      await this.storage.setAlarm(this.now() + WATCHDOG_MS);
      if (state.wipeAt && this.now() >= state.wipeAt) {
        wiped = true;
        await this.wipe();
        return;
      }
      try {
        await this.flush();
      } catch (error) {
        this.onError("flush", error);
      }
      try {
        if (this.state === state) await this.dailyNews();
      } catch (error) {
        this.onError("daily", error);
      }
      try {
        if (this.state === state) await this.runJob();
      } catch (error) {
        this.onError("job", error);
        await this.giveUp(state, error);
      }
    } finally {
      this.ticking = false;
      if (!wiped && this.state === state) {
        await this.save();
        await this.reschedule();
      }
    }
  }

  // A unit blew up in a way nothing foresaw: the job ends with an error rather than looping.
  async giveUp(state, error) {
    const job = state.job;
    if (this.state !== state || !job || job.status === "awaiting" || job.status === "paused") return;
    try {
      await this.afterUnit(job, failJob(job, errorText(error), { lang: state.lang }));
    } catch (second) {
      this.onError("job", second);
      if (state.job === job) {
        job.status = "error";
        state.done = doneRecord(job, this.now(), "error");
        state.job = null;
      }
    }
  }

  async runJob() {
    const state = this.state;
    const lang = state.lang;
    const job = state.job;
    const now = this.now();
    if (!job || job.status !== "active" || job.retryAt > now || state.outboxAt > now) return;

    job.ticks = (job.ticks || 0) + 1;
    if (job.calls >= MAX_CALLS || job.ticks > MAX_TICKS) {
      await this.afterUnit(job, failJob(job, tPlain(lang, "error.limit"), { lang }));
      return;
    }

    const controller = new AbortController();
    const flight = { job, controller };
    this.flight = flight;
    const stopTyping = this.startTyping();
    const ctx = this.unitContext(job, controller.signal);
    let result = null;
    let failure = null;
    try {
      prepareUnit(job, lang);
      await this.showBoard(job);
      if (state.job !== job || job.status !== "active") return;
      if (job.kind === "agent") {
        ctx.notes = { text: state.notes };
        try {
          result = await runAgent(job, ctx);
        } finally {
          if (this.state === state) state.notes = ctx.notes.text;
        }
      } else {
        result = await runUnit(job, ctx);
      }
    } catch (error) {
      failure = error;
    } finally {
      stopTyping();
      if (this.flight === flight) this.flight = null;
    }

    // Stopped, replaced or wiped while the unit was running: its result is dropped.
    if (state.job !== job || this.state !== state || controller.signal.aborted || job.halted) return;
    if (failure instanceof StoppedError) return;

    if (failure && failure.name === "ModelsBusyError" && job.retries < BUSY_TRIES) {
      job.retries += 1;
      const wait = Math.min(Math.max(Number(failure.retryInMs) || 30000, 1000), BUSY_WAIT_CAP_MS);
      const seconds = Math.ceil(wait / 1000);
      job.retryAt = this.now() + wait;
      job.note = t(lang, "board.note.retry", { s: seconds });
      if (job.boardId) await this.showBoard(job);
      else await this.retryNotice(job, seconds);
      return;
    }

    if (failure) {
      try {
        result = failUnit(job, failure, ctx);
      } catch (error) {
        result = failJob(job, errorText(failure), { lang });
      }
    }
    job.retries = 0;
    job.retryAt = 0;
    await this.afterUnit(job, result);
  }

  // Jobs without a board tell a wait for busy models in one small message: edited on the next wait,
  // deleted when the job goes on.
  async retryNotice(job, seconds) {
    const state = this.state;
    const tg = this.telegram();
    const html = t(state.lang, "retry", { s: seconds, n: job.retries, max: BUSY_TRIES });
    if (job.retryId) {
      await tg.edit(state.chatId, job.retryId, html);
      return;
    }
    const sent = await tg.send(state.chatId, html, { silent: true });
    if (!sent.ok) return;
    if (state.job === job) job.retryId = sent.messageId;
    else await this.dropMessage(sent.messageId);
  }

  // What a unit works with. Every AI call is counted before it is made, so the cap bounds the worst
  // case; the model that answered is written down for the report.
  unitContext(job, signal) {
    const state = this.state;
    if (!this.chain || this.chain.state !== state) this.chain = { state, models: this.modelsFor(state.models) };
    const models = this.chain.models;
    const complete = async (request) => {
      job.calls += 1;
      const answer = await models.complete(request);
      const name = answer && answer.name ? `${answer.name}${answer.label ? ` (${answer.label})` : ""}` : "";
      if (name && !job.models.includes(name)) job.models.push(name);
      return answer;
    };
    return { models: { complete }, web: this.web, spark: this.spark, now: this.now, signal, lang: state.lang, history: state.history };
  }

  // Takes what a unit produced: queues its posts, moves the job on, and tidies the chat.
  async afterUnit(job, result) {
    const state = this.state;
    const lang = state.lang;
    const tg = this.telegram();
    const group = state.chatType !== "private";
    let threaded = false;
    for (const post of (result && result.posts) || []) {
      const item = this.outboxItem(job, post.html, post.tag, post.buttons);
      if (group && !threaded && post.tag !== "agent" && job.replyTo) {
        item.replyTo = job.replyTo;
        threaded = true;
      }
      state.outbox.push(item);
    }
    if (result && result.plan) {
      // The plan is a new message, so the phone pings when GlowLead needs a decision. Its
      // "planning…" line is deleted once the plan is there.
      const plan = planMessage(job, lang);
      const item = this.outboxItem(job, plan.html, "plan", plan.buttons);
      item.dropId = job.statusId;
      if (group) item.replyTo = job.replyTo;
      job.statusId = null;
      state.outbox.push(item);
    }
    if (result && result.ask && job.pending) {
      const prompt = this.approvalPrompt(job);
      state.outbox.push(this.outboxItem(job, prompt.html, "ask", prompt.buttons));
    }
    // A room run and a one-step mission have no plan message: their "planning…" line becomes the board.
    const boardless = job.kind === "room" || (job.kind === "lead" && job.simple);
    if (boardless && job.status === "active" && !job.boardId && job.statusId) {
      job.boardId = job.statusId;
      job.statusId = null;
    }

    const finished = job.status === "done" || job.status === "error";
    if (finished) this.finish(job);
    await this.save();
    if (this.state !== state) return;
    await this.flush();
    if (this.state !== state) return;

    if (finished) {
      if (job.boardId) {
        if (job.kind === "lead" && job.simple) await this.dropMessage(job.boardId);
        else await tg.edit(state.chatId, job.boardId, boardText(job, lang), { buttons: [] });
      }
      if (job.statusId) await this.dropMessage(job.statusId);
      if (job.retryId) await this.dropMessage(job.retryId);
      return;
    }
    if (state.job !== job) return; // stopped while the posts were being sent
    if (job.retryId) {
      const retryId = job.retryId;
      job.retryId = null;
      await this.dropMessage(retryId);
    }
    await this.showBoard(job);
  }

  // Remembers what later messages need from a job that just ended, then lets it go.
  finish(job) {
    const state = this.state;
    if (job.status === "done") {
      if (job.kind === "lead") {
        state.last = { jobId: job.id, goal: clip(job.goal, 600), report: clip(job.report, REPORT_KEEP), messageIds: [] };
      } else if (job.kind === "chat") {
        state.history.push(
          { role: "user", content: clip(job.goal, HISTORY_CLIP) },
          { role: "assistant", content: clip(job.final, HISTORY_CLIP) },
        );
        if (state.history.length > HISTORY_KEEP) state.history.splice(0, state.history.length - HISTORY_KEEP);
      } else if (job.kind === "spark") {
        state.sparkLast = { id: job.id, opening: clip(job.goal, 400) };
      }
    }
    if (state.job === job) {
      state.done = doneRecord(job, this.now());
      state.job = null;
    }
  }

  // ---------------------------------------------------------------- sending
  outboxItem(job, html, tag, buttons) {
    return { html, buttons: buttons || null, tag, jobId: job.id, tries: 0, waits: 0, silent: tag === "agent", dropId: null, replyTo: null };
  }

  // Sends the waiting posts in order. One that Telegram refuses is tried again later, so a report
  // is not lost to a busy moment.
  async flush() {
    const state = this.state;
    if (this.flushing || !state) return;
    this.flushing = true;
    try {
      while (this.state === state && state.outbox.length && state.outboxAt <= this.now()) {
        const item = state.outbox[0];
        const sent = await this.deliver(item);
        if (this.state !== state) return;
        const index = state.outbox.indexOf(item);
        if (sent.ok) {
          if (index < 0) {
            // Its job was stopped while it was on its way: the buttons must not stay live.
            if (item.tag === "plan" || item.tag === "ask") await this.telegram().removeButtons(state.chatId, sent.messageId);
            continue;
          }
          state.outbox.splice(index, 1);
          state.outboxAt = 0;
          this.noteSent(item, sent.messageId);
          await this.save();
          continue;
        }
        if (sent.status === 403) {
          this.halt(); // blocked, or removed from the group
          return;
        }
        if (index < 0) continue;
        if (sent.status === 429 && item.waits < FLOOD_WAITS) {
          item.waits += 1;
          const seconds = Math.min(Math.max(retryAfterSeconds(sent.description), FLOOD_WAIT_MIN_S), FLOOD_WAIT_MAX_S);
          state.outboxAt = this.now() + seconds * 1000;
          return;
        }
        item.tries += 1;
        if (item.tries >= OUTBOX_TRIES) {
          state.outbox.splice(index, 1);
          // Its "planning…" line is still in the chat: hand it back to the job, so Stop can tidy it.
          const owner = state.job;
          if (item.dropId && owner && owner.id === item.jobId && !owner.statusId) owner.statusId = item.dropId;
          continue;
        }
        state.outboxAt = this.now() + OUTBOX_RETRY_MS;
        return;
      }
    } finally {
      this.flushing = false;
    }
  }

  async deliver(item) {
    const state = this.state;
    const sent = await this.telegram().send(state.chatId, item.html, { buttons: item.buttons, silent: item.silent, replyTo: item.replyTo });
    if (sent.ok && item.dropId && this.state === state) await this.dropMessage(item.dropId);
    return sent;
  }

  noteSent(item, messageId) {
    const state = this.state;
    if (!messageId) return;
    if (item.tag === "final" && state.last && state.last.jobId === item.jobId) {
      const ids = state.last.messageIds;
      ids.push(messageId);
      if (ids.length > REPORT_IDS_KEEP) ids.splice(0, ids.length - REPORT_IDS_KEEP);
    }
    const job = state.job;
    if (!job || job.id !== item.jobId) return;
    if (item.tag === "plan") job.planId = messageId;
    if (item.tag === "ask") job.askId = messageId;
  }

  // ---------------------------------------------------------------- daily news
  async dailyNews() {
    const state = this.state;
    const daily = state.daily;
    if (!daily) return;
    const now = this.now();
    if (now < dailyDueAt(daily, now)) return;
    const day = daily.retryDay || dayOf(now);
    let sent;
    try {
      const edition = await this.web.news();
      const view = newsBody(edition, "all", state.lang, this.info.pages, "daily.title");
      sent = await this.telegram().send(state.chatId, view.html, { buttons: view.buttons });
    } catch (error) {
      sent = { ok: false, status: 0 };
    }
    if (this.state !== state || state.daily !== daily) return;
    if (sent.status === 403) {
      this.halt();
      return;
    }
    if (!sent.ok) {
      daily.tries += 1;
      if (daily.tries < DAILY_TRIES) {
        daily.retryAt = this.now() + DAILY_RETRY_MS;
        daily.retryDay = day;
        return;
      }
    }
    // Sent, or given up for this day: tomorrow is a new try.
    Object.assign(daily, { lastSent: day, tries: 0, retryAt: 0, retryDay: "" });
  }

  // ---------------------------------------------------------------- small machinery
  // "typing…" in the chat while a unit runs. Telegram shows it for about five seconds a time.
  startTyping() {
    const state = this.state;
    const tg = this.telegram();
    let pings = 1;
    let cancel = () => {};
    tg.typing(state.chatId);
    cancel = this.every(() => {
      if (pings >= TYPING_PINGS) {
        cancel();
        return;
      }
      pings += 1;
      tg.typing(state.chatId);
    }, TYPING_EVERY_MS);
    return () => cancel();
  }

  // Sets the alarm for the next thing that has to happen, or clears it when nothing does.
  async reschedule() {
    const state = this.state;
    if (this.ticking || !state) return;
    const now = this.now();
    const times = [];
    const job = state.job;
    if (job && job.status === "active") times.push(Math.max(job.retryAt || 0, state.outboxAt, now));
    if (state.outbox.length) times.push(Math.max(state.outboxAt, now));
    if (state.daily) times.push(Math.max(dailyDueAt(state.daily, now), now));
    if (state.wipeAt) times.push(state.wipeAt);
    if (times.length) await this.storage.setAlarm(Math.min(...times));
    else await this.storage.deleteAlarm();
  }

  // Forgets this chat completely. A simulated chat does it by itself after half an hour.
  async wipe() {
    if (this.flight) this.flight.controller.abort();
    this.forget();
    await this.storage.deleteAll();
    await this.storage.deleteAlarm();
  }

  // ---------------------------------------------------------------- the simulator
  // What the simulator shows: the calls written down so far and where the job stands. The chat's
  // config (with the bot token) is never part of it.
  async transcript(since = 0) {
    const state = await this.load();
    const rows = await this.storage.list({ prefix: RECORD_PREFIX });
    const calls = [...rows.values()].filter((row) => row && row.n > since).sort((a, b) => a.n - b.n);
    const job = state.job;
    return {
      calls,
      last: state.recSeq,
      alarm: await this.storage.getAlarm(),
      mode: state.mode,
      lang: state.lang,
      job: job
        ? {
            id: job.id,
            kind: job.kind,
            status: job.status,
            phase: job.phase,
            calls: job.calls,
            retries: job.retries,
            models: job.models,
            error: job.error,
            steps: job.steps.map((step) => ({
              title: step.title || clip(String(step.task || ""), 80),
              bot: step.bot || null,
              worker: step.worker || null,
              status: step.status,
            })),
          }
        : null,
      done: state.done,
      outbox: state.outbox.length,
    };
  }

  // Feeds a pretend message or button tap through the same code, in record mode.
  // input = { text?, callback?, messageId?, lang?, chatType?, replyTo? }
  async simulate(input = {}) {
    const state = await this.load();
    if (state.chatId !== null && !state.record) throw new Error("This is a real chat, not a simulated one.");
    const group = input.chatType === "group" || input.chatType === "supergroup";
    const chat = group ? { id: -1004242, type: "supergroup", title: "Simulated group" } : { id: 4242, type: "private" };
    const from = { id: 4242, is_bot: false, first_name: "Tester", language_code: isLang(input.lang) ? input.lang : "en" };
    if (isLang(input.lang)) state.lang = input.lang;

    let update;
    if (input.callback) {
      const data = String(input.callback);
      const messageId = Number(input.messageId) || (await this.findButton(data));
      await this.record(state, { method: "incoming", payload: { tap: data, message_id: messageId } });
      update = { update_id: state.recSeq, callback_query: { id: `sim-${state.recSeq}`, from, data, message: { message_id: messageId, chat } } };
    } else {
      const text = String(input.text || "");
      state.msgSeq += 1;
      const message = { message_id: state.msgSeq, date: Math.floor(this.now() / 1000), chat, from, text };
      if (input.replyTo) message.reply_to_message = { message_id: Number(input.replyTo), from: { id: 1, is_bot: true } };
      await this.record(state, { method: "incoming", payload: { text, message_id: message.message_id } });
      update = { update_id: state.recSeq, message };
    }
    const config = { token: "", botUsername: "glow_sim_bot", botId: 1, origin: "", public: false };
    const access = { role: "owner", allowed: true, claimed: false, ownerKnown: true, gone: false };
    await this.handleUpdate({ update, config, access, record: true });
    return { last: state.recSeq };
  }

  // The newest recorded message that carries a button with this data.
  async findButton(data) {
    const rows = [...(await this.storage.list({ prefix: RECORD_PREFIX })).values()].sort((a, b) => b.n - a.n);
    for (const row of rows) {
      const markup = row && row.payload ? row.payload.reply_markup : null;
      const keys = markup && Array.isArray(markup.inline_keyboard) ? markup.inline_keyboard.flat() : [];
      if (keys.some((key) => key && key.callback_data === data)) return row.messageId || row.payload.message_id || 0;
    }
    return 0;
  }
}

function recordKey(n) {
  return `${RECORD_PREFIX}${String(n).padStart(6, "0")}`;
}
