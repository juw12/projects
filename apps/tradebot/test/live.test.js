import assert from "node:assert/strict";
import { test } from "node:test";

import { newState } from "../src/agent.js";
import { handleUpdate } from "../src/bot.js";
import { createTokocrypto, exchangeSymbol, floorToStep, sign } from "../src/exchange.js";
import { armedBy, buyBlock, drain, liveCommand, liveOf, limitsOf, noteFill } from "../src/live.js";

const ARMED = { LIVE_TRADING: "enabled", TOKO_API_KEY: "key-123", TOKO_API_SECRET: "secret-456" };
const NOW = Date.UTC(2026, 0, 15, 4, 10);

const SYMBOLS = {
  code: 0,
  msg: "success",
  data: {
    list: [
      {
        symbol: "BTC_USDT",
        spotTradingEnable: 1,
        filters: [
          { filterType: "LOT_SIZE", minQty: "0.00001000", stepSize: "0.00001000" },
          { filterType: "NOTIONAL", minNotional: "5.00000000" },
        ],
      },
      {
        symbol: "ETH_USDT",
        spotTradingEnable: 1,
        filters: [
          { filterType: "LOT_SIZE", minQty: "0.00010000", stepSize: "0.00010000" },
          { filterType: "NOTIONAL", minNotional: "5.00000000" },
        ],
      },
      {
        symbol: "SOL_USDT",
        spotTradingEnable: 1,
        filters: [
          { filterType: "LOT_SIZE", minQty: "0.00100000", stepSize: "0.00100000" },
          { filterType: "NOTIONAL", minNotional: "5.00000000" },
        ],
      },
      {
        symbol: "XRP_USDT",
        spotTradingEnable: 1,
        filters: [
          { filterType: "LOT_SIZE", minQty: "0.10000000", stepSize: "0.10000000" },
          { filterType: "NOTIONAL", minNotional: "5.00000000" },
        ],
      },
    ],
  },
};

// A pretend Tokocrypto. Records every request; `balances` is what /asset answers.
function fakeToko({ balances = { USDT: 100, BTC: 0.0002, ETH: 0.01 }, orderError = null, price = 50000 } = {}) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const params = new URLSearchParams(init.method === "POST" ? init.body : parsed.search);
    requests.push({ method: init.method, path: parsed.pathname, params, headers: init.headers || {} });
    const ok = (data) => new Response(JSON.stringify({ code: 0, msg: "success", data }), { status: 200 });
    if (parsed.pathname === "/open/v1/common/symbols") return new Response(JSON.stringify(SYMBOLS), { status: 200 });
    if (parsed.pathname === "/open/v1/account/spot/asset") return ok({ asset: params.get("asset"), free: String(balances[params.get("asset")] || 0), locked: "0" });
    if (parsed.pathname === "/open/v1/orders") {
      if (orderError) return new Response(JSON.stringify({ code: 3210, msg: orderError }), { status: 400 });
      if (params.get("side") === "0") {
        const quote = Number(params.get("quoteOrderQty"));
        return ok({ orderId: 11, status: 2, executedQty: String(quote / price), executedQuoteQty: String(quote) });
      }
      const qty = Number(params.get("quantity"));
      return ok({ orderId: 12, status: 2, executedQty: String(qty), executedQuoteQty: String(qty * price * 1.02) });
    }
    return new Response(JSON.stringify({ code: -1, msg: "unknown path" }), { status: 404 });
  };
  return { fetch, requests, orders: () => requests.filter((request) => request.path === "/open/v1/orders") };
}

const buyFill = (symbol = "BTCUSDT", price = 50000) => ({ side: "buy", symbol, price, at: NOW });
const sellFill = (symbol = "BTCUSDT", price = 51000) => ({ side: "sell", symbol, price, at: NOW });

test("requests are signed the way Tokocrypto's own example is", async () => {
  // The worked example in https://www.tokocrypto.com/apidocs/ (signed with the secret key).
  const signature = await sign(
    "f9AbA6a8AD6bC2a97294a212244dda04ETfl0kc4BSUGOtL7m7rNELpt3Jh25SiP",
    "symbol=BTC_USDT&side=0&type=1&quantity=0.16&price=7500&timestamp=1581720670624&recvWindow=5000",
  );
  assert.equal(signature, "33824b5160daefc34257ab9cd3c3db7a0158a446674f896c9fc3b122ae656bfa");
  assert.equal(exchangeSymbol("BTCUSDT"), "BTC_USDT");
  assert.equal(floorToStep(0.000199999, "0.00001000"), "0.00019");
  assert.equal(floorToStep(12.37, "0.10000000"), "12.3");
  assert.equal(floorToStep(3, "1.00000000"), "3");
});

