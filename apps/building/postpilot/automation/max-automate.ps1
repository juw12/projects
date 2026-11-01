# PostPilot Maximum Automation Script
# Opens URLs, pre-fills clipboard, walks you through setup

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Open($url) {
    Write-Host "  Opening: $url" -ForegroundColor Cyan
    Start-Process $url
    Start-Sleep -Milliseconds 800
}

function Copy($text) {
    Write-Host "  Copied to clipboard (paste with Ctrl+V)" -ForegroundColor Yellow
    Set-Clipboard -Value $text
}

function Prompt($msg) {
    Write-Host ""
    Write-Host ">>> $msg" -ForegroundColor Green
    Write-Host ">>> Press Enter when done to continue..." -ForegroundColor Green
    Read-Host
}

# Step 1: Open Gumroad signup
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PostPilot Maximum Automation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "I'll open URLs and pre-fill your clipboard at each step." -ForegroundColor Gray
Write-Host "You'll do the human parts (sign up, password, etc.)" -ForegroundColor Gray
Write-Host ""

# Step 1: Pre-fill Gumroad product 1
Write-Host "STEP 1 OF 5: Sign up for Gumroad" -ForegroundColor Yellow
Copy "PostPilot Starter — 3 on-brand LinkedIn posts every week"
Open "https://gumroad.com/signup"
Prompt "Sign up for Gumroad. Use any email. Verify your email. When you're logged in, press Enter."

# Step 2: Connect Stripe for payouts
Write-Host "STEP 2 OF 5: Connect Stripe for payouts" -ForegroundColor Yellow
Copy "PostPilot — AI LinkedIn ghostwriting for B2B coaches"
Open "https://gumroad.com/settings/payouts"
Prompt "Click 'Connect with Stripe' and complete Stripe setup. When payouts are connected, press Enter."

# Step 3: Create Product 1
Write-Host "STEP 3 OF 5: Create Product 1 (Starter)" -ForegroundColor Yellow
Copy @"
PostPilot Starter — 3 on-brand LinkedIn posts every week

3 on-brand LinkedIn posts every week. You just hit publish.

For B2B coaches and consultants who'd rather coach than write.

What you get:
- Voice training on 5-10 of your past posts (one-time, 10 minutes)
- 3 ready-to-post drafts delivered every Monday at 9am
- Unlimited revisions in your first month to dial in the voice
- Cancel anytime — no contract, no forms

First month free if you don't love it. Founder offer: first 5 clients get 50% off.

The first posts land next Monday after you onboard.
"@
Open "https://gumroad.com/products/new"
Prompt "Click '+ New Product' → 'Product'. Paste the title. Set price to `$49. Paste the description. Click Save. When Product 1 is created and you have its URL, copy it to a notepad, then press Enter."

# Step 4: Create Product 2
Write-Host "STEP 4 OF 5: Create Product 2 (Growth)" -ForegroundColor Yellow
Copy @"
PostPilot Growth — 5 LinkedIn posts/week + engagement replies

5 on-brand LinkedIn posts every week + 5 weekly engagement replies on relevant posts in your niche. The presence of a full-time ghostwriter, the cost of a Netflix subscription.

For B2B coaches and consultants who want presence plus conversations.

Everything in Starter, plus:
- 2 additional posts per week (5 total)
- 5 engagement replies/week (we draft replies in your voice on posts your audience sees)
- Monthly content audit (what's working, what to adjust)
- Unlimited revisions on all posts

First month free if you don't love it. Founder offer: first 5 clients get 50% off.

The first posts land next Monday after you onboard.
"@
Prompt "Repeat for Product 2. Title is already in clipboard. Description is in clipboard. Set price to `$99. Save. Copy the URL to your notepad. Press Enter when done."

# Step 5: Create Product 3
Write-Host "STEP 5 OF 5: Create Product 3 (Scale)" -ForegroundColor Yellow
Copy @"
PostPilot Scale — Daily LinkedIn + comment engine + monthly strategy

Daily on-brand LinkedIn posts + a weekly comment engine + monthly content strategy call. For agencies and high-ticket coaches running outbound.

For B2B coaches, consultants, and agencies ready to make LinkedIn their #1 channel.

Everything in Growth, plus:
- Daily post (7/week instead of 5)
- Comment engine (10 thoughtful comments/week on relevant posts in your niche)
- Voice training + topic strategy (we plan your content calendar quarterly)
- Monthly 30-minute strategy call (review performance, plan next month)

First month free if you don't love it. Founder offer: first 5 clients get 50% off.

The first posts land next Monday after you onboard.
"@
Prompt "Repeat for Product 3. Set price to `$199. Save. Copy the URL to your notepad. Press Enter when done."

# Step 6: Paste URLs into HTML
Write-Host "STEP 6 OF 5: Paste URLs into your landing page" -ForegroundColor Yellow
$htmlPath = Join-Path $root "landing/index.html"
Open $htmlPath
Copy "#start"
Prompt "Your landing page HTML is open. Press Ctrl+H. Find: `#start`. Replace with your Starter URL. Replace 6 total occurrences: nav, hero, pricing tier 1, pricing tier 2, pricing tier 3, final CTA. Save. Press Enter when done."

# Step 7: Deploy to Netlify
Write-Host "STEP 7 OF 5: Deploy to Netlify" -ForegroundColor Yellow
$landingFolder = Join-Path $root "landing"
explorer $landingFolder
Open "https://app.netlify.com/drop"
Prompt "Drag the landing folder (which just opened) onto the Netlify Drop tab. Copy the public URL Netlify gives you. Press Enter when done."

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Day 0 Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Your site is live. Your payments work. Your AI is ready." -ForegroundColor White
Write-Host ""
Write-Host "Next: open outreach/03-7-day-action-plan.md and start Day 1." -ForegroundColor Yellow
Write-Host ""
Write-Host "Press any key to close..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
