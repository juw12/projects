// The commands that came back from GlowBot 0.2.0 and the owner's access list, word for word:
// /new and /reset, /models, /search and /mission, /myid, /allow, /deny and /users.

import test from "node:test";
import assert from "node:assert/strict";

import {
  AS_MEMBER,
  AS_STRANGER,
  CONFIG,
  FRIEND,
  GLOWCHAT,
  GROUP_CHAT,
  OWNER,
  STOP_BUTTON,
  did,
  fakeRegistry,
  job,
  makeChat,
  outline,
  texts,
} from "./chat-kit.js";
import { AI_MODELS, KEYLESS } from "../src/models.js";
import { t } from "../src/strings.js";

const MINUTE = 60 * 1000;
const STRANGER = { id: 9009, is_bot: false, first_name: "Stranger", language_code: "en" };
const STRANGER_CHAT = { id: STRANGER.id, type: "private" };
const AS_FRIEND = { from: FRIEND, access: AS_MEMBER };
const OWNER_ONLY = "Only this bot's owner can do that.";
const ALLOW_USAGE =
  "Use <code>/allow 123456789</code> to let a chat in and <code>/deny 123456789</code> to take it out. " +
  "A person or a group can send /myid to see its id.";
const PRIVATE_NOTICE = "🔒 This bot is private. Only its owner can let this chat in.";
const STRANGER_ID = [
  "Your Telegram id: <code>9009</code>",
  "Send it to this bot's owner. They can let you in with <code>/allow 9009</code>.",
].join("\n");
const modeSet = (name) => `✅ Mode: <b>${name}</b>. Just type, and it goes there.`;

// A registry whose list of chats is the one given.
const registryListing = (chats, more = {}) => ({
  ...fakeRegistry(),
  users: async () => ({ ok: true, ownerId: OWNER.id, access: "private", chats, ...more }),
});

// ------------------------------------------------------------------ /new, /reset
for (const command of ["/new", "/reset"]) {
  test(`${command} makes GlowChat forget the talk so far, and nothing else`, async () => {
    const kit = makeChat({ rules: [[GLOWCHAT, "Hi."]] });
    await kit.say("/chat hello");
    await kit.run();
    kit.fresh();
    assert.deepEqual(kit.logic.state.history, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi." },
    ]);
    const before = structuredClone(kit.logic.state);

    await kit.say(command);
    did(kit, ["sendMessage"], ["🧹 Done. I have forgotten our chat so far."]);
    assert.deepEqual(kit.logic.state, { ...before, history: [] });
    assert.deepEqual(kit.errors, []);
  });
}

// ------------------------------------------------------------------ /models
test("/models lists the free models in the order they are asked, and which one is resting", async () => {
  const kit = makeChat();
  await kit.say("/models");
  did(kit, ['sendMessage [["mdl:test"],["mdl:spare"],["mdl:auto"]]'], [
    [
      "<b>The free models that answer</b>",
      "1. Test Model (Test)",
      "2. Spare &lt;Model&gt; (Test) · Spare Model · resting, about 2 min",
      "",
      "Your choice: <b>Auto</b>. I ask them in this order. When one is busy it rests and the next one answers.",
      "",
      "Tap a model to choose it, or type <code>/model name</code>. <code>/model auto</code> hands the choice back to me.",
    ].join("\n"),
  ]);
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.errors, []);
});

const MODEL_BUTTONS = '[["mdl:test"],["mdl:spare"],["mdl:auto"]]';
const MODEL_LIST = [
  "<b>The free models that answer</b>",
  "1. Test Model (Test)",
  "2. Spare &lt;Model&gt; (Test) · Spare Model · resting, about 2 min",
  "",
];
const MODEL_TAP = [
  "",
  "Tap a model to choose it, or type <code>/model name</code>. <code>/model auto</code> hands the choice back to me.",
];
const AUTO_LINE = "Your choice: <b>Auto</b>. I ask them in this order. When one is busy it rests and the next one answers.";
const chosenLine = (name) => `Your choice: <b>${name}</b> is asked first. If it is busy the next one answers.`;
const modelsText = (choice) => [...MODEL_LIST, choice, ...MODEL_TAP].join("\n");
const labelsOf = (call) => call.payload.reply_markup.inline_keyboard.map((row) => row[0].text);

