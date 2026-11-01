# PostPilot — Maximum Automation Script

This script opens every URL you need, copies every text you need to paste, and gives you one checklist to follow. It cannot click "Sign up" for you, but it makes the manual steps as fast as possible.

## What gets automated
- Opens 8 URLs in the right order
- Copies every product description to your clipboard (ready to paste into Gumroad)
- Opens every file you need to read
- Walks you through 5 manual checkpoints with exact instructions

## What CANNOT be automated (no AI can)
- Typing your password
- Entering your credit card
- Clicking "I agree to terms" (legal requirement for YOU to consent)
- Sending DMs from your LinkedIn (LinkedIn bans bot accounts)
- Discovery calls (you're the human, the prospect is the human)

## Run it

```powershell
# From the postpilot-launch folder:
.\automation\max-automate.ps1
```

The script will:
1. Copy the Gumroad Product 1 title to your clipboard → opens Gumroad signup
2. You sign up (manual)
3. Script copies Product 1 description → you paste into Gumroad
4. Repeats for Products 2 and 3
5. Copies the HTML find/replace instructions
6. Opens Netlify Drop
7. Done
