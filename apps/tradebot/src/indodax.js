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

import { clock, closeHours, coin, day, hour, idNumber, nextClose, nextStep, pct, signalLines, soonLines } from "./render.js";
import { PARAMS } from "./strategy.js";
import { ago } from "./twin.js";
import { VERSION, clip, escapeHtml } from "./util.js";

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
    learn: cleanLearn(raw.learn),
  };
}

const VERDICTS = new Set(["keep", "watch", "review"]);
// The study's score, 0 to 10: the most each part can give (SCORE_MOST in learn.py).
export const SCORE_MOST = { unseen: 3, steady: 2, dips: 2, real: 3 };
const MAX_CURVE = 60;

const within = (value, most) => (typeof value === "number" && Number.isFinite(value) ? Math.min(most, Math.max(0, Math.round(value * 100) / 100)) : 0);

// The score of one study, or null when the sender is older than the score.
function cleanScore(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.total !== "number" || !Number.isFinite(raw.total)) return null;
  const parts = raw.parts && typeof raw.parts === "object" && !Array.isArray(raw.parts) ? raw.parts : {};
  return {
    total: within(raw.total, 10),
    parts: Object.fromEntries(Object.entries(SCORE_MOST).map(([name, most]) => [name, within(parts[name], most)])),
    realTrades: Math.max(0, Math.round(number(raw.realTrades))),
  };
}

// The short result of the sender's own study of the rules (indodax/learn.py on the PC), or null.
// Numbers, and one short line that names the version it watches. The study only reads prices: it
// cannot order and it never changes the rules.
export function cleanLearn(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !(number(raw.at) > 0) || !VERDICTS.has(raw.verdict)) return null;
  const part = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : null);
  const share = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null);
  const unseen = part(raw.unseen) || {};
  const cost = part(raw.cost) || {};
  const other = raw.verdict === "keep" ? null : part(raw.challenger);
  return {
    at: number(raw.at),
    candles: number(raw.candles),
    versions: number(raw.versions),
    order: number(raw.order),
    trades: number(raw.trades),
    wins: share(raw.wins) || 0,
    perYear: number(raw.perYear),
    dip: number(raw.dip),
    yearUp: share(raw.yearUp),
    monthUp: share(raw.monthUp),
    unseen: { windows: number(unseen.windows), up: number(unseen.up), live: number(unseen.live), picked: number(unseen.picked) },
    cost: {
      assumed: number(cost.assumed),
      measured: typeof cost.measured === "number" && Number.isFinite(cost.measured) ? cost.measured : null,
      trades: number(cost.trades),
      used: cost.used === "measured" ? "measured" : "assumed",
    },
    challenger: other ? { rules: clip(typeof other.rules === "string" ? other.rules.trim() : "", 80), days: number(other.days), trades: number(other.trades), lead: number(other.lead) } : null,
    verdict: other ? raw.verdict : "keep",
    score: cleanScore(raw.score),
    // One point a day, oldest first: the score's curve.
    curve: objects(raw.curve)
      .slice(-MAX_CURVE)
      .map((point) => ({ at: number(point.at), score: within(point.score, 10) }))
      .filter((point) => point.at > 0),
  };
}

// ---------------------------------------------------------------- words

// Indodax trades in rupiah, so these amounts are rupiah already: nothing is converted.
function rp(value) {
  return "Rp" + idNumber(Math.round(value));
}

export { rp as rupiah };

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

// The command that allows buying again. In real mode plain /resume does it too (bot.js).
const resumeWord = (report) => (report && report.mode === "real" ? "/resume" : "<code>/indodax resume</code>");

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
    const lines = [`⏸ <b>Buying is paused from Telegram.</b> No new copy is bought; open copies are still watched and sold. ${resumeWord(report)} allows buying again.`];
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
  lines.push(`${resumeWord(view.report)} allows buying again.`);
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
  if (view.paused || report.paused) lines.push(`⏸ Buying is paused from Telegram. ${resumeWord(report)} allows it again.`);
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

// What happens next. The strategy's own sentence, except where the real account says more: a
// pause, or as many coins held as the sender may hold at one time.
function nextLine(view, extra) {
  const { report } = view;
  if (report.mode !== "real") return nextStep(extra.state, view.now);
  if (view.paused || report.paused) return `Buying is paused, so nothing is bought. What you hold is still watched and sold. ${resumeWord(report)} allows buying again.`;
  const held = realOpen(report);
  if (report.maxOpen > 0 && held >= report.maxOpen) {
    return `You hold ${held} ${held === 1 ? "coin" : "coins"} at Indodax, the most at one time, so nothing more is bought until ${held === 1 ? "it" : "one"} is sold. I judge ${held === 1 ? "it" : "each"} again when the ${extra.state.settings.timeframe} candle closes at ${hour(nextClose(extra.state.settings.timeframe, view.now))}.`;
  }
  return nextStep(extra.state, view.now);
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
    const reading = signalLines(row, extra.state, view.now);
    // Buying by hand is off in real mode (bot.js), so its hint is left out there.
    lines.push(...(report.mode === "real" ? reading.map((line) => line.replace(/ \/buy \w+ buys now\./, "")) : reading));
    // The strategy bought this coin before the sender could copy it (or before real mode): the
    // sender never buys late, so say what it waits for instead of leaving "HOLD" unexplained.
    if (row.held && !report.positions.some((position) => position.symbol === row.symbol)) {
      lines.push(`→ At Indodax you hold no ${escapeHtml(coin(row.symbol))}: the strategy bought it earlier and the sender never buys late. It copies the next new buy signal, after the strategy has sold this one.`);
      continue; // a sale of a coin you do not hold is no news for this account
    }
    lines.push(...headsUpLines(view, row, extra.state));
  }
  if (!rows.length) lines.push("I could not read the strategy's signals just now. /signals shows them.");
  if (extra && extra.state) lines.push(`Next: ${nextLine(view, extra)}`);
  lines.push(`The sender on your PC copies each buy and each sale of this strategy at Indodax within about a minute: ${rp(report.orderIdr)} per buy.`);
  if (report.positions.length) {
    lines.push(`A copy is sold when the strategy sells (momentum turns down, the uptrend breaks, or its stop is hit), or when the Indodax price falls ${report.stopPercent}% under what was paid.`);
  }
  return lines;
}

