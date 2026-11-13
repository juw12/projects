// Replay the trading rules over past candles and compare them with simply holding the coin.
//
// No peeking: a decision uses candles up to a close and is filled at the NEXT candle's open.
// A stop is filled inside the candle that touches it (at the open when the price gapped past it).
// Fees and slippage are the practice account's.

import { COSTS, buy, equity, newPortfolio, sell } from "./paper.js";
import { PARAMS, computeSeries, decideAt, sizeOrder } from "./strategy.js";

export function backtest(candles, options = {}) {
  const params = options.params || PARAMS;
  const riskPct = options.riskPct || 1;
  const maxPositionPct = options.maxPositionPct || 25;
  const costs = options.costs || COSTS;
  const symbol = "X";
  const first = params.regime; // the first candle with every indicator ready
  if (candles.length < first + 30) return null;

  const series = computeSeries(candles, params);
  const portfolio = newPortfolio(10000);
  const trades = [];
  let order = null; // what the last close decided, to be filled at this candle's open
  let lastExit = null;
  let peak = portfolio.cash;
  let worstDrop = 0;

  for (let index = first; index < candles.length; index++) {
    const candle = candles[index];
    if (order && order.action === "buy" && !portfolio.positions[symbol]) {
      const usd = sizeOrder({
        equity: equity(portfolio),
        cash: portfolio.cash,
        price: candle.o,
        stop: order.stop,
        riskPct,
        maxPositionPct,
      });
      if (usd) buy(portfolio, symbol, usd, candle.o, order.stop, candle.t, costs);
    } else if (order && order.action === "sell" && portfolio.positions[symbol]) {
      trades.push(sell(portfolio, symbol, candle.o, order.why, candle.t, costs));
      lastExit = index;
    }
    order = null;

    const held = portfolio.positions[symbol];
    if (held && candle.l <= held.stop) {
      trades.push(sell(portfolio, symbol, Math.min(candle.o, held.stop), "stop", candle.t, costs));
      lastExit = index;
    }

    const position = portfolio.positions[symbol] || null;
    const decision = decideAt(series, index, { position, barsSinceExit: lastExit === null ? null : index - lastExit }, params);
    if (position && decision.stop) position.stop = decision.stop;
    if (decision.action !== "hold") order = decision;

    const value = equity(portfolio, { [symbol]: candle.c });
    peak = Math.max(peak, value);
    worstDrop = Math.max(worstDrop, (peak - value) / peak);
  }

  const lastClose = candles[candles.length - 1].c;
  const finalValue = equity(portfolio, { [symbol]: lastClose });
  const wins = trades.filter((trade) => trade.pnl > 0).length;
  // Holding instead: bought at the same first candle, paying the same costs once.
  const holdValue = ((10000 * (1 - costs.fee)) / (candles[first].o * (1 + costs.slippage))) * lastClose;
  let holdPeak = 0;
  let holdWorstDrop = 0;
  for (let index = first; index < candles.length; index++) {
    holdPeak = Math.max(holdPeak, candles[index].c);
    holdWorstDrop = Math.max(holdWorstDrop, (holdPeak - candles[index].c) / holdPeak);
  }
  return {
    candles: candles.length - first,
    from: candles[first].t,
    to: candles[candles.length - 1].t,
    returnPct: (finalValue / 10000 - 1) * 100,
    holdPct: (holdValue / 10000 - 1) * 100,
    worstDropPct: worstDrop * 100,
    holdWorstDropPct: holdWorstDrop * 100,
    trades: trades.length,
    wins,
    open: !!portfolio.positions[symbol],
  };
}
