# Atomize — local setup (Windows / PowerShell)
#
# Run from this folder:  .\setup.ps1
#
# What it does:
#   1. Copies .env.example to .env.local
#   2. Installs dependencies
#   3. Type-checks the project
#   4. Runs a production build
#
# You still need to fill in .env.local with your real keys before
# the app actually generates content or accepts payment.

$ErrorActionPreference = "Stop"

Write-Host "Atomize setup" -ForegroundColor Cyan
Write-Host "=============" -ForegroundColor Cyan
Write-Host ""

# 1. .env.local
if (-not (Test-Path ".env.local")) {
  Copy-Item ".env.example" ".env.local"
  Write-Host "[ok] Created .env.local from .env.example" -ForegroundColor Green
  Write-Host "    Edit .env.local and paste your keys before running the app." -ForegroundColor Yellow
} else {
  Write-Host "[skip] .env.local already exists" -ForegroundColor DarkGray
}

# 2. Detect Node
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  $portable = "~\.config\opencode\skills\portable-nodejs\bin\node-v24.14.1-win-x64\node.exe"
  if (Test-Path $portable) {
    Write-Host "[ok] Using portable Node.js at $portable" -ForegroundColor Green
    $env:PATH = "~\.config\opencode\skills\portable-nodejs\bin\node-v24.14.1-win-x64;$env:PATH"
  } else {
    Write-Host "[fail] Node.js not found. Install Node 18+ from https://nodejs.org/" -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "[ok] Node $(& node -v)" -ForegroundColor Green
}

# 3. Install
Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install --no-audit --no-fund --ignore-scripts
if ($LASTEXITCODE -ne 0) { Write-Host "[fail] npm install failed" -ForegroundColor Red; exit 1 }
Write-Host "[ok] Dependencies installed" -ForegroundColor Green

# 4. Type-check
Write-Host ""
Write-Host "Type-checking..." -ForegroundColor Cyan
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Write-Host "[fail] Type check failed" -ForegroundColor Red; exit 1 }
Write-Host "[ok] Type check passed" -ForegroundColor Green

# 5. Build
Write-Host ""
Write-Host "Building production bundle..." -ForegroundColor Cyan
npx next build
if ($LASTEXITCODE -ne 0) { Write-Host "[fail] Build failed" -ForegroundColor Red; exit 1 }
Write-Host "[ok] Build succeeded" -ForegroundColor Green

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Edit .env.local — paste your Anthropic + Lemon Squeezy keys" -ForegroundColor White
Write-Host "  2. npx next dev   — start the app at http://localhost:3000" -ForegroundColor White
Write-Host "  3. Read LAUNCH.md for the go-to-market playbook" -ForegroundColor White
Write-Host ""
