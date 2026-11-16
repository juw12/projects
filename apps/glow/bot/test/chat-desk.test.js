// The owner's desk and the calculator, word for word: /calc, /note and /log, /notes, /save, /links,
// /post and its two buttons, /posts, /scan, /guard, /brief and /export.

import test from "node:test";
import assert from "node:assert/strict";

import { AS_MEMBER, FRIEND, GROUP_CHAT, STALE, did, makeChat, texts } from "./chat-kit.js";
import { fakeWeb } from "./fakes.js";

const AS_FRIEND = { from: FRIEND, access: AS_MEMBER };
const NOW = "2026-11-12 02:30";
const OWNER_ONLY = "Only this bot's owner can do that.";
const DESK_PRIVATE = "The desk only opens in our private chat. Send me that command there.";
const NOT_YOURS = "Only the person who started it, or the owner, can do that.";
const STOPPED = "🛡 <b>The Guard stopped this.</b> Nothing was saved.";
const SECRET_FOUND = "• Something that looks like a password, key or token";
const HIDDEN = "<i>hidden by the Guard</i>";
const POST_BUTTONS = '[["pst:1:y","pst:1:n"]]';
const GITHUB = "https://api.github.com/users/juw12/repos?sort=pushed&per_page=8";
// Put together here, so that no line of this file looks like a real key.
const FAKE_KEY = "gh" + "p_" + "a1B2c3D4".repeat(5);

const wordsFound = (n) => `• Guard words found: ${n}`;
const preview = (text) => `✍️ <b>Post to approve</b>\n\n${text}\n\nThe Guard found nothing. Keep it?`;
const said = (kit) => texts(kit.fresh());
const json = (value) => ({ ok: true, status: 200, type: "application/json", text: JSON.stringify(value) });

// The file /export sent: its name, its caption and what is written in it.
async function exported(kit) {
  const calls = kit.fresh();
  assert.deepEqual(calls.map((call) => call.method), ["sendDocument"]);
  const form = calls[0].payload;
  const file = form.get("document");
  return { chat: form.get("chat_id"), caption: form.get("caption"), name: file.name, text: await file.text() };
}

// ------------------------------------------------------------------ /calc
test("/calc works out a sum with units, and says so when it cannot", async () => {
  const kit = makeChat();
  await kit.say("/calc 12 kN / (20 mm * 5 mm) to MPa");
  did(kit, ["sendMessage"], ["🧮 <code>12 kN / (20 mm * 5 mm) to MPa</code>\n= <b>120 MPa</b>"]);

  await kit.say("/calc 1 in to mm");
  assert.deepEqual(said(kit), ["🧮 <code>1 in to mm</code>\n= <b>25.4 mm</b>"]);

  await kit.say("/calc 1/0");
  assert.deepEqual(said(kit), ["🧮 I could not work that out: Division by zero."]);

  await kit.say("/calc");
  assert.deepEqual(said(kit), [
    [
      "🧮 Give me a sum, with units if you like.",
      "<code>/calc 12 kN / (20 mm * 5 mm) to MPa</code>",
      "<code>/calc 1 in to mm</code>",
      "<code>/calc 3 * (4 + 5)</code>",
    ].join("\n"),
  ]);
  assert.deepEqual(kit.models.calls, [], "no AI model is asked");
  assert.deepEqual(kit.errors, []);
});

test("/calc shows what was typed as text, never as HTML", async () => {
  const kit = makeChat();
  await kit.say("/calc <b>2</b> + 2");
  const [answer] = said(kit);
  assert.ok(answer.startsWith("🧮 I could not work that out: "), answer);
  assert.ok(!answer.includes("<b>2</b>"), answer);
});

test("/calc is for everybody, in a group too", async () => {
  const kit = makeChat({ chat: GROUP_CHAT });
  await kit.say("/calc 3 * (4 + 5)", AS_FRIEND);
  did(kit, ["sendMessage re 1"], ["🧮 <code>3 * (4 + 5)</code>\n= <b>27</b>"]);
});

