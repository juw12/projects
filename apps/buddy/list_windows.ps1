$code = @'
using System;
using System.Runtime.InteropServices;
public class WG {
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L,T,Rg,B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
}
'@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue

Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
  $r = New-Object WG+R
  [WG]::GetWindowRect($_.MainWindowHandle, [ref]$r) | Out-Null
  $w = $r.Rg - $r.L
  $h = $r.B - $r.T
  "{0,-20} [{1,6}] '{2}' pos=({3},{4}) {5}x{6}" -f $_.ProcessName, $_.Id, $_.MainWindowTitle, $r.L, $r.T, $w, $h
}