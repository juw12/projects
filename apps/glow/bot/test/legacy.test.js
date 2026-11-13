// A bot connected under GlowBot 0.2.0 carries on under today's Worker: its token, its owner and
// the people it let in are taken over, and its webhook is moved without anyone pasting the token
// again. Also the access list the owner keeps by hand: allow, users, forget.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWED_UPDATES,
  LEGACY_WEBHOOK_PATH,
  REGISTRY_NAME,
  RegistryLogic,
  WEBHOOK_PATH,
  adoptLegacy,
  handleRegistry,
  registryClient,
} from "../src/registry.js";
import { API_BASE } from "../src/telegram.js";
import { sha256Hex } from "../src/util.js";
import { FakeNamespace, FakeStorage, fakeFetch, makeClock, reply } from "./fakes.js";

// A made-up token, longer than a real one on purpose, so nothing mistakes it for a secret.
const TOKEN = "123456789:AAExampleTokenThatIsNotRealAtAll_0123456";
const ORIGIN = "https://glow-bot.test";
const PAGES = "https://glow.test/projects/glow";
const OLD_SECRET = "old-secret-of-0.2.0-0123456789abcdef";
const PAIR_CODE = "c0ffee".repeat(4);
const NEW_CODE = "1".repeat(32);
const HOUR = 60 * 60 * 1000;
const START = 1750000000000; // where makeClock() starts
const CONNECTED = START - 5 * HOUR;
const OWNER = { id: 111, first_name: "Juwen", language_code: "en" };
const FRIEND = { id: 222, first_name: "Budi" };
const GUEST = { id: 333, first_name: "Guest" };
const OWNER_CHAT = { id: 111, type: "private" };
const FRIEND_CHAT = { id: 222, type: "private" };
const GUEST_CHAT = { id: 333, type: "private" };
const GROUP = { id: -5001, type: "supergroup", title: "Makers" };
const BOT = { id: 9001, username: "glow_test_bot", name: "GlowBot" };
const REFUSED = () => reply({ ok: false, error_code: 400, description: "Bad Request: bad webhook: try later" }, { status: 400 });

// What the 0.2.0 Worker kept under "config" once somebody had paired with the bot.
const pairedConfig = () => ({
  token: TOKEN,
  bot: { ...BOT },
  secret: OLD_SECRET,
  ownerId: OWNER.id,
  allowed: [OWNER.id, FRIEND.id, GROUP.id],
  pairCode: "",
  pairUntil: 0,
  connectedAt: CONNECTED,
});

// The same before anybody opened the pairing link: no owner, and a code good for `hoursLeft` more.
const unpairedConfig = (hoursLeft) => ({
  token: TOKEN,
  bot: { ...BOT },
  secret: OLD_SECRET,
  allowed: [],
  pairCode: PAIR_CODE,
  pairUntil: START + hoursLeft * HOUR,
  connectedAt: CONNECTED,
});

