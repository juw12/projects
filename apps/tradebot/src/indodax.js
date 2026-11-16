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

import { clock, coin, idNumber } from "./render.js";
import { ago } from "./twin.js";
import { clip, escapeHtml } from "./util.js";

export const INDODAX_STALE_MS = 5 * 60 * 1000; // reports come every minute; five missed means the PC is away
export const INDODAX_SILENT_MS = 10 * 60 * 1000; // this long without a report, with real money in play, is told once
const MAX_POSITIONS = 5;
const MAX_CLOSED = 5;
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
        how: entry.how,
        estimated: entry.estimated === true,
      })),
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
  const practice = `pretend ${signedRp(values.practice)}`;
  return anyReal ? `${practice} · <b>REAL</b> ${signedRp(values.real)}` : practice;
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
