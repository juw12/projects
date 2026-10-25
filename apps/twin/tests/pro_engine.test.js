// Unit tests for web/pro.js (orders, bracket legs, replay, analytics). Run: node pro_engine.test.js
"use strict";
const assert = require("assert");
const path = require("path");
require(path.join(__dirname, "..", "web", "pro.js"));
const P = globalThis.TwinPro;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error("FAIL:", name, "\n ", error.message);
    process.exitCode = 1;
  }
}
const T = "2026-01-02T00:00:00Z";
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

/* ---------------- indicators ---------------- */
test("sma aligns and averages", () => {
  const out = P.sma([1, 2, 3, 4, 5], 3);
  assert.deepStrictEqual(out.slice(0, 2), [null, null]);
  close(out[2], 2);
  close(out[4], 4);
});
test("rsi is 100 on a straight rise and ~0 on a straight fall", () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const down = Array.from({ length: 30 }, (_, i) => 100 - i);
  close(P.rsi(up)[29], 100);
  assert.ok(P.rsi(down)[29] < 1);
  assert.strictEqual(P.rsi(up)[13], null);
});
test("seriesStats drawdown and return", () => {
  const s = P.seriesStats([100, 120, 90, 110]);
  close(s.total_return_pct, 10);
  close(s.max_drawdown_pct, -25);
  assert.ok(s.volatility_pct > 0);
});

/* ---------------- order validation ---------------- */
test("validation rejects nonsense", () => {
  assert.throws(() => P.createOrder({ symbol: "SPY", side: "buy", type: "limit", dollars: 100 }, 100, T), /limit price/);
  assert.throws(() => P.createOrder({ symbol: "SPY", side: "buy", type: "market" }, 100, T), /amount/);
  assert.throws(() => P.createOrder({ symbol: "SPY", side: "hold", dollars: 5 }, 100, T), /side/);
  assert.throws(() => P.createOrder({ symbol: "SPY", side: "sell", type: "stop", qty: 1, stop: 105 }, 100, T), /below/);
  assert.throws(() => P.createOrder({ symbol: "SPY", side: "buy", type: "stop", qty: 1, stop: 95 }, 100, T), /above/);
  assert.throws(() => P.createOrder({ symbol: "SPY", side: "buy", type: "stop_limit", qty: 1, stop: 105, limit: 104 }, 100, T), /at or above/);
  assert.throws(() => P.createOrder({ symbol: "SPY", side: "sell", type: "trailing", qty: 1, trail_pct: 80 }, 100, T), /50/);
  assert.throws(() => P.createOrder({ symbol: "SPY", side: "buy", dollars: 50, take_profit: 90 }, 100, T), /above the entry/);
  assert.throws(() => P.createOrder({ symbol: "SPY", side: "buy", dollars: 50, stop_loss: 101 }, 100, T), /below the entry/);
  assert.throws(() => P.createOrder({ symbol: "SPY", side: "sell", qty: 1, take_profit: 120 }, 100, T), /attach to buy/);
});

/* ---------------- fill rules ---------------- */
function fills(order, prices) {
  let o = order;
  for (const price of prices) {
    const r = P.checkOrder(o, price);
    o = r.order;
    if (r.fill) {
      return price;
    }
  }
  return null;
}
test("buy limit fills only at or below the limit", () => {
  const o = P.createOrder({ symbol: "AAPL", side: "buy", type: "limit", dollars: 100, limit: 95 }, 100, T);
  assert.strictEqual(fills(o, [99, 97, 95.5, 94.8, 93]), 94.8);
});
test("sell limit fills at or above", () => {
  const o = P.createOrder({ symbol: "AAPL", side: "sell", type: "limit", qty: 1, limit: 110 }, 100, T);
  assert.strictEqual(fills(o, [105, 109.99, 110]), 110);
});
test("sell stop triggers at or below the stop", () => {
  const o = P.createOrder({ symbol: "AAPL", side: "sell", type: "stop", qty: 1, stop: 90 }, 100, T);
  assert.strictEqual(fills(o, [95, 91, 89]), 89);
});
test("buy stop-limit triggers then waits for the limit", () => {
  const o = P.createOrder({ symbol: "AAPL", side: "buy", type: "stop_limit", qty: 1, stop: 105, limit: 106 }, 100, T);
  // triggers at 107 (above stop) but 107 > limit, so waits; fills at 105.5
  assert.strictEqual(fills(o, [104, 107, 108, 105.5]), 105.5);
});
test("trailing sell follows the high and fires on the pullback", () => {
  const o = P.createOrder({ symbol: "AAPL", side: "sell", type: "trailing", qty: 1, trail_pct: 10 }, 100, T);
  // high 120 -> level 108; 110 holds, 107 fires
  assert.strictEqual(fills(o, [105, 120, 110, 107]), 107);
});
test("trailing buy follows the low and fires on the bounce", () => {
  const o = P.createOrder({ symbol: "AAPL", side: "buy", type: "trailing", dollars: 100, trail_pct: 5 }, 100, T);
  // low 80 -> level 84
  assert.strictEqual(fills(o, [90, 80, 83, 84.5]), 84.5);
});

