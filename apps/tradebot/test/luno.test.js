import assert from "node:assert/strict";
import { test } from "node:test";

import { newState } from "../src/agent.js";
import { MAX_SPREAD_PERCENT, VENUES, armedBy, drain, liveCommand, liveOf, marketBlock, limitsOf, noteFill, venueOf } from "../src/live.js";
import { LUNO_TAKER_FEES, averagePrice, createLuno, lunoPair } from "../src/luno.js";
import { useRate } from "../src/render.js";
import { LUNO_RATE, fakeLuno, lunoBooks } from "./fakes.js";

const ARMED = { LIVE_TRADING: "enabled", LUNO_API_KEY_ID: "id-1", LUNO_API_SECRET: "secret-2" };
const NOW = Date.UTC(2026, 10, 16, 4, 10);
const BTC_USDT = 1650000000 / LUNO_RATE; // the pretend selling price of bitcoin, in USDT

useRate(LUNO_RATE); // the bot knows the rupiah rate, so it talks in rupiah

const lunoFor = (luno, { keys = false, rate = () => LUNO_RATE } = {}) =>
  createLuno({ fetch: luno.fetch, now: () => NOW, rate, wait: async () => {}, ...(keys ? { keyId: ARMED.LUNO_API_KEY_ID, secret: ARMED.LUNO_API_SECRET } : {}) });
const fill = (side, symbol = "BTCUSDT", price = BTC_USDT) => ({ side, symbol, price, at: NOW });

test("Luno is the exchange unless the deploy says otherwise, and it is armed by its own two secrets", () => {
  assert.equal(venueOf({}).name, "Luno");
  assert.equal(venueOf({ EXCHANGE: "nonsense" }).name, "Luno");
  assert.equal(venueOf({ EXCHANGE: "Tokocrypto" }).name, "Tokocrypto");
  assert.equal(armedBy(ARMED), true);
  assert.equal(armedBy({ ...ARMED, LIVE_TRADING: "off" }), false);
  assert.equal(armedBy({ LIVE_TRADING: "enabled", LUNO_API_KEY_ID: "id-1" }), false);
  assert.equal(armedBy({ LIVE_TRADING: "enabled", TOKO_API_KEY: "k", TOKO_API_SECRET: "s" }), false, "another exchange's keys do not arm Luno");
  assert.equal(lunoPair("BTCUSDT"), "XBTIDR");
  assert.equal(lunoPair("ethusdt"), "ETHIDR");
});

test("the average price walks the book, best price first, and says when the book is too thin", () => {
  const asks = [{ price: "100", volume: "1" }, { price: "110", volume: "1" }];
  assert.equal(averagePrice(asks, 0), 100);
  assert.equal(averagePrice(asks, 100), 100);
  assert.ok(Math.abs(averagePrice(asks, 155) - 155 / 1.5) < 1e-9);
  assert.equal(averagePrice(asks, 1000), null);
  assert.equal(averagePrice([], 0), null);
});

test("the rules of a market carry the gap between its prices for the size asked", async () => {
  const exchange = lunoFor(fakeLuno());
  const btc = await exchange.rules("BTCUSDT", 10);
  assert.equal(btc.symbol, "XBTIDR");
  assert.equal(btc.stepSize, "0.000001");
  assert.equal(btc.minQty, 0.00001);
  assert.equal(btc.spot, true);
  assert.ok(Math.abs(btc.spreadPercent - 0.08) < 0.001, `bitcoin gap ${btc.spreadPercent}`);
  assert.ok(Math.abs(btc.ask - BTC_USDT) < 1e-6);
  assert.equal(btc.native.ask, 1650000000);
  assert.ok((await exchange.rules("ETHUSDT", 10)).spreadPercent > 50);
  assert.equal(await exchange.rules("XRPUSDT", 10), null, "a coin Luno does not list");
  // 4.000 USDT is far more than the pretend bitcoin buyers hold.
  assert.equal((await exchange.rules("BTCUSDT", 4000)).thin, true);
});

test("only bitcoin passes: ETH is refused for its gap, SOL for too few offers, and nothing is sent", async () => {
  const luno = fakeLuno();
  const exchange = lunoFor(luno, { keys: true });
  const state = newState();
  liveCommand(state, ["on", "confirm"], { env: ARMED, now: NOW });
  noteFill(state, fill("buy", "ETHUSDT", 3600));
  noteFill(state, fill("buy", "SOLUSDT", 130));
  const refused = await drain(state, { exchange, now: NOW, armed: true, venue: VENUES.luno });
  assert.match(refused[0].html, /no ETH copy\. Reason: the buying and selling price of ETH on Luno are 5\d% apart \(limit 0\.5%\)/);
  assert.match(refused[1].html, /no SOL copy\. Reason: Luno has too few SOL offers for an order of Rp165\.000/);
  assert.equal(luno.orders().length, 0);
  assert.deepEqual(liveOf(state).positions, {});
  assert.equal(liveOf(state).mode, "on", "a refusal is not a failure: real trading stays on");

  const limits = limitsOf(liveOf(state));
  assert.equal(marketBlock("BTCUSDT", await exchange.rules("BTCUSDT", 10), limits, VENUES.luno), "");
  assert.equal(MAX_SPREAD_PERCENT, 0.5);
});

