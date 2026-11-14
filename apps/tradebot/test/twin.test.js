import assert from "node:assert/strict";
import { test } from "node:test";

import { useRate } from "../src/render.js";
import { TWIN_COMMANDS, TWIN_STALE_MS, answer, changes, cleanSnapshot, commandOf, isStale } from "../src/twin.js";

const NOW = Date.UTC(2026, 0, 15, 4, 10);

// What the PC's reporter sends when the twin holds nothing.
function report(extra = {}) {
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

const BTC_OPEN = { id: 1, pair: "BTC/USDT", amount: 0.03, openRate: 100000, rate: 101000, stake: 3000, profit: 30, profitPct: 1, openedAt: NOW - 3600000 };
const BTC_CLOSED = { id: 1, pair: "BTC/USDT", profit: -45.5, profitPct: -1.52, closedAt: NOW, reason: "stop_loss" };

function fresh(snapshot) {
  return { snapshot: cleanSnapshot(snapshot), at: NOW - 30000, now: NOW };
}

test("twin: a report keeps only what the bot shows, as numbers and short words", () => {
  useRate(null);
  assert.equal(cleanSnapshot(null), null);
  assert.equal(cleanSnapshot("running"), null);
  assert.equal(cleanSnapshot([report()]), null);

  const clean = cleanSnapshot({
    ...report(),
    secret: "must not be stored",
    strategy: "x".repeat(500),
    maxOpen: "3",
    balance: { total: "10000.5", free: {}, start: null, password: "no" },
    open: [{ ...BTC_OPEN, note: "dropped" }, "not a trade", null],
    closed: Array.from({ length: 40 }, (unused, index) => ({ ...BTC_CLOSED, id: index })),
  });
  assert.equal("secret" in clean, false);
  assert.ok(clean.strategy.length <= 40);
  assert.equal(clean.maxOpen, 3);
  assert.deepEqual(clean.balance, { total: 10000.5, free: 0, start: 0 });
  assert.equal(clean.open.length, 1);
  assert.equal("note" in clean.open[0], false);
  assert.equal(clean.closed.length, 10);

  // Only an explicit false is real money: a missing or odd flag must never read as "real".
  assert.equal(cleanSnapshot({ ...report(), dryRun: undefined }).dryRun, true);
  assert.equal(cleanSnapshot({ ...report(), dryRun: "false" }).dryRun, true);
  assert.equal(cleanSnapshot({ ...report(), dryRun: false }).dryRun, false);

  // Words from the PC are written into Telegram HTML: tags must arrive as text.
  const shown = answer("/status", fresh({ ...report(), strategy: "<i>Rules</i>", open: [{ ...BTC_OPEN, pair: "<u>BTC/USDT" }] })).html;
  assert.match(shown, /&lt;u&gt;BTC/);
  assert.match(shown, /&lt;i&gt;Rules&lt;\/i&gt;/);
  assert.equal(/<u>|<i>/.test(shown), false);
});

test("twin: commands are read like Telegram sends them", () => {
  assert.equal(commandOf("/status"), "status");
  assert.equal(commandOf("  /Status@juwen_twin_bot now"), "status");
  assert.equal(commandOf("status"), "");
  assert.equal(commandOf(""), "");
  assert.equal(commandOf(undefined), "");
  assert.deepEqual(TWIN_COMMANDS.map((entry) => entry.command), ["status", "profit", "trades", "help"]);
});

test("twin: before the first report every answer says the PC has not been heard from", () => {
  useRate(null);
  const view = { snapshot: null, at: 0, now: NOW };
  assert.equal(isStale(view), true);
  for (const command of ["/start", "/help", "/status", "/profit", "/trades"]) {
    assert.match(answer(command, view).html, /I have not heard from the twin yet/, command);
  }
  assert.match(answer("/start", view).html, /I only show what the twin does/);
  assert.match(answer("hello", view).html, /I know \/status, \/profit, \/trades and \/help/);
  assert.match(answer("/forceexit 1", view).html, /I cannot buy, sell or stop it from here/);
});

test("twin: /status, /profit and /trades in plain words", () => {
  useRate(null);
  const empty = answer("/status", fresh(report())).html;
  assert.match(empty, /Twin \(freqtrade\)<\/b> · pretend money/);
  assert.match(empty, /Value: <b>\$10,000\.00<\/b> \(started with \$10,000\.00\)/);
  assert.match(empty, /Holding nothing right now/);
  assert.match(empty, /TradeBotTrend · 4h candles · prices from gate/);
  assert.match(empty, /Last heard from the twin: 1 minute ago\./);

  const holding = answer("/status", fresh(report({ open: [BTC_OPEN], balance: { total: 10030, free: 7000, start: 10000 } }))).html;
  assert.match(holding, /Open trades<\/b>: 1 of 3/);
  assert.match(holding, /• <b>BTC<\/b> · bought .* at \$100,000\.00 · now \$101,000\.00 · \+\$30\.00 \(\+1/);

  assert.match(answer("/status", fresh(report({ state: "stopped" }))).html, /The twin is <b>stopped<\/b>, not trading/);
  assert.match(answer("/status", fresh(report({ dryRun: false }))).html, /REAL money/);

  assert.match(answer("/profit", fresh(report())).html, /No trade has closed yet/);
  const result = answer("/profit", fresh(report({ profit: { closed: 80, all: 110, allPct: 1.1, trades: 5, closedTrades: 4, wins: 3, losses: 1 } }))).html;
  assert.match(result, /<b>\+\$110\.00<\/b>/);
  assert.match(result, /Closed trades: 4, 3 won and 1 lost \(75% won\)/);

  assert.match(answer("/trades", fresh(report())).html, /No trade has closed yet/);
  assert.match(answer("/trades", fresh(report({ closed: [BTC_CLOSED] }))).html, /🔴 BTC -\$45\.50 .* · stop hit/);
});

test("twin: amounts follow TradeBot into rupiah, and other stake money is never converted", () => {
  useRate(16000);
  assert.match(answer("/status", fresh(report())).html, /Value: <b>Rp160\.000\.000<\/b>/);
  const euros = answer("/status", fresh(report({ stake: "EUR" }))).html;
  assert.match(euros, /Value: <b>10000\.00 EUR<\/b>/);
  assert.equal(/Rp/.test(euros), false);
  useRate(null);
});

test("twin: old numbers are marked as old", () => {
  useRate(null);
  const snapshot = cleanSnapshot(report());
  assert.equal(isStale({ snapshot, at: NOW - TWIN_STALE_MS, now: NOW }), false);
  assert.equal(isStale({ snapshot, at: NOW - TWIN_STALE_MS - 1, now: NOW }), true);
  const old = answer("/status", { snapshot, at: NOW - 3 * 3600000, now: NOW }).html;
  assert.match(old, /⚠️ Last heard from the twin 3 hours ago/);
  assert.match(old, /The PC is off, asleep or offline, so these numbers are old/);
  assert.match(old, /Value: <b>\$10,000\.00<\/b>/, "the last numbers are still shown");
});

test("twin: only trades that opened or closed since the last report are news", () => {
  useRate(null);
  const empty = cleanSnapshot(report());
  const holding = cleanSnapshot(report({ open: [BTC_OPEN] }));
  const sold = cleanSnapshot(report({ closed: [BTC_CLOSED], profit: { closed: -45.5, all: -45.5, allPct: -0.46, trades: 1, closedTrades: 1, wins: 0, losses: 1 } }));

  assert.deepEqual(changes(null, holding), [], "the first report is not news");
  assert.deepEqual(changes(empty, empty), []);
  assert.deepEqual(changes(holding, holding), []);

  const bought = changes(empty, holding);
  assert.equal(bought.length, 1);
  assert.match(bought[0].html, /🟢 <b>Twin bought BTC<\/b> · pretend money\n\$3,000\.00 at \$100,000\.00\nOpen trades: 1 of 3/);

  const closed = changes(holding, sold);
  assert.equal(closed.length, 1);
  assert.match(closed[0].html, /🔴 <b>Twin sold BTC<\/b>/);
  assert.match(closed[0].html, /Result: <b>-\$45\.50<\/b> \(-1\.5.*\) · stop hit/);
  assert.match(closed[0].html, /Profit so far: -\$45\.50/);

  // Sold, but the closed trade is not in the list yet: say so instead of inventing a result.
  assert.match(changes(holding, empty)[0].html, /The trade is closed\. \/trades shows the result\./);
});
