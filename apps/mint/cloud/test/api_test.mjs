// End-to-end API test for the Mint worker.
// Usage: node test/api_test.mjs http://127.0.0.1:8787   (against `npm run dev`, PLATFORM_FEE_PCT=10)
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import { startMockServices, VALID_KEYS } from "./mock_services.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
await import(path.join(here, "../../web/js/core.js"));
const Core = globalThis.MintCore;

const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const ORIGIN = "http://127.0.0.1:48714";
let passed = 0;
const mock = await startMockServices(8799);

// A fake browser push subscription (P-256 key + auth secret) so the test can decrypt what Mint sends.
function fakeSubscription(name) {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh,
    auth,
    json: {
      endpoint: "http://127.0.0.1:8799/push/" + name,
      keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
    },
  };
}

// RFC 8291 decryption + RFC 8292 VAPID check of one captured push.
function openPush(capture, sub, vapidPublicKey) {
  const auth = capture.headers.authorization || "";
  const m = auth.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(m, "VAPID Authorization header");
  assert.equal(m[2], vapidPublicKey);
  const [h, c, s] = m[1].split(".");
  const pub = Buffer.from(vapidPublicKey, "base64url");
  const key = crypto.createPublicKey({
    key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33, 65).toString("base64url") },
    format: "jwk",
  });
  assert.ok(crypto.verify("sha256", Buffer.from(h + "." + c), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")), "VAPID JWT signature");
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.equal(claims.aud, "http://127.0.0.1:8799");
  assert.equal(capture.headers["content-encoding"], "aes128gcm");
  const body = capture.body;
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const uaPublic = sub.ecdh.getPublicKey();
  const secret = sub.ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", secret, sub.auth, info, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 2, "last-record padding delimiter");
  return JSON.parse(plain.subarray(0, plain.length - 1).toString());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = fn();
    if (value) {
      return value;
    }
    await sleep(100);
  }
  throw new Error("timed out waiting for " + label);
}

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
assert.equal(r.data.listing.paymentHost, "lynk.id", "but they see which site they will pay on");
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

// ---- paid preview: non-buyers never receive formulas
const hasFormula = (s) => s.sheet.columns.some((c) => c.type === "formula" || c.formula);
assert.ok(hasFormula(spec), "fixture has formula columns");
r = await api("GET", `listings/${listing.id}`, { token: buyer2.token });
assert.equal(r.data.listing.spec.preview, true);
assert.ok(!hasFormula(r.data.listing.spec), "preview must not leak formulas");
assert.ok(r.data.listing.spec.sheet.columns.some((c) => c.locked));
assert.ok(r.data.listing.spec.sheet.rows.length <= 8);
r = await api("GET", `listings/${listing.id}`);
assert.ok(!hasFormula(r.data.listing.spec));
r = await api("GET", `listings/${listing.id}`, { token: buyer.token });
assert.ok(hasFormula(r.data.listing.spec) && !r.data.listing.spec.preview, "buyer gets the full spec");
r = await api("GET", `listings/${listing.id}`, { token: seller.token });
assert.ok(hasFormula(r.data.listing.spec), "seller gets the full spec");
ok("paid listings show a formula-free preview to non-buyers");

// ---- notification counts
r = await api("POST", `listings/${listing.id}/order`, { token: buyer2.token, body: {} });
const o3 = r.data.order;
r = await api("GET", "me", { token: seller.token });
assert.equal(r.data.counts.ordersToConfirm, 1);
assert.equal(r.data.hasRecoveryCode, true);
r = await api("GET", "me", { token: buyer2.token });
assert.equal(r.data.counts.awaitingPayment, 1);
await api("POST", `orders/${o3.id}/cancel`, { token: buyer2.token, body: {} });
r = await api("GET", "me", { token: seller.token });
assert.equal(r.data.counts.ordersToConfirm, 0);
ok("me returns badge counts (orders to confirm, awaiting payment)");

