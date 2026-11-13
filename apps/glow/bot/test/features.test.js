// Scheduled missions, voice notes and mission history: the pure parts, with real dates.

import assert from "node:assert/strict";
import { test } from "node:test";

import { archiveJob, archiveLines, findArchived } from "../src/archive.js";
import {
  clockAt,
  createSchedule,
  describeAt,
  describeWhen,
  dueAt,
  dueSchedules,
  nextRunAt,
  nextScheduleTime,
  parseClock,
  parseEvery,
} from "../src/schedule.js";
import { VoiceError, readTranscript, toBase64, transcribeVoice } from "../src/voice.js";
import { fakeAi, fakeFetch, reply } from "./fakes.js";

const HOUR = 60 * 60 * 1000;
// The owner's clock is UTC+7, so a local time is that UTC time minus 7 hours.
const local = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 7 * HOUR;

// ---------------------------------------------------------------- parsing

test("clock words: 24 h, am/pm, dots, and bare numbers are not times", () => {
  assert.deepEqual(parseClock("08:00"), { hour: 8, minute: 0, used: 1 });
  assert.deepEqual(parseClock("20.15"), { hour: 20, minute: 15, used: 1 });
  assert.deepEqual(parseClock("8am"), { hour: 8, minute: 0, used: 1 });
  assert.deepEqual(parseClock("12am"), { hour: 0, minute: 0, used: 1 });
  assert.deepEqual(parseClock("12pm"), { hour: 12, minute: 0, used: 1 });
  assert.deepEqual(parseClock("7:45pm"), { hour: 19, minute: 45, used: 1 });
  assert.deepEqual(parseClock("8", "pm"), { hour: 20, minute: 0, used: 2 });
  assert.equal(parseClock("8"), null, "a bare number could be part of the goal");
  assert.equal(parseClock("24:00"), null);
  assert.equal(parseClock("13pm"), null);
  assert.equal(parseClock("2026"), null);
});

test("/every understands days and times in the four Glow languages", () => {
  const cases = [
    ["mon,thu 08:00 research cheap flights to Tokyo", [1, 4], 8, 0, "research cheap flights to Tokyo"],
    ["08:00 mon research flights", [1], 8, 0, "research flights"],
    ["weekdays 7:30am summarise AI news for me", [1, 2, 3, 4, 5], 7, 30, "summarise AI news for me"],
    ["daily 21:00 plan tomorrow", [0, 1, 2, 3, 4, 5, 6], 21, 0, "plan tomorrow"],
    ["every day 6pm check the weather in Batam", [0, 1, 2, 3, 4, 5, 6], 18, 0, "check the weather in Batam"],
    ["every friday 5 pm weekly recap of tech news", [5], 17, 0, "weekly recap of tech news"],
    ["mon-wed 09:15 stand-up notes", [1, 2, 3], 9, 15, "stand-up notes"],
    ["fri-mon 10:00 weekend deals", [0, 1, 5, 6], 10, 0, "weekend deals"],
    ["weekends 10:00 find a hike", [0, 6], 10, 0, "find a hike"],
    ["08:00 harga emas hari ini", [0, 1, 2, 3, 4, 5, 6], 8, 0, "harga emas hari ini"],
    ["setiap senin 08:00 rangkum berita AI", [1], 8, 0, "rangkum berita AI"],
    ["setiap hari 07:00 cuaca Jakarta", [0, 1, 2, 3, 4, 5, 6], 7, 0, "cuaca Jakarta"],
    ["每周一 8:00 总结AI新闻", [1], 8, 0, "总结AI新闻"],
    ["工作日 9:30 查看股市", [1, 2, 3, 4, 5], 9, 30, "查看股市"],
    ["週末 10:00 找一個好餐廳", [0, 6], 10, 0, "找一個好餐廳"],
  ];
  for (const [input, days, hour, minute, goal] of cases) {
    assert.deepEqual(parseEvery(input), { days, hour, minute, goal }, input);
  }
});

