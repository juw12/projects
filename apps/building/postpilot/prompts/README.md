# PostPilot Prompt System

This folder contains the AI prompt system for PostPilot. Everything here runs in **Google AI Studio** (aistudio.google.com) on the free tier. **No code, no API keys, no setup.**

## How to use this system

1. Open https://aistudio.google.com and sign in with any Google account
2. Click "Create new prompt" (chat-style)
3. Pick model: **Gemini 2.0 Flash** (free, fast, good enough)
4. Open the file you need (see "When to use" below)
5. Copy the contents into the **System instructions** field
6. In the user message, paste the client's inputs where you see `[BRACKETED PLACEHOLDERS]`
7. Click Run. The output is your client's deliverables.

## Files and when to use each

| File | When | Output |
|---|---|---|
| `00-voice-calibration.md` | Run ONCE per new client (after onboarding) | Voice Profile doc → save as `clientname-voice.md` |
| `01-weekly-generator.md` | Run every Monday | 3 LinkedIn posts ready to deliver |
| `02-few-shot-examples.md` | Paste 3 examples INTO the system instructions of file 01 | (Reference material, not run standalone) |
| `03-quality-check.md` | Run ON each generated post before delivering | PASS or FIX NEEDED with line-level feedback |
| `04-test-run.md` | Run once with fake client data to verify the system works | Reference example showing what good output looks like |
| `05-email-templates.md` | Copy-paste templates for client lifecycle emails | Welcome, weekly delivery, testimonial, cancellation |

## The 5-step workflow per week

1. **Monday morning** — Run `01-weekly-generator.md` for each client
2. **Monday afternoon** — Run `03-quality-check.md` on each generated post
3. If FIX NEEDED → re-run `01-weekly-generator.md` with feedback in the user message
4. If PASS → send the 3 posts to the client with your brief intro
5. **End of week** — Save the client's edits. They become training data for next week

## Onboarding a new client (one-time, 10 minutes)

1. Send the client the onboarding form (see ONBOARDING.md below)
2. Get their voice samples, niche, topics, banned topics
3. Run `00-voice-calibration.md` with their samples
4. Save the output as `[clientname]-voice.md` for future reference
5. You're ready to run `01-weekly-generator.md` for them next Monday

## Common mistakes

- **Running the generator without a voice profile** — the output will sound generic. Always run voice calibration first.
- **Skipping the quality check** — clients notice generic AI phrasing instantly. The check catches "in today's fast-paced world" type tells.
- **Batching multiple clients into one prompt** — keep them separate. Voice profiles don't mix.
- **Editing before sending** — if you're rewriting every post, your voice profile is wrong. Update it.
- **Hiding that AI is involved** — be transparent. Most coaches are fine with it, and it sets expectations.

## What success looks like

- Voice profile takes ~15 minutes per client
- Each Monday: 30-45 minutes to generate + QA all posts
- Client approval rate >70% without edits = you're dialed in
- After 4 weeks, the client's edits give you enough data to make the voice profile "sticky" — the system learns their style

---

## Onboarding form (send to new clients)

```
Copy and paste this into your onboarding email or form:

---

Welcome to PostPilot! Please answer these 7 questions. The better your answers, the better your posts.

1. What's your niche? (e.g., "Executive coaching for SaaS founders")
2. Who's your ideal client? (e.g., "VP Sales at Series A startups, 50-200 person team")
3. Paste 5-10 of your past LinkedIn posts here (or posts you admire and wish you'd written)
4. What 3-5 topics do you want to be known for?
5. Any topics, phrases, or stories you NEVER want to see in your posts?
6. Anything specific to weave in? (years of experience, signature story, frameworks you teach, company name, etc.)
7. One sentence: what should someone think after reading 10 of your posts?

That's it. We'll have your first 3 posts to you within 48 hours.
```
