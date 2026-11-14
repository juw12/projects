// Checks for the bot's Telegram profile: the command menu, the profile texts, the picture and the
// name are set again once per version ("the dress-up"), and the profile report reads back what
// Telegram really shows.
import test from "node:test";
import assert from "node:assert/strict";

import { NEWS_VERSION, RegistryLogic, botDescription, handleRegistry, registryClient } from "../src/registry.js";
import { COMMANDS, OWNER_COMMANDS, commandList, ownerCommandList, t, tPlain } from "../src/strings.js";
import { API_BASE } from "../src/telegram.js";
import { sha256Hex } from "../src/util.js";
import { FakeNamespace, FakeStorage, fakeFetch, makeClock, reply } from "./fakes.js";

// A made-up token, longer than a real one on purpose, so nothing mistakes it for a secret.
const TOKEN = "123456789:AAExampleTokenThatIsNotRealAtAll_0123456";
const ORIGIN = "https://glow-bot.test";
const PAGES = "https://glow.test/projects/glow";
const BOT_ID = 9001;
const OWNER = { id: 111, first_name: "Juwen", language_code: "en" };
const OWNER_CHAT = { id: 111, type: "private" };
const CLAIM_CODE = "1".repeat(32);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// [the key in the profile report, Telegram's language code, the bot's language]
const LANGS = [
  ["default", "", "en"],
  ["id", "id", "id"],
  ["zh", "zh", "zh-Hans"],
];
const EVERYONE = COMMANDS.length;
const FOR_OWNER = COMMANDS.length + OWNER_COMMANDS.length;
const DRESSED = { ok: true, dressed: true, plan: "full", warnings: [] };
const NOTHING_DUE = { ok: true, dressed: false };

// A pretend Telegram that remembers what the bot was given, as the real one does, so what is
// read back is what was really set.
function pretendTelegram(start = {}) {
  const shown = {
    name: start.name === undefined ? "GlowBot" : start.name,
    photos: 0,
    commands: new Map(),
    descriptions: new Map(),
    shorts: new Map(),
    webhook: { url: "", allowed_updates: [] },
  };
  const calls = [];
  const refused = new Map(); // method -> what Telegram says when it refuses
  const menuKey = (payload) => {
    const scope = payload.scope ? `${payload.scope.type}:${payload.scope.chat_id}` : "default";
    return `${scope}/${payload.language_code || ""}`;
  };
  const language = (payload) => payload.language_code || "";
  const answers = {
    getMe: () => ({ id: BOT_ID, is_bot: true, first_name: shown.name, username: "glow_test_bot" }),
    setWebhook: (payload) => {
      shown.webhook = { url: payload.url, allowed_updates: payload.allowed_updates };
      return true;
    },
    getWebhookInfo: () => ({ ...shown.webhook, pending_update_count: 0 }),
    setMyCommands: (payload) => {
      shown.commands.set(menuKey(payload), payload.commands);
      return true;
    },
    getMyCommands: (payload) => shown.commands.get(menuKey(payload)) || [],
    setMyDescription: (payload) => {
      shown.descriptions.set(language(payload), payload.description);
      return true;
    },
    getMyDescription: (payload) => ({ description: shown.descriptions.get(language(payload)) || "" }),
    setMyShortDescription: (payload) => {
      shown.shorts.set(language(payload), payload.short_description);
      return true;
    },
    getMyShortDescription: (payload) => ({ short_description: shown.shorts.get(language(payload)) || "" }),
    setMyName: (payload) => {
      shown.name = payload.name;
      return true;
    },
    getMyName: () => ({ name: shown.name }),
    setMyProfilePhoto: () => {
      shown.photos += 1;
      return true;
    },
    getUserProfilePhotos: () => ({ total_count: shown.photos, photos: [] }),
    sendMessage: () => ({ message_id: 1 }),
  };
  const route = [
    `${API_BASE}/bot${TOKEN}/`,
    (url, init) => {
      const method = url.split("/").pop();
      const payload = init.body instanceof FormData ? init.body : JSON.parse(init.body || "{}");
      calls.push({ method, payload });
      if (refused.has(method)) {
        return reply({ ok: false, error_code: 400, description: refused.get(method) }, { status: 400 });
      }
      return reply({ ok: true, result: answers[method] ? answers[method](payload) : true });
    },
  ];
  return {
    shown,
    calls,
    refused,
    route,
    count: (method) => calls.filter((call) => call.method === method).length,
    payloads: (method) => calls.filter((call) => call.method === method).map((call) => call.payload),
  };
}

