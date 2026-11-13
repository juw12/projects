# Runs TradeBot's freqtrade twin on Windows without Docker.
#
#   .\run-windows.ps1                 dry run (pretend money), Telegram + FreqUI from .env
#   .\run-windows.ps1 backtest        download 4h candles and backtest the rules
#   .\run-windows.ps1 check           show versions and the resolved config
#
# Options:
#   -Venv <folder>      the Python venv with freqtrade (default: $env:FREQTRADE_VENV,
#                       then E:\Projects\.tools\freqtrade-venv, then .venv next to this script)
#   -Exchange <name>    price source, default gate (Binance is blocked on some Indonesian networks;
#                       pass -Exchange binance where it works)
#   -Proxy <url>        HTTP proxy for exchange calls (default: $env:HTTPS_PROXY if set)
#   -Since <yyyymmdd>   first day for the backtest (default 20240101)
#
# One-time install (Python 3.11 to 3.13):
#   py -m venv .venv ; .venv\Scripts\pip install freqtrade
param(
    [ValidateSet("trade", "backtest", "check")]
    [string]$Action = "trade",
    [string]$Venv = "",
    [string]$Exchange = "gate",
    [string]$Proxy = $env:HTTPS_PROXY,
    [string]$Since = "20240101"
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
Set-Location $here

# Find freqtrade.
$candidates = @($Venv, $env:FREQTRADE_VENV, "E:\Projects\.tools\freqtrade-venv", (Join-Path $here ".venv")) |
    Where-Object { $_ }
$freqtrade = $null
foreach ($folder in $candidates) {
    $exe = Join-Path $folder "Scripts\freqtrade.exe"
    if (Test-Path $exe) {
        $freqtrade = $exe
        break
    }
}
if (-not $freqtrade) {
    Write-Error "freqtrade not found. Install it: py -m venv .venv ; .venv\Scripts\pip install freqtrade"
}

# Load .env (KEY=value lines) into this process only.
$envFile = Join-Path $here ".env"
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), "Process")
        }
    }
} elseif ($Action -eq "trade") {
    Write-Warning "No .env: Telegram and FreqUI stay off. Copy .env.example to .env and fill it in."
}

# Local overrides (exchange, proxy) go in user_data, which git ignores.
New-Item -ItemType Directory -Force (Join-Path $here "user_data") | Out-Null
# Spot markets only: loading Gate's options/futures lists can time out on slow networks.
$ccxtSettings = @{ options = @{ fetchMarkets = @{ types = @("spot") } } }
if ($Proxy) {
    $ccxtSettings.httpsProxy = $Proxy
}
$exchangeOverride = @{
    name = $Exchange
    ccxt_config = $ccxtSettings
    ccxt_async_config = $ccxtSettings
}
$override = @{ exchange = $exchangeOverride }
if ($Action -ne "trade") {
    $override.api_server = @{ enabled = $false }
    $override.telegram = @{ enabled = $false }
}
$overridePath = Join-Path $here "user_data\local-override.json"
# No byte-order mark: freqtrade's JSON parser rejects it (Set-Content -Encoding UTF8 adds one on PowerShell 5.1).
[IO.File]::WriteAllText($overridePath, ($override | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))

# freqtrade logs to stderr; Windows PowerShell 5.1 would treat that as an error under Stop.
$ErrorActionPreference = "Continue"

$common = @("--config", "config.json", "--config", $overridePath, "--userdir", "user_data")

switch ($Action) {
    "check" {
        & $freqtrade --version
        & $freqtrade show-config @common
    }
    "backtest" {
        & $freqtrade download-data @common --timerange "$Since-" -t 4h
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & $freqtrade backtesting @common --timerange "$Since-" --strategy TradeBotTrend
    }
    "trade" {
        Write-Host "Dry run (pretend money). Keep this window open; Ctrl+C stops it."
        & $freqtrade trade @common --strategy TradeBotTrend
    }
}
exit $LASTEXITCODE
