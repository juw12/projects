// Checks for the small shared helpers in src/util.js.
import test from "node:test";
import assert from "node:assert/strict";

import {
  StoppedError,
  TimeoutError,
  allowedOrigins,
  clip,
  corsHeaders,
  errorText,
  inBatches,
  json,
  safeEqual,
  sha256Hex,
  sleep,
  withTimeout,
} from "../src/util.js";

test("clip keeps short text and marks a cut with one ellipsis", () => {
  assert.equal(clip("short", 10), "short");
  assert.equal(clip("exactly ten", 11), "exactly ten");
  assert.equal(clip("abcdefghij", 5), "abcd…");
  assert.equal(clip("abcdefghij", 5).length, 5);
  assert.equal(clip(null, 5), "");
  assert.equal(clip(undefined, 5), "");
  assert.equal(clip(12345678, 4), "123…");
});

test("errorText reads a message from errors, strings and nothing at all", () => {
  assert.equal(errorText(new Error("boom")), "boom");
  assert.equal(errorText("plain words"), "plain words");
  assert.equal(errorText(null), "unknown error");
  assert.equal(errorText(undefined), "unknown error");
});

test("sha256Hex matches the published test vector for abc", async () => {
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("safeEqual is true only for identical strings", () => {
  assert.equal(safeEqual("same", "same"), true);
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual("same", "sama"), false);
  assert.equal(safeEqual("same", "same "), false);
  assert.equal(safeEqual("", "a"), false);
  assert.equal(safeEqual("abc", "abcabc"), false);
});

test("withTimeout hands back the result of work that finishes in time", async () => {
  let receivedSignal = null;
  const result = await withTimeout(
    async (signal) => {
      receivedSignal = signal;
      return "done";
    },
    1000,
    "quick job",
  );
  assert.equal(result, "done");
  assert.equal(receivedSignal.aborted, false);
});

test("withTimeout passes on an error thrown by the work", async () => {
  await assert.rejects(
    withTimeout(
      () => {
        throw new Error("work failed");
      },
      1000,
      "failing job",
    ),
    /work failed/,
  );
});

test("withTimeout stops slow work, names it and aborts its signal", async () => {
  let receivedSignal = null;
  await assert.rejects(
    withTimeout(
      (signal) => {
        receivedSignal = signal;
        return new Promise(() => {});
      },
      30,
      "slow job",
    ),
    (error) => {
      assert.ok(error instanceof TimeoutError);
      assert.equal(error.name, "TimeoutError");
      assert.equal(error.message, "slow job timed out after 0 s");
      return true;
    },
  );
  assert.equal(receivedSignal.aborted, true);
});

test("withTimeout stops at once when the outer signal aborts", async () => {
  const outer = new AbortController();
  let receivedSignal = null;
  const running = withTimeout(
    (signal) => {
      receivedSignal = signal;
      return new Promise(() => {});
    },
    5000,
    "stoppable job",
    outer.signal,
  );
  await sleep(5);
  outer.abort();
  await assert.rejects(running, (error) => {
    assert.ok(error instanceof StoppedError);
    assert.equal(error.message, "stopped");
    return true;
  });
  assert.equal(receivedSignal.aborted, true);
});

test("withTimeout refuses to start waiting when the outer signal is already aborted", async () => {
  const outer = new AbortController();
  outer.abort();
  await assert.rejects(
    withTimeout(() => new Promise(() => {}), 5000, "late job", outer.signal),
    StoppedError,
  );
});

test("inBatches keeps the order of results and never runs more than the limit at once", async () => {
  let running = 0;
  let mostAtOnce = 0;
  const tasks = [];
  for (let index = 0; index < 9; index++) {
    tasks.push(async () => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      // Later tasks finish sooner, so order has to come from the index, not from timing.
      await sleep(12 - index);
      running -= 1;
      return `task ${index}`;
    });
  }
  const results = await inBatches(tasks, 4);
  assert.deepEqual(
    results,
    tasks.map((_, index) => `task ${index}`),
  );
  assert.equal(mostAtOnce, 4);
});

test("inBatches copes with no tasks and with fewer tasks than the limit", async () => {
  assert.deepEqual(await inBatches([], 4), []);
  assert.deepEqual(await inBatches([async () => 1, async () => 2], 4), [1, 2]);
});

test("allowedOrigins splits the list and drops blanks", () => {
  assert.deepEqual(allowedOrigins({ ALLOWED_ORIGINS: " https://a.example , ,https://b.example" }), [
    "https://a.example",
    "https://b.example",
  ]);
  assert.deepEqual(allowedOrigins({}), []);
  assert.deepEqual(allowedOrigins(undefined), []);
});

test("corsHeaders opens up only for a listed origin", () => {
  const env = { ALLOWED_ORIGINS: "https://juw12.github.io" };
  const fromGlow = new Request("https://bot.example/v1/status", {
    headers: { Origin: "https://juw12.github.io" },
  });
  assert.deepEqual(corsHeaders(fromGlow, env), {
    Vary: "Origin",
    "Access-Control-Allow-Origin": "https://juw12.github.io",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Glow-Setup-Code",
    "Access-Control-Max-Age": "86400",
  });

  const fromElsewhere = new Request("https://bot.example/v1/status", {
    headers: { Origin: "https://evil.example" },
  });
  assert.deepEqual(corsHeaders(fromElsewhere, env), { Vary: "Origin" });

  const lookalike = new Request("https://bot.example/v1/status", {
    headers: { Origin: "https://juw12.github.io.evil.example" },
  });
  assert.deepEqual(corsHeaders(lookalike, env), { Vary: "Origin" });

  const noOrigin = new Request("https://bot.example/v1/status");
  assert.deepEqual(corsHeaders(noOrigin, env), { Vary: "Origin" });
});

test("json answers are never cached and carry extra headers", async () => {
  const response = json({ ok: true, count: 2 }, 201, { "X-Extra": "yes" });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Extra"), "yes");
  assert.deepEqual(await response.json(), { ok: true, count: 2 });

  const plain = json({ ok: false });
  assert.equal(plain.status, 200);
});
