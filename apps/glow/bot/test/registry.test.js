// Checks for src/registry.js: taking the token, the claim link, and who gets through the gate.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWED_UPDATES,
  REGISTRY_NAME,
  RegistryLogic,
  TOKEN_SHAPE,
  WEBHOOK_PATH,
  handleRegistry,
  registryClient,
  whoAndWhere,
} from "../src/registry.js";
import { COMMANDS } from "../src/strings.js";
import { API_BASE } from "../src/telegram.js";
import { sha256Hex } from "../src/util.js";
import { FakeNamespace, FakeStorage, fakeFetch, makeClock, reply } from "./fakes.js";

// Made-up tokens. They are longer than a real one on purpose, so nothing mistakes them for a secret.
const TOKEN = "123456789:AAExampleTokenThatIsNotRealAtAll_0123456";
const OTHER_TOKEN = "987654321:BBExampleTokenThatIsNotRealAtAll_6543210";
const ORIGIN = "https://glow-bot.test";
const PAGES = "https://glow.test/projects/glow";
const OWNER = { id: 111, first_name: "Juwen", language_code: "en" };
const GUEST = { id: 222, first_name: "Guest" };
const OWNER_CHAT = { id: 111, type: "private" };
const GUEST_CHAT = { id: 222, type: "private" };
const GROUP = { id: -5001, type: "supergroup", title: "Makers" };
const FIRST_CODE = "1".repeat(32);
const SECOND_CODE = "2".repeat(32);

function pretendTelegram(token, botId, answers = {}) {
  return [
    `${API_BASE}/bot${token}/`,
    (url) => {
      const method = url.split("/").pop();
      if (answers[method]) return answers[method]();
      if (method === "getMe") {
        return reply({ ok: true, result: { id: botId, is_bot: true, first_name: "GlowBot", username: "glow_test_bot" } });
      }
      return reply({ ok: true, result: true });
    },
  ];
}

function setUp(options = {}) {
  const now = makeClock();
  const storage = options.storage || new FakeStorage();
  const send = fakeFetch([
    pretendTelegram(TOKEN, 9001, options.telegram),
    pretendTelegram(OTHER_TOKEN, 9002),
    [`${PAGES}/bot/logo.jpg`, () => (options.logo ? options.logo() : reply(new Uint8Array([255, 216, 255, 224])))],
  ]);
  let codes = 0;
  const logic = new RegistryLogic({
    storage,
    fetch: send,
    now,
    pages: PAGES,
    randomHex: (bytes) => String((codes += 1)).repeat(bytes * 2),
  });
  const methods = () => send.calls.map((call) => call.url.split("/").pop());
  return { logic, storage, send, now, methods };
}

let updateNumber = 1000;

function message(chat, from, text, extra = {}) {
  updateNumber += 1;
  return { update_id: updateNumber, message: { message_id: updateNumber, chat, from, text, ...extra } };
}

function memberChange(chat, from, status) {
  updateNumber += 1;
  return {
    update_id: updateNumber,
    my_chat_member: { chat, from, old_chat_member: { status: "left" }, new_chat_member: { status } },
  };
}

function tap(chat, from, data) {
  updateNumber += 1;
  return { update_id: updateNumber, callback_query: { id: "tap" + updateNumber, from, data, message: { message_id: 5, chat } } };
}

async function ready(options) {
  const world = setUp(options);
  const result = await world.logic.setup({ token: TOKEN, origin: ORIGIN });
  assert.equal(result.ok, true);
  const secret = await sha256Hex("glow-bot-webhook:" + TOKEN);
  const gate = (update) => world.logic.gate({ secret, update });
  return { ...world, secret, gate, result };
}

async function claimed(options) {
  const world = await ready(options);
  const answer = await world.gate(message(OWNER_CHAT, OWNER, "/start " + FIRST_CODE));
  assert.equal(answer.access.claimed, true);
  return world;
}