// ---- reports: enough distinct reporters hide a listing until review
const flagSpec = Core.generate("weekly habit tracker").spec;
r = await api("POST", "listings", {
  token: seller.token,
  body: { title: "Flag me", description: "test", category: "Personal", tags: [], price: 0, currency: "IDR", commissionPct: 0, spec: flagSpec },
});
assert.equal(r.status, 201, JSON.stringify(r.data));
const flagged = r.data.listing;
r = await api("POST", `listings/${flagged.id}/report`, { token: seller.token, body: { reason: "self" } });
assert.equal(r.status, 400);
r = await api("POST", `listings/${flagged.id}/report`, { token: buyer.token, body: { reason: "" } });
assert.equal(r.status, 400);
for (const who of [buyer, buyer2]) {
  r = await api("POST", `listings/${flagged.id}/report`, { token: who.token, body: { reason: "spam" } });
  assert.equal(r.status, 200);
}
r = await api("POST", `listings/${flagged.id}/report`, { token: buyer.token, body: { reason: "spam again" } });
r = await api("GET", `listings/${flagged.id}`, { token: buyer.token });
assert.equal(r.data.listing.reported, true);
assert.equal(r.data.listing.status, "live", "the same reporter twice counts once");
await api("POST", `listings/${flagged.id}/report`, { token: affiliate.token, body: { reason: "copied" } });
r = await api("GET", "listings?q=flag%20me");
assert.ok(!r.data.listings.some((l) => l.id === flagged.id), "flagged listing leaves the catalog");
r = await api("POST", `listings/${flagged.id}/republish`, { token: seller.token, body: {} });
assert.equal(r.status, 403);
ok("reports: distinct reporters hide a listing, seller can't republish it");

// ---- password change keeps this session only
r = await api("POST", "auth/login", { body: { email: email("aff"), password: "correct horse 1" } });
const affOther = r.data.token;
r = await api("POST", "me/password", { token: affiliate.token, body: { currentPassword: "wrong", newPassword: "new horse 22" } });
assert.equal(r.status, 401);
r = await api("POST", "me/password", { token: affiliate.token, body: { currentPassword: "correct horse 1", newPassword: "short" } });
assert.equal(r.status, 400);
r = await api("POST", "me/password", { token: affiliate.token, body: { currentPassword: "correct horse 1", newPassword: "new horse 22" } });
assert.equal(r.status, 200);
r = await api("GET", "me", { token: affOther });
assert.equal(r.data.user, null, "other sessions are signed out");
r = await api("GET", "me", { token: affiliate.token });
assert.equal(r.data.user.name, "Andi Affiliate");
r = await api("POST", "auth/login", { body: { email: email("aff"), password: "new horse 22" } });
assert.equal(r.status, 200);
ok("change password (current required, other sessions revoked)");

