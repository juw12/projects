// The chat when things go wrong or get crowded: busy models, limits, a Telegram that refuses,
// restarts, groups, strangers, and the record mode behind the simulator.
// Commands are in chat.test.js; jobs in chat-jobs.test.js.

import test from "node:test";
import assert from "node:assert/strict";

import { MAX_CALLS, MAX_TICKS } from "../src/chat.js";
import { busyError, inTurn } from "./fakes.js";
import {
  AS_MEMBER,
  AS_OWNER,
  AS_STRANGER,
  BAKERY_GOAL,
  BAKERY_PLAN,
  BAKERY_PLAN_TEXT,
  BAKERY_REPORT_TEXT,
  BAKERY_RULES,
  BLOCKED,
  BOARD_BUTTONS,
  BROKEN,
  BUILDER,
  BUSY,
  FRIEND,
  GLOWCHAT,
  GROUP_CHAT,
  HARNESS,
  MODELS,
  MODELS_LINE,
  PAGES,
  PLAN,
  PLAN_BUTTONS,
  SAVE_WIFI,
  SECOND_PLAN,
  SECOND_PLAN_TEXT,
  STALE,
  START,
  STOP_BUTTON,
  WELCOME_POST,
  WIFI_QUESTION,
  WIFI_TASK,
  YEAST_GOAL,
  YEAST_REPORT_TEXT,
  YEAST_RULES,
  alarmIn,
  bakeryBoard,
  bakeryUpTo,
  buttonsOf,
  council,
  did,
  flood,
  job,
  makeChat,
  outline,
  pick,
  record,
  texts,
} from "./chat-kit.js";

// The bakery board while the council is at work, and what a job says when it hits a limit.
const WORKING = bakeryBoard("Working · step 1 of 2", "⏳", "▫️");
const LIMIT = "This job reached its work limit, so I stopped it. Try a smaller task.";
const busyNotice = (tries) => `The free AI models are busy. Trying again in 30 s (try ${tries} of 3).`;
const BUILDER_POST = council("Builder", "Builder: go warm.");
const CRITIC_POST = council("Critic", "Critic: too long.");

// Which message a refusal is aimed at.
const isBuilder = (payload) => /Builder/.test(payload.text);
const isPlan = (payload) => /GlowLead's plan/.test(payload.text);

// The messages still waiting to be sent, without their text.
const outbox = (kit) => kit.logic.state.outbox.map((item) => pick(item, ["tag", "tries", "waits", "dropId"]));

// From the Judge to the report: what is left of the bakery mission once the Critic has spoken.
const REST_OF_MISSION = [
  "sendMessage silent",
  `editMessageText #103 ${BOARD_BUTTONS}`,
  `editMessageText #103 ${BOARD_BUTTONS}`,
  "sendMessage silent",
  `editMessageText #103 ${BOARD_BUTTONS}`,
  "sendMessage",
  "editMessageText #103 []",
];
const REST_TEXTS = [
  council("Judge", "Judge: warm and short."),
  bakeryBoard("Working · step 2 of 2", "✅", "▫️"),
  bakeryBoard("Working · step 2 of 2", "✅", "⏳"),
  WELCOME_POST,
  bakeryBoard("Checking the work", "✅", "✅"),
  BAKERY_REPORT_TEXT,
  bakeryBoard("Done", "✅", "✅"),
];

// GlowLead writes the bakery plan first and, when asked to change it, the second plan.
const replanRules = () => [[PLAN, inTurn([BAKERY_PLAN, SECOND_PLAN])], ...BAKERY_RULES.slice(1)];

// Telegram refuses the plan three times, so the plan is given up. The goal is still waiting, with
// only the "planning…" line (#101) on screen, and forty seconds have passed.
async function planLost(kit) {
  kit.telegram.refuse("sendMessage", BROKEN, { times: 3, when: isPlan });
  await kit.say(BAKERY_GOAL);
  assert.equal(await kit.run(), 3);
  kit.fresh();
}

// ------------------------------------------------------------------ busy models and limits
test("busy models during a mission: the board says so, waits 30 s and then carries on", async () => {
  const kit = makeChat({ rules: [[BUILDER, inTurn([busyError(), busyError(), "Builder: go warm."])], ...BAKERY_RULES] });
  await bakeryUpTo(kit, "board");
  assert.deepEqual(job(kit, "calls", "ticks", "boardId"), { calls: 1, ticks: 1, boardId: 103 });

  // Each busy tick shows the step as started, then adds the note about the wait.
  for (const tries of [1, 2]) {
    await kit.tickOnce();
    did(kit, [`editMessageText #103 ${BOARD_BUTTONS}`, `editMessageText #103 ${BOARD_BUTTONS}`], [
      WORKING,
      `${WORKING}\n<i>models busy, next try in 30 s</i>`,
    ]);
    assert.deepEqual(job(kit, "calls", "ticks", "retries"), { calls: tries + 1, ticks: tries + 1, retries: tries });
    assert.equal(alarmIn(kit), 30);
  }

  // The third try gets through: the note goes away and the Builder speaks.
  await kit.tickOnce();
  did(kit, [`editMessageText #103 ${BOARD_BUTTONS}`, "sendMessage silent"], [WORKING, BUILDER_POST]);
  assert.deepEqual(job(kit, "calls", "ticks", "retries"), { calls: 4, ticks: 4, retries: 0 });
  assert.equal(alarmIn(kit), 0);
  assert.deepEqual(kit.errors, []);
});

