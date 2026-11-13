// The scheduled missions, voice notes and mission history, wired into the chat: what the owner
// types, what the bot answers, and what the alarm does when a schedule comes due.

import test from "node:test";
import assert from "node:assert/strict";

import { archiveJob } from "../src/archive.js";
import { t, tPlain } from "../src/strings.js";
import { AS_MEMBER, FRIEND, GROUP_CHAT, alarmIn, buttonsOf, makeChat, sent, texts } from "./chat-kit.js";

const HOUR = 60 * 60;
const VOICE = { file_id: "voice-1", duration: 4, mime_type: "audio/ogg", file_size: 9000 };

// ------------------------------------------------------------------ /every
test("/every sets a schedule, lists it with a delete button, and the button deletes it", async () => {
  const kit = makeChat();
  await kit.say("/every mon,thu 08:00 research cheap flights to Tokyo");
  const [setReply] = sent(kit.fresh());
  // START is Thursday 02:30 on the owner's clock, so the first run is named: today at 08:00.
  assert.equal(
    setReply.text,
    t("en", "every.set", { when: "Mon, Thu 08:00", goal: "research cheap flights to Tokyo", next: "today 08:00" }),
  );
  assert.deepEqual(kit.logic.state.schedules.map((s) => [s.id, s.days, s.hour, s.minute, s.goal]), [
    ["1", [1, 4], 8, 0, "research cheap flights to Tokyo"],
  ]);
  assert.equal(alarmIn(kit), 5.5 * HOUR);

  await kit.say("/every");
  const [list] = sent(kit.fresh());
  assert.match(list.text, /Mon, Thu 08:00/);
  assert.deepEqual(buttonsOf(list), [["evx:1"]]);

  await kit.tap("evx:1", 105);
  assert.deepEqual(texts(kit.fresh()), [tPlain("en", "toast.ok"), t("en", "every.deleted")]);
  assert.deepEqual(kit.logic.state.schedules, []);
  assert.equal(alarmIn(kit), null, "nothing left to wake up for");
});

test("/every explains itself, refuses a sixth schedule, and /every off clears them all", async () => {
  const kit = makeChat();
  await kit.say("/every research flights");
  assert.deepEqual(texts(kit.fresh()), [t("en", "every.usage")]);
  await kit.say("/every 08:00");
  assert.deepEqual(texts(kit.fresh()), [t("en", "every.usage")]);

  for (let i = 1; i <= 5; i++) await kit.say(`/every ${i + 6}:00 brief number ${i}`);
  kit.fresh();
  await kit.say("/every 20:00 one too many");
  assert.deepEqual(texts(kit.fresh()), [t("en", "every.full", { n: 5 })]);
  assert.equal(kit.logic.state.schedules.length, 5);

  await kit.say("/every off");
  assert.deepEqual(texts(kit.fresh()), [t("en", "every.off")]);
  assert.deepEqual(kit.logic.state.schedules, []);
});

test("only the owner can schedule; a member is told so", async () => {
  const kit = makeChat({ chat: GROUP_CHAT });
  await kit.say("/every 08:00 group news", { from: FRIEND, access: AS_MEMBER });
  assert.deepEqual(texts(kit.fresh()), [t("en", "every.owner")]);
  assert.deepEqual(kit.logic.state.schedules, []);
});

test("when a schedule comes due the alarm starts a GlowRoom mission once, and the next slot is tomorrow", async () => {
  const kit = makeChat();
  await kit.say("/every 08:00 summarise AI news");
  kit.fresh();
  assert.equal(await kit.tickOnce(), true);
  const said = texts(kit.fresh());
  assert.equal(said[0], t("en", "every.running", { when: "every day 08:00", goal: "summarise AI news" }));
  assert.equal(said[1], t("en", "room.planning"));
  const job = kit.logic.state.job;
  assert.deepEqual([job.kind, job.goal, job.scheduleId], ["room", "summarise AI news", "1"]);
  assert.equal(kit.logic.state.schedules[0].lastRun, kit.now());
});

test("a due schedule never cancels the owner's own job: it waits and tries again", async () => {
  const kit = makeChat();
  await kit.say("/every 08:00 summarise AI news");
  // The owner's own plan is waiting for a Run tap when 08:00 comes.
  kit.logic.state.job = { id: "9", kind: "lead", status: "awaiting", goal: "my own plan", by: 9001, steps: [], steer: [] };
  kit.now.advance(5.5 * HOUR * 1000);
  await kit.logic.tick();
  assert.equal(kit.logic.state.job.goal, "my own plan");
  assert.equal(kit.logic.state.schedules[0].lastRun, 0);
  assert.equal(kit.logic.state.scheduleHold, kit.now() + 10 * 60 * 1000);
});