// ---- recovery code resets a forgotten password
assert.match(buyer.recoveryCode, /^MINT-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
r = await api("POST", "auth/recover", { body: { email: email("buyer"), recoveryCode: "MINT-AAAA-BBBB-CCCC", newPassword: "fresh horse 3" } });
assert.equal(r.status, 401);
r = await api("POST", "auth/recover", {
  body: { email: email("buyer"), recoveryCode: buyer.recoveryCode.toLowerCase().replace(/-/g, " "), newPassword: "fresh horse 3" },
});
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.notEqual(r.data.recoveryCode, buyer.recoveryCode, "a new code replaces the used one");
const buyerToken = r.data.token;
r = await api("GET", "me", { token: buyer.token });
assert.equal(r.data.user, null, "old sessions end after recovery");
r = await api("POST", "auth/recover", { body: { email: email("buyer"), recoveryCode: buyer.recoveryCode, newPassword: "again horse 4" } });
assert.equal(r.status, 401, "a used code is single-use");
r = await api("POST", "auth/login", { body: { email: email("buyer"), password: "fresh horse 3" } });
assert.equal(r.status, 200);
r = await api("POST", "me/recovery-code", { token: buyerToken, body: { password: "fresh horse 3" } });
assert.match(r.data.recoveryCode, /^MINT-/);
buyer.token = buyerToken;
ok("recovery code: single-use reset, sessions revoked, regenerate");

// ---- delete account: seller's listings go, buyers keep what they got
const leaver = await register("leaver", "Lena Leaver");
r = await api("POST", "listings", {
  token: leaver.token,
  body: { title: "Leaver freebie", description: "x", category: "Personal", tags: [], price: 0, currency: "IDR", commissionPct: 0, spec: flagSpec },
});
const leaverListing = r.data.listing;
await api("POST", `listings/${leaverListing.id}/order`, { token: buyer2.token, body: {} });
r = await api("POST", "me/delete", { token: leaver.token, body: { password: "nope nope 1" } });
assert.equal(r.status, 401);
r = await api("POST", "me/delete", { token: leaver.token, body: { password: "correct horse 1" } });
assert.equal(r.status, 200);
r = await api("GET", "me", { token: leaver.token });
assert.equal(r.data.user, null);
r = await api("POST", "auth/login", { body: { email: email("leaver"), password: "correct horse 1" } });
assert.equal(r.status, 401);
r = await api("GET", "listings?q=leaver");
assert.ok(!r.data.listings.some((l) => l.id === leaverListing.id));
r = await api("GET", "library", { token: buyer2.token });
assert.ok(r.data.items.some((i) => i.listingId === leaverListing.id || i.id === leaverListing.id || i.title === "Leaver freebie"));
ok("delete account: login gone, listings removed, buyers keep their copy");

// ---- notifications: Web Push subscriptions (decrypted and signature-checked here) + email
r = await api("GET", "health");
assert.equal(r.data.push, true);
assert.equal(r.data.email, true);
assert.equal(r.data.autoPay, true);
const vapidKey = r.data.vapidPublicKey;
assert.equal(Buffer.from(vapidKey, "base64url").length, 65);
const sellerSub = fakeSubscription("seller");
const buyer2Sub = fakeSubscription("buyer2");
const affSub = fakeSubscription("aff");
r = await api("POST", "push/subscribe", { token: seller.token, body: { subscription: { endpoint: "https://x.example/p", keys: { p256dh: "bad", auth: "bad" } } } });
assert.equal(r.status, 400);
r = await api("POST", "push/subscribe", { token: seller.token, body: { subscription: sellerSub.json, test: true } });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.devices, 1);
let pushed = await waitFor(() => mock.state.pushes.find((p) => p.endpoint.endsWith("/push/seller")), "welcome push");
let message = openPush(pushed, sellerSub, vapidKey);
assert.match(message.title, /notifications are on/);
await api("POST", "push/subscribe", { token: buyer2.token, body: { subscription: buyer2Sub.json } });
await api("POST", "push/subscribe", { token: affiliate.token, body: { subscription: affSub.json } });
r = await api("GET", "me", { token: seller.token });
assert.equal(r.data.pushDevices, 1);
assert.equal(r.data.notifyEmail, true);
ok("push subscribe: invalid rejected, VAPID-signed aes128gcm push decrypts on the device side");

