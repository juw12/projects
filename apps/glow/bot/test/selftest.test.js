// The bot's self-test, tested. A green result is only worth something if a broken bot turns it red,
// so most of this file breaks one part of the real chat code and checks which conversation notices.
// The route that serves the result (/v1/selftest) is in worker.test.js.

import test from "node:test";
import assert from "node:assert/strict";

import { ChatLogic } from "../src/chat.js";
import { SELFTEST_NOTE, runSelfTest } from "../src/selftest.js";

const START = Date.UTC(2026, 0, 1); // the pretend clock every self-test chat starts on
const HALF_HOUR = 30 * 60 * 1000;
const STILL_BUSY = "the chat was still busy after 40 alarm runs";
const GLOWCHAT = /^You are GlowChat, the Glow AI assistant/;

// name -> "ok", or what the failed check said
function outcomes(result) {
  return Object.fromEntries(result.checks.map((check) => [check.name, check.ok ? "ok" : check.detail]));
}

// Runs the self-test while one method of the real chat code is swapped for a broken one.
async function withBroken(method, broken) {
  const real = ChatLogic.prototype[method];
  ChatLogic.prototype[method] = broken;
  try {
    return await runSelfTest();
  } finally {
    ChatLogic.prototype[method] = real;
  }
}

// Runs work(open) as the only scenario and hands back what it returned, so a test can look
// inside a pretend chat.
async function withOpen(work, options = {}) {
  let seen;
  const scenario = {
    name: "kit",
    async run(open) {
      seen = await work(open);
      return "done";
    },
  };
  const result = await runSelfTest({ ...options, scenarios: [scenario] });
  assert.deepEqual(result.checks, [{ name: "kit", ok: true, detail: "done" }]);
  return seen;
}

function posted(view) {
  return view.calls.filter((row) => row.method === "sendMessage").map((row) => row.payload);
}

// ------------------------------------------------------------------ the real code passes
test("the six built-in conversations pass, each saying what it saw", async () => {
  const result = await runSelfTest();
  assert.deepEqual(result, {
    ok: true,
    kind: "logic",
    note: SELFTEST_NOTE,
    checks: [
      {
        name: "mission",
        ok: true,
        detail:
          "GlowLead planned, waited for Run, sent the work to the council and GlowChat, checked both goals and reported: 6 AI calls.",
      },
      {
        name: "room",
        ok: true,
        detail: "Nova planned the crew's work and Pixel posted the result under its own name: 2 AI calls.",
      },
      {
        name: "chat",
        ok: true,
        detail:
          "GlowChat answered twice, bold text reached Telegram as HTML, and the second question carried the first exchange.",
      },
      {
        name: "agent",
        ok: true,
        detail: "GlowHarness asked before saving a note, saved it after Approve and answered: 2 AI calls, 1 tool call.",
      },
      {
        name: "stop",
        ok: true,
        detail: "/stop ended a running mission at once: no AI call and no post after it. With nothing running it says so.",
      },
      {
        name: "languages",
        ok: true,
        detail: "/help answered in 4 languages (en, id, zh-Hans, zh-Hant), each with its own text.",
      },
    ],
  });
  // The page and the deploy check read this as JSON, so the order of the fields is part of it.
  assert.deepEqual(Object.keys(result), ["ok", "kind", "note", "checks"]);
  assert.deepEqual(Object.keys(result.checks[0]), ["name", "ok", "detail"]);
});

test("the note says what a pass proves and what it does not", () => {
  assert.match(SELFTEST_NOTE, /scripted AI models/);
  assert.match(SELFTEST_NOTE, /no network/);
  assert.match(SELFTEST_NOTE, /not that the free AI models are answering right now/);
});

test("it uses no network, no real clock and no dice, and gives the same answer twice", async () => {
  const real = { fetch: globalThis.fetch, now: Date.now, random: Math.random };
  const used = [];
  globalThis.fetch = async () => {
    used.push("the network");
    throw new Error("the self-test reached for the network");
  };
  Date.now = () => {
    used.push("the real clock");
    return real.now.call(Date);
  };
  Math.random = () => {
    used.push("the dice");
    return real.random.call(Math);
  };
  let first;
  let second;
  try {
    first = await runSelfTest();
    second = await runSelfTest();
  } finally {
    globalThis.fetch = real.fetch;
    Date.now = real.now;
    Math.random = real.random;
  }
  assert.deepEqual(used, []);
  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
});

// ------------------------------------------------------------------ broken code is noticed
test("a /stop that does nothing is caught by the stop check alone", async () => {
  const result = await withBroken("stopJob", async () => {});
  assert.equal(result.ok, false);
  assert.deepEqual(outcomes(result), {
    mission: "ok",
    room: "ok",
    chat: "ok",
    agent: "ok",
    stop: 'the mission ended as "done"',
    languages: "ok",
  });
});