// A Registry whose storage holds what 0.2.0 left behind. `telegram` = { method: () => Response }.
function takenOver(config, telegram = {}) {
  const now = makeClock();
  const storage = new FakeStorage();
  if (config) storage.map.set("config", structuredClone(config));
  const send = fakeFetch([
    [
      `${API_BASE}/bot${TOKEN}/`,
      (url) => {
        const method = url.split("/").pop();
        if (telegram[method]) return telegram[method]();
        if (method === "getMe") {
          return reply({ ok: true, result: { id: BOT.id, is_bot: true, first_name: BOT.name, username: BOT.username } });
        }
        return reply({ ok: true, result: true });
      },
    ],
    [`${PAGES}/bot/logo.jpg`, () => reply(new Uint8Array([255, 216, 255, 224]))],
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
  const sentTo = (method) => send.calls.filter((call) => call.url.endsWith("/" + method)).map((call) => JSON.parse(call.body));
  return { logic, storage, send, now, methods, sentTo, telegram };
}

let updateNumber = 5000;

function message(chat, from, text) {
  updateNumber += 1;
  return { update_id: updateNumber, message: { message_id: updateNumber, chat, from, text } };
}

const newSecret = () => sha256Hex("glow-bot-webhook:" + TOKEN);
const roleOf = async (logic, secret, chat, from, text = "hi") => {
  const answer = await logic.gate({ secret, update: message(chat, from, text), origin: ORIGIN });
  return answer.ok ? answer.access.role : answer.reason;
};

// ------------------------------------------------------------------ adoptLegacy
test("adoptLegacy takes nothing over when 0.2.0 saved no bot", () => {
  const junk = [
    undefined,
    null,
    "config",
    42,
    [],
    {},
    { token: "" },
    { token: TOKEN },
    { token: TOKEN, bot: {} },
    { token: TOKEN, bot: { username: "glow_test_bot" } },
    { token: 123456789, bot: { ...BOT } },
    { bot: { ...BOT }, secret: OLD_SECRET, ownerId: OWNER.id },
  ];
  for (const old of junk) assert.equal(adoptLegacy(old, START), null, JSON.stringify(old));
});

test("adoptLegacy keeps the token, the owner and everyone let in, and marks the bot as still on the old webhook", () => {
  assert.deepEqual(adoptLegacy(pairedConfig(), START), {
    v: 1,
    token: TOKEN,
    bot: BOT,
    origin: "",
    secret: OLD_SECRET,
    ownerId: OWNER.id,
    claimCode: "",
    claimUntil: 0,
    allowed: {
      [FRIEND.id]: { title: "", addedAt: CONNECTED },
      [GROUP.id]: { title: "", addedAt: CONNECTED },
    },
    public: false,
    seen: [],
    configuredAt: CONNECTED,
    legacy: true,
    oldSecret: "",
    legacyTriedAt: 0,
  });
});

test("adoptLegacy keeps a pairing code only while nobody owns the bot, and survives missing fields", () => {
  const unpaired = adoptLegacy(unpairedConfig(19), START);
  assert.deepEqual(
    [unpaired.ownerId, unpaired.claimCode, unpaired.claimUntil, unpaired.allowed],
    [null, PAIR_CODE, START + 19 * HOUR, {}],
  );

  // A code left behind next to an owner is dead: it must not let a second person take the bot.
  const stale = adoptLegacy({ ...pairedConfig(), pairCode: PAIR_CODE, pairUntil: START + HOUR }, START);
  assert.deepEqual([stale.ownerId, stale.claimCode, stale.claimUntil], [OWNER.id, "", 0]);

  // Only the token and the bot's id are needed. A date that was never saved becomes "now".
  const bare = adoptLegacy({ token: TOKEN, bot: { id: BOT.id } }, START);
  assert.deepEqual(
    [bare.bot, bare.secret, bare.ownerId, bare.allowed, bare.claimCode, bare.configuredAt, bare.legacy],
    [{ id: BOT.id, username: "", name: "" }, "", null, {}, "", START, true],
  );
  assert.equal(adoptLegacy({ ...pairedConfig(), ownerId: "111" }, START).ownerId, null);
});

// ------------------------------------------------------------------ taking the bot over
test("a bot connected under 0.2.0 is taken over as it was: same owner, same people, the old copy untouched", async () => {
  const { logic, storage, send } = takenOver(pairedConfig());
  assert.deepEqual(await logic.status(), {
    configured: true,
    bot: { username: BOT.username, name: BOT.name },
    access: "private",
    claimed: true,
    chats: 2,
    legacy: true,
  });
  assert.deepEqual(storage.map.get("config"), pairedConfig());
  assert.deepEqual(storage.map.get("registry"), adoptLegacy(pairedConfig(), START));
  assert.equal(send.calls.length, 0);

  // Telegram still signs with the 0.2.0 secret. Today's secret is not accepted before the move.
  const answer = await logic.gate({ secret: OLD_SECRET, update: message(OWNER_CHAT, OWNER, "/help"), origin: ORIGIN });
  assert.deepEqual(answer, {
    ok: true,
    duplicate: false,
    chatId: OWNER.id,
    config: { token: TOKEN, botUsername: BOT.username, botId: BOT.id, origin: ORIGIN, public: false },
    access: { role: "owner", allowed: true, claimed: false, ownerKnown: true, gone: false },
    legacy: true,
  });
  assert.equal(await roleOf(logic, OLD_SECRET, FRIEND_CHAT, FRIEND), "member");
  assert.equal(await roleOf(logic, OLD_SECRET, GROUP, GUEST), "member");
  assert.equal(await roleOf(logic, OLD_SECRET, GUEST_CHAT, GUEST), "stranger");
  assert.equal(await roleOf(logic, await newSecret(), OWNER_CHAT, OWNER), "bad-secret");
  assert.equal(await roleOf(logic, "", OWNER_CHAT, OWNER), "bad-secret");
  assert.equal(storage.map.get("registry").origin, ORIGIN);
});

test("a Registry that already has a bot does not look at what 0.2.0 left behind", async () => {
  const world = takenOver(null);
  assert.equal((await world.logic.setup({ token: TOKEN, origin: ORIGIN })).ok, true);
  const saved = structuredClone(world.storage.map.get("registry"));
  world.storage.map.set("config", { ...pairedConfig(), secret: "somebody-else", ownerId: GUEST.id });

  const restarted = new RegistryLogic({ storage: world.storage, fetch: world.send, now: world.now, pages: PAGES });
  assert.deepEqual(await restarted.status(), {
    configured: true,
    bot: { username: BOT.username, name: BOT.name },
    access: "private",
    claimed: false,
    chats: 0,
  });
  assert.equal(await roleOf(restarted, "somebody-else", GUEST_CHAT, GUEST), "bad-secret");
  assert.deepEqual({ ...world.storage.map.get("registry"), seen: [] }, { ...saved, seen: [] });
});

test("an empty or broken 0.2.0 copy leaves the bot unconfigured and writes nothing", async () => {
  for (const config of [null, {}, { token: TOKEN }, { bot: { ...BOT } }]) {
    const { logic, storage } = takenOver(config);
    assert.equal((await logic.status()).configured, false);
    assert.deepEqual(await logic.gate({ secret: OLD_SECRET, update: message(OWNER_CHAT, OWNER, "hi") }), {
      ok: false,
      reason: "not-configured",
    });
    assert.deepEqual(await logic.refreshWebhook({ origin: ORIGIN }), { ok: true, refreshed: false });
    assert.equal(storage.map.has("registry"), false);
  }
});

// ------------------------------------------------------------------ the pairing link of 0.2.0
test("a 0.2.0 pairing link nobody opened yet still makes its first visitor the owner", async () => {
  const { logic, storage } = takenOver(unpairedConfig(19));
  assert.deepEqual([(await logic.status()).claimed, (await logic.status()).legacy], [false, true]);

  // A wrong code, a group, and a plain message claim nothing.
  assert.equal(await roleOf(logic, OLD_SECRET, GUEST_CHAT, GUEST, "/start " + NEW_CODE), "stranger");
  assert.equal(await roleOf(logic, OLD_SECRET, GROUP, GUEST, "/start " + PAIR_CODE), "stranger");
  assert.equal(await roleOf(logic, OLD_SECRET, GUEST_CHAT, GUEST, PAIR_CODE), "stranger");
  assert.equal((await logic.status()).claimed, false);

  const claim = await logic.gate({ secret: OLD_SECRET, update: message(OWNER_CHAT, OWNER, "/start " + PAIR_CODE) });
  assert.deepEqual(claim.access, { role: "owner", allowed: true, claimed: true, ownerKnown: true, gone: false });
  const saved = storage.map.get("registry");
  assert.deepEqual([saved.ownerId, saved.claimCode, saved.claimUntil], [OWNER.id, "", 0]);

  // The link worked once: the same code does nothing for the next person.
  assert.equal(await roleOf(logic, OLD_SECRET, GUEST_CHAT, GUEST, "/start " + PAIR_CODE), "stranger");
  assert.equal(await roleOf(logic, OLD_SECRET, OWNER_CHAT, OWNER), "owner");
});

test("a 0.2.0 pairing link keeps its 24 hours: at the last moment it works, after it nobody gets in", async () => {
  const onTime = takenOver(unpairedConfig(1));
  onTime.now.advance(HOUR);
  assert.equal(await roleOf(onTime.logic, OLD_SECRET, OWNER_CHAT, OWNER, "/start " + PAIR_CODE), "owner");

  const late = takenOver(unpairedConfig(1));
  late.now.advance(HOUR + 1);
  const answer = await late.logic.gate({ secret: OLD_SECRET, update: message(OWNER_CHAT, OWNER, "/start " + PAIR_CODE) });
  assert.deepEqual(answer.access, { role: "stranger", allowed: false, claimed: false, ownerKnown: false, gone: false });
  assert.equal((await late.logic.status()).claimed, false);

  // Setup without a token makes a fresh link for the same bot. The dead code stays dead.
  const again = await late.logic.setup({ origin: ORIGIN });
  assert.deepEqual([again.ok, again.claimed, again.link], [true, false, `https://t.me/${BOT.username}?start=${NEW_CODE}`]);
  assert.equal("claimUntil" in again, false);
  const secret = await newSecret();
  assert.equal(await roleOf(late.logic, secret, GUEST_CHAT, GUEST, "/start " + PAIR_CODE), "stranger");
  assert.equal(await roleOf(late.logic, secret, OWNER_CHAT, OWNER, "/start " + NEW_CODE), "owner");
});

// ------------------------------------------------------------------ moving the webhook
test("the webhook of a taken-over bot moves to today's address, keeping what Telegram still holds", async () => {
  const { logic, storage, send, methods, sentTo } = takenOver(pairedConfig());
  const secret = await newSecret();
  assert.notEqual(secret, OLD_SECRET);

  assert.deepEqual(await logic.refreshWebhook({ origin: ORIGIN + "/" }), { ok: true, refreshed: true, warnings: [] });
  assert.equal(WEBHOOK_PATH, "/telegram/webhook");
  assert.notEqual(WEBHOOK_PATH, LEGACY_WEBHOOK_PATH);
  // No drop_pending_updates: a message sent while the bot was being updated is still delivered.
  assert.deepEqual(sentTo("setWebhook"), [{ url: ORIGIN + WEBHOOK_PATH, secret_token: secret, allowed_updates: ALLOWED_UPDATES }]);
  assert.equal(methods()[0], "setWebhook");
  assert.equal(methods().includes("getMe"), false);
  assert.equal(methods().includes("deleteWebhook"), false);
  // The command menu of 0.2.0 is replaced by today's.
  assert.ok(sentTo("setMyCommands").length >= 1);
  assert.ok(sentTo("setMyCommands")[0].commands.some((entry) => entry.command === "every"));

  const saved = storage.map.get("registry");
  assert.deepEqual(
    [saved.legacy, saved.secret, saved.oldSecret, saved.legacyTriedAt, saved.origin, saved.ownerId],
    [false, secret, "", 0, ORIGIN, OWNER.id],
  );
  assert.deepEqual(Object.keys(saved.allowed), [String(FRIEND.id), String(GROUP.id)]);
  assert.equal("legacy" in (await logic.status()), false);

  // From now on only today's secret opens the gate.
  const answer = await logic.gate({ secret, update: message(OWNER_CHAT, OWNER, "/help") });
  assert.deepEqual([answer.access.role, "legacy" in answer], ["owner", false]);
  assert.equal(await roleOf(logic, OLD_SECRET, OWNER_CHAT, OWNER), "bad-secret");

  // Asking again does nothing and calls nobody.
  const calls = send.calls.length;
  assert.deepEqual(await logic.refreshWebhook({ origin: ORIGIN }), { ok: true, refreshed: false });
  assert.equal(send.calls.length, calls);
  assert.deepEqual(storage.map.get("config"), pairedConfig());
});

test("the move uses the address the first update came in on when none is given, and refuses a bad one", async () => {
  const { logic, send, sentTo } = takenOver(pairedConfig());
  assert.deepEqual(await logic.refreshWebhook(), { ok: false, error: "origin" });
  assert.deepEqual(await logic.refreshWebhook({ origin: "http://plain.test" }), { ok: false, error: "origin" });
  assert.deepEqual(await logic.refreshWebhook({ origin: ORIGIN + "/v1" }), { ok: false, error: "origin" });
  assert.equal(send.calls.length, 0);
  assert.equal((await logic.status()).legacy, true);

  assert.equal(await roleOf(logic, OLD_SECRET, OWNER_CHAT, OWNER), "owner"); // carries origin: ORIGIN
  assert.deepEqual(await logic.refreshWebhook(), { ok: true, refreshed: true, warnings: [] });
  assert.equal(sentTo("setWebhook")[0].url, ORIGIN + WEBHOOK_PATH);
});

test("when Telegram refuses the move the bot keeps working on both secrets, and tries again an hour later", async () => {
  const world = takenOver(pairedConfig(), { setWebhook: REFUSED });
  const { logic, storage, send, now, sentTo, telegram } = world;
  const secret = await newSecret();

  assert.deepEqual(await logic.refreshWebhook({ origin: ORIGIN }), {
    ok: false,
    error: "webhook-failed",
    detail: "Bad Request: bad webhook: try later",
  });
  let saved = storage.map.get("registry");
  assert.deepEqual(
    [saved.legacy, saved.secret, saved.oldSecret, saved.legacyTriedAt, saved.ownerId],
    [true, secret, OLD_SECRET, START, OWNER.id],
  );
  assert.equal((await logic.status()).legacy, true);

  // A refused call may still have been applied, so whichever secret Telegram uses gets through.
  assert.equal(await roleOf(logic, OLD_SECRET, OWNER_CHAT, OWNER), "owner");
  assert.equal(await roleOf(logic, secret, FRIEND_CHAT, FRIEND), "member");
  assert.equal(await roleOf(logic, "neither", OWNER_CHAT, OWNER), "bad-secret");

  // Not again within the hour, however many updates arrive.
  now.advance(HOUR - 1);
  assert.deepEqual(await logic.refreshWebhook({ origin: ORIGIN }), { ok: true, refreshed: false, waiting: true });
  assert.equal(sentTo("setWebhook").length, 1);
  assert.equal(send.calls.length, 1);

  // An hour after the first try it is tried again, and this time Telegram takes it.
  now.advance(1);
  delete telegram.setWebhook;
  assert.deepEqual(await logic.refreshWebhook({ origin: ORIGIN }), { ok: true, refreshed: true, warnings: [] });
  assert.deepEqual(sentTo("setWebhook")[1], { url: ORIGIN + WEBHOOK_PATH, secret_token: secret, allowed_updates: ALLOWED_UPDATES });
  saved = storage.map.get("registry");
  assert.deepEqual([saved.legacy, saved.secret, saved.oldSecret, saved.legacyTriedAt], [false, secret, "", 0]);
  assert.equal(await roleOf(logic, OLD_SECRET, OWNER_CHAT, OWNER), "bad-secret");
  assert.equal(await roleOf(logic, secret, OWNER_CHAT, OWNER), "owner");
});

test("two updates arriving together move the webhook once", async () => {
  const { logic, sentTo } = takenOver(pairedConfig());
  const answers = await Promise.all([logic.refreshWebhook({ origin: ORIGIN }), logic.refreshWebhook({ origin: ORIGIN })]);
  assert.equal(sentTo("setWebhook").length, 1);
  assert.deepEqual(answers.map((answer) => answer.ok), [true, true]);
  assert.deepEqual(answers.filter((answer) => answer.refreshed).length, 1);
});

test("a move that only failed on the profile texts still counts, and says what was left out", async () => {
  const refuse = () => reply({ ok: false, error_code: 429, description: "Too Many Requests: retry after 600" }, { status: 429 });
  const { logic, storage } = takenOver(pairedConfig(), { setMyDescription: refuse });
  const answer = await logic.refreshWebhook({ origin: ORIGIN });
  assert.deepEqual([answer.ok, answer.refreshed], [true, true]);
  assert.ok(answer.warnings.length >= 1);
  assert.ok(answer.warnings.every((warning) => /^description/.test(warning)), answer.warnings.join(" | "));
  assert.equal(storage.map.get("registry").legacy, false);
});

// ------------------------------------------------------------------ setup on a taken-over bot
test("setup without a token re-points a taken-over bot and keeps its owner and people", async () => {
  const { logic, storage, sentTo } = takenOver(pairedConfig());
  assert.deepEqual(await logic.setup({ origin: ORIGIN }), {
    ok: true,
    bot: { username: BOT.username, name: BOT.name },
    link: `https://t.me/${BOT.username}`,
    claimed: true,
    warnings: [],
  });
  const secret = await newSecret();
  assert.deepEqual(sentTo("setWebhook"), [
    { url: ORIGIN + WEBHOOK_PATH, secret_token: secret, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: true },
  ]);
  const saved = storage.map.get("registry");
  assert.deepEqual(
    [saved.token, saved.legacy, saved.secret, saved.oldSecret, saved.ownerId, Object.keys(saved.allowed)],
    [TOKEN, false, secret, "", OWNER.id, [String(FRIEND.id), String(GROUP.id)]],
  );
  assert.equal("legacy" in (await logic.status()), false);
  assert.equal(await roleOf(logic, OLD_SECRET, OWNER_CHAT, OWNER), "bad-secret");
  assert.equal(await roleOf(logic, secret, OWNER_CHAT, OWNER), "owner");
  assert.deepEqual(await logic.refreshWebhook({ origin: ORIGIN }), { ok: true, refreshed: false });
});

test("setup with newPairing forgets the owner and everyone let in, and hands out a new link", async () => {
  const { logic, storage } = takenOver(pairedConfig());
  assert.deepEqual(await logic.setup({ origin: ORIGIN, newPairing: true }), {
    ok: true,
    bot: { username: BOT.username, name: BOT.name },
    link: `https://t.me/${BOT.username}?start=${NEW_CODE}`,
    claimed: false,
    warnings: [],
  });
  const saved = storage.map.get("registry");
  assert.deepEqual([saved.ownerId, saved.allowed, saved.claimCode, saved.claimUntil], [null, {}, NEW_CODE, 0]);
  const secret = await newSecret();
  assert.equal(await roleOf(logic, secret, OWNER_CHAT, OWNER), "stranger");
  assert.equal(await roleOf(logic, secret, FRIEND_CHAT, FRIEND, "/start " + NEW_CODE), "owner");
  assert.equal(await roleOf(logic, secret, OWNER_CHAT, OWNER), "stranger");
});

test("setup keeps a 0.2.0 pairing code that is still good, and says until when", async () => {
  const { logic } = takenOver(unpairedConfig(19));
  const answer = await logic.setup({ origin: ORIGIN });
  assert.deepEqual(answer, {
    ok: true,
    bot: { username: BOT.username, name: BOT.name },
    link: `https://t.me/${BOT.username}?start=${PAIR_CODE}`,
    claimed: false,
    warnings: [],
    claimUntil: START + 19 * HOUR,
  });
  assert.equal(await roleOf(logic, await newSecret(), OWNER_CHAT, OWNER, "/start " + PAIR_CODE), "owner");
});

test("setup without a token has nothing to reuse on an empty Registry", async () => {
  const { logic, send, storage } = takenOver(null);
  assert.deepEqual(await logic.setup({ origin: ORIGIN }), { ok: false, error: "token-format" });
  assert.deepEqual(await logic.setup({ origin: ORIGIN, newPairing: true }), { ok: false, error: "token-format" });
  assert.equal(send.calls.length, 0);
  assert.equal(storage.map.size, 0);
});

// ------------------------------------------------------------------ disconnecting
test("reset forgets the 0.2.0 copy too, so the bot is not taken over again on the next start", async () => {
  const world = takenOver(pairedConfig());
  assert.equal((await world.logic.status()).configured, true);
  assert.deepEqual(await world.logic.reset(), { ok: true, webhook: "deleted" });
  assert.deepEqual(world.sentTo("deleteWebhook"), [{ drop_pending_updates: true }]);
  assert.equal(world.storage.map.size, 0);
  assert.equal((await world.logic.status()).configured, false);

  const restarted = new RegistryLogic({ storage: world.storage, fetch: world.send, now: world.now, pages: PAGES });
  assert.equal((await restarted.status()).configured, false);
  assert.deepEqual(await restarted.gate({ secret: OLD_SECRET, update: message(OWNER_CHAT, OWNER, "hi") }), {
    ok: false,
    reason: "not-configured",
  });
});

// ------------------------------------------------------------------ the list the owner keeps by hand
test("allow lets a chat in by its id, users lists who is in, forget takes one out", async () => {
  const { logic, now } = takenOver(pairedConfig());
  for (const wrong of [undefined, null, "", " ", "abc", "12.5", "1e5", "@budi", "123456789012345678901", {}, [1, 2]]) {
    assert.deepEqual(await logic.allow(wrong), { ok: false, error: "id" }, JSON.stringify(wrong));
  }
  assert.equal(await roleOf(logic, OLD_SECRET, GUEST_CHAT, GUEST), "stranger");

  now.advance(HOUR);
  assert.deepEqual(await logic.allow(GUEST.id), { ok: true, chats: 3 });
  assert.deepEqual(await logic.allow(" 333 "), { ok: true, chats: 3 }); // already in: counted once
  assert.deepEqual(await logic.allow("-7002"), { ok: true, chats: 4 });
  assert.equal(await roleOf(logic, OLD_SECRET, GUEST_CHAT, GUEST), "member");
  assert.equal(await roleOf(logic, OLD_SECRET, { id: -7002, type: "group", title: "Later" }, GUEST), "member");

  assert.deepEqual(await logic.users(), {
    ok: true,
    ownerId: OWNER.id,
    access: "private",
    chats: [
      { id: "222", title: "" },
      { id: "333", title: "" },
      { id: "-5001", title: "" },
      { id: "-7002", title: "" },
    ],
  });
  assert.equal(logic.state.allowed["333"].addedAt, START + HOUR);
  assert.equal(logic.state.allowed["222"].addedAt, CONNECTED);

  assert.deepEqual(await logic.forget(GUEST.id), { ok: true });
  assert.equal(await roleOf(logic, OLD_SECRET, GUEST_CHAT, GUEST), "stranger");
  assert.equal((await logic.users()).chats.some((chat) => chat.id === "333"), false);
  // The owner is never on the list and never needs to be.
  assert.equal((await logic.users()).chats.some((chat) => chat.id === String(OWNER.id)), false);
  assert.equal(await roleOf(logic, OLD_SECRET, OWNER_CHAT, OWNER), "owner");
});

test("users shows a group under the title it had when the owner let it in, and public access as public", async () => {
  const { logic } = takenOver(null);
  assert.deepEqual(await logic.users(), { ok: true, ownerId: null, access: "private", chats: [] });
  assert.equal((await logic.setup({ token: TOKEN, origin: ORIGIN })).ok, true);
  const secret = await newSecret();
  assert.equal(await roleOf(logic, secret, OWNER_CHAT, OWNER, "/start " + NEW_CODE), "owner");
  assert.equal(await roleOf(logic, secret, GROUP, OWNER, "/help"), "owner");
  await logic.setPublic(true);
  assert.deepEqual(await logic.users(), {
    ok: true,
    ownerId: OWNER.id,
    access: "public",
    chats: [{ id: String(GROUP.id), title: "Makers" }],
  });
});

test("allow, users and the webhook move are reachable through the Durable Object routes", async () => {
  const world = takenOver(null);
  class Registry {
    constructor(state) {
      this.logic = new RegistryLogic({ storage: state.storage, fetch: world.send, now: world.now, pages: PAGES, randomHex: () => NEW_CODE });
    }

    fetch(request) {
      return handleRegistry(this.logic, request);
    }
  }
  const namespace = new FakeNamespace(Registry, {}, world.now);
  // 0.2.0 kept its bot in the object called "main", which is the one today's Worker opens.
  assert.equal(REGISTRY_NAME, "main");
  await namespace.object(REGISTRY_NAME).storage.put("config", pairedConfig());
  const registry = registryClient(namespace);

  assert.equal((await registry.status()).legacy, true);
  const first = await registry.gate(OLD_SECRET, message(OWNER_CHAT, OWNER, "/help"), ORIGIN);
  assert.deepEqual([first.access.role, first.legacy, first.config.origin], ["owner", true, ORIGIN]);

  assert.deepEqual(await registry.allow("abc"), { ok: false, error: "id" });
  assert.deepEqual(await registry.allow(), { ok: false, error: "id" });
  assert.deepEqual(await registry.allow(GUEST.id), { ok: true, chats: 3 });
  assert.deepEqual(await registry.users(), {
    ok: true,
    ownerId: OWNER.id,
    access: "private",
    chats: [
      { id: "222", title: "" },
      { id: "333", title: "" },
      { id: "-5001", title: "" },
    ],
  });
  assert.deepEqual(await registry.forget(GUEST.id), { ok: true });
  assert.equal((await registry.users()).chats.length, 2);

  assert.deepEqual(await registry.refreshWebhook("not an address"), { ok: false, error: "origin" });
  assert.deepEqual(await registry.refreshWebhook(ORIGIN), { ok: true, refreshed: true, warnings: [] });
  assert.deepEqual(await registry.refreshWebhook(ORIGIN), { ok: true, refreshed: false });
  assert.equal("legacy" in (await registry.status()), false);
  assert.deepEqual(await registry.gate(OLD_SECRET, message(OWNER_CHAT, OWNER, "hi"), ORIGIN), { ok: false, reason: "bad-secret" });

  assert.deepEqual(await registry.reset(), { ok: true, webhook: "deleted" });
  assert.equal(namespace.object(REGISTRY_NAME).storage.map.size, 0);
});