// ------------------------------------------------------------------ /missions
test("a finished mission is kept; /missions lists it and Run again starts it again", async () => {
  const kit = makeChat();
  await kit.say("/missions");
  assert.deepEqual(texts(kit.fresh()), [t("en", "missions.none")]);

  await kit.logic.load();
  kit.logic.finish({ id: "3", kind: "room", status: "done", goal: "best ramen in Batam", final: "1. Ramen Ya", by: 9001 });
  kit.logic.finish({ id: "4", kind: "chat", status: "done", goal: "hi", final: "hello", by: 9001 });
  assert.deepEqual(kit.logic.state.archive.map((e) => [e.n, e.kind, e.goal, e.report]), [[1, "room", "best ramen in Batam", "1. Ramen Ya"]]);

  await kit.say("/missions");
  const [list] = sent(kit.fresh());
  assert.match(list.text, /#1 ✅ .* · best ramen in Batam/);
  assert.deepEqual(buttonsOf(list), [["rag:1"]]);

  await kit.say("/missions 1");
  const [report] = sent(kit.fresh());
  assert.match(report.text, /Mission #1/);
  assert.match(report.text, /Ramen Ya/);

  await kit.tap("rag:1", 107);
  const said = texts(kit.fresh());
  assert.deepEqual(said, [tPlain("en", "toast.ok"), t("en", "room.planning")]);
  assert.deepEqual([kit.logic.state.job.kind, kit.logic.state.job.goal], ["room", "best ramen in Batam"]);
});

test("Run again on a mission that is no longer kept is stale", async () => {
  const kit = makeChat();
  await kit.logic.load();
  kit.logic.state.archive = archiveJob([], { kind: "lead", goal: "old goal" });
  await kit.tap("rag:42", 50);
  assert.equal(texts(kit.fresh())[0], tPlain("en", "toast.stale"));
});

// ------------------------------------------------------------------ voice notes
test("a voice note is written down, shown, and then handled like typed text", async () => {
  const kit = makeChat();
  const heard = [];
  kit.logic.transcribe = async (voice, config) => {
    heard.push([voice.file_id, config.botId]);
    return "  plan a picnic for Sunday  ";
  };
  await kit.say(undefined, { extra: { voice: VOICE } });
  assert.deepEqual(heard, [["voice-1", 777]]);
  assert.deepEqual(texts(kit.fresh()), [t("en", "voice.heard", { text: "plan a picnic for Sunday" }), t("en", "lead.planning")]);
  assert.equal(kit.logic.state.job.goal, "plan a picnic for Sunday");
});

test("voice notes that cannot be heard get a clear answer and start nothing", async () => {
  const cases = [
    [null, "voice.off"],
    [Object.assign(new Error("long"), { code: "too-long" }), "voice.long"],
    [Object.assign(new Error("big"), { code: "too-big" }), "voice.long"],
    [Object.assign(new Error("no ai"), { code: "no-ai" }), "voice.off"],
    [Object.assign(new Error("bad"), { code: "unreadable" }), "voice.failed"],
    ["", "voice.failed"],
  ];
  for (const [outcome, key] of cases) {
    const kit = makeChat();
    if (outcome instanceof Error) {
      kit.logic.transcribe = async () => {
        throw outcome;
      };
    } else if (outcome === "") {
      kit.logic.transcribe = async () => "   ";
    }
    await kit.say(undefined, { extra: { voice: VOICE } });
    assert.deepEqual(texts(kit.fresh()), [t("en", key)], key);
    assert.equal(kit.logic.state.job, null);
  }
});

test("in a group, only a voice note that answers the bot is heard", async () => {
  const kit = makeChat({ chat: GROUP_CHAT });
  let calls = 0;
  kit.logic.transcribe = async () => {
    calls += 1;
    return "what is the weather";
  };
  await kit.say(undefined, { extra: { voice: VOICE } });
  assert.equal(calls, 0);
  assert.deepEqual(kit.fresh(), []);
  await kit.say(undefined, { extra: { voice: VOICE }, replyTo: 40 });
  assert.equal(calls, 1);
});
