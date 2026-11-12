// The chat's jobs from start to finish: a GlowLead mission, the crew, single agents, GlowSpark and
// GlowHarness, and what Stop, Pause, a changed plan and a follow-up do to them.
// Commands are in chat.test.js; failures, groups and record mode in chat-edge.test.js.

import test from "node:test";
import assert from "node:assert/strict";

import { inTurn } from "./fakes.js";
import {
  BAKERY_GOAL,
  BAKERY_PLAN,
  BAKERY_PLAN_TEXT,
  BAKERY_REPORT_TEXT,
  BAKERY_RULES,
  BOARD_BUTTONS,
  BUSY,
  BYTE,
  CRITIC,
  GLOWCHAT,
  HARNESS,
  MODELS_LINE,
  NOVA_PLAN,
  PIXEL,
  PLAN,
  PLAN_BUTTONS,
  SAVE_WIFI,
  SECOND_PLAN,
  SECOND_PLAN_TEXT,
  STALE,
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
  call,
  council,
  did,
  job,
  makeChat,
  record,
} from "./chat-kit.js";

// ------------------------------------------------------------------ missions
test("a GlowLead mission: the plan waits for Run, then the agents work and GlowLead reports", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });

  await kit.say(BAKERY_GOAL);
  did(kit, [`sendMessage silent ${STOP_BUTTON}`], ["👑 GlowLead is planning…"]);
  assert.deepEqual(job(kit, "kind", "status", "phase", "calls", "statusId"), {
    kind: "lead",
    status: "active",
    phase: "plan",
    calls: 0,
    statusId: 101,
  });
  assert.equal(alarmIn(kit), 0);

  // The plan is a new message, so the phone pings, and the "planning…" line goes away.
  await kit.tickOnce();
  did(kit, [`sendMessage ${PLAN_BUTTONS}`, "deleteMessage #101"], [BAKERY_PLAN_TEXT]);
  assert.deepEqual(job(kit, "status", "phase", "calls", "statusId", "planId"), {
    status: "awaiting",
    phase: "work",
    calls: 1,
    statusId: null,
    planId: 102,
  });
  assert.equal(alarmIn(kit), null);

  await kit.tap("run:1", 102);
  did(kit, ["toast: OK", "editMessageReplyMarkup #102 []", `sendMessage silent ${BOARD_BUTTONS}`], [
    "OK",
    bakeryBoard("Working · step 1 of 2", "▫️", "▫️"),
  ]);
  assert.deepEqual(job(kit, "status", "boardId", "planId"), { status: "active", boardId: 103, planId: null });
  assert.equal(alarmIn(kit), 0);

  // The council is three voices, one on each tick.
  await kit.tickOnce();
  did(kit, [`editMessageText #103 ${BOARD_BUTTONS}`, "sendMessage silent"], [
    bakeryBoard("Working · step 1 of 2", "⏳", "▫️"),
    council("Builder", "Builder: go warm."),
  ]);
  await kit.tickOnce();
  did(kit, ["sendMessage silent"], [council("Critic", "Critic: too long.")]);
  await kit.tickOnce();
  did(kit, ["sendMessage silent", `editMessageText #103 ${BOARD_BUTTONS}`], [
    council("Judge", "Judge: warm and short."),
    bakeryBoard("Working · step 2 of 2", "✅", "▫️"),
  ]);

  await kit.tickOnce();
  did(kit, [`editMessageText #103 ${BOARD_BUTTONS}`, "sendMessage silent", `editMessageText #103 ${BOARD_BUTTONS}`], [
    bakeryBoard("Working · step 2 of 2", "✅", "⏳"),
    WELCOME_POST,
    bakeryBoard("Checking the work", "✅", "✅"),
  ]);
  assert.deepEqual(job(kit, "status", "phase", "calls"), { status: "active", phase: "check", calls: 5 });

  // Of all the work, only the report makes a sound.
  await kit.tickOnce();
  did(kit, ["sendMessage", "editMessageText #103 []"], [BAKERY_REPORT_TEXT, bakeryBoard("Done", "✅", "✅")]);

  const { state } = kit.logic;
  assert.equal(state.job, null);
  assert.deepEqual(state.done, record({ kind: "lead", calls: 6 }));
  assert.deepEqual(state.last, {
    jobId: "1",
    goal: BAKERY_GOAL,
    report: "Welcome to our bakery!",
    messageIds: [108],
  });
  assert.equal(alarmIn(kit), null);
  assert.equal(kit.models.calls.length, 6);
  assert.equal(kit.telegram.typing.length, 6);
  assert.deepEqual(kit.errors, []);
});

