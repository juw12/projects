// Together cloud: end-to-end-encrypted partner sync + Web Push reminder scheduler.
//
// Privacy model
// - Sync rooms store only ciphertext. The encryption key lives in the pairing link's #fragment,
//   which browsers never send to servers. Writes need a separate HKDF-derived auth secret; the
//   room stores only its SHA-256 hash.
// - Push reminders store a browser push subscription plus a list of timestamps. Reminder text
//   stays on the device (the service worker builds it), so pushes carry no payload.
//
// Routes
//   GET    /v1/status
//   GET    /v1/rooms/:id[?since=<version>]   -> 200 {version, data, updated} | 204 | 404
//          (reads count as activity: a room is kept while either partner opens the app)
//   PUT    /v1/rooms/:id  {auth, baseVersion, data} -> 200 {version, updated} | 409 {version, data, updated}
//   DELETE /v1/rooms/:id  {auth}
//   PUT    /v1/push/:id   {subscription, times[]}   -> 200 {count, nextAt}
//   GET    /v1/push/:id                             -> 200 {count, nextAt, lastPush}
//   POST   /v1/push/:id                             -> 200 {status} (send one test push now)
//   DELETE /v1/push/:id

const MAX_BLOB_CHARS = 512 * 1024;
const MAX_REMINDERS = 64;
const ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const DAY_MS = 864e5;
const ROOM_TTL_MS = 400 * DAY_MS;

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "*",
    "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body, status = 200, extra = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

async function sha256Base64Url(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BLOB_CHARS + 4096) throw new Error("too large");
  return text ? JSON.parse(text) : {};
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    let response;
    try {
      if (parts[0] !== "v1") {
        response = json({ error: "not found" }, 404);
      } else if (parts[1] === "status") {
        response = json({ ok: true, service: "together-cloud", push: pushKeyStatus(env), vapidPublic: env.VAPID_PUBLIC || null });
      } else if ((parts[1] === "rooms" || parts[1] === "push") && parts[2] && ID_PATTERN.test(parts[2]) && parts.length === 3) {
        const namespace = parts[1] === "rooms" ? env.ROOMS : env.REMINDERS;
        const stub = namespace.get(namespace.idFromName(parts[2]));
        response = await stub.fetch(request);
      } else {
        response = json({ error: "not found" }, 404);
      }
    } catch (error) {
      response = json({ error: "bad request" }, 400);
    }
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
};

/** One encrypted plan per couple. Optimistic concurrency via a monotonically increasing version. */
export class Room {
  constructor(state, env) {
    this.state = state;
    this.sql = state.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS blob (k INTEGER PRIMARY KEY, version INTEGER, auth TEXT, data TEXT, updated INTEGER)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER)");
  }

  lastSeen() {
    return this.sql.exec("SELECT v FROM meta WHERE k = 'seen'").toArray()[0]?.v || 0;
  }

  /** Reads keep a room alive too; written at most once a day to stay cheap. */
  async touch(row, now) {
    if (now - Math.max(row.updated, this.lastSeen()) < DAY_MS) return;
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('seen', ?)", now);
    await this.state.storage.setAlarm(now + ROOM_TTL_MS);
  }

  current() {
    return this.sql.exec("SELECT version, auth, data, updated FROM blob WHERE k = 1").toArray()[0] || null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const row = this.current();
    if (request.method === "GET") {
      if (!row) return json({ error: "no such room" }, 404);
      await this.touch(row, Date.now());
      const since = Number(url.searchParams.get("since"));
      if (Number.isFinite(since) && since >= row.version) return new Response(null, { status: 204 });
      return json({ version: row.version, data: row.data, updated: row.updated });
    }
    const body = await readJson(request);
    if (typeof body.auth !== "string" || body.auth.length < 32) return json({ error: "auth required" }, 401);
    const authHash = await sha256Base64Url(body.auth);
    if (request.method === "DELETE") {
      if (!row) return json({ ok: true });
      if (row.auth !== authHash) return json({ error: "forbidden" }, 403);
      this.sql.exec("DELETE FROM blob WHERE k = 1");
      this.sql.exec("DELETE FROM meta");
      await this.state.storage.deleteAlarm();
      return json({ ok: true });
    }
    if (request.method !== "PUT") return json({ error: "method not allowed" }, 405);
    if (typeof body.data !== "string" || !body.data || body.data.length > MAX_BLOB_CHARS) return json({ error: "invalid data" }, 413);
    const now = Date.now();
    if (!row) {
      this.sql.exec("INSERT INTO blob (k, version, auth, data, updated) VALUES (1, 1, ?, ?, ?)", authHash, body.data, now);
      await this.state.storage.setAlarm(now + ROOM_TTL_MS);
      return json({ version: 1, updated: now });
    }
    if (row.auth !== authHash) return json({ error: "forbidden" }, 403);
    if (Number(body.baseVersion) !== row.version) {
      return json({ version: row.version, data: row.data, updated: row.updated }, 409);
    }
    const version = row.version + 1;
    this.sql.exec("UPDATE blob SET version = ?, data = ?, updated = ? WHERE k = 1", version, body.data, now);
    await this.state.storage.setAlarm(now + ROOM_TTL_MS);
    return json({ version, updated: now });
  }

  /** Rooms nobody has opened or written for 400 days are deleted. */
  async alarm() {
    const row = this.current();
    if (!row) return;
    const lastActive = Math.max(row.updated, this.lastSeen());
    if (Date.now() - lastActive < ROOM_TTL_MS - DAY_MS) {
      await this.state.storage.setAlarm(lastActive + ROOM_TTL_MS);
      return;
    }
    this.sql.exec("DELETE FROM blob WHERE k = 1");
    this.sql.exec("DELETE FROM meta");
  }
}

