// The Registry: the one place that knows the bot token and who may use the bot.
//
// It is a single Durable Object. The Worker asks it about every Telegram update ("the gate")
// before a chat sees it, and the Glow page talks to it once, to hand over the token.

import { BOT_NAME, commandList, ownerCommandList, pickLang, t, tPlain } from "./strings.js";
import { createTelegram, httpTransport } from "./telegram.js";
import { INSIDE, clip, errorText, inBatches, json, safeEqual, sha256Hex, withTimeout } from "./util.js";

export const TOKEN_SHAPE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;
export const WEBHOOK_PATH = "/telegram/webhook";
export const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"];
// The 0.2.0 Worker kept its bot in the object named "main". Using the same name means the bot
// that was connected before this version is still connected after it.
export const REGISTRY_NAME = "main";
export const LEGACY_WEBHOOK_PATH = "/v1/telegram";

const STORE_KEY = "registry";
const LEGACY_KEY = "config"; // where the 0.2.0 Worker saved the bot; left in place as a backup
const LEGACY_RETRY_MS = 60 * 60 * 1000; // a webhook move Telegram refused is tried again after this long
const SEEN_LIMIT = 200;
const DRESS_KEY = "dress"; // which version last set the command menu and the profile, and how it went
const DRESS_RETRY_MS = 60 * 60 * 1000; // a dress-up that left warnings is tried again after this long
const DRESS_TRIES = 3; // and at most this often for one version
const PROFILE_FRESH_MS = 5 * 60 * 1000;
// The one version whose arrival the owner is told about ("about.whatsnew" describes this version).
export const NEWS_VERSION = "1.34.0";
const GROUP_TYPES = ["group", "supergroup", "channel"];

// Telegram's language codes for the command menu and the profile texts. "" is the default,
// shown to everyone whose app language has no entry of its own.
const PROFILE_LANGS = [
  { code: "", lang: "en" },
  { code: "id", lang: "id" },
  { code: "zh", lang: "zh-Hans" },
];

function accessOf(state) {
  return state.public ? "public" : "private";
}

// The profile text. A private bot says so, so nobody is promised a chat they cannot have.
export function botDescription(lang, isPublic) {
  const text = tPlain(lang, "bot.description");
  return isPublic ? text : `${text}\n\n${tPlain(lang, "bot.private")}`;
}

async function sha256OfBytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

// Telegram answers a menu with exactly the fields it was given.
function sameMenu(got, want) {
  if (!Array.isArray(got) || got.length !== want.length) return false;
  return want.every((entry, index) => got[index].command === entry.command && got[index].description === entry.description);
}

function blankState() {
  return {
    v: 1,
    token: "",
    bot: null, // { id, username, name }
    origin: "",
    secret: "",
    ownerId: null,
    claimCode: "",
    claimUntil: 0, // when the claim link stops working; 0 means it does not expire
    allowed: {}, // chat id -> { title, addedAt }
    public: false,
    seen: [], // the last update ids, so a repeated delivery is not handled twice
    configuredAt: 0,
    legacy: false, // true while Telegram still calls the 0.2.0 address with the 0.2.0 secret
    oldSecret: "", // the 0.2.0 secret, accepted next to the new one while the webhook moves
    legacyTriedAt: 0,
  };
}

// What the 0.2.0 Worker saved, in today's shape, or null when it saved no bot. Its owner and the
// people it let in stay; a pairing link nobody opened yet still works until its 24 hours are up.
export function adoptLegacy(old, now) {
  if (!old || typeof old !== "object" || typeof old.token !== "string" || !old.token) return null;
  if (!old.bot || !old.bot.id) return null;
  const state = blankState();
  state.token = old.token;
  state.bot = { id: old.bot.id, username: String(old.bot.username || ""), name: String(old.bot.name || "") };
  state.secret = String(old.secret || "");
  state.ownerId = Number.isFinite(old.ownerId) ? old.ownerId : null;
  const since = Number(old.connectedAt) || now;
  for (const id of Array.isArray(old.allowed) ? old.allowed : []) {
    // A private chat has the same id as its person. The owner needs no entry of their own.
    if (id !== state.ownerId) state.allowed[String(id)] = { title: "", addedAt: since };
  }
  if (state.ownerId === null && old.pairCode) {
    state.claimCode = String(old.pairCode);
    state.claimUntil = Number(old.pairUntil) || 0;
  }
  state.configuredAt = since;
  state.legacy = true;
  return state;
}

