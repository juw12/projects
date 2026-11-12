// GlowCode: write or request a Kilat program, check it, and run it in a sandbox on this device.
// The Kilat engine is ./kilat.js plus ./kilat.wasm (https://github.com/juw12/kilat).
import { loadKilat } from "./kilat.js";

const K = window.GlowHarnessKit;
const root = document.documentElement;
const $ = (id) => document.getElementById(id);

const CHAT_STORE_KEY = "mufakat.v1";
const HOME_THEME_KEY = "glow.home.theme";
const BRAIN_KEY = "glow.code.brain.v1";
const FUEL_LIMIT = 20000000; // loop turns and function calls one run may make
const MEMORY_MB = 32;
const SHOWN_CHARS = 20000; // printed text beyond this is cut on the page
const MODEL_TRIES = 3; // the first answer plus two corrections
const TASK_MAX = 1200;

const EXAMPLES = [
  {
    icon: "🔩",
    label: "Stress in a bar",
    code: 'let force = 250 N\nlet area = 4 mm * 3 mm\nprint("stress = {force / area:MPa.1}")\n',
  },
  {
    icon: "📏",
    label: "Gap statistics",
    code:
      "let gaps = [1.9 mm, 2.1 mm, 2.0 mm, 2.4 mm]\n" +
      'print("mean   {mean(gaps):mm.2}")\n' +
      'print("median {median(gaps):mm.2}")\n' +
      'print("spread {stddev(gaps):mm.3}")\n',
  },
  {
    icon: "⛔",
    label: "A unit mistake",
    code: "let length = 2 m\nlet mass = 3 kg\nlet wrong = length + mass\nprint(wrong)\n",
  },
  {
    icon: "🔁",
    label: "A function and a loop",
    code:
      "fn fib(n: Int) -> Int {\n" +
      "    if n < 2 {\n" +
      "        return n\n" +
      "    }\n" +
      "    return fib(n - 1) + fib(n - 2)\n" +
      "}\n" +
      "\n" +
      "for i in 0..10 {\n" +
      "    print(fib(i))\n" +
      "}\n",
  },
  {
    icon: "♾",
    label: "A loop that never ends",
    code: "var count = 0\nwhile true {\n    count = count + 1\n}\n",
  },
];

const TASKS = [
  { icon: "🔩", text: "A 1.5 kN load hangs on a round steel rod 6 mm in diameter. Print the stress in MPa." },
  { icon: "⚡", text: "A 12 V supply feeds a 470 ohm resistor. Print the current in mA and the power in mW." },
  { icon: "📦", text: "A box is 300 mm by 200 mm by 150 mm. Print its volume in litres." },
];

// What a model is told about Kilat. Every line here was run against the engine.
const SYSTEM_PROMPT = [
  "You write programs in Kilat, a small statically checked language. Kilat is NOT Python.",
  "Reply with one complete Kilat program inside a single ```kilat code block and nothing else.",
  "",
  "Rules of Kilat:",
  "- `let name = value` cannot be reassigned; `var name = value` can. `//` starts a comment.",
  "- A number followed by a unit is a quantity: `250 N`, `4 mm`, `9.81 m/s^2`, `1.5 kN`, `12 V`, `470 ohm`.",
  "  Inside a unit, `*`, `/` and `^` are written without spaces. Units are checked before the program runs,",
  "  so adding metres to kilograms is an error.",
  "- Built-in units include m km cm mm um inch ft, kg g t lb, s ms min h, N kN MN, Pa kPa MPa GPa bar psi,",
  "  J kJ Wh kWh, W kW mW, A mA V mV ohm kohm, Hz kHz rpm, rad deg, L mL.",
  "- Print with `print(\"text {expr}\")`. `{expr:MPa.1}` prints a quantity in MPa with 1 decimal;",
  "  `{expr:.2}` prints a plain number with 2 decimals. `{{` and `}}` are literal braces.",
  "- `x in mm` turns a quantity into a plain Float measured in mm.",
  "- `/` always gives a Float. `div` is whole-number division. `^` is power. `pi` is built in.",
  "  Logic words are `and`, `or`, `not`. An Int never becomes a quantity by itself: write `n * 1 mm`.",
  "- Blocks use braces: `if a < b { ... } else { ... }`, `while cond { ... }`, `for i in 0..10 { ... }`",
  "  (`0..10` leaves out 10, `0..=10` includes it), `for item in list { ... }`.",
  "- Functions: `fn area(w: mm, h: mm) -> mm^2 { w * h }`. Types: Int, Float, Bool, Str, List[T], and units.",
  "- Lists are `[1, 2, 3]`; `len(list)`, `sum(list)`, `mean(list)`, `median(list)`, `stddev(list)`, `sqrt(x)`.",
  "- There is no import, no input and no file or network access. Compute and print only.",
  "",
  "Example:",
  "```kilat",
  "let force = 250 N",
  "let area = 4 mm * 3 mm",
  'print("stress = {force / area:MPa.1}")',
  "```",
].join("\n");