/** One push subscription per device; fires payload-less pushes at the stored timestamps. */
export class Reminder {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async summary() {
    const times = (await this.state.storage.get("times")) || [];
    const lastPush = (await this.state.storage.get("lastPush")) || null;
    return { count: times.length, nextAt: times[0] || null, lastPush };
  }

  /** Send one push and remember the outcome (status 201 = accepted by the push service). */
  async deliver(subscription) {
    let result;
    try {
      result = { at: Date.now(), status: await sendPush(subscription.endpoint, this.env) };
    } catch (error) {
      result = { at: Date.now(), status: 0, error: String(error && error.message || error).slice(0, 200) };
    }
    await this.state.storage.put("lastPush", result);
    if (result.status === 404 || result.status === 410) {
      await this.state.storage.delete(["subscription", "times"]);
      await this.state.storage.deleteAlarm();
    }
    return result;
  }

  async fetch(request) {
    if (request.method === "GET") return json(await this.summary());
    if (request.method === "DELETE") {
      await this.state.storage.deleteAll();
      await this.state.storage.deleteAlarm();
      return json({ ok: true });
    }
    if (request.method === "POST") {
      const subscription = await this.state.storage.get("subscription");
      if (!subscription) return json({ error: "not subscribed" }, 404);
      const last = (await this.state.storage.get("lastTestAt")) || 0;
      if (Date.now() - last < 20e3) return json({ error: "slow down" }, 429);
      await this.state.storage.put("lastTestAt", Date.now());
      return json(await this.deliver(subscription));
    }
    if (request.method !== "PUT") return json({ error: "method not allowed" }, 405);
    const body = await readJson(request);
    const subscription = body.subscription;
    if (!subscription || typeof subscription.endpoint !== "string" || !/^https:\/\//.test(subscription.endpoint)) {
      return json({ error: "invalid subscription" }, 400);
    }
    const now = Date.now();
    const times = (Array.isArray(body.times) ? body.times : [])
      .map(Number)
      .filter(t => Number.isFinite(t) && t > now && t < now + 400 * DAY_MS)
      .sort((a, b) => a - b)
      .slice(0, MAX_REMINDERS);
    await this.state.storage.put({ subscription: { endpoint: subscription.endpoint }, times });
    if (times.length) await this.state.storage.setAlarm(times[0]);
    else await this.state.storage.deleteAlarm();
    return json(await this.summary());
  }

  async alarm() {
    const subscription = await this.state.storage.get("subscription");
    let times = (await this.state.storage.get("times")) || [];
    const now = Date.now();
    const due = times.filter(t => t <= now + 60e3);
    times = times.filter(t => t > now + 60e3);
    await this.state.storage.put("times", times);
    if (times.length) await this.state.storage.setAlarm(times[0]);
    if (due.length && subscription) await this.deliver(subscription);
  }
}

/** "ok" only when the signing key is present AND parses as an EC P-256 private JWK. */
function pushKeyStatus(env) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return "missing";
  try {
    const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
    return jwk.kty === "EC" && jwk.crv === "P-256" && typeof jwk.d === "string" ? "ok" : "invalid";
  } catch (error) {
    return "invalid";
  }
}

/** Payload-less Web Push with a VAPID (RFC 8292) ES256 JWT. */
async function sendPush(endpoint, env) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return 0;
  const audience = new URL(endpoint).origin;
  const encode = value => base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || "https://github.com/juw12/projects",
  })}`;
  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(env.VAPID_PRIVATE_JWK),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${unsigned}.${base64UrlEncode(new Uint8Array(signature))}, k=${env.VAPID_PUBLIC}`,
      TTL: "86400",
      Urgency: "normal",
    },
    body: "",
  });
  return response.status;
}
