#!/usr/bin/env node
// GlowHarness: the measurements behind the page. No dependencies. Node 18 or newer.
//
//   node bench.js --check     run every engine check; exit 0 only when all of them pass
//   node bench.js --smoke     three prompts that are NOT in the suite, through the harness with a free model
//   node bench.js --model     the frozen 40-task suite against a free model: bare, then through the harness
//   node bench.js             write web/harness/bench.json from the deterministic runs and the saved model runs
//   node bench.js --verify    rebuild those figures and fail if the committed bench.json says anything else
//
// --smoke and --model take --provider <id> (pollinations, ovh or llm7; the default is pollinations). Each
// provider keeps its own result files, so two model runs can be in flight at once.
// A model run is resumable: a task whose call never reached the model is tried again on the next run,
// a task the model answered is never asked twice. Pass --fresh to throw the saved run away.
"use strict";

const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "web");
const ENGINE_FILE = path.join(WEB, "shared", "glow-harness.js");
const KIT_FILE = path.join(WEB, "shared", "glow-harness-kit.js");
const H = require(ENGINE_FILE);
const K = require(KIT_FILE);
const S = require(path.join(WEB, "harness", "suite.js"));
const C = require(path.join(WEB, "harness", "checks.js"));

const ARGS = process.argv.slice(2);
const optionValue = (name) => (ARGS.includes(name) ? ARGS[ARGS.indexOf(name) + 1] : undefined);

const RESULTS = path.join(__dirname, "results");
const runFile = (id) => path.join(RESULTS, `model-run.${id}.json`);
const tracesFile = (id) => path.join(RESULTS, `model-traces.${id}.json`);
const BENCH = path.join(WEB, "harness", "bench.json");

// One free provider per run, so the two conditions meet the same model. No failover during the benchmark.
const PROVIDER = K.PROVIDERS.find((provider) => provider.id === (optionValue("--provider") || K.PROVIDERS[0].id));
if (!PROVIDER) {
  console.error(`unknown provider: use one of ${K.PROVIDERS.map((provider) => provider.id).join(", ")}`);
  process.exit(2);
}
const TEMPERATURE = 0;
// Free tiers are rationed and the road to them is not always open, so every provider gets its own pacing.
// gapMs: time between the starts of two calls. Pollinations answers an anonymous caller once every 45
// seconds; OVHcloud allows two calls per clock minute. timeoutMs: how long one attempt waits for a reply.
// Pollinations keeps working on a slow request and refuses everything else from the same address until it
// is done, so its attempts wait long; OVHcloud answers within seconds or not at all, so its attempts are
// short. attempts: tries per call. silences: how many tries may end with no response before giving up.
const TRANSPORT = {
  pollinations: { gapMs: 46000, timeoutMs: 300000, attempts: 6, silences: 2 },
  ovh: { gapMs: 31000, timeoutMs: 25000, attempts: 12, silences: 10 },
  llm7: { gapMs: 7000, timeoutMs: 60000, attempts: 6, silences: 3 },
};
const PACE = TRANSPORT[PROVIDER.id] || { gapMs: 10000, timeoutMs: 60000, attempts: 6, silences: 3 };
const GAP_MS = PACE.gapMs;
const EMPTY_TRIES = 3; // a reply with nothing in it is asked for again this many times, then taken as the reply
// The day the public documentation of Claude Code, Codex CLI and OpenCode was read for the comparison table.
const REFERENCES_CHECKED = "2026-11-11";
// Spacing the calls out makes a run slow, so the wall-clock guard is lifted for the benchmark. Every other
// limit (steps, repairs, tool time) stays at its default.
const HARNESS_CONFIG = { totalTimeMs: 60 * 60 * 1000 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lfBytes = (file) => Buffer.byteLength(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"), "utf8");
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
const clip = (text, limit) => (text.length > limit ? text.slice(0, limit) + " [...]" : text);
const pad = (value) => String(value).padStart(2, "0");

function writeJson(file, value, indent) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, indent === undefined ? 2 : indent) + "\n", "utf8");
  fs.renameSync(temporary, file);
}