test("busy models on a single answer: one notice counts the tries, then the job gives up", async () => {
  const kit = makeChat({ rules: [[GLOWCHAT, inTurn([busyError(), busyError(), busyError(), busyError()])]] });

  await kit.say("/chat hello");
  did(kit, []);
  assert.deepEqual(job(kit, "kind", "calls"), { kind: "chat", calls: 0 });
  assert.equal(alarmIn(kit), 0);

  await kit.tickOnce();
  did(kit, ["sendMessage silent"], [busyNotice(1)]);
  assert.deepEqual(job(kit, "calls", "retries", "retryId"), { calls: 1, retries: 1, retryId: 101 });
  assert.equal(alarmIn(kit), 30);

  // The same notice is rewritten, so the chat does not fill up with them.
  for (const tries of [2, 3]) {
    await kit.tickOnce();
    did(kit, ["editMessageText #101"], [busyNotice(tries)]);
    assert.deepEqual(job(kit, "calls", "retries"), { calls: tries, retries: tries });
    assert.equal(alarmIn(kit), 30);
  }

  await kit.tickOnce();
  did(kit, ["sendMessage", "deleteMessage #101"], ["⚠️ That did not work: All the free AI models are busy."]);
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(
    kit.logic.state.done,
    record({ kind: "chat", status: "error", error: "All the free AI models are busy.", calls: 4, models: [], finishedAt: START + 90_000 }),
  );
  assert.equal(alarmIn(kit), null);
  assert.equal(await kit.run(), 0);
  assert.deepEqual(kit.errors, []);
});

test("a model that is busy only once: the answer takes the place of the notice", async () => {
  const kit = makeChat({ rules: [[GLOWCHAT, inTurn([busyError(), "Hello!"])]] });

  await kit.say("/chat hello");
  await kit.tickOnce();
  did(kit, ["sendMessage silent"], [busyNotice(1)]);

  await kit.tickOnce();
  did(kit, ["sendMessage", "deleteMessage #101"], ["Hello!"]);
  assert.deepEqual(kit.logic.state.done, record({ kind: "chat", calls: 2, finishedAt: START + 30_000 }));
  assert.equal(alarmIn(kit), null);
  assert.deepEqual(kit.errors, []);
});

test("a job that has used its 24 AI calls is stopped, and says why", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await bakeryUpTo(kit, "work");
  assert.equal(MAX_CALLS, 24);

  // As if the mission had kept the models busy for a long time already.
  kit.logic.state.job.calls = MAX_CALLS;
  await kit.tickOnce();
  did(kit, ["sendMessage", "editMessageText #103 []"], [
    `⚠️ The mission could not be finished: ${LIMIT}`,
    bakeryBoard("Failed", "⏳", "▫️"),
  ]);
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", status: "error", error: LIMIT, calls: 24 }));
  assert.equal(kit.models.calls.length, 2);
  assert.equal(alarmIn(kit), null);
  assert.deepEqual(kit.errors, []);
});

test("a job that is still not finished after 120 ticks is stopped the same way", async () => {
  const kit = makeChat({ rules: [[GLOWCHAT, "Hello!"]] });
  await kit.say("/chat hello");
  assert.equal(MAX_TICKS, 120);

  kit.logic.state.job.ticks = MAX_TICKS;
  await kit.tickOnce();
  did(kit, ["sendMessage"], [`⚠️ That did not work: ${LIMIT}`]);
  assert.deepEqual(kit.logic.state.done, record({ kind: "chat", status: "error", error: LIMIT, calls: 0, models: [] }));
  assert.equal(kit.models.calls.length, 0);
  assert.equal(alarmIn(kit), null);
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ Telegram refusing a message
test("Telegram asks to slow down: the message waits the stated time, and the job waits with it", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await bakeryUpTo(kit, "board");
  kit.telegram.refuse("sendMessage", flood(35), { when: isBuilder });

  await kit.tickOnce();
  did(kit, [`editMessageText #103 ${BOARD_BUTTONS}`, "sendMessage silent"], [WORKING, BUILDER_POST]);
  assert.deepEqual(job(kit, "calls", "ticks"), { calls: 2, ticks: 2 });
  assert.deepEqual(outbox(kit), [{ tag: "agent", tries: 0, waits: 1, dropId: null }]);
  assert.equal(alarmIn(kit), 35);

  // After the wait the Builder's words go out first; the Critic follows in the same tick.
  await kit.tickOnce();
  did(kit, ["sendMessage silent", "sendMessage silent"], [BUILDER_POST, CRITIC_POST]);
  assert.deepEqual(job(kit, "calls", "ticks"), { calls: 3, ticks: 3 });
  assert.deepEqual(outbox(kit), []);
  assert.equal(alarmIn(kit), 0);
  assert.deepEqual(kit.errors, []);
});

test("a user who has blocked the bot: the job stops and nothing more is sent", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await bakeryUpTo(kit, "board");
  kit.telegram.refuse("sendMessage", BLOCKED, { when: isBuilder });

  await kit.tickOnce();
  did(kit, [`editMessageText #103 ${BOARD_BUTTONS}`, "sendMessage silent"], [WORKING, BUILDER_POST]);
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", status: "stopped", calls: 2 }));
  assert.deepEqual(outbox(kit), []);
  assert.equal(alarmIn(kit), null);

  assert.equal(await kit.run(), 0);
  did(kit, []);
  assert.deepEqual(kit.errors, []);
});

test("a message Telegram keeps failing on is tried three times and dropped; the mission goes on", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await bakeryUpTo(kit, "board");
  kit.telegram.refuse("sendMessage", BROKEN, { times: 3, when: isBuilder });

  await kit.tickOnce();
  did(kit, [`editMessageText #103 ${BOARD_BUTTONS}`, "sendMessage silent"], [WORKING, BUILDER_POST]);
  assert.deepEqual(outbox(kit), [{ tag: "agent", tries: 1, waits: 0, dropId: null }]);
  assert.deepEqual(job(kit, "calls", "ticks"), { calls: 2, ticks: 2 });
  assert.equal(alarmIn(kit), 20);

  // While a message is waiting to go out, the job does no new work.
  await kit.tickOnce();
  did(kit, ["sendMessage silent"], [BUILDER_POST]);
  assert.deepEqual(outbox(kit), [{ tag: "agent", tries: 2, waits: 0, dropId: null }]);
  assert.deepEqual(job(kit, "calls", "ticks"), { calls: 2, ticks: 2 });
  assert.equal(alarmIn(kit), 20);

  // The third failure drops the Builder's post, and the Critic speaks in the same tick.
  await kit.tickOnce();
  did(kit, ["sendMessage silent", "sendMessage silent"], [BUILDER_POST, CRITIC_POST]);
  assert.deepEqual(outbox(kit), []);
  assert.deepEqual(job(kit, "calls", "ticks"), { calls: 3, ticks: 3 });
  assert.equal(alarmIn(kit), 0);

  assert.equal(await kit.run(), 3);
  did(kit, REST_OF_MISSION, REST_TEXTS);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", calls: 6, finishedAt: START + 40_000 }));
  assert.deepEqual(kit.errors, []);
});