test("a bot that never sets its alarm does no work, and four checks say so", async () => {
  const seen = outcomes(await withBroken("reschedule", async () => {}));
  assert.equal(seen.mission, "GlowLead did not wait for the plan to be approved");
  assert.equal(seen.room, "the last finished job is missing, not room");
  assert.equal(seen.chat, "the last finished job is missing, not chat");
  assert.equal(seen.agent, "GlowHarness did not wait for permission to save a note");
  assert.equal(seen.languages, "ok");
});

test("a bot that answers only in English is caught by the languages check alone", async () => {
  const handleUpdate = ChatLogic.prototype.handleUpdate;
  const result = await withBroken("handleUpdate", async function (input) {
    (await this.load()).lang = "en";
    return handleUpdate.call(this, input);
  });
  assert.deepEqual(outcomes(result), {
    mission: "ok",
    room: "ok",
    chat: "ok",
    agent: "ok",
    stop: "ok",
    languages: "the chat did not switch to id",
  });
});

test("a chat that never goes quiet is given up on after 40 alarm runs", async () => {
  let runs = 0;
  const result = await withBroken("tick", async function () {
    runs += 1;
    await this.storage.setAlarm(this.now() + 1000);
  });
  assert.deepEqual(outcomes(result), {
    mission: STILL_BUSY,
    room: STILL_BUSY,
    chat: STILL_BUSY,
    agent: STILL_BUSY,
    stop: STILL_BUSY,
    languages: "ok",
  });
  assert.equal(runs, 5 * 40);
});

test("a step that blows up fails the check, and the detail keeps what the bot itself reported", async () => {
  const seen = outcomes(
    await withBroken("runJob", async () => {
      throw new Error("the step broke");
    }),
  );
  assert.equal(seen.room, 'the room job ended as "error" the step broke (the bot reported: job: the step broke)');
  for (const name of ["mission", "chat", "agent", "stop"]) {
    assert.match(seen[name], /\(the bot reported: job: the step broke(; job: the step broke)?\)$/, name);
  }
  assert.equal(seen.languages, "ok");
});

test("with the real code back in place the self-test is green again", async () => {
  const result = await runSelfTest();
  assert.equal(result.ok, true);
  assert.deepEqual(Object.values(outcomes(result)), ["ok", "ok", "ok", "ok", "ok", "ok"]);
});

// ------------------------------------------------------------------ how a result is put together
test("one failing scenario turns the result red, and the ones after it still run", async () => {
  const result = await runSelfTest({
    scenarios: [
      { name: "first", run: async () => "fine" },
      {
        name: "second",
        run: async () => {
          throw new Error("it broke");
        },
      },
      { name: "third", run: async () => "also fine" },
      { name: "quiet", run: async () => {} },
    ],
  });
  assert.deepEqual(result, {
    ok: false,
    kind: "logic",
    note: SELFTEST_NOTE,
    checks: [
      { name: "first", ok: true, detail: "fine" },
      { name: "second", ok: false, detail: "it broke" },
      { name: "third", ok: true, detail: "also fine" },
      { name: "quiet", ok: true, detail: "" },
    ],
  });
});

test("no scenarios at all is a failure, not an empty pass", async () => {
  assert.deepEqual(await runSelfTest({ scenarios: [] }), { ok: false, kind: "logic", note: SELFTEST_NOTE, checks: [] });
});

