param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Url,
    [string]$Size = "1366,1000",
    [int]$BudgetMs = 7000
)
# Headless Edge screenshot of the running CrewCup server (used for visual checks).
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
$profileDir = Join-Path $env:TEMP ("crewcup-shot-" + [guid]::NewGuid().ToString("N"))
$out = Join-Path (Join-Path $PSScriptRoot "..\screenshots") $Name
$arguments = @("--headless=new", "--disable-gpu", "--no-proxy-server", "--hide-scrollbars", "--user-data-dir=$profileDir",
               "--window-size=$Size", "--virtual-time-budget=$BudgetMs", "--screenshot=$out", $Url)
$process = Start-Process -FilePath $edge -ArgumentList $arguments -PassThru -WindowStyle Hidden
if (-not $process.WaitForExit(20000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "name='msedge.exe'" |
    Where-Object { $_.CommandLine -like "*$profileDir*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if (Test-Path $out) { "{0}: {1} bytes" -f $Name, (Get-Item $out).Length } else { "{0}: missing" -f $Name }
