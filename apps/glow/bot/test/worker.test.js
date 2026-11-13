import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as entry from "../src/index.js";
import { AI_MODELS, KEYLESS } from "../src/models.js";
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
  const overrides = { fetch: send, now };
  if (options.probe) overrides.probe = options.probe;
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
    stage: "telegram",
    configured: false,
    bot: null,
    paired: false,
    access: "private",
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
  const registry = await env.REGISTRY.get(env.REGISTRY.idFromName("registry")).fetch("https://glow-bot.internal/gate");
  assert.equal(registry.status, 404, "the settings store answers nothing yet");
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

function resultsPage(count) {
  let page = "";
  for (let number = 1; number <= count; number++) {
    page += `## [Result number ${number} about the free plan](https://site${number}.example/page)\nSnippet ${number}.\n\n`;
  }
  return page;
}

function duckResult(title, link) {
  const href = "//duckduckgo.com/l/?uddg=" + encodeURIComponent(link) + "&amp;rut=abc";
  return `<div class="result"><a rel="nofollow" class="result__a" href="${href}">${title}</a></div>\n`;
}

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
  [provider.pollinations.url, () => reply("bad gateway", { status: 502 })],
  [READER + "https://lite.duckduckgo.com/", () => reply(resultsPage(3))],
  [READER + "https://www.bing.com/", () => reply("forbidden", { status: 403 })],
  [READER + "https://html.duckduckgo.com/", () => reply("nothing that looks like a result")],
  [READER + "https://example.com/", () => reply("Example Domain\nThis domain is for use in documentation examples.")],
  ["https://html.duckduckgo.com/html/", () => reply(duckResult("Workers limits explained", "https://one.example/") + duckResult("Free plan in detail", "https://two.example/"), HTML)],
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
      "@cf/google/gemma-3-12b-it": { response: "" },
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
  assert.deepEqual(
    [providers.pollinations.ok, providers.pollinations.status, providers.pollinations.error],
    [false, 502, "HTTP 502 bad gateway"],
  );

  const models = byId(result.ai);
  assert.deepEqual(Object.keys(models), AI_MODELS.map((entry) => entry.id));
  assert.deepEqual([models["ai-gpt-oss-120b"].ok, models["ai-gpt-oss-120b"].shape, models["ai-gpt-oss-120b"].field], [true, "messages", "output"]);
  assert.deepEqual([models["ai-llama-70b"].ok, models["ai-llama-70b"].field], [true, "response"]);
  assert.deepEqual([models["ai-qwen3-30b"].ok, models["ai-qwen3-30b"].field], [true, "choices"]);
  assert.deepEqual([models["ai-gpt-oss-20b"].ok, models["ai-gpt-oss-20b"].shape, models["ai-gpt-oss-20b"].field], [true, "responses", "output_text"]);
  assert.equal(models["ai-gemma-3-12b"].ok, false);
  assert.equal(models["ai-gemma-3-12b"].error, "messages: empty reply (fields: response) | responses: empty reply (fields: response)");
  assert.equal(models["ai-llama-8b"].ok, false);
  assert.match(models["ai-llama-8b"].error, /^messages: 5007: No such model/);
  assert.deepEqual(result.aiModelList, {
    total: 3,
    textGeneration: ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/openai/gpt-oss-120b"],
  });

  const web = byId(result.web);
  assert.deepEqual(Object.keys(web), [
    "search:jina:lite.duckduckgo.com",
    "search:jina:www.bing.com",
    "search:jina:html.duckduckgo.com",
    "search:duckduckgo-direct",
    "search:bing-rss",
    "search:wikipedia",
    "read:jina",
    "read:direct",
  ]);
  assert.deepEqual(web["search:jina:lite.duckduckgo.com"], {
    id: "search:jina:lite.duckduckgo.com",
    ok: true,
    status: 200,
    ms: 0,
    detail: "3 results; first: Result number 1 about the free plan",
  });
  assert.deepEqual([web["search:jina:www.bing.com"].ok, web["search:jina:www.bing.com"].status], [false, 403]);
  assert.deepEqual([web["search:jina:html.duckduckgo.com"].ok, web["search:jina:html.duckduckgo.com"].detail], [false, "0 results"]);
  assert.equal(web["search:duckduckgo-direct"].ok, true);
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

  // The temporary reach rows: one per candidate search service, whether or not it answered.
  assert.deepEqual(
    result.reach.map((row) => row.id),
    [
      "bing-rss",
      "bing-news-rss",
      "bing-html",
      "brave",
      "duckduckgo-lite",
      "duckduckgo-post",
      "duckduckgo-instant",
      "mojeek",
      "qwant",
      "yep",
      "marginalia",
      "hn-algolia",
      "gdelt",
      "google-news-rss",
      "openalex",
    ],
  );
  const reach = byId(result.reach);
  assert.deepEqual(reach["bing-rss"], {
    id: "bing-rss",
    ok: true,
    status: 200,
    type: "text/xml; charset=utf-8",
    length: BING_FEED.length,
    ms: 0,
    marks: { items: 2, algo: 0, resultLinks: 0, snippets: 0, jsonUrls: 0, blocked: 0 },
    sample:
      "<item><title>Limits &#183; Cloudflare Workers docs</title><link>https://developers.cloudflare.com/workers/platform/limits/</link>" +
      "<description>The free plan allows 100,000 requests per day.</description></item>" +
      "<item><title>Workers pricing</title><link>https://example.org/pricing</link><description>Free, then paid.</description></item>" +
      "</channel></rss>",
    error: "",
  });
  assert.deepEqual([reach.brave.ok, reach.brave.status, reach.brave.error], [false, 599, ""], "a service that says no is reported, not hidden");
  assert.deepEqual([reach["duckduckgo-post"].ok, reach["duckduckgo-post"].marks.resultLinks], [true, 2]);
  const posted = send.calls.find((call) => call.method === "POST" && call.url === "https://html.duckduckgo.com/html/");
  assert.equal(posted.body, "q=Cloudflare%20Workers%20free%20plan%20limits");
  assert.match(posted.headers["User-Agent"], /GlowBot/, "the bot says who it is here too");

  assert.deepEqual(result.news, { ok: true, stories: 3, error: "" });
  assert.equal(result.spark.ok, true, result.spark.error);
  assert.equal(result.spark.parameters, SPARK_META.parameters);
  assert.ok(result.spark.tokens >= 40 && result.spark.sample.length > 10);

  // Cloudflare's free plan allows 50 fetches per run; the check must stay far below that.
  assert.equal(send.calls.length, 32);
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