const state = {
  kilat: null,
  brain: "rules",
  busy: false,
  controller: null,
};

// ---- theme: same choice as Glow home ----
function chatTheme() {
  try {
    return ((JSON.parse(localStorage.getItem(CHAT_STORE_KEY) || "null") || {}).settings || {}).theme;
  } catch (error) {
    return "";
  }
}

function preferredTheme() {
  let choice = "";
  try {
    choice = localStorage.getItem(HOME_THEME_KEY) || "";
  } catch (error) {
    choice = "";
  }
  choice = choice || chatTheme() || "system";
  if (choice === "light" || choice === "dark") return choice;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  const hint = theme === "dark" ? "Switch to light" : "Switch to dark";
  $("theme-btn").textContent = theme === "dark" ? "☀" : "☾";
  $("theme-btn").title = hint;
  $("theme-btn").setAttribute("aria-label", hint);
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#262624" : "#faf9f5";
}

applyTheme(preferredTheme());
$("theme-btn").addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(HOME_THEME_KEY, next);
  } catch (error) {
    // Storage blocked: the choice lasts for this visit only.
  }
  applyTheme(next);
});

// ---- helpers ----
function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function messageOf(error) {
  return error && error.message ? String(error.message) : String(error);
}

function setRunState(value) {
  document.body.dataset.run = value;
}

function providerNames() {
  const providers = (K && K.PROVIDERS) || [];
  return providers.map((provider) => provider.label).join(", ") || "a free AI provider";
}

// The first fenced block of a model's reply, or nothing when the reply has no fence.
export function extractCode(reply) {
  const text = String(reply || "").replace(/\r\n/g, "\n");
  const fenced = /```[\w-]*[ \t]*\n([\s\S]*?)```/.exec(text);
  const code = fenced ? fenced[1].trim() : "";
  return code ? code + "\n" : "";
}

// ---- the desk: who writes, privacy line, examples ----
function renderPrivacy() {
  const line = $("privacy-line");
  line.textContent = "";
  if (state.brain === "free") {
    line.appendChild(make("b", "", "This sends your request out."));
    line.appendChild(
      document.createTextNode(
        ` What you ask for, and any checker errors, go to a free AI provider (${providerNames()}). No account needed. The program it writes still runs only on this device.`,
      ),
    );
  } else {
    line.appendChild(make("b", "", "Nothing leaves this page."));
    line.appendChild(
      document.createTextNode(" The program is checked and run in a sandbox on this device. It cannot read files or use the network."),
    );
  }
}

function setBrain(brain) {
  state.brain = brain === "free" ? "free" : "rules";
  for (const button of $("brain-seg").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.brain === state.brain));
  }
  const free = state.brain === "free";
  $("task-row").hidden = !free;
  $("example-chips").hidden = free;
  $("run-label").textContent = free ? "Write it and run" : "Run";
  $("code-label").textContent = free ? "The program (the model's answer appears here; you can edit and rerun it)" : "Kilat program";
  renderPrivacy();
  try {
    localStorage.setItem(BRAIN_KEY, state.brain);
  } catch (error) {
    // Storage blocked: the choice lasts for this visit only.
  }
}