// How often each method was called.
function tally(calls) {
  const counts = {};
  for (const { method } of calls) counts[method] = (counts[method] || 0) + 1;
  return counts;
}

function makeWorld(start) {
  const now = makeClock();
  const storage = new FakeStorage();
  const telegram = pretendTelegram(start);
  const picture = { bytes: new Uint8Array([255, 216, 255, 224]), status: 200 };
  const send = fakeFetch([telegram.route, [`${PAGES}/bot/logo.jpg`, () => reply(picture.bytes, { status: picture.status })]]);
  const options = { storage, fetch: send, now, pages: PAGES, randomHex: (bytes) => "1".repeat(bytes * 2) };
  // A new RegistryLogic on the same storage is what a restart, or a new version, looks like.
  const logicFor = (version) => new RegistryLogic({ ...options, version });
  const record = () => storage.map.get("dress");
  return { now, storage, telegram, picture, send, options, logicFor, record };
}

let updateNumber = 5000;

function message(text, from = OWNER) {
  updateNumber += 1;
  return { update_id: updateNumber, message: { message_id: updateNumber, chat: OWNER_CHAT, from, text } };
}

async function webhookSecret() {
  return sha256Hex("glow-bot-webhook:" + TOKEN);
}

async function connect(logic) {
  const result = await logic.setup({ token: TOKEN, origin: ORIGIN });
  assert.equal(result.ok, true);
}

async function claim(logic) {
  const answer = await logic.gate({ secret: await webhookSecret(), update: message("/start " + CLAIM_CODE) });
  assert.equal(answer.access.claimed, true);
  return answer;
}

// A bot connected and claimed under an earlier Worker, which kept no record of a dress-up and
// left the name as BotFather had it. It now runs the given version, which has asked Telegram
// nothing yet.
async function upgraded(version, start = {}) {
  const world = makeWorld(start);
  const earlier = world.logicFor("");
  world.telegram.refused.set("setMyName", "the earlier Worker never asked for this");
  await connect(earlier);
  world.telegram.refused.clear();
  if (start.owner !== false) await claim(earlier);
  world.telegram.calls.length = 0;
  return { ...world, logic: world.logicFor(version) };
}

test("the menu and the profile texts fit Telegram's limits in every language", () => {
  for (const [, , lang] of LANGS) {
    const menu = ownerCommandList(lang);
    assert.deepEqual(menu.slice(0, EVERYONE), commandList(lang), lang);
    assert.equal(menu.length, FOR_OWNER, lang);
    assert.ok(menu.length <= 100, lang);
    for (const entry of menu) {
      assert.match(entry.command, /^[a-z0-9_]{1,32}$/, lang);
      assert.ok(entry.description.length >= 1 && entry.description.length <= 256, `${lang} /${entry.command}`);
    }
    assert.equal(botDescription(lang, true), tPlain(lang, "bot.description"));
    assert.equal(botDescription(lang, false), tPlain(lang, "bot.description") + "\n\n" + tPlain(lang, "bot.private"));
    assert.ok(botDescription(lang, false).length <= 512, `${lang} description: ${botDescription(lang, false).length}`);
    assert.ok(tPlain(lang, "bot.short").length <= 120, `${lang} short description: ${tPlain(lang, "bot.short").length}`);
  }
});

test("a new version sets the menu and the profile once", async () => {
  const { logic, telegram, logicFor } = await upgraded("9.0.1");
  assert.equal((await logic.status()).dress, true);

  // Two updates arriving together share one run.
  const [first, second] = await Promise.all([logic.dress(), logic.dress()]);
  assert.deepEqual(first, DRESSED);
  assert.deepEqual(second, DRESSED);
  assert.deepEqual(tally(telegram.calls), {
    setMyCommands: 6,
    setMyDescription: 3,
    setMyShortDescription: 3,
    getUserProfilePhotos: 1,
    getMyName: 1,
  });
  for (const [, code, lang] of LANGS) {
    assert.deepEqual(telegram.shown.commands.get("default/" + code), commandList(lang));
    assert.deepEqual(telegram.shown.commands.get("chat:111/" + code), ownerCommandList(lang));
    assert.equal(telegram.shown.descriptions.get(code), botDescription(lang, false));
    assert.equal(telegram.shown.shorts.get(code), tPlain(lang, "bot.short"));
  }
  assert.equal("dress" in (await logic.status()), false);

  telegram.calls.length = 0;
  assert.deepEqual(await logic.dress(), NOTHING_DUE);
  assert.deepEqual(await logicFor("9.0.1").dress(), NOTHING_DUE, "a restart does not dress again");
  assert.equal(telegram.calls.length, 0);
  assert.deepEqual(await logicFor("9.0.2").dress(), DRESSED, "the next version does");
});

