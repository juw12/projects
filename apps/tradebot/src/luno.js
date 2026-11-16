// Luno, the exchange for real money in rupiah: licensed in Indonesia, answers Cloudflare, and
// trades coins straight against rupiah (XBTIDR), so no USDT has to be bought first.
// Docs: https://www.luno.com/en/developers/api
//
// The books of the bot stay in USDT, so this adapter speaks USDT to the rest of the code and
// rupiah to Luno, with the bot's own rupiah rate in between. Every answer also carries the plain
// rupiah numbers ("native"), so a real trade's profit is worked out in the money it happened in.
//
// Luno's rupiah markets are thin. On 16 Nov 2026 BTC had a 0.08% gap between the buying and the
// selling price, ETH 52% and SOL 74%. So rules() reads the order book and reports that gap for the
// size about to be traded; live.js refuses a copy when it is too wide.
//
// The same four things as Tokocrypto are asked of it: the rules of a market, the free balance,
// a market buy for an amount of money and a market sell for a quantity. Nothing here can
// withdraw: the API key should not have that permission at all.
//
// The order calls follow Luno's documentation and are covered by a pretend Luno in the tests.
// They have not met the real exchange yet, because that needs a funded account.

import { USER_AGENT } from "./util.js";

export const LUNO_NAME = "Luno";
export const LUNO_BASE = "https://api.luno.com";
const MARKETS_GOOD_FOR_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10000;
const FILL_LOOKS = 3; // how often a market order is looked at before its fill is taken as it is
const FILL_WAIT_MS = 700;

// What Luno Indonesia charges a market order, tax included (its fee page, November 2026).
// Only the rehearsal uses these; a real fill carries the fee Luno really took.
export const LUNO_TAKER_FEES = { buy: 0.002122, sell: 0.003722 };

// "BTCUSDT" -> "XBTIDR": Luno calls bitcoin XBT and prices everything here in rupiah.
export function lunoAsset(asset) {
  const name = String(asset || "").toUpperCase();
  return name === "BTC" ? "XBT" : name;
}

export function lunoPair(symbol) {
  const name = String(symbol || "").toUpperCase();
  return lunoAsset(name.endsWith("USDT") ? name.slice(0, -4) : name) + "IDR";
}

// The average price of trading `money` (in rupiah) into one side of the book, best price first.
// With no money it is the best price. null when the book does not hold that much.
export function averagePrice(levels, money) {
  let spent = 0;
  let coins = 0;
  for (const level of levels || []) {
    const price = Number(level.price);
    const volume = Number(level.volume);
    if (!(price > 0) || !(volume > 0)) continue;
    if (!(money > 0)) return price;
    const take = Math.min(volume, (money - spent) / price);
    spent += take * price;
    coins += take;
    if (spent >= money - 1e-6) return spent / coins;
  }
  return null;
}

