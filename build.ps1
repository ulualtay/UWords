# Packs the extension into dist\uwords-<version>.xpi (a zip with forward-slash paths,
# which Firefox/Zen requires; Compress-Archive on Windows PowerShell can't guarantee that).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$out = Join-Path $dist "uwords-$version.xpi"
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }

$include = @('manifest.json', 'background', 'common', 'content', 'icons', 'pdf', 'pdfjs', 'popup', 'ui')

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($out, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($item in $include) {
    $path = Join-Path $root $item
    $files = if (Test-Path -LiteralPath $path -PathType Container) { Get-ChildItem -LiteralPath $path -Recurse -File } else { Get-Item -LiteralPath $path }
    foreach ($f in $files) {
      $entry = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  }
} finally {
  $zip.Dispose()
}
"Built $out"
