import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AI_MODELS,
  KEYLESS,
  ModelsBusyError,
  askEntry,
  createModels,
  isPlanError,
  isQuotaError,
  readAiOutput,
  retryAfterMs,
  stripThinking,
} from "../src/models.js";
import { matchModels, modelName, modelTitle } from "../src/chat.js";
import { completion, fakeAi, fakeFetch, makeClock, reply } from "./fakes.js";

const ONE = { id: "one", kind: "http", label: "One", url: "https://one.test/v1/chat", model: "m1", name: "Model One" };
const TWO = { id: "two", kind: "http", label: "Two", url: "https://two.test/v1/chat", model: "m2", name: "Model Two" };
const AI_A = { id: "ai-a", kind: "ai", label: "Workers AI", model: "@cf/test/a", name: "A", shape: "messages" };
const AI_B = { id: "ai-b", kind: "ai", label: "Workers AI", model: "@cf/test/b", name: "B", shape: "messages" };
const HELLO = { messages: [{ role: "user", content: "hello" }] };
const QUOTA = "AiError: 4006: you have used up your daily free allocation of 10,000 neurons";

function hangUntilAborted(url, init) {
  return new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
  });
}

test("the built-in lists are well formed and take their addresses from the Glow kit", () => {
  const ids = KEYLESS.concat(AI_MODELS).map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "every model id is used once");
  for (const entry of KEYLESS) {
    assert.equal(entry.kind, "http");
    assert.match(entry.url, /^https:\/\/[^ ]+\/chat\/completions$/);
    assert.ok(entry.model && entry.label && entry.name);
  }
  for (const entry of AI_MODELS) {
    assert.equal(entry.kind, "ai");
    assert.match(entry.model, /^@cf\//);
  }
});

test("the list offers the newest free Qwen models and none Cloudflare charges for, and every one fits a Telegram button", () => {
  const all = KEYLESS.concat(AI_MODELS);
  const served = all.map((entry) => entry.model.toLowerCase());
  assert.ok(served.some((model) => /qwen3\.[5-9]/.test(model)), "a Qwen model of the 3.5 line or newer is on the list");
  assert.ok(AI_MODELS.some((entry) => /qwen3\.[5-9]/i.test(entry.model)), "and one of them runs on Workers AI");
  // The live check answered 5035 (not on the Workers Free plan) for each of these families.
  const paidOnly = /^@cf\/(?:deepseek-ai|moonshotai|zai-org|thinkingmachines)\//;
  for (const entry of AI_MODELS) {
    assert.doesNotMatch(entry.model, paidOnly, `${entry.id} is not a model the free plan refuses`);
  }

  // Telegram allows 64 bytes of data on a button and 100 buttons under one message.
  const bytes = (text) => new TextEncoder().encode(text).length;
  for (const entry of all) {
    assert.ok(bytes(`mdl:${entry.id}`) <= 64, `${entry.id} fits a button's data`);
    assert.match(entry.id, /^[a-z0-9-]+$/, `${entry.id} is plain, so it can be typed after /model`);
  }
  assert.ok(all.length + 1 <= 100, "one button for each model and one for Auto");

  // What is shown: each line of the list is told apart, and a button's label is short.
  const titles = all.map(modelTitle);
  assert.equal(new Set(titles).size, titles.length, "no two lines of /models read the same");
  for (const entry of all) {
    assert.ok(`✓ ${all.length}. ${modelName(entry)}`.length <= 30, `${modelName(entry)} fits a button without being cut`);
  }
});

test("a number after /model means that line of the list", () => {
  const list = [ONE, TWO, AI_A];
  assert.deepEqual(matchModels(list, "1"), [ONE]);
  assert.deepEqual(matchModels(list, "3"), [AI_A]);
  assert.deepEqual(matchModels(list, "0"), []);
  assert.deepEqual(matchModels(list, "4"), []);
  assert.deepEqual(matchModels(list, "999"), []);
  assert.deepEqual(matchModels(list, "two"), [TWO], "a name still works");
  assert.equal(modelName(ONE), "Model One");
  assert.equal(modelTitle(ONE), "One · Model One");
  assert.equal(modelName({ label: "LLM7", name: "LLM7" }), "LLM7", "a host that is its own model is named once");
});