test("the picture is uploaded only when the bot shows none or the picture changed", async () => {
  const { logic, telegram, picture, logicFor, record } = await upgraded("9.0.1");
  assert.equal(telegram.shown.photos, 1, "the earlier Worker uploaded it when the bot was connected");

  await logic.dress();
  const adopted = record().photo;
  assert.match(adopted, /^[0-9a-f]{64}$/);
  assert.equal(telegram.count("setMyProfilePhoto"), 0, "the picture already shown is taken to be this one");

  assert.deepEqual(await logicFor("9.0.2").dress(), DRESSED);
  assert.equal(telegram.count("setMyProfilePhoto"), 0, "the same picture is not uploaded again");

  picture.bytes = new Uint8Array([255, 216, 255, 225, 7]);
  telegram.refused.set("setMyProfilePhoto", "Bad Request: PHOTO_INVALID");
  assert.deepEqual((await logicFor("9.0.3").dress()).warnings, ["photo: Bad Request: PHOTO_INVALID"]);
  assert.equal(record().photo, adopted, "a refused picture is not remembered as shown");

  telegram.refused.clear();
  assert.deepEqual(await logicFor("9.0.4").dress(), DRESSED);
  const uploads = telegram.payloads("setMyProfilePhoto");
  assert.equal(uploads.length, 2);
  assert.ok(uploads[1] instanceof FormData);
  assert.deepEqual(JSON.parse(uploads[1].get("photo")), { type: "static", photo: "attach://file" });
  assert.equal(uploads[1].get("file").size, 5);
  assert.notEqual(record().photo, adopted);

  telegram.shown.photos = 0;
  assert.deepEqual(await logicFor("9.0.5").dress(), DRESSED);
  assert.equal(telegram.shown.photos, 1, "a bot that shows no picture gets it back");

  picture.status = 404;
  picture.bytes = new Uint8Array([1]);
  assert.deepEqual((await logicFor("9.0.6").dress()).warnings, ["photo: HTTP 404"]);
  assert.equal(telegram.count("setMyProfilePhoto"), 3);
});

test("only a misspelt GlowBot is renamed", async () => {
  for (const name of ["glowbot", "Glow Bot", "GLOWBOT"]) {
    const { logic, telegram } = await upgraded("9.0.1", { name });
    assert.deepEqual(await logic.dress(), DRESSED, name);
    assert.deepEqual(telegram.payloads("setMyName"), [{ name: "GlowBot" }], name);
    assert.equal((await logic.status()).bot.name, "GlowBot", name);
  }
  for (const name of ["GlowBot", "Juwen's helper", "Glow"]) {
    const { logic, telegram } = await upgraded("9.0.1", { name });
    assert.deepEqual(await logic.dress(), DRESSED, name);
    assert.equal(telegram.count("setMyName"), 0, name);
    assert.equal(telegram.shown.name, name);
  }

  const { logic, telegram } = await upgraded("9.0.1", { name: "glowbot" });
  telegram.refused.set("setMyName", "Bad Request: the name was changed too recently");
  assert.deepEqual((await logic.dress()).warnings, ["name: Bad Request: the name was changed too recently"]);
  assert.equal((await logic.status()).bot.name, "glowbot");

  const fresh = makeWorld({ name: "glowbot" });
  await connect(fresh.logicFor("9.0.1"));
  assert.equal(fresh.telegram.shown.name, "GlowBot", "a bot connected today is named at once");
});

