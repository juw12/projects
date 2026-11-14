// Which Indonesian exchanges answer from where this Worker runs?
//
// Real orders need an exchange that (1) is licensed in Indonesia, (2) gives ordinary customers an
// API and (3) answers Cloudflare. Tokocrypto refuses Cloudflare (HTTP 403), so this asks the others
// the same question: each one's public BTC price in rupiah, and for Indodax and Tokocrypto the door
// that orders go through. No keys are sent and nothing is bought: an order door that answers
// "you did not sign this" is open, and that is all this needs to know.

import { USER_AGENT, clip, errorText } from "./util.js";

const TIMEOUT_MS = 8000;
const SANE_BTC_IDR = { min: 1e8, max: 1e11 }; // one bitcoin in rupiah; anything outside is a broken answer

function btcIdr(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < SANE_BTC_IDR.min || price > SANE_BTC_IDR.max) {
    throw new Error("no believable BTC price in the answer");
  }
  return { btcIdr: Math.round(price) };
}

// read(body, status) returns extra facts for the answer, or throws when the answer is not usable.
export const VENUES = [
  {
    name: "Indodax",
    quote: "IDR",
    kind: "price",
    url: "https://indodax.com/api/ticker/btcidr",
    read: (body) => btcIdr(body && body.ticker && body.ticker.last),
  },
  {
    // The private API, asked without a key: "sign not found" means the door answers from here.
    name: "Indodax orders",
    quote: "IDR",
    kind: "orders",
    url: "https://indodax.com/tapi",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "method=getInfo&nonce=1",
    },
    read: (body) => {
      if (!body || body.success !== 0 || !/sign|key|credential/i.test(String(body.error_code || body.error || ""))) {
        throw new Error("the order door did not answer as expected");
      }
      return {};
    },
  },
  {
    name: "Luno",
    quote: "IDR",
    kind: "price",
    url: "https://api.luno.com/api/1/ticker?pair=XBTIDR",
    read: (body) => btcIdr(body && body.last_trade),
  },
  {
    name: "Upbit Indonesia",
    quote: "IDR",
    kind: "price",
    url: "https://id-api.upbit.com/v1/ticker?markets=IDR-BTC",
    read: (body) => btcIdr(Array.isArray(body) && body[0] && body[0].trade_price),
  },
  {
    name: "Reku",
    quote: "IDR",
    kind: "price",
    url: "https://api.reku.id/v2/price",
    read: (body) => btcIdr(((Array.isArray(body) ? body : []).find((row) => row && row.cd === "BTC") || {}).c),
  },
  {
    name: "Tokocrypto",
    quote: "USDT",
    kind: "orders",
    url: "https://www.tokocrypto.com/open/v1/common/time",
    read: (body) => {
      if (!body || body.code !== 0) throw new Error("the exchange did not answer as expected");
      return {};
    },
  },
];

// Ask every venue once: { name: { ok, quote, kind, status, ms, btcIdr?, error? } }. Never throws.
export async function probeVenues({ fetch, venues = VENUES }) {
  const asked = venues.map(async (venue) => {
    const started = Date.now();
    const answer = { ok: false, quote: venue.quote, kind: venue.kind, status: 0 };
    try {
      const init = venue.init || {};
      const response = await fetch(venue.url, {
        ...init,
        headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...(init.headers || {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      answer.status = response.status;
      const body = await response.json().catch(() => null);
      if (body === null) throw new Error(`HTTP ${response.status}, not JSON (a block page?)`);
      Object.assign(answer, venue.read(body, response.status), { ok: true });
    } catch (error) {
      answer.error = clip(errorText(error), 160);
    }
    answer.ms = Date.now() - started;
    return [venue.name, answer];
  });
  return Object.fromEntries(await Promise.all(asked));
}
