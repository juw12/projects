# Runs TradeBot's MetaTrader 5 bridge on Windows. DEMO ACCOUNTS ONLY.
#
#   .\run-windows.ps1            keep copying, one cycle a minute
#   .\run-windows.ps1 -Show      what it would do right now: no orders, no report
#   .\run-windows.ps1 -Once      one cycle, then stop
#   .\run-windows.ps1 -Test      the bridge's own tests (a pretend MetaTrader 5, no network)
#
# Options:
#   -Python <exe>   the Python to use (default: $env:MT5_PYTHON, then .venv next to this script,
#                   then py or python on the PATH)
#   -Proxy <url>    HTTP proxy for the calls to TradeBot's server (default: $env:HTTPS_PROXY if set)
#
# It is off until .env next to this script holds MT5_BRIDGE_KEY: without the key it says so and
# stops, and MetaTrader 5 is never touched. See README.md before switching it on.
#
# One-time install, on the PC that has the MetaTrader 5 terminal (64-bit Python):
#   py -m venv .venv ; .venv\Scripts\pip install MetaTrader5
param(
    [switch]$Show,
    [switch]$Once,
    [switch]$Test,
    [string]$Python = "",
    [string]$Proxy = $env:HTTPS_PROXY
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
Set-Location $here

# Find Python.
$candidates = @($Python, $env:MT5_PYTHON, (Join-Path $here ".venv\Scripts\python.exe")) | Where-Object { $_ }
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
    Write-Error "Python not found. Install it, then: py -m venv .venv ; .venv\Scripts\pip install MetaTrader5"
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
    Write-Warning "No .env: the bridge stays off. Copy .env.example to .env and fill in MT5_BRIDGE_KEY."
}

$bridgeArgs = @("bridge.py")
if ($Show) {
    $bridgeArgs += "--show"
}
if ($Once) {
    $bridgeArgs += "--once"
}
& $pythonExe @bridgeArgs
exit $LASTEXITCODE