mock.state.pushes.length = 0;
mock.state.emails.length = 0;
r = await api("POST", `listings/${listing.id}/order`, { token: buyer2.token, body: {} });
const manualOrder = r.data.order;
pushed = await waitFor(() => mock.state.pushes.find((p) => p.endpoint.endsWith("/push/seller")), "new-order push");
message = openPush(pushed, sellerSub, vapidKey);
assert.equal(message.title, "New order " + manualOrder.ref);
assert.match(message.url, /#\/sell$/);
let mail = await waitFor(() => mock.state.emails.find((e) => e.to[0] === email("seller")), "new-order email");
assert.equal(mail.subject, "New order " + manualOrder.ref);
await api("POST", `orders/${manualOrder.id}/confirm`, { token: seller.token, body: {} });
pushed = await waitFor(() => mock.state.pushes.find((p) => p.endpoint.endsWith("/push/buyer2")), "paid push");
message = openPush(pushed, buyer2Sub, vapidKey);
assert.match(message.title, /^Ready to download/);
r = await api("POST", "me/notifications", { token: buyer2.token, body: { email: false } });
assert.equal(r.data.notifyEmail, false);
ok("seller is notified of new orders (push + email), buyer when payment is confirmed; email opt-out saved");

// ---- automatic payments on the seller's own provider account
r = await api("GET", "me/payments", { token: seller.token });
assert.equal(r.data.enabled, true);
assert.equal(r.data.account, null);
r = await api("POST", "me/payments", { token: seller.token, body: { provider: "midtrans", secretKey: "not-a-key" } });
assert.equal(r.status, 400);
r = await api("POST", "me/payments", { token: seller.token, body: { provider: "midtrans", secretKey: "SB-Mid-server-wrong-key-000000" } });
assert.equal(r.status, 400);
assert.match(r.data.error, /rejected/);
r = await api("POST", "me/payments", { token: seller.token, body: { provider: "midtrans", secretKey: VALID_KEYS.midtrans } });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.account.provider, "midtrans");
assert.equal(r.data.account.sandbox, true);
assert.equal(r.data.account.keyHint, "…" + VALID_KEYS.midtrans.slice(-4));
assert.ok(!JSON.stringify(r.data).includes(VALID_KEYS.midtrans), "secret key is never sent back");
ok("connect Midtrans: format check, key validated with the provider, only a hint is returned");

const autoSpec = Core.generate("expense tracker in rupiah").spec;
r = await api("POST", "listings", {
  token: seller.token,
  body: { title: "Auto Pay Tracker", description: "Instant unlock", category: "Finance", tags: [], price: 25000, currency: "IDR", commissionPct: 20, spec: autoSpec },
});
assert.equal(r.status, 201, "paid listing without a payment link is allowed once automatic payments are on: " + JSON.stringify(r.data));
const autoListing = r.data.listing;
assert.equal(autoListing.autoPay, "midtrans");
r = await api("GET", `listings/${autoListing.id}`);
assert.match(r.data.listing.paymentHost, /Midtrans/);
mock.state.pushes.length = 0;
r = await api("POST", `listings/${autoListing.id}/order`, { token: buyer2.token, body: { returnUrl: "https://evil.example/steal" } });
assert.equal(r.status, 201, JSON.stringify(r.data));
const autoOrder = r.data.order;
assert.equal(autoOrder.autoPay, "midtrans");
assert.match(r.data.paymentUrl, /\/checkout\/midtrans\//);
const tx = mock.state.midtrans[autoOrder.id];
assert.equal(tx.gross, 25000);
assert.equal(tx.body.callbacks.finish, "http://127.0.0.1:48714/app.html#/item/" + autoListing.id, "return URL stays on the app (no open redirect)");
assert.equal(mock.state.notifyUrls[autoOrder.id], BASE + "/api/pay/notify/midtrans");
r = await api("POST", `orders/${autoOrder.id}/check`, { token: buyer2.token, body: {} });
assert.equal(r.data.order.status, "pending");
// A forged "settlement" webhook does nothing: Mint re-checks with the provider API.
await fetch(BASE + "/api/pay/notify/midtrans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: autoOrder.id, transaction_status: "settlement" }) });
r = await api("GET", "orders", { token: buyer2.token });
assert.equal(r.data.orders.find((o) => o.id === autoOrder.id).status, "pending", "forged webhook is ignored");
// The buyer pays on Midtrans; Midtrans calls the notification URL.
mock.pay("midtrans", autoOrder.id);
await fetch(mock.state.notifyUrls[autoOrder.id], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: autoOrder.id, transaction_status: "settlement", status_code: "200", gross_amount: "25000.00" }) });
r = await api("GET", "library", { token: buyer2.token });
assert.ok(r.data.items.some((i) => i.listingId === autoListing.id), "unlocked without the seller doing anything");
pushed = await waitFor(() => mock.state.pushes.find((p) => p.endpoint.endsWith("/push/seller") && openPush(p, sellerSub, vapidKey).title.startsWith("Sold")), "sold push");
r = await api("GET", "seller", { token: seller.token });
assert.ok(!r.data.pending.some((p) => p.id === autoOrder.id), "nothing left for the seller to confirm");
ok("Midtrans: checkout on the seller's account, forged webhook ignored, real payment unlocks instantly + seller notified");

