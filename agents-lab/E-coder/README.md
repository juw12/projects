# E — E-coder (stdlib-only coding agent)

A small coding agent that can read a repo, plan, edit files, and run tests.
Track **E** in `agents-lab/`, alongside A (VS Code), B (Scout), C (Hermes) and
D (LangGraph).

> Goal: a *coding agent I use every day* — not a Cursor competitor.

The full design lives in [`docs/PLAN.md`](docs/PLAN.md). This folder is at
**M2**: a working agent that can explore a repo, make minimal edits, and run
commands — all gated behind **guardrails** (a command deny-list + confirmation).

## Why stdlib-only

This monorepo's principle is **no third-party dependencies** — nothing to
`pip install`. Track D (LangGraph) pulls 7 deps; E-coder deliberately does **not**
follow that. It reuses D's *ideas* (ReAct loop, guardrails, JSONL traces) with
**zero deps**: HTTP goes through `urllib.request`, JSON through `json`. It is
local-first and free (Ollama `qwen3:8b` by default, no API keys), and any
OpenAI-compatible endpoint works through the same adapter.

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

## Files

```
llm.py             # M0: provider adapter (urllib) + echo REPL
prompt.py          # M1: SYSTEM_PROMPT (M2: write/run care)
tools.py           # M1+M2: list/read/search + write_file/run_command + path sandbox + schemas
guardrails.py      # M2: command deny-list + confirmation gate
loop.py            # M1: the ReAct agent loop (M2: threads a ToolContext)
coder.py           # M1+M2: CLI entrypoint (--yolo / --no-interactive)
tests/test_llm.py        # hermetic stdlib-only tests (M0)
tests/test_tools.py      # hermetic stdlib-only tests (M1+M2: tools + sandbox + write/run)
tests/test_loop.py       # hermetic stdlib-only tests (M1, llm.chat mocked)
tests/test_guardrails.py # hermetic stdlib-only tests (M2: deny-list + confirm)
docs/PLAN.md         # full design + build order
README.md
```

## Build order (see `docs/PLAN.md`)

| Milestone | Deliverable | Status |
| --- | --- | --- |
| **M0** | `llm.py` — one `chat()`, no tools, echo works | ✅ done |
| **M1** | read-only tools (`list/read/search`) + loop | ✅ done |
| **M2** | `write_file` + `run_command` + guardrails + confirm | ✅ done |
| **M3** | gitignore-aware context builder (the hard part) | — |
| **M4** | tests + docs + README | — |
