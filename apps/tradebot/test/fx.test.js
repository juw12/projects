// Rupiah: the rate chain, typed amounts and how money is written.
import test from "node:test";
import assert from "node:assert/strict";
import { FX_TTL_MS, readAmount, refreshRate, toUsdt } from "../src/fx.js";
import * as render from "../src/render.js";
import { liveCommand, newLive } from "../src/live.js";

function fakeFetch(answers) {
  const asked = [];
  const fetch = async (url) => {
    asked.push(url);
    for (const [part, answer] of Object.entries(answers)) {
      if (url.includes(part)) {
        if (answer instanceof Error) throw answer;
        return new Response(JSON.stringify(answer), { status: 200 });
      }
    }
    return new Response("no", { status: 403 });
  };
  return { fetch, asked };
}

test("the rate comes from Indodax first and is kept for an hour", async () => {
  const { fetch, asked } = fakeFetch({ indodax: { ticker: { last: "18252" } } });
  const state = {};
  await refreshRate(state, { fetch, now: 1000 });
  assert.deepEqual(state.fx, { rate: 18252, source: "Indodax", at: 1000 });
  await refreshRate(state, { fetch, now: 1000 + FX_TTL_MS - 1 });
  assert.equal(asked.length, 1, "no second call inside the hour");
});

test("when Indodax fails the next source answers, and nonsense is refused", async () => {
  const { fetch } = fakeFetch({
    indodax: { ticker: { last: "18" } }, // not a believable rupiah rate
    coingecko: { tether: { idr: 18230.61 } },
  });
  const state = {};
  await refreshRate(state, { fetch, now: 5 });
  assert.equal(state.fx.source, "CoinGecko");
  assert.equal(state.fx.rate, 18230.61);
});

test("all sources down: the old rate is kept, and no rate at all stays null", async () => {
  const { fetch } = fakeFetch({});
  const kept = { fx: { rate: 18000, source: "Indodax", at: 0 } };
  await refreshRate(kept, { fetch, now: FX_TTL_MS * 2 });
  assert.equal(kept.fx.rate, 18000);
  const none = {};
  await refreshRate(none, { fetch, now: 1 });
  assert.equal(none.fx, undefined);
});

test("typed amounts: plain, Indonesian dots, rb / jt / m, dollars", () => {
  assert.deepEqual(readAmount("500000"), { value: 500000, unit: null });
  assert.deepEqual(readAmount("1.500.000"), { value: 1500000, unit: null });
  assert.deepEqual(readAmount("500rb"), { value: 500000, unit: "idr" });
  assert.deepEqual(readAmount("1,5jt"), { value: 1500000, unit: "idr" });
  assert.deepEqual(readAmount("2 juta"), { value: 2000000, unit: "idr" });
  assert.deepEqual(readAmount("Rp100.000"), { value: 100000, unit: "idr" });
  assert.deepEqual(readAmount("$50"), { value: 50, unit: "usd" });
  assert.deepEqual(readAmount("10usdt"), { value: 10, unit: "usd" });
  assert.equal(readAmount("abc"), null);
  assert.equal(toUsdt("2jt", 20000), 100);
  assert.equal(toUsdt("$50", 20000), 50);
  assert.equal(toUsdt("500", null), 500, "no rate: dollars, as before");
  assert.ok(Number.isNaN(toUsdt("2jt", null)), "rupiah with no rate cannot be converted");
});

test("money and prices are written in rupiah once a rate is set", () => {
  try {
    render.useRate(18000);
    assert.equal(render.money(10000), "Rp180.000.000");
    assert.equal(render.money(-2.5), "-Rp45.000");
    assert.equal(render.signedMoney(1.5), "+Rp27.000");
    assert.equal(render.signedMoney(0), "Rp0");
    assert.equal(render.price(100000), "Rp1.800.000.000");
    assert.equal(render.price(0.16), "Rp2.880");
    assert.equal(render.price(0.0001), "Rp1,80");
    assert.match(render.rateLine({ source: "Indodax" }), /1 USDT = Rp18\.000 \(Indodax\)/);
    render.useRate(null);
    assert.equal(render.money(10000), "$10,000.00", "no rate: dollars");
    assert.equal(render.rateLine(), null);
  } finally {
    render.useRate(null);
  }
});

test("/live size takes rupiah too, and shows USDT with rupiah beside it", () => {
  const state = { live: newLive() };
  try {
    render.useRate(20000);
    const set = liveCommand(state, ["size", "200rb"], { env: {}, now: 0 });
    assert.equal(state.live.orderUsdt, 10);
    assert.match(set.html, /10\.00 USDT \(Rp200\.000\)/);
    liveCommand(state, ["size", "15"], { env: {}, now: 0 });
    assert.equal(state.live.orderUsdt, 15, "a small plain number is USDT");
    const tooBig = liveCommand(state, ["size", "5jt"], { env: {}, now: 0 });
    assert.match(tooBig.html, /Nothing changed/);
    assert.equal(state.live.orderUsdt, 15);
  } finally {
    render.useRate(null);
  }
});
