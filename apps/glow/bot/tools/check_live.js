// After a deploy, asks the live GlowBot worker two questions and exits 1 when either answer is
// wrong: is this the build that was just deployed (GET /v1/status), and does the bot's own
// self-test pass there (GET /v1/selftest)? The GitHub workflow runs it; by hand:
//
//   node tools/check_live.js https://glow-bot.juw12.workers.dev [build]
//   node tools/check_live.js https://glow-bot.juw12.workers.dev --profile
//
// --profile asks a third question by hand (GET /v1/profile): does Telegram show the name, command
// menus, descriptions and picture this version means to show? The deploy does not ask it, so a
// slow Telegram never fails a release.
//
// No dependencies. The judging is in two plain functions, tested in test/check-live.test.js.

import { pathToFileURL } from "node:url";

import { VERSION } from "../src/util.js";

const ATTEMPTS = 6;
const GAP_MS = 15000; // the worker runs a failed self-test again after a minute: six tries span 75 s
const TIMEOUT_MS = 30000;

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

// What is wrong with a /v1/status answer; [] when it is the expected build of the bot.
export function statusProblems(status, build = "", version = VERSION) {
  if (!isObject(status)) return ["the answer is not a JSON object"];
  const problems = [];
  if (status.ok !== true) problems.push("ok is not true");
  if (status.service !== "glow-bot") problems.push(`service is ${JSON.stringify(status.service)}, not "glow-bot"`);
  if (status.stage !== "bot") problems.push(`stage is ${JSON.stringify(status.stage)}, not "bot"`);
  if (status.version !== version) problems.push(`version is ${JSON.stringify(status.version)}, not "${version}"`);
  if (build && status.build !== build) problems.push(`build is ${JSON.stringify(status.build)}, not "${build}"`);
  return problems;
}

// What is wrong with a /v1/selftest answer; [] when every conversation passed on the expected build.
export function selfTestProblems(answer, build = "", version = VERSION) {
  if (!isObject(answer)) return ["the answer is not a JSON object"];
  if (answer.running === true) return ["the self-test is still running"];
  const result = answer.result;
  if (!isObject(result)) return ["there is no self-test result"];
  const problems = [];
  const checks = Array.isArray(result.checks) ? result.checks : [];
  if (result.error) problems.push(`the self-test stopped: ${result.error}`);
  for (const check of checks) {
    if (!isObject(check) || check.ok !== true) {
      problems.push(`${(check && check.name) || "a check"} failed: ${(check && check.detail) || "no detail"}`);
    }
  }
  if (!checks.length) problems.push("the result lists no checks");
  if (result.ok !== true && !problems.length) problems.push("ok is not true");
  if (result.version !== version) problems.push(`the result is from version ${JSON.stringify(result.version)}, not "${version}"`);
  if (build && result.build !== build) problems.push(`the result is from build ${JSON.stringify(result.build)}, not "${build}"`);
  return problems;
}

// What is wrong with a /v1/profile answer; [] when Telegram shows everything this version sets.
export function profileProblems(profile, version = VERSION) {
  if (!isObject(profile)) return ["the answer is not a JSON object"];
  if (profile.configured !== true) return ["no bot is connected"];
  const problems = [];
  if (profile.version !== version) problems.push(`the profile is from version ${JSON.stringify(profile.version)}, not "${version}"`);
  const part = (label, value) => {
    if (!isObject(value) || value.ok !== true) problems.push(`${label} is not right: ${JSON.stringify(value === undefined ? null : value)}`);
  };
  part("the name", profile.name);
  part("the picture", profile.photo);
  part("the webhook", profile.webhook);
  const groups = [
    ["the command menu", profile.menus, true],
    ["the owner's command menu", profile.ownerMenus, profile.claimed === true],
    ["the description", profile.descriptions, true],
    ["the short description", profile.shorts, true],
  ];
  for (const [label, group, needed] of groups) {
    const names = isObject(group) ? Object.keys(group) : [];
    if (needed && !names.length) problems.push(`${label} was not read`);
    for (const name of names) part(`${label} (${name})`, group[name]);
  }
  const dress = profile.dress;
  if (!isObject(dress)) problems.push("this version has not set the profile yet");
  else {
    if (dress.current !== true) problems.push(`the profile was last set by version ${JSON.stringify(dress.version)}`);
    for (const warning of Array.isArray(dress.warnings) ? dress.warnings : []) problems.push(`warning while setting the profile: ${warning}`);
  }
  if (profile.ok !== true && !problems.length) problems.push("ok is not true");
  return problems;
}

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status}, not JSON: ${text.slice(0, 200)}`);
  }
}

// Asks until both answers are right or the tries run out. Returns the problems of the last try
// ([] means the live worker is the expected build and its self-test passed). Never throws.
export async function checkLive(base, build = "", options = {}) {
  const read = options.read || readJson;
  const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const say = options.say || console.log;
  const attempts = options.attempts || ATTEMPTS;
  let problems = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    problems = [];
    try {
      const status = await read(`${base}/v1/status`);
      problems = statusProblems(status, build).map((problem) => `status: ${problem}`);
      if (!problems.length) {
        const answer = await read(`${base}/v1/selftest`);
        problems = selfTestProblems(answer, build).map((problem) => `self-test: ${problem}`);
        if (!problems.length) {
          say(`GlowBot ${status.version} (build ${status.build || "unknown"}) is live and its self-test passed:`);
          for (const check of answer.result.checks) say(`  ok  ${check.name}: ${check.detail}`);
          return [];
        }
      }
    } catch (error) {
      problems = [`no answer: ${(error && error.message) || error}`];
    }
    say(`Try ${attempt} of ${attempts}:`);
    for (const problem of problems) say(`  ${problem}`);
    if (attempt < attempts) await wait(GAP_MS);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const given = process.argv.slice(2);
  const wantsProfile = given.includes("--profile");
  const [base, build] = given.filter((word) => word !== "--profile");
  if (!base) {
    console.error("Usage: node tools/check_live.js <worker address> [build] [--profile]");
    process.exit(2);
  }
  const address = base.replace(/\/+$/, "");
  const problems = await checkLive(address, build || "");
  if (wantsProfile && !problems.length) {
    try {
      const found = profileProblems(await readJson(`${address}/v1/profile`));
      if (!found.length) console.log("Telegram shows the name, menus, descriptions and picture of this version.");
      for (const problem of found) console.log(`  profile: ${problem}`);
      problems.push(...found);
    } catch (error) {
      console.log(`  profile: no answer: ${(error && error.message) || error}`);
      problems.push("no profile answer");
    }
  }
  process.exit(problems.length ? 1 : 0);
}
