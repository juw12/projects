import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as entry from "../src/index.js";
import { AI_MODELS, KEYLESS } from "../src/models.js";
import { SELFTEST_NOTE } from "../src/selftest.js";
import { VERSION, sha256Hex } from "../src/util.js";
import { FakeNamespace, completion, fakeAi, fakeFetch, makeClock, reply } from "./fakes.js";

const { createWorker } = entry;
const ORIGIN = "https://juw12.github.io";
const PAGES = "https://glow.test/projects/glow";
const SETUP_CODE = "a-test-code-that-opens-nothing-real";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const READER = "https://r.jina.ai/";
const HTML = { headers: { "Content-Type": "text/html; charset=utf-8" } };

// A Worker with a pretend network, a pretend clock and a pretend Cloudflare around it.
async function setUp(options = {}) {
  const now = makeClock();
  const send = fakeFetch(options.routes || []);
  // `every` would start a real timer (the "typing…" signal in a chat); no test has a use for one.
  const overrides = { fetch: send, now, every: () => () => {} };
  for (const name of ["probe", "selftest", "uuid"]) {
    if (options[name]) overrides[name] = options[name];
  }
  const { worker, ChatAgent, Registry } = createWorker(overrides);
  const env = {
    AI: options.ai,
    ALLOWED_ORIGINS: ORIGIN + ",https://localhost",
    GLOW_PAGES: PAGES,
    SETUP_CODE_SHA256: await sha256Hex(SETUP_CODE),
    BUILD: "build-one",
  };
  env.CHAT = new FakeNamespace(ChatAgent, env, now);
  env.REGISTRY = new FakeNamespace(Registry, env, now);

  async function call(path, init = {}) {
    const response = await worker.fetch(new Request("https://glow-bot.test" + path, init), env);
    const raw = await response.text();
    let body = raw;
    try {
      body = JSON.parse(raw);
    } catch (error) {
      // plain text
    }
    return { status: response.status, headers: response.headers, body };
  }
  return { worker, env, now, send, call };
}

// A stand-in for the real health check that only counts how often it ran.
function countingProbe() {
  const probe = async (options) => {
    probe.runs += 1;
    return { at: options.now(), ms: 0, run: probe.runs };
  };
  probe.runs = 0;
  return probe;
}

test("status says what is running, and the Glow page may read it", async () => {
  const { call, worker, env } = await setUp();
  const status = await call("/v1/status", { headers: { Origin: ORIGIN } });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, {
    ok: true,
    service: "glow-bot",
    version: VERSION,
    build: "build-one",
    stage: "bot",
    configured: false,
    bot: null,
    access: "private",
    claimed: false,
    ai: false,
    colo: "",
  });
  assert.equal(status.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(status.headers.get("Vary"), "Origin");
  assert.equal(status.headers.get("Cache-Control"), "no-store");
  assert.equal((await call("/v1/status/")).status, 200, "a trailing slash is fine");

  // Cloudflare adds where the request landed, and the AI binding when the deploy attached it.
  env.AI = fakeAi({});
  const request = new Request("https://glow-bot.test/v1/status");
  Object.defineProperty(request, "cf", { value: { colo: "SIN" } });
  const placed = await (await worker.fetch(request, env)).json();
  assert.equal(placed.colo, "SIN");
  assert.equal(placed.ai, true);
});

