"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const lab = require("../web/strategy-lab.js");
const start = Date.UTC(2024, 0, 1) / 1000;
const asOf = start + 500 * 86400;
const series = (count = 240, price = (i) => 100 + i / 10 + 8 * Math.sin(i / 6)) =>
  Array.from({ length: count }, (_, index) => [start + index * 86400, price(index)]);
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

// Arithmetic examples intentionally use small synthetic histories, not cherry-picked market returns.
test("same inputs produce identical complete reports", () => {
  assert.deepEqual(lab.evaluate(series(), { asOf }), lab.evaluate(series(), { asOf }));
});
test("holdout cannot change the selected training parameter", () => {
  const first = series();
  const split = Math.floor(first.length * 0.6);
  const altered = first.map((point, index) => index < split ? [...point] : [point[0], 1000 + index * 50]);
  const a = lab.evaluate(first, { asOf });
  const b = lab.evaluate(altered, { asOf });
  assert.equal(a.selectedPeriod, b.selectedPeriod);
  assert.deepEqual(a.training, b.training);
});
test("future prices cannot change earlier equity or trade decisions", () => {
  const points = series();
  const changed = points.map((point, index) => [point[0], index < 190 ? point[1] : point[1] * 3]);
  const a = lab.simulate(points, 100, 239, 20);
  const b = lab.simulate(changed, 100, 239, 20);
  assert.deepEqual(a.equity.filter((point) => point[0] < points[190][0]), b.equity.filter((point) => point[0] < points[190][0]));
  assert.deepEqual(a.trades.filter((trade) => trade.time < points[190][0]), b.trades.filter((trade) => trade.time < points[190][0]));
});
test("a close shock cannot be bought at the previous close", () => {
  const points = [100, 100, 100, 100, 200, 300, 300].map((value, index) => [start + index * 86400, value]);
  const result = lab.simulate(points, 2, 6, 2, { feeBps: 0, slippageBps: 0 });
  assert.equal(result.trades[0].time, points[5][0]);
  assert.equal(result.trades[0].signalTime, points[4][0]);
  assert.equal(result.trades[0].fill, 300);
  closeTo(result.returnPct, 0);
});
test("every nonterminal fill follows its signal", () => {
  for (const trade of lab.evaluate(series(), { asOf }).strategy.trades) {
    if (trade.signalTime !== null) {
      assert.ok(trade.time > trade.signalTime);
    }
  }
});
test("benchmark buys first holdout close, sells last, charges both sides", () => {
  const points = series(10, (i) => 100 + i * 10);
  const result = lab.simulate(points, 2, 9, 2, { buyHold: true, feeBps: 10, slippageBps: 20 });
  const expected = 100 * ((190 * 0.998 * 0.999) / (120 * 1.002 * 1.001) - 1);
  closeTo(result.returnPct, expected);
  assert.equal(result.roundTrips, 1);
  closeTo(result.exposurePct, 100);
});
test("cash-only flat-price strategy earns exactly zero", () => {
  const report = lab.evaluate(series(240, () => 100), { asOf });
  closeTo(report.strategy.returnPct, 0);
  closeTo(report.strategy.maxDrawdownPct, 0);
  assert.equal(report.strategy.roundTrips, 0);
  assert.equal(report.selectedPeriod, 10);
  assert.ok(report.benchmark.returnPct < 0);
});
test("more costs cannot improve a fixed-period run", () => {
  const low = lab.simulate(series(), 100, 239, 20, { feeBps: 0, slippageBps: 0 });
  const high = lab.simulate(series(), 100, 239, 20, { feeBps: 25, slippageBps: 25 });
  assert.ok(high.returnPct < low.returnPct);
  assert.equal(low.roundTrips, high.roundTrips);
});
test("drawdown measures peak-to-trough including initial costs", () => {
  const points = [100, 100, 100, 120, 60, 120].map((value, index) => [start + index * 86400, value]);
  const result = lab.simulate(points, 2, 5, 2, { buyHold: true, feeBps: 0, slippageBps: 0 });
  closeTo(result.maxDrawdownPct, -50);
  closeTo(result.returnPct, 20);
});
test("as-of excludes future observations", () => {
  const points = series();
  const report = lab.evaluate(points, { asOf: points[179][0] });
  assert.equal(report.data.count, 180);
  assert.equal(report.data.end, points[179][0]);
  assert.deepEqual(report, lab.evaluate(points.slice(0, 180), { asOf: points[179][0] }));
});
test("input is never mutated", () => {
  const points = series();
  const before = JSON.stringify(points);
  lab.evaluate(points, { asOf });
  assert.equal(JSON.stringify(points), before);
});
test("rejects nonfinite, nonpositive and string prices", () => {
  for (const value of [NaN, Infinity, -1, 0, Number.MIN_VALUE, "100", null, true]) {
    const points = series();
    points[4][1] = value;
    assert.throws(() => lab.evaluate(points, { asOf }), /Close/);
  }
});
test("rejects duplicate or reversed timestamps", () => {
  const points = series();
  points[5][0] = points[4][0];
  assert.throws(() => lab.evaluate(points, { asOf }), /chronological/);
  assert.throws(() => lab.evaluate(series().reverse(), { asOf }), /chronological/);
});
test("rejects intraday and large missing-history gaps", () => {
  const intraday = series().map((point, index) => [start + index * 300, point[1]]);
  assert.throws(() => lab.evaluate(intraday, { asOf }), /daily/);
  const gap = series().map((point, index) => [point[0] + (index > 50 ? 15 * 86400 : 0), point[1]]);
  assert.throws(() => lab.evaluate(gap, { asOf }), /gap/);
});
test("does not mistake weekly history for daily observations", () => {
  const weekly = series().map((point, index) => [start + index * 7 * 86400, point[1]]);
  assert.throws(() => lab.evaluate(weekly, { asOf: weekly.at(-1)[0] }), /weekly/);
});
test("rejects too little history and invalid costs", () => {
  assert.throws(() => lab.evaluate(series(119), { asOf }), /120/);
  for (const feeBps of [NaN, Infinity, -1, 101, "5"]) {
    assert.throws(() => lab.evaluate(series(), { asOf, feeBps }), /Fee/);
  }
});
test("rejects invalid simulation bounds", () => {
  for (const args of [[0, 100, 20], [50, 50, 20], [50, 300, 20], [50, 100, 2.5]]) {
    assert.throws(() => lab.simulate(series(), ...args), /bounds/);
  }
});
test("training and holdout are nonoverlapping with common candidate warmup", () => {
  const report = lab.evaluate(series(), { asOf });
  assert.ok(report.training.end < report.holdout.start);
  assert.equal(report.training.start, series()[50][0]);
  assert.deepEqual(report.training.candidates.map((c) => c.period).sort((a, b) => a - b), [10, 20, 50]);
  assert.equal(report.strategy.equity[0][0], report.benchmark.equity[0][0]);
  assert.equal(report.strategy.equity.at(-1)[0], report.benchmark.equity.at(-1)[0]);
});
test("report replay includes every input and setting", () => {
  const first = lab.evaluate(series(), { asOf, feeBps: 8, slippageBps: 12 });
  const restored = JSON.parse(JSON.stringify(first));
  assert.deepEqual(lab.evaluate(restored.data.points, restored.settings), first);
});
test("all bundled US histories produce finite reports without network calls", () => {
  const market = JSON.parse(fs.readFileSync(path.join(__dirname, "../web/demo/market.json"), "utf8"));
  for (const [symbol, charts] of Object.entries(market.charts)) {
    const points = charts["1Y"].points;
    const report = lab.evaluate(points, { asOf: points.at(-1)[0] });
    assert.ok(Number.isFinite(report.excessReturnPp), symbol);
    assert.ok(report.strategy.maxDrawdownPct <= 0, symbol);
    assert.ok(report.strategy.returnPct >= -100, symbol);
  }
});
test("worker precaches both Strategy Lab scripts and stock page exposes feature", () => {
  const web = path.join(__dirname, "../web");
  const worker = fs.readFileSync(path.join(web, "sw.js"), "utf8");
  const index = fs.readFileSync(path.join(web, "index.html"), "utf8");
  for (const file of ["strategy-lab.js?v=1.8.0", "strategy-lab-ui.js?v=1.8.0"]) {
    assert.ok(worker.includes(file));
    assert.ok(index.includes(file));
  }
  assert.ok(fs.readFileSync(path.join(web, "pro-ui.js"), "utf8").includes("openStrategyLab(symbol)"));
});
