# File 06 — Tracking Sheet

A simple spreadsheet to track every DM, reply, call, and conversion. Copy the table below into Google Sheets.

---

## The columns

| Date | Channel | Person/Post | Type | Status | Notes |
|---|---|---|---|---|---|
| 2026-11-02 | LinkedIn DM | Jane Smith | Warm | Sent | Founder pricing sent in reply |
| 2026-11-02 | LinkedIn DM | John Doe | Warm | Replied | Call scheduled 11/4 |
| 2026-11-03 | Reddit | r/entrepreneur post | Community | Posted | 12 comments, 3 DMs |
| 2026-11-04 | Discovery call | Jane Smith | Call | Won | Founder Growth tier, $99 |
| 2026-11-04 | Discovery call | Bob Lee | Call | Lost | "Need to think" |

**Status options:**
- `Sent` — DM went out, no reply yet
- `Replied` — they responded (any response)
- `Call` — discovery call scheduled or completed
- `Won` — paid
- `Lost` — said no or went silent
- `Follow-up` — sent the 3-day follow-up

**Type options:**
- `Warm` — connection or referral
- `Cold` — pure stranger outreach
- `Community` — engagement post
- `Referral` — came via warm intro

**Channel options:**
- LinkedIn DM, Twitter DM, Email, Reddit DM, Slack/Discord, Community post, Discovery call

---

## The 3 formulas to compute

Copy these into Google Sheets cells:

### Reply rate
```
=COUNTIF(F:F,"Replied") / COUNTIFS(F:F,"Sent",B:B,"LinkedIn DM")
```
Tells you: of all LinkedIn DMs sent, what % got replies.

### Call rate (of people who replied)
```
=COUNTIF(F:F,"Call") / COUNTIF(F:F,"Replied")
```
Tells you: of replies, what % turned into calls.

### Conversion rate
```
=COUNTIF(F:F,"Won") / COUNTIF(F:F,"Call")
```
Tells you: of calls, what % became paying customers.

---

## Daily dashboard

Add a small section at the top of your sheet:

| Metric | Today | Week Total | Goal | Status |
|---|---|---|---|---|
| DMs sent | 12 | 47 | 30/day | 🟡 |
| Replies | 3 | 11 | 15% reply rate | 🟢 |
| Calls | 1 | 4 | 5/week | 🟡 |
| New clients | 1 | 2 | 5 in 14 days | 🟢 |
| Revenue | $99 | $198 | — | — |

---

## What to track weekly

Every Sunday, add a row:

| Week | DMs Sent | Reply % | Calls | Conversion % | Revenue | Lessons |
|---|---|---|---|---|---|---|
| W1 | 78 | 14% | 5 | 20% | $198 | DM 5 (free sample) converts best |
| W2 | 102 | 18% | 8 | 38% | $446 | DM 7 (event trigger) underperformed |

**The "Lessons" column is the most important one.** Patterns only show up over weeks. Write down what you noticed.

---

## When to stop tracking and start scaling

After 100 DMs and 5+ paying clients, you have signal. Stop tweaking the tracking and start:

1. Sending 50 DMs/day (or hire a VA to help)
2. Posting in more communities
3. Testing paid channels (after you have ROI proof from organic)

---

## What NOT to track (yet)

- "Impressions" on community posts (vanity)
- "Engagement rate" (only matters once you have 1k+ followers)
- "Brand awareness" (unmeasurable at your stage)
- "Pipeline value" (you don't have a pipeline yet)

Track: did they reply, did they call, did they pay. That's it.