function defaultRandomHex(bytes) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

// The chat and the person an update is about, whichever kind of update it is.
export function whoAndWhere(update) {
  if (update && update.message) {
    return { kind: "message", chat: update.message.chat, from: update.message.from, message: update.message };
  }
  if (update && update.callback_query) {
    const query = update.callback_query;
    return { kind: "callback", chat: query.message ? query.message.chat : null, from: query.from, message: null };
  }
  if (update && update.my_chat_member) {
    return { kind: "member", chat: update.my_chat_member.chat, from: update.my_chat_member.from, message: null };
  }
  return { kind: "other", chat: null, from: null, message: null };
}

export class RegistryLogic {
  // version: the Worker's version. With it the menu and the profile are set again whenever a new
  // version starts; without it (older tests) they are only set when the bot is connected.
  constructor({ storage, fetch, now = () => Date.now(), pages = "", randomHex = defaultRandomHex, telegramFor, version = "" }) {
    this.version = String(version || "");
    this.dressed = null; // what DRESS_KEY holds
    this.dressing = null; // the dress-up that is running now
    this.ownerLang = "en"; // the owner's app language, learnt from their last update
    this.profileCache = null;
    this.storage = storage;
    this.fetch = fetch;
    this.now = now;
    this.pages = String(pages || "").replace(/\/+$/, "");
    this.randomHex = randomHex;
    this.telegramFor = telegramFor || ((token) => createTelegram({ transport: httpTransport({ fetch, token }) }));
    this.state = null;
    this.loading = null;
  }

  // One state object for the life of this instance: every handler changes it in place.
  load() {
    if (!this.loading) {
      this.loading = this.read().catch((error) => {
        this.loading = null;
        throw error;
      });
    }
    return this.loading;
  }

  // What was saved. When this version has saved no bot yet, the bot the 0.2.0 Worker saved is taken over.
  async read() {
    const saved = await this.storage.get(STORE_KEY);
    let state = { ...blankState(), ...(saved || {}) };
    if (!state.token) {
      const adopted = adoptLegacy(await this.storage.get(LEGACY_KEY), this.now());
      if (adopted) {
        state = adopted;
        await this.storage.put(STORE_KEY, state);
      }
    }
    this.state = state;
    if (this.version) this.dressed = (await this.storage.get(DRESS_KEY)) || null;
    return state;
  }

  async save() {
    await this.storage.put(STORE_KEY, this.state);
  }

  // Safe to show anyone: no token, no ids.
  async status() {
    const state = await this.load();
    return {
      configured: !!state.token,
      bot: state.bot ? { username: state.bot.username, name: state.bot.name } : null,
      access: accessOf(state),
      claimed: state.ownerId !== null,
      chats: Object.keys(state.allowed).length,
      ...(state.legacy ? { legacy: true } : {}),
      ...(this.dressPlan() ? { dress: true } : {}),
    };
  }

