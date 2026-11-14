// Shared set-up for the ChatLogic tests: one chat with a Telegram that writes everything down, a
// clock moved by hand and scripted models, plus helpers that play the user and the alarm.

import assert from "node:assert/strict";

import { ChatLogic } from "../src/chat.js";
import { createTelegram } from "../src/telegram.js";
import { FakeStorage, fakeWeb, makeClock, scripted } from "./fakes.js";

// 02:30 on 12 November 2026 in Batam (UTC+7).
export const START = Date.UTC(2026, 10, 11, 19, 30);
export const PAGES = "https://juw12.github.io/projects/glow";
export const PRIVATE_CHAT = { id: 5001, type: "private" };
export const GROUP_CHAT = { id: -1005001, type: "supergroup", title: "Club" };
export const OWNER = { id: 9001, is_bot: false, first_name: "Juwen", language_code: "en" };
export const FRIEND = { id: 9002, is_bot: false, first_name: "Budi", language_code: "en" };
export const CONFIG = {
  token: "123456789:AAExampleTokenThatIsNotRealAtAll_0123456",
  botUsername: "glow_test_bot",
  botId: 777,
  origin: "",
  public: false,
};
export const AS_OWNER = { role: "owner", allowed: true, claimed: false, ownerKnown: true, gone: false };
export const AS_MEMBER = { role: "member", allowed: true, claimed: false, ownerKnown: true, gone: false };
export const AS_STRANGER = { role: "stranger", allowed: false, claimed: false, ownerKnown: true, gone: false };

// Answers Telegram gives when it refuses a call.
export const flood = (seconds) => ({
  ok: false,
  status: 429,
  description: `Too Many Requests: retry after ${seconds}`,
  retryAfter: seconds,
});
export const BLOCKED = { ok: false, status: 403, description: "Forbidden: bot was blocked by the user" };
export const BROKEN = { ok: false, status: 500, description: "Internal Server Error" };

// A Telegram that writes down every call. The "typing…" ping is kept in its own list: it is not
// awaited, so in the main list its place would be a matter of luck.
export function fakeTelegram() {
  const calls = [];
  const typing = [];
  const refusals = [];
  let lastId = 100;
  const transport = async (method, payload) => {
    if (method === "sendChatAction") {
      typing.push(payload);
      return { ok: true, result: true };
    }
    calls.push({ method, payload });
    const refusal = refusals.find((entry) => entry.left > 0 && entry.method === method && entry.when(payload));
    if (refusal) {
      refusal.left -= 1;
      return refusal.answer;
    }
    if (method === "sendMessage") {
      lastId += 1;
      return { ok: true, result: { message_id: lastId, chat: { id: payload.chat_id } } };
    }
    if (method === "editMessageText" || method === "editMessageReplyMarkup") {
      return { ok: true, result: { message_id: payload.message_id, chat: { id: payload.chat_id } } };
    }
    return { ok: true, result: true };
  };
  return {
    transport,
    calls,
    typing,
    // The next `times` calls of this method (those `when` accepts) get this answer instead.
    refuse(method, answer, { times = 1, when = () => true } = {}) {
      refusals.push({ method, answer, left: times, when });
    },
  };
}

// GlowSpark without its weights: it always continues the opening the same way.
export function fakeSpark(text = " who loved <jam>.\nThe end.") {
  const calls = [];
  return {
    calls,
    async load() {
      return { parameters: 1311872 };
    },
    write(opening, options) {
      calls.push({ opening, options });
      return { text, tokens: 8, ms: 3, seed: 1 };
    },
  };
}

// The Registry as the chat sees it.
export function fakeRegistry() {
  const calls = [];
  let open = false;
  const access = () => (open ? "public" : "private");
  return {
    calls,
    async setPublic(flag) {
      calls.push(["setPublic", flag]);
      open = Boolean(flag);
      return { ok: true, access: access() };
    },
    async status() {
      calls.push(["status"]);
      return { configured: true, bot: { username: CONFIG.botUsername, name: "GlowBot" }, access: access(), claimed: true, chats: 3 };
    },
    async forget(chatId) {
      calls.push(["forget", chatId]);
      return { ok: true };
    },
    async allow(chatId) {
      calls.push(["allow", chatId]);
      return { ok: true, chats: 4 };
    },
    async users() {
      calls.push(["users"]);
      return {
        ok: true,
        ownerId: OWNER.id,
        access: access(),
        chats: [
          { id: String(FRIEND.id), title: "" },
          { id: String(GROUP_CHAT.id), title: "Club <1>" },
        ],
      };
    },
  };
}