test("the token shape accepts what BotFather hands out and nothing else", () => {
  assert.ok(TOKEN_SHAPE.test(TOKEN));
  assert.ok(TOKEN_SHAPE.test("7123456789:AAH-abc_DEF0123456789abcdefghijklmn"));
  for (const wrong of ["", "hello", "123456789", "123456789:", "123456789:short", "abc:" + "A".repeat(35), TOKEN + " x", "bot" + TOKEN]) {
    assert.equal(TOKEN_SHAPE.test(wrong), false, wrong);
  }
});

test("whoAndWhere finds the chat and the person in each kind of update", () => {
  assert.deepEqual(whoAndWhere(message(GROUP, GUEST, "hi")).chat, GROUP);
  assert.equal(whoAndWhere(message(GROUP, GUEST, "hi")).kind, "message");
  const tapped = whoAndWhere(tap(GROUP, OWNER, "run:1"));
  assert.deepEqual([tapped.kind, tapped.chat, tapped.from, tapped.message], ["callback", GROUP, OWNER, null]);
  const moved = whoAndWhere(memberChange(GROUP, OWNER, "member"));
  assert.deepEqual([moved.kind, moved.chat, moved.from], ["member", GROUP, OWNER]);
  assert.deepEqual(whoAndWhere({ update_id: 1, poll: {} }), { kind: "other", chat: null, from: null, message: null });
  assert.equal(whoAndWhere({ update_id: 2, callback_query: { id: "x", from: OWNER } }).chat, null);
  assert.equal(whoAndWhere(null).kind, "other");
});

test("setup refuses a token of the wrong shape and never calls Telegram", async () => {
  const { logic, send, storage } = setUp();
  assert.deepEqual(await logic.setup({ token: "not a token", origin: ORIGIN }), { ok: false, error: "token-format" });
  assert.deepEqual(await logic.setup({}), { ok: false, error: "token-format" });
  assert.deepEqual(await logic.setup(), { ok: false, error: "token-format" });
  assert.deepEqual(await logic.setup({ token: TOKEN, origin: "http://plain.test" }), { ok: false, error: "origin" });
  assert.deepEqual(await logic.setup({ token: TOKEN, origin: "https://glow-bot.test/extra" }), { ok: false, error: "origin" });
  assert.equal(send.calls.length, 0);
  assert.equal(storage.map.size, 0);
});

test("setup refuses a token Telegram does not know, and saves nothing", async () => {
  const { logic, storage, methods } = setUp({
    telegram: { getMe: () => reply({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 }) },
  });
  assert.deepEqual(await logic.setup({ token: TOKEN, origin: ORIGIN }), { ok: false, error: "token-rejected", detail: "Unauthorized" });
  assert.deepEqual(methods(), ["getMe"]);
  assert.equal(storage.map.size, 0);
  assert.equal((await logic.status()).configured, false);
});

test("setup saves nothing when Telegram refuses the webhook", async () => {
  const { logic, storage, methods } = setUp({
    telegram: {
      setWebhook: () => reply({ ok: false, error_code: 400, description: `Bad Request: bad webhook for bot${TOKEN}` }, { status: 400 }),
    },
  });
  const result = await logic.setup({ token: TOKEN, origin: ORIGIN });
  assert.deepEqual(result, { ok: false, error: "webhook-failed", detail: "Bad Request: bad webhook for bot<token>" });
  assert.deepEqual(methods(), ["getMe", "setWebhook"]);
  assert.equal(storage.map.size, 0);
  assert.deepEqual(await logic.gate({ secret: "anything", update: message(OWNER_CHAT, OWNER, "hi") }), { ok: false, reason: "not-configured" });
});

