// The practice account: pretend money, real prices. Every fill pays a fee and a little slippage,
// so the results are not rosier than a real exchange would give.

export const COSTS = { fee: 0.001, slippage: 0.0005 }; // 0.10% fee, 0.05% slippage per fill

export function newPortfolio(cash = 10000) {
  return { start: cash, cash, positions: {}, realized: 0 };
}

// Spend `usd` on `symbol` at `price`. Returns the trade, or throws when it cannot be done.
export function buy(portfolio, symbol, usd, price, stop, at, costs = COSTS) {
  if (portfolio.positions[symbol]) throw new Error(`Already holding ${symbol}.`);
  if (!(usd > 0) || usd > portfolio.cash + 1e-9) throw new Error("Not enough cash for that.");
  const fill = price * (1 + costs.slippage);
  const qty = (usd * (1 - costs.fee)) / fill;
  portfolio.cash -= usd;
  portfolio.positions[symbol] = { qty, entry: fill, cost: usd, stop: stop || 0, openedAt: at };
  return { side: "buy", symbol, qty, price: fill, usd, at };
}

// Sell the whole position in `symbol` at `price`.
export function sell(portfolio, symbol, price, why, at, costs = COSTS) {
  const position = portfolio.positions[symbol];
  if (!position) throw new Error(`Not holding ${symbol}.`);
  const fill = price * (1 - costs.slippage);
  const usd = position.qty * fill * (1 - costs.fee);
  const pnl = usd - position.cost;
  portfolio.cash += usd;
  portfolio.realized += pnl;
  delete portfolio.positions[symbol];
  return { side: "sell", symbol, qty: position.qty, price: fill, usd, pnl, pnlPct: (pnl / position.cost) * 100, why, at };
}

// Cash plus every position at its latest price (the entry price when no price is known).
export function equity(portfolio, prices = {}) {
  let total = portfolio.cash;
  for (const [symbol, position] of Object.entries(portfolio.positions)) {
    total += position.qty * (prices[symbol] || position.entry);
  }
  return total;
}
