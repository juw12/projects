// The twin's voice in Telegram.
//
// The twin is freqtrade running TradeBot's rules in dry run on the owner's PC. Its own Telegram
// bot only works while the PC is on, on a network that allows Telegram. Here the PC does not talk
// to Telegram at all: when the owner switches reports on, a small reporter next to freqtrade posts
// what the twin is doing to this Worker once a minute (HTTPS), and the Worker answers the twin's
// bot. Reports are the owner's choice: on an office network that blocks Telegram, they send the
// twin's numbers out another way, and that network's rules decide whether that is allowed.
//
// It only shows. Nothing travels back to the PC, so this bot cannot buy, sell or stop the twin, and
// it is only as fresh as the last report: when the PC is off, it says so instead of guessing.
//
// This file is the pure part: tidy a report, spot what changed, and write the messages.

import { clock, money, pct, price, signedMoney } from "./render.js";
import { clip, escapeHtml } from "./util.js";

export const TWIN_STALE_MS = 5 * 60 * 1000; // reports come every minute; five missed means the PC is away
const MAX_TRADES = 10;

export const TWIN_COMMANDS = [
  { command: "status", description: "The twin's account and open trades" },
  { command: "profit", description: "The twin's result so far" },
  { command: "trades", description: "The twin's last closed trades" },
  { command: "help", description: "What this bot is and why it only shows" },
];

// ---------------------------------------------------------------- tidying a report

