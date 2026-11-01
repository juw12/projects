# E-coder — Plan (Tier 2: minimal coding agent)

A small, **stdlib-only** coding agent that can read a repo, plan, edit files, and
run tests. Track **E** in `agents-lab/`, alongside A (VS Code), B (Scout),
C (Hermes) and D (LangGraph).

> Goal: a *coding agent I use every day* — not a Cursor competitor.
> "Own Cursor" is a vanity metric; a working daily agent is real.

---

## 1. Principles (inherited from this monorepo)

- **No third-party dependencies.** Python 3 standard library only (`urllib`,
  `json`, `subprocess`, `sqlite3`). Nothing to `pip install`.
- **Local-first, free.** Default model is Ollama `qwen3:8b` — no API keys.
  Any OpenAI-compatible endpoint also works via the same adapter.
- **Hermetic tests.** Tests use a temp dir + mocked HTTP; exit `0` / `1`.
- **Offline-first.** No network unless a model call is made.

### Known conflict (Rule 7 — surface, don't average)

`D-langgraph-agent/requirements.txt` pulls 7 third-party deps (langgraph,
langchain-core, langchain-ollama, mcp, …), which violates the monorepo's
"no third-party dependencies" principle. E-coder deliberately does **not**
follow D's dependency approach — it reuses D's *ideas* (ReAct loop, guardrails,
JSONL traces) with zero deps. D should be flagged for cleanup or documented as
an explicit exception.

---

## 2. Architecture — the five layers

| Layer | E-coder |
| --- | --- |
| **Brain** | Ollama `qwen3:8b` (default) or any OpenAI-compatible URL |
| **Instructions** | System prompt with this repo's discipline baked in (surgical changes, simplicity first, fail loud) |
| **Tools** | 5 tools: `list_files`, `read_file`, `search`, `write_file`, `run_command` |
| **Memory** | None in v1 (stateless per task). Optional SQLite checkpointer later. |
| **Runtime** | The agent loop + guardrails |

---

## 3. File layout

```
agents-lab/E-coder/
  coder.py          # entrypoint + REPL
  llm.py            # provider adapter (urllib): Ollama + OpenAI-compatible
  loop.py           # the agent loop
  tools.py          # tool registry + implementations
  prompt.py         # system prompt (this repo's discipline)
  repo.py           # .gitignore-aware context builder
  guardrails.py     # extends D's stdlib guardrails + path/command safety
  tests/            # hermetic, stdlib-only, exit 0/1
  docs/             # this plan + guides
  README.md
```

---

## 4. The minimal agent loop (ReAct)

```python
messages = [system_prompt, user_task]
for step in range(MAX_STEPS):
    reply = llm.chat(messages, tools=TOOLS)   # model picks a tool or answers
    if reply.tool_call:
        check_guardrails(tool_call)           # path sandbox, cmd deny-list, confirm
        result = run_tool(tool_call)          # execute
        messages += [reply, tool_result]      # feed observation back
    else:
        print(reply.text)                     # done
        break
```

Approx. 150 lines across `loop.py` + `tools.py` + `llm.py`.

---

## 5. Tools — exactly five

| Tool | Input | Risk | Notes |
| --- | --- | --- | --- |
| `list_files` | path | none | gitignore-aware |
| `read_file` | path | none | size-capped |
| `search` | regex | none | ripgrep-style over tree |
| `write_file` | path, content | **high** | diff preview + confirm by default |
| `run_command` | cmd | **high** | sandboxed, timeout, deny-list |

---

## 6. Guardrails — not optional

An agent that runs shell commands **must** be caged:

- **Path sandbox** — no reads/writes outside the target repo root.
- **Command deny-list** — no `rm -rf`, no `git push`, no network (`curl`/`wget`),
  no `pip install`.
- **Confirm-before-write** by default; `--yolo` flag to skip.
- **Max steps + max tokens** per run.
- **Reuse D's `guardrails.py`** patterns (prompt-injection block, PII redaction)
  and add the path/command rules above.
- **JSONL trace** (`traces.jsonl`) of every action, like D.

---

## 7. Definition of Done

Offline, against Ollama:

> Type: *"add a `/health` endpoint to `apps/twin/server.py` and a test"* →
> E-coder finds the file, edits it, runs `python apps/twin/tests/verify_api.py`,
> and reports pass/fail — **without touching anything outside the repo.**

Plus: stdlib-only, hermetic tests exit `0`/`1`, works against any
OpenAI-compatible URL.

---

## 8. Build order

| Milestone | Deliverable |
| --- | --- |
| **M0** | `llm.py` — one `chat()`, no tools, echo works |
| **M1** | read-only tools (`list/read/search`) + loop |
| **M2** | `write_file` + `run_command` + guardrails + confirm |
| **M3** | gitignore-aware context builder (the hard part) |
| **M4** | tests + docs + README |

---

## 9. The hard parts

1. **Context window** — naive whole-file reads blow `qwen3:8b`'s budget fast.
   "Read only what's needed" is ~80% of the difficulty.
2. **Streaming** — painful with raw `urllib`. Ship non-streaming first.
3. **Safety** — a shell-running agent is a loaded gun. Guardrails ship *with*
   M2, not after.

---

## 10. Config (env vars)

| Var | Default | Meaning |
| --- | --- | --- |
| `ECODER_PROVIDER` | `ollama` | `ollama` or `openai` |
| `ECODER_MODEL` | `qwen3:8b` | model name |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama base URL |
| `ECODER_BASE_URL` | — | OpenAI-compatible base URL (`openai` provider) |
| `ECODER_API_KEY` | — | API key (`openai` provider) |