// ------------------------------------------------------------------ /note, /log, /notes
test("/note keeps a note, /log marks it as a log entry and /notes lists them", async () => {
  const kit = makeChat();
  await kit.say("/notes");
  assert.deepEqual(said(kit), ["No notes yet. Write one with <code>/note your text</code>."]);

  await kit.say("/note call the <supplier> on Monday");
  did(kit, ["sendMessage"], ["📝 Saved as note 1. /notes shows them."]);
  kit.now.advance(60 * 1000);
  await kit.say("/log torque test passed");
  assert.deepEqual(said(kit), ["📝 Saved as note 2. /notes shows them."]);

  await kit.say("/notes");
  assert.deepEqual(said(kit), [
    [
      "📝 <b>Notes</b> (the last 2)",
      `📝 <code>${NOW}</code> call the &lt;supplier&gt; on Monday`,
      "📓 <code>2026-11-12 02:31</code> torque test passed",
    ].join("\n"),
  ]);
  assert.deepEqual(kit.errors, []);
});

test("/note and /log without a text explain themselves and keep nothing", async () => {
  const kit = makeChat();
  const usage =
    "📝 Give me the note: <code>/note call the supplier on Monday</code>\n" +
    "/log does the same and marks it as a log entry. /notes shows them.";
  await kit.say("/note");
  await kit.say("/log");
  assert.deepEqual(said(kit), [usage, usage]);
  await kit.say("/notes");
  assert.deepEqual(said(kit), ["No notes yet. Write one with <code>/note your text</code>."]);
});

test("the desk is still there after the chat went to sleep", async () => {
  const kit = makeChat();
  await kit.say("/note keep me");
  kit.restart();
  kit.fresh();
  await kit.say("/notes");
  assert.deepEqual(said(kit), [`📝 <b>Notes</b> (the last 1)\n📝 <code>${NOW}</code> keep me`]);
});

// ------------------------------------------------------------------ /save, /links
test("/save keeps a link with its page title, once", async () => {
  const web = fakeWeb({
    raw: { "https://example.com/a": { text: "<html><head><title>Example Page</title></head></html>" } },
  });
  const kit = makeChat({ web });
  await kit.say("/links");
  assert.deepEqual(said(kit), ["No links yet. Save one with <code>/save https://example.com</code>."]);

  await kit.say("/save https://example.com/a read this later");
  did(kit, ["sendMessage"], ["🔗 Saved as link 1. /links shows them.\nExample Page"]);
  assert.deepEqual(web.calls.page[0], { url: "https://example.com/a", headers: { Accept: "text/html,*/*;q=0.5" } });

  await kit.say("/save https://example.com/a");
  assert.deepEqual(said(kit), ["🔗 You already saved that one. It is link 1.\nExample Page"]);

  // A page that gives no title is still a link worth keeping.
  await kit.say("/save https://example.org/x?a=1&b=2");
  assert.deepEqual(said(kit), ["🔗 Saved as link 2. /links shows them.\nhttps://example.org/x?a=1&amp;b=2"]);

  await kit.say("/links");
  assert.deepEqual(said(kit), [
    [
      "🔗 <b>Links</b> (the last 2)",
      '🔗 <a href="https://example.com/a">Example Page</a>',
      '🔗 <a href="https://example.org/x?a=1&amp;b=2">https://example.org/x?a=1&amp;b=2</a>',
    ].join("\n"),
  ]);
  assert.deepEqual(kit.errors, []);
});

test("/save keeps the link when its page does not answer at all", async () => {
  const web = fakeWeb({ raw: { "https://example.com/down": new Error("connection reset") } });
  const kit = makeChat({ web });
  await kit.say("/save https://example.com/down");
  assert.deepEqual(said(kit), ["🔗 Saved as link 1. /links shows them.\nhttps://example.com/down"]);
  assert.deepEqual(kit.errors, []);
});

test("/save refuses what is not a public web link, and does not go and look", async () => {
  const web = fakeWeb();
  const kit = makeChat({ web });
  const bad = "That is not a public web link. It has to start with http:// or https:// and point to a public site.";
  for (const link of ["example.com", "ftp://example.com/file", "http://192.168.1.10/admin", "http://localhost:8080/"]) {
    await kit.say(`/save ${link}`);
    assert.deepEqual(said(kit), [bad], link);
  }
  await kit.say("/save");
  assert.deepEqual(said(kit), ["🔗 Give me a link: <code>/save https://example.com</code>"]);
  assert.deepEqual(web.calls.page, []);
  await kit.say("/links");
  assert.deepEqual(said(kit), ["No links yet. Save one with <code>/save https://example.com</code>."]);
});

