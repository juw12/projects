// The trading rules. Pure functions: candles in, a decision with its reasons out.
//
// A long-only trend follower for spot markets:
//   buy   when the price is above its long average (uptrend), the fast average is above the slow
//         one (momentum) and RSI says "rising, not overheated";
//   sell  when momentum or the uptrend is lost, or the trailing stop is hit;
//   size  every trade so that hitting the stop loses a fixed share of the account.
//
// The live agent and the backtest both call decideAt and sizeOrder, so a backtest tests the rules
// the bot really trades.

export const PARAMS = {
  fast: 20, // fast average (candles)
  slow: 50, // slow average
  regime: 200, // long average: only buy above it
  rsiPeriod: 14,
  rsiMin: 50,
  rsiMax: 70,
  atrPeriod: 14,
  stopAtr: 3, // the trailing stop sits this many ATRs under the close
  cooldown: 6, // candles to wait after an exit before buying the same market again
};

// Exponential moving average, started from a simple average. null until there is enough history.
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let value = 0;
  for (let index = 0; index < period; index++) value += values[index];
  value /= period;
  out[period - 1] = value;
  const weight = 2 / (period + 1);
  for (let index = period; index < values.length; index++) {
    value += (values[index] - value) * weight;
    out[index] = value;
  }
  return out;
}

// Wilder's relative strength index, 0 to 100.
export function rsi(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index++) {
    const change = closes[index] - closes[index - 1];
    if (change > 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out[period] = value();
  for (let index = period + 1; index < closes.length; index++) {
    const change = closes[index] - closes[index - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    out[index] = value();
  }
  return out;
}

// Wilder's average true range: how far the price usually moves in one candle.
export function atr(candles, period) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const range = (index) => {
    const candle = candles[index];
    const before = candles[index - 1].c;
    return Math.max(candle.h - candle.l, Math.abs(candle.h - before), Math.abs(candle.l - before));
  };
  let value = 0;
  for (let index = 1; index <= period; index++) value += range(index);
  value /= period;
  out[period] = value;
  for (let index = period + 1; index < candles.length; index++) {
    value = (value * (period - 1) + range(index)) / period;
    out[index] = value;
  }
  return out;
}

// Every indicator for every candle, computed once.
export function computeSeries(candles, params = PARAMS) {
  const closes = candles.map((candle) => candle.c);
  return {
    closes,
    fast: ema(closes, params.fast),
    slow: ema(closes, params.slow),
    regime: ema(closes, params.regime),
    rsi: rsi(closes, params.rsiPeriod),
    atr: atr(candles, params.atrPeriod),
  };
}

// The decision at closed candle `index`.
//   state = { position: { stop } | null, barsSinceExit: number | null }
// Returns { action: "buy" | "sell" | "hold", reasons: [{ name, ok, text }], stop, why }.
// `stop` is where the trailing stop belongs after this candle (it only ever moves up).
export function decideAt(series, index, state, params = PARAMS) {
  const close = series.closes[index];
  const fast = series.fast[index];
  const slow = series.slow[index];
  const regime = series.regime[index];
  const strength = series.rsi[index];
  const range = series.atr[index];
  if ([close, fast, slow, regime, strength, range].some((value) => value === null || value === undefined)) {
    return { action: "hold", reasons: [], stop: null, why: "not enough history yet" };
  }

  const trendUp = close > regime;
  const momentumUp = fast > slow;
  const rsiGood = strength >= params.rsiMin && strength <= params.rsiMax;
  const reasons = [
    { name: "Trend", ok: trendUp, text: `price ${trendUp ? "above" : "below"} the ${params.regime}-candle average` },
    { name: "Momentum", ok: momentumUp, text: `${params.fast}-candle average ${momentumUp ? "above" : "below"} the ${params.slow}-candle average` },
    {
      name: "RSI",
      ok: rsiGood,
      text: `${strength.toFixed(0)} (${
        strength > params.rsiMax
          ? `overheated: above ${params.rsiMax}`
          : strength < params.rsiMin
            ? `weak: under ${params.rsiMin}`
            : "rising, not overheated"
      })`,
    },
  ];
  const trail = close - params.stopAtr * range;
  const position = state && state.position;

  if (position) {
    const stop = Math.max(position.stop || 0, trail);
    if (!momentumUp) return { action: "sell", reasons, stop, why: "momentum turned down" };
    if (!trendUp) return { action: "sell", reasons, stop, why: "the uptrend is broken" };
    return { action: "hold", reasons, stop, why: "the trend is intact" };
  }

  const since = state ? state.barsSinceExit : null;
  if (since !== null && since !== undefined && since < params.cooldown) {
    const left = params.cooldown - since;
    return { action: "hold", reasons, stop: null, why: `cooling down after the last sale: ${left} of ${params.cooldown} candles still to wait` };
  }
  if (trendUp && momentumUp && rsiGood) {
    return { action: "buy", reasons, stop: trail, why: `uptrend, rising momentum and RSI ${strength.toFixed(0)} (not overheated): all 3 checks pass` };
  }
  const missing = reasons.filter((reason) => !reason.ok).map((reason) => (reason.name === "RSI" ? "RSI" : reason.name.toLowerCase()));
  const wanted = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}` : missing[0];
  return { action: "hold", reasons, stop: null, why: `waiting for ${wanted}` };
}

// How many dollars to put into a trade so that a stop-out loses `riskPct` of the account,
// never more than `maxPositionPct` of the account or the cash at hand. 0 means "do not trade".
export function sizeOrder({ equity, cash, price, stop, riskPct, maxPositionPct, minOrder = 10 }) {
  const distance = (price - stop) / price; // the share of the trade lost at the stop
  if (!(distance > 0) || !(equity > 0)) return 0;
  const byRisk = (equity * riskPct) / 100 / distance;
  const usd = Math.min(byRisk, (equity * maxPositionPct) / 100, cash);
  return usd >= minOrder ? Math.floor(usd * 100) / 100 : 0;
}
