import assert from "node:assert/strict";
import { test } from "node:test";

import { TICK_MS, newState } from "../src/agent.js";
import { MT5_STALE_MS, SIGNALS_FRESH_MS, answer, changes, cleanReport, isStale, wantedOf } from "../src/mt5.js";
import { useRate } from "../src/render.js";

const NOW = Date.UTC(2026, 10, 16, 4, 10);

// What the bridge on the PC sends when the demo account holds nothing.
function report(extra = {}) {
  return {
    loggedIn: true,
    demo: true,
    tradeAllowed: true,
    server: "MetaQuotes-Demo",
    currency: "USD",
    leverage: 100,
    balance: 10000,
    equity: 10000,
    positions: [],
    notes: [],
    ...extra,
  };
}

const BTC = { symbol: "BTCUSDT", brokerSymbol: "BTCUSD", volume: 0.01, openPrice: 100000, price: 101000, stop: 96000, profit: 10, openedAt: NOW - 3600000 };

function fresh(raw) {
  return { configured: true, report: cleanReport(raw), at: NOW - 30000, now: NOW };
}

test("mt5: the bridge is told the practice account's open coins, and whether they are fresh enough to act on", () => {
  const state = newState();
  assert.deepEqual(wantedOf(state, NOW), { at: NOW, lastRoundAt: null, fresh: false, wanted: [] }, "no round yet: nothing to act on");

  state.lastTick = { at: NOW - TICK_MS, symbols: 3, errors: [] };
  state.portfolio.positions.ETHUSDT = { qty: 1, entry: 3000, cost: 3000, stop: 2880, openedAt: NOW - 5000 };
  state.portfolio.positions.BTCUSDT = { qty: 0.03, entry: 100000, cost: 3000, stop: 96000, openedAt: NOW - 9000 };
  assert.deepEqual(wantedOf(state, NOW), {
    at: NOW,
    lastRoundAt: NOW - TICK_MS,
    fresh: true,
    wanted: [
      { symbol: "BTCUSDT", openedAt: NOW - 9000, stop: 96000 },
      { symbol: "ETHUSDT", openedAt: NOW - 5000, stop: 2880 },
    ],
  });

  // The agent has stopped: the positions are still listed, but the bridge must hold.
  state.lastTick.at = NOW - SIGNALS_FRESH_MS - 1;
  const old = wantedOf(state, NOW);
  assert.equal(old.fresh, false);
  assert.equal(old.wanted.length, 2);
  assert.equal(SIGNALS_FRESH_MS, 3 * TICK_MS);
});

test("mt5: a report keeps only what /mt5 shows, as numbers and short words", () => {
  assert.equal(cleanReport(null), null);
  assert.equal(cleanReport("demo"), null);
  assert.equal(cleanReport([report()]), null);

  const clean = cleanReport({
    ...report(),
    login: 12345678,
    name: "Juwen Lie",
    password: "never kept",
    currency: "usd",
    balance: "10000.5",
    equity: { toString: () => "1" },
    server: "S".repeat(200),
    positions: [{ ...BTC, ticket: 99, comment: "<b>x</b>" }, "junk", null, ...Array.from({ length: 20 }, () => BTC)],
    notes: ["  one  ", 7, "", "n".repeat(500), "three", "four", "five", "six"],
  });
  assert.deepEqual(Object.keys(clean).sort(), ["balance", "currency", "demo", "equity", "leverage", "loggedIn", "notes", "positions", "server", "tradeAllowed"]);
  assert.equal(JSON.stringify(clean).includes("Juwen"), false, "no login number, name or password is kept");
  assert.equal(JSON.stringify(clean).includes("12345678"), false);
  assert.equal(clean.currency, "USD");
  assert.equal(clean.balance, 10000.5);
  assert.equal(clean.equity, 0);
  assert.equal(clean.server.length, 40);
  assert.equal(clean.positions.length, 10);
  assert.deepEqual(clean.positions[0], BTC);
  assert.equal(clean.notes.length, 5);
  assert.equal(clean.notes[0], "one");
  assert.equal(clean.notes[1].length, 160);

  // Demo, logged in and trade-allowed count only when the bridge says so outright.
  for (const value of [undefined, "true", 1, null]) {
    const unsure = cleanReport({ ...report(), demo: value, loggedIn: value, tradeAllowed: value });
    assert.deepEqual([unsure.demo, unsure.loggedIn, unsure.tradeAllowed], [false, false, false]);
  }
});

