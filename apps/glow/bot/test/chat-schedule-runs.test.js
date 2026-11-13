// What the owner sees around a mission that runs while they are away: when it runs next, how the
// last run ended, a note when it starts late, and what /missions keeps of a run that failed or was stopped.

import test from "node:test";
import assert from "node:assert/strict";

import { t, tPlain } from "../src/strings.js";
import { BAKERY_GOAL, BAKERY_RULES, BYTE, NOVA_PLAN, PIXEL, alarmIn, buttonsOf, makeChat, sent, texts } from "./chat-kit.js";

const MINUTE = 60_000;
const UNTIL_EIGHT = 5.5 * 60 * MINUTE; // the tests start at 02:30 on the owner's clock
const WHEN = "every day 08:00";
const GOAL = "summarise AI news";
const ONE_STEP = '{"steps":[{"bot":"media","task":"Write the summary"}]}';
const TWO_STEPS = '{"steps":[{"bot":"media","task":"Write the summary"},{"bot":"coder","task":"Format it as a table"}]}';
const WORKING = [[NOVA_PLAN, ONE_STEP], [PIXEL, "Three things happened in AI today."]];
const FAILING = [[NOVA_PLAN, TWO_STEPS], [PIXEL, new Error("upstream 500")], [BYTE, new Error("upstream 500")]];
const NEXT_TOMORROW = t("en", "every.next", { next: "tomorrow 08:00" });

// The last time the board (the message with the step list) was rewritten.
const lastBoard = (calls) => calls.filter((call) => call.method === "editMessageText").pop().payload;
const kept = (kit) => kit.logic.state.archive.map((entry) => [entry.n, entry.status, entry.error, entry.scheduleId]);
const tally = (kit) => kit.logic.state.schedules.map((item) => [item.runs, item.fails, item.lastResult]);

async function scheduledRun(rules) {
  const kit = makeChat({ rules });
  await kit.say(`/every 08:00 ${GOAL}`);
  await kit.tickOnce();
  await kit.run({ forMs: 30 * MINUTE });
  return kit;
}

test("a scheduled run that finishes says when it runs next, on its board and in /every", async () => {
  const kit = await scheduledRun(WORKING);
  const board = lastBoard(kit.fresh());
  assert.ok(board.text.endsWith(`\n${NEXT_TOMORROW}`), board.text);
  assert.deepEqual(buttonsOf(board), []);
  assert.deepEqual(tally(kit), [[1, 0, "done"]]);
  assert.deepEqual(kept(kit), [[1, "done", "", "1"]]);

  await kit.say("/every");
  const [list] = sent(kit.fresh());
  const status = `${NEXT_TOMORROW} · ${t("en", "every.last.done", { at: "today 08:00" })}`;
  assert.equal(list.text.split("\n")[2], `    ${status}`);
});

test("while a scheduled run is working, /every says so", async () => {
  const kit = makeChat({ rules: WORKING });
  await kit.say(`/every 08:00 ${GOAL}`);
  await kit.tickOnce();
  kit.fresh();
  await kit.say("/every");
  const [list] = sent(kit.fresh());
  assert.equal(list.text.split("\n")[2], `    ${NEXT_TOMORROW} · ${t("en", "every.last.running")}`);
});

test("a scheduled run that fails leaves a way on: the cause, the next run and a Run again button", async () => {
  const kit = await scheduledRun(FAILING);
  const calls = kit.fresh();
  const note = sent(calls).pop();
  assert.equal(note.text, `${t("en", "report.failed", { error: "upstream 500" })}\n${NEXT_TOMORROW}`);
  assert.deepEqual(buttonsOf(note), [["rag:1"]]);
  assert.ok(!note.disable_notification, "the owner hears about a failure");
  // The board keeps to what happened; the next run is said once, in the note.
  assert.ok(!lastBoard(calls).text.includes(NEXT_TOMORROW));
  assert.deepEqual(tally(kit), [[1, 1, "failed"]]);
  assert.deepEqual(kept(kit), [[1, "failed", "upstream 500", "1"]]);

  await kit.say("/every");
  const [list] = sent(kit.fresh());
  assert.equal(list.text.split("\n")[2], `    ${NEXT_TOMORROW} · ${t("en", "every.last.failed", { at: "today 08:00" })}`);

  await kit.say("/missions");
  const [missions] = sent(kit.fresh());
  const lines = missions.text.split("\n");
  assert.equal(lines[1], `#1 ⚠️ 🔁 today 08:00 · ${GOAL}`);
  assert.equal(lines[3], `<i>${t("en", "missions.mark.failed")} · ${t("en", "missions.mark.scheduled")}</i>`);
  assert.equal(lines[4], t("en", "missions.hint", { n: 1 }));
  assert.deepEqual(buttonsOf(missions), [["rag:1"]]);

  await kit.say("/missions 1");
  const [report] = sent(kit.fresh());
  const head = t("en", "missions.report", { n: 1, goal: GOAL });
  assert.equal(report.text, `${head}\n\n${t("en", "missions.failed", { error: "upstream 500" })}`);
  assert.deepEqual(buttonsOf(report), [["rag:1"]]);
});