function number(value) {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function word(value, max = 40) {
  return clip(typeof value === "string" || typeof value === "number" ? String(value) : "", max);
}

function list(value) {
  return (Array.isArray(value) ? value : []).filter((item) => item && typeof item === "object").slice(0, MAX_TRADES);
}

// A report is whatever the PC sent. Keep only the fields this bot shows, as numbers and short
// words, so nothing else can be stored or written into a message. null when it is not a report.
export function cleanSnapshot(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const balance = raw.balance && typeof raw.balance === "object" ? raw.balance : {};
  const profit = raw.profit && typeof raw.profit === "object" ? raw.profit : {};
  return {
    state: word(raw.state, 20),
    dryRun: raw.dryRun !== false, // only an explicit false is real money
    strategy: word(raw.strategy),
    exchange: word(raw.exchange, 20),
    timeframe: word(raw.timeframe, 8),
    stake: word(raw.stake, 10) || "USDT",
    maxOpen: number(raw.maxOpen),
    balance: { total: number(balance.total), free: number(balance.free), start: number(balance.start) },
    profit: {
      closed: number(profit.closed),
      all: number(profit.all),
      allPct: number(profit.allPct),
      trades: number(profit.trades),
      closedTrades: number(profit.closedTrades),
      wins: number(profit.wins),
      losses: number(profit.losses),
    },
    open: list(raw.open).map((trade) => ({
      id: number(trade.id),
      pair: word(trade.pair, 20),
      amount: number(trade.amount),
      openRate: number(trade.openRate),
      rate: number(trade.rate),
      stake: number(trade.stake),
      profit: number(trade.profit),
      profitPct: number(trade.profitPct),
      openedAt: number(trade.openedAt),
    })),
    closed: list(raw.closed).map((trade) => ({
      id: number(trade.id),
      pair: word(trade.pair, 20),
      profit: number(trade.profit),
      profitPct: number(trade.profitPct),
      closedAt: number(trade.closedAt),
      reason: word(trade.reason, 30),
    })),
  };
}

// ---------------------------------------------------------------- words

// "BTC/USDT" -> "BTC"
function coinOf(pair) {
  return escapeHtml(String(pair).split("/")[0] || "?");
}

// Amounts are in the twin's stake money. USDT is written the way TradeBot writes it (rupiah once a
// rate is known); any other stake money is written as it is, never converted with the wrong rate.
function cash(snapshot, value) {
  return snapshot.stake === "USDT" ? money(value) : `${value.toFixed(2)} ${escapeHtml(snapshot.stake)}`;
}

function signedCash(snapshot, value) {
  if (snapshot.stake === "USDT") return signedMoney(value);
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${Math.abs(value).toFixed(2)} ${escapeHtml(snapshot.stake)}`;
}

function quote(snapshot, value) {
  return snapshot.stake === "USDT" ? price(value) : `${value} ${escapeHtml(snapshot.stake)}`;
}

function ago(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const REASONS = {
  exit_signal: "the rules said sell",
  stop_loss: "stop hit",
  stoploss: "stop hit",
  trailing_stop_loss: "trailing stop hit",
  stoploss_on_exchange: "stop hit",
  roi: "target reached",
  force_exit: "sold by hand",
  emergency_exit: "emergency exit",
};

function reasonOf(reason) {
  if (!reason) return "";
  return REASONS[reason] || escapeHtml(reason.replace(/_/g, " "));
}

function moneyKind(snapshot) {
  return snapshot.dryRun ? "pretend money" : "⚠️ REAL money";
}

export function isStale(view) {
  return !view.snapshot || view.now - view.at > TWIN_STALE_MS;
}

// One line about how fresh the numbers are. A warning when the PC has gone quiet.
function heard(view) {
  if (!view.snapshot) {
    return "⚠️ I have not heard from the twin yet. Its PC sends the numbers here only when reports are switched on (TWIN_REPORT_KEY in the twin's .env) and the twin is running.";
  }
  const age = ago(view.now - view.at);
  if (isStale(view)) {
    return `⚠️ Last heard from the twin ${age} (${clock(view.at)}). The PC is off, asleep or offline, so these numbers are old.`;
  }
  return `Last heard from the twin: ${age}.`;
}

const ONLY_SHOWS = "I only show what the twin does. I cannot buy, sell or stop it from here: that is done on the PC.";

// ---------------------------------------------------------------- messages

export function start(view) {
  return {
    html: [
      "👋 This is <b>TradeBot's twin</b>: the same rules, run by freqtrade on your PC with pretend money and real prices.",
      "",
      ONLY_SHOWS,
      "",
      "/status the account and open trades",
      "/profit the result so far",
      "/trades the last closed trades",
      "/help how this works",
      "",
      heard(view),
    ].join("\n"),
  };
}

export function help(view) {
  return {
    html: [
      "<b>How this bot works</b>",
      "",
      "The twin runs on your PC. With reports switched on, it sends its numbers to TradeBot's server once a minute over HTTPS, and I answer you from there. The PC itself never talks to Telegram.",
      "",
      ONLY_SHOWS,
      "When the PC is off or asleep I keep the last numbers and tell you how old they are.",
      "",
      "/status the account and open trades",
      "/profit the result so far",
      "/trades the last closed trades",
      "",
      heard(view),
    ].join("\n"),
  };
}

function openLine(snapshot, trade) {
  const parts = [`• <b>${coinOf(trade.pair)}</b>`, `bought ${clock(trade.openedAt)} at ${quote(snapshot, trade.openRate)}`];
  if (trade.rate) parts.push(`now ${quote(snapshot, trade.rate)}`);
  parts.push(`${signedCash(snapshot, trade.profit)} (${pct(trade.profitPct)})`);
  return parts.join(" · ");
}

function closedLine(snapshot, trade) {
  const mark = trade.profit > 0 ? "🟢" : trade.profit < 0 ? "🔴" : "⚪";
  const parts = [`${mark} ${coinOf(trade.pair)} ${signedCash(snapshot, trade.profit)} (${pct(trade.profitPct)})`];
  if (trade.closedAt) parts.push(`sold ${clock(trade.closedAt)}`);
  if (trade.reason) parts.push(reasonOf(trade.reason));
  return parts.join(" · ");
}

export function status(view) {
  const { snapshot } = view;
  if (!snapshot) return { html: heard(view) };
  const lines = [`<b>Twin (freqtrade)</b> · ${moneyKind(snapshot)}`];
  if (snapshot.state && snapshot.state !== "running") lines.push(`⚠️ The twin is <b>${escapeHtml(snapshot.state)}</b>, not trading.`);
  lines.push(
    "",
    `Value: <b>${cash(snapshot, snapshot.balance.total)}</b> (started with ${cash(snapshot, snapshot.balance.start)})`,
    `Free to use: ${cash(snapshot, snapshot.balance.free)}`,
    `Profit so far: ${signedCash(snapshot, snapshot.profit.all)} (${pct(snapshot.profit.allPct, 2)})`,
    "",
  );
  if (snapshot.open.length) {
    lines.push(`<b>Open trades</b>: ${snapshot.open.length} of ${snapshot.maxOpen || "?"}`);
    lines.push(...snapshot.open.map((trade) => openLine(snapshot, trade)));
  } else {
    lines.push("Holding nothing right now. It buys only when its 3 checks pass, so days without a trade are normal.");
  }
  const rules = [snapshot.strategy, snapshot.timeframe && `${snapshot.timeframe} candles`, snapshot.exchange && `prices from ${snapshot.exchange}`]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
  lines.push("", rules, heard(view));
  return { html: lines.join("\n") };
}

export function profit(view) {
  const { snapshot } = view;
  if (!snapshot) return { html: heard(view) };
  const result = snapshot.profit;
  const lines = [
    `<b>Twin result</b> · ${moneyKind(snapshot)}`,
    "",
    `All trades, open ones at today's price: <b>${signedCash(snapshot, result.all)}</b> (${pct(result.allPct, 2)})`,
    `Closed trades only: ${signedCash(snapshot, result.closed)}`,
  ];
  if (result.closedTrades) {
    const share = Math.round((result.wins / result.closedTrades) * 100);
    lines.push(`Closed trades: ${result.closedTrades}, ${result.wins} won and ${result.losses} lost (${share}% won)`);
    lines.push("Losing trades are part of these rules. What counts is the total, not each trade.");
  } else {
    lines.push("No trade has closed yet.");
  }
  lines.push("", heard(view));
  return { html: lines.join("\n") };
}

