// Does the desk pick better trades than the rules alone? Replays the trading rules over past
// candles, asks the desk about every buy (a spread-out sample), and compares the trades it said
// "take" to with the ones it said "pass" to.
//
//   node tools/desk_eval.mjs --data <folder> [--fetch] [--timeframe 4h]
//        [--coins BTCUSDT,ETHUSDT] [--from 2025-05-14] [--limit 60]
//        [--backend workers-ai | ollama] [--ollama gemma3:12b] [--cache desk_cache.json]
//
// Candle files are <folder>/<SYMBOL>_<timeframe>.json, [{ t, o, h, l, c, v }] oldest first.
// --fetch downloads missing ones (3 years): Binance public market data, else Gate.
// --backend workers-ai asks the model the live desk uses (DESK_MODEL) through the Cloudflare REST
// API, with CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN from the environment.
// --backend ollama (default) asks a local Ollama model: close to, not the same as, the live desk.
// Answers are cached, so an interrupted run picks up where it stopped. With GITHUB_STEP_SUMMARY
// set, the result is also written there as a table.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESK_MODEL, deskBrief, deskMessages, parseVerdict } from "../src/desk.js";
import { COSTS, buy, equity, newPortfolio, sell } from "../src/paper.js";
import { PARAMS, computeSeries, decideAt, sizeOrder } from "../src/strategy.js";

const argv = process.argv.slice(2);
const args = {};
for (let index = 0; index < argv.length; index++) {
  if (!argv[index].startsWith("--")) continue;
  const next = argv[index + 1];
  args[argv[index].slice(2)] = next !== undefined && !next.startsWith("--") ? next : true;
}
const timeframe = args.timeframe || "4h";
const coins = String(args.coins || "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,DOGEUSDT").split(",");
const from = args.from ? Date.parse(args.from) : 0;
const limit = Number(args.limit || 60);
const backend = args.backend || "ollama";
const model = backend === "workers-ai" ? DESK_MODEL : args.ollama || "gemma3:12b";
const dataDir = args.data || "desk_data";
const cachePath = args.cache || join(dataDir, "desk_cache.json");
mkdirSync(dataDir, { recursive: true });
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

const BAR_MS = { "1h": 3600e3, "4h": 4 * 3600e3, "1d": 24 * 3600e3 };

// Three years of finished candles, oldest first.
async function download(symbol) {
  const total = Math.ceil((3 * 365 * 24 * 3600e3) / BAR_MS[timeframe]);
  let rows = [];
  try {
    let end = null;
    while (rows.length < total) {
      const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=1000${end ? `&endTime=${end}` : ""}`;
      const batch = await (await fetch(url)).json();
      if (!Array.isArray(batch) || !batch.length) break;
      rows = batch.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).concat(rows);
      end = batch[0][0] - 1;
      if (batch.length < 1000) break;
    }
  } catch (error) {
    console.error(`Binance did not answer (${error.message}); trying Gate.`);
  }
  if (rows.length < 1000) {
    rows = [];
    const pair = symbol.replace(/USDT$/, "_USDT");
    let to = Math.floor(Date.now() / 1000);
    while (rows.length < total) {
      const start = to - 999 * (BAR_MS[timeframe] / 1000);
      const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${timeframe}&from=${start}&to=${to}`;
      const batch = await (await fetch(url)).json();
      if (!Array.isArray(batch) || !batch.length) break;
      rows = batch.map((k) => ({ t: +k[0] * 1000, o: +k[5], h: +k[3], l: +k[4], c: +k[2], v: +k[6] })).concat(rows);
      to = start - 1;
    }
  }
  const unique = [...new Map(rows.map((row) => [row.t, row])).values()].sort((a, b) => a.t - b.t);
  return unique.slice(0, -1); // the newest candle is still forming
}

// Every trade the rules made on one coin, with the brief the desk would have seen at the buy.
function tradesOf(symbol, candles) {
  const series = computeSeries(candles);
  const portfolio = newPortfolio(10000);
  const trades = [];
  let order = null;
  let open = null;
  let lastExit = null;
  for (let index = PARAMS.regime; index < candles.length; index++) {
    const candle = candles[index];
    if (order && order.action === "buy" && !portfolio.positions.X) {
      const usd = sizeOrder({ equity: equity(portfolio), cash: portfolio.cash, price: candle.o, stop: order.stop, riskPct: 1, maxPositionPct: 25 });
      if (usd) {
        buy(portfolio, "X", usd, candle.o, order.stop, candle.t, COSTS);
        open = { symbol, at: candle.t, brief: order.brief };
      }
    } else if (order && order.action === "sell" && portfolio.positions.X) {
      trades.push({ ...open, pnlPct: sell(portfolio, "X", candle.o, order.why, candle.t, COSTS).pnlPct });
      lastExit = index;
    }
    order = null;
    const held = portfolio.positions.X;
    if (held && candle.l <= held.stop) {
      trades.push({ ...open, pnlPct: sell(portfolio, "X", Math.min(candle.o, held.stop), "stop", candle.t, COSTS).pnlPct });
      lastExit = index;
    }
    const position = portfolio.positions.X || null;
    const decision = decideAt(series, index, { position, barsSinceExit: lastExit === null ? null : index - lastExit });
    if (position && decision.stop) position.stop = decision.stop;
    if (decision.action === "buy" && !position) order = { ...decision, brief: deskBrief(candles, series, index, decision.stop, timeframe) };
    else if (decision.action === "sell") order = decision;
  }
  return trades;
}