test("/model with a name chooses who is asked first, and the tick moves to it", async () => {
  const kit = makeChat();
  await kit.say("/models");
  assert.deepEqual(labelsOf(kit.fresh()[0]), ["Test Model (Test)", "Spare <Model> (Test) · Spare Model", "✓ Auto: GlowBot chooses"]);

  await kit.say("/model spare");
  let calls = kit.fresh();
  assert.deepEqual(outline(calls), [`sendMessage ${MODEL_BUTTONS}`]);
  assert.deepEqual(texts(calls), [modelsText(chosenLine("Spare &lt;Model&gt; (Test) · Spare Model"))]);
  assert.deepEqual(labelsOf(calls[0]), ["Test Model (Test)", "✓ Spare <Model> (Test) · Spare Model", "Auto: GlowBot chooses"]);
  assert.equal(kit.logic.state.models.pinned, "spare");

  // Any part of the name will do, in any case.
  await kit.say("/model TEST MODEL");
  calls = kit.fresh();
  assert.deepEqual(texts(calls), [modelsText(chosenLine("Test Model (Test)"))]);
  assert.deepEqual(labelsOf(calls[0]), ["✓ Test Model (Test)", "Spare <Model> (Test) · Spare Model", "Auto: GlowBot chooses"]);
  assert.equal(kit.logic.state.models.pinned, "test");
  assert.deepEqual(kit.errors, []);
});

test("the choice outlives a restart, and /model auto hands it back", async () => {
  const kit = makeChat();
  await kit.say("/model spare");
  kit.fresh();
  await kit.restart();
  await kit.say("/models");
  assert.deepEqual(texts(kit.fresh()), [modelsText(chosenLine("Spare &lt;Model&gt; (Test) · Spare Model"))]);
  assert.equal(kit.logic.state.models.pinned, "spare");

  for (const word of ["auto", "Auto", "default", "reset", "off"]) {
    await kit.say("/model spare");
    kit.fresh();
    await kit.say(`/model ${word}`);
    did(kit, [`sendMessage ${MODEL_BUTTONS}`], [modelsText(AUTO_LINE)]);
    assert.equal("pinned" in kit.logic.state.models, false, word);
  }
  assert.deepEqual(kit.errors, []);
});

test("a name that fits no model, or more than one, changes nothing and says so", async () => {
  const kit = makeChat();
  await kit.say("/model spare");
  kit.fresh();

  await kit.say("/model nothing");
  did(kit, ["sendMessage"], ["I do not know a model called “nothing”. /models shows the list."]);
  await kit.say("/model model");
  did(kit, ["sendMessage"], [
    "More than one model matches “model”: Test Model (Test), Spare &lt;Model&gt; (Test) · Spare Model. Type more of the name.",
  ]);
  await kit.say("/model <b>bold</b>");
  did(kit, ["sendMessage"], ["I do not know a model called “&lt;b&gt;bold&lt;/b&gt;”. /models shows the list."]);
  assert.equal(kit.logic.state.models.pinned, "spare", "the earlier choice stands");
  assert.deepEqual(kit.errors, []);
});

