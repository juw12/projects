// tools/check_live.js is what makes a deploy fail when the live worker is the wrong build or its
// self-test is red. These tests feed it right and wrong answers; the self-test answer is built from
// the real self-test, wrapped the way the worker's /v1/selftest route wraps it.

import test from "node:test";
import assert from "node:assert/strict";

import { runSelfTest } from "../src/selftest.js";
import { VERSION } from "../src/util.js";
import { checkLive, profileProblems, selfTestProblems, statusProblems } from "../tools/check_live.js";

const BUILD = "abc123def456";
const BASE = "https://bot.example";

const goodStatus = () => ({
  ok: true,
  service: "glow-bot",
  version: VERSION,
  build: BUILD,
  stage: "bot",
  configured: false,
  bot: null,
  access: "private",
  claimed: false,
  ai: true,
  colo: "SIN",
});

async function goodSelfTest() {
  const result = await runSelfTest();
  return { running: false, result: { ...result, at: 1, ms: 60, version: VERSION, build: BUILD } };
}

test("a status from the expected bot build has nothing wrong", () => {
  assert.deepEqual(statusProblems(goodStatus(), BUILD), []);
  assert.deepEqual(statusProblems(goodStatus()), [], "without a build to compare, any build will do");
});

test("each wrong status field is named", () => {
  const wrong = {
    ok: [false, /ok is not true/],
    service: ["glow-cloud", /service is "glow-cloud"/],
    stage: ["probe", /stage is "probe", not "bot"/],
    version: ["0.1.0-probe", /version is "0.1.0-probe"/],
    build: ["000000000000", /build is "000000000000", not "abc123def456"/],
  };
  for (const [field, [value, pattern]] of Object.entries(wrong)) {
    const problems = statusProblems({ ...goodStatus(), [field]: value }, BUILD);
    assert.equal(problems.length, 1, field);
    assert.match(problems[0], pattern);
  }
  assert.deepEqual(statusProblems(null, BUILD), ["the answer is not a JSON object"]);
  assert.deepEqual(statusProblems("<html>", BUILD), ["the answer is not a JSON object"]);
});

test("the real self-test, wrapped as the worker wraps it, has nothing wrong", async () => {
  const answer = await goodSelfTest();
  assert.ok(answer.result.checks.length >= 6, "the self-test still has its six conversations");
  assert.deepEqual(selfTestProblems(answer, BUILD), []);
});

test("a red self-test is reported check by check", async () => {
  const answer = await goodSelfTest();
  answer.result.ok = false;
  answer.result.checks[1] = { ...answer.result.checks[1], ok: false, detail: "the crew never answered" };
  const problems = selfTestProblems(answer, BUILD);
  assert.equal(problems.length, 1);
  assert.match(problems[0], new RegExp(`^${answer.result.checks[1].name} failed: the crew never answered$`));
});

test("a self-test that only claims to be fine is not believed", async () => {
  const lying = await goodSelfTest();
  lying.result.checks[0] = { ...lying.result.checks[0], ok: false, detail: "broken" };
  assert.equal(selfTestProblems(lying, BUILD).length, 1, "ok: true does not hide a failed check");

  const unflagged = await goodSelfTest();
  unflagged.result.ok = false;
  assert.deepEqual(selfTestProblems(unflagged, BUILD), ["ok is not true"]);

  const empty = await goodSelfTest();
  empty.result.checks = [];
  assert.deepEqual(selfTestProblems(empty, BUILD), ["the result lists no checks"]);
});