// What was sent, in the order it was sent.
export const sent = (calls) => calls.filter((call) => call.method === "sendMessage").map((call) => call.payload);
export const methods = (calls) => calls.map((call) => call.method);

// The buttons under a message as "label → what a tap sends" lines.
export function buttonsOf(payload) {
  const rows = payload && payload.reply_markup ? payload.reply_markup.inline_keyboard || [] : [];
  return rows.map((row) => row.map((button) => button.callback_data || button.url || (button.web_app ? button.web_app.url : "")));
}

export function makeChat({
  rules = [],
  web = fakeWeb(),
  spark = fakeSpark(),
  registry = fakeRegistry(),
  chat = PRIVATE_CHAT,
  config = CONFIG,
  start = START,
} = {}) {
  const now = makeClock(start);
  const storage = new FakeStorage();
  const telegram = fakeTelegram();
  const models = scripted(rules);
  const errors = [];
  let gate = null;
  const complete = async (request) => {
    if (gate) {
      const held = gate;
      gate = null;
      held.reached();
      await held.opened;
    }
    return models.complete(request);
  };
  const build = () => new ChatLogic({
    storage,
    now,
    telegramFor: () => createTelegram({ transport: telegram.transport, sleep: async () => {} }),
    modelsFor: () => ({
      complete,
      describe: () => [
        { id: "test", kind: "test", label: "Test Model (Test)", name: "Test Model", model: "test-model", restingMs: 0 },
        { id: "spare", kind: "test", label: "Spare <Model> (Test)", name: "Spare Model", model: "spare-model", restingMs: 61_000 },
      ],
    }),
    web,
    spark,
    registry,
    info: { pages: PAGES, version: "1.34.0", build: "test" },
    onError: (where, error) => errors.push({ where, error }),
  });
  const kit = { now, storage, telegram, models, web, spark, registry, errors, chat, config, logic: build() };
  let userMessageId = 0;
  let updateId = 0;
  let seen = 0;

  const deliver = (update, access, extra = {}) => kit.logic.handleUpdate({ update, config, access, ...extra });

  // The Durable Object went to sleep and woke up: memory is gone, storage is not.
  kit.restart = () => {
    kit.logic = build();
    return kit.logic;
  };

  // The user sends a message. Answers its message_id.
  kit.say = async (text, { from = OWNER, access = AS_OWNER, replyTo = null, replyFrom = config.botId, extra = {} } = {}) => {
    userMessageId += 1;
    updateId += 1;
    const message = { message_id: userMessageId, date: Math.floor(now() / 1000), chat, from, text, ...extra };
    if (replyTo !== null) {
      message.reply_to_message = { message_id: replyTo, chat, from: { id: replyFrom, is_bot: replyFrom === config.botId } };
    }
    await deliver({ update_id: updateId, message }, access);
    return userMessageId;
  };

  // The user taps a button under one of the bot's messages. Answers the callback id.
  kit.tap = async (data, messageId, { from = OWNER, access = AS_OWNER } = {}) => {
    updateId += 1;
    const query = { id: `tap-${updateId}`, from, data, message: { message_id: messageId, chat } };
    await deliver({ update_id: updateId, callback_query: query }, access);
    return query.id;
  };

  // The bot was added to, or removed from, the chat.
  kit.member = async (status, { was = "left", from = OWNER, access = AS_OWNER } = {}) => {
    updateId += 1;
    const bot = { id: config.botId, is_bot: true, username: config.botUsername };
    const change = {
      chat,
      from,
      date: Math.floor(now() / 1000),
      old_chat_member: { user: bot, status: was },
      new_chat_member: { user: bot, status },
    };
    await deliver({ update_id: updateId, my_chat_member: change }, access);
  };

  // Plays the alarm once: moves the clock to the alarm time and runs the tick. False when no alarm is set.
  kit.tickOnce = async () => {
    const at = await storage.getAlarm();
    if (at === null || at === undefined) return false;
    if (at > now()) now.advance(at - now());
    await storage.deleteAlarm();
    await kit.logic.tick();
    return true;
  };

  // Runs every alarm that falls due within `forMs` from now. Answers how many ticks ran.
  kit.run = async ({ forMs = 60_000, limit = 80 } = {}) => {
    const until = now() + forMs;
    let ticks = 0;
    for (;;) {
      const at = await storage.getAlarm();
      if (at === null || at === undefined || at > until) return ticks;
      if (ticks >= limit) throw new Error(`still ticking after ${limit} ticks`);
      await kit.tickOnce();
      ticks += 1;
    }
  };

  // Makes the next model call wait, the way a slow model keeps a tick waiting while messages and
  // taps still arrive. `arrived` resolves once the tick is waiting; `release()` lets the model answer.
  kit.holdModel = () => {
    let reached;
    let release;
    const arrived = new Promise((resolve) => {
      reached = resolve;
    });
    const opened = new Promise((resolve) => {
      release = resolve;
    });
    gate = { reached, opened };
    return { arrived, release };
  };

  // The Telegram calls made since this was last asked.
  kit.fresh = () => {
    const calls = telegram.calls.slice(seen);
    seen = telegram.calls.length;
    return calls;
  };

  return kit;
}

