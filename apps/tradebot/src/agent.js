// The agent: every few minutes it reads the markets, protects what it holds and looks for new
// trades. It changes `state` and returns the messages to send; it never talks to Telegram itself.
//
// state = {
//   settings   watchlist, timeframe, auto, paused, riskPct, maxPositionPct, maxPositions, dailyLossPct
//   portfolio  the practice account (paper.js)
//   trades     the last fills, oldest first. A buy also keeps { stop, why, by, account }, a sell
//              { entry, cost, stop, openedAt, account }; `account` is the account's value then.
//   marks      per market: { price, at, source, decided (candle already judged), lastExit,
//              note (what the last judged candle said), passed ("skipped" | "unanswered": an offer
//              the owner let go; not offered again until the signal goes away and comes back) }
//   pending    buys waiting for the owner's Approve, per market: { price, stop, why, at, until }
//   day        { key, startedAt, start (value at the start of the day), trades, halted,
//              offers (per market: open | approved | skipped | no answer | withdrawn),
//              notTaken (per market: why a passing signal was not bought), rounds, gap (ms unseen) }
//   lastTick   { at, symbols, errors, failed (coin names without a fresh price) }
//   live       real money (live.js): mode, the copies waiting to be sent, real positions, a log
//   deskLog    the desk's second opinions, newest last: { symbol, at, verdict, confidence,
//              taken (bought on it), pnlPct (once that trade is sold) }
// }

import { TIMEFRAMES, closedCandles } from "./market.js";
import { buy, equity, newPortfolio, sell } from "./paper.js";
import * as render from "./render.js";
import { MAX_DESK_LOG, convene, deskBrief } from "./desk.js";
import { newLive, noteFill } from "./live.js";
import { PARAMS, computeSeries, decideAt, sizeOrder } from "./strategy.js";
import { Problem, clip, errorText } from "./util.js";

export const TICK_MS = 5 * 60 * 1000;
export const MAX_TRADES = 100;
export const MAX_WATCH = 8;
export const BLIND_ALERT_MS = 30 * 60 * 1000;
export const MIN_ORDER = 10;

