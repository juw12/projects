// Stand-ins for Cloudflare, Telegram and the price sources, so the Worker's real code runs under plain Node.

// A clock the test moves by hand. Nothing in the Worker reads the real time.
// The default start is 10 minutes into a 4-hour candle.
export function makeClock(start = Date.UTC(2026, 0, 15, 4, 10)) {
  let time = start;
  const now = () => time;
  now.advance = (ms) => {
    time += ms;
    return time;
  };
  return now;
}

// Durable Object storage: keys and values, plus one alarm. Values are copied on the way in and out,
// as the real storage does, so a test cannot pass by sharing an object with the code under test.
export class FakeStorage {
  constructor() {
    this.map = new Map();
    this.alarmAt = null;
  }

  async get(key) {
    return this.map.has(key) ? structuredClone(this.map.get(key)) : undefined;
  }

  async put(key, value) {
    this.map.set(key, structuredClone(value));
  }

  async delete(key) {
    return this.map.delete(key);
  }

  async setAlarm(time) {
    this.alarmAt = Number(time);
  }

  async getAlarm() {
    return this.alarmAt;
  }

  async deleteAlarm() {
    this.alarmAt = null;
  }
}

// A Durable Object namespace: one object per name, built the first time it is asked for.
export class FakeNamespace {
  constructor(Class, env, now) {
    this.Class = Class;
    this.env = env;
    this.now = now || (() => Date.now());
    this.objects = new Map();
  }

  idFromName(name) {
    return { name, toString: () => "id:" + name };
  }

  object(name) {
    if (!this.objects.has(name)) {
      const storage = new FakeStorage();
      const instance = new this.Class({ storage, id: this.idFromName(name) }, this.env);
      this.objects.set(name, { storage, instance });
    }
    return this.objects.get(name);
  }

  get(id) {
    return {
      fetch: (input, init) => this.object(id.name).instance.fetch(new Request(input, init)),
    };
  }

  // Run every alarm that is due. Returns how many ran.
  async runAlarms() {
    let ran = 0;
    for (const entry of this.objects.values()) {
      if (entry.storage.alarmAt === null || entry.storage.alarmAt > this.now()) continue;
      entry.storage.alarmAt = null; // the platform clears an alarm before it runs it
      await entry.instance.alarm();
      ran += 1;
    }
    return ran;
  }
}

