// Real money, as a small copy of the practice account.
//
// The practice account (paper.js) stays the brain: it decides every buy and sell. When real money
// is on, each practice buy is copied on Tokocrypto with a FIXED small amount of USDT (not the
// practice size), and each practice sell sells that real coin again. So the real account can never
// be bigger than a few small trades, whatever the practice account does.
//
// Three modes, set from Telegram with /live:
//   off     nothing real happens. Coins already bought for real are still sold when the rules sell.
//   shadow  every copy is worked out against Tokocrypto's real rules (and the real balance, when
//           keys are set) and shown, but nothing is sent. The dress rehearsal.
//   on      the copies are sent. Needs three things at once: LIVE_TRADING = "enabled" on the
//           Worker (a deploy setting, not a chat command), the API key and secret as Worker
//           secrets, and "/live on confirm" from the owner.
//
// Hard limits that no chat command can lift: at most HARD_MAX_ORDER USDT a trade, at most three
// trades open together, no new real buys after a day's real loss of one trade's size. Any order
// that fails switches real trading back to shadow and says so.

import { EXCHANGE_NAME, baseAsset, exchangeSymbol, floorToStep } from "./exchange.js";
import { escapeHtml } from "./util.js";
import { readAmount } from "./fx.js";
import { idNumber, rateNow } from "./render.js";

export const LIVE_MODES = ["off", "shadow", "on"];
export const HARD_MAX_ORDER = 50;
export const MIN_ORDER_USDT = 5;
export const DEFAULT_ORDER_USDT = 10;
const MAX_OPEN = 3;
const MAX_LOG = 40;

export function newLive() {
  return { mode: "off", orderUsdt: DEFAULT_ORDER_USDT, queue: [], positions: {}, log: [], day: null };
}

// The live book, with defaults for a state saved before real money existed.
export function liveOf(state) {
  if (!state.live) state.live = newLive();
  const live = state.live;
  if (!live.queue) live.queue = [];
  if (!live.positions) live.positions = {};
  if (!live.log) live.log = [];
  return live;
}

export function limitsOf(live) {
  const order = Math.min(HARD_MAX_ORDER, Math.max(MIN_ORDER_USDT, Number(live.orderUsdt) || DEFAULT_ORDER_USDT));
  return { orderUsdt: order, maxOpenUsdt: order * MAX_OPEN, dailyLossUsdt: order };
}

// Real orders are allowed by the deploy only when the switch is on and both secrets are there.
export function armedBy(env) {
  return !!(env && env.LIVE_TRADING === "enabled" && env.TOKO_API_KEY && env.TOKO_API_SECRET);
}

export function missingFor(env) {
  const missing = [];
  if (!(env && env.LIVE_TRADING === "enabled")) missing.push('the Worker setting LIVE_TRADING = "enabled"');
  if (!(env && env.TOKO_API_KEY && env.TOKO_API_SECRET)) missing.push("the Tokocrypto API key and secret (Worker secrets TOKO_API_KEY, TOKO_API_SECRET)");
  return missing;
}

// Called by the agent after every practice fill. Cheap and offline: the work happens in drain().
export function noteFill(state, fill) {
  const live = liveOf(state);
  const held = live.positions[fill.symbol];
  if (fill.side === "buy" && live.mode !== "off" && !held) live.queue.push({ side: "buy", symbol: fill.symbol, price: fill.price, at: fill.at });
  if (fill.side === "sell" && held) live.queue.push({ side: "sell", symbol: fill.symbol, price: fill.price, at: fill.at });
}

function dayOf(live, now) {
  const key = new Date(now).toISOString().slice(0, 10);
  if (!live.day || live.day.key !== key) live.day = { key, realized: 0 };
  return live.day;
}

function openUsdt(live) {
  return Object.values(live.positions).reduce((sum, position) => sum + (position.cost || 0), 0);
}

function remember(live, entry) {
  live.log.push(entry);
  if (live.log.length > MAX_LOG) live.log.splice(0, live.log.length - MAX_LOG);
  return entry;
}

