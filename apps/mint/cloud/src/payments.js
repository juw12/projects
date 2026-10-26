/*
 * Automatic payments through the SELLER'S OWN provider account (Midtrans, Xendit or Stripe).
 * Money goes straight to the seller; Mint never holds funds. Mint creates the checkout with the
 * seller's secret key and confirms an order only after asking the provider's API for the status —
 * webhook bodies are treated as a hint, never as proof of payment.
 */

export const PROVIDERS = {
  midtrans: {
    label: "Midtrans",
    methods: "QRIS, GoPay, ShopeePay, OVO, bank transfer (VA), cards",
    currencies: ["IDR"],
    keyHelp: "Midtrans Dashboard → Settings → Access Keys → Server Key (sandbox keys start with SB-Mid-server-)",
  },
  xendit: {
    label: "Xendit",
    methods: "QRIS, e-wallets, bank transfer (VA), retail outlets, cards",
    currencies: ["IDR", "PHP", "THB", "VND", "MYR", "USD"],
    keyHelp: "Xendit Dashboard → Settings → API Keys → secret key with Money-in write permission",
  },
  stripe: {
    label: "Stripe",
    methods: "cards, Apple Pay, Google Pay, local methods Stripe enables for you",
    currencies: null,
    keyHelp: "Stripe Dashboard → Developers → API keys → secret key, or a restricted key with Checkout Sessions write",
  },
};

const STRIPE_ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export class PaymentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function bases(env) {
  return {
    midtransApi: env.MIDTRANS_API_BASE || "https://api.midtrans.com",
    midtransSnap: env.MIDTRANS_SNAP_BASE || "https://app.midtrans.com",
    midtransApiSandbox: env.MIDTRANS_API_SANDBOX_BASE || "https://api.sandbox.midtrans.com",
    midtransSnapSandbox: env.MIDTRANS_SNAP_SANDBOX_BASE || "https://app.sandbox.midtrans.com",
    xendit: env.XENDIT_API_BASE || "https://api.xendit.co",
    stripe: env.STRIPE_API_BASE || "https://api.stripe.com",
  };
}

export function supportsCurrency(provider, currency) {
  const info = PROVIDERS[provider];
  return Boolean(info) && (!info.currencies || info.currencies.includes(currency));
}

export function isSandboxKey(provider, key) {
  if (provider === "midtrans") {
    return key.startsWith("SB-");
  }
  if (provider === "xendit") {
    return key.startsWith("xnd_development_");
  }
  return key.startsWith("sk_test_") || key.startsWith("rk_test_");
}

export function cleanSecretKey(provider, raw) {
  const key = String(raw || "").trim();
  if (!PROVIDERS[provider]) {
    throw new PaymentError(400, "Choose Midtrans, Xendit or Stripe");
  }
  if (key.length < 16 || key.length > 300 || /\s/.test(key)) {
    throw new PaymentError(400, "That doesn’t look like a secret key");
  }
  if (provider === "midtrans" && !/^(SB-)?Mid-server-/.test(key)) {
    throw new PaymentError(400, "Use the Midtrans Server Key (starts with Mid-server- or SB-Mid-server-)");
  }
  if (provider === "xendit" && !/^xnd_(development|production)_/.test(key)) {
    throw new PaymentError(400, "Use a Xendit secret key (starts with xnd_production_ or xnd_development_)");
  }
  if (provider === "stripe" && !/^(sk|rk)_(live|test)_/.test(key)) {
    throw new PaymentError(400, "Use a Stripe secret or restricted key (sk_… or rk_…)");
  }
  return key;
}

function basicAuth(key) {
  return "Basic " + btoa(key + ":");
}

function midtransBases(env, key) {
  const b = bases(env);
  return isSandboxKey("midtrans", key)
    ? { api: b.midtransApiSandbox, snap: b.midtransSnapSandbox }
    : { api: b.midtransApi, snap: b.midtransSnap };
}

async function call(url, options, label) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new PaymentError(502, label + " can’t be reached right now");
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

function majorUnits(amountCents, currency) {
  // Midtrans/Xendit take major units; IDR and VND have no decimals there.
  if (currency === "IDR" || currency === "VND") {
    return Math.round(amountCents / 100);
  }
  return Math.round(amountCents) / 100;
}

function stripeAmount(amountCents, currency) {
  return STRIPE_ZERO_DECIMAL.has(currency) ? Math.round(amountCents / 100) : Math.round(amountCents);
}

