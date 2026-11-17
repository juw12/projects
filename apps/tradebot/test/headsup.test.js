import assert from "node:assert/strict";
import { test } from "node:test";

import { TICK_MS, newState, readSignals, tick } from "../src/agent.js";
import { LOOK_AHEAD, SOON_MS, earliest, headsUp, levels, signNow } from "../src/headsup.js";
import { STOP_CLEAR_PCT, STOP_NEAR_PCT, cleanReport, fullReport, onlyReal, realHelp, stopSigns, viewData } from "../src/indodax.js";
import { TIMEFRAMES, closedCandles } from "../src/market.js";
import { closeHours, sign, signGone, signals, soonLines, stopNear } from "../src/render.js";
import { PARAMS, computeSeries, decideAt } from "../src/strategy.js";
import { makeCandles, makeClock } from "./fakes.js";

const FOUR_HOURS = TIMEFRAMES["4h"].ms;
const NOW = Date.UTC(2026, 0, 15, 7, 20); // 3 hours 20 minutes into a 4-hour candle: 40 minutes before it closes
const AT = Date.UTC(2026, 0, 15, 8, 0); // when that candle closes (15:00 WIB)
const FLAT = { position: null, barsSinceExit: null };

// Finished candles of one kind of market, and their indicators.
function finished(trend, now = NOW) {
  const closed = closedCandles(makeCandles({ now, timeframeMs: FOUR_HOURS, trend }), "4h", now);
  return { closed, series: computeSeries(closed) };
}

// A market that wanders: no steady direction, so every branch of the arithmetic is used.
function wandering(seed, count = 299) {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const candles = [];
  let price = 100;
  for (let index = 0; index < count; index++) {
    const open = price;
    price *= 1 + (random() - 0.48) * 0.03;
    candles.push({ t: AT - (count - index) * FOUR_HOURS, o: open, h: Math.max(open, price) * 1.002, l: Math.min(open, price) * 0.998, c: price, v: 1 });
  }
  return { closed: candles, series: computeSeries(candles) };
}

// What the rules themselves say when the next candle closes at `close`.
function judged(closed, close, state = FLAT) {
  const last = closed[closed.length - 1];
  const next = [...closed, { t: last.t + FOUR_HOURS, o: last.c, h: Math.max(last.c, close), l: Math.min(last.c, close), c: close, v: 1 }];
  return decideAt(computeSeries(next), next.length - 1, state);
}

const check = (decision, name) => decision.reasons.find((reason) => reason.name === name).ok;

function look(trend, price, extra = {}) {
  const { closed, series } = finished(trend);
  return headsUp({ closed, series, price, timeframe: "4h", now: NOW, ...extra });
}

test("heads-up: every level is the closing price at which the rules' own check turns", () => {
  const markets = [finished("up"), finished("down"), wandering(7), wandering(99), wandering(2026), wandering(31337)];
  for (const { closed, series } of markets) {
    const found = levels(series, closed.length - 1);
    assert.ok(found, "enough history");
    const up = 1 + 1e-7;
    const down = 1 - 1e-7;
    assert.equal(check(judged(closed, found.trend * up), "Trend"), true);
    assert.equal(check(judged(closed, found.trend * down), "Trend"), false);
    assert.equal(check(judged(closed, found.momentum * up), "Momentum"), true);
    assert.equal(check(judged(closed, found.momentum * down), "Momentum"), false);
    // RSI passes from rsiMin to rsiMax and nowhere else.
    assert.ok(found.rsiMin < found.rsiMax);
    assert.equal(check(judged(closed, found.rsiMin * up), "RSI"), true);
    assert.equal(check(judged(closed, found.rsiMin * down), "RSI"), false);
    assert.equal(check(judged(closed, found.rsiMax * down), "RSI"), true);
    assert.equal(check(judged(closed, found.rsiMax * up), "RSI"), false);
    assert.equal(found.atr, series.atr[closed.length - 1]);
  }
  // Too little history: no levels, and the heads-up says it does not know.
  const short = finished("up").closed.slice(0, 100);
  assert.equal(levels(computeSeries(short), short.length - 1), null);
  assert.equal(headsUp({ closed: short, series: computeSeries(short), price: 100, timeframe: "4h", now: NOW }).level, "unknown");
});

