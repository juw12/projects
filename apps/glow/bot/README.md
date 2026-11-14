# GlowBot

Glow's AI team inside Telegram. You give it a goal in a chat or a group; GlowLead plans it, hands
the steps to agents, checks the work and reports back. It runs on a free Cloudflare Worker named
`glow-bot`, uses free AI models, and needs no API key.

- Bot page (status, setup, self-test): https://juw12.github.io/projects/glow/bot/
- Bot server: https://glow-bot.juw12.workers.dev

## Connect it (once)

1. In Telegram, open **@BotFather** and send `/newbot`. Give the bot a name, then a username that
   ends in `bot`. BotFather answers with a **token**.
2. Open your **setup link**. It is the bot page with a setup code after the `#`, like
   `https://juw12.github.io/projects/glow/bot/#k=...`. Paste the token and tap **Connect**.
3. Tap the Telegram link the page shows and press **Start**. That makes you the owner. The link
   works once, and only in a private chat with the bot. Until someone uses it, the bot answers nobody.

About the secrets:

- The **token** goes once, over HTTPS, from the page to the bot server. The server keeps it in its
  own storage on Cloudflare (the `Registry` Durable Object). It is never in this repository, and
  the page does not save it.
- The **setup code** is the part after `#`. A browser never sends that part to a web server, and
  the page wipes it from the address bar as soon as it opens. Your browser history can still
  remember the link, so treat the link like a password. The repository holds only a SHA-256
  fingerprint of the code (`SETUP_CODE_SHA256` in `wrangler.toml`).
- The setup code can connect a different bot or wipe this one, so do not share it.

## Commands

| Command | What it does |
|---|---|
| `/lead` | Give it a goal. GlowLead plans it, hands the steps to agents, checks the result and reports back. |
| `/room` | Give it a topic. The GlowRoom crew researches it on the live web. |
| `/ask` | One agent, one job. Name the agent first, like `/ask scout`, then the task. |
| `/agents` | Who is on the team. |
| `/chat` | Plain chat that remembers the last few turns. |
| `/agent` | GlowHarness: an agent with tools that asks before it saves anything. `/harness` is the same. |
| `/news` | Today's AI news from GlowNews, with buttons for each topic. |
| `/spark` | GlowSpark, the tiny AI Glow built from scratch, writes a short story from your opening line (in English). |
| `/apps` | Buttons that open the Glow apps. |
| `/daily` | AI news every day at a time you set (UTC+7), like `/daily 07:30`. `/daily off` stops it. |
| `/every` | Owner only. A mission that runs by itself on a schedule (UTC+7), like `/every mon,thu 08:00 research cheap flights to Tokyo`. `/every` lists them, `/every off` clears them. Up to 5. |
| `/missions` | Your last missions (the bot keeps 20). `/missions 3` shows a report again; the buttons run one again. |
| `/status` | What is running, your mode, language and jobs used today. |
| `/stop` | Stops the running job. `/cancel` is the same. |
| `/lang` | Changes the language (English, Bahasa Indonesia, 简体中文, 繁體中文). |
| `/new` | Forgets the plain chat so far. `/reset` is the same. Schedules, past missions and notes stay. |
| `/models` | Which free models answer right now, with a button for each one. Tap one and it answers first; the others still step in when it is busy. `/model <name>` does the same by name and `/model auto` lets the bot choose again. |
| `/myid` | Your Telegram id and this chat's id. |
| `/help` | Everything it can do. |
| `/about` | The bot's version and its links. `/version` is the same. |
| `/privacy` | What the bot keeps and where your words go. |
| `/access` | Owner only. `/access public` lets anyone use the bot; `/access private` closes it again. |
| `/allow` | Owner only. `/allow 123456789` lets one person or one group in while the bot stays private. |
| `/deny` | Owner only. `/deny 123456789` takes that person or group out again. |
| `/users` | Owner only, in the owner's private chat. Who is let in. |