test("tapping a model in the list chooses it, and the list is redrawn in place", async () => {
  const kit = makeChat();
  await kit.say("/models");
  kit.fresh();

  await kit.tap("mdl:test", 103);
  let calls = kit.fresh();
  assert.deepEqual(outline(calls), ["toast: OK", `editMessageText #103 ${MODEL_BUTTONS}`]);
  assert.deepEqual(texts(calls), ["OK", modelsText(chosenLine("Test Model (Test)"))]);
  assert.deepEqual(labelsOf(calls[1]), ["✓ Test Model (Test)", "Spare <Model> (Test) · Spare Model", "Auto: GlowBot chooses"]);
  assert.equal(kit.logic.state.models.pinned, "test");

  await kit.tap("mdl:auto", 103);
  calls = kit.fresh();
  assert.deepEqual(outline(calls), ["toast: OK", `editMessageText #103 ${MODEL_BUTTONS}`]);
  assert.deepEqual(texts(calls), ["OK", modelsText(AUTO_LINE)]);
  assert.deepEqual(labelsOf(calls[1]), ["Test Model (Test)", "Spare <Model> (Test) · Spare Model", "✓ Auto: GlowBot chooses"]);
  assert.equal("pinned" in kit.logic.state.models, false);
  assert.equal(kit.logic.state.job, null, "choosing a model starts no job");
  assert.deepEqual(kit.errors, []);
});

test("a button for a model that was retired is refused, and a retired choice is forgotten", async () => {
  const kit = makeChat();
  await kit.tap("mdl:gone", 103);
  did(kit, ["toast: That button is from an older job.", "editMessageReplyMarkup #103 []"], ["That button is from an older job."]);
  assert.equal("pinned" in kit.logic.state.models, false);

  // A choice saved before its model left the list: the list shows Auto again and the id is dropped.
  kit.logic.state.models.pinned = "gone";
  await kit.say("/models");
  did(kit, [`sendMessage ${MODEL_BUTTONS}`], [modelsText(AUTO_LINE)]);
  assert.equal("pinned" in kit.logic.state.models, false);
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ /about, /privacy, /cancel
test("/about and /version say which GlowBot this is and where to read more", async () => {
  const expected = [
    "<b>GlowBot 1.33.0</b> · build <code>test</code>",
    "",
    "An AI team in Telegram. Send a goal: GlowLead plans it, hands each step to an agent, checks the result and reports back. " +
      "Free, with no sign-up and no ads.",
    "",
    "🌐 Glow apps: https://juw12.github.io/projects/glow/",
    "🤖 About this bot: https://juw12.github.io/projects/glow/bot/",
    "",
    "/help shows everything I can do · /privacy says what I keep.",
  ].join("\n");
  for (const command of ["/about", "/version"]) {
    const kit = makeChat();
    await kit.say(command);
    did(kit, ["sendMessage"], [expected]);
    assert.equal(kit.logic.state.job, null);
    assert.deepEqual(kit.errors, []);
  }
});

test("/privacy says what is kept, in the chat's language, and starts nothing", async () => {
  const kit = makeChat();
  await kit.say("/privacy");
  const [english] = texts(kit.fresh());
  assert.equal(english, t("en", "privacy.text"));
  assert.match(english, /^🔒 <b>Privacy<\/b>\n/);

  await kit.say("/lang id");
  kit.fresh();
  await kit.say("/privacy");
  const [indonesian] = texts(kit.fresh());
  assert.equal(indonesian, t("id", "privacy.text"));
  assert.notEqual(indonesian, english);
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.errors, []);
});

test("the privacy text names every host a message can be sent to, and no site the bot does not use", () => {
  const hosts = [...new Set(KEYLESS.concat(AI_MODELS).map((entry) => entry.label))];
  assert.deepEqual(hosts, ["OVHcloud", "LLM7", "Workers AI"]);
  for (const lang of ["en", "id", "zh"]) {
    const text = t(lang, "privacy.text");
    for (const host of hosts) assert.ok(text.includes(host), `${lang}: ${host}`);
    for (const site of ["Bing", "Wikipedia"]) assert.ok(text.includes(site), `${lang}: ${site}`);
    assert.doesNotMatch(text, /DuckDuckGo|Google/, lang);
  }
});

test("/cancel is another word for /stop", async () => {
  const idle = makeChat();
  await idle.say("/cancel");
  did(idle, ["sendMessage"], ["Nothing is running."]);

  const stopped = {};
  for (const command of ["/stop", "/cancel"]) {
    const kit = makeChat();
    await kit.say("/lead Plan a picnic");
    kit.fresh();
    await kit.say(command);
    const calls = kit.fresh();
    stopped[command] = { lines: outline(calls), said: texts(calls), job: kit.logic.state.job };
    assert.deepEqual(kit.errors, []);
  }
  assert.equal(stopped["/cancel"].job, null, "the job is gone");
  assert.ok(stopped["/cancel"].lines.length > 0, "and the chat is told");
  assert.deepEqual(stopped["/cancel"], stopped["/stop"]);
});

// ------------------------------------------------------------------ /search, /mission
test("/search and /mission alone switch the mode, the way /room and /lead do", async () => {
  const kit = makeChat();
  await kit.say("/search");
  did(kit, ["sendMessage"], [modeSet("GlowRoom")]);
  assert.equal(kit.logic.state.mode, "room");

  await kit.say("/mission");
  did(kit, ["sendMessage"], [modeSet("GlowLead")]);
  assert.equal(kit.logic.state.mode, "lead");
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.errors, []);
});