test("heads-up: likely, near and far are told from the price now, and agree with the rules at the close", () => {
  const { closed, series } = finished("up");
  const found = levels(series, closed.length - 1);
  const low = Math.max(found.trend, found.momentum, found.rsiMin);
  assert.ok(low < found.rsiMax, "a rising market leaves a band of closing prices that buys");

  const likely = look("up", (low + found.rsiMax) / 2);
  assert.equal(likely.kind, "buy");
  assert.equal(likely.level, "likely");
  assert.equal(likely.at, AT);
  assert.equal(likely.needPct, 0);
  assert.deepEqual(likely.checks, { trend: true, momentum: true, rsi: true });
  assert.equal(likely.earliest.candles, 1);
  assert.equal(judged(closed, likely.price).action, "buy", "the rules buy at that close");
  // The band it names is the band the rules buy in.
  assert.equal(judged(closed, likely.low * 1.000001).action, "buy");
  assert.equal(judged(closed, likely.low * 0.999999).action, "hold");
  assert.equal(judged(closed, likely.high * 0.999999).action, "buy");
  assert.equal(judged(closed, likely.high * 1.000001).action, "hold");

  const near = look("up", low - 0.5 * found.atr);
  assert.equal(near.level, "near");
  assert.ok(near.needPct > 0 && near.needPct <= near.movePct);
  assert.equal(judged(closed, near.price).action, "hold");

  const far = look("up", low - 3 * found.atr);
  assert.equal(far.level, "far");
  assert.ok(far.moves > 2.9 && far.moves < 3.2, `about 3 usual moves, got ${far.moves}`);

  // Overheated: the price has to come down into the band.
  const hot = look("up", found.rsiMax + 0.5 * found.atr);
  assert.equal(hot.level, "near");
  assert.ok(hot.needPct < 0);
  assert.equal(hot.checks.rsi, false);

  // A falling market: far, and the buy needs a rise.
  const falling = look("down", finished("down").closed.at(-1).c);
  assert.equal(falling.level, "far");
  assert.equal(falling.checks.trend, false);

  // After a sale the coin is left alone for 6 candles, whatever the price does.
  const sold = AT - FOUR_HOURS - 60000; // sold just before the last candle closed
  const waiting = look("up", (low + found.rsiMax) / 2, { lastExit: sold });
  assert.equal(waiting.level, "wait");
  assert.ok(waiting.from > AT);
  for (let step = 0; step < PARAMS.cooldown + 2; step++) {
    const time = AT + step * FOUR_HOURS; // a candle closing at `time`, judged a moment later
    const since = Math.floor((time + 1000 - sold) / FOUR_HOURS);
    assert.equal(time >= waiting.from, since >= PARAMS.cooldown, `candle ${step}: the wait ends when the rules say so`);
  }
});

test("heads-up: with a coin held it says how near the sale is, at the close or at the stop", () => {
  const { closed, series } = finished("up");
  const found = levels(series, closed.length - 1);
  const under = Math.max(found.trend, found.momentum);
  const last = closed.at(-1).c;
  const held = (price, stop) => look("up", price, { position: { stop } });

  const far = held(last, last - 3 * found.atr);
  assert.equal(far.kind, "sell");
  assert.equal(far.level, "far");
  assert.equal(far.under, under);
  assert.ok(far.toStop > 2.9 * far.movePct);

  const stopClose = held(last, last - 0.5 * found.atr);
  assert.deepEqual([stopClose.level, stopClose.near], ["near", "stop"]);

  const closeNear = held(under + 0.5 * found.atr, under - 5 * found.atr);
  assert.deepEqual([closeNear.level, closeNear.near], ["near", "close"]);
  assert.equal(judged(closed, closeNear.price, { position: { stop: 1 }, barsSinceExit: null }).action, "hold");

  const likely = held(under * 0.999, under * 0.5);
  assert.equal(likely.level, "likely");
  assert.ok(likely.why === "momentum" || likely.why === "trend");
  assert.equal(judged(closed, likely.price, { position: { stop: 1 }, barsSinceExit: null }).action, "sell", "the rules sell at that close");
  assert.equal(judged(closed, under * 1.001, { position: { stop: 1 }, barsSinceExit: null }).action, "hold");
});

