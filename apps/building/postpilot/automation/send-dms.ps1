# PostPilot Day 2-7 — Batch DM Sender

This script helps you send DMs faster by:
1. Reading prospects from a CSV
2. Generating personalized messages from templates
3. Opening Gmail compose with the message pre-filled
4. Logging who you've messaged

## Setup (one time)

1. Create a CSV file at `automation/prospects.csv` with these columns:

```
name,niche,context,template,status
Jane Smith,Sales coaching for B2B SaaS,just posted about pricing fractional offers,pain,pending
```

Columns explained:
- `name` — their first name (used in the DM)
- `niche` — what they do (used for personalization)
- `context` — a specific recent thing they did (post, milestone, event)
- `template` — which DM template to use (1-10, see below)
- `status` — `pending` / `sent` / `replied` / `won` / `lost`

2. Fill in 10-30 rows with prospects from your network

3. Run this script:
```powershell
.\send-dms.ps1
```

The script will:
- Read the first 10 pending prospects
- For each, generate a personalized DM using the chosen template
- Open Gmail compose with the message pre-filled
- You review, attach any sample, hit Send
- Script marks the row as `sent` in the CSV

## DM template numbers

| # | Template | Best for |
|---|---|---|
| 1 | Pain-point opener | People who recently vented about LinkedIn |
| 2 | Compliment + soft pitch | People who post regularly but inconsistently |
| 3 | Social proof lead | When you have a client stat to share |
| 4 | Contrarian hook | General cold outreach |
| 5 | Free value first | Highest conversion — give a sample post |
| 6 | Question opener | No context on them, just a connection |
| 7 | Event-trigger | They just launched/raised prices/posted a win |
| 8 | Referral ask | Came via warm intro |
| 9 | Direct offer with risk reversal | Confident pitch |
| 10 | Voice-mimicry sample | You made a sample post for them |

See `../outreach/01-cold-dms.md` for the full templates.

## What this script CANNOT do

- Log into your LinkedIn automatically (LinkedIn blocks automation and bans accounts)
- Send the DM for you (you still need to hit Send)
- Verify the prospect is a real person (you need to do that when filling the CSV)

What it CAN do:
- Open Gmail compose with a personalized message
- Track who you've messaged
- Remind you to follow up after 3 days
- Generate sample posts using the prompt system (if you paste in their last post)

## If LinkedIn is your main channel

This script uses Gmail because it's safer. For LinkedIn DMs:
1. Open LinkedIn in your browser
2. Find each prospect
3. Copy the generated message from the CSV column
4. Paste it manually

It's slower but won't get your account banned.
