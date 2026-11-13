// The agent: every few minutes it reads the markets, protects what it holds and looks for new
// trades. It changes `state` and returns the messages to send; it never talks to Telegram itself.
//
// state = {
//   settings   watchlist, timeframe, auto, paused, riskPct, maxPositionPct, maxPositions, dailyLossPct
//   portfolio  the practice account (paper.js)
//   trades     the last fills, oldest first
//   marks      per market: { price, at, source, decided (candle already judged), lastExit }
//   pending    buys waiting for the owner's Approve, per market: { price, stop, why, at }
//   day        { key, startedAt, start (value at the start of the day), trades, halted }
//   lastTick   { at, symbols, errors }
// }

import { TIMEFRAMES, closedCandles } from "./market.js";
import { buy, equity, newPortfolio, sell } from "./paper.js";
import * as render from "./render.js";
import { PARAMS, computeSeries, decideAt, sizeOrder } from "./strategy.js";
import { clip, errorText } from "./util.js";

export const TICK_MS = 5 * 60 * 1000;
export const MAX_TRADES = 100;
export const MAX_WATCH = 8;
export const BLIND_ALERT_MS = 30 * 60 * 1000;

export const DEFAULT_SETTINGS = {
  watchlist: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  timeframe: "4h",
  auto: true, // trade alone; false = ask the owner before every buy
  paused: false, // true = no new buys (stops and exits still work)
  riskPct: 1, // share of the account lost when a trade hits its stop
  maxPositionPct: 25, // biggest single position, as a share of the account
  maxPositions: 3,
  dailyLossPct: 3, // no new buys for the rest of a day that is down this much
};

export function newState(cash = 10000) {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    portfolio: newPortfolio(cash),
    trades: [],
    marks: {},
    pending: {},
    day: null,
    lastTick: null,
    lastGood: null,
    blindAlerted: false,
  };
}

// The latest known price of every market.
export function prices(state) {
  const known = {};
  for (const [symbol, memo] of Object.entries(state.marks)) {
    if (memo.price) known[symbol] = memo.price;
  }
  return known;
}

export function worth(state) {
  return equity(state.portfolio, prices(state));
}

export function tracked(state) {
  return [...new Set([...state.settings.watchlist, ...Object.keys(state.portfolio.positions)])];
}

function markOf(state, symbol) {
  if (!state.marks[symbol]) state.marks[symbol] = {};
  return state.marks[symbol];
}

// One market right now: the live price, the finished candles and their indicators.
export async function look(market, symbol, timeframe, now, limit = 300) {
  const { source, candles } = await market.candles(symbol, timeframe, limit);
  const live = candles[candles.length - 1];
  if (now - live.t > 2 * TIMEFRAMES[timeframe].ms) throw new Error("the newest price is too old to trade on");
  const closed = closedCandles(candles, timeframe, now);
  return { symbol, source, price: live.c, candles, closed, series: computeSeries(closed) };
}

// What the rules say about a market at its last finished candle.
export function decide(state, view, now) {
  const symbol = view.symbol;
  const lastExit = state.marks[symbol] && state.marks[symbol].lastExit;
  const length = TIMEFRAMES[state.settings.timeframe].ms;
  return decideAt(view.series, view.closed.length - 1, {
    position: state.portfolio.positions[symbol] || null,
    barsSinceExit: lastExit ? Math.floor((now - lastExit) / length) : null,
  });
}

export function orderSize(state, price, stop) {
  return sizeOrder({
    equity: worth(state),
    cash: state.portfolio.cash,
    price,
    stop,
    riskPct: state.settings.riskPct,
    maxPositionPct: state.settings.maxPositionPct,
  });
}

// Why the agent may not open a new position right now ("" when it may).
export function blocked(state) {
  const { settings, portfolio, day } = state;
  if (settings.paused) return "buying is paused";
  if (day && (day.halted || lossToday(state) >= settings.dailyLossPct)) return "today's loss limit is reached";
  if (Object.keys(portfolio.positions).length >= settings.maxPositions) return `already holding ${settings.maxPositions} positions`;
  return "";
}

function lossToday(state) {
  return state.day ? ((state.day.start - worth(state)) / state.day.start) * 100 : 0;
}

function record(state, trade) {
  state.trades.push(trade);
  if (state.trades.length > MAX_TRADES) state.trades.splice(0, state.trades.length - MAX_TRADES);
  if (state.day) state.day.trades += 1;
  return trade;
}

function open(state, symbol, usd, price, stop, why, now) {
  delete state.pending[symbol];
  return record(state, { ...buy(state.portfolio, symbol, usd, price, stop, now), stop, why });
}

function close(state, symbol, price, why, now) {
  delete state.pending[symbol];
  markOf(state, symbol).lastExit = now;
  return record(state, sell(state.portfolio, symbol, price, why, now));
}

// Start the day's books; at the turn of a (UTC) day, send yesterday's summary first.
function startDay(state, now, messages) {
  const key = new Date(now).toISOString().slice(0, 10);
  if (state.day && state.day.key === key) return;
  const value = worth(state);
  if (state.day) messages.push(render.summary(state, value, state.day.startedAt));
  state.day = { key, startedAt: now, start: value, trades: 0, halted: false };
}