  // Take the token from BotFather, point Telegram at this Worker, and hand back the link that
  // makes the first person to open it the owner. Nothing is saved unless Telegram accepts both
  // the token and the webhook.
  //
  // Without a token the saved one is used again, which is how a new pairing link is made
  // (newPairing: the owner and everyone let in are forgotten first).
  async setup({ token, origin, newPairing = false } = {}) {
    const state = await this.load();
    const given = String(token || "").trim();
    const value = given || state.token;
    if (given ? !TOKEN_SHAPE.test(given) : !value) return { ok: false, error: "token-format" };
    const base = String(origin || "").replace(/\/+$/, "");
    if (!/^https:\/\/[^/]+$/.test(base)) return { ok: false, error: "origin" };
    const telegram = this.telegramFor(value);

    const me = await telegram.call("getMe", {});
    if (!me.ok || !me.result || !me.result.id) {
      return { ok: false, error: "token-rejected", detail: clip(me.description || "", 200) };
    }
    const bot = { id: me.result.id, username: String(me.result.username || ""), name: String(me.result.first_name || "") };

    const secret = await sha256Hex("glow-bot-webhook:" + value);
    const hook = await telegram.call("setWebhook", {
      url: base + WEBHOOK_PATH,
      secret_token: secret,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: true,
    });
    if (!hook.ok) return { ok: false, error: "webhook-failed", detail: clip(hook.description || "", 200) };

    // The same bot again keeps its owner and its chats. A different bot starts clean.
    if (!state.bot || state.bot.id !== bot.id) {
      state.ownerId = null;
      state.allowed = {};
      state.public = false;
      state.claimCode = "";
      state.claimUntil = 0;
    }
    if (newPairing) {
      state.ownerId = null;
      state.allowed = {};
      state.claimCode = "";
      state.claimUntil = 0;
    }
    // A different bot, or a new pairing, has no owner menu of its own yet.
    if (!state.bot || state.bot.id !== bot.id) this.dressed = null;
    const now = this.now();
    const expired = !!state.claimUntil && now > state.claimUntil;
    if (state.ownerId === null && (!state.claimCode || expired)) {
      state.claimCode = this.randomHex(16);
      state.claimUntil = 0;
    }
    state.token = value;
    state.bot = bot;
    state.origin = base;
    state.secret = secret;
    state.seen = [];
    state.configuredAt = now;
    // Telegram now calls today's address with today's secret: nothing of 0.2.0 is left to move.
    state.legacy = false;
    state.oldSecret = "";
    state.legacyTriedAt = 0;
    await this.save();

    const warnings = await this.dressUp(telegram);
    const named = await this.setName(telegram, bot.name);
    if (named) warnings.push(named);
    await this.noteDressed(warnings);
    return {
      ok: true,
      bot: { username: bot.username, name: bot.name },
      link: `https://t.me/${bot.username}` + (state.ownerId === null ? `?start=${state.claimCode}` : ""),
      claimed: state.ownerId !== null,
      warnings,
      ...(state.ownerId === null && state.claimUntil ? { claimUntil: state.claimUntil } : {}),
    };
  }

  // A bot taken over from the 0.2.0 Worker: Telegram still calls the 0.2.0 address, with the
  // 0.2.0 secret, and never sends "the bot was added to a group". This moves the webhook to
  // today's address without anyone pasting the token again. Updates Telegram is still holding
  // are kept. Until Telegram confirms, both secrets are accepted, and they stay accepted when the
  // call fails: a call that timed out may still have been applied.
  async refreshWebhook({ origin } = {}) {
    const state = await this.load();
    if (!state.legacy || !state.token) return { ok: true, refreshed: false };
    const base = String(origin || state.origin || "").replace(/\/+$/, "");
    if (!/^https:\/\/[^/]+$/.test(base)) return { ok: false, error: "origin" };
    const now = this.now();
    if (state.legacyTriedAt && now - state.legacyTriedAt < LEGACY_RETRY_MS) return { ok: true, refreshed: false, waiting: true };
    state.legacyTriedAt = now; // set before the first wait, so two calls arriving together move it once

    const secret = await sha256Hex("glow-bot-webhook:" + state.token);
    if (state.secret !== secret) {
      state.oldSecret = state.secret;
      state.secret = secret;
    }
    state.origin = base;
    await this.save();

    const telegram = this.telegramFor(state.token);
    const hook = await telegram.call("setWebhook", {
      url: base + WEBHOOK_PATH,
      secret_token: secret,
      allowed_updates: ALLOWED_UPDATES,
    });
    if (!hook.ok) return { ok: false, error: "webhook-failed", detail: clip(hook.description || "", 200) };

    state.legacy = false;
    state.oldSecret = "";
    state.legacyTriedAt = 0;
    await this.save();
    const warnings = await this.dressUp(telegram);
    await this.noteDressed(warnings);
    return { ok: true, refreshed: true, warnings };
  }