// Real orders are in USDT, so USDT is shown first, with rupiah beside it once a rate is known.
const usdt = (value) => {
  const amount = Number(value || 0);
  const rate = rateNow();
  return `${amount.toFixed(2)} USDT` + (rate ? ` (Rp${idNumber(amount * rate)})` : "");
};

const signedUsdt = (value) => (Number(value || 0) >= 0 ? "+" : "-") + usdt(Math.abs(Number(value || 0)));

// "/live size" amount in USDT: "10", "10usdt" or "$10" are dollars; "200000", "200rb" are rupiah.
function sizeInUsdt(text) {
  const amount = readAmount(text);
  if (!amount) return NaN;
  if (amount.unit === "usd" || (amount.unit === null && amount.value <= 1000)) return amount.value;
  const rate = rateNow();
  return rate ? amount.value / rate : NaN;
}
const coinOf = (symbol) => baseAsset(symbol);

// Why a real buy must not happen ("" when it may). Rules: the market's limits from Tokocrypto.
export function buyBlock(live, symbol, rules, limits, now, balance = null) {
  if (!rules) return `${coinOf(symbol)} is not traded against USDT on ${EXCHANGE_NAME}`;
  if (!rules.spot) return `${EXCHANGE_NAME} has spot trading for ${coinOf(symbol)} switched off`;
  if (live.positions[symbol]) return `a real ${coinOf(symbol)} position is already open`;
  if (limits.orderUsdt < rules.minNotional) return `the smallest ${coinOf(symbol)} order on ${EXCHANGE_NAME} is ${usdt(rules.minNotional)}`;
  if (Object.keys(live.positions).length >= MAX_OPEN) return `${MAX_OPEN} real positions are already open`;
  if (openUsdt(live) + limits.orderUsdt > limits.maxOpenUsdt + 1e-9) return `that would put more than ${usdt(limits.maxOpenUsdt)} in at once`;
  if (dayOf(live, now).realized <= -limits.dailyLossUsdt) return `today's real loss already reached ${usdt(limits.dailyLossUsdt)}`;
  if (balance !== null && balance < limits.orderUsdt) return `only ${usdt(balance)} is free on ${EXCHANGE_NAME}`;
  return "";
}

// The quantity a real sell can use: what was bought, not more than is free, on the market's step.
export function sellQty(position, rules, free = null) {
  const have = free === null ? position.qty : Math.min(position.qty, free);
  return Number(floorToStep(have, rules ? rules.stepSize : "0.00000001"));
}

// Work through the queued copies. Returns messages for the owner. Never throws.
// exchange: createTokocrypto(...) or null; armed: armedBy(env).
export async function drain(state, { exchange, now, armed }) {
  const live = liveOf(state);
  const messages = [];
  while (live.queue.length) {
    const intent = live.queue.shift();
    try {
      const message = intent.side === "buy" ? await copyBuy(live, intent, { exchange, now, armed }) : await copySell(live, intent, { exchange, now, armed });
      if (message) messages.push(message);
    } catch (error) {
      messages.push(failed(live, intent, error, now));
    }
  }
  return messages;
}