test("a plan Telegram never takes is given up, and Stop then tidies the planning line", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  kit.telegram.refuse("sendMessage", BROKEN, { times: 3, when: isPlan });

  await kit.say(BAKERY_GOAL);
  did(kit, [`sendMessage silent ${STOP_BUTTON}`], ["👑 GlowLead is planning…"]);
  assert.deepEqual(job(kit, "statusId"), { statusId: 101 });

  // The plan is written once and its message tried three times. Until it is out, the planning line stays.
  await kit.tickOnce();
  did(kit, [`sendMessage ${PLAN_BUTTONS}`], [BAKERY_PLAN_TEXT]);
  assert.deepEqual(job(kit, "status", "phase", "calls", "ticks", "statusId", "planId"), {
    status: "awaiting",
    phase: "work",
    calls: 1,
    ticks: 1,
    statusId: null,
    planId: null,
  });
  assert.deepEqual(outbox(kit), [{ tag: "plan", tries: 1, waits: 0, dropId: 101 }]);
  assert.equal(alarmIn(kit), 20);

  await kit.tickOnce();
  did(kit, [`sendMessage ${PLAN_BUTTONS}`], [BAKERY_PLAN_TEXT]);
  assert.deepEqual(outbox(kit), [{ tag: "plan", tries: 2, waits: 0, dropId: 101 }]);
  assert.equal(alarmIn(kit), 20);

  // Given up: the job gets its planning line back, so that something can still tidy it away.
  await kit.tickOnce();
  did(kit, [`sendMessage ${PLAN_BUTTONS}`], [BAKERY_PLAN_TEXT]);
  assert.deepEqual(outbox(kit), []);
  assert.deepEqual(job(kit, "status", "statusId", "planId"), { status: "awaiting", statusId: 101, planId: null });
  assert.equal(alarmIn(kit), null);

  await kit.say("/stop");
  did(kit, ["editMessageText #101 []", "sendMessage"], ["⏹ Stopped.", "⏹ Stopped."]);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", status: "stopped", calls: 1, finishedAt: START + 40_000 }));
  assert.equal(await kit.run(), 0);
  assert.deepEqual(kit.errors, []);
});

test("after a plan that never arrived, a typed change makes GlowLead plan again", async () => {
  const kit = makeChat({ rules: replanRules() });
  await planLost(kit);

  await kit.say("Make it one step shorter");
  did(kit, ["deleteMessage #101", `sendMessage silent ${STOP_BUTTON}`], ["👑 GlowLead is changing the plan…"]);
  assert.deepEqual(job(kit, "status", "phase", "calls", "statusId"), { status: "active", phase: "plan", calls: 1, statusId: 102 });
  assert.equal(alarmIn(kit), 0);

  await kit.tickOnce();
  did(kit, [`sendMessage ${PLAN_BUTTONS}`, "deleteMessage #102"], [SECOND_PLAN_TEXT]);
  assert.deepEqual(job(kit, "status", "calls", "ticks", "statusId", "planId"), {
    status: "awaiting",
    calls: 2,
    ticks: 2,
    statusId: null,
    planId: 103,
  });
  assert.equal(alarmIn(kit), null);
  assert.deepEqual(kit.errors, []);
});

test("after a plan that never arrived, a new job takes its place and removes the planning line", async () => {
  const kit = makeChat({ rules: [...BAKERY_RULES, [GLOWCHAT, "Hello!"]] });
  await planLost(kit);

  await kit.say("/chat hello");
  did(kit, ["deleteMessage #101"]);
  assert.deepEqual(job(kit, "id", "kind", "calls"), { id: "2", kind: "chat", calls: 0 });
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", status: "cancelled", calls: 1, finishedAt: START + 40_000 }));
  assert.equal(alarmIn(kit), 0);

  await kit.tickOnce();
  did(kit, ["sendMessage"], ["Hello!"]);
  assert.deepEqual(kit.logic.state.done, record({ id: "2", kind: "chat", calls: 1, finishedAt: START + 40_000 }));
  assert.deepEqual(kit.errors, []);
});

test("Stop while the plan is held back by Telegram: the plan is never sent", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  kit.telegram.refuse("sendMessage", flood(40), { when: isPlan });
  await kit.say(BAKERY_GOAL);
  kit.fresh();

  await kit.tickOnce();
  did(kit, [`sendMessage ${PLAN_BUTTONS}`], [BAKERY_PLAN_TEXT]);
  assert.deepEqual(job(kit, "status", "calls"), { status: "awaiting", calls: 1 });
  assert.deepEqual(outbox(kit), [{ tag: "plan", tries: 0, waits: 1, dropId: 101 }]);
  assert.equal(alarmIn(kit), 40);

  await kit.say("/stop");
  did(kit, ["editMessageText #101 []", "sendMessage"], ["⏹ Stopped.", "⏹ Stopped."]);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", status: "stopped", calls: 1 }));
  assert.deepEqual(outbox(kit), []);
  assert.equal(alarmIn(kit), null);
  assert.equal(await kit.run(), 0);
  did(kit, []);
  assert.deepEqual(kit.errors, []);
});

