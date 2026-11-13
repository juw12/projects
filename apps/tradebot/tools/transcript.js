// Plays one fixed conversation against the real Worker and writes down what the owner would see
// in Telegram. Telegram, the price sources and the clock are stand-ins (test/fakes.js); every bot
// message is the Worker's own output. The prices are scripted, not market data.
//
//   node tools/transcript.js              print the conversation
//   node tools/transcript.js --out FILE   write it to a file
//
// test/transcript.test.js plays the same conversation and checks every message.

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createWorker } from "../src/index.js";
import { TIMEFRAMES } from "../src/market.js";
import { sha256Hex } from "../src/util.js";
import { FakeNamespace, fakeFetch, makeClock, reply } from "../test/fakes.js";

const TOKEN = "123456789:AAfake_token_for_the_transcript_0123456";
const SETUP_CODE = "transcript-only";
const HOST = "https://trade-bot.test";
const OWNER = 111;
const STRANGER = 222;
const MINUTE = 60 * 1000;
const CANDLE = TIMEFRAMES["4h"].ms;
const START = Date.UTC(2026, 0, 15, 4, 10); // Thursday 15 Jan 2026, 11:10 WIB
const WIB = 7 * 60 * MINUTE;

// ------------------------------------------------------------------ scripted prices

// How a market moves per 4-hour candle, as [even candle, odd candle] changes.
const MOVES = {
  up: [0.008, -0.006],
  down: [0.006, -0.008],
  slide: [0.004, -0.014],
  flat: [0.005, -0.005],
};

// Each market: its price when the conversation starts, how wide its candles are, and a script of
// [from (UTC), move]. A number as the move is one single candle (-0.09 = a 9% fall).
const quiet = [
  [-Infinity, "flat"],
  ["2025-08-20T00:00Z", "up"],
  ["2025-09-25T00:00Z", "down"],
  ["2025-10-20T00:00Z", "flat"],
];
const MARKETS = {
  BTCUSDT: { price: 96400, wick: 0.001, script: [...quiet, ["2025-11-26T00:00Z", "up"], ["2026-01-15T08:00Z", -0.09], ["2026-01-15T12:00Z", "down"]] },
  ETHUSDT: { price: 3310, wick: 0.001, script: [...quiet, ["2025-11-26T00:00Z", "down"]] },
  SOLUSDT: { price: 188, wick: 0.001, script: [...quiet, ["2025-11-26T00:00Z", "down"]] },
  DOGEUSDT: { price: 0.362, wick: 0.001, script: [...quiet, ["2025-11-26T00:00Z", "up"]] },
  XRPUSDT: { price: 2.94, wick: 0.03, script: [...quiet, ["2025-11-26T00:00Z", "up"], ["2026-01-16T00:00Z", "slide"]] },
  ADAUSDT: { price: 0.981, wick: 0.001, script: [...quiet, ["2025-11-26T00:00Z", "up"]] },
};

const candleIndex = (time) => Math.floor(time / CANDLE);

// The closing price of every candle of one market, by candle index.
function closesOf(market) {
  const first = candleIndex(START) - 1300;
  const last = candleIndex(START) + 60;
  const script = market.script.map(([from, move]) => [from === -Infinity ? -Infinity : Date.parse(from), move]);
  const closes = new Map();
  let price = 1;
  for (let index = first; index <= last; index++) {
    const time = index * CANDLE;
    let move = "flat";
    for (const [from, name] of script) {
      if (time >= from) move = name;
    }
    price *= 1 + (typeof move === "number" ? move : MOVES[move][Math.abs(index) % 2]);
    closes.set(index, price);
  }
  const scale = market.price / closes.get(candleIndex(START) - 1);
  for (const [index, value] of closes) closes.set(index, value * scale);
  return closes;
}

const CLOSES = Object.fromEntries(Object.entries(MARKETS).map(([symbol, market]) => [symbol, closesOf(market)]));

// Candles oldest first; the last one is still forming and moves steadily towards its close.
function candlesOf(symbol, limit, now) {
  const closes = CLOSES[symbol];
  const { wick } = MARKETS[symbol];
  const live = candleIndex(now);
  const rows = [];
  for (let index = live - limit + 1; index <= live; index++) {
    const open = closes.get(index - 1);
    let close = closes.get(index);
    let reach = wick;
    if (index === live) {
      const done = (now - index * CANDLE) / CANDLE;
      close = open * Math.pow(close / open, done);
      reach = wick * done;
    }
    rows.push({ t: index * CANDLE, o: open, h: Math.max(open, close) * (1 + reach), l: Math.min(open, close) * (1 - reach), c: close, v: 1000 });
  }
  return rows;
}

