"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const agent = require("../web/twinagent.js");

const DAY = 86400;
const start = Date.UTC(2025, 0, 2) / 1000;
const asOf = start + 400 * DAY;
const daily = (count = 260, price = (i) => 100 * 1.001 ** i) => ({
  currency: "USD", name: "Example Corp",
  points: Array.from({ length: count }, (_, i) => [start + i * DAY, price(i)]),
});
const monthly = (months = 240, value = (i) => 0.01 + 0.04 * Math.sin(i / 5)) => {
  const out = {};
  for (let i = 0; i < months; i += 1) {
    out[`${2000 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`] = value(i);
  }
  return out;
};
const iso = (seconds) => new Date(seconds * 1000).toISOString();
const fundamentals = (filed = "2026-01-20") => ({
  rows: [
    { end: "2025-12-31", filed, form: "10-Q", revenue_yoy: 12, eps_yoy: 20, net_margin: 22, operating_margin: 30 },
    { end: "2024-12-31", filed: "2025-01-25", form: "10-Q", revenue_yoy: 5, eps_yoy: 6, net_margin: 20, operating_margin: 27 },
  ],
});
const news = () => ({
  items: [
    { id: "n1", title: "Example Corp beats estimates and raises outlook", time: iso(asOf - 2 * DAY), source: "Wire A" },
    { id: "n2", title: "Example shares rally on record demand", time: iso(asOf - DAY), source: "Wire B" },
    { id: "n3", title: "Lockheed backlog grows", summary: "Defense contractor news", time: iso(asOf - DAY), source: "Wire A" },
    { id: "future", title: "Example Corp plunges after fraud probe", time: iso(asOf + DAY), source: "Wire A" },
  ],
});
const profile = { riskLevel: 3, limits: { max_loss_per_trade_usd: 50, max_position_pct: 20, cash_buffer_pct: 10, min_reward_risk: 2, budget: 10000 } };
const portfolio = { cash: 10000, equity: 10000, heldValue: 0 };
const bundle = (overrides = {}) => ({
  symbol: "EXM", name: "Example Corp", daily: daily(), monthly: monthly(), fundamentals: fundamentals(),
  news: news(), holdings: null, mode: "test", ...overrides,
});

test("full pipeline runs every agent and produces a typed decision", () => {
  const report = agent.analyze(bundle(), { asOf, profile, portfolio });
  assert.equal(report.engine, "TwinAgent");
  assert.equal(report.agents.trend.status, "active");
  assert.equal(report.agents.risk.status, "active");
  assert.equal(report.agents.fundamentals.status, "active");
  assert.equal(report.agents.news.status, "active");
  assert.equal(report.agents.holdings.status, "abstained");
  assert.ok(["Buy", "Overweight", "Hold", "Underweight", "Sell"].includes(report.decision.rating));
  assert.ok(report.decision.composite >= -1 && report.decision.composite <= 1);
  assert.equal(report.scorecard.status, "active");
});

test("identical inputs give identical reports and fingerprints", () => {
  const a = agent.analyze(bundle(), { asOf, profile, portfolio });
  const b = agent.analyze(bundle(), { asOf, profile, portfolio });
  assert.deepEqual(a, b);
  assert.match(a.inputFingerprint, /^[0-9a-f]{8}$/);
});

test("data published after the as-of time cannot change the report", () => {
  const base = agent.analyze(bundle(), { asOf, profile, portfolio });
  const leaked = bundle();
  leaked.daily.points.push([asOf + DAY, 1], [asOf + 2 * DAY, 5000]);
  leaked.fundamentals.rows.unshift({ end: "2026-03-31", filed: iso(asOf + 5 * DAY), revenue_yoy: -90, eps_yoy: -90, net_margin: -50 });
  leaked.news.items.push({ title: "Example Corp crashes on weak recall lawsuit", time: iso(asOf + 3600), source: "Wire C" });
  const future = monthly(260, (i) => (i >= 240 ? -0.5 : 0.01 + 0.04 * Math.sin(i / 5)));
  const withFuture = agent.analyze({ ...leaked, monthly: future }, { asOf, profile, portfolio });
  for (const name of ["trend", "risk", "fundamentals", "news"]) {
    assert.deepEqual(withFuture.agents[name], base.agents[name], name);
  }
  assert.deepEqual(withFuture.decision, base.decision);
});

test("news analyst screens out loosely tagged headlines and future items", () => {
  const report = agent.analyze(bundle(), { asOf, profile, portfolio });
  assert.equal(report.agents.news.screening.relevant, 2);
  assert.equal(report.agents.news.screening.screenedOut, 1);
  assert.ok(report.agents.news.headlines.every((item) => item.id !== "future"));
  assert.ok(report.agents.news.score > 0);
});