test("setup points Telegram at this Worker and hands back the claim link", async () => {
  const { logic, send, storage, now, methods } = setUp();
  const result = await logic.setup({ token: `  ${TOKEN}\n`, origin: ORIGIN + "/" });
  assert.deepEqual(result, {
    ok: true,
    bot: { username: "glow_test_bot", name: "GlowBot" },
    link: "https://t.me/glow_test_bot?start=" + FIRST_CODE,
    claimed: false,
    warnings: [],
  });

  const secret = await sha256Hex("glow-bot-webhook:" + TOKEN);
  const hook = send.calls.find((call) => call.url.endsWith("/setWebhook"));
  assert.deepEqual(JSON.parse(hook.body), {
    url: ORIGIN + WEBHOOK_PATH,
    secret_token: secret,
    allowed_updates: ALLOWED_UPDATES,
    drop_pending_updates: true,
  });
  assert.match(secret, /^[A-Za-z0-9_-]{1,256}$/);
  assert.deepEqual(ALLOWED_UPDATES, ["message", "callback_query", "my_chat_member"]);

  // One getMe, one setWebhook, three languages of menu and profile texts, the picture: 13 calls.
  const counts = {};
  for (const method of methods()) counts[method] = (counts[method] || 0) + 1;
  assert.deepEqual(counts, {
    getMe: 1,
    setWebhook: 1,
    setMyCommands: 3,
    setMyDescription: 3,
    setMyShortDescription: 3,
    "logo.jpg": 1,
    setMyProfilePhoto: 1,
  });
  assert.equal(send.calls.length, 13);

  const menus = send.calls.filter((call) => call.url.endsWith("/setMyCommands")).map((call) => JSON.parse(call.body));
  assert.deepEqual(menus.map((menu) => menu.language_code), [undefined, "id", "zh"]);
  for (const menu of menus) {
    assert.deepEqual(menu.commands.map((entry) => entry.command), COMMANDS);
    for (const entry of menu.commands) {
      assert.match(entry.command, /^[a-z0-9_]{1,32}$/);
      assert.ok(entry.description.length >= 1 && entry.description.length <= 256, entry.description);
    }
  }
  assert.notEqual(menus[0].commands[0].description, menus[1].commands[0].description);
  assert.notEqual(menus[0].commands[0].description, menus[2].commands[0].description);
  for (const call of send.calls.filter((entry) => entry.url.endsWith("/setMyDescription"))) {
    const text = JSON.parse(call.body).description;
    assert.ok(text.length > 0 && text.length <= 512, String(text.length));
  }
  for (const call of send.calls.filter((entry) => entry.url.endsWith("/setMyShortDescription"))) {
    const text = JSON.parse(call.body).short_description;
    assert.ok(text.length > 0 && text.length <= 120, String(text.length));
  }

  const photo = send.calls.find((call) => call.url.endsWith("/setMyProfilePhoto"));
  assert.ok(photo.body instanceof FormData);
  assert.equal(photo.body.get("photo"), JSON.stringify({ type: "static", photo: "attach://file" }));
  assert.equal(photo.body.get("file").size, 4);
  assert.equal(photo.body.get("file").type, "image/jpeg");

  assert.deepEqual(storage.map.get("registry"), {
    v: 1,
    token: TOKEN,
    bot: { id: 9001, username: "glow_test_bot", name: "GlowBot" },
    origin: ORIGIN,
    secret,
    ownerId: null,
    claimCode: FIRST_CODE,
    allowed: {},
    public: false,
    seen: [],
    configuredAt: now(),
  });
  assert.deepEqual(await logic.status(), {
    configured: true,
    bot: { username: "glow_test_bot", name: "GlowBot" },
    access: "private",
    claimed: false,
    chats: 0,
  });
});

test("a failure in the profile calls is a warning, not an error", async () => {
  const { logic } = setUp({
    telegram: { setMyDescription: () => reply({ ok: false, description: "Bad Request: too long" }, { status: 400 }) },
    logo: () => new Response("gone", { status: 404 }),
  });
  const result = await logic.setup({ token: TOKEN, origin: ORIGIN });
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, [
    "description: Bad Request: too long",
    "description (id): Bad Request: too long",
    "description (zh): Bad Request: too long",
    "photo: HTTP 404",
  ]);
  assert.equal((await logic.status()).configured, true);
});

test("a picture Telegram refuses, or a network error on the way, is only a warning", async () => {
  const refused = setUp({
    telegram: { setMyProfilePhoto: () => reply({ ok: false, description: "Bad Request: PHOTO_INVALID" }, { status: 400 }) },
  });
  assert.deepEqual((await refused.logic.setup({ token: TOKEN, origin: ORIGIN })).warnings, ["photo: Bad Request: PHOTO_INVALID"]);
  const broken = setUp({
    logo: () => {
      throw new Error("connection lost");
    },
  });
  assert.deepEqual((await broken.logic.setup({ token: TOKEN, origin: ORIGIN })).warnings, ["photo: connection lost"]);
});

