/*
 * Mint API — Cloudflare Worker + one SQLite-backed Durable Object ("main").
 *
 * The static app (GitHub Pages) calls this API cross-origin with a bearer token.
 * Data: accounts, drafts, listings, orders (pending → paid via the seller's own
 * payment link, confirmed by the seller), affiliate links + commissions, reviews.
 * AI: POST /api/ai/template turns a prompt into a template with Workers AI.
 */
import { DurableObject } from "cloudflare:workers";
import "../../web/js/core.js";
import seedData from "../../web/data/seed.json";

const Core = globalThis.MintCore;

const APP = "mint";
const VERSION = "2.0.0";
const SESSION_DAYS = 30;
const PBKDF2_ROUNDS = 100000; // Workers' PBKDF2 ceiling
const MAX_BODY = 400000;
const CATEGORIES = new Set(Core.CATEGORIES);
const CURRENCIES = new Set(Object.keys(Core.CURRENCIES));
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$/;
const CODE_RE = /^[A-Za-z0-9_-]{4,40}$/;
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const STUDIO_EMAIL = "studio@mint.local";

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ------------------------------------------------------------------ worker entry
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (!url.pathname.startsWith("/api/")) {
      return json({ ok: true, app: APP, hint: "API lives under /api/" }, 200, cors);
    }
    const id = env.MINT_DB.idFromName("main");
    const headers = new Headers(request.headers);
    headers.set("x-mint-ip", request.headers.get("CF-Connecting-IP") || "local");
    let body;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const declared = parseInt(request.headers.get("Content-Length") || "0", 10);
      if (declared > MAX_BODY) {
        return json({ error: "Request too large" }, 413, cors);
      }
      body = await request.arrayBuffer();
      if (body.byteLength > MAX_BODY) {
        return json({ error: "Request too large" }, 413, cors);
      }
    }
    const forwarded = new Request(request.url, { method: request.method, headers, body });
    const response = await env.MINT_DB.get(id).fetch(forwarded);
    const out = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) {
      out.set(key, value);
    }
    return new Response(response.body, { status: response.status, headers: out });
  },
};

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

// ------------------------------------------------------------------ helpers
const encoder = new TextEncoder();

function now() {
  return Date.now() / 1000;
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let text = "";
  for (const b of data) {
    text += String.fromCharCode(b);
  }
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomId(prefix) {
  return prefix + randomToken(9);
}

function orderRef() {
  const data = crypto.getRandomValues(new Uint8Array(6));
  return "M-" + [...data].map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("");
}

async function sha256(text) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ROUNDS }, key, 256);
  return hex(bits);
}

function safeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function cleanText(value, maxLen, field, required = true) {
  const text = String(value ?? "").trim();
  if (required && !text) {
    throw new ApiError(400, `${field} is required`);
  }
  return text.slice(0, maxLen);
}

function cleanUrl(value) {
  const url = String(value || "").trim().slice(0, 300);
  if (!url) {
    return "";
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    throw new ApiError(400, "Payment link is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new ApiError(400, "Payment link must start with https://");
  }
  return parsed.toString();
}

function cleanSpec(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError(400, "Template spec must be an object");
  }
  const sheet = raw.sheet;
  if (!sheet || !Array.isArray(sheet.columns)) {
    throw new ApiError(400, "Template spec needs sheet.columns");
  }
  if (sheet.columns.length < 1 || sheet.columns.length > 30) {
    throw new ApiError(400, "Templates need 1–30 columns");
  }
  if (sheet.rows !== undefined && (!Array.isArray(sheet.rows) || sheet.rows.length > 500)) {
    throw new ApiError(400, "Templates can include up to 500 rows");
  }
  for (const column of sheet.columns) {
    if (!column || typeof column !== "object" || !String(column.name || "").trim()) {
      throw new ApiError(400, "Every column needs a name");
    }
  }
  const spec = Core.normalize(raw);
  const encoded = JSON.stringify(spec);
  if (encoded.length > 250000) {
    throw new ApiError(413, "Template is too large");
  }
  return encoded;
}

function moneyToCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new ApiError(400, "Price must be a number");
  }
  if (amount < 0 || amount > 100000000) {
    throw new ApiError(400, "Price is out of range");
  }
  return Math.round(amount * 100);
}

function parseJsonLoose(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new ApiError(502, "The AI answer had no JSON");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new ApiError(502, "The AI answer was not valid JSON");
  }
}

function specFromAiText(text, prompt) {
  const draft = parseJsonLoose(text);
  const spec = Core.normalize(draft);
  if (!spec.sheet.columns.length || spec.sheet.columns.length < 2) {
    throw new ApiError(502, "The AI returned too few columns");
  }
  spec.prompt = prompt;
  return spec;
}