test("Run again under a failure note starts the same mission again", async () => {
  const kit = await scheduledRun(FAILING);
  kit.fresh();
  await kit.tap("rag:1", 106);
  assert.deepEqual(texts(kit.fresh()), [tPlain("en", "toast.ok"), t("en", "room.planning")]);
  const job = kit.logic.state.job;
  assert.deepEqual([job.kind, job.goal, job.scheduleId || null], ["room", GOAL, null], "a rerun by hand is not the schedule's run");
});

test("the owner's own failed mission gets the Run again button and no next-run line", async () => {
  const kit = makeChat({ rules: FAILING });
  await kit.say(`/room ${GOAL}`);
  await kit.run({ forMs: 30 * MINUTE });
  const note = sent(kit.fresh()).pop();
  assert.equal(note.text, t("en", "report.failed", { error: "upstream 500" }));
  assert.deepEqual(buttonsOf(note), [["rag:1"]]);
  assert.deepEqual(kept(kit), [[1, "failed", "upstream 500", null]]);
});

test("a scheduled run the owner stops is kept as stopped, and its board says when it runs next", async () => {
  const kit = makeChat({ rules: WORKING });
  await kit.say(`/every 08:00 ${GOAL}`);
  await kit.tickOnce();
  kit.fresh();
  await kit.tap("stp:1", 103);
  await kit.run({ forMs: 30 * MINUTE });
  const calls = kit.fresh();
  assert.equal(texts(calls)[0], tPlain("en", "stopped"));
  assert.ok(lastBoard(calls).text.endsWith(`\n${NEXT_TOMORROW}`), lastBoard(calls).text);
  assert.deepEqual(tally(kit), [[1, 0, "stopped"]]);
  assert.deepEqual(kept(kit), [[1, "stopped", "", "1"]]);

  await kit.say("/missions");
  const [missions] = sent(kit.fresh());
  const lines = missions.text.split("\n");
  assert.equal(lines[1], `#1 ⏹ 🔁 today 08:00 · ${GOAL}`);
  assert.equal(lines[3], `<i>${t("en", "missions.mark.stopped")} · ${t("en", "missions.mark.scheduled")}</i>`);

  await kit.say("/missions 1");
  const [report] = sent(kit.fresh());
  assert.equal(report.text, `${t("en", "missions.report", { n: 1, goal: GOAL })}\n\n${t("en", "missions.stopped")}`);
});

test("a plan that is stopped before it ran is not kept as a mission", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await kit.say(`/lead ${BAKERY_GOAL}`);
  await kit.run({ forMs: 2 * MINUTE });
  assert.equal(kit.logic.state.job.status, "awaiting");
  await kit.say("/stop");
  assert.deepEqual(kit.logic.state.archive, []);
  kit.fresh();
  await kit.say("/missions");
  assert.deepEqual(texts(kit.fresh()), [t("en", "missions.none")]);
});

test("a finished mission list has no legend: there is nothing to explain", async () => {
  const kit = makeChat({ rules: WORKING });
  await kit.say(`/room ${GOAL}`);
  await kit.run({ forMs: 30 * MINUTE });
  kit.fresh();
  await kit.say("/missions");
  const [missions] = sent(kit.fresh());
  assert.deepEqual(missions.text.split("\n").slice(1), [`#1 ✅ today 02:30 · ${GOAL}`, "", t("en", "missions.hint", { n: 1 })]);
});

