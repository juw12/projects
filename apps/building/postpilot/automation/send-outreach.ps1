# PostPilot Outreach Email Sender
# Reads prospects.csv, generates personalized emails, sends via Gmail relay

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$csvPath = Join-Path $root "automation/prospects.csv"
$configPath = Join-Path $root "automation/relay-config.txt"
$logPath = Join-Path $root "automation/send-log.txt"
$secret = "w-sZoBcWyZkxd_NyPc8Uup12LabbVS3lUjzufX4-bdA"

# Load config
if (-not (Test-Path $configPath)) {
    Write-Host "Config file not found: $configPath" -ForegroundColor Red
    exit 1
}
$relayUrl = (Get-Content $configPath -First 1).Trim()
if ($relayUrl -like "*PASTE-YOUR-RELAY-URL*") {
    Write-Host "Add your Gmail relay URL to automation/relay-config.txt" -ForegroundColor Red
    exit 1
}
$delay = 60
$dailyLimit = 10
foreach ($line in Get-Content $configPath) {
    if ($line -match "^SEND_DELAY=(\d+)") { $delay = [int]$matches[1] }
    if ($line -match "^DAILY_LIMIT=(\d+)") { $dailyLimit = [int]$matches[1] }
}

# Email templates (10 from outreach/01-cold-dms.md, abbreviated)
$templates = @{
    1 = @{
        subject = "Quick question about [NICHE]"
        body = @"
Hey [NAME] — saw your post about [CONTEXT].

Quick question: how long have you been "meaning to get more consistent" with LinkedIn?

I ask because I run a service that does exactly this for coaches and consultants. 3 on-brand posts a week, written in your voice. You approve, you post.

No pitch here — genuinely curious about the [CONTEXT] thing. Most of the people I work with say something similar.

[YOUR_NAME]
"@
    }
    2 = @{
        subject = "Your [CONTEXT] post"
        body = @"
Hey [NAME] — your post on [CONTEXT] was [SPECIFIC_THING].

Curious: do you have a system for writing these, or do they just happen when inspiration hits?

I ask because I help a few [NICHE] do this weekly without thinking about it. Happy to share how if it's useful.

[YOUR_NAME]
"@
    }
    3 = @{
        subject = "LinkedIn ghostwriting — curious if it's a fit"
        body = @"
Hey [NAME] — quick context.

I write LinkedIn for a few [NICHE]. One went from 0 to 12k impressions on her best post. Another cut her content time from 4 hours/week to 30 minutes.

If LinkedIn is something you keep meaning to do and not doing, worth a 10-minute call? Not pitching — just curious if the problem is as common as I'm seeing.

[YOUR_NAME]
"@
    }
    4 = @{
        subject = "Hot take on LinkedIn for [NICHE]"
        body = @"
Hot take from working with [NICHE]: you don't need to post daily to grow on LinkedIn.

3 thoughtful posts a week, in your voice, beats 7 generic ones written by AI at 2am.

I run a small service that does exactly this. About 15 minutes of your time per week. The rest is on me.

Worth a look?

[YOUR_NAME]
"@
    }
    6 = @{
        subject = "Quick question for [NAME]"
        body = @"
Hey [NAME] — quick question for you.

If your LinkedIn was actually consistent for the next 90 days, what would that change for your [NICHE]?

I help [NICHE] do exactly this. No idea if it's on your radar — just curious how you'd answer.

[YOUR_NAME]
"@
    }
    7 = @{
        subject = "Saw you [CONTEXT]"
        body = @"
Hey [NAME] — saw you [CONTEXT]. Congrats.

Quick observation: most people in your position see 2-3x more inbound when their LinkedIn is consistent through the [CONTEXT]. Right now you're going dark after the announcement.

I run a small service that keeps your LinkedIn active through moments like this — 3 on-brand posts a week, written in your voice, you just approve.

Worth a chat? 10 minutes, no pitch.

[YOUR_NAME]
"@
    }
    9 = @{
        subject = "I'll write your LinkedIn for a month"
        body = @"
Hey [NAME] — I'll write your LinkedIn for a month.

3 on-brand posts a week, in your voice. Delivered Monday morning. You approve or edit. Cancel anytime. If your first month doesn't deliver posts you'd actually publish, I refund it.

`$99/mo to start. No contract.

10 minutes to onboard. Worth trying?

[YOUR_NAME]
"@
    }
}

# Read CSV
$rows = Import-Csv $csvPath
$pending = $rows | Where-Object { $_.status -eq "pending" -and $_.email }

if ($pending.Count -eq 0) {
    Write-Host "No pending prospects with email addresses found." -ForegroundColor Yellow
    Write-Host "Fill in automation/prospects.csv with real names and emails first." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Found $($pending.Count) pending prospects with emails." -ForegroundColor Cyan
Write-Host "Daily limit: $dailyLimit | Delay between sends: ${delay}s" -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "DRY RUN MODE — no emails will actually be sent" -ForegroundColor Yellow
}
Write-Host ""

$sent = 0
foreach ($p in $pending) {
    if ($sent -ge $dailyLimit) {
        Write-Host "Daily limit reached. Stopping." -ForegroundColor Yellow
        break
    }

    $templateNum = [int]$p.template
    if (-not $templates.ContainsKey($templateNum)) {
        Write-Host "  Skipping $($p.name) — template $templateNum not loaded" -ForegroundColor Gray
        continue
    }

    $tpl = $templates[$templateNum]
    $subject = $tpl.subject -replace "\[NAME\]", $p.name -replace "\[NICHE\]", $p.niche -replace "\[CONTEXT\]", $p.trigger_event
    $body = $tpl.body -replace "\[NAME\]", $p.name -replace "\[NICHE\]", $p.niche -replace "\[CONTEXT\]", $p.trigger_event -replace "\[YOUR_NAME\]", "Sisyphus"

    Write-Host ""
    Write-Host "To: $($p.email)" -ForegroundColor White
    Write-Host "Subject: $subject" -ForegroundColor White
    Write-Host "Body preview: $($body.Substring(0, [Math]::Min(100, $body.Length)))..." -ForegroundColor Gray

    if ($DryRun) {
        Write-Host "  [DRY RUN] Would send this email" -ForegroundColor Yellow
        $sent++
        continue
    }

    # Send via Gmail relay
    $payload = @{
        secret = $secret
        to = $p.email
        subject = $subject
        text = $body
        html = $body -replace "`n", "<br>"
        name = "Sisyphus"
    } | ConvertTo-Json

    try {
        $response = Invoke-RestMethod -Uri $relayUrl -Method Post -Body $payload -ContentType "application/json"
        if ($response.ok) {
            Write-Host "  [SENT]" -ForegroundColor Green
            $p.status = "sent"
            $p.date_sent = (Get-Date -Format "yyyy-MM-dd")
            $p.follow_up_date = (Get-Date).AddDays(3).ToString("yyyy-MM-dd")
            $sent++

            # Log
            "$((Get-Date -Format 'yyyy-MM-dd HH:mm')) | $($p.email) | tpl=$templateNum | $($p.name)" | Out-File -Append $logPath
        } else {
            Write-Host "  [ERROR] $($response.error)" -ForegroundColor Red
        }
    } catch {
        Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
    }

    if ($sent -lt $dailyLimit -and $sent -lt $pending.Count) {
        Write-Host "  Waiting $delay seconds..." -ForegroundColor Gray
        Start-Sleep -Seconds $delay
    }
}

# Save updated CSV
$rows | Export-Csv $csvPath -NoTypeInformation

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Done. Sent: $sent / Daily limit: $dailyLimit" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Check your sent folder to verify the emails went out" -ForegroundColor White
Write-Host "2. Wait 3 days, then run again to send follow-ups" -ForegroundColor White
Write-Host "3. When prospects reply, update their status in prospects.csv" -ForegroundColor White
