# E-coder — Usage

E-coder is a **stdlib-only coding agent** — track **E** in [`agents-lab/`](../README.md).
You give it a task in plain language and a repo; it explores the repo with
read-only tools, builds a compact gitignore-aware context, makes minimal edits,
and runs commands — all gated behind guardrails. It has **zero third-party
dependencies** (no `pip install`) and runs against a local model (Ollama by
default) or any OpenAI-compatible endpoint.

For the architecture and safety model, see [`DESIGN.md`](DESIGN.md).
The original design + build order is in [`PLAN.md`](PLAN.md).

## Quickstart

### 1. Ollama (local, default)

Start Ollama and pull a model, then run E-coder:

```powershell
ollama serve                 # in another terminal (if not already running)
ollama pull qwen3:8b

cd agents-lab\E-coder
python coder.py "which file defines the health endpoint?" --repo ..\..
```

### 2. OpenAI-compatible endpoint

Point the environment at any OpenAI-compatible base URL, then run:

```powershell
$env:ECODER_PROVIDER = "openai"
$env:ECODER_BASE_URL = "https://api.example.com/v1"   # required
$env:ECODER_API_KEY  = "sk-..."                        # optional (sent as Bearer)

python coder.py "add a /health endpoint" --repo ..\..
```

### 3. No model at all (verify the setup)

`--context-only` builds and prints the repository context and exits **without
calling any model** — useful when no model is installed:

```powershell
python coder.py "add a health check to apps/twin/server.py" --repo ..\.. --context-only
```

## Configuration

Config is read with priority **explicit kwarg > env var > default** (see
[`llm.py`](../llm.py)):

| Variable | Default | Meaning |
| --- | --- | --- |
| `ECODER_PROVIDER` | `ollama` | `ollama` or `openai` |
| `ECODER_MODEL` | `qwen3:8b` | model name |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama base URL (`provider=ollama`) |
| `ECODER_BASE_URL` | *(required)* | OpenAI-compatible base URL (`provider=openai`) |
| `ECODER_API_KEY` | *(optional)* | API key (`provider=openai`, sent as `Authorization: Bearer`) |

The `--provider` and `--model` CLI flags override `ECODER_PROVIDER` /
`ECODER_MODEL` for a single run.

## CLI reference

```
python coder.py "<task>" [--repo PATH] [--max-steps N]
                        [--provider P] [--model M] [--verbose]
                        [--yolo] [--no-interactive]
                        [--no-context] [--context-budget N] [--context-only]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `task` | *(required)* | The task, in plain language. |
| `--repo` | `.` | Repo root to operate within. All tool paths are relative to it. |
| `--max-steps` | `12` | Max agent steps before it stops and returns a "[stopped…]" note. |
| `--provider` | env / `ollama` | `ollama` or `openai`. |
| `--model` | env / `qwen3:8b` | Model name. |
| `--verbose` | off | Print each step (tool, args, result preview) and the context size. |
| `--context-only` | off | Build + print the repository context, then exit **0** with **no model call**. |
| `--no-context` | off | Disable the prebuilt repository context (it is on by default). |
| `--context-budget` | `20000` | Max characters for the prebuilt context. |
| `--yolo` | off | Skip confirmation for writes/commands (**never** skips the command deny-list). Use with care. |
| `--no-interactive` | off | Never prompt; declines all writes/commands (effectively read-only; safe for scripts). |

## The six tools

All read-only tools are confined to the repo root by a path sandbox (a path that
escapes via `../`, an absolute path, or a symlink raises an error). The two
mutating tools are gated by the guardrails (below).

| Tool | What it does | Risk |
| --- | --- | --- |
| `list_files` | List a directory (dirs get a trailing `/`); skips noise dirs. | read-only |
| `read_file` | Read one file's text (size-capped, truncation note). | read-only |
| `search` | Regex-search file contents → `relpath:lineno: line` matches. | read-only |
| `repo_tree` | A gitignore-aware tree of the repo (ignored entries omitted). | read-only |
| `write_file` | Create/overwrite a file; shows a unified diff first. | **mutating** — confirm (unless `--yolo`) |
| `run_command` | Run a shell command inside the repo root. | **mutating** — deny-list **and** confirm (unless `--yolo`) |

## Guardrails (safe by default)

The agent is **safe by default**: it will not write a file or run a command
unless a user confirms. Two fail-closed layers guard the mutating tools
(see [`guardrails.py`](../guardrails.py)):

- **`check_command` (hard deny-list).** Rejects, in order: empty commands; any
  shell control operator (`;` `|` `&` backtick `>` `<`, newlines, `$(`) so
  `true && rm -rf /` can't sneak past; then deny patterns — `rm -rf`,
  `del /f|/s|/q`, `rmdir /s`, `format`, `mkfs`, `dd if=`, `git push`,
  `git reset --hard`, `git clean -fd`, `shutdown`, `reboot`, `curl`, `wget`,
  `invoke-webrequest`/`iwr`, `pip install`, `npm install`/`npm i`, `chmod 777`,
  the `:(){` fork bomb, and writes to `/dev/`.
- **`confirm` (yes/no gate).** `interactive=False` **always declines** (a
  non-interactive run is never auto-approved). `interactive=True` prints the
  detail (a diff for writes, the command for runs) and accepts only `y`/`yes`.

**`--yolo`** skips the *confirmation* gate only — it **never** bypasses the
deny-list, so a blocked command stays blocked even under `--yolo`.

## Examples

```powershell
# Read-only question (no writes will happen; safe for scripts):
python coder.py "find where the DB connection is created" --repo ..\.. --no-interactive

# A task that may write: it asks before writing (answer y/yes to proceed):
python coder.py "add a docstring to main() in server.py" --repo ..\..

# Inspect what the agent would be shown, without a model:
python coder.py "add a /health endpoint" --repo ..\.. --context-only

# See every step as it runs:
python coder.py "summarize this repo" --repo ..\.. --verbose
```

## Running the tests

```powershell
python agents-lab\E-coder\tests\run_all.py
```

Runs every test in one command (hermetic, no network, no model) and exits `0`
when all pass, `1` otherwise. Each test file can also be run on its own:

```powershell
python agents-lab\E-coder\tests\test_llm.py
python agents-lab\E-coder\tests\test_tools.py
python agents-lab\E-coder\tests\test_loop.py
python agents-lab\E-coder\tests\test_guardrails.py
python agents-lab\E-coder\tests\test_repo.py
```

## Troubleshooting

- **"network error" / can't reach the model (Ollama):** Ollama must be running
  (`ollama serve`) and the model pulled (`ollama pull qwen3:8b`). The default
  host is `http://127.0.0.1:11434`; override with `OLLAMA_HOST`. A model
  failure is reported as `[llm error] …` and the CLI exits `2` (it does not
  crash).
- **`[openai] ECODER_BASE_URL is not set`:** set `ECODER_BASE_URL` to your
  OpenAI-compatible base (e.g. `https://api.example.com/v1`) and, if needed,
  `ECODER_API_KEY`. Use `--provider openai` (or `ECODER_PROVIDER=openai`) to
  switch from Ollama.
- **Writes/commands are being declined:** that is the safe default. Approve at
  the prompt, or run with `--yolo` (skip confirm, not the deny-list). With
  `--no-interactive` they are always declined — that is intended.
- **No model installed but you want to sanity-check E-coder:** use
  `--context-only` — it never touches the model.
