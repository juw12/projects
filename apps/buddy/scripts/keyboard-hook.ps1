# keyin Windows keyboard hook
#
# Low-level WH_KEYBOARD_LL hook via .NET p/invoke into user32.dll.
# Forwards each key event as one JSON object per line on stdout, e.g.
#   {"vk":65,"scanCode":30,"type":"down","timestamp":12345,"modifiers":{"shift":false,"ctrl":false,"alt":false,"meta":false}}
# Listens for "QUIT" on stdin so the Node side can shut it down cleanly.
#
# NOTE: WH_KEYBOARD_LL hooks must pump a message loop. We use a hidden
#       System.Windows.Forms.Control + Application.Run() so the CLR keeps
#       the hook alive. Exit the loop on "QUIT" stdin.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

# Load Win32 + Forms types once
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class Win32 {
    public const int WH_KEYBOARD_LL = 13;
    public const int WM_KEYDOWN     = 0x0100;
    public const int WM_KEYUP       = 0x0101;
    public const int WM_SYSKEYDOWN  = 0x0104;
    public const int WM_SYSKEYUP    = 0x0105;

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);
}
"@

# Modifiers we care about (VK codes): Shift=0x10, Ctrl=0x11, Alt=0x12, LWin=0x5B, RWin=0x5C
$script:modifiers = @{
    shift = [Win32]::GetAsyncKeyState(0x10) -band 0x8000 -ne 0
    ctrl  = [Win32]::GetAsyncKeyState(0x11) -band 0x8000 -ne 0
    alt   = [Win32]::GetAsyncKeyState(0x12) -band 0x8000 -ne 0
    meta  = ([Win32]::GetAsyncKeyState(0x5B) -band 0x8000 -ne 0) -or ([Win32]::GetAsyncKeyState(0x5C) -band 0x8000 -ne 0)
}

$script:stopRequested = $false

$hookCallback = {
    param($nCode, $wParam, $lParam)

    if ($nCode -lt 0) {
        return [Win32]::CallNextHookEx([IntPtr]::Zero, $nCode, $wParam, $lParam)
    }

    $type = 'down'
    if ($wParam -eq [Win32]::WM_KEYUP -or $wParam -eq [Win32]::WM_SYSKEYUP) { $type = 'up' }

    $info = [System.Runtime.InteropServices.Marshal]::PtrToStructure(
        $lParam, [type][Win32+KBDLLHOOKSTRUCT])

    $obj = [ordered]@{
        vk         = [int]$info.vkCode
        scanCode   = [int]$info.scanCode
        type       = $type
        timestamp  = [int][double]::Parse(([DateTime]::UtcNow - [DateTime]::new(1970,1,1,0,0,0,[DateTimeKind]::Utc)).TotalMilliseconds.ToString('F0'))
        modifiers  = @{
            shift = $script:modifiers.shift
            ctrl  = $script:modifiers.ctrl
            alt   = $script:modifiers.alt
            meta  = $script:modifiers.meta
        }
    }

    $json = (ConvertTo-Json -InputObject $obj -Compress)
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()

    return [Win32]::CallNextHookEx([IntPtr]::Zero, $nCode, $wParam, $lParam)
}

# We need a hidden form to drive the message pump
$form = New-Object System.Windows.Forms.Form
$form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
$form.ShowInTaskbar = $false
$form.Opacity = 0
$form.Width = 1; $form.Height = 1
$form.Visible = $false

# Set up the hook (last param = 0 = global)
$hMod = [Win32]::GetModuleHandle($null)
$hookPtr = [Win32]::SetWindowsHookEx([Win32]::WH_KEYBOARD_LL, $hookCallback, $hMod, 0)
if ($hookPtr -eq [IntPtr]::Zero) {
    [Console]::Error.WriteLine('Failed to install keyboard hook (admin required?).')
    exit 1
}

# Watch stdin for QUIT
$stdinJob = Start-Job -ScriptBlock {
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($line -eq 'QUIT') { exit 0 }
        if ($null -eq $line) { exit 0 }
    }
}

# Run the message loop on a background thread; poll for QUIT
$loopStarted = $false
try {
    # Run the form's message loop in a job so we can wait on stdin
    $msgLoop = Start-Job -ScriptBlock {
        param($f)
        [System.Windows.Forms.Application]::Run($f)
    } -ArgumentList $form

    # Poll stdin job and the msg-loop job
    while (-not $script:stopRequested) {
        if ($stdinJob.State -ne 'Running') {
            $script:stopRequested = $true
            break
        }
        Start-Sleep -Milliseconds 100
    }

    # Tear down
    [Win32]::UnhookWindowsHookEx($hookPtr) | Out-Null
    [System.Windows.Forms.Application]::Exit()
    Stop-Job -Job $msgLoop -ErrorAction SilentlyContinue
    Stop-Job -Job $stdinJob -ErrorAction SilentlyContinue
} catch {
    [Console]::Error.WriteLine("Hook loop error: $_")
    exit 1
}
