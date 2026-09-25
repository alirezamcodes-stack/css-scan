Add-Type -AssemblyName System.Drawing

$iconDirectory = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force -Path $iconDirectory | Out-Null

$base = [System.Drawing.Bitmap]::new(128, 128)
$graphics = [System.Drawing.Graphics]::FromImage($base)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::Transparent)

$path = [System.Drawing.Drawing2D.GraphicsPath]::new()
$path.AddArc(4, 4, 36, 36, 180, 90)
$path.AddArc(88, 4, 36, 36, 270, 90)
$path.AddArc(88, 88, 36, 36, 0, 90)
$path.AddArc(4, 88, 36, 36, 90, 90)
$path.CloseFigure()
$background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(18, 27, 34))
$graphics.FillPath($background, $path)

$mint = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(116, 244, 181))
$font = [System.Drawing.Font]::new('Consolas', 60, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$graphics.DrawString('{', $font, $mint, 11, 22)
$graphics.DrawString('}', $font, $mint, 72, 22)

$pointer = [System.Drawing.Drawing2D.GraphicsPath]::new()
$pointer.AddPolygon([System.Drawing.Point[]]@(
    [System.Drawing.Point]::new(55, 45),
    [System.Drawing.Point]::new(58, 95),
    [System.Drawing.Point]::new(72, 82),
    [System.Drawing.Point]::new(85, 103),
    [System.Drawing.Point]::new(94, 97),
    [System.Drawing.Point]::new(81, 76),
    [System.Drawing.Point]::new(99, 72)
))
$white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$graphics.FillPath($white, $pointer)
$outline = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(18, 27, 34), 3)
$graphics.DrawPath($outline, $pointer)

foreach ($size in @(16, 32, 48, 128)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $scaled = [System.Drawing.Graphics]::FromImage($bitmap)
    $scaled.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $scaled.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $scaled.DrawImage($base, 0, 0, $size, $size)
    $bitmap.Save((Join-Path $iconDirectory "$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $scaled.Dispose()
    $bitmap.Dispose()
}

$graphics.Dispose()
$base.Dispose()
$path.Dispose()
$pointer.Dispose()
$background.Dispose()
$mint.Dispose()
$white.Dispose()
$outline.Dispose()
$font.Dispose()