async function copyBuy(live, intent, { exchange, now, armed }) {
  const { symbol } = intent;
  const limits = limitsOf(live);
  const sending = live.mode === "on" && armed;
  if (live.mode === "off") return null;
  if (!exchange) throw new Error(`${EXCHANGE_NAME} is not reachable from here`);
  const rules = await exchange.rules(symbol);
  const balance = exchange.hasKeys ? await exchange.free("USDT") : null;
  const block = buyBlock(live, symbol, rules, limits, now, balance);
  if (block) {
    remember(live, { at: now, side: "buy", symbol, status: "refused", note: block });
    return { html: `🟡 Real money: no ${coinOf(symbol)} copy. Reason: ${escapeHtml(block)}. Nothing was sent.` };
  }
  if (!sending) {
    const qty = limits.orderUsdt / intent.price;
    live.positions[symbol] = { qty, cost: limits.orderUsdt, entry: intent.price, at: now, real: false };
    remember(live, { at: now, side: "buy", symbol, status: "shadow", quote: limits.orderUsdt, price: intent.price });
    const why = live.mode === "on" ? ` Real trading is set to on, but ${armed ? "" : "the Worker is not armed for it, so "}nothing was sent.` : " Shadow mode: nothing was sent.";
    return { html: `🔸 Real money (rehearsal): would buy <b>${usdt(limits.orderUsdt)}</b> of ${coinOf(symbol)} on ${EXCHANGE_NAME} (${exchangeSymbol(symbol)}, smallest order ${usdt(rules.minNotional)}).${why}` };
  }
  const fill = await exchange.marketBuy(symbol, limits.orderUsdt);
  if (!(fill.qty > 0)) throw new Error(`the ${coinOf(symbol)} buy did not fill (order ${fill.orderId || "?"})`);
  live.positions[symbol] = { qty: fill.qty, cost: fill.quote, entry: fill.price, at: now, real: true, orderId: fill.orderId };
  remember(live, { at: now, side: "buy", symbol, status: "filled", quote: fill.quote, qty: fill.qty, price: fill.price, orderId: fill.orderId });
  return { html: `💵 <b>Real money: bought ${coinOf(symbol)}</b> for ${usdt(fill.quote)} on ${EXCHANGE_NAME} at ${fill.price.toPrecision(6)} (order ${escapeHtml(String(fill.orderId))}).` };
}

async function copySell(live, intent, { exchange, now, armed }) {
  const { symbol } = intent;
  const position = live.positions[symbol];
  if (!position) return null;
  const day = dayOf(live, now);
  if (!position.real) {
    const value = position.qty * intent.price;
    const result = value - position.cost;
    delete live.positions[symbol];
    day.realized += result;
    remember(live, { at: now, side: "sell", symbol, status: "shadow", quote: value, price: intent.price, result });
    return { html: `🔸 Real money (rehearsal): would sell the ${coinOf(symbol)} copy for about ${usdt(value)} (${signedUsdt(result)}). Nothing was sent.` };
  }
  // A coin bought for real is always sold for real, whatever the mode, as long as the Worker can.
  if (!armed || !exchange || !exchange.hasKeys) {
    throw new Error(`the real ${coinOf(symbol)} could not be sold because real trading is not armed on the Worker any more`);
  }
  const rules = await exchange.rules(symbol);
  const free = await exchange.free(baseAsset(symbol));
  const qty = sellQty(position, rules, free);
  if (!(qty > 0) || (rules && qty * intent.price < rules.minNotional)) {
    delete live.positions[symbol];
    remember(live, { at: now, side: "sell", symbol, status: "dust", qty, note: "too small to sell" });
    return { html: `🟡 Real money: the ${coinOf(symbol)} left (${qty}) is below ${EXCHANGE_NAME}'s smallest order, so it stays in the account as a tiny remainder.` };
  }
  const fill = await exchange.marketSell(symbol, qty);
  if (!(fill.qty > 0)) throw new Error(`the ${coinOf(symbol)} sell did not fill (order ${fill.orderId || "?"})`);
  const cost = position.cost * Math.min(1, fill.qty / position.qty);
  const result = fill.quote - cost;
  delete live.positions[symbol];
  day.realized += result;
  remember(live, { at: now, side: "sell", symbol, status: "filled", quote: fill.quote, qty: fill.qty, price: fill.price, result, orderId: fill.orderId });
  return { html: `💵 <b>Real money: sold ${coinOf(symbol)}</b> for ${usdt(fill.quote)} on ${EXCHANGE_NAME} (${signedUsdt(result)}).` };
}