  // The command menu, the profile texts and the profile photo. The bot works without them,
  // so a failure here becomes a warning and never an error.
  async dressUp(telegram, { photo = true } = {}) {
    const tasks = this.profileTasks(telegram, ["commands", "description", "short"]);
    if (photo) tasks.push(() => this.setPhoto(telegram));
    const results = await inBatches(tasks, 3);
    return results.filter(Boolean);
  }

  // One call per language for each kind of profile text. Every task answers null or a warning.
  profileTasks(telegram, kinds) {
    const isPublic = this.state.public;
    const tasks = [];
    const add = (label, method, payload) => {
      tasks.push(async () => {
        const answer = await telegram.call(method, payload);
        return answer.ok ? null : `${label}: ${clip(answer.description || "failed", 120)}`;
      });
    };
    for (const { code, lang } of PROFILE_LANGS) {
      const language = code ? { language_code: code } : {};
      const suffix = code ? ` (${code})` : "";
      if (kinds.includes("commands")) add(`commands${suffix}`, "setMyCommands", { commands: commandList(lang), ...language });
      if (kinds.includes("description")) {
        add(`description${suffix}`, "setMyDescription", { description: botDescription(lang, isPublic), ...language });
      }
      if (kinds.includes("short")) {
        add(`short description${suffix}`, "setMyShortDescription", { short_description: tPlain(lang, "bot.short"), ...language });
      }
    }
    return tasks;
  }

  // The owner's own chat gets a longer menu: everyone's commands and the owner's.
  async ownerMenus(telegram) {
    const ownerId = this.state.ownerId;
    if (ownerId === null) return [];
    const tasks = [];
    for (const { code, lang } of PROFILE_LANGS) {
      const language = code ? { language_code: code } : {};
      const suffix = code ? ` (${code})` : "";
      tasks.push(async () => {
        const payload = { commands: ownerCommandList(lang), scope: { type: "chat", chat_id: ownerId }, ...language };
        const answer = await telegram.call("setMyCommands", payload);
        return answer.ok ? null : `owner commands${suffix}: ${clip(answer.description || "failed", 120)}`;
      });
    }
    const results = await inBatches(tasks, 3);
    return results.filter(Boolean);
  }

  async fetchPhoto() {
    const response = await withTimeout((signal) => this.fetch(`${this.pages}/bot/logo.jpg`, { signal }), 15000, "the bot picture");
    if (!response.ok) return { warning: `photo: HTTP ${response.status}` };
    return { bytes: await response.arrayBuffer() };
  }

  async uploadPhoto(telegram, bytes) {
    const form = new FormData();
    form.append("photo", JSON.stringify({ type: "static", photo: "attach://file" }));
    form.append("file", new Blob([bytes], { type: "image/jpeg" }), "logo.jpg");
    const answer = await telegram.call("setMyProfilePhoto", form);
    return answer.ok ? null : `photo: ${clip(answer.description || "failed", 120)}`;
  }

  async setPhoto(telegram) {
    if (!this.pages) return null;
    try {
      const picture = await this.fetchPhoto();
      if (picture.warning) return picture.warning;
      return await this.uploadPhoto(telegram, picture.bytes);
    } catch (error) {
      return `photo: ${clip(errorText(error), 120)}`;
    }
  }

  // The same picture is not uploaded again with every version: only when the bot shows none,
  // or when the picture on the Glow page changed. record.photo remembers which picture it is.
  async freshPhoto(telegram, record) {
    if (!this.pages) return null;
    try {
      const picture = await this.fetchPhoto();
      if (picture.warning) return picture.warning;
      const hash = await sha256OfBytes(picture.bytes);
      const shown = await telegram.call("getUserProfilePhotos", { user_id: this.state.bot.id, limit: 1 });
      const hasOne = !!shown.ok && !!shown.result && shown.result.total_count > 0;
      // A bot dressed before 1.33.0 shows a picture but has no record of it: that picture is
      // taken to be this one, so the same picture is not added to its gallery a second time.
      if (hasOne && (!record.photo || record.photo === hash)) {
        record.photo = hash;
        return null;
      }
      const warning = await this.uploadPhoto(telegram, picture.bytes);
      if (!warning) record.photo = hash;
      return warning;
    } catch (error) {
      return `photo: ${clip(errorText(error), 120)}`;
    }
  }

