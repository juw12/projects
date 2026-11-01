# Start photo2cad locally and expose it on the LAN (no Kubernetes needed).
#
# Reads the MAAS API key from the OpenCode config at run time (it does NOT
# modify that file); set MAAS_API_KEY yourself to override.
#
#   powershell -ExecutionPolicy Bypass -File apps\photo2cad\start.ps1
#   $env:PHOTO2CAD_PORT = "8100"   # optional, default 8000

$ErrorActionPreference = "Stop"
$App  = $PSScriptRoot
$Root = (Resolve-Path (Join-Path $App "..\..")).Path
$py   = Join-Path $Root ".venv3d\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }

$cfg = Join-Path $env:USERPROFILE ".config\opencode\opencode.json"
if (-not $env:MAAS_API_KEY -and (Test-Path $cfg)) {
  $env:MAAS_API_KEY = (Get-Content $cfg -Raw | ConvertFrom-Json).provider.pegaai.options.apiKey
}
if (-not $env:MAAS_LLM_BASE_URL) { $env:MAAS_LLM_BASE_URL = "http://aicc-gateway.pegatroncorp.com/pegaai/v1" }
if (-not $env:MAAS_LLM_MODEL)    { $env:MAAS_LLM_MODEL = "Pega-Coding" }

$port = if ($env:PHOTO2CAD_PORT) { $env:PHOTO2CAD_PORT } else { "8000" }
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
       Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.IPAddress -notmatch '^169\.254\.' } |
       Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host "photo2cad  ->  LAN http://${ip}:$port   local http://127.0.0.1:$port"
Write-Host "LLM configured: $([bool]$env:MAAS_API_KEY)   model=$env:MAAS_LLM_MODEL   base=$env:MAAS_LLM_BASE_URL"
Write-Host "If peers can't connect, allow inbound TCP $port in Windows Firewall."
& $py (Join-Path $App "server\server.py") --lan --port $port