function form(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)))
    .join("&");
}

/** Checks that the key works before it is saved (a read-only call). */
export async function validateKey(provider, key, env) {
  const b = bases(env);
  if (provider === "midtrans") {
    const m = midtransBases(env, key);
    const r = await call(m.api + "/v2/mint-key-check-" + Date.now() + "/status", {
      headers: { Authorization: basicAuth(key), Accept: "application/json" },
    }, "Midtrans");
    const code = String(r.data.status_code || r.status);
    if (r.status === 401 || code === "401") {
      throw new PaymentError(400, "Midtrans rejected this Server Key");
    }
    return true;
  }
  if (provider === "xendit") {
    const r = await call(b.xendit + "/v2/invoices?limit=1", { headers: { Authorization: basicAuth(key) } }, "Xendit");
    if (r.status === 401) {
      throw new PaymentError(400, "Xendit rejected this secret key");
    }
    if (r.status === 403) {
      throw new PaymentError(400, "This Xendit key needs Money-in (invoices) read and write permission");
    }
    if (r.status >= 400) {
      throw new PaymentError(400, "Xendit answered " + r.status + " — check the key");
    }
    return true;
  }
  const r = await call(b.stripe + "/v1/checkout/sessions?limit=1", { headers: { Authorization: "Bearer " + key } }, "Stripe");
  if (r.status === 401) {
    throw new PaymentError(400, "Stripe rejected this key");
  }
  if (r.status === 403) {
    throw new PaymentError(400, "This restricted Stripe key needs Checkout Sessions read and write");
  }
  if (r.status >= 400) {
    throw new PaymentError(400, "Stripe answered " + r.status + " — check the key");
  }
  return true;
}

/**
 * Creates a hosted checkout on the seller's account.
 * order: { id, ref, amountCents, currency, title, buyerEmail, buyerName, returnUrl, notifyUrl }
 * Returns { url, providerRef }.
 */
export async function createCheckout(provider, key, env, order) {
  if (!supportsCurrency(provider, order.currency)) {
    throw new PaymentError(400, PROVIDERS[provider].label + " doesn’t take " + order.currency);
  }
  const title = String(order.title).slice(0, 50);
  if (provider === "midtrans") {
    const m = midtransBases(env, key);
    const gross = majorUnits(order.amountCents, order.currency);
    const r = await call(m.snap + "/snap/v1/transactions", {
      method: "POST",
      headers: {
        Authorization: basicAuth(key),
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Override-Notification": order.notifyUrl,
      },
      body: JSON.stringify({
        transaction_details: { order_id: order.id, gross_amount: gross },
        item_details: [{ id: order.ref, price: gross, quantity: 1, name: title }],
        customer_details: { first_name: String(order.buyerName).slice(0, 50), email: order.buyerEmail },
        callbacks: { finish: order.returnUrl },
      }),
    }, "Midtrans");
    if (r.status >= 300 || !r.data.redirect_url) {
      throw new PaymentError(502, "Midtrans couldn’t start the checkout" + (r.data.error_messages ? ": " + r.data.error_messages.join("; ") : ""));
    }
    return { url: r.data.redirect_url, providerRef: order.id };
  }
  if (provider === "xendit") {
    const r = await call(bases(env).xendit + "/v2/invoices", {
      method: "POST",
      headers: { Authorization: basicAuth(key), "Content-Type": "application/json" },
      body: JSON.stringify({
        external_id: order.id,
        amount: majorUnits(order.amountCents, order.currency),
        currency: order.currency,
        description: title + " (" + order.ref + ")",
        payer_email: order.buyerEmail,
        customer: { given_names: String(order.buyerName).slice(0, 50), email: order.buyerEmail },
        success_redirect_url: order.returnUrl,
        failure_redirect_url: order.returnUrl,
        invoice_duration: 86400,
      }),
    }, "Xendit");
    if (r.status >= 300 || !r.data.invoice_url) {
      throw new PaymentError(502, "Xendit couldn’t start the checkout" + (r.data.message ? ": " + r.data.message : ""));
    }
    return { url: r.data.invoice_url, providerRef: r.data.id };
  }
  const r = await call(bases(env).stripe + "/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
    body: form({
      mode: "payment",
      success_url: order.returnUrl,
      cancel_url: order.returnUrl,
      client_reference_id: order.id,
      "metadata[order_id]": order.id,
      "metadata[mint_ref]": order.ref,
      customer_email: order.buyerEmail,
      "line_items[0][quantity]": 1,
      "line_items[0][price_data][currency]": order.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": stripeAmount(order.amountCents, order.currency),
      "line_items[0][price_data][product_data][name]": title,
    }),
  }, "Stripe");
  if (r.status >= 300 || !r.data.url) {
    throw new PaymentError(502, "Stripe couldn’t start the checkout" + (r.data.error ? ": " + r.data.error.message : ""));
  }
  return { url: r.data.url, providerRef: r.data.id };
}