test("keyless models are asked first unless the order says otherwise", () => {
  const ai = fakeAi({});
  const idsOf = (models) => models.chain().map((entry) => entry.id);
  assert.deepEqual(idsOf(createModels({ providers: [ONE, TWO], aiModels: [AI_A], ai })), ["one", "two", "ai-a"]);
  assert.deepEqual(idsOf(createModels({ providers: [ONE, TWO], aiModels: [AI_A], ai, order: "ai-first" })), ["ai-a", "one", "two"]);
  assert.deepEqual(idsOf(createModels({ providers: [ONE, TWO], aiModels: [AI_A] })), ["one", "two"], "no binding, no Workers AI");
});

test("a chosen model is asked first, ahead of the one that answered last", async () => {
  const ai = fakeAi({});
  const make = (state) => createModels({ providers: [ONE, TWO], aiModels: [AI_A], ai, state });
  const idsOf = (models) => models.chain().map((entry) => entry.id);
  assert.deepEqual(idsOf(make({ pinned: "ai-a" })), ["ai-a", "one", "two"]);
  assert.deepEqual(idsOf(make({ pinned: "ai-a", preferred: "two" })), ["ai-a", "two", "one"]);
  assert.deepEqual(idsOf(make({ pinned: "two", preferred: "two" })), ["two", "one", "ai-a"], "the same model is listed once");
  assert.deepEqual(idsOf(make({ pinned: "retired", preferred: "two" })), ["two", "one", "ai-a"], "a model that left the list is ignored");
  assert.deepEqual(idsOf(make({ pinned: "retired" })), ["one", "two", "ai-a"]);
});

test("the chosen model answers even when another answered last, and the next one takes over while it rests", async () => {
  const now = makeClock();
  let twoIsBusy = false;
  const send = fakeFetch([
    [ONE.url, () => reply(completion("from one"))],
    [TWO.url, () => (twoIsBusy ? reply("slow down", { status: 429, headers: { "Retry-After": "30" } }) : reply(completion("from two")))],
  ]);
  const models = createModels({ fetch: send, providers: [ONE, TWO], now });
  assert.equal((await models.complete(HELLO)).provider, "one");
  assert.equal(models.state.preferred, "one");

  models.state.pinned = "two";
  assert.equal((await models.complete(HELLO)).provider, "two");
  assert.deepEqual([send.count(ONE.url), send.count(TWO.url)], [1, 1], "the chosen model was asked first, not the last one");

  // Busy: the choice is kept, the next model answers, and the chosen one is asked again once it has rested.
  twoIsBusy = true;
  const covered = await models.complete(HELLO);
  assert.equal(covered.provider, "one");
  assert.equal(models.state.pinned, "two");
  assert.deepEqual([send.count(ONE.url), send.count(TWO.url)], [2, 2]);
  await models.complete(HELLO);
  assert.deepEqual([send.count(ONE.url), send.count(TWO.url)], [3, 2], "a resting model is not asked");

  twoIsBusy = false;
  now.advance(31_000);
  assert.equal((await models.complete(HELLO)).provider, "two");
});

test("the request carries the model, the limit and the temperature", async () => {
  const send = fakeFetch([[ONE.url, () => reply(completion("hi there"))]]);
  const models = createModels({ fetch: send, providers: [ONE], now: makeClock() });
  const answer = await models.complete({ ...HELLO, temperature: 0.2, maxTokens: 321 });
  assert.equal(answer.text, "hi there");
  assert.equal(answer.provider, "one");
  assert.equal(answer.name, "Model One");
  const sent = JSON.parse(send.calls[0].body);
  assert.deepEqual(sent, { model: "m1", messages: HELLO.messages, temperature: 0.2, max_tokens: 321, stream: false });
});