test("real money is off by default: practice fills queue nothing and the Worker is not armed", () => {
  const state = newState();
  assert.equal(liveOf(state).mode, "off");
  noteFill(state, buyFill());
  assert.equal(liveOf(state).queue.length, 0);
  assert.equal(armedBy({}), false);
  assert.equal(armedBy({ LIVE_TRADING: "off", TOKO_API_KEY: "k", TOKO_API_SECRET: "s" }), false);
  assert.equal(armedBy({ LIVE_TRADING: "enabled" }), false);
  assert.equal(armedBy(ARMED), true);
});

test("shadow works the copy out on the real rules and sends nothing", async () => {
  const toko = fakeToko();
  const exchange = createTokocrypto({ fetch: toko.fetch, now: () => NOW });
  const state = newState();
  liveCommand(state, ["shadow"], { env: {}, now: NOW });
  noteFill(state, buyFill());
  const bought = await drain(state, { exchange, now: NOW, armed: false });
  assert.match(bought[0].html, /rehearsal\): would buy <b>10\.00 USDT<\/b> of BTC on Tokocrypto/);
  assert.equal(liveOf(state).positions.BTCUSDT.real, false);
  noteFill(state, sellFill());
  const sold = await drain(state, { exchange, now: NOW, armed: false });
  assert.match(sold[0].html, /would sell the BTC copy for about 10\.20 USDT \(\+0\.20 USDT\)/);
  assert.equal(toko.orders().length, 0, "no order is ever sent in shadow");
  assert.deepEqual(liveOf(state).positions, {});
});

test("/live on needs the Worker armed and the word confirm", () => {
  const state = newState();
  assert.match(liveCommand(state, ["on", "confirm"], { env: {}, now: NOW }).html, /cannot go on yet\. Missing: the Worker setting LIVE_TRADING/);
  assert.equal(liveOf(state).mode, "off");
  assert.match(liveCommand(state, ["on"], { env: ARMED, now: NOW }).html, /send <code>\/live on confirm<\/code>/);
  assert.equal(liveOf(state).mode, "off");
  assert.match(liveCommand(state, ["on", "confirm"], { env: ARMED, now: NOW }).html, /Real money is <b>on<\/b>/);
  assert.equal(liveOf(state).mode, "on");
  assert.match(liveCommand(state, ["size", "500"], { env: ARMED, now: NOW }).html, /between 5\.00 USDT and 50\.00 USDT/);
  liveCommand(state, ["size", "20"], { env: ARMED, now: NOW });
  assert.deepEqual(limitsOf(liveOf(state)), { orderUsdt: 20, maxOpenUsdt: 60, dailyLossUsdt: 20 });
});

test("on and armed: a real market buy by USDT amount, then a real sell of what is free, on the step", async () => {
  const toko = fakeToko({ balances: { USDT: 100, BTC: 0.000199999 } });
  const exchange = createTokocrypto({ fetch: toko.fetch, now: () => NOW, apiKey: ARMED.TOKO_API_KEY, apiSecret: ARMED.TOKO_API_SECRET });
  const state = newState();
  liveCommand(state, ["on", "confirm"], { env: ARMED, now: NOW });
  noteFill(state, buyFill());
  const bought = await drain(state, { exchange, now: NOW, armed: true });
  assert.match(bought[0].html, /Real money: bought BTC<\/b> for 10\.00 USDT/);
  const [buy] = toko.orders();
  assert.equal(buy.method, "POST");
  assert.equal(buy.headers["X-MBX-APIKEY"], "key-123");
  assert.equal(buy.params.get("symbol"), "BTC_USDT");
  assert.equal(buy.params.get("side"), "0");
  assert.equal(buy.params.get("type"), "2");
  assert.equal(buy.params.get("quoteOrderQty"), "10");
  const unsigned = new URLSearchParams(buy.params);
  unsigned.delete("signature");
  assert.equal(buy.params.get("signature"), await sign("secret-456", unsigned.toString()));
  assert.equal(liveOf(state).positions.BTCUSDT.real, true);

  noteFill(state, sellFill());
  const sold = await drain(state, { exchange, now: NOW, armed: true });
  const sell = toko.orders()[1];
  assert.equal(sell.params.get("side"), "1");
  assert.equal(sell.params.get("quantity"), "0.00019", "never more than is free, rounded down to the step");
  assert.match(sold[0].html, /Real money: sold BTC<\/b>/);
  assert.deepEqual(liveOf(state).positions, {});
});

