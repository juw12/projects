import assert from "node:assert/strict";
import { test } from "node:test";

import { TIMEFRAMES, closedCandles, createMarket, normalizeSymbol } from "../src/market.js";
import { binanceRows, fakeFetch, makeCandles, okxBody, reply } from "./fakes.js";

const NOW = Date.UTC(2026, 0, 15, 4, 10);
const HOUR = TIMEFRAMES["1h"].ms;
const BINANCE = "https://data-api.binance.vision/";
const OKX = "https://www.okx.com/";

test("symbols are read the way people type them", () => {
  assert.equal(normalizeSymbol("btc"), "BTCUSDT");
  assert.equal(normalizeSymbol("BTC/USDT"), "BTCUSDT");
  assert.equal(normalizeSymbol("solusdt"), "SOLUSDT");
  assert.equal(normalizeSymbol(""), null);
  assert.equal(normalizeSymbol("!!!"), null);
});

test("Binance candles are read oldest first", async () => {
  const candles = makeCandles({ now: NOW, timeframeMs: HOUR, count: 10 });
  const fetch = fakeFetch([[BINANCE, () => reply(binanceRows(candles))]]);
  const answer = await createMarket({ fetch }).candles("BTCUSDT", "1h", 10, "Binance");
  assert.equal(answer.source, "Binance");
  assert.deepEqual(answer.candles, candles);
  assert.match(fetch.calls[0].url, /symbol=BTCUSDT&interval=1h&limit=10$/);
});

test("OKX answers when the others do not, and its newest-first rows are turned around", async () => {
  const candles = makeCandles({ now: NOW, timeframeMs: HOUR, count: 10 });
  const fetch = fakeFetch([
    [BINANCE, () => reply({ code: 0, msg: "Service unavailable from a restricted location" }, { status: 451 })],
    [OKX, () => reply(okxBody(candles))],
  ]);
  const answer = await createMarket({ fetch }).candles("ETHUSDT", "4h", 500);
  assert.equal(answer.source, "OKX");
  assert.deepEqual(answer.candles, candles);
  assert.match(fetch.calls.pop().url, /instId=ETH-USDT&bar=4H&limit=300$/);
});

test("one named source can be asked alone, and failures name every source tried", async () => {
  const candles = makeCandles({ now: NOW, timeframeMs: HOUR, count: 10 });
  const fetch = fakeFetch([
    [BINANCE, () => reply(binanceRows(candles))],
    [OKX, () => reply({ code: "51001", msg: "Instrument ID does not exist", data: [] })],
  ]);
  const market = createMarket({ fetch });
  await assert.rejects(market.candles("BTCUSDT", "1h", 10, "OKX"), /OKX: Instrument ID does not exist/);
  await assert.rejects(createMarket({ fetch: fakeFetch([]) }).candles("BTCUSDT", "1h"), /No price data for BTCUSDT \(Gate: .*; Kraken: .*; MEXC: .*; OKX: .*; Binance: .*\)/);
  await assert.rejects(market.candles("BTCUSDT", "2h"), /Unknown timeframe/);
});

test("the other exchanges are read into the same candles", async () => {
  const candles = makeCandles({ now: NOW, timeframeMs: HOUR, count: 10 });
  const text = (candle) => [candle.o, candle.h, candle.l, candle.c, candle.v].map(String);
  const shapes = {
    Gate: ["https://api.gateio.ws/", candles.map((c) => [String(c.t / 1000), "0", String(c.c), String(c.h), String(c.l), String(c.o), String(c.v), "true"])],
    Kraken: ["https://api.kraken.com/", { error: [], result: { XBTUSDT: candles.map((c) => [c.t / 1000, String(c.o), String(c.h), String(c.l), String(c.c), "0", String(c.v), 7]), last: 1 } }],
    MEXC: ["https://api.mexc.com/", candles.map((c) => [c.t, ...text(c), c.t + 1, "0"])],
  };
  for (const [name, [address, body]] of Object.entries(shapes)) {
    const fetch = fakeFetch([[address, () => reply(body)]]);
    const answer = await createMarket({ fetch }).candles("BTCUSDT", "1h", 4, name);
    assert.deepEqual(answer, { source: name, candles: candles.slice(-4) }, name);
  }
  const kraken = fakeFetch([["https://api.kraken.com/", () => reply({ error: ["EQuery:Unknown asset pair"] })]]);
  await assert.rejects(createMarket({ fetch: kraken }).candles("BTCUSDT", "4h", 10, "Kraken"), /Kraken: EQuery:Unknown asset pair/);
  assert.match(kraken.calls[0].url, /pair=XBTUSDT&interval=240$/);
});

test("the source that answered last is asked first, and a refusal says its HTTP status", async () => {
  const candles = makeCandles({ now: NOW, timeframeMs: HOUR, count: 10 });
  const fetch = fakeFetch([
    [BINANCE, () => new Response("<html>blocked</html>", { status: 403 })],
    [OKX, () => reply(okxBody(candles))],
  ]);
  const market = createMarket({ fetch });
  await assert.rejects(market.candles("BTCUSDT", "1h", 10, "Binance"), /Binance: unexpected answer \(HTTP 403\)/);
  fetch.calls.length = 0;
  assert.equal((await market.candles("BTCUSDT", "1h", 10)).source, "OKX");
  assert.equal(fetch.calls.length, 4, "first time: Gate, Kraken and MEXC do not answer, OKX does");
  assert.equal((await market.candles("ETHUSDT", "1h", 10)).source, "OKX");
  assert.equal(fetch.calls.length, 5, "second time: OKX is asked straight away");
});

test("broken numbers are refused instead of traded on", async () => {
  const candles = makeCandles({ now: NOW, timeframeMs: HOUR, count: 10 });
  const rows = binanceRows(candles);
  rows[4][4] = "oops";
  const market = createMarket({ fetch: fakeFetch([[BINANCE, () => reply(rows)]]) });
  await assert.rejects(market.candles("BTCUSDT", "1h", 10), /no usable candles/);
});

test("the forming candle is not counted as finished", () => {
  const candles = makeCandles({ now: NOW, timeframeMs: HOUR, count: 10 });
  const closed = closedCandles(candles, "1h", NOW);
  assert.equal(closed.length, 9);
  assert.equal(closed[8].t, candles[8].t);
});

test("a failure says whether the market is unknown or nobody could be reached", async () => {
  // Nobody answers at all.
  const silent = await createMarket({ fetch: fakeFetch([]) })
    .candles("BTCUSDT", "1h")
    .catch((error) => error);
  assert.equal(silent.kind, "unreachable");

  // Two exchanges answer properly and say they do not list it.
  const fetch = fakeFetch([
    [BINANCE, () => reply({ code: -1121, msg: "Invalid symbol." }, { status: 400 })],
    [OKX, () => reply({ code: "51001", msg: "Instrument ID does not exist", data: [] })],
  ]);
  const missing = await createMarket({ fetch })
    .candles("NOPEUSDT", "1h")
    .catch((error) => error);
  assert.equal(missing.kind, "unknown");

  // Busy is not the same as "no such market".
  const busy = fakeFetch([
    [BINANCE, () => reply({ code: -1003, msg: "Too many requests" }, { status: 429 })],
    [OKX, () => reply({ code: "50011", msg: "Too Many Requests", data: [] }, { status: 429 })],
  ]);
  const waiting = await createMarket({ fetch: busy })
    .candles("BTCUSDT", "1h")
    .catch((error) => error);
  assert.equal(waiting.kind, "unreachable");
});
