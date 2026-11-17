// The heads-up: how near the next buy or sale is, and the earliest time it can happen.
//
// The rules judge a coin when a candle closes, on that candle's closing price (strategy.js). So
// for the candle that is forming now, every check can be turned into a price: "this check passes
// if the candle closes above X". That gives a sign before the candle closes, and how far the
// price still has to go.
//
// Nothing here orders, and nothing here guesses where the price goes. It is arithmetic on the
// numbers the rules use; test/headsup.test.js checks every level against decideAt itself. The
// "earliest" time is the first candle at which a steady move would pass the checks: a lower
// bound to plan around, not a forecast.

import { TIMEFRAMES } from "./market.js";
import { PARAMS, computeSeries, decideAt } from "./strategy.js";

export const SOON_MS = 60 * 60 * 1000; // a sign is sent in the last hour before a candle closes
export const LOOK_AHEAD = 60; // candles the estimate looks ahead (10 days of 4-hour candles)
// Steady moves tried for the estimate, in usual candle moves (ATR) per candle. A climb faster
// than one usual move at every candle is not tried: nothing climbs like that for long.
export const PACES = [0, 0.1, -0.1, 0.2, -0.2, 0.35, -0.35, 0.5, 0.75, 1];

// Wilder's average gain and loss at the last close: what rsi() carries from candle to candle.
function wilder(closes, period) {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index++) {
    const change = closes[index] - closes[index - 1];
    if (change > 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;
  for (let index = period + 1; index < closes.length; index++) {
    const change = closes[index] - closes[index - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
  }
  return { gain, loss };
}

// The closing prices at which each check turns, for the candle after `index`:
//   trend     passes when that candle closes above `trend`
//   momentum  passes when it closes above `momentum`
//   RSI       passes when it closes from `rsiMin` to `rsiMax`
// atr is the usual move of one candle. null while there is too little history.
export function levels(series, index, params = PARAMS) {
  const close = series.closes[index];
  const fast = series.fast[index];
  const slow = series.slow[index];
  const regime = series.regime[index];
  const range = series.atr[index];
  if ([close, fast, slow, regime, range, series.rsi[index]].some((value) => value === null || value === undefined)) return null;
  const strength = wilder(series.closes.slice(0, index + 1), params.rsiPeriod);
  if (!strength) return null;

  // An average moves a fixed share of the way to each new close, so "fast above slow after the
  // next close" is one straight line in that close.
  const fastStep = 2 / (params.fast + 1);
  const slowStep = 2 / (params.slow + 1);
  const momentum = (slow * (1 - slowStep) - fast * (1 - fastStep)) / (fastStep - slowStep);

  // RSI reaches `level` when average gain = ratio x average loss after the next close.
  const before = params.rsiPeriod - 1;
  const closeFor = (level) => {
    const ratio = level / (100 - level);
    const rise = before * (ratio * strength.loss - strength.gain);
    return close + (rise >= 0 ? rise : before * (strength.loss - strength.gain / ratio));
  };
  return { trend: regime, momentum, rsiMin: closeFor(params.rsiMin), rsiMax: closeFor(params.rsiMax), atr: range, close };
}

// The three checks if the forming candle closed at `price`.
export function checksAt(found, price) {
  return { trend: price > found.trend, momentum: price > found.momentum, rsi: price >= found.rsiMin && price <= found.rsiMax };
}

// The first candle at which a steady move from the price now would pass all 3 checks.
//   at = when the forming candle closes; from = no buy before this time (the wait after a sale)
// Returns { at, candles, price, pct, pace } or null when no steady move tried gets there.
export function earliest({ closed, price, at, length, from = 0, params = PARAMS }) {
  const last = closed[closed.length - 1];
  const range = computeSeries(closed, params).atr[closed.length - 1];
  if (!last || !(range > 0) || !(price > 0)) return null;
  let best = null;
  for (const pace of PACES) {
    const candles = closed.slice();
    let before = last.c;
    for (let step = 1; step <= LOOK_AHEAD; step++) {
      const close = price + step * pace * range;
      if (!(close > 0)) break;
      candles.push({ t: last.t + step * length, o: before, h: Math.max(before, close), l: Math.min(before, close), c: close, v: 0 });
      before = close;
    }
    const series = computeSeries(candles, params);
    for (let step = 1; step <= candles.length - closed.length; step++) {
      if (best && step >= best.candles) break; // an earlier candle was found with a gentler move
      const closes = at + (step - 1) * length;
      if (closes < from) continue;
      if (decideAt(series, closed.length - 1 + step, { position: null, barsSinceExit: null }, params).action !== "buy") continue;
      const reached = candles[closed.length - 1 + step].c;
      best = { at: closes, candles: step, price: reached, pct: (reached / price - 1) * 100, pace };
      break;
    }
  }
  return best;
}

// The heads-up for one coin.
//   closed, series, price: agent.look's finished candles, their indicators and the live price
//   position: the open position ({ stop }) or null; lastExit: when this coin was last sold
// Returns { kind: "buy" | "sell", level, at, ... }:
//   level  "likely"   at the price now, the buy (or the sale) happens when the candle closes
//          "near"     within one usual candle move of it
//          "far"      further than that
//          "wait"     buy only: still waiting out the candles after a sale (until `from`)
//          "unknown"  too little history
//   at     when the forming candle closes: the next time the rules judge this coin
// estimate = false leaves out the earliest time (the agent's own rounds only need the level).
export function headsUp({ closed, series, price, timeframe, now, position = null, lastExit = null, estimate = true, params = PARAMS }) {
  const length = TIMEFRAMES[timeframe].ms;
  const at = (Math.floor(now / length) + 1) * length;
  const kind = position ? "sell" : "buy";
  const index = closed.length - 1;
  const found = index >= 0 ? levels(series, index, params) : null;
  if (!found || !(price > 0)) return { kind, level: "unknown", at };
  const movePct = (found.atr / price) * 100; // the usual move of one candle, in percent of the price
  const checks = checksAt(found, price);
  const base = { kind, at, price, movePct, checks, trend: found.trend, momentum: found.momentum, rsiMin: found.rsiMin, rsiMax: found.rsiMax };

  if (position) {
    // Sold at the close when momentum or the uptrend is lost; sold at once under the stop.
    const under = Math.max(found.trend, found.momentum);
    const stop = position.stop > 0 ? position.stop : null;
    const toClose = (1 - under / price) * 100; // how far the price is above the close that sells, in percent
    const toStop = stop ? (1 - stop / price) * 100 : null;
    const why = !checks.momentum ? "momentum" : !checks.trend ? "trend" : "";
    let level = "far";
    let near = "";
    if (why) level = "likely";
    else if (toStop !== null && toStop <= movePct) [level, near] = ["near", "stop"];
    else if (toClose <= movePct) [level, near] = ["near", "close"];
    return { ...base, level, near, why, under, stop, toClose, toStop };
  }

  // A buy needs a close above the trend and momentum levels with RSI inside its band.
  const low = Math.max(found.trend, found.momentum, found.rsiMin);
  const high = found.rsiMax;
  const open = low < high; // some closing price passes all 3 checks at this candle
  const passes = checks.trend && checks.momentum && checks.rsi;
  const target = price > high && open ? high : low; // the nearest edge of that band
  const needPct = passes ? 0 : (target / price - 1) * 100;
  const from = lastExit ? Math.ceil((lastExit + params.cooldown * length) / length) * length : 0;
  let level = "far";
  if (from > at) level = "wait";
  else if (passes) level = "likely";
  else if (open && Math.abs(needPct) <= movePct) level = "near";
  const first = level === "likely" ? { at, candles: 1, price, pct: 0, pace: 0 } : estimate ? earliest({ closed, price, at, length, from, params }) : null;
  return { ...base, level, low, high, open, needPct, moves: movePct > 0 ? Math.abs(needPct) / movePct : null, from, earliest: first };
}

// The sign to send now, or "": only in the last hour before the close, once per candle and kind.
//   told = what was already sent for this coin ({ kind, at }) or null
export function signNow(soon, told, now) {
  if (!soon || soon.level !== "likely") return "";
  if (soon.at - now > SOON_MS || soon.at <= now) return "";
  if (told && told.at === soon.at && told.kind === soon.kind) return "";
  return soon.kind;
}
