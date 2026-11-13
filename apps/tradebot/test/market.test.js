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
  const answer = await createMarket({ fetch }).candles("BTCUSDT", "1h", 10);
  assert.equal(answer.source, "Binance");
  assert.deepEqual(answer.candles, candles);
  assert.match(fetch.calls[0].url, /symbol=BTCUSDT&interval=1h&limit=10$/);
});

test("OKX answers when Binance does not, and its newest-first rows are turned around", async () => {
  const candles = makeCandles({ now: NOW, timeframeMs: HOUR, count: 10 });
  const fetch = fakeFetch([
    [BINANCE, () => reply({ code: 0, msg: "Service unavailable from a restricted location" }, { status: 451 })],
    [OKX, () => reply(okxBody(candles))],
  ]);
  const answer = await createMarket({ fetch }).candles("ETHUSDT", "4h", 500);
  assert.equal(answer.source, "OKX");
  assert.deepEqual(answer.candles, candles);
  assert.match(fetch.calls[1].url, /instId=ETH-USDT&bar=4H&limit=300$/);
});

test("one named source can be asked alone, and failures name every source tried", async () => {
  const candles = makeCandles({ now: NOW, timeframeMs: HOUR, count: 10 });
  const fetch = fakeFetch([
    [BINANCE, () => reply(binanceRows(candles))],
    [OKX, () => reply({ code: "51001", msg: "Instrument ID does not exist", data: [] })],
  ]);
  const market = createMarket({ fetch });
  await assert.rejects(market.candles("BTCUSDT", "1h", 10, "OKX"), /OKX: Instrument ID does not exist/);
  await assert.rejects(createMarket({ fetch: fakeFetch([]) }).candles("BTCUSDT", "1h"), /No price data for BTCUSDT \(Binance: .*; OKX: .*\)/);
  await assert.rejects(market.candles("BTCUSDT", "2h"), /Unknown timeframe/);
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