test("headline lexicon handles negation and phrases", () => {
  assert.ok(agent.headlineSentiment("Company beats estimates").score > 0);
  assert.ok(agent.headlineSentiment("Company did not beat estimates").score < 0);
  assert.ok(agent.headlineSentiment("1 Red Flag That Keeps Me From Buying").score < 0);
  assert.equal(agent.headlineSentiment("Company holds annual meeting").score, 0);
});

test("stale or unpublished fundamentals make that analyst abstain", () => {
  const stale = agent.analyze(bundle({ fundamentals: fundamentals("2025-01-25") }), { asOf, profile, portfolio });
  assert.equal(stale.agents.fundamentals.status, "abstained");
  const unpublished = agent.analyze(bundle({ fundamentals: fundamentals(iso(asOf + DAY)) }), { asOf, profile, portfolio });
  assert.equal(unpublished.agents.fundamentals.rows, undefined);
  assert.ok(unpublished.agents.fundamentals.status === "abstained" || unpublished.agents.fundamentals.source.filed !== iso(asOf + DAY));
});

test("one-off accounting outliers are capped and lower confidence", () => {
  const odd = fundamentals();
  odd.rows[0].eps_yoy = 290;
  odd.rows[0].net_margin = 93;
  const report = agent.analyze(bundle({ fundamentals: odd }), { asOf, profile, portfolio });
  const earnings = report.agents.fundamentals.signals.find((signal) => signal.id === "fund.earnings");
  assert.ok(earnings.score <= 0.3);
  assert.equal(report.agents.fundamentals.confidenceFactor, 0.5);
  assert.ok(report.agents.fundamentals.warnings.length > 0);
});

test("missing price history means no call and no ticket", () => {
  const report = agent.analyze(bundle({ daily: daily(100) }), { asOf, profile, portfolio });
  assert.equal(report.decision.rating, "No call");
  assert.equal(report.riskGate.action, "no-call");
  assert.equal(report.riskGate.ticket, null);
});

test("uptrend with strong evidence drafts a practice ticket inside the user's limits", () => {
  const report = agent.analyze(bundle(), { asOf, profile, portfolio });
  assert.ok(["Buy", "Overweight"].includes(report.decision.rating), report.decision.rating);
  const ticket = report.riskGate.ticket;
  assert.ok(ticket, report.riskGate.summary);
  assert.ok(ticket.plannedRisk <= 50 + 0.01);
  assert.ok(ticket.dollars <= 0.2 * 10000 + 0.01);
  assert.ok(ticket.dollars <= 10000 - 1000 + 0.01);
  assert.ok(ticket.stop_loss < ticket.reference && ticket.take_profit > ticket.reference);
  assert.ok(Math.abs((ticket.take_profit - ticket.reference) / (ticket.reference - ticket.stop_loss) - 2) < 0.02);
});

test("risk gate blocks buys that are too volatile for the profile", () => {
  const wild = daily(260, (i) => 100 * 1.002 ** i * (i % 2 ? 1.06 : 0.94));
  const report = agent.analyze(bundle({ daily: wild }), { asOf, profile: { ...profile, riskLevel: 1 }, portfolio });
  if (["Buy", "Overweight"].includes(report.decision.rating)) {
    assert.equal(report.riskGate.ticket, null);
    assert.ok(report.riskGate.checks.some((check) => check.id === "volatility" && !check.pass));
  } else {
    assert.equal(report.riskGate.ticket, null);
  }
});

test("existing position at the concentration cap leaves no room", () => {
  const report = agent.analyze(bundle(), { asOf, profile, portfolio: { cash: 10000, equity: 10000, heldValue: 2500 } });
  assert.equal(report.riskGate.ticket, null);
});

test("downtrend never produces a buy ticket", () => {
  const report = agent.analyze(bundle({ daily: daily(260, (i) => 200 * 0.997 ** i), fundamentals: null, news: null }),
    { asOf, profile, portfolio: { ...portfolio, heldValue: 500 } });
  assert.ok(["Underweight", "Sell", "Hold"].includes(report.decision.rating), report.decision.rating);
  assert.equal(report.riskGate.ticket, null);
});

test("debate cites evidence from both sides with cross-agent rebuttals", () => {
  const report = agent.analyze(bundle({ daily: daily(260, (i) => 100 * 1.001 ** i * (i % 2 ? 1.03 : 0.97)) }), { asOf, profile, portfolio });
  for (const point of [...report.debate.bull, ...report.debate.bear]) {
    assert.ok(point.id && point.agent && Number.isFinite(point.contribution));
    if (point.rebuttal) {
      assert.notEqual(point.rebuttal.agent, point.agent);
    }
  }
});

