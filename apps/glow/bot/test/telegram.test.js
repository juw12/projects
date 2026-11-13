// GlowBot in Telegram, end to end: setup, pairing, access, GlowChat, GlowLead missions, /stop,
// busy models and the other Glow services. Telegram, the models and the web are all pretend.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorker } from "../src/index.js";
import { KEYLESS } from "../src/models.js";
import { createTelegram, markdownToHtml, splitMarkdown } from "../src/telegram.js";
import { sha256Hex } from "../src/util.js";
import { FakeNamespace, completion, fakeFetch, makeClock, reply } from "./fakes.js";

const PAGES = "https://glow.test/projects/glow";
const SETUP_CODE = "a-test-code-that-opens-nothing-real";
const TOKEN = "123456789:AAH-fake-token-for-tests-only-xyz0123456789";
const TG = `https://api.telegram.org/bot${TOKEN}/`;
const OWNER = { id: 1001, is_bot: false, first_name: "Juwen" };
const FRIEND = { id: 2002, is_bot: false, first_name: "Friend" };
const OVH = KEYLESS[0].url;

// ---------------------------------------------------------------- pretend Telegram and models

function fakeTelegram() {
  const sent = [];
  let nextMessage = 500;
  const handler = async (url, init) => {
    const method = url.slice(TG.length);
    const body = init.body ? JSON.parse(init.body) : {};
    sent.push({ method, body });
    if (method === "getMe") return reply({ ok: true, result: { id: 777, is_bot: true, username: "GlowTestBot", first_name: "Glow" } });
    if (method === "sendMessage") return reply({ ok: true, result: { message_id: nextMessage++, chat: { id: body.chat_id }, text: body.text } });
    return reply({ ok: true, result: true });
  };
  return { sent, handler, of: (method) => sent.filter((call) => call.method === method) };
}

// The model answers by role, the way the real prompts ask for it.
function fakeModel(overrides = {}) {
  const asked = [];
  const handler = async (url, init) => {
    const body = JSON.parse(init.body);
    const system = body.messages[0].content;
    asked.push({ system, messages: body.messages });
    for (const [mark, answer] of Object.entries(overrides)) {
      if (system.includes(mark)) return typeof answer === "function" ? answer(body) : reply(completion(answer));
    }
    if (system.includes("You are GlowLead, the lead of a team")) {
      return reply(
        completion(
          JSON.stringify({
            summary: "Find two good options, then pick one.",
            criteria: ["Names a concrete pick", "Cites at least one source"],
            steps: [
              { worker: "room", title: "Research options", task: "Find two city e-bikes with current prices." },
              { worker: "chat", title: "Pick one", task: "Pick the better bike and say why." },
            ],
          }),
        ),
      );
    }
    if (system.includes("Write one short web search query")) return reply(completion("city e-bike prices"));
    if (system.includes("researcher of the GlowRoom crew")) return reply(completion("Bike A costs $900 [1]. Bike B costs $1100 [2]."));
    if (system.includes("You are GlowChat, working for GlowLead")) return reply(completion("Pick **Bike A**: it is cheaper."));
    if (system.includes("You are GlowLead, the team lead")) {
      return reply(completion('## Pick: Bike A\nBike A costs $900 [1].\nCHECK: {"met":[true,true],"missing":""}'));
    }
    if (system.includes("You are GlowChat, the assistant of Glow")) {
      return reply(completion(`Hello from GlowChat (${body.messages.length} messages seen).`));
    }
    return reply(completion("ok"));
  };
  return { asked, handler };
}

const RSS_PAGE = `<?xml version="1.0"?><rss><channel>
<item><title>Bike A review</title><link>https://bikes.example/a</link><description>Bike A for $900.</description></item>
<item><title>Bike B review</title><link>https://bikes.example/b</link><description>Bike B for $1100.</description></item>
</channel></rss>`;