test("/every says what is missing", () => {
  assert.deepEqual(parseEvery("mon research flights"), { error: "time" });
  assert.deepEqual(parseEvery("research flights every week"), { error: "time" });
  assert.deepEqual(parseEvery("mon 08:00"), { error: "goal" });
  assert.deepEqual(parseEvery("08:00 hi"), { error: "goal" });
  assert.deepEqual(parseEvery(""), { error: "time" });
  assert.equal(parseEvery("08:00 " + "x".repeat(900)).goal.length, 600);
});

// ---------------------------------------------------------------- timing

test("the next run is on the owner's clock (UTC+7), on the right weekday, never in the past", () => {
  // Thursday 12 Nov 2026, 12:00 local.
  const now = local(2026, 11, 12, 12, 0);
  const mondays8 = { days: [1], hour: 8, minute: 0, lastRun: 0 };
  assert.equal(new Date(now + 7 * HOUR).getUTCDay(), 4, "the test date is a Thursday on the owner's clock");
  assert.equal(nextRunAt(mondays8, now), local(2026, 11, 16, 8, 0));
  const daily = { days: [0, 1, 2, 3, 4, 5, 6], hour: 13, minute: 30, lastRun: 0 };
  assert.equal(nextRunAt(daily, now), local(2026, 11, 12, 13, 30), "later today");
  const earlier = { ...daily, hour: 11 };
  assert.equal(nextRunAt(earlier, now), local(2026, 11, 13, 11, 30), "already passed today: tomorrow");
  // 06:30 local is 23:30 UTC the day before: the weekday must follow the owner's clock.
  const fridayEarly = { days: [5], hour: 6, minute: 30, lastRun: 0 };
  assert.equal(nextRunAt(fridayEarly, now), local(2026, 11, 13, 6, 30));
  assert.equal(new Date(nextRunAt(fridayEarly, now) + 7 * HOUR).getUTCDay(), 5);
  assert.equal(nextRunAt({ days: [], hour: 8, minute: 0 }, now), Infinity);
});

test("a schedule fires once per slot, waits for the next slot after it ran, and the alarm aims at the earliest", () => {
  const created = local(2026, 11, 12, 7, 0);
  const schedule = createSchedule({ days: [4], hour: 8, minute: 0, goal: "weekly AI news" }, 1, created);
  assert.equal(dueSchedules([schedule], local(2026, 11, 12, 7, 59)).length, 0);
  assert.equal(dueSchedules([schedule], local(2026, 11, 12, 8, 0)).length, 1);
  assert.equal(dueSchedules([schedule], local(2026, 11, 12, 22, 0)).length, 1, "a missed slot still runs once");
  schedule.lastRun = local(2026, 11, 12, 8, 1);
  assert.equal(dueSchedules([schedule], local(2026, 11, 12, 23, 0)).length, 0, "not twice for the same slot");
  assert.equal(dueSchedules([schedule], local(2026, 11, 19, 8, 0)).length, 1, "next Thursday");

  const other = createSchedule(
    { days: [0, 1, 2, 3, 4, 5, 6], hour: 9, minute: 0, goal: "daily brief" },
    2,
    local(2026, 11, 12, 10, 0),
  );
  assert.equal(nextScheduleTime([schedule, other], local(2026, 11, 12, 12, 0)), local(2026, 11, 13, 9, 0));
  assert.equal(nextScheduleTime([], 0), null);
  // Created after today's slot: the first run is the next slot, not "now".
  const late = createSchedule({ days: [4], hour: 8, minute: 0, goal: "x news" }, 3, local(2026, 11, 12, 9, 0));
  assert.equal(dueSchedules([late], local(2026, 11, 12, 9, 5)).length, 0);
});

test("schedules are described in the chat's language", () => {
  assert.equal(describeWhen({ days: [1, 4], hour: 8, minute: 0 }), "Mon, Thu 08:00");
  assert.equal(describeWhen({ days: [0, 1, 2, 3, 4, 5, 6], hour: 7, minute: 5 }, "id"), "setiap hari 07:05");
  assert.equal(describeWhen({ days: [1, 2, 3, 4, 5], hour: 9, minute: 30 }, "zh-Hans"), "工作日 09:30");
  assert.equal(describeWhen({ days: [0, 6], hour: 10, minute: 0 }, "zh-Hant"), "週末 10:00");
  assert.equal(describeWhen({ days: [3], hour: 21, minute: 0 }, "xx"), "Wed 21:00", "unknown language falls back to English");
});

