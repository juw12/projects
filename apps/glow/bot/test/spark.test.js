import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createSpark } from "../src/spark.js";
import { StoppedError } from "../src/util.js";
import { fakeFetch, makeClock, reply } from "./fakes.js";

// The real model, straight from the GlowSpark page's folder: the bot must run exactly what the page runs.
const FOLDER = new URL("../../web/spark/", import.meta.url);
const META_TEXT = readFileSync(new URL("spark.json", FOLDER), "utf8");
const META = JSON.parse(META_TEXT);
const WEIGHTS = new Uint8Array(readFileSync(new URL(META.weights.file, FOLDER)));
const BASE = "https://glow.test/spark";
const SENTENCE_END = /[.!?]["']?$/;

function site(overrides = {}) {
  return fakeFetch([
    [BASE + "/spark.json", overrides.meta || (() => reply(META_TEXT, { headers: { "Content-Type": "application/json" } }))],
    [BASE + "/" + META.weights.file, overrides.weights || (() => reply(WEIGHTS))],
  ]);
}

async function loaded() {
  const spark = createSpark({ fetch: site(), base: BASE, now: makeClock() });
  await spark.load();
  return spark;
}

test("the model is downloaded once, checked and made ready", async () => {
  const now = makeClock();
  const send = site({
    meta: () => {
      now.advance(120);
      return reply(META_TEXT);
    },
    weights: () => {
      now.advance(300);
      return reply(WEIGHTS);
    },
  });
  const spark = createSpark({ fetch: send, base: BASE + "/", now });
  assert.equal(spark.loaded(), false);
  assert.deepEqual(spark.info(), { loaded: false, parameters: 0, context: 0, downloadMs: 0, buildMs: 0 });

  const [first, second] = await Promise.all([spark.load(), spark.load()]);
  assert.deepEqual(first, {
    loaded: true,
    parameters: META.parameters,
    context: META.config.context,
    downloadMs: 420,
    buildMs: 0,
  });
  assert.deepEqual(second, first);
  assert.equal(spark.loaded(), true);
  assert.deepEqual(
    send.calls.map((call) => call.url),
    [BASE + "/spark.json", BASE + "/" + META.weights.file],
    "two loads at the same moment share one download",
  );

  await spark.load();
  assert.equal(send.calls.length, 2, "a loaded model is not downloaded again");
});

test("weights that changed on the way are refused, and a later good download works", async () => {
  let tamper = true;
  const send = site({
    weights: () => {
      if (!tamper) return reply(WEIGHTS);
      const changed = WEIGHTS.slice();
      changed[1000] ^= 1;
      return reply(changed);
    },
  });
  const spark = createSpark({ fetch: send, base: BASE, now: makeClock() });
  await assert.rejects(spark.load(), /weights do not match their checksum/);
  assert.equal(spark.loaded(), false);
  assert.throws(() => spark.write("Once upon a time"), /GlowSpark is not loaded yet/);

  tamper = false;
  assert.equal((await spark.load()).loaded, true);
});

test("a download that is cut short or missing says what went wrong", async () => {
  const short = createSpark({ fetch: site({ weights: () => reply(WEIGHTS.slice(0, 5000)) }), base: BASE });
  await assert.rejects(short.load(), /weights are incomplete/);

  const noMeta = createSpark({ fetch: site({ meta: () => reply("gone", { status: 404 }) }), base: BASE });
  await assert.rejects(noMeta.load(), /HTTP 404 for spark\.json/);

  const noWeights = createSpark({ fetch: site({ weights: () => reply("busy", { status: 503 }) }), base: BASE });
  await assert.rejects(noWeights.load(), new RegExp("HTTP 503 for " + META.weights.file.replace(".", "\\.")));
});

test("a stop request ends the download", async () => {
  const spark = createSpark({ fetch: site(), base: BASE });
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(spark.load(stop.signal), StoppedError);
  assert.equal(spark.loaded(), false);
  assert.equal((await spark.load()).loaded, true, "the next try starts again from nothing");
});

test("the same seed and opening give the same tale, another seed gives another", async () => {
  const spark = await loaded();
  const first = spark.write("Once upon a time", { maxTokens: 40, seed: 7 });
  const again = spark.write("Once upon a time", { maxTokens: 40, seed: 7 });
  const other = spark.write("Once upon a time", { maxTokens: 40, seed: 8 });
  assert.equal(first.seed, 7);
  assert.ok(first.text.trim().length > 20, "it wrote something: " + JSON.stringify(first.text));
  assert.equal(again.text, first.text);
  assert.equal(again.tokens, first.tokens);
  assert.notEqual(other.text, first.text);

  // A second copy of the model, built from the same files, writes the very same tale.
  const twin = await loaded();
  assert.equal(twin.write("Once upon a time", { maxTokens: 40, seed: 7 }).text, first.text);
});

test("a tale ends at the end of a sentence soon after the length asked for", async () => {
  const spark = await loaded();
  for (const seed of [1, 2, 3]) {
    const tale = spark.write("The little dog", { maxTokens: 30, seed });
    assert.ok(tale.tokens >= 30 && tale.tokens <= 90, `seed ${seed} wrote ${tale.tokens} tokens`);
    if (tale.tokens < 90) assert.match(tale.text, SENTENCE_END, `seed ${seed} stopped mid-sentence`);
  }
});

test("the length has a ceiling and the choices have sensible defaults", async () => {
  const spark = await loaded();
  const longest = spark.write("Once", { maxTokens: 100000, seed: 5 });
  assert.ok(longest.tokens >= 600 && longest.tokens <= 660, `wrote ${longest.tokens} tokens`);

  const unseeded = spark.write("Once upon a time", { maxTokens: 10 });
  assert.ok(Number.isInteger(unseeded.seed) && unseeded.seed >= 0 && unseeded.seed <= 4294967295);
  assert.equal(spark.write("Once upon a time", { maxTokens: 10, seed: unseeded.seed }).text, unseeded.text, "the seed it reports repeats the tale");

  // With no randomness at all the seed stops mattering.
  const calm = spark.write("Once upon a time", { maxTokens: 20, temperature: 0, seed: 1 });
  assert.equal(spark.write("Once upon a time", { maxTokens: 20, temperature: 0, seed: 2 }).text, calm.text);
});
