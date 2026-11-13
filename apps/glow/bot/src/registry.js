// The Registry: the one place that knows the bot token and who may use the bot.
//
// It is a single Durable Object. The Worker asks it about every Telegram update ("the gate")
// before a chat sees it, and the Glow page talks to it once, to hand over the token.

import { commandList, tPlain } from "./strings.js";
import { createTelegram, httpTransport } from "./telegram.js";
import { INSIDE, clip, errorText, inBatches, json, safeEqual, sha256Hex, withTimeout } from "./util.js";

export const TOKEN_SHAPE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;
export const WEBHOOK_PATH = "/telegram/webhook";
export const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"];
// GlowBot 0.2.0 kept its settings in the instance named "main". The name stays, so a bot that
// was connected then is still connected now.
export const REGISTRY_NAME = "main";
export const CLAIM_GOOD_FOR_MS = 24 * 60 * 60 * 1000; // how long a new owner link works

const STORE_KEY = "registry";
const LEGACY_KEY = "config"; // where GlowBot 0.2.0 kept its settings, in a shape of its own
const SEEN_LIMIT = 200;
const GROUP_TYPES = ["group", "supergroup", "channel"];

// Telegram's language codes for the command menu and the profile texts. "" is the default,
// shown to everyone whose app language has no entry of its own.
const PROFILE_LANGS = [
  { code: "", lang: "en" },
  { code: "id", lang: "id" },
  { code: "zh", lang: "zh-Hans" },
];

function blankState() {
  return {
    v: 1,
    token: "",
    bot: null, // { id, username, name }
    origin: "",
    secret: "",
    ownerId: null,
    claimCode: "",
    claimUntil: 0, // the owner link stops working at this time
    allowed: {}, // chat id -> { title, addedAt }
    public: false,
    seen: [], // the last update ids, so a repeated delivery is not handled twice
    configuredAt: 0,
  };
}

function defaultRandomHex(bytes) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

// What GlowBot 0.2.0 saved, read into the shape used here, or null when it had no bot connected.
// It kept { token, bot, secret, allowed: [user ids], ownerId, connectedAt, pairCode, pairUntil }.
// A person's id is also the id of their private chat, so its list of people fits the list of chats.
export function adoptLegacy(old) {
  if (!old || typeof old !== "object" || !old.token || !old.bot || !old.bot.id) return null;
  const state = blankState();
  const connectedAt = Number(old.connectedAt) || 0;
  const isPerson = (id) => Number.isSafeInteger(id) && id > 0;
  state.token = String(old.token);
  state.bot = { id: old.bot.id, username: String(old.bot.username || ""), name: String(old.bot.name || "") };
  state.secret = String(old.secret || "");
  state.ownerId = isPerson(old.ownerId) ? old.ownerId : null;
  state.configuredAt = connectedAt;
  for (const id of Array.isArray(old.allowed) ? old.allowed : []) {
    if (isPerson(id) && id !== state.ownerId) state.allowed[String(id)] = { title: "", addedAt: connectedAt };
  }
  if (state.ownerId === null && old.pairCode) {
    state.claimCode = String(old.pairCode);
    state.claimUntil = Number(old.pairUntil) || 0;
  }
  return state;
}