// ------------------------------------------------------------------ what Telegram shows

// Telegram HTML as readable text: bold as **bold**, italics as _italics_, code as `code`.
export function shown(html) {
  return String(html)
    .replace(/<\/?b>/g, "**")
    .replace(/<\/?i>/g, "_")
    .replace(/<\/?code>/g, "`")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// What Telegram hands back as message.text: the text without any markup.
function plain(html) {
  return String(html)
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function wibClock(time) {
  const date = new Date(time + WIB);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
  const two = (value) => String(value).padStart(2, "0");
  return `${day} ${date.getUTCDate()} Jan, ${two(date.getUTCHours())}:${two(date.getUTCMinutes())} WIB`;
}

// ------------------------------------------------------------------ the conversation

// Returns { markdown, messages, state, seen }.
//   messages  every text the bot sent or edited: { html, buttons, kind: "message" | "edit" | "popup" }
//   state     the practice account as stored at the end
//   seen      facts collected on the way: exit reasons, offers waiting, outage, days, unanswered commands
export async function play() {
  const now = makeClock(START);
  const network = { down: false };
  const lines = [];
  const messages = [];
  const byId = new Map();
  let waiting = []; // what the bot did since the last line was written
  let nextMessageId = 100;

  const unknown = {
    "https://api.gateio.ws/": (pair) => reply({ label: "INVALID_CURRENCY_PAIR", message: `Invalid currency pair ${pair}` }, { status: 400 }),
    "https://api.kraken.com/": () => reply({ error: ["EQuery:Unknown asset pair"] }),
    "https://api.mexc.com/": () => reply({ code: -1121, msg: "Invalid symbol." }, { status: 400 }),
    "https://www.okx.com/": () => reply({ code: "51001", msg: "Instrument ID, Instrument family or Instrument type doesn't exist.", data: [] }),
    "https://data-api.binance.vision/": () => reply({ code: -1121, msg: "Invalid symbol." }, { status: 400 }),
  };
  const exchangeRoutes = Object.entries(unknown).map(([prefix, refuse]) => [
    prefix,
    (url) => {
      if (network.down) return new Response("<html><h1>503 Service Temporarily Unavailable</h1></html>", { status: 503 });
      const query = new URL(url).searchParams;
      const pair = query.get("currency_pair") || "";
      const symbol = pair.replace("_", "");
      if (!prefix.includes("gateio") || !MARKETS[symbol] || query.get("interval") !== "4h") return refuse(pair);
      const rows = candlesOf(symbol, Number(query.get("limit")), now());
      // Gate's shape: [seconds, quote volume, close, high, low, open, volume], as strings.
      return reply(rows.map((row) => [String(row.t / 1000), "0", String(row.c), String(row.h), String(row.l), String(row.o), String(row.v)]));
    },
  ]);

  const fetch = fakeFetch([
    [
      `https://api.telegram.org/bot${TOKEN}/`,
      (url, init) => {
        const method = url.split("/").pop();
        const body = JSON.parse(init.body);
        if (method === "getMe") return reply({ ok: true, result: { id: 999, username: "juwen_trade_bot", first_name: "TradeBot" } });
        const buttons = body.reply_markup && body.reply_markup.inline_keyboard;
        if (method === "sendMessage") {
          const id = ++nextMessageId;
          byId.set(id, { html: body.text, buttons });
          if (buttons) offered.set(id, buttons);
          messages.push({ html: body.text, buttons, kind: "message" });
          waiting.push({ kind: "message", html: body.text, buttons });
          return reply({ ok: true, result: { message_id: id } });
        }
        if (method === "editMessageText") {
          byId.set(body.message_id, { html: body.text, buttons });
          messages.push({ html: body.text, buttons, kind: "edit" });
          waiting.push({ kind: "edit", html: body.text });
        }
        if (method === "answerCallbackQuery" && body.text) {
          messages.push({ html: body.text, kind: "popup" });
          waiting.push({ kind: "popup", text: body.text });
        }
        return reply({ ok: true, result: true });
      },
    ],
    ...exchangeRoutes,
  ]);

  const { worker, Trader } = createWorker({ fetch, now });
  const env = { BUILD: "transcript", SETUP_CODE_SHA256: await sha256Hex(SETUP_CODE) };
  env.TRADER = new FakeNamespace(Trader, env, now);
  const storage = env.TRADER.object("main").storage;
  const stateNow = () => storage.get("state");
  const seen = { pending: 0, blind: false, days: new Set(), exits: new Set(), unanswered: [], secrets: [TOKEN, SETUP_CODE] };

  async function note() {
    const state = await stateNow();
    if (!state) return;
    seen.pending = Math.max(seen.pending, Object.keys(state.pending).length);
    seen.blind = seen.blind || state.blindAlerted;
    if (state.day) seen.days.add(state.day.key);
    for (const trade of state.trades) {
      if (trade.side === "sell") seen.exits.add(trade.why);
    }
  }

  async function call(method, path, headers, body) {
    const response = await worker.fetch(new Request(HOST + path, { method, headers, body: JSON.stringify(body) }), env);
    if (response.status !== 200) throw new Error(`${path} answered ${response.status}`);
    return response.json();
  }

  let updateId = 5000;
  async function webhook(update) {
    const config = await storage.get("config");
    await call("POST", "/v1/telegram", { "X-Telegram-Bot-Api-Secret-Token": config.secret }, { update_id: ++updateId, ...update });
    if (!seen.secrets.includes(config.secret)) seen.secrets.push(config.secret);
    await note();
  }

  // Write down everything the bot did since the last call.
  function flush() {
    for (const item of waiting) {
      if (item.kind === "popup") {
        lines.push(`_Pop-up on the button:_ ${item.text}`, "");
      } else if (item.kind === "edit") {
        const last = shown(item.html).trim().split("\n").pop();
        lines.push(`_The message with the buttons loses them and now ends with:_ ${last}`, "");
      } else {
        const text = shown(item.html).split("\n").map((line) => `> ${line}`.trimEnd());
        const buttons = (item.buttons || []).map((row) => "> " + row.map((button) => `[ ${button.text} ]`).join(" "));
        lines.push("**Bot:**", ...text, ...buttons, "");
      }
    }
    const wrote = waiting.length;
    waiting = [];
    return wrote;
  }

  function section(title) {
    lines.push(`## ${title}`, "", `_${wibClock(now())}_`, "");
  }

  async function say(text, from = OWNER, written = text) {
    lines.push(`**${from === OWNER ? "Owner" : "A stranger"}:** ${written}`, "");
    await webhook({ message: { message_id: ++nextMessageId, from: { id: from }, chat: { id: from, type: "private" }, text } });
    if (!flush()) seen.unanswered.push(written);
  }

  // The newest message that mentions `about` and has (or had) a button whose label ends with `label`.
  const offered = new Map(); // message id -> the buttons it was first sent with
  function buttonOn(label, about) {
    for (const [id, buttons] of [...offered.entries()].reverse()) {
      const button = buttons.flat().find((entry) => entry.text.endsWith(label));
      if (button && byId.get(id).html.includes(about)) return { id, button, message: byId.get(id) };
    }
    throw new Error(`no message about "${about}" has a button "${label}"`);
  }

  async function tap(label, about = "", note = "") {
    const { id, button, message } = buttonOn(label, about);
    return tapData(button.text, button.callback_data, id, message, note || (about ? ` _on the ${about} offer_` : ""));
  }

  async function tapData(label, data, id, message, note = "") {
    lines.push(`**Owner taps** [ ${label} ]${note}`, "");
    const query = { id: "cb" + updateId, from: { id: OWNER }, data, message: { message_id: id, chat: { id: OWNER, type: "private" }, text: plain(message.html) } };
    await webhook({ callback_query: query });
    if (!flush()) seen.unanswered.push(`tap ${label}`);
  }

  // Let time pass. The agent's rounds run when they are due; what it sends is written with its time.
  async function wait(minutes) {
    const until = now() + minutes * MINUTE;
    while (now() < until) {
      now.advance(Math.min(MINUTE, until - now()));
      await env.TRADER.runAlarms();
      await note();
      if (waiting.length) {
        lines.push(`_${wibClock(now())}, without being asked:_`, "");
        flush();
      }
    }
  }

  async function waitUntil(utc) {
    await wait((Date.parse(utc) - now()) / MINUTE);
  }

  lines.push(
    "# TradeBot: one conversation, start to finish",
    "",
    "_What the owner sees in Telegram. Every bot message is the real Worker's output; the prices are scripted so that each situation happens. Bold is shown as \\*\\*bold\\*\\*, buttons as [ label ]._",
    "",
  );

  // 1. Pairing and the first look.
  section("1. Pairing and the first look");
  const setup = await call("POST", "/v1/setup", { "X-Setup-Code": SETUP_CODE }, { token: TOKEN });
  seen.secrets.push(setup.pairLink.split("start=")[1]);
  await say("hi", STRANGER);
  lines.push("_The owner opens the one-time pairing link from the setup._", "");
  await say("/start " + setup.pairLink.split("start=")[1], OWNER, "/start (with the one-time code from the link)");
  await env.TRADER.runAlarms();
  if (waiting.length) {
    lines.push("_A moment later, without being asked:_", "");
    flush();
  }
  await wait(1);
  await say("/status");
  await say("/signals");

  // 2. Words the bot does not know.
  section("2. Words it does not know");
  await say("how is it going?");
  await say("/stauts");
  await say("hi", STRANGER);

  // 3. Buying and selling by hand.
  await wait(2);
  section("3. Buying and selling by hand");
  await say("/buy");
  await say("/buy DOGE 500");
  await say("/buy DOGE 500");
  await say("/buy XYZ 100");
  await say("/buy ETH 50000");
  await say("/buy ETH 5");
  await wait(7);
  await say("/sell");
  await say("/sell DOGE");
  await say("/sell DOGE");

  // 4. The agent alone: BTC falls 9% inside one candle.
  section("4. The agent on its own");
  lines.push("_The owner puts the phone away. BTC starts falling at 15:00 WIB._", "");
  await waitUntil("2026-01-15T09:30Z");
  await say("/history");
  await say("/status");

  // 5. Settings, right and wrong.
  section("5. Settings");
  await say("/risk");
  await say("/risk 9");
  await say("/risk 0.5");
  await say("/timeframe");
  await say("/timeframe 2h");
  await say("/pause");
  await say("/resume");
  await say("/watchlist");
  await say("/unwatch");
  await say("/unwatch SOL");
  await say("/watch XYZ");
  await say("/auto");
  await say("/auto off");

  // 6. Ask first: two offers, one approved, one skipped.
  section("6. Asking before it buys");
  await say("/watch XRP");
  await say("/watch XRP");
  await say("/watch ADA");
  await wait(6);
  await tap("Approve", "XRP");
  await tap("Skip", "ADA");
  // The skipped offer's Approve button, still on screen on another phone.
  await tap("Approve", "ADA", " _on the ADA offer that was just skipped (still on screen on another phone)_");

  // 7. The rules on past prices.
  section("7. Backtest");
  await say("/backtest BTC");
  await say("/backtest XYZ");

  // 8. The price sources go down for 45 minutes.
  await waitUntil("2026-01-15T10:00Z");
  section("8. The price sources go down");
  lines.push("_Every price source stops answering for 45 minutes._", "");
  network.down = true;
  await wait(20);
  await say("/status");
  await say("/signals");
  await say("/buy BTC 200");
  await wait(25);
  network.down = false;
  lines.push("_The price sources answer again._", "");
  await wait(10);

  // 9. The next days: summaries, and XRP turns down.
  section("9. The next days");
  lines.push("_The owner does nothing until the next morning. XRP starts sliding on 16 Jan._", "");
  await waitUntil("2026-01-16T01:00Z");
  lines.push(`_${wibClock(now())}_`, "");
  await say("/unwatch ADA");
  await waitUntil("2026-01-18T02:00Z");
  lines.push(`_${wibClock(now())}_`, "");
  await say("/status");
  await say("/history");

  // 10. Starting over.
  section("10. Starting over");
  await say("/reset 50");
  await say("/reset");
  await tap("Keep it");
  await say("/reset 5000");
  await tap("start over");
  const [oldId, oldMessage] = [...byId.entries()][0];
  await tapData("a button", "gone:1", oldId, oldMessage, " _left over from an older version of the bot_");
  await say("/help");

  const state = await stateNow();
  const markdown = lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  return { markdown, messages, state, seen: { ...seen, days: [...seen.days], exits: [...seen.exits] } };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const { markdown } = await play();
  const out = process.argv.indexOf("--out");
  if (out > 0) writeFileSync(process.argv[out + 1], markdown, "utf8");
  else process.stdout.write(markdown);
}