test("a goal with a one-step plan skips the approval and answers on the placeholder", async () => {
  const kit = makeChat({ rules: YEAST_RULES });
  const board = (mark) => `👑 <b>Mission</b>: ${YEAST_GOAL}\nWorking · step 1 of 1\n${mark} 💬 GlowChat: Explain it`;

  await kit.say(YEAST_GOAL);
  await kit.tickOnce();
  assert.deepEqual(job(kit, "status", "phase", "calls", "statusId", "boardId", "planId"), {
    status: "active",
    phase: "work",
    calls: 1,
    statusId: null,
    boardId: 101,
    planId: null,
  });
  assert.equal(await kit.run(), 1);

  did(
    kit,
    [
      `sendMessage silent ${STOP_BUTTON}`,
      `editMessageText #101 ${BOARD_BUTTONS}`,
      `editMessageText #101 ${BOARD_BUTTONS}`,
      "sendMessage",
      "deleteMessage #101",
    ],
    ["👑 GlowLead is planning…", board("▫️"), board("⏳"), YEAST_REPORT_TEXT],
  );
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", calls: 2 }));
  assert.deepEqual(kit.logic.state.last, {
    jobId: "1",
    goal: YEAST_GOAL,
    report: "Yeast eats sugar and makes gas.",
    messageIds: [102],
  });
  assert.deepEqual(kit.errors, []);
});

