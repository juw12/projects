# GlowBot

Glow's agents inside Telegram, running on a free Cloudflare Worker named `glow-bot`.

**This is the foundation only.** The Telegram side (missions with GlowLead and the crew, GlowNews,
GlowHarness and GlowSpark) is the next step and is built on the parts that are here.

## What it does today

| Address | What you get |
|---|---|
| `GET /v1/status` | It is alive, and which build is live. |
| `GET /v1/probe` | A health check run from Cloudflare itself: every free model, every way to search and read the web, GlowNews and GlowSpark, each tried once. |

The health check runs inside a Durable Object alarm, which is exactly where the bot's missions
will run, so a green check means that path works too. A result is kept for six hours per build.
Asking for a new one early (`?fresh=1`) needs the owner's setup code in the `X-Glow-Setup-Code`
header.

## What is inside

| File | Job |
|---|---|
| `src/index.js` | The Worker and its two Durable Objects (`ChatAgent`, `Registry`). |
| `src/models.js` | The chain of free models: no-key services first, Cloudflare Workers AI as backup, with rest times after a failure. |
| `src/web.js` | Web search and page reading, with several fallbacks. |
| `src/spark.js` | GlowSpark, Glow's own small language model, running on the Worker. |
| `src/probe.js` | The health check. |
| `src/crew-port.js` | GlowRoom's search parser, copied by `tools/make_ports.py` (never edited by hand). |

No API keys are needed. The only secrets are the two Cloudflare ones the deploy workflow uses.

## Run the tests

```
cd apps/glow/bot
node --test test/*.test.js
python tools/make_ports.py --check
```

The tests use a pretend network and a pretend clock, so they need no internet.

## Deploy

Pushing to `main` deploys it through `.github/workflows/glow-bot-worker.yml`, which then asks the
live Worker for its status and runs the health check.
