// Every message the bot writes, as Telegram HTML in plain words.
// Rule of the house: a message says what happened, what it costs and what comes next.

import { TIMEFRAMES } from "./market.js";
import { COSTS } from "./paper.js";
import { PARAMS } from "./strategy.js";
import { deskRecord } from "./desk.js";
import { escapeHtml } from "./util.js";

const WIB_MS = 7 * 60 * 60 * 1000; // times are shown in WIB (UTC+7)
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHECK = "5-minute"; // how often the agent reads prices (agent.js TICK_MS)
const SMALL_PRINT = "<i>Practice only. Not financial advice.</i>";

// ---------------------------------------------------------------- words and numbers

export function coin(symbol) {
  return String(symbol).replace(/USDT$/, "");
}

export function money(value) {
  const cents = Math.round(Math.abs(value) * 100) / 100;
  const text = cents.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (value < 0 && cents > 0 ? "-$" : "$") + text;
}

export function signedMoney(value) {
  const cents = Math.round(Math.abs(value) * 100) / 100;
  if (!cents) return "$0.00";
  return (value > 0 ? "+" : "-") + money(cents);
}

export function price(value) {
  const digits = value >= 100 ? 2 : value >= 1 ? 4 : 6;
  return "$" + value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// A change in percent, with its sign: "+1.2%", "-0.4%", "0.0%".
export function pct(value, digits = 1) {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return `${text}%`;
  return (value > 0 ? "+" : "-") + text + "%";
}

// A share in percent, without a sign: "25%", "2.5%".
function share(value) {
  return Math.abs(value).toFixed(1).replace(/\.0$/, "") + "%";
}

// A small cost in percent, kept exact: "0.1%", "0.05%".
function cost(value) {
  return String(Number((value * 100).toFixed(3))) + "%";
}

function list(items) {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const two = (value) => String(value).padStart(2, "0");

export function day(ms) {
  const date = new Date(ms + WIB_MS);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function hour(ms) {
  const date = new Date(ms + WIB_MS);
  return `${two(date.getUTCHours())}:${two(date.getUTCMinutes())} WIB`;
}

export function clock(ms) {
  return `${day(ms)} ${hour(ms)}`;
}

// The time alone when it is today, with the date otherwise.
function when(ms, now) {
  return day(ms) === day(now) ? hour(ms) : clock(ms);
}

function span(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 120) return plural(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return plural(hours, "hour");
  return plural(Math.round(hours / 24), "day");
}

// When the candle that is forming now closes: that is when the agent judges a coin again.
export function nextClose(timeframe, now) {
  const length = TIMEFRAMES[timeframe].ms;
  return (Math.floor(now / length) + 1) * length;
}

// Dollars lost when `usd` bought at `fill` is sold at `stop`, fees and slippage included.
function lossAtStop(usd, fill, stop, costs = COSTS) {
  const qty = (usd * (1 - costs.fee)) / fill;
  return usd - qty * stop * (1 - costs.slippage) * (1 - costs.fee);
}

function known(state) {
  const prices = {};
  for (const [symbol, memo] of Object.entries(state.marks || {})) {
    if (memo.price) prices[symbol] = memo.price;
  }
  return prices;
}

export function modeLine(settings) {
  const mode = settings.paused ? "paused (no new buys)" : settings.auto ? "trading alone" : "asks before buying";
  return `Agent: ${mode} · ${settings.timeframe} candles · risk ${settings.riskPct}% per trade`;
}

// What the agent does next, in one or two sentences.
export function nextStep(state, now) {
  const { settings, portfolio } = state;
  const today = state.day;
  const lost = today ? ((today.start - accountValue(state)) / today.start) * 100 : 0;
  if (today && (today.halted || lost >= settings.dailyLossPct)) {
    return `Today's loss limit (${settings.dailyLossPct}%) is reached, so I buy nothing more until tomorrow (07:00 WIB). Stops and sell rules stay on.`;
  }
  if (settings.paused) return "Buying is paused, so I buy nothing. Stops and sell rules stay on. /resume lets me buy again.";
  const asked = Object.entries(state.pending || {});
  if (asked.length) {
    const names = list(asked.map(([symbol]) => coin(symbol)));
    const offer = asked[0][1];
    const until = asked.length === 1 && offer.until ? ` (the offer is open until ${hour(offer.until)})` : "";
    return `I am waiting for your answer on ${names}${until}. No answer means no buy.`;
  }
  const held = Object.keys(portfolio.positions).length;
  if (held >= settings.maxPositions) return `I hold ${plural(held, "coin")}, the most I hold together, so I buy nothing until one is sold.`;
  if (!settings.watchlist.length) return "The watchlist is empty, so there is nothing to buy. /watch BTC adds a coin.";
  const act = settings.auto ? "I buy it and tell you" : "I ask you first";
  return `I judge each coin when the ${settings.timeframe} candle closes at ${hour(nextClose(settings.timeframe, now))}; if all 3 checks pass, ${act}.`;
}

function accountValue(state) {
  const prices = known(state);
  let total = state.portfolio.cash;
  for (const [symbol, position] of Object.entries(state.portfolio.positions)) {
    total += position.qty * (prices[symbol] || position.entry);
  }
  return total;
}

// A price failure in plain words. error.kind comes from market.js and agent.js.
export function noPrice(error, name) {
  const kind = error && error.kind;
  if (kind === "unknown") {
    return `I cannot find a ${name}/USDT market on any of my price sources. Check the spelling: I read coins priced in US dollars (USDT), like BTC, ETH or DOGE.`;
  }
  if (kind === "unreachable") return `None of my price sources is answering right now, so I have no ${name} price. Try again in a few minutes.`;
  if (kind === "stale") return `The newest ${name} price I can get is too old to trade on. Try again in a few minutes.`;
  return `I could not get a ${name} price just now. Try again in a few minutes.`;
}

// ---------------------------------------------------------------- buys and sells

// Why the trade has the size it has. `account` is the account's value before the buy.
function sizeNote(usd, fill, stop, account, settings, by) {
  if (!(account > 0)) return "";
  const part = `${share((usd / account) * 100)} of the account`;
  if (by === "you") return ` (${part})`;
  const cap = (account * settings.maxPositionPct) / 100;
  const distance = (fill - stop) / fill;
  const byRisk = distance > 0 ? (account * settings.riskPct) / 100 / distance : cap;
  if (usd >= cap * 0.995) return ` (${part}, the most I put in one coin)`;
  if (usd < byRisk * 0.98) return ` (${part}, all the cash that was left)`;
  if (distance >= 0.08) return ` (${part}, kept small because the stop is far away)`;
  return ` (${part}, sized so a stop-out costs about ${settings.riskPct}% of the account)`;
}

function stopLine(usd, fill, stop, account, sell) {
  const loss = lossAtStop(usd, fill, stop);
  const part = account > 0 ? ` (${share((loss / account) * 100)} of the account)` : "";
  return `Stop: ${price(stop)} (${pct((stop / fill - 1) * 100)}): if the price falls to it ${sell}, losing about ${money(loss)}${part}`;
}

export function bought(trade, settings) {
  const lines = [
    `🟢 <b>Bought ${coin(trade.symbol)}</b> · practice money`,
    `${money(trade.usd)} at ${price(trade.price)}${sizeNote(trade.usd, trade.price, trade.stop, trade.account, settings, trade.by)}`,
    stopLine(trade.usd, trade.price, trade.stop, trade.account, "I sell"),
    `Why: ${escapeHtml(trade.why)}`,
  ];
  if (trade.by === "you") lines.push("I will look after it from here: the stop follows the price up, and I sell when the trend breaks.");
  lines.push(...deskLines(trade.desk));
  return { html: lines.join("\n") };
}

export function proposal(symbol, offer, usd, account, settings) {
  const fill = offer.price * (1 + COSTS.slippage);
  const lines = [
    `🟡 <b>Buy ${coin(symbol)}?</b> · practice money`,
    `About ${money(usd)} at ${price(offer.price)}${sizeNote(usd, fill, offer.stop, account, settings, "signal")}`,
    stopLine(usd, fill, offer.stop, account, "I would sell"),
    `Why: ${escapeHtml(offer.why)}`,
  ];
  if (offer.until) lines.push(`Tap by ${hour(offer.until)}. No answer means no buy.`);
  lines.push(...deskLines(offer.desk));
  return {
    html: lines.join("\n"),
    buttons: [
      [
        { text: "✅ Approve", data: `ok:${symbol}` },
        { text: "❌ Skip", data: `no:${symbol}` },
      ],
    ],
  };
}

function sellReason(trade) {
  if (trade.why === "stop hit") {
    const stop = trade.stop ? ` (${price(trade.stop)})` : "";
    return `stop hit. The price fell under my stop${stop}, so I sold at my next ${CHECK} check.`;
  }
  if (trade.why === "momentum turned down") {
    return `momentum turned down. The ${PARAMS.fast}-candle average fell below the ${PARAMS.slow}-candle average.`;
  }
  if (trade.why === "the uptrend is broken") return `the uptrend is broken. The price closed under its ${PARAMS.regime}-candle average.`;
  return `${escapeHtml(trade.why)}.`;
}

export function sold(trade, state) {
  const { settings, portfolio } = state;
  const name = coin(trade.symbol);
  const lines = [
    `${trade.pnl >= 0 ? "✅" : "🔴"} <b>Sold ${name}</b> · practice money`,
    `Result: <b>${signedMoney(trade.pnl)}</b> (${pct(trade.pnlPct)}), fees included`,
  ];
  if (trade.cost && trade.entry) lines.push(`In: ${money(trade.cost)} at ${price(trade.entry)} · Out: ${money(trade.usd)} at ${price(trade.price)}`);
  lines.push(`Why: ${sellReason(trade)}`);
  if (trade.account) lines.push(`Account: ${money(trade.account)} (${pct((trade.account / portfolio.start - 1) * 100, 2)} since the start)`);
  if (settings.watchlist.includes(trade.symbol)) {
    const wait = span(PARAMS.cooldown * TIMEFRAMES[settings.timeframe].ms);
    lines.push(`Next: I leave ${name} alone for ${wait} (${PARAMS.cooldown} candles), then may buy it again if all 3 checks pass.`);
  } else {
    lines.push(`Next: ${name} is not on the watchlist, so I will not buy it again. /watch ${name} adds it.`);
  }
  return { html: lines.join("\n") };
}

// ---------------------------------------------------------------- the desk (second opinion)

// The desk's three voices under a buy or an offer. Empty when the desk did not answer.
export function deskLines(desk) {
  if (!desk) return [];
  const verdict = desk.verdict === "take" ? "take it" : "pass on it";
  return [
    "",
    `🧑‍⚖️ <b>Desk</b> (second opinion; the 3 checks decide, not the desk): <b>${verdict}</b>, ${desk.confidence}/5 sure`,
    `🐂 Bull: ${escapeHtml(desk.bull)}`,
    `🐻 Bear: ${escapeHtml(desk.bear)}`,
    `🛡 Risk: ${escapeHtml(desk.risk)}`,
  ];
}

const deskGroup = (label, group) =>
  group.count
    ? `${label}: ${group.count} sold, ${group.wins} won, average ${pct(group.averagePct)} per trade`
    : `${label}: none sold yet`;

export function deskReport(state) {
  const on = state.settings.desk !== false;
  const record = deskRecord(state.deskLog);
  const lines = [
    `🧑‍⚖️ <b>The desk</b> is <b>${on ? "on" : "off"}</b>.`,
    "Before every buy, three voices look at the same numbers as my 3 checks: a Bull (the case for), a Bear (the case against) and a Risk manager. They say \"take it\" or \"pass on it\". The desk never decides: the 3 checks do. It is here so you can see if it would have helped.",
    "",
    `Asked so far: ${record.asked} · trades sold since: ${record.closed}`,
    deskGroup("When it said take it", record.take),
    deskGroup("When it said pass on it", record.pass),
  ];
  if (record.closed < 10) lines.push("Too few sold trades to judge the desk yet. Give it at least 10.");
  lines.push("", on ? "<code>/desk off</code> stops asking it." : "<code>/desk on</code> asks it again before every buy.");
  return { html: lines.join("\n") };
}

// ---------------------------------------------------------------- the account

// view = { value, prices, now } from the agent.
export function status(state, view) {
  const { portfolio, settings } = state;
  const now = view.now;
  const gain = view.value - portfolio.start;
  const lines = [
    "💼 <b>Practice account</b> · pretend money, real prices",
    `Value: <b>${money(view.value)}</b> (${signedMoney(gain)}, ${pct((gain / portfolio.start) * 100, 2)} since the start at ${money(portfolio.start)})`,
    `Cash: ${money(portfolio.cash)} · In coins: ${money(view.value - portfolio.cash)}`,
  ];
  if (state.day) {
    const change = view.value - state.day.start;
    lines.push(`Today (since ${when(state.day.startedAt, now)}): ${signedMoney(change)} (${pct((change / state.day.start) * 100, 2)})`);
  }
  lines.push("");
  const held = Object.entries(portfolio.positions);
  if (!held.length) lines.push("Holding nothing right now.");
  for (const [symbol, position] of held) {
    const last = view.prices[symbol] || position.entry;
    const worth = position.qty * last;
    const atStop = lossAtStop(position.cost, position.entry, position.stop);
    const outcome = atStop > 0 ? `selling there loses about ${money(atStop)}` : `selling there still makes about ${money(-atStop)}`;
    lines.push(
      `• <b>${coin(symbol)}</b> ${money(worth)} (${signedMoney(worth - position.cost)}, ${pct((worth / position.cost - 1) * 100)})`,
      `   bought at ${price(position.entry)} · now ${price(last)}`,
      `   stop ${price(position.stop)} (${share((1 - position.stop / last) * 100)} under now): ${outcome}`,
    );
  }
  lines.push("", modeLine(settings), `Watching: ${settings.watchlist.map(coin).join(", ") || "nothing"}`);
  const closed = state.trades.filter((trade) => trade.side === "sell");
  if (closed.length) {
    const wins = closed.filter((trade) => trade.pnl > 0).length;
    const total = closed.reduce((sum, trade) => sum + trade.pnl, 0);
    lines.push(`Closed: ${plural(closed.length, "trade")}, ${wins} won, ${signedMoney(total)} in all (/history)`);
  }
  lines.push(`Next: ${nextStep(state, now)}`);
  if (state.lastTick) {
    lines.push(`Last check: ${clock(state.lastTick.at)}`);
    const warning = outage(state, now);
    if (warning) lines.push("", warning);
  }
  return { html: lines.join("\n") };
}

// The last round could not read some or all prices: say what that means, never the raw error.
function outage(state, now) {
  const tick = state.lastTick;
  const missing = tick.failed || [];
  const count = tick.failed ? missing.length : tick.errors.length;
  if (!count) return "";
  if (count >= tick.symbols) {
    const since = state.lastGood ? ` since ${when(state.lastGood, now)}` : "";
    const stops = Object.keys(state.portfolio.positions).length ? " and stops are not being checked" : "";
    return `⚠️ I cannot read prices right now (no price source has answered${since}). The numbers above are the last ones I saw${stops}. I retry every 5 minutes.`;
  }
  const names = missing.length ? list(missing) : "some coins";
  return `⚠️ No fresh price for ${names} at the last check, so those numbers are the last ones I saw. I retry every 5 minutes.`;
}

// rows = [{ symbol, price, decision, held, blocked, pending, passed, judged } | { symbol, error }]
export function signals(rows, state, now) {
  const { settings } = state;
  if (rows.length && rows.every((row) => row.error && row.error.kind !== "unknown")) {
    return {
      html: "⚠️ I cannot read prices right now, so I have no signals to show. None of my price sources is answering. I retry every 5 minutes; /status shows the last numbers I saw.",
    };
  }
  const lines = [`📡 <b>Signals</b> · ${settings.timeframe} candles`];
  for (const row of rows) {
    const name = coin(row.symbol);
    lines.push("");
    if (row.error) {
      const trouble = row.error.kind === "unknown" ? "none of my price sources lists this market any more" : "no fresh price right now; I try again at my next check";
      lines.push(`<b>${name}</b>: ⚠️ ${trouble}`);
      continue;
    }
    const action = row.held ? (row.decision.action === "sell" ? "SELL" : "HOLD") : row.decision.action === "buy" ? "BUY" : "WAIT";
    lines.push(`<b>${name}</b> ${price(row.price)}: <b>${action}</b>`);
    for (const reason of row.decision.reasons) lines.push(`${reason.ok ? "✅" : "❌"} ${reason.name}: ${escapeHtml(reason.text)}`);
    lines.push(`→ ${signalNote(row, action, state, now)}`);
  }
  lines.push(
    "",
    `<i>A candle is one ${settings.timeframe} slice of the price. Trend: the price is above its ${PARAMS.regime}-candle average. Momentum: the ${PARAMS.fast}-candle average is above the ${PARAMS.slow}-candle one. RSI is a 0 to 100 gauge of how fast the price rose lately; I want ${PARAMS.rsiMin} to ${PARAMS.rsiMax}. I buy only when all 3 are ✅.</i>`,
  );
  return { html: lines.join("\n") };
}

function signalNote(row, action, state, now) {
  const { settings } = state;
  const name = coin(row.symbol);
  if (action === "HOLD") return `holding: trend and momentum are still up. Stop at ${price(row.held.stop)}.`;
  if (action === "SELL") return `${escapeHtml(row.decision.why)}: I sell at my next ${CHECK} check.`;
  if (action === "WAIT") return escapeHtml(row.decision.why);
  if (row.blocked) return `all 3 checks pass, but not buying: ${row.blocked}.`;
  if (row.pending) {
    const until = row.pending.until ? `; the offer is open until ${hour(row.pending.until)}` : "";
    return `all 3 checks pass. I asked you${until}.`;
  }
  if (row.passed) {
    const what = row.passed === "skipped" ? "you skipped my offer" : "my offer got no answer";
    return `all 3 checks pass, but ${what}, so I will not ask again until this signal goes away and comes back. /buy ${name} buys now.`;
  }
  if (!row.judged) return `all 3 checks pass: ${settings.auto ? "I buy it" : "I ask you"} at my next ${CHECK} check.`;
  const again = hour(nextClose(settings.timeframe, now));
  return `all 3 checks pass, but I act once per candle and could not buy when this one closed. I look again at ${again}. /buy ${name} buys now.`;
}

export function history(trades) {
  const closed = trades.filter((trade) => trade.side === "sell");
  if (!closed.length) {
    return { html: "📒 No closed trades yet. A trade shows up here once I have sold the coin. /status shows what I hold now." };
  }
  const wins = closed.filter((trade) => trade.pnl > 0).length;
  const total = closed.reduce((sum, trade) => sum + trade.pnl, 0);
  const shown = closed.slice(-10).reverse();
  const lines = [
    `📒 <b>Closed trades</b>: ${closed.length}, ${wins} won, ${signedMoney(total)} in all`,
    `<i>Practice money, fees included. Newest first${closed.length > shown.length ? `, the last ${shown.length}` : ""}.</i>`,
    "",
  ];
  for (const trade of shown) {
    lines.push(`${trade.pnl >= 0 ? "✅" : "🔴"} ${coin(trade.symbol)} ${signedMoney(trade.pnl)} (${pct(trade.pnlPct)}) · ${day(trade.at)} · ${escapeHtml(trade.why)}`);
  }
  return { html: lines.join("\n") };
}

// rows = [{ symbol, source, result } | { symbol, error }], result from backtest().
export function backtests(rows, timeframe) {
  if (rows.length === 1 && rows[0].error) return { html: `⚠️ No backtest: ${noPrice(rows[0].error, coin(rows[0].symbol))}` };
  const lines = [
    `🧪 <b>Backtest</b> · ${timeframe} candles · practice run on past prices`,
    "<i>What my rules would have done with $10,000 of pretend money, fees included, next to simply buying the coin and holding it.</i>",
  ];
  for (const row of rows) {
    const name = coin(row.symbol);
    lines.push("");
    if (row.error) {
      lines.push(`<b>${name}</b>: no price history right now. Try again in a few minutes.`);
      continue;
    }
    if (!row.result) {
      lines.push(`<b>${name}</b>: not enough price history for a backtest (I need about ${PARAMS.regime + 30} candles).`);
      continue;
    }
    const result = row.result;
    const days = Math.round((result.to - result.from) / DAY_MS);
    lines.push(
      `<b>${name}</b> · last ${days} days (${escapeHtml(row.source)})`,
      `Bot:  ${pct(result.returnPct)} · worst drop ${pct(-result.worstDropPct)}`,
      `Hold: ${pct(result.holdPct)} · worst drop ${pct(-result.holdWorstDropPct)}`,
      `Trades: ${result.trades}, ${result.wins} won`,
      `Reading: ${reading(result)}`,
    );
  }
  lines.push("", "<i>Worst drop: the biggest fall from a high point on the way. The past does not promise the future.</i>");
  return { html: lines.join("\n") };
}

function reading(result) {
  if (!result.trades) return "the bot never traded here, so there is nothing to compare.";
  const gap = result.returnPct - result.holdPct;
  const versus = Math.abs(gap) < 0.05 ? "the bot did about the same as holding" : `the bot made ${Math.abs(gap).toFixed(1)} percentage points ${gap > 0 ? "more" : "less"} than holding`;
  const drops = result.worstDropPct - result.holdWorstDropPct;
  const drop = Math.abs(drops) < 0.05 ? "the same worst drop" : `a ${drops < 0 ? "smaller" : "bigger"} worst drop`;
  const few = result.trades < 10 ? ` Only ${plural(result.trades, "trade")}: too few to prove anything.` : "";
  return `${versus}, with ${drop}.${few}`;
}

// ---------------------------------------------------------------- reports

const BOUGHT_BY = { signal: "my signal", approved: "you approved", you: "you asked" };
const OFFER_STATE = { open: "waiting for your answer", approved: "approved", skipped: "skipped", "no answer": "got no answer", withdrawn: "withdrawn" };

// The day that just ended. `ended` is its book (agent.js day); state.day is already the new one.
export function summary(state, ended, value, now) {
  const { portfolio, settings } = state;
  const prices = known(state);
  const todays = state.trades.filter((trade) => trade.at >= ended.startedAt && trade.at < now);
  const buys = todays.filter((trade) => trade.side === "buy");
  const sells = todays.filter((trade) => trade.side === "sell");
  const offers = Object.entries(ended.offers || {});
  const dayChange = value - ended.start;
  const allChange = value - portfolio.start;
  const lines = [
    `🗓 <b>Daily summary</b> · ${day(ended.startedAt)} · practice money`,
    `<i>${clock(ended.startedAt)} to ${clock(now)}</i>`,
    `Value: <b>${money(value)}</b>`,
    `Day: ${signedMoney(dayChange)} (${pct((dayChange / ended.start) * 100, 2)}) · Since the start: ${signedMoney(allChange)} (${pct((allChange / portfolio.start) * 100, 2)})`,
  ];
  if (buys.length) {
    lines.push(`Bought: ${buys.map((trade) => `${coin(trade.symbol)} ${money(trade.usd)}${BOUGHT_BY[trade.by] ? ` (${BOUGHT_BY[trade.by]})` : ""}`).join(", ")}`);
  }
  if (sells.length) lines.push(`Sold: ${sells.map((trade) => `${coin(trade.symbol)} ${signedMoney(trade.pnl)} (${escapeHtml(trade.why)})`).join(", ")}`);
  if (offers.length) lines.push(`Offers: ${offers.map(([symbol, text]) => `${coin(symbol)} ${OFFER_STATE[text] || escapeHtml(text)}`).join(", ")}`);
  const done = new Set([...buys.map((trade) => trade.symbol), ...offers.map(([symbol]) => symbol)]);
  const missed = Object.entries(ended.notTaken || {}).filter(([symbol]) => !done.has(symbol));
  if (missed.length) lines.push(`Passed all 3 checks but not bought: ${missed.map(([symbol, why]) => `${coin(symbol)} (${escapeHtml(why)})`).join(", ")}`);
  if (!buys.length && !sells.length) {
    const quiet = offers.length || missed.length ? "" : settings.paused ? ": buying is paused" : ": no watched coin passed all 3 checks, and no stop or sell rule fired";
    lines.push(`No trades today${quiet}.`);
  }
  const held = Object.entries(portfolio.positions);
  lines.push(
    held.length
      ? `Holding: ${held
          .map(([symbol, position]) => {
            const worth = position.qty * (prices[symbol] || position.entry);
            return `${coin(symbol)} ${money(worth)} (${pct((worth / position.cost - 1) * 100)}, stop ${price(position.stop)})`;
          })
          .join(", ")}`
      : "Holding: nothing",
  );
  const watched = settings.watchlist.filter((symbol) => !portfolio.positions[symbol]);
  if (watched.length) {
    lines.push("Watching:");
    for (const symbol of watched) lines.push(`• ${coin(symbol)}: ${watchNote(state, symbol)}`);
  }
  if (ended.gap > 0) lines.push(`Gap: about ${span(ended.gap)} without a price check, so stops were not checked then.`);
  lines.push(`Next: ${nextStep(state, now)}`);
  return { html: lines.join("\n") };
}

function watchNote(state, symbol) {
  const memo = (state.marks && state.marks[symbol]) || {};
  if (!memo.note) return "not judged yet";
  if (!/all 3 checks pass/.test(memo.note)) return escapeHtml(memo.note);
  if (state.pending && state.pending[symbol]) return "all 3 checks pass, waiting for your answer";
  if (memo.passed === "skipped") return "all 3 checks pass, you skipped my offer";
  if (memo.passed) return "all 3 checks pass, my offer got no answer";
  return "all 3 checks pass";
}

export function halted(state, now) {
  const { settings } = state;
  const lost = state.day.start - accountValue(state);
  return {
    html: [
      "⛔ <b>Loss limit reached</b> · practice money",
      `The account is down ${money(lost)} today (${share((lost / state.day.start) * 100)}), past my limit of ${settings.dailyLossPct}% a day.`,
      `I will not open new trades until tomorrow (07:00 WIB, in ${span(nextClose("1d", now) - now)}). Stops and sell rules stay on.`,
    ].join("\n"),
  };
}

function stopsOf(state) {
  return Object.entries(state.portfolio.positions).map(([symbol, position]) => `${coin(symbol)} (stop ${price(position.stop)})`);
}

// No price source has answered for a while.
export function blind(state, since, now) {
  const held = stopsOf(state);
  return {
    html: [
      `⚠️ I cannot read prices right now: none of my price sources has answered for ${span(now - since)} (since ${when(since, now)}).`,
      held.length ? `Until they answer I cannot check the ${held.length === 1 ? "stop" : "stops"} on ${list(held)}, so a fall would not be sold.` : "You hold no coins, so nothing is at risk.",
      "I retry every 5 minutes and will tell you when prices are back.",
    ].join("\n"),
  };
}

export function back(state, since, now) {
  const prices = known(state);
  const lines = [`✅ Prices are back${since ? ` after ${span(now - since)}` : ""}. I am checking stops and signals again.`];
  for (const [symbol, position] of Object.entries(state.portfolio.positions)) {
    const last = prices[symbol];
    if (last) lines.push(`${coin(symbol)} is at ${price(last)}, ${share((last / position.stop - 1) * 100)} above its stop (${price(position.stop)}).`);
  }
  return { html: lines.join("\n") };
}

// ---------------------------------------------------------------- help

export function welcome(state) {
  const { settings, portfolio } = state;
  const mode = settings.auto
    ? "Auto is on: I buy alone when my 3 checks pass and tell you each time. /auto off makes me ask you first."
    : "Auto is off: I ask you before every buy. /auto on lets me buy alone.";
  return {
    html: [
      "✅ You are the owner. Nobody else can use this bot.",
      "",
      `I start with <b>${money(portfolio.cash)}</b> of practice money (pretend dollars) and trade it at real prices. I cannot place real orders, so no real money is at risk.`,
      "",
      mode,
      "I check prices every 5 minutes and send a summary every day at 07:00 WIB.",
      "",
      "/status the account",
      "/signals what I see in each coin",
      "/help how I trade, and every command",
      "",
      SMALL_PRINT,
    ].join("\n"),
  };
}

export function help(settings) {
  const frame = settings.timeframe;
  return {
    html: [
      "🤖 <b>TradeBot</b>: a trading agent on practice money and real prices. I cannot place real orders, so no real money is ever at risk.",
      "",
      "<b>How I trade</b>",
      "• Every 5 minutes I read the price of each coin on the watchlist.",
      `• A candle is one ${frame} slice of the price. When a candle closes I run 3 checks:`,
      `   Trend: the price is above its ${PARAMS.regime}-candle average.`,
      `   Momentum: the ${PARAMS.fast}-candle average is above the ${PARAMS.slow}-candle average.`,
      `   RSI: a 0 to 100 gauge of how fast the price rose lately. I want ${PARAMS.rsiMin} to ${PARAMS.rsiMax}: rising, not overheated.`,
      "• All 3 pass: I buy, or ask you first when auto is off.",
      `• Size: a trade is sized so that hitting its stop costs about ${settings.riskPct}% of the account. Never more than ${settings.maxPositionPct}% of the account in one coin, and at most ${settings.maxPositions} coins together.`,
      "• Stop: every trade has a stop price under it. If the price falls to it, I sell. The stop follows the price up and never moves down. I check it every 5 minutes, so a fast fall can pass it and the loss can be bigger.",
      "• I also sell when momentum turns down or the uptrend breaks.",
      `• Desk (${settings.desk === false ? "off" : "on"}): before a buy, a Bull, a Bear and a Risk manager (an AI) give a second opinion. It never decides; /desk shows how its calls turned out.`,
      `• If the account is down ${settings.dailyLossPct}% in a day, I buy nothing more until the next day (07:00 WIB).`,
      `• Every pretend trade pays a ${cost(COSTS.fee)} fee and ${cost(COSTS.slippage)} slippage (a slightly worse price), like a real exchange would cost.`,
      "",
      "<b>Commands</b>",
      "/status the account, what I hold, profit and loss",
      "/signals the 3 checks for each coin, right now",
      "/buy BTC 500 buy $500 of BTC now (/buy BTC: I pick the size)",
      "/sell BTC sell it now (/sell all: everything)",
      "/watch DOGE · /unwatch DOGE · /watchlist",
      "/auto off I ask before every buy (/auto on: I trade alone)",
      "/pause no new buys · /resume",
      "/risk 1 percent of the account a stop-out may cost",
      "/timeframe 4h candle size: 15m, 1h, 4h or 1d",
      "/backtest BTC my rules on past prices",
      "/history closed trades",
      "/desk the second opinion and its record (/desk off: stop asking)",
      "/live real money on Tokocrypto (off, shadow or on)",
      "/reset 10000 start over with fresh practice money",
      "",
      modeLine(settings),
      SMALL_PRINT,
    ].join("\n"),
  };
}
