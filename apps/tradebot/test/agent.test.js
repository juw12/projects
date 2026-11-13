import assert from "node:assert/strict";
import { test } from "node:test";

import { BLIND_ALERT_MS, TICK_MS, approve, manualBuy, newState, tick, worth } from "../src/agent.js";
import { TIMEFRAMES } from "../src/market.js";
import { makeCandles, makeClock } from "./fakes.js";

// A pretend price source: scene = { SYMBOL: { trend, drop } }. A missing symbol has no prices.
function fakeMarket(scene, now) {
  return {
    async candles(symbol, timeframe, limit = 300) {
      if (!scene[symbol]) throw new Error("no such market");
      return { source: "Fake", candles: makeCandles({ now: now(), timeframeMs: TIMEFRAMES[timeframe].ms, count: limit, ...scene[symbol] }) };
    },
  };
}

function setup(scene) {
  const now = makeClock();
  const state = newState();
  const market = fakeMarket(scene, now);
  const round = async () => (await tick(state, { market, now: now() })).map((message) => message.html);
  return { now, state, market, scene, round };
}

test("a round buys the rising market, sized by risk, and leaves the falling ones alone", async () => {
  const { state, round } = setup({ BTCUSDT: { trend: "up" }, ETHUSDT: { trend: "down" }, SOLUSDT: { trend: "down" } });
  const messages = await round();
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Bought BTC/);
  const position = state.portfolio.positions.BTCUSDT;
  assert.ok(position && position.stop < position.entry);
  // The loss at the stop is about 1% of the account, unless the 25% cap made the trade smaller.
  const lossAtStop = position.cost * (1 - position.stop / position.entry);
  assert.ok(lossAtStop <= 101 && position.cost <= 2500, `risk ${lossAtStop}, cost ${position.cost}`);
  assert.deepEqual(Object.keys(state.portfolio.positions), ["BTCUSDT"]);
  assert.equal(state.lastTick.errors.length, 0);

  // The same candle is not judged twice.
  assert.deepEqual(await round(), []);
  assert.equal(state.trades.length, 1);
});

test("the stop sells at the live price on any round, and the market then cools down", async () => {
  const { now, state, scene, round } = setup({ BTCUSDT: { trend: "up" } });
  state.settings.watchlist = ["BTCUSDT"];
  await round();
  scene.BTCUSDT.drop = 0.2;
  now.advance(TICK_MS);
  const messages = await round();
  assert.match(messages[0], /Sold BTC/);
  assert.match(messages[0], /stop hit/);
  assert.deepEqual(state.portfolio.positions, {});
  assert.ok(state.portfolio.cash < 10000);

  // Back up, a new candle: still no buy during the cooldown.
  scene.BTCUSDT.drop = 0;
  now.advance(TIMEFRAMES["4h"].ms);
  assert.ok(!(await round()).some((html) => /Bought/.test(html)));
});

test("a position is sold when the trend turns, even while buying is paused", async () => {
  const { now, state, scene, round } = setup({ BTCUSDT: { trend: "up" } });
  state.settings.watchlist = ["BTCUSDT"];
  await round();
  state.portfolio.positions.BTCUSDT.stop = 0.0001; // far away, so only the rules can sell
  state.settings.paused = true;
  scene.BTCUSDT.trend = "down";
  now.advance(TIMEFRAMES["4h"].ms);
  const messages = await round();
  assert.match(messages.join("\n"), /Sold BTC/);
  assert.match(messages.join("\n"), /momentum turned down|uptrend is broken/);
});

test("paused, full, or past the day's loss limit: no new buys", async () => {
  const scene = { BTCUSDT: { trend: "up" }, ETHUSDT: { trend: "up" }, SOLUSDT: { trend: "up" } };

  const paused = setup(scene);
  paused.state.settings.paused = true;
  assert.deepEqual(await paused.round(), []);

  const full = setup(scene);
  full.state.settings.maxPositions = 2;
  assert.equal((await full.round()).filter((html) => /Bought/.test(html)).length, 2);

  const losing = setup({ ...scene, DOGEUSDT: { trend: "up" } });
  losing.state.settings.dailyLossPct = 1;
  await manualBuy(losing.state, "DOGEUSDT", 9000, { market: losing.market, now: losing.now() });
  await losing.round(); // sets the day's starting value
  losing.scene.DOGEUSDT = { trend: "up", drop: 0.02 };
  losing.now.advance(TICK_MS);
  for (const memo of Object.values(losing.state.marks)) delete memo.decided;
  const before = Object.keys(losing.state.portfolio.positions).length;
  const messages = await losing.round();
  assert.match(messages.join("\n"), /I will not open new trades until tomorrow/);
  assert.equal(losing.state.day.halted, true);
  assert.ok(Object.keys(losing.state.portfolio.positions).length <= before);
});