/* ---------------- account + brackets ---------------- */
test("market buy with bracket creates OCO legs; take-profit cancels stop-loss", () => {
  const acct = P.newAccount(10000);
  const placed = P.placeOrder(acct, { symbol: "NVDA", side: "buy", type: "market", qty: 10, take_profit: 120, stop_loss: 90 }, 100, T);
  assert.strictEqual(placed.order.status, "filled");
  close(acct.cash, 9000);
  const legs = acct.orders.filter((o) => o.group === placed.order.id);
  assert.deepStrictEqual(legs.map((o) => o.role).sort(), ["stop_loss", "take_profit"]);
  P.processOrders(acct, { NVDA: 110 }, T);
  assert.ok(legs.every((o) => acct.orders.find((x) => x.id === o.id).status === "open"));
  const events = P.processOrders(acct, { NVDA: 121 }, T);
  assert.strictEqual(events.find((e) => e.kind === "filled").order.role, "take_profit");
  assert.strictEqual(events.find((e) => e.kind === "cancelled").order.role, "stop_loss");
  close(acct.cash, 9000 + 1210);
  assert.strictEqual(acct.positions.NVDA, undefined);
  close(acct.closed[0].pnl, 210);
});
test("stop-loss leg fires and realizes the loss", () => {
  const acct = P.newAccount(5000);
  P.placeOrder(acct, { symbol: "TSLA", side: "buy", qty: 10, stop_loss: 180 }, 200, T);
  P.processOrders(acct, { TSLA: 179 }, T);
  close(acct.closed[0].pnl, -210);
  close(acct.cash, 5000 - 2000 + 1790);
});
test("bracket leg sells only what is left if you sold some manually", () => {
  const acct = P.newAccount(5000);
  P.placeOrder(acct, { symbol: "KO", side: "buy", qty: 10, take_profit: 70 }, 60, T);
  P.placeOrder(acct, { symbol: "KO", side: "sell", qty: 4 }, 62, T);
  P.processOrders(acct, { KO: 71 }, T);
  assert.strictEqual(acct.positions.KO, undefined);
  close(acct.fills[acct.fills.length - 1].qty, 6);
});
test("pending buy rejected when cash ran out; oversell rejected", () => {
  const acct = P.newAccount(1000);
  P.placeOrder(acct, { symbol: "SPY", side: "buy", type: "limit", dollars: 900, limit: 95 }, 100, T);
  P.placeOrder(acct, { symbol: "QQQ", side: "buy", dollars: 500 }, 50, T);
  const events = P.processOrders(acct, { SPY: 94 }, T);
  assert.strictEqual(events[0].kind, "rejected");
  assert.match(events[0].reason, /not enough cash/);
  assert.throws(() => P.createOrder({ symbol: "SPY", side: "sell", qty: 0 }, 100, T));
  const sell = P.placeOrder(acct, { symbol: "SPY", side: "sell", qty: 1 }, 100, T);
  assert.strictEqual(sell.order.status, "rejected");
});
test("marketable limit fills immediately; cancel works", () => {
  const acct = P.newAccount(1000);
  const a = P.placeOrder(acct, { symbol: "GLD", side: "buy", type: "limit", dollars: 100, limit: 210 }, 200, T);
  assert.strictEqual(a.order.status, "filled");
  const b = P.placeOrder(acct, { symbol: "GLD", side: "buy", type: "limit", dollars: 100, limit: 150 }, 200, T);
  assert.strictEqual(b.order.status, "open");
  assert.ok(P.cancelOrder(acct, b.order.id, T));
  assert.strictEqual(acct.orders.find((o) => o.id === b.order.id).status, "cancelled");
  assert.ok(!P.cancelOrder(acct, b.order.id, T));
});