test("a dress-up that left warnings is tried again after an hour, three times at most", async () => {
  const { logic, telegram, now, logicFor, record } = await upgraded("9.0.1");
  telegram.refused.set("setMyDescription", "Bad Request: not now");
  const first = await logic.dress();
  assert.deepEqual(first.warnings, [
    "description: Bad Request: not now",
    "description (id): Bad Request: not now",
    "description (zh): Bad Request: not now",
  ]);
  assert.equal("dress" in (await logic.status()), false, "not at once");

  now.advance(59 * MINUTE);
  assert.deepEqual(await logic.dress(), NOTHING_DUE);
  now.advance(MINUTE);
  assert.equal((await logic.dress()).warnings.length, 3);
  assert.equal(record().tries, 2);
  now.advance(HOUR);
  const restarted = logicFor("9.0.1");
  await restarted.dress();
  assert.equal(record().tries, 3, "a restart does not reset the count");

  telegram.refused.clear();
  now.advance(24 * HOUR);
  telegram.calls.length = 0;
  assert.deepEqual(await restarted.dress(), NOTHING_DUE);
  assert.equal(telegram.calls.length, 0);
  assert.deepEqual(await logicFor("9.0.2").dress(), DRESSED, "a new version starts counting again");
});

test("a second try that works ends the retries", async () => {
  const { logic, telegram, now, record } = await upgraded("9.0.1");
  telegram.refused.set("setMyShortDescription", "Bad Request: not now");
  assert.equal((await logic.dress()).warnings.length, 3);
  telegram.refused.clear();
  now.advance(HOUR);
  assert.deepEqual(await logic.dress(), DRESSED);
  assert.equal(record().tries, 2);
  now.advance(HOUR);
  assert.deepEqual(await logic.dress(), NOTHING_DUE);
});

test("the owner is told once that the new version is live", async () => {
  const { logic, telegram, now, record } = await upgraded(NEWS_VERSION);
  telegram.refused.set("setMyDescription", "Bad Request: not now");
  await logic.dress();
  const english = t("en", "about.whatsnew", { version: NEWS_VERSION });
  assert.ok(english.includes(`GlowBot ${NEWS_VERSION} is live`));
  assert.deepEqual(telegram.payloads("sendMessage"), [{ chat_id: 111, text: english, parse_mode: "HTML" }]);
  assert.deepEqual(record().news, { version: NEWS_VERSION, at: now(), ok: true });

  telegram.refused.clear();
  now.advance(HOUR);
  assert.deepEqual(await logic.dress(), DRESSED);
  assert.equal(telegram.count("sendMessage"), 1, "the second try does not send it again");
});

test("the notice is in the owner's language once the bot has heard from them", async () => {
  const { logic, telegram } = await upgraded(NEWS_VERSION);
  await logic.gate({ secret: await webhookSecret(), update: message("hai", { ...OWNER, language_code: "id" }) });
  await logic.dress();
  const [sent] = telegram.payloads("sendMessage");
  assert.equal(sent.text, t("id", "about.whatsnew", { version: NEWS_VERSION }));
  assert.notEqual(sent.text, t("en", "about.whatsnew", { version: NEWS_VERSION }));
});

test("a notice Telegram refused is recorded and not sent again", async () => {
  const { logic, telegram, now, record } = await upgraded(NEWS_VERSION);
  telegram.refused.set("sendMessage", "Bad Request: chat not found");
  telegram.refused.set("setMyDescription", "Bad Request: not now");
  const first = await logic.dress();
  assert.equal(first.warnings.length, 3, "the notice is not part of the profile, so it is no warning");
  assert.deepEqual(record().news, { version: NEWS_VERSION, at: now(), ok: false, detail: "Bad Request: chat not found" });

  telegram.refused.clear();
  now.advance(HOUR);
  assert.deepEqual(await logic.dress(), DRESSED);
  assert.equal(telegram.count("sendMessage"), 1);
  assert.equal(record().news.ok, false);
});

test("no notice for another version, without an owner, or on a first connection", async () => {
  const other = await upgraded("9.0.1");
  assert.deepEqual(await other.logic.dress(), DRESSED);
  assert.equal(other.telegram.count("sendMessage"), 0);

  const unclaimed = await upgraded(NEWS_VERSION, { owner: false });
  assert.deepEqual(await unclaimed.logic.dress(), DRESSED);
  assert.equal(unclaimed.telegram.count("setMyCommands"), 3, "no owner, so no owner menu");
  await claim(unclaimed.logic);
  assert.equal((await unclaimed.logic.dress()).plan, "part");
  assert.equal(unclaimed.telegram.count("sendMessage"), 0);

  const fresh = makeWorld();
  const logic = fresh.logicFor(NEWS_VERSION);
  await connect(logic);
  await claim(logic);
  assert.equal((await logic.dress()).plan, "part");
  assert.equal(fresh.telegram.count("sendMessage"), 0);
});