// Why the sender would not buy now, whatever the checks say ("" when it would). The pause, the
// safety stop and the most-open rule are the sender's own; too little rupiah is Indodax's.
function realBlock(view) {
  const { report } = view;
  if (report.mode !== "real") return "";
  if (view.paused || report.paused) return "buying is paused";
  if (report.tripped) return "the sender's safety stop is on";
  const held = realOpen(report);
  if (report.maxOpen > 0 && held >= report.maxOpen) return `you already hold ${held} ${held === 1 ? "coin" : "coins"} at Indodax, the most at one time`;
  if (report.cash !== null && report.orderIdr > 0 && report.cash < report.orderIdr) return `the free rupiah (${rp(report.cash)}) is less than one buy of ${rp(report.orderIdr)}`;
  return "";
}

// How far the Indodax price is above the sender's own stop, in percent. null without both prices.
function aboveStop(position, report) {
  if (!(position.price > 0) || !(position.now > 0) || !(report.stopPercent > 0)) return null;
  const stop = position.price * (1 - report.stopPercent / 100);
  return { stop, pct: (position.now / stop - 1) * 100 };
}

// The heads-up for one coin (render.js soonLines), told for this account: a buy that the sender
// would not make says why, and a coin held at Indodax also shows how far its own stop is.
function headsUpLines(view, row, state) {
  try {
    const { report } = view;
    const block = row.blocked || realBlock(view);
    const lines = soonLines({ ...row, blocked: block }, state, view.now);
    for (const position of report.positions) {
      if (position.symbol !== row.symbol) continue;
      const room = aboveStop(position, report);
      if (room) lines.push(`🛡 The sender's own stop (${report.stopPercent}% under the price paid) is at ${rp(room.stop)} per coin: the Indodax price is ${room.pct > 0 ? `${room.pct.toFixed(1)}% above it` : "at or under it"}.`);
    }
    return lines;
  } catch (error) {
    // Only ever shown: a heads-up that cannot be written must not cost the report or the app's view.
    console.log("heads-up lines not written: " + String(error && error.message ? error.message : error).slice(0, 200));
    return [];
  }
}

// /headsup: only how near a buy or a sale is, coin by coin, and when the signs come.
function soonPart(view, extra) {
  const { report } = view;
  const rows = (extra && extra.rows) || [];
  const lines = [];
  for (const row of rows) {
    const name = escapeHtml(coin(row.symbol));
    if (row.error) {
      lines.push(`<b>${name}</b>: ⚠️ no fresh price right now, so no heads-up. I try again at my next 5-minute check.`);
      continue;
    }
    const mine = report.positions.some((position) => position.symbol === row.symbol);
    if (row.held && !mine) {
      lines.push(`<b>${name}</b>: the strategy holds it from before, and at Indodax you hold none. Nothing is bought until the strategy has sold it and a new buy signal comes.`);
      continue;
    }
    const found = headsUpLines(view, row, extra.state);
    lines.push(`<b>${name}</b>${mine ? " · you hold it" : ""}`, ...(found.length ? found : ["Too little price history for a heads-up yet."]));
  }
  if (!rows.length) lines.push("I could not read the prices just now, so there is no heads-up. Try again in a few minutes.");
  if (extra && extra.state) {
    const { timeframe } = extra.state.settings;
    lines.push(
      "",
      `<b>When I tell you by myself</b>`,
      `• In the last hour before a ${timeframe} candle closes (${closeHours(timeframe)}): when a buy or a sale looks likely at the price then. If it does not happen after all, I say that too.`,
      "• At any hour: when the price comes close to a stop.",
      "• And as before: every buy and every sale, right after it is done.",
      "A sign is worked out from the price now. It is not an order and not a forecast: the price can still move before the candle closes.",
    );
  }
  return lines;
}

// A minute in which the sender could not read the balance (the office network drops a call now
// and then) comes without the free rupiah. The figure read a moment ago is still right as long as
// nothing was bought or sold since, so it is kept for a short while instead of blanking the
// report and the plan. cashAt = when the sender last really read it.
export const CASH_KEPT_MS = 15 * 60 * 1000;

