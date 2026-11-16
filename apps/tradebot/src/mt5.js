// MetaTrader 5, seen from the Worker.
//
// MetaTrader 5 only talks to a program on the same Windows PC as its terminal, so this Worker can
// never place an MT5 order itself. A small bridge on the owner's PC (apps/tradebot/mt5/bridge.py)
// does that, on a DEMO account only: once a minute it asks here which coins the practice account
// holds, copies that onto the broker's crypto symbols with the smallest lot, and posts back what the
// demo account looks like. /mt5 in Telegram shows that report.
//
// The Worker only hands out the practice account's open positions and shows what it is told.
// Nothing here can reach the PC, and no login number, name or password is ever stored.
//
// This file is the pure part: what the bridge should hold, tidy a report, spot what changed, and
// write the messages.

import { TICK_MS } from "./agent.js";
import { clock, coin, money, price, signedMoney } from "./render.js";
import { ago } from "./twin.js";
import { clip, escapeHtml } from "./util.js";

export const MT5_STALE_MS = 5 * 60 * 1000; // reports come every minute; five missed means the PC is away
export const SIGNALS_FRESH_MS = 3 * TICK_MS; // older than three rounds: the bridge holds and sends no orders
const MAX_POSITIONS = 10;
const MAX_NOTES = 5;

// ---------------------------------------------------------------- what the bridge should hold

// The practice account's open positions, and whether they are fresh enough to act on. When the
// agent has stopped (no round for a while) `fresh` is false and the bridge must not trade on it.
export function wantedOf(state, now) {
  const lastRoundAt = state && state.lastTick && Number.isFinite(state.lastTick.at) ? state.lastTick.at : null;
  const positions = (state && state.portfolio && state.portfolio.positions) || {};
  return {
    at: now,
    lastRoundAt,
    fresh: lastRoundAt !== null && now - lastRoundAt <= SIGNALS_FRESH_MS,
    wanted: Object.keys(positions)
      .sort()
      .map((symbol) => ({
        symbol,
        openedAt: Number(positions[symbol].openedAt) || 0,
        stop: Number(positions[symbol].stop) || 0,
      })),
  };
}

// ---------------------------------------------------------------- tidying a report

