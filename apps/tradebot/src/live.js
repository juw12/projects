// Real money, as a small copy of the practice account.
//
// The practice account (paper.js) stays the brain: it decides every buy and sell. When real money
// is on, each practice buy is copied on the exchange with a FIXED small amount (not the practice
// size), and each practice sell sells that real coin again. So the real account can never be
// bigger than a few small trades, whatever the practice account does.
//
// The exchange is Luno by default (rupiah markets, luno.js); EXCHANGE = "tokocrypto" on the Worker
// picks Tokocrypto (USDT markets, exchange.js). The books here stay in USDT either way; a rupiah
// trade also keeps its rupiah amounts ("native"), and its profit is worked out from those.
//
// Three modes, set from Telegram with /live:
//   off     nothing real happens. Coins already bought for real are still sold when the rules sell.
//   shadow  every copy is worked out against the exchange's real rules, order book and fees (and
//           the real balance, when keys are set) and shown, but nothing is sent. The dress rehearsal.
//   on      the copies are sent. Needs three things at once: LIVE_TRADING = "enabled" on the
//           Worker (a deploy setting, not a chat command), the API key and secret as Worker
//           secrets, and "/live on confirm" from the owner.
//
// Hard limits that no chat command can lift: at most HARD_MAX_ORDER USDT a trade, at most three
// trades open together, no new real buys after a day's real loss of one trade's size, and no buy
// in a market whose buying and selling prices are more than MAX_SPREAD_PERCENT apart. Any order
// that fails switches real trading back to shadow and says so.

import { baseAsset, floorToStep } from "./exchange.js";
import { escapeHtml } from "./util.js";
import { readAmount } from "./fx.js";
import { idNumber, rateNow } from "./render.js";

export const LIVE_MODES = ["off", "shadow", "on"];
export const HARD_MAX_ORDER = 50;
export const MIN_ORDER_USDT = 5;
export const DEFAULT_ORDER_USDT = 10;
// The widest gap between a market's buying and selling price that a real buy accepts. A market
// order pays that gap at once, so a wide one is a loss before the trade has started.
export const MAX_SPREAD_PERCENT = 0.5;
// A real sell is held back only when the gap is far wider: not selling has its own risk.
export const MAX_SELL_SPREAD_PERCENT = 2;
const MAX_OPEN = 3;
const MAX_LOG = 40;

// Where real orders can go. quote is the money the exchange trades the coins against.
export const VENUES = {
  luno: {
    id: "luno",
    name: "Luno",
    quote: "IDR",
    quoteName: "rupiah",
    secrets: ["LUNO_API_KEY_ID", "LUNO_API_SECRET"],
    note: `A coin is only copied while the gap between its buying and selling price on Luno is under ${MAX_SPREAD_PERCENT}%. That is usually bitcoin only.`,
  },
  tokocrypto: {
    id: "tokocrypto",
    name: "Tokocrypto",
    quote: "USDT",
    quoteName: "USDT",
    secrets: ["TOKO_API_KEY", "TOKO_API_SECRET"],
    note: "",
  },
};

// The exchange this deploy trades on: the Worker setting EXCHANGE, Luno when it is not set.
export function venueOf(env) {
  return VENUES[String((env && env.EXCHANGE) || "").toLowerCase()] || VENUES.luno;
}

// The venue an exchange object belongs to (it carries the same name).
function venueFor(exchange, venue) {
  return venue || Object.values(VENUES).find((entry) => exchange && entry.name === exchange.name) || VENUES.luno;
}

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

function hasSecrets(env, venue) {
  return !!env && venue.secrets.every((name) => !!env[name]);
}

// Real orders are allowed by the deploy only when the switch is on and both secrets are there.
export function armedBy(env) {
  return !!(env && env.LIVE_TRADING === "enabled" && hasSecrets(env, venueOf(env)));
}