  // BotFather often leaves the name as "glowbot". Only a spelling of GlowBot is corrected: a name
  // the owner chose themselves stays.
  async setName(telegram, current) {
    const name = String(current || "").trim();
    if (name === BOT_NAME || !/^glow\s*bot$/i.test(name)) return null;
    const answer = await telegram.call("setMyName", { name: BOT_NAME });
    if (!answer.ok) return `name: ${clip(answer.description || "failed", 120)}`;
    this.state.bot.name = BOT_NAME;
    await this.save();
    return null;
  }

  async putDress(record) {
    this.dressed = record;
    this.profileCache = null;
    await this.storage.put(DRESS_KEY, record);
  }

  // setup() and refreshWebhook() have just set the menu and the profile for this version. The
  // owner's own menu is left to the next dress-up, which the next update starts.
  async noteDressed(warnings) {
    if (!this.version) return;
    const before = this.dressed || {};
    const sameVersion = before.version === this.version;
    await this.putDress({
      version: this.version,
      owner: sameVersion && before.owner !== undefined ? before.owner : null,
      access: accessOf(this.state),
      at: this.now(),
      warnings: warnings.slice(),
      tries: 1,
      photo: before.photo || "",
      news: before.news || null,
    });
  }

  // What is due: "full" (a new version, or an earlier try left warnings), "part" (only the owner
  // or the access changed), or null.
  dressPlan() {
    const state = this.state;
    if (!this.version || !state || !state.token || !state.bot || state.legacy) return null;
    const done = this.dressed;
    if (!done || done.version !== this.version) return "full";
    const unfinished = Array.isArray(done.warnings) && done.warnings.length > 0;
    if (unfinished && (done.tries || 0) < DRESS_TRIES && this.now() - (done.at || 0) >= DRESS_RETRY_MS) return "full";
    if (done.owner !== state.ownerId || done.access !== accessOf(state)) return "part";
    return null;
  }

  // Set the menu and the profile again when dressPlan() says so. Never throws: the bot works
  // without them. Two calls arriving together share one run.
  async dress() {
    await this.load();
    if (!this.dressing) {
      if (!this.dressPlan()) return { ok: true, dressed: false };
      this.dressing = this.dressNow()
        .catch((error) => ({ ok: false, dressed: false, error: clip(errorText(error), 200) }))
        .finally(() => {
          this.dressing = null;
        });
    }
    return this.dressing;
  }

  async dressNow() {
    const state = this.state;
    const plan = this.dressPlan();
    const before = this.dressed || {};
    const sameVersion = before.version === this.version;
    const earlier = sameVersion && Array.isArray(before.warnings) ? before.warnings : [];
    const record = {
      version: this.version,
      owner: state.ownerId,
      access: accessOf(state),
      at: this.now(),
      warnings: ["unfinished"],
      tries: plan === "full" ? (sameVersion ? (before.tries || 0) + 1 : 1) : before.tries || 1,
      photo: before.photo || "",
      news: before.news || null,
    };
    // Saved before the first call: a run that is cut off counts as a try and is not repeated at once.
    await this.putDress({ ...record });

    const telegram = this.telegramFor(state.token);
    const warnings = [];
    if (plan === "full") {
      warnings.push(...(await this.dressUp(telegram, { photo: false })));
      warnings.push(...(await this.ownerMenus(telegram)));
      warnings.push(await this.freshPhoto(telegram, record));
      const mine = await telegram.call("getMyName", {});
      if (mine.ok && mine.result) warnings.push(await this.setName(telegram, mine.result.name));
      await this.tellOwner(telegram, record);
    } else {
      warnings.push(...earlier);
      if (before.owner !== state.ownerId) warnings.push(...(await this.ownerMenus(telegram)));
      if (before.access !== accessOf(state)) {
        warnings.push(...(await inBatches(this.profileTasks(telegram, ["description"]), 3)));
      }
    }
    record.warnings = warnings.filter(Boolean);
    record.at = this.now();
    await this.putDress(record);
    return { ok: true, dressed: true, plan, warnings: record.warnings };
  }