export function trades(view) {
  const { snapshot } = view;
  if (!snapshot) return { html: heard(view) };
  const lines = ["<b>Twin: last closed trades</b>", ""];
  if (snapshot.closed.length) lines.push(...snapshot.closed.map((trade) => closedLine(snapshot, trade)));
  else lines.push("No trade has closed yet.");
  lines.push("", heard(view));
  return { html: lines.join("\n") };
}

// "/status", "/status@some_bot extra" -> "status". Anything that is not a command -> "".
export function commandOf(text) {
  const match = String(text || "").trim().match(/^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i);
  return match ? match[1].toLowerCase() : "";
}

// The answer to one message from the owner.
export function answer(text, view) {
  const command = commandOf(text);
  if (command === "start") return start(view);
  if (command === "help") return help(view);
  if (command === "status" || command === "balance") return status(view);
  if (command === "profit" || command === "daily") return profit(view);
  if (command === "trades" || command === "history") return trades(view);
  return { html: ["I know /status, /profit, /trades and /help.", ONLY_SHOWS].join("\n") };
}

// ---------------------------------------------------------------- what changed between two reports

// Messages for trades that opened or closed since the last report. The first report says nothing:
// there is nothing to compare it with, and old trades are not news.
export function changes(previous, next) {
  if (!previous || !next) return [];
  const before = new Map(previous.open.map((trade) => [trade.id, trade]));
  const after = new Map(next.open.map((trade) => [trade.id, trade]));
  const messages = [];
  for (const trade of next.open) {
    if (before.has(trade.id)) continue;
    messages.push({
      html: [
        `🟢 <b>Twin bought ${coinOf(trade.pair)}</b> · ${moneyKind(next)}`,
        `${cash(next, trade.stake)} at ${quote(next, trade.openRate)}`,
        `Open trades: ${next.open.length} of ${next.maxOpen || "?"}`,
      ].join("\n"),
    });
  }
  for (const trade of previous.open) {
    if (after.has(trade.id)) continue;
    const closed = next.closed.find((item) => item.id === trade.id);
    const lines = [`🔴 <b>Twin sold ${coinOf(trade.pair)}</b> · ${moneyKind(next)}`];
    if (closed) {
      const why = reasonOf(closed.reason);
      lines.push(`Result: <b>${signedCash(next, closed.profit)}</b> (${pct(closed.profitPct)})${why ? ` · ${why}` : ""}`);
    } else {
      lines.push("The trade is closed. /trades shows the result.");
    }
    lines.push(`Profit so far: ${signedCash(next, next.profit.all)}`);
    messages.push({ html: lines.join("\n") });
  }
  return messages;
}