// deps: { fetch, now, keyId, secret, rate, wait, base }. rate() is rupiah for one USDT, or null.
export function createLuno({
  fetch,
  now = () => Date.now(),
  keyId = "",
  secret = "",
  rate = () => null,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  base = LUNO_BASE,
} = {}) {
  let marketsCache = null;

  function rupiahPerUsdt() {
    const value = Number(rate());
    if (!(value > 0)) throw new Error("no rupiah rate is known yet, so a rupiah order cannot be sized");
    return value;
  }

  async function call(method, path, { params = {}, signed = false } = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
    const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
    if (signed) {
      if (!keyId || !secret) throw new Error("no API key is set for the exchange");
      headers.Authorization = "Basic " + btoa(`${keyId}:${secret}`);
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
      throw new Error(`${LUNO_NAME} gave an unreadable answer (HTTP ${response.status})`);
    }
    if (!response.ok || (body && body.error)) {
      throw new Error(`${LUNO_NAME}: ${(body && body.error) || `HTTP ${response.status}`}`);
    }
    return body;
  }

  async function markets() {
    if (marketsCache && now() - marketsCache.at < MARKETS_GOOD_FOR_MS) return marketsCache.byPair;
    const data = await call("GET", "/api/exchange/1/markets");
    const byPair = {};
    for (const entry of (data && data.markets) || []) byPair[entry.market_id] = entry;
    marketsCache = { at: now(), byPair };
    return byPair;
  }

  // The rules of one market plus what its order book says right now, for an order of sizeUsdt:
  // { symbol, stepSize, minQty, minNotional, spot, ask, bid, spreadPercent, thin, fees, native }.
  // Prices and amounts are in USDT; native holds the same in rupiah.
  async function rules(symbol, sizeUsdt = 0) {
    const perUsdt = rupiahPerUsdt();
    const pair = lunoPair(symbol);
    const market = (await markets())[pair];
    if (!market) return null;
    const book = await call("GET", "/api/1/orderbook_top", { params: { pair } });
    const money = Math.max(0, Number(sizeUsdt) || 0) * perUsdt;
    const bestAsk = averagePrice(book.asks, 0);
    const bestBid = averagePrice(book.bids, 0);
    const ask = averagePrice(book.asks, money);
    const bid = averagePrice(book.bids, money);
    const thin = !(ask > 0 && bid > 0);
    const scale = Number(market.volume_scale) || 0;
    const minQty = Number(market.min_volume) || 0;
    return {
      symbol: pair,
      stepSize: (10 ** -scale).toFixed(scale),
      minQty,
      minNotional: bestAsk ? (minQty * bestAsk) / perUsdt : 0,
      spot: market.trading_status === "ACTIVE" && !!bestAsk && !!bestBid,
      ask: thin ? null : ask / perUsdt,
      bid: thin ? null : bid / perUsdt,
      spreadPercent: thin ? null : ((ask - bid) / ((ask + bid) / 2)) * 100,
      thin,
      fees: LUNO_TAKER_FEES,
      native: { asset: "IDR", rate: perUsdt, ask: thin ? null : ask, bid: thin ? null : bid },
    };
  }

  // What is free to trade with of one asset ("IDR", "BTC", ...), in that asset.
  async function free(asset) {
    const code = lunoAsset(asset);
    const data = await call("GET", "/api/1/balance", { params: { assets: code }, signed: true });
    return ((data && data.balance) || [])
      .filter((account) => account.asset === code)
      .reduce((sum, account) => sum + Number(account.balance || 0) - Number(account.reserved || 0), 0);
  }

  // A market order, then a look (or a few) at how it filled. Luno takes its fee from what the
  // order receives: coins on a buy, rupiah on a sell.
  async function market(symbol, side, amount) {
    const perUsdt = rupiahPerUsdt();
    const params = { pair: lunoPair(symbol), type: side === "buy" ? "BUY" : "SELL", client_order_id: `tb${now().toString(36)}` };
    if (side === "buy") params.counter_volume = String(Math.floor(amount * perUsdt)); // whole rupiah
    else params.base_volume = String(amount);
    const sent = await call("POST", "/api/1/marketorder", { params, signed: true });
    if (!sent || !sent.order_id) throw new Error(`${LUNO_NAME} did not give an order number`);
    let order = null;
    for (let look = 0; look < FILL_LOOKS; look++) {
      if (look) await wait(FILL_WAIT_MS);
      order = await call("GET", `/api/1/orders/${encodeURIComponent(sent.order_id)}`, { signed: true });
      if (order.state === "COMPLETE") break;
    }
    const coins = Number(order.base || 0);
    const rupiah = Number(order.counter || 0);
    const qty = side === "buy" ? coins - Number(order.fee_base || 0) : coins;
    const paid = side === "buy" ? rupiah + Number(order.fee_counter || 0) : rupiah - Number(order.fee_counter || 0);
    return {
      orderId: sent.order_id,
      status: order.state,
      qty,
      quote: paid / perUsdt,
      price: qty > 0 ? paid / perUsdt / qty : 0,
      native: { asset: "IDR", quote: paid, price: qty > 0 ? paid / qty : 0 },
    };
  }

  return {
    name: LUNO_NAME,
    quote: "IDR",
    hasKeys: !!(keyId && secret),
    rules,
    free,
    freeQuote: async () => (await free("IDR")) / rupiahPerUsdt(),
    marketBuy: (symbol, quoteUsdt) => market(symbol, "buy", Number(quoteUsdt)),
    marketSell: (symbol, quantity) => market(symbol, "sell", quantity),
  };
}