export function keepCash(previous, next, cashAt, now) {
  if (!next || next.cash !== null || !previous || previous.cash === null) return next;
  if (next.mode !== "real" || previous.mode !== "real") return next;
  if (!(cashAt > 0) || now - cashAt > CASH_KEPT_MS) return next;
  const copies = (report) => report.positions.map((position) => `${position.symbol}:${position.openedAt}:${position.spent}`).join("|");
  const same = copies(previous) === copies(next) && newest(previous) === newest(next) && previous.result.real === next.result.real;
  return same ? { ...next, cash: previous.cash } : next;
}

// ---------------------------------------------------------------- the plan

// The plan for a small real account: protect the money first, raise the size of a buy only after
// the account has grown. The ranges come from a test of these exact rules on past prices
// (tools/plan_backtest.py): BTC only, one fixed-size buy at a time, the sender's stop, Indodax
// candles for the prices, about 0.9% costs for each buy-and-sell. They are what the test gave
// for every start day in that period: low = 1 in 10 did worse, high = 1 in 10 did better.
// A past result is not a promise.
export const PLAN = {
  tested: "BTC, March 2020 to November 2026, 147 trades",
  perBuy: 20000, // the size of a buy in the test; the results grow and shrink with it
  wins: 33, // % of the test's trades that ended with a gain
  usualLoss: 600, // rupiah lost by an average losing trade
  worstLoss: 1700, // rupiah lost by the worst trade (the sender's stop, costs included)
  worstYear: -6700, // 2022
  bestYear: 19200, // 2021
  spans: [
    { name: "1 month", low: -1700, middle: 0, high: 4100 },
    { name: "3 months", low: -2200, middle: 600, high: 7900 },
    { name: "6 months", low: -2600, middle: 2200, high: 11700 },
    { name: "12 months", low: -2300, middle: 6500, high: 29500 },
  ],
  // Stages by the change of the real money since it was put in, in percent.
  floorPct: -20,
  stages: [
    { from: -Infinity, name: "protect the money", rule: "one small buy at a time, only in an uptrend" },
    { from: 10, name: "a little bigger", rule: "the account earned 10%: a buy can grow by half, still one at a time" },
    { from: 30, name: "more at once", rule: "the account earned 30%: two buys can be open at once" },
  ],
};

// Where the real money stands: { putIn, worth, change, pct, stage, scale } or null when the
// sender does not report the free rupiah, or not in real mode.
//   put in = free rupiah + what the open real copies cost - the real result so far
//   worth  = free rupiah + what the open real copies are worth now
// A top-up or a withdrawal moves both by the same amount, so the change stays the trading result.
export function planFigures(report) {
  if (!report || report.mode !== "real" || report.cash === null) return null;
  const open = report.positions.filter((position) => position.real);
  const spent = open.reduce((sum, position) => sum + position.spent, 0);
  const value = open.reduce((sum, position) => sum + (position.now > 0 ? position.value : position.spent), 0);
  const putIn = report.cash + spent - report.result.real;
  const worth = report.cash + value;
  if (!(putIn > 0)) return null;
  const change = worth - putIn;
  const pct = (change / putIn) * 100;
  let stage = 0;
  PLAN.stages.forEach((item, index) => {
    if (pct >= item.from) stage = index;
  });
  return { putIn, worth, change, pct, stage, floor: pct <= PLAN.floorPct, scale: report.orderIdr > 0 ? report.orderIdr / PLAN.perBuy : 1 };
}

const roundRp = (value) => Math.round(value / 100) * 100;

function planLines(report) {
  const figures = planFigures(report);
  if (!figures) return [];
  const { putIn, worth, change, stage, scale } = figures;
  const now = PLAN.stages[stage];
  const next = PLAN.stages[stage + 1];
  const lines = [
    "<b>Plan</b>",
    `Stage ${stage + 1} of ${PLAN.stages.length}: ${now.name}`,
    `Money put in: ${rp(putIn)} · worth now: <b>${rp(worth)}</b> (${signedRp(change)}, ${pct(figures.pct)})`,
    `Rule now: ${now.rule}. ${rp(report.orderIdr)} per buy, so a losing trade costs about ${rp(roundRp(PLAN.usualLoss * scale))} and at most about ${rp(roundRp(PLAN.worstLoss * scale))}.`,
  ];
  if (figures.floor) {
    lines.push(`⚠️ The account is ${Math.abs(PLAN.floorPct)}% or more under what was put in. <code>/indodax pause</code> stops new buys while the plan is looked at again.`);
  } else if (next) {
    lines.push(`Next stage at ${rp(roundRp(putIn * (1 + next.from / 100)))} (${next.name}). The size of a buy is never raised by itself: it is changed on the PC. If it falls to ${rp(roundRp(putIn * (1 + PLAN.floorPct / 100)))}, buying should stop and the plan be looked at again.`);
  } else {
    lines.push(`This is the last stage. If it falls to ${rp(roundRp(putIn * (1 + PLAN.floorPct / 100)))}, buying should stop and the plan be looked at again.`);
  }
  lines.push(`What a test on past prices gave from here (${PLAN.tested}; <b>not a promise</b>):`);
  for (const span of PLAN.spans) {
    lines.push(`• ${span.name}: ${rp(roundRp(worth + span.low * scale))} to ${rp(roundRp(worth + span.high * scale))}, middle ${rp(roundRp(worth + span.middle * scale))}`);
  }
  lines.push(`In that test ${PLAN.wins} of 100 trades won: many small losses, a few bigger gains. Best year ${signedRp(roundRp(PLAN.bestYear * scale))}, worst year ${signedRp(roundRp(PLAN.worstYear * scale))}.`);
  return lines;
}

