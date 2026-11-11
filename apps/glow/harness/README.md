# GlowHarness: the engine, the tools and the measurements

GlowHarness is the agent harness Glow built from scratch. A harness is everything around a language
model that lets it act: the step loop, the tool protocol, the reader that forgives a weak model's
malformed tool calls, the permission gate, the guards that stop a run going wrong, and the trace that
makes every run inspectable and replayable. There is no third-party code and no build step.

The page is `apps/glow/web/harness/` (https://juw12.github.io/projects/glow/harness/). This folder holds
the benchmark runner and the saved model runs. Every figure the page shows is read from
`apps/glow/web/harness/bench.json`, which `bench.js` writes. Nothing is typed in by hand, and this
README states no results for the same reason: open `bench.json` or the page.

## What is where

| File | What it does |
|---|---|
| `../web/shared/glow-harness.js` | The engine: loop, call reader and repairs, permission gate, taint rule, guards, trace, replay. No dependencies. It knows no tool and no model. |
| `../web/shared/glow-harness-kit.js` | The tools (`calc`, `text`, `clock`, `units`, `notes`, `library`, `tale`), the two brains (`rulesBrain`, `chatBrain`) and the free providers. |
| `../web/harness/suite.js` | The frozen benchmark: 40 tasks in 7 categories, the malformed-call corpus, the injection attacks, and the checkers. |
| `../web/harness/checks.js` | The engine checks. The same file runs in Node (`bench.js --check`) and in the reader's browser (the "Run the engine's checks in this browser" button, or `?selftest=1`). |
| `../web/harness/bench.json` | The figures. Written by `bench.js`, read by the page. |
| `bench.js` | The runner. Modes below. |
| `results/model-run.<provider>.json` | One saved model run per provider: every call, every answer, every attempt, the pacing used. |
| `results/model-traces.<provider>.json` | The harness traces of that run, so replay can be checked again by anyone. |
| `../tests/test_glow_harness.py` | Static checks, the Node checks, and browser runs: the self-test, one task with its replay, and the page with no network. Runs in CI. |

## Use it in another Glow page

```html
<script src="../shared/glow-harness.js"></script>
<script src="../shared/glow-harness-kit.js"></script>
```

```js
const tools = GlowHarnessKit.createTools({ now: () => Date.now(), storage: localStorage });
const harness = GlowHarness.createHarness({
  brain: GlowHarnessKit.rulesBrain(),          // or GlowHarnessKit.chatBrain()
  tools,
  confirm: async (request) => "once",          // "once" | "always" | "deny"; show request.summary to the user
  policies: { notes: "ask" },                  // per tool: "allow" | "ask" | "deny"
  onEvent: (event) => console.log(event),
});
const result = await harness.run("What is 48217 times 9364?", { signal });
// result = { status, answer, steps, toolCalls, fallback, message, ms, trace }
const check = await GlowHarness.replay(result.trace, { tools });   // check.identical === true
```

In Node both files export the same objects through `module.exports`.

### The parts

- **Brain**: `{ next({ messages, tools, step, signal }) }` returning the text of one step (or
  `{ text, via }`). A step is either `TOOL {"name": "calc", "args": {"expression": "17 * 23"}}` or
  `FINAL <answer>`. Anything that speaks this protocol can be a brain: a hosted model, a local model,
  or plain rules.
- **Tool**: `{ name, description, params: { key: { type, required, enum, aliases } }, examples, hint,
  risk(args), untrusted, run(args, ctx) }`. `risk` returns `"read"`, `"write"`, `"destructive"` or
  `"download"`. A risk the engine does not know is treated as `"destructive"`.
- **Result status**: `done`, `limit` (steps, repairs or time ran out), `loop` (the same call a third
  time), `stopped` (the caller's signal) or `error`.
- **Defaults**: 8 steps, 2 repairs in a row, 20 s per tool, 120 s per run, 1,500 characters kept per
  tool result, 12,000 characters of context. Each can be passed to `createHarness`.

### Safety rules that hold by construction

1. Reads run. Anything else needs the user's yes, unless the user set that tool to "allow".
2. No `confirm` handler means every prompt is denied. The gate fails closed.
3. Taint: once a run has read untrusted text (a library passage, a saved note, generated text), every
   later action that is not a read needs a fresh yes, even for a tool set to "allow". An "always"
   given while tainted counts once. Injected text cannot spend an old approval.
4. A repeated identical call gets its earlier result back; the third repeat ends the run.
5. There is no `eval` and no `new Function` in the engine, the kit, the suite or the page, and the
   page's Content-Security-Policy forbids both.

### The no-model brain

`rulesBrain()` uses no model: pattern rules that speak the same protocol. It is offline, instant,
English only, and it knows no facts. It exists so the harness works with nothing downloaded, and so the
loop, the gate and the tools can be tested without a network. It fails the suite's control questions
on purpose, and the page says so.

## Measurements

Node 18 or newer, no packages. Run from the repo root.

```
node apps/glow/harness/bench.js --check     # every engine check; exit 0 only when all pass
node apps/glow/harness/bench.js             # write web/harness/bench.json (only when every check passes)
node apps/glow/harness/bench.js --verify    # rebuild the figures; fail if the committed file says anything else
node apps/glow/harness/bench.js --smoke --provider ovh    # three prompts that are NOT in the suite
node apps/glow/harness/bench.js --model --provider ovh    # the 40-task suite: bare model, then through the harness
node apps/glow/harness/bench.js --model --provider ovh --settle   # no calls: close what stayed unanswered
```

What `bench.json` holds, all of it rebuilt by `--verify` except the day and the Node version:

- `engine`, `limits`, `tools`, `checks`: sizes, defaults and the check count.
- `suite`: the task count by category, and the ids of the tasks that ask for today's date or for a
  saved note (`clock_or_memory_tasks`, with `memory_tasks` as the part of it that is about notes).
- `rules`: the no-model brain on the suite, by category, with its failures.
- `parser`: the malformed-call corpus read by a strict reader and by the engine, with the cases the
  engine still misses listed by id, and the well-formed controls.
- `injection`: scripted attacks hidden in tool results, run with the taint rule and without it.
- `replay`: every trace of the deterministic runs replayed and compared.
- `models`: one block per provider whose model run is complete (see below): the score alone and in
  the harness by category, the same score with the date and note tasks left out, the task-by-task
  comparison, and why any task got no reply.

### The model comparison

`--model` sends each of the 40 tasks to one free hosted model twice: bare (the question alone) and
through the harness (same model, same temperature 0, one pass, no failover). The benchmark answers
every permission prompt with yes, so it measures capability, not the gate. The wall-clock limit of a
run is lifted for the benchmark because free tiers ration calls; steps, repairs and tool time keep
their defaults.

Category G is control questions that need no tool; they show whether the harness makes a model worse
at things it could already do.

### Tasks that need today's date or a saved note

Five tasks ask about today (C1, C2, C3, F1, F4) and three ask for a note saved in an earlier
conversation (E1, E2, E3). A model alone is sent the question and the request for an `ANSWER:` line,
nothing else (`barePrompt` in `suite.js`), so it is given neither the date nor the note. `bench.json`
lists these tasks as `suite.clock_or_memory_tasks` and `suite.memory_tasks`.

In `suite.js` the list is still called `IMPOSSIBLE_BARE`. The suite was frozen before the runs, and the
name turned out to be too strong: the models alone got some of the date tasks right. Each model block
says which, under `clock_or_memory.bare_passed_ids`. We never sent a date. One saved reply quotes a
`Today Date:` line "in your prompt", and that line is in none of our files, so the provider put it
there. This fits the chat templates the two models are published with: Llama 3.3's opens the system
message with a `Today Date:` line and gpt-oss's with a `Current date:` line, and whoever hosts the
model fills it in. The runs were made on the day the suite's clock is pinned to (in UTC), so that
line carried the very date the checkers expect. On another day it would not, and those answers would
not match. Nothing here measures that: it would take a second run on a different day.

Only the three note tasks cannot be answered alone at all, and in the saved runs no model alone
passed one. The page therefore shows the comparison both ways: every task, and
`without_clock_or_memory`, which leaves all eight out.

One checker is more lenient than it looks. F4 asks the model to save a note and then to count the
days to a date. The checker reads only the count. A model alone that gets the count right passes,
even when it claims to have saved a note it has no means to save, and one saved reply does exactly
that. The checker was frozen with the suite, so it stays and that row counts as a pass alone.

### Task by task

A total hides which tasks moved. Each model block has `paired`: `gained` (wrong alone, right in the
harness), `lost` (the reverse), `both_right`, `both_wrong`, and the ids of the tasks that changed.
`gained_after_no_reply` and `lost_to_no_reply` count the changes where the other side was a provider
that never answered, not a wrong answer. A loss of that kind is still a loss: that is the rule
written down before the results were seen (next section).

`sign_test_p` is an exact two-sided sign test on gained against lost: how often a fair coin would
split that many changed tasks at least this unevenly. The page calls a split clear below 0.05 and
says in plain words when it is not. The test treats tasks as independent, which tasks written by one
author are only roughly, so read it as a guard against over-reading a small difference, not as proof.

Providers are `pollinations`, `ovh` and `llm7`. Each keeps its own result files, so two runs can be in
flight at once. A run is resumable: a task the model answered is never asked twice, a task whose call
never reached the model is tried again on the next run. `--fresh` throws the saved run away.

### When a provider does not answer

Written down before the results were seen and applied the same way to both conditions and every
provider:

- A task whose call gets no usable reply after all attempts is "unanswered". Run `--model` again to
  retry it, at most two more times.
- A task still unanswered after that is settled as a miss with `--model --provider <id> --settle`.
  `--settle` makes no calls: it only closes the tasks the re-runs could not get an answer for, and it
  exits with 2 if any task was never asked. A settled row is flagged `noReply`, and the page reports
  the count next to the score.
- A provider appears in `bench.json` only when every task is answered or settled.
- `bench.json` says why, per condition, under `no_reply_reasons`. The reason is read from the last
  error of the task's last call in `results/model-run.<provider>.json`: `provider_parse` (the provider
  could not read what the model wrote), `output_limit` (the model used up its output allowance before
  it answered), `rate_limit`, `timeout` or `other`. The page puts the reasons into words under the
  score, so a miss caused by the provider is not mistaken for a wrong answer.

One thing the saved runs show, worth knowing before spending a re-run: a provider can hand back a
stored error. In the Pollinations run, the re-runs got the first failure back again, with the time of
the original failure still inside the error body, and the reply came back almost at once. The protocol is
frozen (same prompt, temperature 0), so the request cannot be varied to get past it, and those tasks
were settled as misses. The attempts, their times and the error bodies are all in the result file.

### Rules for changing anything here

- The suite is frozen. After results are seen, only a checker that marks a correct answer wrong may be
  fixed, for every condition at once, and the fix is logged.
- If the engine or its prompt changes after a model run, the run is repeated and the page says so.
- Smoke prompts are never suite tasks.
- The suite is small and was written by the same author as the harness. It shows what this harness
  does for a small free model on tasks that suit tools. It is not a general agent benchmark, and
  GlowHarness does not edit files, run programs or browse the web. The page says where Claude Code,
  Codex CLI and OpenCode are better.

## The page and the Glow assistant button

Every Glow page carries the floating assistant button. On a phone it can end up on top of the Run
button or of a permission prompt. The page guards against that itself (`keepCrownClear` in
`harness.js`). When the button and something you can press overlap by a fifth or more of the smaller
of the two, the button turns see-through and lets taps through to what is under it. While a
permission question is open it does the same wherever it touches the question at all, its text
included, so the question is never read through the button. It is never removed: Tab still reaches
it, keyboard focus brings it back, Enter or Space opens it, it stays while its panel is open, and it
returns as soon as the control has scrolled out from under it or the question has been answered.

## Tests

```
python -X utf8 apps/glow/tests/test_glow_harness.py
```

Static checks need only Python. The Node checks run when `node` is on the path. The browser checks
need Playwright: the page with the self-test switched on, one example with the no-model brain and its
replay, the same example with no network at all after one visit to the Glow home page, served from
the copy the service worker saved, and the assistant button at phone width, where a tap has to go
through it to Run while the keyboard still finds it and opens it, and where it has to keep off an
open permission question and may return once the question is answered. No test calls a real
provider.