function number(value) {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function word(value, max = 40) {
  return clip(typeof value === "string" || typeof value === "number" ? String(value) : "", max);
}

// A report is whatever the PC sent. Keep only the fields /mt5 shows, as numbers and short words, so
// nothing else can be stored or written into a message. null when it is not a report.
export function cleanReport(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const positions = (Array.isArray(raw.positions) ? raw.positions : []).filter((item) => item && typeof item === "object");
  const notes = (Array.isArray(raw.notes) ? raw.notes : []).filter((item) => typeof item === "string" && item.trim());
  return {
    loggedIn: raw.loggedIn === true,
    demo: raw.demo === true, // only an explicit true counts as a demo account
    tradeAllowed: raw.tradeAllowed === true,
    server: word(raw.server),
    currency: word(raw.currency, 8).toUpperCase(),
    leverage: number(raw.leverage),
    balance: number(raw.balance),
    equity: number(raw.equity),
    positions: positions.slice(0, MAX_POSITIONS).map((position) => ({
      symbol: word(position.symbol, 20),
      brokerSymbol: word(position.brokerSymbol, 20),
      volume: number(position.volume),
      openPrice: number(position.openPrice),
      price: number(position.price),
      stop: number(position.stop),
      profit: number(position.profit),
      openedAt: number(position.openedAt),
    })),
    notes: notes.slice(0, MAX_NOTES).map((note) => clip(note.trim(), 160)),
  };
}

// ---------------------------------------------------------------- words

// Amounts are in the demo account's money. Dollars are written the way TradeBot writes them (rupiah
// once a rate is known, a dollar taken as one USDT); any other money is written as it is.
function inDollars(report) {
  return report.currency === "USD" || report.currency === "USDT";
}

function cash(report, value) {
  return inDollars(report) ? money(value) : `${value.toFixed(2)} ${escapeHtml(report.currency || "?")}`;
}

function signedCash(report, value) {
  if (inDollars(report)) return signedMoney(value);
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${Math.abs(value).toFixed(2)} ${escapeHtml(report.currency || "?")}`;
}

function quote(report, value) {
  return inDollars(report) ? price(value) : `${value} ${escapeHtml(report.currency || "?")}`;
}

function nameOf(position) {
  return escapeHtml(coin(position.symbol) || position.brokerSymbol || "?");
}

const ONLY_SHOWS = "I only show this. The bridge on your PC places the demo orders; nothing here can reach the PC.";

const REAL_ACCOUNT =
  "⚠️ <b>MetaTrader 5 is logged in to an account that is not a demo account.</b>\nThe bridge sent no orders and will not send any there: it only trades demo accounts. Log the terminal in to the demo account to continue.";

export function isStale(view) {
  return !view.report || view.now - view.at > MT5_STALE_MS;
}

function heard(view) {
  const age = ago(view.now - view.at);
  if (isStale(view)) {
    return `⚠️ Last heard from the bridge ${age} (${clock(view.at)}). The PC is off, asleep or offline, so these numbers are old and nothing new is copied.`;
  }
  return `Last heard from the bridge: ${age}.`;
}

function positionLine(report, position) {
  const parts = [`• <b>${nameOf(position)}</b> ${position.volume} lot (${escapeHtml(position.brokerSymbol || "?")})`];
  if (position.openPrice) parts.push(`bought at ${quote(report, position.openPrice)}`);
  if (position.price) parts.push(`now ${quote(report, position.price)}`);
  parts.push(position.stop ? `stop ${quote(report, position.stop)}` : "no stop set yet");
  parts.push(signedCash(report, position.profit));
  return parts.join(" · ");
}

// ---------------------------------------------------------------- the answer to /mt5

// view = { configured, report, at, now }
export function answer(view) {
  if (!view.configured) {
    return {
      html: [
        "<b>MetaTrader 5</b> is not set up.",
        "",
        "It works through a small bridge on a Windows PC with the MT5 terminal logged in to a <b>demo</b> account. The bridge copies the coins this practice account holds onto that demo account, with the smallest lot.",
        "The steps are in the README (MetaTrader 5). It only trades a demo account: a real-money account is refused.",
      ].join("\n"),
    };
  }
  const { report } = view;
  if (!report) {
    return {
      html: [
        "<b>MetaTrader 5</b> is set up, but I have not heard from the bridge on your PC yet.",
        "",
        "It reports once a minute while the PC is on, the MT5 terminal is logged in to the demo account, and the bridge is running with its key (MT5_BRIDGE_KEY in the bridge's .env).",
      ].join("\n"),
    };
  }
  if (!report.loggedIn) {
    return {
      html: ["<b>MetaTrader 5</b>", "", "⚠️ The terminal on your PC is not logged in to an account, so nothing is copied.", ...report.notes.map((note) => `• ${escapeHtml(note)}`), "", heard(view)].join("\n"),
    };
  }
  if (!report.demo) {
    return { html: [REAL_ACCOUNT, report.server ? `Server: ${escapeHtml(report.server)}` : null, "", heard(view)].filter((line) => line !== null).join("\n") };
  }
  const lines = [
    `<b>MetaTrader 5</b> · demo account (pretend money)${report.server ? ` · ${escapeHtml(report.server)}` : ""}`,
    "",
    `Balance: <b>${cash(report, report.balance)}</b>`,
    `Equity (with open trades): ${cash(report, report.equity)}${report.leverage ? ` · leverage 1:${report.leverage}` : ""}`,
  ];
  if (!report.tradeAllowed) lines.push("⚠️ Trading is switched off on the PC (Algo Trading in the terminal, or the account), so nothing is copied.");
  lines.push("");
  if (report.positions.length) {
    lines.push(`<b>Open copies</b>: ${report.positions.length}`);
    lines.push(...report.positions.map((position) => positionLine(report, position)));
  } else {
    lines.push("Holding nothing right now. It copies a coin only while this practice account holds it.");
  }
  if (report.notes.length) lines.push("", ...report.notes.map((note) => `• ${escapeHtml(note)}`));
  lines.push("", heard(view), ONLY_SHOWS);
  return { html: lines.join("\n") };
}

// ---------------------------------------------------------------- what changed between two reports

// Messages for copies that opened or closed since the last report, and one warning when the
// terminal turns out to be on an account that is not a demo. The first report tells no trades:
// there is nothing to compare it with.
export function changes(previous, next) {
  if (!next) return [];
  const messages = [];
  const wrongAccount = (report) => !!report && report.loggedIn && !report.demo;
  if (wrongAccount(next) && !wrongAccount(previous)) messages.push({ html: REAL_ACCOUNT });
  if (!previous || !previous.demo || !next.demo) return messages;

  const before = new Map(previous.positions.map((position) => [position.symbol, position]));
  const after = new Map(next.positions.map((position) => [position.symbol, position]));
  for (const position of next.positions) {
    if (before.has(position.symbol)) continue;
    messages.push({
      html: [
        `🟢 <b>MT5 demo bought ${nameOf(position)}</b> · pretend money`,
        `${position.volume} lot of ${escapeHtml(position.brokerSymbol || "?")}${position.openPrice ? ` at ${quote(next, position.openPrice)}` : ""}`,
        `Open copies: ${next.positions.length}`,
      ].join("\n"),
    });
  }
  for (const position of previous.positions) {
    if (after.has(position.symbol)) continue;
    messages.push({
      html: [
        `🔴 <b>MT5 demo closed ${nameOf(position)}</b> · pretend money`,
        `Last seen at ${signedCash(next, position.profit)} before it closed. The exact result is in the terminal's History tab.`,
        `Demo balance: ${cash(next, next.balance)}`,
      ].join("\n"),
    });
  }
  return messages;
}