function renderChips() {
  for (const example of EXAMPLES) {
    const chip = make("button", "chip");
    chip.type = "button";
    chip.appendChild(make("span", "", example.icon));
    chip.firstChild.setAttribute("aria-hidden", "true");
    chip.appendChild(document.createTextNode(" " + example.label));
    chip.addEventListener("click", () => {
      $("code-box").value = example.code;
      $("code-box").focus();
    });
    $("example-chips").appendChild(chip);
  }
  for (const task of TASKS) {
    const chip = make("button", "chip");
    chip.type = "button";
    chip.appendChild(make("span", "", task.icon));
    chip.firstChild.setAttribute("aria-hidden", "true");
    chip.appendChild(document.createTextNode(" " + task.text));
    chip.addEventListener("click", () => {
      $("task-box").value = task.text;
      $("task-box").focus();
    });
    $("task-chips").appendChild(chip);
  }
}

// ---- showing a result ----
function clearResult() {
  $("result").hidden = false;
  $("result").dataset.kind = "";
  $("result-stats").textContent = "";
  $("result-status").textContent = "";
  $("result-status").dataset.kind = "";
  $("result-output").hidden = true;
  $("result-output").textContent = "";
  $("result-error").hidden = true;
  $("result-error").textContent = "";
  $("model-log").hidden = true;
  $("model-log").textContent = "";
}

function showStatus(kind, text) {
  $("result").dataset.kind = kind;
  $("result-status").dataset.kind = kind === "ok" || kind === "checked" ? "ok" : "bad";
  $("result-status").textContent = text;
}

function logStep(text, verdict) {
  const item = make("li", "", text);
  if (verdict) item.dataset.verdict = verdict;
  $("model-log").hidden = false;
  $("model-log").appendChild(item);
}

function showOutput(text) {
  if (!text) return;
  const cut = text.length > SHOWN_CHARS;
  $("result-output").textContent = cut ? text.slice(0, SHOWN_CHARS) + "\n… (the rest is not shown)" : text;
  $("result-output").hidden = false;
}

function showError(text) {
  if (!text) return;
  $("result-error").textContent = text;
  $("result-error").hidden = false;
}

const STOP_REASONS = {
  compile: "Refused before running. The checker found a mistake:",
  runtime: "The program stopped with an error:",
  fuel: `Stopped: the program used its whole work limit (${FUEL_LIMIT.toLocaleString("en")} steps). A loop probably never ends.`,
  memory: `Stopped: the program asked for more than its ${MEMORY_MB} MB memory limit.`,
  stopped: "Stopped by you.",
  crash: "The engine failed. This is a bug in Kilat, not in your program:",
};

function showRunResult(result, elapsedMs) {
  showOutput(result.output);
  if (result.ok) {
    showStatus("ok", result.output ? "Finished." : "Finished. The program printed nothing.");
  } else {
    showStatus(result.kind || "runtime", STOP_REASONS[result.kind] || STOP_REASONS.runtime);
    if (result.kind !== "stopped" && result.kind !== "fuel" && result.kind !== "memory") showError(result.error);
  }
  const steps = Number(result.fuelUsed || 0).toLocaleString("en");
  $("result-stats").textContent = `${steps} steps · ${Math.max(1, Math.round(elapsedMs))} ms`;
}

// ---- running ----
function setBusy(busy) {
  state.busy = busy;
  $("run-btn").disabled = busy || !state.kilat;
  $("check-btn").disabled = busy || !state.kilat;
  $("stop-btn").hidden = !busy;
  setRunState(busy ? "busy" : "done");
}

async function runProgram(source, signal) {
  const started = performance.now();
  const result = await state.kilat.run(source, { fuel: FUEL_LIMIT, memoryMb: MEMORY_MB, signal });
  showRunResult(result, performance.now() - started);
  return result;
}

async function checkOnly() {
  const source = $("code-box").value;
  clearResult();
  if (!source.trim()) {
    showStatus("empty", "There is no program to check. Type one, or tap an example.");
    return;
  }
  const verdict = await state.kilat.check(source);
  if (verdict.ok) {
    showStatus("checked", "The check passed: no type or unit mistakes. The program was not run.");
  } else {
    showStatus("compile", STOP_REASONS.compile);
    showError(verdict.error);
  }
}

async function runTyped(signal) {
  const source = $("code-box").value;
  clearResult();
  if (!source.trim()) {
    showStatus("empty", "There is no program to run. Type one, or tap an example.");
    return;
  }
  await runProgram(source, signal);
}

