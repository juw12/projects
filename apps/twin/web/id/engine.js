/* Twin Indonesia engine (codename Satu): pure, dependency-free logic shared by the app and the tests.
 * Nothing here touches the DOM, storage or the network. Every function takes
 * plain data and returns plain data, so it can be tested in isolation.
 */
(function (root) {
  'use strict';

  const DAY_MS = 86400000;
  const QUEUE_BUFFER = 0.05; // cash held back for market orders queued while closed

  // Markets in the order the product brief asked for: US first, then IDX, crypto, gold.
  const MARKET_ORDER = ['US', 'IDX', 'CRYPTO', 'GOLD'];

  const MARKETS = {
    US: {
      id: 'US',
      name: 'US stocks',
      short: 'US',
      currency: 'USD',
      unit: 'share',
      unitPlural: 'shares',
      qtyDecimals: 6,
      lotSize: 1,
      minOrderLocal: 1,
      timeZone: 'America/New_York',
      zoneLabel: 'New York',
      sessions: { weekdays: [['09:30', '16:00']] },
      blurb: 'Fractional US shares and ETFs from $1, paid from your rupiah wallet at the shown USD/IDR rate.',
    },
    IDX: {
      id: 'IDX',
      name: 'Indonesian stocks',
      short: 'IDX',
      currency: 'IDR',
      unit: 'lot',
      unitPlural: 'lots',
      qtyDecimals: 0,
      lotSize: 100,
      timeZone: 'Asia/Jakarta',
      zoneLabel: 'WIB',
      sessions: {
        monThu: [['09:00', '12:00'], ['13:30', '15:50']],
        fri: [['09:00', '11:30'], ['14:00', '15:50']],
      },
      blurb: 'Shares on the Indonesia Stock Exchange, traded in lots of 100 shares with IDX price steps.',
    },
    CRYPTO: {
      id: 'CRYPTO',
      name: 'Crypto',
      short: 'Crypto',
      currency: 'IDR',
      unit: 'coin',
      unitPlural: 'coins',
      qtyDecimals: 8,
      lotSize: 1,
      minOrderIdr: 10000,
      timeZone: 'Asia/Jakarta',
      zoneLabel: 'WIB',
      sessions: 'always',
      blurb: 'Crypto assets priced in rupiah. Markets never close and prices swing hard.',
    },
    GOLD: {
      id: 'GOLD',
      name: 'Gold',
      short: 'Gold',
      currency: 'IDR',
      unit: 'gram',
      unitPlural: 'grams',
      qtyDecimals: 4,
      lotSize: 1,
      minOrderIdr: 10000,
      timeZone: 'Asia/Jakarta',
      zoneLabel: 'WIB',
      sessions: 'always',
      blurb: 'Digital gold by the gram, priced from the global gold price.',
    },
  };

  // Practice fee schedule. Every line says where it comes from; replace the
  // assumptions with your licensed partner's published schedule before launch.
  const FEES = {
    US: {
      lines: {
        buy: [['FX conversion spread', 0.005]],
        sell: [['FX conversion spread', 0.005]],
      },
      source: 'Assumption: 0% commission plus a 0.5% USD/IDR conversion spread each way.',
    },
    IDX: {
      lines: {
        buy: [['Broker fee incl. levies', 0.0015]],
        sell: [['Broker fee incl. levies', 0.0015], ['Final tax on share sales', 0.001]],
      },
      source: '0.15% buy / 0.25% sell, matching Stockbit\u2019s published retail fees.',
    },
    CRYPTO: {
      lines: {
        buy: [['Exchange fee incl. taxes', 0.002]],
        sell: [['Exchange fee incl. taxes', 0.003]],
      },
      source: 'Assumption. Licensed exchanges publish their own fee and tax schedule.',
    },
    GOLD: {
      lines: {
        buy: [['Buy spread', 0.01]],
        sell: [['Sell spread', 0.01]],
      },
      source: 'Assumption: 2% round-trip spread. Gold providers quote separate buy and sell prices.',
    },
  };

  const RISK_LEVELS = [
    { id: 'conservative', label: 'Conservative', min: 0, max: 3, maxPositionPct: 10, maxCryptoPct: 5 },
    { id: 'balanced', label: 'Balanced', min: 4, max: 6, maxPositionPct: 15, maxCryptoPct: 10 },
    { id: 'growth', label: 'Growth', min: 7, max: 9, maxPositionPct: 25, maxCryptoPct: 20 },
    { id: 'aggressive', label: 'Aggressive', min: 10, max: 12, maxPositionPct: 35, maxCryptoPct: 30 },
  ];

  const PLAN_RANK = { free: 0, plus: 1, pro: 2 };

  // Educational assumptions for the diversification lesson (annualised %).
  const ASSUMED_VOLATILITY = { US: 18, IDX: 20, CRYPTO: 65, GOLD: 15 };
  const ASSUMED_CORRELATION = {
    'US|IDX': 0.45,
    'US|CRYPTO': 0.35,
    'US|GOLD': 0.1,
    'IDX|CRYPTO': 0.25,
    'IDX|GOLD': 0.15,
    'CRYPTO|GOLD': 0.1,
  };

  const SIM_DAILY_VOLATILITY = { US: 0.016, IDX: 0.018, CRYPTO: 0.035, GOLD: 0.009 };

  const SCAM_RULES = [
    {
      id: 'guarantee',
      severity: 'block',
      label: 'Promises guaranteed or risk-free profit',
      pattern: /(guarantee[ds]?|pasti\s*(cuan|untung|profit|naik)|dijamin\s*(untung|cuan|profit|aman|naik)|no\s*risk|risk[-\s]*free|tanpa\s*risiko|anti\s*rugi|100\s*%\s*(profit|untung|aman|win))/i,
    },
    {
      id: 'fixed-return',
      severity: 'block',
      label: 'Promises a fixed return per day, week or month',
      pattern: /\d{1,3}(?:[.,]\d+)?\s*%\s*(?:per|\/|a|tiap|setiap)?\s*(?:day|daily|week|weekly|month|monthly|hari|minggu|bulan|sehari|seminggu|sebulan)\b(?!\s+ini)/i,
    },
    {
      id: 'contact',
      severity: 'block',
      label: 'Moves the conversation to a private chat or phone number',
      pattern: /(wa\.me|whats\s*app|\bwa\s*:?\s*\+?\d|t\.me\/|(join|gabung|link)\s+(my\s+|grup\s+|group\s+)?telegram|\b08\d{8,11}\b|\+62\s?8\d{7,11}|\bdm\s+(me|aku|saya)\b|inbox\s+(me|aku|saya))/i,
    },
    {
      id: 'paid-signals',
      severity: 'block',
      label: 'Sells signals or VIP groups outside the platform',
      pattern: /(vip\s*(group|grup|signal|sinyal|member)|grup\s*(premium|berbayar|sinyal)|signal\s*(berbayar|premium)|join\s+(my|our)\s+(group|grup|channel))/i,
    },
    {
      id: 'transfer',
      severity: 'block',
      label: 'Asks for money to be sent',
      pattern: /(transfer\s*(dulu|ke\s*rekening|ke\s*saya)|kirim\s*(dana|uang)|deposit\s*ke\s*rekening|titip\s*(dana|uang)|send\s+(me\s+)?(money|funds|usdt))/i,
    },
    {
      id: 'illegal-platform',
      severity: 'block',
      label: 'Mentions a platform or scheme declared illegal in Indonesia',
      pattern: /(binomo|quotex|olymp\s*trade|iq\s*option|robot\s*trading)/i,
    },
    {
      id: 'hype',
      severity: 'warn',
      label: 'Hype language: check the evidence before acting',
      pattern: /(to\s*the\s*moon|hajar\s*kanan|pom[\s-]*pom|terbang\s*tinggi|\b\d{1,3}x\s*(gain|cuan|profit)|auto\s*(cuan|profit|kaya)|cepat\s*kaya|get\s*rich)/i,
    },
  ];

  // ---------------------------------------------------------------- helpers

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function iso(date) {
    return new Date(date || Date.now()).toISOString();
  }

  function nowMs(ctx) {
    if (ctx && ctx.now != null) {
      return typeof ctx.now === 'number' ? ctx.now : new Date(ctx.now).getTime();
    }
    return Date.now();
  }

  function floorTo(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.floor(value * factor + 1e-7) / factor;
  }

  function roundTo(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function makeId(prefix, ms) {
    const random = Math.floor(Math.random() * 1e9).toString(36);
    return `${prefix}-${Math.floor(ms).toString(36)}-${random}`;
  }

  // ------------------------------------------------------------ market hours

  function toMinutes(hhmm) {
    const [hours, minutes] = hhmm.split(':').map(Number);
    return hours * 60 + minutes;
  }

  function zonedParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = {};
    for (const part of formatter.formatToParts(date)) {
      parts[part.type] = part.value;
    }
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    const hour = Number(parts.hour) % 24;
    const minute = Number(parts.minute);
    return {
      weekday,
      minutes: hour * 60 + minute,
      label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    };
  }

  function sessionsFor(market, weekday) {
    if (market.sessions === 'always') {
      return 'always';
    }
    if (weekday === 0 || weekday === 6) {
      return [];
    }
    if (market.sessions.weekdays) {
      return market.sessions.weekdays;
    }
    return weekday === 5 ? market.sessions.fri : market.sessions.monThu;
  }

  /** Simplified trading-hours check. Exchange holidays are not modelled. */
  function marketStatus(marketId, date) {
    const market = MARKETS[marketId];
    const when = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
    const local = zonedParts(when, market.timeZone);
    const base = { localTime: local.label, zone: market.zoneLabel };
    const sessions = sessionsFor(market, local.weekday);
    if (sessions === 'always') {
      return Object.assign(base, { open: true, state: 'open', label: 'Open 24/7' });
    }
    for (const [start, end] of sessions) {
      if (local.minutes >= toMinutes(start) && local.minutes < toMinutes(end)) {
        return Object.assign(base, { open: true, state: 'open', label: `Open · closes ${end} ${market.zoneLabel}` });
      }
    }
    if (
      sessions.length === 2 &&
      local.minutes >= toMinutes(sessions[0][1]) &&
      local.minutes < toMinutes(sessions[1][0])
    ) {
      return Object.assign(base, {
        open: false,
        state: 'break',
        label: `Lunch break · reopens ${sessions[1][0]} ${market.zoneLabel}`,
      });
    }
    if (sessions.length && local.minutes < toMinutes(sessions[0][0])) {
      return Object.assign(base, {
        open: false,
        state: 'closed',
        label: `Closed · opens ${sessions[0][0]} ${market.zoneLabel}`,
      });
    }
    let next = (local.weekday + 1) % 7;
    while (next === 0 || next === 6) {
      next = (next + 1) % 7;
    }
    const nextSessions = sessionsFor(market, next);
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][next];
    return Object.assign(base, {
      open: false,
      state: 'closed',
      label: `Closed · opens ${dayName} ${nextSessions[0][0]} ${market.zoneLabel}`,
    });
  }

  // ---------------------------------------------------------- IDX price steps

  function idxTick(price) {
    if (price < 200) return 1;
    if (price < 500) return 2;
    if (price < 2000) return 5;
    if (price < 5000) return 10;
    return 25;
  }

  function roundToTick(price, mode) {
    const tick = idxTick(price);
    const round = mode === 'down' ? Math.floor : mode === 'up' ? Math.ceil : Math.round;
    return round(price / tick - 1e-9 * (mode === 'up' ? 1 : -1)) * tick;
  }

  function isOnTick(price) {
    const steps = price / idxTick(price);
    return Math.abs(steps - Math.round(steps)) < 1e-9;
  }

  // ------------------------------------------------------------------- fees

  function feeRate(marketId, side) {
    return FEES[marketId].lines[side].reduce((sum, line) => sum + line[1], 0);
  }

  /** Price rise needed after a buy for the sale to cover both fees: (1+b)/(1-s) - 1. */
  function breakEvenPct(marketId) {
    const buy = feeRate(marketId, 'buy');
    const sell = feeRate(marketId, 'sell');
    return ((1 + buy) / (1 - sell) - 1) * 100;
  }

  function fxFor(marketId, fxRate) {
    return marketId === 'US' ? fxRate : 1;
  }

  function quoteOrder({ market, side, qty, price, fxRate }) {
    const fx = fxFor(market, fxRate);
    const grossLocal = qty * price;
    const grossIdr = Math.round(grossLocal * fx);
    const lines = FEES[market].lines[side].map(([label, rate]) => ({
      label,
      rate,
      idr: Math.round(grossIdr * rate),
    }));
    const feeIdr = lines.reduce((sum, line) => sum + line.idr, 0);
    const totalIdr = side === 'buy' ? grossIdr + feeIdr : grossIdr - feeIdr;
    return {
      qty,
      price,
      fx,
      grossLocal,
      grossIdr,
      lines,
      feeIdr,
      totalIdr,
      breakEvenPct: breakEvenPct(market),
    };
  }

  /** Largest valid quantity whose all-in buy cost fits within amountIdr. */
  function qtyForAmount({ market, amountIdr, price, fxRate }) {
    if (!(amountIdr > 0) || !(price > 0)) {
      return 0;
    }
    const fx = fxFor(market, fxRate);
    const units = amountIdr / (1 + feeRate(market, 'buy')) / (price * fx);
    if (market === 'IDX') {
      return Math.floor(units / MARKETS.IDX.lotSize + 1e-9) * MARKETS.IDX.lotSize;
    }
    let qty = floorTo(units, MARKETS[market].qtyDecimals);
    // Rounding can push the all-in cost one rupiah over the budget; step down if so.
    const step = Math.pow(10, -MARKETS[market].qtyDecimals);
    while (qty > 0 && quoteOrder({ market, side: 'buy', qty, price, fxRate }).totalIdr > amountIdr) {
      qty = roundTo(qty - step, MARKETS[market].qtyDecimals);
    }
    return Math.max(0, qty);
  }

  // ------------------------------------------------------------------ state

  function createState(options) {
    const opts = options || {};
    const startingCashIdr = opts.startingCashIdr || 10000000;
    return {
      version: 1,
      createdAt: iso(opts.now),
      profile: opts.profile || null,
      settings: { dataMode: 'live', respectHours: true },
      plan: { id: 'free', since: null, renewsAt: null },
      wallet: { cashIdr: startingCashIdr, startingCashIdr },
      positions: {},
      orders: [],
      realizedIdr: 0,
      watchlist: opts.watchlist || [],
      alerts: [],
      community: { posts: [], likes: {}, reports: {}, revealed: {} },
      learn: { completed: {}, streak: { count: 0, lastDay: null } },
    };
  }

  /** Repair a stored state document; unknown or broken input gives a fresh state. */
  function migrateState(raw) {
    if (!raw || typeof raw !== 'object' || raw.version !== 1 || !raw.wallet) {
      return null;
    }
    const fresh = createState({ startingCashIdr: raw.wallet.startingCashIdr });
    const merged = Object.assign(fresh, raw);
    merged.settings = Object.assign(fresh.settings, raw.settings || {});
    merged.plan = Object.assign({ id: 'free', since: null, renewsAt: null }, raw.plan || {});
    merged.community = Object.assign(
      { posts: [], likes: {}, reports: {}, revealed: {} },
      raw.community || {}
    );
    merged.learn = Object.assign({ completed: {}, streak: { count: 0, lastDay: null } }, raw.learn || {});
    merged.positions = raw.positions && typeof raw.positions === 'object' ? raw.positions : {};
    merged.orders = Array.isArray(raw.orders) ? raw.orders : [];
    merged.alerts = Array.isArray(raw.alerts) ? raw.alerts : [];
    merged.watchlist = Array.isArray(raw.watchlist) ? raw.watchlist : [];
    return merged;
  }

  function reservedCash(state, exceptId) {
    return state.orders
      .filter((order) => (order.status === 'open' || order.status === 'queued') && order.id !== exceptId)
      .reduce((sum, order) => sum + (order.reservedIdr || 0), 0);
  }

  function availableCash(state) {
    return state.wallet.cashIdr - reservedCash(state);
  }

  function reservedQty(state, symbol) {
    return state.orders
      .filter(
        (order) =>
          (order.status === 'open' || order.status === 'queued') &&
          order.side === 'sell' &&
          order.symbol === symbol
      )
      .reduce((sum, order) => sum + order.qty, 0);
  }

  function availableQty(state, symbol) {
    const position = state.positions[symbol];
    return position ? roundTo(position.qty - reservedQty(state, symbol), 8) : 0;
  }

  // -------------------------------------------------------------- portfolio

  function portfolioValue(state, ctx) {
    const byMarket = { US: 0, IDX: 0, CRYPTO: 0, GOLD: 0 };
    const positions = [];
    let positionsIdr = 0;
    let costIdr = 0;
    let dayChangeIdr = 0;
    for (const position of Object.values(state.positions)) {
      const quote = ctx.prices[position.symbol];
      const avgPriceLocal = position.costLocal / position.qty;
      const price = quote && quote.price > 0 ? quote.price : avgPriceLocal;
      const prev = quote && quote.prev > 0 ? quote.prev : price;
      const fx = fxFor(position.market, ctx.fxRate);
      const valueIdr = position.qty * price * fx;
      dayChangeIdr += position.qty * (price - prev) * fx;
      byMarket[position.market] += valueIdr;
      positionsIdr += valueIdr;
      costIdr += position.costIdr;
      positions.push(
        Object.assign({}, position, {
          price,
          valueIdr,
          avgPriceLocal,
          pnlIdr: valueIdr - position.costIdr,
          pnlPct: position.costIdr ? ((valueIdr - position.costIdr) / position.costIdr) * 100 : 0,
        })
      );
    }
    positions.sort((a, b) => b.valueIdr - a.valueIdr);
    const reserved = reservedCash(state);
    const totalIdr = state.wallet.cashIdr + positionsIdr;
    const start = state.wallet.startingCashIdr || 1;
    return {
      cashIdr: state.wallet.cashIdr,
      reservedIdr: reserved,
      availableIdr: state.wallet.cashIdr - reserved,
      positionsIdr,
      totalIdr,
      byMarket,
      positions,
      unrealizedIdr: positionsIdr - costIdr,
      realizedIdr: state.realizedIdr || 0,
      dayChangeIdr,
      returnPct: ((totalIdr - start) / start) * 100,
    };
  }

  // ----------------------------------------------------------------- orders

  function validateOrder(state, order, ctx) {
    const errors = [];
    const warnings = [];
    const instrument = ctx.instruments[order.symbol];
    if (!instrument) {
      return { ok: false, errors: ['Unknown instrument.'], warnings };
    }
    const marketId = instrument.market;
    const market = MARKETS[marketId];
    const live = ctx.prices[order.symbol];
    const price = order.type === 'limit' ? Number(order.limitPrice) : live && live.price;
    const qty = Number(order.qty);

    if (!(qty > 0)) {
      errors.push('Enter a quantity greater than zero.');
    }
    if (!(price > 0)) {
      errors.push(order.type === 'limit' ? 'Enter a limit price.' : 'No price is available yet.');
    }
    if (marketId === 'IDX' && qty > 0 && qty % market.lotSize !== 0) {
      errors.push('Indonesian stocks trade in whole lots of 100 shares.');
    }
    if (marketId === 'IDX' && order.type === 'limit' && price > 0 && !isOnTick(price)) {
      errors.push(`At this price the IDX step is Rp${idxTick(price)}. Try Rp${roundToTick(price)}.`);
    }
    if (errors.length) {
      return { ok: false, errors, warnings };
    }

    const quote = quoteOrder({ market: marketId, side: order.side, qty, price, fxRate: ctx.fxRate });
    if (market.minOrderLocal && quote.grossLocal < market.minOrderLocal - 1e-9) {
      errors.push('The minimum US order is $1.');
    }
    if (market.minOrderIdr && quote.grossIdr < market.minOrderIdr) {
      errors.push(`The minimum order is ${formatIdr(market.minOrderIdr)}.`);
    }

    const status = marketStatus(marketId, nowMs(ctx));
    const willQueue = order.type === 'market' && !status.open && ctx.respectHours !== false;
    if (order.side === 'buy') {
      const needed = Math.round(quote.totalIdr * (willQueue ? 1 + QUEUE_BUFFER : 1));
      const available = availableCash(state);
      if (needed > available) {
        errors.push(`Not enough practice cash: this needs ${formatIdr(needed)}, you have ${formatIdr(available)} free.`);
      }
    } else {
      const free = availableQty(state, order.symbol);
      if (qty > free + 1e-9) {
        errors.push(free > 0 ? `You can sell up to ${formatQty(marketId, free, order.symbol)}.` : 'You do not hold this asset.');
      }
    }

    if (order.side === 'buy' && state.profile && state.profile.risk) {
      const value = portfolioValue(state, ctx);
      const total = value.totalIdr || 1;
      const held = value.positions.find((position) => position.symbol === order.symbol);
      const afterPct = (((held ? held.valueIdr : 0) + quote.grossIdr) / total) * 100;
      const risk = state.profile.risk;
      if (afterPct > risk.maxPositionPct) {
        warnings.push(
          `This puts ${afterPct.toFixed(1)}% of your portfolio in ${order.symbol}. Your ${risk.label} limit is ${risk.maxPositionPct}% per asset.`
        );
      }
      if (marketId === 'CRYPTO') {
        const cryptoPct = ((value.byMarket.CRYPTO + quote.grossIdr) / total) * 100;
        if (cryptoPct > risk.maxCryptoPct) {
          warnings.push(`Crypto would be ${cryptoPct.toFixed(1)}% of your portfolio. Your ${risk.label} limit is ${risk.maxCryptoPct}%.`);
        }
      }
    }
    return { ok: errors.length === 0, errors, warnings, quote, willQueue, status };
  }

  function applyFill(state, order, price, fxRate, ms) {
    const quote = quoteOrder({ market: order.market, side: order.side, qty: order.qty, price, fxRate });
    if (order.side === 'buy') {
      const free = state.wallet.cashIdr - reservedCash(state, order.id);
      if (quote.totalIdr > free) {
        order.status = 'rejected';
        order.note = 'Not enough practice cash when the order tried to fill.';
        order.reservedIdr = 0;
        return false;
      }
      state.wallet.cashIdr -= quote.totalIdr;
      const position = state.positions[order.symbol] || {
        symbol: order.symbol,
        market: order.market,
        qty: 0,
        costIdr: 0,
        costLocal: 0,
        openedAt: iso(ms),
      };
      position.qty = roundTo(position.qty + order.qty, 8);
      position.costIdr += quote.totalIdr;
      position.costLocal += quote.grossLocal;
      state.positions[order.symbol] = position;
    } else {
      const position = state.positions[order.symbol];
      if (!position || position.qty + 1e-9 < order.qty) {
        order.status = 'rejected';
        order.note = 'Not enough holdings when the order tried to fill.';
        return false;
      }
      const fraction = Math.min(1, order.qty / position.qty);
      const costPart = position.costIdr * fraction;
      const costLocalPart = position.costLocal * fraction;
      state.wallet.cashIdr += quote.totalIdr;
      order.realizedIdr = Math.round(quote.totalIdr - costPart);
      state.realizedIdr = (state.realizedIdr || 0) + order.realizedIdr;
      position.qty = roundTo(position.qty - order.qty, 8);
      position.costIdr -= costPart;
      position.costLocal -= costLocalPart;
      if (position.qty <= 1e-9) {
        delete state.positions[order.symbol];
      }
    }
    order.status = 'filled';
    order.filledAt = iso(ms);
    order.fillPrice = price;
    order.fx = quote.fx;
    order.feesIdr = quote.feeIdr;
    order.totalIdr = quote.totalIdr;
    order.reservedIdr = 0;
    return true;
  }

  function placeOrder(state, order, ctx) {
    const check = validateOrder(state, order, ctx);
    if (!check.ok) {
      return { state, result: { ok: false, errors: check.errors, warnings: check.warnings } };
    }
    const ms = nowMs(ctx);
    const instrument = ctx.instruments[order.symbol];
    const next = clone(state);
    const record = {
      id: makeId('ord', ms),
      symbol: order.symbol,
      market: instrument.market,
      side: order.side,
      type: order.type,
      qty: Number(order.qty),
      limitPrice: order.type === 'limit' ? Number(order.limitPrice) : null,
      source: order.source || null,
      createdAt: iso(ms),
      status: 'open',
      reservedIdr: 0,
    };
    next.orders.unshift(record);
    const tradable = check.status.open || ctx.respectHours === false;
    const current = ctx.prices[order.symbol] && ctx.prices[order.symbol].price;
    const marketableLimit =
      order.type === 'limit' &&
      current > 0 &&
      (order.side === 'buy' ? current <= record.limitPrice : current >= record.limitPrice);
    if (tradable && (order.type === 'market' || marketableLimit)) {
      // Market orders, and limits already at or through the market, fill at the current price.
      applyFill(next, record, current, ctx.fxRate, ms);
    } else {
      record.status = order.type === 'market' ? 'queued' : 'open';
      if (order.side === 'buy') {
        record.reservedIdr = Math.round(check.quote.totalIdr * (order.type === 'market' ? 1 + QUEUE_BUFFER : 1));
      }
    }
    return { state: next, result: { ok: true, order: record, warnings: check.warnings } };
  }

  /** Fill queued market orders and limit orders whose price condition is met. */
  function processOrders(state, ctx) {
    const pending = state.orders.some((order) => order.status === 'open' || order.status === 'queued');
    if (!pending) {
      return { state, fills: [] };
    }
    const ms = nowMs(ctx);
    const next = clone(state);
    const fills = [];
    // Oldest first, so earlier orders get first claim on cash and holdings.
    for (const order of next.orders.slice().reverse()) {
      if (order.status !== 'open' && order.status !== 'queued') {
        continue;
      }
      if (ctx.respectHours !== false && !marketStatus(order.market, ms).open) {
        continue;
      }
      const quote = ctx.prices[order.symbol];
      const price = quote && quote.price;
      if (!(price > 0)) {
        continue;
      }
      let shouldFill = order.status === 'queued';
      if (order.type === 'limit') {
        shouldFill = order.side === 'buy' ? price <= order.limitPrice : price >= order.limitPrice;
      }
      if (!shouldFill) {
        continue;
      }
      order.reservedIdr = 0;
      if (applyFill(next, order, price, ctx.fxRate, ms)) {
        fills.push(order);
      }
    }
    return { state: next, fills };
  }

  function cancelOrder(state, orderId) {
    const next = clone(state);
    const order = next.orders.find((item) => item.id === orderId);
    if (order && (order.status === 'open' || order.status === 'queued')) {
      order.status = 'cancelled';
      order.reservedIdr = 0;
    }
    return next;
  }

  // ----------------------------------------------------------- risk profile

  function riskProfile(answers) {
    const score = clamp(
      ['goal', 'horizon', 'drawdown', 'experience'].reduce((sum, key) => sum + (Number(answers[key]) || 0), 0),
      0,
      12
    );
    let index = RISK_LEVELS.findIndex((level) => score >= level.min && score <= level.max);
    let capped = false;
    if (!answers.emergencyFund && index > 1) {
      index = 1;
      capped = true;
    }
    return Object.assign({ score, capped }, RISK_LEVELS[index]);
  }

  // ------------------------------------------------- analyst track records

  function scoreIdea(idea, currentPrice, ms, benchmarkPrice) {
    const direction = idea.direction === 'SELL' ? -1 : 1;
    let exitPrice = currentPrice;
    let status = 'Open';
    let benchExit = benchmarkPrice;
    if (idea.closed) {
      exitPrice = idea.closed.price;
      status = idea.closed.reason;
      benchExit = idea.closed.benchPrice || benchmarkPrice;
    } else if (currentPrice > 0) {
      const hitTarget = direction === 1 ? currentPrice >= idea.target : currentPrice <= idea.target;
      const hitStop = direction === 1 ? currentPrice <= idea.stop : currentPrice >= idea.stop;
      const ageDays = (ms - Date.parse(idea.createdAt)) / DAY_MS;
      if (hitTarget) {
        status = 'Target hit';
      } else if (hitStop) {
        status = 'Stopped out';
      } else if (ageDays > idea.horizonDays) {
        status = 'Expired';
      }
    }
    const returnPct = exitPrice > 0 ? ((direction * (exitPrice - idea.entry)) / idea.entry) * 100 : 0;
    let benchPct = null;
    if (idea.benchEntry > 0 && benchExit > 0) {
      benchPct = ((benchExit - idea.benchEntry) / idea.benchEntry) * 100;
    }
    return {
      id: idea.id,
      status,
      exitPrice,
      returnPct,
      benchPct,
      excessPct: benchPct == null || direction !== 1 ? null : returnPct - benchPct,
    };
  }

  function scorecard(scored) {
    const count = scored.length;
    if (!count) {
      return { count: 0, wins: 0, winRate: 0, avgReturnPct: 0, avgExcessPct: null, best: null, worst: null };
    }
    const wins = scored.filter((item) => item.returnPct > 0).length;
    const withExcess = scored.filter((item) => item.excessPct != null);
    const sorted = scored.slice().sort((a, b) => b.returnPct - a.returnPct);
    return {
      count,
      wins,
      winRate: (wins / count) * 100,
      avgReturnPct: scored.reduce((sum, item) => sum + item.returnPct, 0) / count,
      avgExcessPct: withExcess.length
        ? withExcess.reduce((sum, item) => sum + item.excessPct, 0) / withExcess.length
        : null,
      best: sorted[0],
      worst: sorted[sorted.length - 1],
    };
  }

  // ------------------------------------------------------------ Scam Shield

  function scamCheck(text) {
    const value = String(text || '');
    const flags = SCAM_RULES.filter((rule) => rule.pattern.test(value)).map((rule) => ({
      id: rule.id,
      label: rule.label,
      severity: rule.severity,
    }));
    return { blocked: flags.some((flag) => flag.severity === 'block'), flags };
  }

  function cashtags(text, knownSymbols) {
    const found = [];
    const pattern = /\$([A-Z]{1,5})\b/g;
    let match = pattern.exec(String(text || ''));
    while (match) {
      if (knownSymbols.indexOf(match[1]) !== -1 && found.indexOf(match[1]) === -1) {
        found.push(match[1]);
      }
      match = pattern.exec(String(text || ''));
    }
    return found;
  }

  // ------------------------------------------------------ learning widgets

  function compound({ initialIdr, monthlyIdr, annualPct, years }) {
    const monthlyRate = annualPct / 100 / 12;
    const months = Math.round(years * 12);
    let value = initialIdr;
    const series = [value];
    for (let month = 1; month <= months; month += 1) {
      value = value * (1 + monthlyRate) + monthlyIdr;
      if (month % 12 === 0 || month === months) {
        series.push(value);
      }
    }
    const contributedIdr = initialIdr + monthlyIdr * months;
    return { futureIdr: value, contributedIdr, growthIdr: value - contributedIdr, series };
  }

  function weeklyEarnings(amountIdr, annualPct) {
    return (amountIdr * annualPct) / 100 / 52;
  }

  function positionSize({ capitalIdr, riskPct, entry, stop, lotSize }) {
    const lot = lotSize || 1;
    const riskIdr = (capitalIdr * riskPct) / 100;
    const perUnit = Math.abs(entry - stop);
    if (!(perUnit > 0) || !(entry > 0)) {
      return { riskIdr, units: 0, valueIdr: 0, pctOfCapital: 0 };
    }
    const affordable = Math.floor(capitalIdr / entry / lot) * lot;
    const byRisk = Math.floor(riskIdr / perUnit / lot) * lot;
    const units = Math.max(0, Math.min(affordable, byRisk));
    return { riskIdr, units, valueIdr: units * entry, pctOfCapital: ((units * entry) / capitalIdr) * 100 };
  }

  function fxAdjustedReturn(stockPct, fxPct) {
    return ((1 + stockPct / 100) * (1 + fxPct / 100) - 1) * 100;
  }

  /** Portfolio volatility from % weights using the assumed vols and correlations. */
  function portfolioVolatility(weights) {
    let variance = 0;
    for (const a of MARKET_ORDER) {
      for (const b of MARKET_ORDER) {
        const wa = (weights[a] || 0) / 100;
        const wb = (weights[b] || 0) / 100;
        const rho = a === b ? 1 : ASSUMED_CORRELATION[`${a}|${b}`] ?? ASSUMED_CORRELATION[`${b}|${a}`];
        variance += wa * wb * ASSUMED_VOLATILITY[a] * ASSUMED_VOLATILITY[b] * rho;
      }
    }
    return Math.sqrt(variance);
  }

  // ------------------------------------------------------------- simulation

  function makeRng(seed) {
    let state = seed >>> 0;
    return function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rng) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function tidyPrice(marketId, price) {
    if (marketId === 'IDX') {
      return Math.max(1, roundToTick(price));
    }
    if (price >= 1000) return roundTo(price, 0);
    if (price >= 1) return roundTo(price, 2);
    return roundTo(price, 6);
  }

  /**
   * One geometric-Brownian step for the simulated practice market. Returns the
   * raw (unrounded) price; callers keep the raw value between steps and show
   * tidyPrice(), otherwise IDX price steps would freeze cheap stocks.
   */
  function simulateStep(price, marketId, dtDays, rng) {
    const vol = SIM_DAILY_VOLATILITY[marketId] * Math.sqrt(dtDays);
    return price * Math.exp(vol * gaussian(rng) - 0.5 * vol * vol);
  }

  // ------------------------------------------------------ missions & plans

  function missions(state) {
    const filled = state.orders.filter((order) => order.status === 'filled');
    const bought = new Set(filled.filter((order) => order.side === 'buy').map((order) => order.market));
    const chosen = (state.profile && state.profile.markets) || MARKET_ORDER;
    return [
      { id: 'profile', label: 'Set your risk profile', done: !!(state.profile && state.profile.risk), xp: 25 },
      { id: 'first-trade', label: 'Place your first practice trade', done: filled.length > 0, xp: 25 },
      { id: 'limit', label: 'Place a limit order', done: state.orders.some((order) => order.type === 'limit'), xp: 25 },
      {
        id: 'markets',
        label: `Buy in every market you picked (${chosen.length})`,
        done: chosen.every((market) => bought.has(market)),
        xp: 50,
      },
      { id: 'scam-shield', label: 'Finish the Scam Shield lesson', done: !!state.learn.completed['scam-shield'], xp: 25 },
      { id: 'post', label: 'Ask or share something in Community', done: state.community.posts.length > 0, xp: 25 },
    ];
  }

  function totalXp(state) {
    const lessonXp = Object.values(state.learn.completed).reduce((sum, item) => sum + (item.xp || 0), 0);
    const missionXp = missions(state)
      .filter((mission) => mission.done)
      .reduce((sum, mission) => sum + mission.xp, 0);
    return lessonXp + missionXp;
  }

  function dayKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  /** Count consecutive days with learning or practice activity. */
  function bumpStreak(streak, ms) {
    const today = dayKey(ms);
    if (streak.lastDay === today) {
      return streak;
    }
    const yesterday = dayKey(ms - DAY_MS);
    return { count: streak.lastDay === yesterday ? streak.count + 1 : 1, lastDay: today };
  }

  function canAccess(planId, tier) {
    return (PLAN_RANK[planId] || 0) >= (PLAN_RANK[tier] || 0);
  }

  // ------------------------------------------------------------- formatting

  function formatIdr(value, options) {
    const opts = options || {};
    const sign = value < 0 ? '-' : opts.sign && value > 0 ? '+' : '';
    const abs = Math.abs(value);
    if (opts.compact && abs >= 1e12) return `${sign}Rp${(abs / 1e12).toFixed(2)} T`;
    if (opts.compact && abs >= 1e9) return `${sign}Rp${(abs / 1e9).toFixed(2)} M`;
    if (opts.compact && abs >= 1e6) return `${sign}Rp${(abs / 1e6).toFixed(abs >= 1e8 ? 0 : 1)} jt`;
    const decimals = opts.decimals != null ? opts.decimals : abs > 0 && abs < 100 ? 2 : 0;
    return `${sign}Rp${abs.toLocaleString('id-ID', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  }

  function formatUsd(value, options) {
    const opts = options || {};
    const sign = value < 0 ? '-' : opts.sign && value > 0 ? '+' : '';
    const abs = Math.abs(value);
    const decimals = abs > 0 && abs < 1 ? 4 : 2;
    return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  }

  function formatPrice(marketId, price) {
    if (!(price > 0)) return '—';
    if (marketId === 'US') return formatUsd(price);
    if (marketId === 'IDX') return formatIdr(price, { decimals: 0 });
    if (price >= 1000) return formatIdr(price, { decimals: 0 });
    if (price >= 1) return formatIdr(price, { decimals: 2 });
    return formatIdr(price, { decimals: 4 });
  }

  function formatPct(value, digits) {
    if (value == null || Number.isNaN(value)) return '—';
    const d = digits == null ? 2 : digits;
    return `${value > 0 ? '+' : ''}${value.toFixed(d)}%`;
  }

  function trimNumber(value, decimals) {
    return Number(value.toFixed(decimals)).toLocaleString('en-US', { maximumFractionDigits: decimals });
  }

  function formatQty(marketId, qty, symbol) {
    if (marketId === 'IDX') {
      const lots = qty / 100;
      return `${trimNumber(lots, 2)} lot${lots === 1 ? '' : 's'} (${qty.toLocaleString('en-US')} shares)`;
    }
    if (marketId === 'US') return `${trimNumber(qty, 6)} share${qty === 1 ? '' : 's'}`;
    if (marketId === 'GOLD') return `${trimNumber(qty, 4)} g`;
    return `${trimNumber(qty, 8)} ${symbol || ''}`.trim();
  }

  const api = {
    DAY_MS,
    QUEUE_BUFFER,
    MARKET_ORDER,
    MARKETS,
    FEES,
    RISK_LEVELS,
    PLAN_RANK,
    ASSUMED_VOLATILITY,
    ASSUMED_CORRELATION,
    SCAM_RULES,
    clone,
    marketStatus,
    idxTick,
    roundToTick,
    isOnTick,
    feeRate,
    breakEvenPct,
    quoteOrder,
    qtyForAmount,
    createState,
    migrateState,
    availableCash,
    availableQty,
    portfolioValue,
    validateOrder,
    placeOrder,
    processOrders,
    cancelOrder,
    riskProfile,
    scoreIdea,
    scorecard,
    scamCheck,
    cashtags,
    compound,
    weeklyEarnings,
    positionSize,
    fxAdjustedReturn,
    portfolioVolatility,
    makeRng,
    simulateStep,
    tidyPrice,
    missions,
    totalXp,
    bumpStreak,
    canAccess,
    formatIdr,
    formatUsd,
    formatPrice,
    formatPct,
    formatQty,
  };

  root.SatuEngine = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
