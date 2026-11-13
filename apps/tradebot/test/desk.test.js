import assert from "node:assert/strict";
import { test } from "node:test";

import { TICK_MS, newState, tick } from "../src/agent.js";
import { handleUpdate } from "../src/bot.js";
import { DESK_MODEL, convene, deskMessages, deskRecord, parseVerdict } from "../src/desk.js";
import { createWorker } from "../src/index.js";
import { TIMEFRAMES } from "../src/market.js";
import { FakeNamespace, makeCandles, makeClock } from "./fakes.js";

const GOOD = {
  bull: "Price is well above its long average and momentum is rising.",
  bear: "It already ran up a lot this week, so it may pause.",
  risk: "The stop is about 6% away, sensible for a coin this jumpy.",
  verdict: "take",
  confidence: 4,
};

// A pretend Workers AI: `answer` is what run() returns, or a function of (model, inputs).
function fakeAi(answer) {
  const calls = [];
  return {
    calls,
    async run(model, inputs) {
      calls.push({ model, inputs });
      return typeof answer === "function" ? answer(model, inputs) : answer;
    },
  };
}

const brief = {
  timeframe: "4h",
  aboveLongAveragePct: 8,
  fastOverSlowPct: 2,
  rsi: 61,
  moveLastCandlePct: 1,
  moveLastDayPct: 3,
  moveLastWeekPct: 9,
  moveLastMonthPct: 15,
  belowRecentHighPct: 1,
  candleRangePct: 2,
  stopDistancePct: 6,
  volumeVsAverage: 1.3,
};

test("the desk's answer is read only when it is complete and says take or pass", () => {
  assert.deepEqual(parseVerdict(JSON.stringify(GOOD)), GOOD);
  assert.equal(parseVerdict(`Sure! Here is our view:\n${JSON.stringify(GOOD)}\nThanks.`).verdict, "take");
  assert.equal(parseVerdict(JSON.stringify({ ...GOOD, verdict: "PASS" })).verdict, "pass");
  assert.equal(parseVerdict(JSON.stringify({ ...GOOD, confidence: 11 })).confidence, 5);
  assert.equal(parseVerdict(JSON.stringify({ ...GOOD, verdict: "maybe" })), null);
  assert.equal(parseVerdict(JSON.stringify({ ...GOOD, bear: "" })), null);
  assert.equal(parseVerdict("no json at all"), null);
  assert.equal(parseVerdict("{broken"), null);
});

test("the desk is asked about numbers only: no coin name, no date", () => {
  const text = deskMessages(brief).map((message) => message.content).join("\n");
  assert.match(text, /Bull/);
  assert.match(text, /RSI\(14\): 61/);
  assert.doesNotMatch(text, /BTC|ETH|SOL|USDT|20\d\d/);
});

test("convene returns the verdict, and stays quiet on errors, nonsense or a slow answer", async () => {
  const ai = fakeAi({ response: JSON.stringify(GOOD) });
  const verdict = await convene(ai, brief);
  assert.equal(verdict.verdict, "take");
  assert.equal(verdict.model, DESK_MODEL);
  assert.equal(ai.calls[0].model, DESK_MODEL);
  assert.equal(ai.calls[0].inputs.temperature, 0);

  assert.equal((await convene(fakeAi({ choices: [{ message: { content: JSON.stringify(GOOD) } }] }), brief)).verdict, "take");
  assert.equal(await convene(fakeAi({ response: "I cannot help with trading." }), brief), null);
  assert.equal(await convene(fakeAi(() => Promise.reject(new Error("AI is down"))), brief), null);
  assert.equal(await convene(fakeAi(() => new Promise(() => {})), brief, { timeoutMs: 20 }), null);
  assert.equal(await convene(null, brief), null);
});

test("the desk's record splits sold trades by what it said", () => {
  const record = deskRecord([
    { verdict: "take", pnlPct: 4 },
    { verdict: "take", pnlPct: -2 },
    { verdict: "pass", pnlPct: -3 },
    { verdict: "pass" },
  ]);
  assert.equal(record.asked, 4);
  assert.equal(record.closed, 3);
  assert.deepEqual(record.take, { count: 2, wins: 1, averagePct: 1 });
  assert.deepEqual(record.pass, { count: 1, wins: 0, averagePct: -3 });
});

// ---------------------------------------------------------------- inside the agent

function fakeMarket(scene, now) {
  return {
    async candles(symbol, timeframe, limit = 300) {
      if (!scene[symbol]) throw new Error("no such market");
      return { source: "Fake", candles: makeCandles({ now: now(), timeframeMs: TIMEFRAMES[timeframe].ms, count: limit, ...scene[symbol] }) };
    },
  };
}

function setup(ai) {
  const now = makeClock();
  const state = newState();
  state.settings.watchlist = ["BTCUSDT"];
  const scene = { BTCUSDT: { trend: "up" } };
  const market = fakeMarket(scene, now);
  const round = async () => (await tick(state, { market, now: now(), ai })).map((message) => message.html);
  return { now, state, scene, market, round };
}