function localDate(when) {
  const date = when ? new Date(when) : new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function countBy(items, keyOf) {
  const counts = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
}

// ------------------------------------------------------------------ checks
async function runChecks(quiet) {
  const report = await C.run(H, K, S);
  if (!quiet) {
    for (const failure of report.failures) console.log(`FAIL ${failure.name} :: ${failure.error}`);
    console.log(`${report.passed} of ${report.total} checks pass`);
  }
  return report;
}

// ------------------------------------------------------------------ talking to the free model
// Every attempt is written to `log`. A rate limit, a 5xx, a proxy hiccup or a dropped connection is tried
// again after a wait. A reply with nothing in it is asked for again too; if it stays empty it is handed on
// as the model's reply, which the harness treats like any other unusable reply. Anything else is handed
// back as it came.
function pacedSender(log, onAttempt) {
  let lastStart = 0;
  return async (url, init) => {
    let refused = null;
    let empties = 0;
    let silences = 0;
    let made = 0;
    for (let attempt = 1; attempt <= PACE.attempts; attempt++) {
      made = attempt;
      const wait = lastStart + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
      const entry = { at: new Date(lastStart).toISOString(), attempt, status: 0, ms: 0, model: "", channel: "", promptTokens: 0, completionTokens: 0, error: "" };
      log.push(entry);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PACE.timeoutMs);
      let pause = NaN;
      let silent = false;
      try {
        const raw = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: controller.signal });
        entry.status = raw.status;
        const body = await raw.text();
        let data = null;
        try {
          data = JSON.parse(body);
        } catch (error) {
          data = null;
        }
        if (raw.ok && data && Array.isArray(data.choices) && data.choices.length) {
          const usage = data.usage || {};
          const read = K.readChoice(data.choices[0]);
          entry.model = String(data.model || "");
          entry.promptTokens = Number(usage.prompt_tokens) || 0;
          entry.completionTokens = Number(usage.completion_tokens) || 0;
          const answer = { ok: true, status: raw.status, json: async () => data };
          if (read) {
            entry.channel = read.channel;
            return answer;
          }
          entry.error = "no text in the reply";
          empties++;
          if (empties >= EMPTY_TRIES) return answer;
        } else {
          entry.error = clip(body.replace(/\s+/g, " "), 200) || "an empty response";
          refused = { ok: false, status: raw.ok ? 502 : raw.status, json: async () => data };
          const stated = /Retry after (\d+)\s*s/i.exec(body);
          const rationed = raw.status === 402 && (/FREE_LIMIT/.test(body) || !!stated);
          const retryable = raw.ok || rationed || raw.status === 429 || raw.status === 407 || raw.status >= 500;
          if (!retryable) return refused;
          pause = stated ? Number(stated[1]) + 1 : Number(raw.headers.get("retry-after"));
        }
      } catch (error) {
        silent = controller.signal.aborted;
        if (silent) silences++;
        entry.error = silent ? "no reply in time" : String((error && error.message) || error);
      } finally {
        clearTimeout(timer);
        entry.ms = Date.now() - lastStart;
        if (onAttempt) onAttempt(entry);
      }
      if (silences >= PACE.silences) break;
      // After a silent attempt the gap alone decides when the next one goes out.
      if (attempt < PACE.attempts) await sleep(silent ? 1000 : pause > 0 && pause <= 120 ? pause * 1000 : Math.min(60000, 6000 * 2 ** (attempt - 1)));
    }
    if (refused) return refused;
    throw new Error(`no reply after ${made} attempts`);
  };
}

const brainFor = (sender) => () =>
  K.chatBrain({
    providers: [PROVIDER],
    fetch: sender,
    headers: { "User-Agent": "Mozilla/5.0 (GlowHarness bench)" },
    temperature: TEMPERATURE,
    allowEmpty: true,
    timeoutMs: 20 * 60 * 1000, // the sender does its own waiting and retrying
  });

// A run the model never took part in: the provider did not answer at all.
const neverAnswered = (traces) => traces.some((trace) => trace.events.some((event) => event.type === "error" && /No free model answered/.test(String(event.message))));

// ------------------------------------------------------------------ --smoke
const SMOKE = ["What is 12 times 12?", "How many times does the letter a appear in banana?", "What day of the week is 25 December 2030?"];