// A whole exchange as short lines, so a test can compare everything that happened, in order.
//   "sendMessage silent re 2 [["stp:1"]]"   a quiet message, replying to message 2, with one button
//   "editMessageText #103 []"               message 103 was rewritten and its buttons taken away
//   "toast: OK" / "alert: …"                the answer to a button tap
export function outline(calls) {
  return calls.map(({ method, payload }) => {
    if (method === "answerCallbackQuery") return `${payload.show_alert ? "alert" : "toast"}: ${payload.text}`;
    const parts = [method];
    if (method !== "sendMessage" && payload.message_id) parts.push(`#${payload.message_id}`);
    if (payload.disable_notification) parts.push("silent");
    if (payload.reply_parameters) parts.push(`re ${payload.reply_parameters.message_id}`);
    if (payload.reply_markup) parts.push(JSON.stringify(buttonsOf(payload)));
    return parts.join(" ");
  });
}

// The text of every call that carries one (messages, edits and toasts), in order.
export const texts = (calls) => calls.filter((call) => typeof call.payload.text === "string").map((call) => call.payload.text);

// When the next alarm is due, in seconds from now. Null when no alarm is set.
export const alarmIn = (kit) => (kit.storage.alarmAt === null ? null : Math.round((kit.storage.alarmAt - kit.now()) / 1000));

// ------------------------------------------------------------------ what the tests compare against
// The buttons under a message, written the way outline() prints them.
export const STOP_BUTTON = '[["stp:1"]]';
export const PLAN_BUTTONS = '[["run:1","chg:1","can:1"]]';
export const BOARD_BUTTONS = '[["pau:1","stp:1"]]';
export const STALE = "That button is from an older job.";
export const BUSY = "⏳ I am still working on the last job. Stop it first if you want a new one.";
export const MODELS = ["Test Model (Test)"];
export const MODELS_LINE = "<i>Models: Test Model (Test)</i>";

export const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object[key]]));

// What the bot did since the last look: one outline line per Telegram call and, when given, their texts.
export function did(kit, lines, said) {
  const calls = kit.fresh();
  assert.deepEqual(outline(calls), lines);
  if (said) assert.deepEqual(texts(calls), said);
}

// The named fields of the job that is running now.
export const job = (kit, ...keys) => pick(kit.logic.state.job, keys);

// What the chat keeps of a job that is over. Unless a test moves the clock, every job ends at START.
export const record = (fields) => ({ id: "1", status: "done", error: "", models: MODELS, finishedAt: START, ...fields });

// ------------------------------------------------------------------ scripts the chat tests share
// Each pattern matches the start of one agent's system prompt, so a rule answers for that agent.
export const PLAN = /^You are GlowLead, the lead of a team/;
export const REVIEW = /^You are GlowLead, the team lead/;
export const CHAT_STEP = /^You are GlowChat, working for GlowLead/;
export const BUILDER = /^You are the Builder/;
export const CRITIC = /^You are the Critic/;
export const JUDGE = /^You are the Judge/;
export const NOVA_PLAN = /^You are Nova, lead of an AI crew/;
export const PIXEL = /^You are Pixel/;
export const BYTE = /^You are Byte/;
export const GLOWCHAT = /^You are GlowChat, the Glow AI assistant/;
export const HARNESS = /^You are GlowHarness, a careful assistant/;

