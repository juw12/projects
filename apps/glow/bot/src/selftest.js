// GlowBot checks its own logic. The real chat code is driven through whole conversations, with
// scripted AI models in place of the free ones and a notebook in place of Telegram, so nothing
// here touches the network. Anyone can run it on the live bot at /v1/selftest.

import { ChatLogic } from "./chat.js";
import { LANGS, t } from "./strings.js";
import { StoppedError, clip, errorText } from "./util.js";

export const SELFTEST_NOTE =
  "A logic self-test: scripted AI models and recorded Telegram calls, no network. " +
  "A pass proves the bot's own code works in this build, not that the free AI models are answering right now.";

const START = Date.UTC(2026, 0, 1); // a fixed pretend clock: the result never depends on the real time
const SOON_MS = 60 * 1000;
const SETTLE_LIMIT = 40;
const DETAIL_CLIP = 300;
const DEFAULT_PAGES = "https://juw12.github.io/projects/glow";

// ------------------------------------------------------------------ pretend parts
// Durable Object storage kept in memory: keys and values plus one alarm. Values are copied on the
// way in and out, as the real storage does.
class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.alarmAt = null;
  }

  async get(keyOrKeys) {
    if (Array.isArray(keyOrKeys)) {
      const found = new Map();
      for (const key of keyOrKeys) {
        if (this.map.has(key)) found.set(key, structuredClone(this.map.get(key)));
      }
      return found;
    }
    return this.map.has(keyOrKeys) ? structuredClone(this.map.get(keyOrKeys)) : undefined;
  }

  async put(keyOrEntries, value) {
    if (typeof keyOrEntries === "string") {
      this.map.set(keyOrEntries, structuredClone(value));
      return;
    }
    for (const [key, entry] of Object.entries(keyOrEntries)) this.map.set(key, structuredClone(entry));
  }

  async delete(keyOrKeys) {
    if (Array.isArray(keyOrKeys)) {
      let removed = 0;
      for (const key of keyOrKeys) removed += this.map.delete(key) ? 1 : 0;
      return removed;
    }
    return this.map.delete(keyOrKeys);
  }

  async deleteAll() {
    this.map.clear();
  }

  async list(options = {}) {
    const found = new Map();
    for (const key of [...this.map.keys()].sort()) {
      if (!options.prefix || key.startsWith(options.prefix)) found.set(key, structuredClone(this.map.get(key)));
    }
    return found;
  }

  async setAlarm(time) {
    this.alarmAt = Number(time);
  }

  async getAlarm() {
    return this.alarmAt;
  }

  async deleteAlarm() {
    this.alarmAt = null;
  }
}

// AI models that answer from a script. The first rule whose pattern matches the system prompt
// wins. An answer is one text, or a list handed out one per call.
function scriptedModels(rules) {
  const calls = [];
  const handedOut = new Map();
  async function complete({ messages, signal }) {
    const system = String(messages[0].content);
    calls.push({ system, messages });
    if (signal && signal.aborted) throw new StoppedError();
    for (let index = 0; index < rules.length; index += 1) {
      const [pattern, answer] = rules[index];
      if (!pattern.test(system)) continue;
      if (!Array.isArray(answer)) return { text: answer, name: "Script", label: "self-test" };
      const turn = handedOut.get(index) || 0;
      if (turn >= answer.length) throw new Error("the script ran out of answers");
      handedOut.set(index, turn + 1);
      return { text: answer[turn], name: "Script", label: "self-test" };
    }
    throw new Error("no scripted answer for: " + system.slice(0, 60));
  }
  return { complete, calls };
}

// A web with nothing on it, so a scenario that reaches for the web shows up as a failure.
const QUIET_WEB = {
  async search() {
    return { results: [], via: "self-test", tried: [] };
  },
  async read() {
    throw new Error("the self-test has no web pages");
  },
  async news() {
    throw new Error("the self-test has no news");
  },
};

// One pretend chat: the real ChatLogic in record mode, on a clock the scenario moves itself.
function pretendChat(rules, info) {
  let time = START;
  const storage = new MemoryStorage();
  const models = scriptedModels(rules);
  const errors = [];
  const logic = new ChatLogic({
    storage,
    now: () => time,
    telegramFor: () => {
      throw new Error("the self-test must never reach Telegram");
    },
    modelsFor: () => models,
    web: QUIET_WEB,
    spark: null,
    info,
    onError: (where, error) => errors.push(`${where}: ${errorText(error)}`),
  });

  // Runs the alarm if one is due within a minute. A simulated chat always keeps its 30-minute
  // clean-up alarm, so "nothing due soon" means the job is waiting for the user or is over.
  async function tick() {
    const alarm = await storage.getAlarm();
    if (alarm === null || alarm - time > SOON_MS) return false;
    time = Math.max(time, alarm);
    await storage.deleteAlarm();
    await logic.tick();
    return true;
  }

  return {
    models,
    errors,
    tick,
    say: (text, extra = {}) => logic.simulate({ text, ...extra }),
    tap: (data) => logic.simulate({ callback: data }),
    view: () => logic.transcript(),
    async settle() {
      for (let count = 0; count < SETTLE_LIMIT; count += 1) {
        if (!(await tick())) return;
      }
      throw new Error(`the chat was still busy after ${SETTLE_LIMIT} alarm runs`);
    },
  };
}