async function smoke() {
  const log = [];
  console.log(`provider ${PROVIDER.label} (${PROVIDER.model}), one call every ${GAP_MS / 1000} s`);
  const sender = pacedSender(log, (entry) =>
    console.log(`  attempt ${entry.attempt}: ${entry.status || "no response"} in ${entry.ms} ms  ${[entry.model, entry.channel, entry.error].filter(Boolean).join("  ")}`)
  );
  const makeBrain = brainFor(sender);
  const system = H.createHarness({ brain: makeBrain(), tools: K.createTools(S.makeEnv(K)) }).systemPrompt();
  console.log(`--- system prompt (${system.length} characters) ---\n${system}\n`);
  const show = (event) => {
    if (event.type === "model") console.log(`  model   ${JSON.stringify(clip(String(event.text), 300))}${event.via && event.via.channel ? ` [${event.via.channel}]` : ""}`);
    if (event.type === "parse") console.log(`  parse   ${event.kind}${event.tool ? ` ${event.tool} ${JSON.stringify(event.args)}` : ""}${event.format ? ` [${event.format}]` : ""}${event.repairs && event.repairs.length ? ` repairs=${event.repairs.join(",")}` : ""}${event.reason ? ` (${event.reason})` : ""}`);
    if (event.type === "tool") console.log(`  tool    ${event.ok ? "ok" : "failed"} ${JSON.stringify(clip(String(event.ok ? event.result : event.error), 200))}`);
    if (event.type === "error") console.log(`  error   ${event.message}`);
  };
  for (const prompt of SMOKE) {
    console.log(`--- ${prompt}`);
    const harness = H.createHarness(Object.assign({ brain: makeBrain(), tools: K.createTools(S.makeEnv(K)), confirm: async () => "once" }, HARNESS_CONFIG));
    const result = await harness.run(prompt, { onEvent: show });
    console.log(`  => ${result.status}: ${JSON.stringify(result.answer)} (${result.steps} steps, ${result.toolCalls} tool calls)`);
  }
  console.log(`\n${log.length} attempts, models: ${JSON.stringify(countBy(log.filter((entry) => entry.model), (entry) => entry.model))}`);
}

