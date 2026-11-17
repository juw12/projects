// Indodax, seen from the Worker.
//
// Indodax answers this Worker with 403 (it turns Cloudflare away), so no order can ever be sent
// from here. A small sender on the owner's PC (apps/tradebot/indodax/bridge.py) does that: once a
// minute it asks here which coins the practice account holds, copies them at Indodax in rupiah, and
// posts back what its copies look like. /indodax in Telegram shows that report.
//
// The sender starts in practice: pretend money at Indodax's real prices. Real money is a switch on
// the PC only (the owner's own API key plus a sentence typed into the sender's .env). Nothing here
// can switch it on, and no API key, name, email or balance is ever sent here. The one thing the
// owner can do from Telegram is stop new buys (/indodax pause) and allow them again (/indodax
// resume): the sender reads that with its signals. Selling is never paused.
//
// This file is the pure part: tidy a report, spot what changed, and write the messages. Every
// message says whether it is pretend money or REAL MONEY, and anything unclear is shown as real.

import { clock, coin, idNumber, nextStep, pct, signalLines } from "./render.js";
import { PARAMS } from "./strategy.js";
import { ago } from "./twin.js";
import { clip, escapeHtml } from "./util.js";

export const INDODAX_STALE_MS = 5 * 60 * 1000; // reports come every minute; five missed means the PC is away
export const INDODAX_SILENT_MS = 10 * 60 * 1000; // this long without a report, with real money in play, is told once
const MAX_POSITIONS = 5;
const MAX_CLOSED = 10;
const MAX_MARKET = 5;
const MAX_NOTES = 5;
const NOTE_LENGTH = 300;
const HOW = new Set(["sold", "gone", "left"]);

// ---------------------------------------------------------------- tidying a report

