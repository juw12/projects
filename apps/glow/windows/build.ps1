# Builds Glow-Setup.exe (Windows only; uses the C# compiler that ships with the .NET Framework).
#   powershell -ExecutionPolicy Bypass -File apps/glow/windows/build.ps1 [-Out dist]
param([string]$Out = (Join-Path $PSScriptRoot 'dist'))
$ErrorActionPreference = 'Stop'
$glow = Split-Path $PSScriptRoot -Parent
New-Item -ItemType Directory -Force -Path $Out | Out-Null

# The program icon: the Glow logo at every size Windows shows (16 to 256 px).
Add-Type -AssemblyName System.Drawing
$source = [Drawing.Image]::FromFile((Join-Path $glow 'web\icons\icon-512.png'))
$images = @()
foreach ($size in @(16, 20, 24, 32, 40, 48, 64, 96, 128, 256)) {
    $bitmap = New-Object Drawing.Bitmap($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($source, 0, 0, $size, $size)
    $graphics.Dispose()
    $buffer = New-Object IO.MemoryStream
    $bitmap.Save($buffer, [Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    $images += , @($size, $buffer.ToArray())
}
$source.Dispose()
$iconPath = Join-Path $Out 'glow.ico'
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
[IO.File]::WriteAllBytes($iconPath, $stream.ToArray())
$writer.Close()

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$exe = Join-Path $Out 'Glow-Setup.exe'
$script = Join-Path $glow 'install-glow.ps1'
& $csc /nologo /optimize+ /target:winexe /platform:anycpu "/out:$exe" "/win32icon:$iconPath" `
    "/resource:$script,GlowSetup.install-glow.ps1" `
    /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
    (Join-Path $PSScriptRoot 'GlowSetup.cs')
if ($LASTEXITCODE -ne 0) { throw "C# compile failed ($LASTEXITCODE)" }
Write-Host "Built $exe ($((Get-Item $exe).Length) bytes)"
