# Vitals one-step installer for Windows 10/11.
#
#   Press Win+R, paste, press Enter:
#   powershell -ExecutionPolicy Bypass -c "irm https://juw12.github.io/projects/vitals/install.ps1 | iex"
#
# What it does (no admin rights needed; everything stays in your user profile):
#   1. Finds Python 3.8+, or installs it for you with winget (Microsoft's app installer).
#   2. Downloads Vitals into %LOCALAPPDATA%\Vitals\app (about 300 KB).
#   3. Adds Vitals to the Start menu and Desktop, and starts it quietly at sign-in.
#   4. Opens the dashboard.
#
# Re-run to update. Uninstall: same command with  $env:VITALS_UNINSTALL=1;  in front of irm.
# History and the Undo Vault (%USERPROFILE%\.vitals) are kept unless you delete them.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Raw = if ($env:VITALS_RAW) { $env:VITALS_RAW } else { 'https://raw.githubusercontent.com/juw12/projects/main/apps/vitals' }
$Root = Join-Path $env:LOCALAPPDATA 'Vitals'
$App = Join-Path $Root 'app'
$Port = 8765
$StartMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Vitals.lnk'
$Desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Vitals.lnk'
$Startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Vitals (background).lnk'

function Say($text) { Write-Host "> $text" -ForegroundColor Green }
function Warn($text) { Write-Host "! $text" -ForegroundColor Yellow }

function Stop-Vitals {
    try {
        $session = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/session" -TimeoutSec 2
        Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/shutdown" -Headers @{ 'X-Vitals-Token' = $session.token } -TimeoutSec 2 | Out-Null
        Start-Sleep -Seconds 1
    } catch { }
}

function Install-Vitals {
    if ($env:VITALS_UNINSTALL) {
        Say 'Removing Vitals...'
        Stop-Vitals
        Remove-Item -Force -ErrorAction SilentlyContinue $StartMenu, $Desktop, $Startup
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Root
        Say "Done. History and the Undo Vault are still in $env:USERPROFILE\.vitals - delete it to remove everything."
        return
    }

    function Find-Python {
        $tries = @(@('py', '-3'), @('python'), @('python3'))
        foreach ($try in $tries) {
            $exe = $try[0]
            $extra = @()
            if ($try.Count -gt 1) { $extra = $try[1..($try.Count - 1)] }
            if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
            try {
                $out = & $exe @extra -c "import sys; print(sys.executable) if sys.version_info >= (3, 8) else sys.exit(1)" 2>$null
                if ($LASTEXITCODE -eq 0 -and $out) {
                    $path = ($out | Select-Object -Last 1).Trim()
                    if ((Test-Path $path) -and ($path -notlike '*WindowsApps*')) { return $path }
                }
            } catch { }
        }
        $known = Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe" -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1
        if ($known) { return $known.FullName }
        return $null
    }

    $Python = Find-Python
    if (-not $Python) {
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            Say 'Installing Python (one time, about a minute)...'
            winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Null
            $Python = Find-Python
        }
        if (-not $Python) {
            Start-Process 'https://www.python.org/downloads/windows/'
            throw 'Please install Python from the page that just opened (tick "Add python.exe to PATH"), then run this command again.'
        }
    }
    $PythonW = Join-Path (Split-Path $Python) 'pythonw.exe'
    if (-not (Test-Path $PythonW)) { $PythonW = $Python }
    Say "Using Python: $Python"

    Say 'Downloading Vitals...'
    $Tmp = Join-Path $env:TEMP ('vitals-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
    try {
        $list = (Invoke-WebRequest -UseBasicParsing -Uri "$Raw/web/files.txt").Content -split "`n"
        $count = 0
        foreach ($line in $list) {
            $rel = $line.Trim()
            if (-not $rel -or $rel.StartsWith('#')) { continue }
            $dest = Join-Path $Tmp ('app\' + $rel.Replace('/', '\'))
            New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
            Invoke-WebRequest -UseBasicParsing -Uri "$Raw/$rel" -OutFile $dest
            $count++
        }
        if (-not (Test-Path (Join-Path $Tmp 'app\server\server.py'))) { throw 'Download incomplete - check your connection and try again.' }

        Stop-Vitals
        New-Item -ItemType Directory -Force -Path $Root | Out-Null
        if (Test-Path $App) { Remove-Item -Recurse -Force $App }
        Move-Item (Join-Path $Tmp 'app') $App
        Say "Installed $count files in $App"
    } finally {
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Tmp
    }

    $Server = Join-Path $App 'server\server.py'
    $Icon = Join-Path $App 'web\icons\icon.ico'
    $Shell = New-Object -ComObject WScript.Shell

    function New-Shortcut($path, $arguments, $windowStyle) {
        $link = $Shell.CreateShortcut($path)
        $link.TargetPath = $PythonW
        $link.Arguments = $arguments
        $link.WorkingDirectory = $App
        $link.IconLocation = $Icon
        $link.WindowStyle = $windowStyle
        $link.Description = 'Vitals - device health copilot'
        $link.Save()
    }

    New-Shortcut $StartMenu "`"$Server`" --open" 1
    New-Shortcut $Desktop "`"$Server`" --open" 1
    New-Shortcut $Startup "`"$Server`"" 7
    Say 'Added Vitals to the Start menu and Desktop; it starts quietly when you sign in'

    Start-Process -FilePath $PythonW -ArgumentList "`"$Server`"", '--open' -WorkingDirectory $App
    for ($i = 0; $i -lt 20; $i++) {
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1 | Out-Null
            Say "Vitals is running - your browser is opening http://127.0.0.1:$Port/"
            return
        } catch { Start-Sleep -Milliseconds 500 }
    }
    Warn "Vitals is starting... if the browser doesn't open, visit http://127.0.0.1:$Port/"
}

try {
    Install-Vitals
    Start-Sleep -Seconds 3
} catch {
    Write-Host ''
    Write-Host "Vitals could not finish installing: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host 'Press Enter to close'
}
