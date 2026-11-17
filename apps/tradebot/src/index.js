// TradeBot: a trading agent in Telegram, running on a free Cloudflare Worker.
//
//   GET  /v1/status    alive, which build, whether a Telegram bot is connected and the agent is running
//   GET  /v1/probe     can this Worker read live prices? (each price source, asked from Cloudflare)
//   GET  /v1/desk      does the desk (Workers AI second opinion) answer? One sample question, kept 6 hours
//   GET  /v1/live      real money: mode, whether the Worker is armed, and which markets the exchange would take a copy in
//   POST /v1/setup     owner only (setup code): connect a Telegram bot token, set the webhook, make a pairing link
//   POST /v1/telegram  Telegram's webhook (checked with the secret Telegram sends back)
//   GET  /v1/venues    which Indonesian exchanges answer from Cloudflare (public prices, no keys)
//
// The twin (freqtrade on the owner's PC) has its own Telegram bot, answered from here with the
// numbers the PC reports. Reports are off until the owner switches them on; the PC only sends
// numbers, and nothing is ever sent back to it.
//   POST /v1/twin/setup     owner only (setup code): connect the twin's bot, get the report key once
//   POST /v1/twin/report    the PC's reporter (report key): what the twin is doing right now
//   POST /v1/twin/telegram  Telegram's webhook for the twin's bot
//
// MetaTrader 5 (mt5.js): a bridge on the owner's PC copies the practice account's open coins onto an
// MT5 DEMO account. It asks here what to hold and posts back what the demo account looks like; the
// Worker never reaches the PC. Off until the owner runs the setup and gives the bridge its key.
//   POST /v1/mt5/setup      owner only (setup code): make the bridge key, shown once
//   GET  /v1/mt5/signals    the bridge (bridge key): the coins the practice account holds right now
//   POST /v1/mt5/report     the bridge (bridge key): what the demo account looks like
//
// Indodax (indodax.js): Indodax turns this Worker away (403), so a sender on the owner's PC copies the
// practice account's open coins there in rupiah. It starts in practice (pretend money); real money is
// a switch on the PC only. It asks here what to hold and posts back what its copies look like.
//   POST /v1/indodax/setup    owner only (setup code): make the sender's key, shown once
//   GET  /v1/indodax/signals  the sender (its key): the coins the practice account holds right now
//   POST /v1/indodax/report   the sender (its key): what its copies at Indodax look like
//   GET  /v1/indodax/view     the desktop app (the sender's key): the full report as data
//   POST /v1/indodax/pause    the desktop app (the sender's key): stop new buys, or allow them again
//   GET  /v1/indodax/phone    the phone page (?k= the private link from /phone in Telegram): read-only
//
// While the sender is in real mode the owner hears about the real account only: the practice
// account still runs (its signals are what the sender copies), but its messages stay off.
//
// One Durable Object, the Trader, holds the bot's settings and the practice account. Its alarm
// rings every 5 minutes: that is the agent's round. Everything it does happens one thing at a
// time, so a command and a round can never trade over each other.
//
// Money: the practice account decides everything. Real money (live.js) is a small fixed-size copy on
// Luno (rupiah; EXCHANGE = "tokocrypto" picks Tokocrypto) that stays off unless LIVE_TRADING =
// "enabled", the API secrets are set AND the owner sends /live on confirm. With any of the three
// missing, no real order can be sent.

import { TICK_MS, newState, readSignals, tick } from "./agent.js";
import { DESK_MODEL, SAMPLE_BRIEF, convene } from "./desk.js";
import { createTokocrypto } from "./exchange.js";
import { MAX_SPREAD_PERCENT, armedBy, drain, limitsOf, liveOf, marketBlock, missingFor, venueOf } from "./live.js";
import { createLuno } from "./luno.js";
import { COMMANDS, REAL_COMMANDS, handleUpdate, indodaxSymbols } from "./bot.js";
import { refreshRate, rateOfState } from "./fx.js";
import {
  backText as indodaxBack,
  changes as indodaxChanges,
  cleanReport as cleanIndodaxReport,
  keepCash as keepIndodaxCash,
  fullReport as indodaxFull,
  onlyReal as indodaxOnlyReal,
  phonePage as indodaxPhonePage,
  plainWords as indodaxPlainWords,
  realOnly as indodaxRealOnly,
  silentAlert as indodaxSilent,
  stopSigns as indodaxStopSigns,
  viewData as indodaxViewData,
  withDaily as withIndodaxDaily,
} from "./indodax.js";
import { SOURCE_NAMES, createMarket } from "./market.js";
import { changes as mt5Changes, cleanReport, wantedOf } from "./mt5.js";
import * as render from "./render.js";
import { createTelegram } from "./telegram.js";
import { TWIN_COMMANDS, answer as twinAnswer, changes as twinChanges, cleanSnapshot, retired as twinRetired } from "./twin.js";
import { VERSION, clip, errorText, json, randomHex, safeEqual, sha256Hex } from "./util.js";
import { probeVenues } from "./venues.js";