test("/search with a goal starts the same GlowRoom job as /room", async () => {
  const started = {};
  for (const command of ["/room", "/search"]) {
    const kit = makeChat();
    await kit.say(`${command} Plan a picnic`);
    const calls = kit.fresh();
    started[command] = { lines: outline(calls), said: texts(calls), job: job(kit, "kind", "goal", "status", "phase") };
    assert.equal(kit.logic.state.mode, "lead");
    assert.deepEqual(kit.errors, []);
  }
  assert.deepEqual(started["/search"], {
    lines: [`sendMessage silent ${STOP_BUTTON}`],
    said: ["🏢 Nova is planning the crew's work…"],
    job: { kind: "room", goal: "Plan a picnic", status: "active", phase: "plan" },
  });
  assert.deepEqual(started["/search"], started["/room"]);
});

test("/mission with a goal starts the same GlowLead job as /lead", async () => {
  const started = {};
  for (const command of ["/lead", "/mission"]) {
    const kit = makeChat();
    await kit.say(`${command} Plan a picnic`);
    const calls = kit.fresh();
    started[command] = { lines: outline(calls), said: texts(calls), job: job(kit, "kind", "goal", "status", "phase") };
    assert.deepEqual(kit.errors, []);
  }
  assert.deepEqual(started["/mission"], {
    lines: [`sendMessage silent ${STOP_BUTTON}`],
    said: ["👑 GlowLead is planning…"],
    job: { kind: "lead", goal: "Plan a picnic", status: "active", phase: "plan" },
  });
  assert.deepEqual(started["/mission"], started["/lead"]);
});

