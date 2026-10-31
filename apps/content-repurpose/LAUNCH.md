# Atomize — Launch Playbook

The product is built. The code is committed. Now the goal is **first paying customer**.

Target: $500 MRR by end of month 1, $2k MRR by month 3.

## The 7-day launch sequence

| Day | Action | Time | Goal |
|-----|--------|------|------|
| 1 | Buy domain, deploy to Vercel, configure webhook | 45 min | Public URL live |
| 2 | Submit to Product Hunt (scheduled for Day 4) | 15 min | Hunter lined up |
| 3 | Publish launch blog post + X thread | 2 hr | Story in place |
| 4 | Product Hunt launch | All day | Top 5 of the day |
| 5 | Post on Show HN, Indie Hackers | 30 min | Tech audience |
| 6 | Share in 3 niche communities (r/SaaS, r/ContentMarketing, marketing Slack/Discord) | 1 hr | Targeted users |
| 7 | Review metrics, double down on the channel that converted | 1 hr | Iterate |

## Pre-launch checklist (Day 1)

- [ ] Buy `atomize.app`, `atomize.io`, or your preferred domain (~$12/yr on Namecheap/Cloudflare)
- [ ] Vercel → New Project → import your GitHub repo → paste env vars
- [ ] Lemon Squeezy → store live, Pro + Power products published
- [ ] Lemon Squeezy → webhook configured to `https://yourdomain.com/api/lemonsqueezy/webhook`
- [ ] Visit your domain, click through the flow, do a test purchase
- [ ] Run the example blog post through the tool, save the output as a screenshot for marketing
- [ ] Set up a Plausible or Google Analytics property
- [ ] Create `@atomizeapp` (or similar) on X
- [ ] Create the Product Hunt maker profile

## Channel-by-channel playbook

### 1. Product Hunt (highest leverage, hardest)

- **Lead time:** Need a "Hunter" to submit you. Message 5-10 people in your network 48 hours before launch.
- **Launch day:** All hands. Respond to every comment in the first 4 hours. Aim for Top 5 of the day.
- **Asset checklist:** Logo (512×512), Open Graph image (1200×630), 3-5 product screenshots, GIF of the tool in action.

### 2. Hacker News (Show HN)

- **Title format:** `Show HN: Atomize – Turn one blog post into a week of social content`
- **Body:** 2-3 sentences on what it does + why you built it + a screenshot. Link at the bottom.
- **Timing:** Post between 8-10am US Eastern. Tuesday-Thursday.
- **Engagement:** Reply to every comment for the first 6 hours. Be honest about limitations.

### 3. Indie Hackers

- **Post in "Milestones" + your personal journal.**
- **Story arc:** "I built this because [problem I had]. Here's how it's going."
- **Update weekly** for the first month. The IH audience rewards consistency.

### 4. X (Twitter) thread

- 7-tweet thread:
  1. The pain point (founder has content but no time to repurpose it)
  2. The insight (1 blog post = 1 week of social)
  3. The product (Atomize does this in 15 seconds)
  4. A real before/after screenshot
  5. How it's built (Claude + Lemon Squeezy + Next.js)
  6. The free tier (3 repurposes on the house)
  7. CTA (link in bio / reply to get a free repurpose)

### 5. Niche communities

Don't blast the same message. Customize per community:

| Community | Angle |
|-----------|-------|
| r/SaaS | "Building a micro-SaaS in the AI repurposing niche — here's week 1" |
| r/ContentMarketing | "Tool I built for repurposing blog posts — looking for feedback" |
| r/IndieHackers | (post in IH, not Reddit) |
| Marketing Twitter | "Free for the first 50 — paste your blog, get 17 pieces of content" |
| Slack: Demand Curve, Marketing Examined, etc. | Same as above, no link drop, just helpful |

### 6. SEO (slow burn, high leverage)

- **Write 8-10 SEO posts targeting:**
  - "content repurposing tool"
  - "turn blog post into LinkedIn posts"
  - "AI content repurposing"
  - "best AI tool for repurposing blog posts"
  - "how to repurpose a blog post"
  - "Twitter thread generator from blog post"
  - "newsletter generator from blog post"
  - "YouTube short script generator"
- **Each post:** 800-1200 words, real examples, a CTA to the tool.

## Pricing experiments to run

- **Week 2:** Try lowering Pro to $12/mo to see if conversion improves. If yes, keep there.
- **Week 4:** Add a $99/year option (saves them ~$130/year). 20-30% of Pro users typically switch.
- **Month 2:** Consider a "Team" tier ($79/mo for 5 seats) once you see agencies using it.

## What success looks like (Day 30)

| Metric | Target |
|--------|--------|
| Unique visitors | 2,000 |
| Free signups / uses | 150 |
| Paid conversions | 10-20 |
| MRR | $200-400 |
| NPS (post-purchase email) | 40+ |

If you're below these, the bottleneck is usually:
- **Traffic** → SEO + communities are your levers
- **Conversion** → pricing, landing page clarity, or the free tier limit
- **Retention** → output quality or usage friction

Tell me which metric is the bottleneck and I'll help you fix that specific thing.