test("a moment is named the way the owner would say it", () => {
  const now = local(2026, 11, 12, 2, 30); // a Thursday
  assert.equal(clockAt(local(2026, 11, 12, 8, 11)), "08:11");
  assert.equal(describeAt(local(2026, 11, 12, 8, 0), now), "today 08:00");
  assert.equal(describeAt(local(2026, 11, 12, 23, 59), now), "today 23:59");
  assert.equal(describeAt(local(2026, 11, 13, 0, 0), now), "tomorrow 00:00", "the day changes on the owner's clock, not at UTC midnight");
  assert.equal(describeAt(local(2026, 11, 11, 21, 15), now), "yesterday 21:15");
  assert.equal(describeAt(local(2026, 11, 16, 8, 0), now), "Mon 16 Nov 08:00");
  assert.equal(describeAt(local(2026, 11, 10, 8, 0), now), "Tue 10 Nov 08:00", "two days back is a date again");
  assert.equal(describeAt(local(2026, 11, 13, 7, 30), now, "id"), "besok 07:30");
  assert.equal(describeAt(local(2026, 12, 16, 8, 0), now, "id"), "Rab 16 Des 08:00");
  assert.equal(describeAt(local(2026, 11, 12, 8, 0), now, "zh-Hans"), "今天 08:00");
  assert.equal(describeAt(local(2026, 11, 16, 8, 0), now, "zh-Hans"), "11月16日 周一 08:00");
  assert.equal(describeAt(local(2026, 11, 16, 8, 0), now, "zh-Hant"), "11月16日 週一 08:00");
  assert.equal(describeAt(local(2026, 11, 16, 8, 0), now, "xx"), "Mon 16 Nov 08:00", "unknown language falls back to English");
  assert.equal(describeAt(undefined, now), "");
  assert.equal(describeAt(NaN, now), "");
});

test("a schedule knows the time of the run it is waiting for, and starts with an empty record", () => {
  const schedule = createSchedule({ days: [0, 1, 2, 3, 4, 5, 6], hour: 8, minute: 0, goal: "ai news" }, 1, local(2026, 11, 12, 2, 30));
  assert.deepEqual(
    [schedule.runs, schedule.fails, schedule.lastResult, schedule.lastEnd, schedule.heldFor],
    [0, 0, "", 0, 0],
  );
  assert.equal(dueAt(schedule), local(2026, 11, 12, 8, 0));
  schedule.lastRun = local(2026, 11, 12, 8, 4); // it ran, four minutes late
  assert.equal(dueAt(schedule), local(2026, 11, 13, 8, 0));
});

// ---------------------------------------------------------------- voice

const TOKEN = "123:abc";
function voiceNet(bytes = new Uint8Array([79, 103, 103, 83, 1, 2, 3])) {
  return fakeFetch([
    [`https://api.telegram.org/bot${TOKEN}/getFile`, async () => reply({ ok: true, result: { file_path: "voice/file_1.oga", file_size: bytes.length } })],
    [`https://api.telegram.org/file/bot${TOKEN}/voice/file_1.oga`, async () => new Response(bytes)],
  ]);
}

