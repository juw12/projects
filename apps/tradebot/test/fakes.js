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