export const DEFAULT_SETTINGS = {
  watchlist: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  timeframe: "4h",
  auto: true, // trade alone; false = ask the owner before every buy
  paused: false, // true = no new buys (stops and exits still work)
  riskPct: 1, // share of the account lost when a trade hits its stop
  maxPositionPct: 25, // biggest single position, as a share of the account
  maxPositions: 3,
  dailyLossPct: 3, // no new buys for the rest of a day that is down this much
  desk: true, // ask the desk (Bull, Bear, Risk) for a second opinion on every buy; it never decides
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
    deskLog: [],
    live: newLive(), // real money (live.js): off until the owner and the Worker both switch it on
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

// Today's book, with the fields a day stored by an older version does not have yet.
function today(state) {
  const day = state.day;
  if (!day) return null;
  if (!day.offers) day.offers = {};
  if (!day.notTaken) day.notTaken = {};
  if (!day.rounds) day.rounds = 0;
  if (!day.gap) day.gap = 0;
  return day;
}

function noteOffer(state, symbol, text) {
  const day = today(state);
  if (day) day.offers[symbol] = text;
}

// One market right now: the live price, the finished candles and their indicators.
export async function look(market, symbol, timeframe, now, limit = 300) {
  const { source, candles } = await market.candles(symbol, timeframe, limit);
  const live = candles[candles.length - 1];
  if (now - live.t > 2 * TIMEFRAMES[timeframe].ms) {
    const stale = new Error("the newest price is too old to trade on");
    stale.kind = "stale";
    throw stale;
  }
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
  const held = Object.keys(portfolio.positions).length;
  if (held >= settings.maxPositions) return `I already hold ${held} coins, the most I hold together`;
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

// by = who decided: "signal" (the agent alone), "approved" (the owner said yes), "you" (/buy).
function open(state, symbol, usd, price, stop, why, now, by, desk = null) {
  const account = worth(state);
  const fill = buy(state.portfolio, symbol, usd, price, stop, now);
  noteFill(state, fill);
  delete state.pending[symbol];
  delete markOf(state, symbol).passed;
  if (desk && desk.at) {
    state.portfolio.positions[symbol].deskAt = desk.at;
    const entry = deskEntry(state, symbol, desk.at);
    if (entry) entry.taken = true;
  }
  return record(state, { ...fill, stop, why, by, account, desk });
}

function deskEntry(state, symbol, at) {
  return (state.deskLog || []).find((entry) => entry.symbol === symbol && entry.at === at) || null;
}

// The desk's second opinion on a buy the rules want, or null (desk off, no AI, slow or unclear answer).
async function askDesk(state, view, decision, ai, now) {
  if (!ai || state.settings.desk === false) return null;
  const brief = deskBrief(view.closed, view.series, view.closed.length - 1, decision.stop, state.settings.timeframe);
  const opinion = await convene(ai, brief);
  if (!opinion) return null;
  if (!state.deskLog) state.deskLog = [];
  state.deskLog.push({ symbol: view.symbol, at: now, verdict: opinion.verdict, confidence: opinion.confidence, taken: false });
  if (state.deskLog.length > MAX_DESK_LOG) state.deskLog.splice(0, state.deskLog.length - MAX_DESK_LOG);
  return { ...opinion, at: now };
}

function close(state, symbol, price, why, now) {
  const position = state.portfolio.positions[symbol];
  const fill = sell(state.portfolio, symbol, price, why, now);
  noteFill(state, fill);
  delete state.pending[symbol];
  markOf(state, symbol).lastExit = now;
  const opinion = position.deskAt ? deskEntry(state, symbol, position.deskAt) : null;
  if (opinion) opinion.pnlPct = fill.pnlPct;
  return record(state, {
    ...fill,
    entry: position.entry,
    cost: position.cost,
    stop: position.stop,
    openedAt: position.openedAt,
    account: worth(state),
  });
}

// Start the day's books; at the turn of a (UTC) day, send yesterday's summary first.
function startDay(state, now, messages) {
  const key = new Date(now).toISOString().slice(0, 10);
  if (state.day && state.day.key === key) return;
  const ended = today(state);
  const value = worth(state);
  state.day = { key, startedAt: now, start: value, trades: 0, halted: false, offers: {}, notTaken: {}, rounds: 0, gap: 0 };
  if (ended) messages.push(render.summary(state, ended, value, now));
}

// One round of the agent. Returns [{ html, buttons? }].
// `ai` is the Workers AI binding for the desk; without it the agent trades exactly the same.
export async function tick(state, { market, now, ai = null }) {
  const messages = [];
  const { settings, portfolio } = state;
  startDay(state, now, messages);
  const day = today(state);
  day.rounds += 1;
  const afterSummary = messages.length;

  const symbols = tracked(state);
  const errors = [];
  const failed = [];
  for (const symbol of symbols) {
    let view;
    try {
      view = await look(market, symbol, settings.timeframe, now);
    } catch (error) {
      errors.push(`${render.coin(symbol)}: ${clip(errorText(error), 120)}`); // for /v1/status, never for the chat
      failed.push(render.coin(symbol));
      continue;
    }
    const memo = markOf(state, symbol);
    memo.price = view.price;
    memo.at = now;
    memo.source = view.source;

    // The stop is checked on every round, at the live price.
    const position = portfolio.positions[symbol];
    if (position && position.stop && view.price <= position.stop) {
      messages.push(render.sold(close(state, symbol, view.price, "stop hit", now), state));
      continue;
    }

    // Everything else is judged once per finished candle.
    const last = view.closed[view.closed.length - 1];
    if (!last || memo.decided === last.t) continue;
    memo.decided = last.t;
    const decision = decide(state, view, now);
    if (position) {
      if (decision.action === "sell") messages.push(render.sold(close(state, symbol, view.price, decision.why, now), state));
      else if (decision.stop) position.stop = decision.stop;
      continue;
    }
    memo.note = decision.why;
    // An offer the owner did not answer ends with its candle.
    if (state.pending[symbol]) {
      delete state.pending[symbol];
      memo.passed = "unanswered";
      day.offers[symbol] = "no answer";
    }
    if (decision.action !== "buy") {
      delete memo.passed; // the signal went away: a new one may be offered again
      continue;
    }
    const reason = blocked(state);
    if (reason) {
      day.notTaken[symbol] = reason;
      continue;
    }
    const usd = orderSize(state, view.price, decision.stop);
    if (!usd) {
      day.notTaken[symbol] = "not enough cash for a trade";
      continue;
    }
    if (settings.auto) {
      const desk = await askDesk(state, view, decision, ai, now);
      messages.push(render.bought(open(state, symbol, usd, view.price, decision.stop, decision.why, now, "signal", desk), settings));
      continue;
    }
    // The owner already let this signal go: do not ask again while it lasts.
    if (memo.passed) {
      day.notTaken[symbol] = memo.passed === "skipped" ? "you skipped my offer" : "my offer got no answer";
      continue;
    }
    const desk = await askDesk(state, view, decision, ai, now);
    const offer = { price: view.price, stop: decision.stop, why: decision.why, at: now, until: render.nextClose(settings.timeframe, now), desk };
    state.pending[symbol] = offer;
    day.offers[symbol] = "open";
    messages.push(render.proposal(symbol, offer, usd, worth(state), settings));
  }

  if (!day.halted && lossToday(state) >= settings.dailyLossPct) {
    day.halted = true;
    messages.push(render.halted(state, now));
  }

  // Tell the owner once when no price can be read for a while: the stops are not watched then.
  if (symbols.length && errors.length === symbols.length) {
    const since = state.lastGood || (state.lastTick && state.lastTick.at) || now;
    if (!state.blindAlerted && now - since >= BLIND_ALERT_MS) {
      state.blindAlerted = true;
      messages.push(render.blind(state, since, now));
    }
  } else {
    if (state.lastGood && now - state.lastGood > 1.5 * TICK_MS) day.gap += now - state.lastGood;
    // "Prices are back" comes before what this round did with them.
    if (state.blindAlerted) messages.splice(afterSummary, 0, render.back(state, state.lastGood, now));
    state.blindAlerted = false;
    state.lastGood = now;
  }
  state.lastTick = { at: now, symbols: symbols.length, errors, failed };
  return messages;
}

// The owner tapped Skip on a proposed buy. Returns false when there was no open offer.
export function skip(state, symbol) {
  if (!state.pending[symbol]) return false;
  delete state.pending[symbol];
  markOf(state, symbol).passed = "skipped";
  noteOffer(state, symbol, "skipped");
  return true;
}

// The owner tapped Approve on a proposed buy. Returns the trade, or throws a Problem with the
// reason in plain words. When only the price cannot be read, the offer stays open.
export async function approve(state, symbol, { market, now }) {
  const name = render.coin(symbol);
  const offer = state.pending[symbol];
  const holding = !!state.portfolio.positions[symbol];
  const expired = `That offer has expired, so nothing was bought. If you still want ${name}, send /buy ${name}.`;
  if (!offer) {
    if (holding) throw new Problem(`Already bought: the account holds ${name}. /status shows it.`);
    if (state.marks[symbol] && state.marks[symbol].passed === "skipped") {
      throw new Problem(`You skipped this offer, so nothing was bought. To buy ${name} at the current price, send /buy ${name}.`);
    }
    throw new Problem(expired);
  }
  const withdraw = (text, mark = "withdrawn") => {
    delete state.pending[symbol];
    noteOffer(state, symbol, mark);
    return new Problem(text);
  };
  if (now - offer.at > TIMEFRAMES[state.settings.timeframe].ms || (offer.until && now >= offer.until)) throw withdraw(expired, "no answer");
  if (holding) throw withdraw(`The account already holds ${name}, so nothing more was bought. The offer is closed.`);
  const view = await look(market, symbol, state.settings.timeframe, now);
  const memo = markOf(state, symbol);
  memo.price = view.price;
  memo.at = now;
  if (view.price <= offer.stop) {
    throw withdraw(`The ${name} price already fell under the stop (${render.price(offer.stop)}), so nothing was bought. The offer is closed.`);
  }
  const reason = blocked(state);
  if (reason) throw withdraw(`Nothing was bought: ${reason}. The offer is closed.`);
  const usd = orderSize(state, view.price, offer.stop);
  if (!usd) throw withdraw("Nothing was bought: there is not enough cash for this trade. The offer is closed.");
  const trade = open(state, symbol, usd, view.price, offer.stop, offer.why, now, "approved", offer.desk || null);
  noteOffer(state, symbol, "approved");
  return trade;
}

// The owner's own buy. Without an amount the trade is sized by the risk rule.
// The agent then looks after it like any other position.
export async function manualBuy(state, symbol, usd, { market, now }) {
  const name = render.coin(symbol);
  const { cash, positions } = state.portfolio;
  if (positions[symbol]) {
    throw new Problem(`Already holding ${name} (${render.money(positions[symbol].cost)} put in), so nothing was bought. /sell ${name} sells it first.`);
  }
  if (usd && usd < MIN_ORDER) throw new Problem(`The smallest trade is $${MIN_ORDER}, so nothing was bought. Try /buy ${name} 100.`);
  if (cash < MIN_ORDER) {
    throw new Problem(`Only ${render.money(cash)} of cash is left, less than the smallest trade ($${MIN_ORDER}), so nothing was bought. /sell frees cash.`);
  }
  if (usd > cash) {
    throw new Problem(`Only ${render.money(cash)} of cash is left, so nothing was bought. The most you can buy is /buy ${name} ${Math.floor(cash)}.`);
  }
  const view = await look(market, symbol, state.settings.timeframe, now);
  const memo = markOf(state, symbol);
  memo.price = view.price;
  memo.at = now;
  const range = view.series.atr[view.closed.length - 1];
  const stop = range && view.price - PARAMS.stopAtr * range > 0 ? view.price - PARAMS.stopAtr * range : view.price * 0.9;
  const amount = usd || orderSize(state, view.price, stop);
  if (!(amount >= MIN_ORDER)) {
    throw new Problem(`By my risk rule this trade would be under the smallest size (${render.money(MIN_ORDER)}), so nothing was bought. Name the amount yourself: /buy ${name} ${render.exampleAmount()}.`);
  }
  const last = view.closed[view.closed.length - 1];
  if (last) memo.decided = last.t; // the agent first reviews it at the next finished candle
  return open(state, symbol, amount, view.price, stop, "you asked", now, "you");
}

export async function manualSell(state, symbol, { market, now }) {
  const name = render.coin(symbol);
  if (!state.portfolio.positions[symbol]) {
    const held = Object.keys(state.portfolio.positions).map(render.coin);
    throw new Problem(`Not holding ${name}, so nothing was sold. ${held.length ? `You hold: ${held.join(", ")}.` : "You hold no coins right now."}`);
  }
  const view = await look(market, symbol, state.settings.timeframe, now);
  const memo = markOf(state, symbol);
  memo.price = view.price;
  memo.at = now;
  return close(state, symbol, view.price, "you asked", now);
}
