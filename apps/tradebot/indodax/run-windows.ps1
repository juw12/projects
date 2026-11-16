# Runs TradeBot's Indodax sender on Windows. PRACTICE BY DEFAULT: no order reaches Indodax.
#
#   .\run-windows.ps1            keep copying, one cycle a minute
#   .\run-windows.ps1 -Show      what it would do right now: no orders, no report
#   .\run-windows.ps1 -Once      one cycle, then stop
#   .\run-windows.ps1 -Check     does the Indodax API key work? prints the free rupiah, orders nothing
#   .\run-windows.ps1 -Clear     clear the safety stop, after you have looked at Indodax
#   .\run-windows.ps1 -Test      the sender's own tests (a pretend exchange, no network)
#
# Options:
#   -Python <exe>   the Python to use (default: $env:INDODAX_PYTHON, then .venv next to this script,
#                   then py or python on the PATH)
#   -Proxy <url>    HTTP proxy for the calls to TradeBot and Indodax (default: $env:HTTPS_PROXY if set)
#
# It is off until .env next to this script holds INDODAX_BRIDGE_KEY: without the key it says so and
# stops. Real money needs more than that, on purpose. See README.md before switching anything on.
#
# Nothing to install: the sender uses only what comes with Python.
param(
    [switch]$Show,
    [switch]$Once,
    [switch]$Check,
    [switch]$Clear,
    [switch]$Test,
    [string]$Python = "",
    [string]$Proxy = $env:HTTPS_PROXY
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
Set-Location $here

# Find Python.
$candidates = @($Python, $env:INDODAX_PYTHON, (Join-Path $here ".venv\Scripts\python.exe")) | Where-Object { $_ }
$pythonExe = $null
foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
        $pythonExe = $candidate
        break
    }
}
if (-not $pythonExe) {
    foreach ($name in @("py", "python")) {
        $found = Get-Command $name -ErrorAction SilentlyContinue
        if ($found) {
            $pythonExe = $found.Source
            break
        }
    }
}
if (-not $pythonExe) {
    Write-Error "Python not found. Install Python 3.9 or newer, then run this again."
}

if ($Test) {
    & $pythonExe -m unittest
    exit $LASTEXITCODE
}

# bridge.py reads .env itself. Only the proxy is passed on from here.
if ($Proxy) {
    $env:HTTPS_PROXY = $Proxy
}
if (-not (Test-Path (Join-Path $here ".env"))) {
    Write-Warning "No .env: the sender stays off. Copy .env.example to .env and fill in INDODAX_BRIDGE_KEY."
}

$bridgeArgs = @("bridge.py")
if ($Show) {
    $bridgeArgs += "--show"
}
if ($Once) {
    $bridgeArgs += "--once"
}
if ($Check) {
    $bridgeArgs += "--check"
}
if ($Clear) {
    $bridgeArgs += "--clear"
}
& $pythonExe @bridgeArgs
exit $LASTEXITCODE