function number(value) {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function word(value, max = 20) {
  return clip(typeof value === "string" || typeof value === "number" ? String(value) : "", max);
}

function objects(value) {
  return (Array.isArray(value) ? value : []).filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

function pair(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { practice: number(source.practice), real: number(source.real) };
}

// A report is whatever the PC sent. Keep only the fields /indodax shows, as numbers and short
// words, so nothing else can be stored or written into a message. null when it is not a report.
//
// Real money is never understated: only an explicit "practice" is practice, and a copy is pretend
// only when it says real: false.
export function cleanReport(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const trippedWhy = clip(typeof raw.trippedWhy === "string" ? raw.trippedWhy.trim() : "", NOTE_LENGTH);
  const notes = (Array.isArray(raw.notes) ? raw.notes : []).filter((item) => typeof item === "string" && item.trim());
  const today = pair(raw.today);
  return {
    mode: raw.mode === "practice" ? "practice" : "real",
    keys: raw.keys === true,
    checked: raw.checked === true, // this API key passed --check on the PC; without it no real buy is sent
    paused: raw.paused === true, // the sender has read the pause from Telegram
    tripped: raw.tripped === true || trippedWhy !== "",
    trippedWhy,
    orderIdr: number(raw.orderIdr),
    maxOpen: number(raw.maxOpen),
    stopPercent: number(raw.stopPercent),
    positions: objects(raw.positions)
      .slice(0, MAX_POSITIONS)
      .map((position) => ({
        symbol: word(position.symbol),
        pair: word(position.pair),
        real: position.real !== false,
        quantity: number(position.quantity),
        spent: number(position.spent),
        price: number(position.price),
        now: number(position.now),
        value: number(position.value),
        openedAt: number(position.openedAt),
      })),
    closed: objects(raw.closed)
      .filter((entry) => HOW.has(entry.how))
      .slice(-MAX_CLOSED)
      .map((entry) => ({
        symbol: word(entry.symbol),
        real: entry.real !== false,
        spent: number(entry.spent),
        received: number(entry.received),
        at: number(entry.at),
        boughtAt: number(entry.boughtAt),
        quantity: number(entry.quantity),
        how: entry.how,
        estimated: entry.estimated === true,
      })),
    // Free rupiah at Indodax: sent only when the owner switched that on (INDODAX_REPORT_CASH on the
    // PC), else null. Indodax's own prices of the coins the sender may trade are public numbers.
    cash: typeof raw.cash === "number" && Number.isFinite(raw.cash) && raw.cash >= 0 ? raw.cash : null,
    market: objects(raw.market)
      .slice(0, MAX_MARKET)
      .map((row) => ({ coin: word(row.coin).toUpperCase(), bid: number(row.bid), ask: number(row.ask) }))
      .filter((row) => row.coin && row.bid > 0),
    result: pair(raw.result),
    today: { ...today, buys: number(raw.today && typeof raw.today === "object" ? raw.today.buys : 0) },
    notes: notes.slice(0, MAX_NOTES).map((note) => clip(note.trim(), NOTE_LENGTH)),
  };
}

// ---------------------------------------------------------------- words

// Indodax trades in rupiah, so these amounts are rupiah already: nothing is converted.
function rp(value) {
  return "Rp" + idNumber(Math.round(value));
}

function signedRp(value) {
  const whole = Math.round(value);
  return `${whole > 0 ? "+" : whole < 0 ? "-" : ""}Rp${idNumber(whole)}`;
}

function nameOf(entry) {
  return escapeHtml(coin(entry.symbol) || entry.pair || "?");
}

function tag(real) {
  return real ? "<b>REAL MONEY</b>" : "pretend money";
}

function realOpen(report) {
  return report.positions.filter((position) => position.real).length;
}

const ONLY_SHOWS =
  "From here you can stop new buys (<code>/indodax pause</code>) and allow them again (<code>/indodax resume</code>). Everything else is on your PC: the sender there does the buying and selling, and nothing here can reach your Indodax account.";

const CLEAR = "To allow real buys again, check your Indodax account first, then run <code>run-windows.ps1 -Clear</code> on the PC.";

const NOT_CHECKED =
  "⚠️ <b>This API key has not passed the check on the PC</b>, so nothing is bought with real money yet. Stop the sender, run <code>run-windows.ps1 -Check</code> once, then start it again.";

function trippedLines(report) {
  return [
    `⚠️ <b>The safety stop is on.</b> ${escapeHtml(report.trippedWhy || "The sender gave no reason.")}`,
    `No new real buys are sent. Selling goes on. ${CLEAR}`,
  ];
}

function realModeText(report) {
  return [
    "⚠️ <b>Indodax: the sender on your PC is in REAL MONEY mode.</b>",
    `From now on each copy is bought with your own rupiah: ${rp(report.orderIdr)} per buy, at most ${report.maxOpen} open.`,
    "Only you can switch this on, in the sender's .env on the PC. To go back to practice, set INDODAX_MODE=practice there.",
  ].join("\n");
}

export function isStale(view) {
  return !view.report || view.now - view.at > INDODAX_STALE_MS;
}

// The pause is set here (Telegram) and carried out on the PC, so both sides are shown: what was
// asked for, and whether the sender has read it yet.
function pauseLines(view) {
  const { report } = view;
  const fresh = !isStale(view);
  if (view.paused) {
    const lines = ["⏸ <b>Buying is paused from Telegram.</b> No new copy is bought; open copies are still watched and sold. <code>/indodax resume</code> allows buying again."];
    if (!report.paused) lines.push(fresh ? "The sender has not read this yet. It asks once a minute." : "The sender has not read this yet, and it is not answering.");
    return lines;
  }
  if (report.paused && fresh) return ["▶️ Buying is allowed again. The sender reads that within a minute."];
  return [];
}

// The answers to /indodax pause and /indodax resume. view = { configured, report, at, now }
export function pausedText(view) {
  const lines = ["⏸ <b>Indodax buying is paused.</b> No new copy is bought. Open copies are still watched and sold, and the stop stays on."];
  lines.push(isStale(view) ? "The sender on your PC is not answering right now. It reads this as soon as it runs again." : "The sender on your PC reads this within a minute.");
  lines.push("<code>/indodax resume</code> allows buying again.");
  return lines.join("\n");
}

export function resumedText(view) {
  const { report } = view;
  const lines = ["▶️ <b>Indodax buying is allowed again.</b> The sender on your PC reads this within a minute."];
  if (report && report.mode === "real") {
    lines.push(`⚠️ It is in <b>REAL MONEY</b> mode: the next copy is bought with your own rupiah, ${rp(report.orderIdr)} per buy.`);
    if (!report.checked) lines.push(NOT_CHECKED);
    if (report.tripped) lines.push(`The safety stop is still on, so no real buy is sent yet. ${CLEAR}`);
  }
  if (report && isStale(view)) lines.push("The sender is not answering right now, so nothing is bought until it runs again.");
  return lines.join("\n");
}

// One alert when the sender has gone quiet while real money is in play: in real mode, or with a
// real copy still open. view = { report, at, now, toldAt }; toldAt is the report time this was
// last told for, so one silence is told once. null when there is nothing to tell.
export function silentAlert(view) {
  const { report } = view;
  if (!report || !view.at || view.toldAt === view.at) return null;
  if (view.now - view.at <= INDODAX_SILENT_MS) return null;
  const real = realOpen(report);
  if (report.mode !== "real" && !real) return null;
  const lines = [
    "⚠️ <b>Indodax: I have not heard from the sender on your PC</b>",
    `Its last report was ${ago(view.now - view.at)} (${clock(view.at)}). The PC is off, asleep or offline.`,
    "While it is away nothing is bought and <b>nothing is sold either</b>: its stop only works while it runs, and Indodax holds no stop order for these copies.",
  ];
  if (real) {
    lines.push(`<b>${real} open ${real === 1 ? "copy is" : "copies are"} REAL MONEY.</b> Start the sender again, or sell at Indodax yourself.`);
  } else {
    lines.push("No real copy is open, so nothing of yours is at risk right now.");
  }
  return { html: lines.join("\n") };
}

// Said on the first report after a silence that was told.
export function backText(report) {
  const real = realOpen(report);
  const open = report.positions.length;
  const holding = open ? `${open} open ${open === 1 ? "copy" : "copies"}${real ? ` (${real} REAL MONEY)` : ""}` : "nothing open";
  return `✅ <b>Indodax: the sender on your PC is back.</b> It reports again: ${holding}. /indodax shows it.`;
}

function heard(view) {
  const age = ago(view.now - view.at);
  if (!isStale(view)) return [`Last heard from the sender: ${age}.`];
  const lines = [
    `⚠️ Last heard from the sender ${age} (${clock(view.at)}). The PC is off, asleep or offline, so these numbers are old.`,
    "While it is away nothing is bought and <b>nothing is sold either</b>: its stop only works while it runs, and Indodax holds no stop order for these copies.",
  ];
  const real = realOpen(view.report);
  if (real) {
    lines.push(`⚠️ <b>${real} open ${real === 1 ? "copy is" : "copies are"} REAL MONEY and nobody is watching ${real === 1 ? "it" : "them"}.</b> Start the sender again, or sell at Indodax yourself.`);
  }
  return lines;
}

function positionLine(position) {
  const parts = [`• <b>${nameOf(position)}</b> · ${tag(position.real)}`, `paid ${rp(position.spent)}`];
  if (position.now > 0) parts.push(`worth ${rp(position.value)} now (${signedRp(position.value - position.spent)})`);
  else parts.push("no price right now");
  return parts.join(" · ");
}

function closedLine(entry) {
  const head = `• <b>${nameOf(entry)}</b> · ${tag(entry.real)}`;
  const when = entry.at ? ` · ${clock(entry.at)}` : "";
  if (entry.how === "gone") return `${head} · no longer in the Indodax account (sold or moved by hand?), closed without a result${when}`;
  if (entry.how === "left") return `${head} · too small for Indodax to sell, so it stays in your account; closed without a result${when}`;
  const about = entry.estimated ? "about " : "";
  return `${head} · sold: paid ${rp(entry.spent)}, got ${about}${rp(entry.received)} (${about}${signedRp(entry.received - entry.spent)})${when}`;
}

// Practice and real are never added together. The real part is shown as soon as anything real
// exists, and left out for an account that has only ever practised.
function totals(report, values) {
  const anyReal = report.mode === "real" || values.real !== 0 || realOpen(report) > 0 || report.closed.some((entry) => entry.real);
  // In real mode the pretend figure is left out unless something pretend is still on the books.
  const anyPretend = values.practice !== 0 || report.positions.some((position) => !position.real) || report.closed.some((entry) => !entry.real);
  if (report.mode === "real" && !anyPretend) return `<b>REAL</b> ${signedRp(values.real)}`;
  const practice = `pretend ${signedRp(values.practice)}`;
  return anyReal ? `${practice} · <b>REAL</b> ${signedRp(values.real)}` : practice;
}

// ---------------------------------------------------------------- the daily report

// The Indodax part of the daily summary (07:00 WIB) and of /report: where the copies stand, in a
// few lines. Each buy and sell is told when it happens, so this is the standing, not a list.
// "Today" is left out: the sender starts its own day at 07:00 WIB as well, so at that minute the
// figure is either the day that just ended or already zero.
// view = { configured, report, at, now, paused }. Nothing when Indodax is not set up.
export function daily(view) {
  if (!view || !view.configured) return [];
  const { report } = view;
  if (!report) return ["<b>Indodax</b>: no report yet from the sender on your PC. It reports while the PC is on and the sender is running."];
  const real = report.mode === "real";
  const lines = [
    real ? "<b>Indodax</b> · ⚠️ <b>REAL MONEY</b> (your own rupiah)" : "<b>Indodax</b> · practice (pretend money)",
    `Each buy: ${rp(report.orderIdr)} · at most ${report.maxOpen} open`,
  ];
  if (report.positions.length) lines.push(...report.positions.map(positionLine));
  else lines.push("Holding nothing.");
  lines.push(`Result so far: ${totals(report, report.result)}`);
  if (view.paused || report.paused) lines.push("⏸ Buying is paused from Telegram. <code>/indodax resume</code> allows it again.");
  if (real && !report.checked) lines.push(NOT_CHECKED);
  if (report.tripped) lines.push(...trippedLines(report));
  lines.push(...heard(view));
  return lines;
}

// Add that part to each message marked daily (the daily summary, /report). Other messages, and
// every message when Indodax is not set up, are returned as they are.
export function withDaily(messages, view) {
  const lines = daily(view);
  if (!lines.length) return messages;
  return messages.map((message) => (message && message.daily ? { ...message, html: `${message.html}\n\n${lines.join("\n")}` } : message));
}

// ---------------------------------------------------------------- the answer to /indodax

// view = { configured, report, at, now }
export function answer(view) {
  if (!view.configured) {
    return {
      html: [
        "<b>Indodax</b> is not set up.",
        "",
        "It works through a small sender on your PC, because Indodax does not answer this bot's server. The sender copies the coins this practice account holds onto Indodax in rupiah. It starts in practice: pretend money at Indodax's real prices.",
        "The steps are in the README (Indodax). Real money stays off until you switch it on yourself, on the PC.",
      ].join("\n"),
    };
  }
  const { report } = view;
  if (!report) {
    return {
      html: [
        "<b>Indodax</b> is set up, but I have not heard from the sender on your PC yet.",
        "",
        "It reports once a minute while the PC is on and the sender is running with its key (INDODAX_BRIDGE_KEY in the sender's .env).",
      ].join("\n"),
    };
  }

  const real = report.mode === "real";
  const lines = [real ? "<b>Indodax</b> · ⚠️ <b>REAL MONEY</b> (your own rupiah)" : "<b>Indodax</b> · practice (pretend money at Indodax's real prices)", ""];
  lines.push(`Each buy: ${rp(report.orderIdr)} · at most ${report.maxOpen} open · its own stop: ${report.stopPercent}% under the price paid`);
  if (!real && realOpen(report)) {
    lines.push("⚠️ Some copies below were bought with real money. The sender still sells those for real while its API key is on the PC.");
  }
  const pause = pauseLines(view);
  if (pause.length) lines.push("", ...pause);
  if (real && !report.checked) lines.push("", NOT_CHECKED);
  if (report.tripped) lines.push("", ...trippedLines(report));
  lines.push("");
  if (report.positions.length) {
    lines.push(`<b>Open copies</b>: ${report.positions.length}`);
    lines.push(...report.positions.map(positionLine));
  } else {
    lines.push("Holding nothing right now. It copies a coin only while this practice account holds it.");
  }
  lines.push("", `Result so far: ${totals(report, report.result)}`);
  lines.push(`Today (from 07:00 WIB): ${totals(report, report.today)} · ${report.today.buys} ${report.today.buys === 1 ? "buy" : "buys"}`);
  if (report.closed.length) {
    lines.push("", "<b>Closed lately</b>");
    lines.push(...[...report.closed].reverse().map(closedLine));
  }
  if (report.notes.length) lines.push("", ...report.notes.map((note) => `• ${escapeHtml(note)}`));
  lines.push("", ...heard(view), ONLY_SHOWS);
  return { html: lines.join("\n") };
}

// ---------------------------------------------------------------- the full report

// In real mode the owner is told about the real account only: TradeBot's practice messages
// (bought, sold, the practice daily summary) stay off, and this report takes their place.
export function realOnly(view) {
  return !!(view && view.configured && view.report && view.report.mode === "real");
}

function coinAmount(quantity) {
  return quantity.toFixed(8).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
}

function holdingLine(position, report) {
  const parts = [`• <b>${nameOf(position)}</b> · ${tag(position.real)}`];
  if (position.quantity > 0) parts.push(`${coinAmount(position.quantity)} ${nameOf(position)}`);
  if (position.openedAt) parts.push(`bought ${clock(position.openedAt)}`);
  parts.push(`paid ${rp(position.spent)}`);
  if (position.now > 0 && position.spent > 0) {
    parts.push(`worth ${rp(position.value)} now (${signedRp(position.value - position.spent)}, ${pct((position.value / position.spent - 1) * 100)})`);
  } else {
    parts.push("no price right now");
  }
  if (position.price > 0 && report.stopPercent > 0) parts.push(`sender's stop at ${rp(position.price * (1 - report.stopPercent / 100))} per coin`);
  return parts.join(" · ");
}

function historyLine(entry) {
  const head = `• <b>${nameOf(entry)}</b> · ${tag(entry.real)}`;
  const bought = entry.boughtAt ? `bought ${clock(entry.boughtAt)} for ${rp(entry.spent)}` : `bought for ${rp(entry.spent)}`;
  const when = entry.at ? ` ${clock(entry.at)}` : "";
  if (entry.how === "gone") return `${head} · ${bought} → no longer in the account${when} (sold or moved by hand), no result`;
  if (entry.how === "left") return `${head} · ${bought} → too small to sell${when}, it stays in the account, no result`;
  const about = entry.estimated ? "about " : "";
  const change = entry.spent > 0 ? `, ${pct(((entry.received - entry.spent) / entry.spent) * 100)}` : "";
  return `${head} · ${bought} → sold${when} for ${about}${rp(entry.received)} · ${about}${signedRp(entry.received - entry.spent)}${change}`;
}

function cashLines(report) {
  if (report.cash === null) return [];
  const buys = report.orderIdr > 0 ? Math.floor(report.cash / report.orderIdr) : 0;
  if (buys < 1) return [`Free rupiah at Indodax: <b>${rp(report.cash)}</b> · ⚠️ less than one buy of ${rp(report.orderIdr)}, so nothing can be bought until you top up.`];
  return [`Free rupiah at Indodax: <b>${rp(report.cash)}</b> · enough for ${buys} ${buys === 1 ? "buy" : "buys"} of ${rp(report.orderIdr)}`];
}

function marketLines(report, rows) {
  const lines = [];
  for (const row of report.market) {
    const change = (rows || []).find((item) => !item.error && coin(item.symbol) === row.coin && item.change24h !== null && item.change24h !== undefined);
    const spread = row.ask > 0 ? ((row.ask - row.bid) / row.ask) * 100 : 0;
    lines.push(`• <b>${escapeHtml(row.coin)}</b> at Indodax: buyers pay ${rp(row.bid)} · sellers ask ${rp(row.ask)} (${spread.toFixed(2)}% apart)${change ? ` · last 24 hours ${pct(change.change24h)}` : ""}`);
  }
  return lines;
}

// What the strategy sees in each coin the sender may trade, and what has to happen before it
// buys or sells. extra = { rows, state } from agent.js readSignals; without it this part is short.
function needLines(view, extra) {
  const { report } = view;
  const rows = (extra && extra.rows) || [];
  const lines = [];
  for (const row of rows) {
    if (row.error) {
      lines.push(`<b>${escapeHtml(coin(row.symbol))}</b>: ⚠️ no fresh price for the strategy right now. It tries again at its next 5-minute check.`);
      continue;
    }
    lines.push(...signalLines(row, extra.state, view.now));
    // The strategy bought this coin before the sender could copy it (or before real mode): the
    // sender never buys late, so say what it waits for instead of leaving "HOLD" unexplained.
    if (row.held && !report.positions.some((position) => position.symbol === row.symbol)) {
      lines.push(`→ At Indodax you hold no ${escapeHtml(coin(row.symbol))}: the strategy bought it earlier and the sender never buys late. It copies the next new buy signal, after the strategy has sold this one.`);
    }
  }
  if (!rows.length) lines.push("I could not read the strategy's signals just now. /signals shows them.");
  if (extra && extra.state) lines.push(`Next: ${nextStep(extra.state, view.now)}`);
  lines.push(`The sender on your PC copies each buy and each sale of this strategy at Indodax within about a minute: ${rp(report.orderIdr)} per buy.`);
  if (report.positions.length) {
    lines.push(`A copy is sold when the strategy sells (momentum turns down, the uptrend breaks, or its stop is hit), or when the Indodax price falls ${report.stopPercent}% under what was paid.`);
  }
  return lines;
}

const TOPICS = {
  all: ["cash", "holding", "market", "need", "history", "result", "warnings", "sender"],
  holding: ["cash", "holding", "result", "warnings", "sender"],
  analysis: ["market", "need", "warnings", "sender"],
  trades: ["history", "result", "sender"],
};

// The full Indodax report: free rupiah, what is held, the market, what the strategy needs before
// it buys or sells, the history and the result. The daily message (07:00 WIB), /report, the phone
// page and the desktop app are all written from this. topic narrows it (/holding, /analysis,
// /trades). view = { configured, report, at, now, paused }; extra = { rows, state } or null.
export function fullReport(view, extra = null, topic = "all") {
  if (!view || !view.configured || !view.report) return answer(view || { configured: false });
  const { report } = view;
  const real = report.mode === "real";
  const shown = real ? { ...report, closed: report.closed.filter((entry) => entry.real || entry.how !== "sold") } : report;
  const parts = {
    cash: cashLines(report),
    holding: ["<b>Holding now</b>", ...(report.positions.length ? report.positions.map((position) => holdingLine(position, report)) : [real ? "No coin. All the money is in rupiah." : "No coin."])],
    market: report.market.length ? ["<b>Market</b>", ...marketLines(report, extra && extra.rows)] : [],
    need: ["<b>What I need before I buy or sell</b>", ...needLines(view, extra)],
    history: ["<b>History</b> (newest first)", ...(shown.closed.length ? [...shown.closed].reverse().map(historyLine) : [real ? "No real trade is finished yet." : "No trade is finished yet."])],
    result: [`Result so far: ${totals(report, report.result)}`, `Today (from 07:00 WIB): ${totals(report, report.today)} · ${report.today.buys} ${report.today.buys === 1 ? "buy" : "buys"}`],
    warnings: [
      ...(view.paused || report.paused ? ["⏸ Buying is paused from Telegram. <code>/indodax resume</code> allows it again."] : []),
      ...(real && !report.checked ? [NOT_CHECKED] : []),
      ...(report.tripped ? trippedLines(report) : []),
      ...report.notes.map((note) => `• ${escapeHtml(note)}`),
    ],
    sender: heard(view),
  };
  const title = { all: "Indodax report", holding: "Indodax: what you hold", analysis: "Indodax: market and signals", trades: "Indodax: history" }[topic] || "Indodax report";
  const lines = [
    `📋 <b>${title}</b> · ${real ? "⚠️ <b>REAL MONEY</b>" : "practice (pretend money)"} · ${clock(view.now)}`,
    `Each buy: ${rp(report.orderIdr)} · at most ${report.maxOpen} open · stop: ${report.stopPercent}% under the price paid`,
  ];
  for (const name of TOPICS[topic] || TOPICS.all) {
    if (parts[name].length) lines.push("", ...parts[name]);
  }
  lines.push("", "<i>Not financial advice. A strategy can lose money.</i>");
  return { html: lines.join("\n") };
}

// What the three checks mean, for someone who has never traded: [{ word, means }]. Written from
// the strategy's own numbers, so the desktop app and the phone page never drift from the rules.
export function plainWords(extra = null) {
  if (!extra || !extra.state) return [];
  const { timeframe } = extra.state.settings;
  return [
    { word: "Candle", means: `the price during one ${timeframe} slice of time. I judge a coin once per candle.` },
    { word: "Trend", means: `the price is above its average of the last ${PARAMS.regime} candles, so the long direction is up.` },
    { word: "Momentum", means: `the average of the last ${PARAMS.fast} candles is above the average of the last ${PARAMS.slow}, so it has been rising lately.` },
    { word: "RSI", means: `a 0 to 100 gauge of how fast the price rose lately. I want ${PARAMS.rsiMin} to ${PARAMS.rsiMax}: rising, but not overheated.` },
  ];
}

// The same numbers for the desktop app, as data. Nothing here that the report does not show.
export function viewData(view, extra = null) {
  const rows = ((extra && extra.rows) || []).map((row) =>
    row.error
      ? { coin: coin(row.symbol), error: true }
      : {
          coin: coin(row.symbol),
          action: row.held ? (row.decision.action === "sell" ? "SELL" : "HOLD") : row.decision.action === "buy" ? "BUY" : "WAIT",
          why: row.decision.why,
          checks: row.decision.reasons.map((reason) => ({ name: reason.name, ok: reason.ok, text: reason.text })),
          change24h: row.change24h === undefined ? null : row.change24h,
        },
  );
  return {
    configured: !!(view && view.configured),
    now: view.now,
    at: view.at || null,
    stale: isStale(view),
    paused: view.paused === true,
    report: view.report || null,
    signals: rows,
    words: plainWords(extra),
    text: fullReport(view, extra).html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"),
  };
}

// The phone page: the full report as a small web page that reloads itself every minute. The
// report's HTML uses only <b>, <i> and <code>, and every value in it is already escaped.
//
// With view (the same { configured, report, at, now, paused } the report was written from) the
// page opens with what matters at a glance: real or practice, whether the sender is alive, the
// warnings, four numbers and what happens next. Without it the page is the report alone.
const PHONE_STYLE = [
  "*{box-sizing:border-box}",
  "body{margin:0;padding:14px;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1419;color:#e6e9ee;-webkit-text-size-adjust:100%}",
  "main{max-width:640px;margin:0 auto}",
  "header{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin:2px 0 10px}",
  "h1{font-size:20px;line-height:1.2;margin:0}",
  ".mode{font-size:15px;font-weight:700;border-radius:6px;padding:3px 10px;background:#3a4556;color:#fff}",
  ".mode.real{background:#c0392b}",
  ".alive{flex-basis:100%;font-size:15px;color:#4cd17a}",
  ".alive.away{color:#ff8a80}",
  ".alert{border-radius:12px;padding:10px 14px;margin:0 0 10px;background:#3b2a12;border:1px solid #7a5a1c;color:#ffd58a}",
  ".alert.bad{background:#3d1a1a;border-color:#8c2f2f;color:#ffb4ab}",
  ".tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 10px}",
  ".tile{background:#1a212b;border:1px solid #2a3442;border-radius:12px;padding:10px 12px;min-width:0}",
  ".tile span{display:block;font-size:15px;color:#9aa6b6}",
  ".tile strong{display:block;font-size:22px;line-height:1.3;overflow-wrap:anywhere}",
  ".up{color:#4cd17a}.down{color:#ff8a80}",
  ".next{background:#20304a;border:1px solid #35507a;border-radius:12px;padding:10px 14px;margin:0 0 10px}",
  ".next span{display:block;font-size:15px;color:#9db7dd}",
  ".rules{color:#9aa6b6;font-size:15px;margin:0 2px 12px}",
  "section{background:#1a212b;border:1px solid #2a3442;border-radius:12px;padding:12px 14px;margin:0 0 10px;overflow-wrap:anywhere}",
  "h2{font-size:17px;margin:0 0 6px;color:#fff}",
  "h2 small{font-size:15px;font-weight:400;color:#9aa6b6}",
  "p{margin:0 0 6px}p:last-child{margin-bottom:0}",
  "p.coin{margin-top:12px;font-size:17px}h2+p.coin{margin-top:0}",
  "p.check{margin:0 0 2px;padding-left:4px}",
  "p.note{color:#9aa6b6}",
  "code{background:#2a3442;border-radius:4px;padding:1px 5px;font-size:.94em}",
  "footer{color:#9aa6b6;font-size:15px;text-align:center;padding:6px 0 18px}",
].join("\n");

function phoneLine(line) {
  const kind = line.startsWith("✅") || line.startsWith("❌") ? "check" : line.startsWith("→") ? "note" : /^<b>[^<]+<\/b> [^:]*: <b>[A-Z]+<\/b>$/.test(line) ? "coin" : "";
  return `<p${kind ? ` class="${kind}"` : ""}>${line}</p>`;
}

// One block of the report as a card. A block that opens with a bold title gets a real heading.
function phoneSection(block) {
  const lines = block.split("\n").filter((line) => line && !line.startsWith("Next: "));
  if (!lines.length) return "";
  const title = lines[0].match(/^<b>([^<]+)<\/b>( \([^<)]*\))?$/);
  const head = title ? `<h2>${title[1]}${title[2] ? ` <small>${title[2].trim()}</small>` : ""}</h2>` : "";
  return `<section>${head}${(title ? lines.slice(1) : lines).map(phoneLine).join("")}</section>`;
}

function phoneTile(label, value, hint, tone = "") {
  return `<div class="tile"><span>${label}</span><strong${tone ? ` class="${tone}"` : ""}>${value}</strong><span>${hint}</span></div>`;
}

// The top of the page: mode, sender, warnings, the four numbers. Every value is a number or one
// of this file's own words, and coin names go through nameOf (escaped).
function phoneTop(view) {
  const { report } = view;
  const real = report.mode === "real";
  const kind = real ? "real" : "practice";
  const stale = isStale(view);
  const held = report.positions.filter((position) => !real || position.real);
  const worth = held.reduce((sum, position) => sum + position.value, 0);
  const paid = held.reduce((sum, position) => sum + position.spent, 0);
  const finished = report.closed.filter((entry) => entry.how === "sold" && (!real || entry.real)).length;
  const buys = report.cash !== null && report.orderIdr > 0 ? Math.floor(report.cash / report.orderIdr) : 0;
  const tone = (value) => (value > 0 ? "up" : value < 0 ? "down" : "");
  const alerts = [];
  if (stale) alerts.push(["bad", `The sender on your PC was last heard ${ago(view.now - view.at)}. While it is away nothing is bought and <b>nothing is sold either</b>.`]);
  if (report.tripped) alerts.push(["bad", "Safety stop: real buying is blocked until you have looked at Indodax. The reason is below."]);
  if (real && !report.checked) alerts.push(["bad", "Real mode is on, but the API key has not passed its check on the PC, so nothing is bought."]);
  if (view.paused || report.paused) alerts.push(["", "Buying is paused. Coins you hold are still watched and sold."]);
  if (real && report.cash !== null && buys < 1 && !report.positions.length) alerts.push(["", `Free rupiah is less than one buy of ${rp(report.orderIdr)}. Top up at Indodax or nothing can be bought.`]);
  return [
    "<header>",
    "<h1>TradeBot · Indodax</h1>",
    `<span class="mode${real ? " real" : ""}">${real ? "REAL MONEY" : "practice (pretend money)"}</span>`,
    `<span class="alive${stale ? " away" : ""}">${stale ? "○ Sender is silent" : "● Sender is running"} · heard ${ago(view.now - view.at)}</span>`,
    "</header>",
    ...alerts.map(([level, text]) => `<div class="alert${level ? ` ${level}` : ""}">${level ? "⛔" : "⚠️"} ${text}</div>`),
    '<div class="tiles">',
    phoneTile("Free rupiah", report.cash === null ? "not reported" : rp(report.cash), report.cash === null ? "the sender does not send it" : `enough for ${buys} ${buys === 1 ? "buy" : "buys"}`),
    phoneTile("Coins you hold", held.length ? held.map(nameOf).join(", ") : "No coin", held.length ? `worth ${rp(worth)}${paid > 0 ? ` (${pct((worth / paid - 1) * 100)})` : ""}` : "all in rupiah"),
    phoneTile("Result so far", signedRp(report.result[kind]), finished ? `${finished} finished ${finished === 1 ? "trade" : "trades"}` : "no trade finished yet", tone(Math.round(report.result[kind]))),
    phoneTile("Today", signedRp(report.today[kind]), `${report.today.buys} ${report.today.buys === 1 ? "buy" : "buys"} · from 07:00 WIB`, tone(Math.round(report.today[kind]))),
    "</div>",
  ];
}

export function phonePage(html, now, view = null, words = []) {
  const blocks = html.split("\n\n");
  const next = html.split("\n").find((line) => line.startsWith("Next: "));
  const withTop = !!(view && view.configured && view.report);
  const top = withTop ? phoneTop(view) : [];
  // With the top in place the report's own title line would only repeat it: keep its rules line.
  const rules = withTop && blocks.length ? blocks.shift().split("\n").slice(1).join(" · ") : "";
  // The top already says these, so the same words are not shown twice. A block that warns
  // (too little rupiah, a silent sender) or that mixes pretend and real money stays.
  const said = (block) =>
    withTop &&
    ((block.startsWith("Free rupiah at Indodax:") && !block.includes("⚠️")) ||
      (block.startsWith("Result so far:") && !block.includes("pretend")) ||
      block.startsWith("Last heard from the sender:"));
  const closing = blocks.length && /^<i>[^<]*<\/i>$/.test(blocks[blocks.length - 1]) ? blocks.pop() : "";
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="refresh" content="60">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="color-scheme" content="dark">',
    '<meta name="theme-color" content="#0f1419">',
    "<title>TradeBot · Indodax</title>",
    "<style>",
    PHONE_STYLE,
    "</style></head><body><main>",
    ...top,
    next ? `<div class="next"><span>What happens next</span>${next.slice(6)}</div>` : "",
    rules ? `<p class="rules">${rules}</p>` : "",
    ...blocks.filter((block) => !said(block)).map(phoneSection),
    words.length ? `<section><h2>In plain words</h2>${words.map((entry) => `<p><b>${escapeHtml(entry.word)}</b>: ${escapeHtml(entry.means)}</p>`).join("")}</section>` : "",
    `<footer>${closing ? `${closing}<br>` : ""}Loaded ${clock(now)} · reloads every minute · read-only: nothing can be bought or sold from this page</footer>`,
    "</main></body></html>",
  ]
    .filter(Boolean)
    .join("\n");
}