test("nothing the Registry shows in public carries the token or the webhook secret", async () => {
  const { logic, result, secret } = await ready();
  const shown = JSON.stringify([result, await logic.status(), await logic.setPublic(true), await logic.forget(1)]);
  assert.ok(!shown.includes(TOKEN));
  assert.ok(!shown.includes(TOKEN.split(":")[1]));
  assert.ok(!shown.includes(secret));
});

test("the gate turns away every update until the bot is set up, and any update with the wrong secret", async () => {
  const fresh = setUp();
  assert.deepEqual(await fresh.logic.gate({ secret: "", update: message(OWNER_CHAT, OWNER, "hi") }), { ok: false, reason: "not-configured" });
  assert.deepEqual(await fresh.logic.gate(), { ok: false, reason: "not-configured" });

  const { logic, secret, storage } = await ready();
  const before = structuredClone(storage.map.get("registry"));
  for (const wrong of ["", "nope", secret + "0", secret.slice(1), undefined]) {
    assert.deepEqual(await logic.gate({ secret: wrong, update: message(OWNER_CHAT, OWNER, "/start " + FIRST_CODE) }), {
      ok: false,
      reason: "bad-secret",
    });
  }
  assert.deepEqual(storage.map.get("registry"), before);
});

test("the gate answers with what the chat needs, and ignores updates that belong to no chat", async () => {
  const { gate } = await ready();
  const answer = await gate(message(GUEST_CHAT, GUEST, "hello"));
  assert.deepEqual(answer, {
    ok: true,
    duplicate: false,
    chatId: 222,
    config: { token: TOKEN, botUsername: "glow_test_bot", botId: 9001, origin: ORIGIN, public: false },
    access: { role: "stranger", allowed: false, claimed: false, ownerKnown: false, gone: false },
  });
  assert.deepEqual(await gate({ update_id: 77, poll: { id: "1" } }), { ok: true, ignore: true });
  assert.deepEqual(await gate({ update_id: 78, callback_query: { id: "x", from: GUEST, data: "run:1" } }), { ok: true, ignore: true });
});

test("the gate lets a repeated update through only once, and remembers the last 200", async () => {
  const { gate, storage } = await ready();
  const first = message(GUEST_CHAT, GUEST, "hello");
  assert.equal((await gate(first)).duplicate, false);
  assert.deepEqual(await gate(first), { ok: true, duplicate: true });
  assert.deepEqual(await gate(structuredClone(first)), { ok: true, duplicate: true });

  for (let count = 0; count < 205; count++) await gate(message(GUEST_CHAT, GUEST, "again"));
  const seen = storage.map.get("registry").seen;
  assert.equal(seen.length, 200);
  assert.equal(seen[seen.length - 1], updateNumber);
  assert.ok(!seen.includes(first.update_id));
  // An update with no id at all (never sent by Telegram) is simply handled.
  assert.equal((await gate({ message: { message_id: 1, chat: GUEST_CHAT, from: GUEST, text: "x" } })).duplicate, false);
});

test("the claim link makes the first person to open it the owner, once", async () => {
  const { gate, logic, storage } = await ready();
  for (const text of ["/start", "/start wrong", "/start " + SECOND_CODE, "/start " + FIRST_CODE.slice(1), "start " + FIRST_CODE]) {
    const answer = await gate(message(GUEST_CHAT, GUEST, text));
    assert.deepEqual([answer.access.role, answer.access.claimed, answer.access.ownerKnown], ["stranger", false, false], text);
  }
  // The code does nothing in a group, even when it is right.
  assert.equal((await gate(message(GROUP, GUEST, "/start " + FIRST_CODE))).access.claimed, false);

  const claim = await gate(message(OWNER_CHAT, OWNER, "/start@glow_test_bot " + FIRST_CODE));
  assert.deepEqual(claim.access, { role: "owner", allowed: true, claimed: true, ownerKnown: true, gone: false });
  assert.equal(storage.map.get("registry").ownerId, 111);
  assert.equal(storage.map.get("registry").claimCode, "");
  assert.equal((await logic.status()).claimed, true);

  const late = await gate(message(GUEST_CHAT, GUEST, "/start " + FIRST_CODE));
  assert.deepEqual(late.access, { role: "stranger", allowed: false, claimed: false, ownerKnown: true, gone: false });
  const empty = await gate(message(GUEST_CHAT, GUEST, "/start "));
  assert.equal(empty.access.role, "stranger");
  const again = await gate(message(OWNER_CHAT, OWNER, "/start " + FIRST_CODE));
  assert.deepEqual([again.access.role, again.access.claimed], ["owner", false]);
});