// ------------------------------------------------------------------ reading a transcript
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function posts(view) {
  return view.calls.filter((row) => row.method === "sendMessage");
}

function lastPost(view) {
  const sent = posts(view);
  expect(sent.length > 0, "the bot posted nothing");
  return sent[sent.length - 1];
}

function textOf(row) {
  return String((row && row.payload && row.payload.text) || "");
}

function buttonsOf(row) {
  const markup = row && row.payload ? row.payload.reply_markup : null;
  const keys = markup && Array.isArray(markup.inline_keyboard) ? markup.inline_keyboard.flat() : [];
  return keys.map((key) => key.callback_data || "");
}

function expectPosted(view, wanted) {
  expect(posts(view).some((row) => textOf(row).includes(wanted)), `no post says "${wanted}"`);
}

function expectDone(view, kind, calls) {
  const done = view.done;
  expect(done && done.kind === kind, `the last finished job is ${done ? done.kind : "missing"}, not ${kind}`);
  expect(done.status === "done", `the ${kind} job ended as "${done.status}" ${done.error || ""}`.trim());
  expect(done.calls === calls, `the ${kind} job made ${done.calls} AI calls, not ${calls}`);
}

// ------------------------------------------------------------------ the scripts
const PLAN = /^You are GlowLead, the lead of a team/;
const REVIEW = /^You are GlowLead, the team lead/;
const CHAT_STEP = /^You are GlowChat, working for GlowLead/;
const BUILDER = /^You are the Builder/;
const CRITIC = /^You are the Critic/;
const JUDGE = /^You are the Judge/;
const NOVA_PLAN = /^You are Nova, lead of an AI crew/;
const PIXEL = /^You are Pixel/;
const GLOWCHAT = /^You are GlowChat, the Glow AI assistant/;
const HARNESS = /^You are GlowHarness, a careful assistant/;

const BAKERY_GOAL = "Write a welcome message for my bakery";
const BAKERY_PLAN = JSON.stringify({
  summary: "Decide the tone, then write it.",
  criteria: ["Friendly tone", "Under 80 words"],
  steps: [
    { worker: "council", title: "Decide the tone", task: "Decide which tone fits a small bakery." },
    { worker: "chat", title: "Write the message", task: "Write the welcome message." },
  ],
});
const BAKERY_RULES = [
  [PLAN, BAKERY_PLAN],
  [BUILDER, "Builder: go warm."],
  [CRITIC, "Critic: too long."],
  [JUDGE, "Judge: warm and short."],
  [CHAT_STEP, "Welcome to our bakery!"],
  [REVIEW, 'Welcome to our bakery!\n\nCHECK: {"met":[true,true],"missing":""}'],
];

const ROOM_RULES = [
  [NOVA_PLAN, JSON.stringify({ steps: [{ bot: "media", task: "Write a short club post" }] })],
  [PIXEL, "Good news, club: the Pi 5 is $80!"],
];

const SAVE_WIFI = "TOOL " + JSON.stringify({ name: "notes", args: { op: "save", key: "wifi", value: "glow-5g" } });