const INSIDE = "https://trade-bot.internal"; // addresses used between the Worker and its Durable Object
const PAIRING_GOOD_FOR_MS = 24 * 60 * 60 * 1000;
const PROBE_GOOD_FOR_MS = 5 * 60 * 1000;
const DESK_CHECK_GOOD_FOR_MS = 6 * 60 * 60 * 1000;
const SEEN_UPDATES = 50;
const TOKEN_SHAPE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/; // what @BotFather hands out
const REPORT_MAX_BYTES = 32 * 1024; // a twin, MT5 or Indodax report is small; anything huge is not one

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
      this.reportSeen = null;
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
      if (url.pathname === "/venues") return this.venues();
      if (url.pathname === "/twin/setup" && request.method === "POST") return this.run(() => this.twinSetup(body));
      if (url.pathname === "/twin/report" && request.method === "POST") return this.run(() => this.twinReport(body));
      if (url.pathname === "/twin/update" && request.method === "POST") return this.run(() => this.twinUpdate(body));
      if (url.pathname === "/mt5/setup" && request.method === "POST") return this.run(() => this.mt5Setup(body));
      if (url.pathname === "/mt5/signals" && request.method === "POST") return this.run(() => this.mt5Signals(body));
      if (url.pathname === "/mt5/report" && request.method === "POST") return this.run(() => this.mt5Report(body));
      if (url.pathname === "/indodax/setup" && request.method === "POST") return this.run(() => this.indodaxSetup(body));
      if (url.pathname === "/indodax/signals" && request.method === "POST") return this.run(() => this.indodaxSignals(body));
      if (url.pathname === "/indodax/report" && request.method === "POST") return this.run(() => this.indodaxReport(body));
      if (url.pathname === "/indodax/view" && request.method === "POST") return this.run(() => this.indodaxViewFor(body));
      if (url.pathname === "/indodax/pause" && request.method === "POST") return this.run(() => this.indodaxPause(body));
      if (url.pathname === "/indodax/page" && request.method === "POST") return this.run(() => this.indodaxPage(body));
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

    // Send messages to the owner's chat. config = { token, chatId }: the twin passes its own token.
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
      if (venueOf(env).id === "tokocrypto") {
        return createTokocrypto({ fetch: deps.fetch, now: deps.now, apiKey: env.TOKO_API_KEY || "", apiSecret: env.TOKO_API_SECRET || "" });
      }
      // Luno trades in rupiah, so it sizes its orders with the bot's own rupiah rate.
      return createLuno({ fetch: deps.fetch, now: deps.now, keyId: env.LUNO_API_KEY_ID || "", secret: env.LUNO_API_SECRET || "", rate: () => render.rateNow() });
    }

    // Send (or rehearse) the real copies of the practice fills that just happened.
    async copyLive(state) {
      const live = liveOf(state);
      if (!live.queue.length) return [];
      return drain(state, { exchange: this.exchange(), now: deps.now(), armed: armedBy(this.env), venue: venueOf(this.env) });
    }

    // Public: what a copy would meet on the exchange right now. No keys are used and no balance is read.
    async liveCheck() {
      const state = await this.state();
      const before = state.fx ? state.fx.at : 0;
      await this.rupiah(state); // a rupiah market cannot be judged without the rate
      if (state.fx && state.fx.at !== before) await this.storage.put("state", state);
      const live = liveOf(state);
      const venue = venueOf(this.env);
      const limits = limitsOf(live);
      const markets = {};
      let reachable = false;
      let error = "";
      try {
        const exchange = this.exchange();
        for (const symbol of state.settings.watchlist) {
          const rules = await exchange.rules(symbol, limits.orderUsdt);
          const refused = marketBlock(symbol, rules, limits, venue);
          markets[symbol] = rules
            ? {
                market: rules.symbol,
                minOrderUsdt: rules.minNotional,
                step: rules.stepSize,
                spot: rules.spot,
                ...(rules.spreadPercent === undefined ? {} : { spreadPercent: rules.spreadPercent === null ? null : Math.round(rules.spreadPercent * 1000) / 1000 }),
                copied: !refused,
                ...(refused ? { refused } : {}),
              }
            : { listed: false, copied: false, refused };
        }
        reachable = true;
      } catch (problem) {
        error = clip(errorText(problem), 200);
      }
      return json({
        ok: reachable,
        exchange: venue.name,
        quote: venue.quote,
        maxSpreadPercent: MAX_SPREAD_PERCENT,
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
          const messages = await this.indodaxDaily(state, await tick(state, { market, now: deps.now(), ai }));
          messages.push(...(await this.copyLive(state)));
          await this.storage.put("state", state); // saved before anything is sent
          await this.deliver(config, messages);
        } catch (error) {
          console.log("round failed: " + clip(errorText(error), 300));
        } finally {
          await this.storage.setAlarm(deps.now() + TICK_MS);
        }
        await this.indodaxSilence(config); // after the alarm is set, so a failure here cannot stop the rounds
      });
    }

    // What the Indodax messages are written from: the sender's last report and the pause switch.
    async indodaxLook(state) {
      const indodax = (await this.storage.get("indodax")) || {};
      return {
        configured: !!indodax.keyHash,
        report: indodax.report || null,
        at: indodax.reportAt || 0,
        now: deps.now(),
        paused: state.settings.indodaxPaused === true,
      };
    }

    // What the strategy sees in the coins the sender may trade. null when it cannot be read: the
    // report is then written without that part.
    async indodaxExtra(state, view) {
      try {
        return { state, rows: await readSignals(state, market, deps.now(), indodaxSymbols(view.report)) };
      } catch (error) {
        console.log("indodax signals not read: " + clip(errorText(error), 300));
        return null;
      }
    }

    // While the sender is in real mode, the round's practice messages stay off and the daily
    // summary is the full Indodax report. Otherwise the daily summary also says where the Indodax
    // copies stand. A failure here leaves the messages as they were: it must never cost the round.
    async indodaxDaily(state, messages) {
      if (!messages.length) return messages;
      try {
        const view = await this.indodaxLook(state);
        if (indodaxRealOnly(view)) {
          const extra = messages.some((message) => message.daily) ? await this.indodaxExtra(state, view) : null;
          return indodaxOnlyReal(messages, view, extra);
        }
        if (!messages.some((message) => message.daily)) return messages;
        return withIndodaxDaily(messages, view);
      } catch (error) {
        console.log("indodax daily part failed: " + clip(errorText(error), 300));
        return messages;
      }
    }

    // Tell the owner once when the Indodax sender has gone quiet while real money is in play. The
    // report time it was told for is remembered, so one silence is one message.
    async indodaxSilence(config) {
      try {
        const indodax = await this.storage.get("indodax");
        if (!indodax || !indodax.keyHash) return;
        const alert = indodaxSilent({ report: indodax.report || null, at: indodax.reportAt || 0, now: deps.now(), toldAt: indodax.silentToldAt || 0 });
        if (!alert) return;
        await this.storage.put("indodax", { ...indodax, silentToldAt: indodax.reportAt }); // saved before it is sent
        await this.deliver(config, [alert]);
      } catch (error) {
        console.log("indodax silence check failed: " + clip(errorText(error), 300));
      }
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
      const twin = (await this.storage.get("twin")) || {};
      const mt5 = (await this.storage.get("mt5")) || {};
      const indodax = (await this.storage.get("indodax")) || {};
      const copies = indodax.report || null;
      return json({
        configured: !!config.token,
        bot: config.bot ? config.bot.username : null,
        paired: !!config.ownerId,
        running: !!config.ownerId && alarm !== null,
        lastRound: state.lastTick ? { at: state.lastTick.at, markets: state.lastTick.symbols, errors: state.lastTick.errors.length } : null,
        rupiah: state.fx ? { perUsdt: state.fx.rate, source: state.fx.source, at: state.fx.at } : null,
        twin: { configured: !!twin.token, bot: twin.bot ? twin.bot.username : null, lastReportAt: twin.snapshotAt || null },
        mt5: { configured: !!mt5.keyHash, lastReportAt: mt5.reportAt || null, demo: mt5.report ? mt5.report.demo : null },
        // Counts and switches only: this page is public, so no amount, coin or result is on it.
        indodax: {
          configured: !!indodax.keyHash,
          lastReportAt: indodax.reportAt || null,
          mode: copies ? copies.mode : null,
          paused: state.settings.indodaxPaused === true,
          keys: copies ? copies.keys === true : null,
          checked: copies ? copies.checked === true : null,
          tripped: copies ? copies.tripped === true : null,
          openCopies: copies ? copies.positions.length : null,
          realOpen: copies ? copies.positions.filter((position) => position.real).length : null,
        },
      });
    }

    // Country and Cloudflare site this object runs in ("SG/SIN"), or "" when that cannot be read.
    async where() {
      try {
        const trace = await (await deps.fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(5000) })).text();
        return ["loc", "colo"].map((key) => (trace.match(new RegExp(`^${key}=(.+)$`, "m")) || [])[1] || "?").join("/");
      } catch (error) {
        return "";
      }
    }

    // Which Indonesian exchanges answer from where this object runs. Kept 5 minutes.
    async venues() {
      const now = deps.now();
      if (this.venuesSeen && now - this.venuesSeen.at < PROBE_GOOD_FOR_MS) return json(this.venuesSeen);
      if (!this.venuesAsking) {
        this.venuesAsking = (async () => {
          const venues = await probeVenues({ fetch: deps.fetch });
          const where = await this.where();
          this.venuesSeen = { ok: Object.values(venues).some((venue) => venue.ok), at: deps.now(), where, venues };
          return this.venuesSeen;
        })().finally(() => {
          this.venuesAsking = null;
        });
      }
      return json(await this.venuesAsking);
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
          const where = await this.where();
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
      if (!TOKEN_SHAPE.test(token)) {
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
        next.commandsFor = VERSION;
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
      const mt5 = (await this.storage.get("mt5")) || {};
      const mt5View = { configured: !!mt5.keyHash, report: mt5.report || null, at: mt5.reportAt || 0, now: deps.now() };
      const indodax = (await this.storage.get("indodax")) || {};
      const indodaxView = { configured: !!indodax.keyHash, report: indodax.report || null, at: indodax.reportAt || 0, now: deps.now() };
      const result = await handleUpdate({ state, market, now: deps.now(), env: this.env || {}, mt5: mt5View, indodax: indodaxView }, update);
      const copies = await this.copyLive(state);
      if (copies.length) result.messages = [...(result.messages || []), ...copies];
      if (result.phone) result.messages = [...(result.messages || []), await this.phoneLink(body.origin)];
      await this.storage.put("state", state); // saved before anything is sent
      await this.freshCommands(config, telegram, indodaxRealOnly(indodaxView));
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

    // ---------------------------------------------------------------- the twin's bot

    // Connect the twin's own Telegram bot here. The answer holds the report key, shown once: the
    // PC's reporter needs it, and only its SHA-256 is kept.
    async twinSetup(body) {
      const config = await this.config();
      const twin = (await this.storage.get("twin")) || {};
      const token = String(body.token || twin.token || "").trim();
      if (!TOKEN_SHAPE.test(token)) {
        return json({ ok: false, error: "That does not look like a bot token from @BotFather." }, 400);
      }
      const telegram = createTelegram({ fetch: deps.fetch, token });
      let me;
      try {
        me = await telegram.call("getMe");
      } catch (error) {
        return json({ ok: false, error: "Telegram did not accept the token: " + clip(errorText(error), 160) }, 400);
      }
      if (config.bot && config.bot.id === me.id) {
        return json({ ok: false, error: "That is TradeBot's own bot. The twin needs a second bot from @BotFather." }, 400);
      }
      const sameBot = twin.bot && twin.bot.id === me.id;
      const keepKey = sameBot && twin.keyHash && !body.newKey;
      const reportKey = keepKey ? null : randomHex(32);
      const next = {
        token,
        bot: { id: me.id, username: me.username, name: me.first_name },
        secret: sameBot && twin.secret ? twin.secret : randomHex(24),
        keyHash: keepKey ? twin.keyHash : await sha256Hex(reportKey),
        snapshot: sameBot ? twin.snapshot || null : null,
        snapshotAt: sameBot ? twin.snapshotAt || null : null,
        connectedAt: deps.now(),
      };
      try {
        // Waiting messages are kept on purpose: a /start sent while the bot was deaf gets its answer.
        await telegram.call("setWebhook", { url: body.webhookUrl, secret_token: next.secret, allowed_updates: ["message"] });
        await telegram.call("setMyCommands", { commands: TWIN_COMMANDS });
      } catch (error) {
        return json({ ok: false, error: "Telegram refused the webhook: " + clip(errorText(error), 160) }, 502);
      }
      await this.storage.put("twin", next);
      return json({
        ok: true,
        bot: { username: me.username, name: me.first_name },
        webhook: body.webhookUrl,
        ownerPaired: !!config.ownerId,
        reportKey,
        note: reportKey ? "Put reportKey in the twin's .env as TWIN_REPORT_KEY. It is not shown again." : "The report key from the first setup still works. Send newKey: true for a new one.",
      });
    }

    // A report from the PC: { key, snapshot }. Stored, and trades that opened or closed are told.
    async twinReport(body) {
      const twin = await this.storage.get("twin");
      const given = typeof body.key === "string" ? body.key : "";
      if (!twin || !twin.keyHash || !given || !safeEqual(await sha256Hex(given), twin.keyHash)) {
        return json({ ok: false, error: "not allowed" }, 403);
      }
      const snapshot = cleanSnapshot(body.snapshot);
      if (!snapshot) return json({ ok: false, error: "That is not a twin report." }, 400);
      await this.state(); // amounts are written in rupiah once a rate is known
      const messages = twinChanges(twin.snapshot, snapshot);
      const now = deps.now();
      await this.storage.put("twin", { ...twin, snapshot, snapshotAt: now }); // saved before anything is sent
      const config = await this.config();
      await this.deliver({ token: twin.token, chatId: config.chatId }, messages);
      return json({ ok: true, at: now, told: messages.length });
    }

    // An update from Telegram for the twin's bot: { secret, update }. It answers TradeBot's owner
    // only, and it only shows: no message here can reach the PC.
    async twinUpdate(body) {
      const twin = await this.storage.get("twin");
      if (!twin || !twin.token || !twin.secret || !body.secret || !safeEqual(body.secret, twin.secret)) {
        return json({ ok: false, error: "not allowed" }, 403);
      }
      const update = body.update || {};
      const id = Number(update.update_id);
      const { from, chat, text } = senderOf(update);
      if (!Number.isSafeInteger(id) || !from || !chat || from.is_bot) return json({ ok: true, ignored: true });

      const seen = (await this.storage.get("twinSeen")) || [];
      if (seen.includes(id)) return json({ ok: true, duplicate: true });
      await this.storage.put("twinSeen", [...seen, id].slice(-SEEN_UPDATES));
      if (chat.type !== "private") return json({ ok: true, ignored: "not a private chat" });

      const config = await this.config();
      const telegram = createTelegram({ fetch: deps.fetch, token: twin.token });
      const say = (html) =>
        telegram.send(chat.id, html).catch((error) => {
          console.log("twin message not sent: " + clip(errorText(error), 200));
        });
      if (!config.ownerId) {
        await say("This bot works for TradeBot's owner, and TradeBot has no owner yet. Pair TradeBot first.");
        return json({ ok: true, allowed: false });
      }
      if (from.id !== config.ownerId) {
        await say("This bot is private. It only works for its owner.");
        return json({ ok: true, allowed: false });
      }
      const state = await this.state(); // amounts are written in rupiah once a rate is known
      // With real money at Indodax the twin is no longer the account to look at: say so, once per message.
      if (indodaxRealOnly(await this.indodaxLook(state))) {
        await say(twinRetired(config.bot ? config.bot.username : null).html);
        return json({ ok: true, retired: true });
      }
      await say(twinAnswer(text, { snapshot: twin.snapshot || null, at: twin.snapshotAt || 0, now: deps.now() }).html);
      return json({ ok: true });
    }

    // ---------------------------------------------------------------- MetaTrader 5 (the bridge on the PC)

    // Make the bridge key. It is shown once: the bridge on the PC needs it, and only its SHA-256 is
    // kept here. Until this has run, nothing can ask for signals or post a report.
    async mt5Setup(body) {
      const mt5 = (await this.storage.get("mt5")) || {};
      const keepKey = !!mt5.keyHash && !body.newKey;
      const bridgeKey = keepKey ? null : randomHex(32);
      await this.storage.put("mt5", {
        keyHash: keepKey ? mt5.keyHash : await sha256Hex(bridgeKey),
        report: mt5.report || null,
        reportAt: mt5.reportAt || null,
        connectedAt: deps.now(),
      });
      const config = await this.config();
      return json({
        ok: true,
        ownerPaired: !!config.ownerId,
        bridgeKey,
        note: bridgeKey ? "Put bridgeKey in the bridge's .env as MT5_BRIDGE_KEY. It is not shown again." : "The bridge key from the first setup still works. Send newKey: true for a new one.",
      });
    }

    // The stored MT5 record when `key` is the bridge key, else null.
    async mt5For(key) {
      const mt5 = await this.storage.get("mt5");
      const given = typeof key === "string" ? key : "";
      if (!mt5 || !mt5.keyHash || !given || !safeEqual(await sha256Hex(given), mt5.keyHash)) return null;
      return mt5;
    }

    // What the bridge should hold: the practice account's open positions. { key }
    async mt5Signals(body) {
      if (!(await this.mt5For(body.key))) return json({ ok: false, error: "not allowed" }, 403);
      return json({ ok: true, ...wantedOf(await this.state(), deps.now()) });
    }

    // A report from the bridge: { key, report }. Stored, and copies that opened or closed are told
    // to the owner through TradeBot's own bot.
    async mt5Report(body) {
      const mt5 = await this.mt5For(body.key);
      if (!mt5) return json({ ok: false, error: "not allowed" }, 403);
      const report = cleanReport(body.report);
      if (!report) return json({ ok: false, error: "That is not an MT5 report." }, 400);
      await this.state(); // amounts are written in rupiah once a rate is known
      const messages = mt5Changes(mt5.report, report);
      const now = deps.now();
      await this.storage.put("mt5", { ...mt5, report, reportAt: now }); // saved before anything is sent
      await this.deliver(await this.config(), messages);
      return json({ ok: true, at: now, told: messages.length });
    }

    // ---------------------------------------------------------------- Indodax (the sender on the PC)

    // Make the sender's key. It is shown once: the sender on the PC needs it, and only its SHA-256 is
    // kept here. Until this has run, nothing can ask for signals or post a report. This key only
    // lets the sender read the practice positions and post its report: it is not an Indodax key.
    async indodaxSetup(body) {
      const indodax = (await this.storage.get("indodax")) || {};
      const keepKey = !!indodax.keyHash && !body.newKey;
      const bridgeKey = keepKey ? null : randomHex(32);
      await this.storage.put("indodax", {
        keyHash: keepKey ? indodax.keyHash : await sha256Hex(bridgeKey),
        report: indodax.report || null,
        reportAt: indodax.reportAt || null,
        silentToldAt: indodax.silentToldAt || null,
        viewHash: indodax.viewHash || null,
        connectedAt: deps.now(),
      });
      const config = await this.config();
      return json({
        ok: true,
        ownerPaired: !!config.ownerId,
        bridgeKey,
        note: bridgeKey
          ? "Put bridgeKey in the sender's .env as INDODAX_BRIDGE_KEY. It is not shown again. The sender starts in practice (pretend money)."
          : "The key from the first setup still works. Send newKey: true for a new one.",
      });
    }

    // The stored Indodax record when `key` is the sender's key, else null.
    async indodaxFor(key) {
      const indodax = await this.storage.get("indodax");
      const given = typeof key === "string" ? key : "";
      if (!indodax || !indodax.keyHash || !given || !safeEqual(await sha256Hex(given), indodax.keyHash)) return null;
      return indodax;
    }

    // What the sender should hold: the practice account's open positions, and whether the owner
    // has paused its buying from Telegram (/indodax pause). { key }
    async indodaxSignals(body) {
      if (!(await this.indodaxFor(body.key))) return json({ ok: false, error: "not allowed" }, 403);
      const state = await this.state();
      return json({ ok: true, ...wantedOf(state, deps.now()), paused: state.settings.indodaxPaused === true });
    }

    // A report from the sender: { key, report }. Stored, and copies that opened or closed (and the
    // two warnings: safety stop, real money) are told to the owner through TradeBot's own bot. The
    // first report after a silence that was told says the sender is back.
    async indodaxReport(body) {
      const indodax = await this.indodaxFor(body.key);
      if (!indodax) return json({ ok: false, error: "not allowed" }, 403);
      const read = cleanIndodaxReport(body.report);
      if (!read) return json({ ok: false, error: "That is not an Indodax report." }, 400);
      const now = deps.now();
      // The free rupiah of a minute ago is kept through a minute in which it could not be read.
      const cashAt = read.cash !== null ? now : indodax.cashAt || 0;
      const report = keepIndodaxCash(indodax.report, read, cashAt, now);
      const messages = indodaxChanges(indodax.report, report, now);
      if (indodax.silentToldAt && indodax.silentToldAt === indodax.reportAt) messages.unshift({ html: indodaxBack(report) });
      // A heads-up when the price of a held coin comes close to the sender's own stop, told once.
      const near = indodaxStopSigns(report, indodax.stopTold || {});
      messages.push(...near.messages);
      await this.storage.put("indodax", { ...indodax, report, reportAt: now, cashAt, silentToldAt: null, stopTold: near.told }); // saved before anything is sent
      await this.deliver(await this.config(), messages);
      return json({ ok: true, at: now, told: messages.length });
    }

    // The bot's command menu in Telegram is set again once after each new version, so new
    // commands show up without running the setup again. A failure is tried again next time.
    async freshCommands(config, telegram, real = false) {
      const wanted = real ? `${VERSION}:real` : VERSION;
      if (config.commandsFor === wanted) return;
      try {
        await telegram.call("setMyCommands", { commands: real ? REAL_COMMANDS : COMMANDS });
        await this.storage.put("config", { ...(await this.config()), commandsFor: wanted });
      } catch (error) {
        console.log("command menu not set: " + clip(errorText(error), 200));
      }
    }

    // /phone: make a new private link to the phone page. Only its SHA-256 is kept, and the link
    // made before stops working. The page only shows; nothing can be changed from it.
    async phoneLink(origin) {
      const indodax = (await this.storage.get("indodax")) || {};
      const key = randomHex(24);
      await this.storage.put("indodax", { ...indodax, viewHash: await sha256Hex(key) });
      const base = typeof origin === "string" && origin.startsWith("https://") ? origin : "";
      if (!base) return { html: "⚠️ I could not work out my own address, so there is no link. Nothing was changed." };
      return {
        html: [
          "📱 <b>Your live page</b>",
          `${base}/v1/indodax/phone?k=${key}`,
          "",
          "Open it on your phone and add it to the home screen. It reloads itself every minute and only shows: nothing can be bought or sold from it.",
          "Keep the link to yourself: anyone who has it can see the page. <code>/phone</code> makes a new link and switches this one off.",
        ].join("\n"),
      };
    }

    // The full report with what the strategy sees, kept for half a minute so a page that reloads
    // does not read the price sources every time.
    async indodaxSeen() {
      const now = deps.now();
      if (this.reportSeen && now - this.reportSeen.at < 30000 && now >= this.reportSeen.at) return this.reportSeen;
      const state = await this.state();
      const view = await this.indodaxLook(state);
      const extra = view.report ? await this.indodaxExtra(state, view) : null;
      this.reportSeen = { at: now, view, extra };
      return this.reportSeen;
    }

    // The desktop app, with the sender's key: the full report as data. { key }
    async indodaxViewFor(body) {
      if (!(await this.indodaxFor(body.key))) return json({ ok: false, error: "not allowed" }, 403);
      const { view, extra } = await this.indodaxSeen();
      return json({ ok: true, ...indodaxViewData(view, extra) });
    }

    // The desktop app, with the sender's key: stop new buys, or allow them again. The same switch
    // as /indodax pause and /indodax resume. Selling is never paused. { key, paused }
    async indodaxPause(body) {
      if (!(await this.indodaxFor(body.key))) return json({ ok: false, error: "not allowed" }, 403);
      if (typeof body.paused !== "boolean") return json({ ok: false, error: "Send paused: true or paused: false." }, 400);
      const state = await this.state();
      const changed = (state.settings.indodaxPaused === true) !== body.paused;
      state.settings.indodaxPaused = body.paused;
      await this.storage.put("state", state);
      this.reportSeen = null;
      if (changed) {
        const text = body.paused
          ? "⏸ <b>Indodax buying was paused from the desktop app.</b> No new copy is bought; open copies are still watched and sold."
          : "▶️ <b>Indodax buying was allowed again from the desktop app.</b>";
        await this.deliver(await this.config(), [{ html: text }]);
      }
      return json({ ok: true, paused: body.paused });
    }

    // The phone page, with the private link's key. { key }
    async indodaxPage(body) {
      const indodax = await this.storage.get("indodax");
      const given = typeof body.key === "string" ? body.key : "";
      if (!indodax || !indodax.viewHash || !given || !safeEqual(await sha256Hex(given), indodax.viewHash)) {
        return json({ ok: false, error: "not allowed" }, 403);
      }
      const { view, extra } = await this.indodaxSeen();
      const seen = { ...view, now: deps.now() };
      return json({ ok: true, page: indodaxPhonePage(indodaxFull(seen, extra).html, seen.now, seen, indodaxPlainWords(extra)) });
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
      // The Worker itself only ever trades practice money; "real" here means the sender on the owner's PC is in real mode.
      const money = inner.indodax && inner.indodax.mode === "real" ? "real at Indodax (sent from the owner's PC)" : "practice";
      return json({ ok: true, service: "trade-bot", version: VERSION, build: buildOf(env), money, ...inner });
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
      const answer = await trader.fetch(post("/update", { secret, update: update || {}, origin: url.origin }));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "GET" && path === "/v1/venues") {
      const answer = await trader.fetch(new Request(INSIDE + "/venues"));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "POST" && path === "/v1/twin/setup") {
      if (!(await hasSetupCode(request, env))) return json({ ok: false, error: "Setting up the twin's bot needs the setup code." }, 403);
      const body = await request.json().catch(() => ({}));
      const answer = await trader.fetch(
        post("/twin/setup", { token: body.token, newKey: !!body.newKey, webhookUrl: `${url.origin}/v1/twin/telegram` }),
      );
      return json(await answer.json(), answer.status);
    }

    if (request.method === "POST" && path === "/v1/twin/report") {
      const key = request.headers.get("X-Twin-Key") || "";
      if (!key) return json({ ok: false, error: "not allowed" }, 403);
      const text = await request.text();
      if (text.length > REPORT_MAX_BYTES) return json({ ok: false, error: "That report is too big." }, 413);
      let snapshot = null;
      try {
        snapshot = JSON.parse(text);
      } catch (error) {
        return json({ ok: false, error: "That is not a twin report." }, 400);
      }
      const answer = await trader.fetch(post("/twin/report", { key, snapshot }));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "POST" && path === "/v1/twin/telegram") {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
      const update = await request.json().catch(() => null);
      if (!secret) return json({ ok: false, error: "not allowed" }, 403);
      const answer = await trader.fetch(post("/twin/update", { secret, update: update || {} }));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "POST" && path === "/v1/mt5/setup") {
      if (!(await hasSetupCode(request, env))) return json({ ok: false, error: "Setting up the MT5 bridge needs the setup code." }, 403);
      const body = await request.json().catch(() => ({}));
      const answer = await trader.fetch(post("/mt5/setup", { newKey: !!body.newKey }));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "GET" && path === "/v1/mt5/signals") {
      const key = request.headers.get("X-Mt5-Key") || "";
      if (!key) return json({ ok: false, error: "not allowed" }, 403);
      const answer = await trader.fetch(post("/mt5/signals", { key }));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "POST" && path === "/v1/mt5/report") {
      const key = request.headers.get("X-Mt5-Key") || "";
      if (!key) return json({ ok: false, error: "not allowed" }, 403);
      const text = await request.text();
      if (text.length > REPORT_MAX_BYTES) return json({ ok: false, error: "That report is too big." }, 413);
      let report = null;
      try {
        report = JSON.parse(text);
      } catch (error) {
        return json({ ok: false, error: "That is not an MT5 report." }, 400);
      }
      const answer = await trader.fetch(post("/mt5/report", { key, report }));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "POST" && path === "/v1/indodax/setup") {
      if (!(await hasSetupCode(request, env))) return json({ ok: false, error: "Setting up the Indodax sender needs the setup code." }, 403);
      const body = await request.json().catch(() => ({}));
      const answer = await trader.fetch(post("/indodax/setup", { newKey: !!(body && body.newKey) }));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "GET" && path === "/v1/indodax/signals") {
      const key = request.headers.get("X-Indodax-Key") || "";
      if (!key) return json({ ok: false, error: "not allowed" }, 403);
      const answer = await trader.fetch(post("/indodax/signals", { key }));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "POST" && path === "/v1/indodax/report") {
      const key = request.headers.get("X-Indodax-Key") || "";
      if (!key) return json({ ok: false, error: "not allowed" }, 403);
      const text = await request.text();
      if (text.length > REPORT_MAX_BYTES) return json({ ok: false, error: "That report is too big." }, 413);
      let report = null;
      try {
        report = JSON.parse(text);
      } catch (error) {
        return json({ ok: false, error: "That is not an Indodax report." }, 400);
      }
      const answer = await trader.fetch(post("/indodax/report", { key, report }));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "GET" && path === "/v1/indodax/view") {
      const key = request.headers.get("X-Indodax-Key") || "";
      if (!key) return json({ ok: false, error: "not allowed" }, 403);
      const answer = await trader.fetch(post("/indodax/view", { key }));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "POST" && path === "/v1/indodax/pause") {
      const key = request.headers.get("X-Indodax-Key") || "";
      if (!key) return json({ ok: false, error: "not allowed" }, 403);
      const body = await request.json().catch(() => ({}));
      const answer = await trader.fetch(post("/indodax/pause", { key, paused: body ? body.paused : undefined }));
      return json(await answer.json(), answer.status);
    }

    if (request.method === "GET" && path === "/v1/indodax/phone") {
      const key = url.searchParams.get("k") || "";
      const answer = key ? await trader.fetch(post("/indodax/page", { key })) : null;
      const data = answer && answer.status === 200 ? await answer.json() : null;
      const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
      if (!data || !data.page) {
        const gone = "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>TradeBot</title><p style=\"font:16px system-ui;padding:20px\">This link does not work (any more). Send /phone to the bot in Telegram for a new one.</p>";
        return new Response(gone, { status: 403, headers });
      }
      return new Response(data.page, { headers });
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