test("an error the bot reported fails the scenario even when the scenario itself was happy", async () => {
  const result = await runSelfTest({
    scenarios: [
      {
        name: "one chat",
        async run(open) {
          open().errors.push("job: a made-up fault");
          return "looked fine";
        },
      },
      {
        name: "two chats",
        async run(open) {
          open().errors.push("flush: one");
          open().errors.push("job: two");
          return "looked fine";
        },
      },
      {
        name: "both",
        async run(open) {
          open().errors.push("job: a made-up fault");
          throw new Error("the answer never came");
        },
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.checks, [
    { name: "one chat", ok: false, detail: "the bot reported: job: a made-up fault" },
    { name: "two chats", ok: false, detail: "the bot reported: flush: one; job: two" },
    { name: "both", ok: false, detail: "the answer never came (the bot reported: job: a made-up fault)" },
  ]);
});

test("a goal no model can answer ends as a failed job, which the bot handles without reporting a fault", async () => {
  const seen = await withOpen(async (open) => {
    const chat = open();
    await chat.say("Plan my week");
    await chat.settle();
    return { view: await chat.view(), errors: [...chat.errors] };
  });
  assert.deepEqual(seen.errors, []);
  assert.equal(seen.view.job, null);
  assert.equal(seen.view.done.status, "error");
  assert.match(posted(seen.view).at(-1).text, /^⚠️ The mission could not be finished: no scripted answer for: /);
});

test("a long detail is cut to 300 characters", async () => {
  const result = await runSelfTest({
    scenarios: [
      { name: "said", run: async () => "a".repeat(500) },
      {
        name: "thrown",
        run: async () => {
          throw new Error("b".repeat(500));
        },
      },
      { name: "fits", run: async () => "c".repeat(300) },
    ],
  });
  assert.deepEqual(
    result.checks.map((check) => check.detail),
    ["a".repeat(299) + "…", "b".repeat(299) + "…", "c".repeat(300)],
  );
});

test("the page address and version it is given reach the chat", async () => {
  const info = { pages: "https://pages.example/glow", version: "9.9.9", build: "abc1234" };
  const ask = async (open) => {
    const chat = open();
    await chat.say("/status");
    await chat.say("/apps");
    const [status, apps] = posted(await chat.view());
    return { title: status.text.split("\n")[0], links: apps.reply_markup.inline_keyboard.flat().map((key) => key.web_app.url) };
  };

  assert.deepEqual(await withOpen(ask, { info }), {
    title: "<b>GlowBot 9.9.9</b>",
    links: [
      "https://pages.example/glow/",
      "https://pages.example/glow/lead/",
      "https://pages.example/glow/chat/mobile.html",
      "https://pages.example/glow/room/mobile.html",
      "https://pages.example/glow/news/",
      "https://pages.example/glow/spark/",
      "https://pages.example/glow/harness/",
      "https://pages.example/glow/code/",
      "https://pages.example/glow/bot/",
    ],
  });
  // Left alone, the links point at the live Glow pages.
  assert.equal((await withOpen(ask)).links[0], "https://juw12.github.io/projects/glow/");
});

// ------------------------------------------------------------------ the pretend parts
test("scripted models: the first matching rule wins, and a list is handed out one answer per call", async () => {
  const rules = [
    [/^You are A/, "first rule"],
    [/^You are/, ["one", "two"]],
  ];
  const seen = await withOpen(async (open) => {
    const { models } = open(rules);
    const answers = [];
    const ask = async (system, signal) => {
      try {
        answers.push(await models.complete({ messages: [{ role: "system", content: system }], signal }));
      } catch (error) {
        answers.push(`${error.name}: ${error.message}`);
      }
    };
    for (const system of ["You are A", "You are A", "You are B", "You are C", "You are D", "Somebody else"]) await ask(system);
    await ask("You are A", AbortSignal.abort());
    return { answers, calls: models.calls };
  });

  const said = (text) => ({ text, name: "Script", label: "self-test" });
  assert.deepEqual(seen.answers, [
    said("first rule"),
    said("first rule"),
    said("one"),
    said("two"),
    "Error: the script ran out of answers",
    "Error: no scripted answer for: Somebody else",
    "StoppedError: stopped",
  ]);
  // Every call is written down, the refused ones too.
  assert.equal(seen.calls.length, 7);
  assert.deepEqual(seen.calls[0], { system: "You are A", messages: [{ role: "system", content: "You are A" }] });
});

test("a pretend chat only moves when its alarm is run, and settle runs it until nothing is due", async () => {
  const seen = await withOpen(async (open) => {
    const chat = open([[GLOWCHAT, "Hello!"]]);
    const empty = await chat.view();
    const tickWhenEmpty = await chat.tick();
    await chat.say("/chat hi");
    const asked = await chat.view();
    const tickWhenAsked = await chat.tick();
    const answered = await chat.view();
    const tickWhenDone = await chat.tick();
    await chat.settle();
    return { empty, tickWhenEmpty, asked, tickWhenAsked, answered, tickWhenDone, settled: await chat.view() };
  });

  assert.deepEqual(seen.empty, { calls: [], last: 0, alarm: null, mode: "lead", lang: null, job: null, done: null, outbox: 0 });
  assert.equal(seen.tickWhenEmpty, false);

  // The question is taken in and the work is left for the alarm, due at once.
  assert.deepEqual(posted(seen.asked), []);
  assert.equal(seen.asked.job.status, "active");
  assert.equal(seen.asked.alarm, START);

  assert.equal(seen.tickWhenAsked, true);
  assert.deepEqual(posted(seen.answered).map((payload) => payload.text), ["Hello!"]);
  assert.equal(seen.answered.job, null);
  assert.equal(seen.answered.done.status, "done");

  // What is left is the simulator's own clean-up half an hour on, which is not "due soon".
  assert.equal(seen.answered.alarm, START + HALF_HOUR);
  assert.equal(seen.tickWhenDone, false);
  assert.deepEqual(seen.settled, seen.answered);
});