test("a claim gives the new owner their menu and nothing else", async () => {
  const { logicFor, telegram } = makeWorld();
  const logic = logicFor("9.0.0");
  await connect(logic);
  assert.equal(telegram.count("setMyProfilePhoto"), 1);
  assert.equal("dress" in (await logic.status()), false, "connecting the bot dressed it");
  assert.deepEqual(await logic.dress(), NOTHING_DUE);

  const answer = await claim(logic);
  assert.equal(answer.dress, true);
  telegram.calls.length = 0;
  assert.deepEqual(await logic.dress(), { ok: true, dressed: true, plan: "part", warnings: [] });
  assert.deepEqual(tally(telegram.calls), { setMyCommands: 3 });
  assert.deepEqual(
    telegram.payloads("setMyCommands").map((payload) => [payload.scope, payload.language_code, payload.commands.length]),
    LANGS.map(([, code]) => [{ type: "chat", chat_id: 111 }, code || undefined, FOR_OWNER]),
  );
  assert.deepEqual(await logic.dress(), NOTHING_DUE);
});

test("opening or closing the bot rewrites only the description", async () => {
  const { logic, telegram } = await upgraded("9.0.1");
  await logic.dress();

  for (const open of [true, false]) {
    telegram.calls.length = 0;
    await logic.setPublic(open);
    assert.equal((await logic.status()).dress, true);
    assert.deepEqual(await logic.dress(), { ok: true, dressed: true, plan: "part", warnings: [] });
    assert.deepEqual(tally(telegram.calls), { setMyDescription: 3 });
    for (const [, code, lang] of LANGS) {
      const description = telegram.shown.descriptions.get(code);
      assert.equal(description, botDescription(lang, open));
      assert.equal(description.includes(tPlain(lang, "bot.private")), !open);
    }
    assert.deepEqual(await logic.dress(), NOTHING_DUE);
  }
});

test("a dress-up never throws, and a cut-off one counts as a try", async () => {
  const { logic, telegram, send, options, record } = await upgraded("9.0.1");
  const broken = new RegistryLogic({
    ...options,
    version: "9.0.1",
    fetch: (input, init) => {
      if (String(input).startsWith(API_BASE)) throw new TypeError("fetch failed");
      return send(input, init);
    },
  });
  const result = await broken.dress();
  assert.equal(result.dressed, true);
  assert.ok(result.warnings.length > 0);
  assert.equal(record().tries, 1);
  assert.deepEqual(await logic.dress(), NOTHING_DUE, "not tried again at once");
  assert.equal(telegram.calls.length, 0);
});

test("the profile reads back what Telegram shows", async () => {
  const { logic, now } = await upgraded("9.0.1", { name: "glowbot" });
  const before = await logic.profile();
  assert.deepEqual([before.ok, before.dress], [false, null], "this version has not dressed the bot yet");

  await logic.dress();
  const profile = await logic.profile();
  const menu = (commands) => Object.fromEntries(LANGS.map(([key]) => [key, { ok: true, commands }]));
  const texts = (lengthOf) => Object.fromEntries(LANGS.map(([key, , lang]) => [key, { ok: true, length: lengthOf(lang) }]));
  assert.deepEqual(profile, {
    ok: true,
    configured: true,
    version: "9.0.1",
    access: "private",
    claimed: true,
    name: { ok: true, value: "GlowBot" },
    menus: menu(EVERYONE),
    ownerMenus: menu(FOR_OWNER),
    descriptions: texts((lang) => botDescription(lang, false).length),
    shorts: texts((lang) => tPlain(lang, "bot.short").length),
    photo: { ok: true, count: 1 },
    webhook: { ok: true, here: true, listens: true, pending: 0, lastError: "", lastErrorAt: 0 },
    dress: { version: "9.0.1", current: true, at: now(), tries: 1, warnings: [] },
    news: null,
    checkedAt: now(),
  });

  // Anyone may read it, so it holds no token, no secret and no ids.
  const text = JSON.stringify(profile);
  for (const secret of [TOKEN, TOKEN.split(":")[1], await webhookSecret(), CLAIM_CODE]) {
    assert.equal(text.includes(secret), false);
  }
  assert.doesNotMatch(text, /\b(111|9001|123456789)\b/);
});

