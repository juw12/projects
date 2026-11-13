// Tokocrypto, the exchange for real money: licensed in Indonesia (OJK), a Binance-style API,
// and the same BTC/ETH/SOL against USDT that the practice account trades.
// Docs: https://www.tokocrypto.com/apidocs/
//
// Only four things are ever asked of it: the trading rules of a market (public), the free
// balance of one coin, a market buy for an amount of USDT and a market sell for a quantity.
// Nothing here can withdraw: the API key should not have that permission at all.

export const EXCHANGE_NAME = "Tokocrypto";
export const EXCHANGE_BASE = "https://www.tokocrypto.com";
const RULES_GOOD_FOR_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10000;

// Order fields, as Tokocrypto numbers them.
const SIDE = { buy: 0, sell: 1 };
const MARKET = 2;
const FILLED = 2;

// "BTCUSDT" -> "BTC_USDT"
export function exchangeSymbol(symbol) {
  const name = String(symbol || "").toUpperCase();
  return name.endsWith("USDT") ? `${name.slice(0, -4)}_USDT` : name;
}

export function baseAsset(symbol) {
  return exchangeSymbol(symbol).split("_")[0];
}

// Decimals of a step like "0.00001000" -> 5.
function decimalsOf(step) {
  const text = String(step).replace(/0+$/, "");
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

// The largest quantity <= qty that the market accepts, as the text the API wants.
export function floorToStep(qty, step) {
  const size = Number(step);
  if (!(size > 0)) return String(qty);
  const steps = Math.floor(qty / size + 1e-9);
  return (steps * size).toFixed(decimalsOf(step));
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const sign = hmacHex;

class ExchangeError extends Error {
  constructor(message, { code = null, status = null } = {}) {
    super(message);
    this.name = "ExchangeError";
    this.code = code;
    this.status = status;
  }
}

// deps: { fetch, now, apiKey, apiSecret, base }
export function createTokocrypto({ fetch, now = () => Date.now(), apiKey = "", apiSecret = "", base = EXCHANGE_BASE } = {}) {
  let rulesCache = null;

  async function call(method, path, { params = {}, signed = false } = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
    const headers = {};
    if (signed) {
      if (!apiKey || !apiSecret) throw new ExchangeError("no API key is set for the exchange");
      query.set("timestamp", String(now()));
      query.set("recvWindow", "5000");
      query.set("signature", await hmacHex(apiSecret, query.toString().replace(/&signature=.*$/, "")));
      headers["X-MBX-APIKEY"] = apiKey;
    }
    let url = base + path;
    const init = { method, headers, signal: AbortSignal.timeout(TIMEOUT_MS) };
    if (method === "GET") {
      if ([...query.keys()].length) url += "?" + query.toString();
    } else {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = query.toString();
    }
    const response = await fetch(url, init);
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ExchangeError(`${EXCHANGE_NAME} gave an unreadable answer (HTTP ${response.status})`, { status: response.status });
    }
    if (!response.ok || body.code !== 0) {
      const why = body.msg || body.message || `HTTP ${response.status}`;
      throw new ExchangeError(`${EXCHANGE_NAME}: ${why}`, { code: body.code ?? null, status: response.status });
    }
    return body.data;
  }

  // Trading rules per market: { symbol, stepSize, minQty, minNotional, spot }
  async function allRules() {
    if (rulesCache && now() - rulesCache.at < RULES_GOOD_FOR_MS) return rulesCache.bySymbol;
    const data = await call("GET", "/open/v1/common/symbols");
    const bySymbol = {};
    for (const entry of (data && data.list) || []) {
      const filters = Object.fromEntries((entry.filters || []).map((filter) => [filter.filterType, filter]));
      const lot = filters.LOT_SIZE || {};
      const notional = filters.NOTIONAL || filters.MIN_NOTIONAL || {};
      bySymbol[entry.symbol] = {
        symbol: entry.symbol,
        stepSize: lot.stepSize || "0.00000001",
        minQty: Number(lot.minQty || 0),
        minNotional: Number(notional.minNotional || 0),
        spot: entry.spotTradingEnable === 1 || entry.spotTradingEnable === true,
      };
    }
    rulesCache = { at: now(), bySymbol };
    return bySymbol;
  }

  async function rules(symbol) {
    return (await allRules())[exchangeSymbol(symbol)] || null;
  }

  async function free(asset) {
    const data = await call("GET", "/open/v1/account/spot/asset", { params: { asset }, signed: true });
    return Number((data && data.free) || 0);
  }

  // A market order, then (if the answer is not final yet) one look at how it filled.
  async function market(symbol, side, amount) {
    const params = { symbol: exchangeSymbol(symbol), side: SIDE[side], type: MARKET, clientId: `tb${now().toString(36)}` };
    if (side === "buy") params.quoteOrderQty = amount;
    else params.quantity = amount;
    let order = await call("POST", "/open/v1/orders", { params, signed: true });
    if (order && order.status !== FILLED && Number(order.executedQty || 0) === 0 && order.orderId) {
      order = await call("GET", "/open/v1/orders/detail", { params: { orderId: order.orderId }, signed: true });
    }
    const qty = Number((order && order.executedQty) || 0);
    const quote = Number((order && order.executedQuoteQty) || 0);
    return {
      orderId: order && order.orderId,
      status: order && order.status,
      qty,
      quote,
      price: qty > 0 ? quote / qty : 0,
    };
  }

  return {
    name: EXCHANGE_NAME,
    hasKeys: !!(apiKey && apiSecret),
    rules,
    free,
    marketBuy: (symbol, quoteUsdt) => market(symbol, "buy", String(quoteUsdt)),
    marketSell: (symbol, quantity) => market(symbol, "sell", String(quantity)),
  };
}
