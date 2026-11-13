# GlowBot

Glow's AI team inside Telegram, on a free Cloudflare Worker named `glow-bot`. Works in the Telegram
app on iPhone, Android and desktop. No app store, no API keys, nothing to pay.

## What you can do in the chat

| You send | What happens |
|---|---|
| any message | **GlowChat** answers, remembering the conversation until `/new`. |
| `/lead <goal>` | **GlowLead** plans the job (steps and done-criteria) and shows the plan with **Start** and **Cancel** buttons. After Start, each step goes to GlowChat, the GlowChat Council (Builder, Critic, Judge) or the GlowRoom crew. The mission card updates as steps finish, and the work is checked against the done-criteria. If something is missing, GlowLead adds one more step, then sends the report with the check. **Stop** works at any moment. |
| `/search <question>` | The **GlowRoom crew** searches the live web, reads the top pages and answers with numbered sources. |
| `/news` | The current **GlowNews** edition: briefing and top stories. |
| `/spark [opening]` | A short tale from **GlowSpark**, the small model Glow trained from scratch. |
| `/models` | Which free models answer, in order, and which are resting. |
| `/new`, `/stop`, `/help`, `/myid` | Fresh chat, stop the mission, help, your Telegram id. |
| `/allow <id>`, `/deny <id>`, `/users` | Owner only: who else may use the bot. |

A mission runs one step per Durable Object alarm, so it survives restarts and can take as long as the
free models need. When every free model is busy, the mission waits and retries (up to four tries per
step) and says so on its card.

## Connect a bot (once)

1. In Telegram, open **@BotFather**, send `/newbot`, choose a name and a username ending in `bot`.
2. Run `python apps/glow/bot/tools/connect_telegram.py`. It asks for the token and your Glow setup
   code (neither is printed or saved), connects the bot to the Worker and prints a pairing link.
3. Open the pairing link on your phone and tap **Start**. You are now the owner. The link works once,
   for 24 hours. `--new-pairing` makes a fresh one.

The bot is private: everyone except the owner is told their Telegram id and has to be added with
`/allow <id>`. Telegram's webhook is checked with a secret that only Telegram and the Worker know.

## Addresses

| Address | What you get |
|---|---|
| `GET /v1/status` | Alive, which build is live, and whether a bot is connected and paired. |
| `GET /v1/probe` | A health check run from Cloudflare itself: every free model, every way to search and read the web, GlowNews and GlowSpark, each tried once. A result is kept for six hours per build; `?fresh=1` needs the setup code. |
| `POST /v1/setup` | Owner only (`X-Glow-Setup-Code`): connect a bot token, set the webhook, make a pairing link. |
| `POST /v1/telegram` | Telegram's webhook. |

## What is inside

| File | Job |
|---|---|
| `src/index.js` | The Worker, the webhook, `ChatAgent` (one per chat: memory, message queue, mission) and `Registry` (token, webhook secret, owner, who may use the bot). |
| `src/bot.js` | Commands, GlowChat, and the mission card with its buttons. |
| `src/lead.js` | GlowLead: planner, workers and checker, following `apps/glow/web/lead/lead.js`. |
| `src/telegram.js` | The Bot API, Markdown to Telegram HTML, and splitting long answers. |
| `src/models.js` | The chain of free models: no-key services first, Cloudflare Workers AI as backup, with rest times after a failure. |
| `src/web.js` | Web search and page reading, with several fallbacks. |
| `src/spark.js` | GlowSpark, Glow's own small language model, running on the Worker. |
| `src/probe.js` | The health check. |
| `src/crew-port.js` | GlowRoom's search parser, copied by `tools/make_ports.py` (never edited by hand). |

## Run the tests

```
cd apps/glow/bot
node --test test/*.test.js
python tools/make_ports.py --check
```

The tests use a pretend Telegram, a pretend network and a pretend clock, so they need no internet.

## Deploy

Pushing to `main` deploys it through `.github/workflows/glow-bot-worker.yml`, which then asks the
live Worker for its status and runs the health check. The bot's settings live in the Worker's own
storage, so a deploy never disconnects the bot.
