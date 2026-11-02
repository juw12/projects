# Runs the Rewind browser test suite and captures screenshots with headless Edge.
# Usage (from apps/rewind):  powershell -ExecutionPolicy Bypass -File ui-tests\run-ui-tests.ps1

# Edge writes harmless diagnostics to stderr; don't treat them as failures.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$appFolder = Join-Path $root "web"
$previewFolder = Join-Path $root "docs\screenshots"
$port = 8765
New-Item -ItemType Directory -Force $previewFolder | Out-Null

$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

function New-InjectedPage($scriptPath, $outputName, $extraBody, [switch]$offline) {
  $index = Get-Content (Join-Path $appFolder "index.html") -Raw
  if ($offline) {
    # Test page must not depend on the network: drop the external font stylesheet.
    $index = [regex]::Replace($index, '<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>', '')
  }
  $script = Get-Content $scriptPath -Raw
  $injection = "$extraBody`n<script>`n$script`n</script>`n</body>"
  Set-Content (Join-Path $appFolder $outputName) $index.Replace("</body>", $injection) -Encoding utf8
}

# Runs headless Edge with a hard real-time limit so a stalled page can't hang the script.
function Invoke-Edge([string[]]$arguments, [int]$timeoutSeconds = 45) {
  $runId = [guid]::NewGuid()
  $profileDir = Join-Path $env:TEMP "rewind-edge-$runId"
  $outFile = Join-Path $env:TEMP "rewind-out-$runId.txt"
  $allArguments = @("--headless=new", "--disable-gpu", "--hide-scrollbars", "--user-data-dir=$profileDir") + $arguments
  $process = Start-Process $edge -ArgumentList $allArguments -RedirectStandardOutput $outFile -RedirectStandardError "$outFile.err" -PassThru -WindowStyle Hidden
  try {
    if (-not $process.WaitForExit($timeoutSeconds * 1000)) {
      Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
        Where-Object { $_.CommandLine -match [regex]::Escape("rewind-edge-$runId") } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
      return "TIMEOUT"
    }
    return (Get-Content $outFile -Raw -ErrorAction SilentlyContinue)
  } finally {
    Start-Sleep -Milliseconds 300
    Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $outFile, "$outFile.err" -Force -ErrorAction SilentlyContinue
  }
}

$tempFiles = @("_test.html", "_shot.html", "_phone.html") | ForEach-Object { Join-Path $appFolder $_ }
$server = $null
try {
  New-InjectedPage (Join-Path $PSScriptRoot "ui-tests.js") "_test.html" '<pre id="results" hidden></pre>' -offline
  New-InjectedPage (Join-Path $PSScriptRoot "screenshot-setup.js") "_shot.html" ""
  $phoneFrames = '<html><body style="margin:0;background:#888;display:flex;gap:20px;padding:20px">' +
    '<iframe src="_shot.html?theme=light" style="width:390px;height:844px;border:0"></iframe>' +
    '<iframe src="_shot.html?theme=light&view=settings" style="width:390px;height:844px;border:0"></iframe>' +
    '</body></html>'
  Set-Content (Join-Path $appFolder "_phone.html") $phoneFrames

  $resultsFile = Join-Path $PSScriptRoot "last-results.txt"
  Remove-Item $resultsFile -ErrorAction SilentlyContinue
  $server = Start-Process python -ArgumentList "`"$(Join-Path $PSScriptRoot 'test_server.py')`"", "$port", "`"$appFolder`"", "`"$resultsFile`"" -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2
  $base = "http://127.0.0.1:$port"

  # Run the test page in real time; it POSTs progress to the test server. Stop when DONE or after 60 s.
  $runId = [guid]::NewGuid()
  $profileDir = Join-Path $env:TEMP "rewind-edge-$runId"
  $edgeProcess = Start-Process $edge -ArgumentList @("--headless=new", "--disable-gpu", "--user-data-dir=$profileDir", "$base/_test.html") -PassThru -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ((Test-Path $resultsFile) -and ((Get-Content $resultsFile -Raw) -match "DONE\s*$")) {
      break
    }
  }
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
    Where-Object { $_.CommandLine -match [regex]::Escape("rewind-edge-$runId") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
  Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue

  if (Test-Path $resultsFile) {
    $lines = (Get-Content $resultsFile -Raw).Trim() -split "`n" | Where-Object { $_ -ne "RESULTS" }
    $lines
    $passed = ($lines | Where-Object { $_ -match '^PASS' }).Count
    $failed = ($lines | Where-Object { $_ -match '^(FAIL|ERROR)' }).Count
    "--- $passed passed, $failed failed ---"
  } else {
    "No test results received"
  }

  $shots = @{
    "desktop-dark-browse.png" = "_shot.html?theme=dark"
    "desktop-light-browse.png" = "_shot.html?theme=light"
    "desktop-light-detail.png" = "_shot.html?theme=light&open=1"
    "desktop-settings.png" = "_shot.html?theme=dark&view=settings"
  }
  foreach ($name in $shots.Keys) {
    Invoke-Edge @("--window-size=1440,1000", "--virtual-time-budget=8000", "--screenshot=$previewFolder\$name", "$base/$($shots[$name])") | Out-Null
  }
  Invoke-Edge @("--window-size=840,890", "--virtual-time-budget=10000", "--screenshot=$previewFolder\phone-light.png", "$base/_phone.html") | Out-Null
} finally {
  if ($server) {
    Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
  }
  $tempFiles | ForEach-Object { Remove-Item $_ -ErrorAction SilentlyContinue }
}