test("heads-up: the earliest time is the first candle at which a steady move passes the rules", () => {
  const { closed } = finished("down");
  const price = closed.at(-1).c;
  const found = earliest({ closed, price, at: AT, length: FOUR_HOURS });
  if (found) {
    // Replay that steady move: the rules buy at that candle.
    const range = computeSeries(closed).atr[closed.length - 1];
    const path = closed.slice();
    for (let step = 1; step <= found.candles; step++) {
      const close = price + step * found.pace * range;
      path.push({ t: closed.at(-1).t + step * FOUR_HOURS, o: path.at(-1).c, h: Math.max(path.at(-1).c, close), l: Math.min(path.at(-1).c, close), c: close, v: 0 });
    }
    assert.equal(decideAt(computeSeries(path), path.length - 1, FLAT).action, "buy");
    assert.equal(found.at, AT + (found.candles - 1) * FOUR_HOURS);
    assert.ok(found.candles > 1 && found.candles <= LOOK_AHEAD);
    assert.ok(found.pct > 0, "a falling market needs a rise first");
  }
  // In a rising market, just under the band: this very candle, with a small rise.
  const rising = finished("up");
  const levelsNow = levels(rising.series, rising.closed.length - 1);
  const low = Math.max(levelsNow.trend, levelsNow.momentum, levelsNow.rsiMin);
  const soon = earliest({ closed: rising.closed, price: low - 0.05 * levelsNow.atr, at: AT, length: FOUR_HOURS });
  assert.equal(soon.candles, 1);
  assert.equal(soon.at, AT);
  assert.ok(soon.pct > 0 && soon.pct < 1);
  // Never before the wait after a sale is over.
  const from = AT + 3 * FOUR_HOURS;
  const later = earliest({ closed: rising.closed, price: (low + levelsNow.rsiMax) / 2, at: AT, length: FOUR_HOURS, from });
  assert.ok(later === null || later.at >= from);
  // No price, no estimate.
  assert.equal(earliest({ closed: rising.closed, price: 0, at: AT, length: FOUR_HOURS }), null);
});

test("heads-up: a sign is due only in the last hour before the close, once per candle", () => {
  const likely = { kind: "buy", level: "likely", at: AT };
  assert.equal(signNow(likely, null, AT - SOON_MS - 60000), "", "more than an hour before the close");
  assert.equal(signNow(likely, null, AT - SOON_MS), "buy");
  assert.equal(signNow(likely, null, AT - 60000), "buy");
  assert.equal(signNow(likely, null, AT), "", "the candle has closed: the rules decide now");
  assert.equal(signNow(likely, { kind: "buy", at: AT }, AT - 60000), "", "already told for this candle");
  assert.equal(signNow(likely, { kind: "buy", at: AT - FOUR_HOURS }, AT - 60000), "buy", "a new candle is told again");
  assert.equal(signNow({ ...likely, kind: "sell" }, { kind: "buy", at: AT }, AT - 60000), "sell");
  for (const level of ["near", "far", "wait", "unknown"]) assert.equal(signNow({ ...likely, level }, null, AT - 60000), "");
  assert.equal(signNow(null, null, AT - 60000), "");
});

// ---------------------------------------------------------------- the agent's rounds

function fakeMarket(scene, now) {
  return {
    async candles(symbol, timeframe, limit = 300) {
      if (!scene[symbol]) throw new Error("no such market");
      return { source: "Fake", candles: makeCandles({ now: now(), timeframeMs: TIMEFRAMES[timeframe].ms, count: limit, ...scene[symbol] }) };
    },
  };
}

function setup(trend) {
  const now = makeClock(); // 10 minutes into a 4-hour candle
  const state = newState();
  state.settings.watchlist = ["BTCUSDT"];
  const scene = { BTCUSDT: { trend } };
  const market = fakeMarket(scene, now);
  const round = async () => tick(state, { market, now: now() });
  const html = async () => (await round()).map((message) => message.html);
  return { now, state, scene, market, round, html };
}

const LATE = 3 * 60 * 60 * 1000 + 10 * 60 * 1000; // from 10 minutes in to 40 minutes before the close