// ------------------------------------------------------------------ /post, /posts
test("/post shows the post first and keeps it only once it is approved", async () => {
  const kit = makeChat();
  await kit.say("/post Shipped <v2> today");
  did(kit, [`sendMessage ${POST_BUTTONS}`], [preview("Shipped &lt;v2&gt; today")]);

  await kit.say("/posts");
  assert.deepEqual(said(kit), ["No approved posts yet. Draft one with <code>/post your text</code>."]);

  await kit.tap("pst:1:y", 101);
  did(kit, ["toast: OK", "editMessageText #101 []"], ["OK", "✅ <b>Approved as post 1</b>\n\nShipped &lt;v2&gt; today"]);

  // A second tap on the same button keeps nothing twice.
  await kit.tap("pst:1:y", 101);
  assert.deepEqual(said(kit), [STALE]);

  await kit.say("/posts");
  assert.deepEqual(said(kit), [
    `✍️ <b>Approved posts</b> (the last 1)\n<b>#1</b> <code>${NOW}</code> Shipped &lt;v2&gt; today`,
  ]);
  assert.deepEqual(kit.errors, []);
});

test("a declined post is not kept, and neither is one that a newer draft replaced", async () => {
  const kit = makeChat();
  await kit.say("/post first draft");
  await kit.say("/post second draft");
  kit.fresh();

  await kit.tap("pst:1:y", 101);
  assert.deepEqual(said(kit), [STALE]);

  await kit.tap("pst:2:n", 102);
  did(kit, ["toast: OK", "editMessageText #102 []"], ["OK", "✖️ Declined. Nothing was kept."]);

  await kit.tap("pst:2:y", 102);
  assert.deepEqual(said(kit), [STALE]);
  await kit.say("/posts");
  assert.deepEqual(said(kit), ["No approved posts yet. Draft one with <code>/post your text</code>."]);
});

test("only the owner can approve a post", async () => {
  const kit = makeChat();
  await kit.say("/post mine to decide");
  kit.fresh();

  await kit.tap("pst:1:y", 101, AS_FRIEND);
  did(kit, [`alert: ${NOT_YOURS}`]);
  await kit.say("/posts");
  assert.deepEqual(said(kit), ["No approved posts yet. Draft one with <code>/post your text</code>."]);

  await kit.tap("pst:1:y", 101);
  did(kit, ["toast: OK", "editMessageText #101 []"]);
});

test("/post without a text explains itself", async () => {
  const kit = makeChat();
  await kit.say("/post");
  did(kit, ["sendMessage"], [
    "✍️ Give me the post: <code>/post your text</code>\n" +
      "The Guard reads it, then you approve it. /posts shows the approved ones.",
  ]);
});

// ------------------------------------------------------------------ /guard, /scan
test("/guard counts the owner's words and never shows them", async () => {
  const kit = makeChat();
  const show = (n) =>
    [
      "🛡 <b>The Guard</b>",
      `Your own words on its list: ${n}. I never show them.`,
      "It also stops anything that looks like a password, key or token.",
      "",
      "<code>/guard add word, another word</code> · add words",
      "<code>/guard clear</code> · remove all your words",
      "/scan <i>text</i> · check a text",
    ].join("\n");
  await kit.say("/guard");
  assert.deepEqual(said(kit), [show(0)]);

  await kit.say("/guard add Bluefern, quartzite");
  assert.deepEqual(said(kit), ["🛡 New words added: 2. The Guard now watches for 2 of your words."]);
  await kit.say("/guard add bluefern; kite");
  assert.deepEqual(said(kit), ["🛡 New words added: 1. The Guard now watches for 3 of your words."]);
  await kit.say("/guard");
  assert.deepEqual(said(kit), [show(3)]);

  const usage = "Use <code>/guard</code>, <code>/guard add word, another word</code> or <code>/guard clear</code>.";
  for (const wrong of ["/guard add", "/guard remove kite", "/guard clear kite"]) {
    await kit.say(wrong);
    assert.deepEqual(said(kit), [usage], wrong);
  }

  await kit.say("/guard clear");
  assert.deepEqual(said(kit), ["🛡 Your words are removed. The Guard still stops passwords, keys and tokens."]);
  await kit.say("/guard");
  assert.deepEqual(said(kit), [show(0)]);

  const everything = texts(kit.telegram.calls).join("\n").toLowerCase();
  for (const word of ["bluefern", "quartzite", "kite"]) assert.ok(!everything.includes(word), word);
});