test("a buy carries the desk's three voices, and the sale scores the desk", async () => {
  const ai = fakeAi({ response: JSON.stringify(GOOD) });
  const { now, state, scene, round } = setup(ai);
  const [bought] = await round();
  assert.match(bought, /Bought BTC/);
  assert.match(bought, /Desk<\/b> \(second opinion; the 3 checks decide, not the desk\): <b>take it<\/b>, 4\/5 sure/);
  assert.match(bought, /🐂 Bull: Price is well above/);
  assert.match(bought, /🐻 Bear: /);
  assert.match(bought, /🛡 Risk: /);
  assert.equal(state.deskLog.length, 1);
  assert.equal(state.deskLog[0].taken, true);
  assert.equal(ai.calls.length, 1);

  scene.BTCUSDT.drop = 0.2; // the stop is hit
  now.advance(TICK_MS);
  const [sold] = await round();
  assert.match(sold, /Sold BTC/);
  assert.ok(state.deskLog[0].pnlPct < 0, "the desk's call is scored with the trade's result");
});

test("without the desk, or when it fails, the agent trades exactly the same", async () => {
  const plain = setup(null);
  const broken = setup(fakeAi(() => Promise.reject(new Error("down"))));
  const off = setup(fakeAi({ response: JSON.stringify(GOOD) }));
  off.state.settings.desk = false;

  const [a] = await plain.round();
  const [b] = await broken.round();
  const [c] = await off.round();
  for (const html of [a, b, c]) {
    assert.match(html, /Bought BTC/);
    assert.doesNotMatch(html, /Desk/);
  }
  assert.equal(plain.state.portfolio.positions.BTCUSDT.cost, broken.state.portfolio.positions.BTCUSDT.cost);
  assert.equal(plain.state.portfolio.positions.BTCUSDT.cost, off.state.portfolio.positions.BTCUSDT.cost);
  assert.equal(off.state.deskLog.length, 0);
});

test("in ask mode the offer shows the desk, and approving keeps the link to it", async () => {
  const ai = fakeAi({ response: JSON.stringify({ ...GOOD, verdict: "pass", confidence: 2 }) });
  const { now, state, market, round } = setup(ai);
  state.settings.auto = false;
  const [offer] = await round();
  assert.match(offer, /Buy BTC\?/);
  assert.match(offer, /<b>pass on it<\/b>, 2\/5 sure/);

  const result = await handleUpdate(
    { state, market, now: now() },
    { callback_query: { id: "1", data: "ok:BTCUSDT", message: { message_id: 5, chat: { id: 1 } } } },
  );
  assert.match(result.messages[0].html, /Bought BTC/);
  assert.match(result.messages[0].html, /pass on it/);
  assert.equal(state.deskLog[0].taken, true);
  assert.equal(state.portfolio.positions.BTCUSDT.deskAt, state.deskLog[0].at);
});

test("/desk shows the record and turns the desk off and on", async () => {
  const state = newState();
  const ctx = { state, market: null, now: Date.now() };
  const ask = async (text) => (await handleUpdate(ctx, { message: { text } })).messages[0].html;

  assert.match(await ask("/desk"), /The desk<\/b> is <b>on<\/b>/);
  assert.match(await ask("/desk"), /Too few sold trades/);
  assert.match(await ask("/desk off"), /is <b>off<\/b>/);
  assert.equal(state.settings.desk, false);
  assert.match(await ask("/help"), /Desk \(off\)/);
  assert.match(await ask("/desk on"), /is <b>on<\/b>/);
  assert.equal(state.settings.desk, true);
});

test("GET /v1/desk asks the live desk one sample question and keeps a good answer", async () => {
  const now = makeClock();
  const ai = fakeAi({ response: JSON.stringify(GOOD) });
  const { worker, Trader } = createWorker({ fetch: async () => new Response("{}"), now, ai });
  const env = { BUILD: "test", SETUP_CODE_SHA256: "0".repeat(64) };
  env.TRADER = new FakeNamespace(Trader, env, now);
  const look = async () => (await worker.fetch(new Request("https://trade-bot.test/v1/desk"), env)).json();

  const first = await look();
  assert.equal(first.ok, true);
  assert.equal(first.verdict, "take");
  assert.equal(first.model, DESK_MODEL);
  await look();
  assert.equal(ai.calls.length, 1, "a second look within 6 hours does not ask again");

  const { worker: quiet, Trader: QuietTrader } = createWorker({ fetch: async () => new Response("{}"), now, ai: null });
  const quietEnv = { BUILD: "test", SETUP_CODE_SHA256: "0".repeat(64) };
  quietEnv.TRADER = new FakeNamespace(QuietTrader, quietEnv, now);
  const none = await (await quiet.fetch(new Request("https://trade-bot.test/v1/desk"), quietEnv)).json();
  assert.equal(none.ok, false);
  assert.match(none.error, /no Workers AI binding/);
});
