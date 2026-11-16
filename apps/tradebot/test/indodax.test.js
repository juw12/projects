import assert from "node:assert/strict";
import { test } from "node:test";

import { INDODAX_SILENT_MS, INDODAX_STALE_MS, answer, backText, changes, cleanReport, daily, isStale, pausedText, resumedText, silentAlert, withDaily } from "../src/indodax.js";

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
  assert.deepEqual(Object.keys(cleaned).sort(), ["checked", "closed", "keys", "maxOpen", "mode", "notes", "orderIdr", "paused", "positions", "result", "stopPercent", "today", "tripped", "trippedWhy"]);
  assert.deepEqual(cleaned.positions, [BTC]);
  assert.deepEqual(cleaned.closed, [{ symbol: "BTCUSDT", real: false, spent: 50000, received: 51000, at: NOW - 60000, how: "sold", estimated: false }]);
  assert.deepEqual(cleaned.notes, ["ok", "spaced"]);
  const kept = JSON.stringify(cleaned);
  for (const secret of ["someone@example.com", "12345678", "SECRET", "Juwen", "991"]) assert.equal(kept.includes(secret), false, secret);

  // Sizes are capped, and a close it does not know is dropped rather than guessed.
  const big = cleanReport(
    report({
      positions: Array.from({ length: 9 }, (unused, index) => ({ ...BTC, symbol: `C${index}USDT` })),
      closed: [
        { symbol: "XUSDT", how: "vanished", at: 1 },
        ...Array.from({ length: 8 }, (unused, index) => ({ symbol: "BTCUSDT", real: false, spent: 1, received: 1, at: index + 1, how: "sold" })),
      ],
      notes: Array.from({ length: 9 }, () => "n".repeat(900)),
      trippedWhy: "w".repeat(900),
    }),
  );
  assert.equal(big.positions.length, 5);
  assert.deepEqual(big.closed.map((entry) => entry.at), [4, 5, 6, 7, 8], "the newest five");
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
    /^<b>Indodax<\/b> · ⚠️ <b>REAL MONEY<\/b> \(your own rupiah\)\nEach buy: Rp20\.000 · at most 1 open\nHolding nothing\.\nResult so far: pretend Rp0 · <b>REAL<\/b> -Rp350\nLast heard from the sender: [^\n]+\.$/,
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