test("a rate-limited model rests for as long as it asked, and the next one answers", async () => {
  const now = makeClock();
  const send = fakeFetch([
    [ONE.url, () => reply("slow down", { status: 429, headers: { "Retry-After": "7" } })],
    [TWO.url, () => reply(completion("from two"))],
  ]);
  const models = createModels({ fetch: send, providers: [ONE, TWO], now });
  const first = await models.complete(HELLO);
  assert.equal(first.provider, "two");
  assert.equal(first.failures.length, 1);
  assert.match(first.failures[0], /^One Model One: HTTP 429/);
  assert.equal(models.state.cooldown.one, now() + 7000);
  assert.equal(models.state.preferred, "two");

  // Whoever answered last is asked first, so the resting model is not even tried.
  await models.complete(HELLO);
  assert.equal(send.count(ONE.url), 1);
  assert.equal(send.count(TWO.url), 2);
  assert.equal(models.describe().find((entry) => entry.id === "one").restingMs, 7000);
});

test("the wait is also read from the body when there is no header", async () => {
  assert.equal(retryAfterMs("7", ""), 7000);
  assert.equal(retryAfterMs(null, "Rate limit reached. Retry after 28 s."), 28000);
  assert.equal(retryAfterMs(null, "please try again in 2 minutes"), 120000);
  assert.equal(retryAfterMs(undefined, "retry after 1500ms"), 1500);
  assert.equal(retryAfterMs("", "nothing useful"), 0);

  const now = makeClock();
  const send = fakeFetch([[ONE.url, () => reply({ error: "Too many requests. Retry after 28 s" }, { status: 429 })]]);
  const models = createModels({ fetch: send, providers: [ONE], now });
  await assert.rejects(models.complete(HELLO), (error) => {
    assert.ok(error instanceof ModelsBusyError);
    assert.equal(error.retryInMs, 28000);
    return true;
  });
  assert.equal(models.state.cooldown.one, now() + 28000);
});

test("when nothing answers the error says when to try again, and resting models are not asked", async () => {
  const now = makeClock();
  const send = fakeFetch([
    [ONE.url, () => reply("busy", { status: 429, headers: { "Retry-After": "7" } })],
    [TWO.url, () => reply("broken", { status: 500 })],
  ]);
  const models = createModels({ fetch: send, providers: [ONE, TWO], now });
  await assert.rejects(models.complete(HELLO), (error) => {
    assert.ok(error instanceof ModelsBusyError);
    assert.equal(error.failures.length, 2);
    assert.equal(error.retryInMs, 7000, "the sooner of 7 s (rate limit) and 20 s (other error)");
    return true;
  });
  assert.equal(send.calls.length, 2);

  await assert.rejects(models.complete(HELLO), (error) => {
    assert.match(error.failures.join(" | "), /resting 7 s.*resting 20 s/);
    return true;
  });
  assert.equal(send.calls.length, 2, "both were resting, so the network was not touched");

  now.advance(7001);
  await assert.rejects(models.complete(HELLO), ModelsBusyError);
  assert.equal(send.count(ONE.url), 2, "the first one is asked again once its rest is over");
  assert.equal(send.count(TWO.url), 1);
});

test("an empty reply and a reply that is not JSON both count as failures", async () => {
  const send = fakeFetch([
    [ONE.url, () => reply(completion("   "))],
    [TWO.url, () => reply("<html>gateway</html>")],
  ]);
  const models = createModels({ fetch: send, providers: [ONE, TWO], now: makeClock() });
  await assert.rejects(models.complete(HELLO), (error) => {
    assert.match(error.failures[0], /empty reply/);
    assert.match(error.failures[1], /not JSON/);
    return true;
  });
});

test("a model that never answers is given up on, rests two minutes, and the next one is asked", async () => {
  const now = makeClock();
  const send = fakeFetch([
    [ONE.url, hangUntilAborted],
    [TWO.url, () => reply(completion("made it"))],
  ]);
  const models = createModels({ fetch: send, providers: [ONE, TWO], now, timeouts: { http: 30 } });
  const answer = await models.complete(HELLO);
  assert.equal(answer.text, "made it");
  assert.match(answer.failures[0], /timed out/);
  assert.equal(models.state.cooldown.one, now() + 120000);
});