async function askOllama(brief) {
  const response = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: deskMessages(brief), stream: false, format: "json", options: { temperature: 0, num_predict: 400 } }),
  });
  const data = await response.json();
  return parseVerdict(data.message && data.message.content);
}

async function askWorkersAi(brief) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error("--backend workers-ai needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: deskMessages(brief), max_tokens: 400, temperature: 0 }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(`Workers AI said ${response.status}: ${JSON.stringify(data.errors || data).slice(0, 300)}`);
  const result = data.result || {};
  return parseVerdict(typeof result.response === "string" ? result.response : JSON.stringify(result.response || result));
}

const ask = backend === "workers-ai" ? askWorkersAi : askOllama;

const all = [];
for (const symbol of coins) {
  const file = join(dataDir, `${symbol}_${timeframe}.json`);
  if (!existsSync(file) && args.fetch) writeFileSync(file, JSON.stringify(await download(symbol)));
  const candles = JSON.parse(readFileSync(file, "utf8"));
  all.push(...tradesOf(symbol, candles).filter((trade) => trade.at >= from));
}
all.sort((a, b) => a.at - b.at);

// An even spread over the period when there are more trades than the limit.
const step = Math.max(1, all.length / limit);
const sample = [];
for (let position = 0; position < all.length && sample.length < limit; position += step) sample.push(all[Math.floor(position)]);

// Workers AI answers in seconds, so 4 at a time; a local model one at a time.
const parallel = backend === "workers-ai" ? 4 : 1;
for (let start = 0; start < sample.length; start += parallel) {
  await Promise.all(
    sample.slice(start, start + parallel).map(async (trade) => {
      const key = `${model}|${trade.symbol}|${trade.at}`;
      if (!cache[key]) {
        const started = Date.now();
        cache[key] = (await ask(trade.brief)) || { verdict: "none" };
        const day = new Date(trade.at).toISOString().slice(0, 10);
        console.error(`${trade.symbol} ${day}: desk ${cache[key].verdict}, trade ${trade.pnlPct.toFixed(1)}% (${((Date.now() - started) / 1000).toFixed(1)} s)`);
      }
      trade.desk = cache[key];
    }),
  );
  writeFileSync(cachePath, JSON.stringify(cache, null, 1));
}

const summary = (rows) => ({
  trades: rows.length,
  winRatePct: rows.length ? (100 * rows.filter((row) => row.pnlPct > 0).length) / rows.length : 0,
  averagePct: rows.length ? rows.reduce((sum, row) => sum + row.pnlPct, 0) / rows.length : 0,
  totalPct: rows.reduce((sum, row) => sum + row.pnlPct, 0),
});
const result = {
  model,
  backend,
  timeframe,
  coins,
  from: args.from || null,
  tradesInPeriod: all.length,
  asked: sample.length,
  all: summary(sample),
  take: summary(sample.filter((trade) => trade.desk.verdict === "take")),
  pass: summary(sample.filter((trade) => trade.desk.verdict === "pass")),
  unanswered: sample.filter((trade) => trade.desk.verdict === "none").length,
};
console.log(JSON.stringify(result, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const row = (label, group) =>
    `| ${label} | ${group.trades} | ${group.winRatePct.toFixed(0)}% | ${group.averagePct.toFixed(2)}% | ${group.totalPct.toFixed(1)}% |`;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `### Desk check: ${model}, ${timeframe} candles, ${result.asked} of ${result.tradesInPeriod} trades since ${result.from || "the start"}`,
      "",
      "| trades | count | won | average | total |",
      "|---|---|---|---|---|",
      row("all the rules took", result.all),
      row("desk said take", result.take),
      row("desk said pass", result.pass),
      "",
      `Unanswered: ${result.unanswered}. The desk helps only if "take" clearly beats "pass" over many trades.`,
      "",
    ].join("\n"),
  );
}
