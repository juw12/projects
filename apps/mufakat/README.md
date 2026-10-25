# Mufakat: many minds, one answer

**Mufakat** (Indonesian: *consensus*, from *musyawarah untuk mufakat*, "deliberate until
everyone agrees") is a free AI chat where models **deliberate before they answer**.

- **Web:** https://juwpegatron.github.io/projects/mufakat/
- **App (installable PWA):** https://juwpegatron.github.io/projects/mufakat/app.html
- **Mobile:** https://juwpegatron.github.io/projects/mufakat/mobile.html

## What it does that single-model chat apps don't
| Mode | What happens |
|---|---|
| **Council** ⚖ | 2–3 agents with different roles (and different models) take turns building, critiquing and revising until they reach **consensus**. Then an impartial **Judge** writes the final answer with what was agreed, what's still open, and a confidence level. Presets: Builder + Critic, Expert panel (Engineer/Designer/Skeptic), Debate, Teacher + Student, Brainstorm. |
| **Arena** ⚔ | One prompt, 2–3 models answering **side by side in parallel**. Vote for the best; your personal **leaderboard** tracks which models actually win for *your* questions. |
| **Chat** | Streaming chat plus one-click **Second opinion** (a different model reviews the answer), regenerate, edit & resend, file attachments (text/code), visible reasoning. |

Plus: chat search, Markdown export, full backup/restore, light/dark theme, keyboard
shortcuts (`Ctrl/⌘ K`, `Esc`), installable PWA, offline app shell.

## Free by design
Static site, no backend, so hosting is free (GitHub Pages). Everything runs in the browser:

| Provider | Cost | Setup |
|---|---|---|
| Demo | Free | None: offline canned replies to show every mode |
| OpenRouter | Free models available | Paste a free key from openrouter.ai/keys in Settings |
| Ollama | Free, private | `OLLAMA_ORIGINS=https://juwpegatron.github.io ollama serve` |
| Any OpenAI-compatible API | Varies | Base URL + key in Settings |

Keys, chats and votes live only in `localStorage`.

## Layout
- `web/`: the free static app (deployed to Pages)
- `server/`: optional hosted tier with accounts, Free/Pro plans, Stripe subscriptions,
  per-user cost budgets and synced chats (`python apps/mufakat/server/app.py`). Its
  front-end currently ships Chat + 2-agent Council; Arena and Judge are web-app features
  to port next. Deploy via `server/render.yaml`.
- `tests/test_static_integrity.py`: static checks for the web app
- `tests/verify_api.py`: end-to-end server test (mock LLM + signed Stripe webhooks, 36 checks)
- `docs/BRIEF.md`: product brief

## Test
```bash
python apps/mufakat/tests/test_static_integrity.py
python apps/mufakat/tests/verify_api.py
```
In-browser self-test: open `web/index.html#selftest` (16 checks covering chat, council,
judge, arena, voting, export, search). Demos: `#demo-council`, `#demo-arena`.

## Honest limits
Mufakat doesn't train its own model, so answer quality comes from the models you connect.
Deliberation helps catch mistakes but costs more calls (and time) than a single answer.
Free OpenRouter models are rate-limited. Working prototype, not a production service.
