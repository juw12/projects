// End-to-end API test for the Mint worker.
// Usage: node test/api_test.mjs http://127.0.0.1:8787   (against `npm run dev`, PLATFORM_FEE_PCT=10)
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
await import(path.join(here, "../../web/js/core.js"));
const Core = globalThis.MintCore;

const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const ORIGIN = "http://127.0.0.1:48714";
let passed = 0;

function ok(name) {
  passed += 1;
  console.log("  ok  " + name);
}

async function api(method, route, { token, body, origin = ORIGIN } = {}) {
  const headers = { Origin: origin };
  if (token) {
    headers.Authorization = "Bearer " + token;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(BASE + "/api/" + route, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

const stamp = Date.now().toString(36);
const email = (who) => `${who}-${stamp}@example.test`;

async function register(who, name) {
  const r = await api("POST", "auth/register", { body: { email: email(who), name, password: "correct horse 1" } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.token && r.data.user.id);
  return r.data;
}

// ---- health + CORS
let r = await api("GET", "health");
assert.equal(r.status, 200);
assert.equal(r.data.app, "mint");
assert.equal(r.data.mode, "cloud");
const fee = r.data.platformFeePct;
ok("health (fee " + fee + "%, ai " + r.data.ai + ")");
assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
const pre = await fetch(BASE + "/api/listings", { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" } });
assert.equal(pre.status, 204);
assert.match(pre.headers.get("access-control-allow-headers"), /Authorization/);
r = await api("GET", "health", { origin: "https://evil.example" });
assert.equal(r.headers.get("access-control-allow-origin"), null);
ok("CORS allows the app origin only");

// ---- accounts
r = await api("POST", "auth/register", { body: { email: email("weak"), name: "Weak", password: "short" } });
assert.equal(r.status, 400);
r = await api("POST", "auth/register", { body: { email: "not-an-email", name: "X", password: "long enough 1" } });
assert.equal(r.status, 400);
const seller = await register("seller", "Sari Seller");
const affiliate = await register("aff", "Andi Affiliate");
const buyer = await register("buyer", "Budi Buyer");
const buyer2 = await register("buyer2", "Citra");
r = await api("POST", "auth/register", { body: { email: email("seller"), name: "Dup", password: "correct horse 1" } });
assert.equal(r.status, 409);
ok("register + validation + duplicate email");
r = await api("POST", "auth/login", { body: { email: email("seller"), password: "wrong password" } });
assert.equal(r.status, 401);
r = await api("POST", "auth/login", { body: { email: email("seller").toUpperCase(), password: "correct horse 1" } });
assert.equal(r.status, 200);
const sellerToken2 = r.data.token;
r = await api("GET", "me", { token: sellerToken2 });
assert.equal(r.data.user.name, "Sari Seller");
r = await api("GET", "me");
assert.equal(r.data.user, null);
r = await api("GET", "templates");
assert.equal(r.status, 401);
ok("login, bearer session, anonymous me");

// ---- drafts + publish
const spec = Core.generate("inventory for my toko in rupiah, ocean theme").spec;
r = await api("POST", "templates", { token: seller.token, body: { title: spec.title, spec } });
assert.equal(r.status, 200);
const templateId = r.data.template.id;
r = await api("POST", "templates", { token: buyer.token, body: { id: templateId, title: "hijack", spec } });
assert.equal(r.status, 403);
r = await api("POST", "templates", { token: seller.token, body: { title: "bad", spec: { sheet: { columns: [] } } } });
assert.equal(r.status, 400);
ok("drafts are private and validated");

const listingBody = {
  templateId, title: "Toko Stock Pro", description: "Stock levels and reorder alerts.", category: "Business",
  tags: ["stok", "toko"], price: 49000, currency: "IDR", commissionPct: 30, spec,
};
r = await api("POST", "listings", { token: seller.token, body: listingBody });
assert.equal(r.status, 400, "paid listing without payment link must fail");
r = await api("POST", "listings", { token: seller.token, body: { ...listingBody, paymentUrl: "http://pay.example/x" } });
assert.equal(r.status, 400);
r = await api("POST", "listings", { token: seller.token, body: { ...listingBody, paymentUrl: "https://lynk.id/sari/toko-stock" } });
assert.equal(r.status, 201, JSON.stringify(r.data));
const listing = r.data.listing;
assert.equal(listing.price, 49000);
assert.equal(listing.hasPaymentLink, true);
assert.equal(listing.paymentUrl, undefined, "payment link is not exposed in summaries");
ok("publish requires an https payment link for paid templates");

// ---- affiliate link + click
r = await api("POST", "affiliate/links", { token: seller.token, body: { listingId: listing.id } });
assert.equal(r.status, 400);
r = await api("POST", "affiliate/links", { token: affiliate.token, body: { listingId: listing.id } });
assert.equal(r.status, 201);
const code = r.data.link.code;
r = await api("POST", "affiliate/links", { token: affiliate.token, body: { listingId: listing.id } });
assert.equal(r.data.link.code, code);
await api("POST", "affiliate/click", { body: { code } });
await api("POST", "affiliate/click", { body: { code } });
r = await api("POST", "me", { token: affiliate.token, body: { payoutInfo: "BCA 123456789 a.n. Andi" } });
assert.equal(r.data.user.payoutInfo, "BCA 123456789 a.n. Andi");
ok("affiliate link (no self-links), clicks, payout details");

// ---- order: pending until the seller confirms
r = await api("POST", `listings/${listing.id}/order`, { token: seller.token, body: {} });
assert.equal(r.status, 400, "seller cannot buy own listing");
r = await api("POST", `listings/${listing.id}/order`, { token: buyer.token, body: { ref: code } });
assert.equal(r.status, 201, JSON.stringify(r.data));
const order = r.data.order;
assert.equal(order.status, "pending");
assert.match(order.ref, /^M-[A-Z2-9]{6}$/);
assert.equal(r.data.paymentUrl, "https://lynk.id/sari/toko-stock");
assert.equal(order.commission, 14700);
r = await api("POST", `listings/${listing.id}/order`, { token: buyer.token, body: { ref: code } });
assert.equal(r.data.existing, true);
assert.equal(r.data.order.id, order.id);
r = await api("GET", `listings/${listing.id}`, { token: buyer.token });
assert.equal(r.data.listing.owned, false);
assert.equal(r.data.listing.pendingOrder.ref, order.ref);
r = await api("GET", "library", { token: buyer.token });
assert.equal(r.data.items.length, 0);
r = await api("POST", `listings/${listing.id}/reviews`, { token: buyer.token, body: { rating: 5, body: "x" } });
assert.equal(r.status, 403);
ok("order is pending, idempotent, no access or reviews before payment");

r = await api("POST", `orders/${order.id}/confirm`, { token: buyer.token, body: {} });
assert.equal(r.status, 403);
r = await api("POST", `orders/${order.id}/confirm`, { token: affiliate.token, body: {} });
assert.equal(r.status, 403);
r = await api("GET", "seller", { token: seller.token });
const pend = r.data.pending.find((p) => p.id === order.id);
assert.ok(pend);
assert.equal(pend.buyerEmail, email("buyer"));
assert.equal(pend.ref, order.ref);
r = await api("POST", `orders/${order.id}/confirm`, { token: seller.token, body: {} });
assert.equal(r.status, 200);
assert.equal(r.data.order.status, "paid");
r = await api("POST", `orders/${order.id}/confirm`, { token: seller.token, body: {} });
assert.equal(r.status, 400);
ok("only the seller confirms payment (once)");

r = await api("GET", "library", { token: buyer.token });
assert.equal(r.data.items.length, 1);
assert.equal(r.data.items[0].ref, order.ref);
assert.ok(r.data.items[0].spec.sheet.columns.length > 3);
r = await api("POST", `listings/${listing.id}/reviews`, { token: buyer.token, body: { rating: 5, body: "Stok jadi rapi" } });
assert.equal(r.status, 200);
r = await api("GET", `listings/${listing.id}`);
assert.equal(r.data.listing.sales, 1);
assert.equal(r.data.listing.rating, 5);
assert.equal(r.data.listing.paymentUrl, "", "anonymous visitors do not see the payment link");
ok("paid order unlocks library, review, sales count");

// ---- ledger
const expectedFee = Math.round(49000 * fee / 100);
r = await api("GET", "seller", { token: seller.token });
const row = r.data.listings.find((l) => l.id === listing.id);
assert.equal(row.gross, 49000);
assert.equal(row.fees, expectedFee);
assert.equal(row.commissions, 14700);
assert.equal(row.net, 49000 - expectedFee - 14700);
const payout = r.data.payouts.find((p) => p.id === order.id);
assert.equal(payout.affiliateName, "Andi Affiliate");
assert.equal(payout.affiliatePayout, "BCA 123456789 a.n. Andi");
assert.equal(payout.commissionPaid, false);
r = await api("GET", "affiliate", { token: affiliate.token });
let link = r.data.links.find((l) => l.code === code);
assert.equal(link.clicks, 1, "repeat clicks from the same network count once per hour");
assert.equal(link.sales, 1);
assert.equal(link.earnings, 14700);
assert.equal(link.paidOut, 0);
r = await api("POST", `orders/${order.id}/commission-paid`, { token: seller.token, body: {} });
assert.equal(r.status, 200);
r = await api("GET", "affiliate", { token: affiliate.token });
link = r.data.links.find((l) => l.code === code);
assert.equal(link.paidOut, 14700);
ok(`ledger: gross 49000, fee ${expectedFee}, affiliate 14700, seller ${49000 - expectedFee - 14700}; commission payout tracked`);

// ---- reject / cancel / re-order
r = await api("POST", `listings/${listing.id}/order`, { token: buyer2.token, body: {} });
const o2 = r.data.order;
assert.equal(o2.commission, 0);
r = await api("POST", `orders/${o2.id}/reject`, { token: seller.token, body: {} });
assert.equal(r.data.order.status, "rejected");
r = await api("POST", `listings/${listing.id}/order`, { token: buyer2.token, body: {} });
assert.notEqual(r.data.order.id, o2.id);
r = await api("POST", `orders/${r.data.order.id}/cancel`, { token: buyer2.token, body: {} });
assert.equal(r.data.order.status, "cancelled");
r = await api("GET", "orders", { token: buyer2.token });
assert.deepEqual(r.data.orders.map((o) => o.status).sort(), ["cancelled", "rejected"]);
ok("reject, cancel and re-order");

// ---- free template = instant
r = await api("GET", "listings?free=1");
const freebie = r.data.listings.find((l) => l.sellerId !== seller.user.id && l.price === 0);
assert.ok(freebie, "seed free listings exist");
r = await api("POST", `listings/${freebie.id}/order`, { token: buyer2.token, body: {} });
assert.equal(r.data.order.status, "paid");
r = await api("GET", "library", { token: buyer2.token });
assert.equal(r.data.items.length, 1);
ok("free templates land in the library instantly");

// ---- edit / unpublish
r = await api("POST", `listings/${listing.id}/edit`, { token: seller.token, body: { paymentUrl: "" } });
assert.equal(r.status, 400);
r = await api("POST", `listings/${listing.id}/edit`, { token: buyer.token, body: { price: 1 } });
assert.equal(r.status, 403);
r = await api("POST", `listings/${listing.id}/edit`, { token: seller.token, body: { price: 59000, commissionPct: 25 } });
assert.equal(r.data.listing.price, 59000);
r = await api("POST", `listings/${listing.id}/unpublish`, { token: seller.token, body: {} });
assert.equal(r.data.status, "hidden", JSON.stringify(r));
r = await api("GET", "listings?q=toko%20stock");
assert.ok(!r.data.listings.some((l) => l.id === listing.id));
r = await api("GET", `listings/${listing.id}`, { token: buyer2.token });
assert.equal(r.status, 404);
r = await api("POST", `listings/${listing.id}/republish`, { token: seller.token, body: {} });
assert.equal(r.data.status, "live");
ok("edit, unpublish, republish");

// ---- AI endpoint (no binding locally → 503; live → spec)
r = await api("POST", "ai/template", { token: buyer.token, body: { prompt: "habit tracker" } });
assert.ok([200, 503, 429].includes(r.status), "ai status " + r.status);
if (r.status === 200) {
  assert.ok(r.data.spec.sheet.columns.length >= 2);
}
ok("AI endpoint answers (" + r.status + ")");

// ---- non-JSON post rejected, logout
const raw = await fetch(BASE + "/api/templates", { method: "POST", headers: { Authorization: "Bearer " + seller.token, "Content-Type": "text/plain" }, body: "{}" });
assert.equal(raw.status, 415);
r = await api("POST", "auth/logout", { token: sellerToken2, body: {} });
r = await api("GET", "me", { token: sellerToken2 });
assert.equal(r.data.user, null);
ok("JSON-only writes, logout ends the session");

// ---- login rate limit (last: it blocks this network for 5 minutes)
let limited = false;
for (let i = 0; i < 12; i += 1) {
  r = await api("POST", "auth/login", { body: { email: email("buyer"), password: "nope nope" } });
  if (r.status === 429) {
    limited = true;
    break;
  }
}
assert.ok(limited);
ok("login attempts are rate limited");

console.log(`\nPASSED ${passed} checks against ${BASE}`);
