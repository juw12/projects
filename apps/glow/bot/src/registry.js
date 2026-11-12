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
export const REGISTRY_NAME = "registry";

const STORE_KEY = "registry";
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
      this.loading = Promise.resolve(this.storage.get(STORE_KEY)).then(
        (saved) => {
          this.state = { ...blankState(), ...(saved || {}) };
          return this.state;
        },
        (error) => {
          this.loading = null;
          throw error;
        },
      );
    }
    return this.loading;
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
  // the token and the webhook.
  async setup({ token, origin } = {}) {
    const state = await this.load();
    const value = String(token || "").trim();
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

    // The same bot again keeps its owner and its chats. A different bot starts clean.
    if (!state.bot || state.bot.id !== bot.id) {
      state.ownerId = null;
      state.allowed = {};
      state.public = false;
      state.claimCode = "";
    }
    if (state.ownerId === null && !state.claimCode) state.claimCode = this.randomHex(16);
    state.token = value;
    state.bot = bot;
    state.origin = base;
    state.secret = secret;
    state.seen = [];
    state.configuredAt = this.now();
    await this.save();

    const warnings = await this.dressUp(telegram);
    return {
      ok: true,
      bot: { username: bot.username, name: bot.name },
      link: `https://t.me/${bot.username}` + (state.ownerId === null ? `?start=${state.claimCode}` : ""),
      claimed: state.ownerId !== null,
      warnings,
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
    if (!safeEqual(String(secret || ""), state.secret)) return { ok: false, reason: "bad-secret" };

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
    if (kind === "message" && chat.type === "private" && from && state.ownerId === null && state.claimCode) {
      const start = /^\/start(?:@\w+)?\s+(\S+)/.exec(String(message.text || ""));
      if (start && safeEqual(start[1], state.claimCode)) {
        state.ownerId = from.id;
        state.claimCode = "";
        claimed = true;
      }
    }

    const isOwner = state.ownerId !== null && !!from && from.id === state.ownerId;
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
    setup: (token, origin) => ask("/setup", { token, origin }),
    status: () => ask("/status"),
    setPublic: (flag) => ask("/public", { public: !!flag }),
    forget: (chatId) => ask("/forget", { chatId }),
    reset: () => ask("/reset"),
  };
}
