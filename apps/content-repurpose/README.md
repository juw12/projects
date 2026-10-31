# Atomize — AI Content Repurposing SaaS

Paste a blog post. Get 5 LinkedIn posts, 8 tweets, 3 newsletters, and a YouTube Short script. Built for founders and marketers who publish once but want to be everywhere.

## Stack

- **Next.js 14** (App Router, TypeScript)
- **Tailwind CSS** for styling
- **Anthropic Claude** (`claude-sonnet-4-5`) for content generation
- **Lemon Squeezy** for payments (Merchant of Record — works in Taiwan)
- **Cookie-based usage tracking** (no auth for MVP)

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in keys
cp .env.example .env.local

# 3. Run dev server
npm run dev
```

Visit `http://localhost:3000`.

## Required env vars

| Variable | Where to get it |
|----------|----------------|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/ (free credits to start) |
| `LEMONSQUEEZY_API_KEY` | https://app.lemonsqueezy.com/settings/api |
| `LEMONSQUEEZY_STORE_ID` | Lemon Squeezy store settings |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | Lemon Squeezy webhook settings |
| `LEMONSQUEEZY_VARIANT_PRO_MONTHLY` | Product → Pro variant ID |
| `LEMONSQUEEZY_VARIANT_POWER_MONTHLY` | Product → Power variant ID |

## Deploy to Vercel (free)

1. Push this folder to a GitHub repo
2. Go to https://vercel.com → New Project → import the repo
3. Add the env vars from above in the Vercel project settings
4. Deploy. Done.

Vercel free tier is enough for an MVP.

## Set up Lemon Squeezy payments

1. Sign up at https://www.lemonsqueezy.com/ (free)
2. Create a store
3. Create two products:
   - **Pro** — $19/month subscription
   - **Power** — $49/month subscription
4. Copy each variant ID into the env vars
5. In Settings → Webhooks, add:
   - URL: `https://your-domain.com/api/lemonsqueezy/webhook`
   - Events: `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_expired`
6. Copy the signing secret into `LEMONSQUEEZY_WEBHOOK_SECRET`

## First-week launch checklist

- [ ] Buy a domain ($10-15/yr). Suggest: `atomize.app`, `atomize.io`, or your niche + .com
- [ ] Deploy to Vercel
- [ ] Set up Lemon Squeezy products + webhook
- [ ] Submit to Product Hunt (https://www.producthunt.com/posts/new)
- [ ] Post on Hacker News (Show HN)
- [ ] Share in 3 relevant communities (e.g., Indie Hackers, r/SaaS, r/ContentMarketing)
- [ ] Write 1 launch post on your blog
- [ ] Set up a Twitter/X account for the product and post a launch thread
- [ ] Add 2 example repurposes to the homepage as social proof

## File map

```
app/
  page.tsx                          # Landing + tool (single-page MVP)
  pricing/page.tsx                  # Pricing
  api/
    repurpose/route.ts              # Core generation endpoint
    checkout/route.ts               # Lemon Squeezy checkout redirect
    lemonsqueezy/webhook/route.ts   # Subscription state sync
components/
  RepurposeTool.tsx                 # Client component: form + result display
lib/
  anthropic.ts                      # Claude SDK + generation prompt
  store.ts                          # File-based user/tier store (data/users.json)
  usage.ts                          # Cookie user-id + tier + usage tracker
  lemonsqueezy.ts                   # Checkout URL + webhook signature verify
data/
  users.json                        # Auto-created on first write (gitignored)
```

## Architecture notes

- **User identity** lives in a signed cookie (`atomize_user`) holding only a UUID.
- **Tier + usage** lives in `data/users.json`, keyed by user UUID. The webhook from
  Lemon Squeezy writes to this file; the API reads from it. Webhooks have no
  browser cookies, so the file is the source of truth across sessions.
- **Free tier** = 3 repurposes per rolling 30 days. Resets automatically on next visit.
- **Abuse vector**: cookie can be cleared. Acceptable for MVP; swap `lib/store.ts`
  for Vercel KV or Supabase when ready to harden.

## Upgrade path (post-MVP)

When you outgrow the MVP, the next moves are:

1. **Real auth** — swap cookie-based usage for Supabase or Clerk (free tiers)
2. **Server-side usage store** — Vercel KV or Upstash Redis for usage counts that survive cookie clears
3. **Multiple blog formats** — accept Markdown, HTML, URL import (fetch + extract)
4. **Tone/persona settings** — let users set brand voice, save presets
5. **Image generation** — add DALL-E / Imagen for social card visuals
6. **API access** — for the Power tier, expose a `/v1/repurpose` endpoint
7. **Scheduling integrations** — post directly to Buffer, LinkedIn, X
