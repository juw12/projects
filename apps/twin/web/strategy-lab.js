/* Twin Strategy Lab: deterministic educational evaluation, NOT an AI adviser.
 * Pure engine: no network, storage, broker calls or dependency on the DOM.
 * A signal at one close can execute only at the FOLLOWING close.
 */
"use strict";

const TwinLab = (() => {
  const VERSION = "1.0.0";
  const PERIODS = Object.freeze([10, 20, 50]);

  function finite(value, label, low, high) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) {
      throw new Error(`${label} must be a finite number between ${low} and ${high}.`);
    }
    return value;
  }

  function validate(points) {
    if (!Array.isArray(points) || points.length < 2 || points.length > 10000) {
      throw new Error("Provide 2 to 10,000 daily observations.");
    }
    let previous = 0;
    const gaps = [];
    const clean = points.map((point) => {
      if (!Array.isArray(point) || point.length !== 2) {
        throw new Error("Each observation must contain a timestamp and a close.");
      }
      const stamp = finite(point[0], "Timestamp", 1, 4102444800);
      const close = finite(point[1], "Close", 1e-8, 1e9);
      if (stamp <= previous) {
        throw new Error("Observations must be strictly chronological, with no duplicates.");
      }
      if (previous && (stamp - previous < 20 * 3600 || stamp - previous > 14 * 86400)) {
        throw new Error("Expected daily observations; intraday data or a gap over 14 days is unsupported.");
      }
      if (previous) {
        gaps.push(stamp - previous);
      }
      previous = stamp;
      return [stamp, close];
    });
    gaps.sort((a, b) => a - b);
    if (gaps[Math.floor(gaps.length / 2)] > 4 * 86400) {
      throw new Error("Expected daily observations; weekly history is unsupported.");
    }
    return clean;
  }

  function settings(options) {
    return {
      feeBps: finite(options.feeBps ?? 5, "Fee per side (bps)", 0, 100),
      slippageBps: finite(options.slippageBps ?? 5, "Slippage per side (bps)", 0, 100),
    };
  }

  function simulateUnchecked(points, start, end, period, costs, buyHold = false) {
    const fee = costs.feeBps / 10000;
    const slip = costs.slippageBps / 10000;
    let cash = 1;
    let shares = 0;
    let peak = 1;
    let maxDrawdown = 0;
    let exposedIntervals = 0;
    const trades = [];
    const equity = [];
    for (let index = start; index <= end; index += 1) {
      const [stamp, close] = points[index];
      if (index > start && shares > 0) {
        exposedIntervals += 1;
      }
      let wantLong = buyHold;
      if (!buyHold) {
        let sum = 0;
        for (let past = index - period; past < index; past += 1) {
          sum += points[past][1];
        }
        wantLong = points[index - 1][1] > sum / period;
      }
      // Close the experiment at its final mark, including exit costs. No new final-bar entry.
      if (index === end) {
        wantLong = false;
      }
      if (wantLong && shares === 0) {
        const fill = close * (1 + slip);
        shares = cash / (fill * (1 + fee));
        cash = 0;
        trades.push({ side: "buy", signalTime: points[index - 1][0], time: stamp, fill, shares });
      } else if (!wantLong && shares > 0) {
        const fill = close * (1 - slip);
        cash = shares * fill * (1 - fee);
        trades.push({
          side: "sell", signalTime: index === end ? null : points[index - 1][0],
          time: stamp, fill, shares, reason: index === end ? "end-of-test liquidation" : "signal",
        });
        shares = 0;
      }
      const value = cash + shares * close;
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("Numerical overflow or underflow; cannot reliably simulate this history.");
      }
      peak = Math.max(peak, value);
      maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
      equity.push([stamp, value]);
    }
    return {
      returnPct: 100 * (cash - 1), maxDrawdownPct: 100 * maxDrawdown,
      roundTrips: trades.filter((trade) => trade.side === "sell").length,
      exposurePct: 100 * exposedIntervals / (end - start), trades, equity,
    };
  }

  function simulate(input, start, end, period, options = {}) {
    const points = validate(input);
    if (!Number.isInteger(period) || period < 2 || !Number.isInteger(start) ||
        !Number.isInteger(end) || start < period || end <= start || end >= points.length) {
      throw new Error("Invalid period or simulation bounds.");
    }
    return simulateUnchecked(points, start, end, period, settings(options), options.buyHold === true);
  }

  function evaluate(input, options = {}) {
    const asOf = finite(options.asOf ?? Date.now() / 1000, "As-of timestamp", 1, 4102444800);
    const points = validate(input).filter((point) => point[0] <= asOf);
    if (points.length < 120) {
      throw new Error("Strategy Lab needs at least 120 daily observations before the as-of date.");
    }
    const costs = settings(options);
    const trainFraction = finite(options.trainFraction ?? 0.6, "Training fraction", 0.5, 0.75);
    const split = Math.floor(points.length * trainFraction);
    const warmup = Math.max(...PERIODS);
    if (split - warmup < 20 || points.length - split < 30) {
      throw new Error("Not enough observations for separate training and holdout windows.");
    }
    // All candidates receive exactly the same training window; holdout never picks a period.
    const candidates = PERIODS.map((period) => {
      const result = simulateUnchecked(points, warmup, split - 1, period, costs);
      return { period, returnPct: result.returnPct, maxDrawdownPct: result.maxDrawdownPct };
    });
    candidates.sort((a, b) => b.returnPct - a.returnPct || a.period - b.period);
    const selectedPeriod = candidates[0].period;
    const strategy = simulateUnchecked(points, split, points.length - 1, selectedPeriod, costs);
    const benchmark = simulateUnchecked(points, split, points.length - 1, selectedPeriod, costs, true);
    const warnings = [
      "Educational single holdout, not a forecast, recommendation, or proof of an investment edge.",
      "Choosing another ticker, split or cost after reading the result reuses the holdout and can overfit.",
      "Close-price simulation only: no dividends, tax, cash interest, FX returns, liquidity limits or partial fills. Corporate-action history is not independently audited.",
      "Long-or-cash model with fractional shares and full allocation. It is not your portfolio or a real broker fill model.",
      "Missing sessions of up to 14 days are not repaired; a signal executes at the next available observation.",
    ];
    if (points.length - split < 100) {
      warnings.push("Fewer than 100 holdout observations; the sample is particularly limited.");
    }
    if (strategy.roundTrips < 5) {
      warnings.push("Fewer than five completed strategy trades; do not infer a reliable success rate.");
    }
    return {
      engineVersion: VERSION, method: "chronological-holdout-next-close", selectedPeriod,
      settings: { ...costs, trainFraction, asOf },
      data: { points, count: points.length, start: points[0][0], end: points.at(-1)[0] },
      training: { start: points[warmup][0], end: points[split - 1][0], candidates },
      holdout: { start: points[split][0], end: points.at(-1)[0], count: points.length - split },
      strategy, benchmark, excessReturnPp: strategy.returnPct - benchmark.returnPct, warnings,
    };
  }

  return Object.freeze({ VERSION, PERIODS, simulate, evaluate });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = TwinLab;
}
