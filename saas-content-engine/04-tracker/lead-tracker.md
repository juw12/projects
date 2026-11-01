# Lead Tracker Template

Copy these headers into Google Sheets, Notion, or Airtable. Add a row for every outreach.

## Column Headers

| Column | What to put there | Example |
|---|---|---|
| **Date Sent** | Day you sent the email / proposal | 2026-11-04 |
| **Company** | Company name | PostHog |
| **Contact Name** | Person you emailed | James Smith |
| **Contact Role** | Their title | Head of Marketing |
| **Email / LinkedIn** | Where you reached them | james@posthog.com |
| **Source** | How you found them | LinkedIn search |
| **Pitch Angle** | The angle from the target list | "PostHog vs Mixpanel comparison" |
| **Platform** | Fiverr / Upwork / Cold Email / LinkedIn | Cold Email |
| **Template Used** | Which email/proposal template | Email 7 (PostHog) |
| **Status** | Sent / Replied / No Reply / Call / Won / Lost | Sent |
| **Reply Date** | When they responded | 2026-11-08 |
| **Reply Type** | Interested / Not now / No / Wrong person | Interested |
| **Next Action** | What you'll do | Send portfolio, propose trial |
| **Action Due Date** | When you'll do it | 2026-11-09 |
| **Project Value** | Dollar amount if won | $600 |
| **Notes** | Anything relevant | Mentioned they're hiring content team |

## Status Values (use these exactly)

- `Sent` — email/proposal sent, no reply yet
- `Replied` — they responded (update to next status)
- `Interested` — positive reply, in conversation
- `Call Booked` — meeting scheduled
- `Proposal Sent` — you sent a custom proposal with pricing
- `Won` — they paid / contract signed
- `Lost` — they said no or ghosted after 30+ days
- `Not Now` — explicit "not right now" (follow up in 60-90 days)

## Sample Row (Filled In)

```
2026-11-04 | PostHog | James Smith | Head of Marketing |
james@posthog.com | LinkedIn | PostHog vs Mixpanel comparison |
Cold Email | Email 7 | Sent | | | Send portfolio |
2026-11-09 | $600 | Mentioned hiring content team
```

## Pipeline View (sort your tracker by Status)

You should always see:

| Status | Healthy count | Red flag |
|---|---|---|
| `Sent` | 20+ at any time | Below 10 = not enough outreach |
| `Replied` | 5+ per week | Below 5/week = pitch needs work |
| `Interested` | 3-5 active | Below 2 = niche or pricing issue |
| `Won` | Growing month over month | Flat = retention problem |

## Weekly Review Ritual (every Sunday, 20 min)

1. **Count rows by Status** — are you sending enough? (Target: 35+ outreach/week)
2. **Look at Lost reasons** — patterns? Pricing too high? Wrong contact? Generic pitch?
3. **Double down on what's working** — which template / niche / company size converts best?
4. **Plan next week's outreach** — 35 new rows minimum

## Tools to Build This In

- **Google Sheets** — fastest, free, shareable with collaborators later
- **Notion** — best if you want a database view with filters + gallery views
- **Airtable** — best if you plan to add automations later (auto-emails via Zapier)
- **HubSpot CRM (free tier)** — overkill now but useful when you hit 5+ clients
