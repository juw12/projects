// The chat's commands in a private chat: what each one answers, word for word.
// Missions and jobs are in chat-jobs.test.js; failures, groups and record mode in chat-edge.test.js.

import test from "node:test";
import assert from "node:assert/strict";

import { APP_LINKS, DAILY_JOB_LIMIT } from "../src/chat.js";
import { COMMANDS, t } from "../src/strings.js";
import { fakeWeb } from "./fakes.js";
import {
  AS_MEMBER,
  AS_OWNER,
  BAKERY_GOAL,
  BAKERY_RULES,
  BLOCKED,
  FRIEND,
  GLOWCHAT,
  GROUP_CHAT,
  PAGES,
  START,
  alarmIn,
  bakeryUpTo,
  makeChat,
  outline,
  texts,
} from "./chat-kit.js";

const MODE_BUTTONS = '[["mode:lead","mode:room"],["mode:chat","mode:agent"]]';
const LANG_BUTTONS = '[["lang:en","lang:id"],["lang:zh-Hans","lang:zh-Hant"]]';
const HELLO = [
  "👋 <b>GlowBot</b>: your Glow AI team, here in Telegram.",
  "",
  "Give me a goal. <b>GlowLead</b> plans it, hands each step to an agent, checks the result and reports back. It is free.",
  "",
  "Try: <code>/lead plan a 3-day trip to Bali on a small budget</code>",
  "Or just type your goal.",
  "",
  "/help shows everything I can do.",
].join("\n");
const STALE = "That button is from an older job.";

// One command in a fresh private chat: the outline and texts of everything it made the bot do.
async function answerTo(text, options) {
  const kit = makeChat();
  await kit.say(text, options);
  const calls = kit.fresh();
  assert.deepEqual(kit.errors, []);
  return { kit, calls, lines: outline(calls), said: texts(calls) };
}

// ------------------------------------------------------------------ /start, /help, /agents
test("/start greets and offers the four modes", async () => {
  const { lines, said } = await answerTo("/start");
  assert.deepEqual(lines, [`sendMessage ${MODE_BUTTONS}`]);
  assert.deepEqual(said, [HELLO]);
});

test("/start tells a new owner first that the bot is now theirs", async () => {
  const { lines, said } = await answerTo("/start", { access: { ...AS_OWNER, claimed: true } });
  assert.deepEqual(lines, ["sendMessage", `sendMessage ${MODE_BUTTONS}`]);
  assert.deepEqual(said, [
    "✅ You are now this bot's owner. It is private: only you, and the groups you add me to, can use it.",
    HELLO,
  ]);
});

test("/help lists every command, and shows /access only to the owner in their own chat", async () => {
  const plain = t("en", "help");
  assert.ok(plain.startsWith("<b>GlowBot: what I can do</b>"));
  assert.ok(plain.endsWith("In groups I answer commands and replies to my messages."));
  for (const command of COMMANDS) {
    if (command !== "help") assert.ok(plain.includes(`/${command}`), `help does not mention /${command}`);
  }
  for (const ownerOnly of ["/access", "/allow", "/deny", "/users"]) {
    assert.ok(!plain.includes(ownerOnly), `the public help mentions ${ownerOnly}`);
  }

  const owner = await answerTo("/help");
  assert.deepEqual(owner.lines, ["sendMessage"]);
  assert.deepEqual(owner.said, [
    [
      plain,
      "",
      "<b>Owner</b>",
      "/access · who can use this bot: private or public",
      "/allow <i>id</i> · let one person or group in",
      "/deny <i>id</i> · take one out again",
      "/users · who is let in",
    ].join("\n"),
  ]);

  const member = await answerTo("/help", { from: FRIEND, access: AS_MEMBER });
  assert.deepEqual(member.said, [plain]);

  const group = makeChat({ chat: GROUP_CHAT });
  await group.say("/help");
  const calls = group.fresh();
  assert.deepEqual(outline(calls), ["sendMessage re 1"]);
  assert.deepEqual(texts(calls), [plain]);
});

