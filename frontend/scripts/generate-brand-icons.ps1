param(
  [Parameter(Mandatory = $true)]
  [string]$Source
)

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $projectRoot 'assets\images'
$publicRoot = Join-Path $projectRoot 'public'
$background = [System.Drawing.ColorTranslator]::FromHtml('#D5CCBB')

function Export-BrandImage {
  param(
    [System.Drawing.Image]$Image,
    [string]$Destination,
    [int]$Size
  )

  $canvas = New-Object System.Drawing.Bitmap($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  try {
    $graphics.Clear($background)
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

    $scale = [Math]::Min($Size / $Image.Width, $Size / $Image.Height)
    $width = [int][Math]::Round($Image.Width * $scale)
    $height = [int][Math]::Round($Image.Height * $scale)
    $left = [int][Math]::Round(($Size - $width) / 2)
    $top = [int][Math]::Round(($Size - $height) / 2)
    $graphics.DrawImage($Image, $left, $top, $width, $height)
    $canvas.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $graphics.Dispose()
    $canvas.Dispose()
  }
}

$sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
try {
  Export-BrandImage $sourceImage (Join-Path $assetRoot 'icon-light.png') 1024
  Export-BrandImage $sourceImage (Join-Path $assetRoot 'adaptive-icon-light.png') 1024
  Export-BrandImage $sourceImage (Join-Path $assetRoot 'favicon-light.png') 512
  Export-BrandImage $sourceImage (Join-Path $assetRoot 'splash-image-light.png') 1024
  Export-BrandImage $sourceImage (Join-Path $publicRoot 'app-icon-192-light.png') 192
  Export-BrandImage $sourceImage (Join-Path $publicRoot 'app-icon-512-light.png') 512
  Export-BrandImage $sourceImage (Join-Path $publicRoot 'apple-touch-icon-light.png') 180
  Export-BrandImage $sourceImage (Join-Path $publicRoot 'favicon-light.png') 192
  Export-BrandImage $sourceImage (Join-Path $publicRoot 'launch-logo-light.png') 1254
}
finally {
  $sourceImage.Dispose()
}