test("/scan says what the Guard would stop, without repeating it", async () => {
  const kit = makeChat();
  await kit.say("/guard add bluefern, quartzite");
  kit.fresh();

  await kit.say("/scan lunch at noon");
  assert.deepEqual(said(kit), ["🛡 Clean. None of your guard words, and nothing that looks like a password, key or token."]);
  await kit.say("/scan the Bluefern and quartzite results");
  assert.deepEqual(said(kit), [[STOPPED, wordsFound(2)].join("\n")]);
  await kit.say(`/scan my key is ${FAKE_KEY}`);
  assert.deepEqual(said(kit), [[STOPPED, SECRET_FOUND].join("\n")]);
  await kit.say(`/scan bluefern ${FAKE_KEY}`);
  assert.deepEqual(said(kit), [[STOPPED, wordsFound(1), SECRET_FOUND].join("\n")]);
  // A word inside a longer word is another word.
  await kit.say("/scan bluefernish weather");
  assert.deepEqual(said(kit), ["🛡 Clean. None of your guard words, and nothing that looks like a password, key or token."]);
  await kit.say("/scan");
  assert.deepEqual(said(kit), ["🛡 Give me the text to check: <code>/scan your text</code>"]);
});

test("the Guard stops a note, a link and a post before anything is kept", async () => {
  const web = fakeWeb();
  const kit = makeChat({ web });
  await kit.say("/guard add bluefern");
  kit.fresh();

  const blockedByWord = [STOPPED, wordsFound(1)].join("\n");
  const blockedBySecret = [STOPPED, SECRET_FOUND].join("\n");
  await kit.say("/note the bluefern build is late");
  await kit.say("/log bluefern torque failed");
  await kit.say("/save https://example.com/bluefern/spec");
  await kit.say("/post Proud of the Bluefern team");
  await kit.say(`/note token ${FAKE_KEY}`);
  await kit.say(`/post my key is ${FAKE_KEY}`);
  did(kit, Array(6).fill("sendMessage"), [
    blockedByWord,
    blockedByWord,
    blockedByWord,
    blockedByWord,
    blockedBySecret,
    blockedBySecret,
  ]);
  assert.deepEqual(web.calls.page, [], "a stopped link is not even looked up");

  await kit.say("/notes");
  await kit.say("/links");
  await kit.say("/posts");
  await kit.say("/export");
  assert.deepEqual(said(kit), [
    "No notes yet. Write one with <code>/note your text</code>.",
    "No links yet. Save one with <code>/save https://example.com</code>.",
    "No approved posts yet. Draft one with <code>/post your text</code>.",
    "The desk is empty, so there is nothing to export yet.",
  ]);
  // No button was offered for the stopped posts, so there is nothing to approve either.
  await kit.tap("pst:1:y", 101);
  assert.deepEqual(said(kit), [STALE]);
});

test("a page title with a guard word is dropped, the link is kept", async () => {
  const web = fakeWeb({ raw: { "https://example.com/p": { text: "<title>Bluefern launch plan</title>" } } });
  const kit = makeChat({ web });
  await kit.say("/guard add bluefern");
  kit.fresh();
  await kit.say("/save https://example.com/p");
  assert.deepEqual(said(kit), ["🔗 Saved as link 1. /links shows them.\nhttps://example.com/p"]);
});