test("a thrown self-test, a missing result and a stale result are all problems", async () => {
  const thrown = { running: false, result: { ok: false, kind: "logic", checks: [], error: "boom", version: VERSION, build: BUILD } };
  assert.deepEqual(selfTestProblems(thrown, BUILD), ["the self-test stopped: boom", "the result lists no checks"]);

  assert.deepEqual(selfTestProblems({ running: false, result: null }, BUILD), ["there is no self-test result"]);
  assert.deepEqual(selfTestProblems({ running: true, result: null }, BUILD), ["the self-test is still running"]);
  assert.deepEqual(selfTestProblems(undefined, BUILD), ["the answer is not a JSON object"]);

  const oldBuild = await goodSelfTest();
  oldBuild.result.build = "000000000000";
  assert.match(selfTestProblems(oldBuild, BUILD).join("\n"), /from build "000000000000", not "abc123def456"/);

  const oldVersion = await goodSelfTest();
  oldVersion.result.version = "1.31.0";
  assert.match(selfTestProblems(oldVersion, BUILD).join("\n"), /from version "1.31.0"/);
});

// A pretend worker: `answers` maps a path to a list of answers handed out one per read (the last one
// repeats). An Error in the list is thrown instead of returned.
function pretendWorker(answers) {
  const reads = [];
  const waits = [];
  const said = [];
  return {
    reads,
    waits,
    said,
    options: {
      attempts: 4,
      say: (line) => said.push(line),
      wait: async (ms) => {
        waits.push(ms);
      },
      read: async (url) => {
        assert.ok(url.startsWith(BASE + "/"), url);
        const path = url.slice(BASE.length);
        reads.push(path);
        const list = answers[path];
        const answer = list.length > 1 ? list.shift() : list[0];
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
}

test("checkLive passes on the first try when both answers are right", async () => {
  const worker = pretendWorker({ "/v1/status": [goodStatus()], "/v1/selftest": [await goodSelfTest()] });
  assert.deepEqual(await checkLive(BASE, BUILD, worker.options), []);
  assert.deepEqual(worker.reads, ["/v1/status", "/v1/selftest"]);
  assert.deepEqual(worker.waits, []);
  assert.match(worker.said[0], new RegExp(`GlowBot ${VERSION.replaceAll(".", "\\.")} \\(build ${BUILD}\\) is live`));
  assert.ok(worker.said.some((line) => /^ {2}ok {2}mission: /.test(line)), "each passed conversation is listed");
});

test("checkLive waits for the new build and does not ask the old one for its self-test", async () => {
  const old = { ...goodStatus(), build: "000000000000" };
  const worker = pretendWorker({
    "/v1/status": [old, new Error("fetch failed"), goodStatus()],
    "/v1/selftest": [await goodSelfTest()],
  });
  assert.deepEqual(await checkLive(BASE, BUILD, worker.options), []);
  assert.deepEqual(worker.reads, ["/v1/status", "/v1/status", "/v1/status", "/v1/selftest"]);
  assert.equal(worker.waits.length, 2);
  assert.ok(worker.said.some((line) => /status: build is "000000000000"/.test(line)));
  assert.ok(worker.said.some((line) => /no answer: fetch failed/.test(line)));
});

test("checkLive gives the self-test time to run again, then passes", async () => {
  const red = await goodSelfTest();
  red.result.ok = false;
  red.result.checks[0] = { ...red.result.checks[0], ok: false, detail: "storage was not ready" };
  const worker = pretendWorker({ "/v1/status": [goodStatus()], "/v1/selftest": [red, red, await goodSelfTest()] });
  assert.deepEqual(await checkLive(BASE, BUILD, worker.options), []);
  assert.equal(worker.waits.length, 2);
});

test("checkLive gives up after its tries and says what was wrong", async () => {
  const red = await goodSelfTest();
  red.result.ok = false;
  red.result.checks[2] = { ...red.result.checks[2], ok: false, detail: "no reply" };
  const worker = pretendWorker({ "/v1/status": [goodStatus()], "/v1/selftest": [red] });
  const problems = await checkLive(BASE, BUILD, worker.options);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^self-test: \w+ failed: no reply$/);
  assert.equal(worker.reads.length, 8, "four tries, two reads each");
  assert.equal(worker.waits.length, 3, "no wait after the last try");

  const down = pretendWorker({ "/v1/status": [new Error("getaddrinfo ENOTFOUND")], "/v1/selftest": [] });
  assert.deepEqual(await checkLive(BASE, BUILD, down.options), ["no answer: getaddrinfo ENOTFOUND"]);
  assert.equal(down.reads.length, 4);
});

// What /v1/profile answers once this version has set the bot's name, picture, texts and menus.
const eachLanguage = () => ({ default: { ok: true }, id: { ok: true }, zh: { ok: true } });
const goodProfile = () => ({
  ok: true,
  configured: true,
  version: VERSION,
  access: "private",
  claimed: true,
  name: { ok: true },
  photo: { ok: true },
  webhook: { ok: true },
  menus: eachLanguage(),
  ownerMenus: eachLanguage(),
  descriptions: eachLanguage(),
  shorts: eachLanguage(),
  dress: { version: VERSION, current: true, warnings: [] },
});

test("a profile set by this version has nothing wrong", () => {
  assert.deepEqual(profileProblems(goodProfile()), []);
  assert.deepEqual(profileProblems({ ...goodProfile(), version: "9.9.9", dress: { version: "9.9.9", current: true } }, "9.9.9"), []);
});

test("a profile that is not an answer, or has no bot, says only that", () => {
  assert.deepEqual(profileProblems(null), ["the answer is not a JSON object"]);
  assert.deepEqual(profileProblems([goodProfile()]), ["the answer is not a JSON object"]);
  assert.deepEqual(profileProblems({ ok: false, configured: false }), ["no bot is connected"]);
});

test("each wrong part of the profile is named", () => {
  const old = { ...goodProfile(), version: "1.0.0" };
  assert.deepEqual(profileProblems(old), [`the profile is from version "1.0.0", not "${VERSION}"`]);

  const wrongName = { ok: false, got: "glowbot", want: "GlowBot" };
  assert.deepEqual(profileProblems({ ...goodProfile(), name: wrongName }), [`the name is not right: ${JSON.stringify(wrongName)}`]);
  assert.deepEqual(profileProblems({ ...goodProfile(), photo: undefined }), ["the picture is not right: null"]);
  assert.deepEqual(profileProblems({ ...goodProfile(), webhook: { ok: false } }), ['the webhook is not right: {"ok":false}']);

  const groups = {
    menus: "the command menu",
    ownerMenus: "the owner's command menu",
    descriptions: "the description",
    shorts: "the short description",
  };
  for (const [field, label] of Object.entries(groups)) {
    const profile = goodProfile();
    profile[field].id = { ok: false, got: 3 };
    assert.deepEqual(profileProblems(profile), [`${label} (id) is not right: {"ok":false,"got":3}`], field);
    profile[field] = {};
    assert.deepEqual(profileProblems(profile), [`${label} was not read`], field);
  }
});

test("the owner's menu is only asked for once the bot has an owner", () => {
  const profile = { ...goodProfile(), claimed: false, ownerMenus: {} };
  assert.deepEqual(profileProblems(profile), []);
  profile.ownerMenus = { default: { ok: false } };
  assert.deepEqual(profileProblems(profile), [`the owner's command menu (default) is not right: {"ok":false}`], "a menu that was read is still checked");
});

test("a profile that this version did not finish setting says why", () => {
  assert.deepEqual(profileProblems({ ...goodProfile(), dress: null }), ["this version has not set the profile yet"]);
  assert.deepEqual(profileProblems({ ...goodProfile(), dress: { version: "1.32.0", current: false } }), [
    'the profile was last set by version "1.32.0"',
  ]);
  const warned = { ...goodProfile(), dress: { version: VERSION, current: true, warnings: ["setMyName: Too Many Requests", "photo: HTTP 404"] } };
  assert.deepEqual(profileProblems(warned), [
    "warning while setting the profile: setMyName: Too Many Requests",
    "warning while setting the profile: photo: HTTP 404",
  ]);
});

test("ok that is not true is only reported when nothing else explains it", () => {
  assert.deepEqual(profileProblems({ ...goodProfile(), ok: false }), ["ok is not true"]);
  const problems = profileProblems({ ...goodProfile(), ok: false, photo: { ok: false } });
  assert.deepEqual(problems, ['the picture is not right: {"ok":false}']);
});