test("scorecard decides only with past months and charges turnover costs", () => {
  const base = monthly(240);
  const card = agent.scorecard(base, { asOf: Date.UTC(2030, 0, 1) / 1000, costBps: 0 });
  const tail = { ...base };
  const lastKey = Object.keys(base).sort().at(-1);
  tail[lastKey] = 0.5;
  const changed = agent.scorecard(tail, { asOf: Date.UTC(2030, 0, 1) / 1000, costBps: 0 });
  assert.deepEqual(changed.ledger.slice(0, -1).map((row) => row.slice(0, 3)), card.ledger.slice(0, -1).map((row) => row.slice(0, 3)));
  const costly = agent.scorecard(base, { asOf: Date.UTC(2030, 0, 1) / 1000, costBps: 50 });
  assert.ok(costly.strategy.totalReturn < card.strategy.totalReturn);
});

test("scorecard needs six years of consecutive history", () => {
  const card = agent.scorecard(monthly(60), { asOf: Date.UTC(2030, 0, 1) / 1000 });
  assert.equal(card.status, "abstained");
  const gappy = monthly(240);
  delete gappy["2010-06"];
  const recent = agent.scorecard(gappy, { asOf: Date.UTC(2030, 0, 1) / 1000 });
  assert.equal(recent.from > "2010-06", true);
});

test("constant returns give equal exposure-matched and strategy results", () => {
  const flat = agent.scorecard(monthly(120, () => 0.01), { asOf: Date.UTC(2030, 0, 1) / 1000, costBps: 0 });
  assert.ok(Math.abs(flat.strategy.totalReturn - flat.exposureMatched.totalReturn) < 1e-9);
});

test("settlement uses the first close after the decision and waits for enough sessions", () => {
  const prices = daily(300);
  const decided = { symbol: "EXM", rating: "Buy", dataEnd: prices.points[259][0] };
  assert.equal(agent.settle(decided, { points: prices.points.slice(0, 262) }).status, "pending");
  const outcome = agent.settle(decided, prices);
  assert.equal(outcome.status, "settled");
  assert.equal(outcome.entryDate, new Date(prices.points[260][0] * 1000).toISOString().slice(0, 10));
  assert.ok(outcome.returnPct > 0 && outcome.correct === true);
  const record = agent.trackRecord([{ rating: "Buy", outcome }]);
  assert.equal(record.scored, 1);
  assert.ok(record.warning);
});

test("rejects bad symbols, missing as-of and reversed history", () => {
  assert.throws(() => agent.analyze(bundle({ symbol: "../x" }), { asOf }), /symbol/);
  assert.throws(() => agent.analyze(bundle(), {}), /as-of/);
  const reversed = daily();
  reversed.points.reverse();
  assert.throws(() => agent.analyze(bundle({ daily: reversed }), { asOf }), /chronological/);
});

test("input objects are never mutated", () => {
  const input = bundle();
  const before = JSON.stringify(input);
  agent.analyze(input, { asOf, profile, portfolio });
  assert.equal(JSON.stringify(input), before);
});

test("bundled demo data runs end to end for every snapshot stock without network", () => {
  const demo = path.join(__dirname, "../web/demo");
  const load = (name) => JSON.parse(fs.readFileSync(path.join(demo, name), "utf8"));
  const market = load("market.json");
  const monthlyData = load("monthly.json");
  const newsData = load("news.json");
  const holdings = load("copycat.json");
  const fundamentalsData = load("fundamentals.json");
  const snapshotAsOf = agent.toSeconds(newsData.checked);
  for (const symbol of Object.keys(market.charts)) {
    const report = agent.analyze({
      symbol, name: market.quotes[symbol].name, daily: market.charts[symbol]["1Y"], benchmark: market.charts.SPY["1Y"],
      monthly: monthlyData[symbol] || null, benchmarkMonthly: monthlyData.SPY, news: newsData,
      fundamentals: fundamentalsData.companies[symbol] || null, holdings, mode: "demo",
    }, { asOf: snapshotAsOf, profile, portfolio });
    assert.notEqual(report.decision.rating, undefined, symbol);
    assert.equal(report.agents.trend.status, "active", symbol);
    if (report.riskGate.ticket) {
      assert.ok(report.riskGate.ticket.plannedRisk <= 50.01, symbol);
    }
    JSON.stringify(report);
  }
});
