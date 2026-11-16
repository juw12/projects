import assert from "node:assert/strict";
import { test } from "node:test";

import { TICK_MS } from "../src/agent.js";
import { nearest } from "../src/bot.js";
import { createWorker } from "../src/index.js";
import { TIMEFRAMES } from "../src/market.js";
import { sha256Hex } from "../src/util.js";
import { FakeNamespace, binanceRows, fakeFetch, fakeLuno, makeCandles, makeClock, reply } from "./fakes.js";

const TOKEN = "123456789:AAfake_token_for_tests_only_0123456789";
const TWIN_TOKEN = "555000111:AAtwin_token_for_tests_only_0123456789"; // the twin's own bot
const SETUP_CODE = "open-sesame";
const HOST = "https://trade-bot.test";
const OWNER = 111;
const STRANGER = 222;

// The whole Worker with a pretend Telegram, pretend price sources and a clock moved by hand.
// routes: extra pretend addresses for one test, asked before the usual ones.
async function harness({ routes = [] } = {}) {
  const now = makeClock();
  const scene = { BTCUSDT: { trend: "up" }, ETHUSDT: { trend: "down" }, SOLUSDT: { trend: "down" } };
  const sent = []; // every Bot API call: { method, ...params }
  const twinSent = []; // the same, for the twin's bot
  const fetch = fakeFetch([
    ...routes,
    [
      `https://api.telegram.org/bot${TWIN_TOKEN}/`,
      (url, init) => {
        const method = url.split("/").pop();
        twinSent.push({ method, ...JSON.parse(init.body) });
        if (method === "getMe") return reply({ ok: true, result: { id: 888, username: "juwen_twin_bot", first_name: "TradeBot Twin" } });
        return reply({ ok: true, result: method === "sendMessage" ? { message_id: twinSent.length } : true });
      },
    ],
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

  // The twin: connect its bot, send a report as the PC would, and talk to its bot.
  const twinConnect = async (body = { token: TWIN_TOKEN }) => {
    const answer = await call("POST", "/v1/twin/setup", { headers: { "X-Setup-Code": SETUP_CODE }, body });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    return answer.body;
  };
  const twinReport = (key, snapshot) => call("POST", "/v1/twin/report", { headers: key ? { "X-Twin-Key": key } : {}, body: snapshot });
  const twinTexts = (from) => twinSent.slice(from).filter((entry) => entry.method === "sendMessage").map((entry) => entry.text).join("\n---\n");
  const twinSay = async (text, from = OWNER, chat = { id: from, type: "private" }) => {
    const twin = (await storage().get("twin")) || {};
    const before = twinSent.length;
    const answer = await call("POST", "/v1/twin/telegram", {
      headers: { "X-Telegram-Bot-Api-Secret-Token": twin.secret },
      body: { update_id: ++updateId, message: { message_id: 1, from: { id: from }, chat, text } },
    });
    assert.equal(answer.status, 200);
    return twinTexts(before);
  };
  return { now, scene, sent, twinSent, fetch, env, storage, call, webhook, say, tap, round, connect, pair, texts, twinConnect, twinReport, twinTexts, twinSay };
}

test("before setup the worker is alive, unconfigured and trades practice money only", async () => {
  const { call } = await harness();
  const status = await call("GET", "/v1/status");
  assert.equal(status.status, 200);
  assert.deepEqual(
    { ...status.body, version: "x" },
    { ok: true, service: "trade-bot", version: "x", build: "test", money: "practice", configured: false, bot: null, paired: false, running: false, lastRound: null, rupiah: null, twin: { configured: false, bot: null, lastReportAt: null }, mt5: { configured: false, lastReportAt: null, demo: null }, indodax: { configured: false, lastReportAt: null, mode: null, paused: false, keys: null, checked: null, tripped: null, openCopies: null, realOpen: null } },
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

// ---------------------------------------------------------------- the twin's bot and the exchange check

// What the PC's reporter sends (see freqtrade/twin_report.py).
function twinSnapshot(extra = {}) {
  return {
    state: "running",
    dryRun: true,
    strategy: "TradeBotTrend",
    exchange: "gate",
    timeframe: "4h",
    stake: "USDT",
    maxOpen: 3,
    balance: { total: 10000, free: 10000, start: 10000 },
    profit: { closed: 0, all: 0, allPct: 0, trades: 0, closedTrades: 0, wins: 0, losses: 0 },
    open: [],
    closed: [],
    ...extra,
  };
}

test("the twin's bot: setup needs the code and a second bot, keeps waiting messages, and shows the report key once", async () => {
  const { call, connect, twinConnect, twinReport, twinSent, sent, storage } = await harness();
  assert.equal((await call("POST", "/v1/twin/setup", { body: { token: TWIN_TOKEN } })).status, 403);
  assert.equal((await call("POST", "/v1/twin/setup", { headers: { "X-Setup-Code": "wrong" }, body: { token: TWIN_TOKEN } })).status, 403);
  assert.equal((await call("POST", "/v1/twin/setup", { headers: { "X-Setup-Code": SETUP_CODE }, body: {} })).status, 400, "no token yet");
  assert.equal((await call("POST", "/v1/twin/setup", { headers: { "X-Setup-Code": SETUP_CODE }, body: { token: "hello" } })).status, 400);

  // TradeBot's own token cannot serve both bots: its webhook would be taken away.
  await connect();
  const mainCalls = sent.length;
  const own = await call("POST", "/v1/twin/setup", { headers: { "X-Setup-Code": SETUP_CODE }, body: { token: TOKEN } });
  assert.equal(own.status, 400);
  assert.match(own.body.error, /TradeBot's own bot/);
  assert.deepEqual(sent.slice(mainCalls).map((entry) => entry.method), ["getMe"], "TradeBot's webhook was not touched");

  const first = await twinConnect();
  assert.equal(first.bot.username, "juwen_twin_bot");
  assert.equal(first.webhook, HOST + "/v1/twin/telegram");
  assert.equal(first.ownerPaired, false);
  assert.match(first.reportKey, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(first).includes(TWIN_TOKEN), false);

  const hook = twinSent.find((entry) => entry.method === "setWebhook");
  const twin = await storage().get("twin");
  assert.equal(hook.url, HOST + "/v1/twin/telegram");
  assert.equal(hook.secret_token, twin.secret);
  assert.deepEqual(hook.allowed_updates, ["message"]);
  assert.equal("drop_pending_updates" in hook, false, "a /start sent while the bot was deaf still gets its answer");
  assert.deepEqual(twinSent.find((entry) => entry.method === "setMyCommands").commands.map((entry) => entry.command), ["status", "profit", "trades", "help"]);

  // Only the key's hash is kept.
  assert.equal(JSON.stringify(twin).includes(first.reportKey), false);
  assert.equal(twin.keyHash, await sha256Hex(first.reportKey));

  const status = (await call("GET", "/v1/status")).body;
  assert.deepEqual(status.twin, { configured: true, bot: "juwen_twin_bot", lastReportAt: null });
  assert.equal(JSON.stringify(status).includes(TWIN_TOKEN), false);

  // Setting up again (no token needed) keeps the key, so the PC's reporter keeps working.
  const again = await twinConnect({});
  assert.equal(again.reportKey, null);
  assert.match(again.note, /still works/);
  assert.equal((await twinReport(first.reportKey, twinSnapshot())).status, 200);
  assert.equal((await storage().get("twin")).secret, twin.secret);

  // A new key on request: the old one stops working.
  const renewed = await twinConnect({ newKey: true });
  assert.match(renewed.reportKey, /^[0-9a-f]{64}$/);
  assert.notEqual(renewed.reportKey, first.reportKey);
  assert.equal((await twinReport(first.reportKey, twinSnapshot())).status, 403);
  assert.equal((await twinReport(renewed.reportKey, twinSnapshot())).status, 200);
});

test("twin reports: only the report key gets in, the numbers are kept, and buys and sells are told to the owner", async () => {
  const { call, pair, twinConnect, twinReport, twinSent, twinTexts, sent, storage, now } = await harness();
  assert.equal((await twinReport("a".repeat(64), twinSnapshot())).status, 403, "no twin connected yet");
  await pair();
  const { reportKey, ownerPaired } = await twinConnect();
  assert.equal(ownerPaired, true);

  assert.equal((await twinReport("", twinSnapshot())).status, 403);
  assert.equal((await twinReport("b".repeat(64), twinSnapshot())).status, 403);
  assert.equal((await twinReport(reportKey, [1, 2, 3])).status, 400);
  const notJson = await call("POST", "/v1/twin/report", { headers: { "X-Twin-Key": reportKey } });
  assert.equal(notJson.status, 400);
  const huge = await twinReport(reportKey, twinSnapshot({ strategy: "x".repeat(40000) }));
  assert.equal(huge.status, 413);
  assert.equal((await storage().get("twin")).snapshot, null, "nothing refused was kept");

  const mainCalls = sent.length;
  const before = twinSent.length;
  const first = await twinReport(reportKey, twinSnapshot({ secret: "not kept" }));
  assert.deepEqual(first.body, { ok: true, at: now(), told: 0 });
  assert.equal((await call("GET", "/v1/status")).body.twin.lastReportAt, now());
  assert.equal("secret" in (await storage().get("twin")).snapshot, false);

  const open = { id: 7, pair: "BTC/USDT", amount: 0.03, openRate: 100000, rate: 100500, stake: 3000, profit: 15, profitPct: 0.5, openedAt: now() };
  now.advance(60000);
  const bought = await twinReport(reportKey, twinSnapshot({ open: [open], balance: { total: 10015, free: 7000, start: 10000 } }));
  assert.equal(bought.body.told, 1);
  assert.match(twinTexts(before), /Twin bought BTC<\/b> · pretend money\n\$3,000\.00 at \$100,000\.00/);
  assert.equal(twinSent[twinSent.length - 1].chat_id, OWNER);

  now.advance(60000);
  assert.equal((await twinReport(reportKey, twinSnapshot({ open: [open] }))).body.told, 0, "nothing changed, nothing said");

  now.advance(60000);
  const closed = { id: 7, pair: "BTC/USDT", profit: 120, profitPct: 4, closedAt: now(), reason: "exit_signal" };
  const result = { closed: 120, all: 120, allPct: 1.2, trades: 1, closedTrades: 1, wins: 1, losses: 0 };
  const sold = await twinReport(reportKey, twinSnapshot({ closed: [closed], profit: result }));
  assert.equal(sold.body.told, 1);
  assert.match(twinTexts(before), /Twin sold BTC<\/b>[\s\S]*Result: <b>\+\$120\.00<\/b> \(\+4[\s\S]*the rules said sell/);

  assert.equal(sent.length, mainCalls, "TradeBot's own bot said nothing: the twin speaks through its own bot");
});

test("the twin's bot answers TradeBot's owner only, and says when the PC has gone quiet", async () => {
  const { call, connect, say, twinConnect, twinReport, twinSay, twinSent, storage, now } = await harness();
  const { pairLink } = await connect();
  const { reportKey } = await twinConnect();
  const twin = await storage().get("twin");
  const update = (id, text) => ({ update_id: id, message: { message_id: 1, from: { id: OWNER }, chat: { id: OWNER, type: "private" }, text } });

  // Telegram's secret is the only way in.
  for (const secret of ["", "guess", (await storage().get("config")).secret]) {
    const refused = await call("POST", "/v1/twin/telegram", { headers: { "X-Telegram-Bot-Api-Secret-Token": secret }, body: update(1, "/status") });
    assert.equal(refused.status, 403);
  }
  assert.equal(twinSent.filter((entry) => entry.method === "sendMessage").length, 0);

  // TradeBot has no owner yet, so the twin's bot has nobody to answer.
  assert.match(await twinSay("/start"), /TradeBot has no owner yet/);
  await say("/start " + pairLink.split("start=")[1]);

  assert.match(await twinSay("/status", STRANGER), /This bot is private/);
  assert.equal(await twinSay("/status", OWNER, { id: -500, type: "group" }), "", "groups are ignored");

  // His /start from before the PC ever reported.
  const hello = await twinSay("/start");
  assert.match(hello, /TradeBot's twin/);
  assert.match(hello, /I have not heard from the twin yet/);

  assert.equal((await twinReport(reportKey, twinSnapshot())).status, 200);
  const live = await twinSay("/status");
  assert.match(live, /Value: <b>\$10,000\.00<\/b>/);
  assert.match(live, /Last heard from the twin: just now\./);
  assert.match(await twinSay("/profit"), /No trade has closed yet/);
  assert.match(await twinSay("/forceexit all"), /I cannot buy, sell or stop it from here/);

  now.advance(45 * 60000);
  const old = await twinSay("/status");
  assert.match(old, /⚠️ Last heard from the twin 45 minutes ago/);
  assert.match(old, /these numbers are old/);

  // Telegram repeats an update when the answer was slow: answered once.
  const post = () => call("POST", "/v1/twin/telegram", { headers: { "X-Telegram-Bot-Api-Secret-Token": twin.secret }, body: update(77, "/help") });
  const before = twinSent.length;
  assert.deepEqual((await post()).body, { ok: true });
  assert.deepEqual((await post()).body, { ok: true, duplicate: true });
  assert.equal(twinSent.length - before, 1);
});

test("the exchange check asks the Indonesian exchanges from inside the worker and remembers the answer", async () => {
  const { call, fetch } = await harness({
    routes: [
      ["https://indodax.com/api/ticker/btcidr", () => reply({ ticker: { last: "1734567000" } })],
      ["https://indodax.com/tapi", () => reply({ success: 0, error: "Bad sign.", error_code: "invalid_credentials" })],
      ["https://www.tokocrypto.com/", () => new Response("<html>blocked</html>", { status: 403 })],
    ],
  });
  const answer = await call("GET", "/v1/venues");
  assert.equal(answer.status, 200);
  assert.equal(answer.body.ok, true);
  assert.equal(answer.body.where, "SG/SIN");
  assert.equal(answer.body.venues.Indodax.btcIdr, 1734567000);
  assert.equal(answer.body.venues["Indodax orders"].ok, true);
  assert.equal(answer.body.venues.Tokocrypto.ok, false);
  assert.equal(answer.body.venues.Tokocrypto.status, 403);
  assert.equal(answer.body.venues.Luno.ok, false);
  const calls = fetch.calls.length;
  await call("GET", "/v1/venues");
  assert.equal(fetch.calls.length, calls, "a second look within five minutes costs nothing");
});

test("the real-money check reads Luno without keys: bitcoin would be copied, ETH and SOL would not", async () => {
  const luno = fakeLuno();
  const { call } = await harness({
    routes: [
      ["https://indodax.com/api/ticker/usdtidr", () => reply({ ticker: { last: "16500" } })],
      ["https://api.luno.com/", (url, init) => luno.fetch(url, init)],
    ],
  });
  const answer = await call("GET", "/v1/live");
  assert.equal(answer.status, 200);
  assert.equal(answer.body.ok, true);
  assert.equal(answer.body.exchange, "Luno");
  assert.equal(answer.body.quote, "IDR");
  assert.equal(answer.body.maxSpreadPercent, 0.5);
  assert.equal(answer.body.mode, "off");
  assert.equal(answer.body.armed, false);
  assert.equal(answer.body.markets.BTCUSDT.market, "XBTIDR");
  assert.equal(answer.body.markets.BTCUSDT.copied, true);
  assert.ok(answer.body.markets.BTCUSDT.spreadPercent < 0.5);
  assert.equal(answer.body.markets.ETHUSDT.copied, false);
  assert.match(answer.body.markets.ETHUSDT.refused, /apart/);
  assert.equal(answer.body.markets.SOLUSDT.copied, false);
  assert.match(answer.body.markets.SOLUSDT.refused, /too few SOL offers/);
  assert.ok(luno.requests.length > 0, "Luno was asked");
  assert.ok(luno.requests.every((request) => !request.headers.Authorization), "no key was sent");
  assert.equal(luno.orders().length, 0);
});

// ---------------------------------------------------------------- MetaTrader 5 (the bridge on the PC)

// What the bridge sends when the demo account holds nothing.
function mt5Report(extra = {}) {
  return { loggedIn: true, demo: true, tradeAllowed: true, server: "MetaQuotes-Demo", currency: "USD", leverage: 100, balance: 10000, equity: 10000, positions: [], notes: [], ...extra };
}

const MT5_SETUP = { headers: { "X-Setup-Code": SETUP_CODE }, body: {} };

test("mt5: setup needs the setup code, shows the bridge key once, and a new key replaces the old one", async () => {
  const { call, storage } = await harness();
  assert.equal((await call("POST", "/v1/mt5/setup", { body: {} })).status, 403);
  assert.equal((await call("POST", "/v1/mt5/setup", { headers: { "X-Setup-Code": "wrong" }, body: {} })).status, 403);
  assert.equal((await storage().get("mt5")) || null, null, "nothing was made without the code");

  const first = (await call("POST", "/v1/mt5/setup", MT5_SETUP)).body;
  assert.equal(first.ok, true);
  assert.equal(first.ownerPaired, false);
  assert.match(first.bridgeKey, /^[0-9a-f]{64}$/);
  assert.match(first.note, /MT5_BRIDGE_KEY/);

  // Only the key's hash is kept.
  const kept = await storage().get("mt5");
  assert.equal(JSON.stringify(kept).includes(first.bridgeKey), false);
  assert.equal(kept.keyHash, await sha256Hex(first.bridgeKey));
  assert.deepEqual((await call("GET", "/v1/status")).body.mt5, { configured: true, lastReportAt: null, demo: null });

  const again = (await call("POST", "/v1/mt5/setup", MT5_SETUP)).body;
  assert.equal(again.bridgeKey, null);
  assert.match(again.note, /still works/);
  assert.equal((await call("GET", "/v1/mt5/signals", { headers: { "X-Mt5-Key": first.bridgeKey } })).status, 200);

  const renewed = (await call("POST", "/v1/mt5/setup", { headers: { "X-Setup-Code": SETUP_CODE }, body: { newKey: true } })).body;
  assert.match(renewed.bridgeKey, /^[0-9a-f]{64}$/);
  assert.notEqual(renewed.bridgeKey, first.bridgeKey);
  assert.equal((await call("GET", "/v1/mt5/signals", { headers: { "X-Mt5-Key": first.bridgeKey } })).status, 403);
  assert.equal((await call("GET", "/v1/mt5/signals", { headers: { "X-Mt5-Key": renewed.bridgeKey } })).status, 200);
});

test("mt5: only the bridge key reads the signals, and they follow the practice account", async () => {
  const { call, pair, round, say, now } = await harness();
  const signals = (key) => call("GET", "/v1/mt5/signals", { headers: key ? { "X-Mt5-Key": key } : {} });
  assert.equal((await signals("a".repeat(64))).status, 403, "no bridge key exists yet");
  const { bridgeKey } = (await call("POST", "/v1/mt5/setup", MT5_SETUP)).body;
  assert.equal((await signals("")).status, 403);
  assert.equal((await signals("b".repeat(64))).status, 403);
  assert.equal((await call("POST", "/v1/mt5/signals", { headers: { "X-Mt5-Key": bridgeKey }, body: {} })).status, 404, "signals are only read");

  // Nobody is paired, so no round has run: nothing to act on.
  const idle = (await signals(bridgeKey)).body;
  assert.deepEqual(idle, { ok: true, at: now(), lastRoundAt: null, fresh: false, wanted: [] });

  await pair();
  assert.match(await round(), /Bought BTC/);
  const held = (await signals(bridgeKey)).body;
  assert.equal(held.fresh, true);
  assert.equal(held.lastRoundAt, now());
  assert.deepEqual(held.wanted.map((item) => item.symbol), ["BTCUSDT"]);
  assert.equal(held.wanted[0].openedAt, now());
  assert.ok(held.wanted[0].stop > 0, "the practice stop travels with the signal");

  // The agent goes quiet for longer than three rounds: the coin is still listed, but not to act on.
  now.advance(3 * TICK_MS + 1000);
  const quiet = (await signals(bridgeKey)).body;
  assert.equal(quiet.fresh, false);
  assert.equal(quiet.wanted.length, 1);

  // Sold in the practice account: nothing is wanted any more.
  await say("/sell BTC");
  assert.deepEqual((await signals(bridgeKey)).body.wanted, []);
});

test("mt5 reports: only the bridge key gets in, and copies are told to the owner through TradeBot's own bot", async () => {
  const { call, pair, sent, twinSent, storage, now } = await harness();
  const post = (key, body) => call("POST", "/v1/mt5/report", { headers: key ? { "X-Mt5-Key": key } : {}, body });
  assert.equal((await post("a".repeat(64), mt5Report())).status, 403, "no bridge key exists yet");
  await pair();
  const { bridgeKey, ownerPaired } = (await call("POST", "/v1/mt5/setup", MT5_SETUP)).body;
  assert.equal(ownerPaired, true);

  assert.equal((await post("", mt5Report())).status, 403);
  assert.equal((await post("b".repeat(64), mt5Report())).status, 403);
  assert.equal((await post(bridgeKey, [1, 2, 3])).status, 400);
  assert.equal((await call("POST", "/v1/mt5/report", { headers: { "X-Mt5-Key": bridgeKey } })).status, 400, "not JSON");
  assert.equal((await post(bridgeKey, mt5Report({ server: "x".repeat(40000) }))).status, 413);
  assert.equal((await storage().get("mt5")).report, null, "nothing refused was kept");

  const texts = (from) => sent.slice(from).filter((entry) => entry.method === "sendMessage").map((entry) => entry.text).join("\n---\n");
  const before = sent.length;
  const first = await post(bridgeKey, mt5Report({ login: 12345678, name: "Juwen" }));
  assert.deepEqual(first.body, { ok: true, at: now(), told: 0 });
  assert.deepEqual((await call("GET", "/v1/status")).body.mt5, { configured: true, lastReportAt: now(), demo: true });
  assert.equal(JSON.stringify(await storage().get("mt5")).includes("12345678"), false, "the login number is not kept");

  const btc = { symbol: "BTCUSDT", brokerSymbol: "BTCUSD", volume: 0.01, openPrice: 100000, price: 100500, stop: 96000, profit: 5, openedAt: now() };
  now.advance(60000);
  assert.equal((await post(bridgeKey, mt5Report({ equity: 10005, positions: [btc] }))).body.told, 1);
  assert.match(texts(before), /MT5 demo bought BTC<\/b> · pretend money\n0\.01 lot of BTCUSD at \$100,000\.00/);
  assert.equal(sent[sent.length - 1].chat_id, OWNER);

  now.advance(60000);
  assert.equal((await post(bridgeKey, mt5Report({ positions: [btc] }))).body.told, 0, "nothing changed, nothing said");

  now.advance(60000);
  assert.equal((await post(bridgeKey, mt5Report({ balance: 10012 }))).body.told, 1);
  assert.match(texts(before), /MT5 demo closed BTC<\/b>/);

  // The terminal is logged in to a real account: one warning, and the status says it is not a demo.
  now.advance(60000);
  const mark = sent.length;
  assert.equal((await post(bridgeKey, { loggedIn: true, demo: false, server: "Broker-Live" })).body.told, 1);
  assert.match(texts(mark), /not a demo account[\s\S]*sent no orders/);
  assert.equal((await post(bridgeKey, { loggedIn: true, demo: false, server: "Broker-Live" })).body.told, 0, "said once");
  assert.equal((await call("GET", "/v1/status")).body.mt5.demo, false);

  assert.equal(twinSent.length, 0, "the twin's bot is not involved");
});

test("mt5: /mt5 in Telegram shows what the bridge last reported, and only shows", async () => {
  const { call, pair, say, sent, now } = await harness();
  await pair();
  assert.match(await say("/mt5"), /MetaTrader 5<\/b> is not set up/);
  assert.match(await say("/mt5@juwen_trade_bot"), /is not set up/);

  const { bridgeKey } = (await call("POST", "/v1/mt5/setup", MT5_SETUP)).body;
  assert.match(await say("/mt5"), /set up, but I have not heard from the bridge/);

  const btc = { symbol: "BTCUSDT", brokerSymbol: "BTCUSD", volume: 0.01, openPrice: 100000, price: 100500, stop: 96000, profit: 5, openedAt: now() };
  await call("POST", "/v1/mt5/report", { headers: { "X-Mt5-Key": bridgeKey }, body: mt5Report({ equity: 10005, positions: [btc] }) });
  const shown = await say("/mt5");
  assert.match(shown, /demo account \(pretend money\) · MetaQuotes-Demo/);
  assert.match(shown, /<b>BTC<\/b> 0\.01 lot \(BTCUSD\)/);
  assert.match(shown, /Last heard from the bridge: just now\./);
  assert.equal(shown.includes(bridgeKey), false);

  // Everyday words and a near miss reach it too, because it only shows.
  assert.match(await say("metatrader"), /I read that as \/mt5[\s\S]*demo account/);
  assert.match(await say("/mt"), /I read \/mt as \/mt5/);
  assert.match(await say("/help"), /\/mt5 the MetaTrader 5 demo account/);
  assert.ok(sent.find((entry) => entry.method === "setMyCommands").commands.some((entry) => entry.command === "mt5"));

  // The PC goes quiet: the numbers stay, marked as old.
  now.advance(10 * 60 * 1000);
  assert.match(await say("/mt5"), /⚠️ Last heard from the bridge 10 minutes ago/);
});

// ---------------------------------------------------------------- Indodax (the sender on the PC)

// What the sender posts when it holds nothing, in practice.
function indodaxReport(extra = {}) {
  return {
    mode: "practice",
    keys: false,
    tripped: false,
    trippedWhy: "",
    orderIdr: 50000,
    maxOpen: 2,
    stopPercent: 8,
    positions: [],
    closed: [],
    result: { practice: 0, real: 0 },
    today: { practice: 0, real: 0, buys: 0 },
    notes: [],
    ...extra,
  };
}

const INDODAX_SETUP = { headers: { "X-Setup-Code": SETUP_CODE }, body: {} };

test("indodax: setup needs the setup code, shows the sender's key once, and a new key replaces the old one", async () => {
  const { call, storage } = await harness();
  assert.equal((await call("POST", "/v1/indodax/setup", { body: {} })).status, 403);
  assert.equal((await call("POST", "/v1/indodax/setup", { headers: { "X-Setup-Code": "wrong" }, body: {} })).status, 403);
  assert.equal((await storage().get("indodax")) || null, null, "nothing was made without the code");

  const first = (await call("POST", "/v1/indodax/setup", INDODAX_SETUP)).body;
  assert.equal(first.ok, true);
  assert.equal(first.ownerPaired, false);
  assert.match(first.bridgeKey, /^[0-9a-f]{64}$/);
  assert.match(first.note, /INDODAX_BRIDGE_KEY[\s\S]*starts in practice/);

  // Only the key's hash is kept.
  const kept = await storage().get("indodax");
  assert.equal(JSON.stringify(kept).includes(first.bridgeKey), false);
  assert.equal(kept.keyHash, await sha256Hex(first.bridgeKey));
  assert.deepEqual((await call("GET", "/v1/status")).body.indodax, { configured: true, lastReportAt: null, mode: null, paused: false, keys: null, checked: null, tripped: null, openCopies: null, realOpen: null });

  const again = (await call("POST", "/v1/indodax/setup", INDODAX_SETUP)).body;
  assert.equal(again.bridgeKey, null);
  assert.match(again.note, /still works/);
  assert.equal((await call("GET", "/v1/indodax/signals", { headers: { "X-Indodax-Key": first.bridgeKey } })).status, 200);

  const renewed = (await call("POST", "/v1/indodax/setup", { headers: { "X-Setup-Code": SETUP_CODE }, body: { newKey: true } })).body;
  assert.match(renewed.bridgeKey, /^[0-9a-f]{64}$/);
  assert.notEqual(renewed.bridgeKey, first.bridgeKey);
  assert.equal((await call("GET", "/v1/indodax/signals", { headers: { "X-Indodax-Key": first.bridgeKey } })).status, 403);
  assert.equal((await call("GET", "/v1/indodax/signals", { headers: { "X-Indodax-Key": renewed.bridgeKey } })).status, 200);

  // The MT5 bridge's key is a different key: neither opens the other's door.
  const mt5 = (await call("POST", "/v1/mt5/setup", MT5_SETUP)).body;
  assert.equal((await call("GET", "/v1/indodax/signals", { headers: { "X-Indodax-Key": mt5.bridgeKey } })).status, 403);
  assert.equal((await call("GET", "/v1/mt5/signals", { headers: { "X-Mt5-Key": renewed.bridgeKey } })).status, 403);
});

test("indodax: only the sender's key reads the signals, and they follow the practice account", async () => {
  const { call, pair, round, say, now } = await harness();
  const signals = (key) => call("GET", "/v1/indodax/signals", { headers: key ? { "X-Indodax-Key": key } : {} });
  assert.equal((await signals("a".repeat(64))).status, 403, "no key exists yet");
  const { bridgeKey } = (await call("POST", "/v1/indodax/setup", INDODAX_SETUP)).body;
  assert.equal((await signals("")).status, 403);
  assert.equal((await signals("b".repeat(64))).status, 403);
  assert.equal((await call("POST", "/v1/indodax/signals", { headers: { "X-Indodax-Key": bridgeKey }, body: {} })).status, 404, "signals are only read");

  // Nobody is paired, so no round has run: nothing to act on.
  assert.deepEqual((await signals(bridgeKey)).body, { ok: true, at: now(), lastRoundAt: null, fresh: false, wanted: [], paused: false });

  await pair();
  assert.match(await round(), /Bought BTC/);
  const held = (await signals(bridgeKey)).body;
  assert.equal(held.fresh, true);
  assert.deepEqual(held.wanted.map((item) => item.symbol), ["BTCUSDT"]);
  assert.equal(held.wanted[0].openedAt, now());

  // The agent goes quiet for longer than three rounds: the coin is still listed, but not to act on.
  now.advance(3 * TICK_MS + 1000);
  const quiet = (await signals(bridgeKey)).body;
  assert.equal(quiet.fresh, false);
  assert.equal(quiet.wanted.length, 1);

  // Sold in the practice account: nothing is wanted any more.
  await say("/sell BTC");
  assert.deepEqual((await signals(bridgeKey)).body.wanted, []);
});

test("indodax reports: only the sender's key gets in, and copies are told to the owner through TradeBot's own bot", async () => {
  const { call, pair, sent, twinSent, storage, now } = await harness();
  const post = (key, body) => call("POST", "/v1/indodax/report", { headers: key ? { "X-Indodax-Key": key } : {}, body });
  assert.equal((await post("a".repeat(64), indodaxReport())).status, 403, "no key exists yet");
  await pair();
  const { bridgeKey, ownerPaired } = (await call("POST", "/v1/indodax/setup", INDODAX_SETUP)).body;
  assert.equal(ownerPaired, true);

  assert.equal((await post("", indodaxReport())).status, 403);
  assert.equal((await post("b".repeat(64), indodaxReport())).status, 403);
  assert.equal((await post(bridgeKey, [1, 2, 3])).status, 400);
  assert.equal((await call("POST", "/v1/indodax/report", { headers: { "X-Indodax-Key": bridgeKey } })).status, 400, "not JSON");
  assert.equal((await post(bridgeKey, indodaxReport({ trippedWhy: "x".repeat(40000) }))).status, 413);
  assert.equal((await storage().get("indodax")).report, null, "nothing refused was kept");

  const texts = (from) => sent.slice(from).filter((entry) => entry.method === "sendMessage").map((entry) => entry.text).join("\n---\n");
  const before = sent.length;
  // The first report: nothing to compare it with. Things the sender should never send are not kept.
  const first = await post(bridgeKey, indodaxReport({ balanceIdr: 987654321, apiKey: "SECRET-INDODAX-KEY", email: "someone@example.com" }));
  assert.deepEqual(first.body, { ok: true, at: now(), told: 0 });
  assert.deepEqual((await call("GET", "/v1/status")).body.indodax, { configured: true, lastReportAt: now(), mode: "practice", paused: false, keys: false, checked: false, tripped: false, openCopies: 0, realOpen: 0 });
  const kept = JSON.stringify(await storage().get("indodax"));
  assert.equal(kept.includes("987654321"), false, "a balance is not kept");
  assert.equal(kept.includes("SECRET-INDODAX-KEY"), false, "a key is not kept");
  assert.equal(kept.includes("someone@example.com"), false, "an address is not kept");

  const btc = { symbol: "BTCUSDT", pair: "btc_idr", real: false, quantity: 0.00003, spent: 50000, price: 1650000000, now: 1650000000, value: 50000, openedAt: now() };
  now.advance(60000);
  assert.equal((await post(bridgeKey, indodaxReport({ positions: [btc], today: { practice: 0, real: 0, buys: 1 } }))).body.told, 1);
  assert.match(texts(before), /Indodax bought BTC<\/b> · pretend money\nPaid Rp50\.000 at Rp1\.650\.000\.000 per coin\nOpen copies: 1/);
  assert.equal(sent[sent.length - 1].chat_id, OWNER);

  now.advance(60000);
  assert.equal((await post(bridgeKey, indodaxReport({ positions: [btc] }))).body.told, 0, "nothing changed, nothing said");

  now.advance(60000);
  const sold = { symbol: "BTCUSDT", real: false, spent: 50000, received: 51200, at: now(), how: "sold" };
  assert.equal((await post(bridgeKey, indodaxReport({ closed: [sold], result: { practice: 1200, real: 0 } }))).body.told, 1);
  assert.match(texts(before), /Indodax sold BTC<\/b> · pretend money\nPaid Rp50\.000, got Rp51\.200: \+Rp1\.200/);
  assert.equal(texts(before).includes("REAL"), false, "practice was never called real");

  // The sender is switched to real money on the PC: one warning, and the status says so.
  now.advance(60000);
  const mark = sent.length;
  assert.equal((await post(bridgeKey, indodaxReport({ mode: "real", keys: true, closed: [sold] }))).body.told, 1);
  assert.match(texts(mark), /REAL MONEY mode[\s\S]*Rp50\.000 per buy, at most 2 open[\s\S]*Only you can switch this on/);
  assert.equal((await post(bridgeKey, indodaxReport({ mode: "real", keys: true, closed: [sold] }))).body.told, 0, "said once");
  assert.equal((await call("GET", "/v1/status")).body.indodax.mode, "real");

  // A real copy is labelled as real, and the safety stop is told once when it comes on.
  now.advance(60000);
  const eth = { symbol: "ETHUSDT", pair: "eth_idr", real: true, quantity: 0.001, spent: 50000, price: 50000000, now: 50000000, value: 50000, openedAt: now() };
  const bought = sent.length;
  assert.equal((await post(bridgeKey, indodaxReport({ mode: "real", keys: true, positions: [eth], closed: [sold] }))).body.told, 1);
  assert.match(texts(bought), /Indodax bought ETH<\/b> · <b>REAL MONEY<\/b>/);
  const stopped = sent.length;
  const tripped = indodaxReport({ mode: "real", keys: true, positions: [eth], closed: [sold], tripped: true, trippedWhy: "Lost Rp150.000 today <limit>" });
  assert.equal((await post(bridgeKey, tripped)).body.told, 1);
  assert.match(texts(stopped), /The safety stop is on\.<\/b> Lost Rp150\.000 today &lt;limit&gt;[\s\S]*run-windows\.ps1 -Clear/);
  assert.equal((await post(bridgeKey, tripped)).body.told, 0, "said once");

  // A report that does not say "practice" is never treated as practice.
  assert.equal((await post(bridgeKey, { positions: [] })).status, 200);
  assert.equal((await call("GET", "/v1/status")).body.indodax.mode, "real");

  assert.equal(twinSent.length, 0, "the twin's bot is not involved");
});

test("indodax: /indodax in Telegram shows what the sender last reported", async () => {
  const { call, pair, say, sent, now } = await harness();
  await pair();
  assert.match(await say("/indodax"), /<b>Indodax<\/b> is not set up/);
  assert.match(await say("/indodax@juwen_trade_bot"), /is not set up/);

  const { bridgeKey } = (await call("POST", "/v1/indodax/setup", INDODAX_SETUP)).body;
  assert.match(await say("/indodax"), /set up, but I have not heard from the sender/);

  const btc = { symbol: "BTCUSDT", pair: "btc_idr", real: false, quantity: 0.00003, spent: 50000, price: 1650000000, now: 1700000000, value: 51515, openedAt: now() };
  await call("POST", "/v1/indodax/report", { headers: { "X-Indodax-Key": bridgeKey }, body: indodaxReport({ positions: [btc], today: { practice: 0, real: 0, buys: 1 } }) });
  const shown = await say("/indodax");
  assert.match(shown, /<b>Indodax<\/b> · practice \(pretend money at Indodax's real prices\)/);
  assert.match(shown, /• <b>BTC<\/b> · pretend money · paid Rp50\.000 · worth Rp51\.515 now \(\+Rp1\.515\)/);
  assert.match(shown, /Today \(from 07:00 WIB\): pretend Rp0 · 1 buy\n/);
  assert.match(shown, /Last heard from the sender: just now\./);
  assert.equal(shown.includes(bridgeKey), false);
  assert.equal(shown.includes("REAL"), false, "practice is not shown a real-money word");

  // Everyday words and a near miss reach it too, because without pause or resume it only shows.
  assert.match(await say("indodax"), /I read that as \/indodax[\s\S]*practice \(pretend money/);
  assert.match(await say("/indoda"), /I read \/indoda as \/indodax/);
  assert.match(await say("/help"), /\/indodax the copies at Indodax in rupiah/);
  assert.ok(sent.find((entry) => entry.method === "setMyCommands").commands.some((entry) => entry.command === "indodax"));

  // The PC goes quiet: the numbers stay, marked as old, and it says nothing is sold either.
  now.advance(10 * 60 * 1000);
  const old = await say("/indodax");
  assert.match(old, /⚠️ Last heard from the sender 10 minutes ago/);
  assert.match(old, /nothing is sold either/);
});

test("indodax: the daily summary and /report say where the Indodax copies stand", async () => {
  const { call, pair, say, round, now, sent } = await harness();
  await pair();
  now.advance(TICK_MS);
  await round();

  // Not set up: /report is the account alone.
  const alone = await say("/report");
  assert.match(alone, /practice/i);
  assert.equal(alone.includes("<b>Indodax</b>"), false);

  const { bridgeKey } = (await call("POST", "/v1/indodax/setup", INDODAX_SETUP)).body;
  const post = (body) => call("POST", "/v1/indodax/report", { headers: { "X-Indodax-Key": bridgeKey }, body });
  const real = indodaxReport({ mode: "real", keys: true, checked: true, orderIdr: 20000, maxOpen: 1 });
  const part = /\n\n<b>Indodax<\/b> · ⚠️ <b>REAL MONEY<\/b> \(your own rupiah\)\nEach buy: Rp20\.000 · at most 1 open\nHolding nothing\.\nResult so far: pretend Rp0 · <b>REAL<\/b> Rp0\nLast heard from the sender: just now\./;
  const times = (text) => (text.match(/<b>Indodax<\/b> ·/g) || []).length;

  // The day turns (07:00 WIB) while the sender is running: one message carries both.
  now.advance(24 * 60 * 60 * 1000);
  assert.equal((await post(real)).status, 200);
  const morning = await round();
  const summary = morning.split("\n---\n").find((text) => text.includes("Daily summary"));
  assert.ok(summary, morning);
  assert.match(summary, /^🗓 <b>Daily summary<\/b>/);
  assert.match(summary, part);
  assert.equal(times(morning), 1, "said once, in the summary");

  // Asked for at any time, and in everyday words.
  const asked = await say("/report");
  assert.match(asked, part);
  assert.equal(times(asked), 1);
  assert.match(await say("daily report"), /I read that as \/report[\s\S]*REAL MONEY/);
  assert.match(await say("/help"), /\/report the account and the Indodax copies in one message/);
  assert.ok(sent.find((entry) => entry.method === "setMyCommands").commands.some((entry) => entry.command === "report"));
  assert.equal((await say("/status")).includes("<b>Indodax</b>"), false, "/status stays the account alone");

  // The summary can also be brought by /status after a quiet night, and the PC was off then:
  // it says the numbers are old instead of looking fine.
  now.advance(24 * 60 * 60 * 1000);
  const late = await say("/status");
  const second = late.split("\n---\n").find((text) => text.includes("Daily summary"));
  assert.ok(second, late);
  assert.match(second, /<b>Indodax<\/b> · ⚠️ <b>REAL MONEY<\/b>/);
  assert.match(second, /⚠️ Last heard from the sender 24 hours ago/);
  assert.equal(times(late), 1);
});

test("indodax: /indodax pause and resume set a flag the sender reads, and a near miss never sets it", async () => {
  const { call, pair, say, storage } = await harness();
  await pair();
  const status = async () => (await call("GET", "/v1/status")).body.indodax;

  // Before the setup there is nothing to pause, and nothing is set.
  assert.match(await say("/indodax pause"), /⚠️ Indodax is not set up, so there is nothing to pause\. Nothing was changed/);
  assert.equal((await status()).paused, false);

  const { bridgeKey } = (await call("POST", "/v1/indodax/setup", INDODAX_SETUP)).body;
  const signals = async () => (await call("GET", "/v1/indodax/signals", { headers: { "X-Indodax-Key": bridgeKey } })).body;
  const post = (body) => call("POST", "/v1/indodax/report", { headers: { "X-Indodax-Key": bridgeKey }, body });
  assert.equal((await signals()).paused, false);

  // A misspelled command and plain words are only offered: buying is not stopped or allowed by a guess.
  assert.match(await say("/indoda pause"), /Did you mean <code>\/indodax pause<\/code>\? Nothing was done/);
  assert.match(await say("indodax pause"), /Did you mean <code>\/indodax pause<\/code>\? Nothing was done/);
  assert.equal((await signals()).paused, false);

  // Paused before the first report: the flag is set and the sender will read it when it runs.
  assert.match(await say("/indodax pause"), /⏸ <b>Indodax buying is paused\.<\/b>[\s\S]*is not answering right now[\s\S]*\/indodax resume/);
  assert.equal((await signals()).paused, true);
  assert.equal((await status()).paused, true);
  assert.equal((await storage().get("state")).settings.indodaxPaused, true);

  // The sender reports, not having read it yet; then it reports that it has.
  await post(indodaxReport());
  assert.match(await say("/indodax"), /⏸ <b>Buying is paused from Telegram\.<\/b>[\s\S]*The sender has not read this yet\. It asks once a minute\./);
  await post(indodaxReport({ paused: true }));
  const read = await say("/indodax");
  assert.match(read, /Buying is paused from Telegram/);
  assert.equal(read.includes("has not read this yet"), false);
  assert.match(await say("/indodax PAUSE"), /Indodax buying is paused[\s\S]*reads this within a minute/, "the word is read in any case");

  // A guess does not allow buying again either.
  assert.match(await say("/indoda resume"), /Did you mean <code>\/indodax resume<\/code>\? Nothing was done/);
  assert.match(await say("indodax resume"), /Did you mean <code>\/indodax resume<\/code>\? Nothing was done/);
  assert.equal((await signals()).paused, true);

  assert.equal(await say("/indodax resume"), "▶️ <b>Indodax buying is allowed again.</b> The sender on your PC reads this within a minute.");
  assert.equal((await signals()).paused, false);
  assert.equal((await status()).paused, false);
  assert.match(await say("/indodax"), /▶️ Buying is allowed again\. The sender reads that within a minute\./);
  await post(indodaxReport());
  assert.equal((await say("/indodax")).includes("allowed again"), false);

  // Any other word after /indodax changes nothing and shows the copies.
  assert.match(await say("/indodax stop"), /<b>Indodax<\/b> · practice/);
  assert.equal((await signals()).paused, false);

  // Resuming in real money says so, and says when the key was never checked.
  await post(indodaxReport({ mode: "real", keys: true }));
  await say("/indodax pause");
  assert.match(await say("/indodax resume"), /REAL MONEY<\/b> mode: the next copy is bought with your own rupiah, Rp50\.000 per buy[\s\S]*has not passed the check on the PC/);
  assert.match(await say("/help"), /\/indodax pause stops its new buys, \/indodax resume allows them again/);
});

test("indodax: a sender that goes quiet with real money in play is told once, and so is its return", async () => {
  const { call, pair, round, now } = await harness();
  await pair();
  const { bridgeKey } = (await call("POST", "/v1/indodax/setup", INDODAX_SETUP)).body;
  const post = (body) => call("POST", "/v1/indodax/report", { headers: { "X-Indodax-Key": bridgeKey }, body });
  const alerts = (text) => (text.match(/I have not heard from the sender on your PC/g) || []).length;
  const eth = { symbol: "ETHUSDT", pair: "eth_idr", real: true, quantity: 0.001, spent: 50000, price: 50000000, now: 50000000, value: 50000, openedAt: now() };

  // Practice with nothing real open: silence is not an alarm, however long it lasts.
  await post(indodaxReport());
  assert.equal(alerts(await round()), 0);
  now.advance(4 * TICK_MS);
  assert.equal(alerts(await round()), 0);

  // Real mode with a real copy open.
  await post(indodaxReport({ mode: "real", keys: true, checked: true, positions: [eth] }));
  const status = (await call("GET", "/v1/status")).body.indodax;
  assert.deepEqual(
    { ...status, lastReportAt: "x" },
    { configured: true, lastReportAt: "x", mode: "real", paused: false, keys: true, checked: true, tripped: false, openCopies: 1, realOpen: 1 },
  );
  assert.equal(JSON.stringify(status).includes("ETH"), false, "the public status names no coin");
  assert.equal(JSON.stringify(status).includes("50000"), false, "and shows no amount");

  now.advance(TICK_MS);
  assert.equal(alerts(await round()), 0, "five minutes is not yet a silence");
  now.advance(TICK_MS + 1000);
  const told = await round();
  assert.equal(alerts(told), 1);
  assert.match(told, /<b>1 open copy is REAL MONEY\.<\/b> Start the sender again, or sell at Indodax yourself\./);
  assert.match(told, /nothing is sold either/);
  now.advance(TICK_MS);
  assert.equal(alerts(await round()), 0, "one silence is one message");
  now.advance(6 * TICK_MS);
  assert.equal(alerts(await round()), 0);

  // The sender comes back: said first, once.
  const back = await post(indodaxReport({ mode: "real", keys: true, checked: true, positions: [eth] }));
  assert.equal(back.body.told, 1);
  const again = await post(indodaxReport({ mode: "real", keys: true, checked: true, positions: [eth] }));
  assert.equal(again.body.told, 0);

  // A second silence is told again; back in practice with the real copy still open counts too.
  await post(indodaxReport({ positions: [eth] }));
  now.advance(2 * TICK_MS + 1000);
  assert.equal(alerts(await round()), 1);
});

test("indodax: the message that the sender is back reaches the owner", async () => {
  const { call, pair, round, sent, now } = await harness();
  await pair();
  const { bridgeKey } = (await call("POST", "/v1/indodax/setup", INDODAX_SETUP)).body;
  const post = (body) => call("POST", "/v1/indodax/report", { headers: { "X-Indodax-Key": bridgeKey }, body });
  await post(indodaxReport({ mode: "real", keys: true, checked: true }));
  await round();
  now.advance(2 * TICK_MS + 1000);
  assert.match(await round(), /I have not heard from the sender[\s\S]*No real copy is open, so nothing of yours is at risk right now\./);

  const before = sent.length;
  await post(indodaxReport({ mode: "real", keys: true, checked: true }));
  const texts = sent.slice(before).filter((entry) => entry.method === "sendMessage");
  assert.equal(texts.length, 1);
  assert.equal(texts[0].chat_id, OWNER);
  assert.equal(texts[0].text, "✅ <b>Indodax: the sender on your PC is back.</b> It reports again: nothing open. /indodax shows it.");
});
