# Respark - one-click local + public tunnel launcher (Windows PowerShell)
#
# Detects whichever tunnel tool you have installed and uses it:
#   1. cloudflared   (preferred - zero account, just install)
#   2. ngrok         (if already set up)
#
# If neither is installed, the script installs cloudflared automatically via winget.
#
# Then:
#   1. Starts the tunnel pointing at port 8000
#   2. Captures the public URL
#   3. Writes it into .env as RESPARK_BASE_URL
#   4. Starts the Respark server in the foreground

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Write-Step($n, $msg) { Write-Host "[$n/5] $msg" -ForegroundColor Cyan }

function Install-Cloudflared {
    Write-Host "      cloudflared not found, installing via winget..." -ForegroundColor Yellow
    try {
        winget install --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements | Out-Null
    } catch {
        Write-Host "      winget install failed. Get it from https://github.com/cloudflare/cloudflared/releases" -ForegroundColor Red
        Write-Host "      Download 'cloudflared-windows-amd64.exe', rename to cloudflared.exe, put in PATH." -ForegroundColor Red
        exit 1
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
        Write-Host "      Installed but not in PATH yet. Restart PowerShell and rerun." -ForegroundColor Red
        exit 1
    }
}

Write-Step "1/5" "Choosing tunnel..."
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
$ng = Get-Command ngrok -ErrorAction SilentlyContinue

if (-not $cf -and -not $ng) {
    Install-Cloudflared
    $cf = Get-Command cloudflared
}

if ($cf) {
    $tunnel = "cloudflared"
    Write-Host "      using cloudflared" -ForegroundColor Green
} else {
    $tunnel = "ngrok"
    Write-Host "      using ngrok" -ForegroundColor Green
}

Write-Step "2/5" "Starting tunnel to port 8000..."

$tunnelPid = $null
$publicUrl = $null

if ($tunnel -eq "cloudflared") {
    $existing = Get-Process cloudflared -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "      cloudflared already running, killing it..." -ForegroundColor DarkYellow
        Stop-Process -Id $existing.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
    $logPath = Join-Path $root "logs\cloudflared.log"
    New-Item -ItemType File -Path $logPath -Force | Out-Null
    $proc = Start-Process cloudflared -ArgumentList "tunnel", "--url", "http://localhost:8000", "--no-autoupdate", "--logfile", $logPath -WindowStyle Hidden -PassThru
    $tunnelPid = $proc.Id

    Write-Step "3/5" "Capturing public URL..."
    for ($i = 0; $i -lt 25; $i++) {
        if ((Test-Path $logPath) -and ((Get-Item $logPath).Length -gt 0)) {
            $logText = Get-Content $logPath -Raw -ErrorAction SilentlyContinue
            if ($logText -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com') {
                $publicUrl = $matches[0]
                break
            }
        }
        Start-Sleep -Seconds 1
    }
}
else {
    $existing = Get-Process ngrok -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "      ngrok already running, killing it..." -ForegroundColor DarkYellow
        Stop-Process -Id $existing.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
    Start-Process ngrok -ArgumentList "http", "8000" -WindowStyle Hidden
    Start-Sleep -Seconds 3

    Write-Step "3/5" "Capturing public URL..."
    for ($i = 0; $i -lt 15; $i++) {
        try {
            $api = Invoke-RestMethod "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 2 -ErrorAction Stop
            $t = $api.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1
            if ($t -and $t.public_url) {
                $publicUrl = $t.public_url
                break
            }
        } catch {}
        Start-Sleep -Seconds 1
    }
}

if (-not $publicUrl) {
    Write-Host "      tunnel didn't expose a URL in time." -ForegroundColor Red
    if ($tunnel -eq "cloudflared") {
        Write-Host "      Check logs\cloudflared.log" -ForegroundColor Red
    } else {
        Write-Host "      Check ngrok status: http://127.0.0.1:4040/status" -ForegroundColor Red
    }
    exit 1
}
Write-Host "      $publicUrl" -ForegroundColor Green

Write-Step "4/5" "Writing URL into .env..."
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }
$content = Get-Content ".env"
$found = $false
$new = @()
foreach ($line in $content) {
    if ($line -match "^RESPARK_BASE_URL=") {
        $new += "RESPARK_BASE_URL=$publicUrl"
        $found = $true
    } else {
        $new += $line
    }
}
if (-not $found) { $new += "RESPARK_BASE_URL=$publicUrl" }
$secretFound = $false
foreach ($line in $new) { if ($line -match "^RESPARK_SECRET=.+") { $secretFound = $true; break } }
if (-not $secretFound) {
    $rand = -join ((33..126) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
    $new += "RESPARK_SECRET=$rand"
}
$new | Set-Content ".env" -Encoding UTF8
Write-Host "      RESPARK_BASE_URL set" -ForegroundColor Green

Write-Step "5/5" "Starting Respark server..."
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Respark is live at:" -ForegroundColor Green
Write-Host "    Local:    http://localhost:8000" -ForegroundColor Green
Write-Host "    Public:   $publicUrl" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Use the public URL to:" -ForegroundColor DarkGray
Write-Host "    - Demo to prospects (send them the link)" -ForegroundColor DarkGray
Write-Host "    - Configure Stripe webhook URL" -ForegroundColor DarkGray
Write-Host "    - Send cold emails with working tracking pixels" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Press Ctrl+C to stop everything." -ForegroundColor DarkGray
Write-Host ""

Register-ObjectEvent -InputObject $Host -EventName "RunspaceClosing" -Action {
    if ($script:tunnelPid) {
        Get-Process -Id $script:tunnelPid -ErrorAction SilentlyContinue | Stop-Process -Force
    }
} | Out-Null

try {
    python server\server.py
} finally {
    if ($tunnelPid) {
        Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue | Stop-Process -Force
    }
}