test("a round sends the buy sign once in the last hour, then buys when the candle closes", async () => {
  const { now, state, scene, round, html } = setup("down");
  assert.deepEqual(await html(), [], "the closed candle is judged: no buy in a falling market");

  // The market turns up, but the close is still hours away: no sign yet.
  scene.BTCUSDT.trend = "up";
  now.advance(TICK_MS);
  assert.deepEqual(await html(), []);

  now.advance(LATE - TICK_MS);
  const messages = await round();
  assert.equal(messages.length, 1);
  assert.match(messages[0].html, /Heads-up: a BTC buy looks likely at 15:00 WIB/);
  assert.match(messages[0].html, /closes in 40 minutes/);
  assert.match(messages[0].html, /all 3 checks would pass/);
  assert.match(messages[0].html, /I buy at my first 5-minute check after 15:00 WIB/);
  assert.match(messages[0].html, /not an order: nothing is bought or sold yet/);
  assert.deepEqual([messages[0].soon.symbol, messages[0].soon.kind, messages[0].soon.what], ["BTCUSDT", "buy", "sign"]);
  assert.deepEqual(state.portfolio.positions, {}, "a sign buys nothing");
  assert.equal(state.trades.length, 0);

  // Told once for this candle.
  now.advance(TICK_MS);
  assert.deepEqual(await html(), []);

  // The candle closes: the rules buy, and no "went away" follows.
  now.advance(45 * 60 * 1000);
  const after = await html();
  assert.equal(after.length, 1);
  assert.match(after[0], /Bought BTC/);
  assert.equal(state.marks.BTCUSDT.soon, undefined);
});

test("a sign that does not come true is followed by one message saying so", async () => {
  const { now, scene, html } = setup("down");
  await html();
  scene.BTCUSDT.trend = "up";
  now.advance(LATE);
  assert.match((await html())[0], /buy looks likely/);

  // The market falls back before the close.
  scene.BTCUSDT.trend = "down";
  now.advance(45 * 60 * 1000);
  const after = await html();
  assert.equal(after.length, 1);
  assert.match(after[0], /BTC: the buy sign went away/);
  assert.match(after[0], /nothing was bought: waiting for/);
  assert.match(after[0], /at 19:00 WIB/);
  now.advance(TICK_MS);
  assert.deepEqual(await html(), []);
});

test("no buy sign for a buy that would not be made: paused, asked already, or in ask mode it says so", async () => {
  const paused = setup("down");
  await paused.html();
  paused.state.settings.paused = true;
  paused.scene.BTCUSDT.trend = "up";
  paused.now.advance(LATE);
  assert.deepEqual(await paused.html(), []);

  const skipped = setup("down");
  await skipped.html();
  skipped.state.marks.BTCUSDT.passed = "skipped";
  skipped.scene.BTCUSDT.trend = "up";
  skipped.now.advance(LATE);
  assert.deepEqual(await skipped.html(), []);

  const asking = setup("down");
  await asking.html();
  asking.state.settings.auto = false;
  asking.scene.BTCUSDT.trend = "up";
  asking.now.advance(LATE);
  assert.match((await asking.html())[0], /I ask you first, right after 15:00 WIB/);
});

test("a held coin: the sale sign comes once in the last hour, and a stop that comes close is told once", async () => {
  const { now, state, scene, html } = setup("up");
  assert.match((await html())[0], /Bought BTC/);
  const position = state.portfolio.positions.BTCUSDT;
  position.stop = 0.0001; // far away, so only the rules can sell
  state.settings.dailyLossPct = 100; // the pretend market falls far: the day's loss limit is not what is tested

  now.advance(TICK_MS);
  assert.deepEqual(await html(), [], "nothing to tell while all is well");

  scene.BTCUSDT.trend = "down";
  now.advance(LATE - TICK_MS);
  const told = await html();
  assert.equal(told.length, 1);
  assert.match(told[0], /Heads-up: a BTC sale looks likely at 15:00 WIB/);
  assert.match(told[0], /momentum would turn down|the uptrend would be broken/);
  assert.match(told[0], /kept only if the candle closes above/);
  assert.ok(state.portfolio.positions.BTCUSDT, "a sign sells nothing");
  now.advance(TICK_MS);
  assert.deepEqual(await html(), []);
  now.advance(45 * 60 * 1000);
  assert.match((await html())[0], /Sold BTC/);

  // The stop: told when the price is within one usual candle move of it, and not again.
  const near = setup("up");
  await near.html();
  const held = near.state.portfolio.positions.BTCUSDT;
  near.now.advance(TICK_MS);
  await near.html();
  held.stop = near.state.marks.BTCUSDT.price * 0.999;
  near.now.advance(TICK_MS);
  const close = await near.html();
  assert.equal(close.length, 1);
  assert.match(close[0], /Heads-up: BTC is close to its stop/);
  assert.match(close[0], /0\.1% above the stop/);
  near.now.advance(TICK_MS);
  assert.deepEqual(await near.html(), []);
  // Well clear again, then close again: told again.
  held.stop = near.state.marks.BTCUSDT.price * 0.5;
  near.now.advance(TICK_MS);
  assert.deepEqual(await near.html(), []);
  held.stop = near.state.marks.BTCUSDT.price * 0.999;
  near.now.advance(TICK_MS);
  assert.match((await near.html())[0], /close to its stop/);
});

