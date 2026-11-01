# E — E-coder (stdlib-only coding agent)

A small coding agent that can read a repo, plan, edit files, and run tests.
Track **E** in `agents-lab/`, alongside A (VS Code), B (Scout), C (Hermes) and
D (LangGraph).

> Goal: a *coding agent I use every day* — not a Cursor competitor.

The full design lives in [`docs/PLAN.md`](docs/PLAN.md). This folder is currently
at **M0**: only the model adapter exists.

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

## Files

```
llm.py            # M0: provider adapter (urllib) + echo REPL
tests/test_llm.py # hermetic stdlib-only tests
docs/PLAN.md      # full design + build order
README.md
```

## Build order (see `docs/PLAN.md`)

| Milestone | Deliverable | Status |
| --- | --- | --- |
| **M0** | `llm.py` — one `chat()`, no tools, echo works | ✅ done |
| **M1** | read-only tools (`list/read/search`) + loop | next |
| **M2** | `write_file` + `run_command` + guardrails + confirm | — |
| **M3** | gitignore-aware context builder (the hard part) | — |
| **M4** | tests + docs + README | — |