test("the profile says which part is wrong, and asks Telegram again after five minutes", async () => {
  const { logic, telegram, now } = await upgraded("9.0.1");
  await logic.dress();
  assert.equal((await logic.profile()).ok, true);

  telegram.calls.length = 0;
  telegram.shown.descriptions.set("", "Something else");
  telegram.shown.commands.delete("default/id");
  telegram.shown.photos = 0;
  telegram.shown.webhook = { ...telegram.shown.webhook, url: "https://elsewhere.test/hook" };
  now.advance(5 * MINUTE - 1);
  assert.equal((await logic.profile()).ok, true, "the earlier answer is kept for five minutes");
  assert.equal(telegram.calls.length, 0);

  now.advance(1);
  const profile = await logic.profile();
  assert.equal(profile.ok, false);
  assert.deepEqual(profile.descriptions.default, { ok: false, length: 14, got: "Something else" });
  assert.equal(profile.descriptions.id.ok, true);
  assert.deepEqual(profile.menus, {
    default: { ok: true, commands: EVERYONE },
    id: { ok: false, commands: 0 },
    zh: { ok: true, commands: EVERYONE },
  });
  assert.deepEqual(profile.photo, { ok: false, count: 0 });
  assert.deepEqual([profile.webhook.ok, profile.webhook.here, profile.webhook.listens], [false, false, true]);
});

test("a dress-up clears the kept profile, and one that left warnings is not ok", async () => {
  const { logic, telegram, logicFor } = await upgraded("9.0.1");
  await logic.dress();
  assert.equal((await logic.profile()).access, "private");
  await logic.setPublic(true);
  await logic.dress();
  const open = await logic.profile();
  assert.deepEqual([open.ok, open.access, open.descriptions.default.length], [true, "public", tPlain("en", "bot.description").length]);

  telegram.refused.set("setMyShortDescription", "Bad Request: not now");
  telegram.shown.shorts.clear();
  const next = logicFor("9.0.2");
  assert.equal((await next.dress()).warnings.length, 3);
  const unfinished = await next.profile();
  assert.deepEqual([unfinished.ok, unfinished.dress.current, unfinished.dress.warnings.length], [false, true, 3]);
  assert.deepEqual(unfinished.shorts.default, { ok: false, length: 0, got: "" });
});

test("nothing to read before a bot is connected, and no owner menu before a claim", async () => {
  const { logicFor } = makeWorld();
  assert.deepEqual(await logicFor("9.0.0").profile(), { ok: false, configured: false });

  const logic = logicFor("9.0.0");
  await connect(logic);
  const profile = await logic.profile();
  assert.deepEqual([profile.ok, profile.claimed, profile.ownerMenus], [true, false, {}]);
  assert.deepEqual(profile.photo, { ok: true, count: 1 });
});

test("the Durable Object routes for the dress-up and the profile", async () => {
  const world = makeWorld();
  class Registry {
    constructor(state) {
      this.logic = new RegistryLogic({ ...world.options, storage: state.storage, version: "9.0.0" });
    }

    fetch(request) {
      return handleRegistry(this.logic, request);
    }
  }
  const registry = registryClient(new FakeNamespace(Registry, {}, world.now));

  assert.deepEqual(await registry.profile(), { ok: false, configured: false });
  assert.deepEqual(await registry.dress(), NOTHING_DUE);
  assert.equal((await registry.setup(TOKEN, ORIGIN)).ok, true);
  const claimAnswer = await registry.gate(await webhookSecret(), message("/start " + CLAIM_CODE));
  assert.deepEqual([claimAnswer.access.claimed, claimAnswer.dress], [true, true]);
  assert.deepEqual(await registry.dress(), { ok: true, dressed: true, plan: "part", warnings: [] });
  const profile = await registry.profile();
  assert.deepEqual([profile.ok, profile.claimed, profile.ownerMenus.default], [true, true, { ok: true, commands: FOR_OWNER }]);
});
