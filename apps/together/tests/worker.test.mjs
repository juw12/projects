// Tests for apps/together/cloud/src/index.js (Cloudflare Worker + Durable Objects), run with plain Node.
// The Durable Object storage is faked: a strict SQL fake (unknown statements throw, so a schema change
// fails loudly here) and a Map-backed KV store. No network: sendPush is never reached without VAPID keys.
import assert from "node:assert/strict";
import worker, { Room, Reminder } from "../cloud/src/index.js";

const DAY = 864e5;

function fakeSql() {
  const db = { blob: null, meta: {} };
  const rows = list => ({ toArray: () => list });
  return {
    db,
    exec(query, ...args) {
      const q = query.replace(/\s+/g, " ").trim();
      if (q.startsWith("CREATE TABLE")) return rows([]);
      if (q === "SELECT v FROM meta WHERE k = 'seen'") return rows("seen" in db.meta ? [{ v: db.meta.seen }] : []);
      if (q === "INSERT OR REPLACE INTO meta (k, v) VALUES ('seen', ?)") { db.meta.seen = args[0]; return rows([]); }
      if (q === "SELECT version, auth, data, updated FROM blob WHERE k = 1") return rows(db.blob ? [{ ...db.blob }] : []);
      if (q === "DELETE FROM blob WHERE k = 1") { db.blob = null; return rows([]); }
      if (q === "DELETE FROM meta") { db.meta = {}; return rows([]); }
      if (q === "INSERT INTO blob (k, version, auth, data, updated) VALUES (1, 1, ?, ?, ?)") {
        db.blob = { version: 1, auth: args[0], data: args[1], updated: args[2] };
        return rows([]);
      }
      if (q === "UPDATE blob SET version = ?, data = ?, updated = ? WHERE k = 1") {
        Object.assign(db.blob, { version: args[0], data: args[1], updated: args[2] });
        return rows([]);
      }
      throw new Error("unexpected SQL in test fake: " + q);
    },
  };
}

function fakeState() {
  const kv = new Map();
  const state = {
    alarm: null,
    storage: {
      sql: fakeSql(),
      async setAlarm(at) { state.alarm = at; },
      async deleteAlarm() { state.alarm = null; },
      async get(key) { return kv.get(key); },
      async put(key, value) {
        if (typeof key === "object") for (const [k, v] of Object.entries(key)) kv.set(k, v);
        else kv.set(key, value);
      },
      async delete(keys) { for (const k of [].concat(keys)) kv.delete(k); },
      async deleteAll() { kv.clear(); },
    },
  };
  return state;
}

/** env whose namespaces hand out one real Room / Reminder per id, like Cloudflare does. */
function fakeEnv() {
  const make = Cls => {
    const objects = new Map();
    return {
      objects,
      idFromName: name => name,
      get: id => {
        if (!objects.has(id)) objects.set(id, new Cls(fakeState(), env));
        return objects.get(id);
      },
    };
  };
  const env = {
    ALLOWED_ORIGINS: "https://juw12.github.io,http://localhost:8765",
    VAPID_PUBLIC: "pub",
  };
  env.ROOMS = make(Room);
  env.REMINDERS = make(Reminder);
  return env;
}

const ROOM = "room_ABCDEFGHIJKLMNOP";
const AUTH = "a".repeat(40);
const OTHER = "b".repeat(40);
const BASE = "https://cloud.example";

