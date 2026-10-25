# Mufakat: Product Brief

## Problem
A single AI answers confidently and is sometimes wrong. People copy answers between
chatbots to get a second opinion, and have no idea which model is actually best for them.

## Idea
Bring the Indonesian practice of *musyawarah untuk mufakat* (deliberate until consensus)
to AI:
- **Council**: 2–3 agents with complementary roles, each on its own model, deliberate;
  an impartial Judge writes the final answer with agreements, open points and confidence.
- **Arena**: the same prompt to several models side by side, with a personal leaderboard
  built from your votes.
- **Second opinion**: one click asks a different model to review any answer.

## Stages
1. **Free prototype (now):** static PWA on GitHub Pages: Demo / OpenRouter free models /
   Ollama / any OpenAI-compatible API, all from the browser. Zero hosting cost.
2. **Hosted (built in `server/`):** accounts, synced chats, Free plan (free models, daily cap)
   and Pro subscription (premium models within a per-user monthly cost budget).
   Needs hosting (~$7/mo), OpenRouter credit and a payment provider for the operator's
   country (Stripe built in; Lemon Squeezy / Paddle where Stripe isn't available).

## Differentiators vs single-model chat apps
| | Single-model chat | Mufakat |
|---|---|---|
| Multiple models in one answer | ✗ | Council + Judge |
| Side-by-side comparison | ✗ | Arena + personal leaderboard |
| Built-in second opinion | ✗ | One click |
| Choice of provider, incl. local/private | Limited | OpenRouter, Ollama, any OpenAI-compatible |
| Price | Subscription | Free (bring your own free key) |

## Success signals
- Users start a Council or Arena in their first session
- Judge verdicts rated better than single-model answers in side-by-side checks
- Repeat Arena votes (people come back to compare models)