A message without a command goes to the mode the chat is in. A new chat starts in lead mode;
`/lead`, `/room`, `/chat` and `/agent` switch it. The first bot had `/mission` and `/search`;
they still work and mean `/lead` and `/room`.

How a mission goes: the bot shows its plan and waits for your OK (a one-step plan just runs).
Before you approve, a message from you changes the plan. While the team works, a message from
you is passed on to it as a note. In a group, send it as a reply to one of the bot's messages.
`/stop` ends the job.

## Groups

- Add the bot to a group and everyone there shares one team.
- The owner lets a group in just by adding the bot to it. If someone else adds a private bot to
  their group, it says so and leaves.
- In a group it answers commands and replies to its own messages. That is how Telegram's privacy
  mode works. To make it hear plain @mentions too, turn privacy mode off in @BotFather
  (Bot Settings, then Group Privacy).
- Only the person who started a job, or the owner, can press that job's buttons.

## Limits

- One job at a time per chat.
- Everyone except the owner gets 20 jobs a day per chat.
- The bot starts **private**: only the owner, and the groups the owner let in, can use it. A
  stranger is told so (at most once an hour) and nothing else. A stranger may still send `/myid`
  (once a minute) to get the id the owner needs for `/allow`.
- It runs on free AI models. They can be slow, busy or simply wrong. Check anything that matters.
- Research uses Bing and Wikipedia search and reads pages directly. Some sites refuse that, so a
  step can come back empty.
- What you send goes to the bot server and on to the free AI services it uses. The server keeps a
  short memory per chat so it can follow up. Do not send secrets.

## Addresses

| Address | What you get |
|---|---|
| `GET /` | A line that says what this server is. |
| `GET /v1/status` | It is alive, which build is live, whether a bot is connected and claimed, and whether it is public or private. |
| `GET /v1/selftest` | The bot checks its own logic: whole conversations driven through the real chat code, with scripted models in place of the free ones. No network is used. One result per build. |
| `GET /v1/probe` | A health check run from Cloudflare itself: every free model, every way to search and read the web, GlowNews, GlowSpark and one recorded voice sample through the speech model, each tried once. Kept for six hours per build; a check that could not fetch the voice sample is run again after five minutes. |
| `GET /v1/profile` | What Telegram shows for the bot right now (name, command menus, descriptions, picture, webhook), read back from Telegram and compared with what this version means to show. No token, owner or chat is in the answer. |
| `POST /telegram/webhook` | Where Telegram delivers messages. Telegram signs each call with a secret header; anything else is refused. |
| `POST /v1/telegram` | The first bot's address for the same thing. It is kept so no message is lost while the webhook moves (see below). |
| `POST /setup` | Used by the bot page: takes the setup code and the token, checks the token with Telegram and connects the webhook. |
| `POST /v1/setup` | The same, for `tools/connect_telegram.py`. A token is optional (the saved one is reused), `"newPairing": true` makes a fresh owner link, and the answer also says where the webhook is and gives the owner link while nobody owns the bot. |
| `/admin/simulate` | Owner tool: talk to the bot without Telegram (send with `POST`, read with `GET`, wipe with `DELETE`). Needs the setup code. |
| `POST /admin/reset` | Owner tool: disconnect the bot and forget the token. Needs the setup code. |

The setup code travels in the `X-Glow-Setup-Code` header (`/setup` also takes it in the body).
Asking for a new self-test or health check early (`?fresh=1`) needs it too. Web pages may call the
server only from `https://juw12.github.io`.

## What is inside

