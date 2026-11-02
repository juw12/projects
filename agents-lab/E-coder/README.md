# E — E-coder (stdlib-only coding agent)

A small coding agent that can read a repo, plan, edit files, and run tests.
Track **E** in `agents-lab/`, alongside A (VS Code), B (Scout), C (Hermes) and
D (LangGraph).

> Goal: a *coding agent I use every day* — not a Cursor competitor.

Docs: [`docs/USAGE.md`](docs/USAGE.md) (how to run/configure) ·
[`docs/DESIGN.md`](docs/DESIGN.md) (architecture + safety) ·
[`docs/PLAN.md`](docs/PLAN.md) (original design + build order).

This folder is at **M4**: a working agent that can explore a repo, make minimal
edits, and run commands — gated behind **guardrails** (a command deny-list +
confirmation), building a **gitignore-aware context** so it reads only what the
task needs. All milestones **M0–M4** are done.

## Why stdlib-only

This monorepo's principle is **no third-party dependencies** — nothing to
`pip install`. Track D (LangGraph) pulls 7 deps; E-coder deliberately does **not**
follow that. It reuses D's *ideas* (ReAct loop, guardrails, JSONL traces) with
**zero deps**: HTTP goes through `urllib.request`, JSON through `json`. It is
local-first and free (Ollama `qwen3:8b` by default, no API keys), and any
OpenAI-compatible endpoint works through the same adapter.

## The six tools