async function setUp(options = {}) {
  const now = makeClock(Date.UTC(2026, 10, 13, 3, 0, 0));
  const telegram = fakeTelegram();
  const model = fakeModel(options.answers);
  const routes = [
    [TG, telegram.handler],
    [OVH, options.modelHandler || model.handler],
    ["https://r.jina.ai/", async () => new Response("rate limited", { status: 429 })],
    ["https://www.bing.com/search?format=rss", async () => new Response(RSS_PAGE, { headers: { "Content-Type": "text/xml" } })],
    [
      "https://bikes.example/",
      async (url) =>
        new Response(`<html><head><title>${url}</title></head><body><p>Price list from ${url}: $900.</p></body></html>`, {
          headers: { "Content-Type": "text/html" },
        }),
    ],
    [PAGES + "/news/news.json", async () => reply(options.news || { generated_at: "2026-11-13T01:53:29+00:00", briefing: ["Gemini 4 is out."], stories: [] })],
    ...(options.routes || []),
  ];
  const send = fakeFetch(routes);
  const { worker, ChatAgent, Registry } = createWorker({ fetch: send, now });
  const env = {
    ALLOWED_ORIGINS: "https://juw12.github.io",
    GLOW_PAGES: PAGES,
    SETUP_CODE_SHA256: await sha256Hex(SETUP_CODE),
    BUILD: "build-two",
  };
  env.CHAT = new FakeNamespace(ChatAgent, env, now);
  env.REGISTRY = new FakeNamespace(Registry, env, now);

  async function call(path, init = {}) {
    const response = await worker.fetch(new Request("https://glow-bot.test" + path, init), env);
    const raw = await response.text();
    let body = raw;
    try {
      body = JSON.parse(raw);
    } catch (error) {
      // plain text
    }
    return { status: response.status, body };
  }

  async function connect() {
    const answer = await call("/v1/setup", {
      method: "POST",
      headers: { "X-Glow-Setup-Code": SETUP_CODE, "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    const secret = telegram.of("setWebhook")[0].body.secret_token;
    return { ...answer.body, secret };
  }

  let updateId = 1;
  let secret = "";
  async function deliver(update, settle = true) {
    const answer = await call("/v1/telegram", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret, "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: updateId++, ...update }),
    });
    if (settle) await settleAll();
    return answer;
  }
  // Let the queue's background work and every due alarm finish.
  async function settleAll() {
    for (let round = 0; round < 5; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await env.CHAT.runAlarms(200);
    }
  }
  const say = (from, text, chat = { id: from.id, type: "private" }) => deliver({ message: { message_id: updateId, from, chat, text } });
  const press = (from, data, chat = { id: from.id, type: "private" }) =>
    deliver({ callback_query: { id: "cb" + updateId, from, data, message: { message_id: 1, chat } } });

  // Connect the bot and pair the owner, as a real first run would.
  async function ready() {
    const setup = await connect();
    secret = setup.secret;
    const code = new URL(setup.pairLink).searchParams.get("start");
    await say(OWNER, `/start ${code}`);
    telegram.sent.length = 0;
    return setup;
  }

  return { env, now, call, send, telegram, model, connect, deliver, say, press, ready, settleAll, setSecret: (value) => (secret = value) };
}

const textsTo = (telegram, chatId) =>
  telegram.sent.filter((call) => call.method === "sendMessage" && call.body.chat_id === chatId).map((call) => call.body.text);

// ---------------------------------------------------------------- formatting

test("model Markdown becomes the HTML Telegram shows", () => {
  const html = markdownToHtml(
    "# Title\n**bold** and *italic* and `x<y`\n- one\n- two\n[Glow](https://juw12.github.io/a?b=1&c=2)\n```js\nif (a < b) {}\n```\n| a | b |\n|---|---|\n| 1 | 2 |",
  );
  assert.equal(
    html,
    [
      "<b>Title</b>",
      "<b>bold</b> and <i>italic</i> and <code>x&lt;y</code>",
      "• one",
      "• two",
      '<a href="https://juw12.github.io/a?b=1&amp;c=2">Glow</a>',
      "<pre>if (a &lt; b) {}</pre>",
      "a · b",
      "1 · 2",
    ].join("\n"),
  );
  assert.equal(markdownToHtml("5 < 6 & 7 > 3"), "5 &lt; 6 &amp; 7 &gt; 3");
  assert.equal(markdownToHtml("snake_case_name stays"), "snake_case_name stays");
});

test("long answers are cut at line breaks and a cut code block is closed and reopened", () => {
  const lines = [];
  for (let index = 0; index < 400; index++) lines.push(`line ${index} of the answer, long enough to matter`);
  const pieces = splitMarkdown("intro\n```\n" + lines.join("\n") + "\n```\noutro", 3500);
  assert.ok(pieces.length >= 5, `${pieces.length} pieces`);
  for (const piece of pieces) {
    assert.ok(piece.length <= 3500, `piece of ${piece.length}`);
    assert.equal((piece.match(/```/g) || []).length % 2, 0, "every piece opens and closes its code blocks");
  }
  assert.ok(pieces[0].startsWith("intro"));
  assert.ok(pieces.at(-1).endsWith("outro"));
  assert.deepEqual(splitMarkdown(""), []);
  const giant = splitMarkdown("x".repeat(9000), 3500);
  assert.ok(giant.every((piece) => piece.length <= 3500) && giant.join("").length === 9000);
});

test("HTML Telegram cannot read is sent again as plain text, and the token never leaks", async () => {
  const calls = [];
  const send = fakeFetch([
    [
      TG,
      async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push(body);
        if (body.parse_mode === "HTML") return reply({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }, { status: 400 });
        return reply({ ok: true, result: { message_id: 9 } });
      },
    ],
  ]);
  const telegram = createTelegram({ fetch: send, token: TOKEN });
  const sent = await telegram.sendMarkdown(42, "**half bold");
  assert.equal(sent.message_id, 9);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].parse_mode, undefined);
  assert.equal(calls[1].text, "**half bold");

  const broken = createTelegram({ fetch: async () => Promise.reject(new Error(`connect failed for ${TG}sendMessage`)), token: TOKEN });
  await assert.rejects(broken.call("sendMessage", {}), (error) => !error.message.includes(TOKEN) && error.message.includes("<token>"));
});

// ---------------------------------------------------------------- setup and access

test("setup needs the setup code and a real-looking token, then sets the webhook and a pairing link", async () => {
  const bot = await setUp();
  const denied = await bot.call("/v1/setup", { method: "POST", body: JSON.stringify({ token: TOKEN }) });
  assert.equal(denied.status, 403);
  const bad = await bot.call("/v1/setup", {
    method: "POST",
    headers: { "X-Glow-Setup-Code": SETUP_CODE },
    body: JSON.stringify({ token: "nope" }),
  });
  assert.equal(bad.status, 400);
  assert.equal(bot.telegram.sent.length, 0, "a bad token never reaches Telegram");

  const setup = await bot.connect();
  assert.equal(setup.ok, true);
  assert.deepEqual(setup.bot, { username: "GlowTestBot", name: "Glow" });
  assert.equal(setup.paired, false);
  assert.match(setup.pairLink, /^https:\/\/t\.me\/GlowTestBot\?start=[0-9a-f]{32}$/);
  const hook = bot.telegram.of("setWebhook")[0].body;
  assert.equal(hook.url, "https://glow-bot.test/v1/telegram");
  assert.match(hook.secret_token, /^[0-9a-f]{48}$/);
  assert.deepEqual(hook.allowed_updates, ["message", "callback_query"]);
  assert.ok(bot.telegram.of("setMyCommands")[0].body.commands.some((command) => command.command === "lead"));

  const status = await bot.call("/v1/status");
  assert.equal(status.body.configured, true);
  assert.equal(status.body.bot, "GlowTestBot");
  assert.equal(status.body.paired, false);
  assert.equal(JSON.stringify(status.body).includes(TOKEN), false, "the token is never shown");
});

test("only Telegram (with the webhook secret) may post updates", async () => {
  const bot = await setUp();
  await bot.connect();
  bot.setSecret("wrong-secret");
  const answer = await bot.say(OWNER, "hello");
  assert.equal(answer.status, 403);
  assert.equal(bot.telegram.of("sendMessage").length, 0);
});

test("the first person with the pairing link becomes the owner; everyone else is turned away until allowed", async () => {
  const bot = await setUp();
  const setup = await bot.connect();
  bot.setSecret(setup.secret);

  await bot.say(FRIEND, "hi");
  assert.match(textsTo(bot.telegram, FRIEND.id)[0], /not paired yet/);
  await bot.say(FRIEND, "/start not-the-code");
  assert.equal(bot.model.asked.length, 0, "no model is used for strangers");

  const code = new URL(setup.pairLink).searchParams.get("start");
  await bot.say(OWNER, `/start ${code}`);
  assert.match(textsTo(bot.telegram, OWNER.id).at(-1), /You are now the owner/);
  assert.equal((await bot.call("/v1/status")).body.paired, true);

  await bot.say(FRIEND, `/start ${code}`);
  assert.match(textsTo(bot.telegram, FRIEND.id).at(-1), /private.*2002/s, "the pairing code works only once");

  await bot.say(OWNER, "/allow 2002");
  assert.match(textsTo(bot.telegram, OWNER.id).at(-1), /2002.*can use this bot now/);
  await bot.say(FRIEND, "hello there");
  assert.match(textsTo(bot.telegram, FRIEND.id).at(-1), /Hello from GlowChat/);

  await bot.say(FRIEND, "/allow 3003");
  assert.match(textsTo(bot.telegram, FRIEND.id).at(-1), /Only the owner/);
  await bot.say(OWNER, "/deny 1001");
  assert.match(textsTo(bot.telegram, OWNER.id).at(-1), /owner cannot be removed/);
  await bot.say(OWNER, "/deny 2002");
  await bot.say(FRIEND, "still here?");
  assert.match(textsTo(bot.telegram, FRIEND.id).at(-1), /private/);
});

// ---------------------------------------------------------------- GlowChat

test("GlowChat answers with a memory of the conversation until /new", async () => {
  const bot = await setUp();
  await bot.ready();
  await bot.say(OWNER, "hi");
  await bot.say(OWNER, "and again");
  const texts = textsTo(bot.telegram, OWNER.id);
  assert.match(texts[0], /2 messages seen/, "system + the message");
  assert.match(texts[1], /4 messages seen/, "system + first exchange + the message");
  assert.ok(bot.telegram.of("sendChatAction").length >= 2, "shows typing while it thinks");
  assert.match(bot.model.asked[0].system, /Today is 2026-11-13/);

  await bot.say(OWNER, "/new");
  await bot.say(OWNER, "fresh");
  assert.match(textsTo(bot.telegram, OWNER.id).at(-1), /2 messages seen/);
});

test("the same update delivered twice is answered once", async () => {
  const bot = await setUp();
  await bot.ready();
  const update = { update_id: 9000, message: { message_id: 1, from: OWNER, chat: { id: OWNER.id, type: "private" }, text: "once" } };
  const secret = (await bot.env.REGISTRY.object("main").storage.get("config")).secret;
  for (let copy = 0; copy < 2; copy++) {
    await bot.call("/v1/telegram", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify(update),
    });
    await bot.settleAll();
  }
  assert.equal(textsTo(bot.telegram, OWNER.id).length, 1);
});

test("when every free model is busy GlowChat says when to try again", async () => {
  const busy = async () => new Response('{"error":"slow down"}', { status: 429, headers: { "Retry-After": "40" } });
  const bot = await setUp({ modelHandler: busy, routes: [["https://", busy]] });
  await bot.ready();
  await bot.say(OWNER, "hello?");
  assert.match(textsTo(bot.telegram, OWNER.id).at(-1), /busy right now\. Try again in about \d+ s/);
});

// ---------------------------------------------------------------- GlowLead

test("a GlowLead mission: plan, Start, research with sources, a chat step, the check and the report", async () => {
  const bot = await setUp();
  await bot.ready();
  await bot.say(OWNER, "/lead find me a city e-bike under $1000");

  const card = bot.telegram.of("sendMessage")[0];
  assert.match(card.body.text, /GlowLead mission/);
  const planned = bot.telegram.of("editMessageText").at(-1).body;
  assert.match(planned.text, /Research options/);
  assert.match(planned.text, /Pick one/);
  assert.match(planned.text, /Names a concrete pick/);
  assert.match(planned.text, /Tap <b>Start<\/b>/);
  const start = planned.reply_markup.inline_keyboard[0][0];
  assert.equal(start.text, "▶️ Start");
  assert.equal(bot.model.asked.length, 1, "nothing runs before the user says Start");

  await bot.press(OWNER, start.callback_data);
  assert.match(bot.telegram.of("answerCallbackQuery").at(-1).body.text, /on it/);

  const order = [
    "You are GlowLead, the lead of a team",
    "Write one short web search query",
    "You are the researcher of the GlowRoom crew",
    "You are GlowChat, working for GlowLead",
    "You are GlowLead, the team lead",
  ];
  assert.equal(bot.model.asked.length, order.length);
  order.forEach((start, index) => assert.ok(bot.model.asked[index].system.startsWith(start), `call ${index + 1}: ${start}`));
  const researcher = bot.model.asked[2].messages[1].content;
  assert.match(researcher, /\[1\] Bike A review\nhttps:\/\/bikes\.example\/a\n.*Price list/s, "the pages were read");
  const chatStep = bot.model.asked[3].messages[1].content;
  assert.match(chatStep, /Bike A costs \$900 \[1\]/, "the next worker sees the research");

  const report = textsTo(bot.telegram, OWNER.id).at(-1);
  assert.match(report, /<b>Pick: Bike A<\/b>/);
  assert.match(report, /GlowLead check: 2 of 2 met/);
  assert.match(report, /✅ Names a concrete pick/);
  assert.match(report, /Models: /);
  const done = bot.telegram.of("editMessageText").at(-1).body;
  assert.match(done.text, /✅ Done/);
  assert.deepEqual(done.reply_markup.inline_keyboard, []);

  await bot.say(OWNER, "/lead another one");
  assert.match(bot.telegram.of("sendMessage").at(-1).body.text, /GlowLead mission/, "a finished mission makes room for the next");
});

test("Stop ends a mission at once, and its step's answer is thrown away", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const bot = await setUp({
    answers: {
      "Write one short web search query": async () => {
        await gate;
        return reply(completion("query"));
      },
    },
  });
  await bot.ready();
  await bot.say(OWNER, "/lead research bikes");
  const start = bot.telegram.of("editMessageText").at(-1).body.reply_markup.inline_keyboard[0][0];
  const pressing = bot.press(OWNER, start.callback_data);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await bot.say(OWNER, "/stop");
  release();
  await pressing;
  await bot.settleAll();

  assert.ok(textsTo(bot.telegram, OWNER.id).includes("⏹ Mission stopped."));
  const card = bot.telegram.of("editMessageText").at(-1).body.text;
  assert.match(card, /Stopped/);
  assert.equal(
    bot.model.asked.some((ask) => ask.system.includes("the team lead. Your team")),
    false,
    "no check and no report after Stop",
  );
  await bot.say(OWNER, "/stop");
  assert.equal(textsTo(bot.telegram, OWNER.id).at(-1), "No mission is running.");
});

test("Cancel on a plan closes it without running anything", async () => {
  const bot = await setUp();
  await bot.ready();
  await bot.say(OWNER, "/lead write a haiku");
  const cancel = bot.telegram.of("editMessageText").at(-1).body.reply_markup.inline_keyboard[0][1];
  assert.equal(cancel.text, "✖️ Cancel");
  await bot.press(OWNER, cancel.callback_data);
  assert.match(bot.telegram.of("editMessageText").at(-1).body.text, /Stopped/);
  assert.equal(bot.model.asked.length, 1);
  const go = cancel.callback_data.replace("cancel:", "go:");
  await bot.press(OWNER, go);
  assert.match(bot.telegram.of("answerCallbackQuery").at(-1).body.text, /already been started or closed/);
});

test("busy models pause a mission and it carries on later; it gives up after the last try", async () => {
  let busy = false;
  const bot = await setUp({
    answers: {
      "You are GlowChat, working for GlowLead": () => (busy ? new Response("{}", { status: 429, headers: { "Retry-After": "30" } }) : reply(completion("done"))),
    },
    routes: [["https://", async () => new Response("{}", { status: 429, headers: { "Retry-After": "30" } })]],
  });
  await bot.ready();
  await bot.say(OWNER, "/lead write a haiku about rain");
  const start = bot.telegram.of("editMessageText").at(-1).body.reply_markup.inline_keyboard[0][0];
  busy = true;
  await bot.press(OWNER, start.callback_data);
  // The research step needs no chat model; the chat step is busy and waits.
  let card = bot.telegram.of("editMessageText").at(-1).body.text;
  assert.match(card, /free models are busy; trying again in \d+ s/);

  busy = false;
  bot.now.advance(10 * 60 * 1000);
  await bot.settleAll();
  card = bot.telegram.of("editMessageText").at(-1).body.text;
  assert.match(card, /✅ Done/);

  // A second mission that stays busy gives up with a clear message.
  await bot.say(OWNER, "/lead another haiku");
  const again = bot.telegram.of("editMessageText").at(-1).body.reply_markup.inline_keyboard[0][0];
  busy = true;
  await bot.press(OWNER, again.callback_data);
  for (let round = 0; round < 6; round++) {
    bot.now.advance(10 * 60 * 1000);
    await bot.settleAll();
  }
  card = bot.telegram.of("editMessageText").at(-1).body.text;
  assert.match(card, /Could not finish\. All the free models are busy/);
});

// ---------------------------------------------------------------- the other services

test("/search researches the live web and lists its sources", async () => {
  const bot = await setUp();
  await bot.ready();
  await bot.say(OWNER, "/search");
  assert.match(textsTo(bot.telegram, OWNER.id).at(-1), /followed by what to look up/);
  await bot.say(OWNER, "/search city e-bike prices");
  const answer = textsTo(bot.telegram, OWNER.id).at(-1);
  assert.match(answer, /Bike A costs \$900 \[1\]/);
  assert.match(answer, /<b>Sources<\/b>/);
  assert.match(answer, /<a href="https:\/\/bikes\.example\/a">Bike A review<\/a>/);
  assert.match(answer, /GlowRoom crew · searched "city e-bike prices"/);
});

test("/news shows the GlowNews briefing and top stories", async () => {
  const news = {
    generated_at: "2026-11-13T01:53:29+00:00",
    briefing: ["Gemini 4 Hydrogen is out.", { text: "Agents get cheaper." }],
    stories: [
      { title: "Introducing Gemini 4 Hydrogen", url: "https://deepmind.google/x", source: "Google DeepMind", topic: "models", summary: "A fast model." },
      { title: "Second story", url: "https://example.com/2", source: "HN", topic: "tools", summary: "Tools." },
    ],
  };
  const bot = await setUp({ news });
  await bot.ready();
  await bot.say(OWNER, "/news");
  const text = textsTo(bot.telegram, OWNER.id).at(-1);
  assert.match(text, /GlowNews<\/b> · edition of 2026-11-13 01:53 UTC/);
  assert.match(text, /• Gemini 4 Hydrogen is out\./);
  assert.match(text, /• Agents get cheaper\./);
  assert.match(text, /<b>1\. <a href="https:\/\/deepmind\.google\/x">Introducing Gemini 4 Hydrogen<\/a><\/b>/);
  assert.match(text, /Google DeepMind · models/);
  assert.equal(bot.model.asked.length, 0, "the news costs no model call");
});

test("help, ids, the model list, other bots' commands and non-text messages", async () => {
  const bot = await setUp();
  await bot.ready();
  await bot.say(OWNER, "/help");
  assert.match(textsTo(bot.telegram, OWNER.id).at(-1), /GlowLead.*Owner/s);
  await bot.say(OWNER, "/myid");
  assert.match(textsTo(bot.telegram, OWNER.id).at(-1), /<code>1001<\/code>/);
  await bot.say(OWNER, "/models");
  assert.match(textsTo(bot.telegram, OWNER.id).at(-1), /Llama 3\.3 70B/);
  await bot.say(OWNER, "/dance");
  assert.match(textsTo(bot.telegram, OWNER.id).at(-1), /don't know \/dance/);
  const before = bot.telegram.of("sendMessage").length;
  await bot.say(OWNER, "/help@SomeOtherBot", { id: -100, type: "group" });
  assert.equal(bot.telegram.of("sendMessage").length, before, "a command for another bot is ignored");
  await bot.deliver({ message: { message_id: 5, from: OWNER, chat: { id: OWNER.id, type: "private" }, photo: [{}] } });
  assert.match(textsTo(bot.telegram, OWNER.id).at(-1), /only read text/);
});