  // One message to the owner when NEWS_VERSION arrives, so they know the new menu is there.
  // Sent once: a failure is recorded and not repeated.
  async tellOwner(telegram, record) {
    const ownerId = this.state.ownerId;
    if (this.version !== NEWS_VERSION || ownerId === null) return;
    if (record.news && record.news.version === this.version) return;
    const text = t(this.ownerLang, "about.whatsnew", { version: this.version });
    const answer = await telegram.call("sendMessage", { chat_id: ownerId, text, parse_mode: "HTML" });
    record.news = {
      version: this.version,
      at: this.now(),
      ok: !!answer.ok,
      ...(answer.ok ? {} : { detail: clip(answer.description || "failed", 120) }),
    };
  }

  // What Telegram really shows for this bot, read back and compared with what it should show.
  // Safe to show anyone: no token and no ids.
  async profile() {
    const state = await this.load();
    if (!state.token || !state.bot) return { ok: false, configured: false };
    if (this.profileCache && this.now() - this.profileCache.at < PROFILE_FRESH_MS) return this.profileCache.value;

    const telegram = this.telegramFor(state.token);
    const ask = async (method, payload = {}) => {
      const answer = await telegram.call(method, payload);
      return answer.ok ? answer.result : null;
    };
    const text = (got, field, want) => {
      const value = got && typeof got[field] === "string" ? got[field] : "";
      return value === want ? { ok: true, length: value.length } : { ok: false, length: value.length, got: clip(value, 80) };
    };
    const report = { name: null, menus: {}, ownerMenus: {}, descriptions: {}, shorts: {}, photo: null, webhook: null };
    const tasks = [];
    tasks.push(async () => {
      const got = await ask("getMyName");
      const value = got && typeof got.name === "string" ? got.name : "";
      report.name = { ok: value.length > 0, value };
    });
    for (const { code, lang } of PROFILE_LANGS) {
      const key = code || "default";
      const language = code ? { language_code: code } : {};
      tasks.push(async () => {
        const got = await ask("getMyCommands", language);
        report.menus[key] = { ok: sameMenu(got, commandList(lang)), commands: Array.isArray(got) ? got.length : 0 };
      });
      if (state.ownerId !== null) {
        tasks.push(async () => {
          const got = await ask("getMyCommands", { scope: { type: "chat", chat_id: state.ownerId }, ...language });
          report.ownerMenus[key] = { ok: sameMenu(got, ownerCommandList(lang)), commands: Array.isArray(got) ? got.length : 0 };
        });
      }
      tasks.push(async () => {
        report.descriptions[key] = text(await ask("getMyDescription", language), "description", botDescription(lang, state.public));
      });
      tasks.push(async () => {
        report.shorts[key] = text(await ask("getMyShortDescription", language), "short_description", tPlain(lang, "bot.short"));
      });
    }
    tasks.push(async () => {
      const got = await ask("getUserProfilePhotos", { user_id: state.bot.id, limit: 1 });
      const count = got && Number.isFinite(got.total_count) ? got.total_count : 0;
      report.photo = { ok: count > 0, count };
    });
    tasks.push(async () => {
      const got = (await ask("getWebhookInfo")) || {};
      const updates = Array.isArray(got.allowed_updates) ? got.allowed_updates.slice().sort() : [];
      const here = !!state.origin && got.url === state.origin + WEBHOOK_PATH;
      const listens = JSON.stringify(updates) === JSON.stringify(ALLOWED_UPDATES.slice().sort());
      report.webhook = {
        ok: here && listens,
        here,
        listens,
        pending: Number(got.pending_update_count) || 0,
        lastError: clip(String(got.last_error_message || ""), 120),
        lastErrorAt: Number(got.last_error_date) || 0,
      };
    });
    await inBatches(tasks, 4);

    const done = this.dressed;
    const dress = done
      ? { version: done.version, current: done.version === this.version, at: done.at, tries: done.tries, warnings: done.warnings || [] }
      : null;
    const parts = [report.name, report.photo, report.webhook];
    for (const group of [report.menus, report.ownerMenus, report.descriptions, report.shorts]) parts.push(...Object.values(group));
    const dressedWell = !this.version || (!!dress && dress.current && dress.warnings.length === 0);
    const value = {
      ok: parts.every((part) => part && part.ok) && dressedWell,
      configured: true,
      version: this.version,
      access: accessOf(state),
      claimed: state.ownerId !== null,
      ...report,
      dress,
      news: done && done.news ? done.news : null,
      checkedAt: this.now(),
    };
    this.profileCache = { at: this.now(), value };
    return value;
  }