test("/agents names the eight agents and what each does", async () => {
  const { lines, said } = await answerTo("/agents");
  assert.deepEqual(lines, ["sendMessage"]);
  assert.deepEqual(said, [
    [
      "<b>The Glow team</b>",
      "💬 <b>GlowChat</b>: answers and writes",
      "⚖️ <b>GlowChat Council</b>: three voices argue it out: Builder, Critic, Judge",
      "🔎 <b>Scout</b>: reads the live web and cites its sources",
      "💻 <b>Byte</b>: writes code (does not run it here)",
      "🧪 <b>Probe</b>: reviews code and lists what to test (does not run it here)",
      "🛡 <b>Sentinel</b>: checks the work and gives a verdict",
      "🎨 <b>Pixel</b>: writes copy and content",
      "🌟 <b>Nova</b>: leads the GlowRoom crew",
      "",
      "Ask one directly: <code>/ask scout price of the Raspberry Pi 5 today</code>",
    ].join("\n"),
  ]);
});

// ------------------------------------------------------------------ /apps
const APP_URLS = [
  [`${PAGES}/`, `${PAGES}/lead/`],
  [`${PAGES}/chat/mobile.html`, `${PAGES}/room/mobile.html`],
  [`${PAGES}/news/`, `${PAGES}/spark/`],
  [`${PAGES}/harness/`, `${PAGES}/code/`],
  [`${PAGES}/bot/`],
];
const keyboardOf = (call) => call.payload.reply_markup.inline_keyboard;

test("/apps opens the nine Glow apps inside Telegram", async () => {
  const { calls, said } = await answerTo("/apps");
  assert.equal(calls.length, 1);
  assert.deepEqual(said, ["Open a Glow app:"]);
  const rows = keyboardOf(calls[0]);
  assert.deepEqual(rows.map((row) => row.map((button) => button.web_app.url)), APP_URLS);
  assert.deepEqual(rows.flat().map((button) => button.text), APP_LINKS.map((app) => `${app.icon} ${app.name}`));
  assert.deepEqual(rows.flat().map((button) => button.text), [
    "✦ Glow",
    "👑 GlowLead",
    "💬 GlowChat",
    "🏢 GlowRoom",
    "📰 GlowNews",
    "✨ GlowSpark",
    "🧰 GlowHarness",
    "⚡ GlowCode",
    "🤖 GlowBot",
  ]);
  assert.ok(rows.flat().every((button) => !("url" in button)));
});