// Any error: no further real orders until the owner looks. Real coins already held stay listed.
function failed(live, intent, error, now) {
  const why = String((error && error.message) || error).slice(0, 200);
  const wasOn = live.mode === "on";
  if (wasOn) live.mode = "shadow";
  remember(live, { at: now, side: intent.side, symbol: intent.symbol, status: "failed", note: why });
  const held = live.positions[intent.symbol] && live.positions[intent.symbol].real;
  return {
    html: [
      `🚨 <b>Real money: the ${coinOf(intent.symbol)} ${intent.side} failed.</b> ${escapeHtml(why)}.`,
      wasOn ? "Real trading switched itself back to shadow: no more real orders until you send /live on confirm again." : "",
      held ? `The real ${coinOf(intent.symbol)} is still in your ${EXCHANGE_NAME} account. Check it in the app and sell it there if you want out.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

// /live
export function liveReport(state, { env, now }) {
  const live = liveOf(state);
  const limits = limitsOf(live);
  const missing = missingFor(env);
  const mode = { off: "OFF", shadow: "SHADOW (rehearsal, nothing is sent)", on: armedBy(env) ? "ON (real orders)" : "ON, but the Worker is not armed: nothing is sent" }[live.mode];
  const open = Object.entries(live.positions);
  const recent = live.log.slice(-5).reverse();
  const day = dayOf(live, now);
  return {
    html: [
      `💰 <b>Real money: ${mode}</b>`,
      `Exchange: ${EXCHANGE_NAME} (licensed in Indonesia), USDT markets.`,
      `Each practice buy is copied with <b>${usdt(limits.orderUsdt)}</b>; at most ${usdt(limits.maxOpenUsdt)} in at once; no new real buys after ${usdt(limits.dailyLossUsdt)} lost in a day (today: ${signedUsdt(day.realized)}).`,
      missing.length ? `Not ready for real orders yet. Missing: ${missing.join("; ")}.` : "Ready for real orders.",
      open.length
        ? "Open copies: " + open.map(([symbol, position]) => `${coinOf(symbol)} ${usdt(position.cost)}${position.real ? "" : " (rehearsal)"}`).join(", ")
        : "Open copies: none.",
      recent.length ? "Last: " + recent.map((entry) => `${entry.side} ${coinOf(entry.symbol)} ${entry.status}`).join(" · ") : "",
      "",
      "/live shadow · /live on confirm · /live off · /live size 10",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  };
}

// /live <args>. Returns the reply; changes state.live.
export function liveCommand(state, args, { env, now }) {
  const live = liveOf(state);
  const want = String(args[0] || "").toLowerCase();
  if (want === "off") {
    live.mode = "off";
    const real = Object.values(live.positions).filter((position) => position.real).length;
    return { html: `💰 Real money is <b>off</b>: no new real buys.${real ? ` The ${real} real coin(s) already bought will still be sold when the rules sell.` : ""}` };
  }
  if (want === "shadow") {
    live.mode = "shadow";
    return { html: `💰 Real money is in <b>shadow</b>: every practice buy and sell is worked out on ${EXCHANGE_NAME}'s real rules and shown here, and nothing is sent.` };
  }
  if (want === "on") {
    const missing = missingFor(env);
    if (missing.length) return { html: `⚠️ Real money stays as it was (${live.mode}). It cannot go on yet. Missing: ${missing.join("; ")}.` };
    if (String(args[1] || "").toLowerCase() !== "confirm") {
      const limits = limitsOf(live);
      return {
        html: `⚠️ This trades <b>real money</b> on ${EXCHANGE_NAME}: ${usdt(limits.orderUsdt)} per trade, up to ${usdt(limits.maxOpenUsdt)} at once. The rules have no proven edge and you can lose it. Nothing changed. To go ahead, send <code>/live on confirm</code>.`,
      };
    }
    live.mode = "on";
    return { html: `💵 Real money is <b>on</b>. The next practice buy is copied with ${usdt(limitsOf(live).orderUsdt)}. /live off stops new real buys at any time.` };
  }
  if (want === "size") {
    const amount = sizeInUsdt(args[1]);
    if (!(amount >= MIN_ORDER_USDT && amount <= HARD_MAX_ORDER)) {
      return { html: `⚠️ Nothing changed. The size of a real trade is between ${usdt(MIN_ORDER_USDT)} and ${usdt(HARD_MAX_ORDER)}, for example <code>/live size 10</code> (USDT) or <code>/live size 200rb</code> (rupiah).` };
    }
    live.orderUsdt = Math.round(amount * 100) / 100;
    return { html: `💰 Real trades are now ${usdt(live.orderUsdt)} each (at most ${usdt(limitsOf(live).maxOpenUsdt)} in at once).` };
  }
  return liveReport(state, { env, now });
}

export function hasRealPositions(state) {
  return Object.values(liveOf(state).positions).some((position) => position.real);
}
