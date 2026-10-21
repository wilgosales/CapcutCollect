param([string]$Source = (Join-Path $PSScriptRoot '..\assets\icon.png'), [string]$Destination = (Join-Path $PSScriptRoot '..\assets\icon.ico'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sourceImage = [System.Drawing.Image]::FromFile([IO.Path]::GetFullPath($Source))
try {
  $frames = @()
  foreach ($dimension in @(16,32,48,64,128,256)) {
    $bitmap = [Drawing.Bitmap]::new($dimension,$dimension)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $stream = [IO.MemoryStream]::new()
    try {
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($sourceImage,0,0,$dimension,$dimension)
      $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
      $frames += @{ Size=$dimension; Bytes=$stream.ToArray() }
    } finally { $graphics.Dispose(); $bitmap.Dispose(); $stream.Dispose() }
  }
  $fileStream = [IO.File]::Create([IO.Path]::GetFullPath($Destination))
  $writer = [IO.BinaryWriter]::new($fileStream)
  try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
      $sizeByte = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
      $writer.Write([byte]$sizeByte); $writer.Write([byte]$sizeByte); $writer.Write([byte]0); $writer.Write([byte]0)
      $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
      $offset += $frame.Bytes.Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
  } finally { $writer.Dispose(); $fileStream.Dispose() }
} finally { $sourceImage.Dispose() }
Write-Output "Windows icon generated."