test("a book too thin for the order refuses the copy", async () => {
  const books = lunoBooks();
  books.XBTIDR.asks = [{ price: "1650000000", volume: "0.0001" }]; // Rp165.000 on offer
  const luno = fakeLuno({ books });
  const state = newState();
  liveCommand(state, ["shadow"], { env: {}, now: NOW });
  liveCommand(state, ["size", "50"], { env: {}, now: NOW });
  noteFill(state, fill("buy"));
  const refused = await drain(state, { exchange: lunoFor(luno), now: NOW, armed: false });
  assert.match(refused[0].html, /no BTC copy\. Reason: Luno has too few BTC offers for an order of Rp825\.000/);
});

test("the rehearsal on Luno pays the real gap and both fees, in rupiah", async () => {
  const luno = fakeLuno();
  const exchange = lunoFor(luno);
  const state = newState();
  assert.match(liveCommand(state, ["shadow"], { env: {}, now: NOW }).html, /worked out on Luno's real rules, prices and fees/);
  noteFill(state, fill("buy"));
  const bought = await drain(state, { exchange, now: NOW, armed: false });
  assert.match(bought[0].html, /rehearsal\): would buy <b>Rp165\.000<\/b> of BTC on Luno \(XBTIDR, smallest order Rp16\.500, prices 0\.08% apart, fee 0\.21%\)\. Shadow mode: nothing was sent\./);
  const position = liveOf(state).positions.BTCUSDT;
  assert.equal(position.real, false);
  assert.ok(Math.abs(position.qty - (10 / BTC_USDT) * (1 - LUNO_TAKER_FEES.buy)) < 1e-12);

  // Sold at once at the same prices: the whole result is the cost of the round trip, about 0.66%.
  noteFill(state, fill("sell"));
  const sold = await drain(state, { exchange, now: NOW, armed: false });
  assert.match(sold[0].html, /would sell the BTC copy for about Rp163\.906 \(-Rp1\.094\)\. Nothing was sent\./);
  const entry = liveOf(state).log.at(-1);
  assert.ok(Math.abs(entry.result / 10 + 0.00663) < 0.0001, `round trip ${entry.result}`);
  assert.equal(luno.orders().length, 0, "no order is ever sent in shadow");
  assert.equal(luno.requests.some((request) => request.headers.Authorization), false, "without keys nothing private is asked");
});

test("on and armed: a rupiah market buy, then a sell of what is free, and the result in rupiah", async () => {
  const luno = fakeLuno({ balances: { IDR: 1000000, XBT: 0.00015 }, reserved: { XBT: 0.00005 }, pendingLooks: 1 });
  const exchange = lunoFor(luno, { keys: true });
  const state = newState();
  liveCommand(state, ["on", "confirm"], { env: ARMED, now: NOW });
  noteFill(state, fill("buy"));
  const bought = await drain(state, { exchange, now: NOW, armed: true, venue: VENUES.luno });
  assert.match(bought[0].html, /Real money: bought BTC<\/b> for Rp165\.000 on Luno at Rp1\.653\.5\d\d\.\d\d\d \(order BX1\)/);
  const [buy] = luno.orders();
  assert.equal(buy.method, "POST");
  assert.equal(buy.headers.Authorization, "Basic " + btoa("id-1:secret-2"));
  assert.equal(buy.params.get("pair"), "XBTIDR");
  assert.equal(buy.params.get("type"), "BUY");
  assert.equal(buy.params.get("counter_volume"), "165000", "whole rupiah");
  assert.equal(buy.params.get("base_volume"), null);
  const position = liveOf(state).positions.BTCUSDT;
  assert.equal(position.real, true);
  assert.equal(position.native.cost, 165000);
  assert.ok(Math.abs(position.qty - 0.0001 * (1 - 0.002122)) < 1e-12, "the coins left after Luno's fee");

  noteFill(state, fill("sell"));
  const sold = await drain(state, { exchange, now: NOW, armed: true, venue: VENUES.luno });
  const sell = luno.orders()[1];
  assert.equal(sell.params.get("type"), "SELL");
  assert.equal(sell.params.get("base_volume"), "0.000099", "what was bought, rounded down to Luno's step");
  assert.equal(sell.params.get("counter_volume"), null);
  assert.match(sold[0].html, /Real money: sold BTC<\/b> for Rp162\.61\d on Luno \(-Rp1\.08\d\)/);
  assert.deepEqual(liveOf(state).positions, {});
});

