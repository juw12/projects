# Glow master installer for Windows: every Glow app in one step. No admin rights needed.
#
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/juw12/projects/main/apps/glow/install-glow.ps1 | iex"
#
# What it does (safe to run again; it updates in place):
#   1. Adds Glow, GlowLead, GlowChat and GlowRoom to the Start menu (folder "Glow") and the desktop.
#      They open as app windows of Edge or Chrome, using your normal browser profile, so all four
#      share one Glow account, your chats and missions.
#   2. Installs or updates Glow Hands (browser control for GlowLead on this PC; starts at every login).
#   3. Opens the Glow setup guide, which shows how to add your phone.
#
# Options (set before running, e.g.  $env:GLOW_SKIP_HANDS = '1'; irm ... | iex):
#   GLOW_SKIP_HANDS=1    only add the app shortcuts, don't install Glow Hands
#   GLOW_NO_DESKTOP=1    Start menu only, no desktop shortcuts
#   GLOW_NO_BROWSER=1    don't open the setup guide at the end
#   GLOW_UNINSTALL=1     remove the shortcuts, stop and remove Glow Hands (your chats stay in the browser)
#   GLOW_SOURCE=<folder> use a local copy of apps/glow instead of downloading (for testing)
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'

    $siteBase = 'https://juw12.github.io/projects/glow/'
    $rawBase = 'https://raw.githubusercontent.com/juw12/projects/main/apps/glow/'
    $glowHome = Join-Path $env:LOCALAPPDATA 'Glow'
    $iconDir = Join-Path $glowHome 'icons'
    $startMenuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'Glow'
    $desktopDir = [Environment]::GetFolderPath('Desktop')
    $handsHome = Join-Path $env:LOCALAPPDATA 'GlowHands'
    $handsLauncher = Join-Path ([Environment]::GetFolderPath('Startup')) 'Glow Hands.vbs'

    # The Glow family. Each entry becomes one app shortcut.
    $apps = @(
        @{ Name = 'Glow'; Page = ''; Icon = 'icons/icon-192.png'; About = 'Glow home: start anything, all Glow apps' },
        @{ Name = 'GlowLead'; Page = 'lead/'; Icon = 'icons/icon-192.png'; About = 'Your AI lead: plans a goal, delegates, checks, reports' },
        @{ Name = 'GlowChat'; Page = 'chat/'; Icon = 'chat/icons/icon-192.png'; About = 'Chat, Council and Arena with any AI model' },
        @{ Name = 'GlowRoom'; Page = 'room/'; Icon = 'room/assets/icon-192.png'; About = 'An AI crew that researches, codes and reports back' }
    )

    function Say($message) { Write-Host "[Glow] $message" -ForegroundColor Cyan }

    function Find-Browser {
        $candidates = @(
            (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
            (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
            (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
            (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
        )
        foreach ($candidate in $candidates) {
            if ($candidate -and (Test-Path $candidate)) { return $candidate }
        }
        return $null
    }

    # Windows shortcuts need .ico files; an .ico may simply wrap a PNG image (Windows Vista and later).
    function Save-Icon($relativePath, $icoPath) {
        if ($env:GLOW_SOURCE) {
            $png = [IO.File]::ReadAllBytes((Join-Path $env:GLOW_SOURCE ('web/' + $relativePath)))
        } else {
            $png = (Invoke-WebRequest -UseBasicParsing -Uri ($siteBase + $relativePath)).Content
        }
        $width = [int]$png[19] + 256 * [int]$png[18]
        $height = [int]$png[23] + 256 * [int]$png[22]
        $stream = New-Object IO.MemoryStream
        $writer = New-Object IO.BinaryWriter($stream)
        $writer.Write([UInt16]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]1)
        $writer.Write([byte]($width % 256))
        $writer.Write([byte]($height % 256))
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$png.Length)
        $writer.Write([UInt32]22)
        $writer.Write($png)
        $writer.Flush()
        [IO.File]::WriteAllBytes($icoPath, $stream.ToArray())
        $writer.Close()
    }

    function New-AppShortcut($folder, $app, $browser, $iconPath) {
        $url = $siteBase + $app.Page
        if ($browser) {
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut((Join-Path $folder ($app.Name + '.lnk')))
            $shortcut.TargetPath = $browser
            $shortcut.Arguments = "--app=$url"
            $shortcut.IconLocation = "$iconPath,0"
            $shortcut.Description = $app.About
            $shortcut.Save()
        } else {
            # No Edge or Chrome: an internet shortcut opens the page in the default browser.
            $lines = @('[InternetShortcut]', "URL=$url", "IconFile=$iconPath", 'IconIndex=0')
            Set-Content -Path (Join-Path $folder ($app.Name + '.url')) -Value $lines -Encoding ASCII
        }
    }

    function Stop-GlowHands {
        Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match 'glow_hands\.py' } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    }

    if ($env:GLOW_UNINSTALL -eq '1') {
        Say 'Removing Glow app shortcuts...'
        if (Test-Path $startMenuDir) { Remove-Item $startMenuDir -Recurse -Force }
        foreach ($app in $apps) {
            foreach ($extension in @('.lnk', '.url')) {
                $path = Join-Path $desktopDir ($app.Name + $extension)
                if (Test-Path $path) { Remove-Item $path -Force }
            }
        }
        Say 'Stopping and removing Glow Hands...'
        Stop-GlowHands
        Start-Sleep -Seconds 1
        if (Test-Path $handsLauncher) { Remove-Item $handsLauncher -Force }
        foreach ($folder in @($handsHome, $glowHome)) {
            if (Test-Path $folder) { Remove-Item $folder -Recurse -Force -ErrorAction SilentlyContinue }
        }
        Say 'Glow is removed from this PC. Your chats and missions stay in your browser until you clear its site data.'
        return
    }

    Say 'Step 1 of 3: adding the Glow apps to the Start menu...'
    $browser = Find-Browser
    if ($browser) { Say "App windows will open in $([IO.Path]::GetFileNameWithoutExtension($browser))." }
    else { Say 'Edge or Chrome not found; the shortcuts will open in your default browser.' }
    New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
    New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
    foreach ($app in $apps) {
        $iconPath = Join-Path $iconDir ($app.Name + '.ico')
        try { Save-Icon $app.Icon $iconPath } catch { Say "Could not fetch the $($app.Name) icon; using the browser icon." }
        if (-not (Test-Path $iconPath)) { $iconPath = if ($browser) { $browser } else { '' } }
        New-AppShortcut $startMenuDir $app $browser $iconPath
        if ($env:GLOW_NO_DESKTOP -ne '1') { New-AppShortcut $desktopDir $app $browser $iconPath }
        Say "  added $($app.Name)"
    }

    if ($env:GLOW_SKIP_HANDS -eq '1') {
        Say 'Step 2 of 3: skipped Glow Hands (GLOW_SKIP_HANDS=1).'
    } else {
        Say 'Step 2 of 3: installing or updating Glow Hands (browser control for GlowLead)...'
        $handsInstaller = Join-Path $env:TEMP 'install-glow-hands.ps1'
        if ($env:GLOW_SOURCE) {
            Copy-Item (Join-Path $env:GLOW_SOURCE 'hands/install-glow-hands.ps1') $handsInstaller -Force
            $env:GLOW_HANDS_SOURCE = Join-Path $env:GLOW_SOURCE 'hands'
        } else {
            Invoke-WebRequest -UseBasicParsing -Uri ($rawBase + 'hands/install-glow-hands.ps1') -OutFile $handsInstaller
        }
        $env:GLOW_HANDS_NO_BROWSER = '1'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $handsInstaller
        $handsExit = $LASTEXITCODE
        Remove-Item Env:GLOW_HANDS_NO_BROWSER -ErrorAction SilentlyContinue
        Remove-Item Env:GLOW_HANDS_SOURCE -ErrorAction SilentlyContinue
        Remove-Item $handsInstaller -ErrorAction SilentlyContinue
        if ($handsExit -ne 0) {
            Say 'Glow Hands did not finish installing. The apps work without it; run this again later to add browser control.'
        }
    }

    Say 'Step 3 of 3: done.'
    Say "Open Glow from the Start menu (folder Glow) or the desktop. Setup guide: ${siteBase}setup/"
    if ($env:GLOW_NO_BROWSER -ne '1') {
        $guide = $siteBase + 'setup/?installed=1'
        if ($browser) { Start-Process $browser -ArgumentList "--app=$guide" } else { Start-Process $guide }
    }
}