// A two-step mission: the council (three voices) decides, GlowChat writes, GlowLead checks.
export const BAKERY_GOAL = "Write a welcome message for my bakery";
export const BAKERY_PLAN = JSON.stringify({
  summary: "Decide the tone, then write it.",
  criteria: ["Friendly tone", "Under 80 words"],
  steps: [
    { worker: "council", title: "Decide the tone", task: "Decide which tone fits a small bakery." },
    { worker: "chat", title: "Write the message", task: "Write the welcome message." },
  ],
});
export const ALL_MET = '\n\nCHECK: {"met":[true,true],"missing":""}';
export const BAKERY_RULES = [
  [PLAN, BAKERY_PLAN],
  [BUILDER, "Builder: go warm."],
  [CRITIC, "Critic: too long."],
  [JUDGE, "Judge: warm and short."],
  [CHAT_STEP, "Welcome to our bakery!"],
  [REVIEW, "Welcome to our bakery!" + ALL_MET],
];
export const BAKERY_PLAN_TEXT = [
  "👑 <b>GlowLead's plan</b>",
  "Decide the tone, then write it.",
  "",
  "<b>Done when</b>",
  "• Friendly tone",
  "• Under 80 words",
  "",
  "<b>Steps</b>",
  "1. ⚖️ <b>GlowChat Council</b>: Decide the tone",
  "2. 💬 <b>GlowChat</b>: Write the message",
  "",
  "Run it? To change the plan, reply to this message with what to change.",
].join("\n");
export const BAKERY_REPORT_TEXT = [
  "👑 <b>GlowLead's report</b>",
  "",
  "Welcome to our bakery!",
  "",
  "———",
  "<b>Done-criteria</b>",
  "✅ Friendly tone",
  "✅ Under 80 words",
  "",
  "<i>Models: Test Model (Test)</i>",
].join("\n");

// The mission board of the bakery mission: its state line and the mark in front of each step.
export const bakeryBoard = (stateLine, first, second) => [
  `👑 <b>Mission</b>: ${BAKERY_GOAL}`,
  stateLine,
  `${first} ⚖️ GlowChat Council: Decide the tone`,
  `${second} 💬 GlowChat: Write the message`,
].join("\n");

// What the agents post while the bakery mission runs: one voice of the council, and GlowChat's step.
export const council = (voice, words) =>
  `⚖️ <b>GlowChat Council</b> · ${voice} · Decide the tone\n<blockquote expandable>${words}</blockquote>`;
export const WELCOME_POST = "💬 <b>GlowChat</b> · Write the message\n<blockquote expandable>Welcome to our bakery!</blockquote>";

// A goal so small that GlowLead skips the plan and just has GlowChat answer.
export const YEAST_GOAL = "How does yeast work?";
export const SIMPLE_PLAN = JSON.stringify({
  summary: "Just answer.",
  criteria: ["Answers it"],
  steps: [{ worker: "chat", title: "Explain it", task: "Explain how yeast works." }],
});
export const YEAST_RULES = [
  [PLAN, SIMPLE_PLAN],
  [CHAT_STEP, "Yeast eats sugar and makes gas."],
];
export const YEAST_REPORT_TEXT = "👑 <b>GlowLead's report</b>\n\nYeast eats sugar and makes gas.\n\n<i>Models: Test Model (Test)</i>";

// The plan GlowLead writes when the user asks for the bakery plan to be changed.
export const SECOND_PLAN = JSON.stringify({
  summary: "Write it in one go.",
  criteria: ["Friendly tone"],
  steps: [
    { worker: "chat", title: "Write the message", task: "Write the welcome message." },
    { worker: "chat", title: "Shorten it", task: "Cut it to two sentences." },
  ],
});
export const SECOND_PLAN_TEXT = [
  "👑 <b>GlowLead's plan</b>",
  "Write it in one go.",
  "",
  "<b>Done when</b>",
  "• Friendly tone",
  "",
  "<b>Steps</b>",
  "1. 💬 <b>GlowChat</b>: Write the message",
  "2. 💬 <b>GlowChat</b>: Shorten it",
  "",
  "Run it? To change the plan, reply to this message with what to change.",
].join("\n");

// What a GlowHarness model writes when it wants a tool.
export const call = (name, args) => `TOOL ${JSON.stringify({ name, args })}`;
export const SAVE_WIFI = call("notes", { op: "save", key: "wifi", value: "glow-5g" });
export const WIFI_TASK = "/agent Remember my wifi name glow-5g";
export const WIFI_QUESTION = "🧰 GlowHarness wants to do this:\n<b>Save a note: wifi = glow-5g</b>\n\nAllow it?";

// Plays the bakery mission up to a named point and leaves the chat there.
//   "plan"   the plan (#102) is waiting for Run
//   "board"  Run was tapped and the board (#103) is up
//   "work"   one work tick has run: the Builder has posted
export async function bakeryUpTo(kit, point) {
  await kit.say(BAKERY_GOAL);
  await kit.tickOnce();
  if (point === "plan") return kit.fresh();
  await kit.tap("run:1", 102);
  if (point === "board") return kit.fresh();
  await kit.tickOnce();
  return kit.fresh();
}