// ------------------------------------------------------------------ durable object
export class MintDB extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
      this.seed();
    });
  }

  all(query, ...params) {
    return this.sql.exec(query, ...params).toArray();
  }

  one(query, ...params) {
    return this.all(query, ...params)[0] || null;
  }

  run(query, ...params) {
    return this.sql.exec(query, ...params);
  }

  get feePct() {
    const pct = parseInt(this.env.PLATFORM_FEE_PCT || "0", 10);
    return Number.isFinite(pct) && pct >= 0 && pct <= 50 ? pct : 0;
  }

  migrate() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        pw_hash TEXT NOT NULL, salt TEXT NOT NULL, payout_info TEXT NOT NULL DEFAULT '', is_system INTEGER NOT NULL DEFAULT 0,
        created REAL NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires REAL NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
        spec TEXT NOT NULL, updated REAL NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS listings (id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, template_id TEXT,
        title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL,
        price_cents INTEGER NOT NULL, currency TEXT NOT NULL, commission_pct INTEGER NOT NULL,
        payment_url TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'live',
        created REAL NOT NULL, updated REAL NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, ref TEXT UNIQUE NOT NULL, listing_id TEXT NOT NULL,
        buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL, status TEXT NOT NULL, price_cents INTEGER NOT NULL,
        currency TEXT NOT NULL, platform_fee_cents INTEGER NOT NULL, affiliate_code TEXT, affiliate_user_id TEXT,
        commission_cents INTEGER NOT NULL DEFAULT 0, seller_net_cents INTEGER NOT NULL,
        commission_paid INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL, paid_at REAL)`,
      `CREATE INDEX IF NOT EXISTS orders_listing ON orders (listing_id, status)`,
      `CREATE INDEX IF NOT EXISTS orders_buyer ON orders (buyer_id, status)`,
      `CREATE INDEX IF NOT EXISTS orders_seller ON orders (seller_id, status)`,
      `CREATE TABLE IF NOT EXISTS affiliate_links (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, listing_id TEXT NOT NULL,
        clicks INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL, UNIQUE (user_id, listing_id))`,
      `CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, user_id TEXT NOT NULL,
        rating INTEGER NOT NULL, body TEXT NOT NULL, created REAL NOT NULL, UNIQUE (listing_id, user_id))`,
      `CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at REAL NOT NULL)`,
    ];
    for (const statement of statements) {
      this.run(statement);
    }
  }

  seed() {
    if (this.one("SELECT 1 AS x FROM listings LIMIT 1")) {
      return;
    }
    let studio = this.one("SELECT * FROM users WHERE email = ?", STUDIO_EMAIL);
    if (!studio) {
      this.run(
        "INSERT INTO users (id, email, name, pw_hash, salt, is_system, created) VALUES (?, ?, ?, '!', '', 1, ?)",
        "u_studio", STUDIO_EMAIL, "Mint Studio", now(),
      );
      studio = { id: "u_studio" };
    }
    const items = (seedData && seedData.listings) || [];
    items.forEach((item, index) => {
      const t = now() - index;
      this.run(
        `INSERT INTO listings (id, seller_id, template_id, title, description, category, tags, price_cents, currency,
          commission_pct, payment_url, spec, status, created, updated) VALUES (?, ?, NULL, ?, ?, ?, ?, 0, ?, 0, '', ?, 'live', ?, ?)`,
        item.id, studio.id, item.title, item.description, item.category, JSON.stringify(item.tags || []),
        item.currency, JSON.stringify(Core.normalize(item.spec)), t, t,
      );
    });
  }

  // ---- rate limiting (fixed window per key)
  limit(key, max, periodSec) {
    const t = now();
    const row = this.one("SELECT * FROM limits WHERE key = ?", key);
    if (!row || row.reset_at <= t) {
      this.run("INSERT OR REPLACE INTO limits (key, count, reset_at) VALUES (?, 1, ?)", key, t + periodSec);
      if (Math.random() < 0.02) {
        this.run("DELETE FROM limits WHERE reset_at <= ?", t);
      }
      return { ok: true, remaining: max - 1 };
    }
    if (row.count >= max) {
      return { ok: false, remaining: 0, retryAfter: Math.ceil(row.reset_at - t) };
    }
    this.run("UPDATE limits SET count = count + 1 WHERE key = ?", key);
    return { ok: true, remaining: max - row.count - 1 };
  }

  requireLimit(key, max, periodSec, message) {
    const result = this.limit(key, max, periodSec);
    if (!result.ok) {
      throw new ApiError(429, message || "Too many requests — try again later");
    }
    return result;
  }

  // ---- request plumbing
  async readJson(request) {
    const type = (request.headers.get("Content-Type") || "").split(";")[0].trim();
    if (type !== "application/json") {
      throw new ApiError(415, "Send JSON (Content-Type: application/json)");
    }
    const text = await request.text();
    if (text.length > MAX_BODY) {
      throw new ApiError(413, "Request too large");
    }
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (err) {
      throw new ApiError(400, "Invalid JSON");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new ApiError(400, "JSON body must be an object");
    }
    return data;
  }

  async currentUser(request, required = true) {
    const header = request.headers.get("Authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    let user = null;
    if (token && token.length < 200) {
      user = this.one(
        "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires > ?",
        await sha256(token), now(),
      );
    }
    if (required && !user) {
      throw new ApiError(401, "Please log in");
    }
    return user;
  }

  publicUser(user) {
    return { id: user.id, email: user.email, name: user.name, payoutInfo: user.payout_info || "" };
  }

  async newSession(userId) {
    const token = randomToken(32);
    this.run(
      "INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)",
      await sha256(token), userId, now() + SESSION_DAYS * 86400,
    );
    if (Math.random() < 0.05) {
      this.run("DELETE FROM sessions WHERE expires <= ?", now());
    }
    return token;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.slice("/api/".length).split("/").filter(Boolean);
    const query = Object.fromEntries(url.searchParams.entries());
    const ip = request.headers.get("x-mint-ip") || "local";
    try {
      const result = await this.route(request, request.method, parts, query, ip);
      if (result instanceof Response) {
        return result;
      }
      return result && result.__http ? json(result.body, result.__http) : json(result, 200);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: err.message }, err.status);
      }
      console.error("mint error", err && err.stack ? err.stack : err);
      return json({ error: "Server error" }, 500);
    }
  }

  async route(request, method, parts, query, ip) {
    const head = parts[0] || "";
    if (head === "health" && method === "GET") {
      return {
        ok: true, app: APP, version: VERSION, mode: "cloud", platformFeePct: this.feePct,
        ai: Boolean(this.env.AI), aiModel: this.env.AI ? (this.env.AI_MODEL || "") : "",
      };
    }
    if (method === "POST") {
      this.requireLimit("w:" + ip, 240, 600, "Too many changes from your network — wait a few minutes");
    }
    switch (head) {
      case "auth":
        return this.routeAuth(request, method, parts.slice(1), ip);
      case "me":
        return this.routeMe(request, method);
      case "templates":
        return this.routeTemplates(request, method, parts.slice(1));
      case "listings":
        return this.routeListings(request, method, parts.slice(1), query);
      case "orders":
        return this.routeOrders(request, method, parts.slice(1));
      case "library":
        if (method === "GET") {
          return this.library(request);
        }
        break;
      case "affiliate":
        return this.routeAffiliate(request, method, parts.slice(1), ip);
      case "seller":
        if (method === "GET") {
          return this.sellerStats(request);
        }
        break;
      case "ai":
        if (method === "POST" && parts[1] === "template") {
          return this.aiTemplate(request, ip);
        }
        break;
      default:
        break;
    }
    throw new ApiError(404, "Not found");
  }

  // ---- auth
  async routeAuth(request, method, parts, ip) {
    if (method !== "POST") {
      throw new ApiError(405, "Method not allowed");
    }
    const action = parts[0] || "";
    if (action === "register") {
      this.requireLimit("reg:" + ip, 8, 3600, "Too many sign-ups from your network — try again in an hour");
      const data = await this.readJson(request);
      const email = cleanText(data.email, 254, "Email").toLowerCase();
      const name = cleanText(data.name, 60, "Name");
      const password = String(data.password || "");
      if (!EMAIL_RE.test(email)) {
        throw new ApiError(400, "Enter a valid email");
      }
      if (password.length < 8 || password.length > 200) {
        throw new ApiError(400, "Password must be 8–200 characters");
      }
      if (this.one("SELECT 1 AS x FROM users WHERE email = ?", email)) {
        throw new ApiError(409, "An account with this email already exists");
      }
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      const id = randomId("u_");
      this.run(
        "INSERT INTO users (id, email, name, pw_hash, salt, is_system, created) VALUES (?, ?, ?, ?, ?, 0, ?)",
        id, email, name, await hashPassword(password, salt), salt, now(),
      );
      const user = this.one("SELECT * FROM users WHERE id = ?", id);
      return { __http: 201, body: { user: this.publicUser(user), token: await this.newSession(id) } };
    }
    if (action === "login") {
      const data = await this.readJson(request);
      const email = String(data.email || "").trim().toLowerCase();
      const gate = this.limit("login:" + ip, 10, 300);
      const perAccount = this.limit("login:acct:" + email, 20, 3600);
      if (!gate.ok || !perAccount.ok) {
        throw new ApiError(429, "Too many attempts — wait a few minutes");
      }
      const user = this.one("SELECT * FROM users WHERE email = ? AND is_system = 0", email);
      const password = String(data.password || "");
      if (!user) {
        await hashPassword(password, "00".repeat(16));
        throw new ApiError(401, "Wrong email or password");
      }
      const candidate = await hashPassword(password, user.salt);
      if (!safeEqual(candidate, user.pw_hash)) {
        throw new ApiError(401, "Wrong email or password");
      }
      return { user: this.publicUser(user), token: await this.newSession(user.id) };
    }
    if (action === "logout") {
      const header = request.headers.get("Authorization") || "";
      if (header.startsWith("Bearer ")) {
        this.run("DELETE FROM sessions WHERE token_hash = ?", await sha256(header.slice(7).trim()));
      }
      return { ok: true };
    }
    throw new ApiError(404, "Not found");
  }

  async routeMe(request, method) {
    if (method === "GET") {
      const user = await this.currentUser(request, false);
      return { user: user ? this.publicUser(user) : null };
    }
    if (method === "POST") {
      const user = await this.currentUser(request);
      const data = await this.readJson(request);
      const name = data.name !== undefined ? cleanText(data.name, 60, "Name") : user.name;
      const payout = data.payoutInfo !== undefined ? cleanText(data.payoutInfo, 300, "Payout details", false) : user.payout_info;
      this.run("UPDATE users SET name = ?, payout_info = ? WHERE id = ?", name, payout, user.id);
      return { user: this.publicUser(this.one("SELECT * FROM users WHERE id = ?", user.id)) };
    }
    throw new ApiError(405, "Method not allowed");
  }

  // ---- drafts
  async routeTemplates(request, method, parts) {
    const user = await this.currentUser(request);
    if (method === "GET" && !parts.length) {
      const rows = this.all("SELECT * FROM templates WHERE owner_id = ? ORDER BY updated DESC LIMIT 200", user.id);
      return { templates: rows.map((r) => ({ id: r.id, title: r.title, updated: r.updated, spec: JSON.parse(r.spec) })) };
    }
    if (method === "POST" && !parts.length) {
      const data = await this.readJson(request);
      const spec = cleanSpec(data.spec);
      const title = cleanText(data.title || JSON.parse(spec).title, 70, "Title");
      let id = String(data.id || "");
      const existing = id ? this.one("SELECT * FROM templates WHERE id = ?", id) : null;
      if (existing && existing.owner_id !== user.id) {
        throw new ApiError(403, "Not your template");
      }
      if (existing) {
        this.run("UPDATE templates SET title = ?, spec = ?, updated = ? WHERE id = ?", title, spec, now(), id);
      } else {
        const count = this.one("SELECT COUNT(*) AS n FROM templates WHERE owner_id = ?", user.id).n;
        if (count >= 200) {
          throw new ApiError(400, "You have 200 drafts — delete some first");
        }
        id = randomId("t_");
        this.run("INSERT INTO templates (id, owner_id, title, spec, updated) VALUES (?, ?, ?, ?, ?)", id, user.id, title, spec, now());
      }
      return { template: { id, title, spec: JSON.parse(spec) } };
    }
    if (method === "DELETE" && parts.length === 1) {
      const row = this.one("SELECT * FROM templates WHERE id = ?", parts[0]);
      if (!row || row.owner_id !== user.id) {
        throw new ApiError(404, "Template not found");
      }
      this.run("DELETE FROM templates WHERE id = ?", parts[0]);
      return { ok: true };
    }
    throw new ApiError(404, "Not found");
  }

  // ---- listings
  summary(row) {
    const sales = this.one("SELECT COUNT(*) AS n FROM orders WHERE listing_id = ? AND status = 'paid'", row.id).n;
    const rating = this.one("SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE listing_id = ?", row.id);
    const seller = this.one("SELECT name FROM users WHERE id = ?", row.seller_id);
    const spec = JSON.parse(row.spec);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      tags: JSON.parse(row.tags),
      price: row.price_cents / 100,
      currency: row.currency,
      commissionPct: row.commission_pct,
      hasPaymentLink: Boolean(row.payment_url),
      status: row.status,
      sellerId: row.seller_id,
      sellerName: seller ? seller.name : "Unknown",
      sales,
      ratingCount: rating.n,
      rating: rating.avg ? Math.round(rating.avg * 100) / 100 : null,
      theme: spec.theme || "mint",
      columns: ((spec.sheet && spec.sheet.columns) || []).slice(0, 8).map((c) => c.name),
      created: row.created,
    };
  }

  async routeListings(request, method, parts, query) {
    if (method === "GET" && !parts.length) {
      return this.browse(query);
    }
    if (method === "POST" && !parts.length) {
      return this.publish(request);
    }
    if (!parts.length) {
      throw new ApiError(404, "Not found");
    }
    const listing = this.one("SELECT * FROM listings WHERE id = ?", parts[0]);
    if (!listing) {
      throw new ApiError(404, "Listing not found");
    }
    const action = parts[1] || "";
    if (method === "GET" && !action) {
      return this.listingDetail(request, listing);
    }
    if (method === "POST" && (action === "order" || action === "buy")) {
      return this.createOrder(request, listing);
    }
    if (method === "POST" && action === "reviews") {
      return this.review(request, listing);
    }
    if (method === "POST" && action === "edit") {
      return this.editListing(request, listing);
    }
    if (method === "POST" && (action === "unpublish" || action === "republish")) {
      const user = await this.currentUser(request);
      if (listing.seller_id !== user.id) {
        throw new ApiError(403, "Not your listing");
      }
      const status = action === "unpublish" ? "hidden" : "live";
      if (status === "live" && listing.price_cents > 0 && !listing.payment_url) {
        throw new ApiError(400, "Add a payment link before republishing a paid template");
      }
      this.run("UPDATE listings SET status = ?, updated = ? WHERE id = ?", status, now(), listing.id);
      return { ok: true, status };
    }
    throw new ApiError(404, "Not found");
  }

  browse(query) {
    let sql = "SELECT * FROM listings WHERE status = 'live'";
    const params = [];
    if (query.category && CATEGORIES.has(query.category)) {
      sql += " AND category = ?";
      params.push(query.category);
    }
    if (query.q) {
      const like = "%" + String(query.q).trim().toLowerCase().slice(0, 60) + "%";
      sql += " AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags) LIKE ?)";
      params.push(like, like, like);
    }
    if (query.seller) {
      sql += " AND seller_id = ?";
      params.push(String(query.seller));
    }
    if (query.free === "1") {
      sql += " AND price_cents = 0";
    }
    sql += " ORDER BY created DESC LIMIT 400";
    const items = this.all(sql, ...params).map((row) => this.summary(row));
    const sort = query.sort || "new";
    if (sort === "popular") {
      items.sort((a, b) => b.sales - a.sales || b.created - a.created);
    } else if (sort === "price_asc") {
      items.sort((a, b) => a.price - b.price);
    } else if (sort === "price_desc") {
      items.sort((a, b) => b.price - a.price);
    } else if (sort === "rating") {
      items.sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.ratingCount - a.ratingCount);
    }
    return { listings: items.slice(0, 200) };
  }

  async listingDetail(request, listing) {
    const user = await this.currentUser(request, false);
    const isSeller = Boolean(user && user.id === listing.seller_id);
    if (listing.status !== "live" && !isSeller) {
      throw new ApiError(404, "Listing not found");
    }
    const summary = this.summary(listing);
    let owned = false;
    let pending = null;
    if (user) {
      owned = Boolean(this.one("SELECT 1 AS x FROM orders WHERE listing_id = ? AND buyer_id = ? AND status = 'paid'", listing.id, user.id));
      const p = this.one("SELECT * FROM orders WHERE listing_id = ? AND buyer_id = ? AND status = 'pending'", listing.id, user.id);
      pending = p ? this.orderOut(p) : null;
    }
    const reviews = this.all(
      `SELECT reviews.rating, reviews.body, reviews.created, users.name FROM reviews JOIN users ON users.id = reviews.user_id
       WHERE listing_id = ? ORDER BY reviews.created DESC LIMIT 50`,
      listing.id,
    );
    return {
      listing: {
        ...summary,
        spec: JSON.parse(listing.spec),
        owned,
        pendingOrder: pending,
        isSeller,
        paymentUrl: isSeller || pending ? listing.payment_url : "",
        reviews: reviews.map((r) => ({ rating: r.rating, body: r.body, name: r.name, created: r.created })),
      },
    };
  }

  listingFields(data, current) {
    const price = data.price !== undefined ? moneyToCents(data.price) : current.price_cents;
    let commission = current.commission_pct;
    if (data.commissionPct !== undefined) {
      commission = parseInt(data.commissionPct, 10);
      if (!Number.isInteger(commission) || commission < 0 || commission > 50) {
        throw new ApiError(400, "Affiliate commission must be 0–50%");
      }
    }
    const paymentUrl = data.paymentUrl !== undefined ? cleanUrl(data.paymentUrl) : current.payment_url;
    if (price > 0 && !paymentUrl) {
      throw new ApiError(400, "Paid templates need your payment link (Lynk.id, Saweria, Gumroad, Stripe Payment Link, PayPal…)");
    }
    return { price, commission, paymentUrl };
  }

  async publish(request) {
    const user = await this.currentUser(request);
    const data = await this.readJson(request);
    const recent = this.one("SELECT COUNT(*) AS n FROM listings WHERE seller_id = ? AND created > ?", user.id, now() - 86400).n;
    if (recent >= 20) {
      throw new ApiError(429, "You can publish up to 20 templates a day");
    }
    const spec = cleanSpec(data.spec);
    const title = cleanText(data.title, 70, "Title");
    const description = cleanText(data.description, 1200, "Description");
    const category = CATEGORIES.has(data.category) ? data.category : "Other";
    const currency = CURRENCIES.has(data.currency) ? data.currency : "USD";
    const fields = this.listingFields(data, { price_cents: 0, commission_pct: 20, payment_url: "" });
    const tags = (Array.isArray(data.tags) ? data.tags : []).map((t) => String(t).trim().slice(0, 24)).filter(Boolean).slice(0, 8);
    const id = randomId("l_");
    const t = now();
    this.run(
      `INSERT INTO listings (id, seller_id, template_id, title, description, category, tags, price_cents, currency,
        commission_pct, payment_url, spec, status, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)`,
      id, user.id, String(data.templateId || "").slice(0, 40) || null, title, description, category, JSON.stringify(tags),
      fields.price, currency, fields.commission, fields.paymentUrl, spec, t, t,
    );
    return { __http: 201, body: { listing: this.summary(this.one("SELECT * FROM listings WHERE id = ?", id)) } };
  }

  async editListing(request, listing) {
    const user = await this.currentUser(request);
    if (listing.seller_id !== user.id) {
      throw new ApiError(403, "Not your listing");
    }
    const data = await this.readJson(request);
    const fields = this.listingFields(data, listing);
    const title = data.title !== undefined ? cleanText(data.title, 70, "Title") : listing.title;
    const description = data.description !== undefined ? cleanText(data.description, 1200, "Description") : listing.description;
    this.run(
      "UPDATE listings SET title = ?, description = ?, price_cents = ?, commission_pct = ?, payment_url = ?, updated = ? WHERE id = ?",
      title, description, fields.price, fields.commission, fields.paymentUrl, now(), listing.id,
    );
    return { listing: this.summary(this.one("SELECT * FROM listings WHERE id = ?", listing.id)) };
  }

  // ---- orders
  orderOut(row, extra = {}) {
    return {
      id: row.id,
      ref: row.ref,
      listingId: row.listing_id,
      status: row.status,
      price: row.price_cents / 100,
      currency: row.currency,
      platformFee: row.platform_fee_cents / 100,
      commission: row.commission_cents / 100,
      sellerNet: row.seller_net_cents / 100,
      viaAffiliate: Boolean(row.affiliate_code),
      commissionPaid: Boolean(row.commission_paid),
      created: row.created,
      paidAt: row.paid_at,
      ...extra,
    };
  }

  async createOrder(request, listing) {
    const user = await this.currentUser(request);
    if (listing.status !== "live") {
      throw new ApiError(404, "Listing not found");
    }
    if (listing.seller_id === user.id) {
      throw new ApiError(400, "You can’t buy your own template");
    }
    const existing = this.one(
      "SELECT * FROM orders WHERE listing_id = ? AND buyer_id = ? AND status IN ('pending', 'paid')",
      listing.id, user.id,
    );
    if (existing) {
      return { order: this.orderOut(existing), paymentUrl: existing.status === "pending" ? listing.payment_url : "", existing: true };
    }
    this.requireLimit("order:" + user.id, 30, 3600, "Too many orders — try again later");
    const data = await this.readJson(request);
    const price = listing.price_cents;
    if (price > 0 && !listing.payment_url) {
      throw new ApiError(400, "This seller hasn’t set up payments yet");
    }
    const fee = Math.round(price * this.feePct / 100);
    const code = String(data.ref || "").trim();
    let affiliate = null;
    if (code && CODE_RE.test(code)) {
      const link = this.one("SELECT * FROM affiliate_links WHERE code = ? AND listing_id = ?", code, listing.id);
      if (link && link.user_id !== user.id && link.user_id !== listing.seller_id) {
        affiliate = link;
      }
    }
    const commission = affiliate && price > 0 ? Math.round(price * listing.commission_pct / 100) : 0;
    const status = price > 0 ? "pending" : "paid";
    const id = randomId("o_");
    let ref = orderRef();
    while (this.one("SELECT 1 AS x FROM orders WHERE ref = ?", ref)) {
      ref = orderRef();
    }
    const t = now();
    this.run(
      `INSERT INTO orders (id, ref, listing_id, buyer_id, seller_id, status, price_cents, currency, platform_fee_cents,
        affiliate_code, affiliate_user_id, commission_cents, seller_net_cents, commission_paid, created, paid_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id, ref, listing.id, user.id, listing.seller_id, status, price, listing.currency, fee,
      affiliate ? affiliate.code : null, affiliate ? affiliate.user_id : null, commission, price - fee - commission,
      t, status === "paid" ? t : null,
    );
    const order = this.one("SELECT * FROM orders WHERE id = ?", id);
    return { __http: 201, body: { order: this.orderOut(order), paymentUrl: status === "pending" ? listing.payment_url : "", existing: false } };
  }

  async routeOrders(request, method, parts) {
    const user = await this.currentUser(request);
    if (method === "GET" && !parts.length) {
      const rows = this.all(
        `SELECT orders.*, listings.title, listings.payment_url, users.name AS seller_name FROM orders
         JOIN listings ON listings.id = orders.listing_id JOIN users ON users.id = orders.seller_id
         WHERE orders.buyer_id = ? ORDER BY orders.created DESC LIMIT 200`,
        user.id,
      );
      return {
        orders: rows.map((r) => this.orderOut(r, {
          title: r.title, sellerName: r.seller_name, paymentUrl: r.status === "pending" ? r.payment_url : "",
        })),
      };
    }
    if (method !== "POST" || parts.length !== 2) {
      throw new ApiError(404, "Not found");
    }
    const order = this.one("SELECT * FROM orders WHERE id = ?", parts[0]);
    if (!order) {
      throw new ApiError(404, "Order not found");
    }
    const action = parts[1];
    if (action === "cancel") {
      if (order.buyer_id !== user.id || order.status !== "pending") {
        throw new ApiError(400, "Only your pending orders can be cancelled");
      }
      this.run("UPDATE orders SET status = 'cancelled' WHERE id = ?", order.id);
    } else if (action === "confirm" || action === "reject") {
      if (order.seller_id !== user.id) {
        throw new ApiError(403, "Not your sale");
      }
      if (order.status !== "pending") {
        throw new ApiError(400, "This order is already " + order.status);
      }
      if (action === "confirm") {
        this.run("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?", now(), order.id);
      } else {
        this.run("UPDATE orders SET status = 'rejected' WHERE id = ?", order.id);
      }
    } else if (action === "commission-paid") {
      if (order.seller_id !== user.id) {
        throw new ApiError(403, "Not your sale");
      }
      if (order.status !== "paid" || order.commission_cents <= 0) {
        throw new ApiError(400, "No commission is owed on this order");
      }
      this.run("UPDATE orders SET commission_paid = 1 WHERE id = ?", order.id);
    } else {
      throw new ApiError(404, "Not found");
    }
    return { order: this.orderOut(this.one("SELECT * FROM orders WHERE id = ?", order.id)) };
  }

  async review(request, listing) {
    const user = await this.currentUser(request);
    if (!this.one("SELECT 1 AS x FROM orders WHERE listing_id = ? AND buyer_id = ? AND status = 'paid'", listing.id, user.id)) {
      throw new ApiError(403, "Only buyers can review");
    }
    const data = await this.readJson(request);
    const rating = parseInt(data.rating, 10);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ApiError(400, "Rating must be 1–5");
    }
    const body = cleanText(data.body, 800, "Review", false);
    this.run(
      `INSERT INTO reviews (id, listing_id, user_id, rating, body, created) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(listing_id, user_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, created = excluded.created`,
      randomId("r_"), listing.id, user.id, rating, body, now(),
    );
    return { ok: true };
  }

  async library(request) {
    const user = await this.currentUser(request);
    const rows = this.all(
      `SELECT orders.*, listings.title, listings.spec FROM orders JOIN listings ON listings.id = orders.listing_id
       WHERE orders.buyer_id = ? AND orders.status = 'paid' ORDER BY orders.paid_at DESC`,
      user.id,
    );
    return {
      items: rows.map((r) => ({
        listingId: r.listing_id, title: r.title, price: r.price_cents / 100, currency: r.currency,
        purchased: r.paid_at || r.created, ref: r.ref, spec: JSON.parse(r.spec),
      })),
    };
  }

  // ---- affiliate
  async routeAffiliate(request, method, parts, ip) {
    if (method === "POST" && parts[0] === "click") {
      const data = await this.readJson(request);
      const code = String(data.code || "");
      if (CODE_RE.test(code) && this.limit("click:" + ip + ":" + code, 1, 3600).ok) {
        this.run("UPDATE affiliate_links SET clicks = clicks + 1 WHERE code = ?", code);
      }
      return { ok: true };
    }
    const user = await this.currentUser(request);
    if (method === "POST" && parts[0] === "links") {
      const data = await this.readJson(request);
      const listing = this.one("SELECT * FROM listings WHERE id = ? AND status = 'live'", String(data.listingId || ""));
      if (!listing) {
        throw new ApiError(404, "Listing not found");
      }
      if (listing.commission_pct <= 0 || listing.price_cents <= 0) {
        throw new ApiError(400, "This template doesn’t offer affiliate commission");
      }
      if (listing.seller_id === user.id) {
        throw new ApiError(400, "You can’t be an affiliate for your own template");
      }
      const existing = this.one("SELECT * FROM affiliate_links WHERE user_id = ? AND listing_id = ?", user.id, listing.id);
      if (existing) {
        return { link: { code: existing.code, listingId: listing.id } };
      }
      const base = user.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "partner";
      const code = base + "-" + hex(crypto.getRandomValues(new Uint8Array(3)));
      this.run("INSERT INTO affiliate_links (code, user_id, listing_id, clicks, created) VALUES (?, ?, ?, 0, ?)", code, user.id, listing.id, now());
      return { __http: 201, body: { link: { code, listingId: listing.id } } };
    }
    if (method === "GET" && !parts.length) {
      const rows = this.all(
        `SELECT affiliate_links.*, listings.title, listings.currency, listings.commission_pct, listings.price_cents
         FROM affiliate_links JOIN listings ON listings.id = affiliate_links.listing_id
         WHERE affiliate_links.user_id = ? ORDER BY affiliate_links.created DESC`,
        user.id,
      );
      const links = rows.map((r) => {
        const paid = this.one(
          `SELECT COUNT(*) AS n, COALESCE(SUM(commission_cents), 0) AS earned,
             COALESCE(SUM(CASE WHEN commission_paid = 1 THEN commission_cents ELSE 0 END), 0) AS paid_out
           FROM orders WHERE affiliate_code = ? AND status = 'paid'`,
          r.code,
        );
        const pending = this.one("SELECT COUNT(*) AS n FROM orders WHERE affiliate_code = ? AND status = 'pending'", r.code);
        return {
          code: r.code, listingId: r.listing_id, title: r.title, clicks: r.clicks, sales: paid.n, pendingSales: pending.n,
          earnings: paid.earned / 100, paidOut: paid.paid_out / 100, currency: r.currency,
          commissionPct: r.commission_pct, price: r.price_cents / 100,
        };
      });
      return { links, payoutInfo: user.payout_info || "" };
    }
    throw new ApiError(404, "Not found");
  }

  // ---- seller
  async sellerStats(request) {
    const user = await this.currentUser(request);
    const listings = this.all("SELECT * FROM listings WHERE seller_id = ? ORDER BY created DESC", user.id).map((row) => {
      const agg = this.one(
        `SELECT COUNT(*) AS n, COALESCE(SUM(price_cents), 0) AS gross, COALESCE(SUM(platform_fee_cents), 0) AS fees,
           COALESCE(SUM(commission_cents), 0) AS commissions, COALESCE(SUM(seller_net_cents), 0) AS net
         FROM orders WHERE listing_id = ? AND status = 'paid'`,
        row.id,
      );
      return {
        ...this.summary(row), paymentUrl: row.payment_url,
        gross: agg.gross / 100, fees: agg.fees / 100, commissions: agg.commissions / 100, net: agg.net / 100,
      };
    });
    const pending = this.all(
      `SELECT orders.*, listings.title, users.name AS buyer_name, users.email AS buyer_email FROM orders
       JOIN listings ON listings.id = orders.listing_id JOIN users ON users.id = orders.buyer_id
       WHERE orders.seller_id = ? AND orders.status = 'pending' ORDER BY orders.created DESC LIMIT 100`,
      user.id,
    ).map((r) => this.orderOut(r, { title: r.title, buyerName: r.buyer_name, buyerEmail: r.buyer_email }));
    const payouts = this.all(
      `SELECT orders.*, listings.title, users.name AS affiliate_name, users.payout_info AS affiliate_payout FROM orders
       JOIN listings ON listings.id = orders.listing_id JOIN users ON users.id = orders.affiliate_user_id
       WHERE orders.seller_id = ? AND orders.status = 'paid' AND orders.commission_cents > 0
       ORDER BY orders.commission_paid ASC, orders.paid_at DESC LIMIT 100`,
      user.id,
    ).map((r) => this.orderOut(r, { title: r.title, affiliateName: r.affiliate_name, affiliatePayout: r.affiliate_payout || "" }));
    const recent = this.all(
      `SELECT orders.*, listings.title FROM orders JOIN listings ON listings.id = orders.listing_id
       WHERE orders.seller_id = ? AND orders.status = 'paid' ORDER BY orders.paid_at DESC LIMIT 20`,
      user.id,
    ).map((r) => this.orderOut(r, { title: r.title }));
    return { platformFeePct: this.feePct, listings, pending, payouts, recent };
  }

  // ---- AI
  async aiTemplate(request, ip) {
    if (!this.env.AI) {
      throw new ApiError(503, "AI is not available right now");
    }
    const user = await this.currentUser(request, false);
    const data = await this.readJson(request);
    const prompt = cleanText(data.prompt, 600, "Prompt");
    const dailyCap = parseInt(this.env.AI_DAILY_LIMIT || "300", 10);
    const personal = user
      ? this.limit("ai:u:" + user.id, 20, 86400)
      : this.limit("ai:ip:" + ip, 5, 86400);
    if (!personal.ok) {
      throw new ApiError(429, user ? "You used today’s 20 AI generations — the quick generator still works" : "Log in for more AI generations today");
    }
    if (!this.limit("ai:all", dailyCap, 86400).ok) {
      throw new ApiError(429, "Mint AI is busy today — the quick generator still works");
    }
    const model = this.env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    let result;
    try {
      result = await this.env.AI.run(model, {
        messages: [
          { role: "system", content: Core.aiSystemPrompt() },
          { role: "user", content: prompt },
        ],
        max_tokens: 2400,
        temperature: 0.4,
      });
    } catch (err) {
      console.error("ai error", err && err.message);
      throw new ApiError(502, "AI request failed");
    }
    const text = typeof result.response === "string" ? result.response : JSON.stringify(result.response || result);
    const spec = specFromAiText(text, prompt);
    return { spec, model, remaining: personal.remaining };
  }
}