test("/signals carries the heads-up under each coin, and its words follow the level", async () => {
  const { now, state, scene, market, html } = setup("down");
  await html();
  let rows = await readSignals(state, market, now());
  assert.equal(rows[0].soon.kind, "buy");
  assert.equal(rows[0].soon.level, "far");
  let text = signals(rows, state, now()).html;
  assert.match(text, /Heads-up: no buy/);
  assert.match(text, /Earliest by my estimate: /);

  scene.BTCUSDT.trend = "up";
  now.advance(LATE);
  rows = await readSignals(state, market, now());
  assert.equal(rows[0].soon.level, "likely");
  text = signals(rows, state, now()).html;
  assert.match(text, /🟢 Heads-up: a buy looks likely at 15:00 WIB \(in 40 minutes\)\. At the price now all 3 checks would pass\. It happens only if the candle closes between /);
  assert.equal(/Earliest by my estimate/.test(text), false, "likely needs no estimate");
  assert.match(soonLines({ ...rows[0], blocked: "buying is paused" }, state, now())[0], /But nothing would be bought: buying is paused\./);

  const soon = rows[0].soon;
  const line = (changed) => soonLines({ soon: { ...soon, ...changed } }, state, now()).join("\n");
  assert.match(line({ level: "near", needPct: 0.4, movePct: 1.2 }), /🟡 Heads-up: a buy is close\. At 15:00 WIB \(in 40 minutes\) it needs a close above .* \(\+0\.4% from now\): less than one usual candle move \(1\.2%\)\./);
  assert.match(line({ level: "near", needPct: -0.4, movePct: 1.2 }), /it needs a close under .* \(-0\.4% from now\)/);
  assert.match(line({ level: "far", needPct: 3.6, movePct: 1.2, moves: 3, earliest: null }), /no buy in sight at 15:00 WIB\. It would need a close above .* \(\+3\.6% from now\), about 3\.0 usual candle moves \(1\.2% each\)\.\nEarliest by my estimate: not in the next 60 candles \(10 days\)/);
  assert.match(line({ level: "far", open: false }), /No closing price passes all 3 checks at this candle\./);
  assert.match(line({ level: "far", needPct: 2, moves: 2, earliest: { at: AT + 2 * FOUR_HOURS, candles: 3, price: soon.price * 1.02, pct: 2, pace: 0.5 } }), /Earliest by my estimate: 23:00 WIB \(3 candles from now\), and only if the price climbs steadily to about .* \(\+2\.0%\)\. A rough estimate, not a forecast\./);
  assert.match(line({ level: "wait", from: AT + 5 * FOUR_HOURS }), /⏳ Heads-up: no buy before 16 Jan 11:00 WIB\. I leave a coin alone for 6 candles after a sale\./);
  assert.deepEqual(soonLines({ soon: { kind: "buy", level: "unknown", at: AT } }, state, now()), []);
  assert.deepEqual(soonLines({}, state, now()), []);

  const selling = { kind: "sell", at: AT, price: 100, movePct: 1.2, under: 97, stop: 95, toClose: 3, toStop: 5, why: "", near: "" };
  const sale = (changed) => soonLines({ soon: { ...selling, ...changed } }, state, now())[0];
  assert.match(sale({ level: "far" }), /⚪ Heads-up: no sale in sight\. I sell at 15:00 WIB only if the candle closes under \$97\.0000 \(3% under the price now\), or at any hour if the price falls to the stop at \$95\.0000 \(5% under the price now\)\./);
  assert.match(sale({ level: "near", near: "close", toClose: 0.8, under: 99.2 }), /🟡 Heads-up: a sale is close\./);
  assert.match(sale({ level: "near", near: "stop", toStop: 0.6, stop: 99.4 }), /🟠 Heads-up: the stop is close\. It is at \$99\.4000 \(0\.6% under the price now\)/);
  assert.match(sale({ level: "likely", why: "momentum", under: 101 }), /🔴 Heads-up: a sale looks likely at 15:00 WIB \(in 40 minutes\)\. At the price now momentum would turn down\. I keep it only if the candle closes above \$101\.00 \(\+1\.0% from now\)\./);
  assert.match(sale({ level: "likely", why: "trend", under: 101 }), /the uptrend would be broken/);

  assert.equal(closeHours("4h"), "03:00, 07:00, 11:00, 15:00, 19:00 and 23:00 WIB");
  assert.equal(closeHours("1d"), "07:00 WIB");
  assert.equal(closeHours("15m"), "every 15m");
});

