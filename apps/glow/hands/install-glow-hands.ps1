# Glow Hands one-step installer for Windows. No admin rights needed.
# Use:  Win+R  ->  powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/juw12/projects/main/apps/glow/hands/install-glow-hands.ps1 | iex"
# It installs into %LOCALAPPDATA%\GlowHands, starts at every login, and opens GlowLead to connect (click Yes on the prompt).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$sourceBase = 'https://raw.githubusercontent.com/juw12/projects/main/apps/glow/hands'
$glowHome = Join-Path $env:LOCALAPPDATA 'GlowHands'
$appDir = Join-Path $glowHome 'app'
$logFile = Join-Path $glowHome 'glow-hands.log'
$glowLeadUrl = 'https://juw12.github.io/projects/glow/lead/#hands-setup'

function Say($message) { Write-Host "[Glow Hands] $message" -ForegroundColor Cyan }

function Find-Python {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\python.exe')
    )
    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($launcher) {
        $fromLauncher = & $launcher.Source -3 -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $fromLauncher) { $candidates = @("$fromLauncher".Trim()) + $candidates }
    }
    $onPath = Get-Command python -ErrorAction SilentlyContinue
    if ($onPath -and $onPath.Source -notlike '*WindowsApps*') { $candidates += $onPath.Source }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            $version = & $candidate -c "import sys; print(sys.version_info >= (3, 10))" 2>$null
            if ("$version".Trim() -eq 'True') { return $candidate }
        }
    }
    return $null
}

function Test-GlowHands($port) {
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:$port/status" -TimeoutSec 2
        return $status.app -eq 'glow-hands'
    } catch { return $false }
}

Say 'Checking Python...'
$python = Find-Python
if (-not $python) {
    Say 'Python 3.10+ not found. Installing Python 3.13 for this user with winget...'
    $ErrorActionPreference = 'Continue'
    winget install -e --id Python.Python.3.13 --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Host
    $ErrorActionPreference = 'Stop'
    $python = Find-Python
    if (-not $python) { throw 'Python could not be installed automatically. Install it from https://www.python.org/downloads/ and run this again.' }
}
Say "Using $python"

Say 'Installing the browser automation library (Playwright)...'
$ErrorActionPreference = 'Continue'
& $python -m pip install --user --disable-pip-version-check --quiet playwright==1.55.0 2>&1 | Where-Object { $_ -notmatch 'not on PATH|Consider adding' } | Out-Host
$pipExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($pipExit -ne 0) { throw 'Installing Playwright failed. Check your internet connection and run this again.' }

New-Item -ItemType Directory -Force -Path $appDir | Out-Null
if ($env:GLOW_HANDS_SOURCE) {
    Copy-Item (Join-Path $env:GLOW_HANDS_SOURCE 'glow_hands.py') (Join-Path $appDir 'glow_hands.py') -Force
} else {
    Invoke-WebRequest -UseBasicParsing -Uri "$sourceBase/glow_hands.py" -OutFile (Join-Path $appDir 'glow_hands.py')
}

$channel = $null
if (Test-Path "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") { $channel = 'msedge' }
elseif (Test-Path "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") { $channel = 'msedge' }
elseif (Test-Path "$env:ProgramFiles\Google\Chrome\Application\chrome.exe") { $channel = 'chrome' }
if (-not $channel) {
    Say 'No Edge or Chrome found; downloading a private Chromium for Glow Hands...'
    $ErrorActionPreference = 'Continue'
    & $python -m playwright install chromium 2>&1 | Out-Host
    $ErrorActionPreference = 'Stop'
}

# Reuse the port of an existing Glow Hands (stopping it so the new version starts), else take the first free port.
$port = $null
foreach ($candidate in 8765..8770) {
    if (Test-GlowHands $candidate) {
        $port = $candidate
        Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
        break
    }
}
if (-not $port) {
    foreach ($candidate in 8765..8770) {
        if (-not (Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue)) { $port = $candidate; break }
    }
}
if (-not $port) { throw 'Ports 8765-8770 are all in use. Close another program and run this again.' }

$channelArgument = if ($channel) { " --channel $channel" } else { '' }
$command = "cmd /c """"$python"" ""$appDir\glow_hands.py""$channelArgument --port $port >> ""$logFile"" 2>&1"""
$startup = [Environment]::GetFolderPath('Startup')
$launcher = Join-Path $startup 'Glow Hands.vbs'
@"
' Starts Glow Hands (browser control for GlowLead) hidden at login. Delete this file to stop auto-start.
CreateObject("WScript.Shell").Run "$($command.Replace('"', '""'))", 0, False
"@ | Set-Content -Path $launcher -Encoding ASCII

Say "Starting Glow Hands on port $port..."
Start-Process wscript.exe -ArgumentList "`"$launcher`""
$ready = $false
foreach ($attempt in 1..20) {
    Start-Sleep -Milliseconds 750
    if (Test-GlowHands $port) { $ready = $true; break }
}
if (-not $ready) { throw "Glow Hands did not start. See $logFile" }

Say "Installed. It starts automatically at every login (launcher: $launcher)."
if ($env:GLOW_HANDS_NO_BROWSER -ne '1') {
    Say 'Opening GlowLead to connect. Click YES on the Windows prompt "Glow Hands: allow this browser?".'
    Start-Process $glowLeadUrl
}