All tools are confined to the repo root by a path sandbox (a path that escapes
via `../`, an absolute path, or a symlink is rejected). The two mutating tools
are gated by the [guardrails](docs/USAGE.md#guardrails-safe-by-default).

| Tool | What it does | Risk |
| --- | --- | --- |
| `list_files` | List a directory (dirs get a trailing `/`); skips noise dirs. | read-only |
| `read_file` | Read one file's text (size-capped, truncation note). | read-only |
| `search` | Regex-search file contents → `relpath:lineno: line`. | read-only |
| `repo_tree` | A gitignore-aware tree of the repo (ignored entries omitted). | read-only |
| `write_file` | Create/overwrite a file; shows a unified diff first. | **mutating** — confirm (unless `--yolo`) |
| `run_command` | Run a shell command inside the repo root. | **mutating** — deny-list **+** confirm (unless `--yolo`) |

## M0 — the model adapter (`llm.py`)

One public entry point that talks to an LLM over HTTP and normalizes **two**
backends into a single `Reply` shape:

| Provider | Endpoint | Text | Tool args in response |
| --- | --- | --- | --- |
| `ollama` | `POST {OLLAMA_HOST}/api/chat` | `message.content` | already a `dict` |
| `openai` | `POST {ECODER_BASE_URL}/chat/completions` | `choices[0].message.content` | a JSON **string** (must be parsed) |

```python
reply = llm.chat([{"role": "user", "content": "23*47?"}], tools=[...])
reply.text          # str
reply.tool_calls    # list[ToolCall(name, arguments: dict, id)]
reply.raw           # the untouched response dict
```

Both providers yield the same `Reply`; OpenAI's JSON-string `arguments` is
`json.loads`-ed into a dict (malformed JSON safely falls back to `{}`). Any
failure — network, HTTP != 200, unparseable JSON — raises `LLMError` naming the
provider, URL, status code, and the first ~500 chars of the body.

### Config (env vars; explicit kwarg > env var > default)

| Var | Default | Meaning |
| --- | --- | --- |
| `ECODER_PROVIDER` | `ollama` | `ollama` or `openai` |
| `ECODER_MODEL` | `qwen3:8b` | model name |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama base URL |
| `ECODER_BASE_URL` | — | OpenAI-compatible base URL (`openai` provider) |
| `ECODER_API_KEY` | — | API key (`openai` provider, sent as `Authorization: Bearer`) |

### Run

```powershell
# echo REPL against a local Ollama (needs `ollama serve` running)
python llm.py

# point at any OpenAI-compatible endpoint instead
$env:ECODER_PROVIDER="openai"
$env:ECODER_BASE_URL="https://api.example.com/v1"
$env:ECODER_API_KEY="<your-key>"
python llm.py
```

### Test

```powershell
python agents-lab\E-coder\tests\test_llm.py
```

Hermetic (`urllib.request.urlopen` is mocked — no real network), exits `0`/`1`.

## M1 — read-only tools + agent loop

A minimal **ReAct** loop: the model inspects the repo with read-only tools, and
keeps going until it answers in plain text (or hits `--max-steps`).

```
you: "which file defines the health endpoint?"
  [step 1] search({"pattern": "health"}) -> server/server.py:14: def health()...
  [step 2] read_file({"path": "server/server.py"}) -> ...
it:  The health endpoint is defined in server/server.py (def health(), line 14).
```

### Tools (`tools.py`) — all confined to the repo root

| Tool | Args | What it does |
| --- | --- | --- |
| `list_files` | `path="."` | sorted listing; dirs get a trailing `/`; skips `node_modules`, `.git`, `__pycache__`, … |
| `read_file` | `path` | file text (UTF-8, size-capped, truncation note) |
| `search` | `pattern`, `path="."` | regex search → `relpath:lineno: line` matches |

**Path sandbox:** every path is resolved with `os.path.realpath` and checked with
`os.path.commonpath` against the repo root; anything that escapes (`../..`, an
absolute path, a symlink) raises `ToolError`. The `root` is always set by the
caller, never by the model. Tool failures become a `"error: ..."` string fed back
to the model, so the loop never crashes.

### Loop (`loop.py`)

`run_agent(task, root, *, max_steps=12, provider=None, model=None, on_step=None)`.
It threads **provider-native** messages (Ollama vs OpenAI) for both the assistant
turn and the tool results, so the conversation stays valid across turns.

### Run the CLI (`coder.py`)

```powershell
python coder.py "list the top-level directories"                 # default repo = .
python coder.py "find where the DB connection is created" --repo apps\orbis
python coder.py "..." --max-steps 8 --verbose                     # see each tool step
python coder.py "..." --provider openai --model gpt-4o-mini        # any OpenAI-compatible endpoint
```

`--provider` / `--model` fall back to `ECODER_PROVIDER` / `ECODER_MODEL`.
Needs a reachable model (Ollama by default). `--verbose` prints each step.

### Test

```powershell
python agents-lab\E-coder\tests\test_tools.py   # tools + path sandbox
python agents-lab\E-coder\tests\test_loop.py    # the loop (llm.chat mocked)
```

Both are hermetic (temp dir + mocked model — no real network), exit `0`/`1`.

## M2 — write/run tools + guardrails (the safety milestone)

The agent can now **write files** and **run shell commands**. Because that is a
loaded gun, it is wrapped in guardrails and is **safe by default**.

### Tools added (`tools.py`)

| Tool | Args | Gate |
| --- | --- | --- |
| `write_file` | `path`, `content` | unified diff + confirmation (unless `--yolo`) |
| `run_command` | `command` | command deny-list **+** confirmation (unless `--yolo`) |

`write_file` shows a unified diff before writing; `run_command` runs
`subprocess.run(..., shell=True)` **only after** `guardrails.check_command` passes.

### Guardrails (`guardrails.py`)

Two fail-closed layers:

- **`check_command` (hard deny-list).** In order: rejects empty commands; rejects any
  shell control operator (`;` `&` `|` backtick `>` `<`, newlines, `$(`) so
  `true && rm -rf /` can't sneak past; then rejects deny patterns — `rm -rf`,
  `del /f|/s|/q`, `rmdir /s`, `format`, `mkfs`, `dd if=`, `git push`,
  `git reset --hard`, `git clean -fd`, `shutdown`, `reboot`, `curl`, `wget`,
  `invoke-webrequest`/`iwr`, `pip install`, `npm install`/`npm i`, `chmod 777`,
  the `:(){` fork bomb, and writes to `/dev/`.
- **`confirm` (yes/no gate).** `interactive=False` **always declines** (a
  non-interactive run never auto-approves). `interactive=True` prints the detail
  and accepts only `y`/`yes` (Ctrl-C / EOF also decline).

### Safe by default

A `ToolContext(root, yolo=False, interactive=True)` controls the mutating tools.
`yolo=False` + `interactive=False` (the default when no context is passed) means
**nothing mutating is ever approved**. `--yolo` skips confirmation but **never**
the deny-list. `--no-interactive` turns confirmation off entirely, so writes and
commands are always declined — effectively read-only, and safe for scripts.

### Run the CLI (M2)

```powershell
python coder.py "add a docstring to main() in server.py"   # asks before writing
python coder.py "..." --yolo          # skip the confirmation prompt (careful!)
python coder.py "..." --no-interactive # never write/run; read-only in effect
```

### Test

```powershell
python agents-lab\E-coder\tests\test_guardrails.py  # deny-list + confirm gate
```

Hermetic (deny-list is string-based; `input` and `subprocess.run` are mocked; the
one real command runs local python, no network), exit `0`/`1`.

## M3 — the gitignore-aware context builder (the "hard part")

Context window is ~80% of the difficulty: reading every file blows the model's
budget. So instead of dumping the whole repo, `repo.py` builds a **compact,
task-relevant** context and injects it as one extra system message.

### How it works (`repo.py`)

1. **`.gitignore` matcher** — a small hand-rolled matcher (no `pathspec`):
   `#`/blank stripped, `!` negation, trailing `/` dir-only, leading `/` or any
   internal `/` anchors to the root, a bare pattern matches the basename at any
   depth, and `*`/`?`/`**` wildcards. `SKIP_DIRS` and the `.gitignore` itself are
   always skipped. A file under an ignored directory is ignored too.
2. **`walk`** — non-ignored file paths only; ignored dirs are pruned so
   `os.walk` never descends into them.
3. **`build_tree`** — an indented tree built *from the file list*, so a dir whose
   contents are all ignored (e.g. `logs/` with only `*.log`) does not appear —
   like `git ls-files`.
4. **`build_context`** — header + tree, then the most relevant files (task tokens
   matched in the **path** weigh more than in the **content**; smaller files win
   ties), each capped, up to `budget_chars`.

> M3 reads only the **root** `.gitignore`; nested `.gitignore` files are a
> noted TODO.

A new read-only tool `repo_tree` exposes the tree to the model. `coder.py` builds
the context by default: `--no-context` disables it, `--context-budget N` caps it.

```powershell
python coder.py "add a /health endpoint" --context-budget 8000
python coder.py "..." --no-context          # no prebuilt context
```

### Test

```powershell
python agents-lab\E-coder\tests\test_repo.py   # matcher + walk + tree + context budget
```

Hermetic (temp repo, no network, no model), exit `0`/`1`.

## M4 — final polish (tests + docs)

One command runs the whole suite, and two docs round it out:

```powershell
python agents-lab\E-coder\tests\run_all.py   # discovers + runs every test, exits 0/1
```

`coder.py` also gained `--context-only`: build + print the repository context and
exit **0** with **no model call** — a model-free way to verify the setup.

| Doc | What it covers |
| --- | --- |
| [`docs/USAGE.md`](docs/USAGE.md) | quickstart (Ollama / OpenAI), CLI reference, six tools, guardrails, examples, troubleshooting |
| [`docs/DESIGN.md`](docs/DESIGN.md) | the five layers, module map, data flow, safety model, stdlib-only rationale, limitations |

## Files

```
llm.py             # M0: provider adapter (urllib) + echo REPL
prompt.py          # M1: SYSTEM_PROMPT (M2: write/run care)
tools.py           # M1+M2+M3: six tools + ToolContext + path sandbox + dispatch + schemas
guardrails.py      # M2: command deny-list + confirmation gate
repo.py            # M3: .gitignore matcher + walk + tree + build_context
loop.py            # M1: the ReAct agent loop (M2: ToolContext; M3: injects context)
coder.py           # M1+M2+M3+M4: CLI entrypoint (--yolo / --no-interactive / --context / --context-only)
tests/test_llm.py        # hermetic stdlib-only tests (M0)
tests/test_tools.py      # hermetic stdlib-only tests (M1+M2: tools + sandbox + write/run)
tests/test_loop.py       # hermetic stdlib-only tests (M1, llm.chat mocked)
tests/test_guardrails.py # hermetic stdlib-only tests (M2: deny-list + confirm)
tests/test_repo.py       # hermetic stdlib-only tests (M3: gitignore + tree + context budget)
tests/run_all.py         # M4: run every test in one command (exit 0/1)
docs/PLAN.md         # original design + build order
docs/USAGE.md        # M4: how to run / configure / use
docs/DESIGN.md       # M4: architecture + safety model
README.md
```

## Build order (see `docs/PLAN.md`)

| Milestone | Deliverable | Status |
| --- | --- | --- |
| **M0** | `llm.py` — one `chat()`, no tools, echo works | ✅ done |
| **M1** | read-only tools (`list/read/search`) + loop | ✅ done |
| **M2** | `write_file` + `run_command` + guardrails + confirm | ✅ done |
| **M3** | gitignore-aware context builder (the hard part) | ✅ done |
| **M4** | tests (`run_all.py`) + docs (`USAGE.md` / `DESIGN.md`) + README | ✅ done |