// ---------------------------------------------------------------- the real account at Indodax

function realView(extra = {}) {
  const report = cleanReport({
    mode: "real",
    keys: true,
    checked: true,
    cash: 50000,
    orderIdr: 20000,
    maxOpen: 1,
    stopPercent: 8,
    positions: [],
    closed: [],
    market: [{ coin: "BTC", bid: 1650000000, ask: 1651000000 }],
    result: { practice: 0, real: 0 },
    today: { practice: 0, real: 0, buys: 0 },
    notes: [],
    ...extra,
  });
  return { configured: true, report, at: NOW - 20000, now: NOW, paused: false };
}

const REAL_BTC = { symbol: "BTCUSDT", pair: "btc_idr", real: true, quantity: 0.0000121, spent: 20000, price: 1650000000, now: 1660000000, value: 20100, openedAt: NOW - 3600000 };

function signsOf(kind) {
  const state = newState();
  const buy = { kind: "buy", level: "likely", at: AT, price: 100, low: 99, high: 103, movePct: 1.2 };
  const sell = { kind: "sell", level: "likely", at: AT, price: 100, under: 101, why: "momentum", stop: 95, toStop: 5, movePct: 1.2 };
  if (kind === "buy") return sign("BTCUSDT", buy, state, NOW);
  if (kind === "sell") return sign("BTCUSDT", sell, state, NOW);
  if (kind === "gone") return signGone("BTCUSDT", "buy", "waiting for RSI", state, AT + 60000);
  return stopNear("BTCUSDT", { ...sell, toStop: 0.6, stop: 99.4 });
}

