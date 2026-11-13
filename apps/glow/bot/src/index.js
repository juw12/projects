// GlowBot: Glow's agents inside Telegram, running on a free Cloudflare Worker.
//
//   GET  /v1/status    alive, which build, whether a Telegram bot is connected
//   GET  /v1/probe     the health check (models, web, GlowNews, GlowSpark), run inside a Durable Object alarm
//   POST /v1/setup     owner only (setup code): connect a Telegram bot token, set the webhook, make a pairing link
//   POST /v1/telegram  Telegram's webhook (checked with the secret Telegram sends back)
//
// One ChatAgent Durable Object per Telegram chat keeps that chat's memory and its GlowLead mission.
// A message is queued and answered from the object, so Telegram always gets its "OK" at once and a
// mission can take minutes: each mission step runs in its own alarm.

import { COMMANDS, advanceMission, handleUpdate, stopMission } from "./bot.js";
import { createModels } from "./models.js";
import { runProbe } from "./probe.js";
import { createSpark } from "./spark.js";
import { createTelegram } from "./telegram.js";
import { VERSION, clip, corsHeaders, errorText, json, safeEqual, sha256Hex } from "./util.js";
import { createWeb } from "./web.js";

const PROBE_GOOD_FOR_MS = 6 * 60 * 60 * 1000;
const PROBE_GIVE_UP_MS = 10 * 60 * 1000;
const PAIRING_GOOD_FOR_MS = 24 * 60 * 60 * 1000;
const INSIDE = "https://glow-bot.internal"; // addresses used between the Worker and its Durable Objects
const QUEUE = "q:";

function buildOf(env) {
  return String((env && env.BUILD) || "dev");
}

function pagesOf(env) {
  return String((env && env.GLOW_PAGES) || "https://juw12.github.io/projects/glow").replace(/\/+$/, "");
}

// The setup code is a long random secret only the owner has. The Worker only knows its SHA-256.
async function hasSetupCode(request, env) {
  const given = request.headers.get("X-Glow-Setup-Code") || "";
  const expected = String((env && env.SETUP_CODE_SHA256) || "");
  if (!given || !expected) return false;
  return safeEqual(await sha256Hex(given), expected);
}