test("stopping cancels the call in flight and blames no model", async () => {
  const send = fakeFetch([[ONE.url, hangUntilAborted]]);
  const models = createModels({ fetch: send, providers: [ONE], now: makeClock() });
  const controller = new AbortController();
  const pending = models.complete({ ...HELLO, signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, { name: "StoppedError" });
  assert.deepEqual(models.state.cooldown, {});

  await assert.rejects(models.complete({ ...HELLO, signal: controller.signal }), { name: "StoppedError" });
  assert.equal(send.calls.length, 1, "an already stopped job asks nobody");
});

test("thinking is cut out of an answer", async () => {
  assert.equal(stripThinking("<think>let me see</think>Paris"), "Paris");
  assert.equal(stripThinking("I should say Paris.</think>\nParis"), "Paris");
  assert.equal(stripThinking("Paris<think>and then I"), "Paris");
  assert.equal(stripThinking("<THINK>a</THINK>one <think>b</think>two"), "one two");
  assert.equal(stripThinking("  plain answer "), "plain answer");

  const send = fakeFetch([[ONE.url, () => reply(completion("<think>hmm</think>The answer is 4."))]]);
  const answer = await createModels({ fetch: send, providers: [ONE], now: makeClock() }).complete(HELLO);
  assert.equal(answer.text, "The answer is 4.");
});

test("every way a Workers AI model answers is understood", () => {
  assert.deepEqual(readAiOutput("plain"), { text: "plain", field: "string", channel: "" });
  assert.deepEqual(readAiOutput({ response: "hi", usage: {} }), { text: "hi", field: "response", channel: "" });
  assert.deepEqual(readAiOutput({ output_text: "hi" }), { text: "hi", field: "output_text", channel: "" });
  assert.deepEqual(readAiOutput({ choices: [{ message: { content: "hi", reasoning_content: "thinking" } }] }), {
    text: "hi",
    field: "choices",
    channel: "",
  });
  assert.deepEqual(readAiOutput({ choices: [{ text: "hi" }] }), { text: "hi", field: "choices.text", channel: "" });
  const responsesForm = {
    output: [
      { type: "reasoning", content: [{ type: "reasoning_text", text: "the user wants a greeting" }] },
      { type: "message", content: [{ type: "output_text", text: "hi" }] },
    ],
  };
  assert.deepEqual(readAiOutput(responsesForm), { text: "hi", field: "output", channel: "" });
  assert.deepEqual(readAiOutput({ result: { response: "hi" } }), { text: "hi", field: "response", channel: "" });
  assert.deepEqual(readAiOutput({ usage: {} }), { text: "", field: "", channel: "" });
  assert.deepEqual(readAiOutput(null), { text: "", field: "", channel: "" });
});

test("Workers AI is asked with a token limit and takes over when the keyless models fail", async () => {
  const send = fakeFetch([[ONE.url, () => reply("down", { status: 503 })]]);
  const ai = fakeAi({ "@cf/test/a": { response: "from Workers AI" } });
  const models = createModels({ fetch: send, ai, providers: [ONE], aiModels: [AI_A], now: makeClock() });
  const answer = await models.complete({ ...HELLO, maxTokens: 900, temperature: 0.1 });
  assert.equal(answer.text, "from Workers AI");
  assert.equal(answer.provider, "ai-a");
  assert.equal(answer.label, "Workers AI");
  assert.deepEqual(ai.calls[0], {
    model: "@cf/test/a",
    inputs: { messages: HELLO.messages, max_tokens: 900, temperature: 0.1 },
  });
});

test("the daily allowance running out rests every Workers AI model at once", async () => {
  const now = makeClock();
  assert.ok(isQuotaError(new Error(QUOTA)));
  assert.ok(!isQuotaError(new Error("5007: No such model")));
  const ai = fakeAi({
    "@cf/test/a": () => {
      throw new Error(QUOTA);
    },
    "@cf/test/b": { response: "never reached" },
  });
  const send = fakeFetch([[ONE.url, () => reply(completion("keyless still works"))]]);
  const models = createModels({ fetch: send, ai, providers: [ONE], aiModels: [AI_A, AI_B], order: "ai-first", now });
  const answer = await models.complete(HELLO);
  assert.equal(answer.text, "keyless still works");
  assert.equal(ai.calls.length, 1, "the second Workers AI model was not asked");
  assert.equal(models.state.cooldown["ai-a"], now() + 30 * 60 * 1000);
  assert.equal(models.state.cooldown["ai-b"], now() + 30 * 60 * 1000);
});

test("a model the plan does not include is not asked in a second form", async () => {
  const PLAN = "AiError: 5035: Model @cf/test/a is not available on the Workers Free plan";
  assert.ok(isPlanError(new Error(PLAN)));
  assert.ok(isPlanError("not available on the Workers Free plan"));
  assert.ok(!isPlanError(new Error("5007: No such model")));
  assert.ok(!isPlanError(new Error(QUOTA)));

  const request = { messages: HELLO.messages, temperature: 0, maxTokens: 50 };
  const paid = fakeAi({
    "@cf/test/a": () => {
      throw new Error(PLAN);
    },
  });
  await assert.rejects(askEntry(AI_A, request, { ai: paid, timeoutMs: 1000, shapes: ["messages", "responses"] }), (error) => {
    assert.equal(error.plan, true);
    assert.match(error.message, /5035/);
    assert.doesNotMatch(error.message, /responses:/, "the second form was not tried");
    return true;
  });
  assert.equal(paid.calls.length, 1);
});

test("the health check can try both request forms and says which one worked", async () => {
  const request = { messages: HELLO.messages, temperature: 0, maxTokens: 50 };
  const picky = fakeAi({
    "@cf/test/a": (inputs) => {
      if (inputs.messages) throw new Error("5006: messages is not allowed");
      return { output: [{ type: "message", content: [{ type: "output_text", text: "pong" }] }] };
    },
  });
  const answer = await askEntry(AI_A, request, { ai: picky, timeoutMs: 1000, shapes: ["messages", "responses"] });
  assert.deepEqual(
    { text: answer.text, shape: answer.shape, field: answer.field },
    { text: "pong", shape: "responses", field: "output" },
  );
  assert.deepEqual(picky.calls[1].inputs, {
    input: [{ role: "user", content: "hello" }],
    instructions: undefined,
    max_output_tokens: 50,
    temperature: 0,
  });

  const broken = fakeAi({
    "@cf/test/a": (inputs) => {
      if (inputs.messages) throw new Error("5006: messages is not allowed");
      return { usage: { total_tokens: 3 } };
    },
  });
  await assert.rejects(askEntry(AI_A, request, { ai: broken, timeoutMs: 1000, shapes: ["messages", "responses"] }), {
    message: "messages: 5006: messages is not allowed | responses: empty reply (fields: usage)",
  });
  await assert.rejects(askEntry(AI_A, request, { ai: broken, timeoutMs: 1000 }), {
    message: "5006: messages is not allowed",
  });
  await assert.rejects(askEntry(AI_A, request, { timeoutMs: 1000 }), /not connected/);
});

test("the state is plain data, so a job can pick up where it left off", async () => {
  const now = makeClock();
  const send = fakeFetch([
    [ONE.url, () => reply("busy", { status: 429, headers: { "Retry-After": "90" } })],
    [TWO.url, () => reply(completion("two"))],
  ]);
  const first = createModels({ fetch: send, providers: [ONE, TWO], now });
  await first.complete(HELLO);
  const saved = JSON.parse(JSON.stringify(first.state));

  const second = createModels({ fetch: send, providers: [ONE, TWO], now, state: saved });
  assert.deepEqual(second.chain().map((entry) => entry.id), ["two", "one"]);
  await second.complete(HELLO);
  assert.equal(send.count(ONE.url), 1, "the restored state still knows the first model is resting");
});