async function call(env, method, path, body, origin = "https://juw12.github.io") {
  const init = { method, headers: { Origin: origin, "content-type": "application/json" } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const response = await worker.fetch(new Request(BASE + path, init), env);
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("CORS: preflight, allowed origin echoed, unknown origin pinned", async () => {
  const env = fakeEnv();
  const pre = await worker.fetch(new Request(BASE + "/v1/status", { method: "OPTIONS", headers: { Origin: "http://localhost:8765" } }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), "http://localhost:8765");
  const evil = await call(env, "GET", "/v1/status", undefined, "https://evil.example");
  assert.equal(evil.headers.get("Access-Control-Allow-Origin"), "https://juw12.github.io");
});

test("status reports a missing push key without leaking anything", async () => {
  const { status, body } = await call(fakeEnv(), "GET", "/v1/status");
  assert.equal(status, 200);
  assert.equal(body.push, "missing");
  assert.equal(body.service, "together-cloud");
});

test("routing rejects bad ids and unknown paths", async () => {
  const env = fakeEnv();
  assert.equal((await call(env, "GET", "/v1/rooms/short")).status, 404);
  assert.equal((await call(env, "GET", "/v1/rooms/" + ROOM + "/extra")).status, 404);
  assert.equal((await call(env, "GET", "/v1/rooms/bad$chars_0123456789")).status, 404);
  assert.equal((await call(env, "GET", "/v2/status")).status, 404);
  assert.equal(env.ROOMS.objects.size, 0, "no Durable Object is created for rejected ids");
});

test("malformed JSON is a 400, not a crash", async () => {
  const { status, body } = await call(fakeEnv(), "PUT", "/v1/rooms/" + ROOM, "{not json");
  assert.equal(status, 400);
  assert.equal(body.error, "bad request");
});

test("room lifecycle: create, conflict, update, poll, delete", async () => {
  const env = fakeEnv();
  const path = "/v1/rooms/" + ROOM;
  assert.equal((await call(env, "GET", path)).status, 404);
  assert.equal((await call(env, "PUT", path, { auth: "short", baseVersion: 0, data: "x" })).status, 401);
  assert.equal((await call(env, "PUT", path, { auth: AUTH, baseVersion: 3, data: "x" })).status, 404, "old device cannot resurrect");

  const created = await call(env, "PUT", path, { auth: AUTH, baseVersion: 0, data: "cipher-1" });
  assert.equal(created.status, 200);
  assert.equal(created.body.version, 1);

  const stored = env.ROOMS.objects.get(ROOM).sql.db.blob;
  assert.notEqual(stored.auth, AUTH, "only a hash of the auth secret is stored");
  assert.match(stored.auth, /^[A-Za-z0-9_-]{43}$/);

  assert.equal((await call(env, "PUT", path, { auth: OTHER, baseVersion: 1, data: "x" })).status, 403);
  const stale = await call(env, "PUT", path, { auth: AUTH, baseVersion: 0, data: "x" });
  assert.equal(stale.status, 409);
  assert.deepEqual([stale.body.version, stale.body.data], [1, "cipher-1"]);

  const updated = await call(env, "PUT", path, { auth: AUTH, baseVersion: 1, data: "cipher-2" });
  assert.equal(updated.body.version, 2);
  assert.equal((await call(env, "GET", path + "?since=2")).status, 204);
  const fresh = await call(env, "GET", path + "?since=1");
  assert.equal(fresh.body.data, "cipher-2");

  assert.equal((await call(env, "DELETE", path, { auth: OTHER })).status, 403);
  assert.equal((await call(env, "DELETE", path, { auth: AUTH })).status, 200);
  assert.equal((await call(env, "GET", path)).status, 404);
});

test("oversized or empty data is refused", async () => {
  const env = fakeEnv();
  const path = "/v1/rooms/" + ROOM;
  assert.equal((await call(env, "PUT", path, { auth: AUTH, baseVersion: 0, data: "" })).status, 413);
  assert.equal((await call(env, "PUT", path, { auth: AUTH, baseVersion: 0, data: "x".repeat(512 * 1024 + 1) })).status, 413);
});

test("room alarm deletes only long-idle rooms", async () => {
  const state = fakeState();
  const room = new Room(state, {});
  state.storage.sql.db.blob = { version: 1, auth: "h", data: "d", updated: Date.now() - 10 * DAY };
  await room.alarm();
  assert.ok(state.storage.sql.db.blob, "recently active room survives");
  assert.ok(state.alarm > Date.now(), "and is rescheduled");
  state.storage.sql.db.blob.updated = Date.now() - 401 * DAY;
  await room.alarm();
  assert.equal(state.storage.sql.db.blob, null);
});

test("push: subscription validated, times filtered/sorted/capped", async () => {
  const env = fakeEnv();
  const path = "/v1/push/" + ROOM;
  assert.equal((await call(env, "PUT", path, { subscription: { endpoint: "http://insecure" }, times: [] })).status, 400);
  const now = Date.now();
  const times = [now + 3 * DAY, now - DAY, "junk", now + DAY, now + 500 * DAY, ...Array.from({ length: 80 }, (_, i) => now + (i + 5) * DAY)];
  const saved = await call(env, "PUT", path, { subscription: { endpoint: "https://push.example/abc", keys: { p256dh: "secret" } }, times });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.count, 64);
  assert.equal(saved.body.nextAt, now + DAY);
  const reminder = env.REMINDERS.objects.get(ROOM);
  assert.deepEqual(await reminder.state.storage.get("subscription"), { endpoint: "https://push.example/abc" }, "only the endpoint is kept");
  assert.equal(reminder.state.alarm, now + DAY);
});

test("push: test-send is rate limited and needs a subscription", async () => {
  const env = fakeEnv();
  const path = "/v1/push/" + ROOM;
  assert.equal((await call(env, "POST", path)).status, 404);
  await call(env, "PUT", path, { subscription: { endpoint: "https://push.example/abc" }, times: [] });
  const first = await call(env, "POST", path);
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 0, "no VAPID key configured, so nothing is sent");
  assert.equal((await call(env, "POST", path)).status, 429);
  assert.equal((await call(env, "DELETE", path)).status, 200);
  assert.equal((await call(env, "GET", path)).body.count, 0);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log("ok   -", name);
  } catch (error) {
    failed += 1;
    console.log("FAIL -", name, "\n   ", error && error.stack || error);
  }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