// ------------------------------------------------------------------ --model
async function modelRun(fresh) {
  const MODEL_RUN = runFile(PROVIDER.id);
  const MODEL_TRACES = tracesFile(PROVIDER.id);
  const saved = fresh ? null : readJson(MODEL_RUN);
  console.log(`provider ${PROVIDER.label} (${PROVIDER.model}), one call every ${GAP_MS / 1000} s, up to ${PACE.timeoutMs / 1000} s per attempt${saved ? ", resuming a saved run" : ""}`);
  const run =
    saved && saved.v === 1 && saved.provider.id === PROVIDER.id
      ? saved
      : {
          v: 1,
          started: new Date().toISOString(),
          finished: "",
          complete: false,
          node: process.version,
          engine: H.VERSION,
          provider: { id: PROVIDER.id, label: PROVIDER.label, url: PROVIDER.url, requested: PROVIDER.model },
          temperature: TEMPERATURE,
          passes: 1,
          gapMs: GAP_MS,
          harnessConfig: HARNESS_CONFIG,
          calls: [],
          bare: {},
          harness: {},
          replay: null,
        };
  const traces = (!fresh && readJson(MODEL_TRACES)) || {};
  // Every start of the runner is written down with its pacing, so a resumed run shows where it was resumed.
  if (!Array.isArray(run.segments)) run.segments = [];
  // --settle asks nothing: it only closes the tasks that the re-runs could not get an answer for.
  const settle = ARGS.includes("--settle");
  if (settle) {
    const neverAsked = S.TASKS.filter((task) => !run.bare[task.id] || !run.harness[task.id]).map((task) => task.id);
    if (neverAsked.length) {
      console.log(`nothing to settle yet: ${neverAsked.join(", ")} were never asked. Run --model without --settle first.`);
      return 2;
    }
  } else {
    run.segments.push({ started: new Date().toISOString(), fromCall: run.calls.length, transport: PACE });
  }
  // A failed attempt is printed as it happens, so a stalled run can be told from a slow one.
  const makeBrain = brainFor(
    pacedSender(run.calls, (entry) => {
      if (entry.error) console.log(`    attempt ${entry.attempt}: ${entry.status || "no response"} after ${entry.ms} ms  ${entry.error}`);
    })
  );
  const save = () => {
    writeJson(MODEL_RUN, run);
    writeJson(MODEL_TRACES, traces, 0);
  };

  for (const task of settle ? [] : S.TASKS) {
    if (!run.bare[task.id] || run.bare[task.id].unanswered) {
      const from = run.calls.length;
      let reply = "";
      let failure = "";
      try {
        reply = (await makeBrain().next({ messages: [{ role: "user", content: S.barePrompt(task) }] })).text;
      } catch (error) {
        failure = String((error && error.message) || error);
      }
      const judged = S.extractBare(reply);
      run.bare[task.id] = {
        id: task.id,
        category: task.category,
        pass: !failure && S.check(task, judged),
        judged: clip(judged.trim(), 400),
        reply: clip(reply, 4000),
        unanswered: !!failure,
        message: failure,
        calls: [from, run.calls.length],
      };
      save();
      console.log(`${task.id} bare     ${failure ? "UNANSWERED " + failure : run.bare[task.id].pass ? "pass" : "FAIL"}  ${JSON.stringify(clip(judged.trim(), 90))}`);
    }
    if (!run.harness[task.id] || run.harness[task.id].unanswered) {
      const from = run.calls.length;
      const row = await S.runTask(H, K, task, { makeBrain, config: HARNESS_CONFIG });
      traces[task.id] = row.traces;
      const kept = Object.assign({}, row, { answer: clip(String(row.answer === null || row.answer === undefined ? "" : row.answer), 2000) });
      delete kept.traces;
      run.harness[task.id] = Object.assign(kept, { unanswered: neverAnswered(row.traces), calls: [from, run.calls.length] });
      save();
      console.log(`${task.id} harness  ${run.harness[task.id].unanswered ? "UNANSWERED" : row.pass ? "pass" : "FAIL"}  ${row.status}${row.fallback ? " (fallback)" : ""} steps=${row.steps} calls=${row.toolCalls} repaired=${row.repairedCalls} repairTurns=${row.repairTurns}  ${JSON.stringify(clip(kept.answer, 90))}`);
    }
  }

  let unanswered = S.TASKS.filter((task) => run.bare[task.id].unanswered || run.harness[task.id].unanswered).map((task) => task.id);
  if (unanswered.length && settle) {
    // The last word on a task the provider never answered: it counts as a miss and is reported as one.
    for (const task of S.TASKS) {
      for (const row of [run.bare[task.id], run.harness[task.id]]) {
        if (!row.unanswered) continue;
        row.unanswered = false;
        row.noReply = true;
        row.pass = false;
      }
    }
    console.log(`settled as misses with no reply: ${unanswered.join(", ")}`);
    run.settled = { at: new Date().toISOString(), tasks: unanswered };
    unanswered = [];
  }
  run.complete = unanswered.length === 0;
  run.finished = new Date().toISOString();
  const all = [];
  for (const task of S.TASKS) for (const trace of traces[task.id] || []) all.push(trace);
  const replayed = await S.replayAll(H, K, all);
  run.replay = { traces: replayed.traces, identical: replayed.identical, different: replayed.different };
  save();

  const block = modelBlock(run, traces);
  console.log("");
  if (!block) {
    console.log(`INCOMPLETE: the provider never answered for ${unanswered.join(", ")}. Run --model again to finish those.`);
    return 3;
  }
  console.log(`bare     ${block.bare.passed} of ${block.bare.total}   ${JSON.stringify(block.bare.by_category)}`);
  console.log(`harness  ${block.harness.passed} of ${block.harness.total}   ${JSON.stringify(block.harness.by_category)}`);
  console.log(`replay   ${block.replay.identical} of ${block.replay.traces} traces identical`);
  return 0;
}

// ------------------------------------------------------------------ the figures
const byCategory = (tally) => Object.fromEntries(Object.entries(tally.byCategory).map(([id, counts]) => [id, { passed: counts.passed, total: counts.total }]));

