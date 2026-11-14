import assert from "node:assert/strict";
import { test } from "node:test";

import { TICK_MS } from "../src/agent.js";
import { nearest } from "../src/bot.js";
import { createWorker } from "../src/index.js";
import { TIMEFRAMES } from "../src/market.js";
import { sha256Hex } from "../src/util.js";
import { FakeNamespace, binanceRows, fakeFetch, makeCandles, makeClock, reply } from "./fakes.js";

const TOKEN = "123456789:AAfake_token_for_tests_only_0123456789";
const SETUP_CODE = "open-sesame";
const HOST = "https://trade-bot.test";
const OWNER = 111;
const STRANGER = 222;

// The whole Worker with a pretend Telegram, pretend price sources and a clock moved by hand.
async function harness() {
  const now = makeClock();
  const scene = { BTCUSDT: { trend: "up" }, ETHUSDT: { trend: "down" }, SOLUSDT: { trend: "down" } };
  const sent = []; // every Bot API call: { method, ...params }
  const fetch = fakeFetch([
    [
      `https://api.telegram.org/bot${TOKEN}/`,
      (url, init) => {
        const method = url.split("/").pop();
        sent.push({ method, ...JSON.parse(init.body) });
        if (method === "getMe") return reply({ ok: true, result: { id: 999, username: "juwen_trade_bot", first_name: "TradeBot" } });
        return reply({ ok: true, result: method === "sendMessage" ? { message_id: sent.length } : true });
      },
    ],
    ["https://api.telegram.org/", () => reply({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 })],
    [
      "https://data-api.binance.vision/",
      (url) => {
        const query = new URL(url).searchParams;
        const market = scene[query.get("symbol")];
        if (!market) return reply({ code: -1121, msg: "Invalid symbol." }, { status: 400 });
        const candles = makeCandles({ now: now(), timeframeMs: TIMEFRAMES[query.get("interval")].ms, count: Number(query.get("limit")), ...market });
        return reply(binanceRows(candles));
      },
    ],
    ["https://www.okx.com/", () => reply({ code: "51001", msg: "Instrument ID does not exist", data: [] })],
    ["https://www.cloudflare.com/cdn-cgi/trace", () => new Response("fl=1\nloc=SG\ncolo=SIN\n")],
  ]);
  const { worker, Trader } = createWorker({ fetch, now });
  const env = { BUILD: "test", SETUP_CODE_SHA256: `${"0".repeat(64)},${await sha256Hex(SETUP_CODE)}` };
  env.TRADER = new FakeNamespace(Trader, env, now);
  const storage = () => env.TRADER.object("main").storage;

  const call = async (method, path, { headers = {}, body } = {}) => {
    const response = await worker.fetch(new Request(HOST + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  let updateId = 1000;
  const webhook = async (update, secret) => {
    const config = (await storage().get("config")) || {};
    return call("POST", "/v1/telegram", {
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret === undefined ? config.secret : secret },
      body: { update_id: ++updateId, ...update },
    });
  };
  const texts = [];
  // Send a message (or tap a button) and get back the texts the bot sent in answer.
  const exchange = async (update) => {
    const before = sent.length;
    const answer = await webhook(update);
    assert.equal(answer.status, 200);
    return sent.slice(before);
  };
  const say = async (text, from = OWNER) => {
    const calls = await exchange({ message: { message_id: 1, from: { id: from }, chat: { id: from, type: "private" }, text } });
    return calls.filter((entry) => entry.method === "sendMessage").map((entry) => entry.text).join("\n---\n");
  };
  const tap = (data, text = "question", from = OWNER) =>
    exchange({ callback_query: { id: "cb1", from: { id: from }, data, message: { message_id: 7, chat: { id: from, type: "private" }, text } } });
  const round = async () => {
    const before = sent.length;
    await env.TRADER.runAlarms();
    return sent.slice(before).filter((entry) => entry.method === "sendMessage").map((entry) => entry.text).join("\n---\n");
  };
  const connect = async () => {
    const answer = await call("POST", "/v1/setup", { headers: { "X-Setup-Code": SETUP_CODE }, body: { token: TOKEN } });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    return answer.body;
  };
  const pair = async () => {
    const { pairLink } = await connect();
    return say("/start " + pairLink.split("start=")[1]);
  };
  return { now, scene, sent, fetch, env, storage, call, webhook, say, tap, round, connect, pair, texts };
}

test("before setup the worker is alive, unconfigured and trades practice money only", async () => {
  const { call } = await harness();
  const status = await call("GET", "/v1/status");
  assert.equal(status.status, 200);
  assert.deepEqual(
    { ...status.body, version: "x" },
    { ok: true, service: "trade-bot", version: "x", build: "test", money: "practice", configured: false, bot: null, paired: false, running: false, lastRound: null, rupiah: null },
  );
  assert.equal((await call("GET", "/nope")).status, 404);
  assert.equal((await call("POST", "/v1/telegram", { headers: { "X-Telegram-Bot-Api-Secret-Token": "guess" }, body: { update_id: 1 } })).status, 403);
});

test("setup needs the setup code and a real token, then points the webhook here", async () => {
  const { call, connect, sent, storage } = await harness();
  assert.equal((await call("POST", "/v1/setup", { body: { token: TOKEN } })).status, 403);
  assert.equal((await call("POST", "/v1/setup", { headers: { "X-Setup-Code": "wrong" }, body: { token: TOKEN } })).status, 403);
  const bad = await call("POST", "/v1/setup", { headers: { "X-Setup-Code": SETUP_CODE }, body: { token: "hello" } });
  assert.equal(bad.status, 400);
  const refused = await call("POST", "/v1/setup", { headers: { "X-Setup-Code": SETUP_CODE }, body: { token: "987654321:AAnot_the_token_telegram_knows_0123456789" } });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /Telegram did not accept the token/);

  const answer = await connect();
  assert.equal(answer.bot.username, "juwen_trade_bot");
  assert.equal(answer.webhook, HOST + "/v1/telegram");
  assert.match(answer.pairLink, /^https:\/\/t\.me\/juwen_trade_bot\?start=[0-9a-f]{32}$/);
  assert.equal(JSON.stringify(answer).includes(TOKEN), false);

  const hook = sent.find((entry) => entry.method === "setWebhook");
  const config = await storage().get("config");
  assert.equal(hook.secret_token, config.secret);
  assert.deepEqual(hook.allowed_updates, ["message", "callback_query"]);
  assert.ok(sent.find((entry) => entry.method === "setMyCommands").commands.some((entry) => entry.command === "status"));

  const status = (await call("GET", "/v1/status")).body;
  assert.deepEqual([status.configured, status.paired, status.running, status.bot], [true, false, false, "juwen_trade_bot"]);
  assert.equal(JSON.stringify(status).includes(TOKEN), false);
});

test("only the pairing link makes an owner; everyone else is turned away", async () => {
  const { connect, say, webhook, sent, call, storage, round } = await harness();
  const { pairLink } = await connect();
  const code = pairLink.split("start=")[1];

  assert.match(await say("/start", STRANGER), /not paired yet/);
  assert.match(await say("/start wrongcode", STRANGER), /not paired yet/);
  assert.equal((await webhook({ message: { from: { id: OWNER }, chat: { id: OWNER, type: "private" }, text: "/status" } }, "wrong-secret")).status, 403);

  const welcome = await say("/start " + code);
  assert.match(welcome, /You are the owner/);
  assert.match(welcome, /\$10,000\.00/);
  assert.match(welcome, /Not financial advice/);
  assert.equal((await storage().get("config")).ownerId, OWNER);

  // The link works once.
  assert.match(await say("/start " + code, STRANGER), /This bot is private/);
  assert.match(await say("/status", STRANGER), /This bot is private/);
  assert.ok(sent.filter((entry) => entry.chat_id === STRANGER).every((entry) => !/Value|\$/.test(entry.text)));

  // The agent starts by itself: the first round runs at once and buys the rising market.
  assert.equal((await call("GET", "/v1/status")).body.running, true);
  const first = await round();
  assert.match(first, /Bought BTC/);
  assert.equal(sent[sent.length - 1].chat_id, OWNER);
  const status = (await call("GET", "/v1/status")).body;
  assert.deepEqual(status.lastRound.markets, 3);
  assert.equal(status.lastRound.errors, 0);
});

test("the agent keeps its 5-minute rhythm, stops out, and reports it in /status and /history", async () => {
  const { now, scene, pair, round, say, storage } = await harness();
  await pair();
  assert.match(await round(), /Bought BTC/);
  assert.equal(await storage().getAlarm(), now() + TICK_MS);

  const holding = await say("/status");
  assert.match(holding, /Practice account/);
  assert.match(holding, /• <b>BTC<\/b>/);
  assert.match(holding, /Agent: trading alone · 4h candles · risk 1% per trade/);

  assert.equal(await round(), "", "nothing is due before five minutes pass");
  scene.BTCUSDT.drop = 0.2;
  now.advance(TICK_MS);
  const stopped = await round();
  assert.match(stopped, /Sold BTC/);
  assert.match(stopped, /stop hit/);

  assert.match(await say("/status"), /Holding nothing right now/);
  const history = await say("/history");
  assert.match(history, /Closed trades<\/b>: 1, 0 won/);
  assert.match(history, /🔴 BTC -\$/);
});

test("a failing round still rings again", async () => {
  const { now, pair, env, storage } = await harness();
  await pair();
  await storage().put("state", "not a state");
  await env.TRADER.runAlarms();
  assert.equal(await storage().getAlarm(), now() + TICK_MS);
});

test("ask mode: the owner approves or skips each buy with a button", async () => {
  const { pair, say, round, tap, sent, now } = await harness();
  await pair();
  assert.match(await say("/auto off"), /I ask you before every buy/);
  const offer = sent.slice(-1)[0] && (await round());
  assert.match(offer, /Buy BTC\?/);
  const keyboard = sent.filter((entry) => entry.method === "sendMessage").pop().reply_markup.inline_keyboard;
  assert.deepEqual(keyboard[0].map((button) => button.callback_data), ["ok:BTCUSDT", "no:BTCUSDT"]);
  assert.match(await say("/status"), /Holding nothing right now/);

  // A stranger tapping the button gets nothing.
  const stranger = await tap("ok:BTCUSDT", "Buy BTC?", STRANGER);
  assert.deepEqual(stranger.map((entry) => entry.method), ["answerCallbackQuery"]);
  assert.match(stranger[0].text, /private/);

  const approved = await tap("ok:BTCUSDT", "Buy BTC?");
  assert.deepEqual(approved.map((entry) => entry.method), ["answerCallbackQuery", "editMessageText", "sendMessage"]);
  assert.match(approved[1].text, /Approved/);
  assert.deepEqual(approved[1].reply_markup, { inline_keyboard: [] });
  assert.match(approved[2].text, /Bought BTC/);

  // The same button a second time: the offer is gone.
  const again = await tap("ok:BTCUSDT", "Buy BTC?");
  assert.match(again[0].text, /Already bought/);
  assert.ok(now() > 0);
});

test("a repeated update is handled once", async () => {
  const { pair, call, storage, sent } = await harness();
  await pair();
  const config = await storage().get("config");
  const update = { update_id: 5, message: { from: { id: OWNER }, chat: { id: OWNER, type: "private" }, text: "/pause" } };
  const post = () => call("POST", "/v1/telegram", { headers: { "X-Telegram-Bot-Api-Secret-Token": config.secret }, body: update });
  const before = sent.length;
  assert.deepEqual((await post()).body, { ok: true });
  assert.deepEqual((await post()).body, { ok: true, duplicate: true });
  assert.equal(sent.length - before, 1);
});

test("commands: trading by hand, the watchlist, settings, backtest and reset", async () => {
  const { pair, say, round, scene, tap, storage } = await harness();
  await pair();
  assert.match(await say("/pause"), /Paused/);
  assert.equal(await round(), "", "paused: the first round buys nothing");

  assert.match(await say("/help"), /\/backtest BTC/);
  assert.match(await say("hello"), /I only understand commands/);
  assert.match(await say("/nonsense"), /I only understand commands/);

  // By hand.
  assert.match(await say("/buy"), /Say what to buy/);
  assert.match(await say("/buy ETH 500"), /Bought ETH[\s\S]*\$500\.00[\s\S]*I will look after it/);
  assert.match(await say("/buy ETH 500"), /Already holding ETH/);
  assert.match(await say("/buy BTC 99999999"), /Only \$9,500\.00 of cash is left/);
  assert.match(await say("/buy NOPE 50"), /Not bought[\s\S]*cannot find a NOPE\/USDT market/);
  assert.match(await say("/buy BTC -5"), /amount is in dollars/);
  assert.match(await say("/sell BTC"), /Not holding BTC/);
  assert.match(await say("/sell all"), /Sold ETH/);
  assert.match(await say("/sell all"), /Holding nothing/);

  // The watchlist.
  scene.DOGEUSDT = { trend: "up", start: 0.1 };
  assert.match(await say("/watch doge"), /Watching <b>DOGE<\/b>, now \$/);
  assert.match(await say("/watch DOGE"), /Already watching/);
  assert.match(await say("/watch NOPE"), /cannot find a NOPE\/USDT market/);
  assert.match(await say("/watchlist"), /BTC, ETH, SOL, DOGE/);
  assert.match(await say("/unwatch SOL"), /Stopped watching SOL/);
  assert.match(await say("/unwatch SOL"), /not on the watchlist/);

  // Signals explain themselves; a buy that is blocked says why.
  const signals = await say("/signals");
  assert.match(signals, /<b>BTC<\/b> \$[\d,.]+: <b>BUY<\/b>/);
  assert.match(signals, /✅ Trend: price above the 200-candle average/);
  assert.match(signals, /but not buying: buying is paused/);
  assert.match(signals, /<b>ETH<\/b> \$[\d,.]+: <b>WAIT<\/b>/);
  assert.match(signals, /❌ Momentum/);

  // Settings.
  assert.match(await say("/risk"), /Risk is <b>1%<\/b>/);
  assert.match(await say("/risk 2"), /now <b>2%<\/b>/);
  assert.match(await say("/risk 50"), /between 0.1 and 5/);
  assert.match(await say("/timeframe"), /I read <b>4h<\/b> candles/);
  assert.match(await say("/timeframe 1h"), /I now read <b>1h<\/b> candles/);
  assert.match(await say("/timeframe 7m"), /Choose one of: 15m, 1h, 4h, 1d/);
  assert.match(await say("/auto"), /Auto is <b>on<\/b>/);
  assert.match(await say("/resume"), /Resumed/);

  // Backtest: the rules on past prices, next to simply holding.
  const tested = await say("/backtest BTC");
  assert.match(tested, /Backtest<\/b> · 1h candles/);
  assert.match(tested, /<b>BTC<\/b> · last \d+ days \(Binance\)/);
  assert.match(tested, /Bot:  \+[\d.]+% · worst drop -[\d.]+%/);
  assert.match(tested, /Hold: \+[\d.]+%/);
  assert.match(await say("/backtest"), /<b>DOGE<\/b> · last/);

  // Reset asks first.
  assert.match(await say("/reset 50"), /between \$100\.00 and/);
  assert.match(await say("/reset 5000"), /Start over with <b>\$5,000\.00<\/b>/);
  assert.equal((await storage().get("state")).trades.length, 2);
  const kept = await tap("keep", "Start over?");
  assert.match(kept[1].text, /Kept as it is/);
  const fresh = await tap("reset:5000", "Start over?");
  assert.match(fresh[2].text, /Fresh start with <b>\$5,000\.00<\/b>/);
  const state = await storage().get("state");
  assert.equal(state.portfolio.cash, 5000);
  assert.deepEqual(state.trades, []);
  assert.equal(state.settings.riskPct, 2, "settings survive a reset");
  assert.deepEqual(state.settings.watchlist, ["BTCUSDT", "ETHUSDT", "DOGEUSDT"]);
});

test("the probe asks every price source from inside the worker and remembers the answer", async () => {
  const { call, fetch } = await harness();
  const probe = (await call("GET", "/v1/probe")).body;
  assert.equal(probe.ok, true);
  assert.equal(probe.where, "SG/SIN");
  assert.equal(probe.sources.Binance.ok, true);
  assert.equal(probe.sources.Binance.candles, 5);
  assert.ok(probe.sources.Binance.price > 0);
  assert.equal(probe.sources.OKX.ok, false);
  const calls = fetch.calls.length;
  await call("GET", "/v1/probe");
  assert.equal(fetch.calls.length, calls, "a second look within five minutes costs nothing");
});

test("a new pairing link takes the bot away from the old owner", async () => {
  const { pair, call, say, env, storage } = await harness();
  await pair();
  const answer = await call("POST", "/v1/setup", { headers: { "X-Setup-Code": SETUP_CODE }, body: { newPairing: true } });
  assert.equal(answer.status, 200);
  assert.match(answer.body.pairLink, /start=/);
  assert.match(await say("/status"), /not paired yet/);
  await env.TRADER.runAlarms();
  assert.equal(await storage().getAlarm(), null, "no owner, no rounds");
  assert.match(await say("/start " + answer.body.pairLink.split("start=")[1], STRANGER), /You are the owner/);
});

test("typos and everyday words: showing is done with a note, acting is only offered", async () => {
  const { pair, say, storage } = await harness();
  await pair();
  assert.equal(nearest("stauts"), "status");
  assert.equal(nearest("sel"), "sell");
  assert.equal(nearest("hist"), "history");
  assert.equal(nearest("nonsense"), null);
  assert.equal(nearest("constructor"), null);

  // A misspelled command that only shows something is simply run.
  const status = await say("/stauts");
  assert.match(status, /I read \/stauts as \/status/);
  assert.match(status, /practice/);

  // One that would change the account is offered, never done.
  const before = await storage().get("state");
  const sell = await say("/sel DOGE");
  assert.match(sell, /Did you mean <code>\/sell DOGE<\/code>\? Nothing was done/);
  assert.match(await say("/paus"), /Did you mean <code>\/pause<\/code>/);
  const after = await storage().get("state");
  assert.equal(after.settings.paused, before.settings.paused);
  assert.deepEqual(after.trades, before.trades);

  // Everyday words that clearly ask to see something.
  assert.match(await say("how is it going?"), /I read that as \/status/);
  assert.match(await say("status"), /I read that as \/status/);
  assert.match(await say("buy BTC 100"), /Did you mean <code>\/buy BTC 100<\/code>/);

  // Everything else is turned away in plain words.
  assert.match(await say("hello"), /I only understand commands/);
  assert.match(await say("/nonsense"), /I only understand commands/);
  assert.match(await say("/constructor"), /I only understand commands/);
});