r = await api("POST", "me/payments/disconnect", { token: seller.token, body: {} });
assert.equal(r.data.account, null);
r = await api("POST", "me/payments", { token: seller.token, body: { provider: "xendit", secretKey: VALID_KEYS.xendit } });
assert.equal(r.status, 200, JSON.stringify(r.data));
r = await api("POST", `listings/${autoListing.id}/order`, { token: affiliate.token, body: {} });
const xenditOrder = r.data.order;
assert.equal(xenditOrder.autoPay, "xendit");
const invoiceId = Object.keys(mock.state.xendit).find((k) => mock.state.xendit[k].external_id === xenditOrder.id);
assert.equal(mock.state.xendit[invoiceId].amount, 25000);
mock.pay("xendit", invoiceId);
r = await api("POST", `orders/${xenditOrder.id}/check`, { token: affiliate.token, body: {} });
assert.equal(r.data.order.status, "paid");
ok("Xendit: invoice on the seller's account, buyer's 'check payment' unlocks after the provider says PAID");

r = await api("POST", "me/payments", { token: seller.token, body: { provider: "stripe", secretKey: VALID_KEYS.stripe } });
assert.equal(r.data.account.provider, "stripe");
r = await api("POST", "listings", {
  token: seller.token,
  body: { title: "Stripe Planner", description: "USD", category: "Personal", tags: [], price: 9.5, currency: "USD", commissionPct: 0, spec: autoSpec },
});
const usdListing = r.data.listing;
r = await api("POST", `listings/${usdListing.id}/order`, { token: buyer2.token, body: {} });
const stripeOrder = r.data.order;
const sessionId = Object.keys(mock.state.stripe).find((k) => mock.state.stripe[k].client_reference_id === stripeOrder.id);
assert.equal(mock.state.stripe[sessionId].amount_total, 950);
assert.equal(mock.state.stripe[sessionId].currency, "usd");
mock.pay("stripe", sessionId);
r = await api("GET", `listings/${usdListing.id}`, { token: buyer2.token });
assert.equal(r.data.listing.owned, true, "returning to the item page re-checks and unlocks");
ok("Stripe: Checkout Session in cents, returning to the listing auto-confirms payment");

r = await api("POST", "me/payments/disconnect", { token: seller.token, body: {} });
r = await api("POST", `listings/${usdListing.id}/order`, { token: affiliate.token, body: {} });
assert.equal(r.status, 400, "no payment method left → orders refused");
r = await api("POST", `listings/${usdListing.id}/republish`, { token: seller.token, body: {} });
assert.equal(r.status, 400);
ok("disconnecting automatic payments stops new orders on listings without a payment link");

// ---- v2.3: coupons, views + seller insights, share previews
// (sign-ups are capped per network, so this section reuses buyer2 / buyer / affiliate as shoppers)
const c1 = buyer2;
const c2 = buyer;
const c3 = affiliate;
r = await api("POST", "listings", {
  token: seller.token,
  body: { title: "Coupon Planner", description: "Plan with a discount.", category: "Business", tags: ["promo"],
    price: 50000, currency: "IDR", commissionPct: 20, paymentUrl: "https://lynk.id/sari/coupon-planner", spec },
});
assert.equal(r.status, 201, JSON.stringify(r.data));
const promo = r.data.listing;

r = await api("POST", "seller/coupons", { token: seller.token, body: { code: "launch20", percent: 20, listingId: promo.id, days: 7 } });
assert.equal(r.status, 201, JSON.stringify(r.data));
const launch = r.data.coupon;
assert.equal(launch.code, "LAUNCH20");
assert.ok(launch.expires > Date.now() / 1000 + 6 * 86400);
r = await api("POST", "seller/coupons", { token: seller.token, body: { code: "LAUNCH20", percent: 10 } });
assert.equal(r.status, 409, "duplicate code");
r = await api("POST", "seller/coupons", { token: seller.token, body: { code: "BIG", percent: 95 } });
assert.equal(r.status, 400, "percent capped at 90");
r = await api("POST", "seller/coupons", { token: seller.token, body: { code: "x y", percent: 10 } });
assert.equal(r.status, 400, "code format");
r = await api("POST", "seller/coupons", { token: affiliate.token, body: { code: "STEAL", percent: 50, listingId: promo.id } });
assert.equal(r.status, 400, "can't make coupons for someone else's template");
r = await api("POST", `seller/coupons/${launch.id}/toggle`, { token: affiliate.token, body: {} });
assert.equal(r.status, 404, "other users can't touch the coupon");
ok("coupons: create, normalise, validate, owner-only");

