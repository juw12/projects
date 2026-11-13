import assert from "node:assert/strict";
import { test } from "node:test";

import { backtest } from "../src/backtest.js";
import { buy, equity, newPortfolio, sell } from "../src/paper.js";
import { PARAMS, atr, computeSeries, decideAt, ema, rsi, sizeOrder } from "../src/strategy.js";
import { makeCandles } from "./fakes.js";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 15, 4, 10);

test("ema starts as a simple average and then follows the price", () => {
  const values = ema([1, 2, 3, 4, 5], 3);
  assert.deepEqual(values.slice(0, 2), [null, null]);
  assert.equal(values[2], 2);
  assert.equal(values[3], 3); // 2 + (4 - 2) * 0.5
  assert.equal(values[4], 4);
});

test("rsi is 100 when the price only rises and 0 when it only falls", () => {
  const rising = Array.from({ length: 30 }, (_, index) => 100 + index);
  const falling = Array.from({ length: 30 }, (_, index) => 100 - index);
  assert.equal(rsi(rising, 14)[29], 100);
  assert.equal(rsi(falling, 14)[29], 0);
  assert.equal(rsi(rising, 14)[13], null);
});

test("atr is the usual candle range", () => {
  const candles = Array.from({ length: 30 }, () => ({ o: 100, h: 102, l: 99, c: 100 }));
  assert.equal(atr(candles, 14)[29], 3);
});

test("a steady climb is a buy, with a stop three ATRs under the price", () => {
  const candles = makeCandles({ now: NOW, timeframeMs: HOUR, trend: "up" }).slice(0, -1);
  const series = computeSeries(candles);
  const index = candles.length - 1;
  const decision = decideAt(series, index, { position: null, barsSinceExit: null });
  assert.equal(decision.action, "buy", decision.why);
  assert.ok(decision.reasons.every((reason) => reason.ok));
  assert.ok(Math.abs(decision.stop - (series.closes[index] - PARAMS.stopAtr * series.atr[index])) < 1e-9);
});

test("no buying during the cooldown, in a fall, or without enough history", () => {
  const rising = makeCandles({ now: NOW, timeframeMs: HOUR, trend: "up" }).slice(0, -1);
  const cooling = decideAt(computeSeries(rising), rising.length - 1, { position: null, barsSinceExit: 2 });
  assert.equal(cooling.action, "hold");
  assert.match(cooling.why, /cooling down/);

  const falling = makeCandles({ now: NOW, timeframeMs: HOUR, trend: "down" }).slice(0, -1);
  const waiting = decideAt(computeSeries(falling), falling.length - 1, { position: null, barsSinceExit: null });
  assert.equal(waiting.action, "hold");
  assert.match(waiting.why, /waiting for/);

  const short = rising.slice(0, 100);
  assert.equal(decideAt(computeSeries(short), short.length - 1, { position: null, barsSinceExit: null }).why, "not enough history yet");
});

test("a held position is sold when the trend turns, and its stop never moves down", () => {
  const falling = makeCandles({ now: NOW, timeframeMs: HOUR, trend: "down" }).slice(0, -1);
  const exit = decideAt(computeSeries(falling), falling.length - 1, { position: { stop: 1 }, barsSinceExit: null });
  assert.equal(exit.action, "sell");

  const rising = makeCandles({ now: NOW, timeframeMs: HOUR, trend: "up" }).slice(0, -1);
  const series = computeSeries(rising);
  const keep = decideAt(series, rising.length - 1, { position: { stop: 1e9 }, barsSinceExit: null });
  assert.equal(keep.action, "hold");
  assert.equal(keep.stop, 1e9);
  const raise = decideAt(series, rising.length - 1, { position: { stop: 1 }, barsSinceExit: null });
  assert.ok(raise.stop > 1);
});

test("an order is sized so a stop-out costs the chosen share of the account", () => {
  // 1% of 10,000 is 100; a stop 5% away means a 2,000 position.
  assert.equal(sizeOrder({ equity: 10000, cash: 10000, price: 100, stop: 95, riskPct: 1, maxPositionPct: 25 }), 2000);
  // A tight stop would want 10,000: capped at 25% of the account.
  assert.equal(sizeOrder({ equity: 10000, cash: 10000, price: 100, stop: 99, riskPct: 1, maxPositionPct: 25 }), 2500);
  // Never more than the cash at hand, nothing under the smallest order, nothing with a stop above the price.
  assert.equal(sizeOrder({ equity: 10000, cash: 300, price: 100, stop: 95, riskPct: 1, maxPositionPct: 25 }), 300);
  assert.equal(sizeOrder({ equity: 10000, cash: 5, price: 100, stop: 95, riskPct: 1, maxPositionPct: 25 }), 0);
  assert.equal(sizeOrder({ equity: 10000, cash: 10000, price: 100, stop: 101, riskPct: 1, maxPositionPct: 25 }), 0);
});

test("the practice account charges fees and slippage on both sides", () => {
  const portfolio = newPortfolio(10000);
  const bought = buy(portfolio, "BTCUSDT", 1000, 100, 95, 1);
  assert.equal(portfolio.cash, 9000);
  assert.ok(Math.abs(bought.price - 100.05) < 1e-9);
  assert.ok(Math.abs(bought.qty - 999 / 100.05) < 1e-9);
  assert.ok(Math.abs(equity(portfolio, { BTCUSDT: 100 }) - (9000 + bought.qty * 100)) < 1e-9);

  const sold = sell(portfolio, "BTCUSDT", 100, "test", 2);
  assert.ok(sold.pnl < 0 && sold.pnl > -4, "a round trip at the same price loses only the costs");
  assert.ok(Math.abs(portfolio.cash - (10000 + sold.pnl)) < 1e-9);
  assert.deepEqual(portfolio.positions, {});

  assert.throws(() => sell(portfolio, "BTCUSDT", 100, "test", 3), /Not holding/);
  assert.throws(() => buy(portfolio, "BTCUSDT", 1e9, 100, 95, 3), /Not enough cash/);
  buy(portfolio, "BTCUSDT", 100, 100, 95, 4);
  assert.throws(() => buy(portfolio, "BTCUSDT", 100, 100, 95, 5), /Already holding/);
});

test("the backtest trades a climb, sits out a fall, and needs enough history", () => {
  const climb = backtest(makeCandles({ now: NOW, timeframeMs: HOUR, count: 600, trend: "up" }));
  assert.ok(climb.returnPct > 0);
  assert.ok(climb.holdPct > climb.returnPct, "a quarter of the account in a pure climb earns less than all of it");
  assert.equal(climb.open, true);

  const fall = backtest(makeCandles({ now: NOW, timeframeMs: HOUR, count: 600, trend: "down" }));
  assert.equal(fall.trades, 0);
  assert.equal(fall.returnPct, 0);
  assert.ok(fall.holdPct < -30);

  assert.equal(backtest(makeCandles({ now: NOW, timeframeMs: HOUR, count: 100 })), null);
});
