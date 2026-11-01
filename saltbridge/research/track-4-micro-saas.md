# Micro-SaaS Business Plan — Bilingual EN/ZH Side-Gig

**Context & honest framing.** Owner is bilingual EN/Chinese, $0 capital, 1–2 h/day. This is *background scaffolding*, not an immediate launch — it must age well over 2–6 months of shelf life. At this scale the **first idea is more likely to fail than to succeed**: iteration is slow and **distribution, not the code, is the real problem**. Every section below therefore favors **validation over building** and a $0-cost stack.

## 3 SaaS ideas

### Idea 1 — Bilingual product-listing generator for cross-border Amazon/Etsy sellers
- **Problem:** Chinese sellers list in English marketplaces, but their Chinese specs become flat, literal, low-converting English copy.
- **Customer:** Solo Amazon/Etsy/Shopify sellers shipping CN→EN (and CN→JP/DE), ~10–500 SKUs, no native copywriter.
- **Bilingual edge:** Founder writes native-level ZH *and* EN, knows which claims are compliant, and can encode marketplace tone (Amazon's keyword-dense style vs Etsy's handmade warmth).
- **MVP features (≤5):** (1) paste ZH spec → EN listing pack (title / bullets / description / tags); (2) brand voice + per-seller glossary; (3) marketplace char/byte limit checker; (4) A/B variants; (5) bulk CSV.
- **Stack + reasoning:** Vercel (Next.js, free) + Supabase free (Auth/Postgres) + Stripe + OpenAI pass-through. All $0 at MVP scale; the LLM is the only variable cost and the free tier caps it.
- **Pricing:** Free 5/mo · Pro **$29/mo** (200 listings, glossary, A/B, CSV) · Studio **$99/mo** (unlimited, bulk, API).
- **GTM (2 sentences):** Post weekly before/after listing screenshots in 3 Chinese seller communities (卖家 groups, 小红书) and offer concierge listings free to the first 10. Then own the "亚马逊 listing 优化 / Amazon listing generator Chinese" SEO terms.

### Idea 2 — Subtitle/transcript translator for bilingual YouTube creators (SEO metadata)
- **Problem:** Creators can get translated captions, but no bilingual titles/descriptions/tags that *rank* in both languages.
- **Customer:** Mid-size YouTubers going cross-border (CN creators → global, EN → CN), 2–8 videos/mo.
- **Bilingual edge:** Produces metadata that actually ranks in both search surfaces, not just literal translation.
- **MVP features (≤5):** (1) pull captions from a YouTube URL; (2) translate SRT/VTT; (3) bilingual title/description/tags; (4) side-by-side bilingual transcript; (5) one-click caption publish.
- **Stack + reasoning:** Cloudflare Workers + Supabase free + YouTube Data API (free quota) + LLM. Serverless is $0; the YouTube API covers MVP volume free.
- **Pricing:** Free 3 videos/mo · Pro **$29/mo** (40 videos, metadata, publish) · Studio **$79/mo** (API, multi-channel).
- **GTM (2 sentences):** Ship a free "bilingual SEO score" checker as a lead magnet, then share it in creator Discords and X. *(Honest: the subtitle-translation layer is commoditized and free — the only wedge is the metadata.)*

### Idea 3 — Translation memory + glossary for repeat-translation freelancers
- **Problem:** Freelancers serving repeat clients re-translate the same terms and lose consistency, with no cheap lightweight TM.
- **Customer:** Freelance ZH-EN translators/localizers doing 1–3 recurring clients.
- **Bilingual edge:** Ships the default ZH-EN pair tool, tuned to the segments they actually use.
- **MVP features (≤5):** (1) upload paired files → build TM; (2) glossary with term-lock; (3) fuzzy-match lookup as you type; (4) export TMX; (5) client workspaces.
- **Stack + reasoning:** Vercel + Supabase free (Postgres holds TM/glossary) + local fuzzy matching (Levenshtein, deterministic). No LLM, so this is the only idea that is *truly* $0 even at volume.
- **Pricing:** Free 10k segments · Pro **$19/mo** (unlimited, TMX) · Team **$49/mo** (shared).
- **GTM (2 sentences):** Cold-DM 50 freelancers on ProZ/TranslatorsCafé offering free TMX import. *(Honest: crowded at the low end — Traxlate is free, Taia $8/mo, Linguaiser $15–30/mo — so WTP is the weakest of the three.)*