test("/room with one step: the crew member's answer is the result", async () => {
  const goal = "Announce the Raspberry Pi 5 price to my club";
  const kit = makeChat({
    rules: [
      [NOVA_PLAN, '{"steps":[{"bot":"media","task":"Write a short club post"}]}'],
      [PIXEL, "Good news, club: the Pi 5 is $80!"],
    ],
  });
  const board = (stateLine, mark) => `🏢 <b>GlowRoom</b>: ${goal}\n${stateLine}\n${mark} 🎨 Pixel: Write a short club post`;

  await kit.say(`/room ${goal}`);
  did(kit, [`sendMessage silent ${STOP_BUTTON}`], ["🏢 Nova is planning the crew's work…"]);
  assert.deepEqual(job(kit, "kind", "status", "phase", "statusId"), {
    kind: "room",
    status: "active",
    phase: "plan",
    statusId: 101,
  });
  assert.equal(alarmIn(kit), 0);

  // The crew asks for no approval: the placeholder itself turns into the board.
  await kit.tickOnce();
  did(kit, [`editMessageText #101 ${BOARD_BUTTONS}`], [board("Working · step 1 of 1", "▫️")]);
  assert.deepEqual(job(kit, "status", "phase", "calls", "statusId", "boardId"), {
    status: "active",
    phase: "work",
    calls: 1,
    statusId: null,
    boardId: 101,
  });

  await kit.tickOnce();
  did(kit, [`editMessageText #101 ${BOARD_BUTTONS}`, "sendMessage", "editMessageText #101 []"], [
    board("Working · step 1 of 1", "⏳"),
    `🎨 <b>Pixel</b>\n\nGood news, club: the Pi 5 is $80!\n\n${MODELS_LINE}`,
    board("Done", "✅"),
  ]);
  assert.deepEqual(kit.logic.state.done, record({ kind: "room", calls: 2 }));
  // Only a GlowLead report can be followed up by replying to it.
  assert.equal(kit.logic.state.last, null);
  assert.equal(kit.telegram.typing.length, 2);
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ one agent at a time
test("/ask sends one task to one agent", async () => {
  const kit = makeChat({ rules: [[BYTE, "```js\nconsole.log(1)\n```"]] });

  await kit.say("/ask byte Write hello world in JS");
  did(kit, []);
  assert.deepEqual(job(kit, "kind", "status", "phase"), { kind: "ask", status: "active", phase: "work" });
  assert.equal(alarmIn(kit), 0);

  await kit.tickOnce();
  did(kit, ["sendMessage"], [`💻 <b>Byte</b>\n\n<pre>console.log(1)</pre>\n\n${MODELS_LINE}`]);
  assert.equal(kit.models.calls[0].user, "Your task: Write hello world in JS");
  assert.deepEqual(kit.logic.state.done, record({ kind: "ask", calls: 1 }));
  assert.equal(kit.logic.state.last, null);
  assert.deepEqual(kit.errors, []);
});

test("/chat remembers the conversation", async () => {
  const kit = makeChat({ rules: [[GLOWCHAT, inTurn(["Hello **Juwen**.", "Your name is **Juwen**."])]] });

  await kit.say("/chat My name is Juwen");
  did(kit, []);
  await kit.tickOnce();
  did(kit, ["sendMessage"], ["Hello <b>Juwen</b>."]);
  assert.deepEqual(kit.logic.state.done, record({ kind: "chat", calls: 1 }));

  await kit.say("/chat What is my name?");
  await kit.tickOnce();
  did(kit, ["sendMessage"], ["Your name is <b>Juwen</b>."]);
  assert.equal(kit.logic.state.done.id, "2");

  // The second question reached the model together with the first exchange.
  const asked = kit.models.calls[1].messages;
  assert.ok(asked[0].content.startsWith("You are GlowChat, the Glow AI assistant,"));
  assert.deepEqual(
    asked.map((message) => message.role),
    ["system", "user", "assistant", "user"],
  );
  assert.deepEqual(
    asked.slice(1).map((message) => message.content),
    ["My name is Juwen", "Hello **Juwen**.", "What is my name?"],
  );
  assert.deepEqual(kit.logic.state.history, [
    { role: "user", content: "My name is Juwen" },
    { role: "assistant", content: "Hello **Juwen**." },
    { role: "user", content: "What is my name?" },
    { role: "assistant", content: "Your name is **Juwen**." },
  ]);
  assert.deepEqual(kit.errors, []);
});

test("/spark writes a tale, and Again writes another from the same opening", async () => {
  const kit = makeChat();
  const opening = "Once there was a fox";
  const tale = [
    "✨ <b>GlowSpark</b>",
    "",
    "Once there was a fox who loved &lt;jam&gt;.",
    "The end.",
    "",
    "<i>A tiny AI we built from scratch. It only knows old storybooks, so it writes tales, not facts.</i>",
  ].join("\n");

  await kit.say(`/spark ${opening}`);
  did(kit, []);
  await kit.tickOnce();
  did(kit, ['sendMessage [["agn:1"]]'], [tale]);
  // GlowSpark is our own tiny model, so no outside model was asked.
  assert.deepEqual(kit.logic.state.done, record({ kind: "spark", calls: 0, models: [] }));

  await kit.tap("agn:1", 101);
  did(kit, ["toast: OK"]);
  await kit.tickOnce();
  did(kit, ['sendMessage [["agn:2"]]'], [tale]);
  assert.deepEqual(kit.logic.state.sparkLast, { id: "2", opening });
  const asked = { opening, options: { maxTokens: 260 } };
  assert.deepEqual(kit.spark.calls, [asked, asked]);

  // The button under the first tale is an old one now.
  await kit.tap("agn:1", 101);
  did(kit, [`toast: ${STALE}`, "editMessageReplyMarkup #101 []"]);
  assert.equal(kit.logic.state.job, null);
  assert.equal(kit.models.calls.length, 0);
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ GlowHarness
test("/agent asks before it saves a note, and saves it after Approve", async () => {
  const kit = makeChat({ rules: [[HARNESS, inTurn([SAVE_WIFI, "FINAL Saved your wifi name."])]] });

  await kit.say(WIFI_TASK);
  did(kit, [`sendMessage silent ${STOP_BUTTON}`], ["🧰 GlowHarness is working…"]);

  await kit.tickOnce();
  did(kit, ['sendMessage [["ok:1:0","no:1:0"]]'], [WIFI_QUESTION]);
  assert.deepEqual(job(kit, "kind", "status", "phase", "calls", "statusId", "askId"), {
    kind: "agent",
    status: "awaiting",
    phase: "work",
    calls: 1,
    statusId: 101,
    askId: 102,
  });
  assert.equal(alarmIn(kit), null);
  assert.equal(kit.logic.state.notes, "");

  await kit.tap("ok:1:0", 102);
  did(kit, ["toast: OK", "editMessageText #102 []"], ["OK", `${WIFI_QUESTION}\n\n✅ Approved.`]);
  assert.deepEqual(job(kit, "status", "askId"), { status: "active", askId: null });

  await kit.tickOnce();
  did(kit, ["sendMessage", "deleteMessage #101"], [
    `🧰 <b>GlowHarness</b>\n\nSaved your wifi name.\n\n<i>Tool calls: 1</i>\n${MODELS_LINE}`,
  ]);
  assert.deepEqual(kit.logic.state.done, record({ kind: "agent", calls: 2 }));
  assert.deepEqual(JSON.parse(kit.logic.state.notes), {
    v: 1,
    items: [{ id: "wifi", key: "wifi", value: "glow-5g", at: "2026-11-12" }],
  });
  assert.deepEqual(kit.errors, []);
});

test("/agent goes on without the note after Decline, and the old Approve button is dead", async () => {
  const kit = makeChat({ rules: [[HARNESS, inTurn([SAVE_WIFI, "FINAL I did not save it."])]] });
  await kit.say(WIFI_TASK);
  await kit.tickOnce();
  kit.fresh();

  await kit.tap("no:1:0", 102);
  did(kit, ["toast: OK", "editMessageText #102 []"], ["OK", `${WIFI_QUESTION}\n\n✖️ Declined.`]);
  assert.deepEqual(job(kit, "status", "phase", "askId"), { status: "active", phase: "work", askId: null });
  assert.equal(alarmIn(kit), 0);

  await kit.tickOnce();
  did(kit, ["sendMessage", "deleteMessage #101"], [
    `🧰 <b>GlowHarness</b>\n\nI did not save it.\n\n<i>Tool calls: 0</i>\n${MODELS_LINE}`,
  ]);
  assert.deepEqual(kit.logic.state.done, record({ kind: "agent", calls: 2 }));

  await kit.tap("ok:1:0", 102);
  did(kit, [`toast: ${STALE}`, "editMessageReplyMarkup #102 []"]);
  assert.equal(kit.logic.state.notes, "");
  assert.deepEqual(kit.errors, []);
});

test("/agent uses a harmless tool without asking", async () => {
  const kit = makeChat({
    rules: [[HARNESS, inTurn([call("calc", { expression: "48217*9364" }), "FINAL **451503988** is the product."])]],
  });

  await kit.say("/agent What is 48217 times 9364?");
  did(kit, [`sendMessage silent ${STOP_BUTTON}`]);
  await kit.tickOnce();
  did(kit, ["sendMessage", "deleteMessage #101"], [
    `🧰 <b>GlowHarness</b>\n\n<b>451503988</b> is the product.\n\n<i>Tool calls: 1</i>\n${MODELS_LINE}`,
  ]);
  assert.deepEqual(kit.logic.state.done, record({ kind: "agent", calls: 2 }));
  assert.equal(kit.models.calls.length, 2);
  assert.equal(kit.telegram.typing.length, 1);
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ Stop, Pause, Resume
test("/stop before the first tick ends the job at once, and a second /stop says nothing is running", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await kit.say(BAKERY_GOAL);
  kit.fresh();

  await kit.say("/stop");
  did(kit, ["editMessageText #101 []", "sendMessage"], ["⏹ Stopped.", "⏹ Stopped."]);
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", status: "stopped", calls: 0, models: [] }));
  assert.equal(alarmIn(kit), null);
  assert.equal(await kit.run(), 0);
  assert.equal(kit.models.calls.length, 0);

  await kit.say("/stop");
  did(kit, ["sendMessage"], ["Nothing is running."]);
  assert.deepEqual(kit.errors, []);
});

test("the Stop button on the board ends a mission in the middle", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await bakeryUpTo(kit, "work");

  await kit.tap("stp:1", 103);
  did(kit, ["toast: ⏹ Stopped.", "editMessageText #103 []"], ["⏹ Stopped.", bakeryBoard("Stopped", "⏳", "▫️")]);
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", status: "stopped", calls: 2 }));
  assert.equal(alarmIn(kit), null);
  assert.equal(await kit.run(), 0);
  assert.equal(kit.models.calls.length, 2);
  assert.deepEqual(kit.errors, []);
});

test("/stop while a model is still answering throws that answer away", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await bakeryUpTo(kit, "board");

  // The tick asks the Builder, and the Builder takes its time.
  const slow = kit.holdModel();
  const ticking = kit.tickOnce();
  await slow.arrived;
  did(kit, [`editMessageText #103 ${BOARD_BUTTONS}`], [bakeryBoard("Working · step 1 of 2", "⏳", "▫️")]);
  assert.deepEqual(job(kit, "status", "phase", "calls"), { status: "active", phase: "work", calls: 2 });

  await kit.say("/stop");
  did(kit, ["editMessageText #103 []", "sendMessage"], [bakeryBoard("Stopped", "⏳", "▫️"), "⏹ Stopped."]);
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", status: "stopped", calls: 2 }));

  // The Builder answers after all, and nobody hears it.
  slow.release();
  await ticking;
  did(kit, []);
  assert.equal(alarmIn(kit), null);
  assert.equal(await kit.run(), 0);
  assert.deepEqual(kit.errors, []);
});

test("Pause holds the mission and Resume carries on", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await bakeryUpTo(kit, "work");

  await kit.tap("pau:1", 103);
  did(kit, ["toast: ⏸ Paused. Tap Resume to go on.", 'editMessageText #103 [["res:1","stp:1"]]'], [
    "⏸ Paused. Tap Resume to go on.",
    bakeryBoard("Paused", "⏳", "▫️"),
  ]);
  assert.deepEqual(job(kit, "status", "phase", "calls"), { status: "paused", phase: "work", calls: 2 });
  assert.equal(alarmIn(kit), null);
  assert.equal(await kit.run(), 0);

  // A second tap on Pause finds nothing left to pause.
  await kit.tap("pau:1", 103);
  did(kit, [`toast: ${STALE}`]);

  await kit.tap("res:1", 103);
  did(kit, ["toast: ▶️ Going on.", `editMessageText #103 ${BOARD_BUTTONS}`], [
    "▶️ Going on.",
    bakeryBoard("Working · step 1 of 2", "⏳", "▫️"),
  ]);
  assert.equal(alarmIn(kit), 0);
  await kit.tap("res:1", 103);
  did(kit, [`toast: ${STALE}`]);

  // The rest of the mission: Critic, Judge, GlowChat, the check and the report.
  assert.equal(await kit.run(), 4);
  did(kit, [
    "sendMessage silent",
    "sendMessage silent",
    `editMessageText #103 ${BOARD_BUTTONS}`,
    `editMessageText #103 ${BOARD_BUTTONS}`,
    "sendMessage silent",
    `editMessageText #103 ${BOARD_BUTTONS}`,
    "sendMessage",
    "editMessageText #103 []",
  ]);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", calls: 6 }));
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ changing the plan
test("typing while the plan waits makes GlowLead write a new plan, and the old plan's buttons stop working", async () => {
  const kit = makeChat({ rules: [[PLAN, inTurn([BAKERY_PLAN, SECOND_PLAN])], ...BAKERY_RULES.slice(1)] });
  await bakeryUpTo(kit, "plan");

  await kit.say("Skip the council, just write it");
  did(kit, ["editMessageReplyMarkup #102 []", `sendMessage silent ${STOP_BUTTON}`], ["👑 GlowLead is changing the plan…"]);
  assert.deepEqual(job(kit, "status", "phase", "calls", "statusId", "planId"), {
    status: "active",
    phase: "plan",
    calls: 1,
    statusId: 103,
    planId: null,
  });
  assert.equal(alarmIn(kit), 0);

  // Run under the old plan, tapped while the new plan is still being written.
  await kit.tap("run:1", 102);
  did(kit, [`toast: ${STALE}`, "editMessageReplyMarkup #102 []"]);
  assert.deepEqual(job(kit, "status", "phase"), { status: "active", phase: "plan" });

  await kit.tickOnce();
  did(kit, [`sendMessage ${PLAN_BUTTONS}`, "deleteMessage #103"], [SECOND_PLAN_TEXT]);
  assert.deepEqual(job(kit, "status", "phase", "calls", "planId"), {
    status: "awaiting",
    phase: "work",
    calls: 2,
    planId: 104,
  });
  assert.equal(alarmIn(kit), null);
  assert.equal(
    kit.models.calls[1].user,
    [
      `Goal: ${BAKERY_GOAL}`,
      "",
      "The plan you made before:",
      "1. [council] Decide the tone: Decide which tone fits a small bakery.",
      "2. [chat] Write the message: Write the welcome message.",
      "",
      "The user wants this changed:",
      "Skip the council, just write it",
      "",
      "Write the complete new plan.",
    ].join("\n"),
  );

  // Run under the old plan once more, now that the new plan waits: it starts nothing.
  await kit.tap("run:1", 102);
  did(kit, [`toast: ${STALE}`, "editMessageReplyMarkup #102 []"]);
  assert.equal(kit.logic.state.job.status, "awaiting");

  await kit.tap("run:1", 104);
  did(kit, ["toast: OK", "editMessageReplyMarkup #104 []", `sendMessage silent ${BOARD_BUTTONS}`], [
    "OK",
    [
      `👑 <b>Mission</b>: ${BAKERY_GOAL}`,
      "Working · step 1 of 2",
      "▫️ 💬 GlowChat: Write the message",
      "▫️ 💬 GlowChat: Shorten it",
    ].join("\n"),
  ]);
  assert.equal(kit.logic.state.job.boardId, 105);
  assert.equal(alarmIn(kit), 0);
  assert.deepEqual(kit.errors, []);
});

test("Change tells how to change the plan, and Cancel drops it", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await bakeryUpTo(kit, "plan");

  await kit.tap("chg:1", 102);
  did(kit, ["toast: OK", "sendMessage re 102"], ["OK", "Reply to the plan with what to change."]);
  assert.deepEqual(job(kit, "status", "planId"), { status: "awaiting", planId: 102 });

  await kit.tap("can:1", 102);
  did(kit, ["toast: OK", "editMessageReplyMarkup #102 []", "sendMessage"], ["OK", "✖️ Cancelled."]);
  assert.equal(kit.logic.state.job, null);
  assert.deepEqual(kit.logic.state.done, record({ kind: "lead", status: "cancelled", calls: 1 }));

  await kit.tap("run:1", 102);
  did(kit, [`toast: ${STALE}`, "editMessageReplyMarkup #102 []"]);
  assert.equal(await kit.run(), 0);
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ while the team works
test("typing while the team works steers the next step", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await bakeryUpTo(kit, "work");

  await kit.say("Make it rhyme");
  did(kit, ["sendMessage"], ["📝 Noted. The team will follow that from the next step."]);
  assert.deepEqual(kit.logic.state.job.steer, ["Make it rhyme"]);

  // The Critic is next. It gets the new instruction with its task, not inside its own rules.
  await kit.tickOnce();
  const critic = kit.models.calls.at(-1);
  assert.match(critic.system, CRITIC);
  assert.ok(!critic.system.includes("Make it rhyme"));
  assert.ok(
    critic.user.endsWith(
      [
        "",
        "Task: Decide which tone fits a small bakery.",
        "",
        "Builder's answer:",
        "Builder: go warm.",
        "",
        "New instructions from the user while you work (follow them):",
        "- Make it rhyme",
      ].join("\n"),
    ),
    critic.user,
  );
  assert.deepEqual(kit.errors, []);
});

test("a new job is refused while one is running", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await bakeryUpTo(kit, "work");

  await kit.say("/room Plan a party");
  did(kit, [`sendMessage ${STOP_BUTTON}`], [BUSY]);
  await kit.say("/chat hello");
  did(kit, [`sendMessage ${STOP_BUTTON}`], [BUSY]);
  assert.deepEqual(job(kit, "id", "kind", "status", "calls"), { id: "1", kind: "lead", status: "active", calls: 2 });
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ follow-ups
test("a reply to the last report starts a follow-up that knows the earlier result", async () => {
  const kit = makeChat({ rules: YEAST_RULES });
  await kit.say(YEAST_GOAL);
  await kit.run();
  kit.fresh();
  const earlier = `Goal: ${YEAST_GOAL}\n\nResult:\nYeast eats sugar and makes gas.`;

  await kit.say("Why does bread rise?", { replyTo: 102 });
  did(kit, ['sendMessage silent [["stp:2"]]'], ["👑 GlowLead is planning…"]);
  assert.equal(kit.logic.state.job.context, earlier);

  await kit.tickOnce();
  assert.equal(
    kit.models.calls[2].user,
    `Goal: Why does bread rise?\n\nThis is a follow-up. Earlier mission and its result:\n${earlier}`,
  );
  assert.deepEqual(kit.errors, []);
});

test("a goal sent as a reply to any other message starts from nothing", async () => {
  const kit = makeChat({ rules: YEAST_RULES });
  await kit.say(YEAST_GOAL);
  await kit.run();

  await kit.say("Why does bread rise?", { replyTo: 55 });
  assert.equal(kit.logic.state.job.context, "");
  await kit.tickOnce();
  assert.equal(kit.models.calls[2].user, "Goal: Why does bread rise?");
  assert.deepEqual(kit.errors, []);
});

// ------------------------------------------------------------------ a planner that fails
test("when the planner fails on a plain goal, GlowChat simply does it", async () => {
  const kit = makeChat({ rules: [[PLAN, new Error("upstream 500")]] });

  await kit.say(BAKERY_GOAL);
  await kit.tickOnce();
  did(kit, [`sendMessage silent ${STOP_BUTTON}`, `editMessageText #101 ${BOARD_BUTTONS}`], [
    "👑 GlowLead is planning…",
    `👑 <b>Mission</b>: ${BAKERY_GOAL}\nWorking · step 1 of 1\n▫️ 💬 GlowChat: Do it`,
  ]);
  assert.deepEqual(job(kit, "status", "phase", "calls", "boardId"), {
    status: "active",
    phase: "work",
    calls: 1,
    boardId: 101,
  });
  assert.deepEqual(kit.errors, []);
});

test("when the planner fails on a research goal, the default plan waits for Run and says it is a default", async () => {
  const goal = "Find the current price of a Raspberry Pi 5";
  const kit = makeChat({ rules: [[PLAN, new Error("upstream 500")]] });

  await kit.say(goal);
  kit.fresh();
  await kit.tickOnce();
  did(kit, [`sendMessage ${PLAN_BUTTONS}`, "deleteMessage #101"], [
    [
      "👑 <b>GlowLead's plan</b>",
      "",
      "<b>Done when</b>",
      `• Directly answers: ${goal}`,
      "• Concrete and usable, not generic",
      "",
      "<b>Steps</b>",
      "1. 🔎 <b>Scout</b>: Research it with the crew",
      "2. 💬 <b>GlowChat</b>: Turn the findings into a clear answer",
      "",
      "<i>Planned with a simple default because the planner was busy.</i>",
      "",
      "Run it? To change the plan, reply to this message with what to change.",
    ].join("\n"),
  ]);
  assert.deepEqual(job(kit, "status", "phase", "calls", "planId"), {
    status: "awaiting",
    phase: "work",
    calls: 1,
    planId: 102,
  });
  assert.deepEqual(
    kit.logic.state.job.steps.map((step) => [step.worker, step.title]),
    [
      ["room", "Research it with the crew"],
      ["chat", "Turn the findings into a clear answer"],
    ],
  );
  assert.deepEqual(kit.errors, []);
});