// Ask a free model for a program, check it, and send a refused program back with the checker's words.
async function writeWithModel(signal) {
  const task = $("task-box").value.trim().slice(0, TASK_MAX);
  clearResult();
  if (!task) {
    showStatus("empty", "Say what the program should work out, or tap an example request.");
    return;
  }
  if (!K || typeof K.chatBrain !== "function") {
    showStatus("model", "The free-model helper did not load, so this mode is not available. “I write it” still works.");
    return;
  }
  const brain = K.chatBrain();
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: task },
  ];
  for (let attempt = 1; attempt <= MODEL_TRIES; attempt += 1) {
    showStatus("checked", attempt === 1 ? "Asking a free model…" : "Asking the model to fix it…");
    let reply;
    try {
      reply = await brain.next({ messages, signal });
    } catch (error) {
      if (signal.aborted) {
        showStatus("stopped", STOP_REASONS.stopped);
        return;
      }
      showStatus("model", "No free model answered, so no program was written. Try again in a minute, or write it yourself.");
      showError(messageOf(error));
      return;
    }
    const via = (reply.via && (reply.via.model || reply.via.provider)) || "a free model";
    let code = extractCode(reply.text);
    if (!code) {
      // Some models leave the fence out. A bare reply counts as a program only when it passes the check;
      // anything else is treated as talk, so prose never lands in the code box.
      const bare = String(reply.text || "").replace(/\r\n/g, "\n").trim();
      if (bare && (await state.kilat.check(bare + "\n")).ok) code = bare + "\n";
    }
    if (!code) {
      logStep(`Try ${attempt}: ${via} sent no program.`, "fail");
      messages.push({ role: "assistant", content: String(reply.text || "") });
      messages.push({ role: "user", content: "That reply had no program. Reply with one complete Kilat program in a single ```kilat code block." });
      continue;
    }
    $("code-box").value = code;
    const verdict = await state.kilat.check(code);
    if (verdict.ok) {
      logStep(`Try ${attempt}: ${via} wrote a program and the checker accepted it.`, "pass");
      await runProgram(code, signal);
      return;
    }
    logStep(`Try ${attempt}: ${via} wrote a program and the checker refused it.`, "fail");
    if (attempt === MODEL_TRIES) {
      showStatus("compile", `The model did not produce a program that passes the check in ${MODEL_TRIES} tries. Its last program is in the box, and the checker's reason is below. Nothing was run.`);
      showError(verdict.error);
      return;
    }
    messages.push({ role: "assistant", content: String(reply.text || "") });
    messages.push({
      role: "user",
      content: `The Kilat checker refused that program:\n\n${verdict.error}\n\nFix it. Reply with the full corrected program in a single \`\`\`kilat code block.`,
    });
  }
  showStatus("model", `The model sent no program in ${MODEL_TRIES} tries. Nothing was run.`);
}

async function guarded(job) {
  if (state.busy || !state.kilat) return;
  state.controller = new AbortController();
  setBusy(true);
  try {
    await job(state.controller.signal);
  } catch (error) {
    showStatus("crash", STOP_REASONS.crash);
    showError(messageOf(error));
  } finally {
    state.controller = null;
    setBusy(false);
  }
}

// ---- wiring ----
renderChips();
let savedBrain = "rules";
try {
  savedBrain = localStorage.getItem(BRAIN_KEY) || "rules";
} catch (error) {
  savedBrain = "rules";
}
setBrain(savedBrain);
$("code-box").value = EXAMPLES[0].code;

$("brain-seg").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-brain]");
  if (button && !state.busy) setBrain(button.dataset.brain);
});
$("run-btn").addEventListener("click", () => guarded(state.brain === "free" && $("task-box").value.trim() ? writeWithModel : runTyped));
$("check-btn").addEventListener("click", () => guarded(checkOnly));
$("stop-btn").addEventListener("click", () => state.controller && state.controller.abort());
$("code-box").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    $("run-btn").click();
  }
});

loadKilat()
  .then((kilat) => {
    state.kilat = kilat;
    $("code-meta").textContent = `Kilat ${kilat.version} is ready. Each run may use ${FUEL_LIMIT.toLocaleString("en")} steps and ${MEMORY_MB} MB.`;
    $("run-btn").disabled = false;
    $("check-btn").disabled = false;
    setRunState("ready");
  })
  .catch((error) => {
    $("code-meta").textContent = `The Kilat engine could not load (${messageOf(error)}). Reload the page to try again.`;
    setRunState("failed");
  });
