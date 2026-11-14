// TradeBot: a trading agent in Telegram, running on a free Cloudflare Worker.
//
//   GET  /v1/status    alive, which build, whether a Telegram bot is connected and the agent is running
//   GET  /v1/probe     can this Worker read live prices? (each price source, asked from Cloudflare)
//   GET  /v1/desk      does the desk (Workers AI second opinion) answer? One sample question, kept 6 hours
//   GET  /v1/live      real money: mode, whether the Worker is armed, and whether Tokocrypto answers from here
//   POST /v1/setup     owner only (setup code): connect a Telegram bot token, set the webhook, make a pairing link
//   POST /v1/telegram  Telegram's webhook (checked with the secret Telegram sends back)
//
// One Durable Object, the Trader, holds the bot's settings and the practice account. Its alarm
// rings every 5 minutes: that is the agent's round. Everything it does happens one thing at a
// time, so a command and a round can never trade over each other.
//
// Money: the practice account decides everything. Real money (live.js) is a small fixed-size copy on
// Tokocrypto that stays off unless LIVE_TRADING = "enabled", the API secrets are set AND the owner
// sends /live on confirm. With any of the three missing, no real order can be sent.

import { TICK_MS, newState, tick } from "./agent.js";
import { DESK_MODEL, SAMPLE_BRIEF, convene } from "./desk.js";
import { EXCHANGE_NAME, createTokocrypto, exchangeSymbol } from "./exchange.js";
import { armedBy, drain, liveOf, missingFor } from "./live.js";
import { COMMANDS, handleUpdate } from "./bot.js";
import { refreshRate, rateOfState } from "./fx.js";
import { SOURCE_NAMES, createMarket } from "./market.js";
import * as render from "./render.js";
import { createTelegram } from "./telegram.js";
import { VERSION, clip, errorText, json, randomHex, safeEqual, sha256Hex } from "./util.js";

const INSIDE = "https://trade-bot.internal"; // addresses used between the Worker and its Durable Object
const PAIRING_GOOD_FOR_MS = 24 * 60 * 60 * 1000;
const PROBE_GOOD_FOR_MS = 5 * 60 * 1000;
const DESK_CHECK_GOOD_FOR_MS = 6 * 60 * 60 * 1000;
const SEEN_UPDATES = 50;

function buildOf(env) {
  return String((env && env.BUILD) || "dev");
}

// The setup code is a long random secret only the owner has. The Worker only knows SHA-256
// hashes of the codes it accepts (a comma-separated list).
async function hasSetupCode(request, env) {
  const given = request.headers.get("X-Setup-Code") || "";
  const expected = String((env && env.SETUP_CODE_SHA256) || "").split(",").map((hash) => hash.trim()).filter(Boolean);
  if (!given || !expected.length) return false;
  const hash = await sha256Hex(given);
  let match = false;
  for (const candidate of expected) match = safeEqual(hash, candidate) || match;
  return match;
}

