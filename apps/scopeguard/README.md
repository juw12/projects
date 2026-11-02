# ScopeGuard — keep your business AI on-mission

**Live app:** https://juw12.github.io/projects/scopeguard/

Companies add an AI assistant to do one job: support, a CAD copilot, a banking helper. Users then treat it as a free general-purpose chatbot, asking for essays, homework, recipes and jailbreaks. The business pays for those tokens and carries the brand risk. ScopeGuard sits between the user and the LLM and handles each message in one of five ways:

| Decision | When | What happens |
|---|---|---|
| **ALLOW** | on-mission | forwarded to your AI unchanged |
| **ADJACENT** | related ("which alloy is best for machining?") | answered briefly, then steered back to the mission |
| **REDIRECT** | off-topic | polite redirect that suggests what the assistant *can* do; your AI is never called |
| **THROTTLE** | the user's daily off-topic allowance is used up | short refusal |
| **BLOCK** | jailbreak / prompt injection | refused |

It also shows the business what users actually want ("unmet demand" themes), which users abuse the assistant, and an estimate of LLM cost avoided.

![Try it](docs/screenshots/try-dark.png)

## What's in this folder

| Path | What |
|---|---|
| `web/` | The app (vanilla JS, no build step, installable PWA). It runs the guard **entirely in the browser**. Use it to chat as a user, simulate traffic, watch the dashboard, correct the classifier, edit/import/export policies and measure accuracy. Data stays in `localStorage`. |
| `web/policies/` | Three policy templates (CAD copilot, bank support, online store) and the CAD accuracy test sets |
| `server/` | Self-hosted guard for production. Python standard library only: `/v1/check`, an OpenAI-compatible `/v1/chat/completions` proxy, an admin dashboard, SQLite log, review queue, and an optional LLM judge. See `server/README.md`. |
| `tests/` | Hermetic checks run by CI (`scripts/run_all_tests.py`): deploy safety, XSS guard, templates, and the 19-test server suite |
| `ui-tests/` | Headless-Edge browser suite: JS-vs-Python engine parity and every UI flow (`last-results.txt`) |
| `docs/` | Product plan, build plan with verification history, screenshots |

The browser engine (`web/engine.js`) is a line-for-line port of `server/engine.py`. The browser suite checks that both make identical decisions with identical scores on 202 messages across all three templates, plus 65 sequential session decisions. A policy you design in the app therefore behaves the same on the server.

## Run it

```
# the app (any static server)
python -m http.server 8000 --directory apps/scopeguard/web

# the production guard
cd apps/scopeguard/server
python server.py --policy policy_cad_assistant.json --port 8787   # dashboard at http://127.0.0.1:8787/
python demo.py                                                     # sample traffic + dashboard

# tests
python apps/scopeguard/tests/test_scopeguard_web.py
python apps/scopeguard/ui-tests/run_ui_tests.py        # needs Playwright + Microsoft Edge
```

## Measured accuracy (CAD policy, local classifier, no LLM judge)

| Set | Served vs stopped correctly | Real users wrongly redirected | Off-topic let through* |
|---|---|---|---|
| Tuning set (used while designing; optimistic) | 100% | 0/23 | 0/15 |
| Blind set (written after the first tuning) | 89% | 0/16 | 3/12 |
| Final set (never tuned against) | 85% | 1/11 | 2/9 |

\*Off-topic messages that get through still receive a "steer back" instruction and land in the review queue. The bank and store templates have no measured test set. The Accuracy page lets you paste your own labelled cases, which is the honest way to measure the guard for your business.

## Limits

- The local classifier matches **wording, not meaning** (TF-IDF + kNN). Expect roughly 1 in 5 cleverly phrased off-topic requests to get through. For production, enable the server's optional LLM judge for low-confidence messages.
- The proxy does not stream (`stream: true` returns 400). Sessions are held in memory, so off-topic allowances reset when the server restarts.
- Cost savings are estimates (\(\text{tokens} \approx \text{chars}/4\) plus an assumed reply length).
- Only incoming messages are checked; the AI's answers are not.
- Status: **working prototype**. Not load-tested, and not audited against any compliance standard.