test("strangers stay strangers until the owner makes access public", async () => {
  const { gate, logic } = await claimed();
  assert.equal((await gate(message(GUEST_CHAT, GUEST, "/lead plan a trip"))).access.role, "stranger");
  assert.equal((await gate(tap(GUEST_CHAT, GUEST, "run:1"))).access.role, "stranger");
  assert.equal((await gate(message(GROUP, GUEST, "/lead plan a trip"))).access.role, "stranger");

  assert.deepEqual(await logic.setPublic(true), { ok: true, access: "public" });
  const open = await gate(message(GUEST_CHAT, GUEST, "/lead plan a trip"));
  assert.deepEqual([open.access.role, open.access.allowed, open.config.public], ["member", true, true]);
  assert.equal((await gate(message(GROUP, GUEST, "/lead plan a trip"))).access.role, "member");
  assert.equal((await logic.status()).access, "public");

  assert.deepEqual(await logic.setPublic(false), { ok: true, access: "private" });
  assert.equal((await gate(message(GUEST_CHAT, GUEST, "hi"))).access.role, "stranger");
});

test("the owner lets a group in by sending a command there", async () => {
  const { gate, logic, storage, now } = await claimed();
  // A reply or a button tap from the owner works for the owner, but does not open the group.
  assert.equal((await gate(message(GROUP, OWNER, "just talking"))).access.role, "owner");
  assert.equal((await gate(tap(GROUP, OWNER, "run:1"))).access.role, "owner");
  assert.equal((await gate(message(GROUP, GUEST, "/help"))).access.role, "stranger");
  assert.equal((await logic.status()).chats, 0);

  assert.equal((await gate(message(GROUP, OWNER, "/help"))).access.role, "owner");
  assert.deepEqual(storage.map.get("registry").allowed, { "-5001": { title: "Makers", addedAt: now() } });
  const guest = await gate(message(GROUP, GUEST, "/help"));
  assert.deepEqual([guest.access.role, guest.access.allowed], ["member", true]);
  assert.equal((await gate(tap(GROUP, GUEST, "lang:id"))).access.role, "member");
  assert.equal((await logic.status()).chats, 1);
  // The guest's own private chat is still closed.
  assert.equal((await gate(message(GUEST_CHAT, GUEST, "/help"))).access.role, "stranger");
});

test("the owner lets a group in by adding the bot; a stranger adding it does not", async () => {
  const { gate, logic } = await claimed();
  const byGuest = await gate(memberChange(GROUP, GUEST, "member"));
  assert.deepEqual([byGuest.access.role, byGuest.access.allowed, byGuest.access.gone], ["stranger", false, false]);
  assert.equal((await logic.status()).chats, 0);

  const byOwner = await gate(memberChange(GROUP, OWNER, "administrator"));
  assert.deepEqual([byOwner.access.role, byOwner.access.allowed, byOwner.chatId], ["owner", true, -5001]);
  assert.equal((await logic.status()).chats, 1);
  assert.equal((await gate(message(GROUP, GUEST, "/help"))).access.role, "member");
  // The owner's private chat never goes on the list: the owner is always let in.
  await gate(message(OWNER_CHAT, OWNER, "/help"));
  assert.equal((await logic.status()).chats, 1);
});

