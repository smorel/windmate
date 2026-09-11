# Re-crop marketing PNGs from windmate-with-unsure-sessions-screenshot.png
# Then: npm run assets:sync

param(
  [string]$Src = (Join-Path $PSScriptRoot '..\assets\windmate-with-unsure-sessions-screenshot.png'),
  [string]$OutDir = (Join-Path $PSScriptRoot '..\assets')
)

function Save-Crop($src, $dst, $x, $y, $w, $h) {
  Add-Type -AssemblyName System.Drawing
  $bmp = [System.Drawing.Bitmap]::FromFile($src)
  $y2 = [Math]::Min($y + $h, $bmp.Height)
  $h2 = $y2 - $y
  $rect = New-Object System.Drawing.Rectangle([int]$x, [int]$y, [int]$w, [int]$h2)
  $crop = $bmp.Clone($rect, $bmp.PixelFormat)
  $crop.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
  $crop.Dispose()
  $bmp.Dispose()
}

$W = 2668
@(
  @('marketing-hero.png', 0, 0, $W, 520),
  @('marketing-watchlist.png', 0, 380, $W, 1680),
  @('marketing-sessions.png', 0, 1980, $W, 580),
  @('marketing-horizon.png', 0, 2565, $W, 640),
  @('marketing-map.png', 0, 3180, $W, 1480),
  @('marketing-matrix.png', 0, 3280, $W, 1380),
  @('marketing-heatmap.png', 0, 3480, $W, 1180),
  @('marketing-ranked-spot.png', 0, 3280, $W, 1380),
  @('marketing-departure.png', 0, 1680, $W, 420)
) | ForEach-Object {
  Save-Crop $Src (Join-Path $OutDir $_[0]) $_[1] $_[2] $_[3] $_[4]
  Write-Host "Wrote $($_[0])"
}