function post(path, body) {
  return new Request(INSIDE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

// Asia-Pacific, so the price sources that refuse some countries still answer.
function traderOf(env) {
  return env.TRADER.get(env.TRADER.idFromName("main"), { locationHint: "apac" });
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

// Everything is built by one function so the tests can hand in a pretend network and a pretend clock.
export function createWorker(overrides) {
  const deps = {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    ...overrides,
  };
  const market = deps.market || createMarket({ fetch: deps.fetch });

  class Trader {
    constructor(ctx, env) {
      this.storage = ctx.storage;
      this.env = env;
      this.queue = Promise.resolve();
      this.probing = null;
      this.probed = null;
    }

    // One thing at a time: a command never runs in the middle of the agent's round.
    run(work) {
      const result = this.queue.then(work);
      this.queue = result.catch(() => null);
      return result;
    }

    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
      if (url.pathname === "/status") return this.run(() => this.status());
      if (url.pathname === "/setup" && request.method === "POST") return this.run(() => this.setup(body));
      if (url.pathname === "/update" && request.method === "POST") return this.run(() => this.update(body));
      if (url.pathname === "/probe") return this.probe();
      if (url.pathname === "/desk") return this.deskCheck();
      if (url.pathname === "/live") return this.run(() => this.liveCheck());
      return json({ ok: false, error: "not found" }, 404);
    }

    async config() {
      return (await this.storage.get("config")) || {};
    }

    async state() {
      const state = (await this.storage.get("state")) || newState();
      render.useRate(rateOfState(state)); // amounts are written in rupiah once a rate is known
      return state;
    }

    // Keeps the USDT -> rupiah rate fresh (read at most once an hour; an old rate beats none).
    async rupiah(state) {
      await refreshRate(state, { fetch: deps.fetch, now: deps.now() });
      render.useRate(rateOfState(state));
    }

    // The agent only runs for a paired owner. Called on every visit, so a lost alarm comes back.
    async keepRunning(config, soon) {
      if (!config.ownerId) return;
      if (soon || (await this.storage.getAlarm()) === null) await this.storage.setAlarm(deps.now() + (soon ? 0 : TICK_MS));
    }

    async deliver(config, messages) {
      if (!config.token || !config.chatId) return;
      const telegram = createTelegram({ fetch: deps.fetch, token: config.token });
      for (const message of messages) {
        try {
          await telegram.send(config.chatId, message.html, message.buttons);
        } catch (error) {
          console.log("message not sent: " + clip(errorText(error), 200));
        }
      }
    }

    // ---------------------------------------------------------------- real money

    exchange() {
      if (deps.exchange !== undefined) return deps.exchange;
      const env = this.env || {};
      return createTokocrypto({ fetch: deps.fetch, now: deps.now, apiKey: env.TOKO_API_KEY || "", apiSecret: env.TOKO_API_SECRET || "" });
    }

    // Send (or rehearse) the real copies of the practice fills that just happened.
    async copyLive(state) {
      const live = liveOf(state);
      if (!live.queue.length) return [];
      return drain(state, { exchange: this.exchange(), now: deps.now(), armed: armedBy(this.env) });
    }

    async liveCheck() {
      const state = await this.state();
      const live = liveOf(state);
      const markets = {};
      let reachable = false;
      let error = "";
      try {
        const exchange = this.exchange();
        for (const symbol of state.settings.watchlist) {
          const rules = await exchange.rules(symbol);
          markets[symbol] = rules ? { market: rules.symbol, minOrderUsdt: rules.minNotional, step: rules.stepSize, spot: rules.spot } : { market: exchangeSymbol(symbol), listed: false };
        }
        reachable = true;
      } catch (problem) {
        error = clip(errorText(problem), 200);
      }
      return json({
        ok: reachable,
        exchange: EXCHANGE_NAME,
        mode: live.mode,
        armed: armedBy(this.env),
        missing: missingFor(this.env),
        orderUsdt: live.orderUsdt,
        openCopies: Object.keys(live.positions).length,
        markets,
        ...(error ? { error } : {}),
      });
    }

    // ---------------------------------------------------------------- the agent's round

    async alarm() {
      await this.run(async () => {
        const config = await this.config();
        if (!config.ownerId) return; // nobody to trade for: stop ringing
        try {
          const state = await this.state();
          await this.rupiah(state);
          const ai = this.ai();
          const messages = await tick(state, { market, now: deps.now(), ai });
          messages.push(...(await this.copyLive(state)));
          await this.storage.put("state", state); // saved before anything is sent
          await this.deliver(config, messages);
        } catch (error) {
          console.log("round failed: " + clip(errorText(error), 300));
        } finally {
          await this.storage.setAlarm(deps.now() + TICK_MS);
        }
      });
    }

    // ---------------------------------------------------------------- status and health

    async status() {
      const config = await this.config();
      await this.keepRunning(config);
      const state = await this.state();
      const before = state.fx ? state.fx.at : 0;
      await this.rupiah(state);
      if (state.fx && state.fx.at !== before) await this.storage.put("state", state); // keep a fresh rate
      const alarm = await this.storage.getAlarm();
      return json({
        configured: !!config.token,
        bot: config.bot ? config.bot.username : null,
        paired: !!config.ownerId,
        running: !!config.ownerId && alarm !== null,
        lastRound: state.lastTick ? { at: state.lastTick.at, markets: state.lastTick.symbols, errors: state.lastTick.errors.length } : null,
        rupiah: state.fx ? { perUsdt: state.fx.rate, source: state.fx.source, at: state.fx.at } : null,
      });
    }

    // Ask every price source for a few BTC candles, from where this object runs.
    async probe() {
      const now = deps.now();
      if (this.probed && now - this.probed.at < PROBE_GOOD_FOR_MS) return json(this.probed);
      if (!this.probing) {
        this.probing = (async () => {
          const sources = {};
          for (const name of SOURCE_NAMES) {
            const started = Date.now();
            try {
              const { candles } = await market.candles("BTCUSDT", "1h", 5, name);
              sources[name] = { ok: true, candles: candles.length, price: candles[candles.length - 1].c, ms: Date.now() - started };
            } catch (error) {
              sources[name] = { ok: false, error: clip(errorText(error), 200), ms: Date.now() - started };
            }
          }
          let where = "";
          try {
            const trace = await (await deps.fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(5000) })).text();
            where = ["loc", "colo"].map((key) => (trace.match(new RegExp(`^${key}=(.+)$`, "m")) || [])[1] || "?").join("/");
          } catch (error) {
            where = "";
          }
          this.probed = { ok: Object.values(sources).some((source) => source.ok), at: deps.now(), where, sources };
          return this.probed;
        })().finally(() => {
          this.probing = null;
        });
      }
      return json(await this.probing);
    }

    ai() {
      return deps.ai !== undefined ? deps.ai : (this.env && this.env.AI) || null;
    }

    // Ask the desk one fixed sample question. Kept 6 hours, so looking costs (almost) nothing.
    async deskCheck() {
      const now = deps.now();
      if (this.deskChecked && now - this.deskChecked.at < DESK_CHECK_GOOD_FOR_MS) return json(this.deskChecked);
      const started = Date.now();
      let problem = "";
      const opinion = await convene(this.ai(), SAMPLE_BRIEF, {
        onProblem: (why) => {
          problem = why;
        },
      });
      const answer = opinion
        ? { ok: true, model: opinion.model, verdict: opinion.verdict, confidence: opinion.confidence, bull: opinion.bull, ms: Date.now() - started, at: now }
        : { ok: false, model: DESK_MODEL, error: this.ai() ? `the desk did not give a usable answer (${problem || "unknown"})` : "no Workers AI binding", ms: Date.now() - started, at: now };
      if (answer.ok) this.deskChecked = answer;
      return json(answer);
    }

    // ---------------------------------------------------------------- setup

    // Connect a bot: check the token, point Telegram's webhook here, and make a one-time owner link.
    async setup(body) {
      const config = await this.config();
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
        token,
        bot: { id: me.id, username: me.username, name: me.first_name },
        secret: sameBot && config.secret ? config.secret : randomHex(24),
        ownerId: sameBot && !body.newPairing ? config.ownerId || null : null,
        chatId: sameBot && !body.newPairing ? config.chatId || null : null,
        connectedAt: deps.now(),
      };
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
      await this.keepRunning(next);
      return json({
        ok: true,
        bot: { username: me.username, name: me.first_name },
        webhook: body.webhookUrl,
        paired: !!next.ownerId,
        pairLink: next.ownerId ? null : `https://t.me/${me.username}?start=${next.pairCode}`,
        pairUntil: next.ownerId ? null : next.pairUntil,
      });
    }

    // ---------------------------------------------------------------- Telegram

    // An update from Telegram's webhook: { secret, update }.
    async update(body) {
      const config = await this.config();
      if (!config.token || !config.secret || !body.secret || !safeEqual(body.secret, config.secret)) {
        return json({ ok: false, error: "not allowed" }, 403);
      }
      const update = body.update || {};
      const id = Number(update.update_id);
      const { from, chat, text, callback } = senderOf(update);
      if (!Number.isSafeInteger(id) || !from || !chat || from.is_bot) return json({ ok: true, ignored: true });

      // Telegram sends an update again when the answer was slow; each one is handled once.
      const seen = (await this.storage.get("seen")) || [];
      if (seen.includes(id)) return json({ ok: true, duplicate: true });
      await this.storage.put("seen", [...seen, id].slice(-SEEN_UPDATES));

      const telegram = createTelegram({ fetch: deps.fetch, token: config.token });
      if (chat.type !== "private") return json({ ok: true, ignored: "not a private chat" });

      // The first person to open the pairing link becomes the owner. Nobody else gets in.
      if (!config.ownerId) {
        const match = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]+)\s*$/);
        const fresh = config.pairCode && deps.now() < (config.pairUntil || 0);
        if (!(match && fresh && safeEqual(match[1], config.pairCode))) {
          await telegram.send(chat.id, "This bot is not paired yet. Its owner has to open the pairing link from the setup first.").catch(() => null);
          return json({ ok: true, allowed: false });
        }
        const paired = { ...config, ownerId: from.id, chatId: chat.id, pairCode: null, pairUntil: null };
        await this.storage.put("config", paired);
        const state = await this.state();
        await this.rupiah(state);
        await this.storage.put("state", state);
        await this.deliver(paired, [
          render.welcome(state),
        ]);
        await this.keepRunning(paired, true); // the first round runs right away
        return json({ ok: true, paired: true });
      }
      if (from.id !== config.ownerId) {
        if (callback) await telegram.answerCallback(callback.id, "This bot is private.");
        else await telegram.send(chat.id, "This bot is private. It only works for its owner.").catch(() => null);
        return json({ ok: true, allowed: false });
      }

      const state = await this.state();
      await this.rupiah(state);
      const result = await handleUpdate({ state, market, now: deps.now(), env: this.env || {} }, update);
      const copies = await this.copyLive(state);
      if (copies.length) result.messages = [...(result.messages || []), ...copies];
      await this.storage.put("state", state); // saved before anything is sent
      await this.keepRunning(config);
      if (callback) {
        await telegram.answerCallback(callback.id, clip(result.toast || "", 190));
        if (result.edit && callback.message) {
          await telegram.edit(chat.id, callback.message.message_id, result.edit).catch(() => null);
        }
      }
      await this.deliver({ ...config, chatId: chat.id }, result.messages || []);
      return json({ ok: true });
    }
  }

  async function route(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const trader = traderOf(env);

    if (request.method === "GET" && path === "/") {
      return new Response(`TradeBot ${VERSION} is running. It trades practice money only.\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (request.method === "GET" && path === "/v1/status") {
      const inner = await (await trader.fetch(new Request(INSIDE + "/status"))).json();
      return json({ ok: true, service: "trade-bot", version: VERSION, build: buildOf(env), money: "practice", ...inner });
    }

    if (request.method === "GET" && path === "/v1/probe") {
      const answer = await trader.fetch(new Request(INSIDE + "/probe"));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "GET" && path === "/v1/live") {
      const answer = await trader.fetch(new Request(INSIDE + "/live"));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "GET" && path === "/v1/desk") {
      const answer = await trader.fetch(new Request(INSIDE + "/desk"));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "POST" && path === "/v1/setup") {
      if (!(await hasSetupCode(request, env))) return json({ ok: false, error: "Setting up the bot needs the setup code." }, 403);
      const body = await request.json().catch(() => ({}));
      const answer = await trader.fetch(
        post("/setup", { token: body.token, newPairing: !!body.newPairing, webhookUrl: `${url.origin}/v1/telegram` }),
      );
      return json(await answer.json(), answer.status);
    }

    if (request.method === "POST" && path === "/v1/telegram") {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
      const update = await request.json().catch(() => null);
      if (!secret) return json({ ok: false, error: "not allowed" }, 403);
      const answer = await trader.fetch(post("/update", { secret, update: update || {} }));
      return json(await answer.json(), answer.status);
    }

    return json({ ok: false, error: "not found" }, 404);
  }

  const worker = {
    async fetch(request, env) {
      try {
        return await route(request, env);
      } catch (error) {
        return json({ ok: false, error: clip(errorText(error), 300) }, 500);
      }
    },
  };

  return { worker, Trader };
}

const production = createWorker();

export const Trader = production.Trader;
export default production.worker;
