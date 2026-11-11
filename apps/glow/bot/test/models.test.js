import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AI_MODELS,
  KEYLESS,
  ModelsBusyError,
  askEntry,
  createModels,
  isQuotaError,
  readAiOutput,
  retryAfterMs,
  stripThinking,
} from "../src/models.js";
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

test("keyless models are asked first unless the order says otherwise", () => {
  const ai = fakeAi({});
  const idsOf = (models) => models.chain().map((entry) => entry.id);
  assert.deepEqual(idsOf(createModels({ providers: [ONE, TWO], aiModels: [AI_A], ai })), ["one", "two", "ai-a"]);
  assert.deepEqual(idsOf(createModels({ providers: [ONE, TWO], aiModels: [AI_A], ai, order: "ai-first" })), ["ai-a", "one", "two"]);
  assert.deepEqual(idsOf(createModels({ providers: [ONE, TWO], aiModels: [AI_A] })), ["one", "two"], "no binding, no Workers AI");
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
