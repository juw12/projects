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
#   Pin an app by right-clicking its window on the taskbar, or Glow in the Start menu: the pin keeps the Glow icon.
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

    # Windows shortcuts need .ico files. This one holds PNG images at every size the Start menu,
    # desktop and taskbar ask for (16 to 256 px), so Windows never has to fall back to a blank icon.
    function Save-Icon($relativePath, $icoPath) {
        if ($env:GLOW_SOURCE) {
            $png = [IO.File]::ReadAllBytes((Join-Path $env:GLOW_SOURCE ('web/' + $relativePath)))
        } else {
            $png = (Invoke-WebRequest -UseBasicParsing -Uri ($siteBase + $relativePath)).Content
        }
        Add-Type -AssemblyName System.Drawing
        $source = [Drawing.Image]::FromStream((New-Object IO.MemoryStream(, $png)))
        $images = @()
        foreach ($size in @(16, 20, 24, 32, 40, 48, 64, 96, 128, 256)) {
            $bitmap = New-Object Drawing.Bitmap($size, $size)
            $graphics = [Drawing.Graphics]::FromImage($bitmap)
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage($source, 0, 0, $size, $size)
            $graphics.Dispose()
            $buffer = New-Object IO.MemoryStream
            $bitmap.Save($buffer, [Drawing.Imaging.ImageFormat]::Png)
            $bitmap.Dispose()
            $images += , @($size, $buffer.ToArray())
        }
        $source.Dispose()
        $stream = New-Object IO.MemoryStream
        $writer = New-Object IO.BinaryWriter($stream)
        $writer.Write([UInt16]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]$images.Count)
        $offset = 6 + 16 * $images.Count
        foreach ($image in $images) {
            $writer.Write([byte]($image[0] % 256))
            $writer.Write([byte]($image[0] % 256))
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([UInt16]1)
            $writer.Write([UInt16]32)
            $writer.Write([UInt32]$image[1].Length)
            $writer.Write([UInt32]$offset)
            $offset += $image[1].Length
        }
        foreach ($image in $images) { $writer.Write([byte[]]$image[1]) }
        $writer.Flush()
        [IO.File]::WriteAllBytes($icoPath, $stream.ToArray())
        $writer.Close()
    }

    # The Edge profile the app windows open in (the one you last used), so they share your Glow account.
    function Get-EdgeProfile {
        try {
            $state = Get-Content (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\Local State') -Raw | ConvertFrom-Json
            if ($state.profile.last_used) { return [string]$state.profile.last_used }
        } catch { }
        return 'Default'
    }

    # Windows groups and pins taskbar buttons by AppUserModelID. Edge gives each --app window an ID built
    # from the page address (and the profile). A shortcut carrying that same ID is what Windows pins, with
    # its Glow icon, instead of a blank "Microsoft Edge" button. Long parts are cut in the middle, like Edge does.
    function Get-EdgeAppId($url, $profileDir) {
        $uri = [Uri]$url
        $name = $uri.Host + '_' + $uri.AbsolutePath
        if ($profileDir -eq 'Default') { $limit = 31; $suffix = '' }
        else { $limit = 20; $suffix = '.UserData.' + ($profileDir -replace '\s', '') }
        if ($name.Length -gt $limit) {
            $head = [Math]::Floor($limit / 2)
            $tail = $limit - $head
            $name = $name.Substring(0, $head) + $name.Substring($name.Length - $tail)
        }
        return 'MSEdge.' + $name + $suffix
    }

    function Set-ShortcutAppId($path, $appId) {
        if (-not ('GlowShortcut' -as [type])) {
            Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class GlowShortcut
{
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, IntPtr key);
        [PreserveSig] int GetValue(IntPtr key, IntPtr value);
        [PreserveSig] int SetValue(IntPtr key, IntPtr value);
        [PreserveSig] int Commit();
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr bindContext, int flags, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
    public static void SetAppId(string path, string appId)
    {
        Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IPropertyStore store;
        int hr = SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 2, ref iid, out store);
        if (hr != 0) throw new COMException("Cannot open shortcut properties", hr);
        IntPtr key = Marshal.AllocHGlobal(20);
        IntPtr value = Marshal.AllocHGlobal(24);
        IntPtr text = Marshal.StringToCoTaskMemUni(appId);
        try
        {
            Marshal.Copy(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3").ToByteArray(), 0, key, 16);
            Marshal.WriteInt32(key, 16, 5);
            for (int i = 0; i < 24; i++) Marshal.WriteByte(value, i, 0);
            Marshal.WriteInt16(value, 0, 31);
            Marshal.WriteIntPtr(value, 8, text);
            hr = store.SetValue(key, value);
            if (hr == 0) hr = store.Commit();
            if (hr != 0) throw new COMException("Cannot save shortcut properties", hr);
        }
        finally
        {
            Marshal.FreeCoTaskMem(text);
            Marshal.FreeHGlobal(key);
            Marshal.FreeHGlobal(value);
            Marshal.ReleaseComObject(store);
        }
    }
}
"@
        }
        [GlowShortcut]::SetAppId($path, $appId)
    }

    function New-AppShortcut($folder, $app, $browser, $iconPath, $edgeProfile) {
        $url = $siteBase + $app.Page
        if ($browser) {
            $path = Join-Path $folder ($app.Name + '.lnk')
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($path)
            $shortcut.TargetPath = $browser
            $shortcut.Arguments = if ($edgeProfile) { "--profile-directory=`"$edgeProfile`" --app=$url" } else { "--app=$url" }
            $shortcut.IconLocation = "$iconPath,0"
            $shortcut.Description = $app.About
            $shortcut.Save()
            if ($edgeProfile) {
                try { Set-ShortcutAppId $path (Get-EdgeAppId $url $edgeProfile) }
                catch { Say "  (could not tag $($app.Name) for the taskbar: $($_.Exception.Message))" }
            }
            return $path
        } else {
            # No Edge or Chrome: an internet shortcut opens the page in the default browser.
            $lines = @('[InternetShortcut]', "URL=$url", "IconFile=$iconPath", 'IconIndex=0')
            Set-Content -Path (Join-Path $folder ($app.Name + '.url')) -Value $lines -Encoding ASCII
            return $null
        }
    }

    # A Glow window pinned before this fix became a blank "Microsoft Edge" button. Point such pins at the
    # matching Glow app (by the window ID stored in the pin) and give them the Glow icon.
    function Repair-TaskbarPins($browser, $edgeProfile, $iconDir) {
        $pinDir = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
        if (-not (Test-Path $pinDir) -or -not $edgeProfile) { return }
        $shellApp = New-Object -ComObject Shell.Application
        $folder = $shellApp.Namespace($pinDir)
        foreach ($file in Get-ChildItem $pinDir -Filter '*.lnk') {
            $pinId = [string]$folder.ParseName($file.Name).ExtendedProperty('System.AppUserModel.ID')
            if ($pinId -notlike 'MSEdge.juw12.github.io*') { continue }
            $match = $apps | Where-Object { (Get-EdgeAppId ($siteBase + $_.Page) $edgeProfile) -eq $pinId } | Select-Object -First 1
            if (-not $match) { $match = $apps[0] }
            $url = $siteBase + $match.Page
            $shell = New-Object -ComObject WScript.Shell
            $pin = $shell.CreateShortcut($file.FullName)
            $pin.TargetPath = $browser
            $pin.Arguments = "--profile-directory=`"$edgeProfile`" --app=$url"
            $pin.IconLocation = (Join-Path $iconDir ($match.Name + '.ico')) + ',0'
            $pin.Description = $match.About
            $pin.Save()
            try { Set-ShortcutAppId $file.FullName (Get-EdgeAppId $url $edgeProfile) } catch { }
            Say "  repaired the pinned taskbar button for $($match.Name)"
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
    $edgeProfile = $null
    if ($browser -and $browser -like '*msedge.exe') { $edgeProfile = Get-EdgeProfile }
    if ($browser) { Say "App windows will open in $([IO.Path]::GetFileNameWithoutExtension($browser))." }
    else { Say 'Edge or Chrome not found; the shortcuts will open in your default browser.' }
    New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
    New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
    foreach ($app in $apps) {
        $iconPath = Join-Path $iconDir ($app.Name + '.ico')
        try { Save-Icon $app.Icon $iconPath } catch { Say "Could not fetch the $($app.Name) icon; using the browser icon." }
        if (-not (Test-Path $iconPath)) { $iconPath = if ($browser) { $browser } else { '' } }
        $null = New-AppShortcut $startMenuDir $app $browser $iconPath $edgeProfile
        if ($env:GLOW_NO_DESKTOP -ne '1') { $null = New-AppShortcut $desktopDir $app $browser $iconPath $edgeProfile }
        Say "  added $($app.Name)"
    }
    if ($browser) { Repair-TaskbarPins $browser $edgeProfile $iconDir }

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
        # The guide opens as a normal browser tab, so it is never mistaken for (or pinned as) the Glow app.
        Start-Process ($siteBase + 'setup/?installed=1')
    }
}