test("another website gets no permission to read the answers", async () => {
  const { call } = await setUp();
  for (const headers of [{ Origin: "https://evil.example" }, {}]) {
    const status = await call("/v1/status", { headers });
    assert.equal(status.status, 200);
    assert.equal(status.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(status.headers.get("Vary"), "Origin");
  }
});

test("the browser's question before a real request is answered", async () => {
  const { call } = await setUp();
  const preflight = await call("/v1/probe", { method: "OPTIONS", headers: { Origin: ORIGIN } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.body, "");
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(preflight.headers.get("Access-Control-Allow-Headers"), /X-Glow-Setup-Code/);
  assert.match(preflight.headers.get("Access-Control-Allow-Methods"), /POST/);
});

test("the front door says hello and unknown addresses say so", async () => {
  const { call, env } = await setUp();
  const hello = await call("/");
  assert.equal(hello.status, 200);
  assert.equal(hello.body, `GlowBot ${VERSION} is running. Glow lives at ${PAGES}/\n`);

  for (const [path, init] of [["/nothing-here", {}], ["/v1/status", { method: "POST" }], ["/v1/probe", { method: "DELETE" }]]) {
    const missing = await call(path, init);
    assert.equal(missing.status, 404, path);
    assert.deepEqual(missing.body, { ok: false, error: "not found" });
  }
  // The two kinds of object behind the door say the same about an address they do not know.
  for (const [namespace, name] of [[env.REGISTRY, "registry"], [env.CHAT, "tg:1"]]) {
    const inside = await namespace.get(namespace.idFromName(name)).fetch("https://glow-bot.internal/nothing-here");
    assert.equal(inside.status, 404, name);
    assert.deepEqual(await inside.json(), { ok: false, error: "not found" });
  }
});

test("a fresh check needs the owner's setup code", async () => {
  const probe = countingProbe();
  const { call, env } = await setUp({ probe });
  for (const headers of [{}, { "X-Glow-Setup-Code": "a wrong guess" }, { "X-Glow-Setup-Code": SETUP_CODE + "x" }]) {
    const refused = await call("/v1/probe?fresh=1", { headers });
    assert.equal(refused.status, 403);
    assert.deepEqual(refused.body, { ok: false, error: "A fresh check needs the setup code." });
  }
  assert.equal(env.CHAT.objects.size, 0, "nothing was started");

  const allowed = await call("/v1/probe?fresh=1", { headers: { "X-Glow-Setup-Code": SETUP_CODE } });
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.body, { running: true, result: null });

  // With no code configured at all, nobody can force a check.
  env.SETUP_CODE_SHA256 = "";
  assert.equal((await call("/v1/probe?fresh=1", { headers: { "X-Glow-Setup-Code": SETUP_CODE } })).status, 403);
});

test("asking again while a check runs does not start another", async () => {
  const probe = countingProbe();
  const { call, env, now } = await setUp({ probe });
  assert.deepEqual((await call("/v1/probe")).body, { running: true, result: null });
  const { storage } = env.CHAT.object("sys:probe");
  const firstAlarm = storage.alarmAt;
  assert.equal(firstAlarm, now());

  now.advance(2000);
  assert.deepEqual((await call("/v1/probe")).body, { running: true, result: null });
  assert.equal(storage.alarmAt, firstAlarm, "the alarm is still the first one");

  assert.equal(await env.CHAT.runAlarms(), 1);
  assert.equal(probe.runs, 1);
  const done = (await call("/v1/probe", { headers: { Origin: ORIGIN } }));
  assert.equal(done.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.deepEqual(done.body, {
    running: false,
    result: { at: now(), ms: 0, run: 1, alarm: { delayMs: 2000 }, version: VERSION, build: "build-one" },
  });
  assert.equal(await env.CHAT.runAlarms(), 0, "nothing is left to run");
});

test("a finished check is reused for six hours, or until the Worker is deployed again", async () => {
  const probe = countingProbe();
  const { call, env, now } = await setUp({ probe });
  await call("/v1/probe");
  await env.CHAT.runAlarms();

  now.advance(6 * HOUR - 1);
  assert.equal((await call("/v1/probe")).body.running, false);
  assert.equal(await env.CHAT.runAlarms(), 0);

  now.advance(1);
  const stale = (await call("/v1/probe")).body;
  assert.equal(stale.running, true, "six hours old, so it is checked again");
  assert.equal(stale.result.run, 1, "the old result is still shown meanwhile");
  await env.CHAT.runAlarms();
  assert.equal((await call("/v1/probe")).body.result.run, 2);

  env.BUILD = "build-two";
  assert.equal((await call("/v1/probe")).body.running, true, "a new deploy, so it is checked again");
  await env.CHAT.runAlarms();
  const fresh = (await call("/v1/probe")).body;
  assert.equal(fresh.running, false);
  assert.equal(fresh.result.build, "build-two");
  assert.equal(probe.runs, 3);
});

test("the owner can ask for a fresh check at any time", async () => {
  const probe = countingProbe();
  const { call, env } = await setUp({ probe });
  await call("/v1/probe");
  await env.CHAT.runAlarms();

  const forced = await call("/v1/probe?fresh=1", { headers: { "X-Glow-Setup-Code": SETUP_CODE } });
  assert.equal(forced.status, 200);
  assert.equal(forced.body.running, true);
  assert.equal(forced.body.result.run, 1);
  await env.CHAT.runAlarms();
  assert.equal((await call("/v1/probe")).body.result.run, 2);
});

test("a check that never finished is started again after ten minutes", async () => {
  const probe = countingProbe();
  const { call, env, now } = await setUp({ probe });
  await call("/v1/probe");
  const { storage } = env.CHAT.object("sys:probe");
  storage.alarmAt = null; // as if the alarm had been lost

  now.advance(10 * MINUTE - 1);
  assert.equal((await call("/v1/probe")).body.running, true);
  assert.equal(storage.alarmAt, null, "still waiting for the first one");

  now.advance(1);
  assert.equal((await call("/v1/probe")).body.running, true);
  assert.equal(storage.alarmAt, now(), "a new alarm is set");
  assert.equal(await env.CHAT.runAlarms(), 1);
  assert.equal(probe.runs, 1);
});

test("a check that breaks still ends, and gives the reason", async () => {
  const failing = async () => {
    throw new Error("the sky fell");
  };
  const { call, env } = await setUp({ probe: failing });
  await call("/v1/probe");
  assert.equal(await env.CHAT.runAlarms(), 1);
  const done = (await call("/v1/probe")).body;
  assert.equal(done.running, false);
  assert.equal(done.result.error, "the sky fell");
  assert.equal(done.result.build, "build-one");
});

test("the alarm never fails, whatever happens inside it", async () => {
  const probe = countingProbe();
  const { call, env } = await setUp({ probe });
  const { storage, instance } = env.CHAT.object("sys:probe");
  await instance.alarm();
  assert.equal(probe.runs, 0, "an alarm with nothing asked for does nothing");

  await call("/v1/probe");
  storage.put = async () => {
    throw new Error("storage is full");
  };
  const logged = [];
  const realLog = console.log;
  console.log = (line) => logged.push(String(line));
  try {
    await instance.alarm(); // Cloudflare would run a failed alarm again, and the whole check with it
  } finally {
    console.log = realLog;
  }
  assert.match(logged.join("\n"), /storage is full/);
});

test("a mistake inside the Worker becomes an error answer, not a crash", async () => {
  const { call, env } = await setUp();
  env.CHAT = undefined;
  const broken = await call("/v1/probe", { headers: { Origin: ORIGIN } });
  assert.equal(broken.status, 500);
  assert.equal(broken.body.ok, false);
  assert.ok(broken.body.error.length > 0);
  assert.equal(broken.headers.get("Access-Control-Allow-Origin"), ORIGIN, "the page can still read the error");
});

test("the settings file names exactly what the Worker exports", () => {
  const settings = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const bound = [...settings.matchAll(/^class_name = "([^"]+)"$/gm)].map((match) => match[1]);
  assert.deepEqual(bound, ["ChatAgent", "Registry"]);
  for (const name of bound) assert.equal(typeof entry[name], "function", `src/index.js must export ${name}`);
  assert.deepEqual(JSON.parse(settings.match(/^new_sqlite_classes = (\[.*\])$/m)[1]), bound, "the free plan needs every class listed here");
  assert.equal(typeof entry.default.fetch, "function");
  assert.match(settings, /^main = "src\/index\.js"$/m);
  assert.match(settings, /^SETUP_CODE_SHA256 = "[0-9a-f]{64}"$/m, "only the hash of the setup code is ever written down");
  assert.match(settings, /^# ai-start\n\[ai\]\nbinding = "AI"\n# ai-end$/m, "the deploy workflow removes this block by its markers");
});

// ---- the real health check, against a pretend internet ----

const SPARK_FOLDER = new URL("../../web/spark/", import.meta.url);
const SPARK_META_TEXT = readFileSync(new URL("spark.json", SPARK_FOLDER), "utf8");
const SPARK_META = JSON.parse(SPARK_META_TEXT);
const SPARK_WEIGHTS = new Uint8Array(readFileSync(new URL(SPARK_META.weights.file, SPARK_FOLDER)));
const provider = Object.fromEntries(KEYLESS.map((entry) => [entry.id, entry]));

const BING_FEED =
  '<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>Search</title>' +
  "<item><title>Limits &#183; Cloudflare Workers docs</title><link>https://developers.cloudflare.com/workers/platform/limits/</link>" +
  "<description>The free plan allows 100,000 requests per day.</description></item>" +
  "<item><title>Workers pricing</title><link>https://example.org/pricing</link><description>Free, then paid.</description></item>" +
  "</channel></rss>";

// The page's name is only in its <title> these days, so the reader has to keep the title to show it.
const EXAMPLE_PAGE =
  "<!doctype html><html><head><title>Example Domain</title></head><body><div>" +
  "<p>This domain is for use in documentation examples without needing permission.</p></div></body></html>";

const LONG_PAGE =
  "<!doctype html><html><head><title>Cloudflare - Wikipedia</title></head><body><p>" +
  "Cloudflare is a company that runs a large network. ".repeat(12) +
  "</p></body></html>";

const PRETEND_INTERNET = [
  [
    provider.ovh.url, // every OVHcloud model shares one address; the body says which is wanted
    (url, init) => {
      const asked = JSON.parse(init.body);
      if (asked.model === provider["ovh-qwen"].model) {
        return reply({ message: "Rate limit reached. Retry after 30 s." }, { status: 429 });
      }
      return reply(completion("pong"));
    },
  ],
  [provider.llm7.url, () => reply(completion("<think>They want one word.</think>Pong!"))],
  [READER + "https://example.com/", () => reply("Example Domain\nThis domain is for use in documentation examples.")],
  // The three ordinary pages: one opens, one turns the bot and the free reader away, one is an empty shell.
  ["https://en.wikipedia.org/wiki/Cloudflare", () => reply(LONG_PAGE, HTML)],
  ["https://www.bbc.com/news", () => reply("forbidden", { status: 403 })],
  [READER + "https://www.bbc.com/news", () => reply("slow down", { status: 429 })],
  ["https://developers.cloudflare.com/workers/platform/limits/", () => reply("<html><body><p>Please enable JavaScript.</p></body></html>", HTML)],
  ["https://en.wikipedia.org/w/api.php", () => reply({ query: { search: [{ title: "Cloudflare", snippet: "An <b>American</b> company" }] } })],
  ["https://www.bing.com/search?format=rss", () => reply(BING_FEED, { headers: { "Content-Type": "text/xml; charset=utf-8" } })],
  ["https://example.com/", () => reply(EXAMPLE_PAGE, HTML)],
  [PAGES + "/news/news.json", () => reply({ stories: [{ id: "a" }, { id: "b" }, { id: "c" }] })],
  [PAGES + "/spark/spark.json", () => reply(SPARK_META_TEXT)],
  [PAGES + "/spark/" + SPARK_META.weights.file, () => reply(SPARK_WEIGHTS)],
];

function pretendWorkersAi() {
  return fakeAi(
    {
      "@cf/openai/gpt-oss-120b": {
        output: [
          { type: "reasoning", content: [{ type: "reasoning_text", text: "One word is wanted." }] },
          { type: "message", content: [{ type: "output_text", text: "pong" }] },
        ],
      },
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { response: "pong", usage: { total_tokens: 12 } },
      "@cf/qwen/qwen3-30b-a3b-fp8": { choices: [{ message: { content: "pong", reasoning_content: "One word." } }] },
      // Refuses the chat form and only answers the newer one: the check must find that out.
      "@cf/openai/gpt-oss-20b": (inputs) => {
        if (inputs.messages) throw new Error("5006: Error: oneOf at '/' not met");
        return { output_text: "pong" };
      },
    },
    [
      { id: "1", name: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", task: { name: "Text Generation" } },
      { id: "2", name: "@cf/baai/bge-m3", task: { name: "Text Embeddings" } },
      { id: "3", name: "@cf/openai/gpt-oss-120b", task: { name: "Text Generation" } },
    ],
  );
}

test("the health check runs in the alarm and reports every model and every route", async () => {
  const ai = pretendWorkersAi();
  const { call, env, now, send } = await setUp({ routes: PRETEND_INTERNET, ai });
  assert.deepEqual((await call("/v1/probe")).body, { running: true, result: null });
  assert.equal(send.calls.length, 0, "nothing is fetched while the request is being answered");

  now.advance(1200);
  assert.equal(await env.CHAT.runAlarms(), 1);
  const { running, result } = (await call("/v1/probe")).body;
  assert.equal(running, false);
  assert.equal(result.version, VERSION);
  assert.equal(result.build, "build-one");
  assert.deepEqual(result.alarm, { delayMs: 1200 });
  assert.equal(result.at, now());

  const byId = (rows) => Object.fromEntries(rows.map((row) => [row.id, row]));
  const providers = byId(result.providers);
  assert.deepEqual(Object.keys(providers), KEYLESS.map((entry) => entry.id));
  assert.deepEqual(providers.ovh, { id: "ovh", model: provider.ovh.model, ok: true, status: 200, ms: 0, sample: "pong", error: "" });
  assert.equal(providers["ovh-gpt-oss"].ok, true);
  assert.equal(providers["ovh-mistral"].ok, true);
  assert.equal(providers["ovh-qwen"].ok, false);
  assert.equal(providers["ovh-qwen"].status, 429);
  assert.match(providers["ovh-qwen"].error, /^HTTP 429 .*Retry after 30 s/);
  assert.equal(providers.llm7.sample, "Pong!", "thinking is not part of the answer");
  assert.equal(providers.pollinations, undefined, "Pollinations asks for payment from Cloudflare, so it is not asked");

  const models = byId(result.ai);
  assert.deepEqual(Object.keys(models), AI_MODELS.map((entry) => entry.id));
  assert.deepEqual([models["ai-gpt-oss-120b"].ok, models["ai-gpt-oss-120b"].shape, models["ai-gpt-oss-120b"].field], [true, "messages", "output"]);
  assert.deepEqual([models["ai-llama-70b"].ok, models["ai-llama-70b"].field], [true, "response"]);
  assert.deepEqual([models["ai-qwen3-30b"].ok, models["ai-qwen3-30b"].field], [true, "choices"]);
  assert.deepEqual([models["ai-gpt-oss-20b"].ok, models["ai-gpt-oss-20b"].shape, models["ai-gpt-oss-20b"].field], [true, "responses", "output_text"]);
  assert.equal(models["ai-gemma-3-12b"], undefined, "Gemma refused the chat form in the live check, so it is not on the list");
  assert.equal(models["ai-llama-8b"].ok, false);
  assert.match(models["ai-llama-8b"].error, /^messages: 5007: No such model/);
  assert.deepEqual(result.aiModelList, {
    total: 3,
    textGeneration: ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/openai/gpt-oss-120b"],
  });

  const web = byId(result.web);
  assert.deepEqual(Object.keys(web), ["search:bing-rss", "search:wikipedia", "read:direct", "read:jina"]);
  assert.deepEqual(
    [web["search:bing-rss"].ok, web["search:bing-rss"].detail],
    [true, "2 results; first: Limits · Cloudflare Workers docs"],
  );
  assert.deepEqual([web["search:wikipedia"].ok, web["search:wikipedia"].detail], [true, "1 results; first: Cloudflare"]);
  assert.equal(web["read:jina"].ok, true);
  assert.deepEqual(
    [web["read:direct"].ok, web["read:direct"].detail],
    [true, `${"Example Domain\n\nThis domain is for use in documentation examples without needing permission.".length} characters`],
    "the page's name is only in its title, and the reader keeps the title",
  );

  // Three ordinary pages, read the way the researcher reads them.
  assert.equal(result.reach, undefined, "the temporary search-service survey is gone");
  const longText = "Cloudflare - Wikipedia\n\n" + "Cloudflare is a company that runs a large network. ".repeat(12).trim();
  assert.deepEqual(result.pages, [
    { url: "https://en.wikipedia.org/wiki/Cloudflare", ok: true, via: "direct", chars: longText.length, ms: 0, error: "" },
    {
      url: "https://www.bbc.com/news",
      ok: false,
      via: "",
      chars: 0,
      ms: 0,
      error: "Could not read https://www.bbc.com/news (direct: HTTP 403; jina: HTTP 429)",
    },
    {
      url: "https://developers.cloudflare.com/workers/platform/limits/",
      ok: false,
      via: "direct",
      chars: "Please enable JavaScript.".length,
      ms: 0,
      error: "too little text: Please enable JavaScript.",
    },
  ]);
  assert.ok(longText.length >= 400, "the page that counts as read really has a page's worth of text");

  assert.deepEqual(result.news, { ok: true, stories: 3, error: "" });
  assert.equal(result.spark.ok, true, result.spark.error);
  assert.equal(result.spark.parameters, SPARK_META.parameters);
  assert.ok(result.spark.tokens >= 40 && result.spark.sample.length > 10);

  // Cloudflare's free plan allows 50 fetches per run; the check must stay far below that.
  // 5 keyless models, 2 searches, 2 reads of the test page, 1 news, 2 GlowSpark files, and 4 for the three
  // ordinary pages (the refused one is tried twice).
  assert.equal(send.calls.length, 16);
  assert.ok(ai.calls.length <= 2 * AI_MODELS.length);
});

test("without the AI binding the check still runs, on the keyless models alone", async () => {
  const { call, env } = await setUp({ routes: PRETEND_INTERNET });
  await call("/v1/probe");
  await env.CHAT.runAlarms();
  const { result } = (await call("/v1/probe")).body;
  assert.deepEqual(result.ai, []);
  assert.equal(result.aiModelList, null);
  assert.equal(result.providers.filter((row) => row.ok).length, 4);
});

// ---- the bot itself: setup, Telegram's webhook, the simulator and the self-test ----

const TOKEN = "123456789:" + "A".repeat(35);
const ADMIN = { "X-Glow-Setup-Code": SETUP_CODE };
const OWNER_CHAT = { id: 9001, type: "private" };
const BOT_NAME = { username: "glow_test_bot", name: "Glow" };
const PLAN_PROMPT = /^You are GlowLead, the lead of a team/;
const TWO_STEP_PLAN = JSON.stringify({
  summary: "Decide the tone, then write it.",
  criteria: ["Friendly tone", "Under 80 words"],
  steps: [
    { worker: "council", title: "Decide the tone", task: "Decide which tone fits a small bakery." },
    { worker: "chat", title: "Write the message", task: "Write the welcome message." },
  ],
});

function jsonPost(body, headers = {}) {
  return { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) };
}

// One text message, the way Telegram delivers it to the webhook.
function message(updateId, text, chat = OWNER_CHAT) {
  return {
    update_id: updateId,
    message: {
      message_id: 10 + updateId,
      date: 0,
      chat,
      from: { id: chat.id, first_name: "Juwen", language_code: "en" },
      text,
    },
  };
}

// A pretend Telegram. It writes down every call and answers the way the real one does;
// `special` may answer a call differently (return nothing to get the usual answer).
function pretendTelegram(special = () => null) {
  const asked = [];
  const address = `https://api.telegram.org/bot${TOKEN}/`;
  const answer = (url, init) => {
    const method = url.split("/").pop();
    let payload = null;
    try {
      payload = JSON.parse(init.body);
    } catch (error) {
      // a form upload (the profile photo)
    }
    asked.push({ method, payload });
    const different = special(method, payload);
    if (different) return different;
    if (method === "getMe") {
      return reply({ ok: true, result: { id: 777, is_bot: true, first_name: "Glow", username: "glow_test_bot" } });
    }
    if (method === "sendMessage") return reply({ ok: true, result: { message_id: 100 + asked.length } });
    return reply({ ok: true, result: true });
  };
  return { asked, route: [address, answer] };
}

// A Worker whose owner has already pasted the bot's token into the setup page.
async function setUpBot(options = {}) {
  const telegram = pretendTelegram(options.telegram);
  const picture = [PAGES + "/bot/logo.jpg", () => new Response(new Uint8Array([1, 2, 3]))];
  const kit = await setUp({ ...options, routes: [telegram.route, picture, ...(options.routes || [])] });
  const setup = (await kit.call("/setup", jsonPost({ code: SETUP_CODE, token: TOKEN }))).body;
  const setupCalls = telegram.asked.splice(0);
  return {
    ...kit,
    asked: telegram.asked,
    setup,
    setupCalls,
    claim: new URL(setup.link).searchParams.get("start"),
    hook: { "X-Telegram-Bot-Api-Secret-Token": await sha256Hex("glow-bot-webhook:" + TOKEN) },
  };
}

// Everything the Worker wrote to its log while `work` ran.
async function logWhile(work) {
  const lines = [];
  const realLog = console.log;
  console.log = (...parts) => lines.push(parts.join(" "));
  try {
    await work();
  } finally {
    console.log = realLog;
  }
  return lines.join("\n");
}

// A stand-in for the real self-test that only counts how often it ran.
function countingSelfTest(outcome = { ok: true }) {
  const selftest = async (options) => {
    selftest.runs += 1;
    selftest.info = options.info;
    if (outcome instanceof Error) throw outcome;
    return { kind: "logic", note: "a stand-in", checks: [], ...outcome };
  };
  selftest.runs = 0;
  selftest.info = null;
  return selftest;
}

test("setting the bot up needs the owner's setup code", async () => {
  const telegram = pretendTelegram();
  const { call, env } = await setUp({ routes: [telegram.route] });
  const attempts = [
    jsonPost({ code: "a wrong guess", token: TOKEN }),
    jsonPost({ token: TOKEN }),
    jsonPost({ token: TOKEN }, { "X-Glow-Setup-Code": SETUP_CODE + "x" }),
    { method: "POST" },
    { method: "POST", body: "not json" },
  ];
  for (const init of attempts) {
    const refused = await call("/setup", init);
    assert.equal(refused.status, 403);
    assert.deepEqual(refused.body, { ok: false, error: "setup-code" });
  }
  assert.equal(env.REGISTRY.objects.size, 0, "the settings store was not even asked");
  assert.deepEqual(telegram.asked, []);
  assert.equal((await call("/setup")).status, 404, "the setup page posts; there is nothing to read here");
});

test("a token that does not look like one never reaches Telegram", async () => {
  const telegram = pretendTelegram();
  const { call } = await setUp({ routes: [telegram.route] });
  for (const token of ["not-a-token", "", undefined, 12345, "123:short"]) {
    const refused = await call("/setup", jsonPost({ code: SETUP_CODE, token }));
    assert.equal(refused.status, 400, String(token));
    assert.deepEqual(refused.body, { ok: false, error: "token-format" });
  }
  // The code may travel in the header instead, the way the owner's other calls send it.
  const viaHeader = await call("/setup", jsonPost({ token: "nope" }, ADMIN));
  assert.deepEqual([viaHeader.status, viaHeader.body], [400, { ok: false, error: "token-format" }]);
  assert.deepEqual(telegram.asked, []);
});

test("a token Telegram does not know is refused, and the bot stays switched off", async () => {
  const telegram = pretendTelegram((method) =>
    method === "getMe" ? reply({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 }) : null,
  );
  const { call } = await setUp({ routes: [telegram.route] });
  const refused = await call("/setup", jsonPost({ code: SETUP_CODE, token: TOKEN }));
  assert.equal(refused.status, 400);
  assert.deepEqual(refused.body, { ok: false, error: "token-rejected", detail: "Unauthorized" });
  assert.deepEqual(telegram.asked.map((entry) => entry.method), ["getMe"]);
  const status = (await call("/v1/status")).body;
  assert.deepEqual([status.configured, status.bot], [false, null]);
});

test("when Telegram will not take the webhook, the bot stays switched off", async () => {
  const telegram = pretendTelegram((method) =>
    method === "setWebhook" ? reply({ ok: false, error_code: 400, description: "Bad Request: bad webhook" }, { status: 400 }) : null,
  );
  const { call } = await setUp({ routes: [telegram.route] });
  const refused = await call("/setup", jsonPost({ code: SETUP_CODE, token: TOKEN }));
  assert.equal(refused.status, 400);
  assert.deepEqual(refused.body, { ok: false, error: "webhook-failed", detail: "Bad Request: bad webhook" });
  assert.deepEqual(telegram.asked.map((entry) => entry.method), ["getMe", "setWebhook"]);
  assert.equal((await call("/v1/status")).body.configured, false);
});

test("setup connects the bot to Telegram and hands back the owner's link", async () => {
  const { call, setup, setupCalls, hook } = await setUpBot();
  assert.deepEqual(setup, { ok: true, bot: BOT_NAME, link: setup.link, claimed: false, warnings: [] });
  assert.match(setup.link, /^https:\/\/t\.me\/glow_test_bot\?start=[0-9a-f]{32}$/);

  // Telegram is told where to send messages, then the bot gets its menu, texts and picture.
  const dressing = ["setMyCommands", "setMyDescription", "setMyShortDescription"];
  assert.deepEqual(
    setupCalls.map((entry) => entry.method),
    ["getMe", "setWebhook", ...dressing, ...dressing, ...dressing, "setMyProfilePhoto"],
  );
  assert.deepEqual(setupCalls[1].payload, {
    url: "https://glow-bot.test/telegram/webhook",
    secret_token: hook["X-Telegram-Bot-Api-Secret-Token"],
    allowed_updates: ["message", "callback_query", "my_chat_member"],
    drop_pending_updates: true,
  });
  assert.deepEqual(
    setupCalls.filter((entry) => entry.method === "setMyCommands").map((entry) => entry.payload.language_code),
    [undefined, "id", "zh"],
    "the menu is set for everyone first, then for Indonesian and Chinese phones",
  );

  const status = (await call("/v1/status")).body;
  assert.deepEqual([status.configured, status.bot, status.claimed], [true, BOT_NAME, false]);
  assert.ok(!JSON.stringify([setup, status]).includes(TOKEN), "the token never comes back out");
});

test("setting the same bot up again keeps its owner", async () => {
  const { call, claim, hook } = await setUpBot();
  await call("/telegram/webhook", jsonPost(message(1, "/start " + claim), hook));
  const again = await call("/setup", jsonPost({ code: SETUP_CODE, token: TOKEN }));
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { ok: true, bot: BOT_NAME, link: "https://t.me/glow_test_bot", claimed: true, warnings: [] });
});

test("the webhook answers only to the secret Telegram was given", async () => {
  const { call, env } = await setUp();
  const bare = await call("/telegram/webhook", jsonPost(message(1, "/help")));
  assert.equal(bare.status, 403);
  assert.deepEqual(bare.body, { ok: false, error: "refused" });
  assert.equal(env.REGISTRY.objects.size, 0, "a call without the secret is turned away at the door");

  // Before any setup there is no secret to match, whatever the caller sends.
  const guess = await call("/telegram/webhook", jsonPost(message(1, "/help"), { "X-Telegram-Bot-Api-Secret-Token": "made-up" }));
  assert.equal(guess.status, 403);
  assert.deepEqual(guess.body, { ok: false, error: "refused" });
  assert.equal(env.CHAT.objects.size, 0);
  assert.equal((await call("/telegram/webhook")).status, 404);
});

test("a wrong secret or a broken body starts nothing", async () => {
  const { call, env, asked, hook } = await setUpBot();
  const wrong = await call("/telegram/webhook", jsonPost(message(1, "/help"), { "X-Telegram-Bot-Api-Secret-Token": "made-up" }));
  assert.equal(wrong.status, 403);
  assert.deepEqual(wrong.body, { ok: false, error: "refused" });

  for (const body of ["not json", "[1, 2]", '"text"', "null"]) {
    const broken = await call("/telegram/webhook", { method: "POST", headers: hook, body });
    assert.equal(broken.status, 400, body);
    assert.deepEqual(broken.body, { ok: false, error: "bad request" });
  }
  assert.equal(env.CHAT.objects.size, 0);
  assert.deepEqual(asked, []);
  assert.equal((await call("/v1/status")).body.claimed, false);
});

test("the owner's link makes the first chat the owner, once", async () => {
  const { call, env, asked, claim, hook } = await setUpBot();
  const start = jsonPost(message(1, "/start " + claim), hook);
  const first = await call("/telegram/webhook", start);
  assert.deepEqual([first.status, first.body], [200, { ok: true }]);
  assert.deepEqual([...env.CHAT.objects.keys()], ["tg:9001"]);
  assert.deepEqual(asked.map((entry) => entry.method), ["sendMessage", "sendMessage"]);
  assert.equal(asked[0].payload.chat_id, 9001);
  assert.match(asked[0].payload.text, /You are now this bot's owner/);
  assert.equal((await call("/v1/status")).body.claimed, true);

  // Telegram sends an update again when the answer was slow; the second copy does nothing.
  asked.length = 0;
  const repeat = await call("/telegram/webhook", start);
  assert.deepEqual([repeat.status, repeat.body], [200, { ok: true }]);
  // An edited message is a kind of update the bot does not act on.
  const edited = { update_id: 50, edited_message: { message_id: 1, chat: OWNER_CHAT, text: "x" } };
  const ignored = await call("/telegram/webhook", jsonPost(edited, hook));
  assert.deepEqual([ignored.status, ignored.body], [200, { ok: true }]);
  assert.deepEqual(asked, []);
});

test("a stranger is told once that the bot is private, then nothing", async () => {
  const { call, env, asked, claim, hook } = await setUpBot();
  await call("/telegram/webhook", jsonPost(message(1, "/start " + claim), hook));
  asked.length = 0;

  const stranger = { id: 5555, type: "private" };
  const hello = await call("/telegram/webhook", jsonPost(message(2, "hello there", stranger), hook));
  assert.deepEqual([hello.status, hello.body], [200, { ok: true }]);
  assert.deepEqual([...env.CHAT.objects.keys()], ["tg:9001", "tg:5555"]);
  assert.deepEqual(asked.map((entry) => entry.method), ["sendMessage"]);
  assert.equal(asked[0].payload.chat_id, 5555);
  assert.equal(asked[0].payload.text, "🔒 This bot is private. Only its owner can let this chat in.");

  asked.length = 0;
  await call("/telegram/webhook", jsonPost(message(3, "hello again", stranger), hook));
  assert.deepEqual(asked, [], "one notice is enough");
});

test("a goal sent in Telegram is planned in the chat's own alarm, not while Telegram waits", async () => {
  const model = (url, init) => {
    const system = JSON.parse(init.body).messages[0].content;
    return PLAN_PROMPT.test(system) ? reply(completion(TWO_STEP_PLAN)) : reply({ error: "no scripted answer" }, { status: 500 });
  };
  const { call, env, now, send, asked, claim, hook } = await setUpBot({ routes: [[provider.ovh.url, model]] });
  await call("/telegram/webhook", jsonPost(message(1, "/start " + claim), hook));
  asked.length = 0;
  const buttons = (payload) => payload.reply_markup.inline_keyboard.map((row) => row.map((button) => button.callback_data));

  const goal = await call("/telegram/webhook", jsonPost(message(2, "Write a welcome message for a small bakery."), hook));
  assert.deepEqual([goal.status, goal.body], [200, { ok: true }]);
  // Telegram waits for this answer, so the webhook only says "planning…" and sets the alarm.
  const { storage } = env.CHAT.object("tg:9001");
  assert.equal(storage.alarmAt, now());
  assert.equal(send.count(provider.ovh.url), 0, "no model was asked yet");
  assert.deepEqual(asked.map((entry) => entry.method), ["sendMessage"]);
  assert.equal(asked[0].payload.text, "👑 GlowLead is planning…");
  assert.equal(asked[0].payload.disable_notification, true);
  assert.deepEqual(buttons(asked[0].payload), [["stp:1"]]);

  // The alarm asks the model for a plan, posts it with its buttons and removes the "planning…" line.
  assert.equal(await env.CHAT.runAlarms(), 1);
  assert.deepEqual(asked.map((entry) => entry.method), ["sendMessage", "sendChatAction", "sendMessage", "deleteMessage"]);
  assert.match(asked[2].payload.text, /^👑 <b>GlowLead's plan<\/b>\nDecide the tone, then write it\./);
  assert.deepEqual(buttons(asked[2].payload), [["run:1", "chg:1", "can:1"]]);
  assert.deepEqual(asked[3].payload, { chat_id: 9001, message_id: 101 });
  assert.equal(send.count(provider.ovh.url), 1);
  assert.equal(storage.alarmAt, null, "a plan with more than one step waits for the owner's tap");
});

test("a chat that breaks does not make Telegram send the message again", async () => {
  const { call, env, claim, hook } = await setUpBot();
  await call("/telegram/webhook", jsonPost(message(1, "/start " + claim), hook));
  env.CHAT.object("tg:9001").instance.chat = () => {
    throw new Error("the chat fell over");
  };
  let answer;
  const log = await logWhile(async () => {
    answer = await call("/telegram/webhook", jsonPost(message(7, "/help"), hook));
  });
  // The update is already marked as seen, so a repeat would be dropped anyway; the log keeps the reason.
  assert.deepEqual([answer.status, answer.body], [200, { ok: true }]);
  assert.equal(log, "update 7 failed: the chat fell over");
});

test("when the settings store is down, Telegram is asked to send the message again", async () => {
  const { call, env, asked, claim, hook } = await setUpBot();
  const store = env.REGISTRY.object("registry").instance;
  store.fetch = async () => {
    throw new Error("the settings store is down");
  };
  const start = jsonPost(message(1, "/start " + claim), hook);
  const failed = await call("/telegram/webhook", start);
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { ok: false, error: "the settings store is down" });
  assert.equal(env.CHAT.objects.size, 0);

  // Telegram repeats an update that got an error. Nothing was marked as seen, so this one arrives.
  delete store.fetch;
  const retried = await call("/telegram/webhook", start);
  assert.deepEqual([retried.status, retried.body], [200, { ok: true }]);
  assert.deepEqual(asked.map((entry) => entry.method), ["sendMessage", "sendMessage"]);
});

test("the self-test runs once for each build, and its answer is kept", async () => {
  const selftest = countingSelfTest();
  const { call, env, now } = await setUp({ selftest });
  const first = await call("/v1/selftest", { headers: { Origin: ORIGIN } });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, {
    running: false,
    result: { kind: "logic", note: "a stand-in", checks: [], ok: true, at: now(), ms: 0, version: VERSION, build: "build-one" },
  });
  assert.equal(first.headers.get("Access-Control-Allow-Origin"), ORIGIN, "the Glow page may read it");
  assert.deepEqual(selftest.info, { pages: PAGES, version: VERSION, build: "build-one" });
  assert.deepEqual([...env.CHAT.objects.keys()], ["sys:selftest"]);

  // The bot's own code only changes with a deployment, so the answer is good until then.
  now.advance(30 * 24 * HOUR);
  assert.deepEqual((await call("/v1/selftest")).body, first.body);
  assert.equal(selftest.runs, 1);

  env.BUILD = "build-two";
  assert.equal((await call("/v1/selftest")).body.result.build, "build-two");
  assert.equal(selftest.runs, 2);
});

test("a failed self-test is tried again a minute later, not on every visit", async () => {
  const selftest = countingSelfTest({ ok: false });
  const { call, now } = await setUp({ selftest });
  assert.equal((await call("/v1/selftest")).body.result.ok, false);
  now.advance(MINUTE - 1);
  assert.equal((await call("/v1/selftest")).body.result.ok, false);
  assert.equal(selftest.runs, 1);
  now.advance(1);
  await call("/v1/selftest");
  assert.equal(selftest.runs, 2);
});

test("only the owner can make the self-test run again on demand", async () => {
  const selftest = countingSelfTest();
  const { call } = await setUp({ selftest });
  await call("/v1/selftest");
  for (const headers of [{}, { "X-Glow-Setup-Code": "a wrong guess" }]) {
    const refused = await call("/v1/selftest?fresh=1", { headers });
    assert.equal(refused.status, 403);
    assert.deepEqual(refused.body, { ok: false, error: "A fresh check needs the setup code." });
  }
  assert.equal(selftest.runs, 1);
  assert.equal((await call("/v1/selftest?fresh=1", { headers: ADMIN })).status, 200);
  assert.equal(selftest.runs, 2);
});

test("a self-test that itself breaks is reported as a failed one", async () => {
  const clock = {};
  const broken = async () => {
    clock.now.advance(40);
    throw new Error("the self-test itself broke");
  };
  const { call, now } = await setUp({ selftest: broken });
  clock.now = now;
  assert.deepEqual((await call("/v1/selftest")).body, {
    running: false,
    result: {
      ok: false,
      kind: "logic",
      note: SELFTEST_NOTE,
      checks: [],
      error: "the self-test itself broke",
      at: now(),
      ms: 40,
      version: VERSION,
      build: "build-one",
    },
  });
});

test("the real self-test passes, and touches neither the network nor the bot's settings", async () => {
  const { call, env, send } = await setUp();
  const { running, result } = (await call("/v1/selftest")).body;
  assert.equal(running, false);
  assert.equal(result.ok, true, JSON.stringify(result.checks.filter((check) => !check.ok)));
  assert.deepEqual(result.checks.map((check) => check.name), ["mission", "room", "chat", "agent", "stop", "languages"]);
  assert.equal(result.kind, "logic");
  assert.equal(result.note, SELFTEST_NOTE);
  assert.equal(send.calls.length, 0);
  assert.equal(env.REGISTRY.objects.size, 0);
});

test("the simulator is the owner's alone", async () => {
  const { call, env } = await setUp({ uuid: () => "sim-fixed-0001" });
  const attempts = [
    ["/admin/simulate", jsonPost({ text: "/help" })],
    ["/admin/simulate", jsonPost({ text: "/help" }, { "X-Glow-Setup-Code": "a wrong guess" })],
    ["/admin/simulate?id=sim-fixed-0001", {}],
    ["/admin/simulate?id=sim-fixed-0001", { method: "DELETE" }],
  ];
  for (const [path, init] of attempts) {
    const refused = await call(path, init);
    assert.equal(refused.status, 403, `${init.method || "GET"} ${path}`);
    assert.deepEqual(refused.body, { ok: false, error: "setup-code" });
  }
  assert.equal(env.CHAT.objects.size, 0);
});

test("a simulated chat answers like a real one, and nothing leaves the Worker", async () => {
  const { call, env, now, send } = await setUp({ uuid: () => "sim-fixed-0001" });
  const made = await call("/admin/simulate", jsonPost({ text: "/stop" }, ADMIN));
  assert.equal(made.status, 200);
  assert.deepEqual(made.body, { id: "sim-fixed-0001", ok: true, last: 2 });
  assert.ok(env.CHAT.objects.has("sim:sim-fixed-0001"));

  // The transcript holds what came in and every call the bot would have made to Telegram.
  const stopReply = {
    n: 2,
    at: now(),
    method: "sendMessage",
    payload: { chat_id: 4242, text: "Nothing is running.", parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    messageId: 2,
  };
  const told = await call("/admin/simulate?id=sim-fixed-0001", { headers: ADMIN });
  assert.equal(told.status, 200);
  assert.deepEqual(told.body, {
    id: "sim-fixed-0001",
    ok: true,
    calls: [{ n: 1, at: now(), method: "incoming", payload: { text: "/stop", message_id: 1 } }, stopReply],
    last: 2,
    alarm: now() + 30 * MINUTE, // a pretend chat tidies itself away after half an hour
    mode: "lead",
    lang: "en",
    job: null,
    done: null,
    outbox: 0,
  });
  const newer = (await call("/admin/simulate?id=sim-fixed-0001&since=1", { headers: ADMIN })).body;
  assert.deepEqual(newer.calls, [stopReply], "a page that is watching asks only for what is new");

  // The caller may name the chat; a name that would not be safe in an address is replaced.
  const named = await call("/admin/simulate", jsonPost({ text: "/stop", id: "my-own-chat-1" }, ADMIN));
  assert.equal(named.body.id, "my-own-chat-1");
  const unsafe = await call("/admin/simulate", jsonPost({ text: "/stop", id: "Not A Name" }, ADMIN));
  assert.equal(unsafe.body.id, "sim-fixed-0001");
  assert.deepEqual([...env.CHAT.objects.keys()].sort(), ["sim:my-own-chat-1", "sim:sim-fixed-0001"]);
  assert.equal(send.calls.length, 0);
});

test("a simulated chat can be wiped, and a request that makes no sense is refused", async () => {
  const { call } = await setUp({ uuid: () => "sim-fixed-0001" });
  await call("/admin/simulate", jsonPost({ text: "/stop" }, ADMIN));
  const wiped = await call("/admin/simulate?id=sim-fixed-0001", { method: "DELETE", headers: ADMIN });
  assert.deepEqual([wiped.status, wiped.body], [200, { id: "sim-fixed-0001", ok: true }]);
  const empty = (await call("/admin/simulate?id=sim-fixed-0001", { headers: ADMIN })).body;
  assert.deepEqual([empty.calls, empty.last, empty.alarm, empty.lang], [[], 0, null, null]);

  for (const method of ["GET", "DELETE"]) {
    for (const query of ["", "?id=bad", "?id=Sim-Fixed-0001"]) {
      const refused = await call("/admin/simulate" + query, { method, headers: ADMIN });
      assert.equal(refused.status, 400, `${method} ${query}`);
      assert.deepEqual(refused.body, { ok: false, error: "id" });
    }
  }
  const noJson = await call("/admin/simulate", { method: "POST", headers: ADMIN, body: "not json" });
  assert.deepEqual([noJson.status, noJson.body], [400, { ok: false, error: "bad request" }]);
  assert.equal((await call("/admin/simulate", { method: "PUT", headers: ADMIN })).status, 404);
});

test("the owner can disconnect the bot from Telegram", async () => {
  const { call, asked, hook } = await setUpBot();
  for (const headers of [{}, { "X-Glow-Setup-Code": "a wrong guess" }]) {
    const refused = await call("/admin/reset", { method: "POST", headers });
    assert.equal(refused.status, 403);
    assert.deepEqual(refused.body, { ok: false, error: "setup-code" });
  }
  assert.equal((await call("/v1/status")).body.configured, true);
  assert.deepEqual(asked, []);

  const reset = await call("/admin/reset", { method: "POST", headers: ADMIN });
  assert.deepEqual([reset.status, reset.body], [200, { ok: true, webhook: "deleted" }]);
  assert.deepEqual(asked.map((entry) => entry.method), ["deleteWebhook"]);
  const status = (await call("/v1/status")).body;
  assert.deepEqual([status.configured, status.bot, status.claimed], [false, null, false]);

  // The old secret opens nothing any more.
  const late = await call("/telegram/webhook", jsonPost(message(60, "/help"), hook));
  assert.deepEqual([late.status, late.body], [403, { ok: false, error: "refused" }]);
  assert.equal((await call("/admin/reset", { headers: ADMIN })).status, 404);
});

test("a chat's alarm that breaks is written to the log, and the alarm itself does not fail", async () => {
  const { env } = await setUp();
  const agent = env.CHAT.object("tg:9001").instance;
  agent.chat = () => ({
    tick: async () => {
      throw new Error("the step broke");
    },
  });
  // Cloudflare runs a failed alarm again and again; the chat's own watchdog is what restarts a stuck job.
  const log = await logWhile(() => agent.alarm());
  assert.equal(log, "chat alarm failed: the step broke");
});