r = await api("GET", `listings/${promo.id}/coupon?code=launch20`);
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.price, 40000);
assert.equal(r.data.percent, 20);
r = await api("GET", `listings/${promo.id}/coupon?code=NOPE99`);
assert.equal(r.status, 400);
r = await api("GET", `listings/${promo.id}/coupon?code=STEAL`);
assert.equal(r.status, 400, "another seller's code doesn't work here");
ok("coupon preview shows the discounted price; unknown codes rejected");

r = await api("POST", "affiliate/links", { token: affiliate.token, body: { listingId: promo.id } });
const promoRef = r.data.link.code;
r = await api("POST", `listings/${promo.id}/order`, { token: c1.token, body: { ref: promoRef, coupon: "launch20" } });
assert.equal(r.status, 201, JSON.stringify(r.data));
const couponOrder = r.data.order;
assert.equal(couponOrder.price, 40000);
assert.equal(couponOrder.discount, 10000);
assert.equal(couponOrder.coupon, "LAUNCH20");
assert.equal(couponOrder.commission, 8000, "commission on the discounted price");
assert.equal(couponOrder.sellerNet, 40000 - couponOrder.platformFee - 8000);
r = await api("GET", "seller", { token: seller.token });
assert.equal(r.data.pending.find((p) => p.id === couponOrder.id).coupon, "LAUNCH20", "seller sees the coupon on the order");
await api("POST", `orders/${couponOrder.id}/confirm`, { token: seller.token, body: {} });
ok("order with coupon + affiliate: price, discount, commission and net are consistent");

r = await api("POST", `listings/${promo.id}/order`, { token: c2.token, body: {} });
const fullOrder = r.data.order;
assert.equal(fullOrder.price, 50000);
r = await api("POST", `listings/${promo.id}/order`, { token: c2.token, body: {} });
assert.equal(r.data.existing, true, "re-ordering without a coupon returns the same order");
r = await api("POST", `listings/${promo.id}/order`, { token: c2.token, body: { coupon: "LAUNCH20" } });
assert.equal(r.status, 201, JSON.stringify(r.data));
assert.notEqual(r.data.order.id, fullOrder.id);
assert.equal(r.data.order.price, 40000);
r = await api("GET", "orders", { token: c2.token });
assert.equal(r.data.orders.find((o) => o.id === fullOrder.id).status, "cancelled", "the unpaid full-price order is replaced");
ok("applying a coupon after ordering replaces the unpaid order");

r = await api("POST", "seller/coupons", { token: seller.token, body: { code: "ONCE50", percent: 50, maxUses: 1 } });
const once = r.data.coupon;
assert.equal(once.listingId, "", "store-wide coupon");
r = await api("POST", `listings/${promo.id}/order`, { token: c3.token, body: { coupon: "ONCE50" } });
assert.equal(r.status, 201, JSON.stringify(r.data));
const onceOrder = r.data.order;
assert.equal(onceOrder.price, 25000);
r = await api("POST", `listings/${promo.id}/order`, { token: c2.token, body: { coupon: "ONCE50" } });
assert.equal(r.status, 400, "max uses counts pending orders");
assert.match(r.data.error, /fully used/);
await api("POST", `orders/${onceOrder.id}/cancel`, { token: c3.token, body: {} });
r = await api("POST", `listings/${promo.id}/order`, { token: c2.token, body: { coupon: "ONCE50" } });
assert.equal(r.status, 201, "a cancelled order frees the use: " + JSON.stringify(r.data));
assert.equal(r.data.order.price, 25000, "and the better coupon replaces the unpaid LAUNCH20 order");
ok("max uses: pending orders hold a use, cancelling releases it");