test("a moving rupiah rate does not invent a profit or a loss: the result comes from the rupiah paid and received", async () => {
  let rate = LUNO_RATE;
  const luno = fakeLuno({ balances: { IDR: 1000000, XBT: 1 } });
  const exchange = lunoFor(luno, { keys: true, rate: () => rate });
  const state = newState();
  liveCommand(state, ["on", "confirm"], { env: ARMED, now: NOW });
  noteFill(state, fill("buy"));
  await drain(state, { exchange, now: NOW, armed: true, venue: VENUES.luno });
  rate = 18000; // the rupiah weakens 9% while the coin is held; its rupiah price stays
  noteFill(state, fill("sell"));
  await drain(state, { exchange, now: NOW, armed: true, venue: VENUES.luno });
  const entry = liveOf(state).log.at(-1);
  assert.equal(entry.status, "filled");
  assert.ok(entry.result < 0 && entry.result > -0.1, `only the fees and the gap are lost, not 9%: ${entry.result}`);
});

test("a real coin is not sold into a collapsed book: it is kept, said, and real trading drops to shadow", async () => {
  const luno = fakeLuno({ balances: { IDR: 1000000, XBT: 1 } });
  const exchange = lunoFor(luno, { keys: true });
  const state = newState();
  liveCommand(state, ["on", "confirm"], { env: ARMED, now: NOW });
  noteFill(state, fill("buy"));
  await drain(state, { exchange, now: NOW, armed: true, venue: VENUES.luno });
  luno.books.XBTIDR.bids = [{ price: "825000000", volume: "1" }]; // the buyers are gone: half price
  noteFill(state, fill("sell"));
  const messages = await drain(state, { exchange, now: NOW, armed: true, venue: VENUES.luno });
  assert.match(messages[0].html, /the BTC sell failed\.<\/b> the real BTC was not sold because its buying and selling price are 67% apart on Luno/);
  assert.match(messages[0].html, /still in your Luno account/);
  assert.equal(luno.orders().length, 1, "only the buy was sent");
  assert.equal(liveOf(state).positions.BTCUSDT.real, true);
  assert.equal(liveOf(state).mode, "shadow");
});

test("without a rupiah rate nothing is worked out and nothing is sent", async () => {
  const luno = fakeLuno();
  const exchange = lunoFor(luno, { keys: true, rate: () => null });
  const state = newState();
  liveCommand(state, ["on", "confirm"], { env: ARMED, now: NOW });
  noteFill(state, fill("buy"));
  const messages = await drain(state, { exchange, now: NOW, armed: true, venue: VENUES.luno });
  assert.match(messages[0].html, /the BTC buy failed\.<\/b> no rupiah rate is known yet/);
  assert.equal(luno.orders().length, 0);
  assert.equal(liveOf(state).mode, "shadow");
});

test("a refused Luno order switches real trading back to shadow", async () => {
  const luno = fakeLuno({ orderError: "Insufficient balance" });
  const exchange = lunoFor(luno, { keys: true });
  const state = newState();
  liveCommand(state, ["on", "confirm"], { env: ARMED, now: NOW });
  noteFill(state, fill("buy"));
  const messages = await drain(state, { exchange, now: NOW, armed: true, venue: VENUES.luno });
  assert.match(messages[0].html, /the BTC buy failed\.<\/b> Luno: Insufficient balance/);
  assert.equal(liveOf(state).mode, "shadow");
  assert.deepEqual(liveOf(state).positions, {});
});

test("/live on Luno talks in rupiah and names the gap rule", () => {
  const state = newState();
  const html = liveCommand(state, [], { env: {}, now: NOW }).html;
  assert.match(html, /Exchange: Luno \(licensed in Indonesia\), rupiah markets\./);
  assert.match(html, /copied with <b>Rp165\.000<\/b>; at most Rp495\.000 in at once/);
  assert.match(html, /under 0\.5%\. That is usually bitcoin only\./);
  assert.match(html, /Missing: the Worker setting LIVE_TRADING = "enabled"; the Luno API key and secret \(Worker secrets LUNO_API_KEY_ID, LUNO_API_SECRET\)/);
  assert.match(liveCommand(state, ["size", "150rb"], { env: {}, now: NOW }).html, /Real trades are now Rp149\.985 each/); // kept as 9.09 USDT
});