  // Every Telegram update passes here first. The answer says which chat it belongs to, hands
  // over what that chat needs to reply, and says who is asking: owner, member or stranger.
  async gate({ secret, update, origin } = {}) {
    const state = await this.load();
    if (!state.token) return { ok: false, reason: "not-configured" };
    const given = String(secret || "");
    const current = !!state.secret && safeEqual(given, state.secret);
    const previous = !!state.oldSecret && safeEqual(given, state.oldSecret);
    if (!given || !(current || previous)) return { ok: false, reason: "bad-secret" };
    // A bot taken over from 0.2.0 never saved where this Worker lives; the first update tells it.
    if (!state.origin && /^https:\/\/[^/]+$/.test(String(origin || ""))) state.origin = String(origin);

    const updateId = update ? update.update_id : null;
    if (Number.isFinite(updateId)) {
      if (state.seen.includes(updateId)) return { ok: true, duplicate: true };
      state.seen.push(updateId);
      if (state.seen.length > SEEN_LIMIT) state.seen.splice(0, state.seen.length - SEEN_LIMIT);
    }

    const { kind, chat, from, message } = whoAndWhere(update);
    if (!chat || chat.id === undefined || chat.id === null) {
      await this.save();
      return { ok: true, ignore: true };
    }
    const chatId = chat.id;
    const key = String(chatId);

    // A group that grows into a supergroup gets a new id: its place on the list moves with it.
    if (message && message.migrate_to_chat_id) {
      if (state.allowed[key]) {
        state.allowed[String(message.migrate_to_chat_id)] = state.allowed[key];
        delete state.allowed[key];
      }
      await this.save();
      return { ok: true, ignore: true };
    }

    // The first person to open the claim link becomes the owner. The link works once.
    let claimed = false;
    const claimOpen = !!state.claimCode && (!state.claimUntil || this.now() <= state.claimUntil);
    if (kind === "message" && chat.type === "private" && from && state.ownerId === null && claimOpen) {
      const start = /^\/start(?:@\w+)?\s+(\S+)/.exec(String(message.text || ""));
      if (start && safeEqual(start[1], state.claimCode)) {
        state.ownerId = from.id;
        state.claimCode = "";
        state.claimUntil = 0;
        claimed = true;
      }
    }

    const isOwner = state.ownerId !== null && !!from && from.id === state.ownerId;
    if (isOwner && from.language_code) this.ownerLang = pickLang(from.language_code);
    const membership = kind === "member" ? String((update.my_chat_member.new_chat_member || {}).status || "") : "";
    const gone = membership === "left" || membership === "kicked";
    if (gone) {
      delete state.allowed[key];
    } else if (isOwner && GROUP_TYPES.includes(chat.type) && !state.allowed[key]) {
      // The owner lets a group in by adding the bot to it, or by sending a command there.
      const sentCommand = kind === "message" && /^\//.test(String(message.text || ""));
      const addedBot = membership === "member" || membership === "administrator";
      if (sentCommand || addedBot) state.allowed[key] = { title: clip(chat.title || "", 80), addedAt: this.now() };
    }

    const role = isOwner ? "owner" : state.allowed[key] || state.public ? "member" : "stranger";
    await this.save();
    return {
      ok: true,
      duplicate: false,
      chatId,
      config: {
        token: state.token,
        botUsername: state.bot.username,
        botId: state.bot.id,
        origin: state.origin,
        public: state.public,
      },
      access: { role, allowed: role !== "stranger", claimed, ownerKnown: state.ownerId !== null, gone },
      ...(state.legacy ? { legacy: true } : {}),
      ...(this.dressPlan() ? { dress: true } : {}),
    };
  }