// ---------------------------------------------------------------- the study

export const LEARN_OLD_MS = 12 * 60 * 60 * 1000; // the study runs every four hours; older than this, the PC was away
const LEARN_REVIEW = { days: 90, trades: 8 }; // what a watched version needs before a review (learn.py)

const share = (value) => idNumber(value, 1);
const points = (value) => idNumber(value, Number.isInteger(value * 10) ? (Number.isInteger(value) ? 0 : 1) : 2);
const LEARN_EVERY_MS = 4 * 60 * 60 * 1000; // LEARN_EVERY_SECONDS in bridge.py
const SCORE_REAL_TRADES = 30; // REAL_TRADES_FULL in learn.py
const COST_TRADES = 5; // real trades before the measured cost replaces the assumed one (learn.py)
const SCORE_NAMES = { unseen: "unseen prices", steady: "steady years", dips: "dips", real: "real money" };

// "▰▰▱▱▱▱▱▱▱▱": ten blocks, one per point.
function scoreBar(total) {
  const filled = Math.min(10, Math.max(0, Math.round(total)));
  return "▰".repeat(filled) + "▱".repeat(10 - filled);
}

// Where the score stood on the first day that is kept, and where it stands now.
function curveWords(curve, total) {
  if (curve.length < 2) return "The curve starts today: one point a day is kept from now on.";
  const first = curve[0];
  const change = Math.round((total - first.score) * 10) / 10;
  const moved = change === 0 ? "the same" : `${change > 0 ? "+" : "−"}${points(Math.abs(change))}`;
  return `Curve: ${points(first.score)} on ${day(first.at)} → ${points(total)} now (${moved} over ${curve.length} days with a study).`;
}

// The score, its four parts, the curve and what is still being collected. /learn shows all of it.
function scoreLines(learn, now) {
  const { score, cost, challenger } = learn;
  if (!score) return [];
  const parts = Object.keys(SCORE_MOST).map((name) => `${SCORE_NAMES[name]} ${points(score.parts[name])} of ${SCORE_MOST[name]}`);
  const next = learn.at + LEARN_EVERY_MS;
  const progress = [
    `real trades finished ${Math.min(score.realTrades, SCORE_REAL_TRADES)} of ${SCORE_REAL_TRADES}`,
    `real cost measured on ${Math.min(cost.trades, COST_TRADES)} of ${COST_TRADES} trades`,
    ...(challenger ? [`the watched version ${Math.min(challenger.days, LEARN_REVIEW.days)} of ${LEARN_REVIEW.days} days and ${Math.min(challenger.trades, LEARN_REVIEW.trades)} of ${LEARN_REVIEW.trades} trades`] : []),
  ];
  return [
    `<b>Score: ${points(score.total)} of 10</b> ${scoreBar(score.total)}`,
    `How far the rules are proven, not how clever they sound: ${parts.join(" · ")}.`,
    curveWords(learn.curve, score.total),
    `Still collecting: ${progress.join(" · ")}. Next study: ${next > now ? `about ${hour(next)}` : "at the sender's next cycle"}.`,
    "The scale is fixed. Only measured things move the score: gains on prices the rules had not seen, and finished real trades with their real result.",
  ];
}

function learnVerdict(learn) {
  const other = learn.challenger;
  if (!other) return "✅ Verdict: <b>keep the rules</b>. They are also the best version of the last three years.";
  const record = `${other.days} ${other.days === 1 ? "day" : "days"}, ${other.trades} ${other.trades === 1 ? "trade" : "trades"}, ${signedRp(other.lead)} against the rules that trade`;
  if (learn.verdict === "review") {
    return `🔔 Verdict: <b>another version has earned a review</b> (${escapeHtml(other.rules)}). On paper: ${record}. Nothing changes by itself: the rules are changed by hand, after a look.`;
  }
  return `👀 Verdict: <b>keep the rules</b>, and watch another version on paper (${escapeHtml(other.rules)}): ${record}. It needs ${LEARN_REVIEW.days} days and ${LEARN_REVIEW.trades} trades ahead before a review.`;
}