test("ask mode proposes with buttons; approving buys, and an old offer expires", async () => {
  const { now, state, market } = setup({ BTCUSDT: { trend: "up" } });
  state.settings.watchlist = ["BTCUSDT"];
  state.settings.auto = false;
  const messages = await tick(state, { market, now: now() });
  assert.match(messages[0].html, /Buy BTC\?/);
  assert.deepEqual(messages[0].buttons[0].map((button) => button.data), ["ok:BTCUSDT", "no:BTCUSDT"]);
  assert.deepEqual(state.portfolio.positions, {});

  const trade = await approve(state, "BTCUSDT", { market, now: now() });
  assert.equal(trade.side, "buy");
  assert.ok(state.portfolio.positions.BTCUSDT);
  assert.deepEqual(state.pending, {});

  state.pending.BTCUSDT = { price: 1, stop: 0.5, why: "old", at: now() - TIMEFRAMES["4h"].ms - 1 };
  await assert.rejects(approve(state, "BTCUSDT", { market, now: now() }), /expired/);
});

test("a hand-made buy gets a stop and is then looked after by the agent", async () => {
  const { now, state, market, scene, round } = setup({ DOGEUSDT: { trend: "up" } });
  state.settings.watchlist = [];
  const trade = await manualBuy(state, "DOGEUSDT", 500, { market, now: now() });
  assert.equal(trade.usd, 500);
  assert.ok(trade.stop > 0 && trade.stop < trade.price);
  await assert.rejects(manualBuy(state, "DOGEUSDT", 500, { market, now: now() }), /Already holding/);
  await assert.rejects(manualBuy(state, "BTCUSDT", 500, { market, now: now() }), /no such market/);

  scene.DOGEUSDT.drop = 0.3;
  now.advance(TICK_MS);
  assert.match((await round())[0], /Sold DOGE/);
});

test("a new day brings yesterday's summary", async () => {
  const { now, state, round } = setup({ BTCUSDT: { trend: "up" } });
  state.settings.watchlist = ["BTCUSDT"];
  await round();
  now.advance(24 * 60 * 60 * 1000);
  const messages = await round();
  assert.match(messages[0], /Daily summary/);
  assert.match(messages[0], /Trades: 1 · Holding: BTC/);
  assert.equal(state.day.trades, 0);
  assert.ok(Math.abs(state.day.start - worth(state)) < 50);
});

test("when prices cannot be read the owner is told once, and again when they are back", async () => {
  const { now, state, scene, round } = setup({});
  state.settings.watchlist = ["BTCUSDT"];
  assert.deepEqual(await round(), []);
  assert.equal(state.lastTick.errors.length, 1);
  now.advance(BLIND_ALERT_MS);
  assert.match((await round())[0], /cannot read prices/);
  now.advance(TICK_MS);
  assert.deepEqual(await round(), []);
  scene.BTCUSDT = { trend: "down" };
  now.advance(TICK_MS);
  assert.match((await round())[0], /Prices are back/);
});

test("stale prices are never traded on", async () => {
  const now = makeClock();
  const state = newState();
  state.settings.watchlist = ["BTCUSDT"];
  const old = makeCandles({ now: now() - 3 * TIMEFRAMES["4h"].ms, timeframeMs: TIMEFRAMES["4h"].ms });
  const market = { candles: async () => ({ source: "Fake", candles: old }) };
  assert.deepEqual(await tick(state, { market, now: now() }), []);
  assert.match(state.lastTick.errors[0], /too old/);
  assert.deepEqual(state.portfolio.positions, {});
});
