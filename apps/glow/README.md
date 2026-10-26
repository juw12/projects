# Glow — From a spark to something real

**Glow** is a small ecosystem of free browser AI apps that share one account:

| App | What it is | Link |
|---|---|---|
| **Glow** (home) | Start here: one box to ask or delegate, recent chats and missions, all apps | https://juwpegatron.github.io/projects/glow/ |
| **GlowChat** | Chat, Council with a Judge, and Arena comparisons to explore ideas and review plans | https://juwpegatron.github.io/projects/glow/chat/ |
| **GlowRoom** | A virtual office of AI agents (formerly Crewroom) that research, write code and make media for a mission | https://juwpegatron.github.io/projects/glow/room/ |
| **GlowLead** 👑 | The AI lead (orchestrator) and owner of GlowRoom: plans a goal, delegates the steps to GlowChat and the GlowRoom crew, checks the work and reports | https://juwpegatron.github.io/projects/glow/lead/ |

GlowChat installable app: `glow/chat/app.html`, mobile: `glow/chat/mobile.html`. GlowRoom: `glow/room/app.html`, `glow/room/mobile.html`.
AI-suggested resources in GlowChat are not automatically browsed or verified; GlowChat does no autonomous building or execution (that is GlowRoom's job, and its results should still be reviewed).

## v0.7.0 — GlowLead, the lead of the Glow apps
A "boss bot" orchestrator, like using one bot to direct Claude Code and Codex, but for the Glow apps (`web/lead/`):
- **Plan → delegate → check → report.** GlowLead turns one goal into 1–4 steps plus 2–4 concrete *done-criteria*, then hands each step to the right worker: **💬 GlowChat** (one model writes/explains), **⚖ GlowChat Council** (Builder, Critic, Judge) or the **🏢 GlowRoom crew** (live web research, code, sources). It never does the work itself.
- **It checks the work.** A review compares the team's output with the done-criteria (✓/✗ per criterion). If something is missing it runs one fix-up round, then checks again, and writes the final report.
- **You stay in charge**: tick *Show me the plan first* to approve the plan before anything runs; ■ Stop at any time; ↻ Try again for failed steps.
- **It controls GlowChat**: every lead becomes one 👑 chat in GlowChat (plan, each worker's output and the checked report), so you can keep asking there. GlowChat's sidebar has *👑 GlowLead: let it lead the job* (what you typed becomes the goal).
- **It owns GlowRoom**: crew missions it starts are saved in GlowRoom's own results with a 👑, GlowRoom shows *👑 Owner: GlowLead* in its header (desktop and phone), and the engine now merges missions saved by another page instead of overwriting them.
- Glow home has a third start button (*👑 Let GlowLead run it*) and a GlowLead card; the app switcher lists GlowLead.
- Works for guests on Glow Free (each AI call may wait ~30 s for the shared limit, so a 3-step lead takes a few minutes); signed-in Glow AI is much faster.
- Self-test: `web/lead/index.html#selftest` (17 checks with a stubbed AI: planning, routing, Council, GlowRoom hand-off, fix-up round, approval, stop, GlowChat hand-off, escaping). Static tests: `tests/test_glowlead.py`.

## v0.6.1 — fixes from a real end-to-end run
Tested as a first-time visitor on the live site (portfolio → Glow home → GlowChat → GlowRoom → back) with the real free AI:
- **GlowRoom missions no longer fail on Glow Free.** The shared free AI allows about one reply every 30 s and answered the crew's back-to-back calls with "402 Free limit… Retry after N s", which ended the mission. GlowRoom now sends Glow Free calls one at a time and waits out the stated time (with a notice); GlowChat does the same, so Council and quick follow-ups work for guests too.
- **Asking from Glow home answers right away**: no sign-in wall or 15-step tour first; first-timers are answered as guests (sign in any time).
- **Hand-offs start by themselves**: "Give it to GlowRoom" and "🏢 Ask GlowRoom" start the crew immediately; the mission box shows the start of the question.
- **GlowRoom on phones accepts hand-offs** (it ignored `?goal=` and cut missions at 240 characters).
- **Short mission titles** (first line of the goal) in results, toasts, history and Glow home, instead of the whole pasted answer.
- Crew members that hit an error no longer stay "working".
- Portfolio card links are named Glow home / GlowChat / GlowRoom. Caches: `glowhome-v2`, `glowchat-v2`, `glowroom-v2`.

## v0.6.0 — the Glow ecosystem
- **Glow home** (`web/index.html`): a quick-start box (💬 *Ask GlowChat* or 🏢 *Give it to GlowRoom*, with a hint when the request sounds like a job for the crew), **Jump back in** (recent GlowChat chats and GlowRoom missions), app cards with Open / Mobile / Install, and your account.
- **GlowChat** (`web/chat/`) is the former Glow chat app. New launch links: `chat/?q=text` pre-fills the box, `chat/?open=<chat id>` reopens a chat.
- **GlowRoom** (`web/room/`) is Crewroom, **moved** here (not copied) from `apps/virtual-bots`. Its saved crews, missions and settings keep the same browser storage keys.
- **One switcher**: the ✦ Glow apps menu (`web/shared/glow-apps.js`) appears in GlowChat and GlowRoom on desktop and phone, and shows who is signed in.
- **One account**: the Glow AI (Puter) sign-in is shared; GlowChat ↔ GlowRoom hand-offs work as in v0.5.1.
- **Old links keep working**: `/virtual-bots/…` → `/glow/room/…`, `/glow/app.html` and `/glow/mobile.html` → GlowChat, `/mufakat/…` → GlowChat (query and hash kept).
- **Cache fix**: Crewroom's service worker used to delete *every* cache on the site when it updated (including other apps' offline caches). GlowRoom now only removes its own (`glowroom-`/`crewroom-`). Each Glow app has its own cache (`glowhome-v1`, `glowchat-v1`, `glowroom-v1`).

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
| Glow Free (default for guests) | Free | None: works right away via Pollinations' anonymous tier (GPT-OSS 20B, shared, rate-limited) |
| Glow AI (sign in) | Free for you and for Glow | Click **Sign in**: a free [Puter](https://puter.com) account; GPT, Claude, Gemini, DeepSeek… with no key |
| Demo | Free | None: offline canned replies to show every mode |
| OpenRouter | Free models available | Paste a free key from openrouter.ai/keys in Settings |
| Ollama | Free, private | `OLLAMA_ORIGINS=https://juwpegatron.github.io ollama serve` |
| Any OpenAI-compatible API | Varies | Base URL + key in Settings |

Chats, settings and votes are stored in browser localStorage. API keys are stored there too and sent to the selected provider to authenticate requests. Prompts and attached text are sent to that provider; there is no hosted app backend in this prototype.

## Layout
- `web/index.html`: Glow home; `web/shared/`: the app switcher used by every Glow app
- `web/chat/`: GlowChat, the free static chat app (deployed to Pages)
- `web/room/`: GlowRoom, the AI agent office (formerly Crewroom, `apps/virtual-bots`)
- `web/lead/`: GlowLead, the lead/orchestrator that plans, delegates to GlowChat and GlowRoom, and checks
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
In-browser self-test: open `web/chat/index.html#selftest` (94 checks covering chat, council,
judge, arena, voting, export, search, the v0.2.1 fixes, v0.4 sign-in, guest mode, tour,
theme, sync and UI, and the v0.5 model picker, personas, checklists, Fuse, share links and Markdown, and the Crewroom link, using a Puter test double so no real account is touched). Demos: `#demo-council`, `#demo-arena`.

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

## v0.5.1 — connected to Crewroom (now GlowRoom)
- **Glow → Crewroom**: the 🏢 Crewroom button in the sidebar hands whatever you typed to Crewroom's AI crew (web research, code, media) as their mission; **🏢 Ask the crew** under any reply sends the question plus Glow's answer so the crew can check and extend it.
- **Crewroom → Glow**: finished crew results arrive in Glow as a chat marked 🏢, so you can keep asking about them. Both apps share one Glow account and the same Glow AI models.
- Works because both apps live on the same site (shared browser storage); nothing goes through a server.

## v0.5.0 — choose your model, personas, checklists
- **Model picker**: searchable dropdown grouped by provider with badges (Free, Fast, Reasoning, Smart, Local), ★ favourites, keyboard navigation. Guests see Glow AI models with a 🔒; picking one opens sign-in and selects it afterwards. Signed-in users can show every Glow AI model.
- **Personas per chat**: Default, Planner, Tutor, Coder, Writer, Critic, Translator, plus your own **custom instructions** (Settings) applied to every mode.
- **Interactive checklists**: `- [ ]` tasks in replies become tickable checkboxes with a progress bar; ticks are saved and included in exports. The *Make a plan* starter uses the Planner.
- **Follow-up chips**: 2–3 suggested next questions under each reply (can be turned off).
- **Arena Fuse**: merge the side-by-side answers into one best answer.
- **Improve prompt** (with undo), **voice input** and **Listen** (read aloud) where the browser supports it.
- **Share by link**: a chat is compressed into the link itself; no server stores it. Imports are sanitized.
- **Fixes**: Markdown tables, safe links, nested/numbered lists, blockquotes; autoscroll no longer yanks you down while reading (↓ Latest button); pinned chats; character/token counter; print layout.

## v0.4.0 — sign in, guest mode, guided tour, themes
- **Welcome screen**: *Sign in* (free real AI) or *Continue as guest* (demo, own keys, Ollama). Existing chats and keys are kept; switch any time from the sidebar or Settings.
- **Glow AI**: signed-in users get curated models (GPT-5 mini, Gemini 2.5 Flash, Claude Haiku 4.5, DeepSeek, Grok and more), streamed through [Puter.js](https://docs.puter.com). Puter's User-Pays model runs them on each person's own free Puter allowance, so there is no API key and no bill for Glow. The model list is filtered against Puter's live catalogue.
- **Chat sync**: when signed in, chats, votes and deletions sync to the user's Puter key-value storage (split into parts under the 400 KB value limit). API keys are never synced. Can be turned off in Settings.
- **Guided tour**: 11 spotlight steps (model picker, composer, Council, Arena, search, export, theme, account, settings), Next/Back/Skip, arrow keys and Esc; replay with `?` or Settings. Works on mobile by opening the sidebar for sidebar steps.
- **Theme**: follows the device by default; toggle in the top bar, welcome screen or sidebar, or choose System/Light/Dark in Settings.
- **UI**: starter prompt cards, per-reply Copy, toast feedback, chat rename, glow accents, focus rings, message animations (reduced-motion respected). Chat error notices no longer disappear right after they appear.
- **Honest limits**: Puter is a third-party service and needs a person to sign in (a popup); its free allowance is limited and set by Puter. If Puter can't be reached, guest mode keeps working.

## v0.4.1 — real AI for guests, no sign-up
- Guests now get real answers immediately: **Glow Free** (GPT-OSS 20B via Pollinations' anonymous tier, no key, no account) is the default model, so typing and pressing Enter works like a normal AI chat. Demo stays available.
- Your own strong models (OpenRouter key, signed-in Glow AI, local Ollama) still take priority when connected.
- Friendly messages when the free service is busy (it's shared and rate-limited; requests are retried automatically) or the network is down.

## v0.4.2 — visible rate-limit notice
- When the free guest AI (or any provider) throttles a reply, a clear notice appears above the message box on desktop and mobile: why it's waiting, a live retry countdown and the attempt number. It disappears as soon as the reply starts.
- If retries run out, the notice stays (with a "Sign in for faster AI" shortcut for guests) until the user dismisses it or tries again. Throttling reported inside the stream is caught too.
