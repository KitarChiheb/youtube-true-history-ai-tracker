Add-Type -AssemblyName System.Drawing
$sizes = @(16, 48, 128)
$base = "C:\Users\chihe\Documents\projects\products\yt-true-history\icons"

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.SmoothingMode = 'AntiAlias'

    $bgColor = [System.Drawing.Color]::FromArgb(255, 5, 7, 20)
    $accent = [System.Drawing.Color]::FromArgb(255, 255, 92, 102)
    $accent2 = [System.Drawing.Color]::FromArgb(255, 122, 125, 255)

    $gfx.Clear($bgColor)

    $padding = [Math]::Round($size * 0.15)
    $ellipseWidth = $size - (2 * $padding)
    $ellipseHeight = $size - (2 * $padding)
    $ellipseRect = [System.Drawing.Rectangle]::new($padding, $padding, $ellipseWidth, $ellipseHeight)
    $gradientMode = [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
    $brushAccent = [System.Drawing.Drawing2D.LinearGradientBrush]::new($ellipseRect, $accent, $accent2, $gradientMode)
    $gfx.FillEllipse($brushAccent, $ellipseRect)

    $fontSize = [Math]::Max(6, [Math]::Round($size * 0.42))
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold)
    $text = 'YT'
    $textSize = $gfx.MeasureString($text, $font)
    $textX = ($size - $textSize.Width) / 2
    $textY = ($size - $textSize.Height) / 2
    $whiteBrush = [System.Drawing.Brushes]::White
    $gfx.DrawString($text, $font, $whiteBrush, $textX, $textY)

    $brushAccent.Dispose()
    $gfx.Dispose()
    $font.Dispose()

    $outputPath = Join-Path $base ("icon{0}.png" -f $size)
    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
