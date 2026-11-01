# PostPilot Day 0 — One-Command Setup

Run this ONE script and Day 0 is done.

## What this script does

1. Asks you 5 questions (your name, brand color, contact email, niche, time zone)
2. Customizes EVERY file in the kit with your info (landing page, email templates, prompts)
3. Opens every URL you need to sign up for (Google AI Studio, Stripe, Gumroad, Netlify Drop, Google Sheets)
4. Opens the files you need to read
5. Tells you the next 3 manual steps

## How to run

1. Open PowerShell (right-click Start → "Windows PowerShell" or "Terminal")
2. Copy and paste this one command:

```powershell
irm https://raw.githubusercontent.com/yourusername/yourrepo/main/postpilot-launch/automation/day0-setup.ps1 | iex
```

(That's the one-time command. Once you have this file locally, you can also just run `.\day0-setup.ps1` from the `automation` folder.)

3. Answer the 5 questions when prompted
4. Let it open the URLs and customize the files
5. Sign up for the accounts it opens (Google, Stripe, etc.)

## What you do manually

Even after this script runs, you still need to:
1. Click "Sign up" on each website it opens
2. Drag the customized `landing` folder to Netlify Drop
3. Copy your Stripe/Gumroad product links back into the HTML

The script can't do those because they require your accounts.

## What's automated

- File customization (your name, color, email, niche in all the right places)
- All URLs open in your default browser
- Tracking sheet template ready
- Email templates pre-filled with your name

## What's NOT automated (and can't be)

- Account creation (Google/Stripe/Gumroad/Netlify)
- Real money collection (Stripe/Gumroad)
- Sending DMs from your LinkedIn
- Discovery calls with prospects

For those, you still need to be the human in the loop. The script just removes every ounce of friction between you and "ready to send."

## If the script doesn't work

If the `irm` command fails, do this:

1. Save the script from the `automation/` folder to your Desktop
2. Right-click the saved file → "Run with PowerShell"
3. If Windows asks about execution policy, run this first:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   ```
4. Then run the script again.

## After Day 0

Once Day 0 is done, come back here:

- **Day 1-7**: Use `outreach/03-7-day-action-plan.md` (or use `automation/send-dms.ps1` to batch the work)
- **Stuck?**: Tell me what happened. I'll diagnose.
