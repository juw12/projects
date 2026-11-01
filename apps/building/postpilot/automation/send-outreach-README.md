# PostPilot Outreach Email Automation

This script reads your prospect CSV, generates a personalized email for each prospect using the DM template that matches them, and sends them via your existing Gmail relay.

## What this does

For each prospect in your CSV:
1. Reads their name, niche, trigger event, and template number
2. Looks up the matching email template from `outreach/01-cold-dms.md`
3. Personalizes the template with their info
4. Sends the email via your Gmail relay
5. Marks the prospect as `sent` in the CSV

## Setup (one time)

1. **Add your Gmail relay URL** to `automation/relay-config.txt`:
   - Open that file
   - Paste your Gmail relay Web App URL on the first line
   - Save

2. **Fill the prospects CSV** with real people:
   - Open `automation/prospects.csv`
   - Replace the fictional names with real prospects
   - Add their real email addresses
   - Update `template` column to match (1-10)

3. **Run the script**:
   ```powershell
   .\send-outreach.ps1
   ```

## What this CANNOT do

- Get past spam filters if you send too many at once (limit: 5-10 per day)
- Send from a real LinkedIn account (this is email only)
- Handle replies (you still need to read and respond)

## Rate limits

The script defaults to 1 email per minute (configurable). Sending too fast triggers Gmail spam filters and your relay gets rate-limited.

For the first week: 5-10 emails/day. After 2 weeks: ramp to 20-30/day if your reply rate stays >5%.

## Safety features

- Never sends to a prospect marked `sent`, `won`, `lost`, or `replied`
- Logs every send to `automation/send-log.txt`
- Skips prospects with empty email field
- Dry-run mode available: `.\send-outreach.ps1 -DryRun`