test("real mode: a sign is rewritten for the real account, and kept only when a real order would follow", () => {
  const kept = (message, seen) => onlyReal([message, { html: "🟢 Bought BTC · practice money" }], seen);
  for (const kind of ["buy", "sell", "gone", "stop"]) assert.match(signsOf(kind).html, /practice money/);

  const buy = kept(signsOf("buy"), realView());
  assert.equal(buy.length, 1);
  assert.match(buy[0].html, /Heads-up: a BTC buy looks likely at 15:00 WIB<\/b> · ⚠️ <b>REAL MONEY<\/b>/);
  assert.match(buy[0].html, /the sender on your PC buys Rp20\.000 of BTC at Indodax within about a minute\. The PC has to be on\./);
  assert.match(buy[0].html, /not an order/);
  assert.equal(/practice|pretend/i.test(buy[0].html), false);

  // Ask mode: the owner is asked first.
  const asking = signsOf("buy");
  asking.soon.auto = false;
  assert.match(kept(asking, realView())[0].html, /I ask you first\. The sender on your PC buys Rp20\.000 of BTC only after you approve\./);

  // No real buy would follow: no sign.
  assert.deepEqual(kept(signsOf("buy"), { ...realView(), paused: true }), []);
  assert.deepEqual(kept(signsOf("buy"), realView({ paused: true })), []);
  assert.deepEqual(kept(signsOf("buy"), realView({ tripped: true, trippedWhy: "The balance did not match." })), []);
  assert.deepEqual(kept(signsOf("buy"), realView({ positions: [{ ...REAL_BTC, symbol: "ETHUSDT" }], market: [{ coin: "BTC", bid: 1, ask: 2 }, { coin: "ETH", bid: 1, ask: 2 }] })), [], "already holding the most at one time");
  assert.deepEqual(kept(signsOf("buy"), realView({ market: [{ coin: "ETH", bid: 1, ask: 2 }] })), [], "a coin the sender does not trade");
  assert.deepEqual(kept(signsOf("gone"), { ...realView(), paused: true }), []);

  // Too little rupiah is said, because the owner can do something about it.
  const poor = kept(signsOf("buy"), realView({ cash: 9856 }));
  assert.match(poor[0].html, /⚠️ But nothing would be bought: the free rupiah \(Rp9\.856\) is less than one buy of Rp20\.000\./);

  // The follow-up.
  const gone = kept(signsOf("gone"), realView());
  assert.match(gone[0].html, /BTC: the buy sign went away<\/b> · ⚠️ <b>REAL MONEY<\/b>\nThe candle closed and nothing was bought: waiting for RSI\./);
  assert.equal(/practice|pretend/i.test(gone[0].html), false);

  // A sale or a stop is news only when this account holds the coin.
  assert.deepEqual(kept(signsOf("sell"), realView()), []);
  assert.deepEqual(kept(signsOf("stop"), realView()), []);
  const holding = realView({ positions: [REAL_BTC] });
  const sale = kept(signsOf("sell"), holding);
  assert.match(sale[0].html, /a BTC sale looks likely at 15:00 WIB<\/b> · ⚠️ <b>REAL MONEY<\/b>/);
  assert.match(sale[0].html, /If it does not, the sender on your PC sells your BTC at Indodax within about a minute\./);
  assert.equal(/practice|pretend/i.test(sale[0].html), false);
  const stop = kept(signsOf("stop"), holding);
  assert.match(stop[0].html, /If it falls to the stop, the sender on your PC sells your BTC at Indodax within about a minute, at any hour\./);
});