// What the study found. short = the four lines in the full report; /learn shows all of it.
function learnLines(report, now, short = false) {
  const learn = report.learn;
  if (!learn) return [];
  const old = now - learn.at > LEARN_OLD_MS;
  const title = `<b>Self-study</b> (${ago(now - learn.at)}${old ? ": ⚠️ old, the PC was off or could not read the prices" : ""})`;
  const year = learn.yearUp === null ? "" : ` A year ended with a gain in ${learn.yearUp} of 100 starts.`;
  if (short) {
    return [
      title,
      ...(learn.score ? [`Score: <b>${points(learn.score.total)} of 10</b> ${scoreBar(learn.score.total)} (how far the rules are proven; real trades ${Math.min(learn.score.realTrades, SCORE_REAL_TRADES)} of ${SCORE_REAL_TRADES}).`] : []),
      `The rules replayed on past prices: ${learn.trades} trades, ${learn.wins} of 100 won, about ${signedRp(roundRp(learn.perYear))} a year at ${rp(learn.order)} per buy.${year}`,
      `${learnVerdict(learn).split("</b>")[0]}</b> · <code>/learn</code> tells all of it.`,
    ];
  }
  const { unseen, cost } = learn;
  const lines = [
    title,
    ...scoreLines(learn, now),
    ...(learn.score ? [""] : []),
    `1. Replay: the rules that trade your money, on ${idNumber(learn.candles)} four-hour candles since March 2020. ${learn.trades} trades, ${learn.wins} of 100 won. About ${signedRp(roundRp(learn.perYear))} a year at ${rp(learn.order)} per buy, deepest dip ${signedRp(roundRp(learn.dip))}.`,
  ];
  if (learn.yearUp !== null && learn.monthUp !== null) lines.push(`   A year ended with a gain in ${learn.yearUp} of 100 starts, a single month in ${learn.monthUp} of 100.`);
  if (unseen.windows > 0) {
    lines.push(
      `2. Unseen prices: ${learn.versions || "many"} nearby versions of the rules are replayed too. For each half year the best one of the three years before is picked and judged on that half year only. ${unseen.windows} half years: the rules that trade gained in ${unseen.up} (${signedRp(roundRp(unseen.live))} in all); picking by the past gave ${signedRp(roundRp(unseen.picked))}.`,
    );
  }
  if (cost.measured === null) lines.push(`3. Real cost of a buy and a sale: ${share(cost.assumed)}% is assumed. No real trade is finished yet, so there is nothing to measure it on.`);
  else if (cost.used === "measured") lines.push(`3. Real cost of a buy and a sale: ${share(cost.measured)}%, measured on ${cost.trades} real trades. The replay uses it (${share(cost.assumed)}% was assumed before).`);
  else lines.push(`3. Real cost of a buy and a sale: ${share(cost.measured)}% on ${cost.trades} real ${cost.trades === 1 ? "trade" : "trades"} so far. From 5 trades on it replaces the assumed ${share(cost.assumed)}%.`);
  lines.push(learnVerdict(learn));
  lines.push("<i>The study runs on your PC every 4 hours and after each buy or sale. It only reads prices: it cannot order, and it never changes the rules or the size of a buy. Winning almost every trade is not the goal: rules that never lose keep losing trades open until one ends the account. The goal is more rupiah after costs on prices the rules have not seen. A past result is not a promise.</i>");
  return lines;
}

// The message when the study's verdict turns to review.
function reviewText(report, now) {
  return ["🔔 <b>Indodax self-study</b>", learnVerdict(report.learn), `<code>/learn</code> shows the study (${ago(now - report.learn.at)}).`].join("\n");
}

const TOPICS = {
  all: ["cash", "holding", "plan", "learnShort", "market", "need", "history", "result", "warnings", "sender"],
  status: ["cash", "holding", "result", "next", "warnings", "sender", "more"],
  learn: ["learn", "warnings", "sender"],
  holding: ["cash", "holding", "result", "warnings", "sender"],
  plan: ["cash", "plan", "result", "warnings", "sender"],
  analysis: ["market", "need", "warnings", "sender"],
  soon: ["soon", "warnings", "sender"],
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
    plan: planLines(report),
    learn: report.learn ? learnLines(report, view.now) : ["<b>Self-study</b>", "No study has arrived yet. The sender on your PC starts one by itself; the first takes a few minutes."],
    learnShort: learnLines(report, view.now, true),
    holding: ["<b>Holding now</b>", ...(report.positions.length ? report.positions.map((position) => holdingLine(position, report)) : [real ? "No coin. All the money is in rupiah." : "No coin."])],
    market: report.market.length ? ["<b>Market</b>", ...marketLines(report, extra && extra.rows)] : [],
    need: ["<b>What I need before I buy or sell</b>", ...needLines(view, extra)],
    soon: ["<b>How near a buy or a sale is</b>", ...soonPart(view, extra)],
    history: ["<b>History</b> (newest first)", ...(shown.closed.length ? [...shown.closed].reverse().map(historyLine) : [real ? "No real trade is finished yet." : "No trade is finished yet."])],
    result: [`Result so far: ${totals(report, report.result)}`, `Today (from 07:00 WIB): ${totals(report, report.today)} · ${report.today.buys} ${report.today.buys === 1 ? "buy" : "buys"}`],
    warnings: [
      ...(view.paused || report.paused ? [`⏸ Buying is paused${real ? "" : " from Telegram"}. ${resumeWord(report)} allows it again.`] : []),
      ...(real && !report.checked ? [NOT_CHECKED] : []),
      ...(report.tripped ? trippedLines(report) : []),
      ...report.notes.map((note) => `• ${escapeHtml(note)}`),
    ],
    sender: heard(view),
    next: extra && extra.state ? [`Next: ${nextLine(view, extra)}`] : [],
    more: ["/report has everything: the plan, the market, the history and my own study."],
  };
  const title = { all: "Indodax report", status: "Indodax: status", holding: "Indodax: what you hold", analysis: "Indodax: market and signals", soon: "Indodax: heads-up", trades: "Indodax: history", plan: "Indodax: the plan", learn: "Indodax: what I learned" }[topic] || "Indodax report";
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