test("a typed change while the plan is held back: the old plan is dropped, the new one waits its turn", async () => {
  const kit = makeChat({ rules: replanRules() });
  kit.telegram.refuse("sendMessage", flood(40), { when: isPlan });
  await kit.say(BAKERY_GOAL);
  await kit.tickOnce();
  kit.fresh();

  await kit.say("Make it one step shorter");
  did(kit, ["deleteMessage #101", `sendMessage silent ${STOP_BUTTON}`], ["👑 GlowLead is changing the plan…"]);
  assert.deepEqual(job(kit, "status", "phase", "statusId"), { status: "active", phase: "plan", statusId: 102 });
  assert.deepEqual(outbox(kit), []);

  // Telegram asked for 40 s of quiet, so the new plan is not written before that.
  assert.equal(alarmIn(kit), 40);
  await kit.tickOnce();
  did(kit, [`sendMessage ${PLAN_BUTTONS}`, "deleteMessage #102"], [SECOND_PLAN_TEXT]);
  assert.deepEqual(job(kit, "status", "calls", "planId"), { status: "awaiting", calls: 2, planId: 103 });
  assert.equal(alarmIn(kit), null);
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ restarts and empty chats
test("a mission carries on after the Durable Object restarts: storage holds everything it needs", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await bakeryUpTo(kit, "work");
  assert.deepEqual(job(kit, "calls", "ticks"), { calls: 2, ticks: 2 });

  // Memory is gone; the job, the board and the alarm are still in storage.
  kit.restart();
  assert.equal(kit.logic.state, null);
  assert.equal(alarmIn(kit), 0);

  // The new object has not drawn the board yet, so it draws it once more. Then the Critic speaks.
  await kit.tickOnce();
  did(kit, [`editMessageText #103 ${BOARD_BUTTONS}`, "sendMessage silent"], [WORKING, CRITIC_POST]);
  assert.deepEqual(job(kit, "calls", "ticks", "boardId"), { calls: 3, ticks: 3, boardId: 103 });

  assert.equal(await kit.run(), 3);
  did(kit, REST_OF_MISSION, REST_TEXTS);
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", calls: 6 }));
  assert.equal(alarmIn(kit), null);
  assert.deepEqual(kit.errors, []);
});

test("a chat nobody has written to keeps nothing: a stray alarm or an unknown update leaves no trace", async () => {
  const kit = makeChat();

  await kit.logic.tick();
  assert.equal(kit.storage.map.size, 0);
  assert.equal(alarmIn(kit), null);

  // Telegram sends many kinds of update; one that belongs to no chat is put aside.
  const answer = await kit.logic.handleUpdate({ update: { update_id: 1, poll: {} }, config: kit.config, access: AS_OWNER });
  assert.deepEqual(answer, { ok: true, ignored: true });
  assert.equal(kit.storage.map.size, 0);
  assert.equal(alarmIn(kit), null);
  did(kit, []);
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ groups
// A third person in the group: allowed to use the bot, but not the one who started the job.
const CITRA = { id: 9003, is_bot: false, first_name: "Citra", language_code: "en" };
const GROUP_HELLO =
  "👋 I am GlowBot. In a group I answer commands and replies to my messages. Try <code>/lead your goal</code>, or /help.";
const NOT_YOURS = "Only the person who started it, or the owner, can do that.";

test("a mission in a group: it belongs to the member who asked, and only the report replies to them", async () => {
  const kit = makeChat({ rules: BAKERY_RULES, chat: GROUP_CHAT });
  const starter = { from: FRIEND, access: AS_MEMBER };
  const other = { from: CITRA, access: AS_MEMBER };

  // The owner adds the bot: one greeting. Being made an admin later is not a new arrival.
  await kit.member("member");
  did(kit, ["sendMessage"], [GROUP_HELLO]);
  await kit.member("administrator", { was: "member" });
  did(kit, []);

  // Ordinary group talk is not for the bot.
  await kit.say("hello everyone");
  did(kit, []);
  assert.equal(kit.logic.state.job, null);

  // A mention is. The name is taken off the goal, and the answer hangs under the asking message.
  await kit.say(`@glow_test_bot ${BAKERY_GOAL}`, starter);
  did(kit, [`sendMessage silent re 2 ${STOP_BUTTON}`], ["👑 GlowLead is planning…"]);
  assert.deepEqual(job(kit, "goal", "by", "replyTo", "statusId"), { goal: BAKERY_GOAL, by: 9002, replyTo: 2, statusId: 102 });

  await kit.tickOnce();
  did(kit, [`sendMessage re 2 ${PLAN_BUTTONS}`, "deleteMessage #102"], [BAKERY_PLAN_TEXT]);
  assert.deepEqual(job(kit, "status", "planId"), { status: "awaiting", planId: 103 });

  // Somebody else can neither run it, nor stop it, nor change it.
  await kit.tap("run:1", 103, other);
  did(kit, [`alert: ${NOT_YOURS}`]);
  await kit.say("/stop", other);
  did(kit, ["sendMessage re 3"], [NOT_YOURS]);
  await kit.say("make it shorter", { ...other, replyTo: 103 });
  did(kit, [`sendMessage re 4 ${STOP_BUTTON}`], [BUSY]);
  assert.deepEqual(job(kit, "status", "planId"), { status: "awaiting", planId: 103 });
  assert.equal(kit.models.calls.length, 1);

  // The member who asked can. The board is a message of its own, not a reply.
  await kit.tap("run:1", 103, starter);
  did(kit, ["toast: OK", "editMessageReplyMarkup #103 []", `sendMessage silent ${BOARD_BUTTONS}`]);
  assert.deepEqual(job(kit, "status", "boardId"), { status: "active", boardId: 106 });

  assert.equal(await kit.run(), 5);
  did(
    kit,
    [
      `editMessageText #106 ${BOARD_BUTTONS}`,
      "sendMessage silent",
      "sendMessage silent",
      "sendMessage silent",
      `editMessageText #106 ${BOARD_BUTTONS}`,
      `editMessageText #106 ${BOARD_BUTTONS}`,
      "sendMessage silent",
      `editMessageText #106 ${BOARD_BUTTONS}`,
      "sendMessage re 2",
      "editMessageText #106 []",
    ],
    [WORKING, BUILDER_POST, CRITIC_POST, ...REST_TEXTS],
  );
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", calls: 6 }));
  assert.deepEqual(kit.registry.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("what a group hears: commands for this bot, and nothing meant for another bot or for nobody", async () => {
  const kit = makeChat({ rules: BAKERY_RULES, chat: GROUP_CHAT });

  // Another bot's command, a command that may be another bot's, and a bare mention: silence.
  await kit.say("/help@other_bot");
  await kit.say("/nonsense");
  did(kit, []);
  await kit.say("/nonsense@glow_test_bot");
  did(kit, ["sendMessage re 3"], ["I do not know that command. /help shows what I can do."]);
  await kit.say("@glow_test_bot");
  did(kit, []);

  await kit.say("/start");
  did(kit, ["sendMessage re 5"], [GROUP_HELLO]);

  // Telegram allows mini-app buttons in private chats only, so a group gets plain links.
  await kit.say("/apps");
  const [apps] = kit.fresh();
  assert.equal(apps.payload.text, "Open a Glow app:");
  assert.equal(apps.payload.reply_parameters.message_id, 6);
  assert.deepEqual(buttonsOf(apps.payload), [
    [`${PAGES}/`, `${PAGES}/lead/`],
    [`${PAGES}/chat/mobile.html`, `${PAGES}/room/mobile.html`],
    [`${PAGES}/news/`, `${PAGES}/spark/`],
    [`${PAGES}/harness/`, `${PAGES}/code/`],
    [`${PAGES}/bot/`],
  ]);
  const buttons = apps.payload.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.every((button) => typeof button.url === "string" && !("web_app" in button)));

  // A member starts a job with a command; the owner may stop anybody's job.
  await kit.say(`/lead@glow_test_bot ${BAKERY_GOAL}`, { from: FRIEND, access: AS_MEMBER });
  did(kit, [`sendMessage silent re 7 ${STOP_BUTTON}`], ["👑 GlowLead is planning…"]);
  assert.deepEqual(job(kit, "goal", "by", "statusId"), { goal: BAKERY_GOAL, by: 9002, statusId: 104 });

  await kit.say("/stop");
  did(kit, ["editMessageText #104 []", "sendMessage re 8"], ["⏹ Stopped.", "⏹ Stopped."]);
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", status: "stopped", calls: 0, models: [] }));
  assert.equal(alarmIn(kit), null);
  assert.deepEqual(kit.registry.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("the bot is removed from a group in the middle of a job: the job ends and nothing more is sent", async () => {
  const kit = makeChat({ rules: BAKERY_RULES, chat: GROUP_CHAT });
  await kit.say(`/lead ${BAKERY_GOAL}`);
  did(kit, [`sendMessage silent re 1 ${STOP_BUTTON}`]);
  assert.equal(alarmIn(kit), 0);

  await kit.member("left", { was: "member" });
  did(kit, []);
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", status: "stopped", calls: 0, models: [] }));
  assert.equal(alarmIn(kit), null);
  assert.equal(await kit.run(), 0);
  assert.equal(kit.models.calls.length, 0);
  assert.deepEqual(kit.registry.calls, []);
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ strangers
// Somebody the owner has not let in.
const STRANGER = { id: 9009, is_bot: false, first_name: "Stranger", language_code: "en" };
const LEAVING = "🔒 This bot is private, so I am leaving this group. Its owner can add me.";
const PRIVATE_NOTICE = "🔒 This bot is private. Only its owner can let this chat in.";
const PRIVATE_ALERT = "alert: This bot is private.";

test("a stranger adds the bot to their group: it says why, leaves, and the group is forgotten", async () => {
  const kit = makeChat({ rules: BAKERY_RULES, chat: GROUP_CHAT });

  await kit.member("member", { from: STRANGER, access: AS_STRANGER });
  const calls = kit.fresh();
  assert.deepEqual(outline(calls), ["sendMessage", "leaveChat"]);
  assert.deepEqual(texts(calls), [LEAVING]);
  assert.deepEqual(calls[1].payload, { chat_id: GROUP_CHAT.id });
  assert.deepEqual(kit.registry.calls, [["forget", GROUP_CHAT.id]]);
  assert.equal(kit.logic.state.job, null);
  assert.equal(alarmIn(kit), null);
  assert.deepEqual(kit.errors, []);
});

test("a stranger writes in a group the owner never let in: the bot leaves instead of answering", async () => {
  const kit = makeChat({ rules: BAKERY_RULES, chat: GROUP_CHAT });
  const stranger = { from: STRANGER, access: AS_STRANGER };

  // The notice is a message of its own: it is for the whole group, not an answer to the command.
  await kit.say(`/lead ${BAKERY_GOAL}`, stranger);
  did(kit, ["sendMessage", "leaveChat"], [LEAVING]);
  assert.deepEqual(kit.registry.calls, [["forget", GROUP_CHAT.id]]);
  assert.equal(kit.logic.state.job, null);

  // A button somebody still has on screen gets a short answer and nothing else.
  await kit.tap("run:1", 55, stranger);
  did(kit, [PRIVATE_ALERT]);
  assert.deepEqual(kit.registry.calls, [["forget", GROUP_CHAT.id]]);
  assert.equal(kit.models.calls.length, 0);
  assert.equal(alarmIn(kit), null);
  assert.deepEqual(kit.errors, []);
});

test("a stranger in a private chat is told once an hour that the bot is private, and no work starts", async () => {
  const kit = makeChat({ rules: BAKERY_RULES, chat: { id: STRANGER.id, type: "private" } });
  const stranger = { from: STRANGER, access: AS_STRANGER };

  await kit.say(BAKERY_GOAL, stranger);
  did(kit, ["sendMessage"], [PRIVATE_NOTICE]);
  await kit.say("hello?", stranger);
  did(kit, []);

  kit.now.advance(3_600_000);
  await kit.say("anyone there?", stranger);
  did(kit, ["sendMessage"], [PRIVATE_NOTICE]);

  // The owner resets the bot, so for now it has no owner at all. The words change; the one
  // notice an hour stays, whatever it says.
  const unclaimed = { from: STRANGER, access: { ...AS_STRANGER, ownerKnown: false } };
  await kit.say("/start", unclaimed);
  did(kit, []);
  kit.now.advance(3_600_000);
  await kit.say("/start", unclaimed);
  did(kit, ["sendMessage"], ["This bot is not set up yet. Its owner has to finish the setup first."]);

  await kit.tap("run:1", 55, stranger);
  did(kit, [PRIVATE_ALERT]);

  assert.equal(kit.logic.state.job, null);
  assert.equal(kit.models.calls.length, 0);
  assert.deepEqual(kit.registry.calls, []);
  assert.equal(alarmIn(kit), null);
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ the simulator (record mode)
// A simulated chat runs the same code as a real one, but writes every Telegram call down instead
// of sending it. Each test ends by checking that the real Telegram stand-in was never called.
const UNTOUCHED = { calls: [], last: 0, alarm: null, mode: "lead", lang: null, job: null, done: null, outbox: 0 };
const MINUTE = 60 * 1000;
const HALF_HOUR = 30 * MINUTE;

// The rows written down after row `since`, and the message ids the bot's new messages were given.
const rowsAfter = async (kit, since = 0) => (await kit.logic.transcript(since)).calls;
const messageIds = (rows) => rows.filter((row) => row.messageId).map((row) => row.messageId);

test("the simulator before anything is typed: an empty transcript, and looking at it stores nothing", async () => {
  const kit = makeChat();
  assert.deepEqual(await kit.logic.transcript(), UNTOUCHED);
  assert.equal(kit.storage.map.size, 0);
  assert.equal(alarmIn(kit), null);
  assert.deepEqual(kit.telegram.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("a simulated mission is written down call by call, and nothing is sent to Telegram", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });

  // The goal: the tester's message is row 1, the bot's "planning…" line is row 2.
  assert.deepEqual(await kit.logic.simulate({ text: BAKERY_GOAL }), { last: 2 });
  let seen = await kit.logic.transcript();
  assert.deepEqual(seen.calls[0], { n: 1, at: START, method: "incoming", payload: { text: BAKERY_GOAL, message_id: 1 } });
  assert.deepEqual(outline(seen.calls), ["incoming #1", `sendMessage silent ${STOP_BUTTON}`]);
  assert.deepEqual(texts(seen.calls), [BAKERY_GOAL, "👑 GlowLead is planning…"]);
  assert.deepEqual(messageIds(seen.calls), [2]);
  assert.equal(seen.lang, "en");
  assert.deepEqual(seen.job, {
    id: "1",
    kind: "lead",
    status: "active",
    phase: "plan",
    calls: 0,
    retries: 0,
    models: [],
    error: "",
    steps: [],
  });

  // A pretend chat with a pretend bot: no token, and half an hour to live.
  const state = kit.logic.state;
  assert.deepEqual(pick(state, ["chatId", "chatType", "record", "lang", "msgSeq", "recSeq"]), {
    chatId: 4242,
    chatType: "private",
    record: true,
    lang: "en",
    msgSeq: 2,
    recSeq: 2,
  });
  assert.deepEqual(state.config, { token: "", botUsername: "glow_sim_bot", botId: 1, origin: "", public: false });
  assert.equal(state.wipeAt - kit.now(), HALF_HOUR);
  assert.equal(kit.storage.map.size, 3);
  assert.equal(alarmIn(kit), 0);

  // The plan. With the job waiting for Run, the only alarm left is the wipe.
  assert.equal(await kit.run(), 1);
  seen = await kit.logic.transcript(2);
  assert.deepEqual(outline(seen.calls), [`sendMessage ${PLAN_BUTTONS}`, "deleteMessage #2"]);
  assert.deepEqual(texts(seen.calls), [BAKERY_PLAN_TEXT]);
  assert.deepEqual(messageIds(seen.calls), [3]);
  assert.equal(seen.last, 4);
  assert.equal(seen.alarm, START + HALF_HOUR);
  assert.deepEqual(pick(seen.job, ["status", "phase", "calls", "models", "steps"]), {
    status: "awaiting",
    phase: "work",
    calls: 1,
    models: MODELS,
    steps: [
      { title: "Decide the tone", bot: null, worker: "council", status: "queued" },
      { title: "Write the message", bot: null, worker: "chat", status: "queued" },
    ],
  });
  assert.equal(kit.storage.map.size, 5);

  // A tap without a message id finds the newest message that carries that button.
  assert.deepEqual(await kit.logic.simulate({ callback: "run:1" }), { last: 8 });
  seen = await kit.logic.transcript(4);
  assert.deepEqual(seen.calls[0].payload, { tap: "run:1", message_id: 3 });
  assert.deepEqual(seen.calls[1].payload, { callback_query_id: "sim-5", text: "OK", show_alert: false });
  assert.deepEqual(outline(seen.calls), [
    "incoming #3",
    "toast: OK",
    "editMessageReplyMarkup #3 []",
    `sendMessage silent ${BOARD_BUTTONS}`,
  ]);
  assert.equal(seen.calls[3].payload.text, bakeryBoard("Working · step 1 of 2", "▫️", "▫️"));
  assert.deepEqual(messageIds(seen.calls), [4]);
  assert.equal(seen.alarm, START);

  // The work, the review and the report: the same sixteen calls a real chat gets.
  assert.equal(await kit.run(), 5);
  seen = await kit.logic.transcript(8);
  assert.deepEqual(outline(seen.calls), [
    `editMessageText #4 ${BOARD_BUTTONS}`,
    "sendMessage silent",
    "sendMessage silent",
    "sendMessage silent",
    `editMessageText #4 ${BOARD_BUTTONS}`,
    `editMessageText #4 ${BOARD_BUTTONS}`,
    "sendMessage silent",
    `editMessageText #4 ${BOARD_BUTTONS}`,
    "sendMessage",
    "editMessageText #4 []",
  ]);
  assert.deepEqual(texts(seen.calls), [WORKING, BUILDER_POST, CRITIC_POST, ...REST_TEXTS]);
  assert.deepEqual(messageIds(seen.calls), [5, 6, 7, 8, 9]);
  assert.equal(seen.last, 18);
  assert.equal(seen.job, null);
  assert.deepEqual(seen.done, record({ kind: "lead", calls: 6 }));
  assert.equal(seen.alarm, START + HALF_HOUR);

  // One state entry and eighteen rows. What the simulator page gets never holds the chat's settings.
  const whole = await kit.logic.transcript();
  assert.deepEqual(whole.calls.map((row) => row.n), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.ok(whole.calls.every((row) => row.at === START));
  assert.equal(kit.storage.map.size, 19);
  assert.doesNotMatch(JSON.stringify(whole), /config|token/);

  assert.deepEqual(kit.telegram.calls, []);
  assert.deepEqual(kit.registry.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("a simulated chat is wiped half an hour after its last message, and then starts from nothing", async () => {
  const kit = makeChat();

  // Every message starts the half hour again.
  await kit.logic.simulate({ text: "/status" });
  kit.now.advance(10 * MINUTE);
  await kit.logic.simulate({ text: "/status" });
  assert.equal(kit.logic.state.wipeAt - kit.now(), HALF_HOUR);
  assert.equal(alarmIn(kit), 1800);
  assert.equal(kit.storage.map.size, 5);

  assert.equal(await kit.run({ forMs: 29 * MINUTE }), 0);
  assert.equal(kit.storage.map.size, 5);

  assert.equal(await kit.run({ forMs: 31 * MINUTE }), 1);
  assert.equal(kit.logic.state, null);
  assert.equal(kit.storage.map.size, 0);
  assert.equal(alarmIn(kit), null);

  // Looking at the empty chat does not bring anything back; the next message is row 1 again.
  assert.deepEqual(await kit.logic.transcript(), UNTOUCHED);
  assert.equal(kit.storage.map.size, 0);
  assert.deepEqual(await kit.logic.simulate({ text: "/status" }), { last: 2 });
  assert.deepEqual(outline(await rowsAfter(kit)), ["incoming #1", "sendMessage"]);

  assert.deepEqual(kit.telegram.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("the wipe also ends a simulated mission that was left paused", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await kit.logic.simulate({ text: BAKERY_GOAL });
  await kit.run();
  await kit.logic.simulate({ callback: "run:1" });
  await kit.tickOnce();
  await kit.logic.simulate({ callback: "pau:1" });
  assert.deepEqual(job(kit, "status", "calls"), { status: "paused", calls: 2 });
  assert.equal(alarmIn(kit), 1800);
  assert.equal(kit.storage.map.size, 14);

  assert.equal(await kit.run({ forMs: 31 * MINUTE }), 1);
  assert.equal(kit.logic.state, null);
  assert.equal(kit.storage.map.size, 0);
  assert.equal(alarmIn(kit), null);
  assert.equal(kit.models.calls.length, 2);
  assert.deepEqual(kit.telegram.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("a simulated tap on a button that is nowhere on screen gets the older-job answer", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await kit.logic.simulate({ text: BAKERY_GOAL });
  await kit.run();

  // The plan is waiting, so no message carries a Resume button: the tap belongs to message 0.
  assert.deepEqual(await kit.logic.simulate({ callback: "res:1" }), { last: 6 });
  let rows = await rowsAfter(kit, 4);
  assert.deepEqual(rows[0].payload, { tap: "res:1", message_id: 0 });
  assert.deepEqual(rows[1].payload, { callback_query_id: "sim-5", text: STALE, show_alert: false });
  assert.deepEqual(outline(rows), ["incoming", `toast: ${STALE}`]);
  assert.deepEqual(job(kit, "status", "planId"), { status: "awaiting", planId: 3 });

  // A tap may also name its message, the way a page that shows the buttons would send it.
  assert.deepEqual(await kit.logic.simulate({ callback: "run:1", messageId: 3 }), { last: 10 });
  rows = await rowsAfter(kit, 6);
  assert.equal(rows[1].payload.callback_query_id, "sim-7");
  assert.deepEqual(outline(rows), [
    "incoming #3",
    "toast: OK",
    "editMessageReplyMarkup #3 []",
    `sendMessage silent ${BOARD_BUTTONS}`,
  ]);
  assert.deepEqual(messageIds(rows), [4]);
  assert.deepEqual(job(kit, "status", "boardId"), { status: "active", boardId: 4 });

  assert.deepEqual(kit.telegram.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("a simulated GlowHarness run asks before it saves a note, and saves it after Approve", async () => {
  const kit = makeChat({ rules: [[HARNESS, inTurn([SAVE_WIFI, "FINAL Saved your wifi name."])]] });

  assert.deepEqual(await kit.logic.simulate({ text: WIFI_TASK }), { last: 2 });
  assert.equal(await kit.run(), 1);
  let rows = await rowsAfter(kit);
  assert.deepEqual(outline(rows), [
    "incoming #1",
    `sendMessage silent ${STOP_BUTTON}`,
    'sendMessage [["ok:1:0","no:1:0"]]',
  ]);
  assert.deepEqual(texts(rows), [WIFI_TASK, "🧰 GlowHarness is working…", WIFI_QUESTION]);
  assert.deepEqual(messageIds(rows), [2, 3]);
  assert.deepEqual((await kit.logic.transcript()).job, {
    id: "1",
    kind: "agent",
    status: "awaiting",
    phase: "work",
    calls: 1,
    retries: 0,
    models: MODELS,
    error: "",
    steps: [],
  });
  assert.equal(kit.storage.map.size, 4);
  assert.equal(kit.logic.state.notes, "");

  assert.deepEqual(await kit.logic.simulate({ callback: "ok:1:0" }), { last: 6 });
  assert.equal(await kit.run(), 1);
  rows = await rowsAfter(kit, 3);
  assert.deepEqual(rows[0].payload, { tap: "ok:1:0", message_id: 3 });
  assert.equal(rows[1].payload.callback_query_id, "sim-4");
  assert.deepEqual(outline(rows), ["incoming #3", "toast: OK", "editMessageText #3 []", "sendMessage", "deleteMessage #2"]);
  assert.deepEqual(texts(rows), [
    "OK",
    `${WIFI_QUESTION}\n\n✅ Approved.`,
    `🧰 <b>GlowHarness</b>\n\nSaved your wifi name.\n\n<i>Tool calls: 1</i>\n${MODELS_LINE}`,
  ]);
  assert.deepEqual(messageIds(rows), [4]);

  assert.deepEqual(kit.logic.state.done, record({ kind: "agent", calls: 2 }));
  assert.deepEqual(JSON.parse(kit.logic.state.notes), {
    v: 1,
    items: [{ id: "wifi", key: "wifi", value: "glow-5g", at: "2026-11-12" }],
  });
  assert.deepEqual(kit.telegram.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("the simulator keeps only the newest 200 rows", async () => {
  const kit = makeChat();
  let answer = null;
  for (let turn = 0; turn < 101; turn += 1) answer = await kit.logic.simulate({ text: "/stop" });
  assert.deepEqual(answer, { last: 202 });

  // 101 messages and 101 answers make 202 rows; the two oldest are gone.
  const seen = await kit.logic.transcript();
  assert.equal(seen.calls.length, 200);
  assert.equal(seen.calls[0].n, 3);
  assert.equal(seen.calls[199].n, 202);
  assert.equal(seen.last, 202);
  assert.equal(kit.storage.map.size, 201);

  const newest = await rowsAfter(kit, 200);
  assert.deepEqual(outline(newest), ["incoming #201", "sendMessage"]);
  assert.deepEqual(texts(newest), ["/stop", "Nothing is running."]);
  assert.deepEqual(messageIds(newest), [202]);
  assert.deepEqual(kit.telegram.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("a simulated reply to the last report starts a follow-up that knows the earlier result", async () => {
  const kit = makeChat({ rules: YEAST_RULES });

  await kit.logic.simulate({ text: YEAST_GOAL });
  assert.equal(await kit.run(), 2);
  const rows = await rowsAfter(kit);
  assert.deepEqual(outline(rows), [
    "incoming #1",
    `sendMessage silent ${STOP_BUTTON}`,
    `editMessageText #2 ${BOARD_BUTTONS}`,
    `editMessageText #2 ${BOARD_BUTTONS}`,
    "sendMessage",
    "deleteMessage #2",
  ]);
  assert.equal(rows[4].payload.text, YEAST_REPORT_TEXT);
  assert.deepEqual(messageIds(rows), [2, 3]);
  assert.deepEqual(kit.logic.state.last, {
    jobId: "1",
    goal: YEAST_GOAL,
    report: "Yeast eats sugar and makes gas.",
    messageIds: [3],
  });

  // The tester's messages and the bot's share one counter, so this message is number 4.
  assert.deepEqual(await kit.logic.simulate({ text: "Why does bread rise?", replyTo: 3 }), { last: 8 });
  const [asked] = await rowsAfter(kit, 6);
  assert.deepEqual(asked.payload, { text: "Why does bread rise?", message_id: 4 });
  assert.deepEqual(job(kit, "goal", "context"), {
    goal: "Why does bread rise?",
    context: `Goal: ${YEAST_GOAL}\n\nResult:\nYeast eats sugar and makes gas.`,
  });
  assert.deepEqual(kit.telegram.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("a real chat cannot be turned into a simulated one", async () => {
  const kit = makeChat();
  await kit.say("/help");
  assert.equal(kit.fresh().length, 1);

  await assert.rejects(kit.logic.simulate({ text: "hello" }), /This is a real chat, not a simulated one\./);
  assert.equal(kit.logic.state.record, false);
  assert.deepEqual([...kit.storage.map.keys()], ["chat"]);
  assert.deepEqual((await kit.logic.transcript()).calls, []);
  did(kit, []);
  assert.deepEqual(kit.errors, []);
});

test("the simulator can pretend to be a group and can speak another language", async () => {
  const kit = makeChat();

  assert.deepEqual(await kit.logic.simulate({ text: "/help", chatType: "group", lang: "id" }), { last: 2 });
  assert.deepEqual(pick(kit.logic.state, ["chatId", "chatType", "lang"]), {
    chatId: -1004242,
    chatType: "supergroup",
    lang: "id",
  });
  assert.equal(alarmIn(kit), 1800);

  // In a group the help is threaded under the command and leaves the owner's command out.
  const [, help] = await rowsAfter(kit);
  assert.match(help.payload.text, /^<b>GlowBot: yang bisa kulakukan<\/b>/);
  assert.deepEqual(help.payload.reply_parameters, { message_id: 1, allow_sending_without_reply: true });
  assert.doesNotMatch(help.payload.text, /\/access/);
  assert.deepEqual(kit.telegram.calls, []);
  assert.deepEqual(kit.errors, []);
});

test("the simulated tester is the owner of a private chat, and an unknown language changes nothing", async () => {
  const kit = makeChat();

  await kit.logic.simulate({ text: "/help" });
  await kit.logic.simulate({ text: "/status" });
  const rows = await rowsAfter(kit);
  assert.deepEqual(outline(rows), ["incoming #1", "sendMessage", "incoming #3", "sendMessage"]);
  assert.deepEqual(messageIds(rows), [2, 4]);

  // The owner's help ends with the owner's command; the owner has no daily limit.
  assert.deepEqual(rows[1].payload.text.split("\n").slice(-2), [
    "<b>Owner</b>",
    "/access · who can use this bot: private or public",
  ]);
  assert.equal(
    rows[3].payload.text,
    [
      "<b>GlowBot 1.32.0</b>",
      "Mode: GlowLead",
      "Language: English",
      "Access: private",
      "Running: nothing",
      "Jobs today: 0 (no limit for you)",
      "Daily news: off",
    ].join("\n"),
  );

  assert.deepEqual(await kit.logic.simulate({ text: "/status", lang: "xx" }), { last: 6 });
  assert.equal(kit.logic.state.lang, "en");
  assert.deepEqual(kit.telegram.calls, []);
  assert.deepEqual(kit.registry.calls, []);
  assert.deepEqual(kit.errors, []);
});
