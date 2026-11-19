import assert from "node:assert/strict";
import { test } from "node:test";

import { INDODAX_SILENT_MS, INDODAX_STALE_MS, answer, backText, changes, cleanReport, daily, fullReport, isStale, pausedText, phoneIcon, phonePage, COPY_OLD_MINUTES, plainWords, planFigures, PLAN, keepCash, CASH_KEPT_MS, cleanLearn, LEARN_OLD_MS, SCORE_MOST, resumedText, silentAlert, viewData, withDaily, onlyReal, realHelp } from "../src/indodax.js";
import { proposal } from "../src/render.js";

const NOW = Date.UTC(2026, 10, 16, 4, 10); // 11:10 WIB

// What the sender on the PC posts when it holds nothing, in practice.
function report(extra = {}) {
  return {
    mode: "practice",
    keys: false,
    tripped: false,
    trippedWhy: "",
    orderIdr: 50000,
    maxOpen: 2,
    stopPercent: 8,
    positions: [],
    closed: [],
    result: { practice: 0, real: 0 },
    today: { practice: 0, real: 0, buys: 0 },
    notes: [],
    ...extra,
  };
}

const BTC = { symbol: "BTCUSDT", pair: "btc_idr", real: false, quantity: 0.00003, spent: 50000, price: 1650000000, now: 1700000000, value: 51000, openedAt: NOW - 3600000 };
const REAL_ETH = { symbol: "ETHUSDT", pair: "eth_idr", real: true, quantity: 0.001, spent: 50000, price: 50000000, now: 48000000, value: 48000, openedAt: NOW - 1800000 };

function view(raw, age = 20000) {
  return { configured: true, report: cleanReport(raw), at: NOW - age, now: NOW };
}

const texts = (messages) => messages.map((message) => message.html).join("\n---\n");

test("indodax: a report is tidied to the fields /indodax shows, and nothing else is kept", () => {
  assert.equal(cleanReport(null), null);
  assert.equal(cleanReport("practice"), null);
  assert.equal(cleanReport([report()]), null);

  const cleaned = cleanReport(
    report({
      email: "someone@example.com",
      freeIdr: 12345678,
      apiKey: "SECRET",
      positions: [{ ...BTC, orderId: 991, name: "Juwen" }],
      closed: [{ symbol: "BTCUSDT", real: false, spent: 50000, received: 51000, at: NOW - 60000, how: "sold", orderId: 7 }],
      notes: ["ok", 5, "", "  spaced  "],
    }),
  );
  assert.deepEqual(Object.keys(cleaned).sort(), ["cash", "checked", "closed", "keys", "learn", "market", "maxOpen", "mode", "notes", "orderIdr", "paused", "positions", "result", "stopPercent", "today", "tripped", "trippedWhy"]);
  assert.deepEqual(cleaned.positions, [BTC]);
  assert.deepEqual(cleaned.closed, [{ symbol: "BTCUSDT", real: false, spent: 50000, received: 51000, at: NOW - 60000, boughtAt: 0, quantity: 0, how: "sold", estimated: false }]);
  assert.equal(cleaned.cash, null, "free rupiah is kept only under its own name, when the sender sends it");
  assert.deepEqual(cleaned.market, []);
  assert.deepEqual(cleaned.notes, ["ok", "spaced"]);
  const kept = JSON.stringify(cleaned);
  for (const secret of ["someone@example.com", "12345678", "SECRET", "Juwen", "991"]) assert.equal(kept.includes(secret), false, secret);

  // Sizes are capped, and a close it does not know is dropped rather than guessed.
  const big = cleanReport(
    report({
      positions: Array.from({ length: 9 }, (unused, index) => ({ ...BTC, symbol: `C${index}USDT` })),
      closed: [
        { symbol: "XUSDT", how: "vanished", at: 1 },
        ...Array.from({ length: 13 }, (unused, index) => ({ symbol: "BTCUSDT", real: false, spent: 1, received: 1, at: index + 1, how: "sold" })),
      ],
      notes: Array.from({ length: 9 }, () => "n".repeat(900)),
      trippedWhy: "w".repeat(900),
    }),
  );
  assert.equal(big.positions.length, 5);
  assert.deepEqual(big.closed.map((entry) => entry.at), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13], "the newest ten");
  assert.equal(big.notes.length, 5);
  assert.equal(big.notes[0].length, 300);
  assert.equal(big.trippedWhy.length, 300);
});

test("indodax: real money is never understated", () => {
  // Only an explicit "practice" is practice, and only an explicit real: false is pretend.
  assert.equal(cleanReport(report({ mode: "practice" })).mode, "practice");
  for (const mode of ["real", "REAL", "Practice", "", null, undefined, 1]) assert.equal(cleanReport(report({ mode })).mode, "real", String(mode));
  const unclear = cleanReport(report({ positions: [{ ...BTC, real: undefined }, { ...BTC, real: "false" }, { ...BTC, real: false }], closed: [{ symbol: "BTCUSDT", spent: 1, received: 1, at: 5, how: "sold" }] }));
  assert.deepEqual(unclear.positions.map((position) => position.real), [true, true, false]);
  assert.equal(unclear.closed[0].real, true);
  // A reason without the flag still counts as stopped.
  assert.equal(cleanReport(report({ tripped: false, trippedWhy: "A sale could not be confirmed." })).tripped, true);

  const shown = answer(view(report({ mode: undefined, positions: [{ ...BTC, real: undefined }] }))).html;
  assert.match(shown, /<b>Indodax<\/b> · ⚠️ <b>REAL MONEY<\/b>/);
  assert.match(shown, /<b>BTC<\/b> · <b>REAL MONEY<\/b>/);
  assert.equal(shown.includes("pretend money"), false);
});

