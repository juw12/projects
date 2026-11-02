# E-coder — Design

How E-coder is put together: the layers, the modules, the data flow, and the
safety model. The "why" behind the choices (and the deliberate contrast with
track D) is the point of this doc; see [`USAGE.md`](USAGE.md) for how to run it
and [`PLAN.md`](PLAN.md) for the original design + build order.

## The five layers

Every agent in this lab is assembled from the same five layers. Here is how each
maps to E-coder:

| Layer | In E-coder | Notes |
| --- | --- | --- |
| **Brain** (model) | [`llm.py`](../llm.py) | One `chat()` normalizes Ollama + OpenAI into a single `Reply`. Non-streaming, over `urllib`. |
| **Instructions** | [`prompt.py`](../prompt.py) | `SYSTEM_PROMPT`: explore first, mutate carefully, answer in plain text when done. |
| **Tools** | [`tools.py`](../tools.py) + [`repo.py`](../repo.py) | Six tools, a path sandbox, a dispatcher, and the gitignore-aware context builder. |
| **Memory** | *(none, by design)* | The loop keeps the message history in-process for one task, but there is **no persistent memory across runs** (contrast: track D uses a SQLite checkpointer). |
| **Runtime** | [`loop.py`](../loop.py) + [`coder.py`](../coder.py) | A minimal ReAct loop + the CLI. [`guardrails.py`](../guardrails.py) is the safety layer on the tools. |

## Module map

One line each:

- **`llm.py`** — the model adapter: one public `chat(messages, tools)` that POSTs
  JSON over `urllib` and normalizes two backends into `Reply(text, tool_calls, raw)`.
- **`prompt.py`** — `SYSTEM_PROMPT`, the agent's instructions.
- **`repo.py`** — the M3 "hard part": a hand-rolled `.gitignore` matcher, a
  pruning `walk`, an indented `build_tree`, and a relevance-ranked `build_context`.
- **`tools.py`** — the six tools, `ToolContext`, the path sandbox
  (`_resolve_inside`), `dispatch`, and the `TOOL_SCHEMAS` (OpenAI function-calling
  format that Ollama also accepts).
- **`guardrails.py`** — `check_command` (command deny-list + shell-operator block)
  and `confirm` (fail-closed yes/no gate).
- **`loop.py`** — `run_agent`: the ReAct loop that threads provider-native
  messages, one `ToolContext`, and the injected context.
- **`coder.py`** — the argparse CLI that ties it together.

## Data flow

```
task
  │
  ▼
coder.py ──► repo.build_context(root, task)   # gitignore-aware, task-relevant
  │                                   └─► str  (tree + top relevant files, ≤ budget)
  ▼
loop.run_agent(task, root, context=…, yolo, interactive)
  │  messages = [ SYSTEM_PROMPT, (context system msg), user: task ]
  ▼
llm.chat(messages, tools=TOOL_SCHEMAS) ──► Reply
  │
  ├── no tool_calls ──► return reply.text            (final answer)
  │
  └── has tool_calls:
        for each ToolCall:
          write_file / run_command  ──►  guardrails.check_command  (deny-list)
                                         guardrails.confirm        (unless --yolo)
          any tool  ──►  tools.dispatch(name, args, root, ctx)
                                        └─► path sandbox (_resolve_inside)
        each result (or "error: …") is appended as a provider-native tool message
        ──► back to llm.chat …
```

A tool failure never crashes the loop: a `ToolError` (or any exception) becomes
an `"error: …"` string that is fed back to the model so it can recover. The loop
stops when the model answers in plain text or when `max_steps` is reached.

## Safety model

E-coder can write files and run commands, so it is **safe by default** and
fail-closed at every layer:

- **Path sandbox** (`tools._resolve_inside`). Every path is resolved with
  `os.path.realpath` (collapses `..`, follows symlinks) and checked with
  `os.path.commonpath` against the repo root. Anything that escapes — `../..`,
  an absolute path, a symlink — raises `ToolError`. `root` is always set by the
  caller, never by the model.
- **Command deny-list + operator block** (`guardrails.check_command`). Fails
  closed: rejects empty commands; rejects any shell control operator
  (`;` `|` `&` backtick `>` `<`, newlines, `$(`) so a destructive command can't
  hide after an operator; then rejects a deny-list of destructive / network /
  privilege patterns (`rm -rf`, `git push`, `curl`, `pip install`, …).
- **Fail-closed confirmation** (`guardrails.confirm`). A non-interactive caller is
  **never** auto-approved; an interactive caller must answer `y`/`yes`. The
  default `ToolContext` (`yolo=False, interactive=False`) means nothing mutating
  is ever approved.
- **`--yolo` scope.** `--yolo` skips the *confirmation* gate only. It **never**
  bypasses the deny-list, so a blocked command stays blocked even under `--yolo`.

## Why stdlib-only

The monorepo principle is **no third-party dependencies** — nothing to
`pip install`. Track D (LangGraph) pulls ~7 packages for its graph runtime and
checkpointer. E-coder deliberately does **not** follow that path: it reuses
track D's *ideas* (a ReAct loop, a guardrails module, structured error
feedback) with **zero dependencies** — HTTP via `urllib.request`, JSON via
`json`, no streaming. That keeps it local-first, free (Ollama by default, no API
keys), and trivially portable. The trade-off is accepted intentionally: no
streaming and no persistent memory in exchange for "it runs anywhere Python 3
runs."

## Known limitations / TODO

- **Root-only `.gitignore`.** `repo.py` reads only the root `.gitignore`; nested
  `.gitignore` files are not applied (noted in the code).
- **Non-streaming.** `llm.chat` is request/response only; streaming over raw
  `urllib` is a later concern.
- **`**` zero-directory edge.** The `**` wildcard crosses `/`, but the
  zero-directory case (`a/**/b` matching `a/b`) is a documented simplification.
- **No persistent memory.** Each run starts fresh; there is no cross-run
  checkpointer (unlike track D).
- **Heuristic relevance.** `build_context` ranks files by task-token substring
  matches (path matches weighted higher); it is a heuristic, not semantic search.