test("what was kept before a word went on the list is hidden from then on", async () => {
  const web = fakeWeb({ raw: { "https://example.com/q": { text: "<title>Quartzite notes</title>" } } });
  const kit = makeChat({ web });
  await kit.say("/note the quartzite sample arrived");
  await kit.say("/note buy coffee");
  await kit.say("/save https://example.com/q");
  await kit.say("/post Quartzite is done");
  await kit.tap("pst:1:y", 104);
  await kit.say("/guard add quartzite");
  kit.fresh();

  await kit.say("/notes");
  await kit.say("/links");
  await kit.say("/posts");
  assert.deepEqual(said(kit), [
    ["📝 <b>Notes</b> (the last 2)", `📝 <code>${NOW}</code> ${HIDDEN}`, `📝 <code>${NOW}</code> buy coffee`].join("\n"),
    ["🔗 <b>Links</b> (the last 1)", `🔗 ${HIDDEN}`].join("\n"),
    ["✍️ <b>Approved posts</b> (the last 1)", `<b>#1</b> <code>${NOW}</code> ${HIDDEN}`].join("\n"),
  ]);

  await kit.say("/export");
  const file = await exported(kit);
  assert.ok(!file.text.toLowerCase().includes("quartzite"), file.text);
  assert.equal(file.text.split("hidden by the Guard").length - 1, 3, file.text);
  assert.ok(file.text.includes("buy coffee"), file.text);
});

// ------------------------------------------------------------------ /brief
test("/brief lists the last pushes to the owner's public repositories", async () => {
  const web = fakeWeb({
    raw: {
      [GITHUB]: json([
        {
          name: "glow",
          html_url: "https://github.com/juw12/glow",
          description: "Apps <and> bots",
          pushed_at: "2026-11-11T19:00:00Z",
          private: false,
        },
        { name: "plain", html_url: "https://github.com/juw12/plain", description: null, pushed_at: "2026-11-11T01:15:00Z" },
        { name: "locked", html_url: "https://github.com/juw12/locked", description: "", pushed_at: "2026-11-10T00:00:00Z", private: true },
        { name: "side", html_url: "https://github.com/juw12/side", description: "the bluefern rig", pushed_at: "2026-11-09T00:00:00Z" },
        null,
      ]),
    },
  });
  const kit = makeChat({ web });
  await kit.say("/guard add bluefern");
  kit.fresh();

  await kit.say("/brief");
  did(kit, ["sendMessage"], [
    [
      "🗞 <b>Last pushes on GitHub</b> · juw12",
      '• <a href="https://github.com/juw12/glow">glow</a> · <code>2026-11-12 02:00</code>',
      "   Apps &lt;and&gt; bots",
      '• <a href="https://github.com/juw12/plain">plain</a> · <code>2026-11-11 08:15</code>',
    ].join("\n"),
  ]);
  assert.deepEqual(web.calls.page, [{ url: GITHUB, headers: { Accept: "application/vnd.github+json" } }]);
  assert.deepEqual(kit.errors, []);
});

test("/brief says so when GitHub refuses, answers nonsense or has nothing to list", async () => {
  const refused = makeChat({ web: fakeWeb({ raw: { [GITHUB]: { ok: false, status: 403, text: "rate limit" } } }) });
  await refused.say("/brief");
  assert.deepEqual(said(refused), [
    "GitHub did not answer (HTTP 403). Without a login it only answers a few times an hour, so try again later.",
  ]);

  const down = makeChat({ web: fakeWeb({ raw: { [GITHUB]: new Error("timed out") } }) });
  await down.say("/brief");
  assert.deepEqual(said(down), [
    "GitHub did not answer (HTTP 0). Without a login it only answers a few times an hour, so try again later.",
  ]);

  const nonsense = makeChat({ web: fakeWeb({ raw: { [GITHUB]: { ok: true, status: 200, text: "<html>busy</html>" } } }) });
  await nonsense.say("/brief");
  assert.deepEqual(said(nonsense), [
    "GitHub did not answer (HTTP 200). Without a login it only answers a few times an hour, so try again later.",
  ]);

  const empty = makeChat({ web: fakeWeb({ raw: { [GITHUB]: json([{ name: "locked", private: true }]) } }) });
  await empty.say("/brief");
  assert.deepEqual(said(empty), ["GitHub shows no public repository of juw12 that I may list."]);
  assert.deepEqual([refused, down, nonsense, empty].flatMap((kit) => kit.errors), []);
});

