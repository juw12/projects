# 150 ChatGPT Prompts for Etsy Sellers — Build Deliverable

**Status:** Ready to ship. All core deliverables complete. ~$0 cost. ~2 hours of execution work remaining before first sale.

---

## What You're Shipping

A digital product called **"150 ChatGPT Prompts for Etsy Sellers to Write Listings That Rank"** — positioned as a **6-phase system** that uses 150 prompts to write Etsy listings that rank, descriptions that convert, and a shop that grows.

| Format | File | Status |
|---|---|---|
| PDF (print/screen ready) | `product-files/150-etsy-prompts.pdf` | ✅ Ready (234 KB) |
| Master markdown | `product-files/master-source.md` | ✅ Ready |
| Plain text | `product-files/master-source.txt` | ✅ Ready |
| Notion-import | Same as master markdown (Notion accepts markdown) | ✅ Ready |
| Cover image (Gumroad) | `product-files/cover-gumroad.png` | ✅ Ready (1280×720) |
| Thumbnail (Etsy) | `product-files/thumbnail-etsy.png` | ✅ Ready (2000×2000) |
| Pinterest pin #1 | `product-files/pin-pain-point.png` | ✅ Ready (1000×1500) |
| Pinterest pin #2 | `product-files/pin-stat.png` | ✅ Ready (1000×1500) |
| Self-hostable landing page | `assets/landing-page.html` | ✅ Ready (deploy in 5 min) |

**Sections shipped:** 9 sections, 150 prompts, intro + workflow.

| Section | Prompts | File |
|---|---|---|
| 00 — Intro & 6-Phase Workflow | n/a | `prompts/00-intro-workflow.md` |
| 01 — Titles That Rank | 15 | `prompts/01-titles.md` |
| 02 — Descriptions That Convert | 20 | `prompts/02-descriptions.md` |
| 03 — Tags & Etsy SEO | 15 | `prompts/03-tags-seo.md` |
| 04 — Customer Service Replies | 20 | `prompts/04-customer-service.md` |
| 05 — Social Media Captions | 20 | `prompts/05-social-media.md` |
| 06 — Customer Emails | 15 | `prompts/06-emails.md` |
| 07 — Mockups & Photography | 15 | `prompts/07-mockups-photography.md` |
| 08 — Product Research & Validation | 15 | `prompts/08-research-validation.md` |
| 09 — Troubleshooting, Diagnosis & Strategy | 15 | `prompts/09-troubleshooting-strategy.md` |

---

## File Structure

```
etsy-prompts-product/
├── README.md                          ← You are here
├── prompts/                           ← The 150 prompts (source of truth)
│   ├── 00-intro-workflow.md
│   ├── 01-titles.md
│   ├── 02-descriptions.md
│   ├── 03-tags-seo.md
│   ├── 04-customer-service.md
│   ├── 05-social-media.md
│   ├── 06-emails.md
│   ├── 07-mockups-photography.md
│   ├── 08-research-validation.md
│   └── 09-troubleshooting-strategy.md
├── marketing/                         ← How to sell it
│   ├── gumroad-listing.md             ← Full Gumroad sales page (3 tiers)
│   ├── etsy-listing.md                ← Etsy listing (140-char title, 13 tags, description)
│   ├── launch-plan.md                 ← 14-day, $0-budget launch plan
│   └── cover-image-spec.md            ← Cover/thumbnail design spec for Canva
├── product-files/                     ← The actual deliverable file the buyer downloads
│   ├── 150-etsy-prompts.pdf           ← The product PDF
│   ├── master-source.md               ← Source for the PDF
│   ├── master-source.txt              ← Plain text version
│   └── pdf-styles.css                 ← CSS used to generate the PDF
├── research/
│   └── competitor-analysis.md         ← 30KB market research — pricing, gaps, channels
├── build_product.py                   ← Script that consolidates prompts into master source
├── build_pdf.py                       ← Script that converts master source to PDF
└── listings/                          ← Agent-generated alt copy (kept for reference)
    └── FINAL-LISTING-COPY.md
```