function randomHex(bytes) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function post(path, body) {
  return new Request(INSIDE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

async function ask(stub, path, body) {
  const response = await stub.fetch(post(path, body));
  return response.json();
}

function registryOf(env) {
  return env.REGISTRY.get(env.REGISTRY.idFromName("main"));
}

// Who sent an update, and in which chat.
function senderOf(update) {
  if (update.message) return { from: update.message.from, chat: update.message.chat, text: update.message.text || "" };
  if (update.callback_query) {
    const query = update.callback_query;
    return { from: query.from, chat: query.message && query.message.chat, text: "", callback: query };
  }
  return { from: null, chat: null, text: "" };
}

// A stop request is handled the moment it arrives, even while the chat's queue is busy.
function isStop(update) {
  if (update.callback_query) return /^(stop|cancel):/.test(String(update.callback_query.data || ""));
  const text = (update.message && update.message.text) || "";
  return /^\/stop(?:@\w+)?\s*$/i.test(text.trim());
}

// Everything is built by one function so the tests can hand in a pretend network and a pretend clock.
export function createWorker(overrides) {
  const deps = {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    probe: runProbe,
    ...overrides,
  };

  // One per Telegram chat ("tg:<chat id>"), plus "sys:probe" for the health check.
  class ChatAgent {
    constructor(state, env) {
      this.storage = state.storage;
      this.env = env;
      this.draining = null;
      this.missionRunning = false;
      this.chatController = null; // aborts the answer being written
      this.missionController = null; // aborts the mission step being run
      this.spark = null;
    }

    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/probe") return this.probe(url.searchParams.get("fresh") === "1");
      if (url.pathname === "/update" && request.method === "POST") return this.receive(await request.json());
      return json({ ok: false, error: "not found" }, 404);
    }

    // ---------------------------------------------------------------- health check

    // Always answers { running, result }: `result` is the newest finished check (it may be an old one).
    async probe(fresh) {
      const stored = await this.storage.get(["probe:run", "probe:result"]);
      const run = stored.get("probe:run");
      const result = stored.get("probe:result") || null;
      const now = deps.now();
      // A check in progress comes first, so nobody is handed the previous result as if it were new.
      if (run && now - run.requestedAt < PROBE_GIVE_UP_MS) return json({ running: true, result });
      const current = !!result && result.build === buildOf(this.env) && now - result.at < PROBE_GOOD_FOR_MS;
      if (current && !fresh) return json({ running: false, result });
      await this.storage.put("probe:run", { requestedAt: now });
      await this.storage.setAlarm(now);
      return json({ running: true, result });
    }

    async runProbeIfAsked() {
      const run = await this.storage.get("probe:run");
      if (!run) return;
      const started = deps.now();
      let result;
      try {
        result = await deps.probe({
          fetch: deps.fetch,
          ai: this.env.AI,
          now: deps.now,
          glowPages: this.env.GLOW_PAGES,
        });
      } catch (error) {
        result = { at: started, ms: deps.now() - started, error: clip(errorText(error), 300) };
      }
      result.alarm = { delayMs: Math.max(0, started - run.requestedAt) };
      result.version = VERSION;
      result.build = buildOf(this.env);
      await this.storage.put("probe:result", result);
      await this.storage.delete("probe:run");
    }

    // ---------------------------------------------------------------- Telegram

    // An update from the Worker: { update, token, bot, isOwner, paired }.
    async receive(body) {
      const update = body.update || {};
      const id = Number(update.update_id);
      if (!Number.isSafeInteger(id)) return json({ ok: false, error: "no update id" }, 400);
      await this.storage.put("tg:config", { token: body.token, bot: body.bot || null });
      const last = (await this.storage.get("tg:last")) || 0;
      const key = QUEUE + String(id).padStart(16, "0");
      if (id <= last || (await this.storage.get(key))) return json({ ok: true, duplicate: true });
      if (isStop(update)) {
        await this.storage.put("tg:last", Math.max(last, id));
        await this.stopNow(update, body);
        return json({ ok: true, stopped: true });
      }
      await this.storage.put(key, { update, isOwner: !!body.isOwner, paired: !!body.paired });
      await this.schedule(deps.now()); // the backup, in case this object is put away before it finishes
      this.drain().catch((error) => console.log("queue failed: " + errorText(error)));
      return json({ ok: true, queued: true });
    }

    async schedule(at) {
      const current = await this.storage.getAlarm();
      if (current === null || current === undefined || current > at) await this.storage.setAlarm(at);
    }

    async context(entry, controller) {
      const config = (await this.storage.get("tg:config")) || {};
      const chatId = await this.storage.get("tg:chat");
      const state = (await this.storage.get("models:state")) || {};
      const models = createModels({ fetch: deps.fetch, ai: this.env.AI, now: deps.now, state });
      const storage = this.storage;
      if (!this.spark) this.spark = createSpark({ fetch: deps.fetch, now: deps.now, base: pagesOf(this.env) + "/spark" });
      const env = this.env;
      return {
        chatId,
        storage,
        now: deps.now,
        telegram: createTelegram({ fetch: deps.fetch, token: config.token }),
        botUsername: config.bot && config.bot.username,
        web: createWeb({ fetch: deps.fetch, glowPages: pagesOf(env) }),
        spark: this.spark,
        describeModels: () => models.describe(),
        // Every answer remembers which model answered and which ones are resting, for the next one.
        complete: async (request) => {
          try {
            return await models.complete(request);
          } finally {
            await storage.put("models:state", models.state);
          }
        },
        schedule: (at) => this.schedule(at),
        registry: (path, body) => ask(registryOf(env), path, body),
        isOwner: !!(entry && entry.isOwner),
        paired: !!(entry && entry.paired),
        signal: controller ? controller.signal : undefined,
      };
    }

    async stopNow(update, body) {
      const { chat } = senderOf(update);
      if (chat) await this.storage.put("tg:chat", chat.id);
      for (const controller of [this.chatController, this.missionController]) {
        if (controller) controller.abort();
      }
      const ctx = await this.context({ isOwner: body.isOwner });
      const stopped = await stopMission(ctx);
      if (update.callback_query) {
        await ctx.telegram.answerCallback(update.callback_query.id, stopped ? "Stopped." : "Nothing is running.");
      } else {
        await ctx.telegram.sendMarkdown(ctx.chatId, stopped ? "⏹ Mission stopped." : "No mission is running.");
      }
    }

    // Answer every queued update, oldest first. Only one drain runs at a time.
    drain() {
      if (!this.draining) {
        this.draining = (async () => {
          try {
            for (;;) {
              const queued = await this.storage.list({ prefix: QUEUE, limit: 20 });
              if (!queued.size) return;
              for (const [key, entry] of queued) await this.answer(key, entry);
            }
          } finally {
            this.draining = null;
          }
        })();
      }
      return this.draining;
    }

    async answer(key, entry) {
      const id = Number(entry.update.update_id);
      const { chat } = senderOf(entry.update);
      if (chat) await this.storage.put("tg:chat", chat.id);
      try {
        this.chatController = new AbortController();
        const ctx = await this.context(entry, this.chatController);
        if (ctx.chatId !== undefined) {
          try {
            await handleUpdate(ctx, entry.update);
          } catch (error) {
            console.log("update failed: " + errorText(error));
            await ctx.telegram.sendMarkdown(ctx.chatId, `Sorry, that went wrong: ${clip(errorText(error), 200)}`).catch(() => null);
          }
        }
      } finally {
        this.chatController = null;
        await this.storage.delete(key);
        const last = (await this.storage.get("tg:last")) || 0;
        await this.storage.put("tg:last", Math.max(last, id));
      }
    }

    async runMission() {
      if (this.missionRunning) return;
      this.missionRunning = true;
      this.missionController = new AbortController();
      try {
        const ctx = await this.context({}, this.missionController);
        if (ctx.chatId === undefined || !ctx.telegram) return;
        const nextAt = await advanceMission(ctx);
        if (nextAt !== null && nextAt !== undefined) await this.schedule(nextAt);
      } finally {
        this.missionController = null;
        this.missionRunning = false;
      }
    }

    // Never throws: a failed alarm would be retried by Cloudflare and run the whole thing again.
    async alarm() {
      try {
        await this.runProbeIfAsked();
      } catch (error) {
        console.log("health check failed to finish: " + errorText(error));
      }
      try {
        await this.drain();
        await this.runMission();
      } catch (error) {
        console.log("chat work failed: " + errorText(error));
      }
    }
  }

  // The bot's settings: its token, the webhook secret, the owner and who else may use it.
  class Registry {
    constructor(state, env) {
      this.storage = state.storage;
      this.env = env;
    }

    async config() {
      return (await this.storage.get("config")) || { allowed: [] };
    }

    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
      const config = await this.config();
      switch (url.pathname) {
        case "/config":
          return json(config);
        case "/setup":
          return this.setup(config, body);
        case "/access":
          return this.access(config, body);
        case "/allow":
        case "/deny":
          return this.change(config, url.pathname.slice(1), Number(body.userId));
        case "/users":
          return json({ owner: config.ownerId || null, users: config.allowed || [] });
        default:
          return json({ ok: false, error: "not found" }, 404);
      }
    }

    // Connect (or reconnect) the bot. body = { token?, webhookUrl, newPairing? }
    async setup(config, body) {
      const token = String(body.token || config.token || "").trim();
      if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
        return json({ ok: false, error: "That does not look like a bot token from @BotFather." }, 400);
      }
      const telegram = createTelegram({ fetch: deps.fetch, token });
      let me;
      try {
        me = await telegram.call("getMe");
      } catch (error) {
        return json({ ok: false, error: "Telegram did not accept the token: " + clip(errorText(error), 160) }, 400);
      }
      const sameBot = config.bot && config.bot.id === me.id;
      const next = {
        ...config,
        token,
        bot: { id: me.id, username: me.username, name: me.first_name },
        secret: sameBot && config.secret ? config.secret : randomHex(24),
        allowed: sameBot ? config.allowed || [] : [],
        ownerId: sameBot ? config.ownerId || null : null,
        connectedAt: deps.now(),
      };
      if (body.newPairing) {
        next.ownerId = null;
        next.allowed = [];
      }
      if (!next.ownerId) {
        next.pairCode = randomHex(16);
        next.pairUntil = deps.now() + PAIRING_GOOD_FOR_MS;
      }
      try {
        await telegram.call("setWebhook", {
          url: body.webhookUrl,
          secret_token: next.secret,
          allowed_updates: ["message", "callback_query"],
          drop_pending_updates: true,
        });
        await telegram.call("setMyCommands", { commands: COMMANDS });
      } catch (error) {
        return json({ ok: false, error: "Telegram refused the webhook: " + clip(errorText(error), 160) }, 502);
      }
      await this.storage.put("config", next);
      return json({
        ok: true,
        bot: { username: me.username, name: me.first_name },
        webhook: body.webhookUrl,
        paired: !!next.ownerId,
        pairLink: next.ownerId ? null : `https://t.me/${me.username}?start=${next.pairCode}`,
        pairUntil: next.ownerId ? null : next.pairUntil,
      });
    }

    // May this person use the bot? The first one to open the pairing link becomes the owner.
    async access(config, body) {
      const userId = Number(body.userId);
      if (!config.token) return json({ allowed: false, reason: "not-configured" });
      if (!config.ownerId) {
        const match = String(body.text || "").match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]+)\s*$/);
        const fresh = config.pairCode && deps.now() < (config.pairUntil || 0);
        if (match && fresh && safeEqual(match[1], config.pairCode)) {
          const next = { ...config, ownerId: userId, allowed: [userId], pairCode: null, pairUntil: null };
          await this.storage.put("config", next);
          return json({ allowed: true, owner: true, paired: true });
        }
        return json({ allowed: false, reason: "not-paired" });
      }
      const allowed = (config.allowed || []).includes(userId);
      return json({ allowed, owner: userId === config.ownerId, reason: allowed ? "" : "private" });
    }

    async change(config, action, userId) {
      if (!Number.isSafeInteger(userId) || userId <= 0) return json({ ok: false, error: "That is not a Telegram id." }, 400);
      if (!config.ownerId) return json({ ok: false, error: "The bot has no owner yet." }, 409);
      if (action === "deny" && userId === config.ownerId) return json({ ok: false, error: "The owner cannot be removed." }, 409);
      const allowed = new Set(config.allowed || []);
      if (action === "allow") allowed.add(userId);
      else allowed.delete(userId);
      await this.storage.put("config", { ...config, allowed: [...allowed] });
      return json({ ok: true, users: [...allowed] });
    }
  }

  async function telegramWebhook(request, env) {
    const registry = registryOf(env);
    const config = await (await registry.fetch(new Request(INSIDE + "/config"))).json();
    const given = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (!config.token || !config.secret || !given || !safeEqual(given, config.secret)) {
      return json({ ok: false, error: "not allowed" }, 403);
    }
    let update;
    try {
      update = await request.json();
    } catch (error) {
      return json({ ok: true, ignored: "not JSON" });
    }
    const { from, chat, text, callback } = senderOf(update || {});
    if (!from || !chat || from.is_bot) return json({ ok: true, ignored: "no sender" });

    const access = await ask(registry, "/access", { userId: from.id, text });
    if (!access.allowed) {
      const telegram = createTelegram({ fetch: deps.fetch, token: config.token });
      if (callback) {
        await telegram.answerCallback(callback.id, "This GlowBot is private.");
      } else if (chat.type === "private") {
        const message =
          access.reason === "not-paired"
            ? "This GlowBot is not paired yet. Its owner has to open the pairing link from the setup first."
            : `This GlowBot is private. Your Telegram id is \`${from.id}\`: ask the owner to send \`/allow ${from.id}\`.`;
        await telegram.sendMarkdown(chat.id, message).catch(() => null);
      }
      return json({ ok: true, allowed: false });
    }

    const agent = env.CHAT.get(env.CHAT.idFromName("tg:" + chat.id));
    await agent.fetch(
      post("/update", { update, token: config.token, bot: config.bot, isOwner: !!access.owner, paired: !!access.paired }),
    );
    return json({ ok: true });
  }

  async function route(request, env, cors) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (request.method === "GET" && path === "/") {
      return new Response(`GlowBot ${VERSION} is running. Glow lives at ${pagesOf(env)}/\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...cors },
      });
    }

    if (request.method === "GET" && path === "/v1/status") {
      const config = await (await registryOf(env).fetch(new Request(INSIDE + "/config"))).json();
      return json(
        {
          ok: true,
          service: "glow-bot",
          version: VERSION,
          build: buildOf(env),
          stage: "telegram",
          configured: !!config.token,
          bot: config.bot ? config.bot.username : null,
          paired: !!config.ownerId,
          access: "private",
          ai: !!env.AI,
          colo: (request.cf && request.cf.colo) || "",
        },
        200,
        cors,
      );
    }

    if (request.method === "GET" && path === "/v1/probe") {
      const fresh = url.searchParams.get("fresh") === "1";
      if (fresh && !(await hasSetupCode(request, env))) {
        return json({ ok: false, error: "A fresh check needs the setup code." }, 403, cors);
      }
      const agent = env.CHAT.get(env.CHAT.idFromName("sys:probe"));
      const reply = await agent.fetch(INSIDE + "/probe" + (fresh ? "?fresh=1" : ""));
      return json(await reply.json(), reply.status, cors);
    }

    if (request.method === "POST" && path === "/v1/setup") {
      if (!(await hasSetupCode(request, env))) return json({ ok: false, error: "Setting up the bot needs the setup code." }, 403, cors);
      const body = await request.json().catch(() => ({}));
      const webhookUrl = `${url.origin}/v1/telegram`;
      const answer = await registryOf(env).fetch(post("/setup", { token: body.token, newPairing: !!body.newPairing, webhookUrl }));
      return json(await answer.json(), answer.status, cors);
    }

    if (request.method === "POST" && path === "/v1/telegram") return telegramWebhook(request, env);

    return json({ ok: false, error: "not found" }, 404, cors);
  }

  const worker = {
    async fetch(request, env) {
      const cors = corsHeaders(request, env);
      try {
        return await route(request, env, cors);
      } catch (error) {
        return json({ ok: false, error: clip(errorText(error), 300) }, 500, cors);
      }
    },
  };

  return { worker, ChatAgent, Registry };
}

const production = createWorker();

export const ChatAgent = production.ChatAgent;
export const Registry = production.Registry;
export default production.worker;