// Add the full report in place of the practice daily summary. messages = this round's messages.
export function onlyReal(messages, view, extra = null) {
  const kept = [];
  for (const message of messages) {
    if (!message) continue;
    if (message.daily) kept.push({ ...fullReport(view, extra), daily: true });
    else if (message.buttons) kept.push({ ...message, html: `${message.html}\n\n${offerIsReal(view.report)}` });
    else if (message.alert) kept.push(message);
  }
  return kept;
}

function offerIsReal(report) {
  return `⚠️ <b>Approving this also buys at Indodax with REAL MONEY</b>: the sender on your PC copies it, ${rp(report.orderIdr)}. <code>/auto on</code> lets me buy alone, without asking.`;
}

// ---------------------------------------------------------------- what changed between two reports

function newest(report) {
  return report.closed.reduce((latest, entry) => Math.max(latest, entry.at), 0);
}

function boughtText(position, report) {
  return [
    `🟢 <b>Indodax bought ${nameOf(position)}</b> · ${tag(position.real)}`,
    `Paid ${rp(position.spent)}${position.price ? ` at ${rp(position.price)} per coin` : ""}`,
    `Open copies: ${report.positions.length}`,
  ].join("\n");
}

function closedText(entry) {
  const label = tag(entry.real);
  if (entry.how === "gone") {
    return [`⚪ <b>Indodax: ${nameOf(entry)} is no longer in the account</b> · ${label}`, "It was sold or moved by hand, so the copy is closed without a result."].join("\n");
  }
  if (entry.how === "left") {
    return [`⚪ <b>Indodax: what is left of ${nameOf(entry)} is too small to sell</b> · ${label}`, "It stays in your Indodax account. The copy is closed without a result."].join("\n");
  }
  const about = entry.estimated ? "about " : "";
  const lines = [`🔴 <b>Indodax sold ${nameOf(entry)}</b> · ${label}`, `Paid ${rp(entry.spent)}, got ${about}${rp(entry.received)}: ${about}${signedRp(entry.received - entry.spent)}`];
  if (entry.estimated) lines.push("This result is an estimate. The exact one is in your Indodax order history.");
  return lines.join("\n");
}

// Messages for copies that opened or closed since the last report, one warning when the safety
// stop comes on, and one when the sender turns to real money. The first report tells no trades
// (there is nothing to compare it with), but it does tell both warnings.
export function changes(previous, next) {
  if (!next) return [];
  const messages = [];
  if (next.mode === "real" && !(previous && previous.mode === "real")) messages.push({ html: realModeText(next) });
  if (next.tripped && !(previous && previous.tripped)) messages.push({ html: ["<b>Indodax</b>", ...trippedLines(next)].join("\n") });
  if (!previous) return messages;

  const key = (position) => `${position.symbol}:${position.openedAt}`;
  const before = new Set(previous.positions.map(key));
  for (const position of next.positions) {
    if (!before.has(key(position))) messages.push({ html: boughtText(position, next) });
  }
  const since = newest(previous);
  for (const entry of next.closed) {
    if (entry.at > since) messages.push({ html: closedText(entry) });
  }
  return messages;
}