// /help and /start in real mode: how the real money is traded, and only the commands that are
// about it. Nothing here is about the practice book. view = { report }; settings = the strategy's.
export function realHelp(view, settings) {
  const { report } = view;
  const frame = settings.timeframe;
  const buys = settings.auto ? "the sender on your PC buys" : "I ask you first, then the sender on your PC buys";
  return {
    html: [
      "🤖 <b>TradeBot</b> · ⚠️ <b>REAL MONEY</b> at Indodax (your own rupiah)",
      "Everything I say in this chat is about your real Indodax account.",
      "",
      "<b>How I trade</b>",
      `• Every 5 minutes I read the price. A candle is one ${frame} slice of the price, and when a candle closes I run 3 checks:`,
      `   Trend: the price is above its ${PARAMS.regime}-candle average.`,
      `   Momentum: the ${PARAMS.fast}-candle average is above the ${PARAMS.slow}-candle average.`,
      `   RSI: a 0 to 100 gauge of how fast the price rose lately. I want ${PARAMS.rsiMin} to ${PARAMS.rsiMax}: rising, not overheated.`,
      `• All 3 pass: ${buys} ${rp(report.orderIdr)} of the coin at Indodax, within about a minute. At most ${report.maxOpen} open at one time.`,
      `• It is sold when momentum turns down, the uptrend breaks or my stop is hit, and also when the Indodax price falls ${report.stopPercent}% under the price paid.`,
      "• Heads-up: in the last hour before a candle closes I tell you when a buy or a sale looks likely at the price then, and at any hour when the price comes close to a stop. A sign is not an order and not a forecast.",
      "• The buying and selling is done by the sender inside the TradeBot app on your PC. While the PC is off or asleep, nothing is bought and <b>nothing is sold</b>.",
      "",
      "<b>Commands</b>",
      "/status the real account in short: free rupiah, coins held, result, what happens next",
      "/report everything in one message (it also comes every day at 07:00 WIB)",
      "/holding what you hold · /analysis the market and what I need before I buy or sell · /trades each buy and sale with its result",
      "/headsup how near a buy or a sale is: the price it needs, when the candle closes, and my earliest estimate",
      "/plan the plan for the real money: stage, money put in, worth now, and what a test on past prices gave",
      "/learn what my own study of the rules found: the replay on past prices, the proof on unseen prices, the real cost, the verdict",
      "/phone a private link to the live page for your phone",
      "/pause no new buys (what you hold is still watched and sold) · /resume allows buying again",
      "/sell BTC sell a coin you hold at Indodax now (/sell all: everything)",
      "/auto off I ask before every buy (/auto on: I buy alone)",
      "You can also just ask, in everyday words: what do I hold, why no buy yet, how much profit.",
      "",
      "Buying by hand (/buy) is off: a coin is bought only when all 3 checks pass. The size of a buy is set on the PC, not here.",
      "<i>Not financial advice. A strategy can lose money.</i>",
    ].join("\n"),
  };
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

const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// The heads-up of one coin for the desktop app: the report's own lines as plain text, with the
// level and the time so the app can colour it. null when there is nothing to say, and for a coin
// the strategy holds but this account does not (its sale is no news here).
function soonData(view, row, state) {
  const soon = row.soon;
  if (!soon || soon.level === "unknown" || !view.report) return null;
  if (row.held && !view.report.positions.some((position) => position.symbol === row.symbol)) return null;
  const lines = headsUpLines(view, row, state).map(plain);
  if (!lines.length) return null;
  return { kind: soon.kind, level: soon.level, at: soon.at, lines };
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
          soon: soonData(view, row, extra.state),
        },
  );
  return {
    configured: !!(view && view.configured),
    version: VERSION, // the desktop app says when a newer one is out
    now: view.now,
    at: view.at || null,
    stale: isStale(view),
    paused: view.paused === true,
    report: view.report || null,
    signals: rows,
    plan: planFigures(view.report || null),
    words: plainWords(extra),
    text: plain(fullReport(view, extra).html),
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
  ".copy{color:#9db7dd;font-size:15px;margin:0 2px 10px}",
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

// The home-screen icon: four candles on the page's own dark colour, 180 by 180, a PNG with no
// see-through parts. It shows nothing private, so it is served without the link's key.
export const PHONE_ICON_PATH = "/v1/indodax/phone-icon.png";
const PHONE_ICON = "iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAAB2klEQVR42u3cvQ2AIBCAUTewsXEnJ7Kydjsn0o5Y2Jj4A3cv+RYAXkUOun4Ypcs6WyA4BIfgEByCQ3AIDsEhOASHBIfgEByCQ3AIDsEhOASH4JDgEByCQ3AIDsEhOASH4BAcEhyVNm1zCQ7BITgEh+AQHIIDDjjggAMOOOCIj+BucMABBxxwCA7BITgEh+CAAw444IADDjjggAMOOASH4BAcen4YBw444IADDsEhOJw0HHDAAQcccMABBxxw5L3ehgMOOOCAAw44BAcBcMABBxxwwAEHHHDAAQcccMABBxxwwAEHHIIjC459XUotDuP43hoOOOCAAw444IADDjjggAMOOPLhOCO4GxxwwAEHHHDAER/HU4uPiqOG4IADDjjggAMOOOCAAw444IADDjjggAOO2kf738ZR8/U2HHDAAQcccMABBxxwwAEHHHDAAQcccMABxz84MgSH4uJ4+zkkHHAIDsEBBxxwwAEHHHDAAQcccMABBxzt4RAcgkNwwAEHHHDAAQcccMABx1dBAAcccMABBxxwwCE4BIfgEByCQ3lxCA7BITgEhwSH4BAcgkNwCA7BITgEh+AQHBIcgkNwCA7BITgEh+AQHIJDgkNwCA7BITgEh+AQHArZASy6zLO4K7p5AAAAAElFTkSuQmCC";

export function phoneIcon() {
  return Uint8Array.from(atob(PHONE_ICON), (letter) => letter.charCodeAt(0));
}

// The copy of the page that the PC fetches and sends to the phone through GitHub (for a phone whose
// network blocks this server's address). It cannot reload itself, so it says when it was made, counts
// its own age, and warns when no newer copy has arrived for COPY_OLD_MINUTES.
export const COPY_OLD_MINUTES = 20;

function copyLines(now) {
  return [
    `<p class="copy">Copy made ${clock(now)} (<span id="age">see the time</span>). It comes to this phone through GitHub, so it can be about 10 minutes old.</p>`,
    `<div class="alert bad" id="old" hidden>⛔ No newer copy has arrived for <b id="oldfor">a while</b>. The PC that makes it is off, asleep or offline, so what you read below is old. If the PC is off, nothing is bought and <b>nothing is sold either</b>.</div>`,
  ];
}

// The only script on any page: it counts the copy's age. It reads nothing and sends nothing.
function copyScript(now) {
  return [
    "<script>",
    "(function () {",
    `  var made = ${Math.round(now)};`,
    "  function words(minutes) { return minutes < 1 ? \"just now\" : minutes < 120 ? minutes + (minutes === 1 ? \" minute ago\" : \" minutes ago\") : Math.round(minutes / 60) + \" hours ago\"; }",
    "  function tick() {",
    "    var minutes = Math.max(0, Math.floor((Date.now() - made) / 60000));",
    "    document.getElementById(\"age\").textContent = words(minutes);",
    `    document.getElementById("old").hidden = minutes < ${COPY_OLD_MINUTES};`,
    "    document.getElementById(\"oldfor\").textContent = words(minutes).replace(\" ago\", \"\");",
    // An old copy must not go on saying in green that the sender is running: nobody knows that now.
    "    var alive = document.querySelector(\".alive\");",
    `    if (alive && minutes >= ${COPY_OLD_MINUTES}) { alive.className = "alive away"; alive.textContent = "○ Sender: not known, this copy is old"; }`,
    "  }",
    "  tick();",
    "  setInterval(tick, 20000);",
    "})();",
    "</script>",
  ].join("\n");
}

// copy = true: the page as a file for the phone's GitHub way (see copyLines). It has no reload, and no
// home-screen tags or icon, because it is shown inside another page.
export function phonePage(html, now, view = null, words = [], copy = false) {
  const blocks = html.split("\n\n");
  const next = html.split("\n").find((line) => line.startsWith("Next: "));
  const withTop = !!(view && view.configured && view.report);
  const top = withTop ? phoneTop(view) : [];
  // A copy says so right under the title, before any warning or number is read.
  if (copy) top.splice(top.indexOf("</header>") + 1, 0, ...copyLines(now));
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
    copy ? "" : '<meta http-equiv="refresh" content="60">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="color-scheme" content="dark">',
    '<meta name="theme-color" content="#0f1419">',
    // Added to the home screen it opens like an app: no browser bars, its own name and icon.
    ...(copy
      ? []
      : [
          '<meta name="apple-mobile-web-app-capable" content="yes">',
          '<meta name="mobile-web-app-capable" content="yes">',
          '<meta name="apple-mobile-web-app-title" content="TradeBot">',
          '<meta name="apple-mobile-web-app-status-bar-style" content="black">',
          `<link rel="apple-touch-icon" href="${PHONE_ICON_PATH}">`,
        ]),
    "<title>TradeBot · Indodax</title>",
    "<style>",
    PHONE_STYLE,
    "</style></head><body><main>",
    ...top,
    next ? `<div class="next"><span>What happens next</span>${next.slice(6)}</div>` : "",
    rules ? `<p class="rules">${rules}</p>` : "",
    ...blocks.filter((block) => !said(block)).map(phoneSection),
    words.length ? `<section><h2>In plain words</h2>${words.map((entry) => `<p><b>${escapeHtml(entry.word)}</b>: ${escapeHtml(entry.means)}</p>`).join("")}</section>` : "",
    `<footer>${closing ? `${closing}<br>` : ""}${copy ? `Copy made ${clock(now)} · a new copy about every 5 minutes` : `Loaded ${clock(now)} · reloads every minute`} · read-only: nothing can be bought or sold from this page</footer>`,
    copy ? copyScript(now) : "",
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
    else if (message.buttons) kept.push(realOffer(message, view.report));
    else if (message.soon) kept.push(realSoon(message, view));
    else if (message.alert) kept.push(message);
  }
  return kept.filter(Boolean);
}

