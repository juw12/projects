import assert from "node:assert/strict";
import { test } from "node:test";

import { USER_AGENT } from "../src/util.js";
import { VENUES, probeVenues } from "../src/venues.js";
import { fakeFetch, reply } from "./fakes.js";

const BLOCK_PAGE = () => new Response("<html>Sorry, you have been blocked</html>", { status: 403, headers: { "Content-Type": "text/html" } });

test("the name sent to exchanges has no 'bot' in it (Indodax answers 403 to those)", () => {
  assert.equal(/bot/i.test(USER_AGENT), false);
});

test("venues: every exchange is asked once, with the neutral name, and says what it found", async () => {
  const seen = [];
  const fetch = fakeFetch([
    [
      "https://indodax.com/api/ticker/btcidr",
      (url, init) => {
        seen.push(init.headers["User-Agent"]);
        return reply({ ticker: { last: "1734567000" } });
      },
    ],
    [
      "https://indodax.com/tapi",
      (url, init) => {
        assert.equal(init.method, "POST");
        assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
        return reply({ success: 0, error: "Bad sign.", error_code: "invalid_credentials" });
      },
    ],
    ["https://api.luno.com/", () => reply({ pair: "XBTIDR", last_trade: "1740000000.00" })],
    ["https://id-api.upbit.com/", () => reply([{ market: "IDR-BTC", trade_price: 1738000000 }])],
    ["https://api.reku.id/", () => reply([{ cd: "ETH", c: "60000000" }, { cd: "BTC", c: "1736000000" }])],
    ["https://www.tokocrypto.com/", BLOCK_PAGE],
  ]);
  const venues = await probeVenues({ fetch });

  assert.deepEqual(Object.keys(venues), VENUES.map((venue) => venue.name));
  assert.deepEqual(seen, [USER_AGENT]);
  assert.equal(fetch.calls.length, VENUES.length);

  assert.deepEqual({ ...venues.Indodax, ms: 0 }, { ok: true, quote: "IDR", kind: "price", status: 200, btcIdr: 1734567000, ms: 0 });
  assert.equal(venues["Indodax orders"].ok, true, "a 'you did not sign this' answer means the order door is open");
  assert.equal(venues["Indodax orders"].kind, "orders");
  assert.equal(venues.Luno.btcIdr, 1740000000);
  assert.equal(venues["Upbit Indonesia"].btcIdr, 1738000000);
  assert.equal(venues.Reku.btcIdr, 1736000000);

  assert.equal(venues.Tokocrypto.ok, false);
  assert.equal(venues.Tokocrypto.status, 403);
  assert.match(venues.Tokocrypto.error, /HTTP 403, not JSON/);
});

test("venues: a price that cannot be one bitcoin in rupiah is not believed", async () => {
  const fetch = fakeFetch([
    ["https://indodax.com/api/ticker/btcidr", () => reply({ ticker: { last: "97000" } })], // dollars, not rupiah
    ["https://indodax.com/tapi", () => reply({ success: 1, return: {} })], // an order door that lets anyone in is not what was asked
    ["https://api.luno.com/", () => reply({ error: "Invalid currency pair" }, { status: 400 })],
  ]);
  const venues = await probeVenues({ fetch });
  assert.equal(venues.Indodax.ok, false);
  assert.match(venues.Indodax.error, /no believable BTC price/);
  assert.equal(venues["Indodax orders"].ok, false);
  assert.equal(venues.Luno.ok, false);
  assert.equal(venues.Luno.status, 400);
  assert.equal(venues.Reku.ok, false, "no route at all: the venue is down, the probe still answers");
  assert.equal(Object.values(venues).some((venue) => venue.ok), false);
});

test("venues: a network that throws is reported, never thrown", async () => {
  const fetch = async () => {
    throw new Error("connection reset");
  };
  const venues = await probeVenues({ fetch });
  for (const venue of Object.values(venues)) {
    assert.equal(venue.ok, false);
    assert.equal(venue.status, 0);
    assert.match(venue.error, /connection reset/);
  }
});