test("a voice note is downloaded from Telegram and read by Whisper turbo (base64)", async () => {
  const ai = fakeAi({ "@cf/openai/whisper-large-v3-turbo": (inputs) => ({ text: ` plan a trip (${inputs.audio}) ` }) });
  const result = await transcribeVoice({ fetch: voiceNet(), ai, token: TOKEN, voice: { file_id: "f1", duration: 4 } });
  assert.equal(result.text, `plan a trip (${toBase64(new Uint8Array([79, 103, 103, 83, 1, 2, 3]))})`);
  assert.equal(result.model, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(ai.calls[0].inputs.task, "transcribe");
});

test("when turbo cannot read the note, the base model gets the raw bytes", async () => {
  const ai = fakeAi({
    "@cf/openai/whisper-large-v3-turbo": () => {
      throw new Error("5006: could not decode audio");
    },
    "@cf/openai/whisper": (inputs) => ({ text: `bytes ${inputs.audio.length}` }),
  });
  const result = await transcribeVoice({ fetch: voiceNet(), ai, token: TOKEN, voice: { file_id: "f1", duration: 4 } });
  assert.deepEqual(result, { text: "bytes 7", model: "@cf/openai/whisper" });
});

test("voice failures come back as clear codes, and nothing is downloaded when the limits say no", async () => {
  const net = voiceNet();
  const broken = fakeAi({
    "@cf/openai/whisper-large-v3-turbo": () => {
      throw new Error("bad audio");
    },
    "@cf/openai/whisper": () => {
      throw new Error("bad audio");
    },
  });
  await assert.rejects(transcribeVoice({ fetch: net, ai: broken, token: TOKEN, voice: { file_id: "f1", duration: 3 } }), (error) => error instanceof VoiceError && error.code === "unreadable");
  const silent = fakeAi({ "@cf/openai/whisper-large-v3-turbo": { text: "  " }, "@cf/openai/whisper": { text: "" } });
  await assert.rejects(transcribeVoice({ fetch: voiceNet(), ai: silent, token: TOKEN, voice: { file_id: "f1", duration: 3 } }), (error) => error.code === "empty");

  const counted = voiceNet();
  await assert.rejects(transcribeVoice({ fetch: counted, ai: broken, token: TOKEN, voice: { file_id: "f1", duration: 600 } }), (error) => error.code === "too-long");
  await assert.rejects(transcribeVoice({ fetch: counted, ai: broken, token: TOKEN, voice: { file_id: "f1", duration: 5, file_size: 9e6 } }), (error) => error.code === "too-big");
  await assert.rejects(transcribeVoice({ fetch: counted, ai: null, token: TOKEN, voice: { file_id: "f1", duration: 5 } }), (error) => error.code === "no-ai");
  assert.equal(counted.calls.length, 0, "limits are checked before any download");

  const missing = fakeFetch([[`https://api.telegram.org/bot${TOKEN}/getFile`, async () => reply({ ok: false, description: "file is too big" })]]);
  await assert.rejects(transcribeVoice({ fetch: missing, ai: broken, token: TOKEN, voice: { file_id: "f1", duration: 5 } }), (error) => error.code === "download");
});

test("Whisper answers are read from any of the fields the models use", () => {
  assert.equal(readTranscript({ text: " hi " }), "hi");
  assert.equal(readTranscript({ result: { text: "yo" } }), "yo");
  assert.equal(readTranscript({ segments: [{ text: "a" }, { text: "b" }] }), "a b");
  assert.equal(readTranscript("plain"), "plain");
  assert.equal(readTranscript(null), "");
});

test("base64 of a large buffer matches Node's encoder", () => {
  const bytes = new Uint8Array(100000).map((_, index) => (index * 31) % 256);
  assert.equal(toBase64(bytes), Buffer.from(bytes).toString("base64"));
});

// ---------------------------------------------------------------- history

test("mission history keeps the newest 20, numbers them, and finds them again", () => {
  let archive = [];
  for (let index = 1; index <= 23; index++) {
    archive = archiveJob(archive, { goal: `goal ${index}`, report: "r".repeat(5000), status: index % 5 ? "done" : "stopped", at: index });
  }
  assert.equal(archive.length, 20);
  assert.equal(archive[0].n, 23, "newest first");
  assert.equal(archive.at(-1).n, 4);
  assert.equal(archive[0].report.length, 3500, "reports are clipped");
  assert.equal(findArchived(archive, 10).goal, "goal 10");
  assert.equal(findArchived(archive, 2), null, "dropped from history");
  const lines = archiveLines(archive, (at) => `day ${at}`, 3);
  assert.deepEqual(lines, ["#23 ✅ day 23 · goal 23", "#22 ✅ day 22 · goal 22", "#21 ✅ day 21 · goal 21"]);
  const repeated = archiveJob([], { goal: "weekly news", report: "x", scheduleId: "1", status: "stopped" });
  assert.equal(archiveLines(repeated)[0], "#1 ⏹ 🔁 weekly news");
});