// ------------------------------------------------------------------ the scenarios
// Each one gets open(rules) to start a pretend chat, and returns a short line saying what it saw.
const SCENARIOS = [
  {
    name: "mission",
    async run(open) {
      const chat = open(BAKERY_RULES);
      await chat.say(BAKERY_GOAL);
      await chat.settle();
      let view = await chat.view();
      expect(view.job && view.job.status === "awaiting", "GlowLead did not wait for the plan to be approved");
      expect(buttonsOf(lastPost(view)).join(" ") === "run:1 chg:1 can:1", "the plan has no Run, Change and Cancel buttons");

      await chat.tap("run:1");
      await chat.settle();
      view = await chat.view();
      expectDone(view, "lead", 6);
      for (const voice of ["Builder: go warm.", "Critic: too long.", "Judge: warm and short."]) expectPosted(view, voice);
      const report = textOf(lastPost(view));
      for (const part of ["Welcome to our bakery!", "✅ Friendly tone", "✅ Under 80 words"]) {
        expect(report.includes(part), `the final report does not say "${part}"`);
      }
      return "GlowLead planned, waited for Run, sent the work to the council and GlowChat, checked both goals and reported: 6 AI calls.";
    },
  },
  {
    name: "room",
    async run(open) {
      const chat = open(ROOM_RULES);
      await chat.say("/room Announce the Raspberry Pi 5 price to my club");
      await chat.settle();
      const view = await chat.view();
      expectDone(view, "room", 2);
      expectPosted(view, "Good news, club: the Pi 5 is $80!");
      expectPosted(view, "<b>Pixel</b>");
      return "Nova planned the crew's work and Pixel posted the result under its own name: 2 AI calls.";
    },
  },
  {
    name: "chat",
    async run(open) {
      const chat = open([[GLOWCHAT, ["The capital is **Paris**.", "It has about **2 million** people."]]]);
      await chat.say("/chat What is the capital of France?");
      await chat.settle();
      await chat.say("/chat How many people live there?");
      await chat.settle();
      const view = await chat.view();
      expectDone(view, "chat", 1);
      expectPosted(view, "The capital is <b>Paris</b>.");
      expectPosted(view, "It has about <b>2 million</b> people.");
      const second = chat.models.calls[1];
      const roles = second ? second.messages.map((message) => message.role).join(" ") : "";
      expect(roles === "system user assistant user", `the second question was sent as "${roles}", without the first exchange`);
      return "GlowChat answered twice, bold text reached Telegram as HTML, and the second question carried the first exchange.";
    },
  },
  {
    name: "agent",
    async run(open) {
      const chat = open([[HARNESS, [SAVE_WIFI, "FINAL Saved your wifi name."]]]);
      await chat.say("/agent Remember my wifi name glow-5g");
      await chat.settle();
      let view = await chat.view();
      expect(view.job && view.job.status === "awaiting", "GlowHarness did not wait for permission to save a note");
      expect(buttonsOf(lastPost(view)).join(" ") === "ok:1:0 no:1:0", "the question has no Approve and Deny buttons");

      await chat.tap("ok:1:0");
      await chat.settle();
      view = await chat.view();
      expectDone(view, "agent", 2);
      expect(textOf(lastPost(view)).includes("Saved your wifi name."), "the final answer is missing");
      return "GlowHarness asked before saving a note, saved it after Approve and answered: 2 AI calls, 1 tool call.";
    },
  },
  {
    name: "stop",
    async run(open) {
      const idle = open();
      await idle.say("/stop");
      expect(textOf(lastPost(await idle.view())) === t("en", "nothing.running"), "/stop with nothing running gave the wrong answer");

      const busy = open(BAKERY_RULES);
      await busy.say(BAKERY_GOAL);
      await busy.settle();
      await busy.tap("run:1");
      await busy.tick();
      const before = await busy.view();
      expect(before.job && before.job.status === "active", "the mission was not running when /stop was sent");
      await busy.say("/stop");
      const callsAtStop = busy.models.calls.length;
      await busy.settle();
      const view = await busy.view();
      expect(view.job === null, "the mission is still there after /stop");
      expect(view.done && view.done.status === "stopped", `the mission ended as "${view.done ? view.done.status : "nothing"}"`);
      expect(textOf(lastPost(view)) === t("en", "stopped"), "/stop did not confirm");
      expect(busy.models.calls.length === callsAtStop, "an AI model was called after /stop");
      expect(view.outbox === 0, "posts were still waiting after /stop");
      return "/stop ended a running mission at once: no AI call and no post after it. With nothing running it says so.";
    },
  },
  {
    name: "languages",
    async run(open) {
      const replies = [];
      for (const lang of LANGS) {
        const chat = open();
        await chat.say("/help", { lang });
        const view = await chat.view();
        expect(view.lang === lang, `the chat did not switch to ${lang}`);
        const reply = textOf(lastPost(view));
        expect(reply.length > 40, `/help is empty in ${lang}`);
        replies.push(reply);
      }
      expect(new Set(replies).size === LANGS.length, "two languages gave the same /help text");
      return `/help answered in ${LANGS.length} languages (${LANGS.join(", ")}), each with its own text.`;
    },
  },
];

// ------------------------------------------------------------------ running them
// options = { info, scenarios }. Returns { ok, kind, note, checks: [{ name, ok, detail }] }.
// A scenario fails when it throws, or when the bot reported an error inside any chat it opened;
// when both happen the detail carries both.
export async function runSelfTest(options = {}) {
  const info = { pages: DEFAULT_PAGES, version: "", build: "", ...(options.info || {}) };
  const scenarios = options.scenarios || SCENARIOS;
  const checks = [];
  for (const scenario of scenarios) {
    const opened = [];
    const open = (rules = []) => {
      const chat = pretendChat(rules, info);
      opened.push(chat);
      return chat;
    };
    let ok = true;
    let detail = "";
    try {
      detail = String((await scenario.run(open)) || "");
    } catch (error) {
      ok = false;
      detail = errorText(error);
    }
    // What the bot itself reported is the more useful half of a failure, so it is never dropped.
    const errors = opened.flatMap((chat) => chat.errors);
    if (errors.length) {
      const reported = "the bot reported: " + errors.join("; ");
      detail = ok ? reported : `${detail} (${reported})`;
      ok = false;
    }
    checks.push({ name: String(scenario.name), ok, detail: clip(detail, DETAIL_CLIP) });
  }
  return { ok: checks.length > 0 && checks.every((check) => check.ok), kind: "logic", note: SELFTEST_NOTE, checks };
}
