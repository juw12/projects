# PostPilot — Complete Launch Kit

You're going to sell AI-written LinkedIn ghostwriting to B2B coaches and consultants. $99-399/month. Goal: 5 paying clients in 14 days.

Everything you need is in this folder.

## What's in here

```
postpilot-launch/
├── README.md                  ← you are here (start here)
├── landing/
│   ├── index.html             ← your website (single file, drag-and-drop deploy)
│   └── DEPLOY.md              ← how to put the website online for free in 60 seconds
├── prompts/
│   ├── README.md              ← how to use the prompt system
│   ├── 00-voice-calibration.md ← run once per new client
│   ├── 01-weekly-generator.md  ← run every Monday per client
│   ├── 02-few-shot-examples.md ← reference examples
│   ├── 03-quality-check.md     ← run before delivering to client
│   ├── 04-test-run.md          ← worked example with a fake client
│   └── 05-email-templates.md   ← client lifecycle emails (welcome, weekly, testimonial)
├── outreach/
│   ├── README.md              ← 7-day plan overview
│   ├── 00-buyer-profile.md    ← who to sell to and where to find them
│   ├── 01-cold-dms.md         ← 10 copy-paste DM templates
│   ├── 02-community-posts.md  ← 5 platform-specific posts
│   ├── 03-7-day-action-plan.md ← day-by-day checklist
│   ├── 04-objection-handling.md ← top 5 objections + responses
│   ├── 05-founder-pricing.md  ← the "first 5 clients" offer
│   ├── 06-tracking-sheet.md   ← spreadsheet template + formulas
│   └── 07-sample-dms.md       ← 10 fully-written "done" examples
└── automation/
    ├── README.md              ← what the automation scripts do
    ├── day0-setup.ps1         ← ONE-COMMAND Day 0 setup (run this first)
    ├── send-dms.ps1           ← batch DM helper for Days 2-7
    └── prospects.csv          ← 10-row template + 20 blank slots
```

---

## Day 0 — Get set up (45 minutes)

### The fast way (recommended)

Run **ONE command** in PowerShell. It does 80% of Day 0 for you.

```powershell
# From the postpilot-launch folder:
.\automation\day0-setup.ps1
```

It will:
- Ask you 5 questions (name, color, email, niche, timezone)
- Customize every file with your info
- Open every sign-up URL you need (Google AI Studio, Stripe, Gumroad, Netlify, Google Sheets)
- Open the key docs for you to read

After it finishes, you do 4 small manual steps (sign up + replace links + drag to Netlify).

### The slow way (if you don't want to run the script)

Open `automation/README.md` → it walks you through manually.

Either way, you end at the same place: working AI, live site, real payments, tracking sheet.

---

## Day 1-7: Get customers

Open `outreach/README.md` and `outreach/03-7-day-action-plan.md`. Follow them exactly.

The TL;DR:

| Day | What you do | Time |
|---|---|---|
| Day 1 | List 30 prospects, set up payments | 90 min |
| Day 2 | Send 10 DMs + 1 community post | 90 min |
| Day 3 | Send 10 cold DMs + 1 community post | 90 min |
| Day 4 | Follow-ups + community engagement | 75 min |
| Day 5 | Discovery calls | 90 min |
| Day 6 | Send founder offers | 60 min |
| Day 7 | Onboard first clients + retrospective | 90 min |

Use `outreach/01-cold-dms.md` for the messages. Use `outreach/04-objection-handling.md` when prospects push back. Use `outreach/05-founder-pricing.md` when it's time to close.

---

## Day 7+: Deliver the service

When someone pays:
1. Send them the onboarding form (in `prompts/README.md`)
2. Get their voice samples back (5-10 posts)
3. Run `prompts/00-voice-calibration.md` → save the output as `[clientname]-voice.md`
4. Every Monday: run `prompts/01-weekly-generator.md` with their voice profile + topics
5. Run `prompts/03-quality-check.md` on each post
6. Send them 3 polished posts
7. They approve, edit, or ask for changes
8. After month 1, ask for testimonial (use template in `outreach/05-founder-pricing.md`)

---

## What success looks like

### Day 7
- 30+ DMs sent
- 5+ discovery calls
- 1-3 paying clients
- First weekly posts delivered

### Day 14
- 5 paying clients
- 4-5 testimonials
- Real data on which offer works
- Decision: scale (more outreach, raise prices, hire VA) or pivot (different niche, different offer)

### Day 30
- $500-2000/mo recurring revenue
- Refined voice profile per client
- 2-3 case studies
- Either: keep growing OR you've learned this isn't the right product and you know exactly what to build next

---

## If nothing happens

Read `outreach/03-7-day-action-plan.md` → section "Stop conditions." Most likely issues:

| Symptom | Fix |
|---|---|
| Reply rate < 5% after 30 DMs | Use DM 5 (free sample) instead of DM 1 |
| Calls booked but no conversion | Re-read `outreach/04-objection-handling.md` |
| "Let me think" replies | Strengthen risk reversal — read `outreach/05-founder-pricing.md` |
| No one replying at all | Your targeting is off — re-read `outreach/00-buyer-profile.md` |

Don't panic until Day 14. Day 7 with 0 clients is fine. Day 14 with 0 clients = the offer needs adjustment.

---

## What NOT to do

- **Don't build a more complex product first.** You can add features after you have 5 paying customers.
- **Don't run paid ads yet.** No data, no money. Organic first.
- **Don't add a blog, podcast, or YouTube channel.** Stay focused on outreach.
- **Don't change the offer mid-week.** Send 30 DMs before changing anything.
- **Don't tell prospects AI is involved secretly.** Be transparent.
- **Don't refund someone who's just confused.** Explain first. Then refund if needed.
- **Don't quit before Day 14.** Most give up on Day 5.

---

## The actual hard parts (not what you think)

1. **Sending the first DM.** It's awkward. Send it anyway. DM 5 (free value) is the easiest to start with.
2. **Asking for the sale.** "Want to lock in [PLAN]?" — direct. Don't hint.
3. **Asking for the testimonial.** Most clients will say yes if you write the first draft.

The product is easy. The sending and asking is the work.

---

## When to come back to me

If after Day 14 you have:
- 5+ clients → I'll help you scale (raise prices, add automation, hire help)
- 1-3 clients → I'll help you diagnose what's blocking conversion
- 0 clients → I'll help you pivot the offer (different niche, different promise)

Save your tracking sheet and your DMs. The patterns are in the data.

Go.