function tokensOf(run, rows) {
  let prompt = 0;
  let completion = 0;
  let attempts = 0;
  let answered = 0;
  for (const row of rows) {
    for (const entry of run.calls.slice(row.calls[0], row.calls[1])) {
      attempts++;
      if (entry.model) answered++;
      prompt += entry.promptTokens;
      completion += entry.completionTokens;
    }
  }
  return { model_calls: answered, attempts, prompt_tokens: prompt, completion_tokens: completion };
}

// Exact two-sided sign test: how often chance alone splits the changed tasks at least this unevenly.
function signTest(gained, lost) {
  const changed = gained + lost;
  if (!changed) return 1;
  const larger = Math.max(gained, lost);
  let coefficient = 1;
  let tail = 0;
  for (let k = 0; k <= changed; k++) {
    if (k >= larger) tail += coefficient;
    coefficient = (coefficient * (changed - k)) / (k + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** changed);
}

// Task by task: what changed between a model alone and the same model inside the harness.
function pairedOf(bareRows, harnessRows) {
  const gained = [];
  const lost = [];
  let bothRight = 0;
  let bothWrong = 0;
  let gainedAfterNoReply = 0;
  let lostToNoReply = 0;
  bareRows.forEach((bare, index) => {
    const inside = harnessRows[index];
    if (bare.pass && inside.pass) bothRight += 1;
    else if (!bare.pass && !inside.pass) bothWrong += 1;
    else if (inside.pass) {
      gained.push(bare.id);
      if (bare.noReply) gainedAfterNoReply += 1;
    } else {
      lost.push(bare.id);
      if (inside.noReply) lostToNoReply += 1;
    }
  });
  return {
    gained: gained.length,
    lost: lost.length,
    both_right: bothRight,
    both_wrong: bothWrong,
    gained_ids: gained,
    lost_ids: lost,
    gained_after_no_reply: gainedAfterNoReply,
    lost_to_no_reply: lostToNoReply,
    sign_test_p: Number(signTest(gained.length, lost.length).toPrecision(4)),
  };
}

function modelBlock(run, traces) {
  if (!run || !traces) return null;
  const bareRows = S.TASKS.map((task) => run.bare[task.id]);
  const harnessRows = S.TASKS.map((task) => run.harness[task.id]);
  if (bareRows.some((row) => !row || row.unanswered) || harnessRows.some((row) => !row || row.unanswered)) return null;

  const events = [];
  for (const task of S.TASKS) for (const trace of traces[task.id]) for (const event of trace.events) events.push(event);
  const parses = events.filter((event) => event.type === "parse");
  const toolParses = parses.filter((event) => event.kind === "tool");
  const repairedParses = toolParses.filter((event) => event.repairs.length > 0);
  const repairCodes = [];
  for (const event of repairedParses) for (const code of event.repairs) repairCodes.push(code);
  const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
  const possible = (rows) => rows.filter((row) => !S.IMPOSSIBLE_BARE.includes(row.id));
  const special = (rows) => rows.filter((row) => S.IMPOSSIBLE_BARE.includes(row.id));
  const bare = S.tally(bareRows);
  const harness = S.tally(harnessRows);
  const segments = Array.isArray(run.segments) && run.segments.length ? run.segments : [{ transport: { gapMs: run.gapMs, timeoutMs: 60000, attempts: 6 } }];
  const pace = segments[segments.length - 1].transport;
  const earlier = [];
  for (const segment of segments) {
    const seconds = segment.transport.timeoutMs / 1000;
    if (seconds !== pace.timeoutMs / 1000 && !earlier.includes(seconds)) earlier.push(seconds);
  }
  const silent = (rows) => rows.filter((row) => row.noReply).length;
  // Why a task got no reply, read from the last error of its last call, so the page can say it in words.
  const reasonOf = (row) => {
    const span = run.calls.slice(row.calls[0], row.calls[1]);
    const last = span.length ? String(span[span.length - 1].error || "") : "";
    if (/unexpected tokens remaining in message header/i.test(last)) return "provider_parse";
    if (/output token limit/i.test(last)) return "output_limit";
    if (/\b429\b|\b402\b|rate.?limit|FREE_LIMIT/i.test(last)) return "rate_limit";
    if (/timed? ?out|timeout|abort/i.test(last)) return "timeout";
    return "other";
  };
  const silentReasons = (rows) => countBy(rows.filter((row) => row.noReply), reasonOf);

  return {
    id: run.provider.id,
    provider: run.provider.label,
    requested: run.provider.requested,
    returned: Object.keys(countBy(run.calls.filter((entry) => entry.model), (entry) => entry.model)),
    temperature: run.temperature,
    passes: run.passes,
    gap_seconds: run.gapMs / 1000,
    attempt_seconds: pace.timeoutMs / 1000,
    attempts_per_call: pace.attempts,
    earlier_attempt_seconds: earlier,
    resumes: segments.length - 1,
    time_limit_seconds: run.harnessConfig.totalTimeMs / 1000,
    empty_tries: EMPTY_TRIES,
    // The UTC day the run ended, read straight from the saved timestamp, so every machine rebuilds the same figure.
    date: String(run.finished).slice(0, 10),
    node: run.node,
    engine: run.engine,
    bare: Object.assign(
      {
        passed: bare.passed,
        total: bare.total,
        by_category: byCategory(bare),
        no_reply: silent(bareRows),
        no_reply_reasons: silentReasons(bareRows),
        empty_replies: bareRows.filter((row) => !row.noReply && !String(row.reply).trim()).length,
      },
      tokensOf(run, bareRows)
    ),
    harness: Object.assign(
      {
        passed: harness.passed,
        total: harness.total,
        by_category: byCategory(harness),
        no_reply: silent(harnessRows),
        no_reply_reasons: silentReasons(harnessRows),
        runs: sum(harnessRows, "runs"),
        steps: sum(harnessRows, "steps"),
        tool_calls: sum(harnessRows, "toolCalls"),
        repaired_calls: sum(harnessRows, "repairedCalls"),
        repair_turns: sum(harnessRows, "repairTurns"),
        permission_prompts: sum(harnessRows, "prompts"),
        fallback_answers: harnessRows.filter((row) => row.fallback).length,
        fallback_answers_right: harnessRows.filter((row) => row.fallback && row.pass).length,
        statuses: countBy(harnessRows, (row) => row.status),
        native_calls: events.filter((event) => event.type === "model" && event.via && event.via.channel === "native").length,
        empty_replies: parses.filter((event) => event.kind === "invalid" && /empty/.test(String(event.reason))).length,
        call_formats: countBy(toolParses, (event) => event.format),
        repair_codes: countBy(repairCodes, (code) => code),
        unmarked_answers: parses.filter((event) => event.kind === "final" && event.implicit).length,
        unusable_replies: parses.filter((event) => event.kind !== "final" && event.kind !== "tool").length,
      },
      tokensOf(run, harnessRows)
    ),
    // The tasks that ask for today's date or a saved note. A bare model is sent neither, yet a provider may add a date.
    clock_or_memory: {
      total: special(bareRows).length,
      bare_passed: special(bareRows).filter((row) => row.pass).length,
      bare_passed_ids: special(bareRows).filter((row) => row.pass).map((row) => row.id),
      harness_passed: special(harnessRows).filter((row) => row.pass).length,
    },
    without_clock_or_memory: {
      total: possible(bareRows).length,
      bare_passed: possible(bareRows).filter((row) => row.pass).length,
      harness_passed: possible(harnessRows).filter((row) => row.pass).length,
    },
    paired: pairedOf(bareRows, harnessRows),
    replay: { traces: run.replay.traces, identical: run.replay.identical },
    rows: S.TASKS.map((task) => {
      const row = run.harness[task.id];
      return {
        id: task.id,
        category: task.category,
        bare: run.bare[task.id].pass,
        harness: row.pass,
        no_reply: [run.bare[task.id].noReply ? "bare" : "", row.noReply ? "harness" : ""].filter(Boolean).join("+"),
        status: row.status,
        fallback: row.fallback,
        steps: row.steps,
        tool_calls: row.toolCalls,
        repaired_calls: row.repairedCalls,
      };
    }),
  };
}

async function figures() {
  const report = await runChecks(true);
  const { corpus, attacks, suite, replayed } = report.measured;
  const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
  const memoryCategory = (S.CATEGORIES.find((category) => category.key === "memory") || {}).id;
  const bench = {
    v: 1,
    built: localDate(),
    node: process.version,
    references_checked: REFERENCES_CHECKED,
    engine: { version: H.VERSION, bytes: lfBytes(ENGINE_FILE), kit_bytes: lfBytes(KIT_FILE), dependencies: 0 },
    limits: {
      max_steps: H.DEFAULTS.maxSteps,
      max_repairs: H.DEFAULTS.maxRepairs,
      tool_seconds: H.DEFAULTS.toolTimeoutMs / 1000,
      total_seconds: H.DEFAULTS.totalTimeMs / 1000,
    },
    tools: K.createTools(S.makeEnv(K)).length,
    checks: { passed: report.passed, total: report.total },
    suite: {
      tasks: S.TASKS.length,
      categories: S.CATEGORIES.map((category) => ({ id: category.id, key: category.key, tasks: S.TASKS.filter((task) => task.category === category.id).length })),
      clock_or_memory_tasks: S.IMPOSSIBLE_BARE.slice(),
      memory_tasks: S.TASKS.filter((task) => task.category === memoryCategory && S.IMPOSSIBLE_BARE.includes(task.id)).map((task) => task.id),
    },
    rules: {
      passed: suite.passed,
      total: suite.total,
      by_category: byCategory(suite),
      steps: sum(suite.rows, "steps"),
      tool_calls: sum(suite.rows, "toolCalls"),
      permission_prompts: sum(suite.rows, "prompts"),
      without_clock_or_memory: {
        total: suite.rows.filter((row) => !S.IMPOSSIBLE_BARE.includes(row.id)).length,
        passed: suite.rows.filter((row) => !S.IMPOSSIBLE_BARE.includes(row.id) && row.pass).length,
      },
    },
    parser: {
      cases: corpus.cases,
      families: corpus.families,
      strict: corpus.strict,
      recovered: corpus.recovered,
      missed: corpus.rows.filter((row) => !row.recovered).map((row) => row.id),
      controls: corpus.controls,
      controls_held: corpus.controlsHeld,
    },
    injection: {
      attacks: attacks.attacks,
      delivered: attacks.delivered,
      ran_with_rule: attacks.ranWithRule,
      held_with_rule: attacks.askedWithRule,
      ran_without_rule: attacks.ranWithoutRule,
    },
    replay: { traces: replayed.traces, identical: replayed.identical },
    models: K.PROVIDERS.map((provider) => modelBlock(readJson(runFile(provider.id)), readJson(tracesFile(provider.id)))).filter(Boolean),
  };
  return { bench, report };
}

// ------------------------------------------------------------------ main
async function main() {
  const flags = new Set(ARGS);
  if (flags.has("--check")) {
    const report = await runChecks(false);
    return report.failures.length ? 1 : 0;
  }
  if (flags.has("--smoke")) {
    await smoke();
    return 0;
  }
  if (flags.has("--model")) return modelRun(flags.has("--fresh"));

  const { bench, report } = await figures();
  if (report.failures.length) {
    for (const failure of report.failures) console.log(`FAIL ${failure.name} :: ${failure.error}`);
    console.log("bench.json is only written when every check passes.");
    return 1;
  }
  if (flags.has("--verify")) {
    const committed = readJson(BENCH);
    if (!committed) {
      console.log("bench.json is missing");
      return 1;
    }
    // The day it was built and the Node that built it are the only things allowed to differ.
    const comparable = (value) => JSON.stringify(Object.assign({}, value, { built: "", node: "" }));
    if (comparable(committed) !== comparable(bench)) {
      console.log("bench.json is out of date: run `node apps/glow/harness/bench.js` and commit the result.");
      for (const key of Object.keys(bench)) {
        if (JSON.stringify(committed[key]) !== JSON.stringify(bench[key]) && key !== "built" && key !== "node") console.log(`  differs: ${key}`);
      }
      return 1;
    }
    console.log("bench.json matches a fresh run");
    return 0;
  }
  writeJson(BENCH, bench);
  console.log(`wrote ${path.relative(process.cwd(), BENCH)} with ${bench.models.length ? "model runs for " + bench.models.map((block) => block.provider).join(", ") : "no finished model run yet"}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(2);
  }
);