// A heads-up sign (render.js sign, signGone, stopNear), written for the real account. A buy sign
// is kept only when the sender would really buy that coin; a sale sign or a stop sign only when
// this account holds it. message.soon = { symbol, kind, what, head, body, at, auto }.
function realSoon(message, view) {
  const { report } = view;
  const { symbol, kind, what, head, body } = message.soon;
  const name = escapeHtml(coin(symbol));
  if (report.market.length && !report.market.some((row) => row.coin === coin(symbol))) return null;
  const mine = report.positions.some((position) => position.real && position.symbol === symbol);
  const lines = [`${head} · ⚠️ <b>REAL MONEY</b>`, ...body];
  if (kind === "buy") {
    const block = realBlock(view);
    if (mine || (block && !block.startsWith("the free rupiah"))) return null; // no real buy would follow: no sign
    if (what === "gone") return { html: lines.join("\n") };
    if (block) lines.push(`⚠️ But nothing would be bought: ${block}.`);
    else if (message.soon.auto) lines.push(`If it does, the sender on your PC buys ${rp(report.orderIdr)} of ${name} at Indodax within about a minute. The PC has to be on.`);
    else lines.push(`If it does, I ask you first. The sender on your PC buys ${rp(report.orderIdr)} of ${name} only after you approve.`);
  } else {
    if (!mine) return null;
    if (what === "gone") return { html: lines.join("\n") };
    if (what === "stop") lines.push(`If it falls to the stop, the sender on your PC sells your ${name} at Indodax within about a minute, at any hour. The PC has to be on.`);
    else lines.push(`If it does not, the sender on your PC sells your ${name} at Indodax within about a minute. The PC has to be on.`);
  }
  lines.push("<i>A sign from the price now, not an order: nothing is bought or sold yet, and the price can still move.</i>");
  return { html: lines.join("\n") };
}