  async setPublic(flag) {
    const state = await this.load();
    state.public = !!flag;
    await this.save();
    return { ok: true, access: accessOf(state) };
  }

  async forget(chatId) {
    const state = await this.load();
    delete state.allowed[String(chatId)];
    await this.save();
    return { ok: true };
  }

  // The owner lets one person (their private chat) or one group in by its Telegram id.
  async allow(chatId) {
    const state = await this.load();
    const key = String(chatId === undefined || chatId === null ? "" : chatId).trim();
    if (!/^-?\d{1,20}$/.test(key)) return { ok: false, error: "id" };
    if (!state.allowed[key]) state.allowed[key] = { title: "", addedAt: this.now() };
    await this.save();
    return { ok: true, chats: Object.keys(state.allowed).length };
  }

  // For the owner only: the ids let in. Never part of the public status.
  async users() {
    const state = await this.load();
    return {
      ok: true,
      ownerId: state.ownerId,
      access: accessOf(state),
      chats: Object.entries(state.allowed).map(([id, entry]) => ({ id, title: String((entry && entry.title) || "") })),
    };
  }

  // Disconnect the bot: tell Telegram to stop calling, then forget the token and everything else.
  async reset() {
    const state = await this.load();
    let webhook = "none";
    if (state.token) {
      const answer = await this.telegramFor(state.token).call("deleteWebhook", { drop_pending_updates: true });
      webhook = answer.ok ? "deleted" : "failed";
    }
    Object.assign(state, blankState());
    this.dressed = null;
    this.profileCache = null;
    // The 0.2.0 copy goes too: otherwise the next start would take the forgotten bot over again.
    await this.storage.delete([STORE_KEY, LEGACY_KEY, DRESS_KEY]);
    return { ok: true, webhook };
  }
}

// The Durable Object's front door: one small JSON route per method above.
export async function handleRegistry(logic, request) {
  const path = new URL(request.url).pathname;
  let body = {};
  if (request.method === "POST") {
    try {
      body = (await request.json()) || {};
    } catch (error) {
      body = {};
    }
  }
  if (path === "/gate") return json(await logic.gate(body));
  if (path === "/setup") return json(await logic.setup(body));
  if (path === "/status") return json(await logic.status());
  if (path === "/public") return json(await logic.setPublic(body.public));
  if (path === "/forget") return json(await logic.forget(body.chatId));
  if (path === "/allow") return json(await logic.allow(body.chatId));
  if (path === "/users") return json(await logic.users());
  if (path === "/refresh") return json(await logic.refreshWebhook(body));
  if (path === "/reset") return json(await logic.reset());
  if (path === "/dress") return json(await logic.dress());
  if (path === "/profile") return json(await logic.profile());
  return json({ ok: false, error: "not found" }, 404);
}

// How the Worker and the chats reach the Registry through its binding.
export function registryClient(namespace) {
  async function ask(path, body) {
    const stub = namespace.get(namespace.idFromName(REGISTRY_NAME));
    const response = await stub.fetch(INSIDE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return response.json();
  }
  return {
    gate: (secret, update, origin) => ask("/gate", { secret, update, origin }),
    setup: (token, origin, options = {}) => ask("/setup", { token, origin, newPairing: !!options.newPairing }),
    status: () => ask("/status"),
    setPublic: (flag) => ask("/public", { public: !!flag }),
    forget: (chatId) => ask("/forget", { chatId }),
    allow: (chatId) => ask("/allow", { chatId }),
    users: () => ask("/users"),
    refreshWebhook: (origin) => ask("/refresh", { origin }),
    reset: () => ask("/reset"),
    dress: () => ask("/dress"),
    profile: () => ask("/profile"),
  };
}
