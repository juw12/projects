// The desk: a second opinion before every buy, in the style of TradingAgents (TauricResearch).
// Three voices argue over the same numbers - a Bull, a Bear and a Risk manager - and give one
// verdict: "take" or "pass". One call to Workers AI, free on the Cloudflare plan.
//
// The desk ADVISES. It never places, blocks or sizes a trade: the rules in strategy.js decide.
// It only sees numbers the rules already computed (no coin name, no date), so a model cannot
// "remember" how that day went, and the backtest in tools/desk_eval.mjs replays it honestly.
// When Workers AI is slow, down or answers nonsense, the desk stays quiet and trading goes on.

export const DESK_MODEL = "@cf/google/gemma-3-12b-it";
export const DESK_TIMEOUT_MS = 25000;
export const MAX_DESK_LOG = 60;

// A typical setup, used by GET /v1/desk to check that the live desk answers.
export const SAMPLE_BRIEF = {
  timeframe: "4h",
  aboveLongAveragePct: 6.2,
  fastOverSlowPct: 1.4,
  rsi: 61,
  moveLastCandlePct: 0.8,
  moveLastDayPct: 2.1,
  moveLastWeekPct: 5.5,
  moveLastMonthPct: 9.8,
  belowRecentHighPct: 1.2,
  candleRangePct: 1.9,
  stopDistancePct: 5.7,
  volumeVsAverage: 1.2,
};

const pct = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

// The facts the desk argues over, all from finished candles up to `index`.
export function deskBrief(candles, series, index, stop, timeframe = "4h") {
  const close = series.closes[index];
  const back = (count) => {
    const then = series.closes[Math.max(0, index - count)];
    return ((close - then) / then) * 100;
  };
  const window = candles.slice(Math.max(0, index - 49), index + 1);
  const high = Math.max(...window.map((candle) => candle.h));
  const volumes = candles.slice(Math.max(0, index - 19), index + 1).map((candle) => candle.v || 0);
  const averageVolume = volumes.reduce((sum, value) => sum + value, 0) / (volumes.length || 1);
  const perDay = { "15m": 96, "1h": 24, "4h": 6, "1d": 1 }[timeframe] || 6;
  return {
    timeframe,
    aboveLongAveragePct: ((close - series.regime[index]) / series.regime[index]) * 100,
    fastOverSlowPct: ((series.fast[index] - series.slow[index]) / series.slow[index]) * 100,
    rsi: series.rsi[index],
    moveLastCandlePct: back(1),
    moveLastDayPct: back(perDay),
    moveLastWeekPct: back(perDay * 7),
    moveLastMonthPct: back(perDay * 30),
    belowRecentHighPct: ((high - close) / high) * 100,
    candleRangePct: (series.atr[index] / close) * 100,
    stopDistancePct: ((close - stop) / close) * 100,
    volumeVsAverage: averageVolume > 0 ? (candles[index].v || 0) / averageVolume : 1,
  };
}

const SYSTEM = [
  "You are a small crypto trading desk reviewing ONE proposed long (buy) trade on spot.",
  "Three people speak, each in one plain sentence of at most 25 words, no jargon, no hype:",
  "Bull: the strongest honest case for buying now.",
  "Bear: the strongest honest case against buying now.",
  "Risk: what could go wrong and whether the stop distance is sensible.",
  "Then decide together: verdict \"take\" or \"pass\", and confidence 1 (unsure) to 5 (sure).",
  "Judge only the numbers given. Never invent news, prices, dates or coin names.",
  'Answer with JSON only: {"bull":"...","bear":"...","risk":"...","verdict":"take","confidence":3}',
].join("\n");

export function deskMessages(brief) {
  const lines = [
    `Proposed: buy now, sell if the price falls ${brief.stopDistancePct.toFixed(1)}% (the stop), or when the trend turns.`,
    `Candles: ${brief.timeframe}.`,
    `Price vs its 200-candle average: ${pct(brief.aboveLongAveragePct)}.`,
    `20-candle average vs 50-candle average: ${pct(brief.fastOverSlowPct)}.`,
    `RSI(14): ${brief.rsi.toFixed(0)}.`,
    `Moves: last candle ${pct(brief.moveLastCandlePct)}, last day ${pct(brief.moveLastDayPct)}, last week ${pct(brief.moveLastWeekPct)}, last month ${pct(brief.moveLastMonthPct)}.`,
    `Below the highest price of the last 50 candles by ${brief.belowRecentHighPct.toFixed(1)}%.`,
    `A typical candle moves ${brief.candleRangePct.toFixed(1)}%.`,
    `Volume of the last candle: ${brief.volumeVsAverage.toFixed(1)}x its 20-candle average.`,
  ];
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: lines.join("\n") },
  ];
}

const sentence = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 220);

// The verdict from the model's text, or null when it is not a usable answer.
export function parseVerdict(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const verdict = String(data.verdict || "").toLowerCase().trim();
  if (verdict !== "take" && verdict !== "pass") return null;
  const bull = sentence(data.bull);
  const bear = sentence(data.bear);
  const risk = sentence(data.risk);
  if (!bull || !bear || !risk) return null;
  const confidence = Math.min(5, Math.max(1, Math.round(Number(data.confidence) || 3)));
  return { bull, bear, risk, verdict, confidence };
}

// What Workers AI returned, as text, whatever shape the model answers in.
function answerText(result) {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (result.response && typeof result.response === "object") return JSON.stringify(result.response);
  const choice = result.choices && result.choices[0];
  if (choice && choice.message && typeof choice.message.content === "string") return choice.message.content;
  return "";
}

// Ask the desk. Resolves to { bull, bear, risk, verdict, confidence, model } or null; never throws.
export async function convene(ai, brief, { model = DESK_MODEL, timeoutMs = DESK_TIMEOUT_MS } = {}) {
  if (!ai || typeof ai.run !== "function" || !brief) return null;
  let timer;
  try {
    const call = ai.run(model, { messages: deskMessages(brief), max_tokens: 400, temperature: 0 });
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const verdict = parseVerdict(answerText(await Promise.race([call, late])));
    return verdict ? { ...verdict, model } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The desk's track record: how the trades it said "take" to did against the ones it said "pass" to.
// `log` holds { symbol, at, verdict, confidence, taken, pnlPct (once sold) }.
export function deskRecord(log) {
  const closed = (log || []).filter((entry) => typeof entry.pnlPct === "number");
  const group = (verdict) => {
    const rows = closed.filter((entry) => entry.verdict === verdict);
    const total = rows.reduce((sum, entry) => sum + entry.pnlPct, 0);
    return {
      count: rows.length,
      wins: rows.filter((entry) => entry.pnlPct > 0).length,
      averagePct: rows.length ? total / rows.length : 0,
    };
  };
  return { asked: (log || []).length, closed: closed.length, take: group("take"), pass: group("pass") };
}
