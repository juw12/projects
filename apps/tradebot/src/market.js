// Live prices, free and without an API key. Candles come from Binance's public market-data
// mirror; when that does not answer, from OKX. Both are read-only: nothing here can trade.

export const TIMEFRAMES = {
  "15m": { ms: 15 * 60 * 1000, okx: "15m" },
  "1h": { ms: 60 * 60 * 1000, okx: "1H" },
  "4h": { ms: 4 * 60 * 60 * 1000, okx: "4H" },
  "1d": { ms: 24 * 60 * 60 * 1000, okx: "1Dutc" },
};

const QUOTE = "USDT";

// "btc", "BTC/USDT" and "btcusdt" all mean BTCUSDT. null when it is not a market we can read.
export function normalizeSymbol(text) {
  const value = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!value) return null;
  const symbol = value.endsWith(QUOTE) ? value : value + QUOTE;
  return /^[A-Z0-9]{2,12}USDT$/.test(symbol) ? symbol : null;
}

const SOURCES = [
  {
    name: "Binance",
    max: 1000,
    url: (symbol, timeframe, limit) =>
      `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`,
    parse(data) {
      if (!Array.isArray(data)) throw new Error((data && data.msg) || "unexpected answer");
      return data.map((row) => ({ t: Number(row[0]), o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]), v: Number(row[5]) }));
    },
  },
  {
    name: "OKX",
    max: 300,
    url: (symbol, timeframe, limit) =>
      `https://www.okx.com/api/v5/market/candles?instId=${symbol.slice(0, -QUOTE.length)}-${QUOTE}&bar=${TIMEFRAMES[timeframe].okx}&limit=${limit}`,
    parse(data) {
      if (!data || data.code !== "0" || !Array.isArray(data.data)) throw new Error((data && data.msg) || "unexpected answer");
      return data.data
        .map((row) => ({ t: Number(row[0]), o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]), v: Number(row[5]) }))
        .reverse(); // OKX sends the newest candle first
    },
  },
];

export const SOURCE_NAMES = SOURCES.map((source) => source.name);

// createMarket({ fetch }) -> { candles(symbol, timeframe, limit, only?) }
export function createMarket(options = {}) {
  const send = options.fetch || ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs || 8000;

  async function read(source, symbol, timeframe, limit) {
    const response = await send(source.url(symbol, timeframe, Math.min(limit, source.max)), {
      headers: { Accept: "application/json", "User-Agent": "trade-bot" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => null);
    const candles = source.parse(data);
    const good = candles.filter((candle) => [candle.t, candle.o, candle.h, candle.l, candle.c].every(Number.isFinite) && candle.c > 0);
    if (good.length < 2 || good.length !== candles.length) throw new Error("no usable candles");
    return good;
  }

  // Oldest candle first; the last one is still forming. `only` asks one named source.
  async function candles(symbol, timeframe, limit = 300, only) {
    if (!TIMEFRAMES[timeframe]) throw new Error(`Unknown timeframe ${timeframe}.`);
    const errors = [];
    for (const source of SOURCES) {
      if (only && source.name !== only) continue;
      try {
        return { source: source.name, candles: await read(source, symbol, timeframe, limit) };
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
