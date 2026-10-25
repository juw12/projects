# Glow — From a spark to something real

**Glow** is a free browser prototype for exploring ideas, developing plans and getting multiple AI perspectives. Chat, Council with a Judge, and Arena comparisons help you review proposals before acting. AI-suggested resources are not automatically browsed or verified; there is no autonomous building or execution.

- **Web:** https://juwpegatron.github.io/projects/glow/
- **App (installable PWA):** https://juwpegatron.github.io/projects/glow/app.html
- **Mobile:** https://juwpegatron.github.io/projects/glow/mobile.html

## What it does that single-model chat apps don't
| Mode | What happens |
|---|---|
| **Council** ⚖ | 2–3 agents with different roles (and different models) take turns building, critiquing and revising until they reach **consensus**. Then an impartial **Judge** writes the final answer with what was agreed, what's still open, and a confidence level. Presets: Builder + Critic, Expert panel (Engineer/Designer/Skeptic), Debate, Teacher + Student, Brainstorm. |
| **Arena** ⚔ | One prompt, 2–3 models answering **side by side in parallel**. Vote for the best; your personal **leaderboard** tracks which models actually win for *your* questions. |
| **Chat** | Streaming chat plus one-click **Second opinion** (a different model reviews the answer), regenerate, edit & resend, file attachments (text/code), visible reasoning. |

Plus: sign in or continue as guest, a guided tour, starter prompts, per-reply copy, chat rename
(double-click), chat search, Markdown export, full backup/restore, light/dark/system theme, keyboard
shortcuts (`Ctrl/⌘ K`, `Esc`, `/`, `?`), installable PWA, offline app shell.

## Free by design
Static site, no backend, so hosting is free (GitHub Pages). Everything runs in the browser:

| Provider | Cost | Setup |
|---|---|---|
| Glow AI (sign in) | Free for you and for Glow | Click **Sign in**: a free [Puter](https://puter.com) account; GPT, Claude, Gemini, DeepSeek… with no key |
| Demo | Free | None: offline canned replies to show every mode |
| OpenRouter | Free models available | Paste a free key from openrouter.ai/keys in Settings |
| Ollama | Free, private | `OLLAMA_ORIGINS=https://juwpegatron.github.io ollama serve` |
| Any OpenAI-compatible API | Varies | Base URL + key in Settings |

Chats, settings and votes are stored in browser localStorage. API keys are stored there too and sent to the selected provider to authenticate requests. Prompts and attached text are sent to that provider; there is no hosted app backend in this prototype.

## Layout
- `web/`: the free static app (deployed to Pages)
- `server/`: optional hosted tier with accounts, Free/Pro plans, Stripe subscriptions,
  per-user cost budgets and synced chats (`python apps/glow/server/app.py`). Its
  front-end currently ships Chat + 2-agent Council; Arena and Judge are web-app features
  to port next. Deploy via `server/render.yaml`.
- `tests/test_static_integrity.py`: static checks for the web app
- `tests/verify_api.py`: end-to-end server test (mock LLM + signed Stripe webhooks, 36 checks)
- `docs/BRIEF.md`: product brief

## Test
```bash
python apps/glow/tests/test_static_integrity.py
python apps/glow/tests/verify_api.py
```
In-browser self-test: open `web/index.html#selftest` (49 checks covering chat, council,
judge, arena, voting, export, search, the v0.2.1 fixes, and v0.4 sign-in, guest mode, tour,
theme, sync and UI, using a Puter test double so no real account is touched). Demos: `#demo-council`, `#demo-arena`.

## v0.2.1 fixes
- Demo and self-test links (`#selftest`, `#demo-*`) run in a sandbox and never touch a visitor's saved chats or keys.
- Rate limits (HTTP 429/5xx) are retried automatically with backoff (honours `Retry-After`), which matters on free models.
- Long conversations are trimmed to the most recent ~24k characters so small models don't overflow.
- Consensus only counts when an agent *ends* with `CONSENSUS` (not "no consensus yet").
- Second opinion never falls back to the demo bot when a real model is connected.
- Default models prefer strong general chat models over alphabetical order.

## Honest limits
Glow doesn't train its own model, so answer quality comes from the models you connect.
Deliberation helps catch mistakes but costs more calls (and time) than a single answer.
Free OpenRouter models are rate-limited. Working prototype, not a production service.

## v0.3.0 — renamed Glow
- Formerly Mufakat. Existing browser storage and hosted databases are retained.
- Old web, installed-app and mobile links redirect to the matching Glow page.
- Demo/self-test links still use isolated storage.
- Glow cache cleanup is restricted to Glow, preserving other apps on the same origin.
- Glow is a prototype brand chosen by the owner, not a unique or trademark-cleared name.

## v0.4.0 — sign in, guest mode, guided tour, themes
- **Welcome screen**: *Sign in* (free real AI) or *Continue as guest* (demo, own keys, Ollama). Existing chats and keys are kept; switch any time from the sidebar or Settings.
- **Glow AI**: signed-in users get curated models (GPT-5 mini, Gemini 2.5 Flash, Claude Haiku 4.5, DeepSeek, Grok and more), streamed through [Puter.js](https://docs.puter.com). Puter's User-Pays model runs them on each person's own free Puter allowance, so there is no API key and no bill for Glow. The model list is filtered against Puter's live catalogue.
- **Chat sync**: when signed in, chats, votes and deletions sync to the user's Puter key-value storage (split into parts under the 400 KB value limit). API keys are never synced. Can be turned off in Settings.
- **Guided tour**: 11 spotlight steps (model picker, composer, Council, Arena, search, export, theme, account, settings), Next/Back/Skip, arrow keys and Esc; replay with `?` or Settings. Works on mobile by opening the sidebar for sidebar steps.
- **Theme**: follows the device by default; toggle in the top bar, welcome screen or sidebar, or choose System/Light/Dark in Settings.
- **UI**: starter prompt cards, per-reply Copy, toast feedback, chat rename, glow accents, focus rings, message animations (reduced-motion respected). Chat error notices no longer disappear right after they appear.
- **Honest limits**: Puter is a third-party service and needs a person to sign in (a popup); its free allowance is limited and set by Puter. If Puter can't be reached, guest mode keeps working.