test("real mode: the sender's own stop coming close is told once, and again only after the price was well clear", () => {
  const at = (now) => cleanReport({ mode: "real", stopPercent: 8, orderIdr: 20000, maxOpen: 1, positions: [{ ...REAL_BTC, now }], closed: [], market: [] });
  const stop = REAL_BTC.price * 0.92;
  const key = `BTCUSDT:${REAL_BTC.openedAt}`;

  const far = stopSigns(at(stop * 1.05), {});
  assert.deepEqual(far, { messages: [], told: {} });

  const near = stopSigns(at(stop * (1 + STOP_NEAR_PCT / 100 - 0.001)), {});
  assert.equal(near.messages.length, 1);
  assert.match(near.messages[0].html, /Heads-up: BTC is close to the sender's stop<\/b> · <b>REAL MONEY<\/b>/);
  assert.match(near.messages[0].html, /is 1\.9% above the stop at Rp1\.518\.000\.000, which is 8% under the Rp1\.650\.000\.000 paid\./);
  assert.match(near.messages[0].html, /for about Rp18\.400 of the Rp20\.000 paid/);
  assert.deepEqual(near.told, { [key]: true });

  // Still near, or a little above: not told again.
  assert.deepEqual(stopSigns(at(stop * 1.01), near.told), { messages: [], told: { [key]: true } });
  assert.deepEqual(stopSigns(at(stop * 1.03), near.told), { messages: [], told: { [key]: true } });
  // A minute without a price keeps what was told.
  assert.deepEqual(stopSigns(at(0), near.told), { messages: [], told: { [key]: true } });
  // Well clear: forgotten, so the next approach is told again.
  const clear = stopSigns(at(stop * (1 + STOP_CLEAR_PCT / 100 + 0.001)), near.told);
  assert.deepEqual(clear, { messages: [], told: {} });
  assert.equal(stopSigns(at(stop * 1.01), clear.told).messages.length, 1);
  // Already under the stop: the sale itself is the news.
  assert.equal(stopSigns(at(stop * 0.99), {}).messages.length, 0);
  // A coin that was sold is forgotten.
  assert.deepEqual(stopSigns(cleanReport({ mode: "real", stopPercent: 8, positions: [], closed: [], market: [] }), near.told), { messages: [], told: {} });
  assert.deepEqual(stopSigns(null, near.told), { messages: [], told: {} });
});

test("real mode: /headsup, the report and the desktop app all carry the same heads-up", async () => {
  const { now, state, scene, market, html } = setup("down");
  await html();
  scene.BTCUSDT.trend = "up";
  now.advance(LATE);
  const rows = await readSignals(state, market, now());
  const seen = { ...realView(), now: now() };
  const extra = { state, rows };

  const soon = fullReport(seen, extra, "soon").html;
  assert.match(soon, /📋 <b>Indodax: heads-up<\/b> · ⚠️ <b>REAL MONEY<\/b>/);
  assert.match(soon, /<b>How near a buy or a sale is<\/b>\n<b>BTC<\/b>\n🟢 Heads-up: a buy looks likely at 15:00 WIB/);
  assert.match(soon, /In the last hour before a 4h candle closes \(03:00, 07:00, 11:00, 15:00, 19:00 and 23:00 WIB\)/);
  assert.match(soon, /not an order and not a forecast/);
  assert.equal(/practice|pretend/i.test(soon), false);
  assert.equal(/<b>Market<\/b>|<b>History<\/b>/.test(soon), false, "only the heads-up");

  // The full report and /analysis carry it under the three checks.
  for (const topic of ["all", "analysis"]) assert.match(fullReport(seen, extra, topic).html, /✅ RSI: .*\n→ .*\n🟢 Heads-up: a buy looks likely/);

  // A buy the sender would not make says why.
  const poor = fullReport({ ...realView({ cash: 9856 }), now: now() }, extra, "soon").html;
  assert.match(poor, /But nothing would be bought: the free rupiah \(Rp9\.856\) is less than one buy of Rp20\.000\./);
  const paused = fullReport({ ...seen, paused: true }, extra, "soon").html;
  assert.match(paused, /But nothing would be bought: buying is paused\./);

  // The desktop app gets the same lines as plain text, with the level and the time.
  const data = viewData(seen, extra);
  assert.equal(data.signals[0].soon.kind, "buy");
  assert.equal(data.signals[0].soon.level, "likely");
  assert.equal(data.signals[0].soon.at, AT);
  assert.match(data.signals[0].soon.lines[0], /^🟢 Heads-up: a buy looks likely at 15:00 WIB/);
  assert.equal(/[<>]/.test(data.signals[0].soon.lines.join("")), false, "plain text");
  assert.match(data.text, /Heads-up: a buy looks likely/);

  // A coin held at Indodax: the sale's heads-up and how far the sender's own stop is.
  state.portfolio.positions.BTCUSDT = { qty: 1, entry: rows[0].price, cost: rows[0].price, stop: rows[0].price * 0.9, openedAt: now() };
  const heldRows = await readSignals(state, market, now());
  assert.equal(heldRows[0].soon.kind, "sell");
  const holding = { ...realView({ positions: [REAL_BTC] }), now: now() };
  const held = fullReport(holding, { state, rows: heldRows }, "soon").html;
  assert.match(held, /<b>BTC<\/b> · you hold it\n⚪ Heads-up: no sale in sight\./);
  assert.match(held, /🛡 The sender's own stop \(8% under the price paid\) is at Rp1\.518\.000\.000 per coin: the Indodax price is 9\.4% above it\./);
  assert.equal(viewData(holding, { state, rows: heldRows }).signals[0].soon.kind, "sell");

  // The strategy holds it but this account does not: its sale is no news here.
  const none = fullReport(seen, { state, rows: heldRows }, "soon").html;
  assert.match(none, /<b>BTC<\/b>: the strategy holds it from before, and at Indodax you hold none\./);
  assert.equal(/Heads-up: no sale/.test(none), false);
  assert.equal(viewData(seen, { state, rows: heldRows }).signals[0].soon, null);
  assert.equal(/Heads-up: no sale/.test(fullReport(seen, { state, rows: heldRows }, "analysis").html), false);

  // Without the signals the part says so instead of guessing.
  assert.match(fullReport(seen, null, "soon").html, /I could not read the prices just now, so there is no heads-up\./);

  // /help names the command and the sign.
  const help = realHelp(seen, state.settings).html;
  assert.match(help, /\/headsup how near a buy or a sale is/);
  assert.match(help, /in the last hour before a candle closes I tell you/);
});
