// Every message the bot writes, as Telegram HTML in plain words.

import { escapeHtml } from "./util.js";

const WIB_MS = 7 * 60 * 60 * 1000; // times are shown in WIB (UTC+7)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function coin(symbol) {
  return String(symbol).replace(/USDT$/, "");
}

export function money(value) {
  const text = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (value < 0 ? "-$" : "$") + text;
}

export function signedMoney(value) {
  return (value >= 0 ? "+" : "-") + money(Math.abs(value));
}

export function price(value) {
  const digits = value >= 100 ? 2 : value >= 1 ? 4 : 6;
  return "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
}

export function pct(value, digits = 1) {
  return (value >= 0 ? "+" : "") + value.toFixed(digits) + "%";
}

export function day(ms) {
  const date = new Date(ms + WIB_MS);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function clock(ms) {
  const date = new Date(ms + WIB_MS);
  const two = (value) => String(value).padStart(2, "0");
  return `${day(ms)} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())} WIB`;
}

function stopLine(entryPrice, stop) {
  return `Stop: ${price(stop)} (${pct((stop / entryPrice - 1) * 100)})`;
}

export function bought(trade) {
  return {
    html: [
      `🟢 <b>Bought ${coin(trade.symbol)}</b> · practice money`,
      `${money(trade.usd)} at ${price(trade.price)}`,
      stopLine(trade.price, trade.stop),
      `Why: ${escapeHtml(trade.why)}`,
    ].join("\n"),
  };
}

export function sold(trade) {
  const mark = trade.pnl >= 0 ? "✅" : "🔴";
  return {
    html: [
      `${mark} <b>Sold ${coin(trade.symbol)}</b> · ${signedMoney(trade.pnl)} (${pct(trade.pnlPct)})`,
      `at ${price(trade.price)}`,
      `Why: ${escapeHtml(trade.why)}`,
    ].join("\n"),
  };
}

export function proposal(symbol, offer, usd) {
  return {
    html: [
      `🟡 <b>Buy ${coin(symbol)}?</b> · practice money`,
      `About ${money(usd)} at ${price(offer.price)}`,
      stopLine(offer.price, offer.stop),
      `Why: ${escapeHtml(offer.why)}`,
    ].join("\n"),
    buttons: [
      [
        { text: "✅ Approve", data: `ok:${symbol}` },
        { text: "❌ Skip", data: `no:${symbol}` },
      ],
    ],
  };
}

function modeLine(settings) {
  const mode = settings.paused ? "paused (no new buys)" : settings.auto ? "trading alone" : "asks before buying";
  return `Agent: ${mode} · ${settings.timeframe} candles · risk ${settings.riskPct}% per trade`;
}

// view = { value, prices } from the agent.
export function status(state, view) {
  const { portfolio, settings } = state;
  const total = (view.value / portfolio.start - 1) * 100;
  const lines = [
    "💼 <b>Practice account</b> (pretend money, real prices)",
    `Value: <b>${money(view.value)}</b> (${pct(total)} since start)`,
    `Cash: ${money(portfolio.cash)}`,
  ];
  if (state.day) {
    const change = view.value - state.day.start;
    lines.push(`Today: ${signedMoney(change)} (${pct((change / state.day.start) * 100)})`);
  }
  lines.push("");
  const held = Object.entries(portfolio.positions);
  if (!held.length) lines.push("Holding nothing right now.");
  for (const [symbol, position] of held) {
    const now = view.prices[symbol] || position.entry;
    const worth = position.qty * now;
    lines.push(
      `• <b>${coin(symbol)}</b> ${money(worth)} (${pct((worth / position.cost - 1) * 100)})`,
      `   in ${price(position.entry)} · now ${price(now)} · stop ${price(position.stop)}`,
    );
  }
  lines.push("", modeLine(settings), `Watching: ${settings.watchlist.map(coin).join(", ") || "nothing"}`);
  if (state.day && state.day.halted) lines.push(`⛔ Loss limit of ${settings.dailyLossPct}% reached: no new buys until tomorrow.`);
  if (state.lastTick) {
    lines.push(`Last check: ${clock(state.lastTick.at)}`);
    if (state.lastTick.errors.length) lines.push(`⚠️ ${escapeHtml(state.lastTick.errors.join("; "))}`);
  }
  return { html: lines.join("\n") };
}

// rows = [{ symbol, price, decision, held, blocked } | { symbol, error }]
export function signals(rows, settings) {
  const lines = [`📡 <b>Signals</b> · ${settings.timeframe} candles`];
  for (const row of rows) {
    lines.push("");
    if (row.error) {
      lines.push(`<b>${coin(row.symbol)}</b>: ⚠️ ${escapeHtml(row.error)}`);
      continue;
    }
    const action = row.held ? (row.decision.action === "sell" ? "SELL" : "HOLD") : row.decision.action === "buy" ? "BUY" : "WAIT";
    lines.push(`<b>${coin(row.symbol)}</b> ${price(row.price)}: <b>${action}</b>`);
    for (const reason of row.decision.reasons) lines.push(`${reason.ok ? "✅" : "❌"} ${reason.name}: ${escapeHtml(reason.text)}`);
    let note = row.decision.why;
    if (action === "BUY" && row.blocked) note += `, but not buying: ${row.blocked}`;
    lines.push(`→ ${escapeHtml(note)}`);
  }
  return { html: lines.join("\n") };
}

export function history(trades) {
  const closed = trades.filter((trade) => trade.side === "sell");
  if (!closed.length) return { html: "No closed trades yet." };
  const wins = closed.filter((trade) => trade.pnl > 0).length;
  const total = closed.reduce((sum, trade) => sum + trade.pnl, 0);
  const lines = [`📒 <b>Closed trades</b>: ${closed.length}, ${wins} won, ${signedMoney(total)} in all`, ""];
  for (const trade of closed.slice(-10).reverse()) {
    lines.push(`${trade.pnl >= 0 ? "✅" : "🔴"} ${coin(trade.symbol)} ${signedMoney(trade.pnl)} (${pct(trade.pnlPct)}) · ${day(trade.at)} · ${escapeHtml(trade.why)}`);
  }
  return { html: lines.join("\n") };
}

// rows = [{ symbol, source, result } | { symbol, error }], result from backtest().
export function backtests(rows, timeframe) {
  const lines = [`🧪 <b>Backtest</b> · ${timeframe} candles · same rules, fees included`];
  for (const row of rows) {
    lines.push("");
    if (row.error || !row.result) {
      lines.push(`<b>${coin(row.symbol)}</b>: ${escapeHtml(row.error || "not enough history")}`);
      continue;
    }
    const result = row.result;
    const days = Math.round((result.to - result.from) / 86400000);
    lines.push(
      `<b>${coin(row.symbol)}</b> · last ${days} days (${row.source})`,
      `Bot:  ${pct(result.returnPct)} · worst drop ${pct(-result.worstDropPct)}`,
      `Hold: ${pct(result.holdPct)} · worst drop ${pct(-result.holdWorstDropPct)}`,
      `Trades: ${result.trades}, ${result.wins} won`,
    );
  }
  lines.push("", "<i>The past does not promise the future.</i>");
  return { html: lines.join("\n") };
}

export function summary(state, value, dayStartedAt) {
  const { portfolio } = state;
  const held = Object.keys(portfolio.positions).map(coin).join(", ") || "nothing";
  return {
    html: [
      `🗓 <b>Daily summary</b> · ${day(dayStartedAt)}`,
      `Value: <b>${money(value)}</b> · day ${pct((value / state.day.start - 1) * 100, 2)} · total ${pct((value / portfolio.start - 1) * 100, 2)}`,
      `Trades: ${state.day.trades} · Holding: ${held}`,
    ].join("\n"),
  };
}

export function help(settings) {
  return {
    html: [
      "🤖 <b>TradeBot</b>: a trading agent on practice money and real prices.",
      "",
      "Every 5 minutes I check the markets. I buy when the trend, momentum and RSI agree, protect every trade with a trailing stop, and tell you here.",
      "",
      "/status account, positions, profit",
      "/signals what I see in each market",
      "/buy BTC 500 · /sell BTC · /sell all",
      "/watch DOGE · /unwatch DOGE · /watchlist",
      "/auto on|off trade alone, or ask you first",
      "/pause · /resume new buys",
      "/risk 1 percent of the account risked per trade",
      "/timeframe 15m | 1h | 4h | 1d",
      "/backtest BTC the rules on past prices",
      "/history closed trades",
      "/reset 10000 start over",
      "",
      modeLine(settings),
      "<i>Practice only. Not financial advice.</i>",
    ].join("\n"),
  };
}