/**
 * Asks the provider for the real status. Returns { state: "paid" | "pending" | "failed", amountCents|null }.
 */
export async function fetchStatus(provider, key, env, providerRef, currency) {
  if (provider === "midtrans") {
    const m = midtransBases(env, key);
    const r = await call(m.api + "/v2/" + encodeURIComponent(providerRef) + "/status", {
      headers: { Authorization: basicAuth(key), Accept: "application/json" },
    }, "Midtrans");
    const code = String(r.data.status_code || r.status);
    if (code === "404") {
      return { state: "pending", amountCents: null };
    }
    if (r.status === 401 || code === "401") {
      throw new PaymentError(502, "The seller’s Midtrans key stopped working");
    }
    const status = String(r.data.transaction_status || "");
    const fraud = String(r.data.fraud_status || "accept");
    const amountCents = r.data.gross_amount !== undefined ? Math.round(parseFloat(r.data.gross_amount) * 100) : null;
    if (status === "settlement" || (status === "capture" && fraud === "accept")) {
      return { state: "paid", amountCents };
    }
    if (["deny", "cancel", "expire", "failure"].includes(status)) {
      return { state: "failed", amountCents };
    }
    return { state: "pending", amountCents };
  }
  if (provider === "xendit") {
    const r = await call(bases(env).xendit + "/v2/invoices/" + encodeURIComponent(providerRef), {
      headers: { Authorization: basicAuth(key) },
    }, "Xendit");
    if (r.status === 401) {
      throw new PaymentError(502, "The seller’s Xendit key stopped working");
    }
    if (r.status >= 400) {
      return { state: "pending", amountCents: null };
    }
    const status = String(r.data.status || "");
    const amountCents = r.data.amount !== undefined ? Math.round(Number(r.data.amount) * 100) : null;
    if (status === "PAID" || status === "SETTLED") {
      return { state: "paid", amountCents };
    }
    if (status === "EXPIRED") {
      return { state: "failed", amountCents };
    }
    return { state: "pending", amountCents };
  }
  const r = await call(bases(env).stripe + "/v1/checkout/sessions/" + encodeURIComponent(providerRef), {
    headers: { Authorization: "Bearer " + key },
  }, "Stripe");
  if (r.status === 401) {
    throw new PaymentError(502, "The seller’s Stripe key stopped working");
  }
  if (r.status >= 400) {
    return { state: "pending", amountCents: null };
  }
  const total = r.data.amount_total;
  const cur = String(r.data.currency || currency || "").toUpperCase();
  const amountCents = typeof total === "number" ? (STRIPE_ZERO_DECIMAL.has(cur) ? total * 100 : total) : null;
  if (r.data.payment_status === "paid" || r.data.payment_status === "no_payment_required") {
    return { state: "paid", amountCents };
  }
  if (r.data.status === "expired") {
    return { state: "failed", amountCents };
  }
  return { state: "pending", amountCents };
}

/** Pulls our order id out of a provider webhook body (used only to know which order to re-check). */
export function orderIdFromWebhook(provider, body) {
  if (!body || typeof body !== "object") {
    return "";
  }
  if (provider === "midtrans") {
    return String(body.order_id || "");
  }
  if (provider === "xendit") {
    return String(body.external_id || (body.data && body.data.reference_id) || "");
  }
  if (provider === "stripe") {
    const obj = body.data && body.data.object ? body.data.object : {};
    return String(obj.client_reference_id || (obj.metadata && obj.metadata.order_id) || "");
  }
  return "";
}

// ---- secret-key storage (AES-GCM with a key derived from the PAYMENT_KEY_SECRET worker secret)
async function aesKey(secret) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mint-payment-keys|" + secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toB64(bytes) {
  let s = "";
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

function fromB64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export async function sealSecret(secret, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

export async function openSecret(secret, sealed) {
  const data = fromB64(sealed);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, await aesKey(secret), data.slice(12));
  return new TextDecoder().decode(pt);
}