// A Telegram id as the owner types it: digits, with a minus sign in front for a group.
// Only a number or a piece of text can be one; anything else is null.
function readChatId(value) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^-?\d{1,16}$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id !== 0 ? id : null;
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
  constructor({ storage, fetch, now = () => Date.now(), pages = "", randomHex = defaultRandomHex, telegramFor }) {
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

  async read() {
    const saved = await this.storage.get(STORE_KEY);
    // Nothing saved here yet: take over what GlowBot 0.2.0 saved, and save it at once so this
    // happens one time only. Its own copy stays where it is, so going back to 0.2.0 would still
    // find the bot connected.
    const adopted = saved ? null : adoptLegacy(await this.storage.get(LEGACY_KEY));
    this.state = adopted || { ...blankState(), ...(saved || {}) };
    if (adopted) await this.save();
    return this.state;
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
      access: state.public ? "public" : "private",
      claimed: state.ownerId !== null,
      chats: Object.keys(state.allowed).length,
    };
  }

  // Take the token from BotFather, point Telegram at this Worker, and hand back the link that
  // makes the first person to open it the owner. Nothing is saved unless Telegram accepts both
  // the token and the webhook. Without a token the saved one is used again, which refreshes the
  // webhook and the menu; newPairing drops the owner and everyone let in and makes access
  // private again, for a fresh start.
  async setup({ token, origin, newPairing = false } = {}) {
    const state = await this.load();
    const value = String(token || state.token || "").trim();
    if (!TOKEN_SHAPE.test(value)) return { ok: false, error: "token-format" };
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

    // The same bot again keeps its owner and its chats. A different bot, or a new pairing,
    // starts clean: no owner, nobody let in, access private.
    const sameBot = !!state.bot && state.bot.id === bot.id;
    if (!sameBot || newPairing) {
      state.ownerId = null;
      state.allowed = {};
      state.public = false;
      await this.storage.delete(LEGACY_KEY); // the old copy must not bring them back
    }
    // While nobody owns the bot, every setup makes a new owner link and the one before it stops working.
    const waiting = state.ownerId === null;
    state.claimCode = waiting ? this.randomHex(16) : "";
    state.claimUntil = waiting ? this.now() + CLAIM_GOOD_FOR_MS : 0;
    state.token = value;
    state.bot = bot;
    state.origin = base;
    state.secret = secret;
    state.seen = [];
    state.configuredAt = this.now();
    await this.save();

    const warnings = await this.dressUp(telegram);
    const chatLink = `https://t.me/${bot.username}`;
    const ownerLink = waiting ? `${chatLink}?start=${state.claimCode}` : null;
    return {
      ok: true,
      bot: { username: bot.username, name: bot.name },
      link: ownerLink || chatLink,
      claimed: !waiting,
      warnings,
      // The same facts under the names GlowBot 0.2.0 gave them, which tools/connect_telegram.py reads.
      webhook: base + WEBHOOK_PATH,
      paired: !waiting,
      pairLink: ownerLink,
      pairUntil: waiting ? state.claimUntil : null,
    };
  }

  // The command menu, the profile texts and the profile photo. The bot works without them,
  // so a failure here becomes a warning and never an error.
  async dressUp(telegram) {
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
      add(`commands${suffix}`, "setMyCommands", { commands: commandList(lang), ...language });
      add(`description${suffix}`, "setMyDescription", { description: tPlain(lang, "bot.description"), ...language });
      add(`short description${suffix}`, "setMyShortDescription", { short_description: tPlain(lang, "bot.short"), ...language });
    }
    tasks.push(() => this.setPhoto(telegram));
    const results = await inBatches(tasks, 3);
    return results.filter(Boolean);
  }

  async setPhoto(telegram) {
    if (!this.pages) return null;
    try {
      const response = await withTimeout((signal) => this.fetch(`${this.pages}/bot/logo.jpg`, { signal }), 15000, "the bot picture");
      if (!response.ok) return `photo: HTTP ${response.status}`;
      const bytes = await response.arrayBuffer();
      const form = new FormData();
      form.append("photo", JSON.stringify({ type: "static", photo: "attach://file" }));
      form.append("file", new Blob([bytes], { type: "image/jpeg" }), "logo.jpg");
      const answer = await telegram.call("setMyProfilePhoto", form);
      return answer.ok ? null : `photo: ${clip(answer.description || "failed", 120)}`;
    } catch (error) {
      return `photo: ${clip(errorText(error), 120)}`;
    }
  }

  // Every Telegram update passes here first. The answer says which chat it belongs to, hands
  // over what that chat needs to reply, and says who is asking: owner, member or stranger.
  async gate({ secret, update } = {}) {
    const state = await this.load();
    if (!state.token) return { ok: false, reason: "not-configured" };
    if (!state.secret || !safeEqual(String(secret || ""), state.secret)) return { ok: false, reason: "bad-secret" };

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

    // The first person to open the owner link becomes the owner. The link works once, and only
    // until its deadline.
    let claimed = false;
    const linkIsGood = !!state.claimCode && this.now() < state.claimUntil;
    if (kind === "message" && chat.type === "private" && from && state.ownerId === null && linkIsGood) {
      const start = /^\/start(?:@\w+)?\s+(\S+)/.exec(String(message.text || ""));
      if (start && safeEqual(start[1], state.claimCode)) {
        state.ownerId = from.id;
        state.claimCode = "";
        state.claimUntil = 0;
        claimed = true;
      }
    }

    const isOwner = state.ownerId !== null && !!from && from.id === state.ownerId;
    const membership = kind === "member" ? String((update.my_chat_member.new_chat_member || {}).status || "") : "";
    const gone = membership === "left" || membership === "kicked";
    if (gone) {
      // A group the bot was removed from loses its place. A person who blocks the bot keeps
      // theirs: the owner let them in, and only the owner takes that away.
      if (GROUP_TYPES.includes(chat.type)) delete state.allowed[key];
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
    };
  }

  async setPublic(flag) {
    const state = await this.load();
    state.public = !!flag;
    await this.save();
    return { ok: true, access: state.public ? "public" : "private" };
  }

  async forget(chatId) {
    const state = await this.load();
    delete state.allowed[String(chatId)];
    await this.save();
    return { ok: true };
  }

  // The owner lets a chat in by its Telegram id, or takes that away again. A person's id opens
  // their private chat with the bot; a group has an id of its own, a negative number.
  async allow(id) {
    return this.changeAccess(id, true);
  }

  async deny(id) {
    return this.changeAccess(id, false);
  }

  async changeAccess(id, letIn) {
    const state = await this.load();
    const chatId = readChatId(id);
    if (chatId === null) return { ok: false, error: "bad-id" };
    if (state.ownerId === null) return { ok: false, error: "no-owner" };
    if (chatId === state.ownerId) return { ok: false, error: "owner" }; // always in, never removed
    const key = String(chatId);
    if (letIn) {
      if (!state.allowed[key]) state.allowed[key] = { title: "", addedAt: this.now() };
    } else {
      delete state.allowed[key];
      await this.storage.delete(LEGACY_KEY); // the old copy must not bring them back
    }
    await this.save();
    return { ok: true, id: chatId };
  }

  // For the owner's eyes only: the ids are not secret, but they are nobody else's business.
  async users() {
    const state = await this.load();
    const users = Object.keys(state.allowed).map((key) => ({ id: Number(key), title: String(state.allowed[key].title || "") }));
    return { ok: true, owner: state.ownerId, users };
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
    await this.storage.delete(STORE_KEY);
    await this.storage.delete(LEGACY_KEY);
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
  if (path === "/allow") return json(await logic.allow(body.id));
  if (path === "/deny") return json(await logic.deny(body.id));
  if (path === "/users") return json(await logic.users());
  if (path === "/reset") return json(await logic.reset());
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
    gate: (secret, update) => ask("/gate", { secret, update }),
    setup: (token, origin, newPairing) => ask("/setup", { token, origin, newPairing: !!newPairing }),
    status: () => ask("/status"),
    setPublic: (flag) => ask("/public", { public: !!flag }),
    forget: (chatId) => ask("/forget", { chatId }),
    allow: (id) => ask("/allow", { id }),
    deny: (id) => ask("/deny", { id }),
    users: () => ask("/users"),
    reset: () => ask("/reset"),
  };
}