test("a group the bot leaves, or is thrown out of, comes off the list", async () => {
  for (const status of ["left", "kicked"]) {
    const { gate, logic } = await claimed();
    await gate(message(GROUP, OWNER, "/help"));
    assert.equal((await logic.status()).chats, 1);
    const answer = await gate(memberChange(GROUP, GUEST, status));
    assert.deepEqual(answer.access, { role: "stranger", allowed: false, claimed: false, ownerKnown: true, gone: true });
    assert.equal((await logic.status()).chats, 0);
    assert.equal((await gate(message(GROUP, GUEST, "/help"))).access.role, "stranger");
  }
  const { gate, logic } = await claimed();
  await gate(message(GROUP, OWNER, "/help"));
  assert.deepEqual(await logic.forget(-5001), { ok: true });
  assert.equal((await logic.status()).chats, 0);
  assert.deepEqual(await logic.forget(12345), { ok: true });
});

test("a group that becomes a supergroup keeps its place on the list", async () => {
  const { gate, storage } = await claimed();
  const small = { id: -42, type: "group", title: "Small" };
  await gate(message(small, OWNER, "/help"));
  const moved = await gate(message(small, GUEST, undefined, { migrate_to_chat_id: -100777 }));
  assert.deepEqual(moved, { ok: true, ignore: true });
  assert.deepEqual(Object.keys(storage.map.get("registry").allowed), ["-100777"]);
  const big = { id: -100777, type: "supergroup", title: "Small" };
  assert.equal((await gate(message(big, GUEST, "/help"))).access.role, "member");
  // A group that was never let in gains nothing by moving.
  const other = { id: -43, type: "group", title: "Other" };
  await gate(message(other, GUEST, undefined, { migrate_to_chat_id: -100888 }));
  assert.deepEqual(Object.keys(storage.map.get("registry").allowed), ["-100777"]);
});

test("setting up the same bot again keeps its owner and chats; another bot starts clean", async () => {
  const { gate, logic, storage } = await claimed();
  await gate(message(GROUP, OWNER, "/help"));
  await logic.setPublic(true);

  const again = await logic.setup({ token: TOKEN, origin: ORIGIN });
  assert.deepEqual(again, {
    ok: true,
    bot: { username: "glow_test_bot", name: "GlowBot" },
    link: "https://t.me/glow_test_bot",
    claimed: true,
    warnings: [],
  });
  const kept = storage.map.get("registry");
  assert.deepEqual([kept.ownerId, Object.keys(kept.allowed), kept.public, kept.claimCode, kept.seen], [111, ["-5001"], true, "", []]);

  const other = await logic.setup({ token: OTHER_TOKEN, origin: ORIGIN });
  assert.deepEqual([other.ok, other.claimed, other.link], [true, false, "https://t.me/glow_test_bot?start=" + SECOND_CODE]);
  const clean = storage.map.get("registry");
  assert.deepEqual([clean.token, clean.bot.id, clean.ownerId, clean.allowed, clean.public, clean.claimCode], [
    OTHER_TOKEN,
    9002,
    null,
    {},
    false,
    SECOND_CODE,
  ]);
  // The first bot's webhook secret no longer opens the gate.
  assert.deepEqual(await gate(message(OWNER_CHAT, OWNER, "/help")), { ok: false, reason: "bad-secret" });
});

test("an unclaimed bot that is set up again keeps the same claim link", async () => {
  const { logic, result } = await ready();
  const again = await logic.setup({ token: TOKEN, origin: ORIGIN });
  assert.equal(again.link, result.link);
  assert.equal(again.link, "https://t.me/glow_test_bot?start=" + FIRST_CODE);
});

test("reset tells Telegram to stop calling and forgets everything", async () => {
  const { gate, logic, storage, send, methods } = await claimed();
  await gate(message(GROUP, OWNER, "/help"));
  send.calls.length = 0;
  assert.deepEqual(await logic.reset(), { ok: true, webhook: "deleted" });
  assert.deepEqual(methods(), ["deleteWebhook"]);
  assert.deepEqual(JSON.parse(send.calls[0].body), { drop_pending_updates: true });
  assert.equal(storage.map.size, 0);
  assert.deepEqual(await logic.status(), { configured: false, bot: null, access: "private", claimed: false, chats: 0 });
  assert.deepEqual(await gate(message(OWNER_CHAT, OWNER, "/help")), { ok: false, reason: "not-configured" });
  // Resetting a bot that was never set up is harmless.
  assert.deepEqual(await logic.reset(), { ok: true, webhook: "none" });
  assert.deepEqual(await setUp().logic.reset(), { ok: true, webhook: "none" });
});