export function missingFor(env) {
  const venue = venueOf(env);
  const missing = [];
  if (!(env && env.LIVE_TRADING === "enabled")) missing.push('the Worker setting LIVE_TRADING = "enabled"');
  if (!hasSecrets(env, venue)) missing.push(`the ${venue.name} API key and secret (Worker secrets ${venue.secrets.join(", ")})`);
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

const rupiah = (value) => `Rp${idNumber(Number(value || 0))}`;
const signed = (value, text) => (Number(value || 0) >= 0 ? "+" : "-") + text(Math.abs(Number(value || 0)));

// An amount from the USDT books, in the money of the venue: plain rupiah on a rupiah exchange,
// USDT first (with rupiah beside it once a rate is known) on a USDT exchange.
function money(value, venue) {
  const amount = Number(value || 0);
  const rate = rateNow();
  if (venue.quote === "IDR" && rate) return rupiah(amount * rate);
  return `${amount.toFixed(2)} USDT` + (rate ? ` (${rupiah(amount * rate)})` : "");
}

// What a fill or a position really cost or brought in: its own rupiah when it has them.
const paid = (fill, venue) => (fill.native ? rupiah(fill.native.quote) : money(fill.quote, venue));
const costOf = (position, venue) => (position.native ? rupiah(position.native.cost) : money(position.cost, venue));
const percent = (value) => `${value >= 10 ? value.toFixed(0) : value.toFixed(2)}%`;

// What a sale made: in USDT for the books, and in the exchange's own money when both the buy and
// the sale have it, so a moving rupiah rate cannot invent a profit or hide a loss.
function resultOf(position, fill, share = 1) {
  if (position.native && fill.native && fill.native.quote > 0 && fill.quote > 0) {
    const native = fill.native.quote - position.native.cost * share;
    return { usdt: native / (fill.native.quote / fill.quote), native };
  }
  return { usdt: fill.quote - position.cost * share, native: null };
}

const resultText = (result, venue) => (result.native === null ? signed(result.usdt, (value) => money(value, venue)) : signed(result.native, rupiah));

// "/live size" amount in USDT: "10", "10usdt" or "$10" are dollars; "200000", "200rb" are rupiah.
function sizeInUsdt(text) {
  const amount = readAmount(text);
  if (!amount) return NaN;
  if (amount.unit === "usd" || (amount.unit === null && amount.value <= 1000)) return amount.value;
  const rate = rateNow();
  return rate ? amount.value / rate : NaN;
}
const coinOf = (symbol) => baseAsset(symbol);

// Why this market cannot take a real buy of this size right now ("" when it can). Only the
// market's own state: listing, minimum order and, where the exchange reports its order book,
// how far apart the buying and selling prices are.
export function marketBlock(symbol, rules, limits, venue = VENUES.luno) {
  const coin = coinOf(symbol);
  if (!rules) return `${coin} is not traded against ${venue.quoteName} on ${venue.name}`;
  if (!rules.spot) return `${venue.name} has spot trading for ${coin} switched off`;
  if (rules.thin) return `${venue.name} has too few ${coin} offers for an order of ${money(limits.orderUsdt, venue)}`;
  if (rules.spreadPercent > MAX_SPREAD_PERCENT) {
    return `the buying and selling price of ${coin} on ${venue.name} are ${percent(rules.spreadPercent)} apart (limit ${MAX_SPREAD_PERCENT}%), so the trade would start with that loss`;
  }
  if (limits.orderUsdt < rules.minNotional) return `the smallest ${coin} order on ${venue.name} is ${money(rules.minNotional, venue)}`;
  return "";
}

// Why a real buy must not happen ("" when it may). Rules: the market's limits from the exchange.
export function buyBlock(live, symbol, rules, limits, now, balance = null, venue = VENUES.luno) {
  const market = marketBlock(symbol, rules, limits, venue);
  if (market) return market;
  if (live.positions[symbol]) return `a real ${coinOf(symbol)} position is already open`;
  if (Object.keys(live.positions).length >= MAX_OPEN) return `${MAX_OPEN} real positions are already open`;
  if (openUsdt(live) + limits.orderUsdt > limits.maxOpenUsdt + 1e-9) return `that would put more than ${money(limits.maxOpenUsdt, venue)} in at once`;
  if (dayOf(live, now).realized <= -limits.dailyLossUsdt) return `today's real loss already reached ${money(limits.dailyLossUsdt, venue)}`;
  if (balance !== null && balance < limits.orderUsdt) return `only ${money(balance, venue)} is free on ${venue.name}`;
  return "";
}

// The quantity a real sell can use: what was bought, not more than is free, on the market's step.
export function sellQty(position, rules, free = null) {
  const have = free === null ? position.qty : Math.min(position.qty, free);
  return Number(floorToStep(have, rules ? rules.stepSize : "0.00000001"));
}

// Work through the queued copies. Returns messages for the owner. Never throws.
// exchange: createLuno(...) / createTokocrypto(...) or null; armed: armedBy(env); venue: venueOf(env).
export async function drain(state, { exchange, now, armed, venue }) {
  const live = liveOf(state);
  const deps = { exchange, now, armed, venue: venueFor(exchange, venue) };
  const messages = [];
  while (live.queue.length) {
    const intent = live.queue.shift();
    try {
      const message = intent.side === "buy" ? await copyBuy(live, intent, deps) : await copySell(live, intent, deps);
      if (message) messages.push(message);
    } catch (error) {
      messages.push(failed(live, intent, error, now, deps.venue));
    }
  }
  return messages;
}

async function copyBuy(live, intent, { exchange, now, armed, venue }) {
  const { symbol } = intent;
  const coin = coinOf(symbol);
  const limits = limitsOf(live);
  const sending = live.mode === "on" && armed;
  if (live.mode === "off") return null;
  if (!exchange) throw new Error(`${venue.name} is not reachable from here`);
  const rules = await exchange.rules(symbol, limits.orderUsdt);
  const balance = exchange.hasKeys ? await exchange.freeQuote() : null;
  const block = buyBlock(live, symbol, rules, limits, now, balance, venue);
  if (block) {
    remember(live, { at: now, side: "buy", symbol, status: "refused", note: block });
    return { html: `🟡 Real money: no ${coin} copy. Reason: ${escapeHtml(block)}. Nothing was sent.` };
  }
  if (!sending) {
    // The rehearsal pays what a real order would: the selling price in the book and the fee.
    const price = rules.ask || intent.price;
    const fee = (rules.fees && rules.fees.buy) || 0;
    const qty = (limits.orderUsdt / price) * (1 - fee);
    const position = { qty, cost: limits.orderUsdt, entry: price, at: now, real: false };
    if (rules.native) position.native = { asset: rules.native.asset, cost: limits.orderUsdt * rules.native.rate };
    live.positions[symbol] = position;
    remember(live, { at: now, side: "buy", symbol, status: "shadow", quote: limits.orderUsdt, price });
    const details = [rules.symbol, `smallest order ${money(rules.minNotional, venue)}`];
    if (rules.spreadPercent >= 0) details.push(`prices ${percent(rules.spreadPercent)} apart`);
    if (fee) details.push(`fee ${percent(fee * 100)}`);
    const why = live.mode === "on" ? ` Real trading is set to on, but ${armed ? "" : "the Worker is not armed for it, so "}nothing was sent.` : " Shadow mode: nothing was sent.";
    return { html: `🔸 Real money (rehearsal): would buy <b>${costOf(position, venue)}</b> of ${coin} on ${venue.name} (${details.join(", ")}).${why}` };
  }
  const fill = await exchange.marketBuy(symbol, limits.orderUsdt);
  if (!(fill.qty > 0)) throw new Error(`the ${coin} buy did not fill (order ${fill.orderId || "?"})`);
  const position = { qty: fill.qty, cost: fill.quote, entry: fill.price, at: now, real: true, orderId: fill.orderId };
  if (fill.native) position.native = { asset: fill.native.asset, cost: fill.native.quote };
  live.positions[symbol] = position;
  remember(live, { at: now, side: "buy", symbol, status: "filled", quote: fill.quote, qty: fill.qty, price: fill.price, orderId: fill.orderId });
  const at = fill.native ? rupiah(fill.native.price) : fill.price.toPrecision(6);
  return { html: `💵 <b>Real money: bought ${coin}</b> for ${paid(fill, venue)} on ${venue.name} at ${at} (order ${escapeHtml(String(fill.orderId))}).` };
}

async function copySell(live, intent, { exchange, now, armed, venue }) {
  const { symbol } = intent;
  const coin = coinOf(symbol);
  const position = live.positions[symbol];
  if (!position) return null;
  const day = dayOf(live, now);
  if (!position.real) {
    // The rehearsal sells at the buying price in the book, less the fee, when the book can be read.
    let rules = null;
    try {
      rules = exchange ? await exchange.rules(symbol, position.cost) : null;
    } catch {
      rules = null;
    }
    const price = (rules && rules.bid) || intent.price;
    const keep = 1 - ((rules && rules.fees && rules.fees.sell) || 0);
    const fill = { quote: position.qty * price * keep };
    if (rules && rules.native && rules.native.bid) fill.native = { quote: position.qty * rules.native.bid * keep };
    const result = resultOf(position, fill);
    delete live.positions[symbol];
    day.realized += result.usdt;
    remember(live, { at: now, side: "sell", symbol, status: "shadow", quote: fill.quote, price, result: result.usdt });
    return { html: `🔸 Real money (rehearsal): would sell the ${coin} copy for about ${paid(fill, venue)} (${resultText(result, venue)}). Nothing was sent.` };
  }
  // A coin bought for real is always sold for real, whatever the mode, as long as the Worker can.
  if (!armed || !exchange || !exchange.hasKeys) {
    throw new Error(`the real ${coin} could not be sold because real trading is not armed on the Worker any more`);
  }
  const rules = await exchange.rules(symbol, position.cost);
  if (rules && (rules.thin || rules.spreadPercent > MAX_SELL_SPREAD_PERCENT)) {
    const gap = rules.thin ? "there are too few buyers for it" : `its buying and selling price are ${percent(rules.spreadPercent)} apart`;
    throw new Error(`the real ${coin} was not sold because ${gap} on ${venue.name} right now, and a market sell would give that much away`);
  }
  const free = await exchange.free(baseAsset(symbol));
  const qty = sellQty(position, rules, free);
  if (!(qty > 0) || (rules && (qty < rules.minQty || qty * intent.price < rules.minNotional))) {
    delete live.positions[symbol];
    remember(live, { at: now, side: "sell", symbol, status: "dust", qty, note: "too small to sell" });
    return { html: `🟡 Real money: the ${coin} left (${qty}) is below ${venue.name}'s smallest order, so it stays in the account as a tiny remainder.` };
  }
  const fill = await exchange.marketSell(symbol, qty);
  if (!(fill.qty > 0)) throw new Error(`the ${coin} sell did not fill (order ${fill.orderId || "?"})`);
  const result = resultOf(position, fill, Math.min(1, fill.qty / position.qty));
  delete live.positions[symbol];
  day.realized += result.usdt;
  remember(live, { at: now, side: "sell", symbol, status: "filled", quote: fill.quote, qty: fill.qty, price: fill.price, result: result.usdt, orderId: fill.orderId });
  return { html: `💵 <b>Real money: sold ${coin}</b> for ${paid(fill, venue)} on ${venue.name} (${resultText(result, venue)}).` };
}

// Any error: no further real orders until the owner looks. Real coins already held stay listed.
function failed(live, intent, error, now, venue) {
  const why = String((error && error.message) || error).slice(0, 200);
  const wasOn = live.mode === "on";
  if (wasOn) live.mode = "shadow";
  remember(live, { at: now, side: intent.side, symbol: intent.symbol, status: "failed", note: why });
  const held = live.positions[intent.symbol] && live.positions[intent.symbol].real;
  return {
    html: [
      `🚨 <b>Real money: the ${coinOf(intent.symbol)} ${intent.side} failed.</b> ${escapeHtml(why)}.`,
      wasOn ? "Real trading switched itself back to shadow: no more real orders until you send /live on confirm again." : "",
      held ? `The real ${coinOf(intent.symbol)} is still in your ${venue.name} account. Check it in the app and sell it there if you want out.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

const sizeExample = (venue) => (venue.quote === "IDR" ? "150rb" : "10");

// /live
export function liveReport(state, { env, now }) {
  const live = liveOf(state);
  const venue = venueOf(env);
  const limits = limitsOf(live);
  const missing = missingFor(env);
  const mode = { off: "OFF", shadow: "SHADOW (rehearsal, nothing is sent)", on: armedBy(env) ? "ON (real orders)" : "ON, but the Worker is not armed: nothing is sent" }[live.mode];
  const open = Object.entries(live.positions);
  const recent = live.log.slice(-5).reverse();
  const day = dayOf(live, now);
  const cash = (value) => money(value, venue);
  return {
    html: [
      `💰 <b>Real money: ${mode}</b>`,
      `Exchange: ${venue.name} (licensed in Indonesia), ${venue.quoteName} markets.`,
      `Each practice buy is copied with <b>${cash(limits.orderUsdt)}</b>; at most ${cash(limits.maxOpenUsdt)} in at once; no new real buys after ${cash(limits.dailyLossUsdt)} lost in a day (today: ${signed(day.realized, cash)}).`,
      venue.note,
      missing.length ? `Not ready for real orders yet. Missing: ${missing.join("; ")}.` : "Ready for real orders.",
      open.length
        ? "Open copies: " + open.map(([symbol, position]) => `${coinOf(symbol)} ${costOf(position, venue)}${position.real ? "" : " (rehearsal)"}`).join(", ")
        : "Open copies: none.",
      recent.length ? "Last: " + recent.map((entry) => `${entry.side} ${coinOf(entry.symbol)} ${entry.status}`).join(" · ") : "",
      "",
      `/live shadow · /live on confirm · /live off · /live size ${sizeExample(venue)}`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
  };
}

// /live <args>. Returns the reply; changes state.live.
export function liveCommand(state, args, { env, now }) {
  const live = liveOf(state);
  const venue = venueOf(env);
  const cash = (value) => money(value, venue);
  const want = String(args[0] || "").toLowerCase();
  if (want === "off") {
    live.mode = "off";
    const real = Object.values(live.positions).filter((position) => position.real).length;
    return { html: `💰 Real money is <b>off</b>: no new real buys.${real ? ` The ${real} real coin(s) already bought will still be sold when the rules sell.` : ""}` };
  }
  if (want === "shadow") {
    live.mode = "shadow";
    return { html: `💰 Real money is in <b>shadow</b>: every practice buy and sell is worked out on ${venue.name}'s real rules, prices and fees and shown here, and nothing is sent.` };
  }
  if (want === "on") {
    const missing = missingFor(env);
    if (missing.length) return { html: `⚠️ Real money stays as it was (${live.mode}). It cannot go on yet. Missing: ${missing.join("; ")}.` };
    if (String(args[1] || "").toLowerCase() !== "confirm") {
      const limits = limitsOf(live);
      return {
        html: `⚠️ This trades <b>real money</b> on ${venue.name}: ${cash(limits.orderUsdt)} per trade, up to ${cash(limits.maxOpenUsdt)} at once. The rules have no proven edge and you can lose it. Nothing changed. To go ahead, send <code>/live on confirm</code>.`,
      };
    }
    live.mode = "on";
    return { html: `💵 Real money is <b>on</b>. The next practice buy is copied with ${cash(limitsOf(live).orderUsdt)}. /live off stops new real buys at any time.` };
  }
  if (want === "size") {
    const amount = sizeInUsdt(args[1]);
    if (!(amount >= MIN_ORDER_USDT && amount <= HARD_MAX_ORDER)) {
      return { html: `⚠️ Nothing changed. The size of a real trade is between ${cash(MIN_ORDER_USDT)} and ${cash(HARD_MAX_ORDER)}, for example <code>/live size 150rb</code> (rupiah) or <code>/live size 10</code> (USDT).` };
    }
    live.orderUsdt = Math.round(amount * 100) / 100;
    return { html: `💰 Real trades are now ${cash(live.orderUsdt)} each (at most ${cash(limitsOf(live).maxOpenUsdt)} in at once).` };
  }
  return liveReport(state, { env, now });
}

export function hasRealPositions(state) {
  return Object.values(liveOf(state).positions).some((position) => position.real);
}
