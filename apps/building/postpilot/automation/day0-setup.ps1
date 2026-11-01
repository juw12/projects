# PostPilot Day 0 Setup Script
# One-command setup: customize files + open every URL you need

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PostPilot Day 0 Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "I'll ask 5 questions, then customize every file and open the URLs you need." -ForegroundColor Gray
Write-Host ""

# Question 1: Your name
$name = Read-Host "1/5  Your name (used in emails, page footer)"
if ([string]::IsNullOrWhiteSpace($name)) { $name = "Your Name" }

# Question 2: Brand color
Write-Host ""
Write-Host "2/5  Brand color (hex code, e.g., #F97316 is orange. Default = #F97316)" -ForegroundColor Gray
$color = Read-Host "    Press Enter to use default"
if ([string]::IsNullOrWhiteSpace($color)) { $color = "#F97316" }
if (-not $color.StartsWith("#")) { $color = "#" + $color }

# Question 3: Contact email
Write-Host ""
$email = Read-Host "3/5  Contact email (shown on landing page footer)"
if ([string]::IsNullOrWhiteSpace($email)) { $email = "hello@postpilot.example" }

# Question 4: Niche focus
Write-Host ""
Write-Host "4/5  Your niche focus (e.g., 'Sales coaching for fractional CROs')" -ForegroundColor Gray
$niche = Read-Host "    Press Enter to use default ('B2B coaches and consultants')"
if ([string]::IsNullOrWhiteSpace($niche)) { $niche = "B2B coaches and consultants" }

# Question 5: Time zone
Write-Host ""
Write-Host "5/5  Your IANA timezone (e.g., America/New_York, Europe/London, Asia/Tokyo)" -ForegroundColor Gray
$tz = Read-Host "    Press Enter to use default (UTC)"
if ([string]::IsNullOrWhiteSpace($tz)) { $tz = "UTC" }

Write-Host ""
Write-Host "Customizing files..." -ForegroundColor Yellow

# Customize landing page
$landingPath = Join-Path $root "landing/index.html"
if (Test-Path $landingPath) {
    $html = Get-Content $landingPath -Raw
    $html = $html -replace "#F97316", $color
    $html = $html -replace "hello@postpilot\.example", $email
    $html = $html -replace "© 2026 PostPilot", "© 2026 PostPilot, by $name"
    Set-Content -Path $landingPath -Value $html -NoNewline
    Write-Host "  [OK] Landing page updated with your color and email" -ForegroundColor Green
}

# Customize email templates
$emailTemplatesPath = Join-Path $root "prompts/05-email-templates.md"
if (Test-Path $emailTemplatesPath) {
    $tpl = Get-Content $emailTemplatesPath -Raw
    $tpl = $tpl -replace "\[YOUR NAME\]", $name
    Set-Content -Path $emailTemplatesPath -Value $tpl -NoNewline
    Write-Host "  [OK] Email templates signed with your name" -ForegroundColor Green
}

# Customize README
$readmePath = Join-Path $root "README.md"
if (Test-Path $readmePath) {
    $readme = Get-Content $readmePath -Raw
    $readme = $readme -replace "9am \[YOUR TIMEZONE\]", "9am $tz"
    Set-Content -Path $readmePath -Value $readme -NoNewline
    Write-Host "  [OK] README updated with your timezone" -ForegroundColor Green
}

# Save your settings for future reference
$settingsPath = Join-Path $root "automation/my-postpilot-config.txt"
@"
PostPilot — Your Settings
=========================
Name: $name
Brand color: $color
Contact email: $email
Niche: $niche
Timezone: $tz
Configured: $(Get-Date -Format "yyyy-MM-dd HH:mm")

If you ever need to re-customize, edit this file or re-run day0-setup.ps1
"@ | Set-Content -Path $settingsPath
Write-Host "  [OK] Settings saved to automation/my-postpilot-config.txt" -ForegroundColor Green

Write-Host ""
Write-Host "Opening the URLs you need to sign up for..." -ForegroundColor Yellow
Write-Host ""

# URLs to open in browser
$urls = @(
    @{url="https://aistudio.google.com"; desc="Google AI Studio (free AI)"}
    @{url="https://dashboard.stripe.com/register"; desc="Stripe (payments)"}
    @{url="https://gumroad.com/signup"; desc="Gumroad (alt payments)"}
    @{url="https://app.netlify.com/drop"; desc="Netlify Drop (free hosting)"}
    @{url="https://sheets.new"; desc="Google Sheets (tracking)"}
    @{url="https://www.linkedin.com"; desc="LinkedIn (DMs to prospects)"}
)

foreach ($item in $urls) {
    Write-Host "  Opening: $($item.desc)" -ForegroundColor Cyan
    Start-Process $item.url
    Start-Sleep -Milliseconds 800
}

Write-Host ""
Write-Host "Opening the files you need to read..." -ForegroundColor Yellow
Write-Host ""

# Open key files
$filesToOpen = @(
    "README.md"
    "prompts/04-test-run.md"
    "landing/DEPLOY.md"
    "outreach/01-cold-dms.md"
    "outreach/03-7-day-action-plan.md"
)

foreach ($f in $filesToOpen) {
    $p = Join-Path $root $f
    if (Test-Path $p) {
        Write-Host "  Opening: $f" -ForegroundColor Cyan
        Start-Process $p
        Start-Sleep -Milliseconds 500
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Day 0 setup complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "What's automated:" -ForegroundColor Yellow
Write-Host "  - Files customized with your name, color, email" -ForegroundColor White
Write-Host "  - 6 sign-up URLs opened in your browser" -ForegroundColor White
Write-Host "  - 5 key files opened for you to read" -ForegroundColor White
Write-Host ""
Write-Host "What you do manually (about 30 min):" -ForegroundColor Yellow
Write-Host "  1. Sign up for Google AI Studio (free, just need Google account)" -ForegroundColor White
Write-Host "  2. Sign up for Stripe OR Gumroad (pick one)" -ForegroundColor White
Write-Host "  3. In landing/index.html, replace 4 occurrences of href=""#start""" -ForegroundColor White
Write-Host "     with your real Stripe/Gumroad checkout link" -ForegroundColor White
Write-Host "  4. Drag the 'landing' folder onto the Netlify Drop tab it just opened" -ForegroundColor White
Write-Host "  5. Copy the tracking sheet template from outreach/06-tracking-sheet.md" -ForegroundColor White
Write-Host "     into your new Google Sheet" -ForegroundColor White
Write-Host ""
Write-Host "After all that, you're done with Day 0. Move to Day 1 of the outreach playbook." -ForegroundColor Green
Write-Host ""
Write-Host "Press any key to close..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
