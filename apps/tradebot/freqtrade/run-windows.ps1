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

# The rupiah rate (CoinGecko) and Telegram read the proxy from the environment, not from ccxt.
if ($Proxy) {
    $env:HTTPS_PROXY = $Proxy
}

# Telegram, before a dry run: make sure this network can reach it, and learn the chat id the
# first time. Without Telegram the twin still trades (pretend money) and FreqUI still works.
if ($Action -eq "trade" -and $env:FREQTRADE__TELEGRAM__ENABLED -eq "true") {
    $telegramOff = $null
    $token = $env:FREQTRADE__TELEGRAM__TOKEN
    # TELEGRAM_API is only for testing this script against a stand-in server.
    $api = if ($env:TELEGRAM_API) { $env:TELEGRAM_API } else { "https://api.telegram.org" }
    $web = @{ TimeoutSec = 15; UseBasicParsing = $true }
    if ($Proxy -and -not $env:TELEGRAM_API) {
        $web.Proxy = $Proxy
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if (-not $token) {
        $telegramOff = "No bot token in .env."
    } else {
        try {
            $me = Invoke-RestMethod @web -Uri "$api/bot$token/getMe"
            $botName = "@" + $me.result.username
            if (-not $env:FREQTRADE__TELEGRAM__CHAT_ID) {
                $updates = Invoke-RestMethod @web -Uri "$api/bot$token/getUpdates"
                $people = @($updates.result | ForEach-Object { $_.message.chat } |
                    Where-Object { $_ -and $_.type -eq "private" } | Sort-Object id -Unique)
                if ($people.Count -eq 1) {
                    $chatId = [string]$people[0].id
                    $kept = (Get-Content $envFile) -replace '^\s*FREQTRADE__TELEGRAM__CHAT_ID\s*=.*$', "FREQTRADE__TELEGRAM__CHAT_ID=$chatId"
                    [IO.File]::WriteAllLines($envFile, $kept, (New-Object Text.UTF8Encoding $false))
                    $env:FREQTRADE__TELEGRAM__CHAT_ID = $chatId
                    Write-Host "Telegram: $botName now talks to $($people[0].first_name) (chat $chatId, saved in .env)."
                } elseif ($people.Count -eq 0) {
                    $telegramOff = "Send any message to $botName in Telegram, then start this again."
                } else {
                    $telegramOff = "More than one person has written to $botName. Put your own chat id in .env (FREQTRADE__TELEGRAM__CHAT_ID)."
                }
            }
        } catch {
            # The error text is not shown: it can contain the address, and the address contains the token.
            $telegramOff = "Telegram cannot be reached from this network (some office networks block it), or the token in .env is wrong."
        }
    }
    if ($telegramOff) {
        Write-Warning "$telegramOff Running without Telegram for now; FreqUI is at http://127.0.0.1:8080."
        $env:FREQTRADE__TELEGRAM__ENABLED = "false"
    }
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
        # A click in a console window starts "Select" mode, which pauses the program until Esc.
        # Switch that off for this window so a stray click cannot stop the twin.
        try {
            $console = Add-Type -Name ConsoleMode -Namespace TradeBot -PassThru -MemberDefinition @"
[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int handle);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr handle, out uint mode);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr handle, uint mode);
"@
            $stdin = $console::GetStdHandle(-10)
            $mode = 0
            if ($console::GetConsoleMode($stdin, [ref]$mode)) {
                # Clear ENABLE_QUICK_EDIT_MODE (0x40), keep ENABLE_EXTENDED_FLAGS (0x80).
                [void]$console::SetConsoleMode($stdin, ($mode -band (-bnot 0x40)) -bor 0x80)
            }
        } catch {
            # No console (for example when run hidden): nothing to switch off.
        }
        $logFile = Join-Path $here "user_data\logs\freqtrade.log"
        New-Item -ItemType Directory -Force (Split-Path $logFile) | Out-Null
        Write-Host "Dry run (pretend money). Keep this window open; Ctrl+C stops it. Log: $logFile"
        & $freqtrade trade @common --strategy TradeBotTrend --logfile $logFile
    }
}
exit $LASTEXITCODE