**Rejected:** *WeChat→email bridge* — WeChat's Open Platform needs a business license + verification, a hard blocker for a $0 individual. *AI prompt router for support teams* — B2B sales cycle plus heavy tool integrations; a poor fit for 1–2 h/day.

## Recommended idea to build first: **Idea 1**

Build the bilingual listing generator first.

**Market signal.** This is the only candidate where buyers are businesses, not hobbyists, and a paid prosumer tier is already proven. The closest analog, Listara, charges $6–25/mo for exactly this "paste-in → listing pack" workflow, and the wider space runs $33–499/mo (Ailumia, SellerForge) or $300–$1,500 per listing for agencies. Cross-border e-commerce is a growing, money-moving market — not a vanity one.

**Buildability in 40–80 hours.** The MVP is a form plus a prompt plus a database: auth, one brand profile, one "paste ZH spec → listing pack" flow, an editor, a history list, and a Stripe checkout. That is a weekend-to-two-weeks build of a working product on $0 hosting. No video processing, no file parsers, no marketplace API — you output text the seller pastes back into Seller Central — which keeps scope tight.

**Willingness-to-pay evidence.** Sellers already spend $300–$1,500 per listing with agencies and $33–499/mo on tools; a $29/mo price is a rounding error against one saved agency invoice. The concierge test (delivering 10 manual listings) will confirm this with real money inside two weeks.

**Distribution fit.** The founder can reach the buyer where they already are — Chinese seller Facebook groups, 小红书, and 卖家 forums — in both languages, with before/after screenshots that sell the product for itself. No paid ads are required to find the first 20 users.

**Defensibility after launch.** The moat is not the LLM — free ChatGPT gets "good enough." It is the per-seller glossary and brand voice that accumulate into a private, compounding dataset, plus marketplace compliance limits and batch workflows that make switching costly. Translation quality is the entry ticket; the data and the workflow are what keep the $29/mo.

## MVP spec — Bilingual listing generator (working name: **ListingBridge**)

### User flow (screens)
1. **`/` — Landing + auth.** Hero: "Paste 中文 spec → English listing that sells." Email/password (Supabase Auth).
2. **`/onboarding` — Brand profile.** Pick marketplace (Amazon/Etsy), brand voice (premium / friendly / technical), target buyer, and forbidden claims (e.g., "cure", "FDA-approved").
3. **`/listings/new` — Create.** Paste the Chinese spec, choose marketplace + variant count, hit **Generate**.
4. **`/listings/:id` — Editor.** Shows title / 5 bullets / description / tags with **live char- and byte-counts vs platform limits**; inline edit; **Copy** + **Export CSV**; A/B variants as tabs.
5. **`/listings` — Library.** Table of past listings: regenerate, copy, delete.
6. **`/pricing` — Plans + Stripe checkout.**

### Data model (entities + key fields)
- **users** — `id`, `email`, `plan` (free|pro|studio), `stripe_customer_id`, `created_at`
- **brand_profiles** — `id`, `user_id`, `marketplace`, `brand_voice`, `target_buyer`, `tone_notes`
- **glossary_terms** — `id`, `user_id`, `source_zh`, `target_en`, `note` ← *the moat*
- **forbidden_terms** — `id`, `user_id`, `term`, `marketplace`
- **listings** — `id`, `user_id`, `brand_profile_id`, `marketplace`, `input_zh`, `status`, `created_at`
- **listing_outputs** — `id`, `listing_id`, `variant` (A|B), `title`, `bullets` (json), `description`, `tags` (json), `model_used`
- **usage** — `user_id`, `month`, `count` (enforces plan limits)