// One round of the agent. Returns [{ html, buttons? }].
export async function tick(state, { market, now }) {
  const messages = [];
  const { settings, portfolio } = state;
  startDay(state, now, messages);

  const symbols = tracked(state);
  const errors = [];
  for (const symbol of symbols) {
    let view;
    try {
      view = await look(market, symbol, settings.timeframe, now);
    } catch (error) {
      errors.push(`${render.coin(symbol)}: ${clip(errorText(error), 120)}`);
      continue;
    }
    const memo = markOf(state, symbol);
    memo.price = view.price;
    memo.at = now;
    memo.source = view.source;

    // The stop is checked on every round, at the live price.
    const position = portfolio.positions[symbol];
    if (position && position.stop && view.price <= position.stop) {
      messages.push(render.sold(close(state, symbol, view.price, "stop hit", now)));
      continue;
    }

    // Everything else is judged once per finished candle.
    const last = view.closed[view.closed.length - 1];
    if (!last || memo.decided === last.t) continue;
    memo.decided = last.t;
    const decision = decide(state, view, now);
    if (position) {
      if (decision.action === "sell") messages.push(render.sold(close(state, symbol, view.price, decision.why, now)));
      else if (decision.stop) position.stop = decision.stop;
      continue;
    }
    delete state.pending[symbol];
    if (decision.action !== "buy" || blocked(state)) continue;
    const usd = orderSize(state, view.price, decision.stop);
    if (!usd) continue;
    if (settings.auto) {
      messages.push(render.bought(open(state, symbol, usd, view.price, decision.stop, decision.why, now)));
    } else {
      state.pending[symbol] = { price: view.price, stop: decision.stop, why: decision.why, at: now };
      messages.push(render.proposal(symbol, state.pending[symbol], usd));
    }
  }

  if (!state.day.halted && lossToday(state) >= settings.dailyLossPct) {
    state.day.halted = true;
    messages.push({ html: `⛔ Down ${settings.dailyLossPct}% today. I will not open new trades until tomorrow; stops stay on.` });
  }

  // Tell the owner once when no price can be read for a while: the stops are not watched then.
  if (symbols.length && errors.length === symbols.length) {
    const since = state.lastGood || (state.lastTick && state.lastTick.at) || now;
    if (!state.blindAlerted && now - since >= BLIND_ALERT_MS) {
      state.blindAlerted = true;
      messages.push({ html: "⚠️ I cannot read prices right now, so stops are not being checked. I keep trying every 5 minutes." });
    }
  } else {
    if (state.blindAlerted) messages.push({ html: "✅ Prices are back. I am watching the markets again." });
    state.blindAlerted = false;
    state.lastGood = now;
  }
  state.lastTick = { at: now, symbols: symbols.length, errors };
  return messages;
}

// The owner tapped Approve on a proposed buy. Returns the trade, or throws with the reason.
export async function approve(state, symbol, { market, now }) {
  const offer = state.pending[symbol];
  delete state.pending[symbol];
  if (!offer || now - offer.at > TIMEFRAMES[state.settings.timeframe].ms) throw new Error("That offer has expired.");
  if (state.portfolio.positions[symbol]) throw new Error(`Already holding ${render.coin(symbol)}.`);
  const view = await look(market, symbol, state.settings.timeframe, now);
  markOf(state, symbol).price = view.price;
  if (view.price <= offer.stop) throw new Error("The price already fell under the stop, so I did not buy.");
  const reason = blocked(state);
  if (reason) throw new Error(`Not buying: ${reason}.`);
  const usd = orderSize(state, view.price, offer.stop);
  if (!usd) throw new Error("Not enough cash for that trade.");
  return open(state, symbol, usd, view.price, offer.stop, offer.why, now);
}

// The owner's own buy. Without an amount the trade is sized by the risk rule.
// The agent then looks after it like any other position.
export async function manualBuy(state, symbol, usd, { market, now }) {
  if (state.portfolio.positions[symbol]) throw new Error(`Already holding ${render.coin(symbol)}.`);
  const view = await look(market, symbol, state.settings.timeframe, now);
  const memo = markOf(state, symbol);
  memo.price = view.price;
  memo.at = now;
  const range = view.series.atr[view.closed.length - 1];
  const stop = range && view.price - PARAMS.stopAtr * range > 0 ? view.price - PARAMS.stopAtr * range : view.price * 0.9;
  const amount = usd || orderSize(state, view.price, stop);
  if (!(amount >= 10)) throw new Error("The smallest trade is $10.");
  if (amount > state.portfolio.cash) throw new Error(`Only ${render.money(state.portfolio.cash)} of cash is left.`);
  const last = view.closed[view.closed.length - 1];
  if (last) memo.decided = last.t; // the agent first reviews it at the next finished candle
  return open(state, symbol, amount, view.price, stop, "you asked", now);
}

export async function manualSell(state, symbol, { market, now }) {
  if (!state.portfolio.positions[symbol]) throw new Error(`Not holding ${render.coin(symbol)}.`);
  const view = await look(market, symbol, state.settings.timeframe, now);
  markOf(state, symbol).price = view.price;
  return close(state, symbol, view.price, "you asked", now);
}