test("mt5: /mt5 says where things stand at each step of the setup", () => {
  useRate(null);
  assert.match(answer({ configured: false, report: null, at: 0, now: NOW }).html, /is not set up[\s\S]*<b>demo<\/b> account[\s\S]*real-money account is refused/);
  assert.match(answer({ configured: true, report: null, at: 0, now: NOW }).html, /set up, but I have not heard from the bridge[\s\S]*MT5_BRIDGE_KEY/);

  const empty = answer(fresh(report())).html;
  assert.match(empty, /<b>MetaTrader 5<\/b> · demo account \(pretend money\) · MetaQuotes-Demo/);
  assert.match(empty, /Balance: <b>\$10,000\.00<\/b>/);
  assert.match(empty, /leverage 1:100/);
  assert.match(empty, /Holding nothing right now/);
  assert.match(empty, /Last heard from the bridge: 1 minute ago\./);
  assert.match(empty, /I only show this/);

  const holding = answer(fresh(report({ equity: 10010, positions: [BTC], notes: ["ETHUSD is not offered by this broker."] }))).html;
  assert.match(holding, /<b>Open copies<\/b>: 1\n• <b>BTC<\/b> 0\.01 lot \(BTCUSD\) · bought at \$100,000\.00 · now \$101,000\.00 · stop \$96,000\.00 · \+\$10\.00/);
  assert.match(holding, /• ETHUSD is not offered by this broker\./);
  assert.match(answer(fresh(report({ positions: [{ ...BTC, stop: 0 }] }))).html, /no stop set yet/);

  assert.match(answer(fresh(report({ tradeAllowed: false }))).html, /Trading is switched off on the PC/);
  assert.match(answer(fresh(report({ loggedIn: false, demo: false, notes: ["MetaTrader 5 is not logged in to an account."] }))).html, /not logged in to an account, so nothing is copied/);
});

test("mt5: amounts are rupiah once a rate is known, and other account money is never converted", () => {
  useRate(16000);
  assert.match(answer(fresh(report())).html, /Balance: <b>Rp160\.000\.000<\/b>/);
  const euro = answer(fresh(report({ currency: "EUR", positions: [BTC] }))).html;
  assert.match(euro, /Balance: <b>10000\.00 EUR<\/b>/);
  assert.match(euro, /\+10\.00 EUR/);
  useRate(null);
});

test("mt5: an account that is not a demo is called out, and its numbers are not shown", () => {
  useRate(null);
  const real = report({ demo: false, balance: 0, equity: 0, notes: ["This is not a demo account."] });
  const text = answer(fresh(real)).html;
  assert.match(text, /not a demo account[\s\S]*sent no orders/);
  assert.equal(/Balance/.test(text), false);

  // Told once: on the first report, and again only after it had been a demo in between.
  const clean = cleanReport(real);
  assert.equal(changes(null, clean).length, 1);
  assert.match(changes(null, clean)[0].html, /not a demo account/);
  assert.equal(changes(clean, clean).length, 0);
  assert.equal(changes(cleanReport(report({ positions: [BTC] })), clean).length, 1, "the copies are not called closed when the account changed");
  assert.deepEqual(changes(clean, cleanReport(report({ positions: [BTC] }))), [], "back on the demo: nothing to compare with yet");

  // Not logged in is a different thing, and not a reason to shout.
  assert.deepEqual(changes(null, cleanReport(report({ loggedIn: false, demo: false }))), []);
});

test("mt5: copies that opened or closed between two reports are told, and the first report tells none", () => {
  useRate(null);
  const empty = cleanReport(report());
  const holding = cleanReport(report({ positions: [BTC] }));
  assert.deepEqual(changes(null, holding), []);
  assert.deepEqual(changes(holding, holding), []);
  assert.deepEqual(changes(null, null), []);

  const bought = changes(empty, holding);
  assert.equal(bought.length, 1);
  assert.match(bought[0].html, /MT5 demo bought BTC<\/b> · pretend money\n0\.01 lot of BTCUSD at \$100,000\.00\nOpen copies: 1/);

  const closed = changes(holding, cleanReport(report({ balance: 10012 })));
  assert.equal(closed.length, 1);
  assert.match(closed[0].html, /MT5 demo closed BTC<\/b>[\s\S]*Last seen at \+\$10\.00[\s\S]*Demo balance: \$10,012\.00/);

  // Words from the PC are written as text, never as markup.
  const odd = changes(empty, cleanReport(report({ positions: [{ ...BTC, symbol: "<i>X</i>", brokerSymbol: "<b>Y</b>" }] })));
  assert.equal(/<i>|<b>Y/.test(odd[0].html), false);
});

test("mt5: old numbers are marked as old", () => {
  useRate(null);
  const view = { configured: true, report: cleanReport(report()), at: NOW - MT5_STALE_MS - 1000, now: NOW };
  assert.equal(isStale(view), true);
  assert.match(answer(view).html, /⚠️ Last heard from the bridge 5 minutes ago[\s\S]*nothing new is copied/);
  assert.equal(isStale({ ...view, at: NOW - 1000 }), false);
});