### API surface (endpoints)
- `POST /api/listings` — create + trigger generation
- `GET /api/listings` — list a user's listings
- `GET /api/listings/:id` — listing with its outputs
- `PATCH /api/listings/:id/outputs/:outId` — edit one field
- `POST /api/listings/batch` — upload CSV (Studio)
- `GET /api/brand-profile` · `POST /api/brand-profile`
- `GET /api/glossary` · `POST /api/glossary`
- `POST /api/billing/checkout` — create Stripe session
- `GET /api/billing/portal` — billing portal

(Auth lives in Supabase, so it is not counted. 9 routes.)

### Hosting (and why it is $0/mo)
- **Vercel free** — Next.js front-end + serverless functions; $0.
- **Supabase free** — Postgres (500MB) + Auth + Row Level Security; $0.
- **Stripe** — 2.9% + 30¢ per transaction, no monthly fee; $0 fixed.
- **OpenAI (pass-through)** — the **only** variable cost; the Free tier (5 listings/mo) caps it at single-digit dollars, and paid plans fund it.
- **Domain** — start on the free `*.vercel.app` subdomain for true $0; add a ~$12/yr domain at launch.

**Total: $0/month until the first payment.**

## Validation plan (before writing code)

1. **Fake-door landing** (1 page, $0 on Vercel): the promise plus a "Get 3 free listings" email CTA that pings the founder.
2. **Concierge MVP (the real test):** for the first 10 signups, hand-produce the EN listing (ChatGPT + the founder's own skill) and deliver by email/Doc within 24h. Measure: repeat use, "would you pay?", and exactly what they edit.
3. **Smoke-test distribution:** organic posts in 3 seller communities (and a small $0–50 ad only if budget appears); track CTR → signup → concierge request.
4. **Money test:** after 5 concierge listings, add a Stripe link for "10 listings, $10" and watch whether any real money moves.

**Go / no-go (before building):** 30 landing signups, 10 concierge sessions, ≥3 "would pay $29/mo," and ≥1 real payment. If missed, sharpen the wedge or fall back to Idea 2 — *do not* build.

## 90-day build plan (~90–180 h at 1–2 h/day)

- **W1–2 — Validation:** landing live; recruit 10 concierge sellers from the communities.
- **W3–4 — Concierge + refine:** deliver 10–20 manual listings; lock the prompt + glossary; turn the spec above into tasks.
- **W5–6 — Build core:** auth, brand profile, single ZH→EN generation, editor with the limit checker.
- **W7–8 — Build surface:** history/library, A/B variants, CSV export, Stripe (Free/Pro).
- **W9–10 — Beta:** onboard the 10 concierge users onto the real product; fix the top issues.
- **W11 — Bulk + harden:** CSV batch (Studio), rate limits, error states.
- **W12 — Paid launch:** convert beta to Pro; announce in communities; target the **first 5 paying users**.

**Gates:** if <5 concierge sellers by W4 → revisit the wedge. If ~0 signups by W2 → change the GTM channel, not the product.

## Honest risk callouts

1. **Distribution is the actual problem, not the code.** A listing generator is easy to build and invisible without an audience. At $0, growth is organic-only (communities, SEO, word of mouth) and slow. If the founder will not post 3–5×/week in 卖家 / 小红书 groups, the product has no users no matter how good it is.
2. **The free-LLM substitution.** Any seller can paste a ZH spec into ChatGPT/Claude and get "good enough" English. The $29/mo must be earned by *workflow* — per-seller glossary, brand voice, compliance limits, batch, history — not by translation quality. If the moat is just "AI writes English," a $20/mo ChatGPT subscription kills the business.
3. **Feature creep toward the $99/mo clone.** The urge to add keyword research, A+ content, image generation, and repricing (i.e., become Helium 10) will consume the 1–2 h/day budget and delay the first dollar; premature "infrastructure" (fine-tuned models, microservices) before 10 paying users is a death spiral. Ship the single-marketplace ZH→EN pack; everything else waits for revenue.