test("reset still forgets the token when Telegram cannot be reached", async () => {
  const { logic, storage } = await ready({
    telegram: { deleteWebhook: () => new Response("bad gateway", { status: 502 }) },
  });
  assert.deepEqual(await logic.reset(), { ok: true, webhook: "failed" });
  assert.equal(storage.map.size, 0);
});

test("what the Registry knows survives a restart of the object", async () => {
  const { gate, logic, storage, secret } = await claimed();
  await gate(message(GROUP, OWNER, "/help"));
  const restarted = setUp({ storage });
  assert.deepEqual(await restarted.logic.status(), await logic.status());
  const answer = await restarted.logic.gate({ secret, update: message(GROUP, GUEST, "/help") });
  assert.deepEqual([answer.access.role, answer.config.token], ["member", TOKEN]);
  assert.equal(restarted.send.calls.length, 0);
});

test("two calls arriving together share one state", async () => {
  const { logic, secret } = await ready();
  const restarted = new RegistryLogic({ storage: logic.storage, fetch: logic.fetch, pages: PAGES });
  const [first, second] = await Promise.all([
    restarted.gate({ secret, update: message(OWNER_CHAT, OWNER, "/start " + FIRST_CODE) }),
    restarted.gate({ secret, update: message(OWNER_CHAT, OWNER, "/help") }),
  ]);
  assert.deepEqual([first.access.claimed, second.access.role], [true, "owner"]);
  assert.equal(logic.storage.map.get("registry").seen.length, 2);
});

test("the Durable Object routes and the client fit together", async () => {
  const world = setUp();
  class Registry {
    constructor(state) {
      this.logic = new RegistryLogic({ storage: state.storage, fetch: world.send, now: world.now, pages: PAGES, randomHex: () => FIRST_CODE });
    }

    fetch(request) {
      return handleRegistry(this.logic, request);
    }
  }
  const namespace = new FakeNamespace(Registry, {}, world.now);
  const registry = registryClient(namespace);

  assert.equal((await registry.status()).configured, false);
  assert.deepEqual(await registry.setup("nope", ORIGIN), { ok: false, error: "token-format" });
  const done = await registry.setup(TOKEN, ORIGIN);
  assert.deepEqual([done.ok, done.link], [true, "https://t.me/glow_test_bot?start=" + FIRST_CODE]);
  const secret = await sha256Hex("glow-bot-webhook:" + TOKEN);
  assert.deepEqual(await registry.gate("wrong", message(OWNER_CHAT, OWNER, "hi")), { ok: false, reason: "bad-secret" });
  const claim = await registry.gate(secret, message(OWNER_CHAT, OWNER, "/start " + FIRST_CODE));
  assert.deepEqual([claim.chatId, claim.access.role, claim.access.claimed], [111, "owner", true]);
  await registry.gate(secret, message(GROUP, OWNER, "/help"));
  assert.deepEqual(await registry.setPublic(true), { ok: true, access: "public" });
  assert.deepEqual(await registry.status(), {
    configured: true,
    bot: { username: "glow_test_bot", name: "GlowBot" },
    access: "public",
    claimed: true,
    chats: 1,
  });
  assert.deepEqual(await registry.forget(-5001), { ok: true });
  assert.equal((await registry.status()).chats, 0);
  assert.deepEqual(await registry.reset(), { ok: true, webhook: "deleted" });
  assert.equal((await registry.status()).configured, false);
  assert.deepEqual([...namespace.objects.keys()], [REGISTRY_NAME]);

  const stub = namespace.get(namespace.idFromName(REGISTRY_NAME));
  const missing = await stub.fetch("https://glow-bot.internal/nothing-here", { method: "POST", body: "{}" });
  assert.equal(missing.status, 404);
  const garbled = await stub.fetch("https://glow-bot.internal/gate", { method: "POST", body: "not json" });
  assert.deepEqual(await garbled.json(), { ok: false, reason: "not-configured" });
});