/* ---------------- replay ---------------- */
function series(start, values) {
  return values.map((v, i) => [start + i * 86400, v]);
}
test("replay: no look-ahead, orders fill at later closes, benchmark tracks SPY", () => {
  const t0 = 1700000000;
  const spy = series(t0, Array.from({ length: 60 }, (_, i) => 100 + i));      // steady rise
  const xyz = series(t0, Array.from({ length: 60 }, (_, i) => (i < 30 ? 50 : 50 - (i - 29))));  // falls after day 30
  const tl = P.buildTimeline({ SPY: spy, XYZ: xyz });
  const replay = P.newReplay(tl, 25, 10000);
  assert.strictEqual(replay.day, 25);
  P.replayPlace(replay, tl, { symbol: "XYZ", side: "buy", qty: 100, stop_loss: 45 });
  close(replay.account.cash, 10000 - 5000);
  P.replayAdvance(replay, tl, 5);   // day 30: XYZ 49
  assert.strictEqual(replay.account.closed.length, 0);
  P.replayAdvance(replay, tl, 5);   // day 35: XYZ 44 -> stop fired at first close <= 45 (day 34: 45)
  assert.strictEqual(replay.account.closed.length, 1);
  close(replay.account.closed[0].pnl, (45 - 50) * 100);
  const s = P.replaySummary(replay, tl);
  close(s.bench_return_pct, ((135 / 125) - 1) * 100, 0.01);
  assert.strictEqual(s.days_played, 10);
  assert.strictEqual(s.win_rate_pct, 0);
  assert.strictEqual(replay.equity.length, 11);
  // price chart for the current day must not include future closes
  assert.strictEqual(tl.closes.XYZ.slice(0, replay.day + 1).length, 36);
});
test("replay stops at the last day", () => {
  const t0 = 1700000000;
  const tl = P.buildTimeline({ SPY: series(t0, Array.from({ length: 40 }, (_, i) => 100 + i)) });
  const replay = P.newReplay(tl, 30, 1000);
  P.replayAdvance(replay, tl, 999);
  assert.strictEqual(replay.day, 39);
  assert.strictEqual(P.replaySummary(replay, tl).days_left, 0);
});

/* ---------------- analytics ---------------- */
test("lookback weights and allocation notes", () => {
  const t0 = 1700000000;
  const spy = series(t0, Array.from({ length: 50 }, (_, i) => 100 + i));
  const aaa = series(t0, Array.from({ length: 50 }, (_, i) => 10 + i * 0.2));
  const lb = P.lookback({ AAA: 600, SPY: 400 }, { SPY: spy, AAA: aaa });
  close(lb.curve[0], 1);
  const expected = 0.6 * (10 + 49 * 0.2) / 10 + 0.4 * 149 / 100;
  close(lb.curve[lb.curve.length - 1], expected);
  close(lb.benchmark.total_return_pct, 49, 0.01);
  const alloc = P.allocation([{ symbol: "NVDA", value: 6000 }, { symbol: "SPY", value: 2000 }], 2000);
  assert.match(alloc.note, /NVDA is 60%/);
  assert.deepStrictEqual(alloc.classes.map((c) => c.name), ["Single stock", "US stock fund", "Cash"]);
  assert.strictEqual(P.allocation([], 1000).note.startsWith("All cash"), true);
});

console.log(`${passed} pro-engine tests passed`);