r = await api("POST", `seller/coupons/${launch.id}/toggle`, { token: seller.token, body: {} });
assert.equal(r.data.coupon.active, false);
r = await api("GET", `listings/${promo.id}/coupon?code=LAUNCH20`);
assert.equal(r.status, 400, "paused coupon");
r = await api("POST", "seller/coupons", { token: seller.token, body: { code: "AUTOONLY", percent: 30, listingId: autoListing.id } });
assert.equal(r.status, 201, JSON.stringify(r.data));
const autoOnly = r.data.coupon;
r = await api("GET", `listings/${promo.id}/coupon?code=AUTOONLY`);
assert.equal(r.status, 400, "listing-scoped coupon doesn't apply to other listings");
r = await api("POST", `seller/coupons/${autoOnly.id}/delete`, { token: seller.token, body: {} });
assert.equal(r.data.ok, true);
r = await api("GET", "seller/coupons", { token: seller.token });
assert.ok(!r.data.coupons.some((c) => c.id === autoOnly.id), "deleted");
ok("paused and listing-scoped coupons are refused");

// views: anonymous visits count once per network per hour; the seller's own visits don't count
r = await api("GET", "seller", { token: seller.token });
const viewsBefore = r.data.listings.find((l) => l.id === promo.id).views;
await api("GET", `listings/${promo.id}`, { token: seller.token });
await api("GET", `listings/${promo.id}`);
await api("GET", `listings/${promo.id}`);
await api("GET", `listings/${promo.id}`, { token: buyer2.token });
r = await api("GET", "seller", { token: seller.token });
const promoStats = r.data.listings.find((l) => l.id === promo.id);
assert.equal(promoStats.views - viewsBefore, 1, "one view per network per hour");
assert.equal(promoStats.sales, 1);
assert.equal(promoStats.conversion, 100);
assert.equal(r.data.insights.daily.length, 30);
assert.ok(r.data.insights.views30 >= 1);
assert.ok(r.data.insights.sales30 >= 1);
assert.ok(r.data.insights.revenue30.some((x) => x.currency === "IDR" && x.net > 0));
const launchStats = r.data.coupons.find((c) => c.code === "LAUNCH20");
assert.equal(launchStats.paidUses, 1);
assert.equal(launchStats.uses, 1, "the replaced (cancelled) order no longer holds a use");
assert.equal(r.data.coupons.find((c) => c.code === "ONCE50").uses, 1);
ok("views, 30-day insights, per-listing conversion and coupon usage in the seller dashboard");

// share preview page
const shareRes = await fetch(`${BASE}/s/${promo.id}?ref=${promoRef}&coupon=LAUNCH20`, { redirect: "manual" });
assert.equal(shareRes.status, 200);
assert.match(shareRes.headers.get("content-type"), /text\/html/);
const shareHtml = await shareRes.text();
assert.match(shareHtml, /<meta property="og:title" content="Coupon Planner — Rp[\s\u00a0]?50\.000 on Mint">/);
assert.match(shareHtml, /og:image" content="[^"]+icons\/og-card\.png"/);
assert.ok(shareHtml.includes(`#/item/${promo.id}?ref=${promoRef}&coupon=LAUNCH20`), "redirect keeps ref + coupon");
const badRef = await fetch(`${BASE}/s/${promo.id}?ref=${encodeURIComponent('"><script>alert(1)</script>')}`, { redirect: "manual" });
const badHtml = await badRef.text();
assert.ok(!badHtml.includes("<script>alert"), "untrusted ref is dropped, not echoed");
const missing = await fetch(`${BASE}/s/no-such-listing`, { redirect: "manual" });
assert.equal(missing.status, 302);
assert.match(missing.headers.get("location"), /#\/market$/);
ok("share links render Open Graph previews and redirect into the app safely");

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

await mock.close();
console.log(`\nPASSED ${passed} checks against ${BASE}`);