// ------------------------------------------------------------------ /myid
test("/myid tells a person their id and the chat's id", async () => {
  const kit = makeChat();
  await kit.say("/myid");
  did(kit, ["sendMessage"], ["Your Telegram id: <code>9001</code>\nThis chat's id: <code>5001</code>"]);
  assert.deepEqual(kit.registry.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("/myid in a group answers the one who asked with the group's id, which /allow takes", async () => {
  const kit = makeChat({ chat: GROUP_CHAT });
  await kit.say("/myid", AS_FRIEND);
  did(kit, ["sendMessage re 1"], ["Your Telegram id: <code>9002</code>\nThis chat's id: <code>-1005001</code>"]);
  assert.deepEqual(kit.errors, []);
});

test("somebody not let in may ask /myid once a minute, and it does not use up the hourly notice", async () => {
  const kit = makeChat({ chat: STRANGER_CHAT });
  const asStranger = { from: STRANGER, access: AS_STRANGER };

  await kit.say("/myid", asStranger);
  did(kit, ["sendMessage"], [STRANGER_ID]);

  // Asking again right away gets nothing: no reply for every message of a stranger.
  await kit.say("/myid", asStranger);
  await kit.say(`/myid@${CONFIG.botUsername}`, asStranger);
  did(kit, [], []);

  // Anything else still gets the notice, once.
  await kit.say("hello", asStranger);
  did(kit, ["sendMessage"], [PRIVATE_NOTICE]);
  await kit.say("hello again", asStranger);
  did(kit, [], []);

  // "/myid" meant for another bot is just a message, and the notice has been given already.
  kit.now.advance(MINUTE);
  await kit.say("/myid@some_other_bot", asStranger);
  did(kit, [], []);

  // A minute after the first answer the id is told again.
  await kit.say(`/myid@${CONFIG.botUsername}`, asStranger);
  did(kit, ["sendMessage"], [STRANGER_ID]);

  // Nothing else of the chat was touched: no job, no memory, nothing asked of the registry.
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.logic.state.history, []);
  assert.deepEqual(kit.registry.calls, []);
  assert.deepEqual(kit.models.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("a bot without an owner does not hand out ids: /myid gets the set-up notice, once an hour", async () => {
  const kit = makeChat({ chat: STRANGER_CHAT });
  const unclaimed = { from: STRANGER, access: { ...AS_STRANGER, ownerKnown: false } };

  await kit.say("/myid", unclaimed);
  did(kit, ["sendMessage"], ["This bot is not set up yet. Its owner has to finish the setup first."]);
  await kit.say("/myid", unclaimed);
  did(kit, [], []);
  assert.equal(kit.logic.state.myIdAt, 0);

  kit.now.advance(60 * MINUTE);
  await kit.say("/myid", unclaimed);
  did(kit, ["sendMessage"], ["This bot is not set up yet. Its owner has to finish the setup first."]);
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ /allow, /deny
test("/allow lets a chat in by its id and says how many are let in now", async () => {
  const kit = makeChat();
  await kit.say("/allow 9002");
  did(kit, ["sendMessage"], ["✅ Chat <code>9002</code> can now use this bot. Chats let in: 4."]);

  // A group's id is negative. Whatever follows the id is not part of it.
  await kit.say("/allow -1005001 the club");
  did(kit, ["sendMessage"], ["✅ Chat <code>-1005001</code> can now use this bot. Chats let in: 4."]);
  assert.deepEqual(kit.registry.calls, [
    ["allow", "9002"],
    ["allow", "-1005001"],
  ]);
  assert.deepEqual(kit.errors, []);
});

test("/deny takes a chat out again", async () => {
  const kit = makeChat();
  await kit.say("/deny 9002");
  did(kit, ["sendMessage"], ["🚫 Chat <code>9002</code> can no longer use this bot."]);
  assert.deepEqual(kit.registry.calls, [["forget", "9002"]]);
  assert.deepEqual(kit.errors, []);
});

test("/allow and /deny without a real id explain themselves and change nothing", async () => {
  const kit = makeChat();
  const wrong = ["/allow", "/deny", "/allow abc", "/deny @budi", "/allow 12.5", "/allow 123456789012345678901", "/deny <b>1</b>"];
  for (const text of wrong) {
    await kit.say(text);
    did(kit, ["sendMessage"], [ALLOW_USAGE]);
  }
  assert.deepEqual(kit.registry.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("/allow says how to use it when the registry does not take the id", async () => {
  const registry = { ...fakeRegistry(), allow: async () => ({ ok: false, error: "id" }) };
  const kit = makeChat({ registry });
  await kit.say("/allow 9002");
  did(kit, ["sendMessage"], [ALLOW_USAGE]);
  assert.deepEqual(kit.errors, []);
});

test("/allow, /deny and /users are the owner's: a member is told so and the registry is not asked", async () => {
  const privately = makeChat();
  const inGroup = makeChat({ chat: GROUP_CHAT });
  for (const text of ["/allow 9002", "/deny 9001", "/users"]) {
    await privately.say(text, AS_FRIEND);
    did(privately, ["sendMessage"], [OWNER_ONLY]);
  }
  const asked = [];
  for (const text of ["/allow 9002", "/deny 9001", "/users"]) {
    asked.push(await inGroup.say(text, AS_FRIEND));
  }
  did(inGroup, asked.map((id) => `sendMessage re ${id}`), [OWNER_ONLY, OWNER_ONLY, OWNER_ONLY]);
  assert.deepEqual(privately.registry.calls, []);
  assert.deepEqual(inGroup.registry.calls, []);
  assert.deepEqual(privately.errors, []);
  assert.deepEqual(inGroup.errors, []);
});

test("the owner can /allow from a group too", async () => {
  const kit = makeChat({ chat: GROUP_CHAT });
  await kit.say("/allow 9002");
  did(kit, ["sendMessage re 1"], ["✅ Chat <code>9002</code> can now use this bot. Chats let in: 4."]);
  assert.deepEqual(kit.registry.calls, [["allow", "9002"]]);
});

// ------------------------------------------------------------------ /users
test("/users shows the owner who is let in, with a group's title made safe to show", async () => {
  const kit = makeChat();
  await kit.say("/users");
  did(kit, ["sendMessage"], [
    [
      "<b>Who can use this bot</b> · access: private",
      "Owner: <code>9001</code>",
      "<code>9002</code>",
      "<code>-1005001</code> Club &lt;1&gt;",
    ].join("\n"),
  ]);
  assert.deepEqual(kit.registry.calls, [["users"]]);
  assert.deepEqual(kit.errors, []);
});

test("/users says so when nobody else is let in, and that the bot is public when it is", async () => {
  const kit = makeChat({ registry: registryListing([], { access: "public" }) });
  await kit.say("/users");
  did(kit, ["sendMessage"], [
    "<b>Who can use this bot</b> · access: public\nOwner: <code>9001</code>\nNo other chat is let in yet.",
  ]);
  assert.deepEqual(kit.errors, []);
});

test("/users shows fifty chats and counts the rest", async () => {
  const chats = Array.from({ length: 53 }, (_, index) => ({ id: String(7000 + index), title: "" }));
  const kit = makeChat({ registry: registryListing(chats) });
  await kit.say("/users");
  const [text] = texts(kit.fresh());
  const lines = text.split("\n");
  assert.equal(lines.length, 2 + 50 + 1);
  assert.deepEqual(lines.slice(0, 3), [
    "<b>Who can use this bot</b> · access: private",
    "Owner: <code>9001</code>",
    "<code>7000</code>",
  ]);
  assert.deepEqual(lines.slice(-2), ["<code>7049</code>", "…and 3 more."]);
  assert.deepEqual(kit.errors, []);
});

test("/users in a group keeps the ids out of it: the owner is sent to the private chat", async () => {
  const kit = makeChat({ chat: GROUP_CHAT });
  await kit.say("/users");
  did(kit, ["sendMessage re 1"], ["Ask me that in our private chat, so the ids stay between us."]);
  assert.deepEqual(kit.registry.calls, []);
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ the simulator
test("a simulated /allow, /deny and /users never reach the real registry or Telegram", async () => {
  const kit = makeChat();
  await kit.logic.simulate({ text: "/allow 123" });
  await kit.logic.simulate({ text: "/deny 123" });
  await kit.logic.simulate({ text: "/users" });
  const rows = (await kit.logic.transcript()).calls.filter((row) => row.method === "sendMessage");
  assert.deepEqual(rows.map((row) => row.payload.text), [
    "✅ Chat <code>123</code> can now use this bot. Chats let in: 0.",
    "🚫 Chat <code>123</code> can no longer use this bot.",
    "<b>Who can use this bot</b> · access: private\nNo other chat is let in yet.",
  ]);
  assert.deepEqual(kit.registry.calls, []);
  assert.deepEqual(kit.telegram.calls, []);
  assert.deepEqual(kit.errors, []);
});