test("/apps falls back to plain links when Telegram refuses the in-app buttons", async () => {
  const kit = makeChat();
  kit.telegram.refuse("sendMessage", { ok: false, status: 400, description: "Bad Request: BUTTON_TYPE_INVALID" });
  await kit.say("/apps");
  const calls = kit.fresh();
  assert.deepEqual(texts(calls), ["Open a Glow app:", "Open a Glow app:"]);
  assert.ok(keyboardOf(calls[0]).flat().every((button) => button.web_app));
  assert.deepEqual(keyboardOf(calls[1]).map((row) => row.map((button) => button.url)), APP_URLS);
  assert.ok(keyboardOf(calls[1]).flat().every((button) => !("web_app" in button)));
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ /status
const statusLines = (said) => said[said.length - 1].split("\n");

test("/status shows the owner no limit and everyone else the daily limit", async () => {
  const owner = await answerTo("/status");
  assert.deepEqual(owner.lines, ["sendMessage"]);
  assert.deepEqual(statusLines(owner.said), [
    "<b>GlowBot 1.32.0</b>",
    "Mode: GlowLead",
    "Language: English",
    "Access: private",
    "Running: nothing",
    "Jobs today: 0 (no limit for you)",
    "Daily news: off",
  ]);
  const member = await answerTo("/status", { from: FRIEND, access: AS_MEMBER });
  assert.equal(statusLines(member.said)[5], "Jobs today: 0 of 20");
  assert.equal(DAILY_JOB_LIMIT, 20);
});

test("/status names the running job and how far it is", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await kit.say(BAKERY_GOAL);
  kit.fresh();
  await kit.say("/status");
  assert.equal(statusLines(texts(kit.fresh()))[4], "Running: GlowLead · Planning");
  await kit.tickOnce();
  kit.fresh();
  await kit.say("/status");
  const lines = statusLines(texts(kit.fresh()));
  assert.equal(lines[4], "Running: GlowLead · Waiting for your OK");
  assert.equal(lines[5], "Jobs today: 1 (no limit for you)");
  assert.deepEqual(kit.errors, []);
});

test("/status speaks the chat's language and shows the daily news time", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await kit.say("/lang id");
  await kit.say("/daily 07:30");
  await bakeryUpTo(kit, "plan");
  await kit.say("/status");
  assert.deepEqual(statusLines(texts(kit.fresh())), [
    "<b>GlowBot 1.32.0</b>",
    "Mode: GlowLead",
    "Bahasa: Bahasa Indonesia",
    "Akses: pribadi",
    "Berjalan: GlowLead · Menunggu persetujuanmu",
    "Pekerjaan hari ini: 1 (tanpa batas untukmu)",
    "Berita harian: 07:30 (UTC+7)",
  ]);
  await kit.say("/status", { from: FRIEND, access: AS_MEMBER });
  assert.equal(statusLines(texts(kit.fresh()))[5], "Pekerjaan hari ini: 1 dari 20");
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ /lang
test("/lang shows a picker, and a tap on it switches the language", async () => {
  const kit = makeChat();
  await kit.say("/lang");
  let calls = kit.fresh();
  assert.deepEqual(outline(calls), [`sendMessage ${LANG_BUTTONS}`]);
  assert.deepEqual(texts(calls), ["Pick a language:"]);

  await kit.tap("lang:id", 101);
  calls = kit.fresh();
  assert.deepEqual(outline(calls), ["toast: Oke", "editMessageText #101 []"]);
  assert.equal(calls[1].payload.text, "✅ Bahasa: Bahasa Indonesia.");
  assert.equal(kit.logic.state.lang, "id");

  await kit.tap("lang:xx", 101);
  assert.deepEqual(outline(kit.fresh()), ["toast: Tombol itu dari pekerjaan lama."]);
  assert.equal(kit.logic.state.lang, "id");
  assert.deepEqual(kit.errors, []);
});

test("/lang with a code sets it at once; an unknown code shows the picker", async () => {
  const kit = makeChat();
  await kit.say("/lang ZH-HANS");
  assert.deepEqual(texts(kit.fresh()), ["✅ 语言：简体中文。"]);
  assert.equal(kit.logic.state.lang, "zh-Hans");

  await kit.say("/lang fr");
  const calls = kit.fresh();
  assert.deepEqual(outline(calls), [`sendMessage ${LANG_BUTTONS}`]);
  assert.deepEqual(texts(calls), ["选择语言："]);
  assert.equal(kit.logic.state.lang, "zh-Hans");

  await kit.say("/lang en");
  assert.deepEqual(texts(kit.fresh()), ["✅ Language: English."]);
  assert.equal(kit.logic.state.lang, "en");
  assert.deepEqual(kit.errors, []);
});

test("the language is taken from the user's Telegram language the first time only", async () => {
  const kit = makeChat();
  await kit.say("/status", { from: { ...FRIEND, language_code: "id" }, access: AS_MEMBER });
  assert.equal(kit.logic.state.lang, "id");
  await kit.say("/status", { from: { ...FRIEND, language_code: "zh-hans" }, access: AS_MEMBER });
  assert.equal(kit.logic.state.lang, "id");
});

// ------------------------------------------------------------------ modes
test("a mode command without text switches where plain messages go", async () => {
  const kit = makeChat();
  const expected = [
    ["/room", "room", "GlowRoom"],
    ["/chat", "chat", "GlowChat"],
    ["/agent", "agent", "GlowHarness"],
    ["/harness", "agent", "GlowHarness"],
    ["/lead", "lead", "GlowLead"],
  ];
  assert.equal(kit.logic.state, null);
  for (const [command, mode, name] of expected) {
    await kit.say(command);
    assert.deepEqual(texts(kit.fresh()), [`✅ Mode: <b>${name}</b>. Just type, and it goes there.`]);
    assert.equal(kit.logic.state.mode, mode);
  }
  assert.equal(kit.models.calls.length, 0);
  assert.deepEqual(kit.errors, []);
});

test("a mode button switches the mode; a button for a mode that does not exist does nothing", async () => {
  const kit = makeChat();
  await kit.say("/start");
  kit.fresh();
  await kit.tap("mode:room", 101);
  let calls = kit.fresh();
  assert.deepEqual(outline(calls), ["toast: OK", "sendMessage"]);
  assert.equal(calls[1].payload.text, "✅ Mode: <b>GlowRoom</b>. Just type, and it goes there.");
  assert.equal(kit.logic.state.mode, "room");

  await kit.tap("mode:zzz", 101);
  calls = kit.fresh();
  assert.deepEqual(outline(calls), [`toast: ${STALE}`]);
  assert.equal(kit.logic.state.mode, "room");
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ usage hints
test("/spark and /ask explain themselves when something is missing", async () => {
  const cases = [
    ["/spark", "Give it an opening, like this:\n<code>/spark Once upon a time there was a fox</code>"],
    [
      "/ask",
      "Use it like this:\n<code>/ask scout price of the Raspberry Pi 5 today</code>\n\nAgents: chat, council, scout, byte, probe, sentinel, pixel, nova.",
    ],
    ["/ask nobody do it", "I do not know an agent called “nobody”. /agents lists the team."],
    ["/ask byte", "Add what you want after the command, like this:\n<code>/ask byte …</code>"],
    ["/ask @pixel", "Add what you want after the command, like this:\n<code>/ask pixel …</code>"],
    ["/nonsense", "I do not know that command. /help shows what I can do."],
  ];
  for (const [command, answer] of cases) {
    const { kit, lines, said } = await answerTo(command);
    assert.deepEqual(lines, ["sendMessage"], command);
    assert.deepEqual(said, [answer], command);
    assert.equal(kit.logic.state.job, null, command);
    assert.equal(alarmIn(kit), null, command);
  }
});

// ------------------------------------------------------------------ /access and the daily limit
test("/access shows who may use the bot, and the owner can open or close it", async () => {
  const kit = makeChat();
  const view = "Access: <b>private</b>. Chats let in: 3.\n\nChange it with <code>/access public</code> or <code>/access private</code>.";
  await kit.say("/access");
  assert.deepEqual(texts(kit.fresh()), [view]);
  await kit.say("/access maybe");
  assert.deepEqual(texts(kit.fresh()), [view]);
  assert.deepEqual(kit.registry.calls, [["status"], ["status"]]);

  await kit.say("/access public");
  assert.deepEqual(texts(kit.fresh()), ["🌐 Access is now public: anyone can use this bot, with a daily limit per chat."]);
  assert.equal(kit.logic.state.config.public, true);
  await kit.say("/status");
  assert.equal(statusLines(texts(kit.fresh()))[3], "Access: public");

  await kit.say("/access PRIVATE");
  assert.deepEqual(texts(kit.fresh()), ["🔒 Access is now private: only you and the groups you add me to."]);
  assert.equal(kit.logic.state.config.public, false);
  assert.deepEqual(kit.registry.calls.slice(2), [["setPublic", true], ["setPublic", false]]);
  assert.deepEqual(kit.errors, []);
});

test("/access is refused to anyone but the owner", async () => {
  const kit = makeChat();
  await kit.say("/access public", { from: FRIEND, access: AS_MEMBER });
  assert.deepEqual(texts(kit.fresh()), ["Only this bot's owner can do that."]);
  assert.deepEqual(kit.registry.calls, []);
  assert.equal(kit.logic.state.config.public, false);
});

test("a chat gets 20 jobs a day; the owner has no limit; the count starts again the next day", async () => {
  const kit = makeChat({ rules: [[GLOWCHAT, "Hi."]] });
  const asMember = { from: FRIEND, access: AS_MEMBER };
  for (let n = 1; n <= 20; n += 1) {
    await kit.say(`/chat hello ${n}`, asMember);
    await kit.run();
  }
  assert.equal(kit.models.calls.length, 20);
  assert.deepEqual(kit.logic.state.quota, { day: "2026-11-12", jobs: 20 });
  kit.fresh();

  await kit.say("/chat hello 21", asMember);
  assert.deepEqual(texts(kit.fresh()), ["This chat has used today's 20 jobs. Try again tomorrow."]);
  assert.equal(kit.logic.state.job, null);
  assert.equal(await kit.run(), 0);
  assert.equal(kit.models.calls.length, 20);

  await kit.say("/status", asMember);
  assert.equal(statusLines(texts(kit.fresh()))[5], "Jobs today: 20 of 20");

  await kit.say("/chat hello from the owner");
  await kit.run();
  assert.equal(kit.models.calls.length, 21);
  assert.deepEqual(kit.logic.state.quota, { day: "2026-11-12", jobs: 21 });

  kit.now.advance(24 * 3600 * 1000);
  await kit.say("/chat hello again", asMember);
  await kit.run();
  assert.equal(kit.models.calls.length, 22);
  assert.deepEqual(kit.logic.state.quota, { day: "2026-11-13", jobs: 1 });
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ /news
const EDITION = {
  topics: { policy: "Policy", business: "Business", research: "Research", open: "Open source", models: "Models", tools: "Tools" },
  briefing: {
    headline: "Two big model launches today.",
    points: [
      { text: "A new open model beats older ones.", id: "a1" },
      { text: "Prices fell again.", id: "a2" },
    ],
  },
  stories: [
    { title: "Open model <Tiny> released", url: "https://example.com/tiny?a=1&b=2", source: "Example News", summary: "It is small & fast.", topic: "models" },
    { title: "New AI law passes", url: "https://example.org/law", source: "Gov Daily", summary: "Rules for labels.", topic: "policy" },
    { title: "No link story", url: "javascript:alert(1)", source: "", summary: "", topic: "models" },
  ],
};
const NEWS_BUTTONS = JSON.stringify([
  ["news:all", "news:policy", "news:business"],
  ["news:research", "news:open", "news:models"],
  ["news:tools"],
  [`${PAGES}/news/`],
]);
const TINY_STORY = '1. <a href="https://example.com/tiny?a=1&amp;b=2">Open model &lt;Tiny&gt; released</a> — Example News\nIt is small &amp; fast.';
const ALL_STORIES = [
  "<b>Today in short</b>",
  "Two big model launches today.",
  "• A new open model beats older ones.",
  "• Prices fell again.",
  "",
  TINY_STORY,
  '2. <a href="https://example.org/law">New AI law passes</a> — Gov Daily',
  "Rules for labels.",
  "3. No link story",
].join("\n");
const ALL_NEWS = `📰 <b>GlowNews</b>\n\n${ALL_STORIES}`;
const NEWS_ERROR = "GlowNews could not be loaded right now. Try again in a minute.";

// The topic button that carries the "this one is showing" tick.
const tickedTopic = (call) =>
  call.payload.reply_markup.inline_keyboard
    .flat()
    .filter((button) => button.text.startsWith("✓ "))
    .map((button) => button.callback_data);

test("/news shows today's briefing and stories, with unsafe links left out", async () => {
  const kit = makeChat({ web: fakeWeb({ news: EDITION }) });
  await kit.say("/news");
  const calls = kit.fresh();
  assert.deepEqual(outline(calls), [`sendMessage ${NEWS_BUTTONS}`]);
  assert.deepEqual(texts(calls), [ALL_NEWS]);
  assert.deepEqual(tickedTopic(calls[0]), ["news:all"]);
  assert.ok(!calls[0].payload.text.includes("javascript:"));
  assert.deepEqual(kit.errors, []);
});

test("/news with a topic shows only that topic's stories", async () => {
  const kit = makeChat({ web: fakeWeb({ news: EDITION }) });
  await kit.say("/news models");
  const calls = kit.fresh();
  assert.deepEqual(outline(calls), [`sendMessage ${NEWS_BUTTONS}`]);
  assert.deepEqual(texts(calls), [`📰 <b>GlowNews</b> · Models\n\n${TINY_STORY}\n2. No link story`]);
  assert.deepEqual(tickedTopic(calls[0]), ["news:models"]);
});

test("the topic buttons rewrite the news message in place, from one download", async () => {
  const kit = makeChat({ web: fakeWeb({ news: EDITION }) });
  await kit.say("/news");
  kit.fresh();

  await kit.tap("news:policy", 101);
  let calls = kit.fresh();
  assert.deepEqual(outline(calls), ["toast: OK", `editMessageText #101 ${NEWS_BUTTONS}`]);
  assert.equal(
    calls[1].payload.text,
    '📰 <b>GlowNews</b> · Policy\n\n1. <a href="https://example.org/law">New AI law passes</a> — Gov Daily\nRules for labels.',
  );
  assert.deepEqual(tickedTopic(calls[1]), ["news:policy"]);

  await kit.tap("news:tools", 101);
  calls = kit.fresh();
  assert.equal(calls[1].payload.text, "📰 <b>GlowNews</b> · Tools\n\nNo stories right now.");

  await kit.tap("news:all", 101);
  calls = kit.fresh();
  assert.deepEqual(outline(calls), ["toast: OK", `editMessageText #101 ${NEWS_BUTTONS}`]);
  assert.equal(calls[1].payload.text, ALL_NEWS);
  assert.equal(kit.web.calls.news, 1);

  // Five minutes later the edition is fetched again. A topic nobody knows shows everything.
  kit.now.advance(5 * 60 * 1000);
  await kit.say("/news zzz");
  assert.deepEqual(texts(kit.fresh()), [ALL_NEWS]);
  assert.equal(kit.web.calls.news, 2);
  assert.deepEqual(kit.errors, []);
});

test("when GlowNews cannot be loaded the chat says so, and a topic tap says so in a pop-up", async () => {
  const kit = makeChat({ web: fakeWeb({ news: new Error("offline") }) });
  await kit.say("/news");
  assert.deepEqual(texts(kit.fresh()), [NEWS_ERROR]);
  await kit.tap("news:policy", 101);
  assert.deepEqual(outline(kit.fresh()), [`alert: ${NEWS_ERROR}`]);
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ /daily
const DAILY_USAGE = "Use it like this:\n<code>/daily 07:30</code>\n<code>/daily off</code>";
const HOUR_MS = 3600 * 1000;

test("/daily needs a real time", async () => {
  for (const command of ["/daily", "/daily 25:00", "/daily 7:5", "/daily 07:61", "/daily soon"]) {
    const { kit, said } = await answerTo(command);
    assert.deepEqual(said, [DAILY_USAGE], command);
    assert.equal(kit.logic.state.daily, null, command);
    assert.equal(alarmIn(kit), null, command);
  }
});

test("/daily sets the time, starting today when it is still ahead and tomorrow when it has passed", async () => {
  for (const command of ["/daily 07:30", "/daily 7:30"]) {
    const { kit, said } = await answerTo(command);
    assert.deepEqual(said, ["✅ AI news every day at 07:30 (UTC+7)."]);
    assert.deepEqual(kit.logic.state.daily, { hour: 7, minute: 30, lastSent: "", tries: 0, retryAt: 0, retryDay: "" });
    assert.equal(alarmIn(kit), 5 * 3600);
  }

  // The chat's clock stands at 02:30, so 01:00 has gone by today.
  const { kit, said } = await answerTo("/daily 01.00");
  assert.deepEqual(said, ["✅ AI news every day at 01:00 (UTC+7)."]);
  assert.equal(kit.logic.state.daily.lastSent, "2026-11-12");
  assert.equal(alarmIn(kit), 22.5 * 3600);

  await kit.say("/daily off");
  assert.deepEqual(texts(kit.fresh()), ["✅ Daily news is off."]);
  assert.equal(kit.logic.state.daily, null);
  assert.equal(alarmIn(kit), null);
});

test("the daily news arrives at its time, once a day", async () => {
  const kit = makeChat({ web: fakeWeb({ news: EDITION }) });
  await kit.say("/daily 07:30");
  kit.fresh();

  assert.equal(await kit.run({ forMs: 4 * HOUR_MS }), 0);
  assert.equal(await kit.run({ forMs: 6 * HOUR_MS }), 1);
  assert.equal(kit.now() - START, 5 * HOUR_MS);
  let calls = kit.fresh();
  assert.deepEqual(outline(calls), [`sendMessage ${NEWS_BUTTONS}`]);
  assert.deepEqual(texts(calls), [`📰 <b>Your daily AI news</b>\n\n${ALL_STORIES}`]);
  assert.equal(kit.logic.state.daily.lastSent, "2026-11-12");
  assert.equal(alarmIn(kit), 24 * 3600);
  assert.equal(kit.web.calls.news, 1);

  assert.equal(await kit.run({ forMs: 25 * HOUR_MS }), 1);
  assert.equal(kit.now() - START, 29 * HOUR_MS);
  calls = kit.fresh();
  assert.deepEqual(outline(calls), [`sendMessage ${NEWS_BUTTONS}`]);
  assert.equal(kit.logic.state.daily.lastSent, "2026-11-13");
  assert.equal(alarmIn(kit), 24 * 3600);
  assert.deepEqual(kit.errors, []);
});

test("daily news that cannot be loaded is retried twice, then left for tomorrow without a word", async () => {
  const web = fakeWeb({ news: (n) => (n <= 3 ? new Error("offline") : EDITION) });
  const kit = makeChat({ web });
  await kit.say("/daily 03:00");
  kit.fresh();
  assert.equal(alarmIn(kit), 30 * 60);

  await kit.tickOnce();
  assert.deepEqual(kit.logic.state.daily, {
    hour: 3,
    minute: 0,
    lastSent: "",
    tries: 1,
    retryAt: START + 40 * 60 * 1000,
    retryDay: "2026-11-12",
  });
  assert.equal(alarmIn(kit), 10 * 60);

  await kit.tickOnce();
  assert.equal(kit.logic.state.daily.tries, 2);
  assert.equal(kit.logic.state.daily.retryAt, START + 50 * 60 * 1000);
  assert.equal(alarmIn(kit), 10 * 60);

  await kit.tickOnce();
  assert.equal(kit.now() - START, 50 * 60 * 1000);
  assert.deepEqual(kit.logic.state.daily, { hour: 3, minute: 0, lastSent: "2026-11-12", tries: 0, retryAt: 0, retryDay: "" });
  assert.equal(alarmIn(kit), 24 * 3600 - 20 * 60);
  assert.deepEqual(kit.fresh(), []);

  await kit.tickOnce();
  assert.equal(kit.now() - START, 24.5 * HOUR_MS);
  assert.deepEqual(outline(kit.fresh()), [`sendMessage ${NEWS_BUTTONS}`]);
  assert.equal(kit.logic.state.daily.lastSent, "2026-11-13");
  assert.equal(web.calls.news, 4);
});

test("daily news stops for good when the user has blocked the bot", async () => {
  const kit = makeChat({ web: fakeWeb({ news: EDITION }) });
  await kit.say("/daily 07:30");
  kit.fresh();
  kit.telegram.refuse("sendMessage", BLOCKED);
  assert.equal(await kit.run({ forMs: 6 * HOUR_MS }), 1);
  assert.deepEqual(outline(kit.fresh()), [`sendMessage ${NEWS_BUTTONS}`]);
  assert.equal(kit.logic.state.daily, null);
  assert.equal(alarmIn(kit), null);
  assert.deepEqual(kit.registry.calls, []);
  assert.equal(await kit.run({ forMs: 48 * HOUR_MS }), 0);
});