// ------------------------------------------------------------------ /export
test("/export sends the whole desk as one Markdown file", async () => {
  const web = fakeWeb({ raw: { "https://example.com/a": { text: "<title>Example Page</title>" } } });
  const kit = makeChat({ web });
  await kit.say("/export");
  assert.deepEqual(said(kit), ["The desk is empty, so there is nothing to export yet."]);

  await kit.say("/note buy coffee");
  await kit.say("/log torque test passed");
  await kit.say("/save https://example.com/a");
  await kit.say("/post Shipped today");
  await kit.tap("pst:1:y", 105);
  kit.fresh();

  await kit.say("/export");
  const file = await exported(kit);
  assert.equal(file.chat, "5001");
  assert.equal(file.name, "glow-desk.md");
  assert.equal(file.caption, "Your desk: notes, links and approved posts.");
  assert.deepEqual(file.text.trimEnd().split("\n"), [
    "# Glow desk",
    "",
    `Exported ${NOW}`,
    "",
    "## Notes (2)",
    "",
    `- ${NOW} buy coffee`,
    `- ${NOW} [log] torque test passed`,
    "",
    "## Links (1)",
    "",
    `- ${NOW} Example Page: https://example.com/a`,
    "",
    "## Posts (1)",
    "",
    `### ${NOW}`,
    "",
    "Shipped today",
  ]);
  assert.deepEqual(kit.errors, []);
});

test("/export says so when Telegram does not take the file", async () => {
  const kit = makeChat();
  await kit.say("/note buy coffee");
  kit.fresh();
  kit.telegram.refuse("sendDocument", { ok: false, status: 400, description: "Bad Request: file must be non-empty" });
  await kit.say("/export");
  did(kit, ["sendDocument", "sendMessage"], ["I could not send the file. Try again in a moment."]);
});

// ------------------------------------------------------------------ whose desk it is
const DESK_COMMANDS = [
  "/note hello",
  "/log hello",
  "/notes",
  "/save https://example.com/a",
  "/links",
  "/post hello",
  "/posts",
  "/scan hello",
  "/guard",
  "/guard add kite",
  "/brief",
  "/export",
];

test("the desk is the owner's: anybody else is told so, and nothing is kept or looked up", async () => {
  const web = fakeWeb();
  const kit = makeChat({ web });
  for (const command of DESK_COMMANDS) {
    await kit.say(command, AS_FRIEND);
    did(kit, ["sendMessage"], [OWNER_ONLY]);
  }
  assert.deepEqual(web.calls.page, []);
  assert.deepEqual([...kit.storage.map.keys()].filter((key) => key.startsWith("desk:")), []);
});

test("in a group the desk stays shut: silent unless named, and then it points to the private chat", async () => {
  const web = fakeWeb();
  const kit = makeChat({ web, chat: GROUP_CHAT });
  for (const command of DESK_COMMANDS) {
    await kit.say(command);
    await kit.say(command, AS_FRIEND);
  }
  did(kit, []);

  let asked = DESK_COMMANDS.length * 2;
  for (const command of DESK_COMMANDS) {
    const [name, ...rest] = command.split(" ");
    const named = [`${name}@glow_test_bot`, ...rest].join(" ");
    await kit.say(named);
    asked += 1;
    did(kit, [`sendMessage re ${asked}`], [DESK_PRIVATE]);
    await kit.say(named, AS_FRIEND);
    asked += 1;
    did(kit, [`sendMessage re ${asked}`], [OWNER_ONLY]);
  }
  assert.deepEqual(web.calls.page, []);
  assert.deepEqual([...kit.storage.map.keys()].filter((key) => key.startsWith("desk:")), []);
});

// ------------------------------------------------------------------ /help
test("/help tells everybody about /calc and only the owner, in private, about the desk", async () => {
  const mine = makeChat();
  await mine.say("/help");
  const [ownerHelp] = said(mine);
  assert.ok(ownerHelp.includes("/calc"), ownerHelp);
  assert.ok(ownerHelp.includes("<b>Your desk</b> (only in our private chat)"), ownerHelp);
  for (const name of ["note", "notes", "save", "links", "post", "posts", "scan", "guard", "brief", "export"]) {
    assert.ok(ownerHelp.includes(`/${name} `), name);
  }

  const theirs = makeChat();
  await theirs.say("/help", AS_FRIEND);
  const [memberHelp] = said(theirs);
  assert.ok(memberHelp.includes("/calc"), memberHelp);
  assert.ok(!memberHelp.includes("Your desk"), memberHelp);
  assert.ok(!memberHelp.includes("/guard"), memberHelp);
});