---

## Ship-It Checklist (In Order)

### Step 1: Review the product (~20 minutes)

- [ ] Open `product-files/150-etsy-prompts.pdf` and read the intro + first 2 sections
- [ ] Run 3-5 prompts from the pack in ChatGPT yourself (use your own shop's data). Verify they produce useful output.
- [ ] Adjust any prompt that doesn't quite fit how you'd use it. (Optional — most sellers won't customize.)

### Step 2: Cover image — ALREADY DONE for you

The cover, thumbnail, and 2 Pinterest pins are auto-generated and sitting in `product-files/`. Open each PNG to preview — they should be upload-ready as-is.

- [ ] Preview `product-files/cover-gumroad.png` — verify it looks good
- [ ] Preview `product-files/thumbnail-etsy.png` — verify it looks good
- [ ] Preview the 2 Pinterest pins

If you want to customize (different colors, your own text, etc.), edit the source HTML in `assets/` and re-render via Chrome headless — see `marketing/assets-deploy-guide.md`.

### Step 3: Set up the Gumroad listing (~30 minutes)

- [ ] Create a Gumroad account (free) if you don't have one
- [ ] Copy content from `marketing/gumroad-listing.md`
- [ ] Upload `product-files/150-etsy-prompts.pdf` as the deliverable
- [ ] Set price: $24 for Tier 1 (personal use). Optionally add Tier 2 ($67 PLR) and Tier 3 ($97 MRR).
- [ ] Add the cover image
- [ ] Publish

### Step 4: Set up the Etsy listing (~30 minutes, OPTIONAL)

- [ ] Open `marketing/etsy-listing.md` — has the verified 140-char title, 13 tags, description
- [ ] Note: Etsy price should be **$14.99** (per the listing analysis), positioned as a discovery funnel to the Gumroad $24 product
- [ ] **Important:** Confirm Etsy Payments supports your country. If not, skip Etsy and focus 100% on Gumroad.
- [ ] Upload the Etsy thumbnail (2000×2000) + 5 listing photos
- [ ] Add the cover image alt-text from the listing file
- [ ] Publish

### Step 5: Run the launch plan (start Day 1)

- [ ] Open `marketing/launch-plan.md` — full 14-day calendar with day-by-day actions
- [ ] Day 1 actions: list on Gumroad + Etsy, post Template A on r/EtsySellers (~2 hours)
- [ ] Follow the day-by-day calendar: Reddit, X/Twitter, Pinterest, cold DMs

### Step 6: Track and iterate

- [ ] Set up a Google Sheet to track visits, sales, conversion, top source
- [ ] Week 1: expect 0-3 sales (this is normal)
- [ ] Week 2: 3-8 sales if Week 1 was active
- [ ] Month 1: 15-40 sales total if you keep posting
- [ ] If 0 sales at Day 14, see "Failure Recovery Plan" in `launch-plan.md`

---

## What's Built vs. What You Need to Do

| Component | Built for you | You do |
|---|---|---|
| 150 prompts | ✅ Done | Review & customize if desired |
| 6-phase workflow intro | ✅ Done | (none) |
| PDF | ✅ Generated | (none — file is ready) |
| Gumroad listing copy | ✅ Done | Paste into Gumroad, upload PDF |
| Etsy listing copy | ✅ Done | Paste into Etsy, add images |
| Launch plan | ✅ Done | Execute day-by-day |
| Cover images | ✅ Done (auto-rendered to PNG) | Optional: customize via Canva or edit HTML in `assets/` |
| Account setup (Gumroad, Etsy) | Not done | Create accounts (~15 min) |
| First posts (Reddit, X) | Templates done | Customize and post (~2 hours) |

**Estimated time to first sale: 2-7 days** if you execute Day 1 of the launch plan.

---

## Pricing Strategy (Summary)

| Channel | Price | Why |
|---|---|---|
| **Gumroad** (primary revenue) | $24 | Top of the proven $13-25 quality prompt pack band. PLR ($67) and MRR ($97) tiers available. |
| **Etsy** (SEO discovery funnel) | $14.99 | Top of the proven Etsy range ($0.75-$14.67). Below the $15 ceiling that protects click-through. |
| **Free tier** (optional, for lead gen) | $0 | 30-prompt sampler PDF, given away on Reddit/IG/X to build an email list. See `launch-plan.md` failure recovery. |

Gumroad is your main revenue. Etsy is a discovery layer that funnels buyers to Gumroad (Etsy buyers shop on Etsy — let them, but capture them).

---

## What I Did Differently Than "Just Write 150 Prompts"

The competitor research surfaced 5 differentiators that no existing prompt pack has. I built all 5 into this product:

1. **Positioned as a system, not a list.** The 6-phase workflow is the heart. Run the workflow, the prompts become powerful. Skip it and you get the same mediocre results.
2. **Updated for Etsy's 2026 algorithm.** LLM-based ranking, AI disclosure requirements, ChatGPT referral traffic, mobile-first rendering, customer experience signals. Section 09 has prompts for all of this.
3. **Diagnosis prompts.** The #1 Etsy seller complaint ("my listing has views but no sales") has 5 dedicated diagnosis prompts in Section 09. No competitor has this.
4. **Etsy's hard constraints baked in.** Tags enforce the 20-char limit and the no-repeat-words rule. Titles enforce the 140-char limit. Every prompt respects Etsy's actual product, not generic SEO advice.
5. **Brand voice system.** The intro teaches you to lock in your voice once, then paste it into every prompt. The direct fix for the #1 AI-output complaint ("it sounds like a robot").

---

## Honest Caveats (What Could Go Wrong)

- **First sale may take longer than 7 days.** Most $0-budget launches need 14-30 days to gain traction. Don't quit at Day 7 if sales are zero.
- **Etsy may not work for your country.** Etsy Payments has country restrictions. If you're in an unsupported country (e.g., based on the research findings, Taiwan sellers can't onboard as of 2026), skip Etsy and go Gumroad-only.
- **The cover image matters more than the listing copy.** Buyers buy the cover before they read the description. Spend real time on the Canva design.
- **Discounting trains buyers to wait.** Don't drop the price unless you've tested the description/cover first. Most "low sales" problems are copy/positioning problems, not price problems.
- **The 2026 algorithm references may become outdated.** Etsy's algorithm changes every few months. Plan to refresh the diagnosis prompts (Section 09) every 6 months.

---

## What to Do Right Now

If you have 30 minutes today:

1. Open `product-files/150-etsy-prompts.pdf` — read the intro + skim 3 sections. Make sure the prompts feel usable to you.
2. Preview the cover, thumbnail, and 2 pins in `product-files/` — they're ready to upload as-is.
3. Open `marketing/gumroad-listing.md` — copy the hero section + description into a text file. Have it ready for when your Gumroad account is set up.

If you have 2 hours today:

1. Do the above
2. Set up the Gumroad account, paste the listing, upload the PDF, publish
3. Make the cover image (or close to it)
4. Start Day 1 of `marketing/launch-plan.md`

---

## Support Files (When You Need Them)

- **Stuck on prompt wording?** Re-read the prompt's "Use when" line. If still unclear, the prompt is doing too much — split it into 2 runs.
- **Stuck on Etsy SEO?** Section 03 + Section 09 (P09-002, P09-013) cover Etsy search ranking specifically.
- **Stuck on the launch?** `launch-plan.md` has a Day 7 failure recovery section.
- **Stuck on cover design?** `cover-image-spec.md` has color codes, fonts, layout.
- **Stuck on whether to keep going?** Section 09, P09-015: "Should I Stay or Quit" decision framework.

---

**You have everything you need. The product is built. The plan is built. The rest is execution.**

**Go.**