// An offer to buy (ask mode), written for the real account: the size is the sender's fixed buy,
// not the book's. An offer for a coin the sender does not trade is not about real money, so it
// stays off like the other book messages. message = render.proposal's { html, buttons, symbol, tail }.
function realOffer(message, report) {
  if (!message.symbol) return { ...message, html: `${message.html}\n\n${offerIsReal(report)}` };
  const name = coin(message.symbol);
  if (report.market.length && !report.market.some((row) => row.coin === name)) return null;
  const row = report.market.find((item) => item.coin === name);
  const lines = [
    `🟡 <b>Buy ${escapeHtml(name)} at Indodax?</b> · ⚠️ <b>REAL MONEY</b>`,
    `${rp(report.orderIdr)} of your own rupiah${row && row.ask > 0 ? `, at about ${rp(row.ask)} per coin (what sellers ask now)` : ""}`,
    `Stop: it is sold if the Indodax price falls ${report.stopPercent}% under the price paid, and also when momentum turns down or the uptrend breaks.`,
    ...(message.tail || []),
    "Approving lets the sender on your PC buy it within about a minute. <code>/auto on</code> lets me buy alone, without asking.",
  ];
  return { html: lines.join("\n"), buttons: message.buttons };
}

function offerIsReal(report) {
  return `⚠️ <b>Approving this also buys at Indodax with REAL MONEY</b>: the sender on your PC copies it, ${rp(report.orderIdr)}. <code>/auto on</code> lets me buy alone, without asking.`;
}

// ---------------------------------------------------------------- the sender's own stop comes close

export const STOP_NEAR_PCT = 2; // told when the Indodax price is this close above the sender's stop
export const STOP_CLEAR_PCT = 4; // told again only after the price has been this far above it

// One message when the Indodax price of a held coin comes close to the sender's own stop (the
// price paid less stopPercent). told = { "symbol:openedAt": true } from the report before.
// Returns { messages, told }: the new `told` is saved with the report.
export function stopSigns(report, told = {}) {
  const messages = [];
  const next = {};
  if (!report) return { messages, told: next };
  for (const position of report.positions) {
    const key = `${position.symbol}:${position.openedAt}`;
    const room = aboveStop(position, report);
    if (!room) {
      if (told[key]) next[key] = true; // no price this minute: what was told stays told
      continue;
    }
    if (room.pct > STOP_NEAR_PCT) {
      if (told[key] && room.pct < STOP_CLEAR_PCT) next[key] = true;
      continue;
    }
    next[key] = true;
    if (told[key] || room.pct <= 0) continue; // already told, or already under it: the sale itself is told
    messages.push({
      html: [
        `🟠 <b>Heads-up: ${nameOf(position)} is close to the sender's stop</b> · ${tag(position.real)}`,
        `The Indodax price (${rp(position.now)}) is ${room.pct.toFixed(1)}% above the stop at ${rp(room.stop)}, which is ${report.stopPercent}% under the ${rp(position.price)} paid.`,
        `If it falls to the stop, the sender on your PC sells it within about a minute${position.spent > 0 ? `, for about ${rp(position.spent * (1 - report.stopPercent / 100))} of the ${rp(position.spent)} paid` : ""}. The PC has to be on.`,
        "<i>A sign from the price now, not an order: nothing is sold yet.</i>",
      ].join("\n"),
    });
  }
  return { messages, told: next };
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
export function changes(previous, next, now = Date.now()) {
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
  if (next.learn && next.learn.verdict === "review" && previous.learn && previous.learn.verdict !== "review") messages.push({ html: reviewText(next, now) });
  return messages;
}
