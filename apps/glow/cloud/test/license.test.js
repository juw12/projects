// Glow Pro plans and license checks, against a fake Lemon Squeezy License API (no network, no browser).
// Run: node --test apps/glow/cloud/test/
import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

const ORIGIN = "https://juw12.github.io";
const ON_SALE = {
  ALLOWED_ORIGINS: ORIGIN,
  PRO_STORE_ID: "1234",
  PRO_PRODUCT_ID: "555",
  PRO_CHECKOUT_URL: "https://glow.lemonsqueezy.com/buy/abc",
  PRO_PRICE_LABEL: "US$5 / month",
};

function fakeLemonSqueezy() {
  const calls = [];
  const keys = {
    "GOOD-KEY-0001": { status: "active", store: 1234, product: 555 },
    "ENDED-KEY-001": { status: "expired", store: 1234, product: 555 },
    "OTHER-STORE-01": { status: "active", store: 9999, product: 555 },
  };
  const fetch = async (url, options) => {
    const form = new URLSearchParams(options.body);
    const action = url.split("/").pop();
    calls.push({ action, form: Object.fromEntries(form) });
    const key = keys[form.get("license_key")];
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (!key) return reply(404, { error: "license_key not found.", valid: false, activated: false, meta: null });
    const meta = { store_id: key.store, product_id: key.product, customer_name: "Juwen" };
    const license = { status: key.status, expires_at: null };
    if (action === "activate") return reply(200, { activated: key.status === "active", license_key: license, instance: { id: "inst-1" }, meta });
    if (action === "deactivate") return reply(200, { deactivated: true, meta });
    return reply(200, { valid: key.status === "active", license_key: license, meta });
  };
  return { fetch, calls };
}

function appWith(env, fake) {
  const handle = createApp({ launch: async () => { throw new Error("no browser in this test"); }, connect: async () => { throw new Error("no browser"); }, fetch: fake.fetch });
  return async (method, path, body, origin = ORIGIN) => {
    const headers = { "Content-Type": "application/json" };
    if (origin) headers.Origin = origin;
    const response = await handle(new Request("https://glow-cloud.example" + path, {
      method, headers, body: method === "POST" ? JSON.stringify(body || {}) : undefined,
    }), env);
    return { status: response.status, data: await response.json() };
  };
}

test("plans: Pro is not on sale until the store and checkout are set", async () => {
  const fake = fakeLemonSqueezy();
  const send = appWith({ ALLOWED_ORIGINS: ORIGIN, PRO_PRICE_LABEL: "US$5 / month" }, fake);
  const plans = await send("GET", "/v1/plans");
  assert.equal(plans.status, 200);
  assert.equal(plans.data.onSale, false);
  assert.equal(plans.data.checkoutUrl, "");
  const license = await send("POST", "/v1/license", { action: "activate", licenseKey: "GOOD-KEY-0001" });
  assert.equal(license.status, 503);
  assert.equal(fake.calls.length, 0);
});

test("plans: on sale shows the checkout link, only to Glow's own sites", async () => {
  const send = appWith(ON_SALE, fakeLemonSqueezy());
  const plans = await send("GET", "/v1/plans");
  assert.equal(plans.data.onSale, true);
  assert.equal(plans.data.checkoutUrl, ON_SALE.PRO_CHECKOUT_URL);
  assert.equal(plans.data.priceLabel, "US$5 / month");
  assert.equal((await send("GET", "/v1/plans", null, "https://evil.example")).status, 403);
});

test("license: activate, validate and deactivate a real Pro key", async () => {
  const fake = fakeLemonSqueezy();
  const send = appWith(ON_SALE, fake);
  const activated = await send("POST", "/v1/license", { action: "activate", licenseKey: "GOOD-KEY-0001", device: "Glow on Android" });
  assert.equal(activated.status, 200);
  assert.equal(activated.data.pro, true);
  assert.equal(activated.data.instanceId, "inst-1");
  assert.equal(fake.calls[0].form.instance_name, "Glow on Android");
  const valid = await send("POST", "/v1/license", { action: "validate", licenseKey: "GOOD-KEY-0001", instanceId: "inst-1" });
  assert.equal(valid.data.pro, true);
  assert.equal(fake.calls[1].form.instance_id, "inst-1");
  const off = await send("POST", "/v1/license", { action: "deactivate", licenseKey: "GOOD-KEY-0001", instanceId: "inst-1" });
  assert.equal(off.data.pro, false);
  assert.equal(off.data.deactivated, true);
});

test("license: ended, unknown, other-store and malformed keys never give Pro", async () => {
  const fake = fakeLemonSqueezy();
  const send = appWith(ON_SALE, fake);
  const ended = await send("POST", "/v1/license", { action: "validate", licenseKey: "ENDED-KEY-001", instanceId: "inst-1" });
  assert.equal(ended.data.pro, false);
  assert.match(ended.data.error, /ended/);
  const unknown = await send("POST", "/v1/license", { action: "activate", licenseKey: "NO-SUCH-KEY-1" });
  assert.equal(unknown.data.pro, false);
  assert.match(unknown.data.error, /wasn't found/);
  const other = await send("POST", "/v1/license", { action: "activate", licenseKey: "OTHER-STORE-01" });
  assert.equal(other.data.pro, false);
  assert.match(other.data.error, /not for Glow Pro/);
  const before = fake.calls.length;
  const malformed = await send("POST", "/v1/license", { action: "activate", licenseKey: "x\"; drop" });
  assert.equal(malformed.status, 400);
  assert.equal((await send("POST", "/v1/license", { action: "steal", licenseKey: "GOOD-KEY-0001" })).status, 400);
  assert.equal(fake.calls.length, before);
});

test("license: the license service being down is reported, not treated as Pro", async () => {
  const send = appWith(ON_SALE, { fetch: async () => { throw new Error("offline"); } });
  const result = await send("POST", "/v1/license", { action: "validate", licenseKey: "GOOD-KEY-0001", instanceId: "inst-1" });
  assert.equal(result.status, 502);
  assert.equal(result.data.pro, undefined);
});