| File | Job |
|---|---|
| `src/index.js` | The Worker and its two Durable Objects: `Registry` (one for the whole bot) and `ChatAgent` (one per chat). |
| `src/registry.js` | The one place that knows the token, the owner and who may use the bot. Every update passes its gate first. |
| `src/chat.js` | One chat's brain: commands, buttons, the job queue, limits, the daily news timer. Long work runs in alarms, one small unit at a time. |
| `src/missions.js` | The mission engine: turns a job into small units of work (one model call or one batch of web reads each). |
| `src/agent.js` | `/agent` mode: GlowHarness from the Glow web app, with web search and page reading added. |
| `src/telegram.js` | Turns a model's Markdown into Telegram HTML, cuts long answers into messages that fit, and talks to the Bot API. |
| `src/strings.js` | Everything the bot says, in the four Glow languages. |
| `src/models.js` | The chain of free models: no-key services first, Cloudflare Workers AI as backup, with rest times after a failure. |
| `src/web.js` | Web search, page reading and the GlowNews edition. |
| `src/spark.js` | GlowSpark, Glow's own small language model, running on the Worker. |
| `src/selftest.js` | The logic self-test behind `/v1/selftest`. |
| `src/probe.js` | The health check behind `/v1/probe`. |
| `src/util.js` | Small shared helpers. |
| `src/lead-port.js`, `src/crew-port.js` | GlowLead's planning rules and GlowRoom's crew, copied from the web apps by `tools/make_ports.py` (never edited by hand), so a mission is planned the same way in Telegram. |
| `tools/check_live.js` | Asks a deployed Worker for its status and its self-test, and fails unless both belong to the build just deployed and the self-test is green. With `--profile` it also fails when the bot's Telegram profile is not what this version sets. |
| `tools/connect_telegram.py` | Connects a bot from a terminal instead of the bot page, and can make a fresh owner link (`--new-pairing`). |

No API keys are needed and there are no runtime dependencies. The only secrets in GitHub are the
two Cloudflare ones the deploy workflow uses.

## Run the tests

```
cd apps/glow/bot
node --test test/*.test.js
python tools/make_ports.py --check
```

The tests use a pretend network, a pretend Telegram and a pretend clock, so they need no internet.
The bot page has its own test: `python -X utf8 apps/glow/tests/test_glow_bot.py` from the repo root.

## Deploy

Pushing to `main` deploys it through `.github/workflows/glow-bot-worker.yml`. The workflow runs the
tests, checks the generated ports and deploys. Then `node tools/check_live.js` asks the live Worker
for its status and its self-test, and the deploy fails if either is wrong.

## Coming from the first bot (0.2.0)

The first GlowBot kept its token, owner and allowed chats under another name in the same
`Registry` storage, and Telegram delivered to `/v1/telegram`. This version takes all of that over
by itself the first time it runs: the token, the owner, the allowed chats, the public or private
switch and an owner link that was not used yet (it keeps its 24 hours). Nobody has to connect the
bot again. What each chat remembered in the first bot is not carried over.

Then it moves the webhook to `/telegram/webhook`, without dropping waiting messages. The first
message, or the first `GET /v1/status`, starts the move. Until it is done the status says
`"webhook": "moving"` and both addresses and both secrets work. If Telegram refuses, the bot
keeps answering on the old address and tries again an hour later.

## The bot's own profile

The bot sets what Telegram shows for it, once for each version: its name (GlowBot), the text on the empty chat, the short line on its profile, its picture, and the `/` menu in English, Indonesian and Chinese. The owner's private chat gets a longer menu with the owner commands. The description says so when the bot is private, and is sent again when `/access` changes.

Telegram limits how often a bot may change its name. When a step is refused the bot keeps the rest, tries again an hour later, and stops after three tries for one version. `GET /v1/profile` reads everything back from Telegram and says which parts match:

```
node tools/check_live.js https://glow-bot.juw12.workers.dev --profile
```

## Not checked yet

- The tests and `/admin/simulate` use a pretend Telegram. The real round trip (messages, buttons,
  the webhook move) is only proven by using the bot in Telegram.
- The health check sends one recorded voice sample through the speech model and expects the right words back. A voice note recorded on a phone and sent in Telegram has not been tried.
- Until a token is connected, `GET /v1/status` says `"configured": false`.