test("indodax: /indodax before the setup, before the first report, and in practice", () => {
  assert.match(answer({ configured: false, report: null, at: 0, now: NOW }).html, /<b>Indodax<\/b> is not set up[\s\S]*starts in practice[\s\S]*README \(Indodax\)/);
  assert.match(answer({ configured: true, report: null, at: 0, now: NOW }).html, /set up, but I have not heard from the sender[\s\S]*INDODAX_BRIDGE_KEY/);

  const idle = answer(view(report())).html;
  assert.match(idle, /<b>Indodax<\/b> · practice \(pretend money at Indodax's real prices\)/);
  assert.match(idle, /Each buy: Rp50\.000 · at most 2 open · its own stop: 8% under the price paid/);
  assert.match(idle, /Holding nothing right now/);
  assert.match(idle, /Result so far: pretend Rp0\n/);
  assert.match(idle, /Last heard from the sender: just now\./);
  assert.match(idle, /From here you can stop new buys \(<code>\/indodax pause<\/code>\) and allow them again \(<code>\/indodax resume<\/code>\)/);
  assert.match(idle, /the sender there does the buying and selling, and nothing here can reach your Indodax account/);
  assert.equal(idle.includes("paused"), false, "no pause line when nothing is paused");
  assert.equal(idle.includes("has not passed the check"), false, "practice needs no check");
  assert.equal(idle.includes("REAL"), false, "a practice account is never shown a real-money word");

  const holding = answer(
    view(
      report({
        positions: [BTC, { ...BTC, symbol: "SOLUSDT", pair: "sol_idr", now: 0, value: 0 }],
        closed: [
          { symbol: "ETHUSDT", real: false, spent: 50000, received: 47500, at: NOW - 7200000, how: "sold" },
          { symbol: "XRPUSDT", real: false, spent: 50000, received: 52250, at: NOW - 600000, how: "sold" },
        ],
        result: { practice: -250, real: 0 },
        today: { practice: 2250, real: 0, buys: 1 },
        notes: ["DOGE: the buy did not happen. <spread> too wide"],
      }),
    ),
  ).html;
  assert.match(holding, /<b>Open copies<\/b>: 2/);
  assert.match(holding, /• <b>BTC<\/b> · pretend money · paid Rp50\.000 · worth Rp51\.000 now \(\+Rp1\.000\)/);
  assert.match(holding, /• <b>SOL<\/b> · pretend money · paid Rp50\.000 · no price right now/);
  assert.match(holding, /Result so far: pretend -Rp250\n/);
  assert.match(holding, /Today \(from 07:00 WIB\): pretend \+Rp2\.250 · 1 buy\n/);
  assert.match(holding, /sold: paid Rp50\.000, got Rp47\.500 \(-Rp2\.500\) · 16 Nov 09:10 WIB/);
  assert.ok(holding.indexOf("XRP") < holding.indexOf("ETH"), "the newest close comes first");
  assert.match(holding, /&lt;spread&gt; too wide/, "what the PC wrote cannot become markup");
});

test("indodax: real money is labelled everywhere and never added to practice", () => {
  const shown = answer(
    view(
      report({
        mode: "real",
        keys: true,
        positions: [REAL_ETH, BTC],
        closed: [
          { symbol: "XRPUSDT", real: true, spent: 50000, received: 49000, at: NOW - 600000, how: "sold", estimated: true },
          { symbol: "ADAUSDT", real: true, spent: 50000, received: 0, at: NOW - 500000, how: "gone" },
          { symbol: "DOTUSDT", real: true, spent: 50000, received: 0, at: NOW - 400000, how: "left" },
        ],
        result: { practice: 1000, real: -1000 },
        today: { practice: 0, real: -1000, buys: 2 },
      }),
    ),
  ).html;
  assert.match(shown, /<b>Indodax<\/b> · ⚠️ <b>REAL MONEY<\/b> \(your own rupiah\)/);
  assert.match(shown, /• <b>ETH<\/b> · <b>REAL MONEY<\/b> · paid Rp50\.000 · worth Rp48\.000 now \(-Rp2\.000\)/);
  assert.match(shown, /• <b>BTC<\/b> · pretend money/);
  assert.match(shown, /Result so far: pretend \+Rp1\.000 · <b>REAL<\/b> -Rp1\.000/);
  assert.match(shown, /Today \(from 07:00 WIB\): pretend Rp0 · <b>REAL<\/b> -Rp1\.000 · 2 buys/);
  assert.match(shown, /<b>XRP<\/b> · <b>REAL MONEY<\/b> · sold: paid Rp50\.000, got about Rp49\.000 \(about -Rp1\.000\)/);
  assert.match(shown, /<b>ADA<\/b> · <b>REAL MONEY<\/b> · no longer in the Indodax account[\s\S]*without a result/);
  assert.match(shown, /<b>DOT<\/b> · <b>REAL MONEY<\/b> · too small for Indodax to sell/);

  // Back in practice with a real copy still open: it says that copy is still sold for real.
  const mixed = answer(view(report({ keys: true, positions: [REAL_ETH] }))).html;
  assert.match(mixed, /practice \(pretend money/);
  assert.match(mixed, /bought with real money\. The sender still sells those for real/);
  assert.match(mixed, /Result so far: pretend Rp0 · <b>REAL<\/b> Rp0/);
});

test("indodax: the safety stop is shown with its reason and how to clear it", () => {
  const shown = answer(view(report({ mode: "real", tripped: true, trippedWhy: "The sale of BTC could not be confirmed <check>." }))).html;
  assert.match(shown, /⚠️ <b>The safety stop is on\.<\/b> The sale of BTC could not be confirmed &lt;check&gt;\./);
  assert.match(shown, /No new real buys are sent\. Selling goes on\.[\s\S]*run-windows\.ps1 -Clear/);
  assert.equal(answer(view(report())).html.includes("safety stop"), false);
});

test("indodax: a silent sender is called out, loudest when real copies are open", () => {
  assert.equal(isStale(view(report())), false);
  assert.equal(isStale(view(report(), INDODAX_STALE_MS)), false);
  assert.equal(isStale(view(report(), INDODAX_STALE_MS + 1)), true);
  assert.equal(isStale({ configured: true, report: null, at: 0, now: NOW }), true);

  const quiet = answer(view(report({ positions: [BTC] }), 10 * 60 * 1000)).html;
  assert.match(quiet, /⚠️ Last heard from the sender 10 minutes ago \(16 Nov 11:00 WIB\)/);
  assert.match(quiet, /nothing is bought and <b>nothing is sold either<\/b>[\s\S]*Indodax holds no stop order/);
  assert.equal(quiet.includes("nobody is watching"), false);

  const one = answer(view(report({ mode: "real", positions: [REAL_ETH, BTC] }), 3 * 3600 * 1000)).html;
  assert.match(one, /⚠️ <b>1 open copy is REAL MONEY and nobody is watching it\.<\/b> Start the sender again, or sell at Indodax yourself\./);
  const two = answer(view(report({ mode: "real", positions: [REAL_ETH, { ...REAL_ETH, symbol: "BTCUSDT" }] }), 3 * 3600 * 1000)).html;
  assert.match(two, /2 open copies are REAL MONEY and nobody is watching them/);
});

test("indodax: copies that open or close are told once, with the kind of money", () => {
  const empty = cleanReport(report());
  const holding = cleanReport(report({ positions: [BTC] }));
  assert.deepEqual(changes(null, holding), [], "the first report tells no trades");
  assert.deepEqual(changes(holding, null), []);
  assert.deepEqual(changes(holding, holding), [], "nothing changed, nothing said");

  const bought = changes(empty, holding);
  assert.equal(bought.length, 1);
  assert.match(bought[0].html, /🟢 <b>Indodax bought BTC<\/b> · pretend money\nPaid Rp50\.000 at Rp1\.650\.000\.000 per coin\nOpen copies: 1/);
  assert.match(texts(changes(empty, cleanReport(report({ mode: "real", positions: [REAL_ETH] })))), /🟢 <b>Indodax bought ETH<\/b> · <b>REAL MONEY<\/b>/);

  // The same coin bought again later is a new copy.
  const again = cleanReport(report({ positions: [{ ...BTC, openedAt: NOW }] }));
  assert.equal(changes(holding, again).length, 1);

  const sold = { symbol: "BTCUSDT", real: false, spent: 50000, received: 51200, at: NOW, how: "sold" };
  const closed = cleanReport(report({ closed: [sold] }));
  const told = changes(holding, closed);
  assert.equal(told.length, 1);
  assert.match(told[0].html, /🔴 <b>Indodax sold BTC<\/b> · pretend money\nPaid Rp50\.000, got Rp51\.200: \+Rp1\.200/);
  assert.deepEqual(changes(closed, closed), [], "an old close is not told again");

  const later = cleanReport(
    report({
      mode: "real",
      closed: [
        sold,
        { symbol: "ETHUSDT", real: true, spent: 50000, received: 47000, at: NOW + 1, how: "sold", estimated: true },
        { symbol: "ADAUSDT", real: true, spent: 50000, received: 0, at: NOW + 2, how: "gone" },
        { symbol: "DOTUSDT", real: true, spent: 50000, received: 0, at: NOW + 3, how: "left" },
      ],
    }),
  );
  const more = texts(changes({ ...closed, mode: "real" }, later));
  assert.equal(more.includes("Indodax sold BTC"), false);
  assert.match(more, /🔴 <b>Indodax sold ETH<\/b> · <b>REAL MONEY<\/b>\nPaid Rp50\.000, got about Rp47\.000: about -Rp3\.000\nThis result is an estimate/);
  assert.match(more, /ADA is no longer in the account<\/b> · <b>REAL MONEY<\/b>[\s\S]*closed without a result/);
  assert.match(more, /what is left of DOT is too small to sell<\/b> · <b>REAL MONEY<\/b>[\s\S]*stays in your Indodax account/);
});

test("indodax: the safety stop and real-money mode are each warned once, even on a first report", () => {
  const practice = cleanReport(report());
  const real = cleanReport(report({ mode: "real", keys: true }));
  const first = changes(null, real);
  assert.equal(first.length, 1);
  assert.match(first[0].html, /⚠️ <b>Indodax: the sender on your PC is in REAL MONEY mode\.<\/b>[\s\S]*Rp50\.000 per buy, at most 2 open[\s\S]*INDODAX_MODE=practice/);
  assert.equal(changes(practice, real).length, 1);
  assert.deepEqual(changes(real, real), [], "said once");
  assert.deepEqual(changes(real, practice), [], "going back to practice is not a warning");

  const tripped = cleanReport(report({ mode: "real", tripped: true, trippedWhy: "A buy of BTC got no answer." }));
  const warned = changes(real, tripped);
  assert.equal(warned.length, 1);
  assert.match(warned[0].html, /<b>Indodax<\/b>\n⚠️ <b>The safety stop is on\.<\/b> A buy of BTC got no answer\.[\s\S]*-Clear/);
  assert.deepEqual(changes(tripped, tripped), []);
  assert.equal(changes(null, tripped).length, 2, "a first report that is real and stopped tells both");
  assert.equal(changes(tripped, real).length, 0, "clearing it is not a warning");
});

test("indodax: only a true 'checked' or 'paused' from the sender counts", () => {
  assert.equal(cleanReport(report()).checked, false);
  assert.equal(cleanReport(report()).paused, false);
  assert.equal(cleanReport(report({ checked: "yes", paused: 1 })).checked, false);
  assert.equal(cleanReport(report({ checked: "yes", paused: 1 })).paused, false);
  assert.equal(cleanReport(report({ checked: true, paused: true })).checked, true);
  assert.equal(cleanReport(report({ checked: true, paused: true })).paused, true);
});

test("indodax: /indodax shows a pause from Telegram and whether the sender has read it", () => {
  const asked = answer({ ...view(report()), paused: true }).html;
  assert.match(asked, /⏸ <b>Buying is paused from Telegram\.<\/b> No new copy is bought; open copies are still watched and sold\. <code>\/indodax resume<\/code> allows buying again\./);
  assert.match(asked, /The sender has not read this yet\. It asks once a minute\./);

  const away = answer({ ...view(report(), INDODAX_STALE_MS + 1000), paused: true }).html;
  assert.match(away, /The sender has not read this yet, and it is not answering\./);

  const read = answer({ ...view(report({ paused: true })), paused: true }).html;
  assert.match(read, /Buying is paused from Telegram/);
  assert.equal(read.includes("has not read this yet"), false);

  const resumed = answer({ ...view(report({ paused: true })), paused: false }).html;
  assert.match(resumed, /▶️ Buying is allowed again\. The sender reads that within a minute\./);
  assert.equal(resumed.includes("Buying is paused"), false);

  // An old report that still says "paused" proves nothing about now, so it is not repeated.
  const old = answer({ ...view(report({ paused: true }), INDODAX_STALE_MS + 1000), paused: false }).html;
  assert.equal(old.includes("allowed again"), false);
  assert.equal(old.includes("Buying is paused"), false);
});

test("indodax: real mode without a checked API key says nothing real is bought yet", () => {
  const unchecked = answer(view(report({ mode: "real", keys: true }))).html;
  assert.match(unchecked, /⚠️ <b>This API key has not passed the check on the PC<\/b>, so nothing is bought with real money yet\. Stop the sender, run <code>run-windows\.ps1 -Check<\/code> once, then start it again\./);

  const checked = answer(view(report({ mode: "real", keys: true, checked: true }))).html;
  assert.equal(checked.includes("has not passed the check"), false);

  const practice = answer(view(report({ keys: true }))).html;
  assert.equal(practice.includes("has not passed the check"), false, "the check only matters for real buys");
});

test("indodax: the answers to pause and resume say what happens next, and warn about real money", () => {
  const paused = pausedText(view(report()));
  assert.match(paused, /⏸ <b>Indodax buying is paused\.<\/b> No new copy is bought\. Open copies are still watched and sold, and the stop stays on\./);
  assert.match(paused, /The sender on your PC reads this within a minute\./);
  assert.match(paused, /<code>\/indodax resume<\/code> allows buying again\./);
  assert.match(pausedText(view(report(), INDODAX_STALE_MS + 1000)), /is not answering right now\. It reads this as soon as it runs again\./);
  assert.match(pausedText({ configured: true, report: null, at: 0, now: NOW }), /is not answering right now/, "paused before the first report");

  const practice = resumedText(view(report()));
  assert.equal(practice, "▶️ <b>Indodax buying is allowed again.</b> The sender on your PC reads this within a minute.");
  assert.equal(resumedText({ configured: true, report: null, at: 0, now: NOW }), practice, "resumed before the first report");

  const real = resumedText(view(report({ mode: "real", keys: true, checked: true })));
  assert.match(real, /⚠️ It is in <b>REAL MONEY<\/b> mode: the next copy is bought with your own rupiah, Rp50\.000 per buy\./);
  assert.equal(real.includes("has not passed the check"), false);
  assert.equal(real.includes("safety stop"), false);
  assert.equal(real.includes("not answering"), false);

  const blocked = resumedText(view(report({ mode: "real", keys: true, tripped: true, trippedWhy: "A buy of BTC got no answer." }), INDODAX_STALE_MS + 1000));
  assert.match(blocked, /REAL MONEY/);
  assert.match(blocked, /This API key has not passed the check on the PC/);
  assert.match(blocked, /The safety stop is still on, so no real buy is sent yet\.[\s\S]*-Clear/);
  assert.match(blocked, /The sender is not answering right now, so nothing is bought until it runs again\./);
});

test("indodax: a silent sender is told once, and only while real money is in play", () => {
  const quiet = INDODAX_SILENT_MS + 60000; // 11 minutes
  const at = NOW - quiet;
  const real = cleanReport(report({ mode: "real", keys: true, checked: true }));
  const practice = cleanReport(report());
  const realCopy = cleanReport(report({ positions: [BTC, REAL_ETH] }));

  assert.equal(silentAlert({ report: null, at: 0, now: NOW, toldAt: null }), null, "nothing was ever heard");
  assert.equal(silentAlert({ report: practice, at, now: NOW, toldAt: null }), null, "practice with nothing real open is not an alarm");
  assert.equal(silentAlert({ report: real, at: NOW - INDODAX_SILENT_MS, now: NOW, toldAt: null }), null, "not before the limit has passed");
  assert.equal(silentAlert({ report: real, at: NOW - 60000, now: NOW, toldAt: null }), null);

  const alert = silentAlert({ report: real, at, now: NOW, toldAt: null });
  assert.match(alert.html, /⚠️ <b>Indodax: I have not heard from the sender on your PC<\/b>/);
  assert.match(alert.html, /Its last report was .+ \(16 Nov 10:59 WIB\)\. The PC is off, asleep or offline\./);
  assert.match(alert.html, /nothing is bought and <b>nothing is sold either<\/b>/);
  assert.match(alert.html, /No real copy is open, so nothing of yours is at risk right now\./);

  const holding = silentAlert({ report: realCopy, at, now: NOW, toldAt: null });
  assert.match(holding.html, /<b>1 open copy is REAL MONEY\.<\/b> Start the sender again, or sell at Indodax yourself\./, "a real copy counts even after going back to practice");
  assert.equal(holding.html.includes("nothing of yours is at risk"), false);
  const two = silentAlert({ report: cleanReport(report({ mode: "real", positions: [REAL_ETH, { ...REAL_ETH, symbol: "BTCUSDT", pair: "btc_idr" }] })), at, now: NOW, toldAt: null });
  assert.match(two.html, /<b>2 open copies are REAL MONEY\.<\/b>/);

  assert.equal(silentAlert({ report: real, at, now: NOW, toldAt: at }), null, "the same silence is told once");
  assert.ok(silentAlert({ report: real, at, now: NOW, toldAt: at - 600000 }), "a later silence is told again");
});

test("indodax: the first report after a told silence says the sender is back", () => {
  assert.equal(backText(cleanReport(report())), "✅ <b>Indodax: the sender on your PC is back.</b> It reports again: nothing open. /indodax shows it.");
  assert.match(backText(cleanReport(report({ positions: [BTC] }))), /It reports again: 1 open copy\. /);
  assert.match(backText(cleanReport(report({ mode: "real", positions: [BTC, REAL_ETH] }))), /It reports again: 2 open copies \(1 REAL MONEY\)\. /);
});

test("indodax: the daily part says where the copies stand, in practice and with real money", () => {
  assert.deepEqual(daily({ configured: false, report: null, at: 0, now: NOW }), [], "not set up: nothing is added");
  assert.deepEqual(daily(undefined), []);
  assert.match(daily({ configured: true, report: null, at: 0, now: NOW }).join("\n"), /^<b>Indodax<\/b>: no report yet from the sender on your PC\./);

  const practice = daily(view(report({ positions: [BTC], result: { practice: 1200, real: 0 } }))).join("\n");
  assert.match(
    practice,
    /^<b>Indodax<\/b> · practice \(pretend money\)\nEach buy: Rp50\.000 · at most 2 open\n• <b>BTC<\/b> · pretend money · paid Rp50\.000 · worth Rp51\.000 now \(\+Rp1\.000\)\nResult so far: pretend \+Rp1\.200\nLast heard from the sender: [^\n]+\.$/,
  );
  assert.equal(practice.includes("REAL"), false, "practice is not shown a real-money word");
  assert.equal(practice.includes("Today"), false, "the sender's day turns at the same minute, so today is left out");

  const real = daily(view(report({ mode: "real", keys: true, checked: true, orderIdr: 20000, maxOpen: 1, result: { practice: 0, real: -350 } }))).join("\n");
  assert.match(
    real,
    /^<b>Indodax<\/b> · ⚠️ <b>REAL MONEY<\/b> \(your own rupiah\)\nEach buy: Rp20\.000 · at most 1 open\nHolding nothing\.\nResult so far: <b>REAL<\/b> -Rp350\nLast heard from the sender: [^\n]+\.$/,
  );
  assert.match(daily(view(report({ mode: "real", positions: [REAL_ETH] }))).join("\n"), /• <b>ETH<\/b> · <b>REAL MONEY<\/b> · paid Rp50\.000 · worth Rp48\.000 now \(-Rp2\.000\)/);
});

test("indodax: the daily part carries every warning that stops or endangers a trade", () => {
  const text = (raw, age, extra = {}) => daily({ ...view(raw, age), ...extra }).join("\n");

  assert.match(text(report({ mode: "real", keys: true })), /This API key has not passed the check on the PC/);
  assert.equal(text(report({ mode: "real", keys: true, checked: true })).includes("has not passed the check"), false);
  assert.equal(text(report()).includes("has not passed the check"), false, "practice needs no key");

  assert.match(text(report({ tripped: true, trippedWhy: "A sale could not be confirmed." })), /The safety stop is on\.<\/b> A sale could not be confirmed\./);
  assert.match(text(report(), 20000, { paused: true }), /⏸ Buying is paused from Telegram\./);
  assert.match(text(report({ paused: true })), /⏸ Buying is paused from Telegram\./);
  assert.equal(text(report()).includes("paused"), false);

  // The PC was off overnight: the numbers are old, and it says so instead of looking fine.
  const old = text(report({ mode: "real", checked: true, positions: [REAL_ETH] }), 8 * 60 * 60 * 1000);
  assert.match(old, /⚠️ Last heard from the sender 8 hours ago/);
  assert.match(old, /nothing is sold either/);
  assert.match(old, /1 open copy is REAL MONEY and nobody is watching it/);
});

test("indodax: the daily part is added to messages marked daily, and to no other", () => {
  const messages = [{ html: "summary", daily: true }, { html: "bought", buttons: [1] }];
  assert.equal(withDaily(messages, { configured: false, report: null, at: 0, now: NOW }), messages, "not set up: untouched");

  const added = withDaily(messages, view(report()));
  assert.match(added[0].html, /^summary\n\n<b>Indodax<\/b> · practice \(pretend money\)\n/);
  assert.deepEqual(added[1], messages[1]);
  assert.equal(messages[0].html, "summary", "the message it was given is not changed");
});

// ---------------------------------------------------------------- the phone page

const CHECKS = [
  { name: "Trend", ok: true, text: "price above the 200-candle average" },
  { name: "Momentum", ok: false, text: "20-candle average below the 50-candle average" },
  { name: "RSI", ok: false, text: "44 (weak: under 50)" },
];
const SIGNALS = {
  state: { settings: { paused: false, auto: true, timeframe: "4h", dailyLossPct: 3, maxPositions: 2, watchlist: ["ETHUSDT"], riskPct: 1 }, portfolio: { positions: {} }, day: null, pending: {} },
  rows: [{ symbol: "ETHUSDT", price: 2310, decision: { action: "wait", why: "waiting for momentum and RSI", reasons: CHECKS }, held: null, change24h: -0.6 }],
};

function realView(extra = {}, age = 20000) {
  return view(report({ mode: "real", keys: true, checked: true, cash: 30450, orderIdr: 20000, maxOpen: 1, positions: [{ ...REAL_ETH, spent: 20000, value: 20306 }], result: { practice: 0, real: 40 }, today: { practice: 0, real: -15, buys: 1 }, ...extra }), age);
}

const phone = (seen, signals = SIGNALS) => phonePage(fullReport(seen, signals).html, NOW, seen, plainWords(signals));

test("phone page: the top says real money, a live sender, four numbers and what happens next", () => {
  const page = phone(realView());
  assert.match(page, /<h1>TradeBot · Indodax<\/h1>/);
  assert.match(page, /<span class="mode real">REAL MONEY<\/span>/);
  assert.match(page, /class="alive">● Sender is running · heard just now/);
  assert.match(page, /<span>Free rupiah<\/span><strong>Rp30\.450<\/strong><span>enough for 1 buy<\/span>/);
  assert.match(page, /<span>Coins you hold<\/span><strong>ETH<\/strong><span>worth Rp20\.306 \(\+1\.5%\)<\/span>/);
  assert.match(page, /<span>Result so far<\/span><strong class="up">\+Rp40<\/strong>/);
  assert.match(page, /<span>Today<\/span><strong class="down">-Rp15<\/strong><span>1 buy · from 07:00 WIB<\/span>/);
  assert.match(page, /<div class="next"><span>What happens next<\/span>You hold 1 coin at Indodax, the most at one time, so nothing more is bought until it is sold\. I judge it again when the 4h candle closes at \d\d:\d\d WIB\./);
  assert.equal(page.includes("class=\"alert"), false, "no warning when all is fine");
  // What the top already says is not repeated below; the rest of the report stays.
  assert.equal(page.includes("Free rupiah at Indodax:"), false);
  assert.equal(page.includes("Last heard from the sender:"), false);
  assert.equal(page.includes("<p>Next: "), false);
  assert.match(page, /<h2>Holding now<\/h2>/);
  assert.match(page, /<h2>History <small>\(newest first\)<\/small><\/h2>/);
  assert.match(page, /<p class="check">❌ Momentum: 20-candle average below the 50-candle average<\/p>/);
  assert.match(page, /<h2>In plain words<\/h2><p><b>Candle<\/b>: the price during one 4h slice of time/);
  assert.match(page, /Not financial advice/);
});

test("phone page: it is read-only, reloads itself, stays private and keeps its text large", () => {
  const page = phone(realView());
  assert.equal(/<(a|button|form|input|script|select|textarea)[\s>]/i.test(page), false, "nothing to press and no script");
  assert.match(page, /<meta http-equiv="refresh" content="60">/);
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page, /<meta name="referrer" content="no-referrer">/);
  assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(page, /read-only: nothing can be bought or sold from this page/);
  const sizes = [...page.matchAll(/font(?:-size)?:\s*(\d+)px/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 5 && Math.min(...sizes) >= 15, `smallest text ${Math.min(...sizes)}px`);
  assert.match(page, /overflow-wrap:anywhere/);
});

test("phone page: a silent sender, a pause, the safety stop and an unchecked key are warnings on top", () => {
  const silent = phone(realView({}, INDODAX_STALE_MS + 60000));
  assert.match(silent, /class="alive away">○ Sender is silent · heard 6 minutes ago/);
  assert.match(silent, /<div class="alert bad">⛔ The sender on your PC was last heard 6 minutes ago\. While it is away nothing is bought and <b>nothing is sold either<\/b>\./);
  assert.match(silent, /nobody is watching it/, "the report's own warning about the open real copy stays");

  const paused = phone({ ...realView(), paused: true });
  assert.match(paused, /<div class="alert">⚠️ Buying is paused\./);

  const stopped = phone(realView({ tripped: true, trippedWhy: "The balance did not match.", checked: false }));
  assert.match(stopped, /<div class="alert bad">⛔ Safety stop/);
  assert.match(stopped, /<div class="alert bad">⛔ Real mode is on, but the API key has not passed its check/);
  assert.match(stopped, /The balance did not match\./);

  const poor = phone(realView({ cash: 9856, positions: [] }));
  assert.match(poor, /<div class="alert">⚠️ Free rupiah is less than one buy of Rp20\.000/);
  assert.match(poor, /<strong>No coin<\/strong><span>all in rupiah<\/span>/);
  assert.match(poor, /Free rupiah at Indodax: <b>Rp9\.856<\/b> · ⚠️/, "the report's own warning line stays as well");
});

test("phone page: practice is never shown as real, and pretend and real results stay apart", () => {
  const seen = view(report({ positions: [BTC], result: { practice: 1000, real: 0 } }));
  const page = phone(seen, null);
  assert.match(page, /<span class="mode">practice \(pretend money\)<\/span>/);
  assert.equal(page.includes("REAL MONEY"), false);
  assert.match(page, /<span>Free rupiah<\/span><strong>not reported<\/strong>/);
  assert.match(page, /<span>Result so far<\/span><strong class="up">\+Rp1\.000<\/strong>/);
  assert.match(page, /Result so far: pretend \+Rp1\.000/, "the report's own result line stays when pretend money is in it");
  assert.equal(page.includes("In plain words"), false, "no signals, no glossary");
});

test("phone page: on the iPhone's home screen it is an app with its own name and icon, and still nothing to press", () => {
  const page = phone(realView());
  assert.match(page, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(page, /<meta name="mobile-web-app-capable" content="yes">/);
  assert.match(page, /<meta name="apple-mobile-web-app-title" content="TradeBot">/);
  assert.match(page, /<meta name="apple-mobile-web-app-status-bar-style" content="black">/);
  assert.match(page, /<link rel="apple-touch-icon" href="\/v1\/indodax\/phone-icon\.png">/);
  assert.equal(/<(a|button|form|input|script)[\s>]/i.test(page), false);
  const icon = phoneIcon();
  assert.deepEqual([...icon.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "a PNG");
  const size = new DataView(icon.buffer, icon.byteOffset + 16, 8);
  assert.deepEqual([size.getUint32(0), size.getUint32(4)], [180, 180], "the size an iPhone asks for");
  assert.equal(icon[25], 2, "no see-through corners: the iPhone would paint them black");
});

test("phone page as a copy for GitHub: it says when it was made, counts its age, and does not reload", () => {
  const live = phone(realView());
  const copy = phonePage(fullReport(realView(), SIGNALS).html, NOW, realView(), plainWords(SIGNALS), true);
  // The same facts as the live page.
  for (const part of [/<span class="mode real">REAL MONEY<\/span>/, /<span>Free rupiah<\/span><strong>Rp30\.450<\/strong>/, /<h2>Holding now<\/h2>/, /<h2>In plain words<\/h2>/, /Not financial advice/]) {
    assert.match(live, part);
    assert.match(copy, part);
  }
  // It is shown inside another page, so it must not reload itself or ask for this server's icon.
  assert.equal(copy.includes("http-equiv"), false, "no reload");
  assert.equal(/apple-mobile|apple-touch|mobile-web-app/.test(copy), false, "no home-screen tags");
  assert.equal(/(src|href)\s*=/i.test(copy), false, "nothing is fetched from anywhere");
  // It says how old it is: the time it was made, and a warning that shows itself when it gets old.
  assert.match(copy, /<p class="copy">Copy made \d+ \w+ \d\d:\d\d WIB \(<span id="age">see the time<\/span>\)\. It comes to this phone through GitHub, so it can be about 10 minutes old\.<\/p>/);
  assert.match(copy, /<div class="alert bad" id="old" hidden>⛔ No newer copy has arrived for <b id="oldfor">a while<\/b>\. The PC that makes it is off, asleep or offline/);
  assert.match(copy, /nothing is sold either/);
  assert.match(copy, /Copy made \d+ \w+ \d\d:\d\d WIB · a new copy about every 5 minutes · read-only: nothing can be bought or sold from this page<\/footer>/);
  assert.equal(copy.includes("reloads every minute"), false);
  assert.ok(copy.indexOf('class="copy"') > copy.indexOf("</header>") && copy.indexOf('class="copy"') < copy.indexOf('class="tiles"'), "right under the title");
  // One small script, which only counts the age. Still nothing to press.
  assert.equal(/<(a|button|form|input|select|textarea)[\s>]/i.test(copy), false, "nothing to press");
  const scripts = [...copy.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1);
  assert.equal(/fetch|XMLHttpRequest|location|cookie|storage|import|eval/i.test(scripts[0]), false, "it reads and sends nothing");
  // Run that script against a stand-in page: fresh, then old.
  const run = (minutesLater) => {
    const parts = { age: { textContent: "" }, old: { hidden: true }, oldfor: { textContent: "" } };
    const alive = { className: "alive", textContent: "● Sender is running · heard just now" };
    const page = { getElementById: (id) => parts[id], querySelector: (query) => (query === ".alive" ? alive : null) };
    const clockNow = { now: () => NOW + minutesLater * 60000 };
    new Function("document", "Date", "setInterval", scripts[0])(page, clockNow, () => 0);
    return { ...parts, alive };
  };
  const green = { className: "alive", textContent: "● Sender is running · heard just now" };
  assert.deepEqual(run(0), { age: { textContent: "just now" }, old: { hidden: true }, oldfor: { textContent: "just now" }, alive: green });
  assert.deepEqual(run(COPY_OLD_MINUTES - 1).alive, green);
  assert.equal(run(1).age.textContent, "1 minute ago");
  assert.equal(run(COPY_OLD_MINUTES - 1).old.hidden, true, "a normal wait is not a warning");
  const old = run(COPY_OLD_MINUTES + 25);
  assert.equal(old.old.hidden, false);
  assert.equal(old.age.textContent, "45 minutes ago");
  assert.equal(old.oldfor.textContent, "45 minutes");
  assert.deepEqual(old.alive, { className: "alive away", textContent: "○ Sender: not known, this copy is old" }, "an old copy never says in green that the sender runs");
  // A copy with no top (nothing set up) has no such line, and the script does not trip over that.
  const bareScript = phonePage("a", NOW, null, [], true).match(/<script>([\s\S]*?)<\/script>/)[1];
  const none = { age: {}, old: {}, oldfor: {} };
  new Function("document", "Date", "setInterval", bareScript)({ getElementById: (id) => none[id], querySelector: () => null }, { now: () => NOW + 3600000 }, () => 0);
  assert.equal(none.old.hidden, false);
  assert.equal(run(300).oldfor.textContent, "5 hours");
  // Without a view (nothing set up yet) the copy line still leads.
  const bare = phonePage("a", NOW, null, [], true);
  assert.match(bare, /<main>\n<p class="copy">Copy made/);
});

test("phone page: without a view it is the report alone, and plain words are escaped", () => {
  const seen = realView();
  const page = phonePage(fullReport(seen, SIGNALS).html, NOW);
  assert.equal(page.includes("<h1>"), false);
  assert.match(page, /Indodax report/);
  assert.match(page, /Free rupiah at Indodax:/);
  const odd = phonePage("a", NOW, null, [{ word: "<x>", means: "a & b" }]);
  assert.match(odd, /<b>&lt;x&gt;<\/b>: a &amp; b/);
});

test("the desktop app gets the plain words with its data, from the strategy's own numbers", () => {
  const data = viewData(realView(), SIGNALS);
  assert.deepEqual(data.words.map((entry) => entry.word), ["Candle", "Trend", "Momentum", "RSI"]);
  assert.match(data.words[0].means, /one 4h slice/);
  assert.match(data.words[3].means, /I want 50 to 70/);
  assert.deepEqual(viewData(realView(), null).words, []);
  assert.deepEqual(plainWords({ rows: [] }), []);
  assert.match(data.version, /^\d+\.\d+\.\d+$/, "the desktop app compares this with its own version");
});

test("plan: the real money's stage, what was put in, what it is worth, and the test's ranges", () => {
  // Practice, or no free rupiah reported: there is nothing to plan with, so no block and no numbers.
  assert.equal(planFigures(cleanReport(report({ cash: 50000 }))), null);
  assert.equal(planFigures(cleanReport(report({ mode: "real", keys: true, checked: true }))), null);
  assert.equal(fullReport(view(report({ mode: "real", keys: true, checked: true }))).html.includes("<b>Plan</b>"), false);

  // Fresh real account: all rupiah free, nothing earned or lost.
  const fresh = report({ mode: "real", keys: true, checked: true, orderIdr: 20000, maxOpen: 1, cash: 50000 });
  assert.deepEqual(planFigures(cleanReport(fresh)), { putIn: 50000, worth: 50000, change: 0, pct: 0, stage: 0, floor: false, scale: 1 });
  const html = fullReport(view(fresh)).html;
  assert.ok(html.includes("<b>Plan</b>\nStage 1 of 3: protect the money"), html);
  assert.ok(html.includes("Money put in: Rp50.000 · worth now: <b>Rp50.000</b>"), html);
  assert.ok(html.includes("a losing trade costs about Rp500 and at most about Rp1.700"), html);
  assert.ok(html.includes("Next stage at Rp55.000"), html);
  assert.ok(html.includes("If it falls to Rp40.000"), html);
  assert.ok(html.includes("<b>not a promise</b>"), html);
  assert.ok(html.includes("• 1 month: Rp48.300 to Rp53.700, middle Rp49.800"), html);
  assert.ok(html.includes("• 12 months: Rp45.500 to Rp68.200, middle Rp55.000"), html);
  assert.ok(html.indexOf("<b>Holding now</b>") < html.indexOf("<b>Plan</b>") && html.indexOf("<b>Plan</b>") < html.indexOf("<b>What I need"), "the plan sits between holding and the market");

  // /plan alone: the plan without the market and the history.
  const only = fullReport(view(fresh), null, "plan").html;
  assert.ok(only.includes("Indodax: the plan") && only.includes("<b>Plan</b>"), only);
  assert.equal(only.includes("<b>History</b>"), false);
  assert.equal(only.includes("<b>What I need"), false);

  // One open real copy that lost a little, after Rp6.000 of earlier gains:
  // put in = 36.000 + 20.000 - 6.000 = 50.000; worth = 36.000 + 19.500 = 55.500 (+11%): stage 2.
  const open = { symbol: "BTCUSDT", pair: "btc_idr", real: true, quantity: 0.000016, spent: 20000, price: 1250000000, now: 1218750000, value: 19500, openedAt: NOW - 3600000 };
  const grown = cleanReport(report({ mode: "real", keys: true, checked: true, orderIdr: 20000, maxOpen: 1, cash: 36000, positions: [open], result: { practice: 0, real: 6000 } }));
  const figures = planFigures(grown);
  assert.equal(figures.putIn, 50000);
  assert.equal(figures.worth, 55500);
  assert.equal(figures.stage, 1);
  assert.ok(fullReport(view(grown)).html.includes("Stage 2 of 3: a little bigger"));

  // A pretend copy never counts as real money, and a top-up moves both sides: the change stays.
  const pretend = cleanReport(report({ mode: "real", keys: true, checked: true, orderIdr: 20000, cash: 150000, positions: [BTC], result: { practice: 900, real: 6000 } }));
  assert.deepEqual([planFigures(pretend).putIn, planFigures(pretend).worth], [144000, 150000]);

  // Down 20% or more: the floor is said out loud, with the command that stops new buys.
  const low = cleanReport(report({ mode: "real", keys: true, checked: true, orderIdr: 20000, cash: 40000, result: { practice: 0, real: -10000 } }));
  assert.equal(planFigures(low).floor, true);
  assert.ok(fullReport(view(low)).html.includes("/indodax pause"));

  // A bigger buy scales the losses and the ranges with it.
  const bigger = fullReport(view(report({ mode: "real", keys: true, checked: true, orderIdr: 40000, maxOpen: 1, cash: 100000 }))).html;
  assert.ok(bigger.includes("costs about Rp1.000 and at most about Rp3.400"), bigger);
  assert.ok(bigger.includes("• 1 month: Rp96.600 to Rp107.400, middle Rp99.600"), bigger);

  // The numbers shown are the ones in PLAN, in time order, low <= middle <= high.
  assert.deepEqual(PLAN.spans.map((span) => span.name), ["1 month", "3 months", "6 months", "12 months"]);
  for (const span of PLAN.spans) assert.ok(span.low <= span.middle && span.middle <= span.high, span.name);
});

test("indodax: a minute without the balance keeps the free rupiah read just before, unless something traded", () => {
  const real = (extra = {}) => cleanReport(report({ mode: "real", keys: true, checked: true, orderIdr: 20000, ...extra }));
  const before = real({ cash: 50000 });
  const blank = real();
  assert.equal(blank.cash, null);

  // Read a minute ago, nothing changed: kept, so the plan stays on the report.
  const kept = keepCash(before, blank, NOW - 60000, NOW);
  assert.equal(kept.cash, 50000);
  assert.ok(fullReport({ configured: true, report: kept, at: NOW, now: NOW }).html.includes("<b>Plan</b>"));

  // A fresh figure always wins; too old, never read, or practice: not kept.
  assert.equal(keepCash(before, real({ cash: 30000 }), NOW, NOW).cash, 30000);
  assert.equal(keepCash(before, blank, NOW - CASH_KEPT_MS - 1, NOW).cash, null);
  assert.equal(keepCash(before, blank, 0, NOW).cash, null);
  assert.equal(keepCash(null, blank, NOW, NOW).cash, null);
  assert.equal(keepCash(cleanReport(report({ cash: 50000 })), blank, NOW, NOW).cash, null);

  // A buy, a sale or a new result since then: the old figure is wrong, so it is dropped.
  const bought = real({ positions: [{ ...REAL_ETH, spent: 20000 }] });
  assert.equal(keepCash(before, bought, NOW - 60000, NOW).cash, null);
  const sold = real({ closed: [{ symbol: "ETHUSDT", real: true, spent: 20000, received: 20400, at: NOW - 30000, how: "sold" }], result: { practice: 0, real: 400 } });
  assert.equal(keepCash(before, sold, NOW - 60000, NOW).cash, null);
  assert.equal(keepCash(before, real({ result: { practice: 0, real: -300 } }), NOW - 60000, NOW).cash, null);
});

// What indodax/learn.py posts inside a report: the short result of the sender's own study.
const LEARN = {
  at: NOW - 60 * 60 * 1000,
  candles: 14700,
  versions: 81,
  order: 20000,
  trades: 213,
  wins: 30,
  perYear: 4600.4,
  dip: -12000.2,
  yearUp: 63,
  monthUp: 39,
  unseen: { windows: 8, up: 2, live: 9487, picked: 12899 },
  cost: { assumed: 0.9, measured: null, trades: 0, used: "assumed" },
  challenger: { rules: "averages 30/80/300, RSI 50 to 70, stop 4 ATR", days: 0, trades: 0, lead: 0 },
  verdict: "watch",
  score: { total: 2.3, parts: { unseen: 1.28, steady: 0.65, dips: 0.38, real: 0 }, realTrades: 0 },
  curve: [
    { at: NOW - 49 * 60 * 60 * 1000, score: 2.1 },
    { at: NOW - 25 * 60 * 60 * 1000, score: 2.2 },
    { at: NOW - 60 * 60 * 1000, score: 2.3 },
  ],
};
const REVIEW = { ...LEARN, verdict: "review", challenger: { ...LEARN.challenger, days: 95, trades: 9, lead: 3100 } };
const realWith = (learn, extra = {}) => report({ mode: "real", keys: true, checked: true, orderIdr: 20000, maxOpen: 1, cash: 50000, learn, ...extra });

test("indodax study: only numbers and one short line are kept, and junk is dropped", () => {
  assert.equal(cleanReport(report()).learn, null, "a report without a study");
  for (const junk of [null, "watch", [LEARN], {}, { ...LEARN, at: 0 }, { ...LEARN, at: "now" }, { ...LEARN, verdict: "buy more" }, { ...LEARN, verdict: undefined }]) {
    assert.equal(cleanLearn(junk), null, JSON.stringify(junk));
  }
  assert.deepEqual(cleanLearn(LEARN), LEARN);

  const cleaned = cleanLearn({
    ...LEARN,
    wins: 250,
    yearUp: -4,
    monthUp: "many",
    trades: "lots",
    unseen: "none",
    cost: { assumed: 0.9, measured: "cheap", trades: 3, used: "guessed" },
    challenger: { rules: `  <b>${"x".repeat(200)}</b>  `, days: 3, trades: 1, lead: -40, email: "someone@example.com" },
    apiKey: "SECRET",
    params: [30, 80, 300],
  });
  assert.equal(cleaned.wins, 100);
  assert.equal(cleaned.yearUp, 0);
  assert.equal(cleaned.monthUp, null);
  assert.equal(cleaned.trades, 0);
  assert.deepEqual(cleaned.unseen, { windows: 0, up: 0, live: 0, picked: 0 });
  assert.deepEqual(cleaned.cost, { assumed: 0.9, measured: null, trades: 3, used: "assumed" });
  assert.ok(cleaned.challenger.rules.length <= 80);
  assert.deepEqual(Object.keys(cleaned.challenger).sort(), ["days", "lead", "rules", "trades"]);
  assert.deepEqual(Object.keys(cleaned).sort(), Object.keys(LEARN).sort());
  assert.equal(/SECRET|example\.com/.test(JSON.stringify(cleaned)), false);

  // A verdict always matches what is shown: "keep" has no other version, and without one it is "keep".
  assert.equal(cleanLearn({ ...LEARN, verdict: "keep" }).challenger, null);
  assert.equal(cleanLearn({ ...REVIEW, challenger: null }).verdict, "keep");
  assert.equal(cleanLearn({ ...REVIEW, challenger: "the fast one" }).verdict, "keep");
});

test("indodax study: the score and its curve are numbers inside their scale, or nothing", () => {
  // A sender older than the score: no score, an empty curve, and the rest as before.
  const { score: _score, curve: _curve, ...old } = LEARN;
  assert.equal(cleanLearn(old).score, null);
  assert.deepEqual(cleanLearn(old).curve, []);
  for (const junk of ["high", 9, [9], {}, { total: "10" }, { total: NaN }]) assert.equal(cleanLearn({ ...LEARN, score: junk }).score, null, JSON.stringify(junk));

  const odd = cleanLearn({
    ...LEARN,
    score: { total: 99, parts: { unseen: 7, steady: -1, dips: "deep", real: 1.23456, luck: 5 }, realTrades: 4.6, note: "<b>trust me</b>" },
    curve: [{ at: 0, score: 5 }, "up", { at: NOW, score: 44 }, { at: NOW, score: "x" }, ...Array.from({ length: 80 }, (_, index) => ({ at: NOW + index, score: 1.234 }))],
  });
  assert.deepEqual(odd.score, { total: 10, parts: { unseen: 3, steady: 0, dips: 0, real: 1.23 }, realTrades: 5 });
  assert.equal(odd.curve.length, 60);
  assert.deepEqual(odd.curve[0], { at: NOW + 20, score: 1.23 });
  assert.deepEqual(cleanLearn({ ...LEARN, curve: [{ at: NOW, score: 44 }, { at: 0, score: 1 }] }).curve, [{ at: NOW, score: 10 }]);
  assert.deepEqual(Object.keys(SCORE_MOST), ["unseen", "steady", "dips", "real"]);
  assert.equal(Object.values(SCORE_MOST).reduce((sum, most) => sum + most, 0), 10);
});

test("indodax study: /learn leads with the score, its parts, the curve and what is still collected", () => {
  const learn = (study) => fullReport(view(realWith(study)), null, "learn").html.split("\n");
  const lines = learn(LEARN);
  const start = lines.findIndex((line) => line.startsWith("<b>Self-study</b>"));
  assert.equal(lines[start + 1], "<b>Score: 2,3 of 10</b> ▰▰▱▱▱▱▱▱▱▱");
  assert.equal(lines[start + 2], "How far the rules are proven, not how clever they sound: unseen prices 1,28 of 3 · steady years 0,65 of 2 · dips 0,38 of 2 · real money 0 of 3.");
  assert.match(lines[start + 3], /^Curve: 2,1 on \d+ \w+ → 2,3 now \(\+0,2 over 3 days with a study\)\.$/);
  assert.match(lines[start + 4], /^Still collecting: real trades finished 0 of 30 · real cost measured on 0 of 5 trades · the watched version 0 of 90 days and 0 of 8 trades\. Next study: about \d\d:\d\d WIB\.$/);
  assert.match(lines[start + 5], /^The scale is fixed\. Only measured things move the score/);
  assert.equal(lines[start + 6], "");
  assert.match(lines[start + 7], /^1\. Replay/);

  // The first day, a fall, a late study, and counts that never pass their goal.
  assert.ok(learn({ ...LEARN, curve: LEARN.curve.slice(-1) }).includes("The curve starts today: one point a day is kept from now on."));
  assert.ok(learn({ ...LEARN, curve: [{ at: NOW - 49 * 60 * 60 * 1000, score: 3 }, LEARN.curve[2]] }).some((line) => /→ 2,3 now \(−0,7 over 2 days with a study\)/.test(line)));
  assert.ok(learn({ ...LEARN, curve: [{ at: NOW - 49 * 60 * 60 * 1000, score: 2.3 }, LEARN.curve[2]] }).some((line) => line.includes("now (the same over 2 days")));
  assert.ok(learn({ ...LEARN, at: NOW - 5 * 60 * 60 * 1000 }).some((line) => line.endsWith("Next study: at the sender's next cycle.")));
  const far = learn({ ...REVIEW, score: { ...LEARN.score, total: 10, realTrades: 44 }, cost: { assumed: 0.9, measured: 1.2, trades: 9, used: "measured" } });
  assert.ok(far.includes("<b>Score: 10 of 10</b> ▰▰▰▰▰▰▰▰▰▰"));
  assert.ok(far.some((line) => line.includes("real trades finished 30 of 30 · real cost measured on 5 of 5 trades · the watched version 90 of 90 days and 8 of 8 trades")));
  assert.ok(learn({ ...LEARN, verdict: "keep" }).some((line) => line.includes("real cost measured on 0 of 5 trades. Next study")), "no watched version, no line for it");

  // A sender older than the score: /learn reads as before.
  const { score: _score, curve: _curve, ...old } = LEARN;
  const before = learn(old);
  assert.equal(before.some((line) => /Score|Curve|Still collecting/.test(line)), false);
  assert.match(before[before.findIndex((line) => line.startsWith("<b>Self-study</b>")) + 1], /^1\. Replay/);
});

test("indodax study: /learn tells the replay, the unseen prices, the real cost and the verdict", () => {
  const learn = (study, extra) => fullReport(view(realWith(study, extra)), null, "learn").html;

  const watch = learn(LEARN);
  assert.match(watch, /<b>Indodax: what I learned<\/b> · ⚠️ <b>REAL MONEY<\/b>/);
  assert.match(watch, /<b>Self-study<\/b> \(60 minutes ago\)/);
  assert.match(watch, /14\.700 four-hour candles since March 2020\. 213 trades, 30 of 100 won\. About \+Rp4\.600 a year at Rp20\.000 per buy, deepest dip -Rp12\.000\./);
  assert.match(watch, /A year ended with a gain in 63 of 100 starts, a single month in 39 of 100\./);
  assert.match(watch, /81 nearby versions[^\n]*8 half years: the rules that trade gained in 2 \(\+Rp9\.500 in all\); picking by the past gave \+Rp12\.900\./);
  assert.match(watch, /0,9% is assumed\. No real trade is finished yet/);
  assert.match(watch, /👀 Verdict: <b>keep the rules<\/b>, and watch another version on paper \(averages 30\/80\/300, RSI 50 to 70, stop 4 ATR\): 0 days, 0 trades, Rp0 against the rules that trade\. It needs 90 days and 8 trades ahead before a review\./);
  assert.match(watch, /it cannot order, and it never changes the rules or the size of a buy/);
  assert.match(watch, /Winning almost every trade is not the goal/);
  assert.match(watch, /A past result is not a promise/);
  assert.equal(/<b>(Plan|History|Holding now)<\/b>/.test(watch), false, "the study alone");

  const few = learn({ ...LEARN, cost: { assumed: 0.9, measured: 1.1, trades: 1, used: "assumed" } });
  assert.match(few, /1,1% on 1 real trade so far\. From 5 trades on it replaces the assumed 0,9%\./);
  const measured = learn({ ...REVIEW, cost: { assumed: 0.9, measured: 1.24, trades: 6, used: "measured" } });
  assert.match(measured, /1,2%, measured on 6 real trades\. The replay uses it \(0,9% was assumed before\)\./);
  assert.match(measured, /🔔 Verdict: <b>another version has earned a review<\/b>[^\n]*On paper: 95 days, 9 trades, \+Rp3\.100 against the rules that trade\. Nothing changes by itself: the rules are changed by hand, after a look\./);

  const keep = learn({ ...LEARN, verdict: "keep" });
  assert.match(keep, /✅ Verdict: <b>keep the rules<\/b>\. They are also the best version of the last three years\./);
  assert.equal(/another version/.test(keep), false);

  // A name from the PC is text, never markup.
  const odd = learn({ ...LEARN, challenger: { ...LEARN.challenger, rules: "<a href=x>RSI</a> & more" } });
  assert.match(odd, /&lt;a href=x&gt;RSI&lt;\/a&gt; &amp; more/);
  assert.equal(odd.includes("<a href"), false);

  // The study runs every four hours: an older one is said to be old, a fresh one is not.
  const fresh = fullReport({ ...view(realWith({ ...LEARN, at: NOW - LEARN_OLD_MS })), now: NOW }, null, "learn").html;
  assert.equal(fresh.includes("⚠️ old"), false);
  assert.match(learn({ ...LEARN, at: NOW - LEARN_OLD_MS - 60000 }), /<b>Self-study<\/b> \(12 hours ago: ⚠️ old, the PC was off or could not read the prices\)/);

  // Nothing yet: said plainly, with no figures made up.
  const none = learn(undefined);
  assert.match(none, /<b>Self-study<\/b>\nNo study has arrived yet\./);
  assert.equal(/of 100 won|Verdict/.test(none), false);
});

test("indodax study: the full report carries four lines of it, and none when there is no study", () => {
  const full = fullReport(view(realWith(LEARN))).html;
  const block = full.split("\n\n").find((part) => part.startsWith("<b>Self-study</b>"));
  assert.deepEqual(block.split("\n"), [
    "<b>Self-study</b> (60 minutes ago)",
    "Score: <b>2,3 of 10</b> ▰▰▱▱▱▱▱▱▱▱ (how far the rules are proven; real trades 0 of 30).",
    "The rules replayed on past prices: 213 trades, 30 of 100 won, about +Rp4.600 a year at Rp20.000 per buy. A year ended with a gain in 63 of 100 starts.",
    "👀 Verdict: <b>keep the rules</b> · <code>/learn</code> tells all of it.",
  ]);
  assert.ok(full.indexOf("<b>Plan</b>") < full.indexOf("<b>Self-study</b>"), "after the plan");
  assert.ok(full.indexOf("<b>Self-study</b>") < full.indexOf("<b>What I need before I buy or sell</b>"));
  assert.match(fullReport(view(realWith(REVIEW))).html, /🔔 Verdict: <b>another version has earned a review<\/b> · <code>\/learn<\/code>/);
  assert.equal(fullReport(view(realWith(undefined))).html.includes("Self-study"), false);
  assert.match(viewData(view(realWith(LEARN))).text, /Self-study \(60 minutes ago\)/, "the desktop app and the phone page read the same text");
  assert.equal(daily(view(realWith(LEARN))).join("\n").includes("Self-study"), false, "the short /indodax lines stay short");
});

test("indodax study: a version that earns a review is told once, and never on the first report", () => {
  const watching = cleanReport(realWith(LEARN));
  const earned = cleanReport(realWith(REVIEW));
  const told = changes(watching, earned, NOW);
  assert.equal(told.length, 1);
  assert.match(told[0].html, /^🔔 <b>Indodax self-study<\/b>\n🔔 Verdict: <b>another version has earned a review<\/b>/);
  assert.match(told[0].html, /Nothing changes by itself/);
  assert.match(told[0].html, /<code>\/learn<\/code> shows the study \(60 minutes ago\)\.$/);

  assert.deepEqual(changes(earned, earned, NOW), [], "not every minute");
  assert.deepEqual(changes(null, earned, NOW).filter((message) => message.html.includes("self-study")), [], "nothing to compare with");
  assert.deepEqual(changes(cleanReport(realWith(undefined)), earned, NOW), [], "a study that starts at review was already told before the PC was away");
  assert.deepEqual(changes(watching, cleanReport(realWith({ ...LEARN, verdict: "keep" })), NOW), []);
  assert.deepEqual(changes(earned, watching, NOW), [], "back to watching is not news");
});

test("real mode: an offer is rewritten for the real buy, and one for a coin the sender does not trade stays off", () => {
  const settings = { riskPct: 1, maxPositionPct: 20 };
  const offer = (symbol) => proposal(symbol, { price: 100000, stop: 95000, why: "all 3 checks pass", until: NOW + 3600000 }, 500, 10000, settings);
  const seen = view(report({ mode: "real", keys: true, checked: true, orderIdr: 20000, maxOpen: 1, market: [{ coin: "btc", bid: 1650000000, ask: 1651000000 }] }));
  const kept = onlyReal([offer("BTCUSDT"), offer("ETHUSDT"), { html: "🟢 Bought BTC · practice money" }], seen);
  assert.equal(kept.length, 1, "the ETH offer and the book's own message stay off");
  assert.match(kept[0].html, /Buy BTC at Indodax\?<\/b> · ⚠️ <b>REAL MONEY<\/b>\nRp20\.000 of your own rupiah, at about Rp1\.651\.000\.000 per coin/);
  assert.match(kept[0].html, /Why: all 3 checks pass\nTap by \d\d:\d\d WIB\. No answer means no buy\./);
  assert.equal(/pretend|practice|of the account/i.test(kept[0].html), false);
  assert.deepEqual(kept[0].buttons[0].map((button) => button.data), ["ok:BTCUSDT", "no:BTCUSDT"]);
});

test("real mode: /help is about the real money only, and says how a buy is made with auto on and off", () => {
  const seen = view(report({ mode: "real", keys: true, checked: true, orderIdr: 20000, maxOpen: 1, stopPercent: 8 }));
  const alone = realHelp(seen, { timeframe: "4h", auto: true }).html;
  assert.match(alone, /All 3 pass: the sender on your PC buys Rp20\.000 of the coin at Indodax/);
  assert.match(alone, /falls 8% under the price paid/);
  assert.match(alone, /\/learn what my own study of the rules found/);
  assert.match(realHelp(seen, { timeframe: "4h", auto: false }).html, /All 3 pass: I ask you first, then the sender on your PC buys Rp20\.000/);
  assert.equal(/pretend|practice/i.test(alone), false);
});
