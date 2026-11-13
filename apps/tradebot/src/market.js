// Live prices, free and without an API key. Candles come from public market-data addresses of
// several exchanges; the first one that answers is used, and the one that answered last is asked
// first next time. All of them are read-only: nothing here can trade.

export const TIMEFRAMES = {
  "15m": { ms: 15 * 60 * 1000 },
  "1h": { ms: 60 * 60 * 1000 },
  "4h": { ms: 4 * 60 * 60 * 1000 },
  "1d": { ms: 24 * 60 * 60 * 1000 },
};

const QUOTE = "USDT";

// "btc", "BTC/USDT" and "btcusdt" all mean BTCUSDT. null when it is not a market we can read.
export function normalizeSymbol(text) {
  const value = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!value) return null;
  const symbol = value.endsWith(QUOTE) ? value : value + QUOTE;
  return /^[A-Z0-9]{2,12}USDT$/.test(symbol) ? symbol : null;
}

const base = (symbol) => symbol.slice(0, -QUOTE.length);
const candle = (t, o, h, l, c, v) => ({ t: Number(t), o: Number(o), h: Number(h), l: Number(l), c: Number(c), v: Number(v) });
const refuse = (reason) => {
  throw new Error(String(reason || "unexpected answer"));
};

// Every source gives candles oldest first, the last one still forming, with times in milliseconds.
// `bars` is what that exchange calls each timeframe (daily candles always start at 00:00 UTC).
// The order is what answered from Cloudflare when this was deployed (2026-11-13): Gate, Kraken
// and MEXC answered; OKX sometimes said "too many requests"; Binance refused Cloudflare (403).
const SOURCES = [
  {
    name: "Gate",
    max: 1000,
    bars: { "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d" },
    url: (symbol, bar, limit) => `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${base(symbol)}_${QUOTE}&interval=${bar}&limit=${limit}`,
    parse(data) {
      if (!Array.isArray(data)) refuse(data && (data.message || data.label));
      // [seconds, quote volume, close, high, low, open, volume]
      return data.map((row) => candle(Number(row[0]) * 1000, row[5], row[3], row[4], row[2], row[6]));
    },
  },
  {
    name: "Kraken",
    max: 720,
    bars: { "15m": 15, "1h": 60, "4h": 240, "1d": 1440 },
    url: (symbol, bar) => `https://api.kraken.com/0/public/OHLC?pair=${KRAKEN_NAMES[base(symbol)] || base(symbol)}${QUOTE}&interval=${bar}`,
    parse(data) {
      const rows = data && data.result && Object.values(data.result).find(Array.isArray);
      if (!rows) refuse(data && Array.isArray(data.error) && data.error.join(", "));
      // [seconds, open, high, low, close, average, volume]
      return rows.map((row) => candle(Number(row[0]) * 1000, row[1], row[2], row[3], row[4], row[6]));
    },
  },
  {
    name: "MEXC",
    max: 500,
    bars: { "15m": "15m", "1h": "60m", "4h": "4h", "1d": "1d" },
    url: (symbol, bar, limit) => `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${bar}&limit=${limit}`,
    parse(data) {
      if (!Array.isArray(data)) refuse(data && data.msg);
      return data.map((row) => candle(row[0], row[1], row[2], row[3], row[4], row[5]));
    },
  },
  {
    name: "OKX",
    max: 300,
    bars: { "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1Dutc" },
    url: (symbol, bar, limit) => `https://www.okx.com/api/v5/market/candles?instId=${base(symbol)}-${QUOTE}&bar=${bar}&limit=${limit}`,
    parse(data) {
      if (!data || data.code !== "0" || !Array.isArray(data.data)) refuse(data && data.msg);
      return data.data.map((row) => candle(row[0], row[1], row[2], row[3], row[4], row[5])).reverse(); // newest first
    },
  },
  {
    name: "Binance",
    max: 1000,
    bars: { "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d" },
    url: (symbol, bar, limit) => `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${bar}&limit=${limit}`,
    parse(data) {
      if (!Array.isArray(data)) refuse(data && data.msg);
      return data.map((row) => candle(row[0], row[1], row[2], row[3], row[4], row[5]));
    },
  },
];

const KRAKEN_NAMES = { BTC: "XBT", DOGE: "XDG" };

export const SOURCE_NAMES = SOURCES.map((source) => source.name);

// createMarket({ fetch }) -> { candles(symbol, timeframe, limit, only?) }
export function createMarket(options = {}) {
  const send = options.fetch || ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs || 8000;

  let lastGood = null; // the source that answered last time is asked first

  async function read(source, symbol, timeframe, limit) {
    const wanted = Math.min(limit, source.max);
    const response = await send(source.url(symbol, source.bars[timeframe], wanted), {
      headers: { Accept: "application/json", "User-Agent": "trade-bot" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => null);
    let candles;
    try {
      candles = source.parse(data).slice(-wanted);
    } catch (error) {
      throw new Error(response.ok ? error.message : `${error.message} (HTTP ${response.status})`);
    }
    const good = candles.filter((candle) => [candle.t, candle.o, candle.h, candle.l, candle.c].every(Number.isFinite) && candle.c > 0);
    if (good.length < 2 || good.length !== candles.length) throw new Error("no usable candles");
    return good;
  }

  // Oldest candle first; the last one is still forming. `only` asks one named source.
  async function candles(symbol, timeframe, limit = 300, only) {
    if (!TIMEFRAMES[timeframe]) throw new Error(`Unknown timeframe ${timeframe}.`);
    const order = only
      ? SOURCES.filter((source) => source.name === only)
      : [...SOURCES].sort((a, b) => (b.name === lastGood) - (a.name === lastGood));
    const errors = [];
    for (const source of order) {
      try {
        const answer = { source: source.name, candles: await read(source, symbol, timeframe, limit) };
        if (!only) lastGood = source.name;
        return answer;
      } catch (error) {
        errors.push(`${source.name}: ${String((error && error.message) || error).slice(0, 80)}`);
      }
    }
    throw new Error(`No price data for ${symbol} (${errors.join("; ")})`);
  }

  return { candles };
}

// The candles that are finished at `now` (the forming one is left out).
export function closedCandles(candles, timeframe, now) {
  const length = TIMEFRAMES[timeframe].ms;
  return candles.filter((candle) => candle.t + length <= now);
}