export function reply(body, init = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

// A pretend network. routes = [[urlPrefix, handler(url, init)], ...]; the first match answers.
// An address with no route gets status 599, so a test never reaches the real internet by accident.
export function fakeFetch(routes) {
  const calls = [];
  async function send(input, init = {}) {
    const url = String(typeof input === "string" ? input : input.url);
    calls.push({ url, method: init.method || "GET", body: init.body });
    for (const [prefix, handler] of routes) {
      if (url.startsWith(prefix)) return handler(url, init);
    }
    return new Response("no fake route for " + url, { status: 599 });
  }
  send.calls = calls;
  return send;
}

// Candles that zigzag up ("up") or down ("down"), the last one still forming at `now`.
// `drop` moves only the live price: 0.2 puts it 20% under the last finished close.
export function makeCandles({ now, timeframeMs, count = 300, trend = "up", start = 100, drop = 0 }) {
  const [rise, fall] = trend === "up" ? [0.01, 0.006] : [0.006, 0.01];
  const lastOpen = Math.floor(now / timeframeMs) * timeframeMs;
  const candles = [];
  let price = start;
  for (let index = 0; index < count; index++) {
    const open = price;
    price *= index % 2 === 0 ? 1 + rise : 1 - fall;
    if (index === count - 1) price = open * (1 - drop);
    candles.push({
      t: lastOpen - (count - 1 - index) * timeframeMs,
      o: open,
      h: Math.max(open, price) * 1.001,
      l: Math.min(open, price) * 0.999,
      c: price,
      v: 1000,
    });
  }
  return candles;
}

// The shape Binance sends: rows of strings, oldest first.
export function binanceRows(candles) {
  return candles.map((candle) => [candle.t, String(candle.o), String(candle.h), String(candle.l), String(candle.c), String(candle.v), candle.t + 1, "0", 0, "0", "0", "0"]);
}

// The shape OKX sends: rows of strings, newest first, inside { code, data }.
export function okxBody(candles) {
  const rows = candles.map((candle) => [String(candle.t), String(candle.o), String(candle.h), String(candle.l), String(candle.c), String(candle.v), "0", "0", "1"]);
  return { code: "0", msg: "", data: rows.reverse() };
}

// ---------------------------------------------------------------- a pretend Luno

export const LUNO_RATE = 16500; // rupiah for one USDT in the tests

// As https://api.luno.com/api/exchange/1/markets answered on 16 Nov 2026.
export const LUNO_MARKETS = [
  { market_id: "XBTIDR", trading_status: "ACTIVE", base_currency: "XBT", counter_currency: "IDR", min_volume: "0.00001", max_volume: "10.00", volume_scale: 6, price_scale: 0 },
  { market_id: "ETHIDR", trading_status: "ACTIVE", base_currency: "ETH", counter_currency: "IDR", min_volume: "0.001", max_volume: "1000.00", volume_scale: 6, price_scale: 0 },
  { market_id: "SOLIDR", trading_status: "ACTIVE", base_currency: "SOL", counter_currency: "IDR", min_volume: "0.01", max_volume: "10000.00", volume_scale: 4, price_scale: 0 },
];

// Order books shaped like the real ones that day: bitcoin tight (0.08% between the best prices),
// ETH and SOL with buyers far below the sellers.
export function lunoBooks() {
  return {
    XBTIDR: {
      asks: [{ price: "1650000000", volume: "0.05" }, { price: "1652000000", volume: "0.04" }],
      bids: [{ price: "1648680000", volume: "0.004" }, { price: "1647000000", volume: "0.003" }],
    },
    ETHIDR: {
      asks: [{ price: "60000000", volume: "0.5" }],
      bids: [{ price: "35000000", volume: "0.2" }],
    },
    SOLIDR: {
      asks: [{ price: "2188000", volume: "0.808752" }],
      bids: [{ price: "1001001", volume: "0.0256" }, { price: "1001000", volume: "0.05" }, { price: "2001", volume: "24.3632" }],
    },
  };
}

// Records every request. balances/reserved are what /balance answers; books can be changed by the
// test while it runs; pendingLooks is how often an order still reads PENDING before it is COMPLETE.
// Fees are charged the way Luno Indonesia charges a market order: coins on a buy, rupiah on a sell.
export function fakeLuno({ balances = { IDR: 1000000 }, reserved = {}, orderError = null, books = lunoBooks(), pendingLooks = 0 } = {}) {
  const requests = [];
  const placed = new Map();
  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method || "GET";
    const params = new URLSearchParams(method === "POST" ? init.body : parsed.search);
    const headers = init.headers || {};
    requests.push({ method, path: parsed.pathname, params, headers });
    if (parsed.pathname === "/api/exchange/1/markets") return reply({ markets: LUNO_MARKETS });
    if (parsed.pathname === "/api/1/orderbook_top") {
      const book = books[params.get("pair")];
      return book ? reply({ timestamp: 1, ...book }) : reply({ error: "Invalid currency pair.", error_code: "ErrInvalidPair" }, { status: 400 });
    }
    if (!headers.Authorization) return reply({ error: "Unauthorized", error_code: "ErrUnauthorized" }, { status: 401 });
    if (parsed.pathname === "/api/1/balance") {
      const wanted = String(params.get("assets") || "").split(",");
      const rows = wanted.map((asset) => ({ account_id: "1", asset, balance: String(balances[asset] || 0), reserved: String(reserved[asset] || 0), unconfirmed: "0" }));
      return reply({ balance: rows });
    }
    if (parsed.pathname === "/api/1/marketorder") {
      if (orderError) return reply({ error: orderError, error_code: "ErrInsufficientFunds" }, { status: 400 });
      const book = books[params.get("pair")];
      const id = `BX${placed.size + 1}`;
      let order;
      if (params.get("type") === "BUY") {
        const counter = Number(params.get("counter_volume"));
        const base = counter / Number(book.asks[0].price);
        order = { base, counter, fee_base: base * 0.002122, fee_counter: 0 };
      } else {
        const base = Number(params.get("base_volume"));
        const counter = base * Number(book.bids[0].price);
        order = { base, counter, fee_base: 0, fee_counter: counter * 0.003722 };
      }
      placed.set(id, { order, looks: 0 });
      return reply({ order_id: id });
    }
    if (parsed.pathname.startsWith("/api/1/orders/")) {
      const id = parsed.pathname.split("/").pop();
      const entry = placed.get(id);
      if (!entry) return reply({ error: "Order not found", error_code: "ErrOrderNotFound" }, { status: 404 });
      entry.looks += 1;
      if (entry.looks <= pendingLooks) return reply({ order_id: id, state: "PENDING", base: "0", counter: "0", fee_base: "0", fee_counter: "0" });
      const text = Object.fromEntries(Object.entries(entry.order).map(([key, value]) => [key, String(value)]));
      return reply({ order_id: id, state: "COMPLETE", ...text });
    }
    return reply({ error: "unknown path" }, { status: 404 });
  };
  return { fetch, requests, books, orders: () => requests.filter((request) => request.path === "/api/1/marketorder") };
}