test("the hard limits refuse a real buy, and nothing is sent", async () => {
  const live = { mode: "on", orderUsdt: 10, positions: {}, queue: [], log: [], day: null };
  const rules = { symbol: "BTC_USDT", stepSize: "0.00001", minNotional: 5, spot: true };
  const limits = limitsOf(live);
  assert.equal(buyBlock(live, "BTCUSDT", null, limits, NOW), "BTC is not traded against USDT on Tokocrypto");
  assert.equal(buyBlock(live, "BTCUSDT", { ...rules, minNotional: 20 }, limits, NOW), "the smallest BTC order on Tokocrypto is 20.00 USDT");
  assert.equal(buyBlock(live, "BTCUSDT", rules, limits, NOW, 4), "only 4.00 USDT is free on Tokocrypto");
  live.positions = { ETHUSDT: { cost: 10 }, SOLUSDT: { cost: 10 }, XRPUSDT: { cost: 10 } };
  assert.equal(buyBlock(live, "BTCUSDT", rules, limits, NOW), "3 real positions are already open");
  live.positions = {};
  live.day = { key: new Date(NOW).toISOString().slice(0, 10), realized: -10 };
  assert.equal(buyBlock(live, "BTCUSDT", rules, limits, NOW), "today's real loss already reached 10.00 USDT");

  const toko = fakeToko({ balances: { USDT: 3 } });
  const exchange = createTokocrypto({ fetch: toko.fetch, now: () => NOW, apiKey: "k", apiSecret: "s" });
  const state = newState();
  liveCommand(state, ["on", "confirm"], { env: ARMED, now: NOW });
  noteFill(state, buyFill());
  const refused = await drain(state, { exchange, now: NOW, armed: true });
  assert.match(refused[0].html, /no BTC copy\. Reason: only 3\.00 USDT is free on Tokocrypto\. Nothing was sent\./);
  assert.equal(toko.orders().length, 0);
});

test("a failed real order switches real trading back to shadow and says what is still held", async () => {
  const toko = fakeToko({ orderError: "Account has insufficient balance" });
  const exchange = createTokocrypto({ fetch: toko.fetch, now: () => NOW, apiKey: "k", apiSecret: "s" });
  const state = newState();
  liveCommand(state, ["on", "confirm"], { env: ARMED, now: NOW });
  noteFill(state, buyFill());
  const messages = await drain(state, { exchange, now: NOW, armed: true });
  assert.match(messages[0].html, /the BTC buy failed\.<\/b> Tokocrypto: Account has insufficient balance/);
  assert.match(messages[0].html, /switched itself back to shadow/);
  assert.equal(liveOf(state).mode, "shadow");
  assert.deepEqual(liveOf(state).positions, {});
});

test("a real coin is still sold after /live off, and reset is refused while one is open", async () => {
  const toko = fakeToko({ balances: { USDT: 100, BTC: 1 } });
  const exchange = createTokocrypto({ fetch: toko.fetch, now: () => NOW, apiKey: "k", apiSecret: "s" });
  const state = newState();
  liveCommand(state, ["on", "confirm"], { env: ARMED, now: NOW });
  noteFill(state, buyFill());
  await drain(state, { exchange, now: NOW, armed: true });
  assert.match(liveCommand(state, ["off"], { env: ARMED, now: NOW }).html, /1 real coin\(s\) already bought will still be sold/);

  const reset = await handleUpdate({ state, market: null, now: NOW, env: ARMED }, { message: { text: "/reset" } });
  assert.match(reset.messages[0].html, /Nothing was erased\. Real coins bought on Tokocrypto are still open/);

  noteFill(state, buyFill("ETHUSDT", 3000)); // mode is off: no new real buy is queued
  noteFill(state, sellFill());
  await drain(state, { exchange, now: NOW, armed: true });
  assert.equal(toko.orders().length, 2, "one buy, then the sell of the real BTC; no ETH buy");
  assert.equal(toko.orders()[1].params.get("side"), "1");
});

test("/live answers in the chat with the mode, the size and what is missing", async () => {
  const state = newState();
  const result = await handleUpdate({ state, market: null, now: NOW, env: {} }, { message: { text: "/live" } });
  const html = result.messages[0].html;
  assert.match(html, /Real money: OFF/);
  assert.match(html, /copied with <b>10\.00 USDT<\/b>; at most 30\.00 USDT in at once/);
  assert.match(html, /Not ready for real orders yet\. Missing: the Worker setting LIVE_TRADING = "enabled"/);
});
