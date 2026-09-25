$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifestPath = Join-Path $projectRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$outputDirectory = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$archivePath = Join-Path $outputDirectory ("stylescan-ultra-{0}.zip" -f $manifest.version)

$files = @(
    'manifest.json', 'background.js',
    'popup.html', 'popup.css', 'popup.js',
    'options.html', 'options.css', 'options.js',
    'src', 'icons'
)
$paths = $files | ForEach-Object { Join-Path $projectRoot $_ }
foreach ($path in $paths) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing release file: $path" }
}

Compress-Archive -LiteralPath $paths -DestinationPath $archivePath -Force
Write-Output $archivePath
