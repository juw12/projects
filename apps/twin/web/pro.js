/* Twin Pro engine — orders, market replay and analytics.
 *
 * Pure functions with no DOM access, shared by the guest/demo build and the
 * local-server build and unit-tested under Node (tests/test_pro_engine.js).
 *
 * Honest model: prices are whatever the caller supplies (a delayed quote, or a
 * daily close in Replay Lab). Orders are checked only when a new price arrives;
 * fills happen at that price. No intraday highs/lows, gaps, partial fills,
 * fees or slippage are simulated.
 */
"use strict";

(function (root) {
  const EPS = 1e-9;
  const ORDER_TYPES = ["market", "limit", "stop", "stop_limit", "trailing"];
  const round2 = (x) => Math.round(x * 100) / 100;
  const round6 = (x) => Math.round(x * 1e6) / 1e6;
  let counter = 0;

  function newId() {
    counter += 1;
    return Date.now().toString(36) + "-" + counter.toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function positive(value, name) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${name} must be a positive number`);
    }
    return n;
  }

  /* ------------------------------------------------------------ indicators */
  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) {
        sum -= values[i - period];
      }
      if (i >= period - 1) {
        out[i] = sum / period;
      }
    }
    return out;
  }

  // Wilder's RSI. Returns an array aligned with values (null until enough data).
  function rsi(values, period = 14) {
    const out = new Array(values.length).fill(null);
    if (values.length <= period) {
      return out;
    }
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
      const change = values[i] - values[i - 1];
      gain += Math.max(change, 0);
      loss += Math.max(-change, 0);
    }
    gain /= period;
    loss /= period;
    out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = period + 1; i < values.length; i++) {
      const change = values[i] - values[i - 1];
      gain = (gain * (period - 1) + Math.max(change, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  // Summary statistics for an equity/price series sampled at a fixed interval.
  function seriesStats(values, periodsPerYear = 252) {
    const clean = values.filter((v) => Number.isFinite(v) && v > 0);
    if (clean.length < 2) {
      return { total_return_pct: 0, volatility_pct: null, max_drawdown_pct: 0 };
    }
    const rets = [];
    for (let i = 1; i < clean.length; i++) {
      rets.push(clean[i] / clean[i - 1] - 1);
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.length > 1
      ? rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)
      : 0;
    let peak = clean[0];
    let worst = 0;
    for (const v of clean) {
      peak = Math.max(peak, v);
      worst = Math.min(worst, v / peak - 1);
    }
    return {
      total_return_pct: round2((clean[clean.length - 1] / clean[0] - 1) * 100),
      volatility_pct: rets.length > 1 ? round2(Math.sqrt(variance) * Math.sqrt(periodsPerYear) * 100) : null,
      max_drawdown_pct: round2(worst * 100),
    };
  }

  /* ---------------------------------------------------------------- orders */
  function describeOrder(order) {
    const size = order.qty ? `${round6(order.qty)} sh` : `$${round2(order.dollars)}`;
    const verb = order.side === "buy" ? "Buy" : "Sell";
    const detail = {
      market: "at market",
      limit: `limit $${order.limit}`,
      stop: `stop $${order.stop}`,
      stop_limit: `stop $${order.stop} → limit $${order.limit}`,
      trailing: `trailing ${order.trail_pct}%`,
    }[order.type];
    return `${verb} ${size} ${order.symbol} ${detail}`;
  }

  // Validate user input and build an order. `price` is the current reference price.
  function createOrder(fields, price, time) {
    const symbol = String(fields.symbol || "").trim().toUpperCase();
    if (!/^[A-Z0-9.^=-]{1,12}$/.test(symbol)) {
      throw new Error("enter a ticker symbol");
    }
    const side = fields.side;
    if (side !== "buy" && side !== "sell") {
      throw new Error("side must be buy or sell");
    }
    const type = fields.type || "market";
    if (!ORDER_TYPES.includes(type)) {
      throw new Error("unknown order type");
    }
    const reference = positive(price, "price");
    const order = {
      id: newId(), symbol, side, type, status: "open", created: time,
      qty: null, dollars: null, limit: null, stop: null, trail_pct: null,
      anchor: reference, triggered: false, group: fields.group || null,
      bracket: null, role: fields.role || null,
    };
    if (fields.qty !== undefined && fields.qty !== null && fields.qty !== "") {
      order.qty = positive(fields.qty, "shares");
    } else {
      order.dollars = positive(fields.dollars, "amount");
    }
    if (type === "limit" || type === "stop_limit") {
      order.limit = round2(positive(fields.limit, "limit price"));
    }
    if (type === "stop" || type === "stop_limit") {
      order.stop = round2(positive(fields.stop, "stop price"));
    }
    if (type === "trailing") {
      const trail = positive(fields.trail_pct, "trail %");
      if (trail > 50) {
        throw new Error("trail % must be 50 or less");
      }
      order.trail_pct = round2(trail);
    }
    if (type === "stop_limit") {
      if (side === "buy" && order.limit < order.stop) {
        throw new Error("for a buy stop-limit, the limit must be at or above the stop");
      }
      if (side === "sell" && order.limit > order.stop) {
        throw new Error("for a sell stop-limit, the limit must be at or below the stop");
      }
    }
    if (type === "stop") {
      if (side === "buy" && order.stop <= reference) {
        throw new Error(`a buy stop must be above the current price ($${round2(reference)})`);
      }
      if (side === "sell" && order.stop >= reference) {
        throw new Error(`a sell stop must be below the current price ($${round2(reference)})`);
      }
    }
    const tp = fields.take_profit;
    const sl = fields.stop_loss;
    const hasTp = tp !== undefined && tp !== null && tp !== "";
    const hasSl = sl !== undefined && sl !== null && sl !== "";
    if (hasTp || hasSl) {
      if (side !== "buy") {
        throw new Error("take-profit / stop-loss brackets attach to buy orders");
      }
      const entry = order.limit || order.stop || reference;
      const bracket = {};
      if (hasTp) {
        bracket.take_profit = round2(positive(tp, "take-profit"));
        if (bracket.take_profit <= entry) {
          throw new Error(`take-profit must be above the entry price (~$${round2(entry)})`);
        }
      }
      if (hasSl) {
        bracket.stop_loss = round2(positive(sl, "stop-loss"));
        if (bracket.stop_loss >= entry) {
          throw new Error(`stop-loss must be below the entry price (~$${round2(entry)})`);
        }
      }
      order.bracket = bracket;
    }
    return order;
  }

  // Decide whether an order fills at `price`. Returns { order (updated copy), fill, price }.
  function checkOrder(order, price) {
    const next = { ...order };
    if (order.status !== "open" || !(price > 0)) {
      return { order: next, fill: false };
    }
    const buy = order.side === "buy";
    let fill = false;
    if (order.type === "market") {
      fill = true;
    } else if (order.type === "limit") {
      fill = buy ? price <= order.limit + EPS : price >= order.limit - EPS;
    } else if (order.type === "stop") {
      fill = buy ? price >= order.stop - EPS : price <= order.stop + EPS;
    } else if (order.type === "stop_limit") {
      if (!next.triggered && (buy ? price >= order.stop - EPS : price <= order.stop + EPS)) {
        next.triggered = true;
      }
      if (next.triggered) {
        fill = buy ? price <= order.limit + EPS : price >= order.limit - EPS;
      }
    } else if (order.type === "trailing") {
      next.anchor = buy ? Math.min(order.anchor, price) : Math.max(order.anchor, price);
      const level = buy ? next.anchor * (1 + order.trail_pct / 100) : next.anchor * (1 - order.trail_pct / 100);
      next.level = round2(level);
      fill = buy ? price >= level - EPS : price <= level + EPS;
    }
    return { order: next, fill, price };
  }

  /* --------------------------------------------------------------- account */
  function newAccount(cash) {
    const start = positive(cash, "starting cash");
    return { start_cash: start, cash: start, positions: {}, orders: [], fills: [], closed: [] };
  }

  function applyFill(account, order, price, time) {
    let qty = order.qty || order.dollars / price;
    const pos = account.positions[order.symbol];
    if (order.side === "buy") {
      const cost = qty * price;
      if (cost > account.cash + 0.005) {
        return { ok: false, reason: `not enough cash ($${round2(account.cash)} available, needs $${round2(cost)})` };
      }
      account.cash -= cost;
      if (pos) {
        pos.qty += qty;
        pos.cost += cost;
      } else {
        account.positions[order.symbol] = { qty, cost };
      }
    } else {
      const held = pos ? pos.qty : 0;
      if (held < EPS) {
        return { ok: false, reason: `no ${order.symbol} shares to sell` };
      }
      if (qty > held + EPS) {
        if (!order.role) {
          return { ok: false, reason: `you hold ${round6(held)} ${order.symbol}` };
        }
        qty = held; // bracket legs never sell more than what is left
      }
      const avg = pos.cost / pos.qty;
      const pnl = (price - avg) * qty;
      account.cash += qty * price;
      pos.qty -= qty;
      pos.cost -= avg * qty;
      if (pos.qty < 1e-6) {
        delete account.positions[order.symbol];
      }
      account.closed.push({ symbol: order.symbol, pnl: round2(pnl), pct: round2((price / avg - 1) * 100), time });
    }
    const fill = {
      id: order.id, symbol: order.symbol, side: order.side, type: order.type, role: order.role,
      qty: round6(qty), price: round2(price), amount: round2(qty * price), time,
    };
    account.fills.push(fill);
    return { ok: true, fill, qty };
  }

  function bracketLegs(order, qty, time, price) {
    const legs = [];
    if (!order.bracket) {
      return legs;
    }
    if (order.bracket.take_profit) {
      legs.push(createOrder({
        symbol: order.symbol, side: "sell", type: "limit", qty, limit: order.bracket.take_profit,
        group: order.id, role: "take_profit",
      }, price, time));
    }
    if (order.bracket.stop_loss) {
      legs.push(createOrder({
        symbol: order.symbol, side: "sell", type: "stop", qty, stop: order.bracket.stop_loss,
        group: order.id, role: "stop_loss",
      }, Math.max(price, order.bracket.stop_loss + 0.01), time));
    }
    return legs;
  }

  // Check every open order against the supplied prices. Returns a list of events.
  function processOrders(account, prices, time) {
    const events = [];
    const newLegs = [];
    for (let i = 0; i < account.orders.length; i++) {
      const order = account.orders[i];
      const price = prices[order.symbol];
      if (order.status !== "open" || !(price > 0)) {
        continue;
      }
      const result = checkOrder(order, price);
      account.orders[i] = result.order;
      if (!result.fill) {
        continue;
      }
      const applied = applyFill(account, result.order, price, time);
      if (!applied.ok) {
        account.orders[i] = { ...result.order, status: "rejected", reason: applied.reason, closed: time };
        events.push({ kind: "rejected", order: account.orders[i], reason: applied.reason });
        continue;
      }
      account.orders[i] = { ...result.order, status: "filled", fill_price: round2(price), closed: time };
      events.push({ kind: "filled", order: account.orders[i], fill: applied.fill });
      if (result.order.group) {
        for (const other of account.orders) {
          if (other.group === result.order.group && other.id !== result.order.id && other.status === "open") {
            other.status = "cancelled";
            other.reason = "other bracket leg filled";
            other.closed = time;
            events.push({ kind: "cancelled", order: other });
          }
        }
      }
      newLegs.push(...bracketLegs(result.order, applied.qty, time, price));
    }
    account.orders.push(...newLegs);
    return events;
  }

  function placeOrder(account, fields, price, time) {
    const order = createOrder(fields, price, time);
    account.orders.push(order);
    const events = processOrders(account, { [order.symbol]: price }, time)
      .filter((event) => event.order.id === order.id || event.order.group === order.id);
    const placed = account.orders.find((o) => o.id === order.id);
    return { order: placed, events };
  }

  function cancelOrder(account, id, time) {
    const order = account.orders.find((o) => o.id === id && o.status === "open");
    if (!order) {
      return false;
    }
    order.status = "cancelled";
    order.reason = "cancelled by you";
    order.closed = time;
    return true;
  }

  function accountValue(account, prices) {
    let holdings = 0;
    for (const [symbol, pos] of Object.entries(account.positions)) {
      const price = prices[symbol];
      holdings += pos.qty * (price > 0 ? price : pos.cost / pos.qty);
    }
    return account.cash + holdings;
  }

  /* ---------------------------------------------------------------- replay */
  // Align daily close series on the master symbol's trading days (carry forward gaps).
  function buildTimeline(seriesBySymbol, master = "SPY") {
    const masterSeries = seriesBySymbol[master] || Object.values(seriesBySymbol)[0];
    if (!masterSeries || masterSeries.length < 30) {
      throw new Error("not enough daily history for a replay");
    }
    const dates = masterSeries.map((p) => p[0]);
    const closes = {};
    for (const [symbol, series] of Object.entries(seriesBySymbol)) {
      const sorted = [...series].sort((a, b) => a[0] - b[0]);
      const aligned = [];
      let j = 0;
      let last = null;
      for (const t of dates) {
        while (j < sorted.length && sorted[j][0] <= t + 6 * 3600) {
          last = sorted[j][1];
          j += 1;
        }
        aligned.push(last);
      }
      closes[symbol] = aligned;
    }
    return { master: seriesBySymbol[master] ? master : Object.keys(seriesBySymbol)[0], dates, closes };
  }

  function pricesAt(timeline, day) {
    const prices = {};
    for (const [symbol, list] of Object.entries(timeline.closes)) {
      if (list[day] > 0) {
        prices[symbol] = list[day];
      }
    }
    return prices;
  }

  function newReplay(timeline, startDay, cash) {
    const last = timeline.dates.length - 1;
    const day = Math.max(20, Math.min(last - 5, Math.round(startDay)));
    const benchPrice = timeline.closes[timeline.master][day];
    const account = newAccount(cash);
    return {
      version: 1, start_day: day, day, account,
      bench: { symbol: timeline.master, units: account.start_cash / benchPrice },
      equity: [[timeline.dates[day], account.start_cash, account.start_cash]],
      log: [],
    };
  }

  function replayTime(timeline, day) {
    return new Date(timeline.dates[day] * 1000).toISOString();
  }

  function replayPlace(replay, timeline, fields) {
    const price = timeline.closes[String(fields.symbol || "").toUpperCase()]?.[replay.day];
    if (!(price > 0)) {
      throw new Error(`${fields.symbol} has no price on this replay day`);
    }
    const result = placeOrder(replay.account, fields, price, replayTime(timeline, replay.day));
    replay.log.push(...result.events.map((e) => ({ day: replay.day, kind: e.kind, text: eventText(e) })));
    return result;
  }

  function eventText(event) {
    if (event.kind === "filled") {
      const f = event.fill;
      const leg = f.role === "take_profit" ? " (take-profit)" : f.role === "stop_loss" ? " (stop-loss)" : "";
      return `${f.side === "buy" ? "Bought" : "Sold"} ${f.qty} ${f.symbol} @ $${f.price}${leg}`;
    }
    if (event.kind === "rejected") {
      return `Rejected: ${describeOrder(event.order)} — ${event.reason}`;
    }
    return `Cancelled: ${describeOrder(event.order)}`;
  }

  // Move the replay forward `steps` trading days, checking orders at each close.
  function replayAdvance(replay, timeline, steps = 1) {
    const last = timeline.dates.length - 1;
    const events = [];
    for (let k = 0; k < steps && replay.day < last; k++) {
      replay.day += 1;
      const prices = pricesAt(timeline, replay.day);
      const time = replayTime(timeline, replay.day);
      const dayEvents = processOrders(replay.account, prices, time);
      for (const event of dayEvents) {
        replay.log.push({ day: replay.day, kind: event.kind, text: eventText(event) });
      }
      events.push(...dayEvents);
      const value = accountValue(replay.account, prices);
      const bench = replay.bench.units * prices[replay.bench.symbol];
      replay.equity.push([timeline.dates[replay.day], round2(value), round2(bench)]);
    }
    return events;
  }

  function replaySummary(replay, timeline) {
    const prices = pricesAt(timeline, replay.day);
    const value = accountValue(replay.account, prices);
    const start = replay.account.start_cash;
    const benchValue = replay.bench.units * prices[replay.bench.symbol];
    const closed = replay.account.closed;
    const wins = closed.filter((c) => c.pnl > 0).length;
    const curve = replay.equity.map((e) => e[1]);
    const stats = seriesStats(curve);
    return {
      value: round2(value),
      return_pct: round2((value / start - 1) * 100),
      bench_value: round2(benchValue),
      bench_return_pct: round2((benchValue / start - 1) * 100),
      beat_bench: value > benchValue + 0.005,
      max_drawdown_pct: stats.max_drawdown_pct,
      closed_trades: closed.length,
      win_rate_pct: closed.length ? round2(100 * wins / closed.length) : null,
      realized: round2(closed.reduce((a, c) => a + c.pnl, 0)),
      days_played: replay.day - replay.start_day,
      days_left: timeline.dates.length - 1 - replay.day,
      date: timeline.dates[replay.day],
    };
  }

  /* -------------------------------------------------------------- analytics */
  // Hypothetical look-back: today's weights held (no rebalancing) over aligned history.
  function lookback(weights, seriesBySymbol, benchSymbol = "SPY") {
    const symbols = Object.keys(weights).filter((s) => seriesBySymbol[s] && seriesBySymbol[s].length > 20);
    if (!symbols.length || !seriesBySymbol[benchSymbol]) {
      return null;
    }
    const timeline = buildTimeline({ ...Object.fromEntries(symbols.map((s) => [s, seriesBySymbol[s]])), [benchSymbol]: seriesBySymbol[benchSymbol] }, benchSymbol);
    const total = symbols.reduce((a, s) => a + weights[s], 0) || 1;
    const first = timeline.dates.findIndex((_, i) => symbols.every((s) => timeline.closes[s][i] > 0));
    if (first < 0 || first > timeline.dates.length - 20) {
      return null;
    }
    const curve = [];
    const bench = [];
    for (let i = first; i < timeline.dates.length; i++) {
      let value = 0;
      for (const s of symbols) {
        value += (weights[s] / total) * timeline.closes[s][i] / timeline.closes[s][first];
      }
      curve.push(value);
      bench.push(timeline.closes[benchSymbol][i] / timeline.closes[benchSymbol][first]);
    }
    return {
      symbols, dates: timeline.dates.slice(first), curve, bench,
      portfolio: seriesStats(curve), benchmark: seriesStats(bench),
      covered_weight_pct: round2(100 * total / (Object.values(weights).reduce((a, b) => a + b, 0) || 1)),
    };
  }

  const ASSET_CLASS = {
    SPY: "US stock fund", VTI: "US stock fund", QQQ: "US stock fund", VOO: "US stock fund", IVV: "US stock fund",
    VXUS: "Intl stock fund", EFA: "Intl stock fund", VEA: "Intl stock fund",
    AGG: "Bond fund", BND: "Bond fund", TLT: "Bond fund", IEF: "Bond fund", SHY: "Bond fund",
    GLD: "Gold", IAU: "Gold",
  };

  function allocation(positions, cash) {
    const total = positions.reduce((a, p) => a + p.value, 0) + cash;
    const byClass = {};
    for (const p of positions) {
      const cls = ASSET_CLASS[p.symbol] || "Single stock";
      byClass[cls] = (byClass[cls] || 0) + p.value;
    }
    if (cash > 0.005) {
      byClass.Cash = cash;
    }
    const largest = positions.reduce((best, p) => (!best || p.value > best.value ? p : best), null);
    const largestPct = largest && total ? 100 * largest.value / total : 0;
    const singleStocks = positions.filter((p) => !ASSET_CLASS[p.symbol]);
    let note = "";
    if (largest && !ASSET_CLASS[largest.symbol] && largestPct > 25) {
      note = `${largest.symbol} is ${largestPct.toFixed(0)}% of your portfolio. One company that large can swing your whole result.`;
    } else if (singleStocks.length && singleStocks.length < 5 && positions.every((p) => !ASSET_CLASS[p.symbol])) {
      note = "Only a few single stocks and no funds. A broad fund (e.g. VTI or SPY) spreads risk across hundreds of companies.";
    } else if (!positions.length) {
      note = "All cash. Nothing is at risk, and nothing is growing.";
    }
    return {
      total: round2(total),
      classes: Object.entries(byClass).map(([name, value]) => ({ name, value: round2(value), pct: total ? round2(100 * value / total) : 0 }))
        .sort((a, b) => b.value - a.value),
      largest: largest ? { symbol: largest.symbol, pct: round2(largestPct) } : null,
      note,
    };
  }

  root.TwinPro = {
    ORDER_TYPES, sma, rsi, seriesStats, describeOrder, createOrder, checkOrder,
    newAccount, applyFill, processOrders, placeOrder, cancelOrder, accountValue, bracketLegs,
    buildTimeline, pricesAt, newReplay, replayPlace, replayAdvance, replaySummary, eventText,
    lookback, allocation, ASSET_CLASS,
  };
})(typeof window !== "undefined" ? window : globalThis);