test("a run held back by the owner's own plan says so once, then starts when the plan is cancelled", async () => {
  const kit = makeChat({ rules: [...BAKERY_RULES, ...WORKING] });
  await kit.say(`/every 08:00 ${GOAL}`);
  kit.now.advance(UNTIL_EIGHT - 5 * MINUTE); // 07:55
  await kit.say(`/lead ${BAKERY_GOAL}`);
  await kit.run({ forMs: 2 * MINUTE });
  assert.equal(kit.logic.state.job.status, "awaiting");
  kit.fresh();

  kit.now.advance(6 * MINUTE); // 08:01, the plan is still waiting for a tap
  await kit.logic.tick();
  const [held, ...more] = sent(kit.fresh());
  assert.deepEqual(more, []);
  assert.equal(held.text, t("en", "every.held", { when: WHEN, goal: GOAL, at: "08:11" }));
  assert.equal(held.disable_notification, true);
  assert.equal(kit.logic.state.job.goal, BAKERY_GOAL, "the owner's plan is untouched");

  // Later checks find the plan still open: nothing more is said about the same run.
  kit.now.advance(MINUTE);
  await kit.logic.tick();
  kit.now.advance(10 * MINUTE); // 08:12
  await kit.logic.tick();
  assert.deepEqual(sent(kit.fresh()), []);
  assert.equal(kit.logic.state.schedules[0].lastRun, 0);

  await kit.tap("can:1", 103);
  assert.equal(kit.logic.state.job, null);
  assert.equal(kit.logic.state.scheduleHold, 0);
  assert.equal(alarmIn(kit), 0, "the chat is free: the waiting run is due at once");
  kit.fresh();
  await kit.tickOnce();
  const started = texts(kit.fresh());
  assert.equal(started[0], `${t("en", "every.running", { when: WHEN, goal: GOAL })}\n${t("en", "every.late.busy", { at: "08:12" })}`);
  assert.equal(started[1], t("en", "room.planning"));
  assert.equal(kit.logic.state.job.scheduleId, "1");
});

test("a run that starts late for another reason says the time; a run on time says nothing extra", async () => {
  const late = makeChat({ rules: WORKING });
  await late.say(`/every 08:00 ${GOAL}`);
  late.fresh();
  late.now.advance(UNTIL_EIGHT + 5 * MINUTE);
  await late.logic.tick();
  assert.equal(texts(late.fresh())[0], `${t("en", "every.running", { when: WHEN, goal: GOAL })}\n${t("en", "every.late", { at: "08:05" })}`);

  const nearly = makeChat({ rules: WORKING });
  await nearly.say(`/every 08:00 ${GOAL}`);
  nearly.fresh();
  nearly.now.advance(UNTIL_EIGHT + 2 * MINUTE - 1000);
  await nearly.logic.tick();
  assert.equal(texts(nearly.fresh())[0], t("en", "every.running", { when: WHEN, goal: GOAL }));
});

test("two schedules due together run one after the other, without a late note and without a waiting note", async () => {
  const kit = makeChat({ rules: WORKING });
  await kit.say("/every 08:00 summarise AI news");
  await kit.say("/every 08:00 summarise chip news");
  kit.fresh();
  await kit.tickOnce();
  await kit.run({ forMs: 30 * MINUTE });
  const said = texts(kit.fresh());
  const starts = said.filter((text) => text.startsWith("🔁"));
  assert.deepEqual(starts, [
    t("en", "every.running", { when: WHEN, goal: "summarise AI news" }),
    t("en", "every.running", { when: WHEN, goal: "summarise chip news" }),
  ]);
  assert.ok(!said.some((text) => text.startsWith("⏳ Scheduled mission is waiting")));
  assert.deepEqual(kit.logic.state.archive.map((entry) => [entry.n, entry.goal, entry.status, entry.scheduleId]), [
    [2, "summarise chip news", "done", "2"],
    [1, "summarise AI news", "done", "1"],
  ]);
  assert.deepEqual(tally(kit), [[1, 0, "done"], [1, 0, "done"]]);
});

test("/every marks a schedule whose time has come but that has not started yet", async () => {
  const kit = makeChat({ rules: BAKERY_RULES });
  await kit.say(`/every 08:00 ${GOAL}`);
  kit.now.advance(UNTIL_EIGHT + MINUTE);
  kit.fresh();
  await kit.say("/every");
  const [list] = sent(kit.fresh());
  assert.equal(list.text.split("\n")[2], `    ${t("en", "every.due")}`);
});
